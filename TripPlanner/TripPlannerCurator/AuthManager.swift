import SwiftUI
import AuthenticationServices
import Combine

class AuthManager: ObservableObject {
    @Published var isSignedIn: Bool = false
    @Published var userID: String?
    @Published var userName: String?

    init() {
        // Check if we have a stored user ID
        if let stored = UserDefaults.standard.string(forKey: "appleUserID") {
            userID = stored
            userName = UserDefaults.standard.string(forKey: "appleUserName")
            isSignedIn = true
        }
    }

    func signIn(userID: String, fullName: PersonNameComponents?) {
        self.userID = userID
        self.userName = fullName.map { [$0.givenName, $0.familyName].compactMap { $0 }.joined(separator: " ") }
        self.isSignedIn = true

        UserDefaults.standard.set(userID, forKey: "appleUserID")
        if let name = userName {
            UserDefaults.standard.set(name, forKey: "appleUserName")
        }
    }

    func signOut() {
        userID = nil
        userName = nil
        isSignedIn = false
        UserDefaults.standard.removeObject(forKey: "appleUserID")
        UserDefaults.standard.removeObject(forKey: "appleUserName")
    }
}
