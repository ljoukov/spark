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
9. Always include a source-faithful section under the exact heading `## Source problem-statement transcription` when grading against a source paper, even if the source text came from deterministic PDF extraction rather than `extract_text`; record printed root stems, interstitial context, subquestion prompts, table labels/cells, figure labels, displayed formulas, and MCQ option labels/text in source order. This section is not a compact audit or needed-for-grading summary: copy the printed wording page by page for included source items and shared context, omitting only irrelevant administration chrome. Also record every visible submitted-work item that is included or intentionally excluded; an exclusion needs an explicit source-based reason, not just "outside scope."
10. After extraction, read the transcription file and perform one cleanup pass. Do not repeat the identical extraction call.
11. For long source-paper or mark-scheme reference files, do not read the whole file into the conversation. Use `grep_workspace_files` for question labels/page headings first; its generated-reference matches include nearby context. Use `read_workspace_file` with `startLine`/`lineCount` only when that context is insufficient. If the available tool schema does not let you send those fields, use `read_file` with `offset`/`limit` on the workspace-relative file instead.
12. Do not copy full mark schemes into `grader/output/transcription.md`; keep student-answer capture plus the source problem-statement transcription there and leave bulky official/reference text in the extracted reference files. For long source papers, split the source transcription by source page/root question instead of compressing included prompts into paraphrases.
13. Do not repeat unbounded `read_workspace_file` calls on the same extracted reference. Once an outline or `content omitted` response has been returned, use grep or exact line ranges.
14. When `grader/output/transcription.md` and the needed official references exist for a large handwritten paper, write a minimal `grader/output/sheet-plan.md` before crop refinement or scoring. The source problem-statement transcription must be verbatim printed wording page by page, not a compact audit, "needed for grading" summary, only-visibly-answered list, crop plan, or source-paper placeholder; include shared root/interstitial context, options, instructions, table cells, figure labels, displayed formula setup lines, and displayed formulas. Do not flatten diagram-option blocks into prose such as `Options: A, B, C, D shown as diagram choices`, `Options shown as diagram labels`, `Options shown as A, B, C, D in Figure 2`, or `Options A-D shown in Figure 2`; preserve the figure/diagram reference and plan a visible crop. Do not replace a displayed formula/equation with prose such as `displayed formula shown for ...`; render the actual displayed formula as Markdown/LaTeX or plan a visible crop. Include source leaves, ids, marks, scoring batches, figure/table placements, and any exclusions in the plan, then self-check that total marks equal both section totals and listed leaf marks, and total leaves equal the listed leaves. For every included named figure/diagram/graph/visual option block, including shared context before a later subquestion, the plan must name a guarded `grader/output/assets/...` crop path or record a real failed render/crop attempt; never write that no crop is needed because grading is possible without the visual. If source lines for an included leaf say `Figure 1 shows...`, that figure is mandatory for that leaf even if the student's short answer can be marked from the scheme. Then stop broad search; do not search for schema examples or broad reference terms. If one crop correction still fails for a transcribable table/formula visual, render the content as Markdown/LaTeX instead of continuing the crop loop.
15. For long handwritten papers with more than 12 answer leaves or more than 30 marks, call `score_answers_with_fresh_agent` immediately after that minimal plan exists, using focused source, student-answer, mark-scheme, and figure/table-summary excerpts. Prefer 2-4 contiguous root/range batches that cover every answer leaf, and issue all independent scoring calls in the same tool turn; do not start with a subset and wait. The helper returns per-question results inline, may include concise `modelAnswer` text for wrong items, and writes audit files; use the returned results directly, including `teacher-review` when returned. Only use strict minute checkpoints when the task or harness explicitly says it is a capped/performance replay; normal publishing should use the available budget for source-fidelity fixes and may run up to the external supervisor cap. Do not hand-score the paper in hidden reasoning, reopen images to regrade, delay the helper for crop polishing, reread every scoring file, or derive separate model answers unless a named item is missing or validation points to it.
16. Write `sheet.json` with `write_json_workspace_file` immediately after required scoring. If planned final image asset paths are still missing, create only those exact guarded `grader/output/assets/...` files first; if no source image inventory/page render exists, do one bounded source-visual prep step (`extract_pdf_images` to `grader/output/pdf-images` or `pdf_to_images` for exact pages under `grader/output/rendered-pages`) before final `crop_image`/`pad_image`; batch all missing crop/pad calls in one parallel tool turn. Do not create `-raw`, `-candidate`, `-draft`, or temp files under `grader/output/assets`, and do not validate, inspect, or polish crops before first-pass JSON. Pass `jsonText` containing the complete JSON object; never pass `{}` or a partial object. A valid sheet write may derive `run-summary.json`, so immediately call `validate_grader_artifacts({"requireSourceFidelityAudit": false})` next instead of spending another turn on summary text; if validation says the summary is missing, write `run-summary.json` then validate. Preserve returned scores/statuses rather than resolving ambiguity yourself. Every `mcq.options[]` entry must have a non-empty `label`: use printed labels when present, otherwise assign stable visible letters such as `A`, `B`, `C` and keep the source choice wording in `text`. Put each figure/table crop or Markdown table in the exact source question or group prompt, never in `section.theory`, and do not invent bridge text such as "Figure 1 and Figure 2 are used in this question", "planned as crop", "shown in the source paper", or "options shown as diagram labels". Do not crop-validate, reread scoring files, regrade, or enrich before first-pass JSON. Fix invalid JSON, schema, score, crop, missing scoring-helper, or guarded-asset issues; if linked crops exist, record `crop-validation.md` after first-pass JSON and before source-fidelity audit/publish. Omit optional model-answer/reference enrichment and grade-boundary commentary rather than delaying validation or publish.
17. For any printed source paper, source photo, or PDF-derived worksheet content, call `validate_source_fidelity_with_fresh_agent` after JSON preflight and before `publish_sheet`. The tool writes per-scope files under `grader/output/source-fidelity-audits/` and refreshes aggregate `grader/output/source-fidelity-audit.md`; pass the relevant source reference markdown and rendered source page images in `sourcePaths`. If it fails, patch all blocking omissions/paraphrases/visual issues for that page/root in one pass and run at most one follow-up audit for that same scope before escalating to `review_run_progress_with_fresh_agent` or a concrete blocker.
18. Call `publish_sheet`.

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
- for blanks, use `fill` only for a simple one- or two-blank line with `prompt`, `blanks`, and `after`; if you have `segments`/`blanks`, set `type: "cloze"` instead of `fill`,
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
- do not exclude a source question, remove its marks, or call it ungradable solely because a public PDF omits a figure/map/photo or because an insert is missing. Spark is a private student study UI that can link to the original/source PDF only when the visual is genuinely unavailable in the working source. Preserve the student's response and grade against the official mark scheme when the response and mark points make assessment possible,
- keep `review.message` as a short learning summary, not a duplicate of the numeric score,
- write per-question worksheet review notes for unresolved/incorrect work as short cues for the Spark-owned sheet response modal: identify the specific gap to close, acknowledge any useful partial thinking, and give the next repair step without revealing the final answer, model answer, mark scheme, or complete method, even when the learner asks for model answers to memorise,
- include `replyPlaceholder` for unresolved/incorrect work when a focused response would help; make it an action prompt such as "Write the missing method steps in order." or "Set up the equation before calculating.",
- do not compress the mark scheme into unresolved feedback by naming the missing final concept, mechanism, data comparison, or answer path; the note should set up the learner's next written response, not replace it,
- correct/resolved questions may use empty review notes because completed feedback cards are hidden in the student UI.

