import Foundation

class AppAPIService {
    static let shared = AppAPIService()

    private let baseURL = "https://adjunctively-decongestive-leta.ngrok-free.dev"

    // MARK: - Models

    struct TripInfo: Codable, Identifiable {
        let name: String
        let destination: String
        let startDate: String?
        let endDate: String?
        let stage: String?
        var id: String { name }
    }

    struct ParticipantInfo: Codable, Identifiable {
        let name: String
        let role: String?
        var id: String { name }
    }

    struct ItineraryItem: Codable, Identifiable, Hashable {
        let venueName: String
        let time: String?
        let type: String?
        let bookingUrl: String?
        let notes: String?
        var id: String { "\(venueName)-\(time ?? "")" }
    }

    struct ItineraryDay: Codable, Identifiable, Hashable {
        let dayNumber: Int
        let date: String?
        let isFreeDay: Bool
        let items: [ItineraryItem]
        var id: Int { dayNumber }
    }

    struct PreferencesFull: Codable {
        let avgPace: Double?
        let avgBudget: Double?
        let avgAdventure: Double?
        let responseCount: Int
        let totalCount: Int
        let needsSubmission: Bool
    }

    struct VenueOption: Codable, Identifiable, Hashable {
        let id: String
        let name: String
        let category: String
        let description: String
        let url: String?
    }

    struct PollInfo: Codable, Identifiable, Hashable {
        let pollId: String
        let question: String
        let options: [VenueOption]
        let userVote: String?
        let voteCounts: [String: Int]
        let closed: Bool
        let winningOption: String?
        var id: String { pollId }
    }

    struct StopInfo: Codable, Identifiable {
        let name: String
        let dayNumber: Int?
        let confidence: String?
        let type: String?
        var id: String { name }
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

    // MARK: - API Calls

    func getDashboard(participantID: String) async throws -> DashboardResponse {
        let url = URL(string: "\(baseURL)/participant/\(participantID)/dashboard")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(DashboardResponse.self, from: data)
    }

    func castVote(sessionID: String, pollId: String, participantID: String, optionID: String) async throws -> Bool {
        var request = URLRequest(url: URL(string: "\(baseURL)/vote-api/\(pollId)")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        struct VoteBody: Codable { let participantID: String; let optionID: String }
        request.httpBody = try JSONEncoder().encode(VoteBody(participantID: participantID, optionID: optionID))

        let (data, _) = try await URLSession.shared.data(for: request)
        struct Result: Codable { let success: Bool }
        return (try? JSONDecoder().decode(Result.self, from: data))?.success ?? false
    }

    func submitPreferences(sessionID: String, participantID: String, pace: Int, budget: Int, adventure: Int) async throws -> Bool {
        var request = URLRequest(url: URL(string: "\(baseURL)/session/\(sessionID)/preferences")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        struct Body: Codable { let participantID: String; let pace: Int; let budget: Int; let adventure: Int }
        request.httpBody = try JSONEncoder().encode(Body(participantID: participantID, pace: pace, budget: budget, adventure: adventure))

        let (data, _) = try await URLSession.shared.data(for: request)
        struct Result: Codable { let success: Bool }
        return (try? JSONDecoder().decode(Result.self, from: data))?.success ?? false
    }

    // MARK: - Mock Data

    func mockDashboard() -> DashboardResponse {
        DashboardResponse(
            hasTrip: true,
            sessionId: "mock-session",
            trip: TripInfo(name: "Nordik Escape", destination: "Copenhagen & Stockholm", startDate: "2026-04-15", endDate: "2026-04-22", stage: "venues"),
            participants: [
                ParticipantInfo(name: "Sara", role: "organizer"),
                ParticipantInfo(name: "Alex", role: "member"),
                ParticipantInfo(name: "Kim", role: "member"),
                ParticipantInfo(name: "Jay", role: "member"),
            ],
            itinerary: [
                ItineraryDay(dayNumber: 1, date: "2026-04-15", isFreeDay: false, items: [
                    ItineraryItem(venueName: "Hotel Sanders", time: "14:00", type: "confirmed", bookingUrl: "https://example.com", notes: "St. Kongensgade 6, Copenhagen"),
                    ItineraryItem(venueName: "Nyhavn Canal Walk", time: "16:30", type: "confirmed", bookingUrl: nil, notes: "Iconic colorful waterfront"),
                ]),
                ItineraryDay(dayNumber: 2, date: "2026-04-16", isFreeDay: false, items: [
                    ItineraryItem(venueName: "Design Museum Denmark", time: "10:00", type: "confirmed", bookingUrl: nil, notes: "Danish furniture & industrial design"),
                    ItineraryItem(venueName: "Noma", time: "19:00", type: "confirmed", bookingUrl: "https://example.com", notes: "New Nordic cuisine — reservation required"),
                ]),
                ItineraryDay(dayNumber: 3, date: "2026-04-17", isFreeDay: true, items: []),
                ItineraryDay(dayNumber: 4, date: "2026-04-18", isFreeDay: false, items: [
                    ItineraryItem(venueName: "Train to Stockholm (SJ)", time: "08:00", type: "confirmed", bookingUrl: "https://example.com", notes: "5hr scenic route"),
                    ItineraryItem(venueName: "Fotografiska", time: "15:00", type: "confirmed", bookingUrl: nil, notes: "Photography museum on the waterfront"),
                ]),
            ],
            stops: [
                StopInfo(name: "Hotel Sanders", dayNumber: 1, confidence: "confirmed", type: "confirmed"),
                StopInfo(name: "Design Museum", dayNumber: 2, confidence: "confirmed", type: "confirmed"),
            ],
            preferences: PreferencesFull(avgPace: 4.2, avgBudget: 3.8, avgAdventure: 2.5, responseCount: 4, totalCount: 5, needsSubmission: false),
            activePolls: [PollInfo(
                pollId: "1", question: "Where should we have dinner in Kyoto?",
                options: [
                    VenueOption(id: "1", name: "Kikunoi Honten", category: "Fine Dining", description: "Traditional Kaiseki cuisine served in a historic, serene atmosphere", url: nil),
                    VenueOption(id: "2", name: "Pontocho Alley Izakaya", category: "Casual", description: "Atmospheric alley dining with authentic local flavors", url: nil),
                    VenueOption(id: "3", name: "Nishiki Market Late Night", category: "Street Food", description: "Guided tasting tour through Kyoto's legendary food market", url: nil),
                ],
                userVote: nil,
                voteCounts: ["1": 4, "2": 1, "3": 0],
                closed: false, winningOption: nil
            )],
            closedPolls: [
                PollInfo(pollId: "2", question: "Accommodation", options: [], userVote: nil, voteCounts: [:], closed: true, winningOption: "Hotel Sanders"),
                PollInfo(pollId: "3", question: "Transport CPH→STO", options: [], userVote: nil, voteCounts: [:], closed: true, winningOption: "Train (SJ)"),
            ]
        )
    }
}
