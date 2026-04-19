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

## Required Workflow

1. Inventory uploads and assign roles: student, source, scheme, or context.
2. For text-selectable source papers/schemes, run `extract_pdf_reference_text` once, then grep/read targeted lines. Use `extract_text` only for visual/non-text pages.
3. Run one primary `extract_text` pass for remaining transcription targets. Write `grader/output/transcription.md`. Include `## Source problem-statement transcription` with assessed stems, context, labels, figures/tables, formulas, and marks. Do not make an only-visibly-answered list or flatten visual options into prose. Preserve command words exactly: if the paper says `Explain the results.`, do not rewrite it as `Describe and explain the results.`
4. If online references are allowed and required official solutions/schemes are missing, make a bounded official-source lookup. Do not look up examiner reports or grade thresholds unless asked.
5. Build `grader/output/sheet-plan.md` before a large sheet or crop refinement. Source transcription must be verbatim, not an audit, visible-answered list, crop plan, or placeholder. List leaves, ids, marks, totals, scoring batches, exclusions, and each named figure/table/layout with handling. Plan guarded `grader/output/assets/...` crops for every included visual block, or record a real failed crop attempt. If included leaf lines name a figure/table, include it even when scoring does not need it. Self-check totals/leaves.
6. Once `transcription.md`, refs, and `sheet-plan.md` exist, stop broad reading/searching and assemble. Use targeted reads only for a named missing item or publish error.
7. For handwritten papers >12 leaves or >30 marks, call `score_answers_with_fresh_agent` after the minimal sheet plan. Use 2-4 contiguous root/range batches in one parallel turn. Use returned question/modelAnswer results directly, preserving `teacher-review`. In capped replays, scale checkpoints; with 20 minutes, aim score/sheet/validate/publish by T+10/T+16/T+18/T+19:30. After scoring, create missing final crops at `sheet-plan.md` paths; batch crop/pad calls in parallel. Use `crop_image` with `fullImage: true` for final embedded images; never link `grader/output/pdf-images/...` or make intermediate assets. Then write JSON. Do not hand-score. Do not reread every scoring file. Put each figure/table in the exact prompt, never `section.theory`; no source bridge text or figure/table labels as group `displayNumber`s.
8. Write `grader/output/sheet.json` with `write_json_workspace_file` after scoring. Pass complete `jsonText`; never pass `{}`. MCQs need displayMode `"full_options"` or `"labels_only"`. A valid sheet write may derive `grader/output/run-summary.json`. The next non-repair tool call must be `validate_grader_artifacts({"requireSourceFidelityAudit": false})`; if validation reports a missing summary, write it and validate again. Preserve returned scores/statuses. Fix named blockers, record linked-crop validation, and omit optional enrichment.
9. Call `validate_grader_artifacts({"requireSourceFidelityAudit": false})`. Fix invalid JSON/schema/score/crop/scoring-helper issues before any source-fidelity audit.
10. Before publishing source/PDF/photo sheets, call `validate_source_fidelity_with_fresh_agent`; split long material by source page or root question and pass refs plus rendered pages in `sourcePaths`. Check only transfer: verbatim text, visible items, numbering/badges, figures/tables/layouts, and answer evidence.
11. Call `publish_sheet({})`. Repair coherent validation errors; do not repeat a failed branch. Call `review_run_progress_with_fresh_agent` when repeated tool loops suggest the run is off-track.

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
- scores use `{ "got": number, "total": number }`; each `review.questions[id]` uses `status`, `score`, `note`, optional `replyPlaceholder`, and optional `modelAnswer` for unresolved/incorrect items when a concise mark-scheme answer is available,
- use `group` only for real multipart source questions; for decimal labels like `01.1` inside `Question 1`, put plain root text in `section.theory` only when it has no figures/tables/crops; otherwise put the shared stem plus artifact in the first source-faithful prompt and render leaves with short `badgeLabel`s,
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
- Before downloading official PDFs found online, check `knowledge-base/index.md` and call `kb_search_pdfs`; use `kb_download_pdf` for matches or `kb_cache_pdf_from_url` for misses. Carry `storagePath` into worksheet references.
- For source PDFs with named figures/diagrams/photos, use embedded images only when they include all labels/context; otherwise render exact pages, grid them, and request crop bboxes in parallel. Do not use linked-PDF fallback unless source pixels/table text are unavailable after a recorded attempt.
- `grader/output/transcription.md` must not contain "not yet copied", "TBD", or "TODO" placeholders in source problem statements.
- Validate final linked visuals only; `expectedContent` is printed/visible source content, not inferred answers/unprinted labels. Render text/numeric tables/formulas as Markdown/LaTeX instead of crop-chasing. After one failed crop correction for the same visual, switch representation or call `review_run_progress_with_fresh_agent`.
- In handwritten-grading mode, compact does not mean paraphrased. Preserve the exact printed wording for answered source items, and render source tables/figures visibly when the question text names them.
- Do not use `generate_json`, `validate_json`, or `validate_schema` for grader artifacts. Use `validate_grader_artifacts` for grader JSON preflight.
- Do not copy request/brief/upload/planning/answer-list/process files into grader output JSON.
- Do not end with a normal assistant final response before publishing. The run is complete only after `publish_sheet({})` returns `status: "published"`.