## Compact Grading Report Shape

When grading handwritten answers against an uploaded source paper:

- include every assessed source item in source order, including blanks,
- include visible partial responses and visible later questions even when the learner's prompt highlights earlier paragraphs/items. If the item is too incomplete to score confidently, keep the source prompt and captured evidence in the sheet and use a zero/partial/teacher-review note rather than deleting it.
- for short uploaded problem sheets, preserve the full source prompt wording and source display math/layouts in the visible worksheet questions rather than using compact paraphrases,
- for long exam papers, keep visible prompts compact enough for review while still preserving answer-critical source text, numbering, marks, and visuals,
- preserve the source question number, marks, and a short faithful cue such as the command word, measured quantity, table row, or answer line,
- preserve answer-critical source tables, column arithmetic, number grids, flow/box layouts, and printed subpart/option labels in the visible worksheet prompt. Compact grading may omit decorative page chrome, but it must not replace a printed table or stacked calculation with a prose summary.
- for multi-part source roots, follow the numbering rules in `paper-to-sheet`: if the section label already represents the root (for example `Question 1`), put only plain root text in `section.theory` and render decimal/bracket subparts as direct leaves with short `badgeLabel`s; never wrap those leaves in an unnumbered parent group. Keep named figures, tables, and linked crops out of `section.theory`; if shared root context names a figure/table used by multiple decimal leaves, place that context and visual in the first dependent leaf prompt and have later leaves refer to the figure/table above. Use parent `group` entries only for real first-level source subparts or nested subparts that need their own visible badge, such as `a` containing `i` and `ii`.
- for standalone one-part source questions, do not create a parent `group` with one child just to separate the prompt from the answer area; use a single mark-bearing leaf question with the full source prompt,
- keep full problem/source transcription and official solution text in `references.*Markdown` rather than duplicating the entire paper into every prompt,
- embed source-paper figures, maps, photos, and text/numeric tables for every included source item that names or points to them when source pixels/table text are available,
- for diagram-option MCQs, labels-only display is valid only when the option diagrams themselves are visible in the same prompt or an immediately adjacent crop,
- for source-paper figures/diagrams/photos in PDFs, run `extract_pdf_images` before rendering full pages; render with `pdf_to_images` only when extracted images are insufficient or page context is needed,
- for source-paper figures/tables in PDFs, choose exact source pages from the extracted reference and call `pdf_to_images` with 1-based `pageNumbers`; PDFs over 12 pages require page numbers and must not be rendered all at once,
- do not look up grade boundaries or examiner reports unless the user explicitly asked for those external references; when uploaded question paper / mark scheme files are present, use them and finish the source-faithful sheet first,
- model answers for wrong items should be concise derivations from the uploaded source paper and mark scheme; in long-paper grading, prefer the `modelAnswer` fields returned by `score_answers_with_fresh_agent`; do not download optional worked-example/examiner-report PDFs before source visuals/tables are handled and artifacts are moving, and do not spend turns deriving extended model answers before validation/publish,
- use visible text such as `Use Figure 3 in the linked original PDF.` only when the source pixels are genuinely unavailable in the working source or a clean crop is not feasible after a real recorded render/crop attempt. Do not use that text as a first-pass shortcut for ordinary uploaded/source PDF figures; artifact validation rejects named figures/tables that are available but not visibly embedded or transcribed,
- do not crop decorative or irrelevant exam layout, but do not replace answer-critical visuals with linked-PDF instructions merely to keep the report compact.
- when validating source-figure crops, `expectedContent` must name only printed/visible source content, not inferred answers or labels/headings absent from the original figure.
- after transcription and bounded scoring are complete, write the sheet artifacts with `write_json_workspace_file` using complete valid JSON in `jsonText` before doing optional refinement passes; escape JSON backslashes in formula strings, and do not spend long hidden deliberation, reread every scoring file, or override `teacher-review` before `sheet.json`. For first-pass long handwritten grading artifacts, use `lines` for calculation or worked-method leaves unless you provide a valid `calc` question with both `inputLabel` and `unit`; never write a bare `type: "calc"`. If a required crop will be created after first artifact validation, put the planned guarded path such as `grader/output/assets/q01-figure1.png` in the exact question/group prompt now; do not invent an intermediate raw/candidate path, and validation will then force the crop-validation pass.

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

- Use `mcq` only for printed choice/tick-box items, not open-answer prompts that happen to include a figure. `mcq` answers are selected option ids, not visible labels/text. Use `""` for no visible answer.
- `answer_bank` answers are objects keyed by blank index whose values are selected option ids.
- `fill` and `cloze` answers are objects keyed by blank index.
- `match` answers are objects keyed by the shown term.
- `spelling` answers are objects keyed by word index.
- `flow` answers are objects keyed by flow-box id.
- `lines` and `calc` answers are strings.
- Preserve the student's wording, variables, formulas, method, and mistakes in these answer values wherever possible.
