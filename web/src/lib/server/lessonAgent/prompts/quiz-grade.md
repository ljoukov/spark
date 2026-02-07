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
- Every `type-answer` question must include `marks` and a non-empty bullet `markScheme`.
- The quiz must align with the target plan item, the requested level, and any plan preferences in `lesson/requirements.md` (question counts/types).
- Quiz/question copy must meet the length guidance in the quiz draft prompt (keep it concise and scannable).
- Any maths/science equations or formulas included in Markdown fields must be formatted as LaTeX using `$...$` (inline) or `$$...$$` (display). Fail if the draft includes equation-like text (e.g. `V=IR`, `V = I × R`, `I = V / R`, `P ∝ I²`) that is not wrapped in LaTeX delimiters.
- Fail if any `$...$` / `$$...$$` formula is wrapped in backticks (inline code); LaTeX should render as math, not `<code>`.
- If the request asks for a **6-8 marker** free-text question (or similar):
  - You MUST explicitly check the numeric `marks` value on the `type-answer` question (do not assume it is correct).
  - Fail unless `marks` is between **6 and 8** inclusive and a bullet `markScheme` is present that clearly allocates those marks (prefer 1 bullet = 1 mark).

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
