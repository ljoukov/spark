# Spark — Product & Architecture Specification (SwiftUI + SvelteKit)

## 0) Monorepo Layout & Tooling Assumptions

- `proto/` — Protocol Buffer definitions for mobile APIs (CheckMate first).
  - Run `npm run generate` to emit TypeScript protos into `packages/proto/src/gen` and Swift protos into `CheckMate/proto`.
  - TypeScript: alias `$proto` points at `packages/proto/src`.
  - Swift types are generated via `swift-protobuf` and used by the iOS apps.
- `web/` — SvelteKit (latest) project deployed to Vercel. Hosts the public marketing pages _and_ API endpoints consumed by the iOS app.
  - UI theming + color tokens are documented in `web/docs/color-system.md`.
- API logic lives under `web/src/routes/api/*`.
- Web app routes live under `web/src/routes`.
- Admin dashboard lives under `web/src/routes/admin`
- `packages/schemas/` — shared Zod schemas + TypeScript types for Firestore docs (sessions, session state, user stats). Browser-safe and imported by both `web` and `eval` workspaces.
- Shared Firebase project (Auth, Firestore, Storage) configured via environment-specific `.env` files for SvelteKit and plist/xcconfig for the iOS app. Secrets flow through Vercel project environment variables and Xcode build settings.
- `Spark/` — Native iOS app written in SwiftUI. Targets iOS 17+, integrates with Firebase SDKs plus generated Swift Protobuf types.
- `CheckMate/` — Native iOS app written in SwiftUI. Targets iOS 16+, uses Firebase Auth + Firestore. The initial authentication screen includes standard Sign in with Apple plus a Google sign-in button with the standard Google "G" icon, and adapts to light/dark mode. The sign-in and signed-in surfaces adopt Liquid Glass styling on iOS 26+ using SwiftUI `glassEffect`, while iOS 16-25 fall back to Material-based blur treatments. After sign-in, the main surface is a two-page, full-screen horizontal pager: the left page is a vertically scrolling chat list (with a **New chat** button and first-line + date summaries) and the right page is the active chat view. Users can drag horizontally between the pages with snap-to-page behavior, while the inactive pane dims during the transition (light + dark mode). Each chat uses a `conversationId`; the chat view streams thinking + response text over Connect/protobuf while listening to Firestore for persisted history. Assistant responses (and any visible thinking text) render Markdown via the SparkMarkdown package (WKWebView + marked + marked-katex + highlight.js) to stay aligned with the web chat renderer. Requirements live in `docs/CHECK_MATE.md`.
- For long-lived local processes, prefer background execution with logs redirected to files; tmux is optional and not required.

### 0.1) Web UI Automation (Screenshot Template)

For quick UI verification, use the repo template script `scripts/web_screenshot_flow.py`. This script is only a **template**; the AI coding assistant should normally generate a JSON spec for each investigation that explicitly lists:

- Which buttons/links to click (exact labels or selectors).
- The exact **sequence** of those clicks.
- When to take screenshots (including “immediately after click” with short waits to catch spinners).

For repeatable flows we want to re-run, keep the spec under `screenshots/<flow>/flow.json` and commit it. For one-off investigations, place the spec outside the repo (e.g. `/tmp/spark-webflow.json`).

Example spec:

```json
{
  "url": "https://spark.eviworld.com/",
  "viewport": { "width": 1440, "height": 900 },
  "fullPage": true,
  "timeoutMs": 30000,
  "headless": true,
  "steps": [
    { "action": "waitFor", "selector": "text=LOGIN" },
    { "action": "screenshot", "path": "01-landing.jpg", "quality": 90 },
    { "action": "click", "selector": "text=LOGIN" },
    { "action": "screenshot", "path": "02-after-login-click.jpg", "afterMs": 100, "quality": 90 },
    { "action": "clickText", "text": "Continue with Google" },
    { "action": "screenshot", "path": "03-after-google-click.jpg", "afterMs": 100, "quality": 90 }
  ]
}
```

