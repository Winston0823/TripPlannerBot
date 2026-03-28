import SwiftUI

struct CompactView: View {
    var onOpenDashboard: () -> Void

    var body: some View {
        Button(action: onOpenDashboard) {
            HStack(spacing: 10) {
                Image(systemName: "airplane")
                    .font(.system(size: 20))
                Text("Open Trip Dashboard")
                    .font(.system(size: 15, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Theme.brandColor)
            .cornerRadius(Theme.buttonCornerRadius)
        }
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}
