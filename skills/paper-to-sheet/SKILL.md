---
name: paper-to-sheet
description: Use when converting an uploaded PDF, worksheet, exam page, or source-photo into a structured editable worksheet sheet.
---

# Paper To Sheet

Use this skill to translate source material into the paper-sheet JSON contract. It is for draft-sheet runs, source-paper-only grader runs, and grader runs that truly need source-paper reconstruction.

## Inputs

- `brief.md`
- `request.json`
- upload manifest, usually `grader/uploads/index.json`
- caller task file, such as `sheet/task.md` or `grader/task.md`
- source uploads under `grader/uploads/<filename>`

## Decide The Mode

1. Inventory all uploaded files.
2. Decide whether the source is already a worksheet/exam/question paper or whether it is notes/teaching material.
3. If it is already a worksheet/exam/question paper and there are no submitted student answers, use extraction mode and preserve source structure.
4. If it is a handwritten/fill-in grading run with student answers plus a source paper, use compact grading-report mode: preserve source numbering, marks, and enough prompt text to make the scored feedback understandable, but do not rebuild every visual and layout feature from the source paper.
5. If it is notes/teaching material, synthesize a concise worksheet grounded only in the uploaded material.

## Extraction Workflow

- For text-selectable PDFs, run `extract_pdf_reference_text` once as a navigation aid.
- In handwritten-grading mode, when a text-selectable source paper or mark scheme has been extracted successfully, do not send that PDF through `extract_text` again. Use the deterministic markdown reference and targeted line-range reads; reserve `extract_text` for student submissions and genuinely visual/non-text source pages.
- Start with one `extract_text` call that covers all remaining primary source targets.
- For long extracted source/reference markdown, avoid whole-file reads. Use `grep_workspace_files` to locate headings, question numbers, figure labels, and mark-scheme items; generated-reference matches include nearby context. Use `read_workspace_file` with `startLine`/`lineCount` only for ranges where grep context is insufficient.
- Do not repeat unbounded `read_workspace_file` calls on the same large extracted reference. After the first outline, use grep or targeted line ranges.
- For grader runs, identify the canonical paper/component/session early and carry official source URLs forward in the worksheet references when they are found.
- For source PDFs with figures, run `extract_pdf_images` once on the relevant page range when available. Use useful embedded raster outputs as candidates, but remember they may omit on-page labels/captions or coordinates; validate them like any other crop and fall back to rendered pages for vector/layout-sensitive visuals.
- For printed worksheets, exam pages, figures, tables, and layout-sensitive pages, render only the relevant pages with `pdf_to_images` when page pixels are needed. In grader-publish runs the main agent does not inspect images directly with `view_image`; use `extract_text` for transcription and the fresh visual helper tools for localized crop planning/validation.
- For long PDFs, always pass `pageNumbers` to `pdf_to_images`; choose those pages from deterministic text extraction, grep results, or the upload manifest. Do not render a whole exam paper just to look around.
- In compact grading-report mode, use rendered pages and extracted images only to disambiguate student answers, important figures, or source structure that text extraction did not capture. Prefer visible `Use Figure N in the linked original PDF.` instructions for source-paper visuals instead of creating and validating many crops.
- If `pdf_to_images`, `extract_text`, or the fresh visual helper tools fail for a printed worksheet or exam page that truly needs visual handling, stop and fix or report that failure instead of publishing a partial text-only worksheet.
- Before publishing, compare the sheet against extracted text and viewed pages. Fix paraphrase, omission, reordering, invented placeholder text, missing visuals, and guessed OCR.
- Mark uncertainty explicitly instead of guessing missing source text, symbols, or labels.

## Source-Fidelity Rules

- Treat uploaded question sheets as canonical source material.
- Preserve wording, numbering, formulas, notation, marks, labels, blanks, options, tables, and flow/box layouts.
- Apply only minimal OCR/layout cleanup that keeps meaning unchanged.
- Do not simplify, reorder, paraphrase, merge, renumber, or redesign an uploaded question sheet into a nicer worksheet.
- Do not omit cover-page scoring rules when needed, but do omit administration boilerplate from visible worksheet content when it is not needed to answer a question.
- Every worksheet question must include `marks`. For source-paper-only unanswered sheets, marks are still the source total for that question even though no score is awarded yet.
- Use real source sections when present. Otherwise use useful collapsible navigation:
  - one section per substantial root question with subparts or shared context,
  - neutral contiguous ranges for long runs of small standalone questions.
- Do not use meaningless section labels such as `S1`, invent difficulty labels, put a long paper in one giant section, or group multiple large multipart roots into one numeric range.

## Preflight Artifact Plan

Before writing a large `sheet.json` or `draft.json`, make a compact artifact plan. For long papers, write it to `grader/output/sheet-plan.md` or `sheet/output/sheet-plan.md` so later repairs have one source of truth.

