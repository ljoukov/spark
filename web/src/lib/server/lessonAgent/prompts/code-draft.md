# Code problem draft (lesson/output/code/<planItemId>.json)

You are generating a **CodeProblem** JSON for **one** plan item with `kind="problem"`.

Return **JSON only** (start with `{` and end with `}`), matching the schema.

Rules:
- Language is **Python** only.
- Do not include `slug` (the publisher will set it from the plan item id).
- Provide exactly 3 examples and at least 3 tests.
- Tests 1–3 must match examples 1–3 exactly (same input/output).
- The reference solution must solve all tests.
- Keep stdin/stdout plain text (whitespace-tokenised); do not require JSON parsing.

Schema:
{{lesson/schema/code.schema.json}}

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Session context:
{{lesson/output/session.json}}

