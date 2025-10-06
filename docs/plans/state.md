# Sessions, State, Stats, and Bookmarkable URLs — Plan

Last updated: 2025-10-06

Scope: design and implementation plan only (no code changes yet). Source of truth: docs/SPEC.md (requirements, data contracts).

## Overview

- Introduce per-user Sessions in Firestore under `spark/{userId}/sessions/{sessionId}` with `id` (human-readable), `title`, `createdAt`, and a `plan` of items (quiz or problem).
- Track current session per user in `spark/{userId}.currentSessionId`; if empty or invalid, select the latest by `createdAt`.
- Client reads/writes per-session realtime state at `spark/{userId}/state/{sessionId}` (only state is client-accessible; sessions are server-only).
- Quiz definitions live under `spark/{userId}/sessions/{sessionId}/quiz/{quizId}` and coding problems under `spark/{userId}/sessions/{sessionId}/code/{problemId}`; only the server accesses these docs.
- Add read-only user `stats` to `spark/{userId}`: `xp`, `level`, `streakDays`, `solvedCount`.
- Replace hardcoded plan in `/code` with server-provided session and make routes bookmarkable: `/code/[sessionId]`, `/code/[sessionId]/quiz/[id]`, `/code/[sessionId]/p/[id]`.
- Provide a trivial session generation script for the test user only; it writes a fixed session (no LLM) into Firestore and sets `currentSessionId`.

## Packages

- packages/schemas (new, shared)
  - Purpose: centralize Zod schemas and inferred TS types; client-safe (zod only), consumed by both `web` and `eval` apps.
  - Files
    - `packages/schemas/src/session.ts`: `PlanItemSchema`, `SessionSchema`.
    - `packages/schemas/src/sessionState.ts`: `PlanItemStateSchema`, `SessionStateSchema`.
    - `packages/schemas/src/stats.ts`: `UserStatsSchema`.
    - `packages/schemas/src/user.ts`: user doc schema with `currentSessionId?: string`, `stats?: UserStats`.
    - `packages/schemas/src/index.ts`: re-exports schemas and `z.infer` types.
  - Config: ESM, TS project refs; dependency only on `zod`. Wire into workspace so `web` and `eval` import from `@spark/schemas`.

- packages/llm (existing, shared server)
  - For now, export `getTestUserId()` here so both `web` and `eval` can import it. We may later rename this package to `packages/shared-server`.

Note: We are deliberately keeping schemas separate from any LLM deps to remain browser-safe.

## Data Model (Firestore)

- `spark/{userId}` (document)
  - `currentSessionId?: string`
  - `stats?: { xp: number, level: number, streakDays: number, solvedCount: number }`
  - Other existing user fields remain unchanged.
- `spark/{userId}/sessions/{sessionId}` (document)
  - `SessionSchema`: `{ id: string, title: string, createdAt: Timestamp, plan: PlanItem[] }` where `id` is the human-readable session identifier used in URLs and stored as the document ID.
  - `PlanItem`: `{ id: string, kind: 'quiz' | 'problem', title: string }`
  - Note: Ensure plan item shape matches what `/code` currently expects so URLs remain stable.
- `spark/{userId}/state/{sessionId}` (document)
  - `SessionStateSchema`: `{ sessionId: string, items: Record<planItemId, PlanItemState>, lastUpdatedAt: Timestamp }`
  - `PlanItemState`: `{ status: 'not_started' | 'in_progress' | 'completed', score?: number, startedAt?: Timestamp, completedAt?: Timestamp }`

All Firestore reads/writes validated with `@spark/schemas` using Zod; normalize shapes via `transform()` where appropriate.

## Server Repos (web, Admin SDK)

- `web/src/lib/server/session/repo.ts`
  - `saveSession(userId, session)`
  - `getSession(userId, sessionId)`
  - `listSessions(userId, limit?)` ordered by `createdAt` desc
  - `setCurrentSessionId(userId, sessionId)` and `getCurrentSessionId(userId)`
  - `getOrSelectCurrentSession(userId)`: return `currentSessionId` if valid; else latest session; if none, throw.
- `web/src/lib/server/user/repo.ts`
  - `getUserDoc(userId)` and `getUserStats(userId)`; parse with `UserStatsSchema`.
