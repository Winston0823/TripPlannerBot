import SwiftUI

enum ExpandedAction {
    case preferences
    case vote
    case poll
}

struct CompactView: View {
    var onAction: (ExpandedAction) -> Void

    var body: some View {
        HStack(spacing: 12) {
            CompactButton(
                icon: "slider.horizontal.3",
                label: "Preferences",
                color: Theme.brandColor
            ) { onAction(.preferences) }

            CompactButton(
                icon: "hand.thumbsup.fill",
                label: "Vote",
                color: .orange
            ) { onAction(.vote) }

            CompactButton(
                icon: "chart.bar.fill",
                label: "Poll",
                color: .blue
            ) { onAction(.poll) }
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}

struct CompactButton: View {
    let icon: String
    let label: String
    let color: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(.white)
            .frame(width: 80, height: 55)
            .background(color)
            .cornerRadius(12)
        }
    }
}
