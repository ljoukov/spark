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
- generated shared PDF knowledge-base files under `knowledge-base/`

## Decide The Mode

1. Inventory all uploaded files.
2. Decide whether the source is already a worksheet/exam/question paper or whether it is notes/teaching material.
3. If it is already a worksheet/exam/question paper and there are no submitted student answers, use extraction mode and preserve source structure.
4. If it is a handwritten/fill-in grading run with student answers plus a source paper, use compact grading-report mode: preserve source numbering, marks, exact source wording for answered items, answer-critical tables/figures, and enough surrounding prompt text to make the scored feedback understandable without rebuilding irrelevant exam layout chrome.
5. If it is notes/teaching material, synthesize a concise worksheet grounded only in the uploaded material.

## Extraction Workflow

- For text-selectable PDFs, run `extract_pdf_reference_text` once as a navigation aid.
- In handwritten-grading mode, when a text-selectable source paper or mark scheme has been extracted successfully, do not send that PDF through `extract_text` again. Use the deterministic markdown reference and targeted line-range reads; reserve `extract_text` for student submissions and genuinely visual/non-text source pages.
- Start with one `extract_text` call that covers all remaining primary source targets. When one call includes multiple files, pass `instructions` that mention every workspace path and identify each file's role, so source problem text, student submissions, and official solutions stay in separate sections.
- For long extracted source/reference markdown, avoid whole-file reads. Use `grep_workspace_files` to locate headings, question numbers, figure labels, and mark-scheme items; generated-reference matches include nearby context. Use `read_workspace_file` with `startLine`/`lineCount` only for ranges where grep context is insufficient.
- Do not repeat unbounded `read_workspace_file` calls on the same large extracted reference. After the first outline or any `content omitted` response, use grep or targeted line ranges.
- For grader runs, identify the canonical paper/component/session early and carry official source URLs forward in the worksheet references when they are found.
- Before downloading an official PDF found online, check `knowledge-base/index.md` and call `kb_search_pdfs`. If a matching entry exists, call `kb_download_pdf` and use that local cached PDF. If no match exists, call `kb_cache_pdf_from_url` with semi-structured classification text such as `gcse/aqa/biology/2024/<original filename>` plus source identity, session, component, and whether it is a question paper, mark scheme, examiner report, grade boundary, or threshold document.
- When a source or reference PDF came from the shared knowledge base, include the returned shared `storagePath` in `references.paperStoragePath` or `references.markSchemeStoragePath` and in `run-summary.json` as `paperStoragePath` or `markSchemeStoragePath`. Keep `paperUrl` and `markSchemeUrl` only as provenance.
- For source PDFs with figures, run `extract_pdf_images` once on the relevant page range when available. Use useful embedded raster outputs as candidates, but remember they may omit on-page labels/captions or coordinates; validate them like any other crop and fall back to rendered pages for vector/layout-sensitive visuals.
- For printed worksheets, exam pages, figures, tables, and layout-sensitive pages, render only the relevant pages with `pdf_to_images` when page pixels are needed. In grader-publish runs, use `view_image` for source-page/photo fidelity checks and rendered PDF pages when text or layout matters. Use `extract_text` for primary transcription and the fresh visual helper tools for localized crop planning/validation.
- For long PDFs, always pass 1-based `pageNumbers` to `pdf_to_images`; choose those pages from deterministic text extraction, grep results, or the upload manifest. Do not render a whole exam paper just to look around. If `pdf_to_images` fails only because `pageNumbers` were omitted, immediately retry with explicit `pageNumbers`; that failure is a tool-use error, not evidence that the page or visual is unavailable.
- In compact grading-report mode, do not rewrite source questions into summaries such as `Figure 1 asks...` or `Table 1 gives...`. Copy the exact source question wording for every answered item, omitting only irrelevant administration chrome. Do not use `Use Figure N in the linked original PDF.` as the default for answer-critical visuals. Embed the source table as Markdown or crop the source figure when it is needed to understand the task, the student's answer, or the feedback. Preserve source column arithmetic, number grids, stacked calculations, flow/box layouts, and circled/lettered labels with visible Markdown, renderable LaTeX display layout, or a validated crop; never flatten them into a prose cue. Use a linked-source-PDF instruction only after a real render/crop/table attempt failed and the failure is recorded in the artifact plan plus the source-fidelity audit.
- If `pdf_to_images`, `extract_text`, or the fresh visual helper tools fail for a printed worksheet or exam page that truly needs visual handling, stop and fix or report that failure instead of publishing a partial text-only worksheet.
- Before publishing, compare the sheet against extracted text and viewed source pages. Fix paraphrase, omission, reordering, invented placeholder text, missing visuals, and guessed OCR. If the source is a printed photo or scan, inspect the source image/page directly instead of relying only on OCR text.
- For printed source papers, source photos, or long multi-page extracts, call `validate_source_fidelity_with_fresh_agent` before publishing and write its `reviewMarkdown` to `grader/output/source-fidelity-audit.md`. Split the audit by source page or root question when there is more than one page/root, and give the reviewer a narrow rubric: source wording is verbatim apart from minimal OCR cleanup, every visible answer-bearing or partially answered item is represented, numbering/badges match the source hierarchy, and all named figures/tables/layout-critical structures are visible near the relevant prompt.
- Mark uncertainty explicitly instead of guessing missing source text, symbols, or labels.

