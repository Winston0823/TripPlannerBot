import SwiftUI

struct PreferenceChartView: View {
    let preferences: APIService.PreferencesFull

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "chart.bar.fill")
                    .foregroundColor(Theme.brandColor)
                Text("Group Preferences")
                    .font(Theme.headlineFont)
                Spacer()
                Text("\(preferences.responseCount)/\(preferences.totalCount)")
                    .font(Theme.captionFont)
                    .foregroundColor(.secondary)
            }

            PreferenceBar(label: "Pace", icon: "figure.walk", value: preferences.avgPace ?? 3, leftText: "Relaxed", rightText: "Packed")
            PreferenceBar(label: "Budget", icon: "dollarsign.circle", value: preferences.avgBudget ?? 3, leftText: "Budget", rightText: "Luxury")
            PreferenceBar(label: "Adventure", icon: "mountain.2", value: preferences.avgAdventure ?? 3, leftText: "Familiar", rightText: "Bold")
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .padding(.horizontal)
    }
}

struct PreferenceBar: View {
    let label: String
    let icon: String
    let value: Double
    let leftText: String
    let rightText: String

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 13))
                    .foregroundColor(Theme.brandColor)
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                Spacer()
                Text(String(format: "%.1f", value))
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundColor(Theme.brandColor)
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Color(.systemGray5))
                        .frame(height: 6)
                    RoundedRectangle(cornerRadius: 3)
                        .fill(Theme.brandColor)
                        .frame(width: geo.size.width * CGFloat(value) / 5.0, height: 6)
                }
            }
            .frame(height: 6)

            HStack {
                Text(leftText).font(.system(size: 10)).foregroundColor(.secondary)
                Spacer()
                Text(rightText).font(.system(size: 10)).foregroundColor(.secondary)
            }
        }
    }
}
