import AuthenticationServices
import SwiftUI

struct AuthView: View {
    @Environment(\.colorScheme) private var colorScheme

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
                    request.requestedScopes = [.fullName, .email]
                } onCompletion: { result in
                    handleSignInWithApple(result)
                }
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 52)
                .padding(.horizontal, 32)

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

                Spacer(minLength: 24)
            }
        }
    }

    private func handleSignInWithApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard authorization.credential is ASAuthorizationAppleIDCredential else {
                return
            }
            // TODO: Exchange the Apple credential for a Firebase Auth credential.
        case .failure(let error):
            print("Sign in with Apple failed: \(error.localizedDescription)")
        }
    }

    private func handleSignInWithGoogle() {
        // TODO: Present Google Sign-In and exchange the token for Firebase Auth.
    }
}

#Preview {
    AuthView()
}
