# Spark — Product & Architecture Specification (SwiftUI + SvelteKit)

## 0) Monorepo Layout & Tooling Assumptions

- JS/TS tooling uses Bun:
  - Spark uses Bun workspaces with isolated installs (`bunfig.toml`).
  - Install deps at repo root with `bun install` (lockfile: `bun.lock`, config: `bunfig.toml`).
  - Do not run workspace-level installs such as `bun --cwd=web install`; use the root install to refresh the whole workspace graph.
  - Run workspace scripts via `bun run ...` (see root `package.json`).
- `proto/` — Protocol Buffer definitions for mobile APIs (CheckMate first).
  - Run `bun run generate` to emit TypeScript protos into `packages/proto/src/gen` and Swift protos into `CheckMate/proto`.
  - TypeScript: alias `$proto` points at `packages/proto/src`.
  - Swift types are generated via `swift-protobuf` and used by the iOS apps.
- `web/` — SvelteKit (latest) project deployed to Cloudflare Workers for Cloudflare-hosted builds and as a standalone Bun server for local/GCP container builds. Hosts the public marketing pages _and_ API endpoints consumed by the iOS app.
  - UI theming + color tokens are documented in `web/docs/color-system.md`.
- API logic lives under `web/src/routes/api/*`.
- Web app routes live under `web/src/routes`.
- Admin dashboard lives under `web/src/routes/admin`
- `packages/schemas/` — shared Zod schemas + TypeScript types for Firestore docs (sessions, session state, user stats). Browser-safe and imported by both `web` and `eval` workspaces.
- `data/` — gitignored local workspace for eval fixtures and generated artifacts (for example `data/quiz/**` and `data/code/**`); no required git submodules.
- Shared Firebase project (Auth, Firestore, Storage) configured via environment variables for SvelteKit and plist/xcconfig for the iOS app. Secrets flow through Cloudflare Worker secrets/vars and Xcode build settings. Local dev loads from `.env.local` files.
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
    {
      "action": "screenshot",
      "path": "02-after-login-click.jpg",
      "afterMs": 100,
      "quality": 90
    },
    { "action": "clickText", "text": "Continue with Google" },
    {
      "action": "screenshot",
      "path": "03-after-google-click.jpg",
      "afterMs": 100,
      "quality": 90
    }
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

1. Add this to `web/.env.local`:

```
TEST_USER_EMAIL_ID_PASSWORD=you@example.com/firestoreUserId/your-password
```

If you need `/admin`, include the userId in `ADMIN_USER_IDS`.

2. Start the web dev server (HTTPS for Firebase Auth):

```
bun --cwd=web run dev:https
```

If this is a new machine, first install trusted localhost certs with `mkcert -install`, then create `~/.localhost-certs/localhost.pem` and `~/.localhost-certs/localhost-key.pem` for `localhost 127.0.0.1 ::1`. The repo expects those files for HTTPS dev.

3. Open the email login page and sign in using the credentials from `.env.local`:

```
https://localhost:8081/login-with-email
```

Useful entry points after sign-in:

- `/spark` (Spark AI chat), `/spark/lesson`, `/spark/lessons`
- `/admin` (requires the userId in `ADMIN_USER_IDS`)

Notes:

- Auth is fully enforced; Firestore rules have no test-user exceptions.
- The test user is a normal production user, so it is fast for verifying real Firestore behavior.
- HTTP dev for iOS still runs on `http://127.0.0.1:8080` via `bun --cwd=web run dev`.

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
    - Help students prepare for the British Informatics Olympiad (BIO) with coding practice lessons and problems delivered via the web app (e.g., under `/spark/lesson`), with progress persisted through SvelteKit APIs that proxy Firestore.
  - Spark AI Agent (web, Phase 1)
    - Logged-in web home at `/spark` is the Spark AI Agent chat experience.
    - The chat stream is a continuous list of messages (no section summaries/collapsed sections); the composer stays pinned at the bottom.
    - The UI mirrors ChatGPT: a centered conversation column, assistant replies render as clean text blocks, and user messages appear as right-aligned pill bubbles with left-aligned text inside each bubble.
    - After the second assistant reply, the latest assistant response expands to a minimum height to keep breathing room above the composer without adding trailing spacer after the response.
    - The composer is sticky at the bottom with a rounded “Ask anything” input, leading attach button, and trailing send control.
    - Keyboard: desktop Enter submits (Shift+Enter inserts a new line); on mobile Enter inserts a new line and sending uses the send button.
    - Composer input auto-expands up to 12 lines (then scrolls) with a 12,000 character cap.
    - Assistant output renders markdown via SparkMarkdown (including LaTeX + code blocks).
    - Code blocks render inside a framed container with a language label and copy button; user bubbles can expand to the same max width as assistant replies with a small left inset.
    - The attach menu (plus button) includes “Add photos & files” and, on mobile-capable devices, “Take photo”.
    - Pasting clipboard files into the composer attaches supported images/documents (JPG/PNG/WEBP/GIF/HEIC/HEIF/PDF/TXT/Markdown/LaTeX) through the same upload path as picker-selected files; pasted files are named `clipboard-{N}` (with inferred extension when available).
    - Dragging and dropping supported images/documents anywhere in the browser viewport while `/spark` is open attaches them through the same upload path as picker/paste flows.
    - While dragging supported files over the `/spark` browser window, the UI shows a full-screen HTML drop overlay: a dashed rounded panel styled like the “Start a new conversation” surface, three colorful cards (code/image/document), a down-arrow cue, title `Add anything`, and subtext `Drop documents and images here to add to Spark`; the backdrop reuses Spark’s blob color atmosphere, and the panel animates in/out with a short upward slide while keeping a more solid interior fill for readability.
    - HEIC/HEIF uploads are normalized to JPEG client-side before upload when decoding succeeds, so current model adapters can treat them as standard image inputs.
    - Attachments render as horizontally scrolling preview cards above the input field. Each card shows a spinner while uploading and a remove `×` once ready.
    - Uploads are retried automatically up to 3 attempts on transient failures. If all attempts fail, the tile switches to an error state with a user-facing reason plus compact debug details (`code` and, when available, `HTTP` status), a retry icon action, and a remove `×` action.
    - The send button is disabled until all uploads finish; while uploading it shows an inline spinner.
    - While streaming, the assistant bubble exposes client + server phases:
      - `Establishing connection...` while the SSE request is opening (client-side fetch).
      - `Sending request...` once the server has accepted the stream (emitted via the `meta` SSE event).
      - `Thinking...` while the model streams thought deltas (rendered in a fixed-height thoughts box with about 4 lines visible, without trimming streamed deltas).
      - The assistant response streams as it is generated (no explicit "Responding..." label; tokens append into the message body).
    - Conversations are stored in Firestore as a single append-only document per thread.
    - Phase 1 always routes user messages to the agent LLM and streams responses back to the client (no direct messaging yet).
    - The server downloads any attachments on the latest user message, submits images as inline parts, and submits documents through canonical file attachments (`files.create(...)` -> `input_file`).