## Source-Fidelity Rules

- Treat uploaded question sheets as canonical source material.
- Preserve wording, numbering, formulas, notation, marks, labels, blanks, options, tables, and flow/box layouts. For official question papers, the visible worksheet prompt should be a verbatim transcription of the printed item, not a paraphrase.
- Do not treat a learner's broad focus wording as permission to drop visible source items. Focus phrases such as "first 4 paragraphs" are grading-focus guidance, not exclusions. Unless the user explicitly says to grade only specific question numbers, include every source item that is visibly answered, partially answered, selected, or left as an answer space in the submitted work; score blanks/partials normally or mark unresolved evidence explicitly instead of omitting the item.
- Preserve printed subpart labels and option labels exactly. If the UI would otherwise auto-number leaf badges, set `badgeLabel` to the visible source subpart label, for example `a`, `b`, `c`, `i`, `ii`, or `A`.
- Preserve exact root stems and interstitial wording from the source. Do not replace printed source text such as `A computer has a Central Processing Unit (CPU).` with a topic summary such as `Central Processing Unit.`
- Apply only minimal OCR/layout cleanup that keeps meaning unchanged.
- Do not simplify, reorder, paraphrase, merge, renumber, or redesign an uploaded question sheet into a nicer worksheet.
- For short uploaded problem sheets or worksheets, keep the full source problem wording and source display math/layouts in the visible worksheet prompts. Do not move the faithful problem statements only into references while publishing compact paraphrases in the questions.
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
- every visible student-submission item that will be included, including partial responses and blanks, plus an explicit reason for any visible source item intentionally excluded,
- the intended worksheet id for each leaf,
- the marks for each leaf and the expected review-score total when grading,
- each visible `Figure N`, `Table N`, graph, map, photo, or option-diagram block, its source page number, and the nearest source-faithful placement,
- whether each visual/table is transcribed as Markdown, linked as a crop, both, or kept as an explicit source-PDF reference,
- the question type for each leaf (`mcq`, `answer_bank`, `calc`, `lines`, etc.),
- the answer-state shape for each objective or structured item.

Use this plan to catch schema and placement errors before the first publish attempt. In particular, do not start a large JSON artifact until you have decided whether each fixed-option blank is an `answer_bank`, each MCQ is `full_options` or `labels_only`, and each reused figure/table is rendered once at the first source-faithful location.

## Fresh Source-Fidelity Audit

Use `validate_source_fidelity_with_fresh_agent` after `sheet-plan.md` and `sheet.json` exist and before the first publish attempt whenever the source is a printed worksheet, official exam paper, source photo, or any PDF page whose wording/figures/tables are copied into the sheet. Write the returned `reviewMarkdown` to `grader/output/source-fidelity-audit.md`; `publish_sheet` rejects source-paper sheets without a passing audit record.

- Split long source material into page-sized or root-question-sized audits. Do not ask one reviewer to verify an entire long paper at once.
- Give each reviewer the exact source page/root, the relevant source transcript lines, the planned worksheet ids, and the rendered prompt text or `sheet.json` fragment.
- Ask only for transfer fidelity: omitted visible items, non-verbatim wording, changed formulas/labels/options, wrong badge hierarchy, missing figures/tables/grids/column layouts, broken or overly broad crops, and student-answer evidence assigned to the wrong question.
- The reviewer must not grade, solve, redesign the worksheet, or rewrite the final artifact.
- Treat any omitted visible question, missing named figure/table, or paraphrased printed prompt as blocking. Update the plan and artifact, then re-audit the affected page/root before publishing.

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

Do not use `group` for a standalone one-part question. If the source has no answer-bearing subparts, put the full source prompt and marks on one leaf question instead of inventing a child prompt such as `give the conclusion` or duplicating the same display number.

Use `displayNumber` whenever the source has visible numbering such as `01.1`, `9(a)`, or `10(b)`. Use `badgeLabel` when the circular badge should be shorter than the full source label.