Run (outputs relative screenshots into the specified output dir):

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 scripts/web_screenshot_flow.py --spec /tmp/spark-webflow.json --out-dir screenshots/webflow
```

#### 0.1.1) Local Test User Login (Email/Password)

Local UI checks use a real Firebase user (no auth bypass). Configure the test user with a single env var and sign in via a dedicated email/password route.

Steps:

1) Add this to `web/.env.local`:

```
TEST_USER_EMAIL_ID_PASSWORD=you@example.com/firestoreUserId/your-password
```

If you need `/admin`, include the userId in `ADMIN_USER_IDS`.

2) Start the web dev server (HTTPS for Firebase Auth):

```
npm --prefix web run dev:https
```

3) Open the email login page and sign in using the credentials from `.env.local`:

```
https://localhost:8081/login-with-email
```

Useful entry points after sign-in:
- `/spark` (signed-in home), `/spark/code`, `/spark/code/lessons`
- `/admin` (requires the userId in `ADMIN_USER_IDS`)

Notes:
- Auth is fully enforced; Firestore rules have no test-user exceptions.
- The test user is a normal production user, so it is fast for verifying real Firestore behavior.
- HTTP dev for iOS still runs on `http://127.0.0.1:8080` via `npm --prefix web run dev`.

#### 0.1.2) Browser UI Checks and Screenshots

Manual checks:
- Keep the dev server running (see 0.1.1).
- Open the target route(s) in a browser and verify the UI state.
- Use the browser screenshot tool (full-page if needed) for quick evidence.

Automated screenshots (Playwright template):
- Create a JSON spec listing each click/wait and every screenshot. Store reusable flows under `screenshots/<flow>/flow.json` and commit them; otherwise use a temp spec outside the repo (e.g. `/tmp/spark-webflow.json`).
- Save repo screenshots under `screenshots/<flow>/` (not `.logs/`) and use `.jpg` with `quality: 90`.
- Use a consistent viewport and include an explicit wait after navigation or actions that trigger spinners.

Example run:

```
python3 -m pip install playwright
python3 -m playwright install chromium
python3 scripts/web_screenshot_flow.py --spec /tmp/spark-webflow.json --out-dir screenshots/webflow
```

Recommended defaults:
- Desktop: 1440x900, fullPage true
- Mobile: 390x844, fullPage true
- Screenshots should be taken right after the UI reaches the expected state (with a small `afterMs` wait if there is loading).

## 1) Product Goals

- Spark is an effort comprising two apps:
  - Spark Quiz (GCSE Triple Science helper)
    - Help GCSE students learn from their own study materials by turning photos of notes, textbooks, and past papers into short quizzes and flashcards, then summarizing progress after each quiz.
    - Focus: GCSE Triple Science (Biology, Chemistry, Physics) across AQA, Edexcel, OCR. Provide fast feedback loops: immediate acknowledgement that generation started and continuous progress updates via Firestore.
  - Spark Code (British Informatics Olympiad prep)
    - Help students prepare for the British Informatics Olympiad (BIO) with coding practice sessions and problems delivered via the web app (e.g., under `/spark/code`), with session progress persisted through SvelteKit APIs that proxy Firestore.
  - Spark AI Agent (web, Phase 1)
    - Logged-in web home at `/spark` is the Spark AI Agent chat experience.
    - The chat stream is a continuous list of messages (no section summaries/collapsed sections); the composer stays pinned at the bottom.
    - The UI mirrors ChatGPT: a centered conversation column, assistant replies render as clean text blocks, and user messages appear as right-aligned pill bubbles.
    - After the second assistant reply, the latest assistant response expands to a minimum height to keep breathing room above the composer without adding trailing spacer after the response.
    - The composer is sticky at the bottom with a rounded “Ask anything” input, leading attach button, and trailing send control.
    - Keyboard: desktop Enter submits (Shift+Enter inserts a new line); on mobile Enter inserts a new line and sending uses the send button.
    - Assistant output renders markdown via SparkMarkdown (including LaTeX + code blocks).
    - Code blocks render inside a framed container with a language label and copy button; user bubbles can expand to the same max width as assistant replies with a small left inset.
    - The attach menu (plus button) includes “Add photos & files” and, on mobile-capable devices, “Take photo”.
    - Attachments render as horizontally scrolling preview cards above the input field. Each card shows a spinner while uploading and a remove `×` once ready.
    - The send button is disabled until all uploads finish; while uploading it shows an inline spinner.
    - Streaming may include a short “thinking” preview while the assistant response is generated.
    - Conversations are stored in Firestore as a single append-only document per thread.
    - Phase 1 always routes user messages to the agent LLM and streams responses back to the client (no direct messaging yet).
    - The server downloads any attachments on the latest user message and submits them to the LLM as inline parts.

**Non-Goals**

- Teacher dashboards, offline generation, Combined/Double Award in v1, or general note management tooling.

