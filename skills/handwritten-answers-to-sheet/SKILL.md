---
name: handwritten-answers-to-sheet
description: Use when converting handwritten or filled-in student answers into sheet answer state and grading evidence.
---

# Handwritten Answers To Sheet

Use this skill to capture student responses from handwritten work, completed worksheets, answer booklets, and mixed prompt/answer pages.

## Inputs

- `brief.md`
- `request.json`
- upload manifest and source uploads
- generated shared PDF knowledge-base files under `knowledge-base/`
- existing draft sheet and answer state when grading a student-completed generated sheet:
  - `sheet/output/draft.json`
  - `sheet/state/answers.json`

## Core Principles

- Capture what the student visibly selected or wrote before solving anything.
- Preserve the student's variable names, formulas, notation, terminology, method choice, line breaks, and uncertain symbols as closely as possible.
- For layout-sensitive working such as column arithmetic, binary addition, long multiplication/division, or carry/borrow rows, transcribe the actual visible rows and carry/borrow marks in words if they cannot be rendered faithfully in the answer value. Never collapse this evidence to a placeholder such as "working shown"; grading must be able to distinguish real working from a student merely writing that phrase.
- Do not drop a visible prompt or partial response because it looks incomplete or because the learner's wording emphasized a subset of the page. Focus phrases such as "first 4 paragraphs" are grading-focus guidance, not exclusions. Unless the learner explicitly named a restricted set of question numbers, include every visible answered, partially answered, selected, or blank answer-bearing item from the submitted work and score or flag the evidence honestly.
- Keep source-fidelity over mathematical correctness. Do not normalize an incorrect expression into an equivalent correct one.
- Mark unresolved ambiguity explicitly instead of guessing.
- Ignore unrelated doodles, page clutter, and scribbles unless they clearly form part of an answer.
- Stay grading-first. When a source paper is present, the output is a scored worksheet report for the submitted work, not a full interactive recreation of every source-paper visual.

## Extraction-First Workflow

1. Classify each upload as student submission target, problem statement target, official solution/mark-scheme target, or supporting-only context.
2. For text-selectable source-paper, official-solution, or mark-scheme PDFs, run deterministic reference extraction first and use those markdown files as the official/source baseline.
3. Do not put a text-selectable source paper or mark scheme into `extract_text` `documentPaths` after deterministic reference extraction succeeds. Keep those PDFs out of the expensive visual/OCR pass unless a specific page needs visual disambiguation.
4. Make exactly one initial `extract_text` call for the remaining primary transcription targets, normally student submissions and any non-text/visual source pages that truly need OCR. When one call includes multiple files, pass `instructions` that mention every workspace path and identify each file's role, so source problem text, student submissions, and official solutions stay in separate sections.
5. Use `view_image` for source-page/photo fidelity checks and rendered PDF pages when text or layout matters. Use `extract_text` for primary student/photo transcription and the fresh visual helper tools for localized crop planning/validation.
6. Use `supportingPaths` only for disambiguation-only context that is not itself a transcription target.
7. In extraction instructions, require separate sections for student submissions, problem statements, and official solutions only for files actually sent to `documentPaths`; for deterministic reference files, record their paths and roles instead of copying their full contents.
8. Write the transcription to the caller's requested output, normally `grader/output/transcription.md`.
9. Always include a compact source audit section under the exact heading `## Source problem-statement transcription` when grading against a source paper, even if the source text came from deterministic PDF extraction rather than `extract_text`; record printed root stems, interstitial context needed for grading, subquestion prompts, table labels, figure labels, and MCQ option labels/text in source order. Also record every visible submitted-work item that is included or intentionally excluded; an exclusion needs an explicit source-based reason, not just "outside scope."
10. After extraction, read the transcription file and perform one cleanup pass. Do not repeat the identical extraction call.
11. For long source-paper or mark-scheme reference files, do not read the whole file into the conversation. Use `grep_workspace_files` for question labels/page headings first; its generated-reference matches include nearby context. Use `read_workspace_file` with `startLine`/`lineCount` only when that context is insufficient.
12. Do not copy full question papers or full mark schemes into `grader/output/transcription.md`; keep compact student-answer capture plus the source audit section there and leave bulky official/reference text in the extracted reference files.
13. Do not repeat unbounded `read_workspace_file` calls on the same extracted reference. Once an outline has been returned, use grep or exact line ranges.
14. When `grader/output/transcription.md`, the needed official references, and `grader/output/sheet-plan.md` exist, proceed directly to `sheet.json`, `run-summary.json`, and `publish_sheet`. Avoid further broad searching or rereading unless a named mark point, source item, or publish error is missing.
15. For any printed source paper, source photo, or PDF-derived worksheet content, call `validate_source_fidelity_with_fresh_agent` after writing `sheet.json` and before `publish_sheet`. Write the returned `reviewMarkdown` to `grader/output/source-fidelity-audit.md`, fix blocking omissions/paraphrases/visual issues, and re-audit the affected page or root question before publishing.

