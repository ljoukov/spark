import AuthenticationServices
import CryptoKit
import FirebaseAuth
import FirebaseCore
import GoogleSignIn
import Foundation
import Security
import SwiftUI
import UIKit

struct AuthView: View {
    @Environment(\.colorScheme) private var colorScheme
    @EnvironmentObject private var firebaseClients: FirebaseClients
    @State private var currentNonce: String?
    @State private var errorMessage: String?
    @State private var isSigningIn = false

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(.systemBackground),
                    Color(.secondarySystemBackground)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()
                VStack(spacing: 12) {
                    Text("CheckMate")
                        .font(.largeTitle.weight(.semibold))
                    Text("Sign in to keep your progress in sync.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

                Spacer()

                SignInWithAppleButton(.continue) { request in
                    guard let nonce = randomNonceString() else {
                        errorMessage = "Unable to generate a secure sign-in request."
                        return
                    }
                    currentNonce = nonce
                    isSigningIn = true
                    request.requestedScopes = [.fullName, .email]
                    request.nonce = sha256(nonce)
                } onCompletion: { result in
                    handleSignInWithApple(result)
                }
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 52)
                .padding(.horizontal, 32)
                .disabled(isSigningIn)

                Button(action: handleSignInWithGoogle) {
                    HStack(spacing: 12) {
                        Image("GoogleG")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 20, height: 20)
                            .accessibilityHidden(true)
                        Text("Continue with Google")
                            .font(.headline)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Color(.secondarySystemBackground))
                    .foregroundStyle(.primary)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color(.separator), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 32)
                .disabled(isSigningIn)

                Spacer(minLength: 24)
            }
        }
        .alert(
            "Sign In Failed",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { value in
                    if !value {
                        errorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {
            }
        } message: {
            Text(errorMessage ?? "Something went wrong.")
        }
    }

    private func handleSignInWithApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let appleCredential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                finishSignIn(withMessage: "Unable to read Apple ID credentials.")
                return
            }
            guard let nonce = currentNonce else {
                finishSignIn(withMessage: "Missing sign-in state. Please try again.")
                return
            }
            guard let appleIDToken = appleCredential.identityToken else {
                finishSignIn(withMessage: "Unable to fetch identity token.")
                return
            }
            guard let idTokenString = String(data: appleIDToken, encoding: .utf8) else {
                finishSignIn(withMessage: "Unable to decode identity token.")
                return
            }

            let credential = OAuthProvider.appleCredential(
                withIDToken: idTokenString,
                rawNonce: nonce,
                fullName: appleCredential.fullName
            )

            firebaseClients.auth.signIn(with: credential) { _, error in
                if let error = error {
                    finishSignIn(withError: error)
                    return
                }
                finishSignIn(withMessage: nil)
            }
        case .failure(let error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                finishSignIn(withMessage: nil)
                return
            }
            finishSignIn(withError: error)
        }
    }

    private func handleSignInWithGoogle() {
        guard let clientID = FirebaseApp.app()?.options.clientID else {
            finishSignIn(withMessage: "Missing Google client ID.")
            return
        }
        guard let presentingViewController = rootViewController() else {
            finishSignIn(withMessage: "Unable to open Google sign-in.")
            return
        }

        isSigningIn = true
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
        GIDSignIn.sharedInstance.signIn(withPresenting: presentingViewController) { signInResult, error in
            if let error = error {
                let nsError = error as NSError
                if nsError.domain == "com.google.GIDSignIn" && nsError.code == -5 {
                    finishSignIn(withMessage: nil)
                    return
                }
                finishSignIn(withError: error)
                return
            }
            guard let user = signInResult?.user else {
                finishSignIn(withMessage: "Google sign-in returned no user.")
                return
            }
            guard let idToken = user.idToken?.tokenString else {
                finishSignIn(withMessage: "Missing Google ID token.")
                return
            }

            let credential = GoogleAuthProvider.credential(
                withIDToken: idToken,
                accessToken: user.accessToken.tokenString
            )
            firebaseClients.auth.signIn(with: credential) { _, error in
                if let error = error {
                    finishSignIn(withError: error)
                    return
                }
                finishSignIn(withMessage: nil)
            }
        }
    }

    private func finishSignIn(withError error: Error) {
        finishSignIn(withMessage: error.localizedDescription)
    }

    private func finishSignIn(withMessage message: String?) {
        Task { @MainActor in
            currentNonce = nil
            isSigningIn = false
            errorMessage = message
        }
    }

    private func rootViewController() -> UIViewController? {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else {
                continue
            }
            for window in windowScene.windows {
                if window.isKeyWindow {
                    return window.rootViewController
                }
            }
        }
        return nil
    }

    private func randomNonceString(length: Int = 32) -> String? {
        if length <= 0 {
            return nil
        }
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length

        while remainingLength > 0 {
            var randomBytes = [UInt8](repeating: 0, count: 16)
            let status = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
            if status != errSecSuccess {
                return nil
            }
            for random in randomBytes {
                if remainingLength == 0 {
                    break
                }
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }

        return result
    }

    private func sha256(_ input: String) -> String {
        let inputData = Data(input.utf8)
        let hashed = SHA256.hash(data: inputData)
        return hashed.map { String(format: "%02x", $0) }.joined()
    }
}

#Preview {
    AuthView()
        .environmentObject(FirebaseClients())
}
