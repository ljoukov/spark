# Tutor Sessions Experimental Plan

Status: active
Owner: Codex rollout
Scope: experimental tutoring UI for graded olympiad problems

## Phase 1

Create the minimum viable tutoring loop:

1. New tutor-session schema and server repo helpers
2. Session creation from a grader problem report
3. `/spark/sessions` list page
4. `/spark/sessions/[sessionId]` detail page
5. Workspace-driven UI files
6. Full-turn agent runs that update tutor screen files
7. Debounced draft-feedback endpoint that updates inline-feedback files
8. Grader problem CTA to create/open tutor sessions

## Deliverables

- `packages/schemas/src/sparkTutorSession.ts`
- tutor-session server repo helpers under `web/src/lib/server/`
- API routes under `web/src/routes/api/spark/sessions/`
- `/spark/sessions` and `/spark/sessions/[sessionId]` routes
- tutor-mode support in `packages/llm/src/agent/sparkAgentRunner.ts`
- minimal experimental docs only; avoid broad `docs/SPEC.md` edits

## Detailed Plan

### Step 1. Session contract

- add tutor-session Zod schemas
- export them from `packages/schemas/src/index.ts`
- include screen/composer json schemas when useful for server validation

### Step 2. Server helpers

- add tutor-session repo module for create/get/list/patch
- add grader-problem extraction helper so tutor session creation can reuse report parsing
- add workspace seeding helpers for tutor context/ui files

### Step 3. Full-turn runtime

- extend `runSparkAgentTask` to detect tutor-session agent docs
- add tutor-specific tools for screen updates
- add prompt builder for:
  - initial turn
  - reply turn
  - hint turn
- patch tutor-session doc status during run lifecycle

### Step 4. Draft feedback runtime

- add synchronous endpoint for draft feedback
- validate latest-revision-wins semantics
- overwrite only inline-feedback files

### Step 5. UI

- implement `/spark/sessions` list page
- implement `/spark/sessions/[sessionId]` detail page with:
  - top tutor panel
  - context drawer
  - ghost-text composer
  - confidence selector
  - send + hint actions
- subscribe to workspace file updates and session doc updates

### Step 6. Grader integration

- add `Start tutor session` CTA on grader problem page
- if a matching tutor session already exists for the same problem, show `Open session`

### Step 7. Validation

- run targeted typechecks
- run local dev server
- log in with test user
- create/open a tutor session from a grader problem
- verify top panel and inline guidance update from workspace files

## Guardrails

- experimental only; no wide-ranging refactors
- do not overload the existing lesson `spark/{uid}/sessions` collection
- keep tutor UI render contract narrow and file-based
- keep `docs/SPEC.md` edits minimal or skip them if experimental docs are sufficient
