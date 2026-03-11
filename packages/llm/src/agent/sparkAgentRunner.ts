import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import type { PyodideInterface } from "pyodide";
import { z } from "zod";
import {
  createFilesystemToolSetForModel,
  estimateCallCostUsd,
  generateText,
  getCurrentToolCallContext,
  isLlmTextModelId,
  parseJsonFromLlmText,
  runAgentLoop,
  tool,
  type LlmContentPart,
  type LlmInputMessage,
  type LlmStreamEvent,
  type LlmTextModelId,
  type LlmTextResult,
  type LlmThinkingLevel,
  type LlmToolConfig,
  type LlmToolLoopResult,
  type LlmToolSet,
  type LlmUsageTokens,
} from "@ljoukov/llm";
import {
  CodeProblemSchema,
  QuizDefinitionSchema,
  SessionSchema,
  SessionMediaDocSchema,
  SparkAgentStateTimelineSchema,
  SparkTutorComposerStateSchema,
  SparkTutorHistoryEntrySchema,
  SparkTutorScreenStateSchema,
  SparkAgentWorkspaceFileSchema,
  type CodeProblem,
  type QuizDefinition,
  type Session,
  type SessionMediaDoc,
  type SparkAgentStateTimeline,
  type SparkTutorComposerState,
} from "@spark/schemas";

import { errorAsString } from "../utils/error";
import { loadEnvFromFile, loadLocalEnv } from "../utils/env";
import { formatByteSize, formatMillis } from "../utils/format";
import {
  deleteFirestoreDocument,
  getFirestoreDocument,
  listFirestoreDocuments,
  patchFirestoreDocument,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import { parseGoogleServiceAccountJson } from "../utils/gcp/googleAccessToken";
import {
  downloadStorageObject,
  uploadStorageObject,
} from "../utils/gcp/storageRest";
import {
  applyPdfTranscriptionSkillTools,
  PDF_TRANSCRIPTION_SKILL_TEXT,
} from "./skills/pdfTranscription";
import {
  SparkGraderRequestPayloadSchema,
  resolveSparkGraderModelTools,
} from "./sparkChatShared";
import { captureSparkAgentReplayState } from "./sparkAgentReplayArtifacts";
import {
  buildWorkspaceFileDocPath,
  buildWorkspaceFilesCollectionPath,
  normalizeStorageObjectName,
  persistWorkspaceFileFromLocalFs,
  resolveWorkspaceFilePathFromFirestoreDocument,
  resolveWorkspacePathContentType,
} from "./workspaceFileStore";
import {
  encodeBgraBitmapToPng,
  getPdfPageCount,
  renderPdfPagesBgra,
} from "../utils/pdfium";
import { getSharp } from "../utils/sharp";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  LlmUsageTokenUpdate,
  ModelCallHandle,
  StageHandle,
} from "../utils/concurrency";

const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.4";

type LlmDebugOptions = {
  readonly rootDir: string;
  readonly stage?: string;
  readonly subStage?: string;
  readonly enabled?: boolean;
};
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_LESSON_MAX_STEPS = 1000;
const DEFAULT_PDF_EXTRACTION_MODEL_ID: LlmTextModelId = "gemini-2.5-pro";
const DEFAULT_EXTRACT_TEXT_MODEL_ID: LlmTextModelId = "gemini-flash-latest";
const SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;
const SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPE_SET = new Set<string>(
  SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES,
);

type TrackedSubmodelCallSummary = {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly elapsedMs: number;
  readonly usageTokens: LlmUsageTokenUpdate | null;
  readonly costUsd: number | null;
};
const DEFAULT_GENERATE_TEXT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.4";
const WORKSPACE_UPDATE_THROTTLE_MS = 10_000;
const AGENT_LOG_THROTTLE_MS = 2_000;
const AGENT_TOOL_LOG_SNIPPET_MAX_BYTES = 4 * 1024;
const AGENT_TOOL_LOG_SNIPPET_MAX_CHARS = 1_000;
const STOP_POLL_INTERVAL_MS = 10_000;
const AGENT_INLINE_ATTACHMENTS_MAX_COUNT = 24;
const AGENT_INLINE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_DOWNLOAD_CONCURRENCY = 6;
const WEB_FETCH_TIMEOUT_MS = 20_000;
const WEB_FETCH_MAX_BYTES = 6 * 1024 * 1024;
const WEB_FETCH_DEFAULT_MAX_CHARS = 20_000;
const PDF_EXTRACTION_MAX_BYTES = 16 * 1024 * 1024;
const PDF_EXTRACTION_DEFAULT_MAX_CHARS = 200_000;
const EXTRACT_TEXT_MAX_BYTES = 16 * 1024 * 1024;
const EXTRACT_TEXT_DEFAULT_MAX_CHARS = 200_000;
const EXTRACT_TEXT_MAX_DOCUMENT_FILES = 12;
const EXTRACT_TEXT_MAX_CONTEXT_FILES = 8;
const EXTRACT_TEXT_CONTEXT_TEXT_MAX_CHARS = 20_000;
const EXTRACT_TEXT_RESPONSE_STREAM_LOG_THROTTLE_MS = 5_000;
const EXTRACT_TEXT_DEFAULT_SUPPORTING_PROMPT =
  "Supporting documents are for ambiguity resolution only; do not transcribe them unless explicitly instructed.";
const PDF_DIAGRAM_DEFAULT_MAX_ITEMS = 32;
const PDF_DIAGRAM_MAX_ITEMS = 64;
const TUTOR_CONTEXT_PROBLEM_PATH = "context/problem.md";
const TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH = "context/official-solution.md";
const TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH = "context/student-transcript.md";
const TUTOR_CONTEXT_GRADING_PATH = "context/grading.md";
const TUTOR_CONTEXT_ANNOTATIONS_PATH = "context/annotations.md";
const TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH = "context/overall-feedback.md";
const TUTOR_UI_TOP_PANEL_PATH = "ui/tutor.md";
const TUTOR_UI_INLINE_FEEDBACK_PATH = "ui/inline-feedback.md";
const TUTOR_STATE_SESSION_PATH = "state/session.json";
const TUTOR_STATE_COMPOSER_PATH = "state/composer.json";
const TUTOR_HISTORY_TURNS_PATH = "history/turns.jsonl";

async function loadSparkGraderRequestPayloadFromWorkspace(rootDir: string) {
  const requestPath = path.join(rootDir, "request.json");
  try {
    const raw = await readFile(requestPath, { encoding: "utf8" });
    return SparkGraderRequestPayloadSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function formatUsdTotal(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `$${safeValue.toFixed(4)}`;
}

type ToolLlmCostName =
  | "generate_text"
  | "generate_json"
  | "extract_text"
  | "extract_pdf_text"
  | "read_pdf"
  | "extract_pdf_diagrams";

function serializeTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (typeof serialized === "string") {
      return serialized;
    }
    return String(value);
  } catch (error) {
    return `<<unserializable trace payload: ${errorAsString(error)}>>`;
  }
}

function redactDataUrlPayload(value: string): string {
  if (!value.startsWith("data:")) {
    return value;
  }
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) {
    return value;
  }
  const prefix = value.slice(0, commaIndex + 1);
  if (value === `${prefix}...`) {
    return value;
  }
  return `${prefix}...`;
}

function sanitizeViewImageTraceOutput(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  let changed = false;
  const sanitizedParts: unknown[] = [];
  for (const part of value) {
    if (
      part !== null &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      "image_url" in part
    ) {
      const partRecord = part as Record<string, unknown>;
      const imageUrl = partRecord.image_url;
      if (typeof imageUrl === "string") {
        const redactedImageUrl = redactDataUrlPayload(imageUrl);
        if (redactedImageUrl !== imageUrl) {
          changed = true;
          sanitizedParts.push({
            ...partRecord,
            image_url: redactedImageUrl,
          });
          continue;
        }
      }
    }
    sanitizedParts.push(part);
  }
  if (!changed) {
    return value;
  }
  return sanitizedParts;
}

function sanitizeToolTraceValue(options: {
  toolName: string;
  direction: "input" | "output";
  value: unknown;
}): unknown {
  if (options.toolName === "view_image" && options.direction === "output") {
    return sanitizeViewImageTraceOutput(options.value);
  }
  return options.value;
}

function formatToolLogSnippet(value: unknown): string {
  const capped = capUtf8Text(
    serializeTraceValue(value),
    AGENT_TOOL_LOG_SNIPPET_MAX_BYTES,
  );
  const compact = capped.replace(/\s+/gu, " ").trim();
  if (compact.length === 0) {
    return "<empty>";
  }
  if (compact.length <= AGENT_TOOL_LOG_SNIPPET_MAX_CHARS) {
    return compact;
  }
  return `${compact.slice(0, AGENT_TOOL_LOG_SNIPPET_MAX_CHARS)}…`;
}

async function persistToolLoopTrace(options: {
  serviceAccountJson: string;
  userId: string;
  agentId: string;
  toolLoopResult: LlmToolLoopResult;
  consolePrefix: string;
}): Promise<{ stepCount: number; toolCallCount: number }> {
  const logDocPath = `users/${options.userId}/agents/${options.agentId}/logs/log`;
  const now = new Date();
  let toolCallCount = 0;

  for (const step of options.toolLoopResult.steps) {
    const stepDocPath = `${logDocPath}/toolTraceSteps/s${String(step.step).padStart(6, "0")}`;
    const stepText = typeof step.text === "string" ? step.text : "";
    const toolCalls = step.toolCalls;
    toolCallCount += toolCalls.length;

    await setFirestoreDocument({
      serviceAccountJson: options.serviceAccountJson,
      documentPath: stepDocPath,
      data: {
        step: step.step,
        modelId: step.modelVersion,
        text: stepText,
        toolCallCount: toolCalls.length,
        createdAt: now,
        updatedAt: now,
      },
    });

    for (const [toolIndex, toolCall] of toolCalls.entries()) {
      const callIndex = toolIndex + 1;
      const input = serializeTraceValue(
        sanitizeToolTraceValue({
          toolName: toolCall.toolName,
          direction: "input",
          value: toolCall.input,
        }),
      );
      const output = serializeTraceValue(
        sanitizeToolTraceValue({
          toolName: toolCall.toolName,
          direction: "output",
          value: toolCall.output,
        }),
      );
      const callId =
        typeof toolCall.callId === "string" && toolCall.callId.trim().length > 0
          ? toolCall.callId
          : undefined;
      const error =
        typeof toolCall.error === "string" && toolCall.error.trim().length > 0
          ? toolCall.error
          : undefined;

      await setFirestoreDocument({
        serviceAccountJson: options.serviceAccountJson,
        documentPath: `${stepDocPath}/toolCalls/c${String(callIndex).padStart(6, "0")}`,
        data: {
          step: step.step,
          toolIndex: callIndex,
          toolName: toolCall.toolName,
          ...(callId ? { callId } : {}),
          ...(error ? { error } : {}),
          input,
          output,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }

  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: logDocPath,
    updates: {
      "trace.updatedAt": now,
      "trace.stepCount": options.toolLoopResult.steps.length,
      "trace.toolCallCount": toolCallCount,
    },
  });

  return {
    stepCount: options.toolLoopResult.steps.length,
    toolCallCount,
  };
}

type MutableGlobal = Omit<typeof globalThis, "location" | "self"> & {
  location?: { href: string };
  self?: typeof globalThis;
};

let cachedLocalPyodideIndexUrl: string | null | undefined;

function getLocalPyodideIndexUrl(): string | null {
  if (cachedLocalPyodideIndexUrl !== undefined) {
    return cachedLocalPyodideIndexUrl;
  }
  try {
    const moduleUrl = import.meta.url;
    if (!moduleUrl) {
      cachedLocalPyodideIndexUrl = null;
      return cachedLocalPyodideIndexUrl;
    }
    const require = createRequire(moduleUrl);
    const packageJsonPath = require.resolve("pyodide/package.json");
    const baseDir = path.dirname(packageJsonPath);
    cachedLocalPyodideIndexUrl = path.join(baseDir, path.sep);
    return cachedLocalPyodideIndexUrl;
  } catch {
    cachedLocalPyodideIndexUrl = null;
    return cachedLocalPyodideIndexUrl;
  }
}

function resolvePyodideIndexUrl(explicit?: string): string {
  const fromEnv =
    process.env.PYODIDE_INDEX_URL ??
    process.env.PYODIDE_BASE_URL ??
    process.env.PYTHON_RUNTIME_INDEX_URL;
  const raw = explicit?.trim() ?? fromEnv?.trim() ?? "";
  const normalise = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    // Pyodide's Node loader resolves indexURL as a filesystem path (path.resolve),
    // which breaks http(s) URLs (e.g. "https://..." becomes "https:/...") and then
    // attempts to read them via fs. For server-side agent runs, prefer the local
    // indexURL shipped with the `pyodide` npm package.
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return null;
    }

    if (trimmed.startsWith("file://")) {
      try {
        const resolved = fileURLToPath(trimmed);
        return resolved.endsWith(path.sep)
          ? resolved
          : `${resolved}${path.sep}`;
      } catch {
        return null;
      }
    }

    if (trimmed.endsWith(path.sep)) {
      return trimmed;
    }
    return `${trimmed}${path.sep}`;
  };

  const localIndexUrl = getLocalPyodideIndexUrl();
  if (!raw) {
    if (localIndexUrl) {
      return localIndexUrl;
    }
    throw new Error(
      "Pyodide local runtime is unavailable in this environment. Set PYODIDE_INDEX_URL to a local filesystem path before using python_exec.",
    );
  }

  return normalise(raw) ?? localIndexUrl ?? raw;
}

function ensurePyodideEnvironment(indexURL: string): void {
  const globalObject = globalThis as MutableGlobal;
  if (!globalObject.location) {
    globalObject.location = { href: indexURL };
  } else if (!globalObject.location.href) {
    globalObject.location.href = indexURL;
  }
  if (!globalObject.self) {
    globalObject.self = globalThis;
  }
}

let pythonRuntimePromise: Promise<PyodideInterface> | null = null;

async function ensurePythonRuntime(
  indexURL?: string,
): Promise<PyodideInterface> {
  if (!pythonRuntimePromise) {
    pythonRuntimePromise = (async (): Promise<PyodideInterface> => {
      const pyodideModule = (await import(
        /* @vite-ignore */ "pyodide"
      )) as typeof import("pyodide");
      const resolvedIndex = resolvePyodideIndexUrl(indexURL);
      ensurePyodideEnvironment(resolvedIndex);
      return await pyodideModule.loadPyodide({ indexURL: resolvedIndex });
    })();
  }
  return pythonRuntimePromise;
}

async function expandPromptTemplate(options: {
  template: string;
  rootDir: string;
}): Promise<{
  text: string;
  replacements: Array<{ path: string; chars: number }>;
}> {
  const { template, rootDir } = options;
  const regex = /{{\s*([^}]+?)\s*}}/g;
  let result = "";
  let lastIndex = 0;
  const replacements: Array<{ path: string; chars: number }> = [];
  const cache = new Map<string, string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(template)) !== null) {
    const token = match[1]?.trim() ?? "";
    result += template.slice(lastIndex, match.index);
    lastIndex = regex.lastIndex;
    if (!token) {
      result += match[0];
      continue;
    }

    let content = cache.get(token);
    if (content === undefined) {
      try {
        const resolved = resolveWorkspacePath(rootDir, token);
        content = await readFile(resolved, { encoding: "utf8" });
      } catch (error) {
        throw new Error(
          `Failed to expand {{${token}}}: ${errorAsString(error)}`,
        );
      }
      cache.set(token, content);
    }

    replacements.push({ path: token, chars: content.length });
    result += content;
  }

  result += template.slice(lastIndex);
  return { text: result, replacements };
}

type AgentStatus = "created" | "executing" | "stopped" | "failed" | "done";

class StopRequestedError extends Error {
  constructor() {
    super("Agent stop requested.");
    this.name = "StopRequestedError";
  }
}

type WorkspaceFileMeta = {
  createdAt?: Date;
  updatedAt?: Date;
  lastWriteAt: number;
  pending: boolean;
  timer?: NodeJS.Timeout;
  inFlight?: Promise<void>;
  disposed?: boolean;
};

type WorkspaceSyncOptions = {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  bucketName: string;
  rootDir: string;
};

export type SparkAgentWorkspace = {
  scheduleUpdate: (path: string) => void;
  deleteFile: (path: string) => Promise<void>;
  moveFile: (from: string, to: string) => Promise<void>;
};

type AgentRunStatsSnapshot = {
  readonly modelCalls: number;
  readonly modelsUsed: readonly string[];
  readonly tokens: {
    readonly promptTokens: number;
    readonly cachedTokens: number;
    readonly responseTokens: number;
    readonly responseImageTokens: number;
    readonly thinkingTokens: number;
    readonly totalTokens: number;
    readonly toolUsePromptTokens: number;
  };
  readonly modelCostUsd: number;
  readonly toolCalls: number;
  readonly toolCallsByName: Record<string, number>;
  readonly toolCostUsd: number;
  readonly totalCostUsd: number;
};

type AgentRunOptions = {
  userId: string;
  agentId: string;
  workspaceId: string;
  modelId?: LlmTextModelId;
  maxSteps?: number;
};

function parseOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

const AgentAttachmentInputSchema = z.object({
  id: z.preprocess(
    (value) => parseOptionalString(value),
    z.string().trim().min(1).optional(),
  ),
  storagePath: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  filename: z.preprocess(
    (value) => parseOptionalString(value),
    z.string().trim().min(1).optional(),
  ),
  sizeBytes: z.number().int().min(1),
  pageCount: z.preprocess(
    (value) => parseOptionalPositiveInt(value),
    z.number().int().min(1).optional(),
  ),
});

type AgentAttachmentInput = z.infer<typeof AgentAttachmentInputSchema>;

const GraderSummaryProblemSchema = z.object({
  id: z.string().trim().min(1),
  index: z.number().int().min(1),
  title: z.string().trim().min(1).optional(),
  awardedMarks: z.number().min(0).optional(),
  maxMarks: z.number().min(0).optional(),
  verdict: z.enum(["correct", "partial", "incorrect", "ungraded"]).optional(),
  filePath: z.string().trim().min(1),
});

const GraderRunPresentationSchema = z.object({
  title: z.string().trim().min(1).optional(),
  summaryMarkdown: z.string().trim().min(1).optional(),
});

const GraderRunSummarySchema = z
  .object({
    contextLabel: z.string().trim().min(1).optional(),
    olympiad: z.string().trim().min(1).optional(),
    year: z.string().trim().min(1).optional(),
    paperName: z.string().trim().min(1).optional(),
    paperUrl: z.string().trim().min(1).optional(),
    markSchemeUrl: z.string().trim().min(1).optional(),
    presentation: GraderRunPresentationSchema.optional(),
    totals: z
      .object({
        awardedMarks: z.number().min(0),
        maxMarks: z.number().min(0),
      })
      .optional(),
    problems: z.array(GraderSummaryProblemSchema).min(1),
  })
  .transform(({ contextLabel, olympiad, ...rest }) => ({
    ...rest,
    ...((contextLabel ?? olympiad)
      ? { contextLabel: contextLabel ?? olympiad }
      : {}),
  }));

type GraderRunSummary = z.infer<typeof GraderRunSummarySchema>;

function selectGraderResultSummary(options: {
  doneSummary?: string;
  runSummary: GraderRunSummary | null;
}): string | undefined {
  const preferred = options.runSummary?.presentation?.summaryMarkdown?.trim();
  if (preferred && preferred.length > 0) {
    return preferred;
  }
  const fallback = options.doneSummary?.trim();
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return undefined;
}

function resolveSparkRepoRoot(): string {
  const currentWorkingDirectory = path.resolve(process.cwd());
  const currentBaseName = path.basename(currentWorkingDirectory);
  if (currentBaseName === "web" || currentBaseName === "eval") {
    return path.resolve(currentWorkingDirectory, "..");
  }
  return currentWorkingDirectory;
}

function loadAgentEnv(): void {
  loadLocalEnv();
  const repoRoot = resolveSparkRepoRoot();
  loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });
}

function formatWorkspaceRunTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/gu, "-");
}

function shouldUsePersistentDevWorkspaceRoot(): boolean {
  const forced = parseOptionalString(process.env.SPARK_AGENT_LOCAL_WORKSPACE);
  if (forced) {
    const normalized = forced.toLowerCase();
    if (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    ) {
      return true;
    }
    if (
      normalized === "0" ||
      normalized === "false" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }
  }
  return process.env.NODE_ENV !== "production";
}

export function resolveSparkAgentWorkspaceRoot(options: {
  workspaceId: string;
  runStartedAt: Date;
}): { rootDir: string; cleanupOnExit: boolean } {
  if (shouldUsePersistentDevWorkspaceRoot()) {
    const configuredWorkspaceBaseDir = parseOptionalString(
      process.env.SPARK_AGENT_LOCAL_WORKSPACE_BASE_DIR,
    );
    const workspaceBaseDir =
      configuredWorkspaceBaseDir !== undefined
        ? path.resolve(process.cwd(), configuredWorkspaceBaseDir)
        : path.join(resolveSparkRepoRoot(), "data");
    const timestamp = formatWorkspaceRunTimestamp(options.runStartedAt);
    return {
      rootDir: path.join(
        workspaceBaseDir,
        "spark-agent",
        timestamp,
        options.workspaceId,
      ),
      cleanupOnExit: false,
    };
  }
  return {
    rootDir: path.join(
      os.tmpdir(),
      "spark-agent-workspaces",
      options.workspaceId,
    ),
    cleanupOnExit: true,
  };
}

export function resolveSparkAgentLogsDir(rootDir: string): string {
  return path.join(rootDir, "logs", "agent");
}

export function resolveSparkAgentToolCallsDir(rootDir: string): string {
  return path.join(resolveSparkAgentLogsDir(rootDir), "tool_calls");
}

export function resolveSparkAgentThinkingLevel(
  modelId: LlmTextModelId,
): LlmThinkingLevel | undefined {
  if (modelId.includes("gpt-5.4") || modelId.includes("gpt-5.3-codex")) {
    return "high";
  }
  if (modelId.includes("gpt-5.2")) {
    return "medium";
  }
  return undefined;
}

function resolveTextModelId(
  value: string | undefined,
  fallback: LlmTextModelId,
): LlmTextModelId {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const trimmed = value.trim();
  if (isLlmTextModelId(trimmed)) {
    return trimmed;
  }
  throw new Error(`Unsupported model id: ${value}`);
}

function resolveWorkspacePath(
  workspaceDir: string,
  targetPath: string,
): string {
  if (path.isAbsolute(targetPath)) {
    throw new Error(`Absolute paths are not allowed: "${targetPath}".`);
  }
  const rawParts = targetPath.split(/[/\\]+/);
  if (rawParts.some((part) => part === "..")) {
    throw new Error(`Path traversal ("..") is not allowed: "${targetPath}".`);
  }
  const resolved = path.resolve(workspaceDir, targetPath);
  const relative = path.relative(workspaceDir, resolved);
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  for (const part of parts) {
    if (part === "..") {
      throw new Error(`Path "${targetPath}" is outside workspace.`);
    }
  }
  if (relative.length === 0) {
    return resolved;
  }
  if (parts.length === 0) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  return resolved;
}

function isUserUploadPath(userId: string, storagePath: string): boolean {
  return storagePath.startsWith(`spark/uploads/${userId}/`);
}

type ResolvedAttachmentInput = {
  id: string;
  storagePath: string;
  contentType: string;
  filename?: string;
  sizeBytes: number;
  pageCount?: number;
};

function toResolvedAttachmentInput(
  entry: AgentAttachmentInput,
): ResolvedAttachmentInput {
  const fallbackId = `${entry.storagePath}#${entry.contentType}`;
  const attachmentId =
    typeof entry.id === "string" && entry.id.trim().length > 0
      ? entry.id.trim()
      : fallbackId;
  const filename =
    typeof entry.filename === "string" && entry.filename.trim().length > 0
      ? entry.filename.trim()
      : undefined;
  const pageCount =
    typeof entry.pageCount === "number" && entry.pageCount > 0
      ? entry.pageCount
      : undefined;
  return {
    id: attachmentId,
    storagePath: entry.storagePath,
    contentType: entry.contentType,
    ...(filename ? { filename } : {}),
    sizeBytes: entry.sizeBytes,
    ...(pageCount ? { pageCount } : {}),
  };
}

