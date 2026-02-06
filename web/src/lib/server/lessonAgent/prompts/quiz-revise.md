# Quiz revise (lesson/drafts/quiz/<planItemId>.md)

You are revising a quiz **Markdown** draft to address a grading report.

Return **Markdown only** (no JSON).

Rules:
- Fix every issue in the grading report.
- Keep `planItemId` stable.
- Keep question ids stable unless the grading report requires changes.
- Preserve the requested question count / kind mix if it was specified in `lesson/requirements.md`.
- Keep the required format from the quiz draft prompt (Quiz section + Questions).

Decisions + constraints:
{{lesson/requirements.md}}

Session draft context:
{{lesson/drafts/session.md}}

Inputs (in attached files):
- Current quiz Markdown: `lesson/drafts/quiz/<planItemId>.md`
- Grading report Markdown: `lesson/feedback/quiz/<planItemId>-grade.md`

Revise the quiz to address every issue in the grading report.
