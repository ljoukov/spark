import { randomUUID } from "node:crypto";

import {
  runAgentLoop,
  tool,
  type LlmInputMessage,
  type LlmTextModelId,
  type LlmToolConfig,
  type LlmToolSet,
} from "@ljoukov/llm";
import { z } from "zod";

import {
  configureSparkLlmTelemetryFromEnv,
  createSparkAgentRunTelemetryConfig,
  publishSparkAgentProcessMetricsFromEnv,
  publishSparkToolLoopStepMetricsFromEnv,
  resolveSparkMetricProviderLabel,
} from "../utils/gcp/monitoring";
import { AgentProcessUsageMonitor } from "./agentProcessUsageMonitor";
import {
  SPARK_GRADER_SHEET_PATH,
  SPARK_GRADER_SUMMARY_PATH,
  buildSparkGraderAgentPrompt,
} from "./graderAgentPrompt";
import {
  SPARK_SHEET_DRAFT_ANSWERS_PATH,
  SPARK_SHEET_DRAFT_PATH,
  SPARK_SHEET_DRAFT_SUMMARY_PATH,
  buildSparkSheetDraftAgentPrompt,
} from "./sheetDraftAgentPrompt";
import {
  renderSparkAgentSkillPromptSection,
  resolveSparkAgentSkillFiles,
  SPARK_GRADER_SKILL_IDS,
  SPARK_SHEET_DRAFT_SKILL_IDS,
  type SparkAgentSkillFile,
} from "./sparkAgentSkills";

const trimmedString = z.string().trim().min(1);

export const DEFAULT_SPARK_GRADER_RUN_KEY = "uploaded_work" as const;
export const DEFAULT_SPARK_GRADER_RUN_LABEL = "Uploaded work" as const;
export const SPARK_CHAT_MODEL_ID = "chatgpt-gpt-5.4-fast" as const;
export const SPARK_CHAT_THINKING_LEVEL = "medium" as const;
export const SPARK_CHAT_MAX_TOOL_STEPS = 256;
const EXPLICIT_NO_STUDENT_ANSWER_PATTERN =
  /\b(?:source[-\s]?paper[-\s]?only|no\s+student\s+answers?\s+(?:were\s+)?provided|no\s+student\s+submission|no\s+submitted\s+answers?|unanswered\s+worksheet|leave\s+answers?\s+blank|awaiting\s+student\s+work|blank\/awaiting\s+student\s+work|do\s+not\s+solve\s+the\s+paper|do\s+not\s+include\s+an\s+answer\s+key)\b/iu;
const STUDENT_SUBMISSION_PRESENT_PATTERN =
  /\b(?:student\s+(?:work|submission|response|script)|candidate\s+answers?|handwritten|marked\s+paper|completed\s+paper|grade\s+(?:and\s+)?(?:mark|remark)|grade\s+this|remark\s+this|mark\s+scheme)\b/iu;

function nullableOptionalString() {
  return z
    .preprocess((value) => {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
      return value;
    }, z.string().trim().min(1).optional())
    .optional();
}

export const SparkChatAttachmentInputSchema = z.object({
  id: trimmedString,
  contentType: trimmedString,
  sizeBytes: z.number().int().min(1),
  filename: trimmedString.optional(),
  pageCount: z.number().int().min(1).optional(),
  storagePath: trimmedString.optional(),
  localPath: trimmedString.optional(),
});

export type SparkChatAttachmentInput = z.infer<
  typeof SparkChatAttachmentInputSchema
>;

export const DEFAULT_SPARK_SHEET_RUN_LABEL = "Student worksheet" as const;

export const SparkChatCreateSheetInputSchema = z
  .object({
    title: nullableOptionalString().describe(
      "Optional short worksheet title override. Set this only when the uploaded material already makes a concise student-facing title clear.",
    ),
    notes: nullableOptionalString().describe(
      "Optional worksheet-generation focus or constraint (for example: keep the worksheet strictly faithful to the uploaded exam layout).",
    ),
  })
  .strict();

export type SparkChatCreateSheetInput = z.infer<
  typeof SparkChatCreateSheetInputSchema
>;

export const SparkSheetDraftRequestPayloadSchema = z
  .object({
    createdAt: z.string().trim().min(1),
    sourceText: z.string().trim().min(1).nullable(),
    input: SparkChatCreateSheetInputSchema.default({}),
    attachments: z.array(SparkChatAttachmentInputSchema).default([]),
  })
  .strict();

