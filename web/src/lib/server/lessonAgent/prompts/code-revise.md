# Code problem revise (lesson/output/code/<planItemId>.json)

You are revising a code problem JSON draft to address a grading report.

Return **JSON only** (start with `{` and end with `}`), matching the schema.

Rules:
- Fix every issue in the grading report.
- Keep the problem’s core idea stable unless the grading report requires a redesign.
- Keep examples/tests internally consistent with the reference solution.

Schema:
{{lesson/schema/code.schema.json}}

Grading report:
{{lesson/feedback/code-grade.json}}

Current code problem JSON (provided via `generate_text` inputPaths):
(Provide the target problem JSON via `generate_text` by passing `inputPaths: ["lesson/output/code/<planItemId>.json"]`.)
