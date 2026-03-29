import SwiftUI

enum AppTheme {
    // Primary: black in light mode, white in dark mode
    static let primary = Color.primary
    static let secondary = Color(.systemGray)
    static let outline = Color(.systemGray3)
    static let outlineVariant = Color(.systemGray5)

    static let surfaceBackground = Color(.systemBackground)
    static let surfaceContainer = Color(.secondarySystemBackground)
    static let surfaceContainerLow = Color(.tertiarySystemBackground)
    static let surfaceContainerLowest = Color(.systemBackground)

    static let brandAccent = Color(red: 0x5E / 255, green: 0x5C / 255, blue: 0xE6 / 255)

    // Fonts
    static let displayFont = Font.system(size: 40, weight: .black)
    static let headlineFont = Font.system(size: 22, weight: .black)
    static let titleFont = Font.system(size: 18, weight: .bold)
    static let bodyFont = Font.system(size: 14, weight: .regular)
    static let labelFont = Font.system(size: 11, weight: .bold)
    static let microFont = Font.system(size: 10, weight: .bold)
}