export type SparkSheetDraftRequestPayload = z.infer<
  typeof SparkSheetDraftRequestPayloadSchema
>;

export type SparkSheetDraftLaunchPlan = {
  runId: string;
  agentId: string;
  workspaceId: string;
  launchTitle: string;
  launchTitleKey: string;
  summaryPath: string;
  sheetPath: string;
  answersPath: string;
  prompt: string;
  brief: string;
  sheetTask: string;
  skillFiles: SparkAgentSkillFile[];
  requestPayload: SparkSheetDraftRequestPayload;
  runAttachments: SparkChatAttachmentInput[];
  runWorkspaceAttachments: SparkGraderWorkspaceAttachment[];
  sourceText?: string;
  conversationId?: string;
  createdAt: Date;
};

export const SPARK_CHAT_CREATE_SHEET_TOOL_DESCRIPTION = [
  "Create a student worksheet from the learner's uploaded material.",
  "Creates a worksheet workspace, seeds sheet/task.md, and launches a background agent that publishes a solveable sheet under /spark/sheets.",
  "Use this when the learner asks Spark to turn uploads into a worksheet or sheet to solve.",
  "If the current user turn clearly asks for a worksheet from uploaded material, call this tool instead of answering directly in chat.",
  "If the request refers to an earlier upload in the same conversation, those earlier uploads still define the worksheet source unless the learner replaced them.",
  "If the uploaded material is already a worksheet or exam paper, treat it as the canonical source and preserve the question wording, numbering, marks, and structure as closely as possible.",
  "Do not simplify, reorder, paraphrase, or redesign an uploaded question sheet into a nicer worksheet format.",
  "If the uploaded material is notes or teaching content, synthesize a worksheet grounded only in those uploads.",
  "If uploads are present, they are attached to the sheet-draft agent context automatically.",
].join("\n");

export const SparkChatCreateGraderInputSchema = z
  .object({
    title: nullableOptionalString().describe(
      "Optional short run title override. Set this only when the uploaded or pasted materials already make a concise content-based title clear (for example: GCSE English Language Paper 1 or BMO1 2024 Q5).",
    ),
    referenceSourcePolicy: z
      .enum([
        "uploaded-only",
        "allow-official-references",
        "allow-online-search-when-problems-missing",
      ])
      .optional()
      .describe(
        [
          "Controls whether the grader may search online for official problem statements, answer keys, mark schemes, solution references, examiner reports, grade boundaries, prize thresholds, or medal cutoffs.",
          "- uploaded-only: use uploaded/pasted materials only; do not search online. Use this only when the learner explicitly forbids online lookup or asks to rely only on uploads.",
          "- allow-official-references: online search is allowed for official publisher/exam-board/competition references, including answer keys, mark schemes, official reports, and score-boundary sources when the source can be identified.",
          "- allow-online-search-when-problems-missing: online search is allowed only when problem statements are missing/unclear.",
        ].join("\n"),
      ),
    notes: nullableOptionalString().describe(
      "Optional grading focus for this run (for example: focus on proof rigor and notation).",
    ),
    sourcePaperOnlyNoStudent: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the task is to render an uploaded source paper/question sheet as an unanswered worksheet and no student answers/submission are present.",
      ),
  })
  .strict();

export type SparkChatCreateGraderInput = z.infer<
  typeof SparkChatCreateGraderInputSchema
>;

export const SparkGraderRequestPayloadSchema = z
  .object({
    createdAt: z.string().trim().min(1),
    sourceText: z.string().trim().min(1).nullable(),
    input: SparkChatCreateGraderInputSchema.default({}),
    attachments: z.array(SparkChatAttachmentInputSchema).default([]),
    sourcePaperOnlyNoStudent: z.boolean().optional(),
  })
  .strict();

export type SparkGraderRequestPayload = z.infer<
  typeof SparkGraderRequestPayloadSchema
>;

export type SparkGraderWorkspaceAttachment = SparkChatAttachmentInput & {
  workspacePath: string;
};

