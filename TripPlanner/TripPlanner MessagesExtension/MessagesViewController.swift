//
//  MessagesViewController.swift
//  TripPlanner MessagesExtension
//
//  Created by Jiayuan Fu on 2026/3/28.
//

import UIKit
import SwiftUI
import Messages

class MessagesViewController: MSMessagesAppViewController {

    // MARK: - Lifecycle

    override func willBecomeActive(with conversation: MSConversation) {
        super.willBecomeActive(with: conversation)
        presentViewController(for: presentationStyle, with: conversation)
    }

    override func willTransition(to presentationStyle: MSMessagesAppPresentationStyle) {
        guard let conversation = activeConversation else { return }
        presentViewController(for: presentationStyle, with: conversation)
    }

    override func didReceive(_ message: MSMessage, conversation: MSConversation) {
        // Re-present UI when a message arrives from the other party
        presentViewController(for: presentationStyle, with: conversation)
    }

    // MARK: - View Routing

    private func presentViewController(for presentationStyle: MSMessagesAppPresentationStyle, with conversation: MSConversation) {
        removeAllChildViewControllers()

        // Check if we're opening from a tapped poll message
        if let selectedMessage = conversation.selectedMessage,
           let url = selectedMessage.url,
           let poll = PollData.from(url: url) {
            // Show voting view
            let view = PollVoteView(poll: poll) { [weak self] updatedPoll in
                self?.sendPollMessage(updatedPoll, conversation: conversation, session: selectedMessage.session)
            }
            embed(AnyView(view))
            return
        }

        switch presentationStyle {
        case .compact:
            let view = CompactView {
                self.requestPresentationStyle(.expanded)
            }
            embed(AnyView(view))

        case .expanded:
            let view = PollCreatorView { [weak self] poll in
                self?.sendPollMessage(poll, conversation: conversation, session: nil)
            }
            embed(AnyView(view))

        default:
            let view = CompactView {
                self.requestPresentationStyle(.expanded)
            }
            embed(AnyView(view))
        }
    }

    // MARK: - Send Interactive Message

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
            if let error = error {
                print("Failed to send message: \(error)")
            }
        }

        dismiss()
    }

    // MARK: - Poll Image Generator

    private func createPollImage(_ poll: PollData) -> UIImage {
        let size = CGSize(width: 300, height: 200)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            // Background
            UIColor.systemBlue.withAlphaComponent(0.1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))

            // Poll icon
            let iconAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 40)
            ]
            let icon = NSAttributedString(string: "\u{1F4CA}", attributes: iconAttrs)
            icon.draw(at: CGPoint(x: 20, y: 15))

            // Question
            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 18),
                .foregroundColor: UIColor.label
            ]
            let title = NSAttributedString(string: poll.question, attributes: titleAttrs)
            title.draw(in: CGRect(x: 20, y: 70, width: 260, height: 50))

            // Options preview
            let optAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 14),
                .foregroundColor: UIColor.secondaryLabel
            ]
            let emojis = ["1\u{FE0F}\u{20E3}", "2\u{FE0F}\u{20E3}", "3\u{FE0F}\u{20E3}", "4\u{FE0F}\u{20E3}", "5\u{FE0F}\u{20E3}", "6\u{FE0F}\u{20E3}"]
            for (i, option) in poll.options.prefix(4).enumerated() {
                let text = NSAttributedString(string: "\(emojis[i]) \(option.text)", attributes: optAttrs)
                text.draw(at: CGPoint(x: 20, y: 125 + CGFloat(i) * 20))
            }
        }
    }

    // MARK: - Helpers

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
