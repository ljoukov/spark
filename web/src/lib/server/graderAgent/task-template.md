# Grader task

## Read First

Read:

1. `brief.md`
2. `request.json`
3. `grader/uploads/index.json`
4. skill files below

## Required Skills

The detailed reusable workflow lives in skills. Follow:

- `skills/paper-to-sheet/SKILL.md`
- `skills/handwritten-answers-to-sheet/SKILL.md`
- `skills/source-image-cropping/SKILL.md`

## Mode Decision

Classify before expensive work:

- `handwritten-grading`: student work plus source/reference. Produce a compact scored worksheet report aligned to answers/scheme.
- `sheet-answer-grading`: generated sheet and answers. Preserve structure and grade recorded answers.
- `source-paper-only`: no answers. Produce an unanswered sheet.

## Sheet Answer Grading Workflow

Use this path for `sheet-answer-grading`, when the workspace contains `sheet/output/draft.json` and `sheet/state/answers.json`.

1. Read `sheet/output/draft.json` and `sheet/state/answers.json` directly with workspace file tools. Do not use OCR, transcription, source rendering, cropping, or source-fidelity audit to capture the student's answers.
2. Preserve the draft `sheet` structure exactly: ids, numbering, marks, tables, cloze blanks, flow layout, options, and sections. Make only minimal schema repairs if validation names a blocker.
3. Treat saved answer values as the submission: `mcq` values are option ids; `answer_bank`, `fill`, `cloze`, `match`, `spelling`, and `flow` values are keyed objects; `lines` and `calc` values are strings. Blank or missing values are blank answers, not inferred selections.
4. Use `references.officialSolutionMarkdown` or `references.gradingMarkdown` from the draft as the answer key when present. If no key exists, solve from the visible draft prompt at the stated student level.
5. Write `grader/output/sheet.json` as the full graded worksheet report, with the draft sheet copied into `sheet`, saved answers copied into top-level `answers`, and scored `review.questions` for every answer-bearing leaf. Write `grader/output/run-summary.json` if the sheet write does not derive it.
6. The next non-repair tool call after writing valid JSON must be `validate_grader_artifacts({"requireSourceFidelityAudit": false})`, then `publish_sheet({})`.
7. `grader/output/transcription.md`, `grader/output/sheet-plan.md`, crop validation, scoring helpers, and source-fidelity audits are not required for this digital-answer path unless validation reports a specific source-reconstruction blocker.

## Required Workflow

For `handwritten-grading` and `source-paper-only` runs that need source reconstruction:

1. Inventory uploads and assign roles: student, source, scheme, or context.
2. Extract reference text first for text-selectable source papers/schemes; use `extract_text` only for student work or visual/non-text pages that need OCR.
3. Write `grader/output/transcription.md`, including a verbatim `## Source problem-statement transcription` when grading against source material. Preserve command words and visible figure/table/formula references.
4. If allowed and needed, make a bounded official-source lookup; do not look up examiner reports, grade thresholds, or enrichment unless asked.
5. For large or visual source work, build `grader/output/sheet-plan.md` before crop refinement or scoring. List leaves, ids, marks, totals, scoring batches, exclusions, and every named figure/table/layout with final handling. Self-check totals/leaves.
6. For handwritten papers >12 leaves or >30 marks, call `score_answers_with_fresh_agent` after the minimal plan in 2-4 contiguous root/range batches. Use returned question/modelAnswer results directly, preserving `teacher-review`. Do not hand-score. Do not reread every scoring file.
7. Create only missing final guarded crops/source-page click targets named in the plan. Never link `grader/output/pdf-images/...`, never publish SVG, and put each figure/table in the exact prompt, never `section.theory`.
8. Write `grader/output/sheet.json` with complete `jsonText`; never pass `{}`. A valid write may derive `grader/output/run-summary.json`. The next non-repair tool call must be `validate_grader_artifacts({"requireSourceFidelityAudit": false})`; if validation reports a missing summary, write it and validate again. Preserve returned scores/statuses. Fix named blockers, record linked-crop validation, and omit optional enrichment.
9. Before publishing source/PDF/photo sheets, call `validate_source_fidelity_with_fresh_agent`; split long material by source page or root question and pass refs plus rendered pages in `sourcePaths`.
10. Call `publish_sheet({})`. Repair coherent validation errors; do not repeat a failed branch. Call `review_run_progress_with_fresh_agent` when repeated tool loops suggest the run is off-track.

## Output Contract

`grader/output/run-summary.json` must use this top-level shape:

