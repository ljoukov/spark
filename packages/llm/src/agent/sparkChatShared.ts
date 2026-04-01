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
  SPARK_GRADER_UPLOADS_MANIFEST_PATH,
  buildSparkGraderAgentPrompt,
} from "./graderAgentPrompt";
import {
  SPARK_SHEET_DRAFT_ANSWERS_PATH,
  SPARK_SHEET_DRAFT_PATH,
  SPARK_SHEET_DRAFT_SUMMARY_PATH,
  buildSparkSheetDraftAgentPrompt,
} from "./sheetDraftAgentPrompt";
import { HANDWRITING_TRANSCRIPTION_SKILL_TEXT } from "./skills/handwritingTranscription";

const trimmedString = z.string().trim().min(1);

export const DEFAULT_SPARK_GRADER_RUN_KEY = "uploaded_work" as const;
export const DEFAULT_SPARK_GRADER_RUN_LABEL = "Uploaded work" as const;
export const SPARK_CHAT_MODEL_ID = "chatgpt-gpt-5.4" as const;
export const SPARK_CHAT_THINKING_LEVEL = "medium" as const;
export const SPARK_CHAT_MAX_TOOL_STEPS = 256;

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
      .enum(["uploaded-only", "allow-online-search-when-problems-missing"])
      .optional()
      .describe(
        [
          "Controls whether the grader may search online for missing problem statements/official references.",
          "- uploaded-only: use uploaded/pasted materials only; do not search online.",
          "- allow-online-search-when-problems-missing: online search is allowed only when problem statements are missing/unclear.",
        ].join("\n"),
      ),
    notes: nullableOptionalString().describe(
      "Optional grading focus for this run (for example: focus on proof rigor and notation).",
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
  requestPayload: SparkGraderRequestPayload;
  runAttachments: SparkChatAttachmentInput[];
  runWorkspaceAttachments: SparkGraderWorkspaceAttachment[];
  sourceText?: string;
  conversationId?: string;
  createdAt: Date;
};

export const SPARK_CHAT_CREATE_GRADER_TOOL_DESCRIPTION = [
  "Start a grading run from the learner's uploaded work.",
  "Creates a grader workspace, seeds grader/task.md, and launches a background agent.",
  "Use this when the learner asks to mark or grade uploaded answers, submissions, scripts, or related reference documents.",
  "If the current user turn clearly asks to grade uploaded work, call this tool instead of answering with grading feedback directly in chat.",
  "Uploads can include student handwriting, problem statements, answer booklets, rubrics, and optional official solutions/mark schemes.",
  "Set referenceSourcePolicy based on learner confirmation: uploaded-only by default; allow online search only when the learner explicitly approves and problems are missing.",
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
    lines.push(
      "",
      "## User worksheet focus",
      options.input.notes.trim(),
    );
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
    "- If the uploads are notes rather than a ready-made sheet, build a concise worksheet grounded only in the uploaded material.",
    "- Keep the run summary student-facing: concise title + summary, no IDs, file paths, or process narration.",
  );
  return lines.join("\n").trim().concat("\n");
}

export function renderSparkSheetDraftTask(taskTemplate: string): string {
  const baseTask = taskTemplate.trim();
  const extractionWorkflowSection = [
    "",
    "## Extraction workflow",
    "Use an extraction-first workflow before drafting the worksheet JSON.",
    "",
    "- Start with one `extract_text` call that covers every uploaded worksheet, question sheet, or source note.",
    "- If the upload is already a printed worksheet or exam page, always run `pdf_to_images` and inspect every relevant page or crop with `view_image` before drafting.",
    "- For non-worksheet uploads, if page layout matters, run `pdf_to_images` and inspect the relevant pages with `view_image` before drafting.",
    "- Keep question sheets and exam pages faithful to the source structure.",
    "- Never synthesize a new worksheet format when the upload is already a printed worksheet or exam page.",
    "- Do not merge questions, normalize numbering, or omit marks / labels / answer lines from an uploaded question sheet.",
    "- If a numbered source question has shared context such as a stem, table, or diagram before subparts, keep that context in a `group` entry rather than moving it to section theory.",
    "- Every printed question or subpart visible in the source must appear as a worksheet question object. Do not leave a titled section empty when the source page shows questions there.",
    "- Mark uncertainty explicitly instead of guessing missing words, symbols, or labels.",
    "- Never invent placeholder copy for blanks or empty boxes unless the source prints it.",
    "- If the source shows a short numeric answer line such as `Answer ____ £`, prefer `calc` or `fill` instead of `lines`.",
    "- If `pdf_to_images` or `view_image` fails for a printed worksheet or exam page, stop and fix or report that failure instead of publishing a partial text-only worksheet.",
    "- `publish_sheet_draft` only validates schema/persistence; before the first publish attempt, compare the draft against extracted text and viewed source pages and fix any paraphrase, omission, reorder, or guessed OCR.",
    "- Supported worksheet question types are: group, fill, cloze, mcq, lines, calc, match, spelling, flow.",
    "- `fill` questions must use the real schema shape with `prompt`, `blanks`, `after`, optional `conjunction`, and `marks`.",
    "- Use `displayNumber` when a source question has subparts such as `9(a)` or `10(b)`.",
    "- When a grouped child subpart should show a compact circular badge, set `badgeLabel` separately while keeping the full source-faithful label in `displayNumber`, for example `displayNumber: \"10(a)\"` with `badgeLabel: \"a\"`.",
    "- Use `flow` when the source question uses a box-and-arrow calculation structure that should stay visible to the student.",
    "- For `flow.rows[].items`, keep the array in printed left-to-right order; use `direction` only to describe arrow direction.",
  ].join("\n");
  return `${baseTask}${extractionWorkflowSection}`.trim().concat("\n");
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
  const runWorkspaceAttachments = runAttachments.map((attachment) => ({
    ...attachment,
    workspacePath: resolveSparkGraderAttachmentWorkspacePath(attachment),
  }));
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
    options.input.referenceSourcePolicy ?? "uploaded-only";
  const referenceSourcePolicyText =
    referenceSourcePolicy === "allow-online-search-when-problems-missing"
      ? "allow-online-search-when-problems-missing (search online only when problem statements are missing or unclear)"
      : "uploaded-only (do not search online; rely on uploaded/pasted materials)";
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
    "- Transcribe student work, problem statements, and any official solutions from uploads first.",
    "- For student submissions, keep transcription complete and faithful, then convert the graded worksheet into one worksheet JSON artifact with supported sheet question types plus the student's submitted answers.",
    "- When prompt text and student writing share the same page, transcription must clearly separate the original task text from the student's supplied answer.",
    "- For problem statements and official solutions, keep source wording as verbatim as possible; do not rewrite them into cleaned canonical statements.",
    "- Only apply minimal OCR/layout cleanup when meaning is unchanged, and mark uncertainty explicitly instead of paraphrasing.",
    "- Preserve the student's variable names, formulas, terminology, and method choice as closely as possible while doing that cleanup.",
    "- Respect the reference source policy before any online search.",
    "- Per-question worksheet review notes should be empathetic and student-facing: acknowledge plausible thinking or correct structure before naming the exact gap.",
    "- Prefer methodological direction or a rule of thumb before giving the answer away, and do not treat a near-miss as resolved if the task itself is still unmet.",
    "- If official solutions are missing, solve each problem carefully before grading and match the student's level/terminology/methods where reasonable.",
    "- The run summary shown in the UI should stay short and student-facing: title + concise markdown summary, with no IDs, file paths, or process-log wording.",
    "- Base the run title on the uploaded content and identified source context; if the source cannot be identified, describe the graded scope neutrally.",
  );
  return lines.join("\n").trim() + "\n";
}

