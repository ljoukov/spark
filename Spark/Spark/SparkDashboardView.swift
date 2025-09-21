import SwiftUI

struct SparkDashboardView: View {
  private let data = SparkMockData.self

  var body: some View {
    NavigationStack {
      ZStack(alignment: .top) {
        SparkPalette.background
          .ignoresSafeArea()

        ScrollView {
          VStack(alignment: .leading, spacing: SparkStyle.verticalSpacing * 1.5) {
            header
            resumeSessionCard
            quickPracticeSection
            docBasedSection
            focusSection
            timedPaperSection
            revisitSection
            syllabusSection
            utilitiesSection
          }
          .padding(.horizontal, 20)
          .padding(.bottom, 40)
        }
      }
      .toolbar(.hidden, for: .navigationBar)
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      SparkTypography.caption(Text("\(SparkConstants.appName.uppercased())"))
      SparkTypography.heading(Text("Hello, Olivia"))
      SparkTypography.subtitle(Text(SparkConstants.slogan))
        .foregroundColor(SparkPalette.textSecondary)
    }
    .padding(.top, 24)
  }

  private var resumeSessionCard: some View {
    SparkGlassCard(gradient: SparkGradient.hero) {
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .center) {
          VStack(alignment: .leading, spacing: 6) {
            SparkTypography.title(Text("Resume session"))
            SparkTypography.caption(Text(data.resumeSession.subtitle))
          }

          Spacer()

          CircularProgressView(
            progress: data.resumeSession.progress,
            subject: data.resumeSession.subject
          )
          .frame(width: 68, height: 68)
        }

        VStack(alignment: .leading, spacing: 12) {
          progressBar
          infoGrid
        }

        NavigationLink(destination: ResumeSessionView(session: data.resumeSession)) {
          Label("Jump back in", systemImage: "play.fill")
            .font(.system(size: 16, weight: .semibold, design: .rounded))
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity)
            .background(SparkPalette.textPrimary.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }

  private var progressBar: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        SparkTypography.label(Text("Progress"))
        Spacer()
        SparkTypography.caption(
          Text(
            "\(data.resumeSession.completedQuestions)/\(data.resumeSession.totalQuestions) questions"
          )
        )
      }

