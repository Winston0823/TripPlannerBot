import SwiftUI

struct TripDashboardScreen: View {
    let trip: TripCardData
    @State private var dashboard: AppAPIService.DashboardResponse?
    @State private var isLoading = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                heroSection
                if let dash = dashboard {
                    actionSection(dash)
                    itinerarySection(dash)
                    preferencesSection(dash)
                    decidedSection(dash)
                    checklistSection
                    shareButton
                } else if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, minHeight: 200)
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
        .task {
            // Use mock data for now
            dashboard = AppAPIService.shared.mockDashboard()
            isLoading = false
        }
    }

    // MARK: - Hero Section

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("UPCOMING TRIP")
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(2)
                    .foregroundColor(.secondary)
                Text(trip.name.uppercased())
                    .font(.system(size: 34, weight: .black))
                    .tracking(-2)
                Text(trip.destination)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.secondary)
            }

            // Countdown
            VStack(spacing: 4) {
                Text("\(trip.daysUntil)")
                    .font(.system(size: 64, weight: .black))
                    .tracking(-3)
                Text("DAYS REMAINING")
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(3)
                    .foregroundColor(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)
            .background(Color(.systemBackground))
            .cornerRadius(16)

            // Participants
            if let participants = dashboard?.participants {
                HStack(spacing: 8) {
                    HStack(spacing: -6) {
                        ForEach(participants.prefix(3)) { p in
                            Circle()
                                .fill(Color(.systemGray4))
                                .frame(width: 32, height: 32)
                                .overlay(
                                    Text(String(p.name.prefix(1)))
                                        .font(.system(size: 12, weight: .bold))
                                        .foregroundColor(Color(.systemGray))
                                )
                                .overlay(Circle().stroke(Color(.systemBackground), lineWidth: 2))
                        }
                    }

                    if let first = participants.first {
                        Text("\(first.name.uppercased()) \(first.role == "organizer" ? "(ORG)" : "")")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(1)
                        Text("+ \(participants.count - 1) MEMBERS")
                            .font(.system(size: 10, weight: .bold))
                            .tracking(1)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color(.tertiarySystemBackground))
                .clipShape(Capsule())
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
    }

    // MARK: - Action Needed

    private func actionSection(_ dash: AppAPIService.DashboardResponse) -> some View {
        let hasActions = (dash.preferences?.needsSubmission ?? false) || !(dash.activePolls?.isEmpty ?? true)
        guard hasActions else { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 12) {
                Text("ACTION NEEDED")
                    .font(.system(size: 11, weight: .black))
                    .tracking(3)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 24)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        if dash.preferences?.needsSubmission == true {
                            ActionCard(
                                priority: "Preferences",
                                title: "Share Your Preferences",
                                subtitle: "Rate your pace, budget & adventure style",
                                isHighPriority: false
                            )
                        }

                        if let polls = dash.activePolls {
                            ForEach(polls) { poll in
                                NavigationLink(value: poll) {
                                    ActionCard(
                                        priority: "Voting",
                                        title: poll.question,
                                        subtitle: "\(poll.options.count) options — tap to vote",
                                        isHighPriority: false
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.horizontal, 24)
                }
            }
            .navigationDestination(for: AppAPIService.PollInfo.self) { poll in
                VoteDetailScreen(poll: poll)
            }
        )
    }

    // MARK: - Itinerary Timeline

    private func itinerarySection(_ dash: AppAPIService.DashboardResponse) -> some View {
        guard let days = dash.itinerary, !days.isEmpty else { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 16) {
                Text("ITINERARY TIMELINE")
                    .font(.system(size: 11, weight: .black))
                    .tracking(3)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 24)

                VStack(alignment: .leading, spacing: 0) {
                    ForEach(days) { day in
                        NavigationLink(value: day) {
                            TimelineDay(day: day, isFirst: day.id == days.first?.id)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 24)
                .navigationDestination(for: AppAPIService.ItineraryDay.self) { day in
                    DayDetailScreen(day: day, tripName: trip.name)
                }
            }
        )
    }

    // MARK: - Preferences

    private func preferencesSection(_ dash: AppAPIService.DashboardResponse) -> some View {
        guard let prefs = dash.preferences, prefs.responseCount > 0 else { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 20) {
                Text("GROUP VIBE")
                    .font(.system(size: 11, weight: .black))
                    .tracking(3)
                    .foregroundColor(.secondary)

                PrefBar(label: "PACE", value: prefs.avgPace ?? 3)
                PrefBar(label: "BUDGET", value: prefs.avgBudget ?? 3)
                PrefBar(label: "ADVENTURE", value: prefs.avgAdventure ?? 3)
            }
            .padding(24)
            .background(Color(.systemBackground))
            .cornerRadius(16)
            .padding(.horizontal, 24)
        )
    }

    // MARK: - Decided

    private func decidedSection(_ dash: AppAPIService.DashboardResponse) -> some View {
        guard let closed = dash.closedPolls, !closed.isEmpty else { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 12) {
                Text("THE SELECTION")
                    .font(.system(size: 11, weight: .black))
                    .tracking(3)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 24)

                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(closed) { poll in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(poll.question.uppercased())
                                .font(.system(size: 9, weight: .bold))
                                .tracking(2)
                                .foregroundColor(.secondary)
                            Text(poll.winningOption ?? "—")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.primary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Color(.systemBackground))
                        .cornerRadius(12)
                    }
                }
                .padding(.horizontal, 24)
            }
        )
    }

    // MARK: - Checklist

    private var checklistSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("FINAL CHECKS")
                .font(.system(size: 11, weight: .black))
                .tracking(3)
                .foregroundColor(.secondary)
                .padding(.horizontal, 24)

            AppChecklistView(tripId: trip.name)
                .padding(.horizontal, 24)
        }
    }

    // MARK: - Share Button

    private var shareButton: some View {
        Button(action: {}) {
            HStack(spacing: 8) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 14))
                Text("SHARE TO IMESSAGE")
                    .font(.system(size: 13, weight: .black))
                    .tracking(3)
            }
            .foregroundColor(Color(.systemBackground))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 20)
            .background(Color.primary)
            .cornerRadius(16)
        }
        .padding(.horizontal, 24)
    }
}