**Non-Goals**

- Teacher dashboards, offline generation, Combined/Double Award in v1, or general note management tooling.

## 2) Key Functional Requirements

- Inputs: JPG/PNG/WEBP/GIF/HEIC/HEIF images plus PDF/TXT/Markdown/LaTeX documents. Max 25 MB per file (413 on server rejection), max 10 files per conversation, and 50 MB total per conversation (client + server enforced). Text is optional when attachments are present.
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
- For debugging, `runAgent` tasks also include `userId`, `agentId`, and `workspaceId` as query params on the target URL (in addition to `type=runAgent`).
- The same Bearer token also protects `GET /api/internal/tasks/info`, which returns the task runner's embedded build metadata (`buildId`, `builtAt`, platform, runtime/runtimeVersion, commit/branch, and provider-specific build identifiers when available).
- Build metadata is generated during `web` builds and embedded into the server bundle. Every build gets a fresh `buildId` plus a `builtAt` timestamp; provider commit/build identifiers are sourced from Vercel/Cloudflare env vars directly and from Cloud Build via Docker build args so Cloud Run images retain provenance after the Docker boundary.

### Admin UI

- `/admin/tasks` exposes manual task triggers for operators. Controls include a "Run task" button that enqueues the `helloWorld` task (expects to see `Hello World` in the server logs) and a "Generate welcome session" form that accepts a topic string and queues `generateWelcomeSession` to publish a new template under `spark-admin/templates/sessions`.
- `/admin/tasks` also shows the current admin UI build metadata and a "Retrieve build info" button that synchronously fetches `/api/internal/tasks/info` from the configured task service, then renders the task runner build details and whether they match the UI build.
- `/admin/metrics` shows a Cloud Monitoring-backed overview for Spark observability.
- `/admin/metrics/llm` shows detailed LLM telemetry (wrapper call latency, cost, tokens, and tool-loop phase timings) plus agent workload metrics (run duration, task-runner CPU usage, and task-runner RSS peak grouped by agent type such as `grader`, `lesson`, `tutor`, and chat).

### 3.1 Data Flow

1. User captures/upload content in the SwiftUI app (future flow; not used by the web app yet).
2. App serializes a Protocol Buffer `GenerateFromUploadRequest` and uploads file(s) to Firebase Storage (`/spark/<userId>/<timestamp>.jpg|pdf`).
3. App calls API endpoint (`POST /api/spark`) with binary proto payload referencing the upload.
4. API endpoint validates input, writes initial job document to Firestore, and kicks off LLM processing using the runtime `waitUntil()` hook (Cloudflare Workers execution context) so work continues even if the HTTP client disconnects.
5. Background generation reads source material, produces quiz content, and streams status into Firestore (`requests`, `client.events`, and quiz documents).
6. SwiftUI app listens to Firestore collection changes to display progress, new questions, summaries, and errors in real time.

### 3.2 Protocol Buffer Contract

- Core message families: `SparkApiRequest`, `SparkApiResponse`, `GenerateFromUploadRequest`, `CheckAnswerRequest`, `SummarizeRequest`, `JobStatusUpdate`, `Quiz`, `Question`, `FirestoreSyncEnvelope`.
- Versioning: embed `api_version` and `client_version` so server can reject incompatible clients gracefully.
- Binary transport (`Content-Type: application/octet-stream`) for performance; fallback REST+JSON only for marketing/diagnostics endpoints.

### 3.3 Cloud Services

- **Firebase Auth**: Apple Sign-In, email/password fallback. Tokens verified server-side by validating Firebase ID tokens against Google's JWKS (via `jose`). No Firebase Admin SDK is required for token verification.

  Test user login: for local/preview testing, set `TEST_USER_EMAIL_ID_PASSWORD=email/userId/password`. This does **not** bypass Firebase Auth; it is only a reference for signing in via `/login-with-email`. Admin access is still controlled by `ADMIN_USER_IDS`, and Firestore rules have no test-user exceptions.

  Web SSR session: the web app issues a long-lived, encrypted, HTTP-only session cookie (`appSession`, max age 1 year) after successful Firebase sign-in (minted via `POST /api/login`). This cookie is used by `web/src/hooks.server.ts` to keep `/spark/*` SSR routes logged in even when the 1-hour Firebase ID token expires (for example after laptop sleep). The cookie is cleared via `POST /api/logout` (also called by `/logout`). Requires `COOKIE_SECRET_KEY` (32 bytes, base64) in the server environment.
- **Cloud Monitoring**: Spark writes custom metrics under `custom.googleapis.com/spark/**` for LLM call latency, tool-loop timing phases, agent run duration, and task-runner process CPU/RSS summaries. With `@ljoukov/llm` 7.x Spark bridges the library's shared telemetry API into Cloud Monitoring, so direct `generate*` calls and agent loops can emit metrics through one process-wide sink while Spark still adds task-runner-specific step timing and process-resource metrics. `/admin/metrics` reads these series back through the same Google service-account JSON. The service account used in `GOOGLE_SERVICE_ACCOUNT_JSON` must have both `roles/monitoring.metricWriter` and `roles/monitoring.viewer`.

- **Firestore**: Single source of truth for job metadata, quiz content, attempts, summaries, and client events. Server access uses the Firestore REST API with a service-account JWT flow (WebCrypto) using `GOOGLE_SERVICE_ACCOUNT_JSON`. Structured to minimize document sizes (<1 MB) and keep hot paths under 10 writes/sec per doc.
- **Firebase Storage**: Raw uploads stored short-term (7-day TTL) under `/spark/uploads/<uid>/<md5>` with security rules enforcing ownership. Server access uses the Storage JSON API (REST) with the same service-account JWT flow; objects are read/written by `storagePath` (no `downloadUrl` requirement). The server derives the storage bucket automatically as `<projectId>.firebasestorage.app` from the Google service account; do not override via environment variables.

### 3.4 Spark AI Agent Firestore (Phase 1)

- Conversations live under `/{userId}/client/conversations/{conversationId}` (client-safe read path; server writes only).
- Each conversation document stores an append-only `messages` array (OpenAI Response-style with `content[]` parts).
- Assistant messages may include `agent_run` content parts for lesson/grader launches. These parts drive live chat cards that subscribe to the corresponding Firestore session/run document instead of exposing raw tool payloads in prose.
- Conversation documents include `attachments[]` entries with `{ id, storagePath, contentType, filename?, sizeBytes, status, createdAt, updatedAt, messageId? }`, where status ∈ `uploading | attaching | attached | failed`.
- Streaming writes to Firestore are throttled to at most one update every 500 ms; the SSE stream is used for immediate UI updates.

### 3.5 Spark AI Agent Runs (Phase 2)

