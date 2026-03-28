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

    // MARK: - Lifecycle

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

        // Tapped a message bubble
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

        // Compact: show trip preview
        if style == .compact {
            let vm = CompactViewModel(participantID: participantID)
            show(CompactView(viewModel: vm) { [weak self] in
                self?.requestPresentationStyle(.expanded)
            })
            return
        }

        // Expanded: show trip dashboard
        let vm = DashboardViewModel(participantID: participantID)
        show(TripDashboardView(
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
            onShareTrip: { [weak self] in
                guard let dash = vm.dashboard, let trip = dash.trip else { return }
                self?.sendTripBubble(trip: trip, sessionID: vm.sessionID, conversation: conversation)
            }
        ))
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
        case .poll, .dashboard:
            break
        }
    }

    // MARK: - Send Messages

    private func sendTripBubble(trip: APIService.TripInfo, sessionID: String, conversation: MSConversation) {
        let message = MSMessage(session: MSSession())
        let layout = MSMessageTemplateLayout()
        layout.caption = trip.name
        layout.subcaption = "\(trip.destination) · \(trip.startDate ?? "") → \(trip.endDate ?? "")"
        layout.image = makeImage(title: trip.name, subtitle: trip.destination)
        message.url = BubbleURL.build(type: .dashboard, sessionID: sessionID)
        message.layout = layout
        message.summaryText = "\(trip.name) — \(trip.destination)"
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
