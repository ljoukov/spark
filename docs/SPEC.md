# Spark — Product & Architecture Specification (SwiftUI + SvelteKit)

## 0) Monorepo Layout & Tooling Assumptions

- `proto/` — Source of truth for Protocol Buffer definitions shared by client and server.
  - inside `proto/` run "npm run generate" ro ptoduce TypeScript and Swift protos.
  - TypeScript: alias `$proto` is configured to simplify importing.
  - Swift types via `swift-protobuf` into `Spark/proto`.
- `web/` — SvelteKit (latest) project deployed to Vercel. Hosts the public marketing pages _and_ API endpoints consumed by the iOS app.
  - UI theming + color tokens are documented in `web/docs/color-system.md`.
- API logic lives under `web/src/routes/api/*`.
- Web app lives under `web/src/routes/app`
- Admin dashboard lives under `web/src/routes/admin`
- `packages/schemas/` — shared Zod schemas + TypeScript types for Firestore docs (sessions, session state, user stats). Browser-safe and imported by both `web` and `eval` workspaces.
- Shared Firebase project (Auth, Firestore, Storage) configured via environment-specific `.env` files for SvelteKit and plist/xcconfig for the iOS app. Secrets flow through Vercel project environment variables and Xcode build settings.
- `Spark/` — Native iOS app written in SwiftUI. Targets iOS 17+, integrates with Firebase SDKs plus generated Swift Protobuf types.

## 1) Product Goals

- Spark is an effort comprising two apps:
  - Spark Quiz (GCSE Triple Science helper)
    - Help GCSE students learn from their own study materials by turning photos of notes, textbooks, and past papers into short quizzes and flashcards, then summarizing progress after each quiz.
    - Focus: GCSE Triple Science (Biology, Chemistry, Physics) across AQA, Edexcel, OCR. Provide fast feedback loops: immediate acknowledgement that generation started and continuous progress updates via Firestore.
  - Spark Code (British Informatics Olympiad prep)
    - Help students prepare for the British Informatics Olympiad (BIO) with coding practice sessions and problems delivered via the web app (e.g., under `/code`), with session progress persisted through SvelteKit APIs that proxy Firestore.

**Non-Goals**

- Teacher dashboards, offline generation, Combined/Double Award in v1, or general note management tooling.

## 2) Key Functional Requirements

- Inputs: JPEG/PNG photos (normalized to JPEG) and PDFs (full or page selection). Max 25 MB per upload; enforced client-side and server-side with 413 rejection.
- Metadata: `programme = gcse_triple_science`, optional `subject`, `board`, `topic`, `subtopic`. Server enriches or corrects metadata when confident; clients treat board/subject as optional choices.
- Generation modes:
  - **Extraction mode** when source already contains Q&A pairs — preserve wording verbatim.
  - **Synthesis mode** when notes only — produce mixed MCQ/TF/short/numeric questions (default N = 10, remote configurable).
- Question handling:
  - Numeric answers include units, tolerance, significant figures checks.
  - Free-text answers graded server-side with board-aligned rubric; MCQ/TF handled on device with key from Firestore.
- Progress & status: All long-running jobs acknowledged with `202 Accepted` and tracked in Firestore (`requests/{jobId}` + mirrored `client.events[jobId]`). Clients subscribe for live updates and handle TTL expiry.
- Validation: Every external payload validated with `zod` (SvelteKit backend) or Swift structs + generated Proto validation helpers. No `as any`; normalize error responses to structured JSON (or proto errors when binary route is used). Shared Firestore schemas live in `packages/schemas` so `web` and `eval` consume the same runtime validation.
- Internationalization not in scope for v1; all text in UK English.

## 3) Platform Architecture Overview

### API endpoint

`/api/spark` accepts SparkApiRequestProto and responds with SparkApiResponseProto, to simplify logging
additional CGI parameter "method" (eg ?method=create) is added to the url, there method name is
name of the oneof in `SparkApiRequestProto.request`.
`/api/internal/tasks` (POST only) is an internal task-runner hook that currently returns a placeholder `{ message: "hello" }` payload. Access requires a Bearer token that exactly matches the `TASKS_API_KEY` environment variable; all other methods or missing/incorrect tokens are rejected.

### 3.1 Data Flow

1. User captures/upload content in the SwiftUI app.
2. App serializes a Protocol Buffer `GenerateFromUploadRequest` and uploads file(s) to Firebase Storage (`/spark/<userId>/<timestamp>.jpg|pdf`).
3. App calls API endpoint (`POST /api/spark`) with binary proto payload referencing the upload.
4. API endpoint validates input, writes initial job document to Firestore, and kicks off LLM processing using the Vercel Edge Runtime `event.waitUntil()` hook so work continues even if the HTTP client disconnects.
5. Background generation reads source material, produces quiz content, and streams status into Firestore (`requests`, `client.events`, and quiz documents).
6. SwiftUI app listens to Firestore collection changes to display progress, new questions, summaries, and errors in real time.

