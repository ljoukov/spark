import FirebaseAuth
import Foundation
import SwiftUI
struct CheckMateRootView: View {
    @EnvironmentObject private var firebaseClients: FirebaseClients
    @State private var isSignedIn = false
    @State private var authListenerHandle: AuthStateDidChangeListenerHandle?
    @State private var rpcClient: CheckMateRpcClient?

    var body: some View {
        Group {
            if isSignedIn {
                CheckMateChatView(rpcClient: rpcClient)
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
            if rpcClient == nil {
                rpcClient = CheckMateRpcClient(auth: auth)
            }
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
    CheckMateRootView()
        .environmentObject(FirebaseClients())
}

private func isRunningPreview() -> Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
}