When the collapsible section label is already the root, such as `Question 6`, do not create an additional visible parent badge also labelled `6` just to hold the root stem. If the source has one answer-bearing root item, use a single direct question entry instead of a `6` group containing a `6` child. If the source has a root stem followed by subparts, keep the exact root stem in an unnumbered shared context where possible, or at the nearest source-faithful prompt level, and give the subparts full `displayNumber` values plus short `badgeLabel` values such as `a`, `b`, and `c`.

If a root stem is shared by both a direct first-level subpart and a later first-level group, such as `7` followed by `(a)` and then `(b)(i)`, do not attach the root stem to the `(a)` prompt where it will render beside the `a` badge. Put the exact root stem in `section.theory` or another unbadged section-level context, then render `(a)` and `(b)` as separate top-level entries.

Example shape for a `Question 7` section with root text, a direct `(a)` item, and nested `(b)(i)` leaves:

```json
{
  "label": "Question 7",
  "theory": "Embedded system: Follow Me car system.",
  "questions": [
    {
      "id": "q7a",
      "type": "lines",
      "displayNumber": "7(a)",
      "badgeLabel": "a",
      "marks": 3,
      "prompt": "Explain why the system is an example of an embedded system."
    },
    {
      "id": "q7b",
      "type": "group",
      "displayNumber": "b",
      "prompt": "For the Follow Me system:",
      "questions": [
        {
          "id": "q7bi",
          "type": "lines",
          "displayNumber": "7(b)(i)",
          "badgeLabel": "i",
          "marks": 2,
          "prompt": "State two items that will be stored in ROM for the Follow Me system."
        }
      ]
    }
  ]
}
```

For nested subparts such as `1(a)`, `1(b)`, and `1(c)`, use `displayNumber` for the full source label and `badgeLabel` for the visible subpart marker (`a`, `b`, `c`) when the renderer shows a circular item badge. Do not let those badges default to `1`, `2`, `3`.

For two-level nested source labels such as `2(a)(i)`, make the root question the section label (`Question 2`) when possible, then create one top-level `group` per first-level subpart with `displayNumber: "a"`, `displayNumber: "b"`, etc. Put the `(a)` shared stem in that group prompt. Put the answer-bearing `(i)`, `(ii)`, etc. leaves inside that group with source-faithful `displayNumber: "2(a)(i)"` and short `badgeLabel: "i"` / `"ii"`. Do not put all `2(a)(i)`, `2(a)(ii)`, `2(b)(i)` leaves directly under a single `displayNumber: "2"` group, because that renders only one composite item badge instead of separate first- and second-level circles.

For decimal-style exam labels such as `01`, `01.1`, and `01.2`, prefer one collapsible section labelled `Question 1`. Do not render an additional parent circle labelled `01`. Put the root stem in `section.theory` or the nearest unbadged context, then render the answer-bearing `01.x` leaves directly in the section with source-faithful `displayNumber` values and short `badgeLabel` values such as `1`, `2`, and `3`. The visible badges inside `Question 1` should be `1`, `2`, `3`, not `01.1`, `01.2`, `01.3`.

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
  "segments": [
    "Nuclear fission is the splitting of ",
    ". It releases energy and ",
    "."
  ],
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

