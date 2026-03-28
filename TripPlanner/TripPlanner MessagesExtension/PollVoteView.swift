import SwiftUI

struct PollVoteView: View {
    let poll: PollData
    var onVote: (PollData) -> Void

    private var totalVotes: Int {
        poll.options.reduce(0) { $0 + $1.votes }
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 16) {
                Text(poll.question)
                    .font(.title2)
                    .fontWeight(.bold)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                VStack(spacing: 12) {
                    ForEach(poll.options) { option in
                        Button(action: { vote(for: option.id) }) {
                            HStack {
                                Text(option.text)
                                    .foregroundColor(.primary)
                                Spacer()
                                if totalVotes > 0 {
                                    Text("\(option.votes)")
                                        .fontWeight(.semibold)
                                        .foregroundColor(.blue)
                                }
                            }
                            .padding()
                            .background(
                                ZStack(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 10)
                                        .fill(Color(.systemGray6))
                                    if totalVotes > 0 {
                                        GeometryReader { geo in
                                            RoundedRectangle(cornerRadius: 10)
                                                .fill(Color.blue.opacity(0.15))
                                                .frame(width: geo.size.width * CGFloat(option.votes) / CGFloat(max(totalVotes, 1)))
                                        }
                                    }
                                }
                            )
                            .cornerRadius(10)
                        }
                    }
                }
                .padding(.horizontal)

                if totalVotes > 0 {
                    Text("\(totalVotes) vote\(totalVotes == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Spacer()
            }
            .padding(.top)
            .navigationTitle("Poll")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func vote(for optionId: Int) {
        let updated = poll.withVote(for: optionId)
        onVote(updated)
    }
}
