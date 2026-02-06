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
   - Use `generate_text` to draft/revise **Markdown** under `lesson/drafts/` (avoid asking `generate_text` to emit large JSON).
   - Grade drafts with `generate_text` and store feedback **Markdown** under `lesson/feedback/` (must include `pass: true|false`).
   - Store feedback per plan item (do not overwrite when there are multiple items):
     - Quiz grade: `lesson/feedback/quiz/<planItemId>-grade.md`
     - Code grade: `lesson/feedback/code/<planItemId>-grade.md`
   - Prompt templates may include `{{path/to/file}}` placeholders to inline workspace files.
   - IMPORTANT: Quiz/code grade and revise prompts require `inputPaths` so the model can see the candidate draft (and grade report for revise).
     - Example (grade quiz q1):
       - `generate_text({ promptPath: "lesson/prompts/quiz-grade.md", inputPaths: ["lesson/drafts/quiz/q1.md"], outputPath: "lesson/feedback/quiz/q1-grade.md" })`
     - Example (revise quiz q1):
       - `generate_text({ promptPath: "lesson/prompts/quiz-revise.md", inputPaths: ["lesson/drafts/quiz/q1.md", "lesson/feedback/quiz/q1-grade.md"], outputPath: "lesson/drafts/quiz/q1.md" })`
   - Step limit optimisation: When operations are independent, batch tool calls in the same agent step.
     - Grade q1 and q2 in the same step (distinct output paths).
     - `generate_json` for session + all quizzes in the same step, then `validate_json` for all outputs in the same step.
4) Ordering:
   - If coding is included: draft/verify problems first, then draft the session plan/quizzes from the verified problems.
   - Otherwise: draft the session plan first, then draft quizzes.
5) Compile Firestore-ready JSON outputs under `lesson/output/` from the Markdown drafts:
   - Use `generate_json({ sourcePath, schemaPath, outputPath })` for each JSON output file.
   - Then run `validate_json({ schemaPath, inputPath })` and fix until `ok=true`.
   - Fixes can be done by editing the source Markdown and re-running `generate_json`, or by patching the JSON directly.
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
