# Spark — Product & Architecture Specification (SwiftUI + SvelteKit)

IMPORTANT: detailsed UI flows is defined in `docs/FLOW.md` file.

## 0) Monorepo Layout & Tooling Assumptions

- `proto/` — Source of truth for Protocol Buffer definitions shared by client and server.
  - inside `proto/` run "npm run generate" ro ptoduce TypeScript and Swift protos.
  - TypeScript: alias `$proto` is configured to simplify importing.
  - Swift types via `swift-protobuf` into `Spark/proto`.
- `web/` — SvelteKit (latest) project deployed to Vercel. Hosts the public marketing pages _and_ API endpoints consumed by the iOS app.
- API logic lives under `web/src/routes/api/*`.
- Web app lives under `web/src/routes/app`
- Admin dashboard lives under `web/src/routes/admin`
- Shared Firebase project (Auth, Firestore, Storage) configured via environment-specific `.env` files for SvelteKit and plist/xcconfig for the iOS app. Secrets flow through Vercel project environment variables and Xcode build settings.
- `Spark/` — Native iOS app written in SwiftUI. Targets iOS 17+, integrates with Firebase SDKs plus generated Swift Protobuf types.

## 1) Product Goal

- Help GCSE students learn from their own study materials by turning photos of notes, textbooks, and past papers into short quizzes and flashcards, then summarizing progress after each quiz.
- Focus: GCSE Triple Science (Biology, Chemistry, Physics) across AQA, Edexcel, OCR. Provide fast feedback loops: immediate acknowledgement that generation started and continuous progress updates via Firestore.

**Non-Goals**

- Teacher dashboards, offline generation, Combined/Double Award in v1, or general note management tooling.

## 2) Key Functional Requirements

- Inputs: JPEG/PNG photos (normalized to JPEG) and PDFs (full or page selection). Max 15 MB per upload; enforced client-side and server-side with 413 rejection.
- Metadata: `programme = gcse_triple_science`, optional `subject`, `board`, `topic`, `subtopic`. Server enriches or corrects metadata when confident; clients treat board/subject as optional choices.
- Generation modes:
  - **Extraction mode** when source already contains Q&A pairs — preserve wording verbatim.
  - **Synthesis mode** when notes only — produce mixed MCQ/TF/short/numeric questions (default N = 10, remote configurable).
- Question handling:
  - Numeric answers include units, tolerance, significant figures checks.
  - Free-text answers graded server-side with board-aligned rubric; MCQ/TF handled on device with key from Firestore.
- Progress & status: All long-running jobs acknowledged with `202 Accepted` and tracked in Firestore (`requests/{jobId}` + mirrored `client.events[jobId]`). Clients subscribe for live updates and handle TTL expiry.
- Validation: Every external payload validated with `zod` (SvelteKit backend) or Swift structs + generated Proto validation helpers. No `as any`; normalize error responses to structured JSON (or proto errors when binary route is used).
- Internationalization not in scope for v1; all text in UK English.

## 3) Platform Architecture Overview

### API endpoint

`/api/spark` accepts SparkApiRequestProto and responds with SparkApiResponseProto, to simplify logging
additional CGI parameter "method" (eg ?method=create) is added to the url, there method name is
name of the oneof in `SparkApiRequestProto.request`.

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
- Implements newsletter sign-up (Mailcoach/ConvertKit) via Vercel KV or third-party API.
- CSR avoided for marketing pages; islands used sparingly for forms.

## 7) Firestore Data Model

- `users/{uid}`: profile info, preferences, current programme, board (optional), subscriber flags.
- `uploads/{uid}/{uploadId}`: metadata about raw assets (filename, storagePath, subject guess, status, createdAt, expiresAt).
- `requests/{jobId}`: canonical job record with type (`generate`, `check_answer`, `summarize`), status enum, timestamps, error field, payload hashes.
- `client/{uid}` document containing `events` map keyed by `jobId` (compact snapshots mirroring job status + minimal payload refs). TTL clean-up routine prunes old entries.
- `quizzes/{quizId}`: quiz metadata; subcollection `questions/{questionId}` storing prompt, answer, explanation, type, rubric, board tagging.
- `attempts/{uid}/{attemptId}`: per question attempts with grading outcome, rubric reference, numeric tolerance info.
- `summary/{uid}/current`: latest 2–3 bullet summary plus timestamp and underlying attempt refs.
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
- Summaries: produce ≤3 bullets covering strengths/gaps with topic references; limit to 160 chars each.
- Safety: run outputs through moderation filter; redact PII before storing. All prompts tracked with versioned ids.

## 10) Non-Functional Requirements

- Reliability: graceful degradation if LLM provider down — mark job failed with retry guidance. Retain idempotency via `client_request_id` embedded in proto messages.

## 11) Open Questions & Future Enhancements

- Do we need offline capture queue on iOS (store uploads locally until connectivity resumes)?
- Should we expose partial quiz previews while they are being generated? (Answer: definitely)
