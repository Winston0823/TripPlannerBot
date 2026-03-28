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

    override func viewDidLoad() {
        super.viewDidLoad()
    }

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        presentUI(for: presentationStyle, with: conversation)
    }

    override func didTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        guard let conversation = activeConversation else { return }
        presentUI(for: presentationStyle, with: conversation)
    }

    // MARK: - Present UI

    private func presentUI(for style: MSMessagesAppPresentationStyle, with conversation: MSConversation) {
        removeChildren()

        let participantID = ParticipantID.derive(from: conversation.localParticipantIdentifier)
        // Use the chat identifier as session ID so bot and extension share the same data
        let sessionID = conversation.selectedMessage?.url.flatMap {
            BubbleURL.parse(from: $0)?.sessionID
        } ?? "default-session"

        // Tapped an existing message bubble
        if let msg = conversation.selectedMessage, let url = msg.url {
            if let bubble = BubbleURL.parse(from: url) {
                showBubble(bubble, participantID: participantID, conversation: conversation)
                return
            }
            if let poll = PollData.from(url: url) {
                show(PollVoteView(poll: poll) { [weak self] updated in
                    self?.sendPollMessage(updated, conversation: conversation, session: msg.session)
                })
                return
            }
        }

        // Compact: show action buttons
        if style == .compact {
            show(CompactView { [weak self] action in
                self?.pendingAction = action
                self?.requestPresentationStyle(.expanded)
            })
            return
        }

        // Expanded: if user chose a specific action, show that
        if let action = pendingAction {
            pendingAction = nil
            showDirectAction(action, sessionID: sessionID, participantID: participantID, conversation: conversation)
            return
        }

        // Expanded default: smart landing page — auto-detect what bot has set up
        let vm = ActiveSessionViewModel(sessionID: sessionID, participantID: participantID)
        show(ActiveSessionView(
            viewModel: vm,
            onShowPreferences: { [weak self] sid, pid in
                self?.removeChildren()
                let prefVM = PreferenceViewModel(sessionID: sid, participantID: pid)
                self?.show(PreferenceCollectionView(viewModel: prefVM) {
                    self?.dismiss()
                })
            },
            onShowVote: { [weak self] sid, vid, pid in
                self?.removeChildren()
                let voteVM = VenueVoteViewModel(sessionID: sid, voteID: vid, participantID: pid)
                self?.show(VenueVoteView(viewModel: voteVM) {
                    self?.dismiss()
                })
            },
            onShowPoll: { [weak self] in
                self?.removeChildren()
                self?.show(PollCreatorView { poll in
                    self?.sendPollMessage(poll, conversation: conversation, session: nil)
                })
            },
            onExpand: { [weak self] in
                self?.requestPresentationStyle(.expanded)
            }
        ))
    }

    // MARK: - Direct Action (from Compact buttons)

    private func showDirectAction(_ action: ExpandedAction, sessionID: String, participantID: String, conversation: MSConversation) {
        switch action {
        case .preferences:
            let vm = PreferenceViewModel(sessionID: sessionID, participantID: participantID)
            show(PreferenceCollectionView(viewModel: vm) { [weak self] in
                self?.sendPreferenceBubble(sessionID: sessionID, conversation: conversation)
            })
        case .vote:
            let voteID = UUID().uuidString
            let vm = VenueVoteViewModel(sessionID: sessionID, voteID: voteID, participantID: participantID)
            show(VenueVoteView(viewModel: vm) { [weak self] in self?.dismiss() })
        case .poll:
            show(PollCreatorView { [weak self] poll in
                self?.sendPollMessage(poll, conversation: conversation, session: nil)
            })
        }
    }

    // MARK: - Bubble Routing

    private func showBubble(_ bubble: BubbleURL, participantID: String, conversation: MSConversation) {
        switch bubble.type {
        case .preference:
            let vm = PreferenceViewModel(sessionID: bubble.sessionID, participantID: participantID)
            show(PreferenceCollectionView(viewModel: vm) { [weak self] in self?.dismiss() })
        case .vote:
            guard let voteID = bubble.voteID else { return }
            let vm = VenueVoteViewModel(sessionID: bubble.sessionID, voteID: voteID, participantID: participantID)
            show(VenueVoteView(viewModel: vm) { [weak self] in self?.dismiss() })
        case .poll:
            break
        }
    }

    // MARK: - Send Messages

    private func sendPreferenceBubble(sessionID: String, conversation: MSConversation) {
        let message = MSMessage(session: MSSession())
        let layout = MSMessageTemplateLayout()
        layout.caption = "Share Your Travel Preferences"
        layout.subcaption = "Tap to fill in"
        layout.image = makeImage(title: "Travel Preferences", subtitle: "Pace · Budget · Adventure")
        message.url = BubbleURL.build(type: .preference, sessionID: sessionID)
        message.layout = layout
        conversation.insert(message) { _ in }
        dismiss()
    }

    private func sendPollMessage(_ poll: PollData, conversation: MSConversation, session: MSSession?) {
        let message = MSMessage(session: session ?? MSSession())
        let layout = MSMessageTemplateLayout()
        layout.caption = poll.question
        let total = poll.options.reduce(0) { $0 + $1.votes }
        layout.subcaption = total > 0
            ? "Leading: \(poll.options.max(by: { $0.votes < $1.votes })?.text ?? "") (\(total) votes)"
            : "\(poll.options.count) options - Tap to vote!"
        layout.image = makeImage(title: poll.question, subtitle: "\(poll.options.count) options")
        message.url = poll.toURLComponents().url
        message.layout = layout
        conversation.insert(message) { _ in }
        dismiss()
    }

    // MARK: - Image

    private func makeImage(title: String, subtitle: String) -> UIImage {
        let size = CGSize(width: 300, height: 140)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            Theme.brandUIColor.withAlphaComponent(0.1).setFill()
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 12).fill()
            let t: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 17), .foregroundColor: UIColor.label]
            NSAttributedString(string: title, attributes: t).draw(in: CGRect(x: 20, y: 30, width: 260, height: 44))
            let s: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.secondaryLabel]
            NSAttributedString(string: subtitle, attributes: s).draw(at: CGPoint(x: 20, y: 90))
        }
    }

    // MARK: - Helpers

    private func show<V: View>(_ swiftUIView: V) {
        let host = UIHostingController(rootView: swiftUIView)
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
    }

    private func removeChildren() {
        for child in children {
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }
    }
}
