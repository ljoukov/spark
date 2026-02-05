# Session grade (lesson/output/session.json)

You are grading a Spark Session JSON draft against the request and the schema.

Return **JSON only** in this exact shape:
{
  "pass": boolean,
  "issues": string[],
  "suggested_edits": string[]
}

Grading rules (fail if any are violated):
- JSON must match the schema.
- Must respect `lesson/requirements.md` decisions (quiz-only vs coding, media only if explicitly requested).
- `plan` ids must be unique and file-friendly (no spaces; prefer `q1`, `p1`, etc).
- `plan` titles must be short, action-oriented, and reflect what the learner does.
- Must fit the requested level and duration; avoid overstuffing or under-scoping.

Schema:
{{lesson/schema/session.schema.json}}

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Candidate session JSON:
{{lesson/output/session.json}}

