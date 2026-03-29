import SwiftUI
import Combine

struct JoinTripView: View {
    let participantID: String
    var onJoined: () -> Void

    @State private var joinCode = ""
    @State private var displayName = ""
    @State private var isJoining = false
    @State private var errorMessage: String?
    @State private var joinedTrip: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            // Icon
            Image(systemName: "airplane.circle")
                .font(.system(size: 56))
                .foregroundColor(Theme.brandColor)

            // Title
            VStack(spacing: 6) {
                Text("Join a Trip")
                    .font(Theme.titleFont)
                Text("Enter the join code from your group chat")
                    .font(Theme.bodyFont)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }

            // Success state
            if let tripName = joinedTrip {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 48))
                        .foregroundColor(.green)
                    Text("Joined \(tripName)!")
                        .font(Theme.headlineFont)
                }
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        onJoined()
                    }
                }
            } else {
                // Join form
                VStack(spacing: 14) {
                    // Join code input
                    TextField("Join Code (e.g. A3X7KM)", text: $joinCode)
                        .textFieldStyle(.plain)
                        .font(.system(size: 20, weight: .bold, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .textCase(.uppercase)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.characters)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)

                    // Display name
                    TextField("Your Name", text: $displayName)
                        .textFieldStyle(.plain)
                        .font(Theme.bodyFont)
                        .padding()
                        .background(Color(.systemGray6))
                        .cornerRadius(12)

                    // Error
                    if let error = errorMessage {
                        Text(error)
                            .font(Theme.captionFont)
                            .foregroundColor(.red)
                    }

                    // Join button
                    Button(action: joinTrip) {
                        if isJoining {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Text("Join Trip")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle(disabled: joinCode.count < 4))
                    .disabled(joinCode.count < 4 || isJoining)
                }
                .padding(.horizontal)
            }

            Spacer()
        }
        .padding()
    }

    private func joinTrip() {
        isJoining = true
        errorMessage = nil

        Task {
            do {
                let result = try await APIService.shared.joinTrip(
                    joinCode: joinCode.trimmingCharacters(in: .whitespaces),
                    participantID: participantID,
                    name: displayName.isEmpty ? nil : displayName
                )
                if result.success == true {
                    joinedTrip = result.tripName ?? "Trip"
                } else {
                    errorMessage = result.error ?? "Invalid join code"
                }
            } catch {
                errorMessage = "Could not connect to server"
            }
            isJoining = false
        }
    }
}
