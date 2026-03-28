import Foundation
import CryptoKit

/// All supported interactive bubble types
enum BubbleType: String {
    case preference
    case vote
    case poll // legacy PoC polls
    case dashboard
}

/// Parses MSMessage.url to determine bubble type and extract metadata
struct BubbleURL {
    let type: BubbleType
    let sessionID: String
    let voteID: String?

    /// Parse a URL like: tripagent://bubble?type=preference&session=ABC&vote=XYZ
    static func parse(from url: URL) -> BubbleURL? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else { return nil }

        let dict = Dictionary(
            queryItems.map { ($0.name, $0.value ?? "") },
            uniquingKeysWith: { _, last in last }
        )

        // Support legacy poll URLs
        if dict["type"] == "poll" {
            return nil // Let PollData handle these
        }

        guard let typeStr = dict["type"],
              let type = BubbleType(rawValue: typeStr),
              let sessionID = dict["session"] else { return nil }

        return BubbleURL(
            type: type,
            sessionID: sessionID,
            voteID: dict["vote"]
        )
    }

    /// Build a URL for a given bubble type
    static func build(type: BubbleType, sessionID: String, voteID: String? = nil) -> URL? {
        var components = URLComponents()
        components.scheme = "tripagent"
        components.host = "bubble"
        components.queryItems = [
            URLQueryItem(name: "type", value: type.rawValue),
            URLQueryItem(name: "session", value: sessionID),
        ]
        if let voteID = voteID {
            components.queryItems?.append(URLQueryItem(name: "vote", value: voteID))
        }
        return components.url
    }
}

/// Derive participantID from MSMessage.senderParticipantIdentifier via SHA256
enum ParticipantID {
    static func derive(from identifier: UUID) -> String {
        let data = Data(identifier.uuidString.utf8)
        let hash = SHA256.hash(data: data)
        return hash.map { String(format: "%02x", $0) }.joined()
    }
}