function mergeAttachmentInputs(options: {
  primary: ResolvedAttachmentInput[];
  secondary: ResolvedAttachmentInput[];
}): ResolvedAttachmentInput[] {
  const merged: ResolvedAttachmentInput[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const push = (entry: ResolvedAttachmentInput): void => {
    if (seenIds.has(entry.id) || seenPaths.has(entry.storagePath)) {
      return;
    }
    seenIds.add(entry.id);
    seenPaths.add(entry.storagePath);
    merged.push(entry);
  };
  for (const entry of options.primary) {
    push(entry);
  }
  for (const entry of options.secondary) {
    push(entry);
  }
  return merged;
}

async function mapWithConcurrency<Item, Result>(options: {
  items: Item[];
  concurrency: number;
  mapper: (item: Item, index: number) => Promise<Result>;
}): Promise<Result[]> {
  if (options.items.length === 0) {
    return [];
  }
  const requested = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency)
    : 1;
  const workerCount = Math.max(1, Math.min(options.items.length, requested));
  const results = new Array<Result>(options.items.length);
  let nextIndex = 0;
  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(
      (async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= options.items.length) {
            return;
          }
          results[currentIndex] = await options.mapper(
            options.items[currentIndex] as Item,
            currentIndex,
          );
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

function resolveAttachmentLabel(attachment: ResolvedAttachmentInput): string {
  const filename =
    typeof attachment.filename === "string" ? attachment.filename.trim() : "";
  if (filename.length > 0) {
    return filename;
  }
  return attachment.id;
}

async function loadAttachmentParts(options: {
  serviceAccountJson: string;
  bucketName: string;
  userId: string;
  attachments: ResolvedAttachmentInput[];
  log?: (line: string) => void;
}): Promise<{ parts: LlmContentPart[]; notes: string[] }> {
  type AttachmentLoadResult = {
    part?: LlmContentPart;
    note?: string;
    logLine?: string;
  };

  const parts: LlmContentPart[] = [];
  const notes: string[] = [];
  const selectedAttachments = options.attachments.slice(
    0,
    AGENT_INLINE_ATTACHMENTS_MAX_COUNT,
  );
  const outcomes = await mapWithConcurrency({
    items: selectedAttachments,
    concurrency: ATTACHMENT_DOWNLOAD_CONCURRENCY,
    mapper: async (
      attachment,
      attachmentIndex,
    ): Promise<AttachmentLoadResult> => {
      const index = attachmentIndex + 1;
      const label = resolveAttachmentLabel(attachment);
      if (!isUserUploadPath(options.userId, attachment.storagePath)) {
        const note = `[${index.toString()}] skipped ${label}: disallowed storage path`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      let downloaded:
        | {
            bytes: Uint8Array;
            contentType: string | null;
          }
        | undefined;
      try {
        downloaded = await downloadStorageObject({
          serviceAccountJson: options.serviceAccountJson,
          bucketName: options.bucketName,
          objectName: attachment.storagePath,
        });
      } catch (error) {
        const note = `[${index.toString()}] skipped ${label}: download failed (${errorAsString(error)})`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      const bytes = downloaded.bytes;
      if (bytes.length <= 0) {
        const note = `[${index.toString()}] skipped ${label}: file is empty`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      if (bytes.length > AGENT_INLINE_ATTACHMENT_MAX_BYTES) {
        const note = `[${index.toString()}] skipped ${label}: file too large (${bytes.length.toString()} bytes)`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      const mimeType =
        downloaded.contentType && downloaded.contentType.trim().length > 0
          ? downloaded.contentType
          : attachment.contentType;
      const data = Buffer.from(bytes).toString("base64");
      return {
        part: {
          type: "inlineData",
          data,
          mimeType,
        },
        logLine: `input_attachment: added ${label} mime=${mimeType} bytes=${bytes.length.toString()}`,
      };
    },
  });
  for (const outcome of outcomes) {
    if (outcome.note) {
      notes.push(outcome.note);
    }
    if (outcome.part) {
      parts.push(outcome.part);
    }
    if (outcome.logLine) {
      options.log?.(outcome.logLine);
    }
  }
  return { parts, notes };
}

function buildInitialToolLoopInput(options: {
  systemPrompt: string;
  prompt: string;
  inlineParts: LlmContentPart[];
  notes: string[];
}): LlmInputMessage[] {
  const userParts: LlmContentPart[] = [{ type: "text", text: options.prompt }];
  if (options.notes.length > 0) {
    userParts.push({
      type: "text",
      text: [
        "",
        "Attachment ingestion notes:",
        ...options.notes.map((entry) => `- ${entry}`),
      ].join("\n"),
    });
  }
  for (const part of options.inlineParts) {
    userParts.push(part);
  }
  return [
    {
      role: "system",
      content: [{ type: "text", text: options.systemPrompt }],
    },
    {
      role: "user",
      content: userParts,
    },
  ];
}

function buildSingleUserInput(
  parts: readonly LlmContentPart[],
): LlmInputMessage[] {
  return [{ role: "user", content: parts }];
}

function recordLlmTextResult(options: {
  progress?: JobProgressReporter;
  modelId: string;
  result: Pick<LlmTextResult, "modelVersion" | "usage">;
}): void {
  if (!options.progress) {
    return;
  }
  const handle = options.progress.startModelCall({
    modelId: options.modelId,
    uploadBytes: 0,
  });
  options.progress.recordModelUsage(handle, {
    modelVersion: options.result.modelVersion,
    ...(options.result.usage ? { tokens: options.result.usage } : {}),
  });
  options.progress.finishModelCall(handle);
}

function createTrackedSubmodelCallSummary(options: {
  modelId: string;
  startedAt: number;
  result: Pick<LlmTextResult, "modelVersion" | "usage" | "costUsd">;
}): TrackedSubmodelCallSummary {
  return {
    modelId: options.modelId,
    modelVersion: options.result.modelVersion,
    elapsedMs: Date.now() - options.startedAt,
    usageTokens: options.result.usage ?? null,
    costUsd: options.result.costUsd,
  };
}

function recordToolLlmCost(
  onToolLlmCost:
    | ((toolName: ToolLlmCostName, costUsd: number) => void)
    | undefined,
  toolName: ToolLlmCostName,
  costUsd: number | null,
): void {
  if (
    typeof costUsd !== "number" ||
    !Number.isFinite(costUsd) ||
    costUsd <= 0
  ) {
    return;
  }
  onToolLlmCost?.(toolName, costUsd);
}

async function readGraderRunSummaryFromWorkspace(options: {
  rootDir: string;
  summaryPath: string;
  log?: (line: string) => void;
}): Promise<GraderRunSummary | null> {
  let text = "";
  try {
    text = await readFile(
      resolveWorkspacePath(options.rootDir, options.summaryPath),
      {
        encoding: "utf8",
      },
    );
  } catch (error) {
    options.log?.(
      `warn: unable to read grader summary "${options.summaryPath}": ${errorAsString(error)}`,
    );
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    options.log?.(
      `warn: grader summary "${options.summaryPath}" is invalid JSON: ${errorAsString(error)}`,
    );
    return null;
  }
  const parsed = GraderRunSummarySchema.safeParse(parsedJson);
  if (!parsed.success) {
    options.log?.(
      `warn: grader summary "${options.summaryPath}" failed schema validation`,
    );
    return null;
  }
  return parsed.data;
}

function summariseGraderTotals(summary: GraderRunSummary): {
  awardedMarks: number;
  maxMarks: number;
  problemCount: number;
  gradedCount: number;
  percentage: number;
} {
  const awardedFromProblems = summary.problems.reduce((sum, problem) => {
    if (typeof problem.awardedMarks === "number") {
      return sum + problem.awardedMarks;
    }
    return sum;
  }, 0);
  const maxFromProblems = summary.problems.reduce((sum, problem) => {
    if (typeof problem.maxMarks === "number") {
      return sum + problem.maxMarks;
    }
    return sum;
  }, 0);
  const awardedMarks =
    typeof summary.totals?.awardedMarks === "number"
      ? summary.totals.awardedMarks
      : awardedFromProblems;
  const maxMarks =
    typeof summary.totals?.maxMarks === "number"
      ? summary.totals.maxMarks
      : maxFromProblems;
  const gradedCount = summary.problems.filter(
    (problem) =>
      typeof problem.awardedMarks === "number" &&
      typeof problem.maxMarks === "number",
  ).length;
  const percentage = maxMarks > 0 ? (awardedMarks / maxMarks) * 100 : 0;
  return {
    awardedMarks,
    maxMarks,
    problemCount: summary.problems.length,
    gradedCount,
    percentage: Number.isFinite(percentage) ? percentage : 0,
  };
}

async function patchGraderRunStatus(options: {
  serviceAccountJson: string;
  userId: string;
  runId: string;
  updates: Record<string, unknown>;
}): Promise<void> {
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: `spark/${options.userId}/graderRuns/${options.runId}`,
    updates: options.updates,
  });
}

function resolveTutorSessionDocPath(userId: string, sessionId: string): string {
  return `spark/${userId}/tutorSessions/${sessionId}`;
}

async function readWorkspaceTextFileIfExists(options: {
  rootDir: string;
  filePath: string;
}): Promise<string | null> {
  try {
    return await readFile(
      resolveWorkspacePath(options.rootDir, options.filePath),
      {
        encoding: "utf8",
      },
    );
  } catch {
    return null;
  }
}

function buildTutorComposerState(
  overrides: Partial<SparkTutorComposerState> = {},
): SparkTutorComposerState {
  return SparkTutorComposerStateSchema.parse({
    placeholder: "Write your next thought here.",
    disabled: false,
    submitLabel: "Send",
    allowConfidence: true,
    confidenceLabel: "How sure are you?",
    hintButtons: [
      {
        id: "nudge",
        label: "Need a nudge",
        kind: "hint",
        hintLevel: "nudge",
      },
      {
        id: "pointer",
        label: "Need a pointer",
        kind: "hint",
        hintLevel: "pointer",
      },
    ],
    ...overrides,
  });
}

function stringifyJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function firstNonEmptyLine(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/gu)) {
    const trimmed = line
      .replace(/^[#>*\-\d.\s]+/gu, "")
      .replace(/[*_`]/gu, "")
      .trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function formatTutorHistoryForPrompt(historyText: string | null): string {
  const trimmed = historyText?.trim();
  if (!trimmed) {
    return "No committed turns yet.";
  }
  const lines = trimmed.split(/\r?\n/gu);
  const rendered: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const entry = SparkTutorHistoryEntrySchema.parse(JSON.parse(line));
      const label =
        entry.role === "assistant"
          ? "Tutor"
          : entry.kind === "hint_request"
            ? "Student hint request"
            : "Student";
      const metaParts: string[] = [];
      if (entry.confidence) {
        metaParts.push(`confidence=${entry.confidence}`);
      }
      if (entry.hintLevel) {
        metaParts.push(`hint=${entry.hintLevel}`);
      }
      const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
      rendered.push(`${label}${meta}: ${entry.text}`);
    } catch {
      rendered.push(line);
    }
  }
  return rendered.join("\n");
}

async function writeTutorWorkspaceTextFile(options: {
  rootDir: string;
  workspaceSync: WorkspaceSync | undefined;
  filePath: string;
  content: string;
}): Promise<void> {
  const absolutePath = resolveWorkspacePath(options.rootDir, options.filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, options.content, { encoding: "utf8" });
  options.workspaceSync?.scheduleUpdate(options.filePath);
}

async function appendTutorHistoryEntryFile(options: {
  rootDir: string;
  workspaceSync: WorkspaceSync | undefined;
  entry: unknown;
}): Promise<void> {
  const parsed = SparkTutorHistoryEntrySchema.parse(options.entry);
  const existing =
    (await readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_HISTORY_TURNS_PATH,
    })) ?? "";
  const trimmed = existing.trimEnd();
  const line = JSON.stringify(parsed);
  const next = trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
  await writeTutorWorkspaceTextFile({
    rootDir: options.rootDir,
    workspaceSync: options.workspaceSync,
    filePath: TUTOR_HISTORY_TURNS_PATH,
    content: next,
  });
}

type TutorWorkspaceSnapshot = {
  problem: string;
  officialSolution: string;
  transcript: string;
  grading: string;
  annotations: string;
  overallFeedback: string;
  tutorMarkdown: string;
  historyText: string;
};

async function readTutorWorkspaceSnapshot(options: {
  rootDir: string;
}): Promise<TutorWorkspaceSnapshot> {
  const [
    problem,
    officialSolution,
    transcript,
    grading,
    annotations,
    overallFeedback,
    tutorMarkdown,
    historyText,
  ] = await Promise.all([
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_PROBLEM_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_GRADING_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_ANNOTATIONS_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_UI_TOP_PANEL_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_HISTORY_TURNS_PATH,
    }),
  ]);
  return {
    problem: problem ?? "",
    officialSolution: officialSolution ?? "",
    transcript: transcript ?? "",
    grading: grading ?? "",
    annotations: annotations ?? "",
    overallFeedback: overallFeedback ?? "",
    tutorMarkdown: tutorMarkdown ?? "",
    historyText: historyText ?? "",
  };
}

function buildTutorTurnPrompt(options: {
  sessionTitle: string;
  action: "initial" | "reply" | "hint";
  sourceLabel: string;
  snapshot: TutorWorkspaceSnapshot;
  studentText?: string;
  studentConfidence?: string;
  hintLevel?: string;
}): string {
  const actionLines = (() => {
    if (options.action === "initial") {
      return [
        "This is the first tutor turn.",
        "Open by naming one thing the student did well and one critical gap to focus on.",
      ];
    }
    if (options.action === "hint") {
      return [
        `The student explicitly requested a hint (${options.hintLevel ?? "nudge"}).`,
        "Give only the requested level of help and keep the student doing the work.",
      ];
    }
    return [
      `Latest student reply: ${options.studentText ?? ""}`,
      options.studentConfidence
        ? `Student confidence: ${options.studentConfidence}`
        : "Student confidence: not provided",
    ];
  })();

  return [
    `Session: ${options.sessionTitle}`,
    `Source: ${options.sourceLabel}`,
    `Turn action: ${options.action}`,
    ...actionLines,
    "",
    "Current tutor panel:",
    options.snapshot.tutorMarkdown || "(empty)",
    "",
    "Problem:",
    options.snapshot.problem || "(missing)",
    "",
    "Official solution baseline:",
    options.snapshot.officialSolution || "(missing)",
    "",
    "Original student transcript:",
    options.snapshot.transcript || "(missing)",
    "",
    "Grading summary:",
    options.snapshot.grading || "(missing)",
    "",
    "Annotation and feedback:",
    options.snapshot.annotations || "(missing)",
    "",
    "Overall feedback:",
    options.snapshot.overallFeedback || "(missing)",
    "",
    "Committed session history:",
    formatTutorHistoryForPrompt(options.snapshot.historyText),
  ].join("\n");
}

function decodeHtmlToText(input: string): string {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(
        `Response too large (${contentLength.toString()} bytes); limit is ${maxBytes.toString()} bytes.`,
      );
    }
  }

  const body = response.body;
  if (!body) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(
        `Response exceeded ${maxBytes.toString()} bytes while downloading.`,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function resolveFirestoreDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") {
    return undefined;
  }
  const resolved = (toDate as (this: unknown) => unknown).call(value);
  if (resolved instanceof Date) {
    return resolved;
  }
  return undefined;
}

function resolveContentType(filePath: string): string | undefined {
  return resolveWorkspacePathContentType(filePath);
}

function clampToUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toCropPixelsFromNorm(options: {
  width: number;
  height: number;
  left: number;
  top: number;
  widthNorm: number;
  heightNorm: number;
}): { left: number; top: number; right: number; bottom: number } {
  const leftNorm = clampToUnit(options.left);
  const topNorm = clampToUnit(options.top);
  const rightNorm = clampToUnit(options.left + options.widthNorm);
  const bottomNorm = clampToUnit(options.top + options.heightNorm);
  const left = Math.max(
    0,
    Math.min(options.width - 1, Math.floor(leftNorm * options.width)),
  );
  const top = Math.max(
    0,
    Math.min(options.height - 1, Math.floor(topNorm * options.height)),
  );
  const right = Math.max(
    left + 1,
    Math.min(options.width, Math.ceil(rightNorm * options.width)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(options.height, Math.ceil(bottomNorm * options.height)),
  );
  return { left, top, right, bottom };
}

function toCropPixelsFrom1000(options: {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): { left: number; top: number; right: number; bottom: number } {
  const normalized = {
    left: clampToUnit(options.left / 1000),
    top: clampToUnit(options.top / 1000),
    right: clampToUnit(options.right / 1000),
    bottom: clampToUnit(options.bottom / 1000),
  };
  const left = Math.max(
    0,
    Math.min(options.width - 1, Math.floor(normalized.left * options.width)),
  );
  const top = Math.max(
    0,
    Math.min(options.height - 1, Math.floor(normalized.top * options.height)),
  );
  const right = Math.max(
    left + 1,
    Math.min(options.width, Math.ceil(normalized.right * options.width)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(options.height, Math.ceil(normalized.bottom * options.height)),
  );
  return { left, top, right, bottom };
}

function resolveImageMimeTypeFromSharpFormat(options: {
  format: string | undefined;
}): string | undefined {
  if (
    typeof options.format !== "string" ||
    options.format.trim().length === 0
  ) {
    return undefined;
  }
  const normalized = options.format.trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") {
    return "image/jpeg";
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized === "heic") {
    return "image/heic";
  }
  if (normalized === "heif") {
    return "image/heif";
  }
  return undefined;
}

function isSupportedCropImageMimeType(
  contentType: string | undefined,
): boolean {
  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    return false;
  }
  const normalized = contentType.trim().toLowerCase();
  return SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPE_SET.has(normalized);
}

async function cropImageToPngBuffer(options: {
  source: Buffer;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): Promise<Buffer> {
  const cropWidth = Math.max(1, options.right - options.left);
  const cropHeight = Math.max(1, options.bottom - options.top);
  const sharp = getSharp();
  return await sharp(options.source)
    .extract({
      left: options.left,
      top: options.top,
      width: cropWidth,
      height: cropHeight,
    })
    .png()
    .toBuffer();
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function capUtf8Text(value: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return "";
  }
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  const marker = "\n\n[truncated]\n";
  const totalBytes = Buffer.byteLength(value, "utf8");
  const ratio = maxBytes / Math.max(1, totalBytes);
  let end = Math.max(0, Math.floor(value.length * ratio));
  let slice = value.slice(0, end);
  while (end > 0 && Buffer.byteLength(slice + marker, "utf8") > maxBytes) {
    end = Math.floor(end * 0.9);
    slice = value.slice(0, end);
  }
  return slice + marker;
}

type ExtractTextDebugInlineAttachment = {
  index: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  labelText: string | null;
  bytes: Buffer;
};

function resolveInlineDataExtension(mimeType: string): string {
  const normalized = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg": {
      return "jpg";
    }
    case "image/png": {
      return "png";
    }
    case "image/webp": {
      return "webp";
    }
    case "image/gif": {
      return "gif";
    }
    case "image/heic": {
      return "heic";
    }
    case "image/heif": {
      return "heif";
    }
    case "application/pdf": {
      return "pdf";
    }
    case "text/plain": {
      return "txt";
    }
    case "text/markdown": {
      return "md";
    }
    case "application/json": {
      return "json";
    }
  }
  const slashIndex = normalized.indexOf("/");
  if (slashIndex >= 0) {
    const subtype = normalized.slice(slashIndex + 1).split("+")[0] ?? "";
    const cleaned = subtype.replace(/[^a-z0-9]+/gu, "");
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return "bin";
}

function renderExtractTextPromptWithInlineData(options: {
  parts: readonly LlmContentPart[];
}): {
  promptText: string;
  inlineAttachments: ExtractTextDebugInlineAttachment[];
} {
  const sections: string[] = [];
  const inlineAttachments: ExtractTextDebugInlineAttachment[] = [];
  let lastTextLabel: string | null = null;
  for (const part of options.parts) {
    if (part.type === "text") {
      sections.push(part.text);
      const trimmed = part.text.trim();
      if (trimmed.length > 0) {
        const lines = trimmed.split("\n");
        const lastLine = lines[lines.length - 1];
        lastTextLabel = typeof lastLine === "string" ? lastLine.trim() : null;
      } else {
        lastTextLabel = null;
      }
      continue;
    }
    const mimeType =
      typeof part.mimeType === "string" && part.mimeType.trim().length > 0
        ? part.mimeType.trim().toLowerCase()
        : "application/octet-stream";
    const bytes = Buffer.from(part.data, "base64");
    const nextIndex = inlineAttachments.length + 1;
    const filename = `inline-data-${nextIndex.toString()}.${resolveInlineDataExtension(mimeType)}`;
    const labelText =
      lastTextLabel ??
      `Inline data ${nextIndex.toString()} follows as inline data.`;
    sections.push(
      [
        "----------",
        labelText,
        `file=${filename} mime=${mimeType} size=${formatByteSize(bytes.length)}`,
        "----------",
      ].join("\n"),
    );
    inlineAttachments.push({
      index: nextIndex,
      filename,
      mimeType,
      sizeBytes: bytes.length,
      labelText: lastTextLabel,
      bytes,
    });
    lastTextLabel = null;
  }
  return {
    promptText: sections.join("\n\n"),
    inlineAttachments,
  };
}

async function persistExtractTextRequestDebugArtifacts(options: {
  debugRootDir: string;
  toolIdSegment: string;
  promptText: string;
  promptChars: number;
  modelId: string;
  outputPath: string;
  documentPaths: readonly string[];
  supportingPaths: readonly string[];
  instructions?: string;
  supportingInstructions?: string;
  inlineAttachments: readonly ExtractTextDebugInlineAttachment[];
}): Promise<void> {
  const maxBytes = 900_000;
  const baseDir = path.join(
    options.debugRootDir,
    "extract_text",
    options.toolIdSegment,
  );
  await ensureDir(baseDir);
  await writeFile(
    path.join(baseDir, "prompt.txt"),
    capUtf8Text(options.promptText, maxBytes),
    {
      encoding: "utf8",
    },
  );
  for (const attachment of options.inlineAttachments) {
    await writeFile(path.join(baseDir, attachment.filename), attachment.bytes);
  }
  const requestMetadata = {
    capturedAt: new Date().toISOString(),
    modelId: options.modelId,
    outputPath: options.outputPath,
    promptChars: options.promptChars,
    documentPaths: options.documentPaths,
    supportingPaths: options.supportingPaths,
    ...(typeof options.instructions === "string" &&
    options.instructions.trim().length > 0
      ? { instructions: options.instructions }
      : {}),
    ...(typeof options.supportingInstructions === "string" &&
    options.supportingInstructions.trim().length > 0
      ? { supportingInstructions: options.supportingInstructions }
      : {}),
    inlineDataFiles: options.inlineAttachments.map((attachment) => ({
      index: attachment.index,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      labelText: attachment.labelText,
    })),
  };
  await writeFile(
    path.join(baseDir, "request.metadata.json"),
    `${JSON.stringify(requestMetadata, null, 2)}\n`,
    {
      encoding: "utf8",
    },
  );
}

async function persistExtractTextResponseDebugArtifacts(options: {
  debugRootDir: string;
  toolIdSegment: string;
  responseText: string;
  thinkingText: string;
  modelId: string;
  modelVersion?: string;
  elapsedMs?: number;
  costUsd?: number | null;
  usageTokens: unknown;
  thinkingTokens: number | null;
  streamedResponseChars: number;
  streamedResponseBytes: number;
}): Promise<void> {
  const maxBytes = 900_000;
  const baseDir = path.join(
    options.debugRootDir,
    "extract_text",
    options.toolIdSegment,
  );
  await ensureDir(baseDir);
  await writeFile(
    path.join(baseDir, "response.txt"),
    capUtf8Text(options.responseText, maxBytes),
    {
      encoding: "utf8",
    },
  );
  await writeFile(
    path.join(baseDir, "thinking.txt"),
    capUtf8Text(options.thinkingText, maxBytes),
    {
      encoding: "utf8",
    },
  );
  const responseMetadata = {
    capturedAt: new Date().toISOString(),
    modelId: options.modelId,
    ...(typeof options.modelVersion === "string" &&
    options.modelVersion.trim().length > 0
      ? { modelVersion: options.modelVersion }
      : {}),
    ...(typeof options.elapsedMs === "number" &&
    Number.isFinite(options.elapsedMs)
      ? { elapsedMs: options.elapsedMs }
      : {}),
    ...(typeof options.costUsd === "number" && Number.isFinite(options.costUsd)
      ? { costUsd: options.costUsd }
      : {}),
    usageTokens: options.usageTokens,
    thinkingTokens: options.thinkingTokens,
    thinkingTextChars: options.thinkingText.length,
    responseTextChars: options.responseText.length,
    streamedResponseChars: options.streamedResponseChars,
    streamedResponseBytes: options.streamedResponseBytes,
  };
  await writeFile(
    path.join(baseDir, "response.metadata.json"),
    `${JSON.stringify(responseMetadata, null, 2)}\n`,
    {
      encoding: "utf8",
    },
  );
}

async function listFilesRecursive(options: {
  rootDir: string;
  maxDepth: number;
  subDir?: string;
}): Promise<string[]> {
  const { rootDir, maxDepth, subDir = "" } = options;
  if (maxDepth < 0) {
    return [];
  }
  const baseDir = path.join(rootDir, subDir);
  const entries = await readdir(baseDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relative = path.join(subDir, entry.name);
    if (entry.isDirectory()) {
      results.push(`${relative}/`);
      const nested = await listFilesRecursive({
        rootDir,
        maxDepth: maxDepth - 1,
        subDir: relative,
      });
      results.push(...nested);
    } else {
      results.push(relative);
    }
  }
  return results;
}

class WorkspaceSync {
  private serviceAccountJson: string;
  private userId: string;
  private workspaceId: string;
  private bucketName: string;
  private rootDir: string;
  private fileMeta = new Map<string, WorkspaceFileMeta>();
  private discoveredLinkAttachments: ResolvedAttachmentInput[] = [];

  constructor(options: WorkspaceSyncOptions) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.bucketName = options.bucketName;
    this.rootDir = options.rootDir;
  }

  private filesCollectionPath(): string {
    return buildWorkspaceFilesCollectionPath({
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  private fileDocPath(filePath: string): string {
    return buildWorkspaceFileDocPath({
      userId: this.userId,
      workspaceId: this.workspaceId,
      filePath,
    });
  }

  private ensureMeta(filePath: string): WorkspaceFileMeta {
    const existing = this.fileMeta.get(filePath);
    if (existing) {
      return existing;
    }
    const created = {
      lastWriteAt: 0,
      pending: false,
      disposed: false,
    };
    this.fileMeta.set(filePath, created);
    return created;
  }

  getDiscoveredLinkAttachments(): ResolvedAttachmentInput[] {
    return mergeAttachmentInputs({
      primary: this.discoveredLinkAttachments,
      secondary: [],
    });
  }

  private recordDiscoveredLinkAttachment(entry: ResolvedAttachmentInput): void {
    this.discoveredLinkAttachments = mergeAttachmentInputs({
      primary: this.discoveredLinkAttachments,
      secondary: [entry],
    });
  }

  private async materializeWorkspaceStorageLinkFile(options: {
    filePath: string;
    storagePath: string;
    contentType: string;
    sizeBytes?: number;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<void> {
    const objectName = normalizeStorageObjectName(options.storagePath);
    if (objectName.length === 0) {
      return;
    }
    let downloaded:
      | {
          bytes: Uint8Array;
          contentType: string | null;
        }
      | undefined;
    try {
      downloaded = await downloadStorageObject({
        serviceAccountJson: this.serviceAccountJson,
        bucketName: this.bucketName,
        objectName,
      });
    } catch (error) {
      console.warn(
        `Failed to materialize workspace storage link "${options.storagePath}" for "${options.filePath}": ${errorAsString(error)}`,
      );
      return;
    }
    const resolvedPath = resolveWorkspacePath(this.rootDir, options.filePath);
    await ensureDir(path.dirname(resolvedPath));
    await writeFile(resolvedPath, Buffer.from(downloaded.bytes));
    const normalizedPath = options.filePath.replace(/\\/gu, "/");
    const filename = path.posix.basename(normalizedPath).trim();
    const attachmentSizeBytes =
      typeof options.sizeBytes === "number" &&
      Number.isFinite(options.sizeBytes) &&
      options.sizeBytes > 0
        ? Math.floor(options.sizeBytes)
        : downloaded.bytes.byteLength;
    this.recordDiscoveredLinkAttachment({
      id: normalizedPath,
      storagePath: options.storagePath,
      contentType: options.contentType,
      ...(filename.length > 0 ? { filename } : {}),
      sizeBytes: Math.max(1, attachmentSizeBytes),
    });
    const meta = this.ensureMeta(options.filePath);
    meta.createdAt = options.createdAt ?? meta.createdAt;
    meta.updatedAt = options.updatedAt ?? meta.updatedAt;
    meta.lastWriteAt =
      (options.updatedAt ?? options.createdAt)?.getTime() ?? meta.lastWriteAt;
  }

  async load(): Promise<void> {
    const docs = await listFirestoreDocuments({
      serviceAccountJson: this.serviceAccountJson,
      collectionPath: this.filesCollectionPath(),
      limit: 1000,
      orderBy: "path asc",
    });
    if (docs.length === 0) {
      return;
    }
    for (const doc of docs) {
      const data = doc.data ?? {};
      const rawPath = resolveWorkspaceFilePathFromFirestoreDocument({
        documentPath: doc.documentPath,
        storedPath: data.path,
      });
      if (!rawPath) {
        continue;
      }
      const content = typeof data.content === "string" ? data.content : "";
      const createdAt = resolveFirestoreDate(data.createdAt);
      const updatedAt = resolveFirestoreDate(data.updatedAt);
      const parsedWorkspaceFile = SparkAgentWorkspaceFileSchema.safeParse({
        ...data,
        path: rawPath,
      });
      if (
        parsedWorkspaceFile.success &&
        parsedWorkspaceFile.data.type === "storage_link"
      ) {
        await this.materializeWorkspaceStorageLinkFile({
          filePath: rawPath,
          storagePath: parsedWorkspaceFile.data.storagePath,
          contentType: parsedWorkspaceFile.data.contentType,
          sizeBytes: parsedWorkspaceFile.data.sizeBytes,
          createdAt,
          updatedAt,
        });
        continue;
      }
      const resolved = resolveWorkspacePath(this.rootDir, rawPath);
      await ensureDir(path.dirname(resolved));
      await writeFile(resolved, content, { encoding: "utf8" });
      const meta = this.ensureMeta(rawPath);
      meta.createdAt = createdAt ?? meta.createdAt;
      meta.updatedAt = updatedAt ?? meta.updatedAt;
      meta.lastWriteAt =
        updatedAt?.getTime() ?? createdAt?.getTime() ?? meta.lastWriteAt;
    }
  }

  scheduleUpdate(filePath: string): void {
    const meta = this.ensureMeta(filePath);
    if (meta.disposed) {
      return;
    }
    meta.pending = true;
    if (meta.inFlight) {
      return;
    }
    if (meta.timer) {
      return;
    }
    const now = Date.now();
    const elapsed = now - meta.lastWriteAt;
    if (elapsed >= WORKSPACE_UPDATE_THROTTLE_MS) {
      void this.startFlush(filePath, { force: false }).catch((error) => {
        console.warn(
          `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
        );
      });
      return;
    }
    const delay = Math.max(0, WORKSPACE_UPDATE_THROTTLE_MS - elapsed);
    meta.timer = setTimeout(() => {
      meta.timer = undefined;
      void this.startFlush(filePath, { force: false }).catch((error) => {
        console.warn(
          `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
        );
      });
    }, delay);
  }

  async deleteFile(filePath: string): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (meta) {
      meta.disposed = true;
      meta.pending = false;
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      await meta.inFlight?.catch(() => undefined);
    }
    this.fileMeta.delete(filePath);
    await deleteFirestoreDocument({
      serviceAccountJson: this.serviceAccountJson,
      documentPath: this.fileDocPath(filePath),
    }).catch(() => undefined);
  }

  async moveFile(fromPath: string, toPath: string): Promise<void> {
    const meta = this.fileMeta.get(fromPath);
    const fromCreatedAt = meta?.createdAt;
    if (meta) {
      meta.disposed = true;
      meta.pending = false;
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      await meta.inFlight?.catch(() => undefined);
    }
    this.fileMeta.delete(fromPath);
    await deleteFirestoreDocument({
      serviceAccountJson: this.serviceAccountJson,
      documentPath: this.fileDocPath(fromPath),
    }).catch(() => undefined);
    const toMeta = this.ensureMeta(toPath);
    if (fromCreatedAt && !toMeta.createdAt) {
      toMeta.createdAt = fromCreatedAt;
    }
    this.scheduleUpdate(toPath);
  }

  async flushAll(): Promise<void> {
    const entries = Array.from(this.fileMeta.entries());
    const tasks: Promise<void>[] = [];
    for (const [filePath, meta] of entries) {
      if (meta.disposed) {
        continue;
      }
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      const now = Date.now();
      const elapsed = now - meta.lastWriteAt;
      const delay = Math.max(0, WORKSPACE_UPDATE_THROTTLE_MS - elapsed);
      tasks.push(
        (async () => {
          if (meta.inFlight) {
            await meta.inFlight;
          }
          if (!meta.pending) {
            return;
          }
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          await this.startFlush(filePath, { force: true });
        })(),
      );
    }
    await Promise.all(tasks);
  }

  private async startFlush(
    filePath: string,
    { force }: { force: boolean },
  ): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (!meta || meta.disposed) {
      return;
    }
    if (!meta.pending && !force) {
      return;
    }
    if (meta.timer) {
      clearTimeout(meta.timer);
      meta.timer = undefined;
    }
    if (meta.inFlight) {
      await meta.inFlight;
      return;
    }

    // Reserve the write slot immediately so subsequent scheduleUpdate() calls
    // don't accidentally bypass the per-doc throttle while the write is in flight.
    meta.pending = false;
    meta.lastWriteAt = Date.now();
    const promise = this.flushPath(filePath)
      .catch((error) => {
        if (!meta.disposed) {
          meta.pending = true;
        }
        throw error;
      })
      .finally(() => {
        meta.inFlight = undefined;
        if (!meta.disposed && meta.pending) {
          this.scheduleUpdate(filePath);
        }
      });
    meta.inFlight = promise;
    await promise;
  }

  private async flushPath(filePath: string): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (!meta || meta.disposed) {
      return;
    }
    const resolved = resolveWorkspacePath(this.rootDir, filePath);
    try {
      const now = new Date();
      const createdAt = meta.createdAt ?? now;
      meta.createdAt = createdAt;
      meta.updatedAt = now;
      meta.lastWriteAt = Date.now();
      await persistWorkspaceFileFromLocalFs({
        serviceAccountJson: this.serviceAccountJson,
        userId: this.userId,
        workspaceId: this.workspaceId,
        filePath,
        absoluteFilePath: resolved,
        bucketName: this.bucketName,
        createdAt,
        updatedAt: now,
      });
    } catch (error) {
      throw new Error(
        `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
      );
    }
  }
}

function resolveUsageNumber(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return 0;
}

type CallTokenState = {
  promptTokens: number;
  cachedTokens: number;
  responseTokens: number;
  responseImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  toolUsePromptTokens: number;
};

function createEmptyCallTokenState(): CallTokenState {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    responseTokens: 0,
    responseImageTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    toolUsePromptTokens: 0,
  };
}

class AgentRunStatsTracker {
  private readonly primaryModelId: string;
  private modelCalls = 0;
  private readonly modelsUsed = new Set<string>();
  private readonly tokens: CallTokenState = createEmptyCallTokenState();
  private modelCostUsd = 0;
  private toolCalls = 0;
  private readonly toolCallsByName = new Map<string, number>();
  private toolCostUsd = 0;
  private readonly callInfo = new Map<
    ModelCallHandle,
    {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
      costBucket: "model" | "tool";
    }
  >();

  constructor(options?: { primaryModelId?: string }) {
    const raw = options?.primaryModelId?.trim() ?? "";
    this.primaryModelId = raw.length > 0 ? raw : "";
  }

  private resolveCostBucket(modelId: string): "model" | "tool" {
    const trimmed = modelId.trim();
    if (this.primaryModelId && trimmed === this.primaryModelId) {
      return "model";
    }
    // Fallback heuristic: tool-loop calls are "model cost", and calls made by
    // agent tools are tracked as "tool cost".
    if (trimmed.startsWith("chatgpt-")) {
      return "model";
    }
    return "tool";
  }

  startModelCall(details: {
    modelId: string;
    costBucket?: "model" | "tool";
  }): ModelCallHandle {
    const handle: ModelCallHandle = Symbol("agent-model-call");
    const costBucket =
      details.costBucket ?? this.resolveCostBucket(details.modelId);
    this.modelCalls += 1;
    this.modelsUsed.add(details.modelId);
    this.callInfo.set(handle, {
      modelId: details.modelId,
      tokens: createEmptyCallTokenState(),
      appliedCostUsd: 0,
      costBucket,
    });
    return handle;
  }

  recordModelUsage(handle: ModelCallHandle, chunk: LlmUsageChunk): void {
    const state = this.callInfo.get(handle);
    if (!state) {
      return;
    }
    if (chunk.modelVersion) {
      state.modelVersion = chunk.modelVersion;
      this.modelsUsed.add(chunk.modelVersion);
    }
    if (!chunk.tokens) {
      if (typeof chunk.costUsd === "number" && Number.isFinite(chunk.costUsd)) {
        this.applyCostUpdate(state, Math.max(0, chunk.costUsd));
      }
      return;
    }
    this.applyTokenUpdate(state, {
      tokens: chunk.tokens,
      ...(typeof chunk.costUsd === "number" ? { costUsd: chunk.costUsd } : {}),
    });
  }

  finishModelCall(handle: ModelCallHandle): void {
    this.callInfo.delete(handle);
  }

  recordCompletedModelCall(details: {
    modelId: string;
    modelVersion?: string;
    usage?: LlmUsageTokens;
    costUsd?: number;
    costBucket?: "model" | "tool";
  }): void {
    const handle = this.startModelCall({
      modelId: details.modelId,
      ...(details.costBucket ? { costBucket: details.costBucket } : {}),
    });
    if (
      details.modelVersion ||
      details.usage ||
      typeof details.costUsd === "number"
    ) {
      this.recordModelUsage(handle, {
        ...(details.modelVersion ? { modelVersion: details.modelVersion } : {}),
        ...(details.usage ? { tokens: details.usage } : {}),
        ...(typeof details.costUsd === "number"
          ? { costUsd: details.costUsd }
          : {}),
      });
    }
    this.finishModelCall(handle);
  }

  recordToolCall(toolName: string): void {
    this.toolCalls += 1;
    const next = (this.toolCallsByName.get(toolName) ?? 0) + 1;
    this.toolCallsByName.set(toolName, next);
  }

  recordToolCallsFromResult(toolLoopResult: LlmToolLoopResult): void {
    const resultToolCallsByName = new Map<string, number>();
    for (const step of toolLoopResult.steps) {
      for (const toolCall of step.toolCalls) {
        const next = (resultToolCallsByName.get(toolCall.toolName) ?? 0) + 1;
        resultToolCallsByName.set(toolCall.toolName, next);
      }
    }
    for (const [toolName, resultCount] of resultToolCallsByName.entries()) {
      const existingCount = this.toolCallsByName.get(toolName) ?? 0;
      const missingCount = Math.max(0, resultCount - existingCount);
      for (let index = 0; index < missingCount; index += 1) {
        this.recordToolCall(toolName);
      }
    }
  }

  snapshot(): AgentRunStatsSnapshot {
    const toolsByName: Record<string, number> = {};
    for (const [name, count] of this.toolCallsByName.entries()) {
      toolsByName[name] = count;
    }
    const modelCostUsd =
      typeof this.modelCostUsd === "number" &&
      Number.isFinite(this.modelCostUsd)
        ? this.modelCostUsd
        : 0;
    const toolCostUsd =
      typeof this.toolCostUsd === "number" && Number.isFinite(this.toolCostUsd)
        ? this.toolCostUsd
        : 0;
    return {
      modelCalls: this.modelCalls,
      modelsUsed: Array.from(this.modelsUsed).sort(),
      tokens: { ...this.tokens },
      modelCostUsd,
      toolCalls: this.toolCalls,
      toolCallsByName: toolsByName,
      toolCostUsd,
      totalCostUsd: modelCostUsd + toolCostUsd,
    };
  }

  reconcileModelCostFromToolLoopResult(details: {
    modelId: string;
    toolLoopResult: Pick<LlmToolLoopResult, "steps" | "totalCostUsd">;
  }): number {
    this.modelsUsed.add(details.modelId);
    for (const step of details.toolLoopResult.steps) {
      this.modelsUsed.add(step.modelVersion);
    }
    const expectedModelCostUsd = Number.isFinite(details.toolLoopResult.totalCostUsd)
      ? Math.max(0, details.toolLoopResult.totalCostUsd)
      : 0;
    const costDeltaUsd = Math.max(0, expectedModelCostUsd - this.modelCostUsd);
    if (costDeltaUsd > 0) {
      this.modelCostUsd += costDeltaUsd;
    }
    return costDeltaUsd;
  }

  private applyTokenUpdate(
    state: {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
      costBucket: "model" | "tool";
    },
    update: {
      tokens: LlmUsageTokenUpdate;
      costUsd?: number;
    },
  ): void {
    const tokens = update.tokens;
    const previous = state.tokens;
    const next: CallTokenState = {
      promptTokens: resolveUsageNumber(tokens.promptTokens),
      cachedTokens: resolveUsageNumber(tokens.cachedTokens),
      responseTokens: resolveUsageNumber(tokens.responseTokens),
      responseImageTokens: resolveUsageNumber(tokens.responseImageTokens),
      thinkingTokens: resolveUsageNumber(tokens.thinkingTokens),
      totalTokens: resolveUsageNumber(
        tokens.totalTokens ??
          resolveUsageNumber(tokens.promptTokens) +
            resolveUsageNumber(tokens.responseTokens) +
            resolveUsageNumber(tokens.thinkingTokens) +
            resolveUsageNumber(tokens.toolUsePromptTokens),
      ),
      toolUsePromptTokens: resolveUsageNumber(tokens.toolUsePromptTokens),
    };

    const promptDelta = Math.max(0, next.promptTokens - previous.promptTokens);
    const cachedDelta = Math.max(0, next.cachedTokens - previous.cachedTokens);
    const responseDelta = Math.max(
      0,
      next.responseTokens - previous.responseTokens,
    );
    const responseImageDelta = Math.max(
      0,
      next.responseImageTokens - previous.responseImageTokens,
    );
    const thinkingDelta = Math.max(
      0,
      next.thinkingTokens - previous.thinkingTokens,
    );
    const totalDelta = Math.max(0, next.totalTokens - previous.totalTokens);
    const toolUseDelta = Math.max(
      0,
      next.toolUsePromptTokens - previous.toolUsePromptTokens,
    );

    this.tokens.promptTokens += promptDelta;
    this.tokens.cachedTokens += cachedDelta;
    this.tokens.responseTokens += responseDelta;
    this.tokens.responseImageTokens += responseImageDelta;
    this.tokens.thinkingTokens += thinkingDelta;
    this.tokens.totalTokens += totalDelta;
    this.tokens.toolUsePromptTokens += toolUseDelta;

    state.tokens = next;
    const estimatedCostUsd = estimateCallCostUsd({
      modelId: state.modelVersion ?? state.modelId,
      tokens,
      responseImages: 0,
    });
    const reportedCostUsd =
      typeof update.costUsd === "number" && Number.isFinite(update.costUsd)
        ? Math.max(0, update.costUsd)
        : undefined;
    const callCostUsd =
      reportedCostUsd !== undefined
        ? Math.max(estimatedCostUsd, reportedCostUsd)
        : estimatedCostUsd;
    this.applyCostUpdate(state, callCostUsd);
  }

  private applyCostUpdate(
    state: {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
      costBucket: "model" | "tool";
    },
    callCostUsd: number,
  ): void {
    const costDelta = Math.max(0, callCostUsd - state.appliedCostUsd);
    if (costDelta > 0) {
      if (state.costBucket === "tool") {
        this.toolCostUsd += costDelta;
      } else {
        this.modelCostUsd += costDelta;
      }
      state.appliedCostUsd = callCostUsd;
    }
  }
}

function createToolLoopStatsEventBridge(options: {
  tracker: AgentRunStatsTracker;
  modelId: string;
  flush: () => void;
}): {
  onEvent(event: LlmStreamEvent): void;
  finish(): void;
} {
  let activeHandle: ModelCallHandle | null = null;

  const ensureActiveHandle = (): ModelCallHandle => {
    if (activeHandle) {
      return activeHandle;
    }
    activeHandle = options.tracker.startModelCall({
      modelId: options.modelId,
      costBucket: "model",
    });
    return activeHandle;
  };

  const finishActiveHandle = (): void => {
    if (!activeHandle) {
      return;
    }
    options.tracker.finishModelCall(activeHandle);
    activeHandle = null;
  };

  return {
    onEvent(event) {
      switch (event.type) {
        case "delta": {
          const handle = ensureActiveHandle();
          if (event.channel === "response") {
            options.tracker.recordModelUsage(handle, {
              response: { textCharsDelta: event.text.length },
            });
          } else {
            options.tracker.recordModelUsage(handle, {
              thinking: { textCharsDelta: event.text.length },
            });
          }
          options.flush();
          return;
        }
        case "model": {
          const handle = ensureActiveHandle();
          options.tracker.recordModelUsage(handle, {
            modelVersion: event.modelVersion,
          });
          options.flush();
          return;
        }
        case "usage": {
          const handle = ensureActiveHandle();
          options.tracker.recordModelUsage(handle, {
            modelVersion: event.modelVersion,
            tokens: event.usage,
            costUsd: event.costUsd,
          });
          options.flush();
          return;
        }
        case "blocked": {
          finishActiveHandle();
          options.flush();
          return;
        }
        case "tool_call": {
          if (event.phase === "started" && !activeHandle) {
            ensureActiveHandle();
          }
          finishActiveHandle();
          if (event.phase === "started") {
            options.tracker.recordToolCall(event.toolName);
          }
          options.flush();
          return;
        }
      }
    },
    finish() {
      finishActiveHandle();
      options.flush();
    },
  };
}

type AgentLogSyncOptions = {
  serviceAccountJson: string;
  userId: string;
  agentId: string;
  throttleMs: number;
  initialStats: AgentRunStatsSnapshot;
  mirrorToConsole?: boolean;
  consolePrefix?: string;
};

class AgentLogSync {
  private serviceAccountJson: string;
  private userId: string;
  private agentId: string;
  private throttleMs: number;
  private createdAt: Date;
  private createdAtWritten = false;
  private lastWriteAt = 0;
  private pendingLines = new Map<string, string>();
  private pendingStats: AgentRunStatsSnapshot | null = null;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private disposed = false;
  private lastKeyMs = 0;
  private seq = 0;
  private mirrorToConsole: boolean;
  private consolePrefix: string;

  constructor(options: AgentLogSyncOptions) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.userId = options.userId;
    this.agentId = options.agentId;
    this.throttleMs = options.throttleMs;
    this.createdAt = new Date();
    this.pendingStats = options.initialStats;
    this.mirrorToConsole = options.mirrorToConsole ?? false;
    this.consolePrefix = options.consolePrefix ?? "";
    this.scheduleUpdate();
  }

  private documentPath(): string {
    return `users/${this.userId}/agents/${this.agentId}/logs/log`;
  }

  append(line: string): void {
    if (this.disposed) {
      return;
    }
    if (this.mirrorToConsole) {
      console.log(`${this.consolePrefix}${line}`);
    }
    const key = this.nextLineKey();
    this.pendingLines.set(key, line);
    this.scheduleUpdate();
  }

  setStats(stats: AgentRunStatsSnapshot): void {
    if (this.disposed) {
      return;
    }
    this.pendingStats = stats;
    this.scheduleUpdate();
  }

  async flushAll(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => undefined);
    }
    if (this.pendingLines.size === 0 && !this.pendingStats) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastWriteAt;
    const delay = Math.max(0, this.throttleMs - elapsed);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    await this.startFlush({ force: true });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private nextLineKey(): string {
    const nowMs = Date.now();
    if (nowMs === this.lastKeyMs) {
      this.seq += 1;
    } else {
      this.lastKeyMs = nowMs;
      this.seq = 0;
    }
    return `t${nowMs}_${String(this.seq).padStart(3, "0")}`;
  }

  private scheduleUpdate(): void {
    if (this.disposed) {
      return;
    }
    if (this.inFlight) {
      return;
    }
    if (this.timer) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastWriteAt;
    if (elapsed >= this.throttleMs) {
      void this.startFlush({ force: false }).catch((error) => {
        console.warn(
          `Failed to flush agent logs "${this.agentId}": ${errorAsString(error)}`,
        );
      });
      return;
    }
    const delay = Math.max(0, this.throttleMs - elapsed);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.startFlush({ force: false }).catch((error) => {
        console.warn(
          `Failed to flush agent logs "${this.agentId}": ${errorAsString(error)}`,
        );
      });
    }, delay);
  }

  private async startFlush({ force }: { force: boolean }): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!force && this.pendingLines.size === 0 && !this.pendingStats) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) {
      await this.inFlight;
      return;
    }

    this.lastWriteAt = Date.now();
    const promise = this.flush()
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
        if (
          !this.disposed &&
          (this.pendingLines.size > 0 || this.pendingStats)
        ) {
          this.scheduleUpdate();
        }
      });
    this.inFlight = promise;
    await promise;
  }

  private async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const linesEntries = Array.from(this.pendingLines.entries());
    const stats = this.pendingStats;
    this.pendingLines.clear();
    this.pendingStats = null;

    if (linesEntries.length === 0 && !stats) {
      return;
    }

    const now = new Date();
    const linesPayload: Record<string, string> = {};
    for (const [key, value] of linesEntries) {
      linesPayload[key] = value;
    }

    const payload: Record<string, unknown> = {
      updatedAt: now,
    };
    if (!this.createdAtWritten) {
      payload.createdAt = this.createdAt;
    }
    if (linesEntries.length > 0) {
      for (const [key, value] of Object.entries(linesPayload)) {
        payload[`lines.${key}`] = value;
      }
    }
    if (stats) {
      payload.stats = stats;
    }

    try {
      await patchFirestoreDocument({
        serviceAccountJson: this.serviceAccountJson,
        documentPath: this.documentPath(),
        updates: payload,
      });
      this.createdAtWritten = true;
    } catch (error) {
      for (const [key, value] of linesEntries) {
        if (!this.pendingLines.has(key)) {
          this.pendingLines.set(key, value);
        }
      }
      if (!this.pendingStats && stats) {
        this.pendingStats = stats;
      }
      throw error;
    }
  }
}

