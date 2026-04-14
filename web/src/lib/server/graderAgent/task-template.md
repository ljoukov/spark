# Grader task

You are grading student uploaded work and related reference documents.

## Inputs

Read these files first:

1. `brief.md`
2. `request.json`
3. `grader/uploads/index.json`

Uploaded student work (photos/PDFs/text) is also attached in the model context. Treat it as the ground truth for transcription.
Linked uploads are available in the workspace under `grader/uploads/<filename>`.

## Required workflow

1. Inventory and classify uploads first:
   - read `grader/uploads/index.json` and classify each upload as:
     - student submission target,
     - problem statement target,
     - official solution / mark-scheme target.
   - treat uploaded files as the primary source of truth.
   - if a file role is uncertain, make your best guess and note uncertainty in the worksheet references.
2. Run one extraction-first transcription pass:
   - use exactly one initial `extract_text` call to transcribe all primary targets.
   - include all transcription targets in `documentPaths`:
     - student submission files,
     - uploaded problem statement files,
     - uploaded official solution files (if provided).
   - write to `grader/output/transcription.md`.
   - in `instructions`, require separate sections for student submissions, problem statements, and official solutions, each with source filenames.
   - for student submissions, produce complete transcription, not a summary or retelling.
   - when a page mixes printed prompt text and student-written answers (for example fill-in-the-blank work on the same sheet), explicitly distinguish the original prompt from the student's supplied response.
   - if a student answer only makes sense with nearby prompt text, include the needed prompt fragment but label it clearly (for example `Prompt fragment:` and `Student response:`) so later grading never confuses the two.
   - for uploaded problem statements and official solutions, keep the source wording as verbatim as possible: preserve numbering, labels, examples, punctuation, variable names, and displayed math.
   - only fix obvious OCR/layout issues when meaning is unchanged; do NOT paraphrase, summarize, or rewrite problem statements into "cleaned" canonical wording.
   - if any problem-statement wording remains uncertain after extraction, mark the uncertainty explicitly instead of silently rewriting it.
   - if the uploads include a printed worksheet or exam paper, run `pdf_to_images` and inspect relevant page images before you finalize worksheet structure; use `draw_grid_overlay`, `crop_image`, and `trim_image` when page crops or tighter figure bounds are needed.
   - for text-selectable PDFs, run `extract_pdf_reference_text` once before bulk visual inspection and use it as a navigation/transcription aid. It is not a substitute for rendered-page checks of figures, labels, tables, or layout.
   - on long papers, keep the main context small: use extracted reference text plus page overviews for transcription, then call `validate_crop_with_fresh_agent` once for each final linked figure/image crop with workspace paths and question context instead of opening every high-resolution crop in the main agent.
   - render PDF pages at the highest useful resolution available, using the default high-resolution `pdf_to_images` output unless a smaller scale is explicitly needed for a quick overview. Do not crop from thumbnail/downscaled screenshots when original page images are available.
   - after extraction, identify the worksheet questions and the student's submitted answer for each one.
   - for objective or multiple-choice work, keep answer capture separate from solving:
     - first record what the student visibly selected or wrote,
     - then establish the correct-answer baseline,
     - then apply the scoring rules.
   - record a selected MCQ/objective option only when there is an explicit answer-selection mark such as a circle, tick, filled bubble, box, underline/arrow clearly targeting an option, or other unambiguous selection.
   - ignore unrelated scribbles, doodles, workings, crossings-out, diagram annotations, and solved/correct options when deciding the student's selected answer.
   - if no selected option is visible, treat the response as blank/no-answer. Do not infer a choice from the correct answer, from nearby workings, or from the answer you derive while solving. Use `""` for an unanswered MCQ value; never substitute a real option id or add a fake source option.
   - keep student math, variable naming, terminology, and method choice as verbatim as possible (do not rename variables, rewrite formulas, swap in more advanced methods, or change mathematical expressions).
   - you may improve readability only by splitting content into worksheet questions / blanks / answer fields, adding light structure, and fixing obvious spelling mistakes when meaning is unchanged.
   - do not merge, reorder, or silently omit student work that is part of the submission.
   - ignore unrelated scribbles/doodles that are clearly not part of the solution.
   - do not pass these target files via `supportingPaths`; they are primary transcription targets.
   - after this call, read `grader/output/transcription.md` for cleanup and do not repeat an identical call.
