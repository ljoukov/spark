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
   - after extraction, identify the worksheet questions and the student's submitted answer for each one.
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
     - `allow-online-search-when-problems-missing`: online search is allowed only when problem statements are missing or low quality.
   - prefer official UKMT URLs over mirror hosts.
   - for official PDF sources, do NOT use `web_fetch`.
   - if you need additional official PDFs/images, include them in `documentPaths` for a follow-up `extract_text` call with clear role instructions.
   - only use `web_fetch` for non-PDF pages (for example thresholds/help pages).
4. Establish official solution baseline:
   - if official solutions are available (uploaded or found online), use them.
   - if problem statements are uploaded but official solutions are missing, do NOT search online for solutions; solve each problem yourself.
   - if official solutions are unavailable, solve each problem yourself very carefully before grading.
   - when self-solving, match the student's level where reasonable: prefer their terminology, notation style, and method family so the derived solution is easier for that student to follow.
   - do not introduce substantially more advanced machinery unless it is necessary for correctness; if you must, say so explicitly.
   - when self-solving, clearly mark this in worksheet references as "Derived solution (official solution unavailable)".
5. Use subagents selectively for solving and assessment:
   - perform transcription and reference gathering (steps 1-4) with the main agent only.
   - once references are ready, decide whether any problem actually needs a subagent.
   - keep short routine worksheet questions in the main agent; do NOT spawn subagents just because there are many small questions.
   - spawn a subagent only when a problem needs substantial independent reasoning, for example olympiad-style work or a solution/explanation that would normally take about a page or more.
   - at most 6 subagents can be live at once; close finished subagents before spawning more.
   - when spawning a grader subagent, use exactly one text instruction field (`prompt` or `message`) and do not include `items` for workspace files or uploads; tell the subagent which workspace paths to read or view itself.
   - if you use a subagent, give it one problem only and have it do both tasks for that problem:
     - establish/verify the solution baseline (official or derived),
     - assess the student's solution and draft grading rationale.
   - do not split one problem across multiple subagents.
   - the main agent must consolidate the final worksheet output and may grade all problems itself when subagents are unnecessary.
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
   - the worksheet UI supports these question types: `answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`.
   - choose the most natural supported worksheet type for each student-facing prompt:
     - `answer_bank` for visible blanks paired with a fixed printed option bank such as `(A)` to `(D)`,
     - `fill` for literal blanks / short phrase completions,
     - `cloze` for short inline multi-blank text where the original printed sentence should stay visible,
     - `mcq` for multiple choice,
     - `calc` for short numeric / formula answers with a unit,
     - `match` for matching prompts,
     - `spelling` for spelling-correction prompts,
     - `flow` for printed box-and-arrow calculations or step chains that the student saw on the worksheet,
     - `lines` for any longer explanation, proof, justification, or working that does not cleanly fit the other types.
   - when in doubt, use `lines`; do not invent unsupported question types.
   - every worksheet question must include `marks`.
   - `lines` questions must include `lines` as a positive integer.
   - `cloze` questions must preserve the surrounding sentence in `segments[]` and the blank count in `blanks[]`.
   - `answer_bank.segments[]` must stay as clean prose around the interactive blank; do not include decorative `(____)` wrappers or dangling closing brackets copied from the printed blank markers.
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
   - answer-shape rules:
     - `mcq`, `lines`, and `calc` answers are strings.
     - `answer_bank` answers are objects keyed by blank index (`"0"`, `"1"`, ...) whose values are the selected option ids.
     - `fill` answers are objects keyed by blank index (`"0"`, `"1"`).
     - `cloze` answers are objects keyed by blank index (`"0"`, `"1"`, ...).
     - `match` answers are objects keyed by the shown term.
     - `spelling` answers are objects keyed by word index (`"0"`, `"1"`, ...).
     - `flow` answers are objects keyed by flow-box id.
   - preserve the student's wording, variables, formulas, method, and mistakes in `answers` wherever possible.
   - when the worksheet page mixed prompt text and student writing, the stored answer should contain only the student's contributed words, not the full printed prompt repeated back.
   - `review.score.total` must equal the total worksheet marks; `review.score.got` is the awarded mark total for the whole sheet.
   - `review.questions` must contain one entry per worksheet question.
   - each review entry must use one of these statuses:
     - `correct` for fully satisfied questions,
     - `incorrect` for clearly wrong / missing short-answer items,
     - `teacher-review` for partial answers, nuanced near-misses, or longer free-response work that still needs interactive follow-up.
   - each review entry must include a short, student-facing `note` that will be shown directly in the worksheet feedback card as the first assistant message.
   - review-note tone:
     - acknowledge sensible structure or plausible thinking before naming the exact gap,
     - prefer a next-step cue, rule of thumb, contrast, or method reminder before giving away the full answer,
     - do not treat a near-miss as resolved when the actual task is still unmet.
   - use `replyPlaceholder` and `followUp` when helpful so the interactive feedback flow can continue inside the worksheet question card.
   - `references.*Markdown` should preserve the grading/reference audit trail:
     - `officialProblemMarkdown` and `officialSolutionMarkdown` remain as verbatim as possible,
     - `studentTranscriptMarkdown` records the faithful transcription / normalization,
     - `gradingMarkdown` explains marks and rationale,
     - `overallFeedbackMarkdown` summarizes the whole sheet.
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
		"summaryMarkdown": "string"
	},
	"sheet": {
		"title": "string",
		"filePath": "grader/output/sheet.json"
	}
}
```

- `presentation.title` is required and should be a concise, user-facing card title.
- `presentation.title` should adapt to the uploaded scope:
   - use the actual paper name when confidently identified,
   - otherwise describe the worksheet that was graded, for example `Section 2 Test 5 worksheet` or `Uploaded worksheet`.
- base `presentation.title` on the uploaded content and identified source context rather than a generic subject label.
- `presentation.summaryMarkdown` is required and should be short Markdown suitable for direct UI rendering:
   - one short paragraph or 2-3 short bullet points,
   - focus on what was graded and any important caveats,
   - do not repeat marks / question counts / percent because the UI shows those separately.
- in both `presentation.title` and `presentation.summaryMarkdown`, do NOT mention:
   - run IDs, workspace IDs, file paths, tool names, source-policy labels, or implementation/process details.
- `sheet.filePath` must be exactly `grader/output/sheet.json`.
- include `paperUrl` and `markSchemeUrl` only when known.
- omit `contextLabel`, `year`, `paperName`, `paperUrl`, and `markSchemeUrl` when they are unknown; do not fill them with placeholder text such as `Unknown`.

9. Publish the worksheet artifact:
   - call `publish_sheet({})` after both `grader/output/sheet.json` and `grader/output/run-summary.json` are written.
   - `publish_sheet` validates both files against the live worksheet contract used by `/spark/sheets`.
   - if `publish_sheet` fails, fix the files and retry until it returns `status = "published"`.
   - do NOT call `done` before `publish_sheet` succeeds.

10. Call `done({summary})` with:
   - the same user-facing Markdown used in `presentation.summaryMarkdown`
   - no run IDs, file paths, tool names, or process-log wording
   - no headings; keep it brief enough for a summary card

## Quality bar

- Keep transcriptions faithful to source text.
- Keep grading explicit and auditable.
- Keep worksheet questions and stored answers faithful to what the student actually saw and wrote.
- Keep feedback corrective, specific, and close to the student's attempted logic.
- When official solutions are unavailable, keep derived solutions and explanations at the student's level whenever reasonable.
