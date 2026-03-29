import SwiftUI
import AuthenticationServices

struct HomeView: View {
    @EnvironmentObject var authManager: AuthManager
    @AppStorage("isDarkMode") private var isDarkMode = false
    @State private var showMenu = false
    @State private var trips: [TripCardData] = TripCardData.samples
    @State private var navigateToTrip: TripCardData?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    // Sign in banner
                    if !authManager.isSignedIn {
                        appleSignInBanner
                    }

                    // Header
                    VStack(alignment: .leading, spacing: 4) {
                        Text("YOUR COLLECTION")
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(2)
                            .foregroundColor(.secondary)
                        Text("My Trips")
                            .font(.system(size: 36, weight: .black))
                            .tracking(-1)
                    }

                    // Trip cards
                    ForEach(trips) { trip in
                        NavigationLink(value: trip) {
                            TripCard(trip: trip)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 120)
            }
            .background(Color(.systemGroupedBackground))
            .navigationDestination(for: TripCardData.self) { trip in
                TripDashboardScreen(trip: trip)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: { showMenu.toggle() }) {
                        Image(systemName: "line.3.horizontal")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.primary)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text("CURATOR")
                        .font(.system(size: 16, weight: .black))
                        .tracking(4)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { isDarkMode.toggle() }) {
                        Image(systemName: isDarkMode ? "sun.max" : "moon")
                            .font(.system(size: 16, weight: .medium))
                            .foregroundColor(.primary)
                    }
                }
            }
            .sheet(isPresented: $showMenu) {
                MenuSheet()
                    .environmentObject(authManager)
            }
        }
    }

    // MARK: - Apple Sign In

    private var appleSignInBanner: some View {
        SignInWithAppleButton(.signIn) { request in
            request.requestedScopes = [.fullName, .email]
        } onCompletion: { result in
            switch result {
            case .success(let auth):
                if let credential = auth.credential as? ASAuthorizationAppleIDCredential {
                    authManager.signIn(userID: credential.user, fullName: credential.fullName)
                }
            case .failure:
                break
            }
        }
        .signInWithAppleButtonStyle(.black)
        .frame(height: 52)
        .cornerRadius(14)
    }
}

// MARK: - Trip Card Data

struct TripCardData: Identifiable, Hashable {
    let id = UUID()
    let name: String
    let destination: String
    let dateRange: String
    let daysUntil: Int
    let status: TripStatus
    let participantCount: Int
    let imageURL: String?

    enum TripStatus: String {
        case planning = "Planning"
        case ready = "Ready"
        case completed = "Completed"
    }

    static let samples: [TripCardData] = [
        TripCardData(name: "Nordic Solitude", destination: "Reykjavík, Iceland",
                     dateRange: "Oct 12 — Oct 19, 2026", daysUntil: 18, status: .planning,
                     participantCount: 4, imageURL: nil),
        TripCardData(name: "Ethereal Kyoto", destination: "Kyoto, Japan",
                     dateRange: "Nov 04 — Nov 12, 2026", daysUntil: 45, status: .ready,
                     participantCount: 2, imageURL: nil),
        TripCardData(name: "Desert Brutalism", destination: "Joshua Tree, USA",
                     dateRange: "Sep 01 — Sep 05, 2026", daysUntil: 0, status: .completed,
                     participantCount: 3, imageURL: nil),
    ]
}

// MARK: - Trip Card View

struct TripCard: View {
    let trip: TripCardData

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(trip.name)
                        .font(.system(size: 20, weight: .bold))
                        .tracking(-0.5)
                    Text(trip.destination)
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                }
                Spacer()
                if trip.status != .completed {
                    Text("\(trip.daysUntil) days")
                        .font(.system(size: 10, weight: .bold))
                        .tracking(1)
                        .textCase(.uppercase)
                        .foregroundColor(trip.status == .planning ? .white : .primary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(trip.status == .planning ? Color.primary : Color(.systemGray5))
                        .clipShape(Capsule())
                }
            }
            .padding(20)

            // Image placeholder
            if trip.status != .completed {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color(.systemGray5), Color(.systemGray4)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .frame(height: 180)
                    .overlay(
                        Image(systemName: trip.status == .planning ? "airplane" : "mountain.2.fill")
                            .font(.system(size: 40))
                            .foregroundColor(Color(.systemGray3))
                    )
                    .clipped()
            }

            // Footer
            HStack {
                // Participant dots
                HStack(spacing: -8) {
                    ForEach(0..<min(trip.participantCount, 3), id: \.self) { i in
                        Circle()
                            .fill(Color(.systemGray4))
                            .frame(width: 36, height: 36)
                            .overlay(
                                Image(systemName: "person.fill")
                                    .font(.system(size: 14))
                                    .foregroundColor(Color(.systemGray2))
                            )
                            .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                    }
                    if trip.participantCount > 3 {
                        Circle()
                            .fill(Color.primary)
                            .frame(width: 36, height: 36)
                            .overlay(
                                Text("+\(trip.participantCount - 3)")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(Color(.systemBackground))
                            )
                            .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                    }
                }

                Spacer()

                // Status
                HStack(spacing: 6) {
                    if trip.status == .planning {
                        Circle()
                            .fill(Color.primary)
                            .frame(width: 6, height: 6)
                    }
                    Text(trip.status.rawValue.uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .tracking(2)
                        .foregroundColor(trip.status == .planning ? .primary : .secondary)
                }
            }
            .padding(20)

            // Date
            Text(trip.dateRange.uppercased())
                .font(.system(size: 10, weight: .medium))
                .tracking(2)
                .foregroundColor(.secondary)
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
        }
        .background(Color(.systemBackground))
        .cornerRadius(16)
        .shadow(color: .black.opacity(0.03), radius: 20, y: 10)
        .opacity(trip.status == .completed ? 0.6 : 1)
    }
}

// MARK: - Menu Sheet

struct MenuSheet: View {
    @EnvironmentObject var authManager: AuthManager
    @Environment(\.dismiss) var dismiss

    var body: some View {
        NavigationView {
            List {
                Section {
                    if authManager.isSignedIn {
                        HStack(spacing: 12) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 36))
                                .foregroundColor(.secondary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(authManager.userName ?? "Traveler")
                                    .font(.system(size: 16, weight: .bold))
                                Text("Signed in with Apple")
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section("General") {
                    Label("Notifications", systemImage: "bell")
                    Label("Privacy", systemImage: "lock")
                    Label("About", systemImage: "info.circle")
                }

                if authManager.isSignedIn {
                    Section {
                        Button(role: .destructive) {
                            authManager.signOut()
                            dismiss()
                        } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }
}
