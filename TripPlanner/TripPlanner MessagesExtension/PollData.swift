import Foundation

struct PollOption: Identifiable, Codable {
    let id: Int
    let text: String
    var votes: Int = 0
}

struct PollData: Codable {
    let question: String
    let options: [PollOption]
    let pollId: String

    /// Encode poll data into URL query items for MSMessage.url
    func toURLComponents() -> URLComponents {
        var components = URLComponents()
        components.queryItems = [
            URLQueryItem(name: "type", value: "poll"),
            URLQueryItem(name: "pollId", value: pollId),
            URLQueryItem(name: "question", value: question),
            URLQueryItem(name: "optionCount", value: "\(options.count)"),
        ]
        for (i, option) in options.enumerated() {
            components.queryItems?.append(URLQueryItem(name: "opt\(i)", value: option.text))
            components.queryItems?.append(URLQueryItem(name: "votes\(i)", value: "\(option.votes)"))
        }
        return components
    }

    /// Decode poll data from a URL
    static func from(url: URL) -> PollData? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems else { return nil }

        let dict = Dictionary(queryItems.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, last in last })

        guard dict["type"] == "poll",
              let pollId = dict["pollId"],
              let question = dict["question"],
              let countStr = dict["optionCount"],
              let count = Int(countStr) else { return nil }

        var options: [PollOption] = []
        for i in 0..<count {
            if let text = dict["opt\(i)"] {
                let votes = Int(dict["votes\(i)"] ?? "0") ?? 0
                options.append(PollOption(id: i, text: text, votes: votes))
            }
        }

        return PollData(question: question, options: options, pollId: pollId)
    }

    /// Return a copy with a vote added to the given option
    func withVote(for optionId: Int) -> PollData {
        let updated = options.map { option in
            if option.id == optionId {
                return PollOption(id: option.id, text: option.text, votes: option.votes + 1)
            }
            return option
        }
        return PollData(question: question, options: updated, pollId: pollId)
    }
}
