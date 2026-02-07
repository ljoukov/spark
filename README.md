# Spark

Spark is an effort comprising two apps:

- Spark Quiz — a GCSE Triple Science helper. Students snap a photo or upload a PDF, Spark understands the content, and delivers short runs of tailored questions with confident guidance on what to do next. The goal is deliberate, calm practice without a "slot machine" feel. Both the SwiftUI app and the SvelteKit web surface share the same real-time backend so progress, summaries, and feedback stay in sync.
- Spark Code — coding practice to help prepare for the British Informatics Olympiad (BIO). Sessions of quiz and coding problems are delivered via the web app (e.g., under `/code`) with real-time progress syncing.

## App

[Spark (web)](https://spark.eviworld.com)

<img width="1139" height="667" alt="image" src="https://github.com/user-attachments/assets/9273d7ee-a8a5-4b17-810f-94c6cdf3e28c" />


## Spark Quiz — user experience at a glance
- **One-button start:** The home screen revolves around a single “Scan or Upload” button so students can jump directly into practice.
- **Smart capture pipeline:** Photos and PDFs are cropped, classified, and tagged with subject/board metadata automatically, with quick edits available when needed.
- **Tailored practice:** Spark generates ~10 minute quiz sets that respect the source material—MCQ, free-text, numeric, and diagram labelling all inherit GCSE mark-scheme cues.
- **Consistent practice player:** A focused player keeps interactions predictable with accessible input controls, hints on demand, and structured feedback (correct/partial/try again plus rationale).
- **Guided summaries:** After each set students receive accuracy, grade-band trend, and one suggested next action, with optional deep-dive into explanations.
- **Lightweight progress lens:** A single progress view lets students flip between subjects, timeline, and metrics without leaving the page.
- **Accessibility baked in:** High-contrast visuals, generous tap targets, inclusive language, and optional dark/reduced-motion modes keep the experience welcoming.

 

## Technical stack highlights
- **SwiftUI iOS app** targeting iOS 17+, using Firebase Auth/Firestore/Storage and generated Swift Protobuf models for realtime job tracking and quiz playback.
- **SvelteKit web app** deployed to Vercel, using server routes under `web/src/routes/api` to process Protocol Buffer requests in the Vercel Edge Runtime.
- **Shared Protocol Buffers** in [`proto/`](proto) drive typed contracts between client and server (transported as `application/octet-stream`).
- **Vercel Edge runtime** orchestrates long-running generation via `event.waitUntil`, streaming updates into Firestore.
- **Firebase data model** centralises uploads, requests, quizzes, attempts, and summaries with board/topic tagging and rate-aware writes.
- **Design system** built with shadcn-svelte components and Tailwind/UnoCSS for consistent marketing, app, and admin surfaces.

Dive deeper in the [Product & Architecture Specification](docs/SPEC.md).

## Monorepo layout
- [`Spark/`](Spark): SwiftUI app modules for capture, quiz, and progress flows.
- [`web/`](web): SvelteKit project for marketing pages, authenticated portal, and API endpoints.
- [`proto/`](proto): Source for protobuf contracts (`bun run generate` produces TypeScript and Swift bindings).
- [`data/`](data): Fixtures used during prototyping and testing.
- [`docs/`](docs): Living documentation, including [SPEC](docs/SPEC.md).
- [`spark-data/`](spark-data): Private submodule that stores licensed study materials. The contents remain empty in fresh clones unless you have credentials to access the private repository.

## Agent-guided development
Spark is actively maintained with a coding-agent workflow. The repository’s [agent playbook](AGENTS.md) captures expectations around specs, validation, and commit discipline. Contributors should review it alongside the [SPEC](docs/SPEC.md) document before shipping changes to keep human and agent collaborators aligned.

---

- Product & architecture source of truth: [docs/SPEC.md](docs/SPEC.md)
- Coding agent guidelines: [AGENTS.md](AGENTS.md)
