import SwiftUI

struct CompactView: View {
    var onCreatePoll: () -> Void

    var body: some View {
        HStack(spacing: 16) {
            Button(action: onCreatePoll) {
                Label("Create Poll", systemImage: "chart.bar.fill")
                    .font(.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .background(Color.blue)
                    .cornerRadius(12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