## 2) Key Functional Requirements

- Inputs: JPG/PNG/WEBP images and PDFs. Max 25 MB per file (413 on server rejection), max 10 files per conversation, and 50 MB total per conversation (client + server enforced). Text is optional when attachments are present.
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

The protobuf API is reserved for the mobile app (future); the web app does not use protobufs yet. `/api/spark` is currently disabled in the web server while the /spark flow is being rebuilt.
Spark AI Agent uses a dedicated endpoint:

- `POST /api/spark/agent/messages` accepts `{ conversationId?, text?, attachments? }` and returns SSE (`text/event-stream`) for streaming assistant tokens.
- Non-streaming clients receive `202 Accepted` JSON with `{ conversationId, messageId }`.
- `POST /api/spark/agent/attachments` accepts multipart form data with `conversationId` + `file` and returns `{ attachment }`.
- Auth uses Firebase ID tokens (including email/password sign-in for local test-user flows).
additional CGI parameter "method" (eg ?method=create) is added to the url, there method name is
name of the oneof in `SparkApiRequestProto.request`.
`/api/internal/tasks` (POST only) is an internal task-runner hook for background work. Access requires a Bearer token that exactly matches the `TASKS_API_KEY` environment variable; all other methods or missing/incorrect tokens are rejected.

### CheckMate RPC endpoint (Connect protocol)

- Connect protocol over HTTP/1.1 served by SvelteKit routes.
- RPC path: `/api/cm/rpc/<Service>/<Method>` (for example `/api/cm/rpc/CheckMateService/Greet`).
- Auth: Firebase ID token in `Authorization: Bearer <idToken>`.
- RPCs: `CheckMateService.Greet(GreetRequestProto) -> GreetResponseProto`, `CheckMateService.ListChats(ListChatsRequestProto) -> ListChatsResponseProto`, and `CheckMateService.StreamChat(StreamChatRequestProto) -> stream StreamChatResponseProto`.
- `ListChats` returns chat summaries (conversation id, title, snippet, last message timestamp, status) from `/{userId}/client/checkmate_conversations/{conversationId}`.
- `StreamChat` accepts a `conversation_id` to identify chats. The server persists conversation docs under `/{userId}/client/checkmate_conversations/{conversationId}` and throttles Firestore updates to roughly once every 10 seconds when content changes. It also writes status transitions (`streaming`, `idle`, `error`) with server timestamps and emits status updates in the stream. Generation runs under `waitUntil()` so it can finish even if the client disconnects; clients stream via Connect and listen to Firestore for the canonical history.

Payload shape is validated server-side with Zod (in `@spark/llm`) using a discriminated union over `type`:

- `type = "generateQuiz"` with `generateQuiz: { userId: string; uploadId: string; quizId: string }`.
- `type = "runAgent"` with `runAgent: { userId: string; agentId: string; workspaceId: string }`.
- `type = "helloWorld"` with no additional payload. The handler logs `Hello World` for smoke testing and pipeline diagnostics.

During development, the server schedules work by POSTing directly to `TASKS_SERVICE_URL` (typically the same app’s `/api/internal/tasks`). In production the same binary schedules via Google Cloud Tasks:

- Env: `TASKS_SERVICE_URL` (full handler URL), `TASKS_API_KEY` (Bearer), optional `TASKS_QUEUE` (default `spark-tasks`).
- Location: `us-central1`.
- The Cloud Task `httpRequest` targets `TASKS_SERVICE_URL` with the Bearer token header and JSON body.

### Admin UI

- `/admin/tasks` exposes manual task triggers for operators. Controls include a "Run task" button that enqueues the `helloWorld` task (expects to see `Hello World` in the server logs) and a "Generate welcome session" form that accepts a topic string and queues `generateWelcomeSession` to publish a new template under `spark-admin/templates/sessions`.

### 3.1 Data Flow

1. User captures/upload content in the SwiftUI app (future flow; not used by the web app yet).
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

  Test user login: for local/preview testing, set `TEST_USER_EMAIL_ID_PASSWORD=email/userId/password`. This does **not** bypass Firebase Auth; it is only a reference for signing in via `/login-with-email`. Admin access is still controlled by `ADMIN_USER_IDS`, and Firestore rules have no test-user exceptions.