export type SparkGraderLaunchPlan = {
  runId: string;
  agentId: string;
  workspaceId: string;
  launchTitle: string;
  launchTitleKey: string;
  summaryPath: string;
  sheetPath: string;
  prompt: string;
  brief: string;
  graderTask: string;
  skillFiles: SparkAgentSkillFile[];
  requestPayload: SparkGraderRequestPayload;
  runAttachments: SparkChatAttachmentInput[];
  runWorkspaceAttachments: SparkGraderWorkspaceAttachment[];
  sourceText?: string;
  conversationId?: string;
  createdAt: Date;
};

function inferSourcePaperOnlyNoStudentRequest(options: {
  sourceText?: string;
  input: SparkChatCreateGraderInput;
}): boolean {
  if (options.input.sourcePaperOnlyNoStudent === true) {
    return true;
  }
  const requestText = [
    options.sourceText,
    options.input.title,
    options.input.notes,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  if (!EXPLICIT_NO_STUDENT_ANSWER_PATTERN.test(requestText)) {
    return false;
  }
  return !STUDENT_SUBMISSION_PRESENT_PATTERN.test(requestText);
}

export const SPARK_CHAT_CREATE_GRADER_TOOL_DESCRIPTION = [
  "Start a grading run from the learner's uploaded work.",
  "Creates a grader workspace, seeds grader/task.md, and launches a background agent.",
  "Use this when the learner asks to mark or grade uploaded answers, submissions, scripts, or related reference documents.",
  "If the current user turn clearly asks to grade uploaded work, call this tool instead of answering with grading feedback directly in chat.",
  "Uploads can include student handwriting, problem statements, answer booklets, rubrics, and optional official solutions/mark schemes.",
  "Set referenceSourcePolicy based on learner instructions: use allow-official-references by default so official answer keys/mark schemes can be checked for identified public papers; use uploaded-only only when the learner explicitly forbids online lookup.",
  "When uploads include a printed question sheet or exam page, the grader must preserve original numbering, shared stems, tables, MCQ structure, and essential figures instead of flattening them into prose or synthetic per-question sections.",
  "If the uploaded or pasted materials already make a concise run title clear, pass it via title; otherwise omit it and let the grader derive the final title from the content.",
  "If uploads are present, they are attached to the grader agent context automatically.",
].join("\n");

function normalizeGraderTitleKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
  if (normalized.length > 0) {
    return normalized.slice(0, 64);
  }
  return DEFAULT_SPARK_GRADER_RUN_KEY;
}

export function resolveSparkGraderAttachmentWorkspacePath(attachment: {
  id: string;
  filename?: string;
}): string {
  const raw = (attachment.filename ?? attachment.id)
    .trim()
    .replace(/[/\\]+/gu, "-");
  const filename = raw.length > 0 ? raw : attachment.id;
  return `grader/uploads/${filename}`;
}

function createUniqueWorkspaceAttachmentPath(options: {
  basePath: string;
  attachmentId: string;
  seenPaths: Set<string>;
}): string {
  const normalizedBasePath = options.basePath;
  if (!options.seenPaths.has(normalizedBasePath)) {
    options.seenPaths.add(normalizedBasePath);
    return normalizedBasePath;
  }

  const suffix = options.attachmentId.trim().slice(0, 8) || "attachment";
  const extensionMatch = /(\.[A-Za-z0-9]+)$/u.exec(normalizedBasePath);
  const extension = extensionMatch?.[1] ?? "";
  const stem =
    extension.length > 0
      ? normalizedBasePath.slice(0, -extension.length)
      : normalizedBasePath;
  let candidate = `${stem}-${suffix}${extension}`;
  let collisionIndex = 2;
  while (options.seenPaths.has(candidate)) {
    candidate = `${stem}-${suffix}-${collisionIndex.toString()}${extension}`;
    collisionIndex += 1;
  }
  options.seenPaths.add(candidate);
  return candidate;
}

function buildWorkspaceAttachments(
  attachments: readonly SparkChatAttachmentInput[],
): SparkGraderWorkspaceAttachment[] {
  const seenPaths = new Set<string>();
  return attachments.map((attachment) => ({
    ...attachment,
    workspacePath: createUniqueWorkspaceAttachmentPath({
      basePath: resolveSparkGraderAttachmentWorkspacePath(attachment),
      attachmentId: attachment.id,
      seenPaths,
    }),
  }));
}

