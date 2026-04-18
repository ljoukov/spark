# Grader task

You are grading student uploaded work and related reference documents.

## Read First

Read these workspace files before doing extraction or grading:

1. `brief.md`
2. `request.json`
3. `grader/uploads/index.json`
4. the required skill files listed below

Uploaded files are available under `grader/uploads/<filename>`. Treat uploaded student work as the ground truth for transcription.

## Required Skills

The detailed reusable workflow lives in skills. Read and follow the matching files:

- `skills/paper-to-sheet/SKILL.md`
- `skills/handwritten-answers-to-sheet/SKILL.md`
- `skills/source-image-cropping/SKILL.md`

Use `paper-to-sheet` for sheet structure, `handwritten-answers-to-sheet` for answer capture/reference lookup/scoring, and `source-image-cropping` only when a crop is needed.

## Mode Decision

Classify the run before expensive work:

- `handwritten-grading`: student photos/scans/filled work plus source/reference material. Produce a compact scored worksheet report aligned to submitted answers and the mark scheme. Do not recreate the whole source paper as an editable exam.
- `sheet-answer-grading`: starts from an existing generated sheet and recorded answers. Preserve the sheet structure and grade the recorded answers.
- `source-paper-only`: no student answers/submission. Produce an unanswered editable sheet; this is the only mode that should attempt full source-paper reconstruction.

## Required Workflow

1. Inventory uploads and assign each file a role: student submission, problem/source material, official solution/mark scheme, or supporting-only context.
2. For text-selectable source papers and mark schemes, run `extract_pdf_reference_text` once and use `grep_workspace_files` plus targeted `read_workspace_file` line ranges. Do not send those same PDFs through `extract_text` again unless a specific visual/non-text page truly needs OCR.
3. Run one primary `extract_text` pass for remaining transcription targets, normally student submissions and non-text source/solution files. Write `grader/output/transcription.md`. In grading runs with an official/source paper reference, include a compact `## Source problem-statement transcription` section in that file even when the source text came from deterministic PDF extraction; list the assessed root stems, subquestion labels, figure/table labels, and mark-bearing prompts needed to audit the worksheet structure.
4. If online references are allowed and the paper or competition is identifiable, make a bounded official-source lookup effort for mark schemes/solutions, examiner reports, and grade/prize/medal thresholds that are not already uploaded.
5. Build `grader/output/sheet-plan.md` before a large sheet. List source leaves, ids, marks, answer shapes, score totals, and any visible submitted-work item intentionally excluded. For each named figure/diagram/graph/chart/option block/table, list the source page, nearest worksheet placement, and handling: Markdown table, linked validated crop, or recorded failed crop/table attempt. Focus phrases like "first 4 paragraphs" are not exclusions; unless the learner names question numbers to exclude, keep visible answered, partial, selected, and blank answer-bearing items.
6. Once `transcription.md`, the needed official/source references, and `sheet-plan.md` exist, stop broad reference reading and move directly to report assembly. Do only targeted reads for a named missing mark point or publish error.
7. Write `grader/output/sheet.json` and `grader/output/run-summary.json`.
8. Before publishing source-paper/PDF/photo-derived sheets, call `validate_source_fidelity_with_fresh_agent`, write its `reviewMarkdown` to `grader/output/source-fidelity-audit.md`, and split long material by source page or root question. Check only transfer fidelity: verbatim text, visible items, numbering/badges, figures/tables/layouts near the prompt, and answer evidence alignment. Fix blocking failures and re-audit.
9. Call `publish_sheet({})`. Repair coherent validation errors, but do not repeat the same failed branch. Call `review_run_progress_with_fresh_agent` when repeated tool loops suggest the run is off-track.

## Stable Sheet Palette

Use Spark's stable subject palette from the agent prompt for `sheet.color`, `sheet.accent`, `sheet.light`, and `sheet.border`; do not invent custom colors.

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

Optional paper metadata is allowed only when known. If you include `year`, write it as a string such as `"2024"`.

