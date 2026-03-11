import { randomUUID } from "node:crypto";

import {
  runAgentLoop,
  tool,
  type LlmInputMessage,
  type LlmToolConfig,
  type LlmToolSet,
} from "@ljoukov/llm";
import { z } from "zod";

import {
  SPARK_GRADER_PROBLEMS_DIR,
  SPARK_GRADER_SUMMARY_PATH,
  SPARK_GRADER_UPLOADS_MANIFEST_PATH,
  buildSparkGraderAgentPrompt,
} from "./graderAgentPrompt";
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
  problemsDir: string;
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
  lines.push("", "## Reference source policy", `- ${referenceSourcePolicyText}`);
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
    lines.push("", "## Uploaded work", "- No attachments were included for this run.");
  }
  lines.push(
    "",
    "## Objectives",
    "- Identify the paper, assignment, or document context, year, and title from uploaded learner materials when possible.",
    "- Transcribe student work, problem statements, and any official solutions from uploads first.",
    "- For student submissions, keep transcription complete and faithful, then rewrite each problem into a numbered list of student statements/sentences in source order without retelling.",
    "- When prompt text and student writing share the same page, transcription must clearly separate the original task text from the student's supplied answer.",
    "- For problem statements and official solutions, keep source wording as verbatim as possible; do not rewrite them into cleaned canonical statements.",
    "- Only apply minimal OCR/layout cleanup when meaning is unchanged, and mark uncertainty explicitly instead of paraphrasing.",
    "- Preserve the student's variable names, formulas, terminology, and method choice as closely as possible while doing that cleanup.",
    "- Respect the reference source policy before any online search.",
    "- Feedback should be line-by-line against those numbered student statements.",
    "- Feedback should be empathetic and student-facing: acknowledge plausible thinking or correct structure before naming the exact gap.",
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
    "- Student solution transcription must be complete and faithful: after extraction, split each problem into a numbered list of student statements/sentences in source order.",
    "- On mixed prompt/answer pages (for example fill-in-the-blank work), clearly distinguish original prompt text from the student's supplied words; if needed, format transcript items as `Prompt fragment: ... Student response: ...`.",
    "- Preserve student variable names, formulas, terminology, and method choices as closely as possible; allow only numbering, line-break cleanup, and obvious spelling fixes that do not change meaning.",
    "- Final grading feedback must be line-by-line against that numbered transcript.",
    "- Annotation and feedback should be empathetic and specific: acknowledge what makes sense in a near-miss or almost-correct structure before naming the gap.",
    "- Prefer a next-step cue, contrast, or rule of thumb before giving the answer outright, and do not accept loose synonyms when the task asked for a definition/explanation.",
    "- When official solutions are missing, derived solutions should stay at the student's level and reuse their terminology/method style where reasonable.",
    "",
    "Run-mode constraints for grader runs:",
    "- Keep transcription and source gathering on the main agent only.",
    "- After transcription, use subagents for per-problem work: exactly 1 subagent per problem for solving/assessment.",
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
    problemsDir: SPARK_GRADER_PROBLEMS_DIR,
    prompt: buildSparkGraderAgentPrompt({
      summaryPath: SPARK_GRADER_SUMMARY_PATH,
      problemsDir: SPARK_GRADER_PROBLEMS_DIR,
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
  logging?: RunAgentLoopOptions["logging"];
  onEvent?: RunAgentLoopOptions["onEvent"];
}) {
  return await runAgentLoop({
    model: SPARK_CHAT_MODEL_ID,
    input: options.input,
    instructions: options.instructions,
    tools: options.tools,
    maxSteps: SPARK_CHAT_MAX_TOOL_STEPS,
    thinkingLevel: SPARK_CHAT_THINKING_LEVEL,
    ...(options.logging ? { logging: options.logging } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
}
