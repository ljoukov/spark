import SwiftUI

@main
struct SparkApp: App {
  @StateObject private var appState = AppState()

  var body: some Scene {
    WindowGroup {
      HomeView()
        .environmentObject(appState)
    }
  }
}