The plan should list:

- every source root and answer-bearing leaf in order,
- the intended worksheet id for each leaf,
- the marks for each leaf and the expected review-score total when grading,
- each visible `Figure N`, `Table N`, graph, map, photo, or option-diagram block and the nearest source-faithful placement,
- whether each visual/table is transcribed as Markdown, linked as a crop, both, or kept as an explicit source-PDF reference,
- the question type for each leaf (`mcq`, `answer_bank`, `calc`, `lines`, etc.),
- the answer-state shape for each objective or structured item.

Use this plan to catch schema and placement errors before the first publish attempt. In particular, do not start a large JSON artifact until you have decided whether each fixed-option blank is an `answer_bank`, each MCQ is `full_options` or `labels_only`, and each reused figure/table is rendered once at the first source-faithful location.

## Paper-Sheet Modeling

Use only these question types:

- `group`
- `answer_bank`
- `fill`
- `cloze`
- `mcq`
- `lines`
- `calc`
- `match`
- `spelling`
- `flow`

Use `group` when one numbered source question owns shared context such as a stem, table, figure, or instruction before answer-bearing subparts. Put only the shared source text that appears before the first subpart in `group.prompt`; put interstitial text before later subparts into the following child prompt.

Use `displayNumber` whenever the source has visible numbering such as `01.1`, `9(a)`, or `10(b)`. Use `badgeLabel` only when the circular badge should be shorter than the full source label.

For decimal-style roots such as `01`, `01.1`, `01.2`, create a parent `group` with `displayNumber: "01"` and nest the `01.x` children in `questions[]`; do not put those child questions flat in the section.

Use `answer_bank` when the source prints visible blanks plus a fixed option bank such as `(A)` to `(D)`. Keep running sentence prose in `segments[]`, keep source labels in `options[].label`, and omit decorative underscore or bracket markers from segments. Use `displayMode: "inline_labeled"` by default; use `banked` only when the source shows a separate answer bank or the labelled option text is too long for the selector.

For `answer_bank`, `segments.length` must equal `blanks.length + 1`. Each blank has a plain object such as `{ "placeholder": "term" }` or `{}`. Each option needs a stable `id`, a source label such as `A`, and source option text. Example:

```json
{
  "id": "q02_1",
  "type": "answer_bank",
  "displayNumber": "02.1",
  "marks": 3,
  "prompt": "Complete the sentences.",
  "displayMode": "inline_labeled",
  "segments": ["Nuclear fission is the splitting of ", ". It releases energy and ", "."],
  "blanks": [{ "placeholder": "particle" }, { "placeholder": "radiation" }],
  "options": [
    { "id": "nuclei", "label": "A", "text": "nuclei" },
    { "id": "neutrons", "label": "B", "text": "neutrons" },
    { "id": "gamma", "label": "C", "text": "gamma rays" }
  ]
}
```

Use `mcq` for multiple choice. Keep the stem in `prompt`, options in `options[]`, and choose `displayMode: "full_options"` by default. Use `labels_only` only when the source options are already visible in the prompt or are diagram labels/positions. Do not invent placeholder option text such as `Option A`.

For `mcq` in `labels_only` mode, every option still needs a source-faithful `label` such as `A`, `B`, `C`, or `D`. If the choice meaning is not already visible in the prompt or diagram, use `full_options`. For diagram-position MCQs, `options[].text` may be omitted or empty; do not invent generic option text.

Use `calc` or `fill` for short numeric answer lines such as `Answer ____ £`. Use `lines` only for longer free responses, explanations, proofs, or working that do not fit richer structured types.

For `calc`, include `inputLabel` and `unit`. Do not add unsupported fields such as `lines` to a `calc` question. For section introduction blocks, use only top-level section entries shaped exactly as `{ "type": "hook", "text": "..." }` inside `sheet.sections[]`. Never put a `hook` object inside a section's `questions[]`; `questions[]` may contain only `group`, `answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, or `flow` entries. Otherwise put shared stems, tables, and figures in `group.prompt` or a question prompt.

Use `flow` for box-and-arrow calculation structures. Keep each row's `items` array in printed left-to-right order and use `direction` only to describe arrow direction.

## Visuals And Tables

