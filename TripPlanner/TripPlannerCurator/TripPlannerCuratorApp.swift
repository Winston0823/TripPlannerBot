//
//  TripPlannerCuratorApp.swift
//  TripPlannerCurator
//
//  Created by Jiayuan Fu on 2026/3/28.
//

import SwiftUI

@main
struct TripPlannerCuratorApp: App {
    @StateObject private var authManager = AuthManager()
    @AppStorage("isDarkMode") private var isDarkMode = false

    var body: some Scene {
        WindowGroup {
            MainTabView()
                .environmentObject(authManager)
                .preferredColorScheme(isDarkMode ? .dark : .light)
        }
    }
}
