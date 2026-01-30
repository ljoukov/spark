import Combine
import Foundation
import SwiftUI

enum Subject: String, CaseIterable, Identifiable {
  case biology
  case chemistry
  case physics

  var id: String {
    rawValue
  }

  var title: String {
    switch self {
    case .biology:
      return "Biology"
    case .chemistry:
      return "Chemistry"
    case .physics:
      return "Physics"
    }
  }

  var accentColor: Color {
    switch self {
    case .biology:
      return Color(red: 0.24, green: 0.64, blue: 0.42)
    case .chemistry:
      return Color(red: 0.94, green: 0.54, blue: 0.15)
    case .physics:
      return Color(red: 0.23, green: 0.42, blue: 0.87)
    }
  }
}

enum SessionSize: Int, CaseIterable, Identifiable {
  case ten = 10
  case twentyFive = 25
  case forty = 40
  case sixty = 60

  var id: Int {
    rawValue
  }

  var label: String {
    "\(rawValue)"
  }
}

enum QuizScope: String, Identifiable, CaseIterable {
  case thisUpload
  case allDocs

  var id: String {
    rawValue
  }

  var label: String {
    switch self {
    case .thisUpload:
      return "This upload"
    case .allDocs:
      return "All docs"
    }
  }
}

enum SessionMode: Identifiable, Equatable {
  case standard
  case focus(Int)
  case timed

  var id: String {
    switch self {
    case .standard:
      return "standard"
    case .focus:
      return "focus"
    case .timed:
      return "timed"
    }
  }

  var label: String {
    switch self {
    case .standard:
      return "Standard"
    case .focus(let size):
      return "Focus \(size)"
    case .timed:
      return "Timed paper"
    }
  }
}

enum SessionStatus {
  case active
  case finished
  case discarded
}

struct Upload: Identifiable, Hashable {
  let id: UUID
  var title: String
  var subject: Subject
  var itemCount: Int
  var createdAt: Date
  var lastUsedAt: Date?

  init(
    id: UUID = UUID(), title: String, subject: Subject, itemCount: Int, createdAt: Date = Date(),
    lastUsedAt: Date? = nil
  ) {
    self.id = id
    self.title = title
    self.subject = subject
    self.itemCount = itemCount
    self.createdAt = createdAt
    self.lastUsedAt = lastUsedAt
  }
}

struct Session: Identifiable, Equatable {
  let id: UUID
  let uploadId: UUID?
  let subject: Subject?
  let size: SessionSize
  var completedCount: Int
  var status: SessionStatus
  var startedAt: Date
  var updatedAt: Date
  var scope: QuizScope
  var mode: SessionMode

  var remaining: Int {
    max(size.rawValue - completedCount, 0)
  }

  var isComplete: Bool {
    status == .finished
  }

  init(
    id: UUID = UUID(), uploadId: UUID?, subject: Subject?, size: SessionSize,
    completedCount: Int = 0, status: SessionStatus = .active, startedAt: Date = Date(),
    updatedAt: Date = Date(), scope: QuizScope, mode: SessionMode = .standard
  ) {
    self.id = id
    self.uploadId = uploadId
    self.subject = subject
    self.size = size
    self.completedCount = completedCount
    self.status = status
    self.startedAt = startedAt
    self.updatedAt = updatedAt
    self.scope = scope
    self.mode = mode
  }
}

struct SubjectProgress {
  var overall: Double
  var subjectBreakdown: [Subject: Double]
}

struct PinnedConcept: Identifiable, Hashable {
  let id: UUID
  var code: String
  var title: String
  var subject: Subject

  init(id: UUID = UUID(), code: String, title: String, subject: Subject) {
    self.id = id
    self.code = code
    self.title = title
    self.subject = subject
  }
}

enum CreateSource: Identifiable {
  case camera
  case photo
  case file
  case paste

  var id: String {
    switch self {
    case .camera:
      return "camera"
    case .photo:
      return "photo"
    case .file:
      return "file"
    case .paste:
      return "paste"
    }
  }

  var title: String {
    switch self {
    case .camera:
      return "Camera"
    case .photo:
      return "Photo"
    case .file:
      return "File (PDF)"
    case .paste:
      return "Paste text"
    }
  }
}

final class AppState: ObservableObject {
  @Published private(set) var uploads: [Upload]
  @Published private(set) var sessions: [Session]
  @Published var streakDays: Int
  @Published var totalMinutes: Int
  @Published var pinnedConcepts: [PinnedConcept]

