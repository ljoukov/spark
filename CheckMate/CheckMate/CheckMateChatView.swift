import Connect
import FirebaseAuth
import FirebaseFirestore
import SwiftUI
import UIKit

struct CheckMateChatView: View {
    @EnvironmentObject private var firebaseClients: FirebaseClients
    @Binding private var conversationId: String?
    private let rpcClient: CheckMateRpcClient?
    private let safeAreaTop: CGFloat
    private let safeAreaBottom: CGFloat
    private let onStatusUpdate: ((String, CheckMateConversationStatus) -> Void)?
    @State private var messages: [ChatMessage]
    @State private var draftText: String
    @State private var composerHeight: CGFloat
    @State private var composerLineCount: Int
    @State private var composerContainerHeight: CGFloat
    @State private var composerBarMeasuredHeight: CGFloat = 0
    @State private var isComposerFocused = false
    @State private var isAwaitingResponse: Bool
    @State private var hasStreamedContent = false
    @State private var isShowingExpandedComposer = false
    @State private var streamTask: Task<Void, Never>?
    @State private var activeStream: (any ServerOnlyAsyncStreamInterface<StreamChatRequestProto, StreamChatResponseProto>)?
    @State private var activeThinkingId: UUID?
    @State private var activeResponseId: UUID?
    @State private var scrollRequestToken = UUID()
    @State private var scrollTargetId: UUID?
    @State private var scrollTargetAnchor: UnitPoint = .bottom
    @State private var pinnedUserMessageId: UUID?
    @State private var scrollViewHeight: CGFloat = 0
    @State private var messageHeights: [UUID: CGFloat] = [:]
    @State private var messageFrames: [UUID: CGRect] = [:]
    @State private var pendingIndicatorId = UUID()
    @State private var bottomSpacerId = UUID()
    @State private var conversationListener: ListenerRegistration?
    @State private var listeningConversationId: String?
    @State private var pendingFirestoreMessages: [ChatMessage]?

    init(
        conversationId: Binding<String?> = .constant(nil),
        rpcClient: CheckMateRpcClient? = nil,
        safeAreaTop: CGFloat = 0,
        safeAreaBottom: CGFloat = 0,
        onStatusUpdate: ((String, CheckMateConversationStatus) -> Void)? = nil,
        initialMessages: [ChatMessage] = [],
        initialDraftText: String = "",
        initialAwaitingResponse: Bool = false
    ) {
        _conversationId = conversationId
        self.rpcClient = rpcClient
        self.safeAreaTop = safeAreaTop
        self.safeAreaBottom = safeAreaBottom
        self.onStatusUpdate = onStatusUpdate
        _messages = State(initialValue: initialMessages)
        _draftText = State(initialValue: initialDraftText)
        _composerHeight = State(initialValue: ChatComposerMetrics.minHeight)
        _composerLineCount = State(initialValue: 1)
        _composerContainerHeight = State(initialValue: ChatComposerMetrics.defaultComposerHeight)
        _isAwaitingResponse = State(initialValue: initialAwaitingResponse)
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            CheckMateBackground()
                .ignoresSafeArea()
            messageList(safeAreaTop: safeAreaTop, safeAreaBottom: safeAreaBottom)
                .ignoresSafeArea()
            composerBar(safeAreaBottom: safeAreaBottom)
                .measureComposerBarHeight($composerBarMeasuredHeight)
                .anchorPreference(key: ComposerBarBoundsPreferenceKey.self, value: .bounds) { anchor in
                    anchor
                }
        }
        .coordinateSpace(name: ChatOverlaySpace.name)
        .overlayPreferenceValue(ComposerBarBoundsPreferenceKey.self) { anchor in
            GeometryReader { proxy in
                let frame = anchor.map { proxy[$0] } ?? .zero
                let buttonSize: CGFloat = 38
                let targetY = max(buttonSize / 2, frame.minY - 8 - (buttonSize / 2))
                ZStack {
                    if shouldShowScrollToBottom, frame != .zero {
                        ScrollToBottomButton {
                            scrollToBottomOfResponse()
                        }
                        .position(
                            x: frame.midX,
                            y: targetY
                        )
                        .transition(.scale.combined(with: .opacity))
                    }
                }
            }
        }
        .sheet(isPresented: $isShowingExpandedComposer) {
            ExpandedComposerSheet(
                text: $draftText,
                onSubmit: {
                    sendMessage()
                }
            )
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .onAppear {
            handleConversationChange(conversationId)
        }
        .onChange(of: conversationId) { newValue in
            handleConversationChange(newValue)
        }
        .onDisappear {
            streamTask?.cancel()
            streamTask = nil
            activeStream?.cancel()
            activeStream = nil
            stopConversationListener()
        }
    }

