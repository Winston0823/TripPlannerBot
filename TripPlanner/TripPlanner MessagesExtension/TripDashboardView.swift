import SwiftUI

struct TripDashboardView: View {
    @StateObject var viewModel: DashboardViewModel
    var onShowPreferences: (String, String) -> Void
    var onShowVote: (String, String, String) -> Void
    var onShareTrip: () -> Void

    var body: some View {
        Group {
            switch viewModel.state {
            case .loading:
                ProgressView("Loading trip...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .error(let msg):
                errorView(msg)
            case .loaded:
                if let dash = viewModel.dashboard, dash.hasTrip {
                    dashboardContent(dash)
                } else {
                    noTripView
                }
            default:
                EmptyView()
            }
        }
        .task { await viewModel.load() }
    }

    // MARK: - Dashboard Content

    private func dashboardContent(_ dash: APIService.DashboardResponse) -> some View {
        ScrollView {
            VStack(spacing: 16) {
                // Trip Header
                if let trip = dash.trip {
                    tripHeader(trip, participants: dash.participants ?? [])
                }

                // Active actions
                if let prefs = dash.preferences, prefs.needsSubmission {
                    actionCard(icon: "slider.horizontal.3", title: "Share Your Preferences",
                               subtitle: "\(prefs.responseCount)/\(prefs.totalCount) filled in",
                               color: Theme.brandColor, buttonText: "Fill In") {
                        onShowPreferences(viewModel.sessionID, viewModel.participantID)
                    }
                }

                if let polls = dash.activePolls, !polls.isEmpty {
                    ForEach(polls) { poll in
                        actionCard(icon: "hand.thumbsup.fill", title: poll.question,
                                   subtitle: poll.userVote != nil ? "You voted ✓" : "\(poll.options.count) options",
                                   color: .orange,
                                   buttonText: poll.userVote != nil ? "View Results" : "Vote Now") {
                            onShowVote(viewModel.sessionID, poll.pollId, viewModel.participantID)
                        }
                    }
                }

                // Preferences Chart
                if let prefs = dash.preferences, prefs.responseCount > 0 {
                    PreferenceChartView(preferences: prefs)
                }

                // Itinerary
                if let days = dash.itinerary, !days.isEmpty {
                    itinerarySection(days)
                }

                // Closed polls
                if let closed = dash.closedPolls, !closed.isEmpty {
                    closedPollsSection(closed)
                }

                // Checklist
                if let trip = dash.trip {
                    ChecklistView(tripId: trip.name)
                }

                // Share button
                Button(action: onShareTrip) {
                    Label("Share Trip to Chat", systemImage: "square.and.arrow.up")
                        .font(Theme.headlineFont)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Theme.brandColor)
                        .cornerRadius(Theme.buttonCornerRadius)
                }
                .padding(.horizontal)
                .padding(.bottom, 20)
            }
            .padding(.top)
        }
    }

    // MARK: - Trip Header

    private func tripHeader(_ trip: APIService.TripInfo, participants: [APIService.ParticipantInfo]) -> some View {
        VStack(spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(trip.name)
                        .font(Theme.titleFont)
                    HStack(spacing: 4) {
                        Image(systemName: "mappin.circle.fill")
                            .foregroundColor(Theme.brandColor)
                        Text(trip.destination)
                            .font(Theme.bodyFont)
                            .foregroundColor(.secondary)
                    }
                    if let start = trip.startDate, let end = trip.endDate {
                        HStack(spacing: 4) {
                            Image(systemName: "calendar")
                                .foregroundColor(.secondary)
                            Text("\(start) → \(end)")
                                .font(Theme.captionFont)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                Spacer()
                VStack(spacing: 4) {
                    Image(systemName: "airplane")
                        .font(.system(size: 28))
                        .foregroundColor(Theme.brandColor)
                }
            }

            HStack(spacing: 12) {
                // Countdown
                if !viewModel.countdownText.isEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "clock.fill")
                            .font(.system(size: 12))
                        Text(viewModel.countdownText)
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Theme.brandColor)
                    .cornerRadius(12)
                }

                // Participants
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill")
                        .font(.system(size: 12))
                    Text("\(participants.count) going")
                        .font(.system(size: 13, weight: .medium))
                }
                .foregroundColor(.secondary)

                Spacer()
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .padding(.horizontal)
    }

    // MARK: - Itinerary

    private func itinerarySection(_ days: [APIService.ItineraryDay]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "calendar.badge.clock")
                    .foregroundColor(Theme.brandColor)
                Text("Itinerary")
                    .font(Theme.headlineFont)
            }
            .padding(.horizontal)

            ForEach(days) { day in
                ItineraryDayCard(day: day)
            }
        }
    }

    // MARK: - Closed Polls

    private func closedPollsSection(_ polls: [APIService.PollInfo]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundColor(.green)
                Text("Decided")
                    .font(Theme.headlineFont)
            }
            .padding(.horizontal)

            ForEach(polls) { poll in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(poll.question)
                            .font(Theme.captionFont)
                            .foregroundColor(.secondary)
                        Text(poll.winningOption ?? "—")
                            .font(Theme.headlineFont)
                    }
                    Spacer()
                    Image(systemName: "trophy.fill")
                        .foregroundColor(.orange)
                }
                .padding()
                .background(Color(.systemBackground))
                .cornerRadius(Theme.cardCornerRadius)
                .shadow(color: .black.opacity(0.03), radius: 2, y: 1)
                .padding(.horizontal)
            }
        }
    }

    // MARK: - Helpers

    private func actionCard(icon: String, title: String, subtitle: String, color: Color, buttonText: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundColor(color)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Theme.headlineFont).lineLimit(2)
                    Text(subtitle).font(Theme.captionFont).foregroundColor(.secondary)
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
        .padding(.horizontal)
    }

    private var noTripView: some View {
        VStack(spacing: 16) {
            Image(systemName: "airplane.circle")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("No trip planned yet")
                .font(Theme.headlineFont)
            Text("Ask the bot to create a trip!")
                .font(Theme.bodyFont)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 32))
                .foregroundColor(.secondary)
            Text(msg).font(Theme.bodyFont).foregroundColor(.secondary)
            Button("Retry") { Task { await viewModel.load() } }
                .buttonStyle(PrimaryButtonStyle())
                .frame(width: 120)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
