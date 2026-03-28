import SwiftUI

enum Theme {
    static let brandColor = Color(red: 0x5E / 255, green: 0x5C / 255, blue: 0xE6 / 255)
    static let brandUIColor = UIColor(red: 0x5E / 255, green: 0x5C / 255, blue: 0xE6 / 255, alpha: 1)

    static let cardCornerRadius: CGFloat = 16
    static let buttonCornerRadius: CGFloat = 12
    static let cardPadding: CGFloat = 16

    static let captionFont = Font.system(size: 12, weight: .regular)
    static let bodyFont = Font.system(size: 16, weight: .regular)
    static let headlineFont = Font.system(size: 16, weight: .semibold)
    static let titleFont = Font.system(size: 20, weight: .bold)
}

struct PrimaryButtonStyle: ButtonStyle {
    var disabled: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headlineFont)
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(disabled ? Color.gray.opacity(0.4) : Theme.brandColor)
            .cornerRadius(Theme.buttonCornerRadius)
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
