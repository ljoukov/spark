import { SPARK_GRADER_UPLOADS_MANIFEST_PATH } from "./graderAgentPrompt";
import {
  renderSparkAgentSkillReadList,
  SPARK_SHEET_DRAFT_SKILL_IDS,
} from "./sparkAgentSkills";

export const SPARK_SHEET_DRAFT_SUMMARY_PATH =
  "sheet/output/run-summary.json" as const;
export const SPARK_SHEET_DRAFT_PATH = "sheet/output/draft.json" as const;
export const SPARK_SHEET_DRAFT_ANSWERS_PATH =
  "sheet/state/answers.json" as const;

export function buildSparkSheetDraftAgentPrompt(options?: {
  summaryPath?: string;
  sheetPath?: string;
}): string {
  const summaryPath = options?.summaryPath ?? SPARK_SHEET_DRAFT_SUMMARY_PATH;
  const sheetPath = options?.sheetPath ?? SPARK_SHEET_DRAFT_PATH;
  return [
    "Create a student worksheet from uploaded study material.",
    "",
    "Read and follow these files first:",
    "- brief.md",
    "- request.json",
    "- sheet/task.md",
    `- ${SPARK_GRADER_UPLOADS_MANIFEST_PATH}`,
    "",
    "Read and follow these reusable skills before drafting:",
    renderSparkAgentSkillReadList(SPARK_SHEET_DRAFT_SKILL_IDS),
    "",
    "Run-specific constraints:",
    "- Work only from the uploaded material and the explicit request.",
    "- If the latest user request asks for verbatim structure, treat that as a hard requirement.",
    "- The JSON contract is defined explicitly in sheet/task.md. Follow that contract directly and do not infer alternate keys from logs or unrelated files.",
    "- The run summary JSON must use nested `presentation: { title, subtitle, summaryMarkdown, footer }`; do not write legacy flat keys such as `bodySummaryMarkdown` or `footerProvenance`.",
    "",
    "Deliverables:",
    `1) Write one worksheet draft JSON file at ${sheetPath}`,
    `2) Write ${summaryPath} with nested \`presentation: { title, subtitle, summaryMarkdown, footer }\` values`,
    "3) Call publish_sheet_draft({}) to validate and publish the worksheet draft; this only validates the artifact contract/persistence, so complete the source-fidelity check before calling it. If it fails, use the validation error as a diagnostic and repair the artifact coherently instead of repeating the same failed branch",
    "4) Call done with a short summary after publish_sheet_draft succeeds",
  ].join("\n");
}
