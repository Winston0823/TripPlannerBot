import SwiftUI

struct ItineraryDayCard: View {
    let day: APIService.ItineraryDay

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Day header
            HStack {
                Text("Day \(day.dayNumber)")
                    .font(.system(size: 15, weight: .bold))
                if let date = day.date {
                    Text("— \(formatDate(date))")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                }
                Spacer()
                if day.isFreeDay {
                    Text("Free Day")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.green)
                        .cornerRadius(6)
                }
            }

            if day.items.isEmpty && day.isFreeDay {
                HStack(spacing: 6) {
                    Image(systemName: "sun.max.fill")
                        .foregroundColor(.orange)
                    Text("Explore on your own!")
                        .font(Theme.captionFont)
                        .foregroundColor(.secondary)
                }
                .padding(.vertical, 4)
            }

            // Items
            ForEach(Array(day.items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .top, spacing: 10) {
                    // Time
                    Text(item.time ?? "—")
                        .font(.system(size: 13, weight: .medium, design: .monospaced))
                        .foregroundColor(Theme.brandColor)
                        .frame(width: 45, alignment: .trailing)

                    // Dot + line
                    Circle()
                        .fill(item.type == "confirmed" ? Theme.brandColor : Color.orange)
                        .frame(width: 8, height: 8)
                        .padding(.top, 5)

                    // Content
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.venueName)
                            .font(.system(size: 14, weight: .semibold))

                        if let notes = item.notes, !notes.isEmpty {
                            Text(notes)
                                .font(Theme.captionFont)
                                .foregroundColor(.secondary)
                        }

                        if let url = item.bookingUrl, let link = URL(string: url) {
                            Link(destination: link) {
                                HStack(spacing: 3) {
                                    Image(systemName: "link")
                                    Text("Booking")
                                }
                                .font(.system(size: 11))
                                .foregroundColor(Theme.brandColor)
                            }
                        }
                    }

                    Spacer()
                }
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.03), radius: 2, y: 1)
        .padding(.horizontal)
    }

    private func formatDate(_ dateStr: String) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: dateStr) else { return dateStr }
        let display = DateFormatter()
        display.dateFormat = "MMM d"
        return display.string(from: date)
    }
}