- Convert textual/numeric source tables into Markdown tables whenever possible.
- If a question needs a diagram, figure, graph, chart, map, network, photo, or visual option block, use the `source-image-cropping` skill and link the final crop near the source-faithful prompt.
- Link final worksheet crops with workspace-relative Markdown image links using the exact final asset path returned by the crop/trim/pad tool. Preserve the real extension exactly; `pad_image` commonly returns `.png`, and the worksheet link, crop-validation record, and fresh validation call must all use that same `.png` path.
- Prefer simple stable asset names under `grader/output/assets/...` or `sheet/output/assets/...`, but never invent a `.jpg` variant when the tool produced `.png`.
- Use clickable image Markdown such as `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)` or `[![Figure 1](grader/output/assets/q1-figure-1-border.png)](grader/output/assets/q1-figure-1-border.png)` with the matching `sheet/output/assets/...` path for draft-sheet runs.
- Place tables and figures at the nearest source-faithful level: parent `group.prompt` only when shared by all subparts or before the first subpart; child prompt when introduced inside one subquestion.
- Keep labels attached to artifacts: put `Figure N` caption text immediately adjacent to the crop and `Table N` caption text immediately adjacent to the Markdown table.
- Do not repeat the same image in later subquestions. Render it once at the first source-faithful location, then refer to it later with an anchor link such as `[Figure N](#figure-n)` / `[Table N](#table-n)` or with `Figure N above` / `Table N above`.
- Do not hide required visuals in references or transcription only.
- Never leave a visible image placeholder, empty oval/frame, broad blank crop, or text like `see source transcription` where a student needs the visual. If the visible prompt mentions an answer-critical visual, the worksheet prompt/group prompt itself must include either the linked crop or an explicit instruction to use that exact figure in the linked original/source PDF.
- Prefer crops for ordinary source visuals that are actually present in the uploaded/source PDF and feasible to crop. Use a linked original/source PDF reference as a fallback for visuals that are not available as pixels in the working source, are supplied only through a source link, or cannot be cropped without making a broken/fake visual.
- In compact grading-report mode, the linked-source-PDF instruction is the default for source-paper figures unless the crop is needed to explain feedback or the learner cannot otherwise identify the visual. Do not spend the grading run validating a long list of source-paper crops.
- Do not treat public-PDF figure omissions, source-insert omissions, or source notices as blockers. Spark is making a private student study UI that can link to the original/source PDF. When the visual should remain in that linked PDF instead of becoming a worksheet crop, preserve the question, keep the `Figure N` wording, and write a visible instruction such as `Use Figure N in the linked original PDF.`
- Do not exclude a source question, remove its marks, or call it ungradable solely because a public PDF omits a figure/map/photo or because an insert is missing. Keep the source question in the sheet, preserve the student's response, and grade against the official mark scheme when the response and mark points make assessment possible.
- Only report a blocking issue when the question cannot be understood or graded from the uploaded/official source material and no useful source-PDF reference is available.
- Before publishing, grep the transcription for named references such as `Figure 9` or `Table 5`; every included `Figure N` must have a linked image or visible linked-source-PDF instruction near that label, and every extracted text/numeric `Table N` must have a Markdown table near that label.
- If repeated visual extraction, crop validation, or publish repairs suggest the run is looping, call `review_run_progress_with_fresh_agent` and follow its continue/switch/stop recommendation instead of trying the same path again.

## Publishing Gate

Before calling `publish_sheet_draft` or `publish_sheet`:

- for grader runs, `grader/output/sheet.json` is the full graded report wrapper (`schemaVersion`, `sheet`, `answers`, `review`, optional `references`), not the bare `sheet` object,
- for draft-sheet runs, `sheet/output/draft.json` is the draft wrapper (`schemaVersion`, `mode`, `sheet`, optional `references`),
- every visible source question/subquestion is represented in source order,
- output JSON validates against the current sheet contract,
- source-fidelity checks have happened against extracted text and viewed page images,
- required visual crops are linked in the visible worksheet, target real workspace files, and have passed crop validation when applicable; visual source-PDF references are visible next to the relevant source figure label when the visual is intentionally left in the linked original/source PDF,
- prompts do not contain literal escaped newline text such as `\n`; use real Markdown line breaks, tables, or clean crops for layout-critical content,
- optional URL fields such as `references.paperUrl` or `references.markSchemeUrl` are omitted unless a real non-empty URL is known,
- metadata is natural and non-redundant across `sheet.title`, `sheet.subtitle`, `sheet.level`, and presentation fields,
- `presentation.footer` is source/provenance identity only, not a process label such as `transcription`, `OCR text`, or `artifact`; naming the OCR exam board is fine when it is the actual source identity, but do not repeat the visible title, subject, level, or subtitle,
- the summary is concise, student-facing, and free of IDs, file paths, and process narration.

If publishing fails:

- Treat the error as a diagnosis of the artifact plan, not as a reason to keep making local line edits.
- For schema, placement, duplicated-image, answer-shape, or review-score failures, update the artifact plan and rewrite the affected JSON object or full JSON artifact coherently.
- Avoid fragile line patches against a large JSON file after the first failed patch attempt; read the artifact, fix the model, and rewrite the relevant object or file.
- If the same class of publish failure recurs after a coherent repair, stop and report the validation error as a workflow/skill issue instead of continuing the same branch.
