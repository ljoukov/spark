import SwiftUI

enum SparkSubject: String, CaseIterable, Identifiable {
  case biology = "Biology"
  case chemistry = "Chemistry"
  case physics = "Physics"
  case triple = "Triple Science"

  var id: String { rawValue }

  var symbol: String {
    switch self {
    case .biology:
      return "leaf.fill"
    case .chemistry:
      return "flask.fill"
    case .physics:
      return "atom"
    case .triple:
      return "sparkle"
    }
  }

  var accent: Color {
    switch self {
    case .biology:
      return SparkPalette.accentTertiary
    case .chemistry:
      return SparkPalette.accentSecondary
    case .physics:
      return SparkPalette.accent
    case .triple:
      return SparkPalette.success
    }
  }
}

struct SparkResumeSession {
  let title: String
  let subtitle: String
  let progress: Double
  let completedQuestions: Int
  let totalQuestions: Int
  let timeSpentMinutes: Int
  let subject: SparkSubject
  let upcomingSpecCodes: [SparkSpecCode]
}

struct SparkSpecCode: Identifiable, Hashable {
  enum DifficultyTrend: String {
    case improving
    case steady
    case declining
  }

  let id = UUID()
  let code: String
  let topic: String
  let board: String
  let confidence: Double
  let trend: DifficultyTrend
}

struct SparkSessionSizeOption: Identifiable {
  let id = UUID()
  let questions: Int
  let estimatedMinutes: Int
  let isRecommended: Bool
  let timerMinutes: Int?
  let badge: String?
}

struct SparkDocumentPractice: Identifiable {
  enum Scope: String {
    case thisDoc = "This doc"
    case acrossDocs = "Cross-doc"
  }

  let id = UUID()
  let title: String
  let previewSnippet: String
  let itemCount: Int
  let lastPracticed: String
  let scopeOptions: [Scope]
  let weakCodes: [SparkSpecCode]
}

struct SparkFocusRecommendation: Identifiable {
  let id = UUID()
  let spec: SparkSpecCode
  let suggestedQuestions: Int
  let lastScore: Int
  let targetScore: Int
}

struct SparkTimedPaperTemplate: Identifiable {
  let id = UUID()
  let subject: SparkSubject
  let durationMinutes: Int
  let markWeighting: String
  let lastAttemptScore: String
  let recommendedTimer: Int
}

struct SparkConceptDrill: Identifiable {
  let id = UUID()
  let title: String
  let summary: String
  let subject: SparkSubject
  let lastOpened: String
  let estimatedMinutes: Int
  let isPinned: Bool
}

struct SparkSyllabusSnapshot: Identifiable {
  let id = UUID()
  let subject: SparkSubject
  let completed: Int
  let total: Int
  let suggestedSetTitle: String
  let suggestedCount: Int
}

struct SparkUtilityShortcut: Identifiable {
  enum ActionType {
    case streak
    case pinned
    case referral
    case export
  }

  let id = UUID()
  let title: String
  let subtitle: String
  let icon: String
  let action: ActionType
}

struct SparkStudyStats {
  let currentStreak: Int
  let bestStreak: Int
  let thisWeekMinutes: Int
  let averageSessionMinutes: Int
}

struct SparkReferralInfo {
  let code: String
  let rewardDescription: String
  let referralsCompleted: Int
}

enum SparkMockData {
  static let resumeSession = SparkResumeSession(
    title: "Mid-topic Boost",
    subtitle: "Continuation from yesterday's biology run",
    progress: 0.58,
    completedQuestions: 23,
    totalQuestions: 40,
    timeSpentMinutes: 28,
    subject: .biology,
    upcomingSpecCodes: [
      SparkSpecCode(
        code: "B5.3", topic: "Hormonal Control", board: "AQA", confidence: 0.42, trend: .improving),
      SparkSpecCode(
        code: "B6.2", topic: "Immunity & Vaccination", board: "Edexcel", confidence: 0.33,
        trend: .steady),
      SparkSpecCode(
        code: "B9.1", topic: "Respiration", board: "OCR", confidence: 0.51, trend: .declining),
    ]
  )

  static let sessionSizes: [SparkSessionSizeOption] = [
    .init(
      questions: 10, estimatedMinutes: 8, isRecommended: false, timerMinutes: 10, badge: "Warm-up"),
    .init(
      questions: 25, estimatedMinutes: 20, isRecommended: true, timerMinutes: 25, badge: "Focus"),
    .init(
      questions: 40, estimatedMinutes: 35, isRecommended: false, timerMinutes: 40, badge: "Extended"
    ),
    .init(
      questions: 60, estimatedMinutes: 55, isRecommended: false, timerMinutes: 60,
      badge: "Intensive"),
  ]