## Mixed Prompt And Answer Pages

When a page contains printed task text plus student answers:

- separate original prompt text from the student's supplied response,
- label fragments clearly, for example `Prompt fragment:` and `Student response:`,
- store only the student contribution in worksheet `answers`,
- never let printed source text become the student's answer.

## Objective Answer Capture

For MCQ, answer-bank, tick-box, circled, shaded, boxed, or labelled responses:

- record a selected option only when there is an explicit selection mark,
- ignore solved/correct options, workings, arrows on diagrams, crossings-out, and nearby scribbles unless they unambiguously select an option,
- if no option is visibly selected, record blank/no-answer,
- use `""` for unanswered MCQ or answer-bank selections,
- never infer a student's selected option from the correct answer or from your later solution.

## Existing Draft Sheet Grading

When grading starts from a generated draft sheet:

- read `sheet/output/draft.json` before building the final graded worksheet,
- read `sheet/state/answers.json` and use those recorded answers as the student submission,
- preserve the student-facing sheet structure, numbering, tables, cloze blanks, and flow-chart layout unless a validation error forces a minimal repair,
- keep the final graded worksheet aligned to the sheet the student saw.

## Source-Paper-Only Mode

If no student answers/submission are present and the task is to render the source paper:

- publish an unanswered sheet instead of solving it,
- leave answers blank,
- set `review.mode` to `"awaiting_answers"`,
- use status labels such as `Awaiting answer`,
- omit per-question scores,
- keep per-question notes empty,
- omit `officialSolutionMarkdown`, `gradingMarkdown`, and `overallFeedbackMarkdown` unless the learner explicitly asked for answers,
- do not expose an answer key, derived solutions, likely answers, correct MCQ options, worked solutions, or placeholder "no solution" text unless the learner explicitly asked for answers.

## Official Reference Lookup

Before self-solving, identify the paper, component, competition, year/session, tier, and source title as precisely as possible from uploads and transcription.

If `request.json` sets `input.referenceSourcePolicy` to `allow-official-references` and the source is identifiable:

- make a solid official-source lookup effort before self-solving,
- search, when relevant, for the official question paper/source PDF, official mark scheme or official solutions, official examiner report / report on the examination, and official grade-boundary / prize-threshold / medal-cutoff source,
- use only official organiser, exam-board, publisher, competition, or school sources for the grading baseline,
- before downloading official PDFs, check `knowledge-base/index.md` and call `kb_search_pdfs`; use `kb_download_pdf` for a matching shared entry,
- when no shared entry exists, call `kb_cache_pdf_from_url` with a semi-structured classification such as `gcse/aqa/biology/2024/<original filename>` before using the PDF,
- use `web_fetch` only for non-PDF pages; for official PDFs, use the local cached/downloaded workspace PDF path for extraction/transcription instead of treating HTML as the source,
- record every official source actually used,
- include shared `paperStoragePath` and `markSchemeStoragePath` values in `references` and `run-summary.json` when official paper or mark-scheme PDFs come from the knowledge base,
- if no official grading baseline is found, say that explicitly and then self-solve carefully.
- if the official question paper/source and official mark scheme/solutions are already uploaded, use those uploaded files as the baseline and do not search online just to rediscover the same PDFs. Make only a bounded lookup for missing official examiner-report or grade/prize/medal threshold data.

## Grading Evidence

After answer capture:

- write `grader/output/sheet.json` as the full graded worksheet report, not as the bare sheet data:
  - top-level keys must be `schemaVersion`, `sheet`, `answers`, `review`, and optional `references`,
  - `schemaVersion` must be `1`,
  - `sheet` must contain the renderable worksheet data (`id`, `subject`, `level`, `title`, `subtitle`, colors, and `sections`),
  - `answers` must contain the captured student answer for every answer-bearing leaf worksheet question id,
  - `review` must contain the overall score, label, message, note, and per-question review entries,
