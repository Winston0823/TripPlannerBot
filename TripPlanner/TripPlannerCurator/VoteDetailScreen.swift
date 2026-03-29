import SwiftUI

struct VoteDetailScreen: View {
    let poll: AppAPIService.PollInfo
    @State private var selectedOption: String?
    @State private var hasVoted = false
    @State private var voteCounts: [String: Int] = [:]

    private var totalVotes: Int {
        voteCounts.values.reduce(0, +)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                // Header
                VStack(alignment: .leading, spacing: 12) {
                    Text("GROUP DECISION")
                        .font(.system(size: 11, weight: .semibold))
                        .tracking(3)
                        .foregroundColor(.secondary)

                    Text(poll.question)
                        .font(.system(size: 32, weight: .black))
                        .tracking(-1)
                        .lineSpacing(-4)

                    Text("Cast your vote. Majority wins.")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)

                // Options
                VStack(spacing: 12) {
                    ForEach(poll.options) { option in
                        VoteOptionCard(
                            option: option,
                            voteCount: voteCounts[option.id] ?? 0,
                            totalVotes: totalVotes,
                            isSelected: selectedOption == option.id,
                            hasVoted: hasVoted
                        ) {
                            if !hasVoted {
                                withAnimation(.easeInOut(duration: 0.2)) {
                                    selectedOption = option.id
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)

                // Confirm button
                if !hasVoted {
                    Button(action: confirmVote) {
                        Text("CONFIRM VOTE")
                            .font(.system(size: 13, weight: .black))
                            .tracking(3)
                            .foregroundColor(selectedOption != nil ? Color(.systemBackground) : .secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                            .background(selectedOption != nil ? Color.primary : Color(.systemGray5))
                            .cornerRadius(16)
                    }
                    .disabled(selectedOption == nil)
                    .padding(.horizontal, 24)
                }
            }
            .padding(.bottom, 120)
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text("CURATOR")
                    .font(.system(size: 14, weight: .black))
                    .tracking(4)
            }
        }
        .onAppear {
            voteCounts = poll.voteCounts
            if let uv = poll.userVote {
                selectedOption = uv
                hasVoted = true
            }
        }
    }

    private func confirmVote() {
        guard let optionId = selectedOption else { return }
        hasVoted = true
        voteCounts[optionId, default: 0] += 1

        Task {
            let _ = try? await AppAPIService.shared.castVote(
                sessionID: "", pollId: poll.pollId,
                participantID: "app-user", optionID: optionId
            )
        }
    }
}

// MARK: - Vote Option Card

struct VoteOptionCard: View {
    let option: AppAPIService.VenueOption
    let voteCount: Int
    let totalVotes: Int
    let isSelected: Bool
    let hasVoted: Bool
    let onTap: () -> Void

    private var percentage: Int {
        totalVotes > 0 ? Int(Double(voteCount) / Double(totalVotes) * 100) : 0
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 12) {
                // Header
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(option.category.uppercased())
                            .font(.system(size: 10, weight: .bold))
                            .tracking(2)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(isSelected ? Color.primary : Color(.systemGray5))
                            .foregroundColor(isSelected ? Color(.systemBackground) : .primary)
                            .cornerRadius(20)
                        Text(option.name)
                            .font(.system(size: 20, weight: .bold))
                            .tracking(-0.5)
                            .foregroundColor(.primary)
                    }
                    Spacer()
                    if isSelected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(.primary)
                    }
                }

                // Description
                Text(option.description)
                    .font(.system(size: 14))
                    .foregroundColor(.secondary)
                    .lineSpacing(4)

                // Vote bar (show after voting)
                if hasVoted {
                    VStack(spacing: 6) {
                        HStack {
                            Text("\(percentage)% CONSENSUS")
                                .font(.system(size: 10, weight: .bold))
                                .tracking(2)
                                .foregroundColor(isSelected ? .primary : .secondary)
                            Spacer()
                            Text("\(voteCount) VOTES")
                                .font(.system(size: 10, weight: .bold))
                                .tracking(2)
                                .foregroundColor(isSelected ? .primary : .secondary)
                        }

                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color(.systemGray5))
                                    .frame(height: 4)
                                RoundedRectangle(cornerRadius: 2)
                                    .fill(Color.primary)
                                    .frame(width: geo.size.width * CGFloat(percentage) / 100, height: 4)
                            }
                        }
                        .frame(height: 4)
                    }
                }
            }
            .padding(20)
            .background(Color(.systemBackground))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(isSelected ? Color.primary : Color.clear, lineWidth: 2)
            )
            .cornerRadius(16)
        }
        .buttonStyle(.plain)
    }
}