- `web/src/lib/server/firebase/admin.ts`
  - Admin SDK bootstrap (reuse if present).

## Session ID

- The session `id` is a human-readable short identifier generated as part of session creation. It is the only identifier for a session (no UUID) and must be unique per user. Implementation details are internal and not exposed in this plan.

## Session Generation (Test User Only)

- Move CLI to `eval/src/code/session/generateTestSession.ts`.
  - Uses `getTestUserId()` for the single allowed user.
    - Import from `packages/llm` (shared server package), to be renamed to `packages/shared-server` later.
  - Creates a fixed session with a simple static plan for now (no LLM). The client never embeds plans; it only reads from Firestore.
  - Builds `Session` with `id` (generated human-readable short id), `title`, `createdAt` (server timestamp), and `plan`.
  - Writes via `saveSession()` and sets `currentSessionId` on the user doc.
  - Guard: exit unless operating on the test user.
  - Add npm script in `eval`: `"session:generate": "tsx src/code/session/generateTestSession.ts"`.


## Web Routing (Bookmarkable)

- Redirect `/code` → `/code/<currentSessionId>`
  - `web/src/routes/code/+page.server.ts`: resolves the user’s `currentSessionId` server-side; 302 to `/code/[sessionId]`.
- Bookmarkable routes under a session container
  - `web/src/routes/code/[sessionId]/+layout.server.ts`: load session by `params.sessionId`, along with `stats` and `userId`.
  - `web/src/routes/code/[sessionId]/+layout.svelte`: provide `data.session`, `data.stats`, `data.userId` to children.
  - `web/src/routes/code/[sessionId]/+page.svelte`: render plan from `data.session.plan`.
  - `web/src/routes/code/[sessionId]/quiz/[id]/+page.ts`: resolve item from `parent().data.session.plan` by `id`.
  - `web/src/routes/code/[sessionId]/p/[id]/+page.ts`: resolve problem items similarly.
- Update all internal links to include `sessionId` in the path.

## Client Session State and Stats

- `web/src/lib/client/sessionState.ts`
  - `createSessionStateStore(userId, sessionId)` using Web SDK `onSnapshot` on `spark/{userId}/state/{sessionId}`.
  - Parse snapshots with `SessionStateSchema` and expose helpers like `updateItem()` and `markStatus()`.
- `web/src/lib/client/user.ts` (or existing store)
  - Parse `stats` from `/spark/{userId}` using `UserStatsSchema` (read-only client side).

## Docs

- Update `docs/SPEC.md`
  - Firestore structure for sessions, state, and stats.
  - Location of schemas in `packages/schemas` and validation policy with Zod.
  - Statement that sessions are server-delivered; clients never read `sessions` directly.
  - Note that a human-readable session `id` is generated during session creation and used as the only identifier (mechanism unspecified here).
 

## Security Rules (follow-up)

- Clients may:
  - Read `/spark/{userId}` (for `stats`) and `/spark/{userId}/state/{sessionId}` for their own `userId`.
- Clients may not:
  - Read or write `/spark/{userId}/sessions/*`.
- Update `firestore.rules` to enforce the above. (Planned, not implemented in this pass.)

## Assumptions and Constraints

- Trivial generator runs only for the test user returned by `getTestUserId()`.
- Server updates `stats` in the future; client reads only. Do not implement server-side stats updates yet.
- Zod is used for all external inputs (Firestore payloads, env, request params); validation errors produce clear 4xx responses.
- SvelteKit server uses Admin SDK for Firestore; client uses Web SDK for realtime state.

## Open Questions

- None at this time.

## Decisions

- `getTestUserId()` is shared via `packages/llm` (to be renamed to `packages/shared-server` later) and imported by both `web` and `eval`.
- The human-readable session `id` is the only identifier, is used in URLs and stored as the session document ID (no UUID).

## Acceptance Criteria

- Schemas live in `packages/schemas` and are imported by both `web` and `eval`.
- Sessions stored under `spark/{userId}/sessions/{sessionId}` with validated shape; user doc updated with `currentSessionId` (same value as the human-readable session `id`).
- `/code` redirects to `/code/[sessionId]`; child routes resolve items from the loaded session.
- Client can read/write session state for the active session; stats are readable from the user doc.
- Trivial generator creates a session for the test user and sets it as current.