function stripDeprecatedPdfReadTools(tools: LlmToolSet): LlmToolSet {
  const nextTools: LlmToolSet = { ...tools };
  delete (nextTools as Record<string, unknown>).read_pdf;
  delete (nextTools as Record<string, unknown>).extract_pdf_text;
  return nextTools;
}

export function buildSparkAgentSystemPrompt(options?: {
  includePdfTranscriptionSkill?: boolean;
}): string {
  const lines = [
    "You are Spark Agent, a tool-using assistant.",
    "",
    "General rules:",
    "- Work with workspace-relative paths only (no absolute paths, no .. segments).",
    "- Use list_files/read_file/read_files to inspect text files in the workspace before editing.",
    "- Use view_image for image files (read_file is text-only).",
    "- Use write_file to create/overwrite files; use apply_patch for small edits to existing files.",
    "- Use move_file for renames and delete_file for deletions.",
    "- Prefer fewer, larger writes over many tiny edits.",
    "- Use web_search when you need to look up facts or check details.",
    "- Use web_fetch to retrieve NON-PDF source pages/files from URLs discovered via web_search.",
    "- Use extract_text to transcribe workspace document files (images/PDFs) into markdown with LaTeX formulas.",
    "- extract_text does not automatically know source filenames/paths; include identifying details inside instructions when needed.",
    "- For multi-page extraction tasks, you can request explicit page markers in the extracted markdown.",
    "- For PDF transcription, render workspace PDFs with pdf_to_images and inspect page images with view_image.",
    "- Use extract_pdf_diagrams when you need diagram bounding boxes from a PDF.",
    "- Do NOT use web_fetch for PDFs.",
    "- When the task is complete, you MUST call done({summary}).",
    "",
    "Lesson creation pipeline (CRITICAL):",
    "When you are asked to create a Spark lesson, follow the pipeline described in lesson/task.md.",
    "Key strategy (prompt-driven):",
    "1) Read brief.md + request.json + lesson/task.md first; write hard requirements + decisions into lesson/requirements.md.",
    "2) Draft content as Markdown (preferred):",
    "   - Session draft: lesson/drafts/session.md",
    "   - Quiz drafts: lesson/drafts/quiz/<planItemId>.md",
    "   - Code drafts: lesson/drafts/code/<planItemId>.md (only if coding is included)",
    "   - Use generate_text with the templates in lesson/prompts/ to draft/revise Markdown.",
    "   - IMPORTANT dependency: the quiz/code draft prompt templates inline lesson/drafts/session.md, so you MUST generate the session draft before running quiz-draft/code-draft generate_text calls.",
    "3) Grade drafts (do not skip):",
    "   - Session grade: lesson/feedback/session-grade.md (must have pass: true before publishing)",
    "   - Quiz grade: lesson/feedback/quiz/<planItemId>-grade.md (one per quiz plan item)",
    "   - Code grade: lesson/feedback/code/<planItemId>-grade.md (one per coding_problem plan item)",
    "4) Generate Firestore-ready JSON outputs under lesson/output/ from the Markdown drafts:",
    "   - Use generate_json({ sourcePath, schemaPath, outputPath }) for each JSON file.",
    "   - Then run validate_json({ schemaPath, inputPath }) and fix until ok=true.",
    "   - Fixes can be done by editing the source Markdown and re-running generate_json, or by patching the JSON directly.",
    "   - Required outputs:",
    "     - lesson/output/session.json (from lesson/drafts/session.md, schema lesson/schema/session.schema.json)",
    "     - lesson/output/quiz/<planItemId>.json (from lesson/drafts/quiz/<planItemId>.md, schema lesson/schema/quiz.schema.json)",
    "     - lesson/output/code/<planItemId>.json (from lesson/drafts/code/<planItemId>.md, schema lesson/schema/coding_problem.schema.json)",
    '     - lesson/output/media/<planItemId>.json (rare; only if kind="media" exists; schema lesson/schema/media.schema.json)',
    "5) Publish only after outputs exist and look consistent: call publish_lesson and fix errors until status='published'.",
    "Publish lessons into the user's sessions (not welcome templates).",
    "",
    "Schema / files:",
    "- lesson/schema/session.schema.json describes lesson/output/session.json.",
    "- lesson/schema/quiz.schema.json describes lesson/output/quiz/*.json.",
    "- lesson/schema/coding_problem.schema.json describes lesson/output/code/*.json.",
    "- lesson/schema/media.schema.json describes lesson/output/media/*.json (only if explicitly requested).",
    "",
    "generate_text notes:",
    "- Prompt templates may include {{path/to/file}} placeholders to inline workspace files.",
    "- Some prompt templates REQUIRE inputPaths. In particular, quiz/code grade and revise prompts MUST be called with inputPaths so the sub-model can see the candidate draft (and the grading report for revise).",
    "- outputPath is required for every generate_text call.",
    "- Lesson grading templates output `pass: true|false`. generate_text will return `gradePass: true|false` when it detects this line. Use that instead of reading the grade file back unless you need details to fix a failure.",
    "- Only revise drafts when pass=false. If pass=true, proceed even if the grader suggests optional improvements.",
    "",
    "Examples (multiple quizzes / coding problems):",
    "- Grade quiz q1:",
    '  generate_text({ promptPath: "lesson/prompts/quiz-grade.md", inputPaths: ["lesson/drafts/quiz/q1.md"], outputPath: "lesson/feedback/quiz/q1-grade.md" })',
    "- Revise quiz q1 using its grade report:",
    '  generate_text({ promptPath: "lesson/prompts/quiz-revise.md", inputPaths: ["lesson/drafts/quiz/q1.md", "lesson/feedback/quiz/q1-grade.md"], outputPath: "lesson/drafts/quiz/q1.md" })',
    "- Grade code problem p1:",
    '  generate_text({ promptPath: "lesson/prompts/code-grade.md", inputPaths: ["lesson/drafts/code/p1.md"], outputPath: "lesson/feedback/code/p1-grade.md" })',
    "- Revise code problem p1 using its grade report:",
    '  generate_text({ promptPath: "lesson/prompts/code-revise.md", inputPaths: ["lesson/drafts/code/p1.md", "lesson/feedback/code/p1-grade.md"], outputPath: "lesson/drafts/code/p1.md" })',
    "",
    "Step limit optimization (important for smoke tests):",
    "- You MAY call multiple tools in a single step when they are independent (they run in parallel).",
    "- In low-step-budget runs, you MUST batch JSON work: run generate_json for session + all quizzes/coding_problems/media in one step, then validate_json for all outputs in one step.",
    "- Similarly, once prerequisites exist (e.g. session draft), batch quiz/coding_problem draft and grade calls per plan item in the same step (one outputPath per plan item).",
    "- Good batching examples:",
    "  - Grade q1 and q2 in the same step (distinct outputPath per quiz).",
    "  - Generate JSON for session + all quizzes in one step, then validate them all in one step.",
    "- Do NOT batch dependent operations in the same step (e.g. don't grade before drafting, don't validate before generating).",
    "",
    "Python execution:",
    "- Use python_exec for calculations or verification (e.g. validate that a reference solution matches tests).",
    "- Provide stdinPath and capture stdout/stderr to workspace files so results are persisted.",
  ];
  if (options?.includePdfTranscriptionSkill) {
    lines.push(
      "",
      "PDF transcription workflow (required when handling PDF/image grading tasks):",
      "~~~markdown",
      PDF_TRANSCRIPTION_SKILL_TEXT,
      "~~~",
    );
  }
  return lines.join("\n");
}

type ValidatedLessonPublishBundle = {
  readonly session: Session;
  readonly quizzes: QuizDefinition[];
  readonly problems: CodeProblem[];
  readonly media: SessionMediaDoc[];
};

async function validateLessonWorkspaceForPublish(options: {
  rootDir: string;
  sessionId: string;
  sessionPath: string;
  briefPath: string;
  createdAt: Date;
  titleFallback?: string;
  topicsFallback?: string[];
  includeStory?: boolean;
  includeCoding?: boolean;
  enforceLessonPipeline: boolean;
}): Promise<ValidatedLessonPublishBundle> {
  const {
    rootDir,
    sessionId,
    sessionPath,
    briefPath,
    createdAt,
    titleFallback,
    topicsFallback,
    includeStory,
    includeCoding,
    enforceLessonPipeline,
  } = options;

  const readWorkspaceJson = async (inputPath: string): Promise<unknown> => {
    const resolved = resolveWorkspacePath(rootDir, inputPath);
    let text = "";
    try {
      text = await readFile(resolved, { encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `Unable to read workspace file "${inputPath}": ${errorAsString(error)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Invalid JSON in "${inputPath}": ${errorAsString(error)}`,
      );
    }
  };

  const ensurePlainRecord = (
    value: unknown,
    label: string,
  ): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`"${label}" must contain a JSON object.`);
    }
    return value as Record<string, unknown>;
  };

  const readWorkspaceTextOptional = async (
    inputPath: string,
  ): Promise<string | null> => {
    try {
      const resolved = resolveWorkspacePath(rootDir, inputPath);
      return await readFile(resolved, { encoding: "utf8" });
    } catch {
      return null;
    }
  };

  if (enforceLessonPipeline) {
    const sessionGradePath = "lesson/feedback/session-grade.md";
    const gradeText = await readWorkspaceTextOptional(sessionGradePath);
    if (!gradeText) {
      throw new Error(
        `Missing required session grading report (${sessionGradePath}). Run generate_text with promptPath='lesson/prompts/session-grade.md' and outputPath='${sessionGradePath}', then revise until pass: true.`,
      );
    }
    const passMatch = gradeText.match(/^\s*pass\s*:\s*(true|false)\s*$/gim);
    const passValue = passMatch?.[0]
      ? (() => {
          const parts = passMatch[0].split(":");
          const raw = parts[1] ? parts[1].trim().toLowerCase() : "";
          return raw === "true" ? true : raw === "false" ? false : null;
        })()
      : null;
    if (passValue !== true) {
      const detail =
        passValue === false
          ? "pass=false"
          : "missing required `pass: true|false` line";
      throw new Error(
        `Session grading report (${sessionGradePath}) ${detail}. Revise lesson/drafts/session.md and re-grade before publishing.`,
      );
    }
  }

  const lessonBrief = await readWorkspaceTextOptional(briefPath);

  const rawSessionJson = await readWorkspaceJson(sessionPath);
  const rawSessionRecord = ensurePlainRecord(rawSessionJson, sessionPath);

  const titleFromFile =
    typeof rawSessionRecord.title === "string"
      ? rawSessionRecord.title.trim()
      : "";
  const resolvedTitle =
    titleFromFile.length > 0 ? titleFromFile : titleFallback;

  const topicsFromFile = Array.isArray(rawSessionRecord.topics)
    ? rawSessionRecord.topics
        .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
        .filter((topic) => topic.length > 0)
    : [];
  const resolvedTopics =
    topicsFromFile.length > 0
      ? topicsFromFile
      : topicsFallback && topicsFallback.length > 0
        ? topicsFallback
        : [];

  const sessionCandidate: Record<string, unknown> = {
    ...rawSessionRecord,
    id: sessionId,
    createdAt,
    status: "ready",
    nextLessonProposals: [],
  };
  if (resolvedTitle) {
    sessionCandidate.title = resolvedTitle;
  }
  if (resolvedTopics.length > 0) {
    sessionCandidate.topics = resolvedTopics;
  } else if (lessonBrief) {
    const deriveTopic = (brief: string): string => {
      const lines = brief.replace(/\r\n/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]?.trim() ?? "";
        if (/^##\s*topic\s*$/iu.test(line)) {
          for (let j = i + 1; j < lines.length; j += 1) {
            const next = lines[j]?.trim() ?? "";
            if (next.length === 0) {
              continue;
            }
            return next.replace(/^#+\s*/u, "").trim();
          }
        }
        const match = line.match(
          /^\s*(?:topic|lesson topic|session topic|title)\s*:\s*(.+?)\s*$/iu,
        );
        if (match?.[1]) {
          return match[1].trim();
        }
      }
      const firstNonEmpty = lines.find((entry) => entry.trim().length > 0);
      return firstNonEmpty ? firstNonEmpty.replace(/^#+\s*/u, "").trim() : "";
    };
    const derivedTopic = deriveTopic(lessonBrief);
    if (derivedTopic) {
      sessionCandidate.topics = [derivedTopic];
    }
  }

  let sessionDoc: Session;
  try {
    sessionDoc = SessionSchema.parse(sessionCandidate);
  } catch (error) {
    throw new Error(
      `Invalid session JSON (${sessionPath}): ${errorAsString(error)}`,
    );
  }

  if (includeCoding === false) {
    const problemCount = sessionDoc.plan.filter(
      (item) => item.kind === "coding_problem",
    ).length;
    if (problemCount > 0) {
      throw new Error(
        "includeCoding=false but session.plan includes coding_problem items.",
      );
    }
  }

  if (includeStory === false) {
    const mediaCount = sessionDoc.plan.filter(
      (item) => item.kind === "media",
    ).length;
    if (mediaCount > 0) {
      throw new Error(
        "includeStory=false but session.plan includes media items.",
      );
    }
  }

  const seenPlanIds = new Set<string>();
  for (const item of sessionDoc.plan) {
    if (seenPlanIds.has(item.id)) {
      throw new Error(`Duplicate plan item id "${item.id}" in session.`);
    }
    seenPlanIds.add(item.id);
  }

  const baseDir = path.posix.dirname(sessionPath);
  const basePrefix = baseDir === "." ? "" : baseDir;
  const resolveBundlePath = (suffix: string): string => {
    if (!basePrefix) {
      return suffix;
    }
    return `${basePrefix}/${suffix}`;
  };

  const quizPlanItems = sessionDoc.plan.filter((item) => item.kind === "quiz");
  const problemPlanItems = sessionDoc.plan.filter(
    (item) => item.kind === "coding_problem",
  );
  const mediaPlanItems = sessionDoc.plan.filter(
    (item) => item.kind === "media",
  );

  const quizzes: QuizDefinition[] = await Promise.all(
    quizPlanItems.map(async (item) => {
      const quizPath = resolveBundlePath(`quiz/${item.id}.json`);
      const rawQuizJson = await readWorkspaceJson(quizPath);
      const rawQuizRecord = ensurePlainRecord(rawQuizJson, quizPath);
      const progressKeyRaw =
        typeof rawQuizRecord.progressKey === "string"
          ? rawQuizRecord.progressKey.trim()
          : "";
      const progressKey =
        progressKeyRaw.length > 0
          ? progressKeyRaw
          : `lesson:${sessionId}:${item.id}`;
      const quizCandidate: Record<string, unknown> = {
        ...rawQuizRecord,
        id: item.id,
        progressKey,
      };
      try {
        return QuizDefinitionSchema.parse(quizCandidate);
      } catch (error) {
        throw new Error(
          `Invalid quiz JSON (${quizPath}): ${errorAsString(error)}`,
        );
      }
    }),
  );

  const quizzesById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));

  const problems: CodeProblem[] = await Promise.all(
    problemPlanItems.map(async (item) => {
      const problemPath = resolveBundlePath(`code/${item.id}.json`);
      const rawProblemJson = await readWorkspaceJson(problemPath);
      const rawProblemRecord = ensurePlainRecord(rawProblemJson, problemPath);
      const problemCandidate: Record<string, unknown> = {
        ...rawProblemRecord,
        slug: item.id,
      };
      try {
        return CodeProblemSchema.parse(problemCandidate);
      } catch (error) {
        throw new Error(
          `Invalid code problem JSON (${problemPath}): ${errorAsString(error)}`,
        );
      }
    }),
  );

  const media: SessionMediaDoc[] = await Promise.all(
    mediaPlanItems.map(async (item) => {
      const mediaPath = resolveBundlePath(`media/${item.id}.json`);
      const rawMediaJson = await readWorkspaceJson(mediaPath);
      const rawMediaRecord = ensurePlainRecord(rawMediaJson, mediaPath);
      const mediaCandidate: Record<string, unknown> = {
        ...rawMediaRecord,
        id: item.id,
        planItemId: item.id,
        sessionId,
      };
      try {
        return SessionMediaDocSchema.parse(mediaCandidate);
      } catch (error) {
        throw new Error(
          `Invalid media JSON (${mediaPath}): ${errorAsString(error)}`,
        );
      }
    }),
  );

  const planWithProgress = sessionDoc.plan.map((item) => {
    if (item.kind !== "quiz") {
      return item;
    }
    const quiz = quizzesById.get(item.id);
    if (!quiz) {
      return item;
    }
    if (item.progressKey && item.progressKey.trim().length > 0) {
      return item;
    }
    return { ...item, progressKey: quiz.progressKey };
  });

  const validatedSession = SessionSchema.parse({
    ...sessionDoc,
    plan: planWithProgress,
    status: "ready",
    createdAt,
    nextLessonProposals: [],
  });

  return {
    session: validatedSession,
    quizzes,
    problems,
    media,
  };
}