- Agent runs are stored under `users/{userId}/agents/{agentId}`.
  - Fields: `{ id, prompt, status, workspaceId, stop_requested?, inputAttachments?, createdAt, updatedAt, statesTimeline[], resultSummary?, error? }`.
  - `status` ∈ `created | executing | stopped | failed | done`.
  - `statesTimeline[]` entries contain `{ state, timestamp }`.
  - `updatedAt` is refreshed whenever the runner persists new run activity (status changes, streamed text, or log batches), so `/spark/agents` ordering and run-detail duration reflect the latest recorded agent activity.
- Agent runs use a hosted web search tool during the LLM tool loop when available (e.g. OpenAI Responses `web_search` with external web access enabled).
- Stop: the `/spark/agents` UI can set `stop_requested = true`. While running, the server polls `stop_requested` every 10 seconds and stops the run by setting `status = "stopped"` (and returns success to Cloud Tasks so it won’t retry).
- Completion: the agent is expected to call the `done` tool once. If the tool loop ends with a final text response without calling `done`, the server writes the response to `agent-output.md` in the workspace, stores a truncated (≤ 1000 chars) version in `resultSummary`, and marks the run as `done`.
- Agent workspaces live under `users/{userId}/workspace/{workspaceId}/files/{fileId}`.
  - `fileId` is always `encodeURIComponent(path)` (no directory sub-collections).
  - Text files are stored inline as `{ path, content, contentType?, createdAt, updatedAt, sizeBytes }`.
  - Binary files (images/PDFs) are stored as storage links: `{ type: "storage_link", storagePath, contentType, path, createdAt, updatedAt, sizeBytes }`.
  - Workspace file updates are throttled to ≤ 1 write per 10 seconds per file doc.
  - The runner materializes `storage_link` docs into the local workspace path from the same `path` field and injects resolved files into multimodal model input (subject to attachment count/size limits and user-upload path checks).
- Agent sub-model LLM debug snapshots (per `generate_text` / `generate_json` tool call) are stored in the workspace as files:
  - `generate_text/turn{N}tool{M}/{prompt|request|response}.txt`
  - `generate_json/turn{N}tool{M}/{prompt|request|response}.txt`
  - `{N}` is the tool-loop turn/step number and `{M}` is the (1-based) parallel tool index within that turn.
- Lesson creation (from `/spark` chat) is implemented as an Agent run:
  - The chat collects a lesson topic plus optional constraints:
    - Goal + level
    - Plan shape (preferred number of plan items, and for each quiz item the number of questions + mix of `multiple-choice` / `type-answer` / `info-card`)
    - Materials/links to incorporate
    - Duration is not a primary input; the UI/agent can infer an approximate duration from the plan shape + question counts.
  - Server creates a new session stub under `spark/{userId}/sessions/{sessionId}` with `status = generating`.
  - As soon as `create_lesson` succeeds, the `/spark` chat appends a live in-thread task card to the assistant message. The card subscribes to the session/state docs, shows live status (plus elapsed age while active), and links to `/spark/lesson/{sessionId}` via a primary `Open` action without printing internal IDs in assistant markdown.
  - The `create_lesson` tool result shown to the model is intentionally minimal (`status = started`); navigation data stays in the chat card path rather than being restated in assistant markdown.
  - Server writes `brief.md`, `request.json`, plus `lesson/task.md` + `lesson/schema/*` into the workspace and schedules a `runAgent` task.
  - The agent follows `lesson/task.md`, authors Firestore-ready JSON under `lesson/output/` (`session.json`, `quiz/*.json`, `code/*.json`, optional `media/*.json`), then calls `publish_lesson` with a `sessionPath`.
  - `publish_lesson` validates the JSON with Zod and publishes it into the user’s session collections, setting `status = ready` (or `status = error` on failure).
- Uploaded-work grading (from `/spark` chat) is implemented as an Agent run:
  - The chat tool `create_grader` creates `spark/{uid}/graderRuns/{runId}`, provisions a workspace, writes `grader/task.md` plus upload manifests, and schedules `runAgent`.
  - As soon as `create_grader` succeeds, the `/spark` chat appends a live in-thread task card to the assistant message. The card subscribes to the run doc, shows `queued -> grading -> ready/failed/stopped` plus elapsed age while active, and links to `/spark/sheets/{runId}` via a primary `Open sheet` action.
  - The `create_grader` tool result shown to the model is intentionally minimal (`status = started`); run/list URLs stay in the chat card path rather than being restated in assistant markdown.
  - The chat agent should derive any launch title from uploaded/pasted content only when the source material already makes it clear; otherwise it should omit the override and let the grader derive the final UI title after reading the uploads.
  - `create_grader` includes `referenceSourcePolicy`:
    - `uploaded-only`: grading must rely on uploaded/pasted materials; no online search for missing references.
    - `allow-online-search-when-problems-missing`: online search is allowed only when problem statements are missing or unclear.
  - Attachment selection is conversation-aware (not only the latest message): relevant prior user uploads in the same thread are reused for retries/follow-ups unless replaced.
  - Selected uploads are written as metadata in `request.json` and `grader/uploads/index.json`; each upload is also represented by a workspace file at `grader/uploads/<filename>` stored as a `storage_link` doc.
  - During load, linked uploads are materialized into the same local workspace paths (`grader/uploads/<filename>`) so tools such as `view_image` work directly on file paths.
  - The runner resolves these attachments (plus any `inputAttachments` metadata on the agent doc) and injects corresponding images/files into the run-agent model input as inline multimodal parts.
  - The grader agent uses an extraction-first workflow with `extract_text` over uploaded student work/problem statements/official solutions, writing consolidated transcription to `grader/output/transcription.md` before the final worksheet artifact. The tool's success payload exposed back to the agent is intentionally minimal; the agent should read the written markdown file rather than rely on tool-result metadata. Persisted tool traces may still include richer trace-only metadata for debugging and auditing.
  - Problem statements and official-solution text used for grading must stay as verbatim as possible to the uploaded/official source: preserve numbering, labels, examples, punctuation, variable names, and displayed math; only minimal OCR/layout cleanup is allowed, and uncertainty should be marked explicitly instead of paraphrasing.
  - Student transcription must be complete and faithful, then converted into worksheet questions plus submitted answers inside a single sheet artifact; variable names, formulas, terminology, and method choice are preserved as closely as possible except for light structuring, line-break cleanup, and obvious spelling fixes that do not change meaning. When the learner answers on the same page as the original task (for example fill-in-the-blank work on the worksheet itself), the transcript and final worksheet answers must clearly separate original prompt text from the student's contributed response so later grading/review never confuses the two.
  - Transcription/source gathering stays on the main agent. After that, the grader may choose whether subagents are worthwhile: short routine problems should usually stay on the main agent, while longer or olympiad-style problems that need about a page or more of independent solution work may use one subagent per problem. At most 6 subagents should be live at once, and finished subagents should be closed before spawning more. The main agent always consolidates final outputs.
  - The final output is one worksheet JSON artifact at `grader/output/sheet.json` containing:
    - `sheet`: the worksheet UI structure (`hook` / content sections + supported question types),
    - `answers`: the student's submitted answers keyed by worksheet question id,
    - `review`: per-question worksheet feedback cards plus score summary,
    - `references`: grading / official-solution / transcript markdown for auditability.
  - The grading step must produce everything needed to render `/spark/sheets/{runId}` immediately, including the first per-question feedback note for each worksheet question. The sheet page may still be in `grading` status while the artifact is being assembled.
  - Worksheet question types are limited to the paper-sheet UI contract: `fill`, `mcq`, `lines`, `calc`, `match`, and `spelling`. When a problem does not fit neatly into an objective worksheet type, the grader should use `lines`.
  - `lines` questions may also opt into Markdown/LaTeX rendering for the written response area (for example maths proofs or multiline equation working) so the sheet UI shows the student's structured answer as rendered content rather than plain textarea text.
  - Per-question worksheet review notes must be empathetic and student-facing: acknowledge sensible partial thinking or correct structure before naming the missing piece, prefer methodological nudges/rules of thumb before full answers, and do not treat a near-miss as resolved when the actual task is still unmet.
  - If problem statements are uploaded but official solutions are missing, the grader solves each problem carefully itself and does not search online for solutions; the derived solution should stay at the student's level and reuse their terminology/method style where reasonable.
  - If online search is allowed by `referenceSourcePolicy`, `web_search` may be used only to fill missing/unclear problem statements or references; `web_fetch` remains non-PDF only.
  - Image processing tool inputs are aligned with chat upload image formats (`image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/heic`, `image/heif`); `crop_image`, `draw_grid_overlay`, and `trim_image` write PNG outputs into the workspace.
  - Image/PDF outputs generated during runs are uploaded to Firebase Storage under `spark/uploads/{uid}/{md5}` and persisted back to the originating workspace file path as `storage_link` docs.
  - `grader/output/run-summary.json` also carries a grader-specific `presentation` block (`title`, `summaryMarkdown`) for direct UI rendering. It must stay human-facing and concise: no IDs, file paths, tool/process narration, or `Unknown` filler strings.
  - Before completion, the grader must call `publish_sheet`. That tool validates both `grader/output/run-summary.json` and `grader/output/sheet.json`, flushes the workspace artifact, and patches the run document with presentation + totals + sheet metadata for `/spark/sheets` while the run may still be in `grading`.
  - `done({summary})` is only a final completion signal; grader runs must not be allowed to succeed unless `publish_sheet` already passed.

