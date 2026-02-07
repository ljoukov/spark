# Code problem grade (lesson/drafts/code/<planItemId>.md)

You are grading a code problem **Markdown** draft against the request, the plan, and the requirements.

Return **Markdown only** in this exact shape:

# Grade
pass: true|false

## Issues
- ...

## Suggested edits
- ...

If pass: true:
- `## Issues` MUST contain exactly `- (none)`.
- `## Suggested edits` MUST contain exactly `- (none)`.

Fail if any are violated:
- Draft must follow the required format in the code problem draft prompt.
- Examples 1–3 must match tests 1–3 exactly.
- The reference solution must be correct for all tests and must read stdin / write stdout with no prompts.
- Problem must be appropriate for the requested level and the lesson plan.
- Problem copy must meet the length guidance in the code problem draft prompt (keep it concise).
- Any maths/science equations or formulas in Markdown fields must be written as LaTeX using `$...$` (inline) or `$$...$$` (display).
- Fail if any `$...$` / `$$...$$` formula is wrapped in backticks (inline code), since that produces `<code>` instead of rendered math.

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Candidate code problem Markdown:
The candidate problem Markdown is provided in the attached files section.
Exactly one file should be attached:
- `lesson/drafts/code/<planItemId>.md`

If no candidate problem file is attached, fail with `pass: false` and explain what is missing.
