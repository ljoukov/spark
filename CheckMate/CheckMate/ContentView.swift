import Connect
import FirebaseAuth
import Foundation
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var firebaseClients: FirebaseClients
    @State private var rpcClient: CheckMateRpcClient?
    @State private var isSignedIn = false
    @State private var authListenerHandle: AuthStateDidChangeListenerHandle?
    @State private var greetMessage: String?
    @State private var greetError: String?
    @State private var isCallingGreet = false

    var body: some View {
        Group {
            if isSignedIn {
                NavigationStack {
                    VStack(spacing: 16) {
                        Image(systemName: "globe")
                            .imageScale(.large)
                            .foregroundStyle(.tint)
                        Text("Hello, world!")
                        Text(isSignedIn ? "Signed in" : "Signed out")
                            .foregroundStyle(.secondary)

                        Button {
                            Task { await callGreet() }
                        } label: {
                            HStack(spacing: 8) {
                                if isCallingGreet {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                }
                                Text("Call Greet")
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(isCallingGreet)

                        if let greetMessage {
                            Text(greetMessage)
                                .font(.headline)
                        }

                        if let greetError {
                            Text(greetError)
                                .foregroundStyle(.red)
                                .multilineTextAlignment(.center)
                        }
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
    ContentView()
        .environmentObject(FirebaseClients())
}

private func isRunningPreview() -> Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
}

@MainActor
private extension ContentView {
    func callGreet() async {
        if isCallingGreet {
            return
        }
        isCallingGreet = true
        greetError = nil
        greetMessage = nil
        defer {
            isCallingGreet = false
        }

        let auth = firebaseClients.auth
        guard let user = auth.currentUser else {
            greetError = "You need to sign in before calling the server."
            return
        }
        guard let rpcClient else {
            greetError = "The app is still initializing. Please try again."
            return
        }
        let displayName = user.displayName
        let email = user.email
        let name = displayName ?? email ?? "there"

        do {
            let response = try await rpcClient.greet(
                request: .init {
                    $0.name = name
                }
            )
            greetMessage = response.message
        } catch {
            if let connectError = error as? ConnectError {
                let message = connectError.message ?? "Internal error"
                greetError = "[\(connectError.code)] \(message)"
            } else if let localizedError = error as? LocalizedError {
                greetError = localizedError.errorDescription ?? "Something went wrong."
            } else {
                greetError = error.localizedDescription
            }
        }
    }
}
