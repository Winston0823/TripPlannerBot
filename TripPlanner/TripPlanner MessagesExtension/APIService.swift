import Foundation

// MARK: - API Response Models

struct PreferenceStatus: Codable {
    let responded: Bool
    let responseCount: Int
    let totalCount: Int
}

struct PreferenceSubmission: Codable {
    let participantID: String
    let pace: Int
    let budget: Int
    let adventure: Int
}

struct APISuccess: Codable {
    let success: Bool
}

struct VenueOption: Codable, Identifiable {
    let id: String
    let name: String
    let category: String
    let description: String
    let url: String?
}

struct VoteResponse: Codable {
    let question: String
    let options: [VenueOption]
    let userVote: String?
    let closed: Bool
    let voteCounts: [String: Int]
}

struct VoteCast: Codable {
    let participantID: String
    let optionID: String
}

struct VenueSuggestion: Codable {
    let participantID: String
    let name: String
    let description: String
    let url: String?
}

// MARK: - API Service

class APIService {
    static let shared = APIService()

    // Set via Xcode: Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables
    // Add: API_BASE_URL = https://your-ngrok-url.ngrok-free.app
    private let baseURL: String = {
        if let url = ProcessInfo.processInfo.environment["API_BASE_URL"], !url.isEmpty {
            return url
        }
        // Fallback for development — update this when you have a stable URL
        return "http://localhost:3001"
    }()

    private let useMock = true  // Set to false when backend has real session data

    // MARK: - Preference Endpoints

    func getPreferenceStatus(sessionID: String, participantID: String) async throws -> PreferenceStatus {
        if useMock { return mockPreferenceStatus() }

        let url = URL(string: "\(baseURL)/session/\(sessionID)/preference-status?participant=\(participantID)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(PreferenceStatus.self, from: data)
    }

    func submitPreferences(sessionID: String, submission: PreferenceSubmission) async throws -> APISuccess {
        if useMock { return APISuccess(success: true) }

        var request = URLRequest(url: URL(string: "\(baseURL)/session/\(sessionID)/preferences")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(submission)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(APISuccess.self, from: data)
    }

    // MARK: - Vote Endpoints

    func getVoteData(sessionID: String, voteID: String, participantID: String) async throws -> VoteResponse {
        if useMock { return mockVoteResponse() }

        let url = URL(string: "\(baseURL)/session/\(sessionID)/vote/\(voteID)?participant=\(participantID)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(VoteResponse.self, from: data)
    }

    func castVote(sessionID: String, voteID: String, vote: VoteCast) async throws -> APISuccess {
        if useMock { return APISuccess(success: true) }

        var request = URLRequest(url: URL(string: "\(baseURL)/session/\(sessionID)/vote/\(voteID)/cast")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(vote)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(APISuccess.self, from: data)
    }

    func suggestVenue(sessionID: String, voteID: String, suggestion: VenueSuggestion) async throws -> APISuccess {
        if useMock { return APISuccess(success: true) }

        var request = URLRequest(url: URL(string: "\(baseURL)/session/\(sessionID)/vote/\(voteID)/suggest")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(suggestion)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(APISuccess.self, from: data)
    }

    // MARK: - Active Session (what to show when user opens Extension)

    struct TripInfo: Codable {
        let name: String
        let destination: String
        let startDate: String?
        let endDate: String?
        let stage: String?
    }

    struct PreferenceSummary: Codable {
        let responseCount: Int
        let totalCount: Int
    }

    struct ActiveSession: Codable {
        let hasTrip: Bool
        let sessionId: String?
        let trip: TripInfo?
        let activePoll: VoteResponse?
        let needsPreferences: Bool
        let preferenceStatus: PreferenceSummary?
    }

    func getActiveSession(participantID: String) async throws -> ActiveSession {
        if useMock { return mockActiveSession() }

        let url = URL(string: "\(baseURL)/participant/\(participantID)/active")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(ActiveSession.self, from: data)
    }

    // MARK: - Mock Data

    private func mockActiveSession() -> ActiveSession {
        ActiveSession(
            hasTrip: true,
            sessionId: "mock-session",
            trip: TripInfo(name: "Tokyo Trip", destination: "Tokyo, Japan", startDate: "2026-04-15", endDate: "2026-04-22", stage: "preferences"),
            activePoll: mockVoteResponse(),
            needsPreferences: true,
            preferenceStatus: PreferenceSummary(responseCount: 2, totalCount: 5)
        )
    }

    private func mockPreferenceStatus() -> PreferenceStatus {
        PreferenceStatus(responded: false, responseCount: 3, totalCount: 5)
    }

    private func mockVoteResponse() -> VoteResponse {
        VoteResponse(
            question: "Day 2 dinner — where should we eat?",
            options: [
                VenueOption(id: "v1", name: "Sukiyabashi Jiro", category: "Sushi · $$$$", description: "World-renowned omakase sushi experience", url: "https://example.com/jiro"),
                VenueOption(id: "v2", name: "Ichiran Ramen", category: "Ramen · $", description: "Famous tonkotsu ramen with private booths", url: "https://example.com/ichiran"),
                VenueOption(id: "v3", name: "Gonpachi", category: "Izakaya · $$", description: "The 'Kill Bill' restaurant — yakitori and great atmosphere", url: "https://example.com/gonpachi"),
                VenueOption(id: "v4", name: "Tsuta", category: "Ramen · $$", description: "Michelin-starred soba-based ramen", url: nil),
            ],
            userVote: nil,
            closed: false,
            voteCounts: ["v1": 2, "v2": 1, "v3": 0, "v4": 1]
        )
    }
}