export function buildSparkSheetDraftBrief(options: {
  sourceText?: string;
  input: SparkChatCreateSheetInput;
  attachments: SparkChatAttachmentInput[];
}): string {
  const lines: string[] = ["# Worksheet draft request"];
  const rawSource = options.sourceText?.trim();
  if (rawSource && rawSource.length > 0) {
    lines.push("", "## Original user message", "```", rawSource, "```");
  }
  const titleOverride = options.input.title?.trim();
  if (titleOverride && titleOverride.length > 0) {
    lines.push("", "## Requested title override", `- ${titleOverride}`);
  }
  if (options.input.notes) {
    lines.push("", "## User worksheet focus", options.input.notes.trim());
  }
  if (options.attachments.length > 0) {
    lines.push("", "## Uploaded source material");
    let index = 0;
    for (const attachment of options.attachments) {
      index += 1;
      const label = attachment.filename?.trim() || attachment.id;
      const pages =
        typeof attachment.pageCount === "number" && attachment.pageCount > 0
          ? `, pages=${attachment.pageCount.toString()}`
          : "";
      lines.push(
        `- ${index}. ${label} (${attachment.contentType}, size=${attachment.sizeBytes.toString()}${pages})`,
      );
    }
  } else {
    lines.push(
      "",
      "## Uploaded source material",
      "- No attachments were included for this run.",
    );
  }
  lines.push(
    "",
    "## Objectives",
    "- Identify whether the uploads are already a worksheet / exam sheet or whether Spark must synthesize a new worksheet from teaching material.",
    "- If the uploads are already a worksheet / exam sheet, preserve numbering, structure, blanks, options, tables, and flow-chart style layouts as closely as possible.",
    "- Treat uploaded question sheets as canonical source material: do not simplify, reorder, paraphrase, or rewrite them into a nicer worksheet format.",
    "- Default to source-faithful transcription when the uploads are already printed worksheet pages; do not merge or drop questions, marks, labels, blanks, or answer cues.",
    "- Keep formulas, labels, and wording faithful to the source except for light OCR cleanup where meaning is unchanged.",
    "- Use Markdown and LaTeX for prompts so the worksheet surface can render tables, formulas, and structured statements cleanly.",
    "- When writing worksheet JSON directly, either avoid LaTeX backslash syntax in prompt strings or JSON-escape every backslash as `\\\\` so the file remains valid JSON.",
    "- If the uploads are notes rather than a ready-made sheet, build a concise worksheet grounded only in the uploaded material.",
    "- Keep the run summary student-facing: concise title + summary, no IDs, file paths, or process narration.",
  );
  return lines.join("\n").trim().concat("\n");
}

export function renderSparkSheetDraftTask(taskTemplate: string): string {
  const baseTask = taskTemplate.trim();
  const skillsSection = renderSparkAgentSkillPromptSection({
    heading: "Required skills",
    skillIds: SPARK_SHEET_DRAFT_SKILL_IDS,
  });
  return [baseTask, "", skillsSection].join("\n").trim().concat("\n");
}

export function buildSparkSheetDraftLaunchPlan(options: {
  sourceText?: string;
  conversationId?: string;
  input: SparkChatCreateSheetInput;
  attachments: SparkChatAttachmentInput[];
  sheetTaskTemplate: string;
  now?: Date;
  createId?: () => string;
}): SparkSheetDraftLaunchPlan {
  const now = options.now ?? new Date();
  const createId = options.createId ?? randomUUID;
  const runId = createId();
  const workspaceId = createId();
  const agentId = createId();
  const launchTitle =
    options.input.title?.trim() || DEFAULT_SPARK_SHEET_RUN_LABEL;
  const runAttachments = options.attachments.map((attachment) =>
    SparkChatAttachmentInputSchema.parse(attachment),
  );
  const runWorkspaceAttachments = buildWorkspaceAttachments(runAttachments);
  return {
    runId,
    workspaceId,
    agentId,
    launchTitle,
    launchTitleKey: normalizeGraderTitleKey(launchTitle),
    summaryPath: SPARK_SHEET_DRAFT_SUMMARY_PATH,
    sheetPath: SPARK_SHEET_DRAFT_PATH,
    answersPath: SPARK_SHEET_DRAFT_ANSWERS_PATH,
    prompt: buildSparkSheetDraftAgentPrompt({
      summaryPath: SPARK_SHEET_DRAFT_SUMMARY_PATH,
      sheetPath: SPARK_SHEET_DRAFT_PATH,
    }),
    brief: buildSparkSheetDraftBrief({
      sourceText: options.sourceText,
      input: options.input,
      attachments: runAttachments,
    }),
    sheetTask: renderSparkSheetDraftTask(options.sheetTaskTemplate),
    skillFiles: resolveSparkAgentSkillFiles(SPARK_SHEET_DRAFT_SKILL_IDS),
    requestPayload: {
      createdAt: now.toISOString(),
      sourceText: options.sourceText ?? null,
      input: options.input,
      attachments: runAttachments,
    },
    runAttachments,
    runWorkspaceAttachments,
    ...(options.sourceText ? { sourceText: options.sourceText } : {}),
    ...(options.conversationId
      ? { conversationId: options.conversationId }
      : {}),
    createdAt: now,
  };
}