function buildAgentTools(options: {
  workspace: SparkAgentWorkspace;
  rootDir: string;
  userId: string;
  serviceAccountJson: string;
  progress?: JobProgressReporter;
  onToolLlmCost?: (toolName: ToolLlmCostName, costUsd: number) => void;
  enforceLessonPipeline?: boolean;
  allowPythonExec?: boolean;
  debug?: LlmDebugOptions;
  extractTextDebugRootDir?: string;
}): LlmToolSet {
  const {
    workspace,
    rootDir,
    userId,
    serviceAccountJson,
    progress,
    onToolLlmCost,
    enforceLessonPipeline,
    allowPythonExec,
    debug,
    extractTextDebugRootDir,
  } = options;
  const resolvedExtractTextDebugRootDir = (() => {
    const raw =
      typeof extractTextDebugRootDir === "string"
        ? extractTextDebugRootDir.trim()
        : "";
    if (raw.length === 0) {
      return path.join(rootDir, "debug");
    }
    if (path.isAbsolute(raw)) {
      return raw;
    }
    return path.join(rootDir, raw);
  })();

  const shouldEnforceLessonPipeline = enforceLessonPipeline === true;
  const shouldAllowPythonExec = allowPythonExec ?? true;

  const validate_json = tool({
    description: [
      "Validate a workspace JSON file against Spark's Zod schemas (the same ones used by publish_lesson).",
      "Provide schemaPath (for disambiguation) and inputPath (the JSON file to validate).",
      "",
      "This tool fills publisher-managed fields before validating:",
      "- session: id, createdAt, status, nextLessonProposals",
      "- quiz: id, progressKey",
      "- code: slug",
      "- media: id, planItemId, sessionId, createdAt, updatedAt",
      "",
      "Inputs:",
      "- schemaPath (required): One of lesson/schema/session.schema.json|quiz.schema.json|coding_problem.schema.json|media.schema.json (or an equivalent hint).",
      "- inputPath (required): JSON file to validate (usually under lesson/output/...).",
      "- sessionId (optional): Override session id for session validation; otherwise inferred from request.json if present.",
      "",
      "Batching:",
      "- If you need to validate multiple outputs, call validate_json once per file in the SAME step (they will run in parallel).",
    ].join("\n"),
    inputSchema: z
      .object({
        schemaPath: z.string().trim().min(1),
        inputPath: z.string().trim().min(1),
        sessionId: z.preprocess((value) => {
          if (value === null || value === undefined) {
            return undefined;
          }
          if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          }
          return value;
        }, z.string().trim().min(1).optional()),
      })
      .strict(),
    execute: async ({ schemaPath, inputPath, sessionId }) => {
      const normalize = (value: string): string =>
        value.replace(/\\/g, "/").trim();

      const resolvedSchemaPath = normalize(schemaPath);
      const resolvedInputPath = normalize(inputPath);

      const resolveKind = (
        value: string,
      ): "session" | "quiz" | "code" | "media" | null => {
        const lowered = value.toLowerCase();
        if (lowered.endsWith("session.schema.json")) {
          return "session";
        }
        if (lowered.endsWith("quiz.schema.json")) {
          return "quiz";
        }
        if (lowered.endsWith("coding_problem.schema.json")) {
          return "code";
        }
        if (lowered.endsWith("media.schema.json")) {
          return "media";
        }
        return null;
      };

      const kind =
        resolveKind(resolvedSchemaPath) ?? resolveKind(resolvedInputPath);

      const formatIssuePath = (segments: Array<string | number>): string => {
        if (segments.length === 0) {
          return "(root)";
        }
        let out = "";
        for (const segment of segments) {
          if (typeof segment === "number") {
            out += `[${segment.toString()}]`;
            continue;
          }
          const key = segment.trim();
          if (key.length === 0) {
            continue;
          }
          if (out.length === 0) {
            out = key;
          } else {
            out += `.${key}`;
          }
        }
        return out.length > 0 ? out : "(root)";
      };

      const buildZodIssues = (
        error: z.ZodError,
      ): Array<{ path: string; message: string }> =>
        error.issues.slice(0, 50).map((issue) => ({
          path: formatIssuePath(issue.path as Array<string | number>),
          message: issue.message,
        }));

      const fail = (
        message: string,
        issues?: Array<{ path: string; message: string }>,
      ) => ({
        ok: false as const,
        schemaPath: resolvedSchemaPath,
        inputPath: resolvedInputPath,
        kind: kind ?? "unknown",
        error: message,
        issues:
          issues && issues.length > 0 ? issues : [{ path: "(root)", message }],
      });

      const readJsonObject = async (): Promise<Record<string, unknown>> => {
        const resolved = resolveWorkspacePath(rootDir, resolvedInputPath);
        const text = await readFile(resolved, { encoding: "utf8" });
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new Error(
            `Invalid JSON in "${resolvedInputPath}": ${errorAsString(error)}`,
          );
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`"${resolvedInputPath}" must contain a JSON object.`);
        }
        return parsed as Record<string, unknown>;
      };

      const resolveSessionId = async (): Promise<string> => {
        const provided = sessionId?.trim() ?? "";
        if (provided.length > 0) {
          return provided;
        }
        try {
          const raw = await readFile(
            resolveWorkspacePath(rootDir, "request.json"),
            {
              encoding: "utf8",
            },
          );
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const fromRequest =
            typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";
          if (fromRequest.length > 0) {
            return fromRequest;
          }
        } catch {
          // ignore
        }
        return "session";
      };

      const inferPlanItemIdFromPath = (options: {
        dir: string;
        fallbackField: "id" | "slug" | "planItemId";
        record: Record<string, unknown>;
      }): string | null => {
        const normalized = resolvedInputPath;
        const prefix = `${options.dir.replace(/\\/g, "/").replace(/\/+$/g, "")}/`;
        if (normalized.startsWith(prefix) && normalized.endsWith(".json")) {
          const rest = normalized.slice(prefix.length, -".json".length);
          const trimmed = rest.trim();
          if (trimmed.length > 0 && !trimmed.includes("/")) {
            return trimmed;
          }
        }
        const fallbackValue = options.record[options.fallbackField];
        if (typeof fallbackValue === "string") {
          const trimmed = fallbackValue.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      };

      if (!kind) {
        return fail(
          'Unknown schema kind. schemaPath should end with "session.schema.json", "quiz.schema.json", "coding_problem.schema.json", or "media.schema.json".',
        );
      }

      try {
        const record = await readJsonObject();
        const nowIso = new Date().toISOString();

        switch (kind) {
          case "session": {
            const resolvedSessionId = await resolveSessionId();
            const candidate: Record<string, unknown> = {
              ...record,
              id: resolvedSessionId,
              createdAt: nowIso,
              status: "ready",
              nextLessonProposals: [],
            };
            const parsed = SessionSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Session validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              sessionId: parsed.data.id,
              planItems: parsed.data.plan.length,
            };
          }
          case "quiz": {
            const planItemId =
              inferPlanItemIdFromPath({
                dir: "lesson/output/quiz",
                fallbackField: "id",
                record,
              }) ??
              inferPlanItemIdFromPath({
                dir: "quiz",
                fallbackField: "id",
                record,
              });
            if (!planItemId) {
              return fail(
                'Unable to infer quiz id. Use inputPath like "lesson/output/quiz/<planItemId>.json" or include an id field.',
              );
            }
            const resolvedSessionId = await resolveSessionId();
            const progressKeyRaw =
              typeof record.progressKey === "string"
                ? record.progressKey.trim()
                : "";
            const progressKey =
              progressKeyRaw.length > 0
                ? progressKeyRaw
                : `lesson:${resolvedSessionId}:${planItemId}`;
            const candidate: Record<string, unknown> = {
              ...record,
              id: planItemId,
              progressKey,
            };
            const parsed = QuizDefinitionSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Quiz validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              id: parsed.data.id,
              questions: parsed.data.questions.length,
            };
          }
          case "code": {
            const planItemId =
              inferPlanItemIdFromPath({
                dir: "lesson/output/code",
                fallbackField: "slug",
                record,
              }) ??
              inferPlanItemIdFromPath({
                dir: "code",
                fallbackField: "slug",
                record,
              });
            if (!planItemId) {
              return fail(
                'Unable to infer code problem slug. Use inputPath like "lesson/output/code/<planItemId>.json" or include a slug field.',
              );
            }
            const candidate: Record<string, unknown> = {
              ...record,
              slug: planItemId,
            };
            const parsed = CodeProblemSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Code problem validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              slug: parsed.data.slug,
              tests: parsed.data.tests.length,
            };
          }
          case "media": {
            const planItemId =
              inferPlanItemIdFromPath({
                dir: "lesson/output/media",
                fallbackField: "planItemId",
                record,
              }) ??
              inferPlanItemIdFromPath({
                dir: "media",
                fallbackField: "planItemId",
                record,
              });
            if (!planItemId) {
              return fail(
                'Unable to infer media planItemId. Use inputPath like "lesson/output/media/<planItemId>.json" or include planItemId.',
              );
            }
            const resolvedSessionId = await resolveSessionId();
            const candidate: Record<string, unknown> = {
              ...record,
              id: planItemId,
              planItemId,
              sessionId: resolvedSessionId,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            const parsed = SessionMediaDocSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Media validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              id: parsed.data.id,
              narrationLines: parsed.data.narration.length,
              images: parsed.data.images.length,
            };
          }
        }
      } catch (error) {
        return fail(errorAsString(error));
      }
    },
  });

  const resolvePdfPromptText = async (options: {
    toolName:
      | "extract_text"
      | "extract_pdf_text"
      | "read_pdf"
      | "extract_pdf_diagrams";
    prompt?: string;
    promptPath?: string;
  }): Promise<string> => {
    if (
      typeof options.prompt === "string" &&
      options.prompt.trim().length > 0
    ) {
      return options.prompt.trim();
    }
    const resolvedPromptPath = options.promptPath?.trim() ?? "";
    if (resolvedPromptPath.length === 0) {
      throw new Error(
        `${options.toolName} requires either prompt or promptPath.`,
      );
    }
    const promptText = await readFile(
      resolveWorkspacePath(rootDir, resolvedPromptPath),
      { encoding: "utf8" },
    );
    const trimmedPrompt = promptText.trim();
    if (trimmedPrompt.length === 0) {
      throw new Error(
        `${options.toolName} prompt from "${resolvedPromptPath}" is empty.`,
      );
    }
    return trimmedPrompt;
  };

  const decodePdfBytesFromWorkspace = async (options: {
    toolName:
      | "extract_text"
      | "extract_pdf_text"
      | "read_pdf"
      | "extract_pdf_diagrams";
    pdfPath: string;
  }): Promise<{ pdfBytes: Buffer; resolvedPdfPath: string }> => {
    const resolvedPdfPath = options.pdfPath.trim();
    const rawPdfFile = await readFile(
      resolveWorkspacePath(rootDir, resolvedPdfPath),
    );
    let pdfBytes = rawPdfFile;
    const isRawPdf = rawPdfFile.subarray(0, 5).toString("utf8") === "%PDF-";
    if (!isRawPdf) {
      const rawText = rawPdfFile.toString("utf8").trim();
      const withoutPrefix = rawText.replace(
        /^data:application\/pdf;base64,/iu,
        "",
      );
      const compact = withoutPrefix.replace(/\s+/gu, "");
      if (compact.length === 0) {
        throw new Error(
          `${options.toolName} could not decode "${resolvedPdfPath}" as PDF bytes.`,
        );
      }
      const normalizedBase64 = compact.replace(/-/gu, "+").replace(/_/gu, "/");
      if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalizedBase64)) {
        throw new Error(
          `${options.toolName} expected base64 data in "${resolvedPdfPath}".`,
        );
      }
      if (normalizedBase64.length % 4 !== 0) {
        throw new Error(
          `${options.toolName} expected padded base64 in "${resolvedPdfPath}".`,
        );
      }
      pdfBytes = Buffer.from(normalizedBase64, "base64");
    }
    return { pdfBytes, resolvedPdfPath };
  };

  const fetchPdfBytesFromUrl = async (options: {
    toolName: "read_pdf" | "extract_pdf_diagrams";
    url: string;
  }): Promise<{ pdfBytes: Buffer; finalUrl: string; contentType: string }> => {
    const rawUrl = options.url.trim();
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `${options.toolName} supports only http/https URLs (got "${parsed.protocol}").`,
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, WEB_FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const pdfBytes = await readResponseBytesWithLimit(
      response,
      PDF_EXTRACTION_MAX_BYTES,
    );
    const contentTypeHeader = response.headers.get("content-type");
    const contentType = contentTypeHeader
      ? (contentTypeHeader.split(";")[0]?.trim().toLowerCase() ??
        "application/octet-stream")
      : "application/octet-stream";
    const finalUrl = response.url || parsed.toString();
    const hasPdfHeader =
      Buffer.from(pdfBytes).subarray(0, 5).toString("utf8") === "%PDF-";
    if (!hasPdfHeader) {
      throw new Error(
        `${options.toolName} expected PDF bytes from "${finalUrl}" but received ${contentType}.`,
      );
    }
    return { pdfBytes: Buffer.from(pdfBytes), finalUrl, contentType };
  };

  const resolveExtractTextPrimaryDocumentFromWorkspace = async (options: {
    documentPath: string;
  }): Promise<{
    documentBytes: Buffer;
    documentPath: string;
    documentKind: "pdf" | "image";
    documentMimeType: "application/pdf" | string;
  }> => {
    const resolvedDocumentPath = options.documentPath.trim();
    const documentBytes = await readFile(
      resolveWorkspacePath(rootDir, resolvedDocumentPath),
    );
    if (documentBytes.length === 0) {
      throw new Error(
        `extract_text received an empty document file "${resolvedDocumentPath}".`,
      );
    }
    const sourceLooksLikePdf =
      documentBytes.subarray(0, 5).toString("utf8") === "%PDF-";
    const sourceContentType = resolveContentType(resolvedDocumentPath);
    if (sourceLooksLikePdf || sourceContentType === "application/pdf") {
      const decoded = await decodePdfBytesFromWorkspace({
        toolName: "extract_text",
        pdfPath: resolvedDocumentPath,
      });
      if (decoded.pdfBytes.length === 0) {
        throw new Error(
          `extract_text received an empty PDF "${decoded.resolvedPdfPath}".`,
        );
      }
      if (decoded.pdfBytes.length > EXTRACT_TEXT_MAX_BYTES) {
        throw new Error(
          `extract_text PDF is too large (${decoded.pdfBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes).`,
        );
      }
      if (decoded.pdfBytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
        throw new Error(
          `extract_text expected PDF bytes in "${decoded.resolvedPdfPath}" (missing %PDF- header).`,
        );
      }
      return {
        documentBytes: decoded.pdfBytes,
        documentPath: decoded.resolvedPdfPath,
        documentKind: "pdf",
        documentMimeType: "application/pdf",
      };
    }

    const sourceMimeFromPath =
      typeof sourceContentType === "string" &&
      sourceContentType.startsWith("image/")
        ? sourceContentType
        : undefined;
    let sourceMimeType = sourceMimeFromPath;
    if (!sourceMimeType) {
      const sharp = getSharp();
      const metadata = await sharp(documentBytes)
        .metadata()
        .catch((error) => {
          throw new Error(
            `extract_text could not decode "${resolvedDocumentPath}" as an image: ${errorAsString(error)}`,
          );
        });
      sourceMimeType = resolveImageMimeTypeFromSharpFormat({
        format: metadata.format,
      });
    }

    if (!isSupportedCropImageMimeType(sourceMimeType)) {
      throw new Error(
        `extract_text supports PDF or image files (${SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES.join(", ")}). Received ${sourceMimeType ?? "unknown"} for "${resolvedDocumentPath}".`,
      );
    }
    if (typeof sourceMimeType !== "string") {
      throw new Error(
        `extract_text could not resolve image mime type for "${resolvedDocumentPath}".`,
      );
    }
    if (documentBytes.length > EXTRACT_TEXT_MAX_BYTES) {
      throw new Error(
        `extract_text image is too large (${documentBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes).`,
      );
    }
    return {
      documentBytes,
      documentPath: resolvedDocumentPath,
      documentKind: "image",
      documentMimeType: sourceMimeType,
    };
  };

  const resolveExtractTextContextPartFromWorkspace = async (options: {
    contextPath: string;
  }): Promise<{
    contextPath: string;
    contextKind: "pdf" | "image" | "text";
    bytes?: number;
    textChars?: number;
    part: LlmContentPart;
  }> => {
    const resolvedContextPath = options.contextPath.trim();
    const rawBytes = await readFile(
      resolveWorkspacePath(rootDir, resolvedContextPath),
    );
    if (rawBytes.length === 0) {
      throw new Error(
        `extract_text received an empty supporting file "${resolvedContextPath}".`,
      );
    }

    const contentType = resolveContentType(resolvedContextPath);
    const isTextContentType =
      typeof contentType === "string" &&
      (contentType.startsWith("text/") || contentType === "application/json");
    if (isTextContentType) {
      const decoded = rawBytes.toString("utf8").trim();
      const text = capUtf8Text(
        decoded,
        EXTRACT_TEXT_CONTEXT_TEXT_MAX_CHARS * 6,
      ).slice(0, EXTRACT_TEXT_CONTEXT_TEXT_MAX_CHARS);
      return {
        contextPath: resolvedContextPath,
        contextKind: "text",
        textChars: text.length,
        part: {
          type: "text",
          text: [
            "Supporting document text follows:",
            text.length > 0 ? text : "[empty]",
          ].join("\n"),
        },
      };
    }

    const looksLikePdf = rawBytes.subarray(0, 5).toString("utf8") === "%PDF-";
    if (looksLikePdf || contentType === "application/pdf") {
      const decoded = await decodePdfBytesFromWorkspace({
        toolName: "extract_text",
        pdfPath: resolvedContextPath,
      });
      if (decoded.pdfBytes.length > EXTRACT_TEXT_MAX_BYTES) {
        throw new Error(
          `extract_text supporting PDF is too large (${decoded.pdfBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes): "${decoded.resolvedPdfPath}".`,
        );
      }
      return {
        contextPath: decoded.resolvedPdfPath,
        contextKind: "pdf",
        bytes: decoded.pdfBytes.length,
        part: {
          type: "inlineData",
          data: decoded.pdfBytes.toString("base64"),
          mimeType: "application/pdf",
        },
      };
    }

    const sourceMimeFromPath =
      typeof contentType === "string" && contentType.startsWith("image/")
        ? contentType
        : undefined;
    let sourceMimeType = sourceMimeFromPath;
    if (!sourceMimeType) {
      const sharp = getSharp();
      const metadata = await sharp(rawBytes)
        .metadata()
        .catch((error) => {
          throw new Error(
            `extract_text could not decode supporting file "${resolvedContextPath}" as an image: ${errorAsString(error)}`,
          );
        });
      sourceMimeType = resolveImageMimeTypeFromSharpFormat({
        format: metadata.format,
      });
    }
    if (!isSupportedCropImageMimeType(sourceMimeType)) {
      throw new Error(
        `extract_text supporting files must be image/pdf/text. Received ${sourceMimeType ?? "unknown"} for "${resolvedContextPath}".`,
      );
    }
    if (typeof sourceMimeType !== "string") {
      throw new Error(
        `extract_text could not resolve image mime type for supporting file "${resolvedContextPath}".`,
      );
    }
    if (rawBytes.length > EXTRACT_TEXT_MAX_BYTES) {
      throw new Error(
        `extract_text supporting image is too large (${rawBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes): "${resolvedContextPath}".`,
      );
    }
    return {
      contextPath: resolvedContextPath,
      contextKind: "image",
      bytes: rawBytes.length,
      part: {
        type: "inlineData",
        data: rawBytes.toString("base64"),
        mimeType: sourceMimeType,
      },
    };
  };

  const extractTextToWorkspace = async (options: {
    documentPaths: readonly string[];
    outputPath: string;
    instructions?: string;
    supportingPaths?: readonly string[];
    supportingInstructions?: string;
  }): Promise<Record<string, unknown>> => {
    const resolvedOutputPath = options.outputPath.trim();
    if (resolvedOutputPath.endsWith(".json")) {
      throw new Error(
        `extract_text cannot write JSON ("${resolvedOutputPath}"). Write markdown (.md) instead.`,
      );
    }
    const normalizedDocumentPaths = Array.from(
      new Set(
        options.documentPaths
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
    if (normalizedDocumentPaths.length === 0) {
      throw new Error(
        [
          "extract_text requires documentPaths with at least one file path.",
          "Retry with payload shape:",
          '{"documentPaths":["source/<file>.png"],"outputPath":"output/<name>.md"}',
          "Do not retry unchanged arguments.",
        ].join(" "),
      );
    }
    if (normalizedDocumentPaths.length > EXTRACT_TEXT_MAX_DOCUMENT_FILES) {
      throw new Error(
        `extract_text supports at most ${EXTRACT_TEXT_MAX_DOCUMENT_FILES.toString()} documentPaths (got ${normalizedDocumentPaths.length.toString()}).`,
      );
    }
    const primaryDocuments = await Promise.all(
      normalizedDocumentPaths.map(
        async (documentPath) =>
          await resolveExtractTextPrimaryDocumentFromWorkspace({
            documentPath,
          }),
      ),
    );
    const primaryDocumentPathSet = new Set(
      primaryDocuments.map((item) => item.documentPath),
    );
    const supportingPaths = Array.from(
      new Set(
        (options.supportingPaths ?? [])
          .map((entry) => entry.trim())
          .filter(
            (entry) => entry.length > 0 && !primaryDocumentPathSet.has(entry),
          ),
      ),
    );
    if (supportingPaths.length > EXTRACT_TEXT_MAX_CONTEXT_FILES) {
      throw new Error(
        `extract_text supports at most ${EXTRACT_TEXT_MAX_CONTEXT_FILES.toString()} supportingPaths (got ${supportingPaths.length.toString()}).`,
      );
    }
    const supportingParts = await Promise.all(
      supportingPaths.map(
        async (contextPath) =>
          await resolveExtractTextContextPartFromWorkspace({ contextPath }),
      ),
    );

    const instructionText =
      typeof options.instructions === "string" &&
      options.instructions.trim().length > 0
        ? options.instructions.trim()
        : undefined;
    const supportingInstructionText =
      typeof options.supportingInstructions === "string" &&
      options.supportingInstructions.trim().length > 0
        ? options.supportingInstructions.trim()
        : undefined;
    const extractionPrompt = [
      "Transcribe the PRIMARY attached document files into markdown.",
      "You do not automatically know attachment filenames or paths unless they are written in text instructions.",
      "Do not summarize, solve, or rewrite content; preserve source wording and structure.",
      "Use markdown headings/lists where they match the document layout.",
      "For formulas/equations, use embedded LaTeX: inline '\\(...\\)', display '\\[...\\]'.",
      "Mark uncertain characters with short uncertainty markers (for example '[?]') instead of guessing.",
      "If the agent instructions request page markers for multi-page output, include them exactly as requested.",
      "Return markdown only.",
    ].join("\n");
    const primaryPrompt = [
      "Agent-supplied prompt (PRIMARY documents to transcribe):",
      instructionText ??
        "Transcribe all visible text from the primary documents.",
    ].join("\n");
    const supportingPrompt =
      supportingParts.length > 0
        ? [
            "Agent-supplied prompt (SUPPORTING documents for disambiguation only):",
            supportingInstructionText ?? EXTRACT_TEXT_DEFAULT_SUPPORTING_PROMPT,
          ].join("\n")
        : undefined;
    const extractionParts: LlmContentPart[] = [
      { type: "text", text: extractionPrompt },
      { type: "text", text: primaryPrompt },
      ...primaryDocuments.flatMap<LlmContentPart>((document, index) => {
        const label: LlmContentPart = {
          type: "text",
          text: `Primary document ${String(index + 1)} (${document.documentKind}) follows as inline data.`,
        };
        const payload: LlmContentPart = {
          type: "inlineData",
          data: document.documentBytes.toString("base64"),
          mimeType: document.documentMimeType,
        };
        return [label, payload];
      }),
      ...(supportingPrompt
        ? ([{ type: "text", text: supportingPrompt }] as LlmContentPart[])
        : []),
      ...supportingParts.flatMap<LlmContentPart>((item, index) => {
        const label =
          item.contextKind === "text"
            ? `Supporting document ${String(index + 1)} (text) follows.`
            : `Supporting document ${String(index + 1)} (${item.contextKind}) follows as inline data.`;
        return [{ type: "text", text: label } as LlmContentPart, item.part];
      }),
    ];
    const { promptText: renderedPromptWithInlineData, inlineAttachments } =
      renderExtractTextPromptWithInlineData({ parts: extractionParts });
    const primaryDocumentPathsForDebug = primaryDocuments.map(
      (item) => item.documentPath,
    );
    const supportingPathsForDebug = supportingParts.map(
      (item) => item.contextPath,
    );
    const extractionPromptText = [
      `documentPaths: ${JSON.stringify(primaryDocumentPathsForDebug)}`,
      ...(supportingPathsForDebug.length > 0
        ? [`supportingPaths: ${JSON.stringify(supportingPathsForDebug)}`]
        : []),
      "",
      renderedPromptWithInlineData,
    ].join("\n\n");
    const promptChars = extractionParts.reduce((sum, part) => {
      if (part.type !== "text") {
        return sum;
      }
      return sum + part.text.length;
    }, 0);

    const toolContext = getCurrentToolCallContext();
    const toolIdSegment = toolContext
      ? `turn${toolContext.turn}tool${toolContext.toolIndex}`
      : "turn0tool0";
    const extractTextLogPrefix = `[extract_text:${toolIdSegment}]`;
    const logExtractTextProgress = (message: string): void => {
      progress?.log(`${extractTextLogPrefix} ${message}`);
    };
    logExtractTextProgress(
      `start docs=${primaryDocuments.length.toString()} supporting=${supportingParts.length.toString()} promptChars=${promptChars.toString()} progress=${progress ? "yes" : "no"} debug=${debug ? "yes" : "no"}`,
    );
    const shouldPersistExtractTextDebugArtifacts =
      resolvedExtractTextDebugRootDir.trim().length > 0;
    if (shouldPersistExtractTextDebugArtifacts) {
      await persistExtractTextRequestDebugArtifacts({
        debugRootDir: resolvedExtractTextDebugRootDir,
        toolIdSegment,
        promptText: extractionPromptText,
        promptChars,
        modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        outputPath: resolvedOutputPath,
        documentPaths: primaryDocuments.map((item) => item.documentPath),
        supportingPaths: supportingParts.map((item) => item.contextPath),
        ...(typeof instructionText === "string" &&
        instructionText.trim().length > 0
          ? { instructions: instructionText }
          : {}),
        ...(typeof supportingInstructionText === "string" &&
        supportingInstructionText.trim().length > 0
          ? { supportingInstructions: supportingInstructionText }
          : {}),
        inlineAttachments,
      }).catch(() => undefined);
      logExtractTextProgress(
        `debug_request_written dir=${path.join("extract_text", toolIdSegment)}`,
      );
    }
    let streamedThinkingText = "";
    let lastThinkingTokensLogged: number | null = null;
    let llmResult: LlmTextResult | null = null;
    let extractedText = "";
    let modelCallElapsedMs: number | null = null;
    const callStartedAt = Date.now();
    let callHeartbeatTimer: NodeJS.Timeout | undefined;
    try {
      callHeartbeatTimer = setInterval(() => {
        const elapsedMs = Date.now() - callStartedAt;
        logExtractTextProgress(
          `waiting_for_model elapsedMs=${elapsedMs.toString()}`,
        );
      }, 15_000);
      logExtractTextProgress("generate_text_call started");
      llmResult = await generateText({
        model: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        input: buildSingleUserInput(extractionParts),
      });
      recordLlmTextResult({
        progress,
        modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        result: llmResult,
      });
      streamedThinkingText = llmResult.thoughts;
      extractedText = llmResult.text;
      logExtractTextProgress(
        `generate_text_call completed elapsedMs=${(Date.now() - callStartedAt).toString()} extractedChars=${extractedText.length.toString()}`,
      );
      modelCallElapsedMs = Date.now() - callStartedAt;
    } finally {
      if (callHeartbeatTimer) {
        clearInterval(callHeartbeatTimer);
      }
    }

    const normalizedText = extractedText.trim();
    const cappedText = capUtf8Text(
      normalizedText,
      EXTRACT_TEXT_DEFAULT_MAX_CHARS * 6,
    ).slice(0, EXTRACT_TEXT_DEFAULT_MAX_CHARS);
    const truncated = cappedText.length < normalizedText.length;
    const submodelSummary = llmResult
      ? createTrackedSubmodelCallSummary({
          modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
          startedAt: callStartedAt,
          result: llmResult,
        })
      : null;
    recordToolLlmCost(
      onToolLlmCost,
      "extract_text",
      submodelSummary?.costUsd ?? null,
    );
    const finalThinkingTokensRaw = submodelSummary?.usageTokens?.thinkingTokens;
    const finalThinkingTokens =
      typeof finalThinkingTokensRaw === "number" &&
      Number.isFinite(finalThinkingTokensRaw)
        ? Math.max(0, Math.floor(finalThinkingTokensRaw))
        : null;
    if (
      typeof finalThinkingTokens === "number" &&
      finalThinkingTokens > 0 &&
      finalThinkingTokens !== lastThinkingTokensLogged
    ) {
      logExtractTextProgress(
        `thinking_tokens=${finalThinkingTokens.toString()}`,
      );
    }
    const responseElapsedMs =
      typeof submodelSummary?.elapsedMs === "number" &&
      Number.isFinite(submodelSummary.elapsedMs)
        ? submodelSummary.elapsedMs
        : (modelCallElapsedMs ?? undefined);
    if (shouldPersistExtractTextDebugArtifacts) {
      await persistExtractTextResponseDebugArtifacts({
        debugRootDir: resolvedExtractTextDebugRootDir,
        toolIdSegment,
        responseText: extractedText,
        thinkingText: streamedThinkingText,
        modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        ...(typeof submodelSummary?.modelVersion === "string" &&
        submodelSummary.modelVersion.trim().length > 0
          ? { modelVersion: submodelSummary.modelVersion }
          : {}),
        ...(typeof responseElapsedMs === "number" &&
        Number.isFinite(responseElapsedMs)
          ? { elapsedMs: responseElapsedMs }
          : {}),
        ...(typeof submodelSummary?.costUsd === "number" &&
        Number.isFinite(submodelSummary.costUsd)
          ? { costUsd: submodelSummary.costUsd }
          : {}),
        usageTokens: submodelSummary?.usageTokens ?? null,
        thinkingTokens: finalThinkingTokens,
        streamedResponseChars: extractedText.length,
        streamedResponseBytes: Buffer.byteLength(extractedText, "utf8"),
      }).catch(() => undefined);
      logExtractTextProgress(
        `debug_response_written dir=${path.join("extract_text", toolIdSegment)}`,
      );
    }

    const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
    await ensureDir(path.dirname(resolved));
    await writeFile(resolved, cappedText, { encoding: "utf8" });
    workspace.scheduleUpdate(resolvedOutputPath);
    const outputBytes = Buffer.byteLength(cappedText, "utf8");

    return {
      status: "written",
      modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
      ...(submodelSummary?.modelVersion
        ? { modelVersion: submodelSummary.modelVersion }
        : {}),
      ...(submodelSummary?.elapsedMs !== undefined
        ? { elapsedMs: submodelSummary.elapsedMs }
        : {}),
      ...(typeof submodelSummary?.costUsd === "number"
        ? { costUsd: submodelSummary.costUsd }
        : {}),
      ...(submodelSummary?.usageTokens
        ? { usageTokens: submodelSummary.usageTokens }
        : {}),
      documentPaths: primaryDocuments.map((item) => item.documentPath),
      documentFiles: primaryDocuments.length,
      documentKinds: primaryDocuments.map((item) => item.documentKind),
      outputPath: resolvedOutputPath,
      promptChars,
      textChars: cappedText.length,
      outputBytes,
      sourceBytes: primaryDocuments.reduce(
        (sum, item) => sum + item.documentBytes.length,
        0,
      ),
      supportingPaths: supportingParts.map((item) => item.contextPath),
      supportingFiles: supportingParts.length,
      ...(instructionText ? { instructions: instructionText } : {}),
      ...(supportingInstructionText
        ? { supportingInstructions: supportingInstructionText }
        : {}),
      ...(primaryDocuments.length === 1
        ? {
            sourcePath: primaryDocuments[0].documentPath,
            sourceKind: primaryDocuments[0].documentKind,
            sourceMimeType: primaryDocuments[0].documentMimeType,
          }
        : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  };

  const PdfDiagramBoxSchema = z
    .object({
      left: z.number().min(0).max(1),
      top: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.left + value.width > 1.001) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxNorm.left + bboxNorm.width must be <= 1.",
          path: ["width"],
        });
      }
      if (value.top + value.height > 1.001) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxNorm.top + bboxNorm.height must be <= 1.",
          path: ["height"],
        });
      }
    });

  const PdfDiagramGridBoxSchema = z
    .object({
      left: z.number().int().min(0).max(1000),
      top: z.number().int().min(0).max(1000),
      right: z.number().int().min(0).max(1000),
      bottom: z.number().int().min(0).max(1000),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.right <= value.left) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bbox1000.right must be greater than bbox1000.left.",
          path: ["right"],
        });
      }
      if (value.bottom <= value.top) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bbox1000.bottom must be greater than bbox1000.top.",
          path: ["bottom"],
        });
      }
    });

  const PdfDiagramItemSchema = z
    .object({
      id: z.string().trim().min(1),
      problemId: z.string().trim().min(1),
      page: z.number().int().min(1),
      bboxNorm: PdfDiagramBoxSchema,
      bbox1000: PdfDiagramGridBoxSchema.optional(),
      label: z.string().trim().min(1).optional(),
      description: z.string().trim().min(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .strict();

  const PdfDiagramManifestSchema = z
    .object({
      diagrams: z.array(PdfDiagramItemSchema).max(PDF_DIAGRAM_MAX_ITEMS),
      notes: z.string().trim().min(1).optional(),
    })
    .strict();

  const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  const toFiniteInteger = (value: unknown): number | null => {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return null;
    }
    return Math.round(numeric);
  };

  const clamp1000 = (value: number): number => {
    return Math.max(0, Math.min(1000, value));
  };

  const toTrimmedString = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed;
  };

  const normalisePdfDiagramManifest = (
    raw: unknown,
    maxDiagrams: number,
  ): z.infer<typeof PdfDiagramManifestSchema> => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("extract_pdf_diagrams expected a JSON object.");
    }
    const rawRecord = raw as Record<string, unknown>;
    const rawDiagrams = rawRecord.diagrams;
    if (!Array.isArray(rawDiagrams)) {
      throw new Error(
        'extract_pdf_diagrams expected a "diagrams" array in model output.',
      );
    }
    const normalizedItems: z.infer<typeof PdfDiagramItemSchema>[] = [];
    for (const [index, rawEntry] of rawDiagrams.entries()) {
      if (
        !rawEntry ||
        typeof rawEntry !== "object" ||
        Array.isArray(rawEntry)
      ) {
        continue;
      }
      const entry = rawEntry as Record<string, unknown>;
      const bboxGridRaw =
        entry.bbox1000 &&
        typeof entry.bbox1000 === "object" &&
        !Array.isArray(entry.bbox1000)
          ? (entry.bbox1000 as Record<string, unknown>)
          : entry.bbox_int &&
              typeof entry.bbox_int === "object" &&
              !Array.isArray(entry.bbox_int)
            ? (entry.bbox_int as Record<string, unknown>)
            : null;
      const bboxRaw =
        entry.bboxNorm &&
        typeof entry.bboxNorm === "object" &&
        !Array.isArray(entry.bboxNorm)
          ? (entry.bboxNorm as Record<string, unknown>)
          : entry.bbox &&
              typeof entry.bbox === "object" &&
              !Array.isArray(entry.bbox)
            ? (entry.bbox as Record<string, unknown>)
            : null;
      if (!bboxRaw && !bboxGridRaw) {
        continue;
      }
      const left = bboxRaw ? toFiniteNumber(bboxRaw.left ?? bboxRaw.x) : null;
      const top = bboxRaw ? toFiniteNumber(bboxRaw.top ?? bboxRaw.y) : null;
      const width = bboxRaw ? toFiniteNumber(bboxRaw.width ?? bboxRaw.w) : null;
      const height = bboxRaw
        ? toFiniteNumber(bboxRaw.height ?? bboxRaw.h)
        : null;
      const page = toFiniteNumber(
        entry.page ?? entry.pageNumber ?? entry.page_number,
      );
      const problemId =
        toTrimmedString(entry.problemId ?? entry.problem ?? entry.problem_id) ??
        "unknown";
      const id =
        toTrimmedString(entry.id) ??
        `${problemId.toLowerCase()}-${(index + 1).toString()}`;
      if (page === null) {
        continue;
      }
      const label = toTrimmedString(entry.label);
      const description = toTrimmedString(entry.description);
      const confidence = toFiniteNumber(entry.confidence);
      let normalizedBbox: {
        left: number;
        top: number;
        width: number;
        height: number;
      } | null = null;
      let bbox1000:
        | {
            left: number;
            top: number;
            right: number;
            bottom: number;
          }
        | undefined;

      if (bboxGridRaw) {
        const leftGrid = toFiniteInteger(bboxGridRaw.left ?? bboxGridRaw.x0);
        const topGrid = toFiniteInteger(bboxGridRaw.top ?? bboxGridRaw.y0);
        const widthGrid = toFiniteInteger(bboxGridRaw.width ?? bboxGridRaw.w);
        const heightGrid = toFiniteInteger(bboxGridRaw.height ?? bboxGridRaw.h);
        const rightGrid =
          toFiniteInteger(bboxGridRaw.right ?? bboxGridRaw.x1) ??
          (leftGrid !== null && widthGrid !== null
            ? leftGrid + widthGrid
            : null);
        const bottomGrid =
          toFiniteInteger(bboxGridRaw.bottom ?? bboxGridRaw.y1) ??
          (topGrid !== null && heightGrid !== null
            ? topGrid + heightGrid
            : null);

        if (
          leftGrid !== null &&
          topGrid !== null &&
          rightGrid !== null &&
          bottomGrid !== null
        ) {
          const left1000 = clamp1000(leftGrid);
          const top1000 = clamp1000(topGrid);
          const right1000 = clamp1000(rightGrid);
          const bottom1000 = clamp1000(bottomGrid);
          if (right1000 > left1000 && bottom1000 > top1000) {
            bbox1000 = {
              left: left1000,
              top: top1000,
              right: right1000,
              bottom: bottom1000,
            };
            normalizedBbox = {
              left: left1000 / 1000,
              top: top1000 / 1000,
              width: (right1000 - left1000) / 1000,
              height: (bottom1000 - top1000) / 1000,
            };
          }
        }
      }

      if (normalizedBbox === null) {
        if (
          left === null ||
          top === null ||
          width === null ||
          height === null
        ) {
          continue;
        }
        normalizedBbox = {
          left,
          top,
          width,
          height,
        };
      }

      normalizedItems.push({
        id,
        problemId,
        page: Math.max(1, Math.round(page)),
        bboxNorm: normalizedBbox,
        ...(bbox1000 ? { bbox1000 } : {}),
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(confidence !== null
          ? { confidence: Math.max(0, Math.min(1, confidence)) }
          : {}),
      });
    }
    const notes = toTrimmedString(rawRecord.notes);
    const normalized: z.infer<typeof PdfDiagramManifestSchema> = {
      diagrams: normalizedItems.slice(0, Math.max(1, maxDiagrams)),
      ...(notes ? { notes } : {}),
    };
    const parsed = PdfDiagramManifestSchema.safeParse(normalized);
    if (!parsed.success) {
      const issueSummary = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `extract_pdf_diagrams returned invalid diagram manifest: ${issueSummary}`,
      );
    }
    return parsed.data;
  };

  const extractPdfTextToWorkspace = async (options: {
    toolName: "extract_pdf_text" | "read_pdf";
    pdfBytes: Uint8Array;
    outputPath: string;
    promptText: string;
    modelId?: string;
    maxChars?: number;
    sourceInfo: Record<string, unknown>;
  }): Promise<Record<string, unknown>> => {
    const resolvedOutputPath = options.outputPath.trim();
    if (resolvedOutputPath.endsWith(".json")) {
      throw new Error(
        `${options.toolName} cannot write JSON ("${resolvedOutputPath}").`,
      );
    }
    const pdfBytes = Buffer.from(options.pdfBytes);
    if (pdfBytes.length === 0) {
      throw new Error(`${options.toolName} received an empty PDF payload.`);
    }
    if (pdfBytes.length > PDF_EXTRACTION_MAX_BYTES) {
      throw new Error(
        `${options.toolName} PDF is too large (${pdfBytes.length.toString()} bytes, max ${PDF_EXTRACTION_MAX_BYTES.toString()} bytes).`,
      );
    }
    if (pdfBytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw new Error(
        `${options.toolName} expected PDF bytes (missing %PDF- header).`,
      );
    }

    const resolvedModelId = resolveTextModelId(
      options.modelId,
      DEFAULT_PDF_EXTRACTION_MODEL_ID,
    );
    const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);
    const extractionPrompt = [
      "Extract text from the attached PDF.",
      "Follow the user instructions exactly.",
      "Return plain text only.",
      "",
      "Instructions:",
      options.promptText,
    ].join("\n");
    const callStartedAt = Date.now();
    const llmResult = await generateText({
      model: resolvedModelId,
      input: buildSingleUserInput([
        { type: "text", text: extractionPrompt },
        {
          type: "inlineData",
          data: pdfBytes.toString("base64"),
          mimeType: "application/pdf",
        },
      ]),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
    recordLlmTextResult({
      progress,
      modelId: resolvedModelId,
      result: llmResult,
    });
    const extractedText = llmResult.text;

    const safeMaxChars = options.maxChars ?? PDF_EXTRACTION_DEFAULT_MAX_CHARS;
    const normalizedText = extractedText.trim();
    const cappedText = capUtf8Text(normalizedText, safeMaxChars * 6).slice(
      0,
      safeMaxChars,
    );
    const truncated = cappedText.length < normalizedText.length;
    const submodelSummary = createTrackedSubmodelCallSummary({
      modelId: resolvedModelId,
      startedAt: callStartedAt,
      result: llmResult,
    });
    recordToolLlmCost(onToolLlmCost, options.toolName, submodelSummary.costUsd);

    const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
    await ensureDir(path.dirname(resolved));
    await writeFile(resolved, cappedText, { encoding: "utf8" });
    workspace.scheduleUpdate(resolvedOutputPath);
    const outputBytes = Buffer.byteLength(cappedText, "utf8");

    return {
      status: "written",
      modelId: resolvedModelId,
      ...(submodelSummary?.modelVersion
        ? { modelVersion: submodelSummary.modelVersion }
        : {}),
      ...(submodelSummary?.elapsedMs !== undefined
        ? { elapsedMs: submodelSummary.elapsedMs }
        : {}),
      ...(typeof submodelSummary?.costUsd === "number"
        ? { costUsd: submodelSummary.costUsd }
        : {}),
      ...(submodelSummary?.usageTokens
        ? { usageTokens: submodelSummary.usageTokens }
        : {}),
      outputPath: resolvedOutputPath,
      promptChars: options.promptText.length,
      textChars: cappedText.length,
      outputBytes,
      pdfBytes: pdfBytes.length,
      ...(truncated ? { truncated: true } : {}),
      ...options.sourceInfo,
    };
  };

  const extractPdfDiagramManifestToWorkspace = async (options: {
    toolName: "extract_pdf_diagrams";
    pdfBytes: Uint8Array;
    outputPath: string;
    promptText: string;
    modelId?: string;
    maxDiagrams?: number;
    sourceInfo: Record<string, unknown>;
  }): Promise<Record<string, unknown>> => {
    const resolvedOutputPath = options.outputPath.trim();
    if (!resolvedOutputPath.endsWith(".json")) {
      throw new Error(
        `${options.toolName} outputPath must end with ".json" (got "${resolvedOutputPath}").`,
      );
    }
    const pdfBytes = Buffer.from(options.pdfBytes);
    if (pdfBytes.length === 0) {
      throw new Error(`${options.toolName} received an empty PDF payload.`);
    }
    if (pdfBytes.length > PDF_EXTRACTION_MAX_BYTES) {
      throw new Error(
        `${options.toolName} PDF is too large (${pdfBytes.length.toString()} bytes, max ${PDF_EXTRACTION_MAX_BYTES.toString()} bytes).`,
      );
    }
    if (pdfBytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw new Error(
        `${options.toolName} expected PDF bytes (missing %PDF- header).`,
      );
    }

    const safeMaxDiagrams = Math.max(
      1,
      Math.min(
        PDF_DIAGRAM_MAX_ITEMS,
        options.maxDiagrams ?? PDF_DIAGRAM_DEFAULT_MAX_ITEMS,
      ),
    );
    const resolvedModelId = resolveTextModelId(
      options.modelId,
      DEFAULT_PDF_EXTRACTION_MODEL_ID,
    );
    const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);
    const extractionPrompt = [
      "Extract diagram bounding boxes from the attached PDF.",
      "Return JSON only.",
      "",
      "Schema (exact keys):",
      "{",
      '  "diagrams": [',
      "    {",
      '      "id": "string",',
      '      "problemId": "string",',
      '      "page": 1,',
      '      "bbox1000": { "left": 0, "top": 0, "right": 1000, "bottom": 1000 },',
      '      "label": "string (optional)",',
      '      "description": "string (optional)",',
      '      "confidence": 0.0',
      "    }",
      "  ],",
      '  "notes": "string (optional)"',
      "}",
      "",
      "Rules:",
      "- page is 1-based page number.",
      "- bbox1000 uses integer coordinates on a 0..1000 grid per page axis.",
      "- left/top are top-left corner; right/bottom are bottom-right corner.",
      "- Use integers only for bbox1000 fields.",
      `- Return at most ${safeMaxDiagrams.toString()} diagram entries.`,
      "- Include only diagrams relevant to the user instructions.",
      "",
      "User instructions:",
      options.promptText,
    ].join("\n");

    const callStartedAt = Date.now();
    const llmResult = await generateText({
      model: resolvedModelId,
      input: buildSingleUserInput([
        { type: "text", text: extractionPrompt },
        {
          type: "inlineData",
          data: pdfBytes.toString("base64"),
          mimeType: "application/pdf",
        },
      ]),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      responseMimeType: "application/json",
    });
    recordLlmTextResult({
      progress,
      modelId: resolvedModelId,
      result: llmResult,
    });
    const rawText = llmResult.text;

    let parsedRaw: unknown;
    try {
      parsedRaw = parseJsonFromLlmText(rawText);
    } catch (error) {
      throw new Error(
        `extract_pdf_diagrams returned invalid JSON: ${errorAsString(error)}`,
      );
    }
    const manifest = normalisePdfDiagramManifest(parsedRaw, safeMaxDiagrams);
    const formatted = JSON.stringify(manifest, null, 2) + "\n";
    const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
    await ensureDir(path.dirname(resolved));
    await writeFile(resolved, formatted, { encoding: "utf8" });
    workspace.scheduleUpdate(resolvedOutputPath);
    const submodelSummary = createTrackedSubmodelCallSummary({
      modelId: resolvedModelId,
      startedAt: callStartedAt,
      result: llmResult,
    });
    recordToolLlmCost(
      onToolLlmCost,
      "extract_pdf_diagrams",
      submodelSummary.costUsd,
    );
    const outputBytes = Buffer.byteLength(formatted, "utf8");

    return {
      status: "written",
      modelId: resolvedModelId,
      ...(submodelSummary?.modelVersion
        ? { modelVersion: submodelSummary.modelVersion }
        : {}),
      ...(submodelSummary?.elapsedMs !== undefined
        ? { elapsedMs: submodelSummary.elapsedMs }
        : {}),
      ...(typeof submodelSummary?.costUsd === "number"
        ? { costUsd: submodelSummary.costUsd }
        : {}),
      ...(submodelSummary?.usageTokens
        ? { usageTokens: submodelSummary.usageTokens }
        : {}),
      outputPath: resolvedOutputPath,
      promptChars: options.promptText.length,
      outputBytes,
      pdfBytes: pdfBytes.length,
      diagramCount: manifest.diagrams.length,
      ...options.sourceInfo,
    };
  };

  const filesystemToolSet = createFilesystemToolSetForModel(
    DEFAULT_AGENT_MODEL_ID,
    {
      cwd: rootDir,
      allowOutsideCwd: false,
    },
  );
  const requireFilesystemTool = (
    toolName: "read_file" | "view_image",
  ): LlmToolSet[string] => {
    const candidate = (filesystemToolSet as LlmToolSet)[toolName];
    if (!candidate) {
      throw new Error(
        `Missing filesystem tool "${toolName}" in @ljoukov/llm toolset.`,
      );
    }
    return candidate;
  };
  const codexReadFileTool = requireFilesystemTool("read_file");
  const codexViewImageTool = requireFilesystemTool("view_image");
  const executeCodexReadFile = async (input: {
    file_path: string;
    offset?: number | null;
    limit?: number | null;
  }): Promise<unknown> => {
    return await (
      codexReadFileTool as { execute: (value: unknown) => Promise<unknown> }
    ).execute(input);
  };

  const tools: LlmToolSet = {
    publish_lesson: tool({
      description:
        "Publish a Spark lesson into the user's sessions (not welcome templates). Reads Firestore-ready JSON from the workspace and writes session + quiz/coding_problem documents to Firestore.",
      inputSchema: z
        .object({
          sessionId: z.string().trim().min(1),
          sessionPath: z.string().trim().min(1).optional(),
          briefPath: z.string().trim().min(1).optional(),
          includeStory: z.boolean().optional(),
          includeCoding: z.boolean().optional(),
        })
        .strict(),
      execute: async ({
        sessionId,
        sessionPath,
        briefPath,
        includeStory,
        includeCoding,
      }) => {
        const resolvedSessionPath = sessionPath ?? "lesson/output/session.json";
        const resolvedBriefPath = briefPath ?? "brief.md";

        const docPath = `spark/${userId}/sessions/${sessionId}`;
        const existing = await getFirestoreDocument({
          serviceAccountJson,
          documentPath: docPath,
        }).catch(() => ({ exists: false, data: null }));
        const existingSession =
          existing.exists && existing.data
            ? SessionSchema.safeParse({
                id: sessionId,
                ...existing.data,
              })
            : null;
        const createdAt =
          existingSession && existingSession.success
            ? existingSession.data.createdAt
            : new Date();
        const titleFallback =
          existingSession && existingSession.success
            ? existingSession.data.title
            : undefined;
        const topicsFallback =
          existingSession && existingSession.success
            ? existingSession.data.topics
            : undefined;

        try {
          const bundle = await validateLessonWorkspaceForPublish({
            rootDir,
            sessionId,
            sessionPath: resolvedSessionPath,
            briefPath: resolvedBriefPath,
            createdAt,
            titleFallback,
            topicsFallback,
            includeStory,
            includeCoding,
            enforceLessonPipeline: shouldEnforceLessonPipeline,
          });
          await setFirestoreDocument({
            serviceAccountJson,
            documentPath: docPath,
            data: bundle.session as unknown as Record<string, unknown>,
          });

          await Promise.all(
            bundle.quizzes.map(async (quiz) => {
              const validated = QuizDefinitionSchema.parse(quiz);
              await setFirestoreDocument({
                serviceAccountJson,
                documentPath: `${docPath}/quiz/${validated.id}`,
                data: validated as unknown as Record<string, unknown>,
              });
            }),
          );

          await Promise.all(
            bundle.problems.map(async (problem) => {
              const validated = CodeProblemSchema.parse(problem);
              await setFirestoreDocument({
                serviceAccountJson,
                documentPath: `${docPath}/code/${validated.slug}`,
                data: validated as unknown as Record<string, unknown>,
              });
            }),
          );

          await Promise.all(
            bundle.media.map(async (item) => {
              const validated = SessionMediaDocSchema.parse(item);
              await setFirestoreDocument({
                serviceAccountJson,
                documentPath: `${docPath}/media/${validated.id}`,
                data: validated as unknown as Record<string, unknown>,
              });
            }),
          );

          return {
            status: "published",
            sessionId,
            includeStory: includeStory ?? null,
            includeCoding: includeCoding ?? null,
            quizCount: bundle.quizzes.length,
            problemCount: bundle.problems.length,
            mediaCount: bundle.media.length,
            href: `/spark/lesson/${sessionId}`,
          };
        } catch (error) {
          await patchFirestoreDocument({
            serviceAccountJson,
            documentPath: docPath,
            updates: { status: "error" },
          }).catch(() => undefined);
          throw error;
        }
      },
    }),
    validate_json,
    validate_schema: validate_json,
    python_exec: tool({
      description:
        "Run a Python script via Pyodide. Reads scriptPath (required) from the workspace, optionally feeds stdin from stdinPath, and optionally writes stdout/stderr to stdoutPath/stderrPath (workspace paths).",
      inputSchema: z
        .object({
          scriptPath: z.string().trim().min(1),
          stdinPath: z.string().trim().min(1).optional(),
          stdoutPath: z.string().trim().min(1).optional(),
          stderrPath: z.string().trim().min(1).optional(),
          indexURL: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({
        scriptPath,
        stdinPath,
        stdoutPath,
        stderrPath,
        indexURL,
      }) => {
        const python = await ensurePythonRuntime(indexURL);
        const resolvedScriptPath = resolveWorkspacePath(rootDir, scriptPath);
        const scriptSource = await readFile(resolvedScriptPath, {
          encoding: "utf8",
        });
        const stdinText =
          stdinPath && stdinPath.trim().length > 0
            ? await readFile(resolveWorkspacePath(rootDir, stdinPath), {
                encoding: "utf8",
              })
            : "";

        const wrapper = [
          "import io",
          "import json",
          "import sys",
          "import traceback",
          `script_source = ${JSON.stringify(scriptSource)}`,
          `stdin_text = ${JSON.stringify(stdinText)}`,
          "stdout_buffer = io.StringIO()",
          "stderr_buffer = io.StringIO()",
          "original_stdin = sys.stdin",
          "original_stdout = sys.stdout",
          "original_stderr = sys.stderr",
          "ok = True",
          "try:",
          "    sys.stdin = io.StringIO(stdin_text)",
          "    sys.stdout = stdout_buffer",
          "    sys.stderr = stderr_buffer",
          "    env = {'__name__': '__main__'}",
          "    exec(script_source, env)",
          "except Exception:",
          "    ok = False",
          "    traceback.print_exc(file=stderr_buffer)",
          "finally:",
          "    sys.stdin = original_stdin",
          "    sys.stdout = original_stdout",
          "    sys.stderr = original_stderr",
          "json.dumps({'ok': ok, 'stdout': stdout_buffer.getvalue(), 'stderr': stderr_buffer.getvalue()})",
        ].join("\n");

        let raw: unknown;
        try {
          raw = await python.runPythonAsync(wrapper);
        } catch (error) {
          raw = JSON.stringify({
            ok: false,
            stdout: "",
            stderr: errorAsString(error),
          });
        }

        let parsed: { ok?: unknown; stdout?: unknown; stderr?: unknown } = {};
        if (typeof raw === "string") {
          try {
            parsed = JSON.parse(raw) as typeof parsed;
          } catch {
            parsed = { ok: false, stdout: "", stderr: String(raw) };
          }
        } else {
          parsed = { ok: false, stdout: "", stderr: String(raw) };
        }

        const ok = parsed.ok === true;
        const stdout = typeof parsed.stdout === "string" ? parsed.stdout : "";
        const stderr = typeof parsed.stderr === "string" ? parsed.stderr : "";

        const written: string[] = [];
        if (stdoutPath) {
          const resolved = resolveWorkspacePath(rootDir, stdoutPath);
          await writeFile(resolved, stdout, { encoding: "utf8" });
          workspace.scheduleUpdate(stdoutPath);
          written.push(stdoutPath);
        }
        if (stderrPath) {
          const resolved = resolveWorkspacePath(rootDir, stderrPath);
          await writeFile(resolved, stderr, { encoding: "utf8" });
          workspace.scheduleUpdate(stderrPath);
          written.push(stderrPath);
        }

        const truncate = (value: string): string => {
          const max = 8_000;
          if (value.length <= max) {
            return value;
          }
          return `${value.slice(0, max)}…`;
        };

        return {
          ok,
          stdout: stdoutPath ? undefined : truncate(stdout),
          stderr: stderrPath ? undefined : truncate(stderr),
          stdoutBytes: Buffer.byteLength(stdout, "utf8"),
          stderrBytes: Buffer.byteLength(stderr, "utf8"),
          written,
        };
      },
    }),
    generate_text: tool({
      description: [
        "Generate text (Markdown) using a sub-model.",
        "",
        "Reads promptPath from the workspace and expands {{relative/path}} placeholders by inlining referenced workspace files.",
        "",
        "Important:",
        "- This tool is NOT for JSON outputs. Use generate_json + validate_json for JSON files.",
        "- outputPath must NOT end with .json (generate_text will reject it).",
        "",
        "If the generated text contains a line like `pass: true|false` (used by lesson grading prompts),",
        "the tool will include `gradePass: true|false` in its return value so you can decide whether to revise",
        "without reading the grading file back.",
        "",
        "Batching:",
        "- If you need to draft/grade multiple independent items (e.g. quizzes q1 and q2), call generate_text multiple times in the SAME step with distinct outputPath values (they will run in parallel).",
        "",
        "Inputs:",
        "- promptPath (required): Workspace path to a prompt template (usually under lesson/prompts/).",
        "- outputPath (required): Where to write the generated Markdown.",
        "- inputPaths (optional): Extra workspace files to attach under an 'Attached files' section.",
        "- outputMode (optional): overwrite|append (default overwrite).",
        "- tools (optional): web-search|code-execution.",
      ].join("\n"),
      inputSchema: (() => {
        const normalizeOptionalString = (
          value: unknown,
        ): string | undefined => {
          if (value === null || value === undefined) {
            return undefined;
          }
          if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          }
          return undefined;
        };

        const normalizeOptionalStringArray = (
          value: unknown,
        ): string[] | undefined => {
          if (value === null || value === undefined) {
            return undefined;
          }

          const rawItems = Array.isArray(value) ? value : [value];
          const items: string[] = [];
          for (const raw of rawItems) {
            if (typeof raw !== "string") {
              continue;
            }
            const trimmed = raw.trim();
            if (trimmed.length === 0) {
              continue;
            }
            items.push(trimmed);
          }

          return items.length > 0 ? items : undefined;
        };

        const toolTypes = ["web-search", "code-execution"] as const;
        type ToolType = (typeof toolTypes)[number];

        const normalizeToolTypes = (value: unknown): ToolType[] | undefined => {
          const entries = normalizeOptionalStringArray(value);
          if (!entries) {
            return undefined;
          }

          const filtered: ToolType[] = [];
          for (const entry of entries) {
            if (entry === "web-search" || entry === "code-execution") {
              filtered.push(entry);
            }
          }

          return filtered.length > 0 ? filtered : undefined;
        };

        const outputPathSchema = z.preprocess(
          (value) => normalizeOptionalString(value),
          z
            .string({ error: "outputPath is required" })
            .trim()
            .min(1, "outputPath is required"),
        );

        const schema = z
          .object({
            promptPath: z
              .string({ error: "promptPath is required" })
              .trim()
              .min(1, "promptPath is required"),
            inputPaths: z.preprocess(
              (value) => normalizeOptionalStringArray(value),
              z.array(z.string().trim().min(1)).optional(),
            ),
            tools: z.preprocess(
              (value) => normalizeToolTypes(value),
              z.array(z.enum(toolTypes)).optional(),
            ),
            outputPath: outputPathSchema,
            outputMode: z.preprocess(
              (value) => normalizeOptionalString(value),
              z.enum(["overwrite", "append"]).optional(),
            ),
          })
          .strict();

        return schema;
      })(),
      execute: async ({
        promptPath,
        inputPaths,
        tools,
        outputPath,
        outputMode,
      }) => {
        const resolvedModelId: LlmTextModelId = DEFAULT_GENERATE_TEXT_MODEL_ID;
        const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);

        const resolvedPromptPath = promptPath.trim();
        const resolvedOutputPath = outputPath.trim();

        if (resolvedOutputPath.endsWith(".json")) {
          throw new Error(
            `generate_text cannot write JSON ("${resolvedOutputPath}"). Use generate_json instead.`,
          );
        }

        const normalizeSlashes = (value: string): string =>
          value.replace(/\\/g, "/").trim();

        const normalizedPromptPath =
          normalizeSlashes(resolvedPromptPath).toLowerCase();
        const promptFileName = normalizedPromptPath.split("/").at(-1) ?? "";
        const normalizedOutputPath = normalizeSlashes(resolvedOutputPath);
        let effectiveInputPaths = (inputPaths ?? []).map((p) =>
          normalizeSlashes(p),
        );

        const dedupePaths = (paths: string[]): string[] => {
          const seen = new Set<string>();
          const result: string[] = [];
          for (const entry of paths) {
            const trimmed = entry.trim();
            if (trimmed.length === 0 || seen.has(trimmed)) {
              continue;
            }
            seen.add(trimmed);
            result.push(trimmed);
          }
          return result;
        };

        const hasAttachedPathWithPrefix = (prefix: string): boolean => {
          const normalizedPrefix = prefix.replace(/\\/g, "/");
          return effectiveInputPaths.some((p) =>
            p.startsWith(normalizedPrefix),
          );
        };

        const isLessonPrompt =
          normalizedPromptPath.startsWith("lesson/prompts/");

        if (isLessonPrompt) {
          const requireQuizDraft =
            promptFileName === "quiz-grade.md" ||
            promptFileName === "quiz-revise.md";
          const requireCodeDraft =
            promptFileName === "code-grade.md" ||
            promptFileName === "code-revise.md";
          const requireQuizGradeReport = promptFileName === "quiz-revise.md";
          const requireCodeGradeReport = promptFileName === "code-revise.md";

          // Best-effort auto-attachment based on naming conventions to keep the agent from
          // spinning when it forgets inputPaths.
          if (
            (promptFileName === "quiz-grade.md" ||
              promptFileName === "quiz-revise.md") &&
            !hasAttachedPathWithPrefix("lesson/drafts/quiz/")
          ) {
            const match =
              promptFileName === "quiz-grade.md"
                ? normalizedOutputPath.match(
                    /^lesson\/feedback\/quiz\/([^/]+)-grade\.md$/u,
                  )
                : normalizedOutputPath.match(
                    /^lesson\/drafts\/quiz\/([^/]+)\.md$/u,
                  );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/drafts/quiz/${planItemId}.md`,
              ]);
            }
          }
          if (
            (promptFileName === "code-grade.md" ||
              promptFileName === "code-revise.md") &&
            !hasAttachedPathWithPrefix("lesson/drafts/code/")
          ) {
            const match =
              promptFileName === "code-grade.md"
                ? normalizedOutputPath.match(
                    /^lesson\/feedback\/code\/([^/]+)-grade\.md$/u,
                  )
                : normalizedOutputPath.match(
                    /^lesson\/drafts\/code\/([^/]+)\.md$/u,
                  );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/drafts/code/${planItemId}.md`,
              ]);
            }
          }
          if (
            promptFileName === "quiz-revise.md" &&
            !hasAttachedPathWithPrefix("lesson/feedback/quiz/")
          ) {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/quiz\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/feedback/quiz/${planItemId}-grade.md`,
              ]);
            }
          }
          if (
            promptFileName === "code-revise.md" &&
            !hasAttachedPathWithPrefix("lesson/feedback/code/")
          ) {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/code\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/feedback/code/${planItemId}-grade.md`,
              ]);
            }
          }

          if (
            requireQuizDraft &&
            !hasAttachedPathWithPrefix("lesson/drafts/quiz/")
          ) {
            throw new Error(
              "lesson quiz grade/revise prompts require inputPaths that include the candidate quiz Markdown under lesson/drafts/quiz/ (e.g. lesson/drafts/quiz/q1.md).",
            );
          }
          if (
            requireCodeDraft &&
            !hasAttachedPathWithPrefix("lesson/drafts/code/")
          ) {
            throw new Error(
              "lesson code grade/revise prompts require inputPaths that include the candidate problem Markdown under lesson/drafts/code/ (e.g. lesson/drafts/code/p1.md).",
            );
          }
          if (
            requireQuizGradeReport &&
            !hasAttachedPathWithPrefix("lesson/feedback/quiz/")
          ) {
            throw new Error(
              "lesson quiz revise prompts require inputPaths that include the grading report under lesson/feedback/quiz/ (e.g. lesson/feedback/quiz/q1-grade.md).",
            );
          }
          if (
            requireCodeGradeReport &&
            !hasAttachedPathWithPrefix("lesson/feedback/code/")
          ) {
            throw new Error(
              "lesson code revise prompts require inputPaths that include the grading report under lesson/feedback/code/ (e.g. lesson/feedback/code/p1-grade.md).",
            );
          }
        }

        const promptTemplate = await readFile(
          resolveWorkspacePath(rootDir, resolvedPromptPath),
          { encoding: "utf8" },
        );
        const expanded = await expandPromptTemplate({
          template: promptTemplate,
          rootDir,
        });
        let promptText = expanded.text;

        if (isLessonPrompt) {
          if (promptFileName === "quiz-draft.md") {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/quiz\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              promptText = [
                "# Tool instruction",
                `Target plan item id: ${planItemId}`,
                `You MUST draft the quiz for planItemId="${planItemId}" and set the Quiz planItemId field exactly to "${planItemId}".`,
                "Match the content to the session plan section for this plan item id.",
                "",
                promptText,
              ].join("\n");
            }
          }
          if (promptFileName === "code-draft.md") {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/code\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              promptText = [
                "# Tool instruction",
                `Target plan item id: ${planItemId}`,
                `You MUST draft the code problem for planItemId="${planItemId}" (even if the Markdown format does not include planItemId, the content must match this plan item).`,
                "Match the content to the session plan section for this plan item id.",
                "",
                promptText,
              ].join("\n");
            }
          }
        }
        if (effectiveInputPaths.length > 0) {
          const attachments = await Promise.all(
            effectiveInputPaths.map(async (inputPath) => {
              const resolved = resolveWorkspacePath(rootDir, inputPath);
              const content = await readFile(resolved, { encoding: "utf8" });
              return { path: inputPath, content };
            }),
          );
          promptText += "\n\n---\n\n# Attached files\n";
          for (const file of attachments) {
            promptText += `\n\n## ${file.path}\n\n${file.content.trimEnd()}\n`;
          }
        }

        const toolConfigs: LlmToolConfig[] = [];
        for (const toolType of tools ?? []) {
          if (toolType === "web-search") {
            toolConfigs.push({ type: "web-search", mode: "live" });
            continue;
          }
          toolConfigs.push({ type: toolType });
        }

        const callStartedAt = Date.now();
        const llmResult = await generateText({
          model: resolvedModelId,
          input: buildSingleUserInput([{ type: "text", text: promptText }]),
          ...(toolConfigs.length > 0 ? { tools: toolConfigs } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
        recordLlmTextResult({
          progress,
          modelId: resolvedModelId,
          result: llmResult,
        });
        const submodelSummary = createTrackedSubmodelCallSummary({
          modelId: resolvedModelId,
          startedAt: callStartedAt,
          result: llmResult,
        });
        recordToolLlmCost(
          onToolLlmCost,
          "generate_text",
          submodelSummary.costUsd,
        );

        const formatted = llmResult.text;
        const gradePass = (() => {
          const match = formatted.match(
            /(?:^|\n)\s*pass\s*:\s*(true|false)\s*(?:\n|$)/iu,
          );
          if (!match) {
            return undefined;
          }
          return match[1]?.toLowerCase() === "true";
        })();

        const mode = outputMode ?? "overwrite";
        const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
        await ensureDir(path.dirname(resolved));
        let outputBytes = 0;
        if (mode === "append") {
          const existing = await readFile(resolved, {
            encoding: "utf8",
          }).catch(() => "");
          const combined = existing + formatted;
          outputBytes = Buffer.byteLength(combined, "utf8");
          await writeFile(resolved, combined, {
            encoding: "utf8",
          });
        } else {
          outputBytes = Buffer.byteLength(formatted, "utf8");
          await writeFile(resolved, formatted, { encoding: "utf8" });
        }
        workspace.scheduleUpdate(resolvedOutputPath);
        return {
          status: "written",
          modelId: resolvedModelId,
          ...(submodelSummary?.modelVersion
            ? { modelVersion: submodelSummary.modelVersion }
            : {}),
          ...(submodelSummary?.elapsedMs !== undefined
            ? { elapsedMs: submodelSummary.elapsedMs }
            : {}),
          ...(typeof submodelSummary?.costUsd === "number"
            ? { costUsd: submodelSummary.costUsd }
            : {}),
          ...(submodelSummary?.usageTokens
            ? { usageTokens: submodelSummary.usageTokens }
            : {}),
          promptPath: resolvedPromptPath,
          inputPaths: effectiveInputPaths,
          outputPath: resolvedOutputPath,
          outputMode: mode,
          promptTemplateReplacements: expanded.replacements,
          textChars: formatted.length,
          outputBytes,
          ...(gradePass === undefined ? {} : { gradePass }),
        };
      },
    }),
    generate_json: tool({
      description: [
        "Generate JSON from a source workspace file using a sub-model.",
        "Reads sourcePath and schemaPath from the workspace and writes pretty-printed JSON to outputPath.",
        "",
        "Important:",
        "- This tool does NOT validate the JSON against the schema. After generation, call validate_json({ schemaPath, inputPath: outputPath }).",
        "- schemaPath is included as guidance only (no Structured Outputs enforcement).",
        "- outputPath must end with .json.",
        "",
        "Batching:",
        "- If you need to generate multiple JSON outputs (e.g. session + q1 + q2), call generate_json once per outputPath in the SAME step (they will run in parallel).",
        "",
        "Inputs:",
        "- sourcePath (required): The Markdown/text source file to convert into JSON.",
        "- schemaPath (required): JSON schema file to include as guidance for shape/fields.",
        "- outputPath (required): Where to write the generated JSON.",
      ].join("\n"),
      inputSchema: z
        .object({
          sourcePath: z.string().trim().min(1),
          schemaPath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
        })
        .strict(),
      execute: async ({ sourcePath, schemaPath, outputPath }) => {
        const resolvedModelId: LlmTextModelId = DEFAULT_GENERATE_TEXT_MODEL_ID;
        const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);

        const resolvedSourcePath = sourcePath.trim();
        const resolvedSchemaPath = schemaPath.trim();
        const resolvedOutputPath = outputPath.trim();

        if (!resolvedOutputPath.endsWith(".json")) {
          throw new Error(
            `generate_json outputPath must end with ".json" (got "${resolvedOutputPath}").`,
          );
        }

        const schemaText = await readFile(
          resolveWorkspacePath(rootDir, resolvedSchemaPath),
          { encoding: "utf8" },
        );
        const sourceText = await readFile(
          resolveWorkspacePath(rootDir, resolvedSourcePath),
          { encoding: "utf8" },
        );

        const promptText = [
          "You are converting a source document into Firestore-ready JSON.",
          "",
          "Return JSON only (start with `{` and end with `}`). Do not wrap in Markdown fences.",
          "Use the schema as guidance, but do not invent facts that are not supported by the source.",
          "",
          `Schema (${resolvedSchemaPath}):`,
          schemaText.trimEnd(),
          "",
          `Source (${resolvedSourcePath}):`,
          sourceText.trimEnd(),
        ].join("\n");

        const callStartedAt = Date.now();
        const llmResult = await generateText({
          model: resolvedModelId,
          input: buildSingleUserInput([{ type: "text", text: promptText }]),
          ...(thinkingLevel ? { thinkingLevel } : {}),
          responseMimeType: "application/json",
        });
        recordLlmTextResult({
          progress,
          modelId: resolvedModelId,
          result: llmResult,
        });
        const submodelSummary = createTrackedSubmodelCallSummary({
          modelId: resolvedModelId,
          startedAt: callStartedAt,
          result: llmResult,
        });
        recordToolLlmCost(
          onToolLlmCost,
          "generate_json",
          submodelSummary.costUsd,
        );

        let parsed: unknown;
        try {
          parsed = parseJsonFromLlmText(llmResult.text);
        } catch (error) {
          throw new Error(
            `generate_json returned invalid JSON: ${errorAsString(error)}`,
          );
        }

        const formatted = JSON.stringify(parsed, null, 2) + "\n";
        const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
        await ensureDir(path.dirname(resolved));
        await writeFile(resolved, formatted, { encoding: "utf8" });
        workspace.scheduleUpdate(resolvedOutputPath);
        const outputBytes = Buffer.byteLength(formatted, "utf8");

        return {
          status: "written",
          modelId: resolvedModelId,
          ...(submodelSummary?.modelVersion
            ? { modelVersion: submodelSummary.modelVersion }
            : {}),
          ...(submodelSummary?.elapsedMs !== undefined
            ? { elapsedMs: submodelSummary.elapsedMs }
            : {}),
          ...(typeof submodelSummary?.costUsd === "number"
            ? { costUsd: submodelSummary.costUsd }
            : {}),
          ...(submodelSummary?.usageTokens
            ? { usageTokens: submodelSummary.usageTokens }
            : {}),
          schemaPath: resolvedSchemaPath,
          sourcePath: resolvedSourcePath,
          outputPath: resolvedOutputPath,
          textChars: formatted.length,
          outputBytes,
        };
      },
    }),
    web_fetch: tool({
      description: [
        "Fetch a NON-PDF URL and return extracted text or binary metadata.",
        "Use this to download HTML/text sources found via web_search.",
        "For HTML responses, this tool returns stripped plain text.",
        "For non-text responses (except PDFs), this tool returns metadata and optionally writes base64 to outputPath.",
        "Do not use this tool for PDFs; place PDFs in the workspace and use pdf_to_images.",
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.string().trim().min(1),
          outputPath: z.string().trim().min(1).optional(),
          maxChars: z.number().int().min(200).max(200_000).optional(),
        })
        .strict(),
      execute: async ({ url, outputPath, maxChars }) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(
            `web_fetch supports only http/https URLs (got "${parsed.protocol}").`,
          );
        }
        if (parsed.pathname.toLowerCase().endsWith(".pdf")) {
          throw new Error(
            `web_fetch does not support PDF URLs ("${url}"). Place the PDF in workspace and use pdf_to_images.`,
          );
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, WEB_FETCH_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(parsed.toString(), {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const bytes = await readResponseBytesWithLimit(
          response,
          WEB_FETCH_MAX_BYTES,
        );
        const contentTypeHeader = response.headers.get("content-type");
        const contentType = contentTypeHeader
          ? (contentTypeHeader.split(";")[0]?.trim().toLowerCase() ??
            "application/octet-stream")
          : "application/octet-stream";
        const finalUrl = response.url || parsed.toString();
        const safeMaxChars = maxChars ?? WEB_FETCH_DEFAULT_MAX_CHARS;
        if (contentType === "application/pdf") {
          throw new Error(
            `web_fetch received PDF content from "${finalUrl}". Place the PDF in workspace and use pdf_to_images.`,
          );
        }

        const asText = () => {
          const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
            bytes,
          );
          if (
            contentType === "text/html" ||
            contentType === "application/xhtml+xml"
          ) {
            return decodeHtmlToText(decoded);
          }
          return decoded.trim();
        };

        const isLikelyText =
          contentType.startsWith("text/") ||
          contentType.includes("json") ||
          contentType.includes("xml") ||
          contentType.includes("html");

        if (isLikelyText) {
          const text = capUtf8Text(asText(), safeMaxChars * 6).slice(
            0,
            safeMaxChars,
          );
          if (outputPath) {
            const resolved = resolveWorkspacePath(rootDir, outputPath);
            await ensureDir(path.dirname(resolved));
            await writeFile(resolved, text, { encoding: "utf8" });
            workspace.scheduleUpdate(outputPath);
          }
          return {
            status: response.status,
            ok: response.ok,
            url: parsed.toString(),
            finalUrl,
            contentType,
            bytes: bytes.byteLength,
            text,
            ...(outputPath ? { outputPath } : {}),
          };
        }

        const base64 = Buffer.from(bytes).toString("base64");
        if (outputPath) {
          const resolved = resolveWorkspacePath(rootDir, outputPath);
          await ensureDir(path.dirname(resolved));
          await writeFile(resolved, base64, { encoding: "utf8" });
          workspace.scheduleUpdate(outputPath);
        }
        return {
          status: response.status,
          ok: response.ok,
          url: parsed.toString(),
          finalUrl,
          contentType,
          bytes: bytes.byteLength,
          base64Chars: base64.length,
          ...(outputPath ? { outputPath } : {}),
        };
      },
    }),
    extract_text: tool({
      description: [
        "Extract text from one or more workspace image/PDF documents and write markdown output.",
        `Always uses ${DEFAULT_EXTRACT_TEXT_MODEL_ID} (model cannot be overridden).`,
        "Required fields: documentPaths and outputPath.",
        "Always include documentPaths with 1+ primary transcription target documents.",
        'Minimal payload example: {"documentPaths":["source/student-work.png"],"outputPath":"output/transcription.md"}',
        "Do not repeat an identical call for the same documentPaths/outputPath; read the written markdown file and continue from it.",
        'Use instructions to narrow scope (for example: "problems H1 and H2 only").',
        "Use supportingPaths to add extra context files (images, PDFs, or text documents).",
        "Use supportingInstructions to explain how supporting documents should be used for disambiguation.",
        "The model does not know filenames unless you include identifying details in instructions text.",
        "For multi-page tasks, ask for explicit page markers in instructions when needed.",
        "For formulas/equations, output embedded LaTeX: inline '\\(...\\)', display '\\[...\\]'.",
      ].join("\n"),
      inputSchema: z
        .object({
          documentPaths: z
            .array(z.string().trim().min(1))
            .min(1)
            .max(EXTRACT_TEXT_MAX_DOCUMENT_FILES),
          outputPath: z.string().trim().min(1),
          instructions: z.string().trim().min(1).optional().nullable(),
          supportingPaths: z
            .array(z.string().trim().min(1))
            .max(EXTRACT_TEXT_MAX_CONTEXT_FILES)
            .optional()
            .nullable(),
          supportingInstructions: z
            .string()
            .trim()
            .min(1)
            .optional()
            .nullable(),
        })
        .strict(),
      execute: async ({
        documentPaths,
        outputPath,
        instructions,
        supportingPaths,
        supportingInstructions,
      }) => {
        return await extractTextToWorkspace({
          documentPaths,
          outputPath,
          instructions:
            typeof instructions === "string" ? instructions : undefined,
          supportingPaths: supportingPaths ?? undefined,
          supportingInstructions:
            typeof supportingInstructions === "string"
              ? supportingInstructions
              : undefined,
        });
      },
    }),
    read_pdf: tool({
      description: [
        "Read and transcribe a PDF using a multimodal model.",
        "Provide either url (official PDF URL) or pdfPath (workspace file), plus prompt/promptPath and outputPath.",
        `By default this tool uses ${DEFAULT_PDF_EXTRACTION_MODEL_ID}; pass modelId to override.`,
        "This tool requires real PDF bytes and rejects HTML mirror pages.",
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.string().trim().min(1).optional(),
          pdfPath: z.string().trim().min(1).optional(),
          prompt: z.string().trim().min(1).optional(),
          promptPath: z.string().trim().min(1).optional(),
          outputPath: z.string().trim().min(1),
          modelId: z.string().trim().min(1).optional(),
          maxChars: z
            .number()
            .int()
            .min(200)
            .max(PDF_EXTRACTION_DEFAULT_MAX_CHARS)
            .optional(),
        })
        .strict()
        .superRefine((value, context) => {
          const hasUrl =
            typeof value.url === "string" && value.url.trim().length > 0;
          const hasPdfPath =
            typeof value.pdfPath === "string" &&
            value.pdfPath.trim().length > 0;
          const hasPrompt =
            typeof value.prompt === "string" && value.prompt.trim().length > 0;
          const hasPromptPath =
            typeof value.promptPath === "string" &&
            value.promptPath.trim().length > 0;
          if (hasUrl === hasPdfPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "read_pdf expects exactly one of url or pdfPath.",
              path: ["url"],
            });
          }
          if (hasPrompt && hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "read_pdf expects either prompt or promptPath, not both.",
              path: ["prompt"],
            });
          }
          if (!hasPrompt && !hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "read_pdf requires either prompt or promptPath.",
              path: ["prompt"],
            });
          }
        }),
      execute: async ({
        url,
        pdfPath,
        prompt,
        promptPath,
        outputPath,
        maxChars,
        modelId,
      }) => {
        const promptText = await resolvePdfPromptText({
          toolName: "read_pdf",
          prompt,
          promptPath,
        });

        if (typeof pdfPath === "string" && pdfPath.trim().length > 0) {
          const decoded = await decodePdfBytesFromWorkspace({
            toolName: "read_pdf",
            pdfPath,
          });
          return await extractPdfTextToWorkspace({
            toolName: "read_pdf",
            pdfBytes: decoded.pdfBytes,
            outputPath,
            promptText,
            modelId,
            maxChars,
            sourceInfo: {
              pdfPath: decoded.resolvedPdfPath,
            },
          });
        }

        const rawUrl = url?.trim() ?? "";
        const fetched = await fetchPdfBytesFromUrl({
          toolName: "read_pdf",
          url: rawUrl,
        });

        return await extractPdfTextToWorkspace({
          toolName: "read_pdf",
          pdfBytes: fetched.pdfBytes,
          outputPath,
          promptText,
          modelId,
          maxChars,
          sourceInfo: {
            url: rawUrl,
            finalUrl: fetched.finalUrl,
            contentType: fetched.contentType,
          },
        });
      },
    }),
    extract_pdf_diagrams: tool({
      description: [
        "Extract diagram bounding boxes from a PDF using a multimodal model.",
        "Provide either url (official PDF URL) or pdfPath (workspace file), plus prompt/promptPath and outputPath.",
        "Writes a JSON manifest with per-diagram problem id, page, normalized bounding box, and optional labels.",
        `By default this tool uses ${DEFAULT_PDF_EXTRACTION_MODEL_ID}; pass modelId to override.`,
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.string().trim().min(1).optional(),
          pdfPath: z.string().trim().min(1).optional(),
          prompt: z.string().trim().min(1).optional(),
          promptPath: z.string().trim().min(1).optional(),
          outputPath: z.string().trim().min(1),
          modelId: z.string().trim().min(1).optional(),
          maxDiagrams: z
            .number()
            .int()
            .min(1)
            .max(PDF_DIAGRAM_MAX_ITEMS)
            .optional(),
        })
        .strict()
        .superRefine((value, context) => {
          const hasUrl =
            typeof value.url === "string" && value.url.trim().length > 0;
          const hasPdfPath =
            typeof value.pdfPath === "string" &&
            value.pdfPath.trim().length > 0;
          const hasPrompt =
            typeof value.prompt === "string" && value.prompt.trim().length > 0;
          const hasPromptPath =
            typeof value.promptPath === "string" &&
            value.promptPath.trim().length > 0;
          if (hasUrl === hasPdfPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "extract_pdf_diagrams expects exactly one of url or pdfPath.",
              path: ["url"],
            });
          }
          if (hasPrompt && hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "extract_pdf_diagrams expects either prompt or promptPath, not both.",
              path: ["prompt"],
            });
          }
          if (!hasPrompt && !hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "extract_pdf_diagrams requires either prompt or promptPath.",
              path: ["prompt"],
            });
          }
        }),
      execute: async ({
        url,
        pdfPath,
        prompt,
        promptPath,
        outputPath,
        modelId,
        maxDiagrams,
      }) => {
        const promptText = await resolvePdfPromptText({
          toolName: "extract_pdf_diagrams",
          prompt,
          promptPath,
        });

        if (typeof pdfPath === "string" && pdfPath.trim().length > 0) {
          const decoded = await decodePdfBytesFromWorkspace({
            toolName: "extract_pdf_diagrams",
            pdfPath,
          });
          return await extractPdfDiagramManifestToWorkspace({
            toolName: "extract_pdf_diagrams",
            pdfBytes: decoded.pdfBytes,
            outputPath,
            promptText,
            modelId,
            maxDiagrams,
            sourceInfo: {
              pdfPath: decoded.resolvedPdfPath,
            },
          });
        }

        const rawUrl = url?.trim() ?? "";
        const fetched = await fetchPdfBytesFromUrl({
          toolName: "extract_pdf_diagrams",
          url: rawUrl,
        });
        return await extractPdfDiagramManifestToWorkspace({
          toolName: "extract_pdf_diagrams",
          pdfBytes: fetched.pdfBytes,
          outputPath,
          promptText,
          modelId,
          maxDiagrams,
          sourceInfo: {
            url: rawUrl,
            finalUrl: fetched.finalUrl,
            contentType: fetched.contentType,
          },
        });
      },
    }),
    extract_pdf_text: tool({
      description: [
        "Legacy text extraction helper for workspace PDFs.",
        "Prefer the pdf_to_images + view_image workflow for grading and diagram-sensitive transcription tasks.",
      ].join("\n"),
      inputSchema: z
        .object({
          pdfPath: z.string().trim().min(1),
          prompt: z.string().trim().min(1).optional(),
          promptPath: z.string().trim().min(1).optional(),
          outputPath: z.string().trim().min(1),
          maxChars: z
            .number()
            .int()
            .min(200)
            .max(PDF_EXTRACTION_DEFAULT_MAX_CHARS)
            .optional(),
        })
        .strict()
        .superRefine((value, context) => {
          const hasPrompt =
            typeof value.prompt === "string" && value.prompt.trim().length > 0;
          const hasPromptPath =
            typeof value.promptPath === "string" &&
            value.promptPath.trim().length > 0;
          if (hasPrompt && hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "extract_pdf_text expects either prompt or promptPath, not both.",
              path: ["prompt"],
            });
          }
          if (!hasPrompt && !hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "extract_pdf_text requires either prompt or promptPath.",
              path: ["prompt"],
            });
          }
        }),
      execute: async ({
        pdfPath,
        prompt,
        promptPath,
        outputPath,
        maxChars,
      }) => {
        const promptText = await resolvePdfPromptText({
          toolName: "extract_pdf_text",
          prompt,
          promptPath,
        });
        const decoded = await decodePdfBytesFromWorkspace({
          toolName: "extract_pdf_text",
          pdfPath,
        });
        return await extractPdfTextToWorkspace({
          toolName: "extract_pdf_text",
          pdfBytes: decoded.pdfBytes,
          outputPath,
          promptText,
          maxChars,
          sourceInfo: {
            pdfPath: decoded.resolvedPdfPath,
          },
        });
      },
    }),
    pdf_to_images: tool({
      description: [
        "Render pages from a workspace PDF into PNG images in the workspace.",
        "Use this for agentic diagram extraction loops before calling crop_image.",
      ].join("\n"),
      inputSchema: z
        .object({
          pdfPath: z.string().trim().min(1),
          outputDir: z.string().trim().min(1),
          pageNumbers: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              return value;
            },
            z.array(z.number().int().min(1)).max(200).optional(),
          ),
          scale: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().min(0.5).max(6).optional()),
          filenamePrefix: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({
        pdfPath,
        outputDir,
        pageNumbers,
        scale,
        filenamePrefix,
      }) => {
        const decoded = await decodePdfBytesFromWorkspace({
          toolName: "read_pdf",
          pdfPath,
        });
        const pdfBytes = Uint8Array.from(decoded.pdfBytes);
        const pageCount = await getPdfPageCount({ pdfBytes });
        const requestedPages =
          pageNumbers && pageNumbers.length > 0
            ? [...new Set(pageNumbers)].sort((a, b) => a - b)
            : Array.from({ length: pageCount }, (_, index) => index + 1);
        if (requestedPages.length === 0) {
          throw new Error(
            "pdf_to_images requires at least one page to render.",
          );
        }
        for (const pageNumber of requestedPages) {
          if (pageNumber > pageCount) {
            throw new Error(
              `pdf_to_images page ${pageNumber.toString()} exceeds page count ${pageCount.toString()}.`,
            );
          }
        }
        const renderedByPage = await renderPdfPagesBgra({
          pdfBytes,
          pageNumbers: requestedPages,
          scale,
        });
        const normalizedOutputDir = outputDir
          .replace(/\\/g, "/")
          .replace(/\/+$/u, "");
        if (normalizedOutputDir.length === 0) {
          throw new Error("outputDir must not be empty.");
        }
        const prefix = (filenamePrefix ?? "page").replace(
          /[^a-z0-9_-]+/giu,
          "-",
        );
        const written: Array<{
          page: number;
          path: string;
          width: number;
          height: number;
          bytes: number;
        }> = [];
        for (const pageNumber of requestedPages) {
          const bitmap = renderedByPage.get(pageNumber);
          if (!bitmap) {
            continue;
          }
          const relativePath = `${normalizedOutputDir}/${prefix}-${pageNumber
            .toString()
            .padStart(4, "0")}.png`;
          const resolvedPath = resolveWorkspacePath(rootDir, relativePath);
          await ensureDir(path.dirname(resolvedPath));
          const pngBytes = Buffer.from(encodeBgraBitmapToPng(bitmap));
          await writeFile(resolvedPath, pngBytes);
          workspace.scheduleUpdate(relativePath);
          written.push({
            page: pageNumber,
            path: relativePath,
            width: bitmap.width,
            height: bitmap.height,
            bytes: pngBytes.byteLength,
          });
        }
        return {
          status: "written",
          pdfPath: decoded.resolvedPdfPath,
          pageCount,
          outputDir: normalizedOutputDir,
          pages: written,
        };
      },
    }),
    crop_image: tool({
      description: [
        "Crop a workspace image (JPG/PNG/WEBP/GIF/HEIC/HEIF) using bbox1000 (int coords) or bboxNorm.",
        "The cropped output is written as PNG.",
        "For a deliberate full-page copy, set fullImage=true and omit bbox fields.",
        "Use this to iteratively refine diagram crops from page images.",
      ].join("\n"),
      inputSchema: z
        .object({
          sourcePath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
          fullImage: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.boolean().optional()),
          bbox1000: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              return value;
            },
            z
              .object({
                left: z.number().int().min(0).max(1000),
                top: z.number().int().min(0).max(1000),
                right: z.number().int().min(0).max(1000),
                bottom: z.number().int().min(0).max(1000),
              })
              .optional(),
          ),
          bboxNorm: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              return value;
            },
            z
              .object({
                left: z.number().min(0).max(1),
                top: z.number().min(0).max(1),
                width: z.number().positive().max(1),
                height: z.number().positive().max(1),
              })
              .optional(),
          ),
        })
        .strict()
        .superRefine((value, context) => {
          const has1000 = value.bbox1000 !== undefined;
          const hasNorm = value.bboxNorm !== undefined;
          const hasFullImage = value.fullImage === true;
          if (has1000 && hasNorm) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "crop_image expects at most one of bbox1000 or bboxNorm.",
              path: ["bbox1000"],
            });
          }
          if (hasFullImage && (has1000 || hasNorm)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "crop_image with fullImage=true cannot include bbox1000 or bboxNorm.",
              path: ["fullImage"],
            });
          }
          if (!hasFullImage && !has1000 && !hasNorm) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "crop_image expects bbox1000 or bboxNorm; use fullImage=true for full-page copy.",
              path: ["bbox1000"],
            });
          }
        }),
      execute: async ({
        sourcePath,
        outputPath,
        fullImage,
        bbox1000,
        bboxNorm,
      }) => {
        const resolvedSourcePath = resolveWorkspacePath(rootDir, sourcePath);
        const sourceBytes = await readFile(resolvedSourcePath);
        const sharp = getSharp();
        const sourceMetadata = await sharp(sourceBytes)
          .metadata()
          .catch((error) => {
            throw new Error(
              `crop_image could not decode "${sourcePath}" as an image: ${errorAsString(error)}`,
            );
          });
        const sourceWidth = sourceMetadata.width;
        const sourceHeight = sourceMetadata.height;
        if (
          typeof sourceWidth !== "number" ||
          typeof sourceHeight !== "number" ||
          sourceWidth <= 0 ||
          sourceHeight <= 0
        ) {
          throw new Error(
            `crop_image could not read dimensions for "${sourcePath}".`,
          );
        }
        const sourceMime =
          resolveImageMimeTypeFromSharpFormat({
            format: sourceMetadata.format,
          }) ?? resolveContentType(sourcePath);
        if (!isSupportedCropImageMimeType(sourceMime)) {
          throw new Error(
            `crop_image supports ${SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES.join(", ")}. Received ${sourceMime ?? "unknown"} for "${sourcePath}".`,
          );
        }
        const pixels = (() => {
          if (bbox1000 !== undefined) {
            return toCropPixelsFrom1000({
              width: sourceWidth,
              height: sourceHeight,
              left: bbox1000.left,
              top: bbox1000.top,
              right: bbox1000.right,
              bottom: bbox1000.bottom,
            });
          }
          if (bboxNorm !== undefined) {
            return toCropPixelsFromNorm({
              width: sourceWidth,
              height: sourceHeight,
              left: bboxNorm.left,
              top: bboxNorm.top,
              widthNorm: bboxNorm.width,
              heightNorm: bboxNorm.height,
            });
          }
          if (fullImage === true) {
            return {
              left: 0,
              top: 0,
              right: sourceWidth,
              bottom: sourceHeight,
            };
          }
          throw new Error(
            "crop_image received no crop bounds. Provide bbox1000/bboxNorm or set fullImage=true.",
          );
        })();
        const croppedBytes = await cropImageToPngBuffer({
          source: sourceBytes,
          left: pixels.left,
          top: pixels.top,
          right: pixels.right,
          bottom: pixels.bottom,
        });
        const resolvedOutputPath = resolveWorkspacePath(rootDir, outputPath);
        await ensureDir(path.dirname(resolvedOutputPath));
        await writeFile(resolvedOutputPath, croppedBytes);
        workspace.scheduleUpdate(outputPath);
        return {
          status: "written",
          sourcePath,
          outputPath,
          sourceWidth,
          sourceHeight,
          cropWidth: pixels.right - pixels.left,
          cropHeight: pixels.bottom - pixels.top,
          bboxPixels: pixels,
          fullImage: fullImage === true,
          outputBytes: croppedBytes.byteLength,
        };
      },
    }),
    list_files: tool({
      description: "Recursively list files under a workspace path.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        maxDepth: z.number().int().min(0).max(20).optional(),
      }),
      execute: async ({ path: inputPath, maxDepth }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        const entries = await listFilesRecursive({
          rootDir: resolved,
          maxDepth: maxDepth ?? 4,
        });
        const results: Array<{
          path: string;
          type: "file" | "dir";
          sizeBytes?: number;
        }> = [];
        for (const entry of entries) {
          const normalized = entry.endsWith("/") ? entry.slice(0, -1) : entry;
          if (!normalized) {
            continue;
          }
          const fullPath = path.join(resolved, normalized);
          const stats = await stat(fullPath).catch(() => undefined);
          if (!stats) {
            continue;
          }
          results.push({
            path: normalized + (stats.isDirectory() ? "/" : ""),
            type: stats.isDirectory() ? "dir" : "file",
            ...(stats.isFile() ? { sizeBytes: stats.size } : {}),
          });
        }
        return { path: inputPath, entries: results };
      },
    }),
    read_file: codexReadFileTool,
    view_image: codexViewImageTool,
    read_files: tool({
      description: "Read multiple text files from the workspace.",
      inputSchema: z.object({
        paths: z.array(z.string().trim().min(1)).min(1),
      }),
      execute: async ({ paths }) => {
        const files = await Promise.all(
          paths.map(async (entry) => {
            const output = await executeCodexReadFile({
              file_path: entry,
            });
            const content = (() => {
              if (typeof output === "string") {
                return output;
              }
              if (
                Array.isArray(output) &&
                output.every((value) => typeof value === "string")
              ) {
                return output.join("\n");
              }
              if (
                output &&
                typeof output === "object" &&
                !Array.isArray(output)
              ) {
                const candidate = output as Record<string, unknown>;
                if (typeof candidate.content === "string") {
                  return candidate.content;
                }
                if (typeof candidate.text === "string") {
                  return candidate.text;
                }
              }
              return "";
            })();
            return {
              path: entry,
              content,
              bytes: Buffer.byteLength(content, "utf8"),
            };
          }),
        );
        return { files };
      },
    }),
    write_file: tool({
      description: "Create or overwrite a text file in the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        content: z.string(),
      }),
      execute: async ({ path: inputPath, content }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        await ensureDir(path.dirname(resolved));
        await writeFile(resolved, content, { encoding: "utf8" });
        workspace.scheduleUpdate(inputPath);
        return { path: inputPath, status: "written" };
      },
    }),
    delete_file: tool({
      description: "Delete a file from the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        await rm(resolved);
        await workspace.deleteFile(inputPath);
        return { path: inputPath, status: "deleted" };
      },
    }),
    move_file: tool({
      description: "Move or rename a file inside the workspace.",
      inputSchema: z.object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1),
      }),
      execute: async ({ from, to }) => {
        const resolvedFrom = resolveWorkspacePath(rootDir, from);
        const resolvedTo = resolveWorkspacePath(rootDir, to);
        await ensureDir(path.dirname(resolvedTo));
        await rename(resolvedFrom, resolvedTo);
        await workspace.moveFile(from, to);
        return { from, to, status: "moved" };
      },
    }),
    apply_patch: tool({
      description:
        "Apply patch operations to existing files (update only). Use unified diffs or full file contents.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              type: z.enum(["create_file", "update_file", "delete_file"]),
              path: z.string().trim().min(1),
              diff: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ operations }) => {
        const results: Array<{
          path: string;
          status: "completed" | "failed";
          error?: string;
        }> = [];
        for (const operation of operations) {
          try {
            const resolved = resolveWorkspacePath(rootDir, operation.path);
            if (operation.type !== "update_file") {
              throw new Error(
                `Use write_file/move_file/delete_file instead of apply_patch for ${operation.type}`,
              );
            }
            if (!operation.diff) {
              throw new Error("diff is required for update_file");
            }
            const original = await readFile(resolved, { encoding: "utf8" });
            const nextContent = applyDiff(original, operation.diff);
            await ensureDir(path.dirname(resolved));
            await writeFile(resolved, nextContent, { encoding: "utf8" });
            workspace.scheduleUpdate(operation.path);
            results.push({ path: operation.path, status: "completed" });
          } catch (error) {
            results.push({
              path: operation.path,
              status: "failed",
              error: errorAsString(error),
            });
          }
        }
        return { results };
      },
    }),
  };
  if (!shouldAllowPythonExec) {
    delete (tools as Record<string, unknown>).python_exec;
  }
  return tools;
}