### 3.2 Protocol Buffer Contract

- Core message families: `SparkApiRequest`, `SparkApiResponse`, `GenerateFromUploadRequest`, `CheckAnswerRequest`, `SummarizeRequest`, `JobStatusUpdate`, `Quiz`, `Question`, `FirestoreSyncEnvelope`.
- Versioning: embed `api_version` and `client_version` so server can reject incompatible clients gracefully.
- Binary transport (`Content-Type: application/octet-stream`) for performance; fallback REST+JSON only for marketing/diagnostics endpoints.

### 3.3 Cloud Services

- **Firebase Auth**: Apple Sign-In, email/password fallback. Tokens verified server-side by the Vercel Edge Runtime using the Admin SDK (running via `firebase-admin` configured for edge-compatible builds).

  Test/preview mode override: when environment variable `TEST_USER` is set to a valid test ID (format `test-(admin|free|paid)-[A-Za-z0-9]{16}`), authentication is fully disabled. The server does not validate ID tokens and forces the authenticated user ID to `TEST_USER`. The client does not rely on Firebase Auth in this mode; UI renders as signed-in with the server-provided user. Admin access in this mode follows the `test-admin-` prefix (admin allowed) vs other prefixes (admin denied). The user display name is read from `/spark/<TEST_USER>/name` in Firestore.
- **Firestore**: Single source of truth for job metadata, quiz content, attempts, summaries, and client events. Structured to minimize document sizes (<1 MB) and keep hot paths under 10 writes/sec per doc.
- **Firebase Storage**: Raw uploads stored short-term (7-day TTL) under `/spark/<uid>/...` with security rules enforcing ownership.

## 4) Backend (SvelteKit)

- Uses SvelteKit
- API routes implemented as server modules in `web/src/routes/api/*/+server.ts`.
- Request handling pipeline:
  1. Parse binary proto payload using generated TypeScript classes.
  2. Validate auth (Firebase ID token in headers) using Admin SDK instance warmed at module scope.
  3. Persist initial Firestore documents and enqueue background workflow by scheduling async functions with `event.waitUntil()` when running in the Edge Runtime.
  4. Return minimal proto response (`AckResponse` with `job_id`, `received_at`, optimistic status).
- Long-running operations (LLM generations, PDF parsing, summarization) run entirely inside the Edge Runtime `event.waitUntil` hook. The handler writes updates back to Firestore as discrete steps (`started`, `ingesting`, `generating`, `ready`...). If rate limits require, delegate to Cloud Tasks or other queueing primitives in later iterations.
- Firestore access uses REST RPC with service account JWT stored in Vercel environment secrets; ensure connection pooling via `fetch`. All writes batched to stay within limit.
- API surface (proto-based):
  - `SparkApiRequest.request = GenerateFromUploadRequest`
  - `SparkApiRequest.request = CheckAnswerRequest`
  - `SparkApiRequest.request = SummarizeRequest`
  - `SparkApiRequest.request = SyncRequest` (optional to bootstrap client caches)
- Non-proto HTTP endpoints (JSON) for marketing forms or health checks kept separate (`/api/health`, `/api/newsletter`).
- Logging & tracing: console logs captured via Vercel logging/observability; include `jobId`, `uid`, `latency_ms`, and `stage` fields.

## 5) iOS App (SwiftUI)

- Targets iOS 17+. App structure:
  - `SparkApp`: entry point managing Firebase initialization and dependency injection.
  - Feature modules: Capture, Library, Quiz Player, Progress.
  - Shared state via `Observable` view models backed by `@MainActor` classes; Firestore listeners managed by `AsyncStream` wrappers.
- Capture Flow:
  - Uses `PhotosPicker`/`AVFoundation` for image capture.
  - Compresses images to <12 MB headroom, stores local metadata, uploads to Firebase Storage with resumable uploads.
  - On submit, builds `GenerateFromUploadRequest` proto, calls API, and immediately creates speculative document in local state for optimistic UI.
- Quiz Experience:
  - Firestore listeners populate `Quiz` entities; view models map to SwiftUI views.
  - Free-text answers: send `CheckAnswerRequest` via API; update UI based on Firestore results.
  - Local pending jobs stored in memory with 60s TTL; reconciled against `client.events` on resume to avoid ghost states.
