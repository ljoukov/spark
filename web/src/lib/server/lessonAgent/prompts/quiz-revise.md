# Quiz revise (lesson/output/quiz/<planItemId>.json)

You are revising a quiz JSON draft to address a grading report.

Return **JSON only** (start with `{` and end with `}`), matching the schema.

Rules:
- Keep question ids stable unless the grading report requires changes.
- Fix every issue in the grading report.

Schema:
{{lesson/schema/quiz.schema.json}}

Session context:
{{lesson/output/session.json}}

Grading report:
{{lesson/feedback/quiz-grade.json}}

Current quiz JSON (provided via `generate_text` inputPaths):
(Provide the target quiz JSON via `generate_text` by passing `inputPaths: ["lesson/output/quiz/<planItemId>.json"]`.)
