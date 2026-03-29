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
        // Fallback: ngrok tunnel to bot's Mac
        return "https://adjunctively-decongestive-leta.ngrok-free.dev"
    }()

    private let useMock = false

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

    struct RoughSchedule: Codable {
        let transport: TransportInfo?

        struct TransportInfo: Codable {
            let cars: Int?
            let totalSeats: Int?
            let designatedDrivers: Int?
            let departurePoint: String?
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            transport = try? container.decode(TransportInfo.self, forKey: .transport)
        }

        private enum CodingKeys: String, CodingKey {
            case transport
        }
    }

    struct TripInfo: Codable {
        let name: String
        let destination: String
        let startDate: String?
        let endDate: String?
        let stage: String?
        let freeDayCount: Int?
        let organizer: String?
        let roughSchedule: RoughSchedule?
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

    // MARK: - Join Trip

    struct JoinResult: Codable {
        let success: Bool?
        let error: String?
        let tripName: String?
        let destination: String?
    }

    func joinTrip(joinCode: String, participantID: String, name: String?) async throws -> JoinResult {
        if useMock { return JoinResult(success: true, error: nil, tripName: "Tokyo Trip", destination: "Tokyo, Japan") }

        var request = URLRequest(url: URL(string: "\(baseURL)/trip/join")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        struct JoinBody: Codable { let joinCode: String; let participantID: String; let name: String? }
        request.httpBody = try JSONEncoder().encode(JoinBody(joinCode: joinCode, participantID: participantID, name: name))

        let (data, response) = try await URLSession.shared.data(for: request)
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
            let errorResult = try? JSONDecoder().decode(JoinResult.self, from: data)
            return JoinResult(success: false, error: errorResult?.error ?? "Failed to join", tripName: nil, destination: nil)
        }
        return try JSONDecoder().decode(JoinResult.self, from: data)
    }

    func getActiveSession(participantID: String) async throws -> ActiveSession {
        if useMock { return mockActiveSession() }

        let url = URL(string: "\(baseURL)/participant/\(participantID)/active")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(ActiveSession.self, from: data)
    }

    // MARK: - Dashboard

    struct ItineraryItem: Codable {
        let venueName: String
        let time: String?
        let type: String?
        let bookingUrl: String?
        let notes: String?
    }

    struct ItineraryDay: Codable, Identifiable {
        let dayNumber: Int
        let date: String?
        let isFreeDay: Bool
        let items: [ItineraryItem]
        var id: Int { dayNumber }
    }

    struct StopInfo: Codable, Identifiable {
        let name: String
        let dayNumber: Int?
        let confidence: String?
        let type: String?
        var id: String { name }
    }

    struct ParticipantInfo: Codable, Identifiable {
        let name: String
        let role: String?
        var id: String { name }
    }

    struct PreferencesFull: Codable {
        let avgPace: Double?
        let avgBudget: Double?
        let avgAdventure: Double?
        let responseCount: Int
        let totalCount: Int
        let needsSubmission: Bool
    }

    struct PollInfo: Codable, Identifiable {
        let pollId: String
        let question: String
        let options: [VenueOption]
        let userVote: String?
        let voteCounts: [String: Int]
        let closed: Bool
        let winningOption: String?
        var id: String { pollId }
    }

    struct DashboardResponse: Codable {
        let hasTrip: Bool
        let sessionId: String?
        let trip: TripInfo?
        let participants: [ParticipantInfo]?
        let itinerary: [ItineraryDay]?
        let stops: [StopInfo]?
        let preferences: PreferencesFull?
        let activePolls: [PollInfo]?
        let closedPolls: [PollInfo]?
    }

    func getDashboard(participantID: String) async throws -> DashboardResponse {
        if useMock { return mockDashboard() }

        let url = URL(string: "\(baseURL)/participant/\(participantID)/dashboard")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(DashboardResponse.self, from: data)
    }

    // MARK: - Mock Data

    private func mockDashboard() -> DashboardResponse {
        DashboardResponse(
            hasTrip: true,
            sessionId: "mock-session",
            trip: TripInfo(name: "Tokyo Trip", destination: "Tokyo, Japan", startDate: "2026-04-15", endDate: "2026-04-22", stage: "venues", freeDayCount: 1, organizer: "Stefan", roughSchedule: nil),
            participants: [
                ParticipantInfo(name: "Stefan", role: "organizer"),
                ParticipantInfo(name: "Alice", role: "member"),
                ParticipantInfo(name: "Bob", role: "member"),
            ],
            itinerary: [
                ItineraryDay(dayNumber: 1, date: "2026-04-15", isFreeDay: false, items: [
                    ItineraryItem(venueName: "Arrive at Narita Airport", time: "14:00", type: "confirmed", bookingUrl: nil, notes: "Take Narita Express to Shinjuku"),
                    ItineraryItem(venueName: "Ichiran Ramen", time: "19:00", type: "confirmed", bookingUrl: nil, notes: "Dinner"),
                ]),
                ItineraryDay(dayNumber: 2, date: "2026-04-16", isFreeDay: false, items: [
                    ItineraryItem(venueName: "Senso-ji Temple", time: "10:00", type: "confirmed", bookingUrl: nil, notes: nil),
                    ItineraryItem(venueName: "Sukiyabashi Jiro", time: "19:00", type: "confirmed", bookingUrl: "https://example.com", notes: "Reservation required"),
                ]),
                ItineraryDay(dayNumber: 3, date: "2026-04-17", isFreeDay: true, items: []),
            ],
            stops: [
                StopInfo(name: "Senso-ji Temple", dayNumber: 2, confidence: "confirmed", type: "confirmed"),
                StopInfo(name: "Shibuya Crossing", dayNumber: nil, confidence: "open", type: "proposed"),
            ],
            preferences: PreferencesFull(avgPace: 3.8, avgBudget: 2.5, avgAdventure: 4.2, responseCount: 3, totalCount: 5, needsSubmission: false),
            activePolls: [PollInfo(pollId: "1", question: "Day 4 activity?", options: [
                VenueOption(id: "1", name: "TeamLab", category: "Art", description: "Digital art museum", url: nil),
                VenueOption(id: "2", name: "Akihabara", category: "Shopping", description: "Electronics & anime district", url: nil),
            ], userVote: nil, voteCounts: ["1": 2, "2": 1], closed: false, winningOption: nil)],
            closedPolls: [PollInfo(pollId: "2", question: "Day 2 dinner?", options: [], userVote: "1", voteCounts: [:], closed: true, winningOption: "Sukiyabashi Jiro")]
        )
    }

    private func mockActiveSession() -> ActiveSession {
        ActiveSession(
            hasTrip: true,
            sessionId: "mock-session",
            trip: TripInfo(name: "Tokyo Trip", destination: "Tokyo, Japan", startDate: "2026-04-15", endDate: "2026-04-22", stage: "preferences", freeDayCount: 1, organizer: "Stefan", roughSchedule: nil),
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
