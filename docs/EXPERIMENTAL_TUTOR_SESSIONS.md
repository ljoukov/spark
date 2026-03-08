# Experimental Tutor Sessions

Status: experimental
Scope: `/spark/sessions` and `/spark/sessions/[sessionId]` only
Do not treat this document as a stable product contract. Keep `docs/SPEC.md` changes minimal while the design is still moving.

## Goal

Create a tutor surface for graded olympiad work that is not a chat transcript.

The screen should behave like a live coaching workspace:

- one current tutor response at the top
- one current student composer at the bottom
- lightweight gray inline guidance appears inside the composer while the student types
- richer tutor responses replace the top panel after committed student actions

The tutor should teach from the graded problem report, stay at the student's level, and focus on the most important proof/strategy gaps first.

## Key Product Decisions

### 1. Session route is first-class

The experience lives under:

- `/spark/sessions`
- `/spark/sessions/[sessionId]`

Tutor sessions should not be embedded into grader pages as the primary UI. Grader pages can launch or reopen a tutor session.

### 2. UI is filesystem-driven

The detail page renders from workspace files that the model updates.

Student typing is **not** bound directly to Firestore workspace files. The browser keeps the textarea locally. When we want model help, the browser sends a draft or action to the server, which triggers model work that updates workspace files. The UI then re-renders from those files.

Data flow:

`local input -> session API -> model turn -> workspace files -> UI`

### 3. Keep orchestration state separate from render state

Use:

- `spark/{uid}/tutorSessions/{sessionId}` for routing, status, source pointers, and list metadata
- `users/{uid}/workspace/{workspaceId}/files/*` for render-state markdown/json files

Do **not** use `spark/{uid}/sessions/{sessionId}` because that namespace is already used for lesson sessions.

### 4. Two model loops

There are two distinct interaction types:

- Draft feedback: debounced, lightweight, inline-only
- Full tutor turn: explicit student action, richer response, updates the main tutor panel

These should not be treated as the same runtime path.

## Routes

### `/spark/sessions`

Purpose:

- show the user's tutor sessions
- group by recency
- support simple search and status filtering

The list card should come from tutor-session doc metadata, not by reading whole workspaces.

### `/spark/sessions/[sessionId]`

Purpose:

- show the live tutoring screen for one session
- load routing metadata from the tutor-session doc
- subscribe live to workspace files for the screen state
- render the current screen from workspace files

Main regions:

- header: title, source problem, status
- tutor panel: current top-of-screen response from `ui/tutor.md`
- context drawer: problem statement, transcript, grading notes
- composer: local textarea with gray inline guidance from `ui/inline-feedback.md`

### Grader entry points

Add launch/reopen affordances on `/spark/grader/{runId}/{problemId}`:

- `Start tutor session`
- `Open session` when one already exists

## Tutor Session Doc

Suggested document:

`spark/{uid}/tutorSessions/{sessionId}`

Fields:

- `id`
- `workspaceId`
- `status`: `booting | awaiting_student | responding | completed | failed`
- `source`
- `title`
- `preview`
- `focusLabel?`
- `activeTurnAgentId?`
- `latestDraftRevision?`
- `createdAt`
- `updatedAt`
- `completedAt?`
- `error?`

### `source`

For v1, only:

- `kind: "grader-problem"`
- `runId`
- `problemId`
- `problemIndex`
- `problemTitle`
- `verdict?`
- `awardedMarks?`
- `maxMarks?`

The full grader context used by the tutor should be snapshotted into workspace files at session creation.

## Workspace Contract

Workspace files are the render-state API for the UI.

### Context files

- `context/problem.md`
- `context/official-solution.md`
- `context/student-transcript.md`
- `context/grading.md`
- `context/annotations.md`
- `context/overall-feedback.md`

### UI/state files

- `ui/tutor.md`
- `ui/inline-feedback.md`
- `state/session.json`
- `state/composer.json`
- `history/turns.jsonl`

### `state/session.json`

Suggested shape:

```json
{
  "status": "awaiting_student",
  "title": "Problem 8 tutor",
  "focusLabel": "Proof rigor",
  "draftRevision": 3,
  "updatedAt": "2026-03-08T12:00:00.000Z"
}
```

### `state/composer.json`

Suggested shape:

```json
{
  "placeholder": "Write your next thought here.",
  "disabled": false,
  "submitLabel": "Send",
  "allowConfidence": true,
  "confidenceLabel": "How sure are you?",
  "hintButtons": [
    {
      "id": "nudge",
      "label": "Need a nudge",
      "kind": "hint",
      "hintLevel": "nudge"
    },
    {
      "id": "pointer",
      "label": "Need a pointer",
      "kind": "hint",
      "hintLevel": "pointer"
    }
  ]
}
```

### `history/turns.jsonl`

Store only committed turns:

- initial tutor turn
- student submitted replies
- full tutor responses
- explicit hint actions

Do **not** store every debounced draft-feedback call as permanent history.

## Interaction Model

### Draft feedback

Triggered when the student types and the input debounce fires.

Input:

- current draft text
- draft revision counter

Output:

- overwrite `ui/inline-feedback.md`
- optionally patch `state/session.json` draft revision metadata

Constraints:

- latest revision wins
- draft responses should never overwrite `ui/tutor.md`
- draft feedback should be short and non-solution-giving

### Full tutor turn

Triggered by:

- initial session creation
- student submit
- explicit hint button
- continue button, if present later

Output:

- overwrite `ui/tutor.md`
- clear or replace `ui/inline-feedback.md`
- patch `state/composer.json`
- append committed event(s) to `history/turns.jsonl`
- patch tutor-session doc metadata (`status`, `preview`, `focusLabel`, timestamps)

## Runtime

### Full turns

Use background `runAgent` tasks.

Agent doc should include:

- `tutorSessionId`
- `tutorInteractionKind: "full_turn"`
- `tutorAction`

The agent should read workspace context/history files and update workspace state through tutor-specific tools.

### Draft feedback

Use a lighter server path, but still keep the same output contract: model work updates workspace files and the UI reacts to those file changes.

Draft feedback does not need to appear in `/spark/agents` or produce user-facing run history.

## Tutor tools

For tutor runs, prefer narrow UI/state tools over exposing generic file editing as the primary mechanism.

Suggested tools:

- `update_tutor_screen`
- `wait_for_student_input`
- `complete_tutor_session`

These tools write markdown/json files into the workspace and patch session metadata.

## UI notes

The composer should render gray inline guidance using an overlay/backdrop pattern:

- a relative wrapper
- a mirror layer using the same font and spacing
- transparent text for the student draft
- muted ghost text for `ui/inline-feedback.md`
- textarea remains the real input control on top

This should feel like Copilot-style ghost text rather than a popup tooltip.

## Non-goals for v1

- full transcript UI
- stable pedagogy policy engine
- polished persona switching
- teacher dashboard integration
- durable performance guarantees for high-frequency draft traffic

## Validation targets

- typecheck for `packages/schemas`, `packages/llm`, and `web`
- manual `/spark/grader/... -> Start tutor session -> /spark/sessions/[sessionId]` browser flow
- verify workspace files update live while the page is open
