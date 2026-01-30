import FirebaseAuth
import Foundation
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var firebaseClients: FirebaseClients
    @State private var isSignedIn = false
    @State private var authListenerHandle: AuthStateDidChangeListenerHandle?

    var body: some View {
        Group {
            if isSignedIn {
                NavigationStack {
                    VStack {
                        Image(systemName: "globe")
                            .imageScale(.large)
                            .foregroundStyle(.tint)
                        Text("Hello, world!")
                        Text(isSignedIn ? "Signed in" : "Signed out")
                    }
                    .padding()
                }
            } else {
                AuthView()
            }
        }
        .task {
            if isRunningPreview() {
                return
            }
            let auth = firebaseClients.auth
            _ = firebaseClients.firestore
            if authListenerHandle == nil {
                authListenerHandle = auth.addStateDidChangeListener { _, user in
                    Task { @MainActor in
                        isSignedIn = user != nil
                    }
                }
            }
            isSignedIn = auth.currentUser != nil
        }
        .onDisappear {
            if let handle = authListenerHandle {
                firebaseClients.auth.removeStateDidChangeListener(handle)
                authListenerHandle = nil
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(FirebaseClients())
}

private func isRunningPreview() -> Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
}