export function resolveSparkGraderModelTools(options: {
  input?: SparkChatCreateGraderInput;
}): readonly LlmToolConfig[] | undefined {
  const referenceSourcePolicy =
    options.input?.referenceSourcePolicy ?? "uploaded-only";
  if (referenceSourcePolicy === "allow-online-search-when-problems-missing") {
    return [{ type: "web-search", mode: "live" }] as const;
  }
  return undefined;
}

export function renderSparkGraderTask(taskTemplate: string): string {
  const baseTask = taskTemplate.trim();
  const transcriptionSkillSection = [
    "",
    "## Handwriting transcription workflow (must follow)",
    "Use this skill for extraction-first transcription of uploaded student work, problem statements, and official solutions.",
    "",
    "~~~markdown",
    HANDWRITING_TRANSCRIPTION_SKILL_TEXT,
    "~~~",
    "",
    "Grader-specific override:",
    "- When uploaded files are transcription targets, include them in the same initial `extract_text` call via `documentPaths`.",
    "- Leave `supportingPaths` unset unless a file is disambiguation-only and is not itself a transcription target.",
    "- Problem statements and official solutions must keep source wording verbatim where possible: preserve numbering, labels, examples, punctuation, variable names, and displayed math.",
    "- Do not rewrite problem statements into cleaned/canonical wording; allow only minimal OCR/layout cleanup that keeps meaning unchanged, and mark any remaining uncertainty explicitly.",
    "- Student solution transcription must be complete and faithful, but the final output is one worksheet JSON artifact rather than a markdown report.",
    "- On mixed prompt/answer pages (for example fill-in-the-blank work), clearly distinguish original prompt text from the student's supplied words and store only the student contribution inside worksheet `answers`.",
    "- Preserve student variable names, formulas, terminology, and method choices as closely as possible; allow only numbering, line-break cleanup, and obvious spelling fixes that do not change meaning.",
    "- Final grading feedback must be emitted as per-question worksheet review notes plus worksheet-level reference markdown.",
    "- Worksheet review notes should be empathetic and specific: acknowledge what makes sense in a near-miss or almost-correct structure before naming the gap.",
    "- Prefer a next-step cue, contrast, or rule of thumb before giving the answer outright, and do not accept loose synonyms when the task asked for a definition/explanation.",
    "- When official solutions are missing, derived solutions should stay at the student's level and reuse their terminology/method style where reasonable.",
    "- Use only supported worksheet question types: fill, cloze, mcq, lines, calc, match, spelling, flow. If a task does not fit cleanly, use `lines`.",
    "",
    "Run-mode constraints for grader runs:",
    "- Keep transcription and source gathering on the main agent only.",
    "- After transcription, use subagents selectively for substantial reasoning work; keep short routine worksheet questions in the main agent. If you do use one, use at most 1 subagent per problem for solving/assessment.",
    "- For grader subagents, call `spawn_agent` with a single text instruction in `prompt` or `message` only. Do not send workspace files or uploads via `items`; tell the subagent which workspace paths to read or view itself.",
    "- Keep reference-text extraction disabled; rely on explicit `extract_text` instructions and direct source fidelity.",
  ].join("\n");
  return `${baseTask}${transcriptionSkillSection}`.trim().concat("\n");
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
  const runWorkspaceAttachments = runAttachments.map((attachment) => ({
    ...attachment,
    workspacePath: resolveSparkGraderAttachmentWorkspacePath(attachment),
  }));
  const brief = buildSparkGraderBrief({
    sourceText: options.sourceText,
    input: options.input,
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
  const toolLoopModel = modelId as RunAgentLoopOptions["model"];
  let metricStatus: "ok" | "error" = "error";

  processUsageMonitor.start();
  try {
    const result = await runAgentLoop({
      model: toolLoopModel,
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
