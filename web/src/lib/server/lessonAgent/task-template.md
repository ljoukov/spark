# Spark lesson creation task

Session ID: `{{SESSION_ID}}`  
Workspace ID: `{{WORKSPACE_ID}}`

## Request summary

- Topic: {{TOPIC}}
- Title (optional): {{TITLE}}
- Level (optional): {{LEVEL}}
- Goal (optional): {{GOAL}}
- Duration (optional): {{DURATION_MINUTES}}
- Materials (optional):
{{MATERIALS_BULLETS}}

## What you're building

You are creating a *Spark Lesson* (a "session") for a single user.

The final output must be Firestore-ready JSON files under `lesson/output/` that can be published by calling the `publish_lesson` tool.

- `lesson/output/session.json` — Session document (includes `plan[]`)
- `lesson/output/quiz/<planItemId>.json` — QuizDefinition docs, one per plan item with `kind="quiz"`
- `lesson/output/code/<planItemId>.json` — CodeProblem docs, one per plan item with `kind="problem"`
- `lesson/output/media/<planItemId>.json` — SessionMediaDoc docs, only if the user explicitly requested a story/audio clip and the plan includes `kind="media"`

## Schema / validation

Read these files before writing outputs:

- `lesson/schema/firestore-schema.json` — JSON schemas for session/quiz/code/media docs (field definitions + constraints)
- `brief.md` — authoritative user requirements

Notes:

- The publisher always uses the `sessionId` from the tool call.
- `createdAt` is preserved from the session stub the server created when this lesson was started.

## Required pipeline (do not skip)

1) Read `brief.md` and write hard requirements + assumptions to `lesson/plan.md`.
2) Decide lesson shape:
   - If this is programming practice, include `kind="problem"` steps; otherwise make it quiz-only (no `problem` steps).
   - Only include `kind="media"` if the user explicitly asked for a story/audio clip.
3) Draft content:
   - Optional: put working notes in `lesson/drafts/` (Markdown is fine).
4) Create final Firestore JSON outputs under `lesson/output/`:
   - Ensure every `plan[]` item has a matching JSON doc file (quiz/problem/media).
   - Quiz docs must include a non-empty `progressKey` (if unsure, use `lesson:{{SESSION_ID}}:<quizId>`).
5) Validate + publish:
   - Call `publish_lesson` with:
     - `sessionId: {{SESSION_ID}}`
     - `sessionPath: "lesson/output/session.json"`
     - `includeCoding: true|false` (based on whether you included `problem` steps)
     - `includeStory: true|false` (based on whether you included `media` steps)
   - If it fails, fix the files and retry until it returns `status="published"`.
6) Call `done` with a short summary: what you published + sessionId.

## Output quality bar

- Write in UK English.
- Keep plan item titles short and action-oriented (what the learner does).
- Avoid references to "the brief", "the user uploaded", page numbers, or internal pipeline.
- For code problems, ensure the reference solution passes all tests (use `python_exec` if needed).
