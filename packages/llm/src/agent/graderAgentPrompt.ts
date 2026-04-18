import {
  renderSparkAgentSkillReadList,
  SPARK_GRADER_SKILL_IDS,
} from "./sparkAgentSkills";

export const SPARK_GRADER_SUMMARY_PATH =
  "grader/output/run-summary.json" as const;
export const SPARK_GRADER_SHEET_PATH = "grader/output/sheet.json" as const;
export const SPARK_GRADER_UPLOADS_MANIFEST_PATH =
  "grader/uploads/index.json" as const;

export function buildSparkGraderAgentPrompt(options?: {
  summaryPath?: string;
  sheetPath?: string;
}): string {
  const summaryPath = options?.summaryPath ?? SPARK_GRADER_SUMMARY_PATH;
  const sheetPath = options?.sheetPath ?? SPARK_GRADER_SHEET_PATH;
  return [
    "Grade and process student uploaded work and related documents such as problem statements and official solutions.",
    "",
    "Read and follow these files first:",
    "- brief.md",
    "- request.json",
    "- grader/task.md",
    `- ${SPARK_GRADER_UPLOADS_MANIFEST_PATH}`,
    "",
    "Read and follow the reusable skills that match the chosen grader mode before grading. For ordinary handwritten grading against uploaded source/reference PDFs, read `paper-to-sheet` and `handwritten-answers-to-sheet`; read `source-image-cropping` only before actual crop work.",
    renderSparkAgentSkillReadList(SPARK_GRADER_SKILL_IDS),
    "",
    "Run-specific constraints:",
    "- Respect request.json input.referenceSourcePolicy for online-search permissions.",
    "- When official references are allowed and the paper/competition is identifiable, make a solid official-source lookup effort before self-solving: check official question paper/source, mark scheme/official solutions, examiner report/report on the examination, and grade-boundary/prize/medal thresholds when relevant.",
    "- Map the worksheet subject to Spark's stable Apple-style sheet palette and use that palette for `sheet.color`, `sheet.accent`, `sheet.light`, and `sheet.border`: Biology green; Mathematics blue; Chemistry purple; Physics indigo; Geography teal; Science mint; English pink; History or Religious Studies orange; Economics or Business yellow; Computer Science or General gray. Do not invent custom sheet colors.",
    "- Use `list_workspace_dir`, `read_workspace_file`, `grep_workspace_files`, and `write_workspace_file` for workspace text files and grader JSON artifacts. Do not use `extract_text` to read JSON/Markdown workspace files.",
    "- The workspace and PDF tools are available in this run. Do not say you cannot access the local PDF or ask the user to upload it again until you have tried workspace-relative paths from `grader/uploads/index.json` with `extract_text`, `extract_pdf_reference_text`, `extract_pdf_images`, and `pdf_to_images` as appropriate. In grader-publish runs, direct `view_image` is intentionally not available on the main agent; use `extract_text` for transcription and the fresh visual helper tools for localized crop inspection.",
    "- After a large extracted reference returns only an outline or `content omitted`, do not repeat the same unbounded read. Use `grep_workspace_files` or `read_workspace_file`/`read_file` with exact line ranges.",
    "- For long source PDFs, every `pdf_to_images` call must include explicit 1-based `pageNumbers` chosen from the extracted reference headings or grep context. If `pdf_to_images` fails because `pageNumbers` were missing, immediately retry the same PDF with `pageNumbers`; that failure is not a crop attempt and is not evidence that the visual is unavailable.",
    "- For every source item whose wording names a figure, diagram, graph, chart, option diagram, or text/numeric table, decide the visual/table handling before writing `sheet.json`. If the uploaded/source PDF has the pixels or table text, the visible worksheet must include a crop or Markdown table near the source-faithful prompt. Do not use a linked-original/source-PDF instruction for ordinary source-paper visuals unless a real render/crop or table-extraction attempt failed and the failure is recorded in `sheet-plan.md` plus the source-fidelity audit.",
    '- Treat focus phrases such as "first 4 paragraphs" as grading-focus guidance, not permission to omit other visible prompts/responses. Keep later visible numbered items in the transcript and sheet unless the request names question numbers to exclude; mark whether they affected a grade projection.',
    "- Keep upload inventory, workspace file reading, primary transcription, final grading synthesis, and worksheet assembly on the main agent.",
    "- Use bounded subagents only for official-reference lookup/verification when online lookup is allowed, for visual localization proposals that keep image inspection out of the main context, or through `validate_source_fidelity_with_fresh_agent` for pre-publish source-fidelity audits that compare source pages/transcripts against the assembled sheet without grading or rewriting it.",
    "- Use `propose_crop_bbox_with_fresh_agent` for uncertain crop bbox planning, `validate_crop_with_fresh_agent` for final crop validation, and `review_run_progress_with_fresh_agent` when repeated tool loops suggest the run is on the wrong path. When validating crops, pass `expectedContent` with the exact required visual labels/axes/options/table cells and `duplicatedTextToExclude` for prompt/caption/table text rendered separately.",
    "- Do not use `generate_json` for grader artifacts; `generate_json` is for lesson-output schemas. Write grader JSON directly and let `publish_sheet` validate it.",
    "- Do not write `request.json`, `brief.md`, attachment metadata, planning JSON, answer lists, or process summaries into grader output JSON files.",
    '- Do not stop after extraction, page inspection, crop review, or writing draft files. The run is not complete until `publish_sheet({})` returns `status: "published"`.',
    "",
    "Deliverables:",
    "1) Write `grader/output/transcription.md` from a transcription-first extraction pass, then normalize all visible student work into numbered statements/sentences rather than a summary. When grading against a source paper, include a compact `## Source problem-statement transcription` audit section even when source text came from deterministic PDF extraction.",
    `2) Write one worksheet report JSON file at ${sheetPath}. This file is the full graded report wrapper, not the bare sheet data: top-level keys are \`schemaVersion\`, \`sheet\`, \`answers\`, \`review\`, and optional \`references\`; \`schemaVersion\` is exactly \`1\`; \`sheet\` contains the renderable worksheet data; \`answers\` contains one captured student answer for every answer-bearing leaf question id; student answers do not belong inside question objects.`,
    `3) Write ${summaryPath} with this exact top-level shape: \`{ "totals": { "awardedMarks": number, "maxMarks": number }, "presentation": { "title": string, "subtitle": string, "summaryMarkdown": string, "footer": string }, "sheet": { "title": string, "filePath": "${sheetPath}" } }\`, plus optional paper metadata only when known; if you include \`year\`, write it as a string such as \`"2024"\`. Keep \`presentation.summaryMarkdown\` as the sheet-card body: one compact sentence or two short fragments, specific, and not repeating title, subject, level, marks, percentage, created date, or footer. Prefer official grade/prize/medal/percentile outcome when known and suitable; otherwise mention the single most useful score driver, common examiner mistake made/avoided, or concrete next learning target. Do not use generic lead-ins such as "This sheet", "The worksheet", "Graded", "Checked", or broad praise.`,
    `4) In ${summaryPath}, set \`sheet.filePath\` exactly to \`${sheetPath}\`; publish_sheet rejects summaries that omit this field or point at any other path`,
    '5) In `review`, include `score`, `label` formatted as `N/total`, `message`, `note` (use `""` if there is no general note), and `questions`; in every scored `review.questions[questionId]`, include `status`: use `"correct"` for full marks and `"incorrect"` for partial, zero, blank, or unresolved answers; reserve `"teacher-review"` for awaiting-answer/source-paper-only entries without a score',
    "6) When official grade/prize/medal/boundary data applies, mention the real-world outcome and basis in the worksheet feedback/reference markdown and briefly in the run summary when useful; if unavailable, say so instead of inventing it",
    `7) Once transcription, official/source references, and the sheet plan exist, stop broad reference reading and write ${sheetPath} plus ${summaryPath}; before the first publish attempt, verify that both files exist and reflect the final graded worksheet`,
    "8) For printed source papers, source photos, or PDF-derived worksheets, call `validate_source_fidelity_with_fresh_agent` before publishing and write its reviewMarkdown to `grader/output/source-fidelity-audit.md`. Split long material by source page or root question. The audit checks only transfer fidelity: every visible answered/partial/blank item is represented, source wording is verbatim apart from minimal OCR cleanup, numbering/badges match, figures/tables/layout-critical structures are visible near the prompt, and answer evidence is attached to the right item. A named figure/table with no nearby crop/Markdown table is blocking when source pixels/table text are available. Fix blocking findings and re-audit the affected page/root before publishing.",
    "9) Call publish_sheet({}) to validate and publish the worksheet artifact; if it fails, use the validation error as a diagnostic, repair the artifacts coherently, and retry only while you are fixing a new class of issue rather than repeating the same failed branch",
    "10) Do not send a normal final response before publishing. If you catch yourself about to answer the user, instead keep using tools, write the required files, call publish_sheet, then call done.",
  ].join("\n");
}
