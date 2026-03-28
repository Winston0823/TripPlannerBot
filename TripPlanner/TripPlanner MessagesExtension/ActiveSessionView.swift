import SwiftUI
import Combine

@MainActor
class ActiveSessionViewModel: ObservableObject {
    @Published var state: ViewState = .loading
    @Published var session: APIService.ActiveSession?

    let participantID: String

    /// The sessionId returned from the server (= trip's chat_id)
    var resolvedSessionID: String {
        session?.sessionId ?? "unknown"
    }

    init(participantID: String) {
        self.participantID = participantID
    }

    func load() async {
        state = .loading
        do {
            session = try await APIService.shared.getActiveSession(
                participantID: participantID
            )
            state = .loaded
        } catch {
            state = .error("Could not connect to server.")
        }
    }
}

/// Smart landing page: auto-shows what the bot has set up for this chat
struct ActiveSessionView: View {
    @StateObject var viewModel: ActiveSessionViewModel
    var onShowPreferences: (String, String) -> Void  // sessionID, participantID
    var onShowVote: (String, String, String) -> Void  // sessionID, voteID, participantID
    var onShowPoll: () -> Void
    var onExpand: () -> Void

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                VStack {
                    ProgressView()
                    Text("Loading...")
                        .font(Theme.captionFont)
                        .foregroundColor(.secondary)
                        .padding(.top, 4)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .error(let msg):
                VStack(spacing: 12) {
                    Image(systemName: "wifi.slash")
                        .font(.system(size: 32))
                        .foregroundColor(.secondary)
                    Text(msg)
                        .font(Theme.captionFont)
                        .foregroundColor(.secondary)
                    Button("Retry") {
                        Task { await viewModel.load() }
                    }
                    .font(Theme.headlineFont)
                    .foregroundColor(Theme.brandColor)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            case .loaded:
                if let session = viewModel.session, session.hasTrip {
                    tripContent(session)
                } else {
                    noTripView
                }

            default:
                EmptyView()
            }
        }
        .task {
            await viewModel.load()
        }
    }

    // MARK: - Trip Content

    private func tripContent(_ session: APIService.ActiveSession) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                // Trip header
                if let trip = session.trip {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(trip.name)
                                .font(Theme.titleFont)
                            Text(trip.destination)
                                .font(Theme.bodyFont)
                                .foregroundColor(.secondary)
                            if let start = trip.startDate, let end = trip.endDate {
                                Text("\(start) → \(end)")
                                    .font(Theme.captionFont)
                                    .foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                        Image(systemName: "airplane")
                            .font(.system(size: 28))
                            .foregroundColor(Theme.brandColor)
                    }
                    .padding()
                    .background(Color(.systemBackground))
                    .cornerRadius(Theme.cardCornerRadius)
                    .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
                }

                // Preferences card
                if session.needsPreferences {
                    actionCard(
                        icon: "slider.horizontal.3",
                        title: "Share Your Preferences",
                        subtitle: "\(session.preferenceStatus?.responseCount ?? 0)/\(session.preferenceStatus?.totalCount ?? 0) filled in",
                        color: Theme.brandColor,
                        buttonText: "Fill In"
                    ) {
                        onShowPreferences(viewModel.resolvedSessionID, viewModel.participantID)
                    }
                } else if let pref = session.preferenceStatus, pref.responseCount > 0 {
                    infoCard(
                        icon: "checkmark.circle.fill",
                        title: "Preferences Submitted",
                        subtitle: "\(pref.responseCount)/\(pref.totalCount) filled in",
                        color: .green
                    )
                }

                // Active vote card
                if let poll = session.activePoll {
                    actionCard(
                        icon: "hand.thumbsup.fill",
                        title: poll.question,
                        subtitle: poll.userVote != nil ? "You voted ✓" : "\(poll.options.count) options — tap to vote",
                        color: .orange,
                        buttonText: poll.userVote != nil ? "View Results" : "Vote Now"
                    ) {
                        onShowVote(viewModel.resolvedSessionID, String(describing: "active"), viewModel.participantID)
                    }
                }

                // No active items
                if !session.needsPreferences && session.activePoll == nil {
                    VStack(spacing: 8) {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.green)
                        Text("All caught up!")
                            .font(Theme.headlineFont)
                        Text("No pending actions for this trip.")
                            .font(Theme.captionFont)
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 30)
                }
            }
            .padding()
        }
    }

    // MARK: - No Trip

    private var noTripView: some View {
        VStack(spacing: 16) {
            Image(systemName: "airplane.circle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No trip planned yet")
                .font(Theme.headlineFont)
            Text("Ask the bot to create a trip in the group chat!")
                .font(Theme.bodyFont)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Create Poll") { onShowPoll() }
                .buttonStyle(PrimaryButtonStyle())
                .frame(width: 200)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Card Components

    private func actionCard(icon: String, title: String, subtitle: String, color: Color, buttonText: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(Theme.headlineFont)
                        .lineLimit(2)
                    Text(subtitle)
                        .font(Theme.captionFont)
                        .foregroundColor(.secondary)
                }
                Spacer()
            }

            Button(action: action) {
                Text(buttonText)
                    .font(Theme.headlineFont)
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(color)
                    .cornerRadius(10)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }

    private func infoCard(icon: String, title: String, subtitle: String, color: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(color)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Theme.headlineFont)
                Text(subtitle)
                    .font(Theme.captionFont)
                    .foregroundColor(.secondary)
            }
            Spacer()
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
    }
}