export function buildSparkGraderBrief(options: {
  sourceText?: string;
  input: SparkChatCreateGraderInput;
  attachments: SparkChatAttachmentInput[];
}): string {
  const referenceSourcePolicy =
    options.input.referenceSourcePolicy ?? "allow-official-references";
  const referenceSourcePolicyText = (() => {
    switch (referenceSourcePolicy) {
      case "uploaded-only":
        return "uploaded-only (do not search online; rely on uploaded/pasted materials)";
      case "allow-official-references":
        return "allow-official-references (official publisher/exam-board/competition references, answer keys, mark schemes, and official solutions may be searched when the source is identifiable)";
      case "allow-online-search-when-problems-missing":
        return "allow-online-search-when-problems-missing (search online only when problem statements are missing or unclear)";
    }
  })();
  const lines: string[] = ["# Grader request"];
  const rawSource = options.sourceText?.trim();
  if (rawSource && rawSource.length > 0) {
    lines.push("", "## Original user message", "```", rawSource, "```");
  }
  const titleOverride = options.input.title?.trim();
  if (titleOverride && titleOverride.length > 0) {
    lines.push("", "## Requested title override", `- ${titleOverride}`);
  }
  if (options.input.notes) {
    lines.push("", "## User grading focus", options.input.notes.trim());
  }
  lines.push(
    "",
    "## Reference source policy",
    `- ${referenceSourcePolicyText}`,
  );
  if (options.attachments.length > 0) {
    lines.push("", "## Uploaded work");
    let index = 0;
    for (const attachment of options.attachments) {
      index += 1;
      const label = attachment.filename?.trim() || attachment.id;
      const pages =
        typeof attachment.pageCount === "number" && attachment.pageCount > 0
          ? `, pages=${attachment.pageCount.toString()}`
          : "";
      lines.push(
        `- ${index}. ${label} (${attachment.contentType}, size=${attachment.sizeBytes.toString()}${pages})`,
      );
    }
  } else {
    lines.push(
      "",
      "## Uploaded work",
      "- No attachments were included for this run.",
    );
  }
  lines.push(
    "",
    "## Objectives",
    "- Identify the paper, assignment, or document context, year, and title from uploaded learner materials when possible.",
    "- Follow `grader/task.md` and the required skill files for detailed process, schema, visual, and grading rules.",
    "- Classify the mode before expensive work. Use compact scored reports for handwritten submissions with source/reference material; reserve full source-paper reconstruction for source-paper-only runs.",
    "- Transcribe student work first. Keep source/reference context bounded with deterministic PDF reference extraction, grep context, and targeted line-range reads.",
    "- Represent every assessed source item in source order, including blanks, with per-question scores when student answers are present.",
    "- Respect `referenceSourcePolicy` before online search and use official references only when allowed.",
    "- Report applicable official grade/prize/medal/boundary outcomes when an official source supports the mapping.",
    "- Publish one worksheet report through `publish_sheet({})`; do not finish with a normal assistant response before publish succeeds.",
  );
  return lines.join("\n").trim() + "\n";
}

export function resolveSparkGraderModelTools(options: {
  input?: SparkChatCreateGraderInput;
}): readonly LlmToolConfig[] | undefined {
  const referenceSourcePolicy =
    options.input?.referenceSourcePolicy ?? "allow-official-references";
  switch (referenceSourcePolicy) {
    case "uploaded-only":
      return undefined;
    case "allow-official-references":
    case "allow-online-search-when-problems-missing":
      return [{ type: "web-search", mode: "live" }] as const;
  }
}