- Progress & Summaries:
  - Displays summary bullets from Firestore `summary/current` document.
  - Allows "Make more" actions that reuse the last metadata.
- Diagnostics: in-app developer screen (debug flag) showing raw job events, network logs, and proto decode status.

## 6) Web Frontend (SvelteKit)

- IMPORTANT: read the docs in web/docs/sveltekit-docs.md for SvelteKit, it significantly changed recently, eg runes
- IMPORTANT: read the docs in web/docs/shadcn-svelte.md to understand shadcn (UI Com ponents library)

- Landing page is minimal and not shadcn
- /app and /admin pages are build with shadcn and SvelteKit
- Public marketing site + lightweight authenticated portal for testing (e.g., shareable quizzes or onboarding instructions).
- Shared design system built with TailwindCSS (compiled for the Edge Runtime) or UnoCSS.
- Edge-friendly server load functions fetch Firestore user metadata for portal pages.
- Signed-in experiences live under `/(app)/(signed)` with a shared shell (user avatar menu, theme picker, Firebase auth sync) reused by `/spark` and `/code`.
- `/spark` greets the authenticated user by name as the hub landing page after sign-in, while `/code` continues to host the coding sessions UI. The Spark hub card includes a dotted “Upload” dropzone that accepts PDFs up to 25 MB; uploads flow through the SvelteKit API to Firebase Storage under `spark/uploads/{uid}/{sha}.pdf` and immediately register Firestore metadata at `spark/{uid}/uploads/{sha}` with a pending 20-question quiz run.
- `/welcome` accepts an optional `destination` query (`code` | `spark`). Without a destination it shows the dual-card picker (Spark Quiz → `/spark`, Spark Code → `/code`) after authentication; when present it deep-links to the requested experience post-login.
- `/logout` honours a `from` query (`code` | `spark`) and routes the “Back to welcome” action to `/welcome?destination=<from>` so learners land in the correct experience.
- Implements newsletter sign-up (Mailcoach/ConvertKit) via Vercel KV or third-party API.
- CSR avoided for marketing pages; islands used sparingly for forms.

## 7) Firestore Data Model

- `users/{uid}`: profile info, preferences, current programme, board (optional), subscriber flags.
- `spark/{uid}/uploads/{uploadId}`: metadata about raw assets (filename, storagePath, hash, contentType, sizeBytes, status, quizStatus, quizQuestionCount, uploadedAt, lastUpdatedAt, activeQuizId). Subcollection `quiz/{quizId}` records each generation attempt with `{ uploadId, status, requestedQuestionCount, definition?, failureReason?, createdAt, updatedAt }`, where `definition` reuses `QuizDefinitionSchema`. The active quiz run is referenced by `activeQuizId`.
- `requests/{jobId}`: canonical job record with type (`generate`, `check_answer`, `summarize`), status enum, timestamps, error field, payload hashes.
- `client/{uid}` document containing `events` map keyed by `jobId` (compact snapshots mirroring job status + minimal payload refs). TTL clean-up routine prunes old entries.
- `spark/{uid}` user doc: canonical profile plus `currentSessionId?: string` and `stats?: { xp, level, streakDays, solvedCount }`. Stats are read-only client side; server mutates during scoring flows.
- Quiz completion awards XP by question type (info cards +5, multiple-choice +10, type-answer +12) via the authenticated `/api/code/{sessionId}/update` endpoint with a `quizCompletion` payload. The handler increments `stats.solvedCount`, records idempotent progress under `spark/{uid}/progress`, and returns refreshed stats to the client.
- Copy convention: info-card eyebrow uses single-word labels from a small whitelist: `Idea`, `Concept`, `Insight`, `Rules`, `Tips`, `Facts`, `Shortcut` (default `Idea`). Avoid phrases like "Idea card".
- Quiz content (prompts, hints, explanations, info-card bodies, and choice labels) accepts lightweight Markdown authored in the schema. The SvelteKit loader renders it with `marked` (GFM enabled, soft line breaks) before hydrating the quiz components. When no Markdown is present the components fall back to the existing plain-text rendering, so data authors do not need to escape anything manually.
- `spark/{uid}/sessions/{sessionId}`: server-only session plans. Each document stores `{ id, title, createdAt: Timestamp, plan: PlanItem[] }` where `PlanItem` may be a quiz (`{ id, kind: 'quiz', title, summary?, icon?, meta? }`), problem (`{ id, kind: 'problem', title, summary?, icon?, meta?, difficulty?, topic? }`), or media clip (`{ id, kind: 'media', title, summary?, icon?, meta?, duration? }`). Session IDs are short human-readable slugs used in URLs. Only SvelteKit server routes read/write this collection; the client receives sessions through the authenticated layout load. Session-specific content lives in subcollections:
  - `quiz/{quizId}`: quiz definitions delivered to the `/code` experience. Shape follows `QuizDefinitionSchema` (id, title, optional metadata, and an ordered array of questions). Written by server tooling; client never writes or reads directly.
  - `code/{problemId}`: code problem metadata (slug, topics, markdown description, examples, test cases, stdin/stdout solution) scoped to the user and session. Mirrors the structure in `CodeProblemSchema` and is used by the problem detail page.
  - `media/{planItemId}`: narration clips with synced imagery. Documents follow `SessionMediaDocSchema` (`id`, `planItemId`, `sessionId`, `audio: { storagePath, mimeType?, durationSec }`, `images: Array<{ index, storagePath, startSec, durationSec }>` for the ten story panels, `narration: Array<{ text, startSec, durationSec, speaker? }>`, optional `posterImage`/`endingImage` stills (`{ storagePath }`), `metadataVersion` (current v3), timestamps). Audio files live in Firebase Storage at `spark/{userId}/sessions/{sessionId}/{planItemId}.mp3` and remain server-authored via the Admin SDK.
  - On a user's first visit to `/code`, if no sessions exist the server fetches available welcome templates from `spark-admin/templates/sessions`. Each template document provides `{ id, title, plan, tagline, emoji, topic, key? }` plus child collections for `quiz/`, `code/`, and `media/`. The modal lists the templates (sorted by title); picking one clones the template into `spark/{uid}/sessions/{sessionId}` with matching subcollections, copies any narration media into the user namespace, and updates `currentSessionId`.