```json
{
  "totals": { "awardedMarks": 0, "maxMarks": 0 },
  "presentation": {
    "title": "string",
    "subtitle": "string",
    "summaryMarkdown": "string",
    "footer": "string"
  },
  "sheet": {
    "title": "string",
    "filePath": "grader/output/sheet.json"
  }
}
```

If you include `year`, write it as a string such as `"2024"`.

`grader/output/sheet.json` must be the full graded worksheet report wrapper, not bare sheet data. In `write_json_workspace_file`, put the full object text in `jsonText`:

- top-level keys: `schemaVersion`, `sheet`, `answers`, `review`, optional `references`; `schemaVersion`: `1`,
- `answers` contains one captured value per answer-bearing leaf; answers belong only in the top-level `answers` object,
- `review` contains `mode`, `score`, `label`, `message`, `note`, and `questions`,
- completed grading uses `review.mode: "graded"`; unanswered sheets use `"awaiting_answers"`,
- scores use `{ "got": number, "total": number }`; each `review.questions[id]` uses `status`, `score`, `note`, optional `replyPlaceholder`, and optional `modelAnswer`,
- every answer-bearing source item must have an answer value and review entry; every scored review entry must include `status` and `score`,
- use `status: "correct"` only for full marks; use `"incorrect"` for partial, blank, or unresolved answers,
- `score.total` must equal the leaf `marks` so the UI can render `[got/total mark(s)]`; do not add review entries for parent `group` ids,
- unresolved notes and `replyPlaceholder` set up repair without revealing answers, mark schemes, or model answers; even when the learner asks for model answers, keep inline notes cue-only. Put concise per-question `modelAnswer` values in review data when available for close-gap guided steps.
- `mcq` only for printed choice/tick-box items; answers must be option ids, not labels/text. Every option needs a non-empty `label`; use printed labels when present, otherwise assign stable visible letters such as `A`, `B`, `C` and keep the source choice wording in `text`.
- `fill` is only for simple one- or two-blank lines with `prompt`, `blanks`, and `after`; use `cloze` for `segments`/`blanks`.
- In long handwritten grading, prefer `lines` for calculations or worked methods unless the source is a single answer blank and you provide a valid `calc` question with both `inputLabel` and `unit`; never write a bare `type: "calc"`.
- keep named figures/tables/images out of `section.theory`; put them in question/group prompts.

## Guardrails

- Keep intake, reading, transcription, final synthesis, and JSON assembly on the main agent. `score_answers_with_fresh_agent` scores bounded root batches; the main agent owns final totals/review.
- Use `view_image` for source-page/photo fidelity checks and rendered PDF pages when text/layout matters. Use `extract_text` for primary transcription and fresh visual helpers for localized crops.
- Write grader JSON with `write_json_workspace_file`; `jsonText` must be valid JSON, so escape LaTeX backslashes or use Unicode/plain Markdown. Do not flatten displayed formulas, sign rows, arrays, matrices, or grids.
- After a large extracted reference returns only an outline or `content omitted`, use grep or exact line ranges.
- Generic subagents may be used only for bounded lookup/verification or visual localization; pre-publish source-fidelity audits must use `validate_source_fidelity_with_fresh_agent`. Reviewers compare source with `sheet-plan.md`/`sheet.json` and must not grade, solve, or assemble. Use `validate_crop_with_fresh_agent` for final crop validation.
- Before downloading official PDFs found online, check `knowledge-base/index.md` and call `kb_search_pdfs`; use `kb_download_pdf` for matches or `kb_cache_pdf_from_url` for misses.
- For source PDFs/photos with figures/diagrams, use real source pixels. Do not publish SVG. For PDFs, display a guarded crop and link it to a full rendered source-page JPEG. For uploaded photos/scans, reuse one 1500px-normalized JPEG source image with a `#spark-bbox=left,top,right,bottom` viewport.
- `grader/output/transcription.md` must not contain "not yet copied", "TBD", or "TODO" placeholders in source problem statements.
- Validate final linked visuals only; `expectedContent` is printed/visible source content, not inferred answers/unprinted labels. Render text/numeric tables/formulas as Markdown/LaTeX instead of crop-chasing. After one failed crop correction for the same visual, switch representation or call `review_run_progress_with_fresh_agent`.
- In handwritten-grading mode, compact does not mean paraphrased. Preserve the exact printed wording for answered source items, and render source tables/figures visibly when the question text names them.
- Do not use `generate_json`, `validate_json`, or `validate_schema` for grader artifacts. Use `validate_grader_artifacts` for grader JSON preflight.
- Do not copy request/brief/upload/planning/answer-list/process files into grader output JSON.
- Do not end with a normal assistant final response before publishing. The run is complete only after `publish_sheet({})` returns `status: "published"`.
