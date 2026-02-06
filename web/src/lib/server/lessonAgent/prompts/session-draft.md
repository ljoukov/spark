# Session draft (lesson/drafts/session.md)

You are drafting the **Spark Session** plan for a single learner.

Return **Markdown only** (no JSON). This draft will later be converted into `lesson/output/session.json` for publishing.

Write in **UK English**.

## Required format (strict)

# Session
- topics: <at least 1 short topic>
- title: <optional>
- summary: <optional>
- tagline: <optional>
- emoji: <optional>

# Plan
Use one section per plan item:

## <id> (<kind>)
- title: <required>
- summary: <optional>
- description: <optional>
- icon: <required emoji> (single emoji only, e.g. ⚡ 🔋 🧮; NOT icon names like "Bolt")
- meta: <optional> (rare; short, user-facing label. Avoid internal/debug info, especially question-count breakdowns.)

## Rules
- Plan must be non-empty.
- Plan item ids must be unique and file-friendly (no spaces). Prefer `q1`, `q2`, `p1`, `m1`.
- If `lesson/requirements.md` contains plan preferences (number of items, per-quiz question counts/types), follow them exactly.
- `kind="media"` only if the learner explicitly requested a story/audio clip.
- If this is not programming practice, make it quiz-only (no `kind="problem"` items).
- Plan item `title` should be action-oriented and start with a verb (e.g. "Measure current", "Calculate potential difference").
- Every plan item must include an `icon` as a single emoji glyph (not a library/icon identifier).
- Session + plan copy is rendered as plain text in the dashboard timeline (not Markdown): avoid `$...$` / `$$...$$` LaTeX delimiters and avoid writing equations. Refer to formulas by name (e.g. "Ohm's law") instead.
- For `kind="quiz"` items, usually omit `meta` (the UI already labels it as "Quiz").
- `meta` is optional and should be kept very short (think "Easy", "3 min"). If unsure, omit it.
- Keep copy short. If you can't confidently stay within the limits for an optional field, omit that field rather than exceeding:
  - Session `title` (if present): 4-10 words, <= 60 chars.
  - Session `tagline` (if present): 6-12 words, <= 90 chars. If unsure, omit `tagline`.
  - Session `summary` (if present): 1-2 sentences, <= 45 words.
  - Plan item `title`: 3-8 words, <= 55 chars.
  - Plan item `summary` (if present): 1 sentence, <= 25 words.

Decisions + constraints (authoritative):
{{lesson/requirements.md}}

User request (authoritative):
{{brief.md}}

Request metadata:
{{request.json}}
