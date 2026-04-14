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
import { HANDWRITING_TRANSCRIPTION_SKILL_TEXT } from "./skills/handwritingTranscription";

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
          "Controls whether the grader may search online for official problem statements, answer keys, mark schemes, or solution references.",
          "- uploaded-only: use uploaded/pasted materials only; do not search online. Use this only when the learner explicitly forbids online lookup or asks to rely only on uploads.",
          "- allow-official-references: online search is allowed for official publisher/exam-board/competition references, including answer keys and mark schemes, when the source can be identified.",
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
    "- Supported worksheet question types are: group, answer_bank, fill, cloze, mcq, lines, calc, match, spelling, flow.",
    "- Use `answer_bank` when the source prints visible blanks plus a fixed option bank such as `(A)` to `(D)`; keep the sentence in `segments[]` and the source-labelled options in `options[]`.",
    "- For `answer_bank`, `segments[]` must be clean prose around the interactive blanks. Do not copy decorative `(____)` wrappers, underscores, or dangling closing brackets from the printed blank markers.",
    '- For `answer_bank`, use `displayMode: "inline_labeled"` by default when each selector should show the full labelled option such as `(A) principal amount`. Use `displayMode: "banked"` only when the source shows a separate visible answer bank that should stay below the sentence or when the full labelled option text is too long to fit cleanly in the selector.',
    '- For `mcq`, keep the stem in `prompt`, keep structured options in `options[]`, and choose `displayMode: "full_options"` by default when the selectable cards should show the full option text. Use `displayMode: "labels_only"` only when long source options should stay listed separately above compact label-only selectors.',
    '- For `mcq` with `displayMode: "labels_only"`, every option still needs a source-faithful `label` such as `A`, `B`, `C`, or `D`; use `full_options` when the visible selectable card needs the option text.',
    '- For MCQs whose choices are only diagram labels or positions, use `displayMode: "labels_only"` with source labels and omit `options[].text` (or set it to `""`). Do not invent placeholder text such as `Option A`.',
    "- For `calc`, include the required `inputLabel` and `unit` fields; do not add unsupported fields such as `lines` to a calc question.",
    "- `fill` questions must use the real schema shape with `prompt`, `blanks`, `after`, optional `conjunction`, and `marks`.",
    "- Use `displayNumber` when a source question has subparts such as `9(a)` or `10(b)`.",
    '- When a grouped child subpart should show a compact circular badge, set `badgeLabel` separately while keeping the full source-faithful label in `displayNumber`, for example `displayNumber: "10(a)"` with `badgeLabel: "a"`.',
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
    "- Transcribe student work, problem statements, and any official solutions from uploads first.",
    "- For student submissions, keep transcription complete and faithful, then convert the graded worksheet into one worksheet JSON artifact with supported sheet question types plus the student's submitted answers.",
    "- When prompt text and student writing share the same page, transcription must clearly separate the original task text from the student's supplied answer.",
    "- For problem statements and official solutions, keep source wording as verbatim as possible; do not rewrite them into cleaned canonical statements.",
    "- Only apply minimal OCR/layout cleanup when meaning is unchanged, and mark uncertainty explicitly instead of paraphrasing.",
    "- If the uploads include a printed question sheet or exam page, preserve the original numbering hierarchy, shared stems, MCQ option structure, tables, and layout-critical figures as closely as possible in the worksheet JSON.",
    "- Represent every assessed source question and subquestion in source order, including blank or unanswered items; never include only answered questions, only confident grades, or only questions with visible student writing.",
    '- If the request is source-paper-only and no student answers/submission are present, render the paper as an unanswered worksheet instead of solving it: skip solution-baseline derivation unless the learner explicitly asked for answers, leave answers blank (use `""` for unanswered MCQ and answer-bank selections), use review/status labels such as `Awaiting answer`, do not treat every item as a completed zero-score attempt, and do not expose an answer key in visible prompts, review notes, or reference markdown.',
    "- Use `group`, `displayNumber`, and `badgeLabel` when a numbered source question has shared context followed by subparts; do not split those subparts into unrelated standalone prompts.",
    '- For numbering like `01`, `01.1`, `01.2`, create a parent `group` with `displayNumber: "01"` and put `01.1`, `01.2`, etc. inside that group\'s `questions[]`; a flat list of `01.x` subparts is not source-faithful.',
    "- If the source uses subpart numbering such as `01.1` or `5(a)`, keep an explicit parent/group entry for that root question even when only one marked child subpart is visible on the page.",
    "- Keep content sections source-faithful and useful as collapsible navigation. Use real source sections when present; otherwise use one section per root question when roots have subquestions or substantial shared context, and reserve neutral numeric ranges like `Questions 1-5` for long unsectioned runs of many small standalone questions. Do not reorder questions or invent difficulty labels.",
    "- Do not render cover-page or administration boilerplate as worksheet questions/context unless it is needed to answer or grade a question. Keep provenance or scoring rules in references when useful.",
    "- Convert source text/number tables into Markdown tables when possible, and crop essential source figures into workspace image files that can be linked from worksheet Markdown.",
    "- Place figures and tables as close as possible to the source question/subquestion that uses them: use the parent `group.prompt` only for material before the first subpart or genuinely shared by all subparts, and use the specific child prompt for material introduced immediately before or inside one subquestion.",
    "- Keep labels attached to their own artifacts: put `Figure N` caption text immediately adjacent to the `Figure N` crop, and put `Table N` caption text immediately adjacent to the `Table N` Markdown table. Do not place a table between a figure caption and the figure image. Do not repeat the same figure/table image in later subquestions; render it once at the first source-faithful location, then refer to it with an anchor link such as `[Figure N](#figure-n)` / `[Table N](#table-n)` or with `Figure N above` / `Table N above` when the artifact is directly above.",
    "- Cross-check named references from the transcription before publish: every included `Figure N` needs a linked crop near that label, and every included text/numeric `Table N` extracted in the transcription needs a Markdown table near that label.",
    "- Do not use source references or transcription as a substitute for visible worksheet context. Any question prompt that mentions an answer-critical diagram, figure, graph, chart, map, network, or photo must include the linked crop in that prompt/group prompt near the text.",
    "- Figure crops must include every label, axis, table cell, option, and annotation needed by the question. Crop around the visual artifact itself; transcribe printed captions/stems such as `Figure 1 shows...` into Markdown and exclude duplicated caption/question text from the image crop unless those words are part of a visual label, axis, or legend. The worksheet renders artifact labels separately, so exclude standalone `Figure N` / `Table N` captions from the crop unless removing the caption would clip required visual content. It is better to leave slight extra whitespace than to clip important content; leave a small clean margin so question-relevant ink does not touch the image edge.",
    '- For figure isolation/refinement, use a rectangular crop workflow: do not do mask segmentation; produce one clean rectangular crop per target figure. Start from a previous bad crop if it contains the whole figure, otherwise use the full source page; inspect both the selected base image and its coordinate-grid overlay with `view_image`; choose one pixel bbox in that base image\'s coordinate space; prefer a small safe white margin over clipping; reject crops that include surrounding question text, mark text, answer lines, page borders, next-question content, or standalone Figure/Table captions already rendered by the worksheet. When documenting a crop-refinement decision, use JSON shape `{ "cropBase": "badCrop" | "fullPage", "bbox": { "left": number, "top": number, "right": number, "bottom": number }, "reasoning": "brief edge-by-edge explanation", "risks": [] }`, with origin at top-left and right/bottom exclusive. Apply the box with `crop_image` using `bboxPixels` on the selected base image.',
    "- When crop bounds are uncertain, use `propose_crop_bbox_with_fresh_agent` with the poor crop/full page/grid overlay paths so a fresh visual agent follows the rectangular JSON workflow and returns one bbox. You may also use `extract_pdf_diagrams` as a Gemini-assisted coarse bounding-box proposal or cross-check. Treat model-suggested boxes as proposals only; expand/refine them when labels, axes, legends, options, or table cells are near an edge. If one manual crop-and-view correction for the same target is still clipped/noisy/uncertain, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` before spending more turns on hand-tuned crop boxes.",
    "- Use `pad_image` only for a crop that has already passed fresh visual validation and only needs a clean white border after publish validation says dark content touches an edge. Never use `pad_image` to fix a crop-review failure, missing content, clipping, unrelated text, or a duplicated standalone caption; recrop from the high-resolution source page and validate again.",
    "- Use at most six `crop_image` attempts for any one output asset before switching strategy. After that, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` for the source page/target label if you have not already used them. Do not publish a crop-validation report that records unresolved failures.",
    "- Final figure crops must show the complete intended visual, not a mid-diagram fragment and not a different neighbouring figure. If a crop starts inside a diagram, cuts off vertices/labels/axes/table borders/options, or includes a separate neighbouring diagram that would confuse the question, recrop from the high-resolution page image with wider bounds and recheck.",
    "- For objective questions whose answer choices are diagrams, crop one complete options block or separate complete option crops; every candidate label and every option diagram/shape must be fully visible.",
    "- Never validate option-diagram crops as top/bottom portions, used-together fragments, or other partial crops. A final option crop must contain whole candidate labels and whole candidate diagrams.",
    "- Treat crop-review feedback as blocking when it reports clipped required content, a missing label/axis/option/table cell, wrong association, or a medium/high severity issue. Recrop from the high-resolution page image and recheck before publishing; if content is clipped, expand in the clipped direction first instead of trimming tighter. Never publish just because a validation file exists.",
    "- If you use `crop_image` or `trim_image` on a linked worksheet asset after writing `grader/output/crop-validation.md`, the validation is stale: rerun the fresh-context crop check for the final asset and rewrite `crop-validation.md` before publishing. `pad_image` is allowed only after a completed passing validation because it only adds a white border.",
    "- Preserve the student's variable names, formulas, terminology, and method choice as closely as possible while doing that cleanup.",
    "- Respect the reference source policy before any online search.",
    "- When official references are allowed and the uploaded work identifies a public paper, prefer official answer keys, mark schemes, or official solutions for the correct-answer baseline before self-solving.",
    "- Per-question worksheet review notes should be empathetic and student-facing for unresolved/incorrect work: acknowledge plausible thinking or correct structure before naming the exact gap. Correct/resolved questions may use an empty per-question `note` because completed feedback cards are hidden in the student UI.",
    "- Review notes are first tutor messages, not answer-key reveals. Prefer a targeted cue, contrast, rule of thumb, or next step before giving the answer away, and do not treat a near-miss as resolved if the task itself is still unmet.",
    '- Include per-question awarded marks in `review.questions[questionId].score` so the sheet UI can show awarded/total marks for each question when student answers are present. For source-paper-only/no-student runs, set `review.mode` to `"awaiting_answers"`, leave answers blank, omit per-question scores, and do not present the sheet as a completed zero-score attempt.',
    "- If official solutions are missing and student work actually needs grading, solve each problem carefully before grading and match the student's level/terminology/methods where reasonable.",
    "- The run summary shown in the UI should stay short and student-facing: title + concise markdown summary, with no IDs, file paths, or process-log wording.",
    "- Base the run title on the uploaded content and identified source context; if the source cannot be identified, describe the graded scope neutrally.",
    "- Keep worksheet metadata natural and non-redundant: `sheet.subject`, `sheet.level`, `sheet.title`, `sheet.subtitle`, `presentation.title`, `presentation.subtitle`, and `presentation.footer` are rendered together, so do not repeat the same paper name, level word, subject word, or phrase across them. `sheet.level` must be a compact tier/level only, not the full paper or competition title. Avoid suffixes like `question paper` in `sheet.title` when the subtitle/provenance already makes the source type clear.",
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
    "- If the uploads include a printed worksheet or exam page, run `pdf_to_images` and inspect relevant page images before you finalize worksheet structure. Use `extract_pdf_reference_text` once for text-selectable PDFs as a navigation/transcription aid, then use `draw_grid_overlay`, `crop_image`, and `trim_image` when you need precise figure or table crops.",
    "- Problem statements and official solutions must keep source wording verbatim where possible: preserve numbering, labels, examples, punctuation, variable names, and displayed math.",
    "- Do not rewrite problem statements into cleaned/canonical wording; allow only minimal OCR/layout cleanup that keeps meaning unchanged, and mark any remaining uncertainty explicitly.",
    "- Student solution transcription must be complete and faithful, but the final output is one worksheet JSON artifact rather than a markdown report.",
    "- `grader/output/transcription.md` must include both student-answer transcription and source problem-statement transcription when a printed/source paper is uploaded. Put the source transcript under the exact heading `## Source problem-statement transcription`. The source transcription must record printed root stems, interstitial context, subquestion prompts, table labels, figure labels, and MCQ option labels/text in source order; an audit note alone is not enough.",
    "- On mixed prompt/answer pages (for example fill-in-the-blank work), clearly distinguish original prompt text from the student's supplied words and store only the student contribution inside worksheet `answers`.",
    "- For objective/MCQ submissions, keep answer capture separate from solving: record what the student visibly selected first, then establish the correct-answer baseline, then mark.",
    '- Record a selected MCQ/objective option only when there is an explicit answer-selection mark. If no selected option is visible, treat it as blank/no-answer and do not infer a real option from solving, workings, or nearby scribbles; use `""` for unanswered MCQ values instead of a real option id.',
    '- If no student answers were provided at all and the task is to render or grade the source paper itself, do not solve the paper or build an answer key for display. Publish an unanswered sheet with blank/no-answer entries, `review.mode: "awaiting_answers"`, empty per-question notes, and student-facing status labels such as `Awaiting answer`; keep required worksheet total fields schema-compatible without per-question zero scores or presenting the run as a completed failed attempt.',
    "- Preserve printed worksheet structure directly in the sheet JSON: keep source-faithful numbering with `displayNumber`, use `badgeLabel` only for compact subpart chrome, keep shared stems/tables/diagrams inside `group` entries, and do not flatten source MCQs or tables into generic `lines` prompts.",
    "- Represent every assessed question/subquestion from the printed source, including blanks and unanswered items; do not decide to include only answered work or only questions whose marking feels certain.",
    '- For source roots with decimal subparts (`01.1`, `01.2`, ...), use a `group` entry for the root question (`displayNumber: "01"`) and nest each subpart as a child question; do not put the subparts directly in the section.',
    "- Put only the source text that appears after the root number and before the first subpart in the root `group.prompt`; put interstitial text that appears between later subparts into the following child prompt, and do not duplicate the root stem inside the first child prompt.",
    "- If the paper shows subpart numbering like `01.1` or `5(a)`, keep the parent question root as an explicit `group` or parent entry even when there is only one answer-bearing child subpart on that page.",
    "- Make sections useful as collapsible navigation. Use real source sections when present; otherwise use one section per root question when roots have subquestions or substantial shared context, and reserve neutral contiguous ranges like `Questions 1-5` for long unsectioned runs of many small standalone questions. Do not create `S1` wrappers, do not group multiple multi-part roots into one numeric-range section, do not put a whole long paper into one giant section, and do not invent difficulty labels.",
    "- Do not render cover-page or administration boilerplate as visible worksheet content unless it is needed for a question. Omit invigilator/pencil/venue/event boilerplate from the visible sheet; keep only relevant scoring rules/provenance in references.",
    "- Convert textual or numeric source tables into Markdown tables. If a table appears inside a figure area, transcribe the table as Markdown when possible and include a crop only for the surrounding visual context that cannot be represented as text.",
    "- Place each figure/table at the nearest source-faithful level: in the parent `group.prompt` only when shared by all subparts or located before the first subpart, or in the specific child prompt when only that subquestion uses it.",
    "- Keep labels attached to their own artifacts: put `Figure N` caption text immediately adjacent to the `Figure N` crop, and put `Table N` caption text immediately adjacent to the `Table N` Markdown table. Do not place a table between a figure caption and the figure image. Do not repeat the same figure/table image in later subquestions; render it once at the first source-faithful location, then refer to it with an anchor link such as `[Figure N](#figure-n)` / `[Table N](#table-n)` or with `Figure N above` / `Table N above` when the artifact is directly above.",
    "- Before publishing, compare named references in `grader/output/transcription.md` with the worksheet JSON: every included `Figure N` should have a linked crop near that label, and every extracted text/numeric `Table N` should have a Markdown table near that label.",
    "- When a figure/photo/diagram matters, crop it into `grader/output/assets/...` and reference the final worksheet crop from worksheet Markdown with a workspace-relative clickable `.jpg` image link such as `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)`. `publish_sheet` normalizes linked worksheet crops to JPEG with max 512 px on either axis.",
    "- References/transcription are audit trails only. If a visible prompt mentions a diagram, figure, graph, chart, map, network, photo, or other answer-critical visual, show the linked crop in that same prompt/group prompt instead of saying it is available in source references.",
    "- For objective questions whose answer choices are diagrams, treat the option image as high-risk: either crop one complete options block or separate complete option crops, but every candidate label and every option diagram/shape must be fully visible. Do not publish crops where a candidate option is cut off at the crop edge or where the crop includes clipped neighbouring prompt text that should instead be transcribed.",
    "- Never validate option-diagram crops as top/bottom portions, used-together fragments, or other partial crops. A final option crop must contain whole candidate labels and whole candidate diagrams.",
    "- Crop from the highest-resolution page image available, then inspect the crop at highest/original detail when available. Use `draw_grid_overlay` for coarse bounds, `crop_image` from the original page image, `trim_image` only for safe whitespace tightening, and a final `view_image` check before publishing. Crop the visual artifact itself, exclude duplicated caption/question text from the crop, and transcribe duplicated printed captions/question text into Markdown instead of leaving that text inside the image. Leave a small clean margin around all required ink; do not let labels, lines, axes, table borders, or option text touch the image edge.",
    '- For figure isolation/refinement, use a rectangular crop workflow: do not do mask segmentation; produce one clean rectangular crop per target figure. Start from a previous bad crop if it contains the whole figure, otherwise use the full source page; inspect both the selected base image and its coordinate-grid overlay with `view_image`; choose one pixel bbox in that base image\'s coordinate space; prefer a small safe white margin over clipping; reject crops that include surrounding question text, mark text, answer lines, page borders, next-question content, or standalone Figure/Table captions already rendered by the worksheet. When documenting a crop-refinement decision, use JSON shape `{ "cropBase": "badCrop" | "fullPage", "bbox": { "left": number, "top": number, "right": number, "bottom": number }, "reasoning": "brief edge-by-edge explanation", "risks": [] }`, with origin at top-left and right/bottom exclusive. Apply the box with `crop_image` using `bboxPixels` on the selected base image.',
    "- When crop bounds are uncertain, use `propose_crop_bbox_with_fresh_agent` with the poor crop/full page/grid overlay paths so a fresh visual agent follows the rectangular JSON workflow and returns one bbox. You may also use `extract_pdf_diagrams` as a Gemini-assisted coarse bounding-box proposal or cross-check. Treat model-suggested boxes as proposals only; expand/refine them when labels, axes, legends, options, or table cells are near an edge. If one manual crop-and-view correction for the same target is still clipped/noisy/uncertain, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` before spending more turns on hand-tuned crop boxes.",
    "- Use `pad_image` only for a crop that has already passed fresh visual validation and only needs a clean white border after publish validation says dark content touches an edge. Never use `pad_image` to fix a crop-review failure, missing content, clipping, unrelated text, or a duplicated standalone caption; recrop from the high-resolution source page and validate again.",
    "- Use at most six `crop_image` attempts for any one output asset before switching strategy. After that, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` for the source page/target label if you have not already used them. Do not publish a crop-validation report that records unresolved failures.",
    "- Final figure crops must show the complete intended visual, not a mid-diagram fragment and not a different neighbouring figure. If a crop starts inside a diagram, cuts off vertices/labels/axes/table borders/options, or includes a separate neighbouring diagram that would confuse the question, recrop from the high-resolution page image with wider bounds and recheck.",
    "- If `view_image` fails on any workspace image or rendered PDF page because file upload/canonical-file configuration is unavailable, do not ignore the image. Use `crop_image` to create a local PNG overview or relevant crop under `grader/output/assets/...`, then inspect that generated image with `view_image` before grading or publishing. Do not switch to `extract_pdf_diagrams` as a fallback for `view_image` failures.",
    "- Important crops need a fresh-context validation pass when clipping would affect the answer: call `validate_crop_with_fresh_agent` once per final figure/image crop with the question context; the fresh reviewer must use `view_image`, transcribe all visible text in the crop, and confirm that every label, axis, table cell, option, and annotation needed by the question is visible, unrelated visible text/non-target ink is absent, and no required content touches or is clipped by an edge. Slight extra whitespace is acceptable; clipped content is not.",
    "- If there are many final linked crops, do not serially open every final crop in the main agent. Spot-check representative crops if useful, but the final crop-validation pass must still use one `validate_crop_with_fresh_agent` call per final figure/image crop so every crop is reviewed independently.",
    "- Do not publish known-failed crop validation. For uncertain crops, or after any `validate_crop_with_fresh_agent` result reports `pass/fail: fail` or a blocking issue, stop hand-guessing coordinates and use the bad-crop/full-page/grid workflow through `propose_crop_bbox_with_fresh_agent`; apply the returned rectangle with `crop_image`, then validate again with `validate_crop_with_fresh_agent`.",
    "- If an image tool reports that the pre-publish image-edit budget was exceeded, immediately stop guessing crop boxes for that output. Use existing validated crops only; do not work around the budget by linking full-page/page fallback images, publishing a crop-validation file with unresolved failures, or relabelling failed/noisy crop validation as passing.",
    "- If `validate_crop_with_fresh_agent` reports clipped content, a missing required label/axis/option/table cell, wrong question association, a broad full-page fallback, noisy neighbouring content, or any medium/high severity crop issue, fix the crop and re-run the visual check before publishing. If it says content is clipped, expand in the clipped direction first instead of trimming tighter. A validation note that lists unresolved problems is not sufficient.",
    "- If you use `crop_image` or `trim_image` on a linked worksheet asset after writing `grader/output/crop-validation.md`, the validation is stale: rerun the fresh-context crop check for the final asset and rewrite `crop-validation.md` before publishing. `pad_image` is allowed only after a completed passing validation because it only adds a white border.",
    "- Record crop validation in `grader/output/crop-validation.md`: list each final linked crop path, the source question/figure/table label, `fresh-context subagent checked: yes` for that crop, the reviewer-visible text transcribed from the crop, exact `pass/fail: pass|fail`, whether all question-relevant content is visible, whether duplicated caption/question/table text was excluded unless it is part of a visual label/axis/legend, whether unrelated visible text or non-target ink is present, whether edge clipping/content touching an edge is present, and whether page borders/separator lines/answer lines/neighbouring-question fragments are present. Use the `reviewMarkdown` returned by `validate_crop_with_fresh_agent` as the basis for these records. Do not publish linked crop assets without this per-image validation record.",
    "- Preserve student variable names, formulas, terminology, and method choices as closely as possible; allow only numbering, line-break cleanup, and obvious spelling fixes that do not change meaning.",
    "- Final grading feedback must be emitted as per-question worksheet scores plus worksheet-level reference markdown. Use per-question review notes for unresolved/incorrect work; correct/resolved questions may use an empty `note` because completed feedback cards are hidden in the student UI.",
    '- Every `review.questions[questionId]` entry must include `score: { got, total }`, where `total` matches that question\'s marks, except source-paper-only/no-student runs with `review.mode: "awaiting_answers"`; those should omit per-question scores entirely.',
    "- `review.message` should be a short learning summary, not just a duplicate of the numeric score; the UI already renders `score.got / score.total` separately.",
    "- Worksheet review notes should be empathetic and specific for unresolved/incorrect work: acknowledge what makes sense in a near-miss or almost-correct structure before naming the gap. Correct/resolved questions may use an empty `note`.",
    "- Review notes are first tutor messages, not answer-key reveals. Prefer a next-step cue, contrast, or rule of thumb before giving the answer outright, and do not accept loose synonyms when the task asked for a definition/explanation.",
    "- Do not compress the mark scheme into unresolved feedback by naming the missing final concept, mechanism, data comparison, or answer path. Prefer a question or source-navigation cue such as `Which feature in the figure changed?` over `Link the larger muscles to stronger contractions`, and `What trend do the two sources show?` over `Compare how much blue and green light chlorophyll absorbs`.",
    "- When official references are allowed, use official answer keys, mark schemes, or official solutions for identified public papers before deriving answers yourself.",
    "- When official references are unavailable or online lookup is disallowed, derived solutions should stay at the student's level and reuse their terminology/method style where reasonable.",
    "- Use only supported worksheet question types: group, answer_bank, fill, cloze, mcq, lines, calc, match, spelling, flow. Use `lines` only when the source genuinely requires a free-response area that does not fit the richer structured types.",
    '- Follow exact structured schemas before publishing: `calc` requires `inputLabel` and `unit`; `lines` requires `lines`; `mcq` in `labels_only` mode requires per-option `label`; label-only diagram MCQs may omit option text but must not invent placeholders like `Option A`; section hook blocks must be `{ type: "hook", text: "..." }`.',
    "- Do not duplicate MCQ choice labels in the prompt when choices are already represented by `options[]`: remove bare `(A)`, `(B)`, `(C)`, `(D)` lines from prompt text unless each line includes source option content that is not otherwise represented.",
    "- Keep worksheet metadata natural and non-redundant: `sheet.subject`, `sheet.level`, `sheet.title`, `sheet.subtitle`, `presentation.title`, `presentation.subtitle`, and `presentation.footer` are rendered together, so do not repeat the same paper name, level word, subject word, or phrase across them. `sheet.level` must be a compact tier/level only, not the full paper or competition title. Avoid suffixes like `question paper` in `sheet.title` when the subtitle/provenance already makes the source type clear.",
    "- `presentation.footer` must be source/provenance identity only, not a process label. Do not write `Question paper transcription`, `transcription`, `OCR`, `artifact`, or similar wording. For identified public papers, prefer concise mechanical identifiers such as exam board/qualification, paper code/name, tier, and year/session (for example `AQA GCSE Biology · 8461/1H Paper 1 Higher Tier · 2023`).",
    "- Omit optional URL fields such as `references.paperUrl` or `references.markSchemeUrl` when no real URL is known; never set optional URLs to empty strings.",
    "",
    "Run-mode constraints for grader runs:",
    "- Keep transcription and source gathering on the main agent only.",
    "- Generic `spawn_agent` is not available in grader runs. Keep short routine worksheet questions in the main agent, use `propose_crop_bbox_with_fresh_agent` for uncertain crop bbox planning, and use the dedicated `validate_crop_with_fresh_agent` tool for final crop validation.",
    "- For crop validation, pass the final crop path and question context to `validate_crop_with_fresh_agent`; ask only whether required labels/options/table cells/annotations are present and whether the crop includes excessive unrelated material.",
    "- For text-selectable PDFs, run `extract_pdf_reference_text` once as a navigation/transcription aid before bulk page inspection; still use rendered page images as source of truth for figures, labels, tables, and layout.",
    "- Keep the main context small on long papers: use the extracted reference text plus page overviews to draft text, then send each final linked figure/image crop to `validate_crop_with_fresh_agent` instead of opening every high-resolution crop in the main agent.",
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
