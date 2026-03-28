import SwiftUI

struct ChecklistView: View {
    let tripId: String

    private let defaultItems = [
        "Pack bags",
        "Confirm flights",
        "Book accommodation",
        "Download offline maps",
        "Exchange currency",
        "Travel insurance",
        "Share itinerary with family",
    ]

    @AppStorage private var checkedItems: String

    init(tripId: String) {
        self.tripId = tripId
        _checkedItems = AppStorage(wrappedValue: "", "checklist_\(tripId)")
    }

    private var checkedSet: Set<String> {
        Set(checkedItems.split(separator: "|").map(String.init))
    }

    private func toggle(_ item: String) {
        var set = checkedSet
        if set.contains(item) {
            set.remove(item)
        } else {
            set.insert(item)
        }
        checkedItems = set.joined(separator: "|")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "checklist")
                    .foregroundColor(Theme.brandColor)
                Text("Pre-Trip Checklist")
                    .font(Theme.headlineFont)
                Spacer()
                Text("\(checkedSet.count)/\(defaultItems.count)")
                    .font(Theme.captionFont)
                    .foregroundColor(.secondary)
            }

            ForEach(defaultItems, id: \.self) { item in
                Button(action: { toggle(item) }) {
                    HStack(spacing: 10) {
                        Image(systemName: checkedSet.contains(item) ? "checkmark.circle.fill" : "circle")
                            .foregroundColor(checkedSet.contains(item) ? .green : .secondary)
                            .font(.system(size: 20))
                        Text(item)
                            .font(.system(size: 14))
                            .foregroundColor(checkedSet.contains(item) ? .secondary : .primary)
                            .strikethrough(checkedSet.contains(item))
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(Theme.cardCornerRadius)
        .shadow(color: .black.opacity(0.05), radius: 4, y: 2)
        .padding(.horizontal)
    }
}
