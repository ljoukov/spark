import Connect
import SwiftUI
import UIKit

struct CheckMateChatView: View {
    private let rpcClient: CheckMateRpcClient?
    @State private var messages: [ChatMessage]
    @State private var draftText: String
    @State private var composerHeight: CGFloat
    @State private var composerLineCount: Int
    @State private var composerContainerHeight: CGFloat
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

    init(
        rpcClient: CheckMateRpcClient? = nil,
        initialMessages: [ChatMessage] = [],
        initialDraftText: String = "",
        initialAwaitingResponse: Bool = false
    ) {
        self.rpcClient = rpcClient
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
            messageList
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: 16) {
                if shouldShowScrollToBottom {
                    ScrollToBottomButton {
                        scrollToBottomOfResponse()
                    }
                    .transition(.scale.combined(with: .opacity))
                }
                ChatComposerView(
                    text: $draftText,
                    lineCount: $composerLineCount,
                    measuredHeight: $composerHeight,
                    isAwaitingResponse: isAwaitingResponse,
                    onSend: sendMessage,
                    onStop: stopResponse,
                    onExpand: { isShowingExpandedComposer = true }
                )
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
                .measureHeight($composerContainerHeight)
            }
            .frame(maxWidth: .infinity)
        }
        .fullScreenCover(isPresented: $isShowingExpandedComposer) {
            ExpandedComposerSheet(text: $draftText)
        }
        .onDisappear {
            streamTask?.cancel()
            streamTask = nil
            activeStream?.cancel()
            activeStream = nil
        }
    }

    private var messageList: some View {
        GeometryReader { proxy in
            ScrollViewReader { scrollProxy in
                ScrollView {
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
                        Color.clear
                            .frame(height: composerContainerHeight + ChatComposerMetrics.actionButtonSize + 32)
                            .measureFrame(in: ChatScrollSpace.name, for: bottomSpacerId)
                            .id(bottomSpacerId)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                }
                .coordinateSpace(name: ChatScrollSpace.name)
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
                    withAnimation(.easeOut(duration: 0.35)) {
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
        dismissKeyboard()
        let userText = draftText
        let userMessage = ChatMessage(role: .user, text: userText)
        messages.append(userMessage)
        draftText = ""
        isAwaitingResponse = true
        hasStreamedContent = false
        activeThinkingId = nil
        activeResponseId = nil
        pendingIndicatorId = UUID()
        updatePinnedUserMessageId(for: userMessage.id)
        if let pinnedUserMessageId {
            requestScroll(to: pinnedUserMessageId, anchor: .top)
        } else {
            requestScroll(to: userMessage.id, anchor: .bottom)
        }
        startChatStream()
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
    }

    private func startChatStream() {
        guard let rpcClient else {
            appendSystemMessage("Chat is unavailable. Please try again.")
            isAwaitingResponse = false
            return
        }
        var request = StreamChatRequestProto()
        request.messages = buildChatRequestMessages()
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
        }
    }

    private func applyThinkingDelta(_ delta: String) {
        if delta.isEmpty {
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
        if let activeResponseId,
           let index = messages.firstIndex(where: { $0.id == activeResponseId }) {
            messages[index].text += delta
            return
        }
        let message = ChatMessage(role: .assistant, text: delta)
        messages.append(message)
        activeResponseId = message.id
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
        Button(action: action) {
            Image(systemName: "arrow.down")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color(.label))
                .frame(width: 38, height: 38)
                .background(
                    ChatGlassBackground(
                        shape: Circle(),
                        fallbackColor: Color(.systemBackground)
                    )
                )
                .clipShape(Circle())
        }
    }
}

private struct ChatComposerView: View {
    @Binding var text: String
    @Binding var lineCount: Int
    @Binding var measuredHeight: CGFloat
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

        HStack(alignment: .bottom, spacing: 12) {
            Menu {
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
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Color(.label))
                    .frame(width: actionButtonSize, height: actionButtonSize)
                    .background(
                        ChatGlassBackground(
                            shape: Circle(),
                            fallbackColor: Color(.systemBackground)
                        )
                    )
                    .clipShape(Circle())
            }

            ZStack(alignment: .topTrailing) {
                ZStack(alignment: .leading) {
                    GrowingTextView(
                        text: $text,
                        calculatedHeight: $measuredHeight,
                        lineCount: $lineCount,
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
                    Button(action: onExpand) {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(6)
                            .background(Color(.systemBackground).opacity(0.85))
                            .clipShape(Circle())
                    }
                    .padding(.top, 6)
                    .padding(.trailing, 2)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 6)
            .padding(.vertical, ChatComposerMetrics.containerPadding)
            .background(
                ChatGlassBackground(
                    shape: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous),
                    fallbackColor: Color(.secondarySystemBackground)
                )
            )

            if isAwaitingResponse {
                ComposerActionButton(systemImage: "stop.fill", action: onStop)
            } else if text.isEmpty {
                ComposerActionButton(systemImage: "mic.fill", action: {
                })
            } else {
                ComposerActionButton(systemImage: "arrow.up", action: onSend)
            }
        }
        .padding(.vertical, 2)
    }
}

