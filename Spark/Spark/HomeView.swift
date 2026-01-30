import SwiftUI

struct HomeView: View {
  @EnvironmentObject private var appState: AppState
  @State private var navigationPath = NavigationPath()
  @State private var showSettings = false
  @State private var showCreateSheet = false
  @State private var quizSetupContext: QuizSetupContext?
  @State private var progressDetailSubject: Subject?
  @State private var activeQuizHandle: QuizSessionHandle?
  @State private var pendingResults: QuizResult?
  @State private var pendingFollowUp: QuizFollowUp?

  var body: some View {
    NavigationStack(path: $navigationPath) {
      ZStack(alignment: .bottom) {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            topBar
            progressCard
            if let sessionCard = sessionCard {
              sessionCard
            }
            libraryCard
            if appState.uploads.isEmpty {
              emptyState
            }
            Spacer(minLength: 120)
          }
          .padding(.horizontal, 20)
          .padding(.top, 16)
          .padding(.bottom, 160)
        }
        createButton
          .padding(.bottom, 32)
      }
      .navigationDestination(for: HomeDestination.self) { destination in
        switch destination {
        case .library:
          LibraryView(quizSetupContext: $quizSetupContext)
            .environmentObject(appState)
        }
      }
    }
    .sheet(isPresented: $showSettings) {
      SettingsSheet()
        .presentationDetents([.medium])
    }
    .sheet(isPresented: $showCreateSheet) {
      CreateSheet { source in
        showCreateSheet = false
        let upload = appState.createUpload(from: source)
        quizSetupContext = QuizSetupContext(
          upload: upload, defaultScope: .thisUpload, allowScopeToggle: true, mode: .standard,
          preferredSize: .ten)
      }
      .presentationDetents([.medium])
    }
    .sheet(item: $quizSetupContext) { context in
      QuizSetupSheet(context: context) { size, scope, mode in
        let session = appState.startSession(
          from: context.upload, size: size, scope: scope, mode: mode)
        activeQuizHandle = QuizSessionHandle(id: session.id)
      }
      .presentationDetents([.fraction(0.45), .medium])
    }
    .sheet(item: $progressDetailSubject) { subject in
      ProgressDetailSheet(subject: subject) { startSubject in
        let upload =
          appState.uploads.first { candidate in
            candidate.subject == startSubject
          } ?? appState.latestUpload
        if let upload {
          let session = appState.startSession(
            from: upload, size: .ten, scope: .thisUpload, mode: .standard)
          activeQuizHandle = QuizSessionHandle(id: session.id)
        }
      }
      .environmentObject(appState)
      .presentationDetents([.fraction(0.4)])
    }
    .fullScreenCover(item: $activeQuizHandle) { handle in
      if let binding = binding(for: handle.id) {
        QuizFlowView(session: binding) { action in
          handleQuizAction(action)
        } onFinished: { result in
          pendingResults = result
        }
        .environmentObject(appState)
      } else {
        EmptyView()
      }
    }
    .sheet(item: $pendingResults) { result in
      ResultsSheet(result: result) { followUp in
        pendingResults = nil
        handleFollowUp(followUp)
      }
      .presentationDetents([.medium, .large])
    }
    .onChange(of: pendingFollowUp) { _, followUp in
      guard let followUp else {
        return
      }
      pendingFollowUp = nil
      performFollowUp(followUp)
    }
  }

  private var topBar: some View {
    HStack {
      VStack(alignment: .leading, spacing: 4) {
        Text("Spark")
          .font(.system(size: 28, weight: .bold))
        Text("Scan. Practice. GCSE Science.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      Spacer()
      Button {
        showSettings.toggle()
      } label: {
        Image(systemName: "person.crop.circle")
          .font(.system(size: 28))
          .padding(8)
      }
      .accessibilityLabel("Open settings")
    }
  }

  private var progressCard: some View {
    let snapshot = appState.progressSnapshot()
    return Card {
      VStack(alignment: .leading, spacing: 12) {
        Text("Your progress")
          .font(.headline)
        ProgressView(value: snapshot.overall)
          .tint(.accentColor)
        HStack {
          Label("Streak \(appState.streakDays) days", systemImage: "flame")
            .font(.subheadline)
          Spacer()
          Label("\(appState.totalMinutes) min", systemImage: "clock")
            .font(.subheadline)
        }
        .foregroundStyle(.secondary)
        Divider()
        if !appState.pinnedConcepts.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            Text("Pinned concepts")
              .font(.caption)
              .foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
              HStack(spacing: 8) {
                ForEach(appState.pinnedConcepts) { concept in
                  Button {
                    progressDetailSubject = concept.subject
                  } label: {
                    HStack(spacing: 6) {
                      Text(concept.code)
                        .font(.caption2.weight(.semibold))
                      Text(concept.title)
                        .font(.caption2)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(concept.subject.accentColor.opacity(0.15))
                    .clipShape(Capsule())
                  }
                  .buttonStyle(.plain)
                }
              }
            }
          }
          Divider()
        }
        VStack(alignment: .leading, spacing: 12) {
          ForEach(Subject.allCases) { subject in
            Button {
              progressDetailSubject = subject
            } label: {
              HStack(spacing: 12) {
                Circle()
                  .fill(subject.accentColor)
                  .frame(width: 10, height: 10)
                Text(subject.title)
                  .font(.subheadline)
                  .foregroundStyle(.primary)
                Spacer()
                ProgressView(value: snapshot.subjectBreakdown[subject] ?? 0)
                  .progressViewStyle(.linear)
                  .tint(subject.accentColor)
                  .frame(width: 120)
              }
              .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
      }
    }
  }

  private var sessionCard: AnyView? {
    guard let session = sessionPreview else {
      return nil
    }
    let isActive = session.status == .active
    let title = isActive ? "Resume" : "Next session"
    let subtitle: String
    if let subject = session.subject {
      subtitle = subject.title
    } else if let upload = appState.uploads.first(where: { $0.id == session.uploadId }) {
      subtitle = upload.title
    } else {
      subtitle = "Session"
    }
    let detail = isActive ? "\(session.remaining) left" : "Ready"

    return AnyView(
      Card {
        VStack(alignment: .leading, spacing: 12) {
          HStack {
            VStack(alignment: .leading, spacing: 4) {
              Text(title)
                .font(.headline)
              Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            Spacer()
            Menu {
              Button("Change size") {
                if let upload = uploadFor(session: session) {
                  quizSetupContext = QuizSetupContext(
                    upload: upload, defaultScope: session.scope, allowScopeToggle: true,
                    mode: session.mode, preferredSize: session.size)
                }
              }
              Button("New variant") {
                if let upload = uploadFor(session: session) {
                  let newSession = appState.startSession(
                    from: upload, size: session.size, scope: session.scope, mode: .standard)
                  activeQuizHandle = QuizSessionHandle(id: newSession.id)
                }
              }
            } label: {
              Image(systemName: "ellipsis")
                .rotationEffect(.degrees(90))
                .padding(.horizontal, 4)
            }
            .buttonStyle(.plain)
          }
          HStack {
            Text(detail)
              .font(.subheadline)
              .foregroundStyle(.secondary)
            Spacer()
            Button {
              if isActive {
                activeQuizHandle = QuizSessionHandle(id: session.id)
              } else if let upload = uploadFor(session: session) {
                let newSession = appState.startSession(
                  from: upload, size: session.size, scope: session.scope, mode: .standard)
                activeQuizHandle = QuizSessionHandle(id: newSession.id)
              }
            } label: {
              Text(isActive ? "Resume" : "Start")
                .fontWeight(.semibold)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(Color.accentColor.opacity(0.12))
                .clipShape(Capsule())
            }
          }
        }
      })
  }

  private var libraryCard: some View {
    Card {
      VStack(alignment: .leading, spacing: 12) {
        Text("Library")
          .font(.headline)
        if let latest = appState.latestUpload {
          HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
              Text(latest.title)
                .font(.subheadline)
              Text("\(latest.itemCount) items • \(latest.subject.title)")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
          }
        } else {
          Text("Add notes to see them here")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 12) {
          Button {
            navigationPath.append(HomeDestination.library)
          } label: {
            Text("Open Library")
              .frame(maxWidth: .infinity)
          }
          .buttonStyle(.borderedProminent)
          .tint(.accentColor)
          .controlSize(.large)

          Button {
            if let latest = appState.latestUpload {
              quizSetupContext = QuizSetupContext(
                upload: latest, defaultScope: .thisUpload, allowScopeToggle: true, mode: .standard,
                preferredSize: .ten)
            }
          } label: {
            Text("Start from last upload")
              .underline()
          }
          .buttonStyle(.plain)
          .disabled(appState.latestUpload == nil)
        }
      }
    }
  }

  private var emptyState: some View {
    VStack(spacing: 12) {
      Image(systemName: "arrow.down")
        .font(.system(size: 48, weight: .medium))
        .foregroundStyle(.secondary)
      Text("Add notes to start.")
        .font(.callout)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 24)
  }

  private var createButton: some View {
    Button {
      showCreateSheet.toggle()
    } label: {
      Text("Create")
        .font(.headline)
        .frame(maxWidth: .infinity)
        .frame(height: 56)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .overlay(
          Capsule()
            .stroke(Color.accentColor, lineWidth: 1.5)
        )
        .shadow(color: .black.opacity(0.1), radius: 8, x: 0, y: 4)
        .padding(.horizontal, 60)
    }
    .buttonStyle(.plain)
  }

  private func uploadFor(session: Session) -> Upload? {
    appState.uploads.first { upload in
      upload.id == session.uploadId
    }
  }

  private var sessionPreview: Session? {
    if let active = appState.activeSession {
      return active
    }
    if let completed = appState.lastCompletedSession {
      return completed
    }
    return nil
  }

  private func binding(for sessionID: UUID) -> Binding<Session>? {
    guard let session = appState.sessions.first(where: { $0.id == sessionID }) else {
      return nil
    }
    return Binding(
      get: {
        appState.sessions.first(where: { $0.id == sessionID }) ?? session
      },
      set: { updated in
        appState.update(session: updated)
        if updated.status != .active {
          appState.finishSession(id: updated.id, status: updated.status)
        }
      })
  }

  private func handleQuizAction(_ action: QuizFlowAction) {
    switch action {
    case .exit(let session, let status):
      appState.finishSession(id: session.id, status: status)
      activeQuizHandle = nil
    case .resume:
      break
    }
  }

  private func handleFollowUp(_ followUp: QuizFollowUp) {
    switch followUp {
    case .done:
      activeQuizHandle = nil
    default:
      pendingFollowUp = followUp
    }
  }

  private func performFollowUp(_ followUp: QuizFollowUp) {
    switch followUp {
    case .done:
      break
    case .focus(let size, let session):
      activeQuizHandle = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        if let upload = uploadFor(session: session) {
          let newSession = appState.startSession(
            from: upload, size: size, scope: .thisUpload, mode: .focus(size.rawValue))
          activeQuizHandle = QuizSessionHandle(id: newSession.id)
        }
      }
    case .repeatSame(let session):
      activeQuizHandle = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        if let upload = uploadFor(session: session) {
          let newSession = appState.startSession(
            from: upload, size: session.size, scope: session.scope, mode: .standard)
          activeQuizHandle = QuizSessionHandle(id: newSession.id)
        }
      }
    case .newVariant(let session):
      activeQuizHandle = nil
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
        if let upload = uploadFor(session: session) {
          let newSession = appState.startSession(
            from: upload, size: session.size, scope: session.scope, mode: .standard)
          activeQuizHandle = QuizSessionHandle(id: newSession.id)
        }
      }
    case .reviewMistakes:
      break
    }
  }
}