- **Firestore**: Single source of truth for job metadata, quiz content, attempts, summaries, and client events. Structured to minimize document sizes (<1 MB) and keep hot paths under 10 writes/sec per doc.
- **Firebase Storage**: Raw uploads stored short-term (7-day TTL) under `/spark/uploads/<uid>/<md5>` with security rules enforcing ownership. Metadata includes `chatIds` (JSON array of conversation IDs) and `firebaseStorageDownloadTokens`. The server derives the storage bucket automatically as `<projectId>.firebasestorage.app` from the Google service account; do not override via environment variables.

### 3.4 Spark AI Agent Firestore (Phase 1)

- Conversations live under `/{userId}/client/conversations/{conversationId}` (client-safe read path; server writes only).
- Each conversation document stores an append-only `messages` array (OpenAI Response-style with `content[]` parts).
- Conversation documents include `attachments[]` entries with `{ id, storagePath, contentType, filename?, downloadUrl?, sizeBytes, status, createdAt, updatedAt, messageId? }`, where status ∈ `uploading | attaching | attached | failed`.
- Streaming writes to Firestore are throttled to at most one update every 500 ms; the SSE stream is used for immediate UI updates.

### 3.5 Spark AI Agent Runs (Phase 2)

- Agent runs are stored under `users/{userId}/agents/{agentId}`.
  - Fields: `{ id, prompt, status, workspaceId, stop_requested?, createdAt, updatedAt, statesTimeline[], resultSummary?, error? }`.
  - `status` ∈ `created | executing | stopped | failed | done`.
  - `statesTimeline[]` entries contain `{ state, timestamp }`.
- Agent runs use a hosted web search tool during the LLM tool loop when available (e.g. OpenAI Responses `web_search` with external web access enabled).
- Stop: the `/spark/agents` UI can set `stop_requested = true`. While running, the server polls `stop_requested` every 10 seconds and stops the run by setting `status = "stopped"` (and returns success to Cloud Tasks so it won’t retry).
- Completion: the agent is expected to call the `done` tool once. If the tool loop ends with a final text response without calling `done`, the server writes the response to `agent-output.md` in the workspace, stores a truncated (≤ 1000 chars) version in `resultSummary`, and marks the run as `done`.
- Agent workspaces live under `users/{userId}/workspace/{workspaceId}/files/{fileId}`.
  - Each file doc stores `{ path, content, createdAt, updatedAt, sizeBytes?, contentType? }`.
  - Workspace file updates are throttled to ≤ 1 write per 10 seconds per file doc.

- Agent run logs live under `users/{userId}/agents/{agentId}/logs/log` (single doc).
  - Log lines are stored in a map field `lines`, keyed by an epoch-ms timestamp key (`t<ms>_<seq>`), with values as the printed log line text.
  - Updates use partial/merge semantics so individual lines can be appended without rewriting the entire doc.
  - Log updates are throttled to ≤ 1 write per 10 seconds per agent log doc.
  - The log doc also stores `stats` snapshots including:
    - LLM token totals and estimated cost (USD)
    - Tool call counts (total + per-tool)

## 4) Backend (SvelteKit)

- Uses SvelteKit
- API routes implemented as server modules in `web/src/routes/api/*/+server.ts`.
- Request handling pipeline (proto endpoints are future/mobile-only; web routes use JSON today):
  1. (Proto) Parse binary proto payload using generated TypeScript classes.
  2. Validate auth (Firebase ID token in headers) using Admin SDK instance warmed at module scope.
  3. Persist initial Firestore documents and enqueue background workflow by scheduling async functions with `event.waitUntil()` when running in the Edge Runtime.
  4. (Proto) Return minimal proto response (`AckResponse` with `job_id`, `received_at`, optimistic status).
- Long-running operations (LLM generations, PDF parsing, summarization) run entirely inside the Edge Runtime `event.waitUntil` hook. The handler writes updates back to Firestore as discrete steps (`started`, `ingesting`, `generating`, `ready`...). If rate limits require, delegate to Cloud Tasks or other queueing primitives in later iterations.
- Firestore access uses REST RPC with service account JWT stored in Vercel environment secrets; ensure connection pooling via `fetch`. All writes batched to stay within limit.
- API surface (proto-based, future/mobile-only):
  - `SparkApiRequest.request = GenerateFromUploadRequest`
  - `SparkApiRequest.request = CheckAnswerRequest`
  - `SparkApiRequest.request = SummarizeRequest`
  - `SparkApiRequest.request = SyncRequest` (optional to bootstrap client caches)