- Prompting and tool-use strategy:
  - Tool definitions (name + description + Zod schema) are the “API contract”. Put field-level semantics and constraints in the tool schema/description, not scattered across prompts.
  - System prompts define global behaviour (tone, safety, and when/why to call tools). Keep them short and avoid duplicating tool parameter details.
  - Prefer simple, direct instructions; keep long workflows in repo-authored `.md` prompt files and reference them, rather than embedding everything inline in a single prompt string.
  - Prompt locations:
    - Spark chat system prompt: `web/src/lib/server/agent/spark-chat-system-prompt.md` (loaded server-side via `?raw`).
    - Lesson agent task template + prompts: `web/src/lib/server/lessonAgent/task-template.md`, `web/src/lib/server/lessonAgent/prompts/*.md`.
    - Grader agent task template: `web/src/lib/server/graderAgent/task-template.md`.
    - Lesson JSON schemas: `web/src/lib/server/lessonAgent/schema/*.schema.json`.

- Agent run logs live under `users/{userId}/agents/{agentId}/logs/log` (single doc).
  - Log lines are stored in a map field `lines`, keyed by an epoch-ms timestamp key (`t<ms>_<seq>`), with values as the printed log line text.
  - Updates use partial/merge semantics so individual lines can be appended without rewriting the entire doc.
  - Log updates are throttled to ≤ 1 write per 2 seconds per agent log doc.
  - Streaming model output is written under `stream`:
    - `stream.assistant`: the latest assistant output buffer (tail-capped to avoid Firestore doc growth).
    - `stream.thoughts`: the latest reasoning/thoughts buffer (tail-capped to avoid Firestore doc growth).
  - The log doc also stores `stats` snapshots including:
    - LLM token totals and estimated cost (USD)
    - Tool call counts (total + per-tool)

## 4) Backend (SvelteKit)

- Uses SvelteKit
- API routes implemented as server modules in `web/src/routes/api/*/+server.ts`.
- Request handling pipeline (proto endpoints are future/mobile-only; web routes use JSON today):
  1. (Proto) Parse binary proto payload using generated TypeScript classes.
  2. Validate auth (Firebase ID token in headers) by verifying the token signature against Google's JWKS (`jose`).
  3. Persist initial Firestore documents and enqueue background workflow by scheduling async functions with the runtime `waitUntil()` hook (Cloudflare Workers execution context).
  4. (Proto) Return minimal proto response (`AckResponse` with `job_id`, `received_at`, optimistic status).
- Long-running operations (LLM generations, PDF parsing, summarization) run inside the runtime `waitUntil` hook. The handler writes updates back to Firestore as discrete steps (`started`, `ingesting`, `generating`, `ready`...). If rate limits require, delegate to Cloud Tasks or other queueing primitives in later iterations.
- Firestore/Storage access uses a dual-path client:
  - Cloudflare Workers runtime uses Firestore + GCS REST APIs with service-account JWTs minted via WebCrypto.
  - Node runtimes can use Firebase Admin SDK (gRPC) when available (enables Firestore listeners); wrappers fall back to REST on Workers.
  - All writes are batched where possible to stay within Firestore limits.
- API surface (proto-based, future/mobile-only):
  - `SparkApiRequest.request = GenerateFromUploadRequest`
  - `SparkApiRequest.request = CheckAnswerRequest`
  - `SparkApiRequest.request = SummarizeRequest`
  - `SparkApiRequest.request = SyncRequest` (optional to bootstrap client caches)
