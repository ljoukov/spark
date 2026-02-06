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
- marks: <optional int> (include 6-8 marker questions when requested)
- markScheme: <optional bullet list>
- correctFeedback: <required> (message; optional tone; optional heading)

## Rules
- If `lesson/requirements.md` specifies an exact question count or question-kind mix for this quiz plan item, follow it exactly.
- Question ids must be unique within the quiz.
- Questions must be self-contained and must not reference internal pipeline, file names, or "the brief".
- If the request asks for a **6-8 marker** free-text question (or similar), the `type-answer` question MUST have `marks` between **6 and 8** inclusive and MUST include a bullet `markScheme` that clearly allocates those marks.
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