3. Determine paper + references:
   - infer the paper, assignment, or document context, year, and source title from transcribed problem statements + user request.
   - check `request.json` input `referenceSourcePolicy` before any online search:
     - `uploaded-only`: do NOT use `web_search` for missing problems/solutions.
     - `allow-official-references`: `web_search` may be used for official publisher/exam-board/competition sources, including official problem statements, answer keys, mark schemes, and official solutions, when the source is identifiable or the reference is missing/unclear. Do not use unofficial solution mirrors for the correct-answer baseline.
     - `allow-online-search-when-problems-missing`: online search is allowed only when problem statements are missing or low quality.
   - prefer official publisher, exam-board, school, or competition URLs over mirror hosts.
   - for official PDF sources, do NOT use `web_fetch`.
   - if you need additional official PDFs/images, include them in `documentPaths` for a follow-up `extract_text` call with clear role instructions.
   - only use `web_fetch` for non-PDF pages (for example thresholds/help pages).
4. Establish official solution baseline:
   - if official solutions are available (uploaded or found online), use them.
   - if the source is an identified public paper and `referenceSourcePolicy` is `allow-official-references`, search for official answer keys, mark schemes, or official solutions before self-solving. Use official sources only; if no official source is found, solve the problems yourself.
   - if `referenceSourcePolicy` is `uploaded-only`, do NOT search online for solutions; solve each problem yourself from uploaded/pasted materials.
   - if `referenceSourcePolicy` is `allow-online-search-when-problems-missing` and problem statements are already uploaded/clear, do NOT search online for solutions; solve each problem yourself unless official solutions were uploaded.
   - if official solutions are unavailable, solve each problem yourself very carefully before grading.
   - when self-solving, match the student's level where reasonable: prefer their terminology, notation style, and method family so the derived solution is easier for that student to follow.
   - do not introduce substantially more advanced machinery unless it is necessary for correctness; if you must, say so explicitly.
   - when self-solving, clearly mark this in worksheet references as "Derived solution (official solution unavailable)".
   - if this is a source-paper-only/no-student run, skip this solution-baseline step entirely unless the user explicitly asked for answers. Do not output derived answers, likely answers, correct MCQ options, worked solutions, or answer-key notes anywhere.
5. Use fresh visual agents only for per-crop validation:
   - perform transcription and reference gathering (steps 1-4) with the main agent only.
   - generic `spawn_agent` is not available in grader runs and must not be used for intake, upload inventory, workspace file reading, transcription, or file summaries.
   - keep short routine worksheet questions in the main agent; do NOT attempt to delegate just because there are many small questions.
   - do NOT delegate long runs of short objective/MCQ questions just to check answer keys. Use official references when allowed; otherwise verify the objective answer baseline in the main agent.
   - every final linked figure/image crop must be reviewed with its own `validate_crop_with_fresh_agent` call and the question context; the fresh reviewer must use `view_image`, transcribe all visible text in the crop, and confirm that all necessary labels/options/table cells/axes/annotations are visible.
   - the main agent must consolidate the final worksheet output and may grade all problems itself when no dedicated crop validation is needed.
6. Convert the graded worksheet into one worksheet report:
   - write one JSON file at `grader/output/sheet.json`.
   - the whole uploaded worksheet/submission becomes one sheet artifact.
   - if the worksheet has several questions or problems, represent them inside `sheet.sections[].questions[]`; do NOT create separate top-level report files such as `p1.json`, `p2.json`, etc.
   - the JSON must be renderable by the worksheet UI and must validate against this conceptual shape:

```json
{
	"schemaVersion": 1,
	"sheet": {
		"id": "string",
		"subject": "string",
		"level": "string",
		"title": "string",
		"subtitle": "string",
		"color": "#123456",
		"accent": "#123456",
		"light": "#123456",
		"border": "#123456",
		"sections": [
			{ "type": "hook", "text": "string" },
			{
				"id": "A",
				"label": "string",
				"theory": "string",
				"infoBox": { "icon": "string", "title": "string", "text": "string" },
				"questions": [
					{
						"id": "q1",
						"type": "lines",
						"displayNumber": "1",
						"marks": 2,
						"prompt": "string",
						"lines": 4
					}
				]
			}
		]
	},
	"answers": {},
	"review": {
		"score": { "got": 0, "total": 0 },
		"label": "string",
		"message": "string",
		"note": "string",
		"questions": {}
	},
	"references": {
		"problemMarkdown": "string",
		"officialProblemMarkdown": "string",
		"officialSolutionMarkdown": "string",
		"studentTranscriptMarkdown": "string",
		"gradingMarkdown": "string",
		"overallFeedbackMarkdown": "string",
		"paperUrl": "string",
		"markSchemeUrl": "string"
	}
}
```