      GeometryReader { geometry in
        Capsule()
          .fill(SparkPalette.textPrimary.opacity(0.12))
          .overlay(alignment: .leading) {
            Capsule()
              .fill(SparkPalette.textPrimary.opacity(0.9))
              .frame(width: geometry.size.width * data.resumeSession.progress)
          }
      }
      .frame(height: 10)
    }
  }

  private var infoGrid: some View {
    HStack(spacing: 12) {
      infoChip(title: "Time", value: "\(data.resumeSession.timeSpentMinutes) min")
      infoChip(title: "Spec", value: data.resumeSession.upcomingSpecCodes.first?.code ?? "")
      infoChip(title: "Board", value: data.resumeSession.upcomingSpecCodes.first?.board ?? "")
    }
  }

  private func infoChip(title: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      SparkTypography.caption(Text(title.uppercased()))
        .foregroundColor(SparkPalette.textSecondary)
      SparkTypography.label(Text(value))
        .foregroundColor(SparkPalette.textPrimary)
    }
    .padding(.vertical, 10)
    .padding(.horizontal, 12)
    .background(SparkPalette.textPrimary.opacity(0.08))
    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
  }

  private var quickPracticeSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(
        title: "Quick practice",
        destination: AnyView(QuickPracticeSetupView(options: data.sessionSizes)))

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 16) {
          ForEach(data.sessionSizes) { option in
            NavigationLink(
              destination: QuickPracticeSetupView(
                options: data.sessionSizes, selectedOption: option)
            ) {
              QuickPracticeCard(option: option)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 2)
      }
    }
  }

  private func sectionHeader(title: String, destination: AnyView? = nil) -> some View {
    HStack(alignment: .center) {
      SparkTypography.title(Text(title))
      Spacer()
      if let destination {
        NavigationLink(destination: destination) {
          Text("View all")
            .font(.system(size: 14, weight: .semibold, design: .rounded))
        }
        .buttonStyle(.plain)
      }
    }
  }

  private var docBasedSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(title: "Doc-based practice")
      VStack(spacing: 14) {
        ForEach(data.documents) { document in
          NavigationLink(destination: DocPracticeView(document: document)) {
            DocPracticeCard(document: document)
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private var focusSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(title: "Focus on weak codes")
      VStack(spacing: 14) {
        ForEach(data.focusRecommendations) { recommendation in
          NavigationLink(destination: FocusPracticeView(recommendation: recommendation)) {
            FocusRecommendationCard(recommendation: recommendation)
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private var timedPaperSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(title: "Timed paper mode")
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 16) {
          ForEach(data.timedPapers) { paper in
            NavigationLink(destination: TimedPaperSetupView(paper: paper)) {
              TimedPaperCard(template: paper)
            }
            .buttonStyle(.plain)
          }
        }
        .padding(.horizontal, 2)
      }
    }
  }

  private var revisitSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(title: "Revisit concepts")
      VStack(spacing: 14) {
        ForEach(data.concepts) { concept in
          NavigationLink(destination: RevisitConceptView(concept: concept)) {
            RevisitConceptCard(concept: concept)
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  private var syllabusSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(title: "Syllabus snapshot")
      VStack(spacing: 12) {
        ForEach(data.syllabusSnapshots) { snapshot in
          SyllabusSnapshotRow(snapshot: snapshot)
            .background(SparkPalette.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
              RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(SparkPalette.outline)
            )
        }
      }
    }
  }

  private var utilitiesSection: some View {
    VStack(alignment: .leading, spacing: 12) {
      sectionHeader(title: "Utilities")
      VStack(spacing: 12) {
        ForEach(data.utilities) { utility in
          NavigationLink {
            utilityDestination(for: utility)
          } label: {
            UtilityRow(utility: utility)
              .background(SparkPalette.surface)
              .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
              .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                  .stroke(SparkPalette.outline)
              )
          }
          .buttonStyle(.plain)
        }
      }
    }
  }

  @ViewBuilder
  private func utilityDestination(for utility: SparkUtilityShortcut) -> some View {
    switch utility.action {
    case .streak:
      StudyStatsView()
    case .pinned:
      PinnedConceptsView()
    case .referral:
      ReferralView()
    case .export:
      StudyReceiptView()
    }
  }
}

struct CircularProgressView: View {
  let progress: Double
  let subject: SparkSubject

  var body: some View {
    ZStack {
      Circle()
        .stroke(SparkPalette.textPrimary.opacity(0.2), lineWidth: 8)
      Circle()
        .trim(from: 0, to: progress)
        .stroke(subject.accent, style: StrokeStyle(lineWidth: 8, lineCap: .round))
        .rotationEffect(.degrees(-90))
      VStack(spacing: 4) {
        Text("\(Int(progress * 100))%")
          .font(.system(size: 16, weight: .semibold, design: .rounded))
        Image(systemName: subject.symbol)
          .font(.system(size: 14, weight: .medium))
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }
}

private struct QuickPracticeCard: View {
  let option: SparkSessionSizeOption

  var body: some View {
    SparkGlassCard(gradient: SparkGradient.glow) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .center) {
          SparkTypography.label(Text("\(option.questions) questions"))
          Spacer()
          if let badge = option.badge {
            BadgeView(
              text: badge,
              accent: option.isRecommended
                ? SparkPalette.accentSecondary : SparkPalette.textPrimary.opacity(0.5))
          }
        }

        SparkTypography.title(Text("~\(option.estimatedMinutes) min"))
        SparkTypography.caption(Text(option.isRecommended ? "Recommended" : "Choose size"))

        if let timer = option.timerMinutes {
          HStack(spacing: 8) {
            Image(systemName: "timer")
            Text("Timer preset: \(timer) min")
          }
          .font(.system(size: 13, weight: .medium, design: .rounded))
          .foregroundColor(SparkPalette.textSecondary)
        }
      }
      .foregroundStyle(SparkPalette.textPrimary)
      .frame(width: 200, alignment: .leading)
    }
  }
}

struct BadgeView: View {
  let text: String
  let accent: Color

  var body: some View {
    Text(text.uppercased())
      .font(.system(size: 11, weight: .bold, design: .rounded))
      .padding(.horizontal, 10)
      .padding(.vertical, 4)
      .background(accent.opacity(0.2))
      .foregroundColor(accent)
      .clipShape(Capsule())
  }
}

private struct DocPracticeCard: View {
  let document: SparkDocumentPractice

  var body: some View {
    SparkGlassCard {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .firstTextBaseline) {
          VStack(alignment: .leading, spacing: 6) {
            SparkTypography.label(Text(document.title))
            SparkTypography.caption(Text(document.previewSnippet))
          }
          Spacer()
          Chip(text: "\(document.itemCount) items")
        }

        HStack(spacing: 12) {
          Label(document.lastPracticed, systemImage: "clock")
            .labelStyle(.titleAndIcon)
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(SparkPalette.textSecondary)

          Spacer()

          ForEach(document.scopeOptions, id: \.rawValue) { scope in
            Chip(text: scope.rawValue)
          }
        }
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }
}

struct Chip: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.system(size: 12, weight: .semibold, design: .rounded))
      .foregroundStyle(SparkPalette.textSecondary)
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(SparkPalette.textPrimary.opacity(0.08))
      .clipShape(Capsule())
  }
}

private struct FocusRecommendationCard: View {
  let recommendation: SparkFocusRecommendation

  var body: some View {
    SparkGlassCard(gradient: SparkGradient.focus) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .center) {
          VStack(alignment: .leading, spacing: 6) {
            SparkTypography.label(Text("\(recommendation.spec.code)"))
            SparkTypography.caption(Text(recommendation.spec.topic))
          }
          Spacer()
          Chip(text: "\(recommendation.suggestedQuestions) Q")
        }

        HStack(spacing: 12) {
          TrendPill(trend: recommendation.spec.trend)
          ConfidenceMeter(confidence: recommendation.spec.confidence)
        }