- Web app uses JSON endpoints under `/api/*`; non-proto marketing endpoints remain separate (`/api/health`, `/api/newsletter`).
- `POST /api/spark/agents` creates a new Spark Agent run, persists the agent doc, assigns a workspace, and schedules the `runAgent` task.
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
- Svelte 5 gotcha: do not capture reactive `data` (from `$props`) in top-level initializers. Use `$derived`, `$effect`, or lazy functions (e.g. for context) so values update and avoid `state_referenced_locally`.

- Landing page (`/`) is a logged-out home/marketing hero with the preview video and a visible `LOGIN` CTA; clicking it navigates to `/login`. If the server detects an authenticated session it redirects straight to `/spark` (no `destination` query, no guest mode).
- `/login` renders the sign-in dialog (Google auth) and redirects to `/spark` on success.
- Web app pages (including `/spark` and `/admin`) are built with shadcn and SvelteKit.
- The main web app experience (landing, auth, and signed-in pages) lives under the `(app)` layout group so that `/admin` does not inherit app-only client effects.
- Public marketing site + lightweight authenticated portal for testing (e.g., shareable quizzes or onboarding instructions).
- Shared design system built with TailwindCSS (compiled for the Edge Runtime) or UnoCSS.
- Edge-friendly server load functions fetch Firestore user metadata for portal pages.
- Signed-in experiences live under `/(app)/(signed)` with a shared shell (user avatar menu, theme picker, Firebase auth sync) reused by `/spark` and `/spark/code`.
- `/spark` is the signed-in home with cards linking to `/spark/code` and `/spark/code/lessons`.
- `/spark/agents` lists running/completed agent runs, lets users create a new agent prompt, and shows the selected agent status plus workspace files (Markdown files render with the markdown renderer).
- `/spark/code` hosts the Spark Code experience (quizzes, problems, media steps).
- `/logout` signs out and returns to `/`.
- Implements newsletter sign-up (Mailcoach/ConvertKit) via Vercel KV or third-party API.
- CSR avoided for marketing pages; islands used sparingly for forms.

## 7) Firestore Data Model

- `users/{uid}`: profile info, preferences, current programme, board (optional), subscriber flags.
- Spark Chat UI is currently removed from the web app; channel/message collections are reserved for future reuse.
- `spark/{uid}/channels/{channelId}`: Spark Chat channels scoped to a single user (current default scope).
  - Fields: `{ title: string, scope: 'private', createdAt: Timestamp, updatedAt: Timestamp, lastMessageAt?: Timestamp }`.
  - Default channel id: `home` (title “New chat”).
  - Future family/shared channels will live under `spark-families/{familyId}/channels/{channelId}` with `scope: 'family'`.
- `spark/{uid}/channels/{channelId}/messages/{messageId}`: chat messages for a channel.
  - Fields: `{ text: string, authorId: string, authorName?: string, role: 'user' | 'assistant', createdAt: Timestamp }`.