`grader/output/sheet.json` must be the full graded worksheet report wrapper, not the bare sheet data:

- top-level keys: `schemaVersion`, `sheet`, `answers`, `review`, and optional `references`; `schemaVersion` is exactly `1`,
- `sheet` contains renderable worksheet data and supported question types: `group`, `answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`,
- `answers` contains one captured student answer value for every answer-bearing leaf; answers belong only in the top-level `answers` object,
- `review` contains `mode`, `score`, `label`, `message`, `note`, and `questions`,
- use `group` only for real multipart source questions; for decimal labels like `01.1` inside `Question 1`, do not render an extra `01` parent badge; use direct subquestions with short `badgeLabel` values like `1`, `2`, and `3`,
- every answer-bearing source item must have an answer value and review entry; every scored review entry must include `status` and `score`,
- use `status: "correct"` only for full marks; use `"incorrect"` for partial, blank, or unresolved answers,
- `score.total` must equal the leaf `marks` so the UI can render `[got/total mark(s)]`; do not add review entries for parent `group` ids,
- keep `review.score`, `review.label` (`N/total`), and `run-summary.totals` consistent,
- keep `presentation.summaryMarkdown` concise and non-redundant,
- unresolved review notes and `replyPlaceholder` should set up the learner's next repair without revealing the answer or mark scheme.

## Guardrails

- Keep upload inventory, workspace reading, primary transcription, final grading synthesis, and JSON assembly on the main agent.
- Use `view_image` for source-page/photo fidelity checks and rendered PDF pages when text or layout matters. Use `extract_text` for primary student/photo transcription and the fresh visual helper tools for localized crop inspection.
- When writing grader JSON, escape LaTeX backslashes correctly instead of flattening displayed source formulas, sign rows, arrays, matrices, or grids into prose.
- After a large extracted reference returns only an outline or `content omitted`, do not repeat the same unbounded read. Use grep or exact line ranges.
- Generic subagents may be used only for bounded official-reference lookup/verification or visual localization proposals. pre-publish source-fidelity audits must use `validate_source_fidelity_with_fresh_agent`; reviewers compare source pages/transcripts against `sheet-plan.md` and `sheet.json` and must not grade, solve, redesign, or assemble. Final crop validation must use `validate_crop_with_fresh_agent`.
- Before downloading official PDFs found online, check `knowledge-base/index.md` and call `kb_search_pdfs`. If a matching cached PDF exists, call `kb_download_pdf` and use the local file. If no match exists, download/cache the official PDF with `kb_cache_pdf_from_url`, using semi-structured classification text such as `gcse/aqa/biology/2024/<original filename>`, and carry the returned `storagePath` into worksheet references (`paperStoragePath` or `markSchemeStoragePath`). Keep original URLs only as provenance.
- For long PDFs, pass explicit 1-based `pageNumbers` to `pdf_to_images`, chosen from extracted reference page headings or grep context. If `pdf_to_images` fails because `pageNumbers` were missing, immediately retry with pageNumbers; that error is not a bounded crop attempt and is not evidence that the visual is unavailable.
- In handwritten-grading mode, do not use `Use Figure N in the linked original PDF.` as the default for ordinary source-paper figures. Crop answer-critical figures/tables/diagrams into visible worksheet assets, or transcribe text/numeric tables as Markdown, when the source pixels/text are available and feasible. Use a linked original/source PDF instruction only after a real render/crop/table attempt failed and that failure is recorded in `sheet-plan.md` and the source-fidelity audit.
- In handwritten-grading mode, compact does not mean paraphrased. Preserve the exact printed wording for answered source items, and render source tables/figures visibly when the question text names them.
- Do not use `generate_json` for grader artifacts.
- Do not copy `request.json`, `brief.md`, upload manifests, planning JSON, answer lists, or process summaries into grader output JSON.
- Do not end with a normal assistant final response before publishing. The run is complete only after `publish_sheet({})` returns `status: "published"`.