    private func messageList(safeAreaTop: CGFloat, safeAreaBottom: CGFloat) -> some View {
        GeometryReader { proxy in
            ScrollViewReader { scrollProxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Color.clear
                            .frame(height: safeAreaTop)
                        LazyVStack(alignment: .leading, spacing: 18) {
                            ForEach(messages) { message in
                                ChatMessageRow(message: message) { selected in
                                    copyToClipboard(selected.text)
                                }
                                .measureHeight(for: message.id)
                                .measureFrame(in: ChatScrollSpace.name, for: message.id)
                                .id(message.id)
                            }
                            if shouldShowPendingIndicator {
                                PendingResponseRow()
                                    .measureFrame(in: ChatScrollSpace.name, for: pendingIndicatorId)
                                    .id(pendingIndicatorId)
                            }
                            if shouldReserveResponseSpace {
                                Color.clear
                                    .frame(minHeight: pendingResponseMinHeight)
                            }
                        }
                        Color.clear
                            .frame(height: max(composerBarHeight(safeAreaBottom: safeAreaBottom), scrollViewHeight * 0.66))
                            .measureFrame(in: ChatScrollSpace.name, for: bottomSpacerId)
                            .id(bottomSpacerId)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                }
                .coordinateSpace(name: ChatScrollSpace.name)
                .simultaneousGesture(
                    TapGesture().onEnded {
                        if isComposerFocused {
                            dismissKeyboard()
                        }
                    }
                )
                .onAppear {
                    scrollViewHeight = proxy.size.height
                    scrollToLatestMessageIfNeeded(using: scrollProxy)
                }
                .onChange(of: proxy.size.height) { newValue in
                    scrollViewHeight = newValue
                }
                .onChange(of: scrollRequestToken) { _ in
                    guard let targetId = scrollTargetId else {
                        return
                    }
                    withAnimation(.easeOut(duration: 0.12)) {
                        scrollProxy.scrollTo(targetId, anchor: scrollTargetAnchor)
                    }
                }
                .onPreferenceChange(MessageHeightPreferenceKey.self) { newValue in
                    messageHeights = newValue
                }
                .onPreferenceChange(MessageFramePreferenceKey.self) { newValue in
                    messageFrames = newValue
                }
            }
        }
    }

    private func composerBar(safeAreaBottom: CGFloat) -> some View {
        let focusPadding = isComposerFocused ? ChatComposerMetrics.barTopPadding : 0
        let bottomPadding = barBottomPadding(for: safeAreaBottom) + focusPadding
        return VStack(spacing: 0) {
            ChatComposerView(
                text: $draftText,
                lineCount: $composerLineCount,
                measuredHeight: $composerHeight,
                isFocused: $isComposerFocused,
                isAwaitingResponse: isAwaitingResponse,
                onSend: sendMessage,
                onStop: stopResponse,
                onExpand: { isShowingExpandedComposer = true }
            )
            .padding(.horizontal, ChatComposerMetrics.barHorizontalPadding)
            .measureHeight($composerContainerHeight)
        }
        .padding(.top, ChatComposerMetrics.barTopPadding)
        .padding(.bottom, bottomPadding)
        .frame(maxWidth: .infinity)
    }

    private func handleConversationChange(_ newValue: String?) {
        if isRunningPreview() {
            return
        }
        if newValue == listeningConversationId {
            return
        }
        let previousId = listeningConversationId
        listeningConversationId = newValue
        stopConversationListener()
        if previousId != nil && previousId != newValue {
            pendingFirestoreMessages = nil
            stopResponse()
            messages = []
            activeThinkingId = nil
            activeResponseId = nil
            hasStreamedContent = false
            pinnedUserMessageId = nil
        }
        guard let newValue else {
            pendingFirestoreMessages = nil
            messages = []
            pinnedUserMessageId = nil
            return
        }
        startConversationListener(for: newValue)
    }

    private func startConversationListener(for conversationId: String) {
        guard let userId = firebaseClients.auth.currentUser?.uid else {
            return
        }
        let ref = firebaseClients.firestore
            .collection(userId)
            .document("client")
            .collection("checkmate_conversations")
            .document(conversationId)
        conversationListener = ref.addSnapshotListener { snapshot, error in
            DispatchQueue.main.async {
                if let error {
                    print("[CheckMateChatView] Conversation listener error: \(error)")
                    return
                }
                guard let snapshot, snapshot.exists, let data = snapshot.data() else {
                    return
                }
                let firestoreMessages = parseFirestoreMessages(data)
                if isAwaitingResponse {
                    pendingFirestoreMessages = firestoreMessages
                } else {
                    applyFirestoreMessages(firestoreMessages)
                }
            }
        }
    }

    private func stopConversationListener() {
        conversationListener?.remove()
        conversationListener = nil
    }

    private func applyFirestoreMessages(_ newMessages: [ChatMessage]) {
        messages = newMessages
        activeThinkingId = nil
        activeResponseId = nil
        hasStreamedContent = false
        pinnedUserMessageId = nil
    }

    private func applyPendingFirestoreMessagesIfNeeded() {
        guard let pendingFirestoreMessages else {
            return
        }
        self.pendingFirestoreMessages = nil
        applyFirestoreMessages(pendingFirestoreMessages)
    }

    private func parseFirestoreMessages(_ data: [String: Any]) -> [ChatMessage] {
        guard let rawMessages = data["messages"] as? [[String: Any]] else {
            return []
        }
        let hasAssistantResponse = rawMessages.contains { entry in
            let roleValue = entry["role"] as? String ?? ""
            if roleValue != "assistant" {
                return false
            }
            let text = entry["text"] as? String ?? ""
            return !text.isEmpty
        }
        var parsed: [ChatMessage] = []
        for entry in rawMessages {
            let roleValue = entry["role"] as? String ?? ""
            let text = entry["text"] as? String ?? ""
            let role: ChatRole
            switch roleValue {
            case "user":
                role = .user
            case "assistant":
                role = .assistant
            case "thinking":
                if hasAssistantResponse {
                    continue
                }
                role = .assistantThinking
            default:
                continue
            }
            parsed.append(ChatMessage(role: role, text: text))
        }
        return parsed
    }

    private func ensureConversationId() -> String {
        if let conversationId {
            return conversationId
        }
        let newId = UUID().uuidString
        conversationId = newId
        return newId
    }

    private func isRunningPreview() -> Bool {
        ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
    }

    private func scrollToLatestMessageIfNeeded(using proxy: ScrollViewProxy) {
        guard let lastMessage = messages.last else {
            return
        }
        if pinnedUserMessageId != nil {
            return
        }
        requestScroll(to: lastMessage.id, anchor: .bottom)
    }

    private func sendMessage() {
        if isAwaitingResponse {
            return
        }
        let trimmed = draftText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return
        }
        let activeConversationId = ensureConversationId()
        dismissKeyboard()
        let userText = draftText
        let userMessage = ChatMessage(role: .user, text: userText)
        messages.append(userMessage)
        draftText = ""
        isAwaitingResponse = true
        hasStreamedContent = false
        activeThinkingId = nil
        activeResponseId = nil
        pendingFirestoreMessages = nil
        pendingIndicatorId = UUID()
        updatePinnedUserMessageId(for: userMessage.id)
        if let pinnedUserMessageId {
            requestScroll(to: pinnedUserMessageId, anchor: .top)
        } else {
            requestScroll(to: userMessage.id, anchor: .bottom)
        }
        startChatStream(conversationId: activeConversationId)
    }

    private func stopResponse() {
        if !isAwaitingResponse {
            return
        }
        streamTask?.cancel()
        streamTask = nil
        activeStream?.cancel()
        activeStream = nil
        isAwaitingResponse = false
        applyPendingFirestoreMessagesIfNeeded()
    }

    private func startChatStream(conversationId: String) {
        guard let rpcClient else {
            appendSystemMessage("Chat is unavailable. Please try again.")
            isAwaitingResponse = false
            return
        }
        var request = StreamChatRequestProto()
        request.messages = buildChatRequestMessages()
        request.conversationID = conversationId
        streamTask?.cancel()
        let task = Task {
            do {
                let stream = try await rpcClient.startChatStream(request: request)
                await MainActor.run {
                    activeStream = stream
                }
                for await result in stream.results() {
                    await MainActor.run {
                        handleStreamResult(result)
                    }
                }
            } catch {
                if Task.isCancelled {
                    return
                }
                await MainActor.run {
                    appendSystemMessage("Something went wrong. Please try again.")
                    isAwaitingResponse = false
                    activeStream = nil
                }
            }
        }
        streamTask = task
    }

    private func buildChatRequestMessages() -> [CheckMateChatMessageProto] {
        messages.compactMap { message in
            var proto = CheckMateChatMessageProto()
            switch message.role {
            case .user:
                proto.role = .user
            case .assistant:
                proto.role = .assistant
            case .assistantThinking:
                return nil
            }
            proto.text = message.text
            return proto
        }
    }

    private func handleStreamResult(_ result: StreamResult<StreamChatResponseProto>) {
        switch result {
        case .message(let message):
            handleStreamMessage(message)
        case .complete(let code, let error, _):
            if code == .canceled {
                break
            }
            if let error {
                appendSystemMessage(error.localizedDescription)
            } else if code != .ok {
                appendSystemMessage("The response ended unexpectedly.")
            }
            isAwaitingResponse = false
            activeStream = nil
            streamTask = nil
            applyPendingFirestoreMessagesIfNeeded()
        case .headers:
            break
        }
    }

    private func handleStreamMessage(_ message: StreamChatResponseProto) {
        guard let payload = message.payload else {
            return
        }
        switch payload {
        case .thinkingDelta(let delta):
            applyThinkingDelta(delta)
        case .responseDelta(let delta):
            applyResponseDelta(delta)
        case .done:
            isAwaitingResponse = false
            activeStream = nil
            streamTask = nil
            applyPendingFirestoreMessagesIfNeeded()
        case .status(let status):
            handleStatusUpdate(status)
        }
    }

    private func handleStatusUpdate(_ status: CheckMateChatStatusProto) {
        guard let resolvedStatus = CheckMateConversationStatus(proto: status) else {
            return
        }
        guard let conversationId else {
            return
        }
        onStatusUpdate?(conversationId, resolvedStatus)
    }

    private func applyThinkingDelta(_ delta: String) {
        if delta.isEmpty {
            return
        }
        if activeResponseId != nil {
            return
        }
        hasStreamedContent = true
        if let activeThinkingId,
           let index = messages.firstIndex(where: { $0.id == activeThinkingId }) {
            messages[index].text += delta
            return
        }
        let message = ChatMessage(role: .assistantThinking, text: delta)
        messages.append(message)
        activeThinkingId = message.id
    }

    private func applyResponseDelta(_ delta: String) {
        if delta.isEmpty {
            return
        }
        hasStreamedContent = true
        removeThinkingMessagesIfNeeded()
        if let activeResponseId,
           let index = messages.firstIndex(where: { $0.id == activeResponseId }) {
            messages[index].text += delta
            return
        }
        let message = ChatMessage(role: .assistant, text: delta)
        messages.append(message)
        activeResponseId = message.id
    }

    private func removeThinkingMessagesIfNeeded() {
        if activeThinkingId == nil && !messages.contains(where: { $0.role == .assistantThinking }) {
            return
        }
        messages.removeAll(where: { $0.role == .assistantThinking })
        activeThinkingId = nil
    }

    private func appendSystemMessage(_ text: String) {
        guard !text.isEmpty else {
            return
        }
        let message = ChatMessage(role: .assistant, text: text)
        messages.append(message)
    }

    private func copyToClipboard(_ text: String) {
        UIPasteboard.general.string = text
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        isComposerFocused = false
    }

    private func requestScroll(to id: UUID, anchor: UnitPoint) {
        scrollTargetId = id
        scrollTargetAnchor = anchor
        scrollRequestToken = UUID()
    }

    private func scrollToBottomOfResponse() {
        requestScroll(to: bottomSpacerId, anchor: .bottom)
    }

    private func updatePinnedUserMessageId(for id: UUID) {
        let userMessageCount = messages.filter { $0.role == .user }.count
        if userMessageCount >= 2 {
            pinnedUserMessageId = id
        } else {
            pinnedUserMessageId = nil
        }
    }

    private var shouldReserveResponseSpace: Bool {
        guard let lastUserMessageId, pinnedUserMessageId == lastUserMessageId else {
            return false
        }
        return true
    }

    private var shouldShowPendingIndicator: Bool {
        isAwaitingResponse && !hasStreamedContent
    }

    private var lastUserMessageId: UUID? {
        messages.last { $0.role == .user }?.id
    }

    private var pendingResponseMinHeight: CGFloat {
        guard let lastUserMessageId else {
            return 0
        }
        guard let messageHeight = messageHeights[lastUserMessageId] else {
            return 0
        }
        let availableHeight = scrollViewHeight
        return max(0, availableHeight - messageHeight)
    }

    private func composerBarHeight(safeAreaBottom: CGFloat) -> CGFloat {
        if composerBarMeasuredHeight > 0 {
            return composerBarMeasuredHeight
        }
        let focusPadding = isComposerFocused ? ChatComposerMetrics.barTopPadding : 0
        return composerContainerHeight
            + ChatComposerMetrics.actionButtonSize
            + ChatComposerMetrics.barTopPadding
            + barBottomPadding(for: safeAreaBottom)
            + focusPadding
            + 24
    }

    private func barBottomPadding(for safeAreaBottom: CGFloat) -> CGFloat {
        safeAreaBottom > 0 ? safeAreaBottom : 8
    }

    private var shouldShowScrollToBottom: Bool {
        guard scrollViewHeight > 0 else {
            return false
        }
        guard let frame = messageFrames[bottomSpacerId] else {
            return false
        }
        return frame.maxY > (scrollViewHeight + 1)
    }
}