export function renderSparkGraderTask(taskTemplate: string): string {
  const baseTask = taskTemplate.trim();
  const skillsSection = renderSparkAgentSkillPromptSection({
    heading: "Required skills",
    skillIds: SPARK_GRADER_SKILL_IDS,
  });
  const graderOverrides = [
    "## Grader-specific skill constraints",
    "",
    "- Keep upload inventory, workspace file reading, primary transcription, final grading synthesis, and worksheet assembly on the main agent.",
    "- Generic `spawn_agent` may be used only for bounded sidecar work: official-reference lookup/verification when online lookup is allowed, or visual localization proposals for ambiguous source images.",
    "- Use `extract_pdf_images` as a deterministic embedded-raster first pass when useful, `propose_crop_bbox_with_fresh_agent` for uncertain crop bbox planning, `validate_crop_with_fresh_agent` for final crop validation, `score_answers_with_fresh_agent` for mandatory bounded root-question scoring on long handwritten papers, `validate_grader_artifacts` for grader JSON preflight, and `review_run_progress_with_fresh_agent` when repeated loops suggest the run is on the wrong path.",
    "- For crop validation, pass one final crop path plus question context to `validate_crop_with_fresh_agent`; include `expectedContent` with the exact printed/visible visual labels/axes/options/table cells needed in the crop and `duplicatedTextToExclude` for surrounding prompt/caption/table text rendered separately. Do not include inferred answers or unprinted source labels. Do not batch several high-risk crops into one review.",
    "- If crop validation fails only because `expectedContent` included inferred or unprinted placeholders/labels, correct `expectedContent` and revalidate once instead of recropping.",
    "- For text-selectable source/mark PDFs, use `extract_pdf_reference_text` once and do not feed the same PDF into `extract_text` again unless a specific visual/non-text page must be OCRed; rely on rendered page images for figures, labels, tables, and layout when those details matter.",
    "- Source problem-statement transcription must be verbatim page-by-page source wording, not a compact audit, needed-for-grading summary, or only-visibly-answered list. Include shared root context that applies to included leaves, interstitial stems, answer instructions, options, table labels/cells, figure labels, displayed formulas, and layout-critical wording. Do not replace diagram-option blocks with prose like `Options: A, B, C, D shown as diagram choices`; keep the printed figure/diagram reference and plan a visible crop.",
    "- After source transcription, decide table/visual placement in `sheet-plan.md`, then self-check that Total source marks equals the sum of section totals and listed leaf marks, and that Total answer-bearing leaves equals the listed leaves. For every named figure/diagram/graph/visual option block in an included source item, the plan must name a guarded `grader/output/assets/...` crop or a recorded failed crop path before scoring; never write `no crop needed` just because the mark scheme makes grading possible. For long handwritten papers, score one root question or short contiguous range per `score_answers_with_fresh_agent` call, preferably in parallel. Assemble the first `sheet.json` on the main agent from returned inline scoring/modelAnswer results without rereading every scoring file, crop-validating, or deriving separate model answers. Link planned guarded crop paths in the relevant question/group prompts when needed, call `validate_grader_artifacts`, then create/validate crops and run source-fidelity audit before publish. Use uploaded mark schemes for model answers; do not download optional worked-example/examiner-report PDFs unless explicitly requested.",
    "- Use `fill` only for simple one- or two-blank lines with `prompt`, `blanks`, and `after`; use `cloze` for any `segments`/`blanks` question. Keep named figures/tables and image links out of `section.theory`; place them in the relevant question/group prompt.",
    "- `grader/output/transcription.md` source problem-statement sections must not contain placeholders such as `not yet copied`, `TBD`, or `TODO`; replace placeholders with source wording, figure/table labels, and displayed formulas before validation or publish.",
    "- For long extracted source/reference markdown, use `grep_workspace_files` context around exact question/page headings before any `read_workspace_file` `startLine`/`lineCount` range; do not load full question papers or mark schemes.",
    "- Final grading feedback must be emitted as per-question worksheet scores plus worksheet-level reference markdown. For unresolved or incorrect work, write per-question notes as short gap-closing cues for the Spark-owned sheet close-gap answer builder; do not reveal the model answer, mark scheme, final corrected sentence, or complete method in the inline note. Include `replyPlaceholder` when a focused repair prompt would help, and include `modelAnswer` when a concise mark-scheme answer is available so the guided close-gap flow can build correct steps. Correct/resolved questions may use an empty `note` because completed feedback cards are hidden in the student UI. Keep any model-answer derivation concise and after the publish-critical JSON is written.",
    "- When official grade boundaries, prize thresholds, medal cutoffs, or examiner-report outcome guidance apply, report the real-world outcome and its basis in worksheet feedback/reference markdown; if unavailable, say so rather than inventing one.",
  ].join("\n");
  return [baseTask, "", skillsSection, "", graderOverrides]
    .join("\n")
    .trim()
    .concat("\n");
}