private enum HomeDestination: Hashable {
  case library
}

private struct Card<Content: View>: View {
  @ViewBuilder var content: () -> Content

  var body: some View {
    VStack(alignment: .leading, spacing: 0, content: content)
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color(uiColor: .systemBackground))
      .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
      .shadow(color: Color.black.opacity(0.05), radius: 12, x: 0, y: 8)
  }
}

private struct SettingsSheet: View {
  private let options: [(icon: String, title: String)] = [
    ("person", "Account"),
    ("list.bullet.rectangle", "Boards & subjects"),
    ("bell", "Notifications"),
    ("info.circle", "App info"),
    ("doc", "Privacy / Terms"),
    ("star", "Referral code"),
    ("square.and.arrow.up", "Export study receipt"),
    ("questionmark.circle", "Help"),
    ("arrow.backward.square", "Logout"),
  ]

  var body: some View {
    VStack(spacing: 16) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text("Settings")
        .font(.headline)
      ForEach(options, id: \.title) { option in
        HStack(spacing: 12) {
          Image(systemName: option.icon)
            .frame(width: 24)
          Text(option.title)
          Spacer()
          Image(systemName: "chevron.right")
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 8)
      }
      Spacer()
    }
    .padding(.horizontal, 24)
    .presentationDragIndicator(.automatic)
  }
}

