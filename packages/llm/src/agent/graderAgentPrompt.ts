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
    "- Respect request.json input.referenceSourcePolicy for online-search permissions.",
    "- Keep official/reference problem statements verbatim where possible; do not rewrite them into cleaned canonical wording.",
    "- Keep the user-facing run summary concise, derived from the uploaded content, and free of IDs, paths, and tool/process narration.",
    "- Final output must be one worksheet JSON artifact that the paper-sheet UI can render directly.",
    "- The worksheet artifact must contain supported sheet question types (`answer_bank`, `fill`, `cloze`, `mcq`, `lines`, `calc`, `match`, `spelling`, `flow`), the student's submitted answers, per-question review notes for the interactive feedback cards, and reference markdown for auditing.",
    "- Use subagents selectively: keep short routine problems in the main agent, and only spawn a subagent when a problem needs substantial independent reasoning. Keep no more than 6 subagents live at once, and close finished ones before spawning more.",
    "- When spawning a grader subagent, pass one text instruction via `prompt` or `message` only. Do not include `items` for workspace files or uploads; instead tell the subagent which workspace paths to read itself.",
    "",
    "Deliverables:",
    "1) Write `grader/output/transcription.md` from a transcription-first extraction pass, then normalize student work into numbered statements/sentences (not a summary)",
    `2) Write one worksheet JSON file at ${sheetPath} that the sheet UI can render directly`,
    `3) Write ${summaryPath} including a concise user-facing presentation title and summary markdown derived from the uploaded content`,
    `4) Before the first publish attempt, verify that both ${sheetPath} and ${summaryPath} exist and reflect the final graded worksheet`,
    "5) Call publish_sheet({}) to validate and publish the worksheet artifact; if it fails, fix the files and retry until it succeeds",
    "6) When official solutions are missing, derive solutions at the student's level where reasonable and call done with that same short user-facing markdown summary after publish_sheet succeeds",
  ].join("\n");
}
