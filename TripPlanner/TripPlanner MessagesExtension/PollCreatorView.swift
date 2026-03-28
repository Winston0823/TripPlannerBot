import SwiftUI

struct PollCreatorView: View {
    @State private var question = ""
    @State private var options = ["", ""]

    var onSend: (PollData) -> Void

    var body: some View {
        NavigationView {
            Form {
                Section(header: Text("Question")) {
                    TextField("What should we do?", text: $question)
                }

                Section(header: Text("Options")) {
                    ForEach(options.indices, id: \.self) { index in
                        TextField("Option \(index + 1)", text: $options[index])
                    }

                    if options.count < 6 {
                        Button(action: { options.append("") }) {
                            Label("Add Option", systemImage: "plus.circle.fill")
                        }
                    }
                }

                Section {
                    Button(action: sendPoll) {
                        HStack {
                            Spacer()
                            Text("Send Poll")
                                .font(.headline)
                                .foregroundColor(.white)
                            Spacer()
                        }
                        .padding(.vertical, 8)
                        .background(isValid ? Color.blue : Color.gray)
                        .cornerRadius(10)
                    }
                    .disabled(!isValid)
                    .listRowBackground(Color.clear)
                }
            }
            .navigationTitle("New Poll")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var isValid: Bool {
        !question.trimmingCharacters(in: .whitespaces).isEmpty &&
        options.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }.count >= 2
    }

    private func sendPoll() {
        let validOptions = options
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            .enumerated()
            .map { PollOption(id: $0.offset, text: $0.element) }

        let poll = PollData(
            question: question,
            options: validOptions,
            pollId: UUID().uuidString
        )
        onSend(poll)
    }
}
