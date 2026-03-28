import Foundation
import Combine

@MainActor
class VenueVoteViewModel: ObservableObject {
    @Published var state: ViewState = .loading
    @Published var question: String = ""
    @Published var options: [VenueOption] = []
    @Published var voteCounts: [String: Int] = [:]
    @Published var userVote: String? = nil
    @Published var closed: Bool = false
    @Published var selectedOptionID: String? = nil
    @Published var showSuggestionForm: Bool = false
    @Published var suggestionName: String = ""
    @Published var suggestionDescription: String = ""
    @Published var suggestionURL: String = ""

    let sessionID: String
    let voteID: String
    let participantID: String

    var totalVotes: Int {
        voteCounts.values.reduce(0, +)
    }

    var hasVoted: Bool {
        userVote != nil
    }

    var canCastVote: Bool {
        selectedOptionID != nil && !hasVoted && !closed && state != .submitting
    }

    var canSuggest: Bool {
        !suggestionName.trimmingCharacters(in: .whitespaces).isEmpty && !closed
    }

    init(sessionID: String, voteID: String, participantID: String) {
        self.sessionID = sessionID
        self.voteID = voteID
        self.participantID = participantID
    }

    func loadVoteData() async {
        state = .loading
        do {
            let response = try await APIService.shared.getVoteData(
                sessionID: sessionID,
                voteID: voteID,
                participantID: participantID
            )
            question = response.question
            options = response.options
            voteCounts = response.voteCounts
            userVote = response.userVote
            closed = response.closed
            selectedOptionID = response.userVote
            state = .loaded
        } catch {
            state = .error("Failed to load vote data. Tap to retry.")
        }
    }

    func castVote() async {
        guard let optionID = selectedOptionID else { return }
        state = .submitting
        do {
            let vote = VoteCast(participantID: participantID, optionID: optionID)
            let result = try await APIService.shared.castVote(
                sessionID: sessionID,
                voteID: voteID,
                vote: vote
            )
            if result.success {
                userVote = optionID
                voteCounts[optionID, default: 0] += 1
                state = .loaded
            } else {
                state = .error("Vote failed. Try again.")
            }
        } catch {
            state = .error("Network error. Tap to retry.")
        }
    }

    func submitSuggestion() async {
        guard canSuggest else { return }
        state = .submitting
        do {
            let suggestion = VenueSuggestion(
                participantID: participantID,
                name: suggestionName,
                description: suggestionDescription,
                url: suggestionURL.isEmpty ? nil : suggestionURL
            )
            let result = try await APIService.shared.suggestVenue(
                sessionID: sessionID,
                voteID: voteID,
                suggestion: suggestion
            )
            if result.success {
                // Add to local list optimistically
                let newOption = VenueOption(
                    id: UUID().uuidString,
                    name: suggestionName,
                    category: "Suggested",
                    description: suggestionDescription,
                    url: suggestionURL.isEmpty ? nil : suggestionURL
                )
                options.append(newOption)
                voteCounts[newOption.id] = 0
                suggestionName = ""
                suggestionDescription = ""
                suggestionURL = ""
                showSuggestionForm = false
                state = .loaded
            } else {
                state = .error("Suggestion failed. Try again.")
            }
        } catch {
            state = .error("Network error. Tap to retry.")
        }
    }

    func sortedOptions() -> [VenueOption] {
        options.sorted { (voteCounts[$0.id] ?? 0) > (voteCounts[$1.id] ?? 0) }
    }
}
