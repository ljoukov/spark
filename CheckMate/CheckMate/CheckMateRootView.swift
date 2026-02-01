import FirebaseAuth
import Foundation
import SwiftUI
import SwiftProtobuf

struct CheckMateConversationStatus: Equatable {
    enum State: Equatable {
        case idle
        case streaming
        case error
    }

    let state: State
    let updatedAt: Date
    let errorMessage: String?

    init(state: State, updatedAt: Date, errorMessage: String? = nil) {
        self.state = state
        self.updatedAt = updatedAt
        self.errorMessage = errorMessage
    }

    init?(proto: CheckMateChatStatusProto) {
        let state: State
        switch proto.state {
        case .idle:
            state = .idle
        case .streaming:
            state = .streaming
        case .error:
            state = .error
        case .unspecified, .UNRECOGNIZED:
            return nil
        }
        let updatedAt = proto.hasUpdatedAt ? Self.date(from: proto.updatedAt) : Date()
        let trimmedError = proto.errorMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        self.state = state
        self.updatedAt = updatedAt
        self.errorMessage = trimmedError.isEmpty ? nil : trimmedError
    }

    static func date(from timestamp: SwiftProtobuf.Google_Protobuf_Timestamp) -> Date {
        let seconds = Double(timestamp.seconds)
        let nanos = Double(timestamp.nanos) / 1_000_000_000
        return Date(timeIntervalSince1970: seconds + nanos)
    }
}
struct CheckMateRootView: View {
    @EnvironmentObject private var firebaseClients: FirebaseClients
    @State private var isSignedIn = false
    @State private var authListenerHandle: AuthStateDidChangeListenerHandle?
    @State private var rpcClient: CheckMateRpcClient?

