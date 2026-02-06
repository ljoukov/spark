# Quiz grade (lesson/drafts/quiz/<planItemId>.md)

You are grading a quiz **Markdown** draft against the request, the session plan, and the requirements.

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
- Draft must follow the required format in the quiz draft prompt (Quiz section + Questions).
- `planItemId`, `title`, `description`, `gradingPrompt` must be present.
- Question ids must be unique within the quiz.
- Answers and mark schemes must be unambiguous and match the question prompt.
- The quiz must align with the target plan item, the requested level, and any plan preferences in `lesson/requirements.md` (question counts/types).
- Quiz/question copy must meet the length guidance in the quiz draft prompt (keep it concise and scannable).
- Any maths/science formulas included in Markdown fields should be formatted as LaTeX using `$...$` (inline) or `$$...$$` (display). Fail if the draft uses bare formulas like `V=IR` when LaTeX is appropriate.
- If the request asks for a **6-8 marker** free-text question (or similar), the `type-answer` question must have `marks` between **6 and 8** inclusive and must include a bullet `markScheme`.

Decisions + constraints:
{{lesson/requirements.md}}

User request:
{{brief.md}}

Session draft context:
{{lesson/drafts/session.md}}

Candidate quiz Markdown:
The candidate quiz Markdown is provided in the attached files section.
Exactly one file should be attached:
- `lesson/drafts/quiz/<planItemId>.md`

If no candidate quiz file is attached, fail with `pass: false` and explain what is missing.