- Web app uses JSON endpoints under `/api/*`; non-proto marketing endpoints remain separate (`/api/health`, `/api/newsletter`).
- `POST /api/spark/agents` creates a new Spark Agent run, persists the agent doc, assigns a workspace, and schedules the `runAgent` task. Once execution begins, the runner also patches that same agent doc with the resolved per-run available-tools catalog so the run detail page can show exactly which tools, tool prompts, and declared invocation contracts were exposed.
- `POST /api/spark/agents/{agentId}/retry` retries a failed run by cloning the source prompt + retry-safe metadata (including attachment metadata such as `inputAttachments`/`graderInputAttachments`) into a new agent doc, copying workspace files into a fresh workspace, and scheduling a new `runAgent` task.
- Logging & tracing:
  - Server-side web runtimes mirror console logs plus one structured request log per request into Google Cloud Logging when `GOOGLE_SERVICE_ACCOUNT_JSON` is configured, even outside GCP-hosted deployments.
  - Custom web log entries include platform/runtime metadata (`local`, `cloudflare`, `vercel`, `gcp`, etc.); local dev writes are enabled by default and can be disabled with `SPARK_DISABLE_CLOUD_LOGGING=1` (aliases `DISABLE_CLOUD_LOGGING=1` and `CLOUD_LOGGING_DISABLED=1` also work).
  - Admin/operators can query Cloud Logging by `userId`, `agentId`, and `workspaceId`, alongside Cloud Run request/stdout/stderr logs and Cloud Tasks queue operation logs.

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
- `/login` renders the sign-in dialog. Clicking "Continue with Google" navigates to `/login/continue`, which starts Firebase redirect-based Google sign-in. Google returns to `/login/continue` (not `/login`) to avoid flashing the sign-in UI twice, then the client syncs the server session via `POST /api/login` and redirects to `/spark` (or `redirectTo`).
- Web app pages (including `/spark` and `/admin`) are built with shadcn and SvelteKit.
- The main web app experience (landing, auth, and signed-in pages) lives under the `(app)` layout group so that `/admin` does not inherit app-only client effects.
- Public marketing site + lightweight authenticated portal for testing (e.g., shareable quizzes or onboarding instructions).
- Shared design system built with TailwindCSS (compiled for the Edge Runtime) or UnoCSS.
- Edge-friendly server load functions fetch Firestore user metadata for portal pages.
- Signed-in experiences live under `/(app)/(signed)` with a shared shell (user avatar menu showing display name + email/guest label and a copy button that copies `Name`/`Email`/`UserID` lines to the clipboard (omitting missing fields), an `Admin` shortcut to `/admin` only for server-confirmed admins, Chats / Lessons / Sheets shortcuts, theme picker, Firebase auth sync) reused by `/spark` and `/spark/lesson`. The sheet detail route `/spark/sheets/{sheetId}` is the exception: it uses a stripped custom layout that shows only the worksheet surface plus a single floating round `×` button that returns to `/spark/sheets`.
- `/spark` is the signed-in home for the Spark AI Agent chat and includes quick links to Lessons (`/spark/lessons`), Sheets (`/spark/sheets`), and Agents (`/spark/agents`). The current conversation can also be reopened directly with `/spark?conversationId={conversationId}`. If the referenced conversation cannot be rendered from its saved Firestore payload, Spark clears the broken `conversationId`, shows an inline error, and returns the user to a fresh chat instead of leaving them on an empty thread. When chat launches lesson creation or uploaded-work grading, the assistant message renders a live status card in-thread instead of dumping raw tool-call machine data; the card links directly to the lesson/run plus the corresponding list page and updates from Firestore while the background run is still executing.
- `/spark/chats` lists the user's 50 most recent Spark AI Agent conversations newest-first, supports client-side search plus type filters (`All`, `Chat`, `Sheets`, `Quiz`, `Lesson`), and groups results into Today, Yesterday, Last 7 days, and Last 30 days (with an Older fallback if needed). Each row links back into `/spark` with the matching `conversationId`.
- `/spark/sheets` lists sheet runs launched from chat. Each card uses the same paper-sheet header/footer visual language as the full worksheet, plus a concise title, score line, and rendered Markdown summary instead of raw process logs or machine identifiers.
- Opening a sheet (`/spark/sheets/{sheetId}`) always shows the paper-sheet UI inside a dedicated sheet-only layout. The worksheet surface follows the signed-in shell theme (light/dark) while preserving the sheet-specific accent color, but once `grader/output/sheet.json` is available the page drops straight into the worksheet itself with no shared header, no extra sheet-page header or summary card, no separate reference-notes section, and only a floating round `×` close button leading back to `/spark/sheets`. The worksheet column itself is capped at `1024px`, centered in the viewport, and gains extra vertical padding once the viewport is wider than that cap. While grading is still running, the page can stay in a minimal queued / grading / failed / stopped placeholder state until the final worksheet body is published. Once available, the same page renders the worksheet artifact directly in the paper-sheet UI with the student's submitted answers locked in place, and locked long-answer solutions move into their own full-width row beneath the prompt so they align with the feedback cards that follow.
- Interactive follow-up also happens on `/spark/sheets/{sheetId}`. There is no separate `/spark/sessions/{sessionId}` product surface. When the student replies inside a question feedback card, Spark creates a hidden sheet-interaction session and starts a question-scoped background agent. Each worksheet question has at most one open thread. Resolved questions show a done state, collapse by default, tint both the question chrome and the feedback card green, and replace the live composer with a right-aligned `ask followup` action that reopens the resolved thread when the student wants another pass. Open questions expose the per-question reply composer directly inside the sheet. While a reply agent is active, the matching feedback card shows chat-style runtime states (`connecting`, `thinking`, `responding`) plus the in-progress thought/response stream mirrored from the active agent log so the student can see that work is happening before the final assistant turn is committed. Once response streaming starts, the separate thinking block disappears, and while input is runtime-locked the feedback composer animates from the full textarea into a compact circular loading shell: the draft/placeholder are cleared, the attach/input affordances disappear, and the send control becomes a spinner-only outlined circle so it is obvious the student cannot type yet. Reviewer language should stay warm and specific: it should validate sensible partial thinking, prefer methodological direction or rules of thumb before giving the answer away, keep the original task distinct from the student's attempt, and only resolve a thread once the actual asked task has been met. If a reply stalls and leaves a question in `responding`, Spark auto-recovers the sheet interaction on the next load with a fallback reply so the student is not stuck in a permanent reviewing state.
- Legacy `/spark/grader/*` and `/spark/sessions/*` URLs redirect to the corresponding `/spark/sheets/*` page.
- `/spark/agents` lists the user's 50 most recently updated agent runs, supports client-side search plus status filters (`All`, `Running`, `Queued`, `Done`, `Failed`, `Stopped`), groups results into Today, Yesterday, Last 7 days, and Last 30 days (with an Older fallback if needed), and links each row to `/spark/agents/{runId}`. This page is a read-only run index; starting new agent runs is no longer available here.
- Opening a run (`/spark/agents/{runId}`) shows the run details:
  - The run header is prompt-first: a `Prompt` label, the full prompt rendered as Markdown in standard body text underneath, and a top row that keeps `Copy prompt`, `Download zip`, and the status pill together.
  - The detail card also shows an `Available tools` section sourced from the persisted agent doc. Each tool row expands inline to reveal the full tool description/prompt that was exposed to the model for that run, the observed call count when stats are available, the declared input contract (JSON schema for function tools or custom input format/grammar for custom tools), and the current output-contract status. Spark persists the contracts programmatically from the runtime tool definitions rather than duplicating a hand-written UI copy.
  - The user-facing summary also renders Markdown. Metadata shows separate fields for the agent ID, workspace ID, created timestamp, updated timestamp, and elapsed duration, alongside the status timeline and a Stop button (only while `status` is `created`/`executing` and `stop_requested` is not set; after requesting stop, the UI shows a “stop requested” badge).
  - Failed runs show a Retry button in the run header; retrying creates a new agent run with the same prompt and retry-safe metadata, copies the prior workspace files into a new workspace, and starts a fresh task before navigating to the new run.
  - Run log view defaults to tailing the latest lines (auto-scrolls while pinned to bottom, stops auto-follow when the user scrolls up), preserves newline formatting inside each log entry, and shows the raw chronological log stream instead of appending a merged thought snapshot at the end.
  - A separate `Cloud logs` section fetches Google Cloud Logging for the same run (filtered by the authenticated user plus agent/workspace identifiers) and supports manual refresh so crashed or partially-written runs still expose request/task/runtime logs even when Firestore log flushing stops early.
  - Workspace files (Markdown renders inline). Image files and image storage-link files are previewable in the modal, and `Raw` opens the underlying file/link target in a new tab.
  - A `Download zip` action that returns the full workspace contents (including LLM logs) plus a plain-text `agent.log` file for the run.
