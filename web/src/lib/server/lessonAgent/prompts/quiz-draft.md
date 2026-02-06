# Quiz draft (lesson/drafts/quiz/<planItemId>.md)

You are drafting a **QuizDefinition** for **one** plan item with `kind="quiz"`.

Return **Markdown only** (no JSON). This draft will later be converted into `lesson/output/quiz/<planItemId>.json`.

Before writing, identify the **target quiz plan item id** from `lesson/requirements.md` and `lesson/drafts/session.md` (or from a tool instruction).

Write in **UK English**.

## Required format (strict)

# Quiz
- planItemId: <id>
- title: <required>
- description: <required>
- gradingPrompt: <required> (how to mark type-answer questions at this level)
- topic: <optional>
- estimatedMinutes: <optional int>

# Questions
Use one section per question:

## <questionId> (<kind>)
- prompt: <required>
- hint: <optional>
- audioLabel: <optional>

For kind=info-card:
- eyebrow: <optional or null>
- body: <required>
- continueLabel: <optional>

For kind=multiple-choice:
- options:
  - <optionId>: <label> | <text>
- correctOptionId: <required>
- correctFeedback: <required> (message; optional tone=info|success|warning; optional heading)
- explanation: <optional>

For kind=type-answer:
- answer: <required>
- acceptableAnswers: <optional, comma-separated>
- placeholder: <optional>
- marks: <optional int> (required when the request asks for a 6-8 marker question; use 6 by default)
- markScheme: <optional bullet list> (required when the request asks for a 6-8 marker question; prefer 1 bullet = 1 mark)
- correctFeedback: <required> (message; optional tone; optional heading)

## Rules
- If `lesson/requirements.md` specifies an exact question count or question-kind mix for this quiz plan item, follow it exactly.
- Question ids must be unique within the quiz.
- Questions must be self-contained and must not reference internal pipeline, file names, or "the brief".
- If the request asks for a **6-8 marker** free-text question (or similar):
  - Treat the quiz's `type-answer` question as the 6-8 marker question (i.e. do not write a 1-3 mark plug-and-chug calculation).
  - The `type-answer` question MUST have `marks` between **6 and 8** inclusive (prefer `marks: 6` unless the request says otherwise).
  - The `type-answer` question MUST include a bullet `markScheme` that clearly allocates those marks (prefer 1 bullet = 1 mark).
- Use LaTeX for maths/science formulas inside Markdown fields:
  - Inline: wrap in `$...$` (e.g. `$V = IR$`, `$I = \\frac{Q}{t}$`).
  - Display: wrap in `$$...$$` for standalone equations/derivations.
  - Any time you write an equation (e.g. contains `=` or `∝`), it should be LaTeX.
  - Do NOT write bare formulas like `V=IR` when LaTeX is suitable.
- Keep copy short:
  - Quiz `title`: 3-8 words, <= 55 chars.
  - Quiz `description`: 1 sentence, <= 30 words.
  - Quiz `gradingPrompt`: 2-6 short bullets (level-appropriate; no rambling).
  - Question `prompt`: 1-2 sentences, <= 45 words.
  - Info-card `body`: 60-140 words, formatted with short paragraphs or bullets.
  - MCQ `options`: keep each option <= 12 words.
- If an `info-card` is included, it must be question 1.

Decisions + constraints (authoritative):
{{lesson/requirements.md}}

User request (authoritative):
{{brief.md}}

Session draft context:
{{lesson/drafts/session.md}}