- `spark/{uid}/uploads/{uploadId}`: metadata about raw assets (filename, storagePath, hash, contentType, sizeBytes, status, quizStatus, quizQuestionCount, uploadedAt, lastUpdatedAt, activeQuizId). Subcollection `quiz/{quizId}` records each generation attempt with `{ uploadId, status, requestedQuestionCount, definition?, failureReason?, createdAt, updatedAt }`, where `definition` reuses `QuizDefinitionSchema`. The active quiz run is referenced by `activeQuizId`.
- `requests/{jobId}`: canonical job record with type (`generate`, `check_answer`, `summarize`), status enum, timestamps, error field, payload hashes.
- `client/{uid}` document containing `events` map keyed by `jobId` (compact snapshots mirroring job status + minimal payload refs). TTL clean-up routine prunes old entries.
- `spark/{uid}` user doc: canonical profile plus `currentSessionId?: string` and `stats?: { xp, level, streakDays, solvedCount }`. Stats are read-only client side; server mutates during scoring flows.
- Quiz completion awards XP by question type (info cards +5, multiple-choice +10, type-answer +12) via the authenticated `/api/code/{sessionId}/update` endpoint with a `quizCompletion` payload. The handler increments `stats.solvedCount`, records idempotent progress under `spark/{uid}/progress`, and returns refreshed stats to the client.
- Copy convention: info-card eyebrow uses single-word labels from a small whitelist: `Idea`, `Concept`, `Insight`, `Rules`, `Tips`, `Facts`, `Shortcut` (default `Idea`). Avoid phrases like "Idea card".
- Quiz content (prompts, hints, multiple-choice explanations, info-card bodies, and choice labels) accepts lightweight Markdown authored in the schema. Type-answer questions do **not** store explanations; their feedback is produced by the grader. The SvelteKit loader renders Markdown with `marked` (GFM enabled, soft line breaks) plus the KaTeX extension so `$...$` / `$$...$$` formulas display inline or block-level before hydrating the quiz components. When no Markdown is present the components fall back to the existing plain-text rendering, so data authors do not need to escape anything manually.
- `spark/{uid}/sessions/{sessionId}`: server-only session plans. Each document stores `{ id, title, summary?, tagline?, emoji?, createdAt: Timestamp, status?: 'generating' | 'ready' | 'in_progress' | 'completed' | 'error', topics?: string[], sourceSessionId?, sourceProposalId?, nextLessonProposals?: Array<{ id, title, tagline, topics: string[], emoji }>, nextLessonProposalsGeneratedAt?: Timestamp, plan: PlanItem[] }` where `PlanItem` may be a quiz (`{ id, kind: 'quiz', title, summary?, icon?, meta? }`), problem (`{ id, kind: 'problem', title, summary?, icon?, meta?, difficulty?, topic? }`), or media clip (`{ id, kind: 'media', title, summary?, icon?, meta?, duration? }`). Session IDs are short human-readable slugs used in URLs. Only SvelteKit server routes read/write this collection; the client receives sessions through the authenticated layout load. Session-specific content lives in subcollections:
  - `quiz/{quizId}`: quiz definitions delivered to the `/spark/code` experience. Shape follows `QuizDefinitionSchema` (id, title, optional metadata, gradingPrompt, and an ordered array of questions). Type-answer questions include `marks` + `markScheme` for server grading. Written by server tooling; client never writes or reads directly.
  - `code/{problemId}`: code problem metadata (slug, topics, markdown description, examples, test cases, stdin/stdout solution) scoped to the user and session. Mirrors the structure in `CodeProblemSchema` and is used by the problem detail page.