- Convert textual/numeric source tables into Markdown tables whenever possible. If the source prompt says "Complete the table", the visible worksheet prompt must contain that table or a validated crop of it.
- Preserve source-authored stacked arithmetic and number grids as renderable display LaTeX or a validated crop. For binary addition, long multiplication/division, vertical column methods, or LaTeX-origin grids, prefer display LaTeX such as a `\[` `array`/`aligned` expression only when it renders cleanly. In JSON strings, LaTeX row breaks must contain two backslash characters in the final Markdown, which means escaping them as `\\\\` inside the JSON string. Do not use fenced code blocks for arithmetic layouts; the renderer adds code UI chrome that is not part of the source paper.
- Treat mathematical number grids, arranged arithmetic, matrices, and display-only sign/number layouts as math layouts rather than data tables. Preserve them with display LaTeX (`array`, matrix, or aligned environments with borders where appropriate) when that is closer to the source than a Markdown table.
- Do not describe mathematical grids as prose such as `First grid rows: ... / ...`; render the grid itself with display LaTeX.
- If a question needs a diagram, figure, graph, chart, map, network, photo, or visual option block, use the `source-image-cropping` skill and link the final crop near the source-faithful prompt.
- Link final worksheet crops with workspace-relative Markdown image links using the exact final asset path returned by the crop/trim/pad tool. Preserve the real extension exactly; `pad_image` commonly returns `.png`, and the worksheet link, crop-validation record, and fresh validation call must all use that same `.png` path.
- Prefer simple stable asset names under `grader/output/assets/...` or `sheet/output/assets/...`, but never invent a `.jpg` variant when the tool produced `.png`.
- Use clickable image Markdown such as `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)` or `[![Figure 1](grader/output/assets/q1-figure-1-border.png)](grader/output/assets/q1-figure-1-border.png)` with the matching `sheet/output/assets/...` path for draft-sheet runs.
- Place tables and figures at the nearest source-faithful level: parent `group.prompt` only when shared by all subparts or before the first subpart; child prompt when introduced inside one subquestion.
- Keep labels attached to artifacts: put `Figure N` caption text immediately adjacent to the crop and `Table N` caption text immediately adjacent to the Markdown table.
- Do not repeat the same image in later subquestions. Render it once at the first source-faithful location, then refer to it later with an anchor link such as `[Figure N](#figure-n)` / `[Table N](#table-n)` or with `Figure N above` / `Table N above`.
- Do not hide required visuals in references or transcription only.
- Never leave a visible image placeholder, empty oval/frame, broad blank crop, or text like `see source transcription` where a student needs the visual. If the visible prompt mentions an answer-critical visual, the worksheet prompt/group prompt itself must include the linked crop or a Markdown table whenever the source pixels/text are available.
- Prefer crops for ordinary source visuals that are actually present in the uploaded/source PDF and feasible to crop. Use a linked original/source PDF reference only as a fallback for visuals that are not available as pixels in the working source, are supplied only through a source link, or cannot be cropped without making a broken/fake visual after a recorded attempt.
- In compact grading-report mode, embed answer-critical source-paper visuals and tables. Do not spend the grading run recreating irrelevant decoration, but do crop the figure/table/diagram block that the learner must see to understand or answer a worksheet item.
- Do not treat public-PDF figure omissions, source-insert omissions, or source notices as blockers. Spark is making a private student study UI that can link to the original/source PDF. When a required visual truly cannot be embedded after a real render/crop/table attempt, preserve the question, keep the `Figure N` wording, and write a visible instruction such as `Use Figure N in the linked original PDF.`
- Do not exclude a source question, remove its marks, or call it ungradable solely because a public PDF omits a figure/map/photo or because an insert is missing. Keep the source question in the sheet, preserve the student's response, and grade against the official mark scheme when the response and mark points make assessment possible.
- Only report a blocking issue when the question cannot be understood or graded from the uploaded/official source material and no useful source-PDF reference is available.
- Before publishing, grep the transcription for named references such as `Figure 9` or `Table 5`; every included answer-critical `Figure N` must have a linked image near that label unless the artifact plan records why embedding was impossible, and every extracted text/numeric `Table N` must have a Markdown table near that label.
- If repeated visual extraction, crop validation, or publish repairs suggest the run is looping, call `review_run_progress_with_fresh_agent` and follow its continue/switch/stop recommendation instead of trying the same path again.

## Publishing Gate

Before calling `publish_sheet_draft` or `publish_sheet`:

- for grader runs, `grader/output/sheet.json` is the full graded report wrapper (`schemaVersion`, `sheet`, `answers`, `review`, optional `references`), not the bare `sheet` object,
- for draft-sheet runs, `sheet/output/draft.json` is the draft wrapper (`schemaVersion`, `mode`, `sheet`, optional `references`),
- every visible source question/subquestion is represented in source order,
- output JSON validates against the current sheet contract,
- source-fidelity checks have happened against extracted text and viewed page images,
- required visual crops are linked in the visible worksheet, target real workspace files, and have passed crop validation when applicable; text/numeric tables are rendered as Markdown near their labels; visual source-PDF references are visible next to the relevant source figure label only when `sheet-plan.md` and the source-fidelity audit record why a real crop/table attempt failed,
- prompts do not contain literal escaped newline text such as `\n`; use real Markdown line breaks, tables, or clean crops for layout-critical content,
- optional URL fields such as `references.paperUrl` or `references.markSchemeUrl` are omitted unless a real non-empty URL is known; use `paperStoragePath` / `markSchemeStoragePath` for cached shared PDFs whenever available,
- metadata is natural and non-redundant across `sheet.title`, `sheet.subtitle`, `sheet.level`, and presentation fields,
- `presentation.footer` is source/provenance identity only, not a process label such as `transcription`, `OCR text`, or `artifact`; naming the OCR exam board is fine when it is the actual source identity, but do not repeat the visible title, subject, level, or subtitle,
- the summary is concise, student-facing, and free of IDs, file paths, and process narration.

If publishing fails:

- Treat the error as a diagnosis of the artifact plan, not as a reason to keep making local line edits.
- For schema, placement, duplicated-image, answer-shape, or review-score failures, update the artifact plan and rewrite the affected JSON object or full JSON artifact coherently.
- Avoid fragile line patches against a large JSON file after the first failed patch attempt; read the artifact, fix the model, and rewrite the relevant object or file.
- If the same class of publish failure recurs after a coherent repair, stop and report the validation error as a workflow/skill issue instead of continuing the same branch.