private enum ChatScrollSpace {
    static let name = "checkmate-chat-scroll"
}

private struct ComposerActionButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Color(.systemBackground))
                .frame(width: ChatComposerMetrics.actionButtonSize, height: ChatComposerMetrics.actionButtonSize)
                .background(Color(.label))
                .clipShape(Circle())
        }
    }
}

private struct ExpandedComposerSheet: View {
    @Binding var text: String
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color(.systemBackground)
                    .ignoresSafeArea()
                TextEditor(text: $text)
                    .font(.body)
                    .padding(16)
                    .focused($isFocused)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "arrow.down.right.and.arrow.up.left")
                    }
                }
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

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            parent.recalculateHeight(textView)
        }
    }
}

private enum ChatComposerMetrics {
    static let maxVisibleLines = 8
    static let expandThresholdLines = 4
    static let font = UIFont.preferredFont(forTextStyle: .body)
    static let textInsets = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
    static let containerPadding: CGFloat = 4
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

private struct ChatGlassBackground<S: Shape>: View {
    @Environment(\.colorScheme) private var colorScheme
    let shape: S
    let fallbackColor: Color

    var body: some View {
        if #available(iOS 26.0, *) {
            Color.clear.glassEffect(.regular, in: shape)
        } else {
            shape
                .fill(fallbackColor)
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(borderColor, lineWidth: 1))
                .shadow(color: shadowColor, radius: 12, x: 0, y: 4)
        }
    }

    private var borderColor: Color {
        colorScheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.08)
    }

    private var shadowColor: Color {
        colorScheme == .dark ? Color.black.opacity(0.35) : Color.black.opacity(0.12)
    }
}

private struct HeightPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct MessageHeightPreferenceKey: PreferenceKey {
    static var defaultValue: [UUID: CGFloat] = [:]

    static func reduce(value: inout [UUID: CGFloat], nextValue: () -> [UUID: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct MessageFramePreferenceKey: PreferenceKey {
    static var defaultValue: [UUID: CGRect] = [:]

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
    CheckMateChatView()
}

#Preview("Chat With Messages") {
    CheckMateChatView(initialMessages: [
        ChatMessage(role: .user, text: "Hello"),
        ChatMessage(role: .assistant, text: "Hey! Good to see you. What's up?")
    ])
}

#Preview("Chat Thinking") {
    CheckMateChatView(initialMessages: [
        ChatMessage(role: .user, text: "Explain inertia."),
        ChatMessage(role: .assistantThinking, text: "Thinking through a concise explanation...")
    ])
}

#Preview("Chat Multiline Draft") {
    CheckMateChatView(initialDraftText: "Hello\n2\n3\n4\n5\n6\n7\n8")
}

#Preview("Chat Awaiting Response") {
    CheckMateChatView(
        initialMessages: [
            ChatMessage(role: .user, text: "Hello")
        ],
        initialAwaitingResponse: true
    )
}
