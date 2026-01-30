# CheckMate iOS App — Agents Guide

- Scope: applies to the `CheckMate/**` subtree.
- Target platform: iOS 16+ only. Keep the deployment target aligned in `CheckMate.xcodeproj` and guard newer APIs with `@available` when needed.
- UI framework: SwiftUI. Prefer SwiftUI views and modifiers; avoid UIKit unless absolutely necessary.
- App entry point: `CheckMate/CheckMate/CheckMateApp.swift` with root view in `CheckMate/CheckMate/ContentView.swift`.
- Assets: add images/colors to `CheckMate/CheckMate/Assets.xcassets`.
- Tests: unit tests in `CheckMate/CheckMateTests`, UI tests in `CheckMate/CheckMateUITests`.
- Docs: if you change user-facing iOS UI/UX, also update `docs/SPEC.md` per repo guidance.
- Secrets: keep credentials in environment variables only; never commit secrets.
