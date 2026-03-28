//
//  MessagesViewController.swift
//  TripPlanner MessagesExtension
//
//  Created by Jiayuan Fu on 2026/3/28.
//

import UIKit
import SwiftUI
import Messages
import CryptoKit

class MessagesViewController: MSMessagesAppViewController {

    private var pendingAction: ExpandedAction?

    // MARK: - Lifecycle

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        presentViewController(for: presentationStyle, with: conversation)
    }

    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        // Do nothing here — wait until transition completes
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        guard let conversation = activeConversation else { return }
        presentViewController(for: presentationStyle, with: conversation)
    }

    override func didReceive(_ message: MSMessage, conversation: MSConversation) {
        presentViewController(for: presentationStyle, with: conversation)
    }

    // MARK: - View Routing

    private func presentViewController(
        for presentationStyle: MSMessagesAppPresentationStyle,
        with conversation: MSConversation
    ) {
        removeAllChildViewControllers()

        let participantID = deriveParticipantID(from: conversation)

        // Check if user tapped an existing interactive message
        if let selectedMessage = conversation.selectedMessage,
           let url = selectedMessage.url {

            // Try new bubble types first
            if let bubble = BubbleURL.parse(from: url) {
                presentBubbleView(bubble: bubble, participantID: participantID, conversation: conversation)
                return
            }

            // Fall back to legacy poll
            if let poll = PollData.from(url: url) {
                let view = PollVoteView(poll: poll) { [weak self] updatedPoll in
                    self?.sendPollMessage(updatedPoll, conversation: conversation, session: selectedMessage.session)
                }
                embed(AnyView(view))
                return
            }
        }

        // No message selected — show creation UI
        switch presentationStyle {
        case .compact:
            let view = CompactView { [weak self] action in
                self?.pendingAction = action
                self?.requestPresentationStyle(.expanded)
            }
            embed(AnyView(view))

        case .expanded:
            presentExpandedView(
                action: pendingAction ?? .preferences,
                participantID: participantID,
                conversation: conversation
            )
            pendingAction = nil

        default:
            let view = CompactView { [weak self] action in
                self?.pendingAction = action
                self?.requestPresentationStyle(.expanded)
            }
            embed(AnyView(view))
        }
    }

    // MARK: - Bubble View Routing

    private func presentBubbleView(
        bubble: BubbleURL,
        participantID: String,
        conversation: MSConversation
    ) {
        switch bubble.type {
        case .preference:
            let vm = PreferenceViewModel(
                sessionID: bubble.sessionID,
                participantID: participantID
            )
            let view = PreferenceCollectionView(viewModel: vm) { [weak self] in
                self?.dismiss()
            }
            embed(AnyView(view))

        case .vote:
            guard let voteID = bubble.voteID else { return }
            let vm = VenueVoteViewModel(
                sessionID: bubble.sessionID,
                voteID: voteID,
                participantID: participantID
            )
            let view = VenueVoteView(viewModel: vm) { [weak self] in
                self?.dismiss()
            }
            embed(AnyView(view))

        case .poll:
            break
        }
    }

    // MARK: - Expanded View Creation

    private func presentExpandedView(
        action: ExpandedAction,
        participantID: String,
        conversation: MSConversation
    ) {
        switch action {
        case .preferences:
            let sessionID = UUID().uuidString
            let vm = PreferenceViewModel(
                sessionID: sessionID,
                participantID: participantID
            )
            let view = PreferenceCollectionView(viewModel: vm) { [weak self] in
                self?.sendPreferenceBubble(sessionID: sessionID, conversation: conversation)
            }
            embed(AnyView(view))

        case .vote:
            let sessionID = UUID().uuidString
            let voteID = UUID().uuidString
            let vm = VenueVoteViewModel(
                sessionID: sessionID,
                voteID: voteID,
                participantID: participantID
            )
            let view = VenueVoteView(viewModel: vm) { [weak self] in
                self?.dismiss()
            }
            embed(AnyView(view))

        case .poll:
            let view = PollCreatorView { [weak self] poll in
                self?.sendPollMessage(poll, conversation: conversation, session: nil)
            }
            embed(AnyView(view))
        }
    }

    // MARK: - Send Preference Bubble

    private func sendPreferenceBubble(sessionID: String, conversation: MSConversation) {
        let message = MSMessage(session: MSSession())

        let layout = MSMessageTemplateLayout()
        layout.caption = "Share Your Travel Preferences"
        layout.subcaption = "Tap to fill in your preferences"
        layout.image = createBubbleImage(
            title: "Travel Preferences",
            subtitle: "Pace · Budget · Adventure"
        )

        message.url = BubbleURL.build(type: .preference, sessionID: sessionID)
        message.layout = layout
        message.summaryText = "Travel Preferences Survey"

        conversation.insert(message) { error in
            if let error = error {
                print("Failed to send preference bubble: \(error)")
            }
        }

        dismiss()
    }

    // MARK: - Send Vote Bubble

    private func sendVoteBubble(
        sessionID: String,
        voteID: String,
        question: String,
        conversation: MSConversation
    ) {
        let message = MSMessage(session: MSSession())

        let layout = MSMessageTemplateLayout()
        layout.caption = question
        layout.subcaption = "Tap to vote!"
        layout.image = createBubbleImage(
            title: question,
            subtitle: "Tap to see options and vote"
        )

        message.url = BubbleURL.build(type: .vote, sessionID: sessionID, voteID: voteID)
        message.layout = layout
        message.summaryText = question

        conversation.insert(message) { error in
            if let error = error {
                print("Failed to send vote bubble: \(error)")
            }
        }

        dismiss()
    }

    // MARK: - Send Legacy Poll

    private func sendPollMessage(_ poll: PollData, conversation: MSConversation, session: MSSession?) {
        let message = MSMessage(session: session ?? MSSession())

        let layout = MSMessageTemplateLayout()
        layout.caption = poll.question
        let totalVotes = poll.options.reduce(0) { $0 + $1.votes }
        if totalVotes > 0 {
            let topOption = poll.options.max(by: { $0.votes < $1.votes })
            layout.subcaption = "Leading: \(topOption?.text ?? "") (\(totalVotes) votes)"
        } else {
            layout.subcaption = "\(poll.options.count) options - Tap to vote!"
        }
        layout.image = createPollImage(poll)

        message.url = poll.toURLComponents().url
        message.layout = layout
        message.summaryText = "Poll: \(poll.question)"

        conversation.insert(message) { error in
            if let error = error { print("Failed to send message: \(error)") }
        }

        dismiss()
    }

    // MARK: - Image Generators

    private func createBubbleImage(title: String, subtitle: String) -> UIImage {
        let size = CGSize(width: 300, height: 140)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            Theme.brandUIColor.withAlphaComponent(0.08).setFill()
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 12).fill()

            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 17),
                .foregroundColor: UIColor.label
            ]
            NSAttributedString(string: title, attributes: titleAttrs)
                .draw(in: CGRect(x: 20, y: 30, width: 260, height: 44))

            let subAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 14),
                .foregroundColor: UIColor.secondaryLabel
            ]
            NSAttributedString(string: subtitle, attributes: subAttrs)
                .draw(at: CGPoint(x: 20, y: 90))
        }
    }

    private func createPollImage(_ poll: PollData) -> UIImage {
        let size = CGSize(width: 300, height: 200)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            UIColor.systemBlue.withAlphaComponent(0.1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))

            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 18),
                .foregroundColor: UIColor.label
            ]
            NSAttributedString(string: poll.question, attributes: titleAttrs)
                .draw(in: CGRect(x: 20, y: 20, width: 260, height: 50))

            let optAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 14),
                .foregroundColor: UIColor.secondaryLabel
            ]
            let emojis = ["1\u{FE0F}\u{20E3}", "2\u{FE0F}\u{20E3}", "3\u{FE0F}\u{20E3}", "4\u{FE0F}\u{20E3}", "5\u{FE0F}\u{20E3}", "6\u{FE0F}\u{20E3}"]
            for (i, option) in poll.options.prefix(4).enumerated() {
                NSAttributedString(string: "\(emojis[i]) \(option.text)", attributes: optAttrs)
                    .draw(at: CGPoint(x: 20, y: 80 + CGFloat(i) * 24))
            }
        }
    }

    // MARK: - Helpers

    private func deriveParticipantID(from conversation: MSConversation) -> String {
        let uuid = conversation.localParticipantIdentifier
        return ParticipantID.derive(from: uuid)
    }

    private func embed(_ view: AnyView) {
        let hostingController = UIHostingController(rootView: view)
        addChild(hostingController)
        hostingController.view.frame = self.view.bounds
        hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        self.view.addSubview(hostingController.view)
        hostingController.didMove(toParent: self)
    }

    private func removeAllChildViewControllers() {
        for child in children {
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }
    }
}
