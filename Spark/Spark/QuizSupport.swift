import Foundation
import SwiftUI

struct QuizSessionHandle: Identifiable {
  let id: UUID
}

struct QuizSetupContext: Identifiable {
  let id = UUID()
  let upload: Upload?
  let defaultScope: QuizScope
  let allowScopeToggle: Bool
  let mode: SessionMode
  let preferredSize: SessionSize
}

struct QuizResult: Identifiable {
  let id = UUID()
  let session: Session
  let score: Int
  let total: Int
  let timeSpent: TimeInterval
  let wrongCount: Int
}

enum QuizFollowUp: Identifiable, Equatable {
  case done
  case reviewMistakes
  case focus(SessionSize, Session)
  case repeatSame(Session)
  case newVariant(Session)

  var id: String {
    switch self {
    case .done:
      return "done"
    case .reviewMistakes:
      return "review"
    case .focus(_, let session):
      return "focus-\(session.id)"
    case .repeatSame(let session):
      return "repeat-\(session.id)"
    case .newVariant(let session):
      return "variant-\(session.id)"
    }
  }
}

enum QuizFlowAction {
  case exit(Session, SessionStatus)
  case resume
}
