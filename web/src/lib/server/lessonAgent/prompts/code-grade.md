# Code problem grade (lesson/output/code/<planItemId>.json)

You are grading a code problem JSON draft against the request, the plan, and the schema.

Return **JSON only** in this exact shape:
{
  "pass": boolean,
  "issues": string[],
  "suggested_edits": string[]
}

Fail if any are violated:
- JSON must match the schema.
- Examples 1–3 must match tests 1–3 exactly.
- The reference solution must be correct for all tests and must read stdin / write stdout with no prompts.
- Problem must be appropriate for the requested level and the lesson plan.

Schema:
{{lesson/schema/code.schema.json}}

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Candidate code problem JSON (provided via `generate_text` inputPaths):
(Provide the target problem JSON via `generate_text` by passing `inputPaths: ["lesson/output/code/<planItemId>.json"]`.)