- `media/{planItemId}`: narration clips with synced imagery. Documents follow `SessionMediaDocSchema` (`id`, `planItemId`, `sessionId`, `audio: { storagePath, mimeType?, durationSec }`, `images: Array<{ index, storagePath, startSec, durationSec }>` for the story panels (default 10, configurable), `narration: Array<{ text, startSec, durationSec, speaker? }>`, optional `posterImage`/`endingImage` stills (`{ storagePath }`), `metadataVersion` (current v3), timestamps). Audio files live in Firebase Storage at `spark/{userId}/sessions/{sessionId}/{planItemId}.mp3` and remain server-authored via the Admin SDK.
- On a user's first visit to `/spark/code`, if no sessions exist the server fetches available welcome templates from `spark-admin/templates/sessions`. Each template document provides `{ id, title, summary?, plan, tagline, emoji, topic, key? }` plus child collections for `quiz/`, `code/`, and `media/`. The `/spark/code` welcome screen lists the templates as lesson cards (poster image or emoji, two-line-clamped tagline, and a “Launch” CTA); picking one clones the template into `spark/{uid}/sessions/{sessionId}` with matching subcollections, copies any narration media into the user namespace, and updates `currentSessionId`.
- `spark/{uid}/state/{sessionId}`: session state document mirrored into SvelteKit responses. Shape `{ sessionId, items: Record<planItemId, { status: 'not_started' | 'in_progress' | 'completed', startedAt?, completedAt?, quiz?: { lastQuestionIndex?: number, serverCompletedAt?: Timestamp, questions: Record<questionId, { status: 'pending' | 'correct' | 'incorrect' | 'skipped', selectedOptionId?, typedValue?, hintUsed?, dontKnow?, firstViewedAt?, answeredAt?, grade?: { awardedMarks, maxMarks, feedback, heading?, tone? } }> }, code?: { language: 'python', source: string, savedAt: Timestamp, lastRunStatus?: 'passed' | 'failed' | 'error', lastRunAt?: Timestamp } }>, lastUpdatedAt }`. `feedback` stores Markdown only; HTML is derived at render time and never persisted. Only the server reads/writes this collection; browser code receives the state through `load` functions and applies changes by POSTing to `/api/code/{sessionId}/update`, which validates via `@spark/schemas` before persisting.
- Loading feedback (web `/spark/code`): any user action that triggers a server round-trip must surface a visible loading cue. Prefer subtle inline spinners on the action target (timeline rows, dialog buttons) for quick navigations; reserve full-screen or modal overlays for major page transitions (opening a lesson from `/spark/code/lessons`, generating new lesson flows) so learners feel the weight of the transition without unnecessary friction. Free-text grading shows a spinner inside the quiz Submit button with “Submitting…” then “Grading…” once the stream starts; network errors swap the button label to “Network error, retry.”
- Free-text answer UI (web `/spark/code`): starts as a single-line textarea that auto-expands up to 7 lines (then scrolls), with a 1,000 character cap. Grader feedback renders as a single Markdown block; the UI does not inject a separate “correct answer” panel. Grading streams via SSE: thinking tokens render in a fixed-height 4-line box and are cleared once the final answer arrives.
- Quiz exit UX (web `/spark/code`): clicking the "x" in the quiz progress rail shows the "Take a break?" dialog only when there are unanswered questions. The dialog offers `Keep practicing` and `Quit now`; choosing `Quit now` shows an inline spinner on the quit button while the server completes the route back to `/spark/code/{sessionId}` and the dialog stays open until navigation finishes to avoid flicker. If every question is already answered the exit control navigates straight to the session dashboard.
- Code dashboard CTA (web `/spark/code/{sessionId}`): the plan footer button shows `Start` until any item advances, switches to `Continue` once progress exists, and softens into a completed state (`🎉 Finish`) when every step is finished. When finished, the CTA opens the next-lesson dialog instead of routing; the dialog shows a spinner (“Deciding on your next sessions…”) while the server drafts three proposals with Gemini 3 Pro, caches them under `sessions/{sessionId}.nextLessonProposals`, and reuses them on reopen. Each proposal carries `{ title, tagline, topics, emoji }`; picking one enqueues `createTask({ type: 'generateLesson' })`, seeds a `status='generating'` session stub, switches `currentSessionId`, and routes to that session. Sessions in `status='generating'` render the “Generating...” view with a link to `/spark/code/lessons` rather than the plan timeline.
- Lessons list (web `/spark/code/lessons`): mirrors the `/spark/code` shell with a single panel that lists all lessons newest-first, showing emoji, title/tagline, creation date, derived status (`generating` | `ready` | `in_progress` | `completed` | `error`), and simple step progress; each row links to `/spark/code/{sessionId}`. The user menu includes a `Lessons` entry for quick access. The page also shows all welcome templates with a “Start lesson” action that posts to `/spark/code/lessons?/start`; submitting clones the template into the user’s sessions (same flow as first-time welcome) and redirects to the new `/spark/code/{sessionId}` even when other sessions already exist.
- Plan header (web `/spark/code/{sessionId}`) displays the session-level summary when available, falling back to the tagline and then the first plan item; individual plan item summaries remain short (<= 15 words) for the timeline rows.
- Code editor autosave (web `/spark/code/[sessionId]/p/[id]`): the learner's Python source mirrors into `state.items[planItemId].code`. Saves trigger when the user runs code, submits a solution, navigates away / closes the tab (via `keepalive` fetch), and on an edit throttle of ~10 s to avoid spamming Firestore.
- Problem submission flow: submit first re-runs every test. Submission is blocked until all tests pass, then a completion payload (including the latest code snapshot and run metadata) is sent to `/api/code/{sessionId}/update`. The handler grants XP once per problem based on difficulty, increments `stats.solvedCount`, records the event under `spark/{uid}/progress`, and the client shows a celebratory modal with XP earned plus an “OK” action that routes back to the `/spark/code` dashboard.
- Media plan steps (intro/outro clips) route to `/spark/code/{sessionId}/m/{planItemId}`. The page renders a timeline-synced player that relies on keyboard left/right navigation (no on-screen arrow controls), a large slide canvas that bleeds edge-to-edge (no frame padding, fixed 16:9), a fixed-height subtitle banner sized for up to two lines of the current caption (no speaker label), and a control bar with an icon-only play/pause control that flips to a replay icon once playback reaches the final 50ms window, plus the speaker toggle, timestamp, and progress scrubber. Slides reuse the non-question card styling; seeking via the keyboard shortcuts or slider also seeks the audio element. All slide images preload before playback or navigation becomes available, with a centered spinner shown in the card and the controls disabled until everything is ready. If any image fails to load we surface an inline error message in the card with a `Retry` button that re-attempts the preload. The server returns a short-lived signed URL derived from the Firebase Storage object to stream the MP3. While the clip is in progress a compact circular `×` button floats over the card header and opens the same gradient “Take a break?” dialog used in quizzes (copy tweaked for media, actions `Keep watching` / `Quit now`). After the clip finishes (or when the plan item was already marked complete) the same `×` routes straight back to `/spark/code/{sessionId}` without surfacing the dialog, re-affirming completion as needed; there is no separate `Done` button. When present, the optional `posterImage` is shown at the very start for 50ms (no Ken Burns), and the optional `endingImage` is shown for the final 50ms; transitions into/out of these frames use the same image fade as other slides.
- `spark/{uid}/progress/{docId}`: server-managed bookkeeping for awarded milestones (quiz, code, or media completions). Docs store `{ sessionId, planItemId, xpAwarded, createdAt, quizId?, problemId?, difficulty?, language?, mediaId?, durationSec? }` so XP increments remain idempotent across retries.
- `summary/{uid}/current`: latest 2–3 bullet summary plus timestamp and underlying attempt refs.
- `quizzes/{quizId}`: quiz metadata; subcollection `questions/{questionId}` storing prompt, answer, type, mark scheme/rubric, board tagging, plus explanations only for multiple-choice questions.
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

