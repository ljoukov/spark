import SwiftUI

struct ResumeSessionView: View {
  let session: SparkResumeSession
  @State private var showFocusNudge = false
  @State private var expandedSpecID: SparkSpecCode.ID?

  private let focusSuggestion = SparkMockData.focusRecommendations.first

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          header
          progressOverview
          specCodeList
          actionButtons
          if showFocusNudge, let suggestion = focusSuggestion {
            FocusNudgeCard(recommendation: suggestion)
              .transition(.move(edge: .bottom).combined(with: .opacity))
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Resume session")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var header: some View {
    SparkGlassCard(gradient: SparkGradient.hero) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .center) {
          VStack(alignment: .leading, spacing: 8) {
            SparkTypography.title(Text(session.title))
            SparkTypography.caption(Text(session.subtitle))
          }
          Spacer()
          CircularProgressView(progress: session.progress, subject: session.subject)
            .frame(width: 72, height: 72)
        }

        SparkTypography.caption(
          Text(
            "You've completed \(session.completedQuestions) of \(session.totalQuestions) questions")
        )
        Divider().background(SparkPalette.outline)
        HStack(spacing: 12) {
          statPill(icon: "clock.fill", label: "Time", value: "\(session.timeSpentMinutes) min")
          statPill(icon: "speedometer", label: "Pace", value: "\(paceDescription)")
          statPill(icon: "sparkle", label: "Subject", value: session.subject.rawValue)
        }
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }

  private var paceDescription: String {
    let pace = Double(session.timeSpentMinutes) / Double(max(session.completedQuestions, 1))
    return String(format: "%.1f min/Q", pace)
  }

  private func statPill(icon: String, label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Label(value, systemImage: icon)
        .font(.system(size: 14, weight: .semibold, design: .rounded))
      SparkTypography.caption(Text(label.uppercased()))
    }
    .padding(.vertical, 12)
    .padding(.horizontal, 14)
    .background(SparkPalette.textPrimary.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
  }

  private var progressOverview: some View {
    SparkGlassCard {
      VStack(alignment: .leading, spacing: 16) {
        SparkTypography.label(Text("Session timeline"))
        TimelineView(entries: timelineEntries)
        SparkTypography.caption(Text("Keep momentum steady around 1.2 min per question"))
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }

  private var timelineEntries: [TimelineEntry] {
    let steps = Array(stride(from: 0, through: session.completedQuestions, by: 10))
    return steps.enumerated().map { index, value in
      let time = Double(value) * 1.2
      return TimelineEntry(label: "Q\(value)", minutes: time, highlight: index == steps.count - 1)
    }
  }

  private var specCodeList: some View {
    VStack(alignment: .leading, spacing: 12) {
      SparkTypography.label(Text("Upcoming spec codes"))
      VStack(spacing: 12) {
        ForEach(session.upcomingSpecCodes) { spec in
          SparkGlassCard {
            VStack(alignment: .leading, spacing: 12) {
              HStack(alignment: .center) {
                SparkTypography.label(Text(spec.code))
                Spacer()
                ConfidenceMeter(confidence: spec.confidence)
                  .frame(width: 100)
              }

              SparkTypography.caption(Text("\(spec.topic) · \(spec.board)"))

              Button {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85, blendDuration: 0.2)) {
                  if expandedSpecID == spec.id {
                    expandedSpecID = nil
                  } else {
                    expandedSpecID = spec.id
                  }
                }
              } label: {
                HStack {
                  Text(
                    expandedSpecID == spec.id ? "Hide mini-drill preview" : "Preview drill prompts"
                  )
                  .font(.system(size: 13, weight: .semibold, design: .rounded))
                  Spacer()
                  Image(systemName: expandedSpecID == spec.id ? "chevron.up" : "chevron.down")
                    .font(.system(size: 13, weight: .medium))
                }
              }
              .buttonStyle(.plain)

              if expandedSpecID == spec.id {
                VStack(alignment: .leading, spacing: 8) {
                  ForEach(samplePrompts(for: spec), id: \.self) { prompt in
                    Text("• \(prompt)")
                      .font(.system(size: 13, weight: .regular, design: .rounded))
                      .foregroundStyle(SparkPalette.textSecondary)
                  }
                }
                .padding(12)
                .background(SparkPalette.textPrimary.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
              }

              TrendPill(trend: spec.trend)
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }
        }
      }
    }
  }

  private func samplePrompts(for spec: SparkSpecCode) -> [String] {
    return [
      "Explain \(spec.topic.lowercased()) to a friend in 2 sentences.",
      "Sketch a past-paper style question for \(spec.code).",
      "List two common misconceptions and how to correct them.",
    ]
  }

  private var actionButtons: some View {
    VStack(spacing: 14) {
      SparkFilledButton(title: "Continue session", icon: "play.fill", gradient: SparkGradient.hero)
      {
        // Mock action
      }
      SparkSecondaryButton(title: "Mark complete & review", icon: "checkmark.circle.fill") {
        withAnimation {
          showFocusNudge = true
        }
      }
    }
  }
}

private struct TimelineEntry: Identifiable {
  let id = UUID()
  let label: String
  let minutes: Double
  let highlight: Bool
}

private struct TimelineView: View {
  let entries: [TimelineEntry]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(entries) { entry in
        HStack {
          Text(entry.label)
            .font(
              .system(size: 12, weight: entry.highlight ? .semibold : .medium, design: .rounded)
            )
            .frame(width: 44, alignment: .leading)
            .foregroundStyle(
              entry.highlight ? SparkPalette.textPrimary : SparkPalette.textSecondary)

          GeometryReader { geometry in
            Capsule()
              .fill(entry.highlight ? SparkPalette.accent : SparkPalette.textPrimary.opacity(0.12))
              .overlay(alignment: .leading) {
                Capsule()
                  .fill(
                    entry.highlight
                      ? SparkPalette.accentSecondary : SparkPalette.textPrimary.opacity(0.2)
                  )
                  .frame(width: geometry.size.width * normalized(for: entry))
              }
          }
          .frame(height: 10)

          Text("\(Int(entry.minutes)) min")
            .font(.system(size: 12, weight: .medium, design: .rounded))
            .foregroundStyle(SparkPalette.textSecondary)
            .frame(width: 60, alignment: .trailing)
        }
      }
    }
  }

  private func normalized(for entry: TimelineEntry) -> CGFloat {
    guard let maxMinutes = entries.map({ $0.minutes }).max(), maxMinutes > 0 else {
      return 0
    }
    return CGFloat(entry.minutes / maxMinutes)
  }
}