export function buildSparkGraderLaunchPlan(options: {
  sourceText?: string;
  conversationId?: string;
  input: SparkChatCreateGraderInput;
  attachments: SparkChatAttachmentInput[];
  graderTaskTemplate: string;
  now?: Date;
  createId?: () => string;
}): SparkGraderLaunchPlan {
  const now = options.now ?? new Date();
  const createId = options.createId ?? randomUUID;
  const runId = createId();
  const workspaceId = createId();
  const agentId = createId();
  const launchTitle =
    options.input.title?.trim() || DEFAULT_SPARK_GRADER_RUN_LABEL;
  const runAttachments = options.attachments.map((attachment) =>
    SparkChatAttachmentInputSchema.parse(attachment),
  );
  const runWorkspaceAttachments = buildWorkspaceAttachments(runAttachments);
  const sourcePaperOnlyNoStudent = inferSourcePaperOnlyNoStudentRequest({
    sourceText: options.sourceText,
    input: options.input,
  });
  const graderInput = {
    ...options.input,
    ...(sourcePaperOnlyNoStudent ? { sourcePaperOnlyNoStudent } : {}),
  };
  const brief = buildSparkGraderBrief({
    sourceText: options.sourceText,
    input: graderInput,
    attachments: runAttachments,
  });
  return {
    runId,
    workspaceId,
    agentId,
    launchTitle,
    launchTitleKey: normalizeGraderTitleKey(launchTitle),
    summaryPath: SPARK_GRADER_SUMMARY_PATH,
    sheetPath: SPARK_GRADER_SHEET_PATH,
    prompt: buildSparkGraderAgentPrompt({
      summaryPath: SPARK_GRADER_SUMMARY_PATH,
      sheetPath: SPARK_GRADER_SHEET_PATH,
    }),
    brief,
    graderTask: renderSparkGraderTask(options.graderTaskTemplate),
    skillFiles: resolveSparkAgentSkillFiles(SPARK_GRADER_SKILL_IDS),
    requestPayload: {
      createdAt: now.toISOString(),
      sourceText: options.sourceText ?? null,
      input: graderInput,
      attachments: runAttachments,
      ...(sourcePaperOnlyNoStudent ? { sourcePaperOnlyNoStudent } : {}),
    },
    runAttachments,
    runWorkspaceAttachments,
    ...(options.sourceText ? { sourceText: options.sourceText } : {}),
    ...(options.conversationId
      ? { conversationId: options.conversationId }
      : {}),
    createdAt: now,
  };
}

type CreateGraderLaunchResult = {
  status: "started";
};

type CreateSheetLaunchResult = {
  status: "started";
};

export function createSparkChatCreateSheetTool(options: {
  sourceText?: string;
  conversationId?: string;
  attachmentsForMessage: SparkChatAttachmentInput[];
  sheetTaskTemplate: string;
  onStructuredCall?: (payload: {
    input: SparkChatCreateSheetInput;
    plan: SparkSheetDraftLaunchPlan;
  }) => Promise<void> | void;
  launch: (payload: {
    input: SparkChatCreateSheetInput;
    plan: SparkSheetDraftLaunchPlan;
  }) => Promise<CreateSheetLaunchResult>;
}) {
  return tool({
    description: SPARK_CHAT_CREATE_SHEET_TOOL_DESCRIPTION,
    inputSchema: SparkChatCreateSheetInputSchema,
    execute: async (input) => {
      const plan = buildSparkSheetDraftLaunchPlan({
        sourceText: options.sourceText,
        conversationId: options.conversationId,
        input,
        attachments: options.attachmentsForMessage,
        sheetTaskTemplate: options.sheetTaskTemplate,
      });
      await options.onStructuredCall?.({ input, plan });
      const result = await options.launch({ input, plan });
      return {
        status: result.status,
      };
    },
  });
}