- `/spark/lesson` hosts the Spark Lessons experience (quizzes, coding problems, media steps).
- `/logout` signs out and returns to `/`.
- Implements newsletter sign-up (Mailcoach/ConvertKit) via Cloudflare KV (or a third-party API).
- CSR avoided for marketing pages; islands used sparingly for forms.

## 7) Firestore Data Model

- `users/{uid}`: profile info, preferences, current programme, board (optional), subscriber flags.
- Spark AI Agent chat (`/spark`) conversations live under `/{uid}/client/conversations/{conversationId}` as a single append-only document per thread.
- (Legacy) `spark/{uid}/channels/{channelId}`: Spark Chat channels scoped to a single user (current default scope).
  - Fields: `{ title: string, scope: 'private', createdAt: Timestamp, updatedAt: Timestamp, lastMessageAt?: Timestamp }`.
  - Default channel id: `home` (title “New chat”).
  - Future family/shared channels will live under `spark-families/{familyId}/channels/{channelId}` with `scope: 'family'`.
- (Legacy) `spark/{uid}/channels/{channelId}/messages/{messageId}`: chat messages for a channel.
  - Fields: `{ text: string, authorId: string, authorName?: string, role: 'user' | 'assistant', createdAt: Timestamp }`.
- `spark/{uid}/uploads/{uploadId}`: metadata about raw assets (filename, storagePath, hash, contentType, sizeBytes, status, quizStatus, quizQuestionCount, uploadedAt, lastUpdatedAt, activeQuizId). Subcollection `quiz/{quizId}` records each generation attempt with `{ uploadId, status, requestedQuestionCount, definition?, failureReason?, createdAt, updatedAt }`, where `definition` reuses `QuizDefinitionSchema`. The active quiz run is referenced by `activeQuizId`.
- `spark/{uid}/tutorSessions/{sessionId}`: hidden sheet-interaction sessions seeded from worksheet reports once the student replies on a sheet. The session doc tracks `{ workspaceId, status, source, title, preview?, focusLabel?, activeTurnAgentId?, activeTurnQuestionId?, error?, createdAt, updatedAt, completedAt? }`, while the paired workspace stores `context/report.json` (the worksheet artifact + references), optional reference markdown mirrors, and `state/review.json` containing the structured worksheet review state (`sheet`, `answers`, `review`, and per-question thread status/history). The interaction workspace is append-only by question: each worksheet question gets `feedback/questions/{questionId}/question.json`, and every student/assistant turn is written as a new file under `feedback/questions/{questionId}/turns/<timestamp>-<author>.json`. Student replies are always written first, then the reply agent is launched with the new file path in its prompt. The reply agent only receives question-reply tools (`wait_for_student_input`, `complete_tutor_session`, `done`) and cannot delete or rewrite workspace files.
- `requests/{jobId}`: canonical job record with type (`generate`, `check_answer`, `summarize`), status enum, timestamps, error field, payload hashes.
- `client/{uid}` document containing `events` map keyed by `jobId` (compact snapshots mirroring job status + minimal payload refs). TTL clean-up routine prunes old entries.
- `spark/{uid}` user doc: canonical profile plus `currentSessionId?: string` and `stats?: { xp, level, streakDays, solvedCount }`. Stats are read-only client side; server mutates during scoring flows.
- Quiz completion awards XP by question type (info cards +5, multiple-choice +10, type-answer +12) via the authenticated `/api/code/{sessionId}/update` endpoint with a `quizCompletion` payload. The handler increments `stats.solvedCount`, records idempotent progress under `spark/{uid}/progress`, and returns refreshed stats to the client.
- Copy convention: info-card eyebrow uses single-word labels from a small whitelist: `Idea`, `Concept`, `Insight`, `Rules`, `Tips`, `Facts`, `Shortcut` (default `Idea`). Avoid phrases like "Idea card".
- Quiz content (prompts, hints, multiple-choice explanations, info-card bodies, and choice labels) accepts lightweight Markdown authored in the schema. Type-answer questions do **not** store explanations; their feedback is produced by the grader. The SvelteKit loader renders Markdown with `marked` (GFM enabled, soft line breaks) plus KaTeX so formulas display inline or block-level before hydrating the quiz components. Both `\(...\)` / `\[...\]` and `$...$` / `$$...$$` delimiters are supported. When no Markdown is present the components fall back to the existing plain-text rendering, so data authors do not need to escape anything manually.
- `spark/{uid}/sessions/{sessionId}`: server-only session plans. Each document stores `{ id, title, summary?, tagline?, emoji?, createdAt: Timestamp, status?: 'generating' | 'ready' | 'in_progress' | 'completed' | 'error', topics?: string[], sourceSessionId?, sourceProposalId?, nextLessonProposals?: Array<{ id, title, tagline, topics: string[], emoji }>, nextLessonProposalsGeneratedAt?: Timestamp, plan: PlanItem[] }` where `PlanItem` may be a quiz (`{ id, kind: 'quiz', title, summary?, icon?, meta? }`), coding problem (`{ id, kind: 'coding_problem', title, summary?, icon?, meta?, difficulty?, topic? }`), or media clip (`{ id, kind: 'media', title, summary?, icon?, meta?, duration? }`). `kind='coding_problem'` is a competitive-programming style stdin/stdout task where the learner writes Python to pass tests. Session IDs are short human-readable slugs used in URLs. Only SvelteKit server routes read/write this collection; the client receives sessions through the authenticated layout load. Session-specific content lives in subcollections:
  - `quiz/{quizId}`: quiz definitions delivered to the `/spark/lesson` experience. Shape follows `QuizDefinitionSchema` (id, title, optional metadata, gradingPrompt, and an ordered array of questions). Type-answer questions include `marks` + `markScheme` for server grading. Written by server tooling; client never writes or reads directly.
  - `code/{problemId}`: code problem metadata (slug, topics, markdown description, examples, test cases, stdin/stdout solution) scoped to the user and session. Mirrors the structure in `CodeProblemSchema` and is used by the problem detail page.
