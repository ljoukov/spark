# Quiz draft (lesson/output/quiz/<planItemId>.json)

You are generating the QuizDefinition JSON for **one** plan item with `kind="quiz"`.

Before writing, identify the **target quiz plan item id** from `lesson/requirements.md` (or from a tool instruction).

Return **JSON only** (start with `{` and end with `}`), matching the schema.

Rules:
- Write in **UK English**.
- Do not include `id` or `progressKey` (the publisher will set these from the plan item id).
- Include a non-empty `gradingPrompt` suitable for the subject/level.
- If `lesson/requirements.md` specifies an exact question count or question-kind mix for this quiz plan item, follow it exactly.
- Questions must be self-contained and must not reference internal pipeline, file names, or “the brief”.
- Include some `type-answer` questions with `marks` and a bullet `markScheme`.

Schema:
{{lesson/schema/quiz.schema.json}}

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Session context:
{{lesson/output/session.json}}