export function createSparkChatCreateGraderTool(options: {
  sourceText?: string;
  conversationId?: string;
  attachmentsForMessage: SparkChatAttachmentInput[];
  graderTaskTemplate: string;
  onStructuredCall?: (payload: {
    input: SparkChatCreateGraderInput;
    plan: SparkGraderLaunchPlan;
  }) => Promise<void> | void;
  launch: (payload: {
    input: SparkChatCreateGraderInput;
    plan: SparkGraderLaunchPlan;
  }) => Promise<CreateGraderLaunchResult>;
}) {
  return tool({
    description: SPARK_CHAT_CREATE_GRADER_TOOL_DESCRIPTION,
    inputSchema: SparkChatCreateGraderInputSchema,
    execute: async (input) => {
      const plan = buildSparkGraderLaunchPlan({
        sourceText: options.sourceText,
        conversationId: options.conversationId,
        input,
        attachments: options.attachmentsForMessage,
        graderTaskTemplate: options.graderTaskTemplate,
      });
      await options.onStructuredCall?.({ input, plan });
      const result = await options.launch({ input, plan });
      return {
        status: result.status,
      };
    },
  });
}

type RunAgentLoopOptions = Parameters<typeof runAgentLoop>[0];

export async function runSparkChatAgentLoop(options: {
  input: string | LlmInputMessage[];
  instructions: string;
  tools: LlmToolSet;
  modelId?: LlmTextModelId;
  logging?: RunAgentLoopOptions["logging"];
  onEvent?: RunAgentLoopOptions["onEvent"];
}) {
  configureSparkLlmTelemetryFromEnv();
  const processUsageMonitor = new AgentProcessUsageMonitor();
  const metricTaskIdPrefix = `spark-chat-${Date.now().toString()}`;
  const modelId: LlmTextModelId = options.modelId ?? SPARK_CHAT_MODEL_ID;
  let metricStatus: "ok" | "error" = "error";

  processUsageMonitor.start();
  try {
    const result = await runAgentLoop({
      model: modelId,
      input: options.input,
      instructions: options.instructions,
      tools: options.tools,
      maxSteps: SPARK_CHAT_MAX_TOOL_STEPS,
      thinkingLevel: SPARK_CHAT_THINKING_LEVEL,
      telemetry: createSparkAgentRunTelemetryConfig({
        agentType: "chat",
        job: "spark-chat",
        taskIdPrefix: "spark-chat",
      }),
      ...(options.logging ? { logging: options.logging } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });

    await Promise.all(
      result.steps.map(async (step) => {
        if (!step.timing) {
          return;
        }
        await publishSparkToolLoopStepMetricsFromEnv({
          operation: "agent_run_tool_loop",
          model: modelId,
          provider: resolveSparkMetricProviderLabel(modelId),
          status: "ok",
          agentType: "chat",
          timings: {
            totalMs: step.timing.totalMs,
            queueWaitMs: step.timing.queueWaitMs,
            connectionSetupMs: step.timing.connectionSetupMs,
            activeGenerationMs: step.timing.activeGenerationMs,
            toolExecutionMs: step.timing.toolExecutionMs,
            waitToolMs: step.timing.waitToolMs,
            schedulerDelayMs: step.timing.schedulerDelayMs,
            providerRetryDelayMs: step.timing.providerRetryDelayMs,
          },
          job: "spark-chat",
          taskId: `${metricTaskIdPrefix}-step-${step.step.toString()}`,
          ...(step.timing.completedAt
            ? { timestamp: step.timing.completedAt }
            : {}),
        });
      }),
    );

    metricStatus = "ok";
    return result;
  } finally {
    const processUsage = processUsageMonitor.stop();
    await publishSparkAgentProcessMetricsFromEnv({
      agentType: "chat",
      status: metricStatus,
      cpuUtilization: processUsage.cpuUtilization,
      cpuTimeMs: processUsage.cpuTimeMs,
      rssPeakBytes: processUsage.rssPeakBytes,
      job: "spark-chat",
      taskId: `${metricTaskIdPrefix}-process`,
    });
  }
}