- `media/{planItemId}`: narration clips with synced imagery. Documents follow `SessionMediaDocSchema` (`id`, `planItemId`, `sessionId`, `audio: { storagePath, mimeType?, durationSec }`, `images: Array<{ index, storagePath, startSec, durationSec }>` for the story panels (default 10, configurable), `narration: Array<{ text, startSec, durationSec, speaker? }>`, optional `posterImage`/`endingImage` stills (`{ storagePath }`), `metadataVersion` (current v3), timestamps). Audio files live in Firebase Storage at `spark/{userId}/sessions/{sessionId}/{planItemId}.mp3` and are served via the authenticated `/api/media` proxy (Storage JSON API via service account).
- `spark/{uid}/graderRuns/{runId}`: sheet-run metadata launched from `create_grader`. Each document stores `{ id, agentId, workspaceId, conversationId?, userPrompt?, olympiadKey, olympiadLabel, summaryPath, sheetPath, sourceAttachmentIds?, sourceAttachmentCount?, status: 'created'|'executing'|'stopped'|'failed'|'done', paper?, presentation?: { title?, summaryMarkdown? }, totals?, sheet?: { title?, filePath }, resultSummary?, error?, createdAt, updatedAt, completedAt? }`. `olympiadKey` / `olympiadLabel` are legacy seed-title fields for the pre-summary launch state; `paper` captures inferred paper metadata/URLs (including `contextLabel` when known), `presentation` carries the UI-facing title/summary markdown, `sheetPath` points to the canonical worksheet artifact (`grader/output/sheet.json`), and `sheet` carries the published summary used by `/spark/sheets`.
- On a user's first visit to `/spark/lesson`, if no sessions exist the server fetches available welcome templates from `spark-admin/templates/sessions`. Each template document provides `{ id, title, summary?, plan, tagline, emoji, topic, key? }` plus child collections for `quiz/`, `code/`, and `media/`. The `/spark/lesson` welcome screen lists the templates as lesson cards (poster image or emoji, two-line-clamped tagline, and a “Launch” CTA); picking one clones the template into `spark/{uid}/sessions/{sessionId}` with matching subcollections, copies any narration media into the user namespace, and updates `currentSessionId`.
- `spark/{uid}/state/{sessionId}`: session state document mirrored into SvelteKit responses. Shape `{ sessionId, items: Record<planItemId, { status: 'not_started' | 'in_progress' | 'completed', startedAt?, completedAt?, quiz?: { lastQuestionIndex?: number, serverCompletedAt?: Timestamp, questions: Record<questionId, { status: 'pending' | 'correct' | 'incorrect' | 'skipped', selectedOptionId?, typedValue?, hintUsed?, dontKnow?, firstViewedAt?, answeredAt?, grade?: { awardedMarks, maxMarks, feedback, heading?, tone? } }> }, code?: { language: 'python', source: string, savedAt: Timestamp, lastRunStatus?: 'passed' | 'failed' | 'error', lastRunAt?: Timestamp } }>, lastUpdatedAt }`. `feedback` stores Markdown only; HTML is derived at render time and never persisted. Only the server reads/writes this collection; browser code receives the state through `load` functions and applies changes by POSTing to `/api/code/{sessionId}/update`, which validates via `@spark/schemas` before persisting.
- Loading feedback (web `/spark/lesson`): any user action that triggers a server round-trip must surface a visible loading cue. Prefer subtle inline spinners on the action target (timeline rows, dialog buttons) for quick navigations; reserve full-screen or modal overlays for major page transitions (opening a lesson from `/spark/lessons`, generating new lesson flows) so learners feel the weight of the transition without unnecessary friction. Free-text grading shows a spinner inside the quiz Submit button with “Submitting…” then “Grading…” once the stream starts; network errors swap the button label to “Network error, retry.”
- Free-text answer UI (web `/spark/lesson`): starts as a single-line textarea that auto-expands up to 7 lines (then scrolls), with a 1,000 character cap. Grader feedback renders as a single Markdown block; the UI does not inject a separate “correct answer” panel. Grading streams via SSE: thinking tokens render in a fixed-height box with about 4 lines visible (without trimming streamed deltas) and are cleared once the final answer arrives.
- Quiz exit UX (web `/spark/lesson`): clicking the "x" in the quiz progress rail shows the "Take a break?" dialog only when there are unanswered questions. The dialog offers `Keep practicing` and `Quit now`; choosing `Quit now` shows an inline spinner on the quit button while the server completes the route back to `/spark/lesson/{sessionId}` and the dialog stays open until navigation finishes to avoid flicker. If every question is already answered the exit control navigates straight to the session dashboard.
- Lesson dashboard CTA (web `/spark/lesson/{sessionId}`): the plan footer button shows `Start` until any item advances, switches to `Continue` once progress exists, and softens into a completed state (`🎉 Finish`) when every step is finished. When finished, the CTA opens the next-lesson dialog instead of routing; the dialog shows a spinner (“Deciding on your next sessions…”) while the server drafts three proposals with Gemini 3 Pro, caches them under `sessions/{sessionId}.nextLessonProposals`, and reuses them on reopen. Each proposal carries `{ title, tagline, topics, emoji }`; picking one enqueues `createTask({ type: 'generateLesson' })`, seeds a `status='generating'` session stub, switches `currentSessionId`, and routes to that session. Sessions in `status='generating'` render the “Generating...” view with a link to `/spark/lessons` rather than the plan timeline.
- Lessons list (web `/spark/lessons`): mirrors the `/spark/lesson` shell with a single panel that lists all lessons newest-first, showing emoji, title/tagline, creation date, derived status (`generating` | `ready` | `in_progress` | `completed` | `error`), and simple step progress; each row links to `/spark/lesson/{sessionId}`. The user menu includes `Chats`, `Lessons`, and `Sheets` entries for quick access, and server-confirmed admins also see an `Admin` entry that links to `/admin`. The page also shows all welcome templates with a “Start lesson” action that posts to `/spark/lessons?/start`; submitting clones the template into the user’s sessions (same flow as first-time welcome) and redirects to the new `/spark/lesson/{sessionId}` even when other sessions already exist.
- Plan header (web `/spark/lesson/{sessionId}`) displays the session-level summary when available, falling back to the tagline and then the first plan item; individual plan item summaries remain short (<= 15 words) for the timeline rows.
- Plan timeline icons/meta (web `/spark/lesson/{sessionId}`): `plan[].icon` is a single emoji (rendered as text) and must not be an icon library identifier (e.g. "Bolt"). `plan[].meta` is optional and should be a short user-facing label (avoid internal breakdowns like "questions: 20; multiple-choice: ...").
- Code editor autosave (web `/spark/lesson/[sessionId]/p/[id]`): the learner's Python source mirrors into `state.items[planItemId].code`. Saves trigger when the user runs code, submits a solution, navigates away / closes the tab (via `keepalive` fetch), and on an edit throttle of ~10 s to avoid spamming Firestore.
- Problem submission flow: submit first re-runs every test. Submission is blocked until all tests pass, then a completion payload (including the latest code snapshot and run metadata) is sent to `/api/code/{sessionId}/update`. The handler grants XP once per problem based on difficulty, increments `stats.solvedCount`, records the event under `spark/{uid}/progress`, and the client shows a celebratory modal with XP earned plus an “OK” action that routes back to the `/spark/lesson` dashboard.
- Media plan steps (intro/outro clips) route to `/spark/lesson/{sessionId}/m/{planItemId}`. The page renders a timeline-synced player that relies on keyboard left/right navigation (no on-screen arrow controls), a large slide canvas that bleeds edge-to-edge (no frame padding, fixed 16:9), a fixed-height subtitle banner sized for up to two lines of the current caption (no speaker label), and a control bar with an icon-only play/pause control that flips to a replay icon once playback reaches the final 50ms window, plus the speaker toggle, timestamp, and progress scrubber. Slides reuse the non-question card styling; seeking via the keyboard shortcuts or slider also seeks the audio element. All slide images preload before playback or navigation becomes available, with a centered spinner shown in the card and the controls disabled until everything is ready. If any image fails to load we surface an inline error message in the card with a `Retry` button that re-attempts the preload. The server returns a short-lived signed URL derived from the Firebase Storage object to stream the MP3. While the clip is in progress a compact circular `×` button floats over the card header and opens the same gradient “Take a break?” dialog used in quizzes (copy tweaked for media, actions `Keep watching` / `Quit now`). After the clip finishes (or when the plan item was already marked complete) the same `×` routes straight back to `/spark/lesson/{sessionId}` without surfacing the dialog, re-affirming completion as needed; there is no separate `Done` button. When present, the optional `posterImage` is shown at the very start for 50ms (no Ken Burns), and the optional `endingImage` is shown for the final 50ms; transitions into/out of these frames use the same image fade as other slides.
- Media plan steps (intro/outro clips) route to `/spark/lesson/{sessionId}/m/{planItemId}`. The page renders a timeline-synced player that relies on keyboard left/right navigation (no on-screen arrow controls), a large slide canvas that bleeds edge-to-edge (no frame padding, fixed 16:9), a fixed-height subtitle banner sized for up to two lines of the current caption (no speaker label), and a control bar with an icon-only play/pause control that flips to a replay icon once playback reaches the final 50ms window, plus the speaker toggle, timestamp, and progress scrubber. Slides reuse the non-question card styling; seeking via the keyboard shortcuts or slider also seeks the audio element. All slide images preload before playback or navigation becomes available, with a centered spinner shown in the card and the controls disabled until everything is ready. If any image fails to load we surface an inline error message in the card with a `Retry` button that re-attempts the preload. Audio/images stream via the authenticated `/api/media` endpoint which proxies bytes from Firebase Storage via the Storage JSON API. While the clip is in progress a compact circular `×` button floats over the card header and opens the same gradient “Take a break?” dialog used in quizzes (copy tweaked for media, actions `Keep watching` / `Quit now`). After the clip finishes (or when the plan item was already marked complete) the same `×` routes straight back to `/spark/lesson/{sessionId}` without surfacing the dialog, re-affirming completion as needed; there is no separate `Done` button. When present, the optional `posterImage` is shown at the very start for 50ms (no Ken Burns), and the optional `endingImage` is shown for the final 50ms; transitions into/out of these frames use the same image fade as other slides.
- `spark/{uid}/progress/{docId}`: server-managed bookkeeping for awarded milestones (quiz, code, or media completions). Docs store `{ sessionId, planItemId, xpAwarded, createdAt, quizId?, problemId?, difficulty?, language?, mediaId?, durationSec? }` so XP increments remain idempotent across retries.
- `summary/{uid}/current`: latest 2–3 bullet summary plus timestamp and underlying attempt refs.
- `quizzes/{quizId}`: quiz metadata; subcollection `questions/{questionId}` storing prompt, answer, type, mark scheme/rubric, board tagging, plus explanations only for multiple-choice questions.
- `attempts/{uid}/{attemptId}`: per question attempts with grading outcome, rubric reference, numeric tolerance info.
- Indexing: composite indexes on (`uid`, `status`, `updatedAt`) for requests, and (`uid`, `createdAt`) for quizzes/attempts.