export function buildSparkAgentTools(options: {
  workspace: SparkAgentWorkspace;
  rootDir: string;
  userId: string;
  serviceAccountJson: string;
  progress?: JobProgressReporter;
  onToolLlmCost?: (toolName: ToolLlmCostName, costUsd: number) => void;
  enforceLessonPipeline?: boolean;
  allowPythonExec?: boolean;
  debug?: LlmDebugOptions;
  extractTextDebugRootDir?: string;
}): LlmToolSet {
  return stripDeprecatedPdfReadTools(buildAgentTools(options));
}

export async function runSparkLessonAgentLocal(options: {
  rootDir: string;
  userId: string;
  prompt: string;
  modelId?: LlmTextModelId;
  maxSteps?: number;
  progress?: JobProgressReporter;
  debug?: LlmDebugOptions;
}): Promise<{
  readonly toolLoopResult: LlmToolLoopResult;
  readonly publishResult: {
    status: "published";
    sessionId: string;
    includeStory: boolean | null;
    includeCoding: boolean | null;
    quizCount: number;
    problemCount: number;
    mediaCount: number;
    href: string;
    mode: "mock";
  } | null;
  readonly doneSummary: string | null;
}> {
  const modelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const maxSteps = options.maxSteps ?? DEFAULT_LESSON_MAX_STEPS;
  const thinkingLevel = resolveSparkAgentThinkingLevel(modelId);
  const progress = options.progress;

  const workspace: SparkAgentWorkspace = {
    scheduleUpdate: () => {},
    deleteFile: async (inputPath) => {
      const resolved = resolveWorkspacePath(options.rootDir, inputPath);
      await rm(resolved, { recursive: true, force: true });
    },
    moveFile: async (from, to) => {
      const resolvedFrom = resolveWorkspacePath(options.rootDir, from);
      const resolvedTo = resolveWorkspacePath(options.rootDir, to);
      await ensureDir(path.dirname(resolvedTo));
      await rename(resolvedFrom, resolvedTo);
    },
  };

  const baseTools = stripDeprecatedPdfReadTools(
    buildAgentTools({
      workspace,
      rootDir: options.rootDir,
      userId: options.userId,
      serviceAccountJson: "{}",
      progress,
      enforceLessonPipeline: true,
      debug: options.debug,
      extractTextDebugRootDir: resolveSparkAgentToolCallsDir(options.rootDir),
    }),
  );

  type PublishLessonToolInput = {
    sessionId: string;
    sessionPath?: string;
    briefPath?: string;
    includeStory?: boolean;
    includeCoding?: boolean;
  };

  type LocalPublishLessonResult = {
    status: "published";
    sessionId: string;
    includeStory: boolean | null;
    includeCoding: boolean | null;
    quizCount: number;
    problemCount: number;
    mediaCount: number;
    href: string;
    mode: "mock";
  };

  let publishResult: LocalPublishLessonResult | null = null;
  const publishLessonInputSchema: z.ZodType<PublishLessonToolInput> =
    "inputSchema" in baseTools.publish_lesson
      ? (baseTools.publish_lesson
          .inputSchema as z.ZodType<PublishLessonToolInput>)
      : z
          .object({
            sessionId: z.string().trim().min(1),
            sessionPath: z.string().trim().min(1).optional(),
            briefPath: z.string().trim().min(1).optional(),
            includeStory: z.boolean().optional(),
            includeCoding: z.boolean().optional(),
          })
          .strict();
  const publish_lesson = tool({
    description:
      "Mock publish_lesson for local runs. Validates workspace JSON and returns counts but does not write Firestore.",
    inputSchema: publishLessonInputSchema,
    execute: async (input: PublishLessonToolInput) => {
      const resolvedSessionPath =
        input.sessionPath ?? "lesson/output/session.json";
      const resolvedBriefPath = input.briefPath ?? "brief.md";
      const bundle = await validateLessonWorkspaceForPublish({
        rootDir: options.rootDir,
        sessionId: input.sessionId,
        sessionPath: resolvedSessionPath,
        briefPath: resolvedBriefPath,
        createdAt: new Date(),
        includeStory: input.includeStory,
        includeCoding: input.includeCoding,
        enforceLessonPipeline: true,
      });
      const result: LocalPublishLessonResult = {
        status: "published",
        sessionId: input.sessionId,
        includeStory: input.includeStory ?? null,
        includeCoding: input.includeCoding ?? null,
        quizCount: bundle.quizzes.length,
        problemCount: bundle.problems.length,
        mediaCount: bundle.media.length,
        href: `/spark/lesson/${input.sessionId}`,
        mode: "mock",
      };
      publishResult = result;
      return result;
    },
  });

  let doneSummary: string | null = null;
  let doneCalled = false;
  const done = tool({
    description:
      "Mark the local agent run as complete. Stores a short summary for the caller.",
    inputSchema: z
      .object({
        summary: z.string().trim().min(1).optional(),
      })
      .strict(),
    execute: ({ summary }) => {
      doneCalled = true;
      doneSummary = summary ?? null;
      return { status: "done", summary: summary ?? null };
    },
  });

  const toolLoopResult = await runAgentLoop({
    model: modelId,
    instructions: buildSparkAgentSystemPrompt(),
    input: options.prompt,
    tools: {
      ...baseTools,
      publish_lesson,
      done,
    },
    modelTools: [{ type: "web-search", mode: "live" }],
    maxSteps,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    logging: {
      workspaceDir: resolveSparkAgentLogsDir(options.rootDir),
      callLogsDir: "llm_calls",
      mirrorToConsole: false,
    },
  });

  if (!doneCalled) {
    throw new Error("Lesson agent completed without calling done().");
  }

  return {
    toolLoopResult,
    publishResult,
    doneSummary,
  };
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} {
  const match = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/);
  if (!match) {
    throw new Error(`Invalid hunk header: ${line}`);
  }
  const oldStart = Number.parseInt(match[1], 10);
  const oldLines = match[2] ? Number.parseInt(match[2], 10) : 1;
  const newStart = Number.parseInt(match[3], 10);
  const newLines = match[4] ? Number.parseInt(match[4], 10) : 1;
  return { oldStart, oldLines, newStart, newLines };
}

