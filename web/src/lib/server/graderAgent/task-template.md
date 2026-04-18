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
5. Build `grader/output/sheet-plan.md` before a large sheet. List source leaves, ids, marks, answer shapes, visual handling, score totals, and any visible submitted-work item intentionally excluded. Focus phrases like "first 4 paragraphs" are not exclusions; unless the learner names question numbers to exclude, keep visible answered, partial, selected, and blank answer-bearing items.
6. Once `transcription.md`, the needed official/source references, and `sheet-plan.md` exist, stop broad reference reading and move directly to report assembly. Do only targeted reads for a named missing mark point or publish error.
7. Write `grader/output/sheet.json` and `grader/output/run-summary.json`.
8. Before publishing source-paper/PDF/photo-derived sheets, call `validate_source_fidelity_with_fresh_agent`, write its `reviewMarkdown` to `grader/output/source-fidelity-audit.md`, and split long material by source page or root question. Check only transfer fidelity: verbatim text, visible items, numbering/badges, figures/tables/layouts near the prompt, and answer evidence alignment. Fix blocking failures and re-audit.
9. Call `publish_sheet({})`. Repair coherent validation errors, but do not repeat the same failed branch. Call `review_run_progress_with_fresh_agent` when repeated tool loops suggest the run is off-track.

## Stable Sheet Palette

Map the worksheet subject to Spark's stable Apple-style palette and use the matching values for `sheet.color`, `sheet.accent`, `sheet.light`, and `sheet.border`.

- Biology: green.
- Mathematics: blue.
- Chemistry: purple.
- Physics: indigo.
- Geography: teal.
- Science: mint.
- English: pink.
- History or Religious Studies: orange.
- Economics or Business: yellow.
- Computer Science or General: gray.

Do not invent custom sheet colors.

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

- top-level keys: `schemaVersion`, `sheet`, `answers`, `review`, and optional `references`,
- `schemaVersion` is exactly `1`,
- `sheet` contains the renderable worksheet data (`id`, `subject`, `level`, `title`, `subtitle`, `color`, `accent`, `light`, `border`, `sections`),
- `answers` contains one captured student answer value for every answer-bearing leaf worksheet question id,
- do not put student answers inside `sheet.sections[].questions[]`; answers belong only in the top-level `answers` object,
- `review` contains `mode`, `score`, `label`, `message`, `note`, and `questions`,
- supported question types are `group`, `answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, and `flow`,
- use `group` only for real multipart source questions with answer-bearing subparts; do not wrap a standalone one-part question in a single-child group or invent a child prompt such as `give the conclusion`,
- for decimal-style exam labels such as `01.1` inside a `Question 1` section, do not render an extra `01` parent badge; use direct subquestions with short `badgeLabel` values like `1`, `2`, and `3`,
- every answer-bearing source item must have an answer value and a review entry,
- every scored review entry must include `status` and `score`,
- use `status: "correct"` only for full marks, otherwise use `status: "incorrect"` for partial, blank, or unresolved answers,
- `score.total` must equal the leaf question's `marks` so the UI can render `[got/total mark(s)]`,
- do not add review entries for parent `group` ids,
- keep `review.score` and `run-summary.totals` equal to the sum of per-question scores,
- format `review.label` as `N/total` and include `review.note`, which may be `""`.
- `presentation.summaryMarkdown` is the Sheets thumbnail body only: write one compact sentence or two short fragments, concrete and non-redundant. Do not repeat title, subject, level, marks, percentage, created date, or footer. Prefer a known official grade/prize/medal/percentile outcome when suitable; otherwise mention the most useful score driver, common examiner mistake made/avoided, or a concrete next learning target. Do not use generic lead-ins such as "This sheet", "The worksheet", "Graded", "Checked", or broad praise.

## Guardrails

- Keep upload inventory, workspace reading, primary transcription, final grading synthesis, and JSON assembly on the main agent.
- Use `view_image` for source-page/photo fidelity checks and rendered PDF pages when text or layout matters. Use `extract_text` for primary student/photo transcription and the fresh visual helper tools for localized crop inspection.
- When writing grader JSON, escape LaTeX backslashes correctly instead of flattening displayed source formulas, sign rows, arrays, matrices, or grids into prose.
- Generic subagents may be used only for bounded official-reference lookup/verification or visual localization proposals. pre-publish source-fidelity audits must use `validate_source_fidelity_with_fresh_agent`; reviewers compare source pages/transcripts against `sheet-plan.md` and `sheet.json` and must not grade, solve, redesign, or assemble. Final crop validation must use `validate_crop_with_fresh_agent`.
- Before downloading official PDFs found online, check `knowledge-base/index.md` and call `kb_search_pdfs`. If a matching cached PDF exists, call `kb_download_pdf` and use the local file. If no match exists, download/cache the official PDF with `kb_cache_pdf_from_url`, using semi-structured classification text such as `gcse/aqa/biology/2024/<original filename>`, and carry the returned `storagePath` into worksheet references (`paperStoragePath` or `markSchemeStoragePath`). Keep original URLs only as provenance.
- For long PDFs, pass explicit `pageNumbers` to `pdf_to_images`.
- In handwritten-grading mode, do not use `Use Figure N in the linked original PDF.` as the default for ordinary source-paper figures. Crop answer-critical figures/tables/diagrams into visible worksheet assets when the source pixels are available and feasible. Use a linked original/source PDF instruction only after bounded extraction/crop attempts show the visual is unavailable or not feasible to embed cleanly.
- In handwritten-grading mode, compact does not mean paraphrased. Preserve the exact printed wording for answered source items, and render source tables/figures visibly when the question text names them.
- Do not use `generate_json` for grader artifacts.
- Do not copy `request.json`, `brief.md`, upload manifests, planning JSON, answer lists, or process summaries into grader output JSON.
- Do not end with a normal assistant final response before publishing. The run is complete only after `publish_sheet({})` returns `status: "published"`.
