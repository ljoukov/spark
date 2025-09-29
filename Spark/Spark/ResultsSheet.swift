import SwiftUI

struct ResultsSheet: View {
  let result: QuizResult
  let onAction: (QuizFollowUp) -> Void

  private var focusSize: SessionSize {
    if result.wrongCount == 0 {
      return .ten
    }
    let suggested = max(10, min(result.wrongCount * 2, 25))
    if let match = SessionSize.allCases.first(where: { $0.rawValue >= suggested }) {
      return match
    }
    return .sixty
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text("Results")
        .font(.headline)
      scoreRow
      Divider()
      actionButtons
      Spacer()
      Button {
        onAction(.done)
      } label: {
        Text("Done")
          .font(.headline)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
      }
      .buttonStyle(.borderedProminent)
      .tint(.accentColor)
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 24)
    .presentationDragIndicator(.visible)
  }

  private var scoreRow: some View {
    HStack(alignment: .top) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Score")
          .font(.subheadline)
          .foregroundStyle(.secondary)
        Text("\(result.score)/\(result.total)")
          .font(.title2.weight(.bold))
      }
      Spacer()
      VStack(alignment: .leading, spacing: 4) {
        Text("Time")
          .font(.subheadline)
          .foregroundStyle(.secondary)
        Text(formatDuration(result.timeSpent))
          .font(.title3.weight(.semibold))
      }
      VStack(alignment: .leading, spacing: 4) {
        Text("Wrong")
          .font(.subheadline)
          .foregroundStyle(.secondary)
        Text("\(result.wrongCount)")
          .font(.title3.weight(.semibold))
      }
    }
  }

  private var actionButtons: some View {
    VStack(spacing: 12) {
      Button {
        onAction(.reviewMistakes)
      } label: {
        Text("Review mistakes")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.borderedProminent)
      .tint(.accentColor.opacity(0.7))

      Button {
        onAction(.focus(focusSize, result.session))
      } label: {
        Text("Do Focus \(focusSize.rawValue)")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.bordered)

      Button {
        onAction(.repeatSame(result.session))
      } label: {
        Text("Same again")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.bordered)

      Button {
        onAction(.newVariant(result.session))
      } label: {
        Text("New variant")
          .frame(maxWidth: .infinity)
          .padding(.vertical, 12)
      }
      .buttonStyle(.bordered)
    }
  }

  private func formatDuration(_ interval: TimeInterval) -> String {
    let minutes = Int(interval) / 60
    let seconds = Int(interval) % 60
    if minutes == 0 {
      return "\(seconds)s"
    }
    return "\(minutes)m \(seconds)s"
  }
}

#Preview {
  ResultsSheetPreview()
}

private struct ResultsSheetPreview: View {
  private let state = AppState()

  var body: some View {
    if let session = state.sessions.first {
      ResultsSheet(result: QuizResult(session: session, score: 18, total: session.size.rawValue, timeSpent: 420, wrongCount: 2)) { _ in
      }
    } else {
      ResultsSheet(result: QuizResult(session: Session(uploadId: nil, subject: .biology, size: .ten, completedCount: 10, status: .finished, startedAt: Date(), updatedAt: Date(), scope: .thisUpload, mode: .standard), score: 8, total: 10, timeSpent: 320, wrongCount: 2)) { _ in
      }
    }
  }
}
