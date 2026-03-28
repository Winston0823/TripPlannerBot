import SwiftUI

struct PreferenceCollectionView: View {
    @StateObject var viewModel: PreferenceViewModel
    var onDismiss: () -> Void

    var body: some View {
        NavigationView {
            Group {
                switch viewModel.state {
                case .loading:
                    ProgressView("Loading...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)

                case .error(let message):
                    errorView(message: message)

                case .submitted where !viewModel.isEditing:
                    submittedView

                case .loaded, .submitting, .submitted:
                    sliderForm

                }
            }
            .navigationTitle("Travel Preferences")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            await viewModel.loadStatus()
        }
    }

    // MARK: - Slider Form

    private var sliderForm: some View {
        ScrollView {
            VStack(spacing: 24) {
                Text("Help us plan the perfect trip by sharing your preferences.")
                    .font(Theme.bodyFont)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)

                PreferenceSlider(
                    label: "Trip Pace",
                    leftLabel: "Relaxed",
                    rightLabel: "Packed",
                    value: $viewModel.pace,
                    touched: $viewModel.paceTouched,
                    icon: "figure.walk"
                )

                PreferenceSlider(
                    label: "Budget",
                    leftLabel: "Budget-friendly",
                    rightLabel: "Luxury",
                    value: $viewModel.budget,
                    touched: $viewModel.budgetTouched,
                    icon: "dollarsign.circle"
                )

                PreferenceSlider(
                    label: "Adventure",
                    leftLabel: "Familiar",
                    rightLabel: "Adventurous",
                    value: $viewModel.adventure,
                    touched: $viewModel.adventureTouched,
                    icon: "mountain.2"
                )

                Button(action: {
                    Task { await viewModel.submit() }
                }) {
                    if viewModel.state == .submitting {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Text("Submit Preferences")
                    }
                }
                .buttonStyle(PrimaryButtonStyle(disabled: !viewModel.canSubmit))
                .disabled(!viewModel.canSubmit)
                .padding(.horizontal)
                .padding(.top, 8)

                if !viewModel.allTouched {
                    Text("Drag all three sliders to enable submit")
                        .font(Theme.captionFont)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.vertical)
        }
    }

    // MARK: - Submitted State

    private var submittedView: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 60))
                .foregroundColor(.green)

            Text("Your preferences are saved")
                .font(Theme.titleFont)

            Text("\(viewModel.responseCount)/\(viewModel.totalCount) people have responded")
                .font(Theme.bodyFont)
                .foregroundColor(.secondary)

            Button("Edit My Preferences") {
                viewModel.enableEditing()
            }
            .font(Theme.headlineFont)
            .foregroundColor(Theme.brandColor)
            .padding(.top, 8)

            Spacer()
        }
        .padding()
    }

    // MARK: - Error State

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
                Task { await viewModel.loadStatus() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(width: 120)
            Spacer()
        }
        .padding()
    }
}

// MARK: - Preference Slider Component

struct PreferenceSlider: View {
    let label: String
    let leftLabel: String
    let rightLabel: String
    @Binding var value: Double
    @Binding var touched: Bool
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(Theme.brandColor)
                Text(label)
                    .font(Theme.headlineFont)
                Spacer()
                Text("\(Int(value))")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.brandColor)
                    .frame(width: 32, height: 32)
                    .background(Theme.brandColor.opacity(0.12))
                    .cornerRadius(8)
            }

            Slider(value: $value, in: 1...5, step: 1) { editing in
                if editing { touched = true }
            }
            .tint(Theme.brandColor)

            HStack {
                Text(leftLabel)
                    .font(Theme.captionFont)
                    .foregroundColor(.secondary)
                Spacer()
                Text(rightLabel)
                    .font(Theme.captionFont)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .padding(.horizontal)
    }
}
