import SwiftUI
import Combine

@MainActor
class CompactViewModel: ObservableObject {
    @Published var dashboard: APIService.DashboardResponse?
    @Published var loaded = false

    let participantID: String

    init(participantID: String) {
        self.participantID = participantID
    }

    func load() async {
        do {
            dashboard = try await APIService.shared.getDashboard(participantID: participantID)
            loaded = true
        } catch {
            loaded = true // Show fallback
        }
    }
}

struct CompactView: View {
    @StateObject var viewModel: CompactViewModel
    var onOpenDashboard: () -> Void
    var onJoinNew: () -> Void

    var body: some View {
      VStack(spacing: 0) {
        Button(action: onOpenDashboard) {
            if let dash = viewModel.dashboard, dash.hasTrip, let trip = dash.trip {
                HStack(spacing: 10) {
                    // Trip icon
                    VStack {
                        Image(systemName: "airplane")
                            .font(.system(size: 18))
                            .foregroundColor(Theme.brandColor)
                    }
                    .frame(width: 36, height: 36)
                    .background(Theme.brandColor.opacity(0.15))
                    .cornerRadius(8)

                    // Trip info
                    VStack(alignment: .leading, spacing: 2) {
                        Text(trip.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.primary)
                            .lineLimit(1)

                        HStack(spacing: 8) {
                            // Destination
                            HStack(spacing: 2) {
                                Image(systemName: "mappin")
                                    .font(.system(size: 9))
                                Text(trip.destination)
                                    .font(.system(size: 11))
                            }
                            .foregroundColor(.secondary)

                            // Action needed
                            if let prefs = dash.preferences, prefs.needsSubmission {
                                Text("· Preferences needed")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.orange)
                            } else if let polls = dash.activePolls, !polls.isEmpty {
                                Text("· Vote open")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.orange)
                            }
                        }
                    }

                    Spacer()

                    // Countdown or chevron
                    if let start = trip.startDate {
                        let days = daysUntil(start)
                        if let days = days, days > 0 {
                            VStack(spacing: 0) {
                                Text("\(days)")
                                    .font(.system(size: 16, weight: .bold, design: .rounded))
                                    .foregroundColor(Theme.brandColor)
                                Text("days")
                                    .font(.system(size: 9))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    Image(systemName: "chevron.up")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            } else {
                // No trip / loading
                HStack(spacing: 10) {
                    Image(systemName: "airplane")
                        .font(.system(size: 18))
                    Text(viewModel.loaded ? "No trip yet — tap to open" : "Loading...")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(viewModel.loaded ? .primary : .secondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)

        // Join different trip button
        if viewModel.loaded && viewModel.dashboard?.hasTrip == true {
            Button(action: onJoinNew) {
                HStack(spacing: 4) {
                    Image(systemName: "plus.circle")
                        .font(.system(size: 12))
                    Text("Join New Trip")
                        .font(.system(size: 11, weight: .medium))
                }
                .foregroundColor(Theme.brandColor)
                .padding(.bottom, 6)
            }
        }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(.systemBackground))
    .task { await viewModel.load() }
    }

    private func daysUntil(_ dateStr: String) -> Int? {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateStr) else { return nil }
        return Calendar.current.dateComponents([.day], from: Date(), to: date).day
    }
}