struct FocusNudgeCard: View {
  let recommendation: SparkFocusRecommendation

  var body: some View {
    SparkGlassCard(gradient: SparkGradient.focus) {
      VStack(alignment: .leading, spacing: 14) {
        HStack {
          SparkTypography.label(Text("Focus next"))
          Spacer()
          Chip(text: "\(recommendation.suggestedQuestions) Q")
        }

        SparkTypography.caption(
          Text("Target \(recommendation.spec.topic) to level up before the next session"))
        HStack(spacing: 12) {
          TrendPill(trend: recommendation.spec.trend)
          ConfidenceMeter(confidence: recommendation.spec.confidence)
            .frame(width: 120)
        }

        SparkFilledButton(
          title: "Start focus set", icon: "bolt.fill", gradient: SparkGradient.focus
        ) {
          // Mock action
        }
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }
}

struct QuickPracticeSetupView: View {
  let options: [SparkSessionSizeOption]
  let selectedOption: SparkSessionSizeOption?

  init(options: [SparkSessionSizeOption], selectedOption: SparkSessionSizeOption? = nil) {
    self.options = options
    self.selectedOption = selectedOption
  }

  @State private var currentSelection: SparkSessionSizeOption?
  @State private var includeTimer = true
  @State private var timerPreset = 25
  @State private var showFocusOffer = false

  private let timerChoices = [10, 15, 20, 25, 30]
  private let focusSuggestion = SparkMockData.focusRecommendations[1]

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard {
            VStack(alignment: .leading, spacing: 16) {
              SparkTypography.label(Text("How big is today's burst?"))
              LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                ForEach(options) { option in
                  Button {
                    withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) {
                      currentSelection = option
                      timerPreset = option.timerMinutes ?? timerPreset
                    }
                  } label: {
                    VStack(alignment: .leading, spacing: 10) {
                      HStack {
                        Text("\(option.questions) Q")
                          .font(.system(size: 20, weight: .semibold, design: .rounded))
                        Spacer()
                        if option.isRecommended {
                          BadgeView(text: "Recommended", accent: SparkPalette.accentSecondary)
                        }
                      }
                      SparkTypography.caption(Text("≈ \(option.estimatedMinutes) min"))
                      if let timer = option.timerMinutes {
                        SparkTypography.caption(Text("Timer preset \(timer) min"))
                      }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(selectionBackground(for: option))
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(
                      RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(
                          isSelected(option) ? SparkPalette.accentSecondary : SparkPalette.outline,
                          lineWidth: 1.5)
                    )
                  }
                  .buttonStyle(.plain)
                }
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkGlassCard {
            VStack(alignment: .leading, spacing: 16) {
              Toggle(isOn: $includeTimer) {
                SparkTypography.label(Text("Include a timer"))
              }
              .toggleStyle(SwitchToggleStyle(tint: SparkPalette.accentSecondary))

              if includeTimer {
                VStack(alignment: .leading, spacing: 12) {
                  SparkTypography.caption(Text("Choose your pace"))
                  ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                      ForEach(timerChoices, id: \.self) { value in
                        Button {
                          withAnimation {
                            timerPreset = value
                          }
                        } label: {
                          Text("\(value) min")
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(
                              timerPreset == value
                                ? SparkPalette.accentSecondary.opacity(0.25)
                                : SparkPalette.textPrimary.opacity(0.06)
                            )
                            .foregroundColor(
                              timerPreset == value
                                ? SparkPalette.accentSecondary : SparkPalette.textSecondary
                            )
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                      }
                    }
                  }
                }
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkFilledButton(
            title: "Start quick practice", icon: "sparkles", gradient: SparkGradient.hero
          ) {
            withAnimation {
              showFocusOffer = true
            }
          }

          if showFocusOffer {
            FocusNudgeCard(recommendation: focusSuggestion)
              .transition(.move(edge: .bottom).combined(with: .opacity))
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Quick practice")
    .navigationBarTitleDisplayMode(.inline)
    .onAppear {
      if currentSelection == nil {
        if let selectedOption {
          currentSelection = selectedOption
          timerPreset = selectedOption.timerMinutes ?? timerPreset
        } else if let recommended = options.first(where: { $0.isRecommended }) {
          currentSelection = recommended
          timerPreset = recommended.timerMinutes ?? timerPreset
        } else {
          currentSelection = options.first
        }
      }
    }
  }

  private func isSelected(_ option: SparkSessionSizeOption) -> Bool {
    guard let currentSelection else {
      return false
    }
    return currentSelection.id == option.id
  }

  private func selectionBackground(for option: SparkSessionSizeOption) -> some View {
    return isSelected(option)
      ? SparkGradient.glow
      : LinearGradient(
        colors: [SparkPalette.surface, SparkPalette.surface], startPoint: .top, endPoint: .bottom)
  }
}

struct DocPracticeView: View {
  let document: SparkDocumentPractice
  @State private var selectedScope: SparkDocumentPractice.Scope
  @State private var reinforceWeakCodes = true
  @State private var showFocusOffer = false

  init(document: SparkDocumentPractice) {
    self.document = document
    _selectedScope = State(initialValue: document.scopeOptions.first ?? .thisDoc)
  }

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard(gradient: SparkGradient.glow) {
            VStack(alignment: .leading, spacing: 14) {
              SparkTypography.label(Text(document.title))
              SparkTypography.caption(Text(document.previewSnippet))
              Divider().background(SparkPalette.outline)
              HStack(spacing: 12) {
                Chip(text: "\(document.itemCount) items")
                Chip(text: document.lastPracticed)
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkGlassCard {
            VStack(alignment: .leading, spacing: 16) {
              SparkTypography.label(Text("Scope"))
              scopeSelector
              Toggle(isOn: $reinforceWeakCodes) {
                SparkTypography.caption(Text("Bring in similar weak codes"))
              }
              .toggleStyle(SwitchToggleStyle(tint: SparkPalette.accentSecondary))
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          if !document.weakCodes.isEmpty {
            SparkGlassCard {
              VStack(alignment: .leading, spacing: 12) {
                SparkTypography.label(Text("Weak areas to watch"))
                ForEach(document.weakCodes) { spec in
                  SparkSpecRow(spec: spec)
                }
              }
              .foregroundStyle(SparkPalette.textPrimary)
            }
          }

          SparkFilledButton(
            title: "Start doc practice", icon: "doc.text", gradient: SparkGradient.hero
          ) {
            withAnimation {
              showFocusOffer = true
            }
          }

          if showFocusOffer {
            FocusNudgeCard(recommendation: SparkMockData.focusRecommendations.first!)
              .transition(.opacity)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Doc-based practice")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var scopeSelector: some View {
    HStack(spacing: 12) {
      ForEach(document.scopeOptions, id: \.rawValue) { scope in
        Button {
          withAnimation {
            selectedScope = scope
          }
        } label: {
          Text(scope.rawValue)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .padding(.horizontal, 18)
            .padding(.vertical, 10)
            .background(scopeBackground(for: scope))
            .foregroundColor(
              selectedScope == scope ? SparkPalette.accent : SparkPalette.textSecondary
            )
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
      }
    }
  }

  private func scopeBackground(for scope: SparkDocumentPractice.Scope) -> some View {
    return selectedScope == scope
      ? SparkPalette.accent.opacity(0.2)
      : SparkPalette.textPrimary.opacity(0.05)
  }
}

struct FocusPracticeView: View {
  let recommendation: SparkFocusRecommendation
  @State private var showCompletion = false

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard(gradient: SparkGradient.focus) {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text(recommendation.spec.code))
              SparkTypography.caption(
                Text("\(recommendation.spec.topic) · \(recommendation.spec.board)"))
              HStack(spacing: 12) {
                TrendPill(trend: recommendation.spec.trend)
                ConfidenceMeter(confidence: recommendation.spec.confidence)
                  .frame(width: 120)
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkGlassCard {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text("Focus plan"))
              ForEach(planSteps, id: \.self) { step in
                Text(step)
                  .font(.system(size: 14, weight: .regular, design: .rounded))
                  .foregroundColor(SparkPalette.textSecondary)
                  .frame(maxWidth: .infinity, alignment: .leading)
                  .padding(.vertical, 8)
                if step != planSteps.last {
                  Divider().background(SparkPalette.outline)
                }
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkFilledButton(
            title: "Start \(recommendation.suggestedQuestions)-question set", icon: "bolt.fill",
            gradient: SparkGradient.focus
          ) {
            withAnimation {
              showCompletion = true
            }
          }

          if showCompletion {
            FocusCompletionCard(recommendation: recommendation)
              .transition(.move(edge: .bottom).combined(with: .opacity))
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Focus practice")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var planSteps: [String] {
    return [
      "Warm-up: 2 retrieval cards on key definitions",
      "Application: 3 scenario-based short answers",
      "Stretch: 3 calculation / multi-step reasoning",
    ]
  }
}

struct TimedPaperSetupView: View {
  let paper: SparkTimedPaperTemplate
  @State private var paceMultiplier: Double = 1
  @State private var showFocusOffer = false

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard(gradient: SparkGradient.timed) {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text(paper.subject.rawValue))
              SparkTypography.caption(Text(paper.markWeighting))
              HStack(spacing: 12) {
                Chip(text: "\(paper.durationMinutes) min")
                Chip(text: "Last: \(paper.lastAttemptScore)")
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkGlassCard {
            VStack(alignment: .leading, spacing: 16) {
              SparkTypography.label(Text("Set your pace"))
              Slider(value: $paceMultiplier, in: 0.8...1.2, step: 0.05)
                .accentColor(SparkPalette.accentSecondary)
              SparkTypography.caption(Text("Suggested timer: \(suggestedTimer) min"))
              HStack(spacing: 12) {
                paceBadge(title: "Calm", value: 0.9)
                paceBadge(title: "Standard", value: 1.0)
                paceBadge(title: "Challenge", value: 1.1)
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkGlassCard {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text("Section weighting"))
              ForEach(sectionWeightings, id: \.title) { section in
                HStack {
                  Text(section.title)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                  Spacer()
                  Text(section.weight)
                    .font(.system(size: 13, weight: .regular, design: .rounded))
                }
                .padding(.vertical, 6)
                Divider().background(SparkPalette.outline)
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkFilledButton(
            title: "Start timed paper", icon: "stopwatch.fill", gradient: SparkGradient.timed
          ) {
            withAnimation {
              showFocusOffer = true
            }
          }

          if showFocusOffer {
            FocusNudgeCard(recommendation: SparkMockData.focusRecommendations.last!)
              .transition(.opacity)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Timed paper")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var suggestedTimer: Int {
    return Int(Double(paper.recommendedTimer) * paceMultiplier)
  }

  private func paceBadge(title: String, value: Double) -> some View {
    let isActive = abs(paceMultiplier - value) < 0.01
    return Text(title)
      .font(.system(size: 12, weight: .semibold, design: .rounded))
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      .background(
        isActive
          ? SparkPalette.accentSecondary.opacity(0.25) : SparkPalette.textPrimary.opacity(0.06)
      )
      .foregroundColor(isActive ? SparkPalette.accentSecondary : SparkPalette.textSecondary)
      .clipShape(Capsule())
      .onTapGesture {
        withAnimation {
          paceMultiplier = value
        }
      }
  }

  private var sectionWeightings: [(title: String, weight: String)] {
    return [
      ("Section A · MCQ", "25%"),
      ("Section B · Short answer", "45%"),
      ("Section C · Extended response", "30%"),
    ]
  }
}

struct RevisitConceptView: View {
  let concept: SparkConceptDrill
  @State private var showCompletion = false

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard(gradient: SparkGradient.revisit) {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text(concept.title))
              SparkTypography.caption(Text(concept.summary))
              HStack(spacing: 12) {
                Chip(text: concept.subject.rawValue)
                Chip(text: "Last opened \(concept.lastOpened)")
                Chip(text: "\(concept.estimatedMinutes) min")
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkGlassCard {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text("Mini-drill blueprint"))
              ForEach(drillBlueprint, id: \.self) { item in
                Text("• \(item)")
                  .font(.system(size: 14, weight: .regular, design: .rounded))
                  .foregroundStyle(SparkPalette.textSecondary)
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }

          SparkFilledButton(
            title: "Start \(concept.estimatedMinutes)-minute drill", icon: "flame.fill",
            gradient: SparkGradient.revisit
          ) {
            withAnimation {
              showCompletion = true
            }
          }

          if showCompletion {
            FocusNudgeCard(
              recommendation: SparkMockData.focusRecommendations.randomElement()
                ?? SparkMockData.focusRecommendations[0]
            )
            .transition(.move(edge: .bottom).combined(with: .opacity))
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Revisit drill")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var drillBlueprint: [String] {
    return [
      "3 flash prompts to recall key definitions",
      "1 graph or diagram annotation",
      "2 applied questions pulled from explanations",
      "Reflection: rate confidence and tag tricky bits",
    ]
  }
}

struct StudyStatsView: View {
  let stats = SparkMockData.studyStats

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard(gradient: SparkGradient.glow) {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text("Streak & time"))
              HStack {
                metricBlock(title: "Current streak", value: "\(stats.currentStreak) days")
                metricBlock(title: "Best streak", value: "\(stats.bestStreak) days")
              }
              Divider().background(SparkPalette.outline)
              HStack {
                metricBlock(title: "This week", value: "\(stats.thisWeekMinutes) min")
                metricBlock(title: "Avg session", value: "\(stats.averageSessionMinutes) min")
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Streak summary")
    .navigationBarTitleDisplayMode(.inline)
  }

  private func metricBlock(title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      SparkTypography.caption(Text(title.uppercased()))
      Text(value)
        .font(.system(size: 18, weight: .semibold, design: .rounded))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct PinnedConceptsView: View {
  let concepts = SparkMockData.concepts.filter { concept in
    return concept.isPinned
  }

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          ForEach(concepts) { concept in
            SparkGlassCard(gradient: SparkGradient.revisit) {
              VStack(alignment: .leading, spacing: 8) {
                SparkTypography.label(Text(concept.title))
                SparkTypography.caption(Text(concept.summary))
                HStack(spacing: 12) {
                  Chip(text: concept.subject.rawValue)
                  Chip(text: "\(concept.estimatedMinutes) min")
                }
              }
              .foregroundStyle(SparkPalette.textPrimary)
            }
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Pinned concepts")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct ReferralView: View {
  let info = SparkMockData.referralInfo

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard(gradient: SparkGradient.glow) {
            VStack(alignment: .leading, spacing: 12) {
              SparkTypography.label(Text("Share Spark"))
              Text(info.rewardDescription)
                .font(.system(size: 14, weight: .regular, design: .rounded))
                .foregroundStyle(SparkPalette.textSecondary)
              referralCodeBlock
              SparkTypography.caption(Text("\(info.referralsCompleted) friends already joined"))
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Referral")
    .navigationBarTitleDisplayMode(.inline)
  }

  private var referralCodeBlock: some View {
    HStack {
      Text(info.code)
        .font(.system(size: 24, weight: .bold, design: .rounded))
        .tracking(2)
      Spacer()
      Button(action: {}) {
        Label("Copy", systemImage: "doc.on.doc")
          .font(.system(size: 14, weight: .semibold, design: .rounded))
      }
      .buttonStyle(.plain)
      .padding(.horizontal, 14)
      .padding(.vertical, 10)
      .background(SparkPalette.textPrimary.opacity(0.1))
      .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    .padding()
    .background(SparkPalette.textPrimary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

struct StudyReceiptView: View {
  private let entries: [StudyReceiptEntry] = [
    .init(title: "Focus session", detail: "Photosynthesis & Respiration", duration: "26 min"),
    .init(title: "Timed paper", detail: "Biology paper 1", duration: "58 min"),
    .init(title: "Revisit drill", detail: "Electrolysis steps", duration: "9 min"),
  ]

  var body: some View {
    ZStack(alignment: .top) {
      SparkPalette.background.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 24) {
          SparkGlassCard {
            VStack(alignment: .leading, spacing: 16) {
              SparkTypography.label(Text("This week's receipt"))
              ForEach(entries) { entry in
                VStack(alignment: .leading, spacing: 6) {
                  Text(entry.title)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                  Text(entry.detail)
                    .font(.system(size: 13, weight: .regular, design: .rounded))
                    .foregroundStyle(SparkPalette.textSecondary)
                  Text(entry.duration)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(SparkPalette.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 8)
                if entry.id != entries.last?.id {
                  Divider().background(SparkPalette.outline)
                }
              }
              SparkFilledButton(
                title: "Export as PDF", icon: "square.and.arrow.up", gradient: SparkGradient.glow
              ) {
                // Mock action
              }
            }
            .foregroundStyle(SparkPalette.textPrimary)
          }
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 40)
        .padding(.top, 24)
      }
    }
    .navigationTitle("Study receipt")
    .navigationBarTitleDisplayMode(.inline)
  }
}

private struct StudyReceiptEntry: Identifiable {
  let id = UUID()
  let title: String
  let detail: String
  let duration: String
}

struct SparkSpecRow: View {
  let spec: SparkSpecCode

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        SparkTypography.label(Text(spec.code))
        SparkTypography.caption(Text(spec.topic))
        SparkTypography.caption(Text(spec.board))
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 8) {
        ConfidenceMeter(confidence: spec.confidence)
          .frame(width: 100)
        TrendPill(trend: spec.trend)
      }
    }
    .padding(14)
    .background(SparkPalette.textPrimary.opacity(0.05))
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

struct FocusCompletionCard: View {
  let recommendation: SparkFocusRecommendation

  var body: some View {
    SparkGlassCard(gradient: SparkGradient.focus) {
      VStack(alignment: .leading, spacing: 12) {
        SparkTypography.label(Text("Nice work"))
        SparkTypography.caption(Text("You just boosted \(recommendation.spec.topic.lowercased())"))
        HStack(spacing: 12) {
          Chip(text: "Confidence +18%")
          Chip(text: "Streak +1")
        }
        SparkSecondaryButton(title: "Queue another run", icon: "plus") {
          // Mock action
        }
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }
}

struct SparkFilledButton: View {
  let title: String
  let icon: String?
  let gradient: LinearGradient
  let action: () -> Void

  init(title: String, icon: String? = nil, gradient: LinearGradient, action: @escaping () -> Void) {
    self.title = title
    self.icon = icon
    self.gradient = gradient
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      HStack {
        if let icon {
          Image(systemName: icon)
        }
        Text(title)
          .font(.system(size: 16, weight: .semibold, design: .rounded))
      }
      .foregroundColor(SparkPalette.textPrimary)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity)
      .background(gradient)
      .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
    .buttonStyle(.plain)
  }
}

struct SparkSecondaryButton: View {
  let title: String
  let icon: String?
  let action: () -> Void

  init(title: String, icon: String? = nil, action: @escaping () -> Void) {
    self.title = title
    self.icon = icon
    self.action = action
  }

  var body: some View {
    Button(action: action) {
      HStack {
        if let icon {
          Image(systemName: icon)
        }
        Text(title)
          .font(.system(size: 15, weight: .semibold, design: .rounded))
      }
      .foregroundColor(SparkPalette.textPrimary)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity)
      .background(SparkPalette.textPrimary.opacity(0.08))
      .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
    .buttonStyle(.plain)
  }
}

#Preview("Resume") {
  NavigationStack {
    ResumeSessionView(session: SparkMockData.resumeSession)
  }
  .preferredColorScheme(.dark)
}

#Preview("Quick practice") {
  NavigationStack {
    QuickPracticeSetupView(
      options: SparkMockData.sessionSizes, selectedOption: SparkMockData.sessionSizes.first)
  }
  .preferredColorScheme(.dark)
}

#Preview("Doc practice") {
  NavigationStack {
    DocPracticeView(document: SparkMockData.documents.first!)
  }
  .preferredColorScheme(.dark)
}

#Preview("Focus") {
  NavigationStack {
    FocusPracticeView(recommendation: SparkMockData.focusRecommendations.first!)
  }
  .preferredColorScheme(.dark)
}

#Preview("Timed paper") {
  NavigationStack {
    TimedPaperSetupView(paper: SparkMockData.timedPapers.first!)
  }
  .preferredColorScheme(.dark)
}

#Preview("Revisit") {
  NavigationStack {
    RevisitConceptView(concept: SparkMockData.concepts.first!)
  }
  .preferredColorScheme(.dark)
}

#Preview("Utilities") {
  NavigationStack {
    StudyStatsView()
  }
  .preferredColorScheme(.dark)
}