## 8) Background Processing & WaitUntil Strategy

- Every API handler returns within <1s by pushing heavy work into `waitUntil(async () => { ... })` on the runtime execution context.
- Workflows encapsulated in pure async functions that:
  1. Fetch source materials from Firebase Storage (Storage JSON API via service account).
  2. Run OCR/PDF parsing (Tesseract or Google Cloud Vision) and send prompts to LLM provider.
  3. Validate LLM outputs against schema (proto + zod) and board rules.
  4. Write incremental progress to Firestore so clients render streaming feedback.
  5. Finalize by writing quiz documents and updating `requests`/`client.events` to `ready` or `failed`.
- On failure, ensure error is written to Firestore and surfaced to client; WaitUntil promise resolves even when the client is offline.
- For high-latency tasks, consider chunking status updates to stay under Firestore write limits (e.g., throttle to 1 write / 2s per job).

## 9) LLM Guardrails & Prompting

- LLM providers: Gemini (Vertex AI) and OpenAI (Responses API / ChatGPT Codex backend). The shared wrapper defaults OpenAI API text calls to `gpt-5.4-mini` with `reasoning: { effort: "medium" }` when an OpenAI model is selected. Spark chat (`POST /api/spark/agent/messages`) uses `chatgpt-gpt-5.4` with `thinkingLevel: "medium"`, and Spark run-agent execution (`packages/llm/src/agent/sparkAgentRunner.ts`) also uses `chatgpt-gpt-5.4` with `thinkingLevel: "medium"`. When Spark agent subagents are enabled, Spark keeps the Codex prompt pattern and Spark itself chooses the same parent model rather than letting the model choose an arbitrary subagent backend. Free-text grading uses `gemini-flash-latest`.
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

- Cloud Run troubleshooting: when native bindings (e.g., `sharp`) misbehave in production, validate the image locally before redeploying. Docker path: `docker build -f web/Dockerfile -t spark-web-local .`, then `docker run --rm -e PORT=8080 -p 8080:8080 spark-web-local`, then `curl http://127.0.0.1:8080`.
- Local standalone Bun path: `bun --cwd=web run build:bun`, then `PORT=8080 bun --cwd=web run start:bun`, then `curl http://127.0.0.1:8080`.
- Apple `container` path (Apple silicon, macOS 26+): run `container system start` once, optionally `container builder start --cpus 8 --memory 16g` for faster Bun builds, then `container build -f web/Dockerfile -t spark-web-local .`, `container run --name spark-web-local-test --detach --rm -e PORT=8080 -p 8080:8080 spark-web-local`, and `curl http://127.0.0.1:8080`. Local builds read `web/.env.local`; Cloud Build populates that same file via `web/write_dotenv.py` from Secret Manager. The first Apple `container` build/run is materially slower because it bootstraps the kernel, BuildKit VM, init image, and local snapshot import, so reserve it for deployment-specific debugging rather than routine development.
