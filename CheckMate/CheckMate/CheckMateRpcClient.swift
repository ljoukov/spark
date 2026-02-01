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
    private let host: String

    nonisolated private static var defaultHost: String {
#if targetEnvironment(simulator)
        return "http://127.0.0.1:8080/api/cm/rpc"
#else
        return "https://spark.eviworld.com/api/cm/rpc"
#endif
    }

    init(auth: Auth, host: String = CheckMateRpcClient.defaultHost) {
        self.auth = auth
        self.host = host
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
            log("Greet failed: no signed-in user.")
            throw CheckMateRpcError.notSignedIn
        }

        let token = try await user.getIDToken()
        log(
            "Greet request starting.",
            context: [
                "host": host,
                "nameLength": String(request.name.count),
                "tokenLength": String(token.count)
            ]
        )
        let response = await client.greet(
            request: request,
            headers: [
                "authorization": ["Bearer \(token)"]
            ]
        )

        if let message = response.message {
            log(
                "Greet response OK.",
                context: [
                    "code": String(describing: response.code),
                    "responseLength": String(message.message.count)
                ]
            )
            return message
        }

        if let error = response.error {
            log(
                "Greet response error.",
                context: [
                    "error": describe(error)
                ]
            )
            throw error
        }

        log("Greet response missing message and error.")
        throw CheckMateRpcError.missingResponse
    }

    private func log(_ message: String, context: [String: String] = [:]) {
        if context.isEmpty {
            print("[CheckMateRpcClient] \(message)")
            return
        }
        print("[CheckMateRpcClient] \(message) \(context)")
    }

    private func describe(_ error: Error) -> String {
        if let connectError = error as? ConnectError {
            return "ConnectError(code: \(connectError.code), message: \(connectError.message ?? "nil"))"
        }
        return error.localizedDescription
    }
}