- LLM providers: Gemini (Vertex AI) and OpenAI (Responses API). The shared wrapper defaults OpenAI calls to `gpt-5.2` with `reasoning: { effort: "xhigh" }` when an OpenAI model is selected. Free-text grading uses `gemini-flash-latest`.
- Extraction prompt: preserve original wording; label low-confidence items; ensure per-question metadata includes source page reference.
- Generation prompt: board + subject aware; include numeric tolerance, significant figures instructions; produce rationale snippet.
- Grading prompt: strict rubric enforcement with partial credit; return plain text with `%AWARDED_MARKS%: X`, `%MAX_MARKS%: Y`, and `%FEEDBACK%:` followed by Markdown that includes sections (a) grade + reasoning (including a `Your answer: X/Y` line), (b) a perfect full-mark answer, and (c) per-mark bullet points. For partial/zero marks, include short “Where you got marks” / “What you missed” lines after the grade reason. The grader result label {correct, partial, incorrect} is derived from marks for UI tone/summary.
- Story image pipeline: as soon as the batch grader returns a `redo_batch`, we request prompt revisions on the first attempt and feed the reviser concrete evidence (grader findings, semantic alignment scores, and thumbnails). The prompt explicitly allows camera/focus changes while anchoring replacements to the narration lines surfaced via `frameNarrationByIndex`.
- Story prose pipeline: add a locked two-sentence Origins Capsule stage before drafting. Narrative prompts must weave the capsule into the opening half, stick to neutral naming (“now known as…”, “…and others”) and forbid exclusive “first/sole” claims, while limiting the story to one named figure. The ending must choose one of the hedged modern templates verbatim (“Today, related algorithms…”, “You’ll spot echoes…”, “This idea sits under the hood…”). The fact-check gate returns a normalized `blockers` object keyed by `{namingAttribution, exclusivityClaim, modernTieInOverclaim, datePrecision, wrongEntity}`, and the editor responds with a matching `fixChecklist` to confirm every blocker was cleared before publication.
- Summaries: produce ≤3 bullets covering strengths/gaps with topic references; limit to 160 chars each.
- Safety: run outputs through moderation filter; redact PII before storing. All prompts tracked with versioned ids.

## 10) Non-Functional Requirements

- Reliability: graceful degradation if LLM provider down — mark job failed with retry guidance. Retain idempotency via `client_request_id` embedded in proto messages.

## 11) Open Questions & Future Enhancements

- Do we need offline capture queue on iOS (store uploads locally until connectivity resumes)?
- Should we expose partial quiz previews while they are being generated? (Answer: definitely)

## 12) Developer Operations Notes

- Cloud Run troubleshooting: when native bindings (e.g., `sharp`) misbehave in production, validate the image locally before redeploying. Run `docker build -f web/Dockerfile -t spark-web-local .` followed by `docker run --rm -e PORT=8080 -p 8080:8080 spark-web-local` and `curl http://127.0.0.1:8080` to confirm the server starts. This workflow is slow (≈1–2 minutes per build) and should only be used while chasing deployment-specific regressions, not during routine development.