- `spark/{uid}/state/{sessionId}`: session state document mirrored into SvelteKit responses. Shape `{ sessionId, items: Record<planItemId, { status: 'not_started' | 'in_progress' | 'completed', startedAt?, completedAt?, quiz?: { lastQuestionIndex?: number, serverCompletedAt?: Timestamp, questions: Record<questionId, { status: 'pending' | 'correct' | 'incorrect' | 'skipped', selectedOptionId?, typedValue?, hintUsed?, dontKnow?, firstViewedAt?, answeredAt? }> }, code?: { language: 'python', source: string, savedAt: Timestamp, lastRunStatus?: 'passed' | 'failed' | 'error', lastRunAt?: Timestamp } }>, lastUpdatedAt }`. Only the server reads/writes this collection; browser code receives the state through `load` functions and applies changes by POSTing to `/api/code/{sessionId}/update`, which validates via `@spark/schemas` before persisting.
- Quiz exit UX (web `/code`): clicking the "x" in the quiz progress rail shows the "Take a break?" dialog only when there are unanswered questions. The dialog offers `Keep practicing` and `Quit now`; choosing `Quit now` immediately routes back to `/code/{sessionId}` without issuing an additional session update, extra invalidation, or saving spinner, and the dialog stays open until navigation finishes to avoid flicker. If every question is already answered the exit control navigates straight to the session dashboard.
- Code dashboard CTA (web `/code/{sessionId}`): the plan footer button shows `Start` until any item advances, switches to `Continue` once progress exists, and softens into a completed state (`🎉 Finish`) when every step is finished. Keep the CTA copy short—omit plan titles inside the button—and let the visual styling reflect each state (primary gradient for active, subtle green pill when completed).
- Code editor autosave (web `/code/[sessionId]/p/[id]`): the learner's Python source mirrors into `state.items[planItemId].code`. Saves trigger when the user runs code, submits a solution, navigates away / closes the tab (via `keepalive` fetch), and on an edit throttle of ~10 s to avoid spamming Firestore.
- Problem submission flow: submit first re-runs every test. Submission is blocked until all tests pass, then a completion payload (including the latest code snapshot and run metadata) is sent to `/api/code/{sessionId}/update`. The handler grants XP once per problem based on difficulty, increments `stats.solvedCount`, records the event under `spark/{uid}/progress`, and the client shows a celebratory modal with XP earned plus an “OK” action that routes back to the `/code` dashboard.
- Media plan steps (intro/outro clips) route to `/code/{sessionId}/m/{planItemId}`. The page renders a timeline-synced player that relies on keyboard left/right navigation (no on-screen arrow controls), a large slide canvas that bleeds edge-to-edge (no frame padding, fixed 16:9), a fixed-height subtitle banner sized for up to two lines of the current caption (no speaker label), and a control bar with an icon-only play/pause control that flips to a replay icon once playback reaches the final 50ms window, plus the speaker toggle, timestamp, and progress scrubber. Slides reuse the non-question card styling; seeking via the keyboard shortcuts or slider also seeks the audio element. All slide images preload before playback or navigation becomes available, with a centered spinner shown in the card and the controls disabled until everything is ready. If any image fails to load we surface an inline error message in the card with a `Retry` button that re-attempts the preload. The server returns a short-lived signed URL derived from the Firebase Storage object to stream the MP3. While the clip is in progress a compact circular `×` button floats over the card header and opens the same gradient “Take a break?” dialog used in quizzes (copy tweaked for media, actions `Keep watching` / `Quit now`). After the clip finishes (or when the plan item was already marked complete) the same `×` routes straight back to `/code/{sessionId}` without surfacing the dialog, re-affirming completion as needed; there is no separate `Done` button. When present, the optional `posterImage` is shown at the very start for 50ms (no Ken Burns), and the optional `endingImage` is shown for the final 50ms; transitions into/out of these frames use the same image fade as other slides.
- `spark/{uid}/progress/{docId}`: server-managed bookkeeping for awarded milestones (quiz, code, or media completions). Docs store `{ sessionId, planItemId, xpAwarded, createdAt, quizId?, problemId?, difficulty?, language?, mediaId?, durationSec? }` so XP increments remain idempotent across retries.
- `summary/{uid}/current`: latest 2–3 bullet summary plus timestamp and underlying attempt refs.
- `quizzes/{quizId}`: quiz metadata; subcollection `questions/{questionId}` storing prompt, answer, explanation, type, rubric, board tagging.
- `attempts/{uid}/{attemptId}`: per question attempts with grading outcome, rubric reference, numeric tolerance info.
- Indexing: composite indexes on (`uid`, `status`, `updatedAt`) for requests, and (`uid`, `createdAt`) for quizzes/attempts.

