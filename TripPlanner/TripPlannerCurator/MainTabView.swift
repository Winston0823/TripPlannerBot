import SwiftUI

struct MainTabView: View {
    @State private var selectedTab = 0

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: $selectedTab) {
                HomeView()
                    .tag(0)

                ExploreView()
                    .tag(1)

                BookmarksView()
                    .tag(2)

                ProfileView()
                    .tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            // Custom Tab Bar
            customTabBar
        }
        .ignoresSafeArea(.keyboard)
    }

    private var customTabBar: some View {
        HStack(spacing: 0) {
            tabButton(icon: "rectangle.on.rectangle.angled", index: 0)
            tabButton(icon: "safari", index: 1)
            tabButton(icon: "bookmark", index: 2)
            tabButton(icon: "person", index: 3)
        }
        .padding(.horizontal, 40)
        .padding(.top, 16)
        .padding(.bottom, 32)
        .background(
            .ultraThinMaterial,
            in: RoundedRectangle(cornerRadius: 32, style: .continuous)
        )
        .shadow(color: .black.opacity(0.06), radius: 20, y: -10)
    }

    private func tabButton(icon: String, index: Int) -> some View {
        Button(action: { withAnimation(.easeInOut(duration: 0.2)) { selectedTab = index } }) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .medium))
                .frame(width: 48, height: 48)
                .background(selectedTab == index ? Color.primary : Color.clear)
                .foregroundColor(selectedTab == index ? Color(.systemBackground) : Color(.systemGray3))
                .clipShape(Circle())
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Placeholder Tabs

struct ExploreView: View {
    var body: some View {
        VStack {
            Spacer()
            Image(systemName: "safari")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("Explore")
                .font(AppTheme.titleFont)
                .padding(.top, 8)
            Text("Discover destinations")
                .font(AppTheme.bodyFont)
                .foregroundColor(.secondary)
            Spacer()
        }
    }
}

struct BookmarksView: View {
    var body: some View {
        VStack {
            Spacer()
            Image(systemName: "bookmark")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("Saved")
                .font(AppTheme.titleFont)
                .padding(.top, 8)
            Text("Your saved places & trips")
                .font(AppTheme.bodyFont)
                .foregroundColor(.secondary)
            Spacer()
        }
    }
}

struct ProfileView: View {
    @EnvironmentObject var authManager: AuthManager

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "person.circle.fill")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            if authManager.isSignedIn {
                Text(authManager.userName ?? "Traveler")
                    .font(AppTheme.headlineFont)
                Button("Sign Out") {
                    authManager.signOut()
                }
                .foregroundColor(.red)
            } else {
                Text("Not signed in")
                    .font(AppTheme.titleFont)
            }
            Spacer()
        }
    }
}