function applyUnifiedDiff(original: string, diff: string): string {
  const originalLines = splitLines(original);
  const diffLines = splitLines(diff);
  const output: string[] = [];
  let originalIndex = 0;
  let diffIndex = 0;
  while (diffIndex < diffLines.length) {
    const line = diffLines[diffIndex];
    if (line.startsWith("---") || line.startsWith("+++")) {
      diffIndex += 1;
      continue;
    }
    if (!line.startsWith("@@")) {
      throw new Error(`Invalid diff hunk header: ${line}`);
    }
    const header = parseHunkHeader(line);
    const expectedIndex = header.oldStart - 1;
    if (expectedIndex < originalIndex) {
      throw new Error("Diff hunk overlaps previous hunk");
    }
    output.push(...originalLines.slice(originalIndex, expectedIndex));
    originalIndex = expectedIndex;
    diffIndex += 1;
    let hunkLineCount = 0;
    while (diffIndex < diffLines.length) {
      const hunkLine = diffLines[diffIndex];
      if (hunkLine.startsWith("@@")) {
        break;
      }
      if (hunkLine.startsWith(" ")) {
        output.push(hunkLine.slice(1));
        originalIndex += 1;
        hunkLineCount += 1;
      } else if (hunkLine.startsWith("-")) {
        const expected = hunkLine.slice(1);
        const actual = originalLines[originalIndex];
        if (actual !== expected) {
          throw new Error(
            `Patch removal mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        originalIndex += 1;
        hunkLineCount += 1;
      } else if (hunkLine.startsWith("+")) {
        output.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith("\\ No newline")) {
        // ignore
      } else {
        throw new Error(`Unsupported diff line: ${hunkLine}`);
      }
      diffIndex += 1;
    }
    if (hunkLineCount !== header.oldLines) {
      throw new Error(
        `Diff hunk length mismatch: expected ${header.oldLines} got ${hunkLineCount}`,
      );
    }
  }
  output.push(...originalLines.slice(originalIndex));
  return output.join("\n");
}

function applyV4Patch(original: string, diff: string): string {
  const originalLines = splitLines(original);
  const diffLines = splitLines(diff);
  let originalIndex = 0;
  let diffIndex = 0;
  const output: string[] = [];
  while (diffIndex < diffLines.length) {
    const line = diffLines[diffIndex];
    if (line.startsWith("*** Begin Patch")) {
      diffIndex += 1;
      continue;
    }
    if (line.startsWith("*** End Patch")) {
      break;
    }
    if (!line.startsWith("@@")) {
      diffIndex += 1;
      continue;
    }
    const header = parseHunkHeader(line);
    const expectedIndex = header.oldStart - 1;
    output.push(...originalLines.slice(originalIndex, expectedIndex));
    originalIndex = expectedIndex;
    diffIndex += 1;
    while (diffIndex < diffLines.length) {
      const hunkLine = diffLines[diffIndex];
      if (hunkLine.startsWith("@@") || hunkLine.startsWith("*** End Patch")) {
        break;
      }
      if (hunkLine.startsWith(" ")) {
        output.push(hunkLine.slice(1));
        originalIndex += 1;
      } else if (hunkLine.startsWith("-")) {
        const expected = hunkLine.slice(1);
        const actual = originalLines[originalIndex];
        if (actual !== expected) {
          throw new Error(
            `Patch removal mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        originalIndex += 1;
      } else if (hunkLine.startsWith("+")) {
        output.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith("\\ No newline")) {
        // ignore
      } else {
        throw new Error(`Unsupported diff line: ${hunkLine}`);
      }
      diffIndex += 1;
    }
  }
  output.push(...originalLines.slice(originalIndex));
  return output.join("\n");
}

function applyDiff(original: string, diff: string): string {
  if (diff.trim().length === 0) {
    return original;
  }
  if (diff.includes("*** Begin Patch")) {
    return applyV4Patch(original, diff);
  }
  if (diff.includes("@@")) {
    const hasRangeHeader = diff
      .split("\n")
      .some(
        (line) =>
          line.startsWith("@@") && line.includes("-") && line.includes("+"),
      );
    if (!hasRangeHeader) {
      return applyV4Patch(original, diff);
    }
    return applyUnifiedDiff(original, diff);
  }

  const lines = splitLines(diff);
  const hasMarkers = lines.some(
    (line) =>
      line.startsWith("+") || line.startsWith("-") || line.startsWith(" "),
  );
  if (!hasMarkers) {
    return diff;
  }
  const allPlus = lines.every((line) => line === "" || line.startsWith("+"));
  if (allPlus) {
    return lines
      .map((line) => (line.startsWith("+") ? line.slice(1) : line))
      .join("\n");
  }
  const allSpaceOrPlus = lines.every(
    (line) => line === "" || line.startsWith("+") || line.startsWith(" "),
  );
  if (allSpaceOrPlus) {
    return lines
      .map((line) => {
        if (line.startsWith("+")) {
          return line.slice(1);
        }
        if (line.startsWith(" ")) {
          return line.slice(1);
        }
        return line;
      })
      .join("\n");
  }

  return applyUnifiedDiff(original, diff);
}

async function updateAgentStatus(options: {
  serviceAccountJson: string;
  agentDocPath: string;
  status: AgentStatus;
  resultSummary?: string;
  error?: string;
}): Promise<void> {
  const now = new Date();
  const snapshot = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: options.agentDocPath,
  });
  const existingTimeline = z
    .array(SparkAgentStateTimelineSchema)
    .catch([])
    .parse(snapshot.data?.statesTimeline ?? []);
  const nextTimeline: SparkAgentStateTimeline[] = [
    ...existingTimeline,
    { state: options.status, timestamp: now },
  ];
  const payload: Record<string, unknown> = {
    status: options.status,
    updatedAt: now,
    statesTimeline: nextTimeline,
  };
  if (typeof options.resultSummary === "string") {
    payload.resultSummary = options.resultSummary;
  }
  if (typeof options.error === "string") {
    payload.error = options.error;
  }
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: options.agentDocPath,
    updates: payload,
  });
}