- establish the correct-answer baseline from uploaded official solutions or official references when allowed,
- otherwise self-solve carefully at the student's level,
- grade against the captured answer, not against what the answer should have been,
- include `review.score.total` equal to the total worksheet marks and `review.score.got` equal to the awarded mark total,
- include `review.label`, normally formatted as `N/total`, and `review.note`, which may be `""`,
- before publishing, cross-check that `grader/output/run-summary.json` `totals.awardedMarks` equals `review.score.got` and `totals.maxMarks` equals `review.score.total`,
- include one `review.questions[questionId]` entry per answer-bearing leaf worksheet question,
- do not include `review.questions` entries for parent `group` ids; a `group` only holds shared context and its child questions carry the marks,
- when student answers are present, every review entry must include `status` and `score: { "got": number, "total": number }`; use `status: "correct"` only when full marks are awarded, otherwise use `status: "incorrect"` so partial and blank answers remain open for tutoring,
- `score.total` must equal that leaf question's `marks` so the UI can render `[got/total mark(s)]`,
- if any question review includes a score, all worksheet question reviews must include a score; do not mix scored and unscored reviews except in source-paper-only `awaiting_answers` mode,
- never omit per-question scores in a real grading run merely because a question is blank or uncertain; score blank/incorrect work as `got: 0` with the correct `total`,
- do not exclude a source question, remove its marks, or call it ungradable solely because a public PDF omits a figure/map/photo or because an insert is missing. Spark is a private student study UI that can link to the original/source PDF. Preserve the student's response and grade against the official mark scheme when the response and mark points make assessment possible,
- keep `review.message` as a short learning summary, not a duplicate of the numeric score,
- write per-question worksheet review notes for unresolved/incorrect work as first tutor messages: start with a cue, contrast, or next step instead of simply revealing the final answer,
- do not compress the mark scheme into unresolved feedback by naming the missing final concept, mechanism, data comparison, or answer path,
- correct/resolved questions may use empty review notes because completed feedback cards are hidden in the student UI.

## Compact Grading Report Shape

When grading handwritten answers against an uploaded source paper:

- include every assessed source item in source order, including blanks,
- include visible partial responses and visible later questions even when the learner's prompt highlights earlier paragraphs/items. If the item is too incomplete to score confidently, keep the source prompt and captured evidence in the sheet and use a zero/partial/teacher-review note rather than deleting it.
- for short uploaded problem sheets, preserve the full source prompt wording and source display math/layouts in the visible worksheet questions rather than using compact paraphrases,
- for long exam papers, keep visible prompts compact enough for review while still preserving answer-critical source text, numbering, marks, and visuals,
- preserve the source question number, marks, and a short faithful cue such as the command word, measured quantity, table row, or answer line,
- preserve answer-critical source tables, column arithmetic, number grids, flow/box layouts, and printed subpart/option labels in the visible worksheet prompt. Compact grading may omit decorative page chrome, but it must not replace a printed table or stacked calculation with a prose summary.
- for multi-part source roots, create an explicit parent `group` entry for the root question and put mark-bearing subparts inside it; do not publish a section that contains only flat subparts such as `1.1`, `1.2`, `1.3` with no parent root,
- for standalone one-part source questions, do not create a parent `group` with one child just to separate the prompt from the answer area; use a single mark-bearing leaf question with the full source prompt,
- keep full problem/source transcription and official solution text in `references.*Markdown` rather than duplicating the entire paper into every prompt,
- embed source-paper figures, maps, photos, and text/numeric tables when they are needed to understand the task, the student's answer, or the feedback,
- use visible text such as `Use Figure 3 in the linked original PDF.` only when the source pixels are unavailable or a clean crop is not feasible after a bounded attempt,
- do not crop decorative or irrelevant exam layout, but do not replace answer-critical visuals with linked-PDF instructions merely to keep the report compact.

## Real-World Outcome Reporting

When official grade boundaries, prize thresholds, medal cutoffs, or examiner-report outcome guidance are available for the same paper/session/tier:

- report the likely real exam or competition outcome in addition to raw marks,
- use the organiser's exact wording, such as `Grade 7`, `Silver`, `Distinction`, or `missed the Bronze cutoff by 2 marks`,
- distinguish `official`, `estimated from official boundary data`, and `unavailable`,
- do not infer a qualification-wide grade from one paper/component unless the official source supports that inference,
- put the outcome and its basis in `references.overallFeedbackMarkdown`,
- mention the outcome briefly in `presentation.summaryMarkdown` when it is the main student-facing takeaway,
- if the matching boundary/threshold source is not found, state that the grade/prize/medal mapping is unavailable instead of inventing one.

## Answer State Shapes

The `answers` object is separate from `sheet`. Do not put student answers inside question objects.

- `mcq` answers are selected option ids. Use `""` for no visible answer.
- `answer_bank` answers are objects keyed by blank index whose values are selected option ids.
- `fill` and `cloze` answers are objects keyed by blank index.
- `match` answers are objects keyed by the shown term.
- `spelling` answers are objects keyed by word index.
- `flow` answers are objects keyed by flow-box id.
- `lines` and `calc` answers are strings.
- Preserve the student's wording, variables, formulas, method, and mistakes in these answer values wherever possible.