        SparkTypography.caption(
          Text(
            "Last score: \(recommendation.lastScore)/10 → Target \(recommendation.targetScore)/10")
        )
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }
}

struct TrendPill: View {
  let trend: SparkSpecCode.DifficultyTrend

  var body: some View {
    let icon: String
    let text: String
    let color: Color

    switch trend {
    case .improving:
      icon = "arrow.up"
      text = "Improving"
      color = SparkPalette.success
    case .steady:
      icon = "equal"
      text = "Steady"
      color = SparkPalette.textSecondary
    case .declining:
      icon = "arrow.down"
      text = "Needs attention"
      color = SparkPalette.warning
    }

    return Label(text, systemImage: icon)
      .font(.system(size: 12, weight: .semibold, design: .rounded))
      .padding(.horizontal, 12)
      .padding(.vertical, 6)
      .background(color.opacity(0.18))
      .foregroundColor(color)
      .clipShape(Capsule())
  }
}

struct ConfidenceMeter: View {
  let confidence: Double

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      SparkTypography.caption(Text("Confidence"))
      ProgressView(value: confidence, total: 1)
        .tint(SparkPalette.textPrimary)
        .background(
          Capsule()
            .fill(SparkPalette.textPrimary.opacity(0.1))
        )
        .clipShape(Capsule())
      SparkTypography.caption(Text("\(Int(confidence * 100))%"))
    }
  }
}

private struct TimedPaperCard: View {
  let template: SparkTimedPaperTemplate

  var body: some View {
    SparkGlassCard(gradient: SparkGradient.timed) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .center) {
          SparkTypography.label(Text(template.subject.rawValue))
          Spacer()
          Image(systemName: template.subject.symbol)
            .font(.system(size: 18, weight: .medium))
        }

        SparkTypography.title(Text("\(template.durationMinutes) min"))
        SparkTypography.caption(Text(template.markWeighting))

        HStack(spacing: 8) {
          Image(systemName: "timer")
          Text("Recommended pace \(template.recommendedTimer) min")
        }
        .font(.system(size: 13, weight: .medium, design: .rounded))

        SparkTypography.caption(Text("Last paper: \(template.lastAttemptScore)"))
      }
      .foregroundStyle(SparkPalette.textPrimary)
      .frame(width: 220, alignment: .leading)
    }
  }
}

private struct RevisitConceptCard: View {
  let concept: SparkConceptDrill

  var body: some View {
    SparkGlassCard(gradient: SparkGradient.revisit) {
      VStack(alignment: .leading, spacing: 12) {
        HStack(alignment: .center) {
          SparkTypography.label(Text(concept.title))
          Spacer()
          if concept.isPinned {
            Image(systemName: "pin.fill")
              .foregroundStyle(SparkPalette.textPrimary.opacity(0.8))
          }
        }

        SparkTypography.caption(Text(concept.summary))

        HStack(spacing: 12) {
          Label(concept.lastOpened, systemImage: "clock")
          Label("\(concept.estimatedMinutes) min", systemImage: "bolt.fill")
        }
        .font(.system(size: 13, weight: .medium, design: .rounded))
        .foregroundStyle(SparkPalette.textPrimary.opacity(0.8))
      }
      .foregroundStyle(SparkPalette.textPrimary)
    }
  }
}

private struct SyllabusSnapshotRow: View {
  let snapshot: SparkSyllabusSnapshot

  var body: some View {
    HStack(spacing: 16) {
      Circle()
        .fill(snapshot.subject.accent.opacity(0.3))
        .frame(width: 54, height: 54)
        .overlay(
          Image(systemName: snapshot.subject.symbol)
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(snapshot.subject.accent)
        )

      VStack(alignment: .leading, spacing: 6) {
        SparkTypography.label(Text(snapshot.subject.rawValue))
        ProgressView(value: Double(snapshot.completed), total: Double(snapshot.total))
          .tint(snapshot.subject.accent)
        SparkTypography.caption(Text("\(snapshot.completed)/\(snapshot.total) spec points"))
      }

      Spacer()

      VStack(alignment: .trailing, spacing: 6) {
        SparkTypography.caption(Text("Next"))
        Text(snapshot.suggestedSetTitle)
          .font(.system(size: 13, weight: .semibold, design: .rounded))
        Chip(text: "\(snapshot.suggestedCount) Q")
      }
    }
    .padding(16)
    .foregroundStyle(SparkPalette.textPrimary)
  }
}

private struct UtilityRow: View {
  let utility: SparkUtilityShortcut

  var body: some View {
    HStack(spacing: 16) {
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(SparkPalette.textPrimary.opacity(0.08))
        .frame(width: 54, height: 54)
        .overlay(
          Image(systemName: utility.icon)
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(SparkPalette.textPrimary)
        )

      VStack(alignment: .leading, spacing: 6) {
        SparkTypography.label(Text(utility.title))
        SparkTypography.caption(Text(utility.subtitle))
      }

      Spacer()

      Image(systemName: "chevron.right")
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(SparkPalette.textSecondary)
    }
    .padding(16)
    .foregroundStyle(SparkPalette.textPrimary)
  }
}

#Preview {
  SparkDashboardView()
    .preferredColorScheme(.dark)
}
