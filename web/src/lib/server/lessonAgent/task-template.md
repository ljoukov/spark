# Spark lesson creation task

Session ID: `{{SESSION_ID}}`  
Workspace ID: `{{WORKSPACE_ID}}`

## Request summary

- Topic: {{TOPIC}}
- Title (optional): {{TITLE}}
- Level (optional): {{LEVEL}}
- Goal (optional): {{GOAL}}
- Plan preferences (optional):
{{PLAN_ITEMS_BULLETS}}
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

- `lesson/schema/session.schema.json` — JSON schema for `lesson/output/session.json`
- `lesson/schema/quiz.schema.json` — JSON schema for `lesson/output/quiz/*.json`
- `lesson/schema/code.schema.json` — JSON schema for `lesson/output/code/*.json`
- `lesson/schema/media.schema.json` — JSON schema for `lesson/output/media/*.json` (only if media is requested)
- `brief.md` — authoritative user requirements

Notes:

- The publisher always uses the `sessionId` from the tool call.
- `createdAt` is preserved from the session stub the server created when this lesson was started.

## Required pipeline (do not skip)

1) Read `brief.md` + `request.json` + this file, then write hard requirements + key decisions to `lesson/requirements.md`.
2) Decide lesson shape:
   - If this is programming practice, include `kind="problem"` steps; otherwise make it quiz-only (no `problem` steps).
   - Only include `kind="media"` if the user explicitly asked for a story/audio clip.
   - If plan preferences are provided in this file, you must follow them exactly (number of plan items, and per-quiz question counts/types).
3) Generate -> grade -> revise loop (do not skip grading):
   - Use `generate_text` for drafting and grading (store prompts under `lesson/prompts/` and feedback under `lesson/feedback/`).
   - Prompt templates may include `{{path/to/file}}` placeholders to inline workspace files.
4) Ordering:
   - If coding is included: draft/verify problems first, then draft the session plan/quizzes from the verified problems.
   - Otherwise: draft the session plan first, then draft quizzes.
5) Write final JSON outputs under `lesson/output/` (use `generate_text` with `responseSchemaPath` pointing at `lesson/schema/*.schema.json`):
   - `lesson/output/session.json` — Session document (includes `plan[]`)
   - `lesson/output/quiz/<planItemId>.json` — for each `plan[]` item with `kind="quiz"`
   - `lesson/output/code/<planItemId>.json` — for each `plan[]` item with `kind="problem"`
   - `lesson/output/media/<planItemId>.json` — only if `kind="media"` exists (media is optional and should be rare)
6) Validate + publish:
   - Call `publish_lesson` with:
     - `sessionId: {{SESSION_ID}}`
     - `sessionPath: "lesson/output/session.json"`
     - `includeCoding: true|false` (based on whether you included `problem` steps)
     - `includeStory: true|false` (based on whether you included `media` steps)
   - If it fails, fix the files and retry until it returns `status="published"`.
7) Call `done` with a short summary: what you published + sessionId.

## Output quality bar

- Write in UK English.
- Keep plan item titles short and action-oriented (what the learner does).
- Avoid references to "the brief", "the user uploaded", page numbers, or internal pipeline.
- For code problems, ensure the reference solution passes all tests (use `python_exec` to verify).
