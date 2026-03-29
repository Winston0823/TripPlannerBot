import SwiftUI
import MapKit

struct DayDetailScreen: View {
    let day: AppAPIService.ItineraryDay
    let tripName: String

    private func formatDate(_ dateStr: String) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: dateStr) else { return dateStr }
        let display = DateFormatter()
        display.dateFormat = "EEEE"
        return display.string(from: d)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Map header
                mapHeader

                // Activities
                VStack(alignment: .leading, spacing: 32) {
                    ForEach(Array(day.items.enumerated()), id: \.offset) { index, item in
                        activityCard(item: item, index: index)
                    }

                    if day.isFreeDay && day.items.isEmpty {
                        freeDayCard
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 120)
            }
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
        .safeAreaInset(edge: .bottom) {
            Button(action: {}) {
                HStack(spacing: 8) {
                    Image(systemName: "calendar.badge.plus")
                        .font(.system(size: 14))
                    Text("ADD TO CALENDAR")
                        .font(.system(size: 12, weight: .black))
                        .tracking(3)
                }
                .foregroundColor(.primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(.ultraThinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 40)
                        .stroke(Color(.systemGray4), lineWidth: 1)
                )
                .cornerRadius(40)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 80)
        }
    }

    // MARK: - Map Header

    private var mapHeader: some View {
        ZStack(alignment: .bottomLeading) {
            // Map placeholder
            Rectangle()
                .fill(Color(.systemGray5))
                .frame(height: 300)
                .overlay(
                    Image(systemName: "map")
                        .font(.system(size: 40))
                        .foregroundColor(Color(.systemGray3))
                )

            // Gradient overlay
            LinearGradient(
                colors: [.clear, Color(.systemGroupedBackground)],
                startPoint: .center,
                endPoint: .bottom
            )

            // Day title
            VStack(alignment: .leading, spacing: 4) {
                Text("DAY \(String(format: "%02d", day.dayNumber)) — \(formatDate(day.date ?? "").uppercased())")
                    .font(.system(size: 11, weight: .medium))
                    .tracking(3)
                    .foregroundColor(.secondary)
                Text(day.items.first?.venueName.uppercased() ?? (day.isFreeDay ? "FREE DAY" : ""))
                    .font(.system(size: 28, weight: .black))
                    .tracking(-1)
            }
            .padding(24)
        }
    }

    // MARK: - Activity Card

    private func activityCard(item: AppAPIService.ItineraryItem, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Time + category
            HStack {
                Text(item.time ?? "")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(2)
                    .foregroundColor(.secondary)
                Spacer()
                Text((item.type ?? "activity").uppercased())
                    .font(.system(size: 11, weight: .medium))
                    .tracking(2)
                    .foregroundColor(Color(.systemGray3))
            }
            .padding(.bottom, 12)

            // Card
            VStack(alignment: .leading, spacing: 0) {
                // Image placeholder
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color(.systemGray5), Color(.systemGray4)],
                            startPoint: .topLeading, endPoint: .bottomTrailing
                        )
                    )
                    .aspectRatio(16/9, contentMode: .fill)
                    .overlay(
                        Image(systemName: iconForType(item.type))
                            .font(.system(size: 30))
                            .foregroundColor(Color(.systemGray3))
                    )
                    .clipped()

                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(item.venueName)
                            .font(.system(size: 20, weight: .bold))
                            .tracking(-0.5)
                        Spacer()
                        if let type = item.type {
                            Text(type.capitalized)
                                .font(.system(size: 10, weight: .bold))
                                .tracking(1)
                                .textCase(.uppercase)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 4)
                                .background(Color(.systemGray5))
                                .cornerRadius(20)
                        }
                    }

                    if let notes = item.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.system(size: 14))
                            .foregroundColor(.secondary)
                            .lineSpacing(4)
                    }

                    HStack {
                        if let notes = item.notes {
                            Text("Note: \(notes)".uppercased())
                                .font(.system(size: 11, weight: .medium))
                                .tracking(2)
                                .foregroundColor(Color(.systemGray3))
                                .lineLimit(1)
                        }
                        Spacer()
                        if let urlStr = item.bookingUrl, let _ = URL(string: urlStr) {
                            Button(action: {
                                if let url = URL(string: urlStr) {
                                    UIApplication.shared.open(url)
                                }
                            }) {
                                Text("BOOK")
                                    .font(.system(size: 10, weight: .bold))
                                    .tracking(2)
                                    .foregroundColor(Color(.systemBackground))
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 8)
                                    .background(Color.primary)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                    .padding(.top, 8)
                }
                .padding(20)
            }
            .background(Color(.systemBackground))
            .cornerRadius(16)
        }
    }

    // MARK: - Free Day

    private var freeDayCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "sun.max")
                .font(.system(size: 32))
                .foregroundColor(.secondary)
            Text("FREE DAY")
                .font(.system(size: 14, weight: .black))
                .tracking(3)
            Text("Explore at your own pace")
                .font(.system(size: 14))
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .background(Color(.systemBackground))
        .cornerRadius(16)
    }

    private func iconForType(_ type: String?) -> String {
        switch type?.lowercased() {
        case "confirmed": return "checkmark.seal"
        case "proposed": return "questionmark.circle"
        default: return "mappin.circle"
        }
    }
}
