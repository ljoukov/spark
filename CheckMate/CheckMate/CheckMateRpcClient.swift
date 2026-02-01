import Connect
import FirebaseAuth
import Foundation

enum CheckMateRpcError: LocalizedError {
    case notSignedIn
    case missingResponse
    case streamUnavailable

    var errorDescription: String? {
        switch self {
        case .notSignedIn:
            return "You need to sign in before calling the server."
        case .missingResponse:
            return "The server did not return a response message."
        case .streamUnavailable:
            return "The chat stream could not be started."
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

    func startChatStream(
        request: StreamChatRequestProto
    ) async throws -> any ServerOnlyAsyncStreamInterface<StreamChatRequestProto, StreamChatResponseProto> {
        guard let user = auth.currentUser else {
            log("StreamChat failed: no signed-in user.")
            throw CheckMateRpcError.notSignedIn
        }

        let token = try await user.getIDToken()
        log(
            "StreamChat request starting.",
            context: [
                "host": host,
                "messageCount": String(request.messages.count),
                "tokenLength": String(token.count)
            ]
        )
        let stream = client.streamChat(
            headers: [
                "authorization": ["Bearer \(token)"]
            ]
        )
        do {
            try stream.send(request)
        } catch {
            log(
                "StreamChat failed to send request.",
                context: [
                    "error": describe(error)
                ]
            )
            throw error
        }
        return stream
    }

    func listChats(limit: Int32 = 50) async throws -> ListChatsResponseProto {
        guard let user = auth.currentUser else {
            log("ListChats failed: no signed-in user.")
            throw CheckMateRpcError.notSignedIn
        }

        let token = try await user.getIDToken()
        var request = ListChatsRequestProto()
        request.limit = limit
        log(
            "ListChats request starting.",
            context: [
                "host": host,
                "limit": String(limit),
                "tokenLength": String(token.count)
            ]
        )
        let response = await client.listChats(
            request: request,
            headers: [
                "authorization": ["Bearer \(token)"]
            ]
        )

        if let message = response.message {
            log(
                "ListChats response OK.",
                context: [
                    "code": String(describing: response.code),
                    "chatCount": String(message.chats.count)
                ]
            )
            return message
        }

        if let error = response.error {
            log(
                "ListChats response error.",
                context: [
                    "error": describe(error)
                ]
            )
            throw error
        }

        log("ListChats response missing message and error.")
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
