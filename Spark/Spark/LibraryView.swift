import SwiftUI

struct LibraryView: View {
  @EnvironmentObject private var appState: AppState
  @Environment(\.dismiss) private var dismiss
  @Binding var quizSetupContext: QuizSetupContext?
  @State private var uploadToRename: Upload?
  @State private var uploadToDelete: Upload?
  @State private var draftTitle: String = ""

  var body: some View {
    VStack {
      if appState.uploads.isEmpty {
        emptyLibrary
      } else {
        List {
          Section {
            ForEach(appState.uploads) { upload in
              LibraryRow(upload: upload) {
                quizSetupContext = QuizSetupContext(
                  upload: upload, defaultScope: .thisUpload, allowScopeToggle: false,
                  mode: .standard, preferredSize: .ten)
              } onRename: {
                uploadToRename = upload
                draftTitle = upload.title
              } onDelete: {
                uploadToDelete = upload
              }
            }
            .listRowBackground(Color(uiColor: .systemBackground))
          }
        }
        .listStyle(.insetGrouped)
      }
    }
    .navigationTitle("Library")
    .navigationBarTitleDisplayMode(.inline)
    .toolbarRole(.editor)
    .sheet(item: $uploadToRename) { upload in
      RenameUploadSheet(title: $draftTitle, subject: upload.subject) { newTitle in
        appState.rename(upload: upload, to: newTitle)
      }
      .presentationDetents([.fraction(0.3)])
    }
    .alert(
      "Delete upload?",
      isPresented: Binding(
        get: {
          uploadToDelete != nil
        },
        set: { flag in
          if !flag {
            uploadToDelete = nil
          }
        })
    ) {
      Button("Delete", role: .destructive) {
        if let upload = uploadToDelete {
          appState.delete(upload: upload)
        }
        uploadToDelete = nil
      }
      Button("Cancel", role: .cancel) {
        uploadToDelete = nil
      }
    } message: {
      if let upload = uploadToDelete {
        Text("\(upload.title) will be removed.")
      }
    }
  }

  private var emptyLibrary: some View {
    VStack(spacing: 12) {
      Spacer()
      Image(systemName: "folder")
        .font(.system(size: 48, weight: .regular))
        .foregroundStyle(.secondary)
      Text("Uploads you add appear here.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
      Spacer()
    }
  }
}

private struct LibraryRow: View {
  let upload: Upload
  let onSelect: () -> Void
  let onRename: () -> Void
  let onDelete: () -> Void

  var body: some View {
    Button {
      onSelect()
    } label: {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(upload.title)
            .font(.body)
            .foregroundStyle(.primary)
          Spacer()
          Menu {
            Button("Rename", action: onRename)
            Button("Delete", role: .destructive, action: onDelete)
          } label: {
            Image(systemName: "ellipsis")
              .rotationEffect(.degrees(90))
              .foregroundStyle(.secondary)
              .padding(.trailing, 4)
          }
          .menuIndicator(.hidden)
        }
        HStack(spacing: 8) {
          Text(upload.subject.title)
            .font(.caption)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(upload.subject.accentColor.opacity(0.15))
            .clipShape(Capsule())
          Text("\(upload.itemCount) items")
            .font(.caption)
            .foregroundStyle(.secondary)
          Spacer()
          Text(relativeDate(for: upload.lastUsedAt))
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
      }
      .padding(.vertical, 8)
    }
    .buttonStyle(.plain)
  }

  private func relativeDate(for date: Date?) -> String {
    guard let date else {
      return "Never used"
    }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .short
    return formatter.localizedString(for: date, relativeTo: Date())
  }
}

private struct RenameUploadSheet: View {
  @Binding var title: String
  let subject: Subject
  let onCommit: (String) -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Capsule()
        .fill(Color.secondary.opacity(0.3))
        .frame(width: 40, height: 4)
        .padding(.top, 12)
      Text("Rename upload")
        .font(.headline)
      TextField("Title", text: $title)
        .textFieldStyle(.roundedBorder)
      Button {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
          return
        }
        onCommit(trimmed)
        dismiss()
      } label: {
        Text("Save")
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
  }
}

#Preview {
  LibraryPreview()
}

private struct LibraryPreview: View {
  @StateObject private var state = AppState()
  @State private var context: QuizSetupContext?

  var body: some View {
    NavigationStack {
      LibraryView(quizSetupContext: $context)
        .environmentObject(state)
    }
  }
}
