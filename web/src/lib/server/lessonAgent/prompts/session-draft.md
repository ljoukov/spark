# Session draft (lesson/output/session.json)

You are generating the **Spark Session** JSON for a single learner.

Return **JSON only** (start with `{` and end with `}`), matching the schema.

Rules:
- Write in **UK English**.
- Do **not** include `id`, `createdAt`, `status`, or `nextLessonProposals` (the publisher will set these).
- `topics` must be a non-empty array of short strings.
- `plan` must be non-empty and every plan item must have a unique `id`.
- Use short, stable ids like `q1`, `q2`, `p1`, `p2`, `m1`.
- If `lesson/requirements.md` contains plan preferences (number of items, quiz question counts/types), follow them exactly and reflect quiz counts in `plan[].meta` (e.g. "8 questions").
- `kind="media"` only if the learner explicitly requested a story/audio clip.
- If the lesson is not programming practice, make it quiz-only (no `kind="problem"` items).

Schema:
{{lesson/schema/session.schema.json}}

Decisions + constraints (authoritative):
{{lesson/requirements.md}}

User request (authoritative):
{{brief.md}}

Request metadata:
{{request.json}}
