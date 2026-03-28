import Foundation
import Combine

enum ViewState: Equatable {
    case loading
    case loaded
    case submitting
    case submitted
    case error(String)
}

@MainActor
class PreferenceViewModel: ObservableObject {
    @Published var pace: Double = 3
    @Published var budget: Double = 3
    @Published var adventure: Double = 3
    @Published var state: ViewState = .loading
    @Published var isEditing: Bool = false
    @Published var hasResponded: Bool = false
    @Published var responseCount: Int = 0
    @Published var totalCount: Int = 0

    // Track if user has touched each slider
    @Published var paceTouched = false
    @Published var budgetTouched = false
    @Published var adventureTouched = false

    let sessionID: String
    let participantID: String

    var allTouched: Bool {
        paceTouched && budgetTouched && adventureTouched
    }

    var canSubmit: Bool {
        allTouched && state != .submitting
    }

    init(sessionID: String, participantID: String) {
        self.sessionID = sessionID
        self.participantID = participantID
    }

    func loadStatus() async {
        state = .loading
        do {
            let status = try await APIService.shared.getPreferenceStatus(
                sessionID: sessionID,
                participantID: participantID
            )
            hasResponded = status.responded
            responseCount = status.responseCount
            totalCount = status.totalCount
            state = hasResponded ? .submitted : .loaded
        } catch {
            state = .error("Failed to load status. Tap to retry.")
        }
    }

    func submit() async {
        guard canSubmit else { return }
        state = .submitting
        do {
            let submission = PreferenceSubmission(
                participantID: participantID,
                pace: Int(pace),
                budget: Int(budget),
                adventure: Int(adventure)
            )
            let result = try await APIService.shared.submitPreferences(
                sessionID: sessionID,
                submission: submission
            )
            if result.success {
                hasResponded = true
                responseCount += 1
                isEditing = false
                state = .submitted
            } else {
                state = .error("Submission failed. Try again.")
            }
        } catch {
            state = .error("Network error. Tap to retry.")
        }
    }

    func enableEditing() {
        isEditing = true
        state = .loaded
        paceTouched = true
        budgetTouched = true
        adventureTouched = true
    }
}
