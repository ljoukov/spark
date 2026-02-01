import Connect
import FirebaseAuth
import Foundation

enum CheckMateRpcError: LocalizedError {
    case notSignedIn
    case missingResponse

    var errorDescription: String? {
        switch self {
        case .notSignedIn:
            return "You need to sign in before calling the server."
        case .missingResponse:
            return "The server did not return a response message."
        }
    }
}

@MainActor
final class CheckMateRpcClient {
    private let client: CheckMateServiceClient
    private let auth: Auth

    init(auth: Auth, host: String = "http://127.0.0.1:8080/api/cm/rpc") {
        self.auth = auth
        let config = ProtocolClientConfig(
            host: host,
            networkProtocol: .connect,
            codec: ProtoCodec(),
            unaryGET: .disabled
        )
        let protocolClient = ProtocolClient(config: config)
        self.client = CheckMateServiceClient(client: protocolClient)
    }

    func greet(request: GreetRequestProto) async throws -> GreetResponseProto {
        guard let user = auth.currentUser else {
            throw CheckMateRpcError.notSignedIn
        }

        let token = try await user.getIDToken()
        let response = await client.greet(
            request: request,
            headers: [
                "authorization": ["Bearer \(token)"]
            ]
        )

        if let message = response.message {
            return message
        }

        if let error = response.error {
            throw error
        }

        throw CheckMateRpcError.missingResponse
    }
}