7. Worksheet-report rules:
  - the worksheet UI supports these question types: `group`, `answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`.
  - `grader/output/transcription.md` must include both student-answer transcription and source problem-statement transcription when a printed/source paper is uploaded. Put the source transcript under the exact heading `## Source problem-statement transcription`. The source transcription must record printed root stems, interstitial context, subquestion prompts, table labels, figure labels, and MCQ option labels/text in source order; an audit note alone is not enough.
  - represent every assessed source question and subquestion in source order, including blank or unanswered items. Do not decide to include only answered items, only confident grades, or only questions with visible student writing.
  - if the request is source-paper-only and no student answers/submission are present, render the source as an unanswered worksheet instead of solving it:
     - skip solution-baseline derivation unless the user explicitly asked for answers,
     - leave answers blank; use `""` for unanswered MCQ and answer-bank selections,
     - set `review.mode` to `"awaiting_answers"`,
     - use review/status labels such as `Awaiting answer`,
     - omit per-question `review.questions[questionId].score`,
     - keep per-question notes empty so the UI does not show review cards for blank source worksheets,
     - do not treat every item as a completed zero-score attempt,
     - do not expose an answer key in visible prompts, review notes, or reference markdown unless the user explicitly asked for answers.
     - omit `officialSolutionMarkdown` and grading-rationale reference fields instead of writing placeholder text such as `No official solution was included`; keep only source/problem/provenance references needed to audit the transcription.
  - choose the most natural supported worksheet type for each student-facing prompt:
     - `group` for one numbered source question that has shared context such as a stem, table, figure, or instruction before multiple answer-bearing subparts,
     - `answer_bank` for visible blanks paired with a fixed printed option bank such as `(A)` to `(D)`,
     - `fill` for literal blanks / short phrase completions,
     - `cloze` for short inline multi-blank text where the original printed sentence should stay visible,
     - `mcq` for multiple choice,
     - `calc` for short numeric / formula answers with a unit,
     - `match` for matching prompts,
     - `spelling` for spelling-correction prompts,
     - `flow` for printed box-and-arrow calculations or step chains that the student saw on the worksheet,
     - `lines` for any longer explanation, proof, justification, or working that does not cleanly fit the other types.
   - if a numbered source question has shared context before subparts, keep that numbered parent as a `group` entry and place the shared Markdown/table/figure in `group.prompt` rather than duplicating it into each child prompt or moving it into `section.theory`.
   - put only the source text that appears after the root number and before the first subpart in the root `group.prompt`; put interstitial text that appears between later subparts into the following child prompt, and do not duplicate the root stem inside the first child prompt.
   - if the source uses subpart numbering such as `01.1` or `5(a)`, keep an explicit parent/group entry for that root question even when only one marked child subpart is visible on the page.
   - for decimal-style subparts such as `01.1`, `01.2`, `01.3`, create a parent `group` with `displayNumber: "01"` and put those subparts in that group's `questions[]`; do not place `01.x` child questions flat in the section.
   - use `displayNumber` whenever the source has visible numbering such as `01.1`, `9(a)`, or `10(b)`.
   - use `badgeLabel` only when the circular badge should differ from the full source label, for example `displayNumber: "10(a)"` with `badgeLabel: "a"`.
   - use worksheet sections as useful collapsible navigation:
     - use real source sections when the paper has them,
     - for a long multi-part root question, a section labelled with that root question (for example `Question 1`) is appropriate because it contains the parent stem plus its subparts,
     - use one section per root question when roots have subquestions or substantial shared context,
     - for a long unsectioned run of many small standalone questions, split into contiguous neutral ranges such as `Questions 1-5`, `Questions 6-10`, etc.,
     - do not group multiple multi-part root questions into one numeric-range section,
     - do not put a whole long paper into one giant `Questions` section,
     - do not create meaningless ids/labels such as `S1`, and do not invent difficulty labels or reorder questions.
   - omit cover-page and administration boilerplate from the visible worksheet when it is not needed to answer or grade the questions, including invigilator instructions, pencil rules, venue/event text, and generic "do not open" guidance. Keep source provenance and relevant scoring rules in `references.*Markdown` instead.
   - when in doubt, use `lines`; do not invent unsupported question types or flatten richer supported structures just to avoid modeling them.
   - every worksheet question must include `marks`.
   - `mcq` questions must include structured `options[]` and a valid `displayMode`: use `full_options` when selectable cards should show the full option text, and `labels_only` only when the full options are already shown in the prompt or labels are clearer. Do not convert source MCQs to `lines` merely to satisfy schema validation.
   - if `displayMode` is `labels_only`, every MCQ option must still include a source-faithful `label` such as `A`, `B`, `C`, or `D`; use `full_options` when a compact label-only card would hide important option text.
   - for MCQs whose source choices are only diagram labels or positions, use `displayMode: "labels_only"` with source labels and omit `options[].text` (or set it to `""`). Do not invent visible placeholder text such as `Option A`; the diagram/prompt already carries the meaning.
   - do not duplicate MCQ choice labels in the prompt when choices are already represented by `options[]`: remove bare `(A)`, `(B)`, `(C)`, `(D)` lines from prompt text unless each line includes source option content that is not otherwise represented.
   - preserve source MCQ labels and option text faithfully; if no option is visibly selected by the student, keep the answer value as `""` instead of adding a fake no-answer option or inventing a real choice.
   - `lines` questions must include `lines` as a positive integer.
   - `calc` questions must include `inputLabel` and `unit`; do not add unsupported `lines` fields to `calc`.
   - `cloze` questions must preserve the surrounding sentence in `segments[]` and the blank count in `blanks[]`.
   - `answer_bank.segments[]` must stay as clean prose around the interactive blank; do not include decorative `(____)` wrappers or dangling closing brackets copied from the printed blank markers.
   - if you use a non-question hook/introduction in a section, it must be exactly `{ "type": "hook", "text": "..." }`; otherwise put source stems, tables, and figures in `group.prompt` or a question prompt.
   - omit optional URL fields such as `references.paperUrl` or `references.markSchemeUrl` unless you have a real non-empty URL; do not set optional URLs to `""`.
   - preserve textual or numeric source tables as Markdown tables whenever possible; do not collapse them into prose summaries when the table structure matters.
   - if a figure area contains a transcribable text/numeric table, transcribe that table as Markdown in the worksheet even when you also include a crop for nearby visual context.
   - do not put literal escaped newline text like `\n` in visible prompts. For multiline source layouts, use real Markdown line breaks. For arranged arithmetic, grids, or layout-critical text, prefer a Markdown table or a clean crop over raw LaTeX array/tabular environments that may render as red source text.
   - when writing `grader/output/sheet.json` directly, it must be valid JSON: either avoid LaTeX backslash syntax in prompt strings or JSON-escape every backslash as `\\` (for example `\\(y = mx + c\\)`). Prefer plain Unicode math text when it is readable.
  - place tables and figures at the nearest source-faithful level: in the parent `group.prompt` only when shared by all subparts or located before the first subpart, and in the child prompt if only that subquestion uses or introduces the material. Do not hoist child-specific figures/tables to the section start or parent group just because Markdown renders there.
   - keep labels attached to their own artifacts: put `Figure N` caption text immediately adjacent to the `Figure N` crop, and put `Table N` caption text immediately adjacent to the `Table N` Markdown table. Do not place a table between a figure caption and the figure image.
   - do not repeat the same figure/table image in later subquestions; render it once at the first source-faithful location and refer to it with an anchor link such as `[Figure N](#figure-n)` / `[Table N](#table-n)` or with `Figure N above` / `Table N above` when the artifact is directly above.
   - before publishing, compare named references in `grader/output/transcription.md` against the worksheet: every included `Figure N` must have a linked crop near that label, and every extracted text/numeric `Table N` must have a Markdown table near that label.
   - when a figure, photo, graph, or diagram matters to the question, crop it from the source into `grader/output/assets/...` and reference the final worksheet crop from worksheet Markdown using a workspace-relative clickable image link with a `.jpg` target such as `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)`. `publish_sheet` normalizes linked worksheet crops to JPEG with max 512 px on either axis.
   - references and transcription files are audit trails only. If a student needs a diagram, figure, graph, chart, map, network, photo, or other visual to answer a question, that visible worksheet prompt/group prompt must link the final crop near the question text. Do not write `see source transcription` or `included in references` instead of showing the visual.
   - for objective questions whose answer choices are diagrams, treat the option image as high-risk: either crop one complete options block or separate complete option crops, but every candidate label and every option diagram/shape must be fully visible. Do not publish crops where a candidate option is cut off at the crop edge or where the crop includes clipped neighbouring prompt text that should instead be transcribed.
   - never validate option-diagram crops as `top/bottom portions`, `used together`, or partial fragments. A final option crop must contain whole candidate labels and whole candidate diagrams; if a row does not fit, recrop a larger complete options block or create one complete crop per candidate.
   - crop workflow for important figures/tables:
     - render the source PDF page with `pdf_to_images`,
     - view the page with `view_image`,
     - create a labelled coarse grid using `draw_grid_overlay`,
     - if bounds are uncertain, use `propose_crop_bbox_with_fresh_agent` with the poor crop/full page/grid overlay paths so a fresh visual agent follows the rectangular JSON workflow and returns one bbox; you may also use `extract_pdf_diagrams` as a Gemini-assisted coarse bounding-box proposal or cross-check,
     - if one manual crop-and-view correction for the same target is still clipped/noisy/uncertain, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` for that source page and target label before spending more turns on hand-tuned crop boxes,
     - crop from the original page image with `crop_image`,
     - inspect the crop with `view_image` at highest/original detail when available,
     - crop around the visual artifact itself; transcribe printed captions/stems such as `Figure 1 shows...` into Markdown and exclude duplicated caption/question text from the image crop unless those words are part of a visual label, axis, or legend,
     - the worksheet renders artifact labels separately, so exclude standalone `Figure N` / `Table N` captions from the crop unless removing the caption would clip required visual content,
     - for figure isolation/refinement, use a rectangular crop workflow:
       - do not do mask segmentation; produce one clean rectangular crop per target figure,
       - start from a previous bad crop if it contains the whole figure, otherwise use the full source page,
       - inspect both the selected base image and its coordinate-grid overlay with `view_image`,
       - choose one pixel bounding box in the selected base image coordinate space,
       - prefer a small safe white margin over any clipping,
       - reject crops that include surrounding question text, mark text, answer lines, page borders, next-question content, or standalone `Figure N` / `Table N` captions already rendered by the worksheet,
       - when documenting a crop-refinement decision, use JSON shape `{ "cropBase": "badCrop" | "fullPage", "bbox": { "left": number, "top": number, "right": number, "bottom": number }, "reasoning": "brief edge-by-edge explanation", "risks": [] }`,
       - coordinate convention: origin is top-left, `left`/`top`/`right`/`bottom` are pixel coordinates, and `right`/`bottom` are exclusive crop boundaries,
       - apply the returned box with `crop_image` using `bboxPixels` on the selected base image,
	     - use `trim_image` only for safe whitespace tightening after the complete crop is known,
	     - leave a small clean margin around all question-relevant ink; do not let labels, lines, axes, table borders, or option text touch the image edge,
	     - avoid crops with large empty internal whitespace: the target visual should occupy most of the crop while still keeping a safe clean margin,
	     - use `pad_image` only for a crop that has already passed fresh visual validation and only needs a clean white border after `publish_sheet` reports dark edge contact; never use `pad_image` to fix a crop-review failure, missing content, clipping, unrelated text, or a duplicated standalone caption,
	     - use at most six `crop_image` attempts for any one output asset before switching strategy. After that, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` for the source page/target label if you have not already used them. Do not publish a crop-validation report that records unresolved failures,
	     - if you use `crop_image` or `trim_image` on a linked worksheet asset after writing `grader/output/crop-validation.md`, that validation is stale: rerun the fresh-context crop check for the final asset and rewrite `crop-validation.md` before publishing. `pad_image` is safe only after a completed passing validation because it only adds a white border,
     - do not work around image-tool budgets or failed crop review by linking full-page/page fallback images, and do not relabel failed/noisy/broad crop validation as passing,
     - final figure crops must show the complete intended visual, not a mid-diagram fragment and not a different neighbouring figure,
     - if a crop starts inside a diagram, cuts off vertices/labels/axes/table borders/options, or includes a separate neighbouring diagram that would confuse the question, recrop from the high-resolution page image with wider bounds and recheck,
     - re-crop from the original page image if any label, axis, table cell, option text, or annotation needed by the question is missing or touches a crop edge.
   - if `view_image` fails on any workspace image or rendered PDF page because canonical file upload configuration is unavailable, do not ignore the image:
     - use `crop_image` to create a local PNG overview or relevant crop under `grader/output/assets/...`,
     - inspect that generated image with `view_image`,
     - do not switch to `extract_pdf_diagrams` as a fallback for `view_image` failures,
     - only then grade or publish.
  - the workspace and PDF tools are available in this run. Do not say you cannot access the local PDF or ask the user to upload it again until you have tried workspace-relative paths from `grader/uploads/index.json` with `extract_text`, `extract_pdf_reference_text`, `pdf_to_images`, and `view_image` as appropriate.
  - for final important crops, prefer complete information over tightness: slight extra whitespace or neighbouring irrelevant text is acceptable, but clipped question-relevant content is not acceptable. If visual feedback says content is clipped, expand in the clipped direction first; do not "fix" it by trimming tighter.
  - every final linked figure/image crop must be checked by its own `validate_crop_with_fresh_agent` call. Do not batch several crops into one image-review call when the crop may contain labels/options/axes/table cells; ask one independent fresh reviewer per crop to use `view_image`, transcribe all visible text in the crop, and then judge whether the crop contains all question-relevant visual information, excludes duplicated caption/question/table text, contains no unrelated visible text/non-target ink, and has no required content touching or clipped by an edge.
  - act on crop-review feedback before publishing: any reported clipping, missing label/axis/option/table cell, wrong association, broad full-page fallback, noisy neighbouring content, or medium/high severity issue must be fixed and rechecked rather than written up as a pass.
  - for long papers with many figures or diagram-option crops, do not load every final crop at full resolution in the main agent. Send each final linked figure/image crop to `validate_crop_with_fresh_agent`, then fix and re-check only the crops they flag.
  - if there are many final linked crops, do not run a serial main-agent `view_image` loop over every crop. Spot-check representative crops if useful, but the final crop-validation pass must still use one `validate_crop_with_fresh_agent` call per final figure/image crop so every crop is reviewed independently.
  - do not publish known-failed crop validation. For uncertain crops, or after any `validate_crop_with_fresh_agent` result reports `pass/fail: fail` or a blocking issue, stop hand-guessing coordinates and use the bad-crop/full-page/grid workflow through `propose_crop_bbox_with_fresh_agent`; apply the returned rectangle with `crop_image`, then validate again with `validate_crop_with_fresh_agent`.
  - if an image tool reports that the repeated-crop or pre-publish image-edit budget was exceeded, immediately stop guessing crop boxes for that output. Use existing validated crops only; do not work around the budget by linking full-page/page fallback images, publishing a crop-validation file with unresolved failures, or relabelling failed/noisy crop validation as passing.
  - act on visual validation feedback before publishing: if `validate_crop_with_fresh_agent` reports clipped required content, a missing label/axis/option/table cell, wrong association, or any medium/high severity issue, recrop from the high-resolution page image and re-run the check. Do not publish merely because `grader/output/crop-validation.md` exists if that file records unresolved crop problems.
  - write `grader/output/crop-validation.md` before publishing whenever linked figure/table/image crops are included in the worksheet:
     - list each important crop path,
     - list the source question/figure/table label,
     - say `fresh-context subagent checked: yes` for each final linked crop,
     - record the reviewer-visible text from the crop, exact `pass/fail: pass|fail`, whether duplicated caption/question/table text was excluded unless it is part of a visual label/axis/legend, whether unrelated visible text or non-target ink is present, whether edge clipping/content touching an edge is present, whether page borders/separator lines/answer lines/neighbouring-question fragments are present, and any crop fixes made.
   - do not publish linked crop assets without this validation record.
   - `fill` questions must use the real schema shape:
     - `prompt`: text before the first blank,
     - `blanks`: an array of 1 or 2 blank objects like `{ "placeholder": "..." }`,
     - `conjunction`: optional text between blank 1 and blank 2,
     - `after`: text after the final blank.
   - `fill` supports only 1 or 2 blanks. If the worksheet has 3 or more blanks in one printed sentence, either split that work into multiple supported questions or use `lines`. Do NOT emit a 3-blank `fill` question.
   - `flow` questions must keep the printed box order, row order, and connector direction faithful to the source layout where possible.
   - `lines` questions may optionally set `renderMode: "markdown"` when the prompt or the student's written answer should render with Markdown/LaTeX formatting in the sheet UI; use this for maths-heavy working, aligned equations, proofs, or structured multiline responses.
   - question ids must be unique across the whole worksheet, not just within a section.
   - the worksheet should reflect the real student-facing task text as closely as possible.
   - keep prompt wording verbatim where possible: preserve numbering, labels, examples, punctuation, variable names, and displayed math.
  - use `sheet.sections[].theory` / `infoBox` only when it helps explain context already present in the original materials; do not invent large teaching passages just to decorate the UI.
  - `answers` must be keyed by worksheet `question.id`.
  - for source-paper-only runs with no student answers, keep answers blank/no-answer rather than solving the paper. Use `""` for unanswered MCQ values; do not substitute the correct option.
   - answer-shape rules:
    - `mcq` answers are selected option ids (strings); `lines` and `calc` answers are plain strings. For a no-answer/blank MCQ, use `""` rather than a real option id.
     - `answer_bank` answers are objects keyed by blank index (`"0"`, `"1"`, ...) whose values are the selected option ids.
     - `fill` answers are objects keyed by blank index (`"0"`, `"1"`).
     - `cloze` answers are objects keyed by blank index (`"0"`, `"1"`, ...).
     - `match` answers are objects keyed by the shown term.
     - `spelling` answers are objects keyed by word index (`"0"`, `"1"`, ...).
     - `flow` answers are objects keyed by flow-box id.
   - preserve the student's wording, variables, formulas, method, and mistakes in `answers` wherever possible.
   - when the worksheet page mixed prompt text and student writing, the stored answer should contain only the student's contributed words, not the full printed prompt repeated back.
   - `review.score.total` must equal the total worksheet marks; `review.score.got` is the awarded mark total for the whole sheet.
   - `review.message` should be a short learning summary, not just a duplicate of the numeric score; the UI already renders `score.got / score.total` separately.
   - `review.questions` must contain one entry per worksheet question.
   - every `review.questions[questionId]` entry must include `score: { "got": number, "total": number }`, and `score.total` must equal that worksheet question's marks, except source-paper-only/no-student runs with `review.mode: "awaiting_answers"`; those must omit per-question scores so they are not rendered as completed zero-score attempts.
   - each review entry must use one of these statuses:
     - `correct` for fully satisfied questions,
     - `incorrect` for clearly wrong / missing short-answer items,
     - `teacher-review` for partial answers, nuanced near-misses, or longer free-response work that still needs interactive follow-up.
   - each unresolved or incorrect review entry must include a short, student-facing `note` that will be shown directly in the worksheet feedback card as the first assistant message. Correct/resolved questions may use an empty `note` because completed feedback cards are hidden in the student UI.
   - review-note tone:
     - acknowledge sensible structure or plausible thinking before naming the exact gap,
     - prefer a next-step cue, rule of thumb, contrast, or method reminder before giving away the full answer,
     - do not open feedback for an incorrect or blank response by directly stating the correct answer (for example avoid "The correct answer is ..."); make the first message a teaching cue unless the student has already solved it,
     - do not compress the mark scheme into unresolved feedback by naming the missing final concept, mechanism, data comparison, or answer path. Prefer a question or source-navigation cue such as `Which feature in the figure changed?` over `Link the larger muscles to stronger contractions`, and `What trend do the two sources show?` over `Compare how much blue and green light chlorophyll absorbs`,
     - do not treat a near-miss as resolved when the actual task is still unmet.
   - use `replyPlaceholder` and `followUp` when helpful so the interactive feedback flow can continue inside the worksheet question card.
   - `references.*Markdown` should preserve the grading/reference audit trail:
     - `officialProblemMarkdown` and `officialSolutionMarkdown` remain as verbatim as possible,
     - `studentTranscriptMarkdown` records the faithful transcription / normalization,
     - `gradingMarkdown` explains marks and rationale,
     - `overallFeedbackMarkdown` summarizes the whole sheet.
     - exception: for source-paper-only/no-student runs with `review.mode: "awaiting_answers"`, omit `officialSolutionMarkdown`, `gradingMarkdown`, and `overallFeedbackMarkdown`; do not write answers, solution keys, or placeholder "no solution" text into those fields.