  init(uploads: [Upload] = [], sessions: [Session] = [], streakDays: Int = 0, totalMinutes: Int = 0)
  {
    if uploads.isEmpty {
      let now = Date()
      let sampleUploads: [Upload] = [
        Upload(
          title: "Cell structure notes", subject: .biology, itemCount: 36,
          createdAt: now.addingTimeInterval(-86_400 * 4),
          lastUsedAt: now.addingTimeInterval(-86_400)),
        Upload(
          title: "Organic chemistry prompts", subject: .chemistry, itemCount: 28,
          createdAt: now.addingTimeInterval(-86_400 * 8),
          lastUsedAt: now.addingTimeInterval(-86_400 * 5)),
        Upload(
          title: "Waves recap", subject: .physics, itemCount: 18,
          createdAt: now.addingTimeInterval(-86_400 * 11),
          lastUsedAt: now.addingTimeInterval(-86_400 * 3)),
      ]
      self.uploads = sampleUploads
      self.sessions = [
        Session(
          uploadId: sampleUploads.first?.id, subject: .biology, size: .twentyFive,
          completedCount: 17, status: .active, startedAt: now.addingTimeInterval(-3_600),
          updatedAt: now.addingTimeInterval(-600), scope: .thisUpload, mode: .standard),
        Session(
          uploadId: sampleUploads.first?.id, subject: .biology, size: .ten, completedCount: 10,
          status: .finished, startedAt: now.addingTimeInterval(-86_400 * 2),
          updatedAt: now.addingTimeInterval(-86_400 * 2 + 2_700), scope: .thisUpload,
          mode: .focus(10)),
        Session(
          uploadId: sampleUploads[1].id, subject: .chemistry, size: .forty, completedCount: 40,
          status: .finished, startedAt: now.addingTimeInterval(-86_400 * 6),
          updatedAt: now.addingTimeInterval(-86_400 * 6 + 5_400), scope: .allDocs, mode: .timed),
      ]
      self.streakDays = 5
      self.totalMinutes = 186
      self.pinnedConcepts = [
        PinnedConcept(code: "B2.3", title: "Cell division", subject: .biology),
        PinnedConcept(code: "C7.1", title: "Fractional distillation", subject: .chemistry),
        PinnedConcept(code: "P4.4", title: "Wave behaviour", subject: .physics),
      ]
    } else {
      self.uploads = uploads
      self.sessions = sessions
      self.streakDays = streakDays
      self.totalMinutes = totalMinutes
      self.pinnedConcepts = []
    }
  }

  var activeSession: Session? {
    sessions.first { $0.status == .active }
  }

  var lastCompletedSession: Session? {
    sessions.first { $0.status == .finished }
  }

  var latestUpload: Upload? {
    uploads.sorted { $0.createdAt > $1.createdAt }.first
  }

  func subjectProgress(for subject: Subject) -> Double {
    let totalAttempts = sessions.filter { $0.subject == subject }
    guard !totalAttempts.isEmpty else {
      return 0
    }
    let completed = totalAttempts.reduce(0) { partialResult, session in
      partialResult + min(session.completedCount, session.size.rawValue)
    }
    let total = totalAttempts.reduce(0) { partialResult, session in
      partialResult + session.size.rawValue
    }
    if total == 0 {
      return 0
    }
    return Double(completed) / Double(total)
  }

  func overallProgress() -> Double {
    guard !sessions.isEmpty else {
      return 0
    }
    let completed = sessions.reduce(0) { result, session in
      result + min(session.completedCount, session.size.rawValue)
    }
    let total = sessions.reduce(0) { result, session in
      result + session.size.rawValue
    }
    if total == 0 {
      return 0
    }
    return Double(completed) / Double(total)
  }

  func progressSnapshot() -> SubjectProgress {
    let breakdown = Dictionary(
      uniqueKeysWithValues: Subject.allCases.map { subject in
        (subject, subjectProgress(for: subject))
      })
    return SubjectProgress(overall: overallProgress(), subjectBreakdown: breakdown)
  }

  func createUpload(from source: CreateSource) -> Upload {
    let title: String
    switch source {
    case .camera:
      title = "New scan"
    case .photo:
      title = "Imported photo"
    case .file:
      title = "Imported PDF"
    case .paste:
      title = "Pasted text"
    }
    let subject = Subject.allCases.randomElement() ?? .biology
    let count = [18, 24, 32, 40].randomElement() ?? 24
    let upload = Upload(
      title: title, subject: subject, itemCount: count, createdAt: Date(), lastUsedAt: nil)
    uploads.insert(upload, at: 0)
    return upload
  }

  func rename(upload: Upload, to newTitle: String) {
    guard let index = uploads.firstIndex(of: upload) else {
      return
    }
    uploads[index].title = newTitle
  }

  func delete(upload: Upload) {
    uploads.removeAll { candidate in
      candidate.id == upload.id
    }
    sessions.removeAll { session in
      session.uploadId == upload.id
    }
  }

  func markUse(of upload: Upload) {
    guard let index = uploads.firstIndex(of: upload) else {
      return
    }
    uploads[index].lastUsedAt = Date()
  }

  @discardableResult
  func startSession(
    from upload: Upload?, size: SessionSize, scope: QuizScope, mode: SessionMode = .standard
  ) -> Session {
    let session = Session(
      uploadId: upload?.id, subject: upload?.subject, size: size, completedCount: 0,
      status: .active, startedAt: Date(), updatedAt: Date(), scope: scope, mode: mode)
    sessions.insert(session, at: 0)
    if let upload {
      markUse(of: upload)
    }
    return session
  }

  func update(session: Session) {
    guard let index = sessions.firstIndex(where: { $0.id == session.id }) else {
      return
    }
    sessions[index] = session
  }

  func finishSession(id: UUID, status: SessionStatus) {
    guard let index = sessions.firstIndex(where: { $0.id == id }) else {
      return
    }
    sessions[index].status = status
    sessions[index].updatedAt = Date()
  }

  func completeSession(id: UUID) {
    guard let index = sessions.firstIndex(where: { $0.id == id }) else {
      return
    }
    sessions[index].status = .finished
    sessions[index].completedCount = sessions[index].size.rawValue
    sessions[index].updatedAt = Date()
  }
}
