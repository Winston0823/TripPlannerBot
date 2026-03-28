import SwiftUI

struct VenueVoteView: View {
    @StateObject var viewModel: VenueVoteViewModel
    var onDismiss: () -> Void

    var body: some View {
        NavigationView {
            Group {
                switch viewModel.state {
                case .loading:
                    ProgressView("Loading venues...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                case .error(let message):
                    errorView(message: message)

                default:
                    voteContent
                }
            }
            .navigationTitle("Vote")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            await viewModel.loadVoteData()
        }
    }

    // MARK: - Vote Content

    private var voteContent: some View {
        ScrollView {
            VStack(spacing: 16) {
                // Question header
                Text(viewModel.question)
                    .font(Theme.titleFont)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                if viewModel.closed {
                    closedBanner
                }

                // Status
                HStack {
                    Image(systemName: "person.2.fill")
                        .foregroundColor(.secondary)
                    Text("\(viewModel.totalVotes) vote\(viewModel.totalVotes == 1 ? "" : "s")")
                        .font(Theme.captionFont)
                        .foregroundColor(.secondary)
                    if viewModel.hasVoted {
                        Text("· You voted")
                            .font(Theme.captionFont)
                            .foregroundColor(.green)
                    }
                }

                // Options list
                let displayOptions = viewModel.hasVoted ? viewModel.sortedOptions() : viewModel.options
                ForEach(displayOptions) { option in
                    VenueOptionCard(
                        option: option,
                        voteCount: viewModel.voteCounts[option.id] ?? 0,
                        totalVotes: viewModel.totalVotes,
                        isSelected: viewModel.selectedOptionID == option.id,
                        isUserVote: viewModel.userVote == option.id,
                        showVotes: viewModel.hasVoted || viewModel.closed,
                        isInteractive: !viewModel.hasVoted && !viewModel.closed
                    ) {
                        viewModel.selectedOptionID = option.id
                    }
                }

                // Action buttons
                if !viewModel.hasVoted && !viewModel.closed {
                    Button(action: {
                        Task { await viewModel.castVote() }
                    }) {
                        if viewModel.state == .submitting {
                            ProgressView().tint(.white)
                        } else {
                            Text("Confirm Vote")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(disabled: !viewModel.canCastVote))
                    .disabled(!viewModel.canCastVote)
                    .padding(.horizontal)
                }

                // Add suggestion
                if !viewModel.closed {
                    suggestionSection
                }
            }
            .padding(.vertical)
        }
    }

    // MARK: - Closed Banner

    private var closedBanner: some View {
        HStack {
            Image(systemName: "lock.fill")
            Text("Voting is closed")
                .font(Theme.headlineFont)
        }
        .foregroundColor(.orange)
        .padding(.vertical, 8)
        .padding(.horizontal, 16)
        .background(Color.orange.opacity(0.1))
        .cornerRadius(8)
    }

    // MARK: - Suggestion Section

    private var suggestionSection: some View {
        VStack(spacing: 12) {
            Button(action: { viewModel.showSuggestionForm.toggle() }) {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Suggest a Place")
                }
                .font(Theme.headlineFont)
                .foregroundColor(Theme.brandColor)
            }

            if viewModel.showSuggestionForm {
                VStack(spacing: 12) {
                    TextField("Place name", text: $viewModel.suggestionName)
                        .textFieldStyle(.roundedBorder)
                    TextField("Short description", text: $viewModel.suggestionDescription)
                        .textFieldStyle(.roundedBorder)
                    TextField("Link (optional)", text: $viewModel.suggestionURL)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                        .autocapitalization(.none)

                    Button("Submit Suggestion") {
                        Task { await viewModel.submitSuggestion() }
                    }
                    .buttonStyle(PrimaryButtonStyle(disabled: !viewModel.canSuggest))
                    .disabled(!viewModel.canSuggest)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(Theme.cardCornerRadius)
            }
        }
        .padding(.horizontal)
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "wifi.slash")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text(message)
                .font(Theme.bodyFont)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                Task { await viewModel.loadVoteData() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(width: 120)
            Spacer()
        }
        .padding()
    }
}

// MARK: - Venue Option Card

struct VenueOptionCard: View {
    let option: VenueOption
    let voteCount: Int
    let totalVotes: Int
    let isSelected: Bool
    let isUserVote: Bool
    let showVotes: Bool
    let isInteractive: Bool
    var onTap: () -> Void

    private var votePercentage: CGFloat {
        totalVotes > 0 ? CGFloat(voteCount) / CGFloat(totalVotes) : 0
    }

    var body: some View {
        Button(action: { if isInteractive { onTap() } }) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(option.name)
                        .font(Theme.headlineFont)
                        .foregroundColor(.primary)

                    if isUserVote {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                            .font(.system(size: 16))
                    }

                    Spacer()

                    if showVotes {
                        Text("\(voteCount)")
                            .font(.system(size: 18, weight: .bold, design: .rounded))
                            .foregroundColor(Theme.brandColor)
                    }
                }

                Text(option.category)
                    .font(Theme.captionFont)
                    .foregroundColor(Theme.brandColor)

                Text(option.description)
                    .font(Theme.captionFont)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                if let urlString = option.url, let url = URL(string: urlString) {
                    Link(destination: url) {
                        HStack(spacing: 4) {
                            Image(systemName: "safari")
                            Text("View Details")
                        }
                        .font(Theme.captionFont)
                        .foregroundColor(Theme.brandColor)
                    }
                }

                if showVotes && totalVotes > 0 {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 4)
                                .fill(Color(.systemGray5))
                                .frame(height: 6)
                            RoundedRectangle(cornerRadius: 4)
                                .fill(isUserVote ? Theme.brandColor : Theme.brandColor.opacity(0.5))
                                .frame(width: geo.size.width * votePercentage, height: 6)
                        }
                    }
                    .frame(height: 6)
                }
            }
            .padding()
            .background(
                RoundedRectangle(cornerRadius: Theme.cardCornerRadius)
                    .fill(Color(.systemBackground))
                    .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cardCornerRadius)
                    .stroke(isSelected ? Theme.brandColor : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
        .padding(.horizontal)
    }
}
