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
    "Create a student worksheet from uploaded study material or from the learner's requested curricular context.",
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
    "- Work only from the uploaded material, the explicit request, and any `student-sheets/` files copied into the workspace.",
    "- If `student-sheets/` exists, read `student-sheets/index.md` first and then the relevant summaries, sheet JSON, or saved answers before choosing a next or related sheet.",
    "- If there are no uploads, create the sheet from the learner's request plus the existing-sheet context. Do not stop because the run has no source upload.",
    "- For a new curricular sheet without uploads, prefer this unit-sheet structure unless the request says otherwise: learning objectives; short concept/theory and worked example where useful; misconception frame; Section A multiple-choice questions; Section B fill-in-the-blanks; challenge and extension questions; review and remember / retrieval planner.",
    "- For next-sheet requests, avoid duplicating an existing sheet unless the learner explicitly asked to remake or practise the same unit again.",
    "- If the latest user request asks for verbatim structure, treat that as a hard requirement.",
    "- The JSON contract is defined explicitly in sheet/task.md. Follow that contract directly and do not infer alternate keys from logs or unrelated files.",
    "- The run summary JSON must use nested `presentation: { title, subtitle, summaryMarkdown, footer }`; do not write legacy flat keys such as `bodySummaryMarkdown` or `footerProvenance`.",
    "- Map the worksheet subject to Spark's stable Apple-style sheet palette and use that palette for `sheet.color`, `sheet.accent`, `sheet.light`, and `sheet.border`: Biology green; Mathematics blue; Chemistry purple; Physics indigo; Geography teal; Science mint; English pink; History or Religious Studies orange; Economics or Business yellow; Computer Science or General gray. Do not invent custom sheet colors.",
    '- Keep `presentation.summaryMarkdown` as one compact sentence or two short fragments for the Sheets thumbnail; do not repeat the title, subject, level, marks, percentage, created date, or footer, and avoid generic lead-ins such as "This sheet" or "The worksheet".',
    "",
    "Deliverables:",
    `1) Write one worksheet draft JSON file at ${sheetPath}`,
    `2) Write ${summaryPath} with nested \`presentation: { title, subtitle, summaryMarkdown, footer }\` values`,
    "3) Call publish_sheet_draft({}) to validate and publish the worksheet draft; this only validates the artifact contract/persistence, so complete the source-fidelity check before calling it. If it fails, use the validation error as a diagnostic and repair the artifact coherently instead of repeating the same failed branch",
    "4) Call done with a short summary after publish_sheet_draft succeeds",
  ].join("\n");
}
