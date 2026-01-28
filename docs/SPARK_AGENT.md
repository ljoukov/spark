# Spark AI Agent Requirements (Draft)

Status: draft
Scope: logged-in home layout and core AI experience for the web app only (redesign of `/spark`; iOS is out of scope)
Source of truth for platform + APIs: `docs/SPEC.md`

## Terminology

- Use the product term "Spark AI Agent" in UI and docs.
- Avoid "assistant" in user-facing copy.

## Home Layout

- The logged-in home is a single chat stream centered on Spark AI Agent.
- Web home route is `/spark` (see `docs/SPEC.md` for local test-user login steps).
- The stream is a continuous list of messages (no summary sections).
- Tasks appear as sections inside the same stream (not separate tabs).
- Keep the visible scroll depth limited (target: ~5x screen height). Older content is pulled in as collapsed sections on demand.

## Core Capabilities (Target)

- Spark AI Agent can run multiple tasks in parallel (limit: 3 concurrent tasks per user).
- Example tasks include:
  - Creating lessons.
  - Planning multiple lessons.
  - Reviewing uploaded work interactively.

## Task Model (Future, Not in Phase 1)

- Tasks have visible status in the stream (e.g., queued, running, waiting on user, completed, failed).
- A task can emit multiple updates that append to the same section rather than creating new sections.
- Task history must remain readable after completion (summary + key outputs).
- Background tasks triggered by tool calls may exist in Phase 1, but they do not surface as user-visible task sections yet.

## Conversation Model (Firestore, Draft)

- Store each conversation as a single Firestore document with an append-only `messages` array.
- Messages follow an OpenAI Response API-like shape, with an extra `author` object on `role = "user"` messages to track who posted.
- The UI is rendered from the conversation document alone (no separate message collection in Phase 1).
- Firestore should be client-safe: user-facing data lives under `/{userId}/client/**` and is read-only from clients. All writes go through the server.
- Other users’ documents are never readable by a client (server-only access).

Proposed document shape (draft):

```
/{userId}/client/conversations/{conversationId}
  - id: string
  - familyId?: string
  - participantIds: string[] (user ids)
  - createdAt: Timestamp
  - updatedAt: Timestamp
  - lastMessageAt: Timestamp
  - messages: Message[]

Message
  - id: string
  - role: "user" | "assistant" | "tool" | "system"
  - author?: { userId: string; displayName?: string; role?: "parent" | "dependent" }
  - createdAt: Timestamp
  - content: ContentPart[]  // ordered list of parts

ContentPart
  - type: "text" | "image" | "file" | "tool_call" | "tool_result"
  - text?: string
  - file?: { storagePath: string; contentType: string; sizeBytes: number; pageCount?: number }
  - toolCall?: { id: string; name: string; argsJson: string }
  - toolResult?: { toolCallId: string; outputJson: string; status: "ok" | "error" }
```

Notes:
- Phase 1 assumes the server is the only writer that appends messages to avoid ordering conflicts.
- When a user sends a message to another user, the backend writes it into both users’ conversation docs (source + destination), so each user renders from their own client-safe path without joins.
- Firestore document size limit (1 MB) may require future rollover/chunking; keep an eye on conversation growth.
- Schema should live in `packages/schemas` (browser-safe) and be consumed by web + server.

## Firestore Security Rules (Draft)

- Allow read-only access to `/{userId}/client/**` for the authenticated `userId`.
- Deny all client writes under `/{userId}/client/**`.
- Deny reads of any other userId subtree.
- Server uses Admin SDK to write (rules do not apply).

## Family System & Messaging

- Users can create a family via invite link.
- Family members have parent or dependent roles (permission model TBD).
- Default expectation: family members can message each other through Spark AI Agent so it can read, summarize, and act on messages.
- Messaging can also be sent verbatim to a specific member or a whole family channel; the UI treatment for this needs experimentation.
- Lesson progress visibility: generally available to all family members (role-based refinements TBD).
- Privacy: users must be able to opt out of AI reading family messages (behavior details TBD).

## Input, Voice, and Accessibility

