import Foundation
import Combine

@MainActor
class DashboardViewModel: ObservableObject {
    @Published var state: ViewState = .loading
    @Published var dashboard: APIService.DashboardResponse?

    let participantID: String

    init(participantID: String) {
        self.participantID = participantID
    }

    var daysUntilTrip: Int? {
        guard let dateStr = dashboard?.trip?.startDate else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let startDate = formatter.date(from: dateStr) else { return nil }
        let days = Calendar.current.dateComponents([.day], from: Date(), to: startDate).day
        return days
    }

    var tripDuration: Int? {
        guard let start = dashboard?.trip?.startDate,
              let end = dashboard?.trip?.endDate else { return nil }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let s = formatter.date(from: start),
              let e = formatter.date(from: end) else { return nil }
        return Calendar.current.dateComponents([.day], from: s, to: e).day.map { $0 + 1 }
    }

    var countdownText: String {
        guard let days = daysUntilTrip else { return "" }
        if days > 0 { return "\(days) days to go" }
        if days == 0 { return "Trip starts today!" }
        if let duration = tripDuration, days > -duration { return "Trip in progress" }
        return "Trip completed"
    }

    var sessionID: String {
        dashboard?.sessionId ?? "unknown"
    }

    func load() async {
        state = .loading
        do {
            dashboard = try await APIService.shared.getDashboard(participantID: participantID)
            state = .loaded
        } catch {
            state = .error("Could not load trip data.")
        }
    }
}
