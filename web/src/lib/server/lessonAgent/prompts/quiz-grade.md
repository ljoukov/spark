# Quiz grade (lesson/output/quiz/<planItemId>.json)

You are grading a quiz JSON draft against the request, the session plan, and the schema.

Return **JSON only** in this exact shape:
{
  "pass": boolean,
  "issues": string[],
  "suggested_edits": string[]
}

Fail if any are violated:
- JSON must match the schema.
- `gradingPrompt` must be present and helpful for marking type-answer questions.
- Question ids must be unique within the quiz.
- Answers and mark schemes must be unambiguous and match the question prompt.
- The quiz must align with the target plan item, the requested level, and any plan preferences in `lesson/requirements.md` (question counts/types).

Schema:
{{lesson/schema/quiz.schema.json}}

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Session context:
{{lesson/output/session.json}}

Candidate quiz JSON:
(Provide the target quiz JSON via `generate_text` by passing `inputPaths: ["lesson/output/quiz/<planItemId>.json"]`.)