// MARK: - Action Card

struct ActionCard: View {
    let priority: String
    let title: String
    let subtitle: String
    let isHighPriority: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(priority.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .tracking(2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(isHighPriority ? Color.white.opacity(0.1) : Color(.systemGray5))
                    .cornerRadius(20)
                Spacer()
                Image(systemName: isHighPriority ? "exclamationmark" : "hand.thumbsup")
                    .font(.system(size: 14))
            }
            Text(title)
                .font(.system(size: 17, weight: .bold))
                .lineLimit(2)
            Text(subtitle)
                .font(.system(size: 12))
                .foregroundColor(isHighPriority ? .white.opacity(0.6) : .secondary)
        }
        .padding(20)
        .frame(width: 260, alignment: .leading)
        .background(isHighPriority ? Color.primary : Color(.systemGray6))
        .foregroundColor(isHighPriority ? Color(.systemBackground) : .primary)
        .cornerRadius(14)
    }
}

// MARK: - Timeline Day

struct TimelineDay: View {
    let day: AppAPIService.ItineraryDay
    let isFirst: Bool

    private func formatDate(_ dateStr: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: dateStr) else { return dateStr }
        let display = DateFormatter()
        display.dateFormat = "MMM d"
        return display.string(from: d)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 20) {
            // Timeline dot + line
            VStack(spacing: 0) {
                Circle()
                    .fill(isFirst ? Color.primary : Color(.systemGray4))
                    .frame(width: 10, height: 10)
                Rectangle()
                    .fill(Color(.systemGray5))
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
            }
            .frame(width: 10)

            VStack(alignment: .leading, spacing: 6) {
                Text("DAY \(day.dayNumber) — \(formatDate(day.date ?? ""))".uppercased())
                    .font(.system(size: 10, weight: .black))
                    .tracking(2)
                    .foregroundColor(.secondary)

                if day.isFreeDay {
                    Text("Free Day")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.primary)
                } else if let first = day.items.first {
                    Text(first.venueName)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(.primary)

                    if let item = day.items.first {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(item.time ?? "") • \(item.venueName)")
                                .font(.system(size: 13, weight: .medium))
                            if let notes = item.notes {
                                Text(notes)
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.tertiarySystemBackground))
                        .cornerRadius(10)
                    }
                }
            }
            .padding(.trailing, 24)
            .padding(.bottom, 28)
            .opacity(isFirst ? 1 : 0.6)
        }
    }
}

// MARK: - Preference Bar

struct PrefBar: View {
    let label: String
    let value: Double

    var body: some View {
        VStack(spacing: 6) {
            HStack {
                Text(label)
                    .font(.system(size: 10, weight: .bold))
                    .tracking(2)
                Spacer()
                Text(String(format: "%.1f / 5", value))
                    .font(.system(size: 10, weight: .bold))
                    .tracking(2)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(.systemGray5))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.primary)
                        .frame(width: geo.size.width * CGFloat(value) / 5.0, height: 4)
                }
            }
            .frame(height: 4)
        }
    }
}

// MARK: - Checklist

struct AppChecklistView: View {
    let tripId: String

    private let items = [
        "Book transport tickets",
        "Verify passport validity",
        "Exchange currency",
        "Download offline maps",
        "Share itinerary with family",
    ]

    @AppStorage private var checked: String

    init(tripId: String) {
        self.tripId = tripId
        _checked = AppStorage(wrappedValue: "", "app_checklist_\(tripId)")
    }

    private var checkedSet: Set<String> {
        Set(checked.split(separator: "|").map(String.init))
    }

    private func toggle(_ item: String) {
        var s = checkedSet
        if s.contains(item) { s.remove(item) } else { s.insert(item) }
        checked = s.joined(separator: "|")
    }

    var body: some View {
        VStack(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Button(action: { toggle(item) }) {
                    HStack(spacing: 12) {
                        Image(systemName: checkedSet.contains(item) ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 20))
                            .foregroundColor(checkedSet.contains(item) ? .primary : Color(.systemGray4))
                        Text(item)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(checkedSet.contains(item) ? .secondary : .primary)
                            .strikethrough(checkedSet.contains(item))
                        Spacer()
                    }
                    .padding(14)
                    .background(Color(.systemBackground))
                    .cornerRadius(12)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