8. Write run summary JSON to `grader/output/run-summary.json` with this shape:

```json
{
	"contextLabel": "string",
	"year": "string",
	"paperName": "string",
	"totals": {
		"awardedMarks": 0,
		"maxMarks": 0
	},
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

- Do not write the legacy flat summary shape with top-level `title`, `subtitle`, `bodySummaryMarkdown`, or `footerProvenance`; `publish_sheet` requires the nested `presentation` object shown above.
- Do not write `request.json`, `brief.md`, attachment metadata, planning JSON, answer lists, or process summaries into `grader/output/sheet.json` or `grader/output/run-summary.json`; those outputs must match the worksheet report and run-summary schemas only.
- Do not use `generate_json` for `grader/output/sheet.json` or `grader/output/run-summary.json`; `generate_json` is for lesson-output schemas, and `request.json` / `grader/task.md` are not schemas. Write grader JSON directly and let `publish_sheet` validate it.
- `presentation.title` is required and should be a concise, user-facing card title.
- `presentation.title` should adapt to the uploaded scope:
   - use the actual paper name when confidently identified,
   - otherwise describe the worksheet that was graded, for example `Section 2 Test 5 worksheet` or `Uploaded worksheet`.
- base `presentation.title` on the uploaded content and identified source context rather than a generic subject label.
- Keep worksheet and presentation metadata natural and non-redundant because the sheet UI renders `sheet.level`, `sheet.subject`, `sheet.title`, `sheet.subtitle`, `presentation.title`, `presentation.subtitle`, and `presentation.footer` near each other:
   - do not repeat the same paper name, subject word, level word, or source phrase across those fields,
   - use `sheet.level` only for a compact tier/level such as a school year, exam tier, or competition tier; do not put the full paper or competition title there,
   - do not use invented category labels to fill metadata,
   - avoid suffixes like `question paper` in `sheet.title` when the subtitle/provenance already makes the source type clear.
- `presentation.subtitle` is required and should be a short factual line for the card header:
   - describe what the upload is or what state the reviewed work is in,
   - keep it distinct from the title and from the body summary,
   - avoid marks, percentages, and process-log wording.
- `presentation.summaryMarkdown` is required and should be short Markdown suitable for direct UI rendering:
   - one short paragraph or 2-3 short bullet points,
   - focus on what was graded, what happened, or what the student should notice next,
   - do not repeat marks / question counts / percent because the UI shows those separately.
- `presentation.footer` is required and must be source/provenance identity only, as a terse provenance/retrieval line for the card footer:
   - source context, paper label, or upload cue only,
   - do not repeat the full title,
   - do not repeat `sheet.level`, `sheet.subject`, or `sheet.title`,
   - do not include marks, percentages, or status prose,
   - do not write process labels such as `Question paper transcription`, `transcription`, `OCR`, `artifact`, or similar wording,
   - for identified public papers, prefer concise mechanical identifiers such as exam board/qualification, tier, paper code/name, and session (for example `AQA GCSE Biology · Higher Tier Paper 1H · June 2023`).
- in `presentation.title`, `presentation.subtitle`, `presentation.summaryMarkdown`, and `presentation.footer`, do NOT mention:
   - run IDs, workspace IDs, file paths, tool names, source-policy labels, or implementation/process details.
- `sheet.filePath` must be exactly `grader/output/sheet.json`.
- include `paperUrl` and `markSchemeUrl` only when known.
- omit `contextLabel`, `year`, `paperName`, `paperUrl`, and `markSchemeUrl` when they are unknown; do not fill them with placeholder text such as `Unknown`.

9. Publish the worksheet artifact:
   - call `publish_sheet({})` after both `grader/output/sheet.json` and `grader/output/run-summary.json` are written.
   - `publish_sheet` validates both files against the live worksheet contract used by `/spark/sheets`.
   - if `publish_sheet` fails, fix the files and retry until it returns `status = "published"`.
   - do NOT call `done` before `publish_sheet` succeeds.
   - do NOT end with a normal assistant final response after extraction, page inspection, or crop review; if `publish_sheet` has not succeeded, continue using tools.

10. Call `done({summary})` with:
   - the same user-facing Markdown used in `presentation.summaryMarkdown`
   - no run IDs, file paths, tool names, or process-log wording
   - no headings; keep it brief enough for a summary card
   - only after `publish_sheet` returns `status = "published"`

## Quality bar

- Keep transcriptions faithful to source text.
- Keep grading explicit and auditable.
- Keep worksheet questions and stored answers faithful to what the student actually saw and wrote.
- Keep numbering hierarchy, grouped stems, tables, and essential figures source-faithful whenever the paper provides them.
- Keep feedback corrective, specific, and close to the student's attempted logic.
- When official solutions are unavailable, keep derived solutions and explanations at the student's level whenever reasonable.
