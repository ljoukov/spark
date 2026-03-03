# Grader task

You are grading olympiad-paper solutions.

- Run ID: `{{RUN_ID}}`
- Workspace ID: `{{WORKSPACE_ID}}`
- Default olympiad profile: `{{OLYMPIAD_LABEL}}`

## Inputs

Read these files first:

1. `brief.md`
2. `request.json`
3. `grader/memory.md`
4. `grader/uploads/index.json`

Uploaded student work (photos/PDFs/text) is also attached in the model context. Treat it as the ground truth for transcription.
Linked uploads are available in the workspace under `grader/uploads/<filename>`.

## Required workflow

1. Determine the target paper:
   - infer olympiad, year, and paper title from uploaded work + user request.
   - if uncertain, write your best guess and explain uncertainty in the grading output.
2. Collect official references:
   - use `web_search` to find the paper, marking scheme, and official solutions (if available).
   - prefer official UKMT URLs over mirror hosts.
   - for official PDF sources, do NOT use `web_fetch`.
   - write extraction instructions to `grader/prompts/<name>.md`.
   - use the PDF transcription workflow for workspace PDFs and diagram-sensitive tasks: `pdf_to_images` -> `draw_grid_overlay` -> `crop_image` -> `trim_image` -> `view_image`.
   - keep working files under `grader/` and include final diagram file references in outputs.
   - only use `web_fetch` for non-PDF pages (for example thresholds/help pages).
3. Transcribe precisely:
   - transcribe each graded problem statement.
   - transcribe official solution text/steps from official sources before grading.
   - transcribe the student's solution exactly from uploads before evaluating.
4. Grade each problem deeply:
   - compare against official marking guidance.
   - award marks fairly even when the student's method differs from official solutions, if mathematically correct.
   - reference paper / mark-scheme / official solution URLs in the grading notes when available.
5. Write one markdown file per problem under `grader/output/problems/`:
   - file path pattern: `grader/output/problems/<problem-id>.md`
   - use Markdown with LaTeX math notation (`$...$` and `$$...$$`) when writing mathematics.
   - required section headings (exact):
     - `## Problem statement`
     - `## Official problem statement`
     - `## Official solution`
     - `## Student solution transcript`
     - `## Grading`
     - `## Annotation and feedback`
     - `## Overall feedback`
   - `## Official problem statement` must be the cleaned statement from the official paper source.
   - `## Official solution` must summarize the official mark-scheme/solution in markdown (with LaTeX where needed), with source URLs.
   - in `## Annotation and feedback`, choose line-by-line or statement-by-statement annotation based on what best matches the solution structure, and quote the student text where useful.
6. Write run summary JSON to `grader/output/run-summary.json` with this shape:

```json
{
	"olympiad": "string",
	"year": "string",
	"paperName": "string",
	"paperUrl": "string",
	"markSchemeUrl": "string",
	"totals": {
		"awardedMarks": 0,
		"maxMarks": 0
	},
	"problems": [
		{
			"id": "p1",
			"index": 1,
			"title": "string",
			"awardedMarks": 0,
			"maxMarks": 0,
			"verdict": "correct|partial|incorrect|ungraded",
			"filePath": "grader/output/problems/p1.md"
		}
	]
}
```

7. Call `done({summary})` with:
   - inferred olympiad/year
   - total marks
   - number of problems graded

## Quality bar

- Keep transcriptions faithful to source text.
- Keep grading explicit and auditable.
- Keep feedback corrective, specific, and close to the student's attempted logic.
