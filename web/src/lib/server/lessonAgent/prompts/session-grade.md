# Session grade (lesson/drafts/session.md)

You are grading a Spark Session **Markdown** draft against the request and hard requirements.

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
- Draft must follow the required format in the session draft prompt (Session section + Plan items).
- `topics` must be present and non-empty.
- Plan must be non-empty.
- Every plan item must have: id, kind, title.
- Plan item ids must be unique and file-friendly (no spaces; prefer `q1`, `p1`, etc).
- Must respect `lesson/requirements.md` decisions (includeCoding/includeStory).
- If plan preferences exist (number of items, per-quiz question counts/types), follow them exactly.
- Plan item titles must be short, action-oriented, and reflect what the learner does.
- Every plan item must include an `icon` and it must be a single emoji glyph (NOT an icon/library name like "Bolt", "Calculator", etc).
- If any plan item includes `meta`, it must be short and user-facing. Fail if `meta` contains debug-y breakdowns like "questions:", "multiple-choice", "type-answer", "info-card", or long semicolon-separated lists.
- Session + plan copy must avoid LaTeX delimiters (`$...$` / `$$...$$`) because the dashboard renders these fields as plain text. Prefer referencing formulas in words (e.g. "Ohm's law").
- If present, session `title`/`tagline`/`summary` must meet the length guidance in the session draft prompt.
- Must fit the requested level and goal; avoid overstuffing or under-scoping.

Decisions + constraints (authoritative):
{{lesson/requirements.md}}

User request (authoritative):
{{brief.md}}

Candidate session Markdown:
{{lesson/drafts/session.md}}
