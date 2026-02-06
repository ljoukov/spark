# Lesson publishing schemas

These JSON schema files describe the workspace outputs that `publish_lesson` reads, validates, and writes to Firestore:

- `session.schema.json` → `lesson/output/session.json` (session doc)
- `quiz.schema.json` → `lesson/output/quiz/<planItemId>.json` (QuizDefinition doc, per quiz plan item)
- `coding_problem.schema.json` → `lesson/output/code/<planItemId>.json` (CodeProblem doc, per coding_problem plan item)
- `media.schema.json` → `lesson/output/media/<planItemId>.json` (SessionMediaDoc doc, per media plan item)

Notes:

- The publisher always uses the `sessionId` passed to the tool (and preserves `createdAt` from the existing session stub).
- `session.plan[]` is authoritative for which quiz/coding_problem/media documents must exist.
