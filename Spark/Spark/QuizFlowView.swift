import SwiftUI

struct QuizFlowView: View {
  @Binding var session: Session
  let onAction: (QuizFlowAction) -> Void
  let onFinished: (QuizResult) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var questions: [QuizQuestion]
  @State private var index: Int = 0
  @State private var selectedChoice: Int?
  @State private var revealAnswer = false
  @State private var wrongCount = 0
  @State private var showExitSheet = false
  @State private var completed = false
  @State private var startedAt = Date()

  init(session: Binding<Session>, onAction: @escaping (QuizFlowAction) -> Void, onFinished: @escaping (QuizResult) -> Void) {
    self._session = session
    self.onAction = onAction
    self.onFinished = onFinished
    _questions = State(initialValue: QuizQuestion.generate(for: session.wrappedValue))
  }

  var body: some View {
    VStack(spacing: 24) {
      topBar
      Spacer(minLength: 0)
      if completed {
        completionPlaceholder
      } else {
        questionContent
        Spacer()
        primaryButton
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 20)
    .padding(.bottom, 32)
    .background(Color(uiColor: .systemBackground))
    .sheet(isPresented: $showExitSheet) {
      exitSheet
        .presentationDetents([.fraction(0.25), .medium])
    }
    .animation(.easeInOut(duration: 0.2), value: revealAnswer)
    .animation(.easeInOut(duration: 0.2), value: completed)
  }

  private var topBar: some View {
    HStack {
      Text("\(min(index + 1, questions.count))/\(questions.count)")
        .font(.headline)
      Spacer()
      Button {
        showExitSheet = true
      } label: {
        Image(systemName: "xmark")
          .font(.headline)
          .padding(8)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Exit quiz")
    }
  }

  private var questionContent: some View {
    let question = questions[index]
    return VStack(alignment: .leading, spacing: 16) {
      Text(question.prompt)
        .font(.title3.weight(.semibold))
      VStack(spacing: 12) {
        ForEach(question.choices.indices, id: \.self) { choiceIndex in
          let choice = question.choices[choiceIndex]
          Button {
            guard !revealAnswer else {
              return
            }
            selectedChoice = choiceIndex
          } label: {
            HStack {
              Text(choice)
                .multilineTextAlignment(.leading)
              Spacer()
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(backgroundColor(for: choiceIndex, question: question))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
              RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(borderColor(for: choiceIndex, question: question), lineWidth: 1)
            )
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private var completionPlaceholder: some View {
    VStack(spacing: 16) {
      Image(systemName: "checkmark.seal.fill")
        .font(.system(size: 48))
        .foregroundStyle(Color.accentColor)
      Text("Session complete")
        .font(.title2.weight(.semibold))
      Text("View results to plan your next move.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .center)
  }

  private var primaryButton: some View {
    Button {
      primaryAction()
    } label: {
      Text(revealAnswer ? (isLastQuestion ? "Finish" : "Next") : "Check")
        .font(.headline)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }
    .buttonStyle(.borderedProminent)
    .tint(.accentColor)
    .disabled(!revealAnswer && selectedChoice == nil)
  }

  private var exitSheet: some View {
    VStack(spacing: 16) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text("Leave session?")
        .font(.headline)
      Button {
        finishEarly()
        showExitSheet = false
      } label: {
        Text("Finish now")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.borderedProminent)
      .tint(.accentColor)
      Button {
        showExitSheet = false
        onAction(.resume)
      } label: {
        Text("Resume")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.bordered)
      Button(role: .destructive) {
        discard()
        showExitSheet = false
      } label: {
        Text("Discard")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.bordered)
      Spacer()
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 24)
  }

  private func primaryAction() {
    guard !completed else {
      return
    }
    if revealAnswer {
      advance()
    } else {
      checkAnswer()
    }
  }

  private func checkAnswer() {
    guard let selectedChoice else {
      return
    }
    revealAnswer = true
    if selectedChoice != questions[index].answerIndex {
      wrongCount += 1
    }
  }

  private func advance() {
    let answered = index + 1
    session.completedCount = answered
    session.updatedAt = Date()
    revealAnswer = false
    selectedChoice = nil
    if isLastQuestion {
      completeSession()
    } else {
      index += 1
    }
  }

  private func finishEarly() {
    if !revealAnswer, selectedChoice != nil {
      checkAnswer()
    }
    session.completedCount = max(index + (revealAnswer ? 1 : 0), session.completedCount)
    session.updatedAt = Date()
    completeSession()
  }

  private func discard() {
    session.status = .discarded
    session.updatedAt = Date()
    onAction(.exit(session, .discarded))
    dismiss()
  }

  private func completeSession() {
    if !completed {
      session.status = .finished
      session.completedCount = max(session.completedCount, index + 1)
      session.updatedAt = Date()
      completed = true
      let duration = Date().timeIntervalSince(startedAt)
      let total = session.completedCount
      let score = max(total - wrongCount, 0)
      let result = QuizResult(session: session, score: score, total: total, timeSpent: duration, wrongCount: wrongCount)
      onFinished(result)
    }
  }

  private var isLastQuestion: Bool {
    index >= questions.count - 1
  }

  private func backgroundColor(for choiceIndex: Int, question: QuizQuestion) -> Color {
    if revealAnswer {
      if choiceIndex == question.answerIndex {
        return Color.accentColor.opacity(0.2)
      }
      if choiceIndex == selectedChoice {
        return Color.red.opacity(0.15)
      }
    } else if selectedChoice == choiceIndex {
      return Color.accentColor.opacity(0.12)
    }
    return Color.secondary.opacity(0.08)
  }

  private func borderColor(for choiceIndex: Int, question: QuizQuestion) -> Color {
    if revealAnswer {
      if choiceIndex == question.answerIndex {
        return Color.accentColor
      }
      if choiceIndex == selectedChoice {
        return Color.red
      }
    }
    if selectedChoice == choiceIndex {
      return Color.accentColor
    }
    return Color.clear
  }
}

private struct QuizQuestion: Identifiable {
  let id = UUID()
  let prompt: String
  let choices: [String]
  let answerIndex: Int

  static func generate(for session: Session) -> [QuizQuestion] {
    let baseQuestions = samples(for: session.subject ?? .biology)
    let total = session.size.rawValue
    if baseQuestions.count >= total {
      return Array(baseQuestions.prefix(total))
    }
    if baseQuestions.isEmpty {
      return baseQuestions
    }
    var questions = [QuizQuestion]()
    for index in 0..<total {
      questions.append(baseQuestions[index % baseQuestions.count])
    }
    return questions
  }

  private static func samples(for subject: Subject) -> [QuizQuestion] {
    switch subject {
    case .biology:
      return [
        QuizQuestion(prompt: "Which organelle contains genetic material?", choices: ["Mitochondria", "Nucleus", "Ribosome", "Golgi apparatus"], answerIndex: 1),
        QuizQuestion(prompt: "What is the function of chloroplasts?", choices: ["Protein synthesis", "Photosynthesis", "Cell division", "Respiration"], answerIndex: 1),
        QuizQuestion(prompt: "Which blood component carries oxygen?", choices: ["Plasma", "White cells", "Platelets", "Red cells"], answerIndex: 3)
      ]
    case .chemistry:
      return [
        QuizQuestion(prompt: "What is the pH of a neutral solution?", choices: ["0", "3", "7", "14"], answerIndex: 2),
        QuizQuestion(prompt: "Which bond involves sharing electrons?", choices: ["Ionic", "Metallic", "Covalent", "Hydrogen"], answerIndex: 2),
        QuizQuestion(prompt: "What is the formula for sodium chloride?", choices: ["Na2", "NaCl", "NaO", "NaCO3"], answerIndex: 1)
      ]
    case .physics:
      return [
        QuizQuestion(prompt: "What is the unit of force?", choices: ["Joule", "Newton", "Watt", "Pascal"], answerIndex: 1),
        QuizQuestion(prompt: "Speed equals distance divided by?", choices: ["Velocity", "Time", "Acceleration", "Mass"], answerIndex: 1),
        QuizQuestion(prompt: "Which energy store is involved when an object is lifted?", choices: ["Chemical", "Elastic", "Gravitational", "Thermal"], answerIndex: 2)
      ]
    }
  }
}

#Preview {
  QuizFlowPreview()
}

private struct QuizFlowPreview: View {
  @State private var session: Session = {
    let state = AppState()
    return state.sessions.first ?? Session(uploadId: state.uploads.first?.id, subject: state.uploads.first?.subject, size: .ten, completedCount: 0, status: .active, startedAt: Date(), updatedAt: Date(), scope: .thisUpload, mode: .standard)
  }()

  var body: some View {
    QuizFlowView(session: $session) { _ in
    } onFinished: { _ in
    }
  }
}