- The Spark AI Agent input supports text plus attachments (images and PDFs).
- Upload constraints follow platform defaults: JPEG/PNG (normalized to JPEG) and PDFs, max 25 MB per upload.
- Voice mode supports both live audio and push-to-talk; transcripts are always visible.
- In voice mode, Spark AI Agent can still produce visual output.
- Visual outputs must have text descriptions so the voice experience can describe them when needed.

## Message Routing (Phase 1)

- When a user submits a message, the server decides how to handle it.
- Phase 1: always forward to the agent LLM and stream the response back into the same conversation.
- Future: allow direct (verbatim) messages to specific users or family channels without waiting on LLM processing, while still letting the agent observe and react.
- Streaming writes should be throttled to at most one Firestore update every 500 ms.

## Agent Runtime (Draft)

- Two message classes:
  1) Plain user messages → regular LLM responses streamed to the client.
  2) Tool-eligible messages → LLM emits tool calls (e.g., create a lesson).
- Streaming path:
  - The API uses SSE to stream LLM tokens back to the client (same pattern as free-text grading in Code quizzes).
  - The assistant response is also persisted to Firestore with throttled updates (≤ 1 write / 500 ms).
- Tool calls:
  - If the LLM emits a tool call, the server enqueues a long-running task and ends the original HTTP response.
  - Task execution and progress updates are delivered via Firestore updates to the conversation doc (no SSE for tasks).
- Long-running tasks:
  - Routed through GCP Tasks using `createTask(task: Task): Promise<void>`.
  - Task handlers append tool results / assistant follow-ups into the same conversation doc.

## Minimal API Contract (Phase 1, Draft)

Single endpoint is sufficient; the server creates the conversation if needed.

`POST /api/spark/agent/messages`

Request body (JSON, draft):

```
{
  "conversationId": "optional string",
  "text": "string",
  "attachments": [
    { "storagePath": "string", "contentType": "string", "sizeBytes": 12345 }
  ],
  "targetUserId": "optional string" // for future verbatim delivery
}
```

Response modes (draft):

SSE stream (interactive LLM response):

- `Content-Type: text/event-stream`
- Stream assistant tokens/events as they are generated.
- End the stream once the assistant response is complete or a tool call is emitted.

Ack-only JSON (fallback / non-streaming clients):

```
{
  "conversationId": "string",
  "messageId": "string"
}
```

Notes:
- Clients listen to Firestore for the canonical message history.
- The API streams assistant tokens via SSE; Firestore remains the source of truth for the rendered conversation.
- Auth uses Firebase ID tokens; local testing signs in with the test user credentials described in `docs/SPEC.md`.
- Prefer 200 for SSE streams; 202 for ack-only JSON responses.
- SSE is limited to assistant token streaming; task scheduling stays internal and only shows up via conversation updates.

## Data & Realtime Sync

- Conversation state and any task-related progress updates are stored in Firestore.
- The UI relies on Firestore realtime updates, including updates across users.

## Non-Goals (v1)

- Separate task tabs or multi-pane task dashboards.
- Internationalization (UK English only; see `docs/SPEC.md`).
- Teacher dashboards.

## Implementation Plan (Draft)

Phase 1 (now):
- Web `/spark` redesign only (iOS excluded).
- Conversation document in Firestore + realtime rendering.
- SSE streaming for agent responses; Firestore as the source of truth.
- Tool-call background tasks routed via GCP Tasks (no user-visible task sections, no summaries).

Phase 2 (later):
- Task system with statuses and section summaries.
- Direct messaging UX (verbatim) plus role-based family permissions.

## Open Questions / TBD

- Parent vs dependent permissions and visibility rules.
- Which actions Spark AI Agent is allowed to take from messages.
- Final UX for verbatim messaging vs AI-mediated messaging.
- Details of the AI opt-out experience and fallback behaviors.
- Exact task status taxonomy + how status maps to UI affordances.
- Sectioning rules (what triggers a new section, how TOC labels are generated).
- Stream pagination policy (when older sections are fetched or collapsed).