    var body: some View {
        Group {
            if isSignedIn {
                CheckMateMainView(rpcClient: rpcClient)
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

struct CheckMateMainView: View {
    private let rpcClient: CheckMateRpcClient?
    @Environment(\.colorScheme) private var colorScheme
    @State private var activeIndex: Int
    @State private var dragOffset: CGFloat = 0
    @State private var activeConversationId: String?
    @State private var conversations: [CheckMateConversationSummary] = []
    @State private var conversationsError: String?
    @State private var isLoadingChats = false
    @State private var chatListTask: Task<Void, Never>?

    init(rpcClient: CheckMateRpcClient? = nil, initialIndex: Int = 1) {
        self.rpcClient = rpcClient
        _activeIndex = State(initialValue: max(0, min(initialIndex, 1)))
    }

    var body: some View {
        GeometryReader { proxy in
            let width = max(proxy.size.width, 1)
            let clampedDrag = clampedDragOffset(for: width)
            let baseOffset = -CGFloat(activeIndex) * width
            let currentOffset = baseOffset + clampedDrag
            let position = clamp(-currentOffset / width, min: 0, max: 1)
            let maxDimOpacity = colorScheme == .dark ? 0.32 : 0.22
            let leftDim = position * maxDimOpacity
            let rightDim = (1 - position) * maxDimOpacity

            HStack(spacing: 0) {
                CheckMateChatListView(
                    conversations: conversations,
                    activeConversationId: activeConversationId,
                    isLoading: isLoadingChats,
                    errorText: conversationsError,
                    onSelectChat: { conversationId in
                        selectConversation(conversationId)
                    },
                    onNewChat: {
                        startNewConversation()
                    },
                    onRefresh: {
                        refreshChats()
                    }
                )
                .ignoresSafeArea()
                .frame(width: width)
                .clipped()
                .overlay(Color.black.opacity(leftDim).allowsHitTesting(false))

                CheckMateChatView(
                    conversationId: $activeConversationId,
                    rpcClient: rpcClient,
                    onStatusUpdate: { conversationId, status in
                        applyStatusUpdate(conversationId, status)
                    }
                )
                    .frame(width: width)
                    .clipped()
                    .overlay(Color.black.opacity(rightDim).allowsHitTesting(false))
            }
            .offset(x: currentOffset)
            .contentShape(Rectangle())
            .simultaneousGesture(horizontalDragGesture(width: width))
        }
        .onAppear {
            refreshChats()
        }
        .onDisappear {
            chatListTask?.cancel()
            chatListTask = nil
        }
        .onChange(of: activeIndex) { newValue in
            if newValue == 0 {
                refreshChats()
            }
        }
        .onChange(of: rpcClient != nil) { hasClient in
            if hasClient {
                refreshChats()
            }
        }
    }

    private func horizontalDragGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .local)
            .onChanged { value in
                if width <= 0 {
                    return
                }
                let horizontal = value.translation.width
                let vertical = value.translation.height
                if abs(horizontal) > abs(vertical) {
                    dragOffset = horizontal
                } else {
                    dragOffset = 0
                }
            }
            .onEnded { value in
                if width <= 0 {
                    dragOffset = 0
                    return
                }
                let horizontal = value.translation.width
                let vertical = value.translation.height
                if abs(horizontal) <= abs(vertical) {
                    dragOffset = 0
                    return
                }

                let predicted = value.predictedEndTranslation.width
                let threshold = width * 0.25
                var newIndex = activeIndex

                if (predicted > threshold || horizontal > threshold) && activeIndex > 0 {
                    newIndex = activeIndex - 1
                }
                if (predicted < -threshold || horizontal < -threshold) && activeIndex < 1 {
                    newIndex = activeIndex + 1
                }

                withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
                    activeIndex = newIndex
                    dragOffset = 0
                }
            }
    }

    private func showChatView() {
        if activeIndex == 1 {
            return
        }
        withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.86)) {
            activeIndex = 1
            dragOffset = 0
        }
    }

    private func selectConversation(_ conversationId: String) {
        if conversationId.isEmpty {
            return
        }
        activeConversationId = conversationId
        showChatView()
    }

    private func startNewConversation() {
        activeConversationId = UUID().uuidString
        showChatView()
    }

    private func refreshChats() {
        if isRunningPreview() {
            return
        }
        guard let rpcClient else {
            return
        }
        chatListTask?.cancel()
        isLoadingChats = true
        conversationsError = nil
        chatListTask = Task {
            do {
                let response = try await rpcClient.listChats(limit: 50)
                let summaries = response.chats.map { summary in
                    parseConversationSummary(from: summary)
                }
                await MainActor.run {
                    conversations = mergeConversationSummaries(current: conversations, incoming: summaries)
                    if activeConversationId == nil {
                        activeConversationId = conversations.first?.id
                    }
                    conversationsError = nil
                    isLoadingChats = false
                }
            } catch {
                if Task.isCancelled {
                    return
                }
                await MainActor.run {
                    conversationsError = "Unable to load chats."
                    isLoadingChats = false
                }
            }
        }
    }

    private func parseConversationSummary(from summary: CheckMateChatSummaryProto) -> CheckMateConversationSummary {
        let lastMessageAt = summary.hasLastMessageAt
            ? CheckMateConversationStatus.date(from: summary.lastMessageAt)
            : Date()
        let status = summary.hasStatus ? CheckMateConversationStatus(proto: summary.status) : nil
        return CheckMateConversationSummary(
            id: summary.conversationID,
            title: summary.title,
            snippet: summary.snippet,
            lastMessageAt: lastMessageAt,
            status: status
        )
    }

    private func mergeConversationSummaries(
        current: [CheckMateConversationSummary],
        incoming: [CheckMateConversationSummary]
    ) -> [CheckMateConversationSummary] {
        let currentById = Dictionary(uniqueKeysWithValues: current.map { ($0.id, $0) })
        return incoming.map { summary in
            guard let existing = currentById[summary.id] else {
                return summary
            }
            let mergedStatus = mergeStatus(existing.status, summary.status)
            if mergedStatus == summary.status {
                return summary
            }
            return CheckMateConversationSummary(
                id: summary.id,
                title: summary.title,
                snippet: summary.snippet,
                lastMessageAt: summary.lastMessageAt,
                status: mergedStatus
            )
        }
    }

    private func mergeStatus(
        _ current: CheckMateConversationStatus?,
        _ incoming: CheckMateConversationStatus?
    ) -> CheckMateConversationStatus? {
        guard let incoming else {
            return current
        }
        guard let current else {
            return incoming
        }
        if current.updatedAt > incoming.updatedAt {
            return current
        }
        return incoming
    }

    private func applyStatusUpdate(_ conversationId: String, _ status: CheckMateConversationStatus) {
        guard let index = conversations.firstIndex(where: { $0.id == conversationId }) else {
            return
        }
        let existing = conversations[index].status
        if let existing, existing.updatedAt > status.updatedAt {
            return
        }
        let summary = conversations[index]
        conversations[index] = CheckMateConversationSummary(
            id: summary.id,
            title: summary.title,
            snippet: summary.snippet,
            lastMessageAt: summary.lastMessageAt,
            status: status
        )
    }

    private func clampedDragOffset(for width: CGFloat) -> CGFloat {
        let minOffset: CGFloat
        let maxOffset: CGFloat
        if activeIndex == 0 {
            minOffset = -width
            maxOffset = 0
        } else {
            minOffset = 0
            maxOffset = width
        }
        return clamp(dragOffset, min: minOffset, max: maxOffset)
    }

    private func clamp(_ value: CGFloat, min: CGFloat, max: CGFloat) -> CGFloat {
        if value < min {
            return min
        }
        if value > max {
            return max
        }
        return value
    }
}

