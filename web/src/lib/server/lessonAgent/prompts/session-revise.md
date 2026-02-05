# Session revise (lesson/output/session.json)

You are revising a Spark Session JSON draft to address a grading report.

Return **JSON only** (start with `{` and end with `}`), matching the schema.

Rules:
- Do **not** include `id`, `createdAt`, `status`, or `nextLessonProposals`.
- Fix every issue in the grading report.
- Keep plan item ids stable unless the grading report requires changing them.

Schema:
{{lesson/schema/session.schema.json}}

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Grading report:
{{lesson/feedback/session-grade.json}}

Current session JSON:
{{lesson/output/session.json}}