## 8) Background Processing & WaitUntil Strategy

- Every API handler returns within <1s by pushing heavy work into `event.waitUntil(async () => { ... })`.
- Workflows encapsulated in pure async functions that:
  1. Fetch source materials from Firebase Storage (signed URL via Admin SDK).
  2. Run OCR/PDF parsing (Tesseract or Google Cloud Vision) and send prompts to LLM provider.
  3. Validate LLM outputs against schema (proto + zod) and board rules.
  4. Write incremental progress to Firestore so clients render streaming feedback.
  5. Finalize by writing quiz documents and updating `requests`/`client.events` to `ready` or `failed`.
- On failure, ensure error is written to Firestore and surfaced to client; WaitUntil promise resolves even when the client is offline.
- For high-latency tasks, consider chunking status updates to stay under Firestore write limits (e.g., throttle to 1 write / 2s per job).

## 9) LLM Guardrails & Prompting

- Extraction prompt: preserve original wording; label low-confidence items; ensure per-question metadata includes source page reference.
- Generation prompt: board + subject aware; include numeric tolerance, significant figures instructions; produce rationale snippet.
- Grading prompt: strict rubric enforcement; respond with canonical enum {correct, partial, incorrect}, required units, and 1-line rationale.
- Story image pipeline: as soon as the batch grader returns a `redo_batch`, we request prompt revisions on the first attempt and feed the reviser concrete evidence (grader findings, semantic alignment scores, and thumbnails). The prompt explicitly allows camera/focus changes while anchoring replacements to the narration lines surfaced via `frameNarrationByIndex`.
- Story prose pipeline: add a locked two-sentence Origins Capsule stage before drafting. Narrative prompts must weave the capsule into the opening half, stick to neutral naming (“now known as…”, “…and others”) and forbid exclusive “first/sole” claims, while limiting the story to one named figure. The ending must choose one of the hedged modern templates verbatim (“Today, related algorithms…”, “You’ll spot echoes…”, “This idea sits under the hood…”). The fact-check gate returns a normalized `blockers` object keyed by `{namingAttribution, exclusivityClaim, modernTieInOverclaim, datePrecision, wrongEntity}`, and the editor responds with a matching `fixChecklist` to confirm every blocker was cleared before publication.
- Summaries: produce ≤3 bullets covering strengths/gaps with topic references; limit to 160 chars each.
- Safety: run outputs through moderation filter; redact PII before storing. All prompts tracked with versioned ids.

## 10) Non-Functional Requirements

- Reliability: graceful degradation if LLM provider down — mark job failed with retry guidance. Retain idempotency via `client_request_id` embedded in proto messages.

## 11) Open Questions & Future Enhancements

- Do we need offline capture queue on iOS (store uploads locally until connectivity resumes)?
- Should we expose partial quiz previews while they are being generated? (Answer: definitely)