private struct CheckMateConversationSummary: Identifiable {
    let id: String
    let title: String
    let snippet: String
    let lastMessageAt: Date
    let status: CheckMateConversationStatus?
}

private struct CheckMateChatListView: View {
    let conversations: [CheckMateConversationSummary]
    let activeConversationId: String?
    let isLoading: Bool
    let errorText: String?
    let onSelectChat: (String) -> Void
    let onNewChat: () -> Void
    let onRefresh: () -> Void

    var body: some View {
        GeometryReader { proxy in
            let safeTop = proxy.safeAreaInsets.top
            ZStack {
                CheckMateBackground()
                    .ignoresSafeArea()
                VStack(alignment: .leading, spacing: 0) {
                    header
                        .padding(.top, safeTop)
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            if let errorText {
                                Text(errorText)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                            } else if isLoading && conversations.isEmpty {
                                ProgressView()
                                    .frame(maxWidth: .infinity, alignment: .center)
                                    .padding(.vertical, 16)
                            } else if conversations.isEmpty {
                                Text("No chats yet.")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 4)
                            } else {
                                ForEach(conversations) { chat in
                                    Button {
                                        onSelectChat(chat.id)
                                    } label: {
                                        chatRow(chat)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)
                        .padding(.bottom, 28)
                    }
                    .refreshable {
                        onRefresh()
                    }
                }
            }
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Chats")
                    .font(.largeTitle)
                    .fontWeight(.semibold)
                Text("Recent conversations")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                onNewChat()
            } label: {
                Text("New chat")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
            }
            .glassSurface(RoundedRectangle(cornerRadius: 14, style: .continuous), fallbackMaterial: .thinMaterial)
        }
        .padding(.horizontal, 16)
        .padding(.top, 24)
        .padding(.bottom, 8)
    }

    private func chatRow(_ chat: CheckMateConversationSummary) -> some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        let isActive = chat.id == activeConversationId
        let accent = Color.accentColor
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(accent.opacity(0.18))
                Text(initials(for: chat.title))
                    .font(.headline)
                    .foregroundStyle(accent)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 8) {
                    Text(chat.title)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if chat.status?.state == .streaming {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .scaleEffect(0.7)
                    }
                    Text(formatTimestamp(chat.lastMessageAt))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if !chat.snippet.isEmpty {
                    Text(chat.snippet)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(12)
        .glassSurface(shape, fallbackMaterial: .thinMaterial, strokeOpacity: isActive ? 0.2 : 0.12)
    }

    private func initials(for title: String) -> String {
        let parts = title
            .split(separator: " ")
            .map { String($0.prefix(1)).uppercased() }
        if parts.isEmpty {
            return "?"
        }
        if parts.count == 1 {
            return parts[0]
        }
        return parts.prefix(2).joined()
    }

    private func formatTimestamp(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        if calendar.isDate(date, equalTo: Date(), toGranularity: .year) {
            return date.formatted(.dateTime.month(.abbreviated).day())
        }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }
}

#Preview {
    CheckMateRootView()
        .environmentObject(FirebaseClients())
}

private func isRunningPreview() -> Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
}