export async function runSparkAgentTask(
  options: AgentRunOptions,
): Promise<void> {
  loadAgentEnv();
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
  const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;
  const agentDocPath = `users/${options.userId}/agents/${options.agentId}`;

  const toolLoopModelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const statsTracker = new AgentRunStatsTracker({
    primaryModelId: toolLoopModelId,
  });
  let generateTextCostUsd = 0;
  let generateJsonCostUsd = 0;
  let extractTextCostUsd = 0;
  let pdfToolCostUsd = 0;

  let prompt = "";
  let logSync: AgentLogSync | undefined;
  let workspaceRoot: string | undefined;
  let cleanupWorkspaceRoot = true;
  let workspaceSync: WorkspaceSync | undefined;
  let graderRunId: string | null = null;
  let graderSummaryPath = "grader/output/run-summary.json";
  let graderProblemsDir = "grader/output/problems";
  let tutorSessionId: string | null = null;
  let tutorAction: "initial" | "reply" | "hint" | null = null;
  let tutorStudentText: string | null = null;
  let tutorConfidence: string | null = null;
  let tutorHintLevel: string | null = null;
  let tutorSessionTitle = "Tutor session";
  let tutorSourceLabel = "graded problem";
  let tutorDraftRevision = 0;
  let tutorFocusLabel: string | null = null;
  let tutorSnapshot: TutorWorkspaceSnapshot | null = null;

  let stopRequested = false;
  let stopPollTimer: NodeJS.Timeout | undefined;
  let stopPollInFlight: Promise<void> | undefined;

  let doneCalled = false;

  const stopStopPolling = async (): Promise<void> => {
    if (stopPollTimer) {
      clearInterval(stopPollTimer);
      stopPollTimer = undefined;
    }
    await stopPollInFlight?.catch(() => undefined);
  };

  try {
    const agentSnap = await getFirestoreDocument({
      serviceAccountJson,
      documentPath: agentDocPath,
    });
    if (!agentSnap.exists || !agentSnap.data) {
      console.warn(`[spark-agent:${options.agentId}] Agent not found`);
      return;
    }

    const agentData = agentSnap.data ?? {};
    const rawGraderRunId =
      typeof agentData.graderRunId === "string"
        ? agentData.graderRunId.trim()
        : "";
    if (rawGraderRunId.length > 0) {
      graderRunId = rawGraderRunId;
    }
    const rawSummaryPath =
      typeof agentData.graderSummaryPath === "string"
        ? agentData.graderSummaryPath.trim()
        : "";
    if (rawSummaryPath.length > 0) {
      graderSummaryPath = rawSummaryPath;
    }
    const rawProblemsDir =
      typeof agentData.graderProblemsDir === "string"
        ? agentData.graderProblemsDir.trim()
        : "";
    if (rawProblemsDir.length > 0) {
      graderProblemsDir = rawProblemsDir;
    }
    const rawTutorSessionId =
      typeof agentData.tutorSessionId === "string"
        ? agentData.tutorSessionId.trim()
        : "";
    if (rawTutorSessionId.length > 0) {
      tutorSessionId = rawTutorSessionId;
    }
    const rawTutorAction =
      typeof agentData.tutorAction === "string"
        ? agentData.tutorAction.trim()
        : "";
    if (
      rawTutorAction === "initial" ||
      rawTutorAction === "reply" ||
      rawTutorAction === "hint"
    ) {
      tutorAction = rawTutorAction;
    }
    tutorStudentText =
      typeof agentData.tutorStudentText === "string" &&
      agentData.tutorStudentText.trim().length > 0
        ? agentData.tutorStudentText.trim()
        : null;
    tutorConfidence =
      typeof agentData.tutorConfidence === "string" &&
      agentData.tutorConfidence.trim().length > 0
        ? agentData.tutorConfidence.trim()
        : null;
    tutorHintLevel =
      typeof agentData.tutorHintLevel === "string" &&
      agentData.tutorHintLevel.trim().length > 0
        ? agentData.tutorHintLevel.trim()
        : null;
    const currentStatus =
      typeof agentData.status === "string" ? agentData.status.trim() : "";
    if (
      currentStatus === "done" ||
      currentStatus === "failed" ||
      currentStatus === "stopped"
    ) {
      console.log(
        `[spark-agent:${options.agentId}] skip run; status=${currentStatus}`,
      );
      return;
    }

    if (agentData.stop_requested === true) {
      console.log(`[spark-agent:${options.agentId}] stop_requested pre-run`);
      await updateAgentStatus({
        serviceAccountJson,
        agentDocPath,
        status: "stopped",
        resultSummary: "Stopped by user.",
      });
      if (graderRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: graderRunId,
          updates: {
            status: "stopped",
            updatedAt: new Date(),
            completedAt: new Date(),
            resultSummary: "Stopped by user before execution.",
          },
        }).catch(() => undefined);
      }
      return;
    }

    prompt =
      typeof agentData.prompt === "string" && agentData.prompt.trim().length > 0
        ? agentData.prompt.trim()
        : "";
    if (!prompt) {
      await updateAgentStatus({
        serviceAccountJson,
        agentDocPath,
        status: "failed",
        error: "Agent prompt is missing.",
      });
      if (graderRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: graderRunId,
          updates: {
            status: "failed",
            updatedAt: new Date(),
            completedAt: new Date(),
            error: "Agent prompt is missing.",
          },
        }).catch(() => undefined);
      }
      return;
    }

    await updateAgentStatus({
      serviceAccountJson,
      agentDocPath,
      status: "executing",
    });
    if (graderRunId) {
      await patchGraderRunStatus({
        serviceAccountJson,
        userId: options.userId,
        runId: graderRunId,
        updates: {
          status: "executing",
          updatedAt: new Date(),
        },
      }).catch(() => undefined);
    }
    if (tutorSessionId) {
      await patchFirestoreDocument({
        serviceAccountJson,
        documentPath: resolveTutorSessionDocPath(
          options.userId,
          tutorSessionId,
        ),
        updates: {
          status: "responding",
          activeTurnAgentId: options.agentId,
          updatedAt: new Date(),
        },
      }).catch(() => undefined);
    }

    logSync = new AgentLogSync({
      serviceAccountJson,
      userId: options.userId,
      agentId: options.agentId,
      throttleMs: AGENT_LOG_THROTTLE_MS,
      initialStats: statsTracker.snapshot(),
      mirrorToConsole: true,
      consolePrefix: `[spark-agent:${options.agentId}] `,
    });
    logSync.append(
      `start: workspaceId=${options.workspaceId} modelId=${toolLoopModelId}`,
    );

    const workspaceRootConfig = resolveSparkAgentWorkspaceRoot({
      workspaceId: options.workspaceId,
      runStartedAt: new Date(),
    });
    workspaceRoot = workspaceRootConfig.rootDir;
    cleanupWorkspaceRoot = workspaceRootConfig.cleanupOnExit;
    await ensureDir(workspaceRoot);
    const workspaceLogLine = [
      `local_fs_dir=${workspaceRoot}`,
      `cleanup_on_exit=${cleanupWorkspaceRoot ? "true" : "false"}`,
    ].join(" ");
    logSync.append(workspaceLogLine);
    logSync.append(`workspace_root: ${workspaceRoot}`);
    workspaceSync = new WorkspaceSync({
      serviceAccountJson,
      userId: options.userId,
      workspaceId: options.workspaceId,
      bucketName,
      rootDir: workspaceRoot,
    });
    await workspaceSync.load();
    if (tutorSessionId) {
      const tutorSessionSnap = await getFirestoreDocument({
        serviceAccountJson,
        documentPath: resolveTutorSessionDocPath(
          options.userId,
          tutorSessionId,
        ),
      });
      const tutorSessionData = tutorSessionSnap.data ?? {};
      if (
        typeof tutorSessionData.title === "string" &&
        tutorSessionData.title.trim().length > 0
      ) {
        tutorSessionTitle = tutorSessionData.title.trim();
      }
      if (
        typeof tutorSessionData.focusLabel === "string" &&
        tutorSessionData.focusLabel.trim().length > 0
      ) {
        tutorFocusLabel = tutorSessionData.focusLabel.trim();
      }
      if (typeof tutorSessionData.latestDraftRevision === "number") {
        tutorDraftRevision = Math.max(0, tutorSessionData.latestDraftRevision);
      }
      const source =
        tutorSessionData.source &&
        typeof tutorSessionData.source === "object" &&
        !Array.isArray(tutorSessionData.source)
          ? (tutorSessionData.source as Record<string, unknown>)
          : null;
      if (
        source &&
        source.kind === "grader-problem" &&
        typeof source.problemIndex === "number" &&
        typeof source.problemTitle === "string"
      ) {
        tutorSourceLabel = `Problem ${source.problemIndex.toString()}: ${source.problemTitle}`;
      }
      tutorSnapshot = await readTutorWorkspaceSnapshot({
        rootDir: workspaceRoot,
      });
    }

    const pollStopRequested = async (): Promise<void> => {
      if (stopRequested || stopPollInFlight) {
        return;
      }
      stopPollInFlight = (async () => {
        const snap = await getFirestoreDocument({
          serviceAccountJson,
          documentPath: agentDocPath,
        });
        const data = snap.data ?? {};
        if (data.stop_requested === true) {
          stopRequested = true;
          logSync?.append("warn: stop_requested detected");
        }
      })();
      try {
        await stopPollInFlight;
      } catch (error) {
        logSync?.append(`warn: stop poll failed: ${errorAsString(error)}`);
      } finally {
        stopPollInFlight = undefined;
      }
    };

    const startStopPolling = (): void => {
      if (stopPollTimer) {
        return;
      }
      stopPollTimer = setInterval(() => {
        void pollStopRequested();
      }, STOP_POLL_INTERVAL_MS);
    };

    const throwIfStopRequested = (): void => {
      if (stopRequested) {
        throw new StopRequestedError();
      }
    };

    const modelId = toolLoopModelId;
    const isLessonRun = Boolean(
      typeof agentData.lessonSessionId === "string" &&
      agentData.lessonSessionId.trim().length > 0,
    );
    const rawAgentInputAttachments: unknown[] = [];
    if (Array.isArray(agentData.inputAttachments)) {
      rawAgentInputAttachments.push(...agentData.inputAttachments);
    }
    if (Array.isArray(agentData.graderInputAttachments)) {
      rawAgentInputAttachments.push(...agentData.graderInputAttachments);
    }
    const explicitInputAttachments = z
      .array(AgentAttachmentInputSchema)
      .catch([])
      .parse(rawAgentInputAttachments)
      .map((entry) => toResolvedAttachmentInput(entry));
    const workspaceLinkAttachments =
      workspaceSync.getDiscoveredLinkAttachments();
    const inlineInputAttachments = mergeAttachmentInputs({
      primary: explicitInputAttachments,
      secondary: workspaceLinkAttachments,
    }).slice(0, AGENT_INLINE_ATTACHMENTS_MAX_COUNT);
    if (inlineInputAttachments.length > 0) {
      logSync?.append(
        `input_attachments: using ${inlineInputAttachments.length.toString()} attachment(s)`,
      );
    }
    const maxSteps =
      options.maxSteps ??
      (isLessonRun ? DEFAULT_LESSON_MAX_STEPS : DEFAULT_MAX_STEPS);
    const thinkingLevel = resolveSparkAgentThinkingLevel(modelId);
    const progress: JobProgressReporter = {
      log: (message) => {
        throwIfStopRequested();
        logSync?.append(message);
        logSync?.setStats(statsTracker.snapshot());
      },
      startModelCall: (details) => {
        throwIfStopRequested();
        const handle = statsTracker.startModelCall({
          modelId: details.modelId,
          costBucket: "tool",
        });
        logSync?.setStats(statsTracker.snapshot());
        return handle;
      },
      recordModelUsage: (handle, chunk) => {
        throwIfStopRequested();
        statsTracker.recordModelUsage(handle, chunk);
        logSync?.setStats(statsTracker.snapshot());
      },
      finishModelCall: (handle) => {
        throwIfStopRequested();
        statsTracker.finishModelCall(handle);
        logSync?.setStats(statsTracker.snapshot());
      },
      startStage: (stageName: string): StageHandle => {
        throwIfStopRequested();
        void stageName;
        return Symbol("agent-stage");
      },
      finishStage: (handle: StageHandle) => {
        throwIfStopRequested();
        void handle;
      },
      setActiveStages: (stages) => {
        throwIfStopRequested();
        void stages;
      },
    };

    const llmDebug: LlmDebugOptions = {
      rootDir: path.join(workspaceRoot, ".llm-debug"),
      stage: "spark-agent",
    };

    const doneTool = tool({
      description:
        "Mark the agent run as complete. Flushes workspace updates and records a short summary.",
      inputSchema: z
        .object({
          summary: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ summary }) => {
        doneCalled = true;
        logSync?.append(
          summary ? `done: ${summary}` : "done: completed without summary",
        );
        logSync?.setStats(statsTracker.snapshot());
        await workspaceSync?.flushAll();
        await logSync?.flushAll();
        const runSummary =
          graderRunId && workspaceRoot
            ? await readGraderRunSummaryFromWorkspace({
                rootDir: workspaceRoot,
                summaryPath: graderSummaryPath,
                log: (line) => {
                  logSync?.append(line);
                },
              })
            : null;
        const resultSummary = selectGraderResultSummary({
          doneSummary: summary,
          runSummary,
        });
        await updateAgentStatus({
          serviceAccountJson,
          agentDocPath,
          status: "done",
          resultSummary,
        });
        if (graderRunId && workspaceRoot) {
          const now = new Date();
          if (runSummary) {
            const totals = summariseGraderTotals(runSummary);
            const paper: Record<string, string> = {};
            const presentation: Record<string, string> = {};
            if (runSummary.contextLabel) {
              paper.contextLabel = runSummary.contextLabel;
            }
            if (runSummary.year) {
              paper.year = runSummary.year;
            }
            if (runSummary.paperName) {
              paper.paperName = runSummary.paperName;
            }
            if (runSummary.paperUrl) {
              paper.paperUrl = runSummary.paperUrl;
            }
            if (runSummary.markSchemeUrl) {
              paper.markSchemeUrl = runSummary.markSchemeUrl;
            }
            if (runSummary.presentation?.title) {
              presentation.title = runSummary.presentation.title;
            }
            if (runSummary.presentation?.summaryMarkdown) {
              presentation.summaryMarkdown =
                runSummary.presentation.summaryMarkdown;
            }
            await patchGraderRunStatus({
              serviceAccountJson,
              userId: options.userId,
              runId: graderRunId,
              updates: {
                status: "done",
                updatedAt: now,
                completedAt: now,
                resultSummary,
                ...(Object.keys(paper).length > 0 ? { paper } : {}),
                ...(Object.keys(presentation).length > 0
                  ? { presentation }
                  : {}),
                totals,
                problems: runSummary.problems,
                summaryPath: graderSummaryPath,
                problemsDir: graderProblemsDir,
              },
            }).catch((error) => {
              logSync?.append(
                `warn: failed to patch grader run summary: ${errorAsString(error)}`,
              );
            });
          } else {
            await patchGraderRunStatus({
              serviceAccountJson,
              userId: options.userId,
              runId: graderRunId,
              updates: {
                status: "done",
                updatedAt: now,
                completedAt: now,
                resultSummary,
                summaryPath: graderSummaryPath,
                problemsDir: graderProblemsDir,
              },
            }).catch((error) => {
              logSync?.append(
                `warn: failed to patch grader run status: ${errorAsString(error)}`,
              );
            });
          }
        }
        return { status: "done", summary: resultSummary };
      },
    });

    const wait_for_student_input = tool({
      description:
        "Update the tutor screen with the next coaching turn, enable the composer, and pause for the student's next reply. Call done() immediately after this tool.",
      inputSchema: z
        .object({
          tutorMarkdown: z.string().trim().min(1),
          focusLabel: z.string().trim().min(1).optional(),
          composerPlaceholder: z.string().trim().min(1).optional(),
          askForConfidence: z.boolean().optional(),
          preview: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({
        tutorMarkdown,
        focusLabel,
        composerPlaceholder,
        askForConfidence,
        preview,
      }) => {
        if (!tutorSessionId || !workspaceRoot) {
          throw new Error(
            "wait_for_student_input is only available for tutor sessions.",
          );
        }
        const now = new Date();
        const resolvedFocusLabel =
          parseOptionalString(focusLabel) ?? tutorFocusLabel ?? undefined;
        const resolvedPreview =
          parseOptionalString(preview) ??
          firstNonEmptyLine(tutorMarkdown) ??
          "Tutor turn ready.";
        const composerState = buildTutorComposerState({
          placeholder:
            parseOptionalString(composerPlaceholder) ??
            "Write your next thought here.",
          disabled: false,
          allowConfidence: askForConfidence ?? true,
        });
        const screenState = SparkTutorScreenStateSchema.parse({
          status: "awaiting_student",
          title: tutorSessionTitle,
          ...(resolvedFocusLabel ? { focusLabel: resolvedFocusLabel } : {}),
          draftRevision: tutorDraftRevision,
          updatedAt: now.toISOString(),
        });
        await Promise.all([
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_UI_TOP_PANEL_PATH,
            content: tutorMarkdown,
          }),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_UI_INLINE_FEEDBACK_PATH,
            content: "",
          }),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_STATE_SESSION_PATH,
            content: stringifyJsonFile(screenState),
          }),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_STATE_COMPOSER_PATH,
            content: stringifyJsonFile(composerState),
          }),
          appendTutorHistoryEntryFile({
            rootDir: workspaceRoot,
            workspaceSync,
            entry: {
              role: "assistant",
              kind: "full_turn",
              text: tutorMarkdown,
              createdAt: now.toISOString(),
            },
          }),
          patchFirestoreDocument({
            serviceAccountJson,
            documentPath: resolveTutorSessionDocPath(
              options.userId,
              tutorSessionId,
            ),
            updates: {
              status: "awaiting_student",
              preview: resolvedPreview,
              updatedAt: now,
              activeTurnAgentId: options.agentId,
              ...(resolvedFocusLabel ? { focusLabel: resolvedFocusLabel } : {}),
            },
          }),
        ]);
        tutorFocusLabel = resolvedFocusLabel ?? tutorFocusLabel;
        return { status: "awaiting_student", preview: resolvedPreview };
      },
    });

    const complete_tutor_session = tool({
      description:
        "Write the final tutor screen, disable the composer, and mark the session complete. Call done() immediately after this tool.",
      inputSchema: z
        .object({
          tutorMarkdown: z.string().trim().min(1),
          focusLabel: z.string().trim().min(1).optional(),
          preview: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ tutorMarkdown, focusLabel, preview }) => {
        if (!tutorSessionId || !workspaceRoot) {
          throw new Error(
            "complete_tutor_session is only available for tutor sessions.",
          );
        }
        const now = new Date();
        const resolvedFocusLabel =
          parseOptionalString(focusLabel) ?? tutorFocusLabel ?? undefined;
        const resolvedPreview =
          parseOptionalString(preview) ??
          firstNonEmptyLine(tutorMarkdown) ??
          "Tutor session complete.";
        const composerState = buildTutorComposerState({
          placeholder: "This tutor session is complete.",
          disabled: true,
        });
        const screenState = SparkTutorScreenStateSchema.parse({
          status: "completed",
          title: tutorSessionTitle,
          ...(resolvedFocusLabel ? { focusLabel: resolvedFocusLabel } : {}),
          draftRevision: 0,
          updatedAt: now.toISOString(),
        });
        await Promise.all([
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_UI_TOP_PANEL_PATH,
            content: tutorMarkdown,
          }),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_UI_INLINE_FEEDBACK_PATH,
            content: "",
          }),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_STATE_SESSION_PATH,
            content: stringifyJsonFile(screenState),
          }),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_STATE_COMPOSER_PATH,
            content: stringifyJsonFile(composerState),
          }),
          appendTutorHistoryEntryFile({
            rootDir: workspaceRoot,
            workspaceSync,
            entry: {
              role: "assistant",
              kind: "full_turn",
              text: tutorMarkdown,
              createdAt: now.toISOString(),
            },
          }),
          patchFirestoreDocument({
            serviceAccountJson,
            documentPath: resolveTutorSessionDocPath(
              options.userId,
              tutorSessionId,
            ),
            updates: {
              status: "completed",
              preview: resolvedPreview,
              updatedAt: now,
              completedAt: now,
              activeTurnAgentId: options.agentId,
              ...(resolvedFocusLabel ? { focusLabel: resolvedFocusLabel } : {}),
            },
          }),
        ]);
        tutorFocusLabel = resolvedFocusLabel ?? tutorFocusLabel;
        return { status: "completed", preview: resolvedPreview };
      },
    });

    const tools: LlmToolSet = tutorSessionId
      ? {
          wait_for_student_input,
          complete_tutor_session,
          done: doneTool,
        }
      : (() => {
          const baseTools: LlmToolSet = {
            ...stripDeprecatedPdfReadTools(
              buildAgentTools({
                workspace: workspaceSync,
                rootDir: workspaceRoot,
                userId: options.userId,
                serviceAccountJson,
                progress,
                onToolLlmCost: (toolName, costUsd) => {
                  if (toolName === "generate_text") {
                    generateTextCostUsd += costUsd;
                    return;
                  }
                  if (toolName === "generate_json") {
                    generateJsonCostUsd += costUsd;
                    return;
                  }
                  if (toolName === "extract_text") {
                    extractTextCostUsd += costUsd;
                    return;
                  }
                  pdfToolCostUsd += costUsd;
                },
                enforceLessonPipeline: isLessonRun,
                allowPythonExec: graderRunId === null,
                debug: llmDebug,
                extractTextDebugRootDir:
                  resolveSparkAgentToolCallsDir(workspaceRoot),
              }),
            ),
            done: doneTool,
          };
          return graderRunId === null
            ? baseTools
            : applyPdfTranscriptionSkillTools({
                tools: baseTools,
                rootDir: workspaceRoot,
                includeReferenceTextTool: false,
                onFileWritten: (outputPath) => {
                  workspaceSync?.scheduleUpdate(outputPath);
                },
              });
        })();

    progress.log(`exposed tools: ${Object.keys(tools).sort().join(", ")}`);

    await pollStopRequested();
    if (stopRequested) {
      throw new StopRequestedError();
    }
    startStopPolling();

    const agentSystemPrompt = tutorSessionId
      ? [
          "You are Spark's experimental maths tutor screen.",
          "This is not a running chat transcript. The UI shows one current tutor response at the top and one student composer below it.",
          "Work from the graded report and the student's level. Focus on the most important next gap rather than rewriting the whole solution.",
          "Keep the student doing the thinking. Do not give away a full solution unless absolutely necessary.",
          "When the turn is ready, call either wait_for_student_input or complete_tutor_session.",
          "After calling one of those tools, immediately call done with a short summary.",
          "Do not use markdown headings unless they help readability. Prefer concise paragraphs or short bullet points.",
        ].join("\n")
      : buildSparkAgentSystemPrompt({
          includePdfTranscriptionSkill: graderRunId !== null,
        });
    if (graderRunId && workspaceRoot) {
      try {
        await captureSparkAgentReplayState({
          rootDir: workspaceRoot,
          agentKind: "grader",
          prompt,
          systemPrompt: agentSystemPrompt,
          modelId,
          thinkingLevel,
          maxSteps,
          useSubagents: true,
          grader: {
            summaryPath: graderSummaryPath,
            problemsDir: graderProblemsDir,
          },
        });
        logSync?.append(
          "replay: captured manifest + initial workspace snapshot",
        );
      } catch (error) {
        logSync?.append(
          `warn: failed to capture replay artifacts: ${errorAsString(error)}`,
        );
      }
    }
    let initialInput: LlmInputMessage[] | null = null;
    if (tutorSessionId && tutorAction && tutorSnapshot) {
      initialInput = [
        {
          role: "system",
          content: [{ type: "text", text: agentSystemPrompt }],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildTutorTurnPrompt({
                sessionTitle: tutorSessionTitle,
                action: tutorAction,
                sourceLabel: tutorSourceLabel,
                snapshot: tutorSnapshot,
                ...(tutorStudentText ? { studentText: tutorStudentText } : {}),
                ...(tutorConfidence
                  ? { studentConfidence: tutorConfidence }
                  : {}),
                ...(tutorHintLevel ? { hintLevel: tutorHintLevel } : {}),
              }),
            },
          ],
        },
      ];
    } else if (inlineInputAttachments.length > 0) {
      const loaded = await loadAttachmentParts({
        serviceAccountJson,
        bucketName,
        userId: options.userId,
        attachments: inlineInputAttachments,
        log: (line) => {
          logSync?.append(line);
        },
      });
      if (loaded.parts.length > 0 || loaded.notes.length > 0) {
        initialInput = buildInitialToolLoopInput({
          systemPrompt: agentSystemPrompt,
          prompt,
          inlineParts: loaded.parts,
          notes: loaded.notes,
        });
      }
    }

    const toolLoopStartedAt = Date.now();
    const toolLoopEventBridge = createToolLoopStatsEventBridge({
      tracker: statsTracker,
      modelId,
      flush: () => {
        logSync?.setStats(statsTracker.snapshot());
      },
    });
    const graderRequestPayload =
      graderRunId && workspaceRoot
        ? await loadSparkGraderRequestPayloadFromWorkspace(workspaceRoot)
        : null;
    const graderModelTools = resolveSparkGraderModelTools({
      input: graderRequestPayload?.input,
    });
    const toolLoopResult = await (async (): Promise<LlmToolLoopResult> => {
      try {
        return await runAgentLoop({
          model: modelId,
          input: initialInput ?? prompt,
          ...(initialInput ? {} : { instructions: agentSystemPrompt }),
          tools,
          ...(tutorSessionId
            ? {}
            : graderRunId === null
              ? { modelTools: [{ type: "web-search", mode: "live" }] }
              : graderModelTools
                ? { modelTools: graderModelTools }
                : {}),
          subagents:
            tutorSessionId || graderRunId === null
              ? undefined
              : { promptPattern: "codex" as const },
          maxSteps,
          ...(thinkingLevel ? { thinkingLevel } : {}),
          onEvent: (event) => {
            toolLoopEventBridge.onEvent(event);
          },
          logging: {
            workspaceDir: resolveSparkAgentLogsDir(workspaceRoot),
            callLogsDir: "llm_calls",
            mirrorToConsole: false,
            sink: {
              append: (line: string) => {
                logSync?.append(line);
              },
              flush: async () => {
                await logSync?.flushAll();
              },
            },
          },
        });
      } finally {
        toolLoopEventBridge.finish();
      }
    })();
    const reconciledAgentCostUsd = statsTracker.reconcileModelCostFromToolLoopResult(
      {
        modelId: toolLoopModelId,
        toolLoopResult,
      },
    );
    statsTracker.recordToolCallsFromResult(toolLoopResult);
    logSync?.setStats(statsTracker.snapshot());
    if (reconciledAgentCostUsd > 0) {
      logSync?.append(
        `reconciled_agent_llm_cost: +${reconciledAgentCostUsd.toFixed(6)} from toolLoopResult.totalCostUsd`,
      );
    }

    try {
      const traceSummary = await persistToolLoopTrace({
        serviceAccountJson,
        userId: options.userId,
        agentId: options.agentId,
        toolLoopResult,
        consolePrefix: `[spark-agent:${options.agentId}] `,
      });
      logSync?.append(
        `trace_summary: steps=${traceSummary.stepCount} tool_calls=${traceSummary.toolCallCount}`,
      );
    } catch (error) {
      logSync?.append(
        `warn: failed to persist full tool trace: ${errorAsString(error)}`,
      );
    }

    if (!doneCalled) {
      const responseText = toolLoopResult.text.trim();
      const summary =
        responseText.length > 1000
          ? `${responseText.slice(0, 1000).trim()}…`
          : responseText;

      logSync?.append(
        "warn: model returned a final response without calling done; auto-completing run",
      );

      if (tutorSessionId && responseText.length > 0) {
        await wait_for_student_input.execute({
          tutorMarkdown: responseText,
          ...(tutorFocusLabel ? { focusLabel: tutorFocusLabel } : {}),
        });
      } else if (responseText.length > 0 && workspaceRoot) {
        const outputPath = "agent-output.md";
        try {
          await writeFile(path.join(workspaceRoot, outputPath), responseText, {
            encoding: "utf8",
          });
          workspaceSync?.scheduleUpdate(outputPath);
        } catch (error) {
          logSync?.append(
            `warn: failed to persist final response: ${errorAsString(error)}`,
          );
        }
      }

      await doneTool.execute({
        summary: summary.length > 0 ? summary : undefined,
      });
    }

    const totals = statsTracker.snapshot();
    progress.log(
      [
        "run_summary:",
        `agent_llm=${formatUsdTotal(totals.modelCostUsd)}`,
        `tool_llm=${formatUsdTotal(totals.toolCostUsd)}`,
        `generate_text=${formatUsdTotal(generateTextCostUsd)}`,
        `generate_json=${formatUsdTotal(generateJsonCostUsd)}`,
        `extract_text=${formatUsdTotal(extractTextCostUsd)}`,
        `pdf_tools=${formatUsdTotal(pdfToolCostUsd)}`,
        `wallclock=${formatMillis(Date.now() - toolLoopStartedAt)}`,
      ].join(" "),
    );

    await workspaceSync?.flushAll().catch(() => undefined);
    await logSync?.flushAll().catch(() => undefined);
  } catch (error) {
    if (error instanceof StopRequestedError) {
      logSync?.append("warn: agent stopped by user request");
      await workspaceSync?.flushAll().catch(() => undefined);
      await logSync?.flushAll().catch(() => undefined);
      await updateAgentStatus({
        serviceAccountJson,
        agentDocPath,
        status: "stopped",
        resultSummary: "Stopped by user.",
      }).catch(() => undefined);
      if (graderRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: graderRunId,
          updates: {
            status: "stopped",
            updatedAt: new Date(),
            completedAt: new Date(),
            resultSummary: "Stopped by user.",
          },
        }).catch(() => undefined);
      }
      if (tutorSessionId && workspaceRoot) {
        const now = new Date();
        await Promise.all([
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_STATE_SESSION_PATH,
            content: stringifyJsonFile(
              SparkTutorScreenStateSchema.parse({
                status: "failed",
                title: tutorSessionTitle,
                ...(tutorFocusLabel ? { focusLabel: tutorFocusLabel } : {}),
                draftRevision: tutorDraftRevision,
                updatedAt: now.toISOString(),
              }),
            ),
          }).catch(() => undefined),
          writeTutorWorkspaceTextFile({
            rootDir: workspaceRoot,
            workspaceSync,
            filePath: TUTOR_STATE_COMPOSER_PATH,
            content: stringifyJsonFile(
              buildTutorComposerState({
                placeholder: "This tutor turn was stopped. You can try again.",
                disabled: false,
              }),
            ),
          }).catch(() => undefined),
          patchFirestoreDocument({
            serviceAccountJson,
            documentPath: resolveTutorSessionDocPath(
              options.userId,
              tutorSessionId,
            ),
            updates: {
              status: "failed",
              error: "Stopped by user.",
              updatedAt: now,
            },
          }).catch(() => undefined),
        ]);
      }
      return;
    }

    const message = errorAsString(error);
    console.error(`[spark-agent:${options.agentId}] failed: ${message}`);
    logSync?.append(`error: ${message}`);
    await workspaceSync?.flushAll().catch(() => undefined);
    await logSync?.flushAll().catch(() => undefined);
    const statusUpdated = await updateAgentStatus({
      serviceAccountJson,
      agentDocPath,
      status: "failed",
      error: message,
    })
      .then(() => true)
      .catch((statusError) => {
        console.error(
          `[spark-agent:${options.agentId}] failed to update status: ${errorAsString(statusError)}`,
        );
        return false;
      });
    if (!statusUpdated) {
      throw error;
    }
    if (graderRunId) {
      await patchGraderRunStatus({
        serviceAccountJson,
        userId: options.userId,
        runId: graderRunId,
        updates: {
          status: "failed",
          updatedAt: new Date(),
          completedAt: new Date(),
          error: message,
        },
      }).catch(() => undefined);
    }
    if (tutorSessionId && workspaceRoot) {
      const now = new Date();
      await Promise.all([
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_SESSION_PATH,
          content: stringifyJsonFile(
            SparkTutorScreenStateSchema.parse({
              status: "failed",
              title: tutorSessionTitle,
              ...(tutorFocusLabel ? { focusLabel: tutorFocusLabel } : {}),
              draftRevision: tutorDraftRevision,
              updatedAt: now.toISOString(),
            }),
          ),
        }).catch(() => undefined),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_COMPOSER_PATH,
          content: stringifyJsonFile(
            buildTutorComposerState({
              placeholder: "That tutor turn failed. You can try sending again.",
              disabled: false,
            }),
          ),
        }).catch(() => undefined),
        patchFirestoreDocument({
          serviceAccountJson,
          documentPath: resolveTutorSessionDocPath(
            options.userId,
            tutorSessionId,
          ),
          updates: {
            status: "failed",
            error: message,
            updatedAt: now,
          },
        }).catch(() => undefined),
      ]);
    }
    return;
  } finally {
    await stopStopPolling();
    logSync?.dispose();
    if (workspaceRoot && cleanupWorkspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