  static let documents: [SparkDocumentPractice] = [
    .init(
      title: "Cell Biology Revision Cards",
      previewSnippet: "Mitosis checkpoints, stem cells, differentiation pathways",
      itemCount: 64,
      lastPracticed: "2 days ago",
      scopeOptions: [.thisDoc, .acrossDocs],
      weakCodes: [
        SparkSpecCode(
          code: "B2.1", topic: "Cell Structure", board: "AQA", confidence: 0.44, trend: .steady),
        SparkSpecCode(
          code: "B2.3", topic: "Transport Across Membranes", board: "OCR", confidence: 0.38,
          trend: .declining),
      ]
    ),
    .init(
      title: "Energy Changes Worksheet",
      previewSnippet: "Bond enthalpies and practical write-ups",
      itemCount: 28,
      lastPracticed: "Yesterday",
      scopeOptions: [.thisDoc, .acrossDocs],
      weakCodes: [
        SparkSpecCode(
          code: "C4.4", topic: "Energy Transfer", board: "Edexcel", confidence: 0.52,
          trend: .improving)
      ]
    ),
    .init(
      title: "Forces & Motion Summary PDF",
      previewSnippet: "SUVAT, Newton's Laws, free-body diagrams",
      itemCount: 52,
      lastPracticed: "4 days ago",
      scopeOptions: [.thisDoc, .acrossDocs],
      weakCodes: [
        SparkSpecCode(
          code: "P8.2", topic: "Acceleration", board: "AQA", confidence: 0.41, trend: .declining),
        SparkSpecCode(
          code: "P7.3", topic: "Momentum", board: "OCR", confidence: 0.35, trend: .steady),
      ]
    ),
  ]

  static let focusRecommendations: [SparkFocusRecommendation] = [
    .init(
      spec: SparkSpecCode(
        code: "B10.4", topic: "The Brain", board: "AQA", confidence: 0.27, trend: .declining),
      suggestedQuestions: 8,
      lastScore: 5,
      targetScore: 8
    ),
    .init(
      spec: SparkSpecCode(
        code: "C6.2", topic: "Electrolysis", board: "Edexcel", confidence: 0.31, trend: .steady),
      suggestedQuestions: 6,
      lastScore: 6,
      targetScore: 9
    ),
    .init(
      spec: SparkSpecCode(
        code: "P11.1", topic: "Pressure & Gases", board: "OCR", confidence: 0.22, trend: .declining),
      suggestedQuestions: 5,
      lastScore: 4,
      targetScore: 8
    ),
  ]

  static let timedPapers: [SparkTimedPaperTemplate] = [
    .init(
      subject: .biology, durationMinutes: 90, markWeighting: "Paper 1 weighting 60%",
      lastAttemptScore: "78/100", recommendedTimer: 60),
    .init(
      subject: .chemistry, durationMinutes: 90, markWeighting: "Paper 2 weighting 40%",
      lastAttemptScore: "65/100", recommendedTimer: 55),
    .init(
      subject: .physics, durationMinutes: 90, markWeighting: "Paper 1 weighting 50%",
      lastAttemptScore: "82/100", recommendedTimer: 58),
  ]

  static let concepts: [SparkConceptDrill] = [
    .init(
      title: "Photosynthesis Limiting Factors", summary: "Quick graph interpretation drill",
      subject: .biology, lastOpened: "3 hours ago", estimatedMinutes: 6, isPinned: true),
    .init(
      title: "Le Chatelier Scenarios", summary: "Equilibrium shift reasoning", subject: .chemistry,
      lastOpened: "Yesterday", estimatedMinutes: 7, isPinned: true),
    .init(
      title: "Circuit Calculations Mix", summary: "V=IR, power, efficiency", subject: .physics,
      lastOpened: "5 days ago", estimatedMinutes: 5, isPinned: false),
  ]

  static let syllabusSnapshots: [SparkSyllabusSnapshot] = [
    .init(
      subject: .biology, completed: 42, total: 60, suggestedSetTitle: "Photosynthesis deep dive",
      suggestedCount: 12),
    .init(
      subject: .chemistry, completed: 36, total: 58, suggestedSetTitle: "Organic synthesis recap",
      suggestedCount: 10),
    .init(
      subject: .physics, completed: 44, total: 62, suggestedSetTitle: "Force interactions mix",
      suggestedCount: 14),
  ]

  static let utilities: [SparkUtilityShortcut] = [
    .init(
      title: "Streak & time", subtitle: "12-day streak · 164 min this week", icon: "flame.fill",
      action: .streak),
    .init(title: "Pinned concepts", subtitle: "4 shortcuts", icon: "pin.fill", action: .pinned),
    .init(
      title: "Refer a friend", subtitle: "Unlock 1 month premium", icon: "person.2.wave.2.fill",
      action: .referral),
    .init(
      title: "Export study receipt", subtitle: "Share revision log", icon: "square.and.arrow.up",
      action: .export),
  ]

  static let studyStats = SparkStudyStats(
    currentStreak: 12,
    bestStreak: 23,
    thisWeekMinutes: 164,
    averageSessionMinutes: 26
  )

  static let referralInfo = SparkReferralInfo(
    code: "SPARK-73F",
    rewardDescription: "Both of you unlock 30 days of Spark+",
    referralsCompleted: 3
  )
}