private struct ChatMessageRow: View {
    @Environment(\.colorScheme) private var colorScheme
    let message: ChatMessage
    let onCopy: (ChatMessage) -> Void

    var body: some View {
        switch message.role {
        case .user:
            HStack {
                Spacer(minLength: 40)
                Text(message.text)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(Color(.secondarySystemBackground))
                    )
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        case .assistant:
            VStack(alignment: .leading, spacing: 8) {
                Text(message.text)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button {
                    onCopy(message)
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                .buttonStyle(.plain)
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .assistantThinking:
            Text(message.text)
                .font(.callout)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(thinkingBackground)
                )
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var thinkingBackground: Color {
        colorScheme == .dark ? Color(.systemGray4) : Color(.systemGray5)
    }
}

private struct PendingResponseRow: View {
    var body: some View {
        HStack(spacing: 8) {
            ProgressView()
                .progressViewStyle(.circular)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ScrollToBottomButton: View {
    let action: () -> Void

    var body: some View {
        GlassIconButton(systemName: "arrow.down", size: 38, iconSize: 16, action: action)
    }
}

private struct ChatComposerView: View {
    @Binding var text: String
    @Binding var lineCount: Int
    @Binding var measuredHeight: CGFloat
    @Binding var isFocused: Bool
    let isAwaitingResponse: Bool
    let onSend: () -> Void
    let onStop: () -> Void
    let onExpand: () -> Void

    var body: some View {
        let font = ChatComposerMetrics.font
        let minHeight = ChatComposerMetrics.minHeight
        let maxHeight = ChatComposerMetrics.maxHeight
        let textInsets = ChatComposerMetrics.textInsets
        let actionButtonSize = ChatComposerMetrics.actionButtonSize
        let cornerRadius = ChatComposerMetrics.singleLineCornerRadius

        GlassEffectGroup {
            HStack(alignment: .bottom, spacing: 12) {
                GlassIconMenu(systemName: "plus", size: actionButtonSize, iconSize: 22) {
                    Button {
                    } label: {
                        Label("Camera", systemImage: "camera")
                    }
                    Button {
                    } label: {
                        Label("Photos", systemImage: "photo.on.rectangle")
                    }
                    Button {
                    } label: {
                        Label("Files", systemImage: "doc")
                    }
                }

                ZStack(alignment: .topTrailing) {
                    ZStack(alignment: .leading) {
                        GrowingTextView(
                            text: $text,
                            calculatedHeight: $measuredHeight,
                            lineCount: $lineCount,
                            isFocused: $isFocused,
                            minHeight: minHeight,
                            maxHeight: maxHeight,
                            font: font,
                            textInsets: textInsets
                        )
                        .frame(height: measuredHeight)

                        if text.isEmpty {
                            Text("Ask anything")
                                .font(.body)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, textInsets.left + 2)
                                .padding(.vertical, textInsets.top)
                                .allowsHitTesting(false)
                        }
                    }

                    if lineCount > ChatComposerMetrics.expandThresholdLines {
                        GlassIconButton(
                            systemName: "arrow.up.left.and.arrow.down.right",
                            size: 42,
                            iconSize: 16,
                            foreground: .secondary,
                            action: onExpand
                        )
                        .zIndex(1)
                        .padding(.top, 6)
                        .padding(.trailing, 2)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 6)
                .padding(.vertical, ChatComposerMetrics.containerPadding)
                .glassSurface(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
                    fallbackMaterial: .thinMaterial,
                    strokeOpacity: 0.12
                )
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))

                if isAwaitingResponse {
                    ComposerActionButton(systemImage: "stop.fill", action: onStop)
                } else if text.isEmpty {
                    ComposerActionButton(systemImage: "mic.fill", action: {
                    })
                } else {
                    ComposerActionButton(systemImage: "arrow.up", action: onSend)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

private enum ChatScrollSpace {
    static let name = "checkmate-chat-scroll"
}

private enum ChatOverlaySpace {
    static let name = "checkmate-chat-overlay"
}

private struct ComposerActionButton: View {
    let systemImage: String
    let size: CGFloat
    let iconSize: CGFloat
    let action: () -> Void

    init(
        systemImage: String,
        size: CGFloat = ChatComposerMetrics.actionButtonSize,
        iconSize: CGFloat = 20,
        action: @escaping () -> Void
    ) {
        self.systemImage = systemImage
        self.size = size
        self.iconSize = iconSize
        self.action = action
    }

    var body: some View {
        GlassIconButton(systemName: systemImage, size: size, iconSize: iconSize, action: action)
    }
}

private struct ExpandedComposerSheet: View {
    @Binding var text: String
    @Environment(\.dismiss) private var dismiss
    let onSubmit: () -> Void
    @FocusState private var isFocused: Bool

    var body: some View {
        let inputShape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        GlassEffectGroup {
            ZStack {
                Color(.systemBackground)
                    .ignoresSafeArea()
                TextEditor(text: $text)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
                    .focused($isFocused)
                    .background(
                        Color.clear.glassSurface(
                            inputShape,
                            fallbackMaterial: .thinMaterial,
                            strokeOpacity: 0.12
                        )
                    )
                    .clipShape(inputShape)
                    .padding(.horizontal, 8)
                    .padding(.top, 8)
            }
            .overlay(alignment: .topTrailing) {
                GlassIconButton(
                    systemName: "arrow.down.right.and.arrow.up.left",
                    size: 42,
                    iconSize: 16,
                    action: { dismiss() }
                )
                .padding(.top, 8)
                .padding(.trailing, 8)
            }
            .safeAreaInset(edge: .bottom) {
                HStack(spacing: 12) {
                    GlassIconMenu(systemName: "plus", size: 42, iconSize: 22) {
                        Button {
                        } label: {
                            Label("Camera", systemImage: "camera")
                        }
                        Button {
                        } label: {
                            Label("Photos", systemImage: "photo.on.rectangle")
                        }
                        Button {
                        } label: {
                            Label("Files", systemImage: "doc")
                        }
                    }

                    Spacer()

                    GlassIconButton(
                        systemName: "arrow.up",
                        size: 42,
                        iconSize: 20
                    ) {
                        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                        if trimmed.isEmpty {
                            return
                        }
                        onSubmit()
                        dismiss()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 10)
            }
        }
        .onAppear {
            isFocused = true
        }
    }
}

private struct GrowingTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var calculatedHeight: CGFloat
    @Binding var lineCount: Int
    @Binding var isFocused: Bool
    let minHeight: CGFloat
    let maxHeight: CGFloat
    let font: UIFont
    let textInsets: UIEdgeInsets

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.font = font
        textView.textColor = UIColor.label
        textView.backgroundColor = .clear
        textView.isScrollEnabled = false
        textView.textContainerInset = textInsets
        textView.textContainer.lineFragmentPadding = 0
        textView.adjustsFontForContentSizeCategory = true
        textView.delegate = context.coordinator
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        if textView.text != text {
            textView.text = text
        }
        textView.font = font
        recalculateHeight(textView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    private func recalculateHeight(_ textView: UITextView) {
        let availableWidth = textView.bounds.width
        if availableWidth <= 0 {
            return
        }
        textView.layoutIfNeeded()
        let targetSize = CGSize(width: availableWidth, height: .greatestFiniteMagnitude)
        let size = textView.sizeThatFits(targetSize)
        let clamped = min(max(size.height, minHeight), maxHeight)
        if calculatedHeight != clamped {
            DispatchQueue.main.async {
                calculatedHeight = clamped
            }
        }
        let visualLines = max(1, countVisualLines(in: textView))
        if lineCount != visualLines {
            DispatchQueue.main.async {
                lineCount = visualLines
            }
        }
        textView.isScrollEnabled = size.height > maxHeight
    }

    private func countVisualLines(in textView: UITextView) -> Int {
        let layoutManager = textView.layoutManager
        layoutManager.ensureLayout(for: textView.textContainer)
        let numberOfGlyphs = layoutManager.numberOfGlyphs
        var index = 0
        var lines = 0
        var lineRange = NSRange()
        while index < numberOfGlyphs {
            layoutManager.lineFragmentRect(forGlyphAt: index, effectiveRange: &lineRange)
            index = NSMaxRange(lineRange)
            lines += 1
        }
        return max(lines, 1)
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        private let parent: GrowingTextView

        init(_ parent: GrowingTextView) {
            self.parent = parent
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            parent.isFocused = true
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            parent.recalculateHeight(textView)
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            parent.isFocused = false
        }
    }
}

private enum ChatComposerMetrics {
    static let maxVisibleLines = 8
    static let expandThresholdLines = 4
    static let font = UIFont.preferredFont(forTextStyle: .body)
    static let textInsets = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
    static let containerPadding: CGFloat = 4
    static let barTopPadding: CGFloat = 10
    static let barHorizontalPadding: CGFloat = 12
    static var minHeight: CGFloat {
        font.lineHeight + textInsets.top + textInsets.bottom
    }
    static var maxHeight: CGFloat {
        (font.lineHeight * CGFloat(maxVisibleLines)) + textInsets.top + textInsets.bottom
    }
    static var actionButtonSize: CGFloat {
        minHeight + (containerPadding * 2)
    }
    static var defaultComposerHeight: CGFloat {
        actionButtonSize + 4
    }
    static var singleLineCornerRadius: CGFloat {
        actionButtonSize / 2
    }
}

struct ChatMessage: Identifiable, Equatable {
    let id: UUID
    let role: ChatRole
    var text: String
    let createdAt: Date

    init(id: UUID = UUID(), role: ChatRole, text: String, createdAt: Date = Date()) {
        self.id = id
        self.role = role
        self.text = text
        self.createdAt = createdAt
    }
}

enum ChatRole {
    case user
    case assistant
    case assistantThinking
}

private struct HeightPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ComposerBarHeightPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ComposerBarBoundsPreferenceKey: PreferenceKey {
    static let defaultValue: Anchor<CGRect>? = nil

    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        if value == nil {
            value = nextValue()
        }
    }
}

private struct MessageHeightPreferenceKey: PreferenceKey {
    static let defaultValue: [UUID: CGFloat] = [:]

    static func reduce(value: inout [UUID: CGFloat], nextValue: () -> [UUID: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct MessageFramePreferenceKey: PreferenceKey {
    static let defaultValue: [UUID: CGRect] = [:]

    static func reduce(value: inout [UUID: CGRect], nextValue: () -> [UUID: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private extension View {
    func measureHeight(_ height: Binding<CGFloat>) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear
                    .preference(key: HeightPreferenceKey.self, value: proxy.size.height)
            }
        )
        .onPreferenceChange(HeightPreferenceKey.self) { newValue in
            if height.wrappedValue != newValue {
                height.wrappedValue = newValue
            }
        }
    }

    func measureComposerBarHeight(_ height: Binding<CGFloat>) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear
                    .preference(key: ComposerBarHeightPreferenceKey.self, value: proxy.size.height)
            }
        )
        .onPreferenceChange(ComposerBarHeightPreferenceKey.self) { newValue in
            if height.wrappedValue != newValue {
                height.wrappedValue = newValue
            }
        }
    }

    func measureHeight(for id: UUID) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear
                    .preference(key: MessageHeightPreferenceKey.self, value: [id: proxy.size.height])
            }
        )
    }

    func measureFrame(in coordinateSpace: String, for id: UUID) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear
                    .preference(key: MessageFramePreferenceKey.self, value: [id: proxy.frame(in: .named(coordinateSpace))])
            }
        )
    }
}

#Preview("Chat Empty") {
    CheckMateChatView(conversationId: .constant(nil))
        .environmentObject(FirebaseClients())
}

#Preview("Chat With Messages") {
    CheckMateChatView(
        conversationId: .constant(nil),
        initialMessages: [
            ChatMessage(role: .user, text: "Hello"),
            ChatMessage(role: .assistant, text: "Hey! Good to see you. What's up?")
        ]
    )
    .environmentObject(FirebaseClients())
}

#Preview("Chat Thinking") {
    CheckMateChatView(
        conversationId: .constant(nil),
        initialMessages: [
            ChatMessage(role: .user, text: "Explain inertia."),
            ChatMessage(role: .assistantThinking, text: "Thinking through a concise explanation...")
        ]
    )
    .environmentObject(FirebaseClients())
}

#Preview("Chat Multiline Draft") {
    CheckMateChatView(conversationId: .constant(nil), initialDraftText: "Hello\n2\n3\n4\n5\n6\n7\n8")
        .environmentObject(FirebaseClients())
}

#Preview("Chat Awaiting Response") {
    CheckMateChatView(
        conversationId: .constant(nil),
        initialMessages: [
            ChatMessage(role: .user, text: "Hello")
        ],
        initialAwaitingResponse: true
    )
    .environmentObject(FirebaseClients())
}