private struct CreateSheet: View {
  let onPick: (CreateSource) -> Void

  var body: some View {
    VStack(spacing: 20) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text("Create sheet")
        .font(.headline)
      ForEach([CreateSource.camera, .photo, .file, .paste]) { source in
        Button {
          onPick(source)
        } label: {
          HStack {
            Text(source.title)
              .font(.body)
            Spacer()
            Image(systemName: "chevron.right")
              .foregroundStyle(.tertiary)
          }
          .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
      }
      Spacer()
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 16)
    .presentationDragIndicator(.visible)
  }
}

private struct QuizSetupSheet: View {
  let context: QuizSetupContext
  let onStart: (SessionSize, QuizScope, SessionMode) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var selectedSize: SessionSize
  @State private var selectedScope: QuizScope
  @State private var isTimed: Bool

  init(context: QuizSetupContext, onStart: @escaping (SessionSize, QuizScope, SessionMode) -> Void)
  {
    self.context = context
    self.onStart = onStart
    _selectedSize = State(initialValue: context.preferredSize)
    _selectedScope = State(initialValue: context.defaultScope)
    if case .timed = context.mode {
      _isTimed = State(initialValue: true)
    } else {
      _isTimed = State(initialValue: false)
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text("Quiz setup")
        .font(.headline)
      if let upload = context.upload {
        VStack(alignment: .leading, spacing: 4) {
          Text(upload.title)
            .font(.subheadline)
          Text("\(upload.itemCount) items • \(upload.subject.title)")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
      Text("Size")
        .font(.subheadline)
      HStack(spacing: 12) {
        ForEach(SessionSize.allCases) { size in
          Button {
            selectedSize = size
          } label: {
            Text(size.label)
              .fontWeight(.semibold)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 12)
              .background(
                size == selectedSize ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.1)
              )
              .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
          }
          .buttonStyle(.plain)
        }
      }
      if context.allowScopeToggle {
        VStack(alignment: .leading, spacing: 12) {
          Text("Scope")
            .font(.subheadline)
          Picker("Scope", selection: $selectedScope) {
            ForEach(QuizScope.allCases) { scope in
              Text(scope.label)
                .tag(scope)
            }
          }
          .pickerStyle(.segmented)
        }
      } else {
        Text("Scope: \(context.defaultScope.label)")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
      if showsModeToggle {
        Toggle(isOn: $isTimed) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Timed paper mode")
              .font(.subheadline)
            Text("Applies mark weighting and stopwatch")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .toggleStyle(.switch)
      }
      Button {
        let scope = context.allowScopeToggle ? selectedScope : context.defaultScope
        let mode: SessionMode
        if case .focus = context.mode {
          mode = context.mode
        } else {
          mode = isTimed ? .timed : .standard
        }
        onStart(selectedSize, scope, mode)
        dismiss()
      } label: {
        Text("Start")
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
      }
      .buttonStyle(.borderedProminent)
      .tint(.accentColor)
      Spacer()
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 24)
    .presentationDragIndicator(.visible)
  }

  private var showsModeToggle: Bool {
    if case .focus = context.mode {
      return false
    }
    return true
  }
}

private struct ProgressDetailSheet: View {
  @EnvironmentObject private var appState: AppState
  let subject: Subject
  let onStart: (Subject) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text(subject.title)
        .font(.headline)
      ProgressView(value: appState.subjectProgress(for: subject))
        .tint(subject.accentColor)
      if let suggestion = suggestion {
        VStack(alignment: .leading, spacing: 4) {
          Text("Suggested next set")
            .font(.caption)
            .foregroundStyle(.secondary)
          HStack(spacing: 8) {
            Text(suggestion.code)
              .font(.caption2.weight(.semibold))
              .padding(.horizontal, 10)
              .padding(.vertical, 4)
              .background(subject.accentColor.opacity(0.15))
              .clipShape(Capsule())
            Text(suggestion.title)
              .font(.subheadline)
          }
        }
      }
      Button {
        onStart(subject)
        dismiss()
      } label: {
        Text("Start session")
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.borderedProminent)
      .tint(subject.accentColor)
      Spacer()
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 24)
    .presentationDragIndicator(.visible)
  }

  private var suggestion: PinnedConcept? {
    appState.pinnedConcepts.first { concept in
      concept.subject == subject
    }
  }
}

#Preview {
  HomePreview()
}

private struct HomePreview: View {
  @StateObject private var state = AppState()

  var body: some View {
    HomeView()
      .environmentObject(state)
  }
}
