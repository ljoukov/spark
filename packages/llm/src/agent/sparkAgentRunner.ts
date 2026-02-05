import os from "node:os";
import path from "node:path";
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
  CodeProblemSchema,
  QuizDefinitionSchema,
  SessionSchema,
  SessionMediaDocSchema,
  SparkAgentStateTimelineSchema,
  type CodeProblem,
  type QuizDefinition,
  type Session,
  type SessionMediaDoc,
  type SparkAgentStateTimeline,
} from "@spark/schemas";

import { errorAsString } from "../utils/error";
import { loadEnvFromFile, loadLocalEnv } from "../utils/env";
import {
  deleteFirestoreDocument,
  getFirestoreDocument,
  listFirestoreDocuments,
  patchFirestoreDocument,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import {
  estimateCallCostUsd,
  generateText,
  runToolLoop,
  tool,
  type LlmTextModelId,
  type LlmToolConfig,
  type LlmDebugOptions,
  type LlmToolSet,
} from "../utils/llm";
import { isGeminiModelId, type GeminiModelId } from "../utils/gemini";
import type { OpenAiReasoningEffort } from "../utils/openai-llm";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  LlmUsageTokenUpdate,
  ModelCallHandle,
  StageHandle,
} from "../utils/concurrency";

const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.2-codex";
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_LESSON_MAX_STEPS = 1000;
const DEFAULT_GENERATE_TEXT_MODEL_ID: GeminiModelId = "gemini-2.5-pro";
const WORKSPACE_UPDATE_THROTTLE_MS = 10_000;
const AGENT_LOG_THROTTLE_MS = 2_000;
const AGENT_STREAM_MAX_CHARS = 20_000;
const STOP_POLL_INTERVAL_MS = 10_000;

type MutableGlobal = Omit<typeof globalThis, "location" | "self"> & {
  location?: { href: string };
  self?: typeof globalThis;
};

function resolvePyodideIndexUrl(explicit?: string): string | undefined {
  const fromEnv =
    process.env.PYODIDE_INDEX_URL ??
    process.env.PYODIDE_BASE_URL ??
    process.env.PYTHON_RUNTIME_INDEX_URL;
  const raw = explicit?.trim() ?? fromEnv?.trim() ?? "";
  if (!raw) {
    return undefined;
  }
  if (raw.endsWith("/")) {
    return raw;
  }
  if (
    raw.startsWith("http://") ||
    raw.startsWith("https://") ||
    raw.startsWith("file://")
  ) {
    return `${raw}/`;
  }
  if (raw.endsWith(path.sep)) {
    return raw;
  }
  return `${raw}${path.sep}`;
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
      const options: { indexURL?: string } = {};
      if (resolvedIndex) {
        ensurePyodideEnvironment(resolvedIndex);
        options.indexURL = resolvedIndex;
      }
      return await pyodideModule.loadPyodide(options);
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

function loadAgentEnv(): void {
  loadLocalEnv();
  const repoRoot = path.resolve(process.cwd());
  loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });
}

function resolveOpenAiReasoningEffort(
  modelId: LlmTextModelId,
): OpenAiReasoningEffort | undefined {
  if (modelId.includes("gpt-5.2")) {
    return "medium";
  }
  return undefined;
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

function encodeFileId(filePath: string): string {
  return encodeURIComponent(filePath);
}

function decodeFileId(fileId: string): string {
  try {
    return decodeURIComponent(fileId);
  } catch {
    return fileId;
  }
}

function resolveContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return "text/markdown";
  }
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".txt") {
    return "text/plain";
  }
  return undefined;
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
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
  private rootDir: string;
  private fileMeta = new Map<string, WorkspaceFileMeta>();

  constructor(options: WorkspaceSyncOptions) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.rootDir = options.rootDir;
  }

  private filesCollectionPath(): string {
    return `users/${this.userId}/workspace/${this.workspaceId}/files`;
  }

  private fileDocPath(filePath: string): string {
    return `${this.filesCollectionPath()}/${encodeFileId(filePath)}`;
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
      const rawPath =
        typeof data.path === "string" && data.path.trim().length > 0
          ? data.path.trim()
          : decodeFileId(
              doc.documentPath.split("/").filter(Boolean).at(-1) ?? "",
            );
      if (!rawPath) {
        continue;
      }
      const content = typeof data.content === "string" ? data.content : "";
      const createdAt = resolveFirestoreDate(data.createdAt);
      const updatedAt = resolveFirestoreDate(data.updatedAt);
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
    let content = "";
    try {
      content = await readFile(resolved, { encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `Failed to read workspace file "${filePath}": ${errorAsString(error)}`,
      );
    }
    const now = new Date();
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const createdAt = meta.createdAt ?? now;
    meta.createdAt = createdAt;
    meta.updatedAt = now;
    meta.lastWriteAt = Date.now();
    const payload: Record<string, unknown> = {
      path: filePath,
      content,
      createdAt,
      updatedAt: now,
      sizeBytes,
    };
    const contentType = resolveContentType(filePath);
    if (contentType) {
      payload.contentType = contentType;
    }
    await patchFirestoreDocument({
      serviceAccountJson: this.serviceAccountJson,
      documentPath: this.fileDocPath(filePath),
      updates: payload,
    });
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
    }
  >();

  startModelCall(details: { modelId: string }): ModelCallHandle {
    const handle: ModelCallHandle = Symbol("agent-model-call");
    this.modelCalls += 1;
    this.modelsUsed.add(details.modelId);
    this.callInfo.set(handle, {
      modelId: details.modelId,
      tokens: createEmptyCallTokenState(),
      appliedCostUsd: 0,
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
      return;
    }
    this.applyTokenUpdate(state, chunk.tokens);
  }

  finishModelCall(handle: ModelCallHandle): void {
    this.callInfo.delete(handle);
  }

  recordToolCall(toolName: string): void {
    this.toolCalls += 1;
    const next = (this.toolCallsByName.get(toolName) ?? 0) + 1;
    this.toolCallsByName.set(toolName, next);
  }

  parseLogLine(message: string): void {
    const prefix = "tool:";
    if (!message.startsWith(prefix)) {
      return;
    }
    const rest = message.slice(prefix.length).trim();
    if (!rest) {
      return;
    }
    const toolName = rest.split(/\s+/)[0]?.trim();
    if (!toolName) {
      return;
    }
    this.recordToolCall(toolName);
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

  private applyTokenUpdate(
    state: {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
    },
    tokens: LlmUsageTokenUpdate,
  ): void {
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
    const callCostUsd = estimateCallCostUsd({
      modelId: state.modelVersion ?? state.modelId,
      tokens,
      responseImages: 0,
    });
    const costDelta = Math.max(0, callCostUsd - state.appliedCostUsd);
    if (costDelta > 0) {
      this.modelCostUsd += costDelta;
      state.appliedCostUsd = callCostUsd;
    }
  }
}

type AgentLogSyncOptions = {
  serviceAccountJson: string;
  userId: string;
  agentId: string;
  throttleMs: number;
  initialStats: AgentRunStatsSnapshot;
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
  private streamAssistant = "";
  private streamThoughts = "";
  private streamDirty = false;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private disposed = false;
  private lastKeyMs = 0;
  private seq = 0;

  constructor(options: AgentLogSyncOptions) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.userId = options.userId;
    this.agentId = options.agentId;
    this.throttleMs = options.throttleMs;
    this.createdAt = new Date();
    this.pendingStats = options.initialStats;
    this.scheduleUpdate();
  }

  private documentPath(): string {
    return `users/${this.userId}/agents/${this.agentId}/logs/log`;
  }

  append(line: string): void {
    if (this.disposed) {
      return;
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

  appendAssistantDelta(delta: string): void {
    if (this.disposed) {
      return;
    }
    if (!delta) {
      return;
    }
    const next = this.streamAssistant + delta;
    this.streamAssistant =
      next.length > AGENT_STREAM_MAX_CHARS
        ? next.slice(next.length - AGENT_STREAM_MAX_CHARS)
        : next;
    this.streamDirty = true;
    this.scheduleUpdate();
  }

  appendThoughtDelta(delta: string): void {
    if (this.disposed) {
      return;
    }
    if (!delta) {
      return;
    }
    const next = this.streamThoughts + delta;
    this.streamThoughts =
      next.length > AGENT_STREAM_MAX_CHARS
        ? next.slice(next.length - AGENT_STREAM_MAX_CHARS)
        : next;
    this.streamDirty = true;
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
    if (
      this.pendingLines.size === 0 &&
      !this.pendingStats &&
      !this.streamDirty
    ) {
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
    if (
      !force &&
      this.pendingLines.size === 0 &&
      !this.pendingStats &&
      !this.streamDirty
    ) {
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
          (this.pendingLines.size > 0 || this.pendingStats || this.streamDirty)
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
    const streamDirty = this.streamDirty;
    const streamAssistant = this.streamAssistant;
    const streamThoughts = this.streamThoughts;
    this.pendingLines.clear();
    this.pendingStats = null;
    this.streamDirty = false;

    if (linesEntries.length === 0 && !stats && !streamDirty) {
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
    if (streamDirty) {
      payload["stream.updatedAt"] = now;
      if (streamAssistant.length > 0) {
        payload["stream.assistant"] = streamAssistant;
      }
      if (streamThoughts.length > 0) {
        payload["stream.thoughts"] = streamThoughts;
      }
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
      if (streamDirty) {
        this.streamDirty = true;
      }
      throw error;
    }
  }
}

function buildAgentSystemPrompt(): string {
  return [
    "You are Spark Agent, a tool-using assistant.",
    "",
    "General rules:",
    "- Work with workspace-relative paths only (no absolute paths, no .. segments).",
    "- Use list_files/read_file/read_files to inspect the workspace before editing.",
    "- Use write_file to create/overwrite files; use apply_patch for small edits to existing files.",
    "- Use move_file for renames and delete_file for deletions.",
    "- Prefer fewer, larger writes over many tiny edits.",
    "- Use web_search when you need to look up facts or check details.",
    "- When the task is complete, you MUST call done({summary}).",
    "",
    "Lesson creation pipeline (CRITICAL):",
    "When you are asked to create a Spark lesson, follow the pipeline described in lesson/task.md.",
    "Key strategy (mirrors the old fixed pipeline, but prompt-driven):",
    "1) Read brief.md + request.json + lesson/task.md first; write hard requirements + decisions into lesson/requirements.md.",
    "2) Generate -> grade -> revise loop for each artifact (do not skip grading):",
    "   - session plan (lesson/output/session.json)",
    "   - quizzes (lesson/output/quiz/<planItemId>.json)",
    "   - code problems (lesson/output/code/<planItemId>.json) when coding is included",
    "3) If coding is included, draft/verify code problems first, then build the plan/quizzes from the verified problems.",
    "4) You MUST use generate_text for drafting and grading; do not write lesson/output/*.json or lesson/feedback/*.json directly with write_file/apply_patch.",
    "   - Example (draft session): generate_text({ promptPath: 'lesson/prompts/session-draft.md', responseSchemaPath: 'lesson/schema/session.schema.json', outputPath: 'lesson/output/session.json' })",
    "   - Example (grade session): generate_text({ promptPath: 'lesson/prompts/session-grade.md', outputPath: 'lesson/feedback/session-grade.json' })",
    "   - Example (grade a quiz): generate_text({ promptPath: 'lesson/prompts/quiz-grade.md', inputPaths: ['lesson/output/quiz/q1.json'], outputPath: 'lesson/feedback/quiz-grade.json' })",
    "   - IMPORTANT: When using responseSchemaPath (JSON outputs), do NOT set tools=[...]. If you need web-search or code execution, do that separately via web_search/python_exec.",
    "   - Prompt templates may include {{path/to/file}} placeholders to inline workspace files.",
    "   - You can also pass inputPaths to generate_text to append additional workspace files without editing the template.",
    "   - When generating JSON, pass responseSchemaPath pointing at lesson/schema/*.schema.json.",
    "   - Do not publish until lesson/feedback/session-grade.json exists and pass=true.",
    "5) Publish only after outputs exist and look consistent: call publish_lesson and fix errors until status='published'.",
    "Publish lessons into the user's sessions (not welcome templates).",
    "",
    "Schema / files:",
    "- lesson/schema/session.schema.json defines lesson/output/session.json.",
    "- lesson/schema/quiz.schema.json defines lesson/output/quiz/*.json.",
    "- lesson/schema/code.schema.json defines lesson/output/code/*.json.",
    "- lesson/schema/media.schema.json defines lesson/output/media/*.json (only if explicitly requested).",
    "",
    "Python execution:",
    "- Use python_exec for calculations or verification (e.g. validate that a reference solution matches tests).",
    "- Provide stdinPath and capture stdout/stderr to workspace files so results are persisted.",
  ].join("\n");
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
    const sessionGradePath = "lesson/feedback/session-grade.json";
    let rawGrade: unknown;
    try {
      rawGrade = await readWorkspaceJson(sessionGradePath);
    } catch {
      throw new Error(
        `Missing required session grading report (${sessionGradePath}). Run generate_text with promptPath='lesson/prompts/session-grade.md' and outputPath='${sessionGradePath}', then revise until pass=true.`,
      );
    }
    const gradeRecord = ensurePlainRecord(rawGrade, sessionGradePath);
    if (gradeRecord.pass !== true) {
      throw new Error(
        `Session grading report (${sessionGradePath}) has pass=false. Revise lesson/output/session.json and re-grade before publishing.`,
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
      (item) => item.kind === "problem",
    ).length;
    if (problemCount > 0) {
      throw new Error(
        "includeCoding=false but session.plan includes problem items.",
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
    (item) => item.kind === "problem",
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
  enforceLessonPipeline?: boolean;
  debug?: LlmDebugOptions;
}): LlmToolSet {
  const {
    workspace,
    rootDir,
    userId,
    serviceAccountJson,
    progress,
    enforceLessonPipeline,
    debug,
  } = options;

  const shouldEnforceLessonPipeline = enforceLessonPipeline === true;
  const isLessonGeneratedJsonPath = (inputPath: string): boolean => {
    const normalized = inputPath.replace(/\\/g, "/");
    if (!normalized.endsWith(".json")) {
      return false;
    }
    if (normalized.startsWith("lesson/output/")) {
      return true;
    }
    if (normalized.startsWith("lesson/feedback/")) {
      return true;
    }
    return false;
  };

  return {
    publish_lesson: tool({
      description:
        "Publish a Spark lesson into the user's sessions (not welcome templates). Reads Firestore-ready JSON from the workspace and writes session + quiz/problem documents to Firestore.",
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
      description:
        "Generate text (Markdown/JSON) using a sub-model. Reads promptPath from the workspace and expands {{relative/path}} placeholders by inlining referenced workspace files.",
      inputSchema: z
        .object({
          promptPath: z.string().trim().min(1),
          inputPaths: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              if (typeof value === "string") {
                const trimmed = value.trim();
                return trimmed.length > 0 ? [trimmed] : undefined;
              }
              return value;
            },
            z.array(z.string().trim().min(1)).optional(),
          ),
          modelId: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            if (typeof value === "string") {
              const trimmed = value.trim();
              return trimmed.length > 0 ? trimmed : undefined;
            }
            return value;
          }, z.string().trim().min(1).optional()),
          tools: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              if (typeof value === "string") {
                const trimmed = value.trim();
                return trimmed.length > 0 ? [trimmed] : undefined;
              }
              return value;
            },
            z.array(z.enum(["web-search", "code-execution"])).optional(),
          ),
          responseSchemaPath: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            if (typeof value === "string") {
              const trimmed = value.trim();
              return trimmed.length > 0 ? trimmed : undefined;
            }
            return value;
          }, z.string().trim().min(1).optional()),
          outputPath: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            if (typeof value === "string") {
              const trimmed = value.trim();
              return trimmed.length > 0 ? trimmed : undefined;
            }
            return value;
          }, z.string().trim().min(1).optional()),
          outputMode: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              if (typeof value === "string") {
                const trimmed = value.trim();
                return trimmed.length > 0 ? trimmed : undefined;
              }
              return value;
            },
            z.enum(["overwrite", "append"]).optional(),
          ),
        })
        .strict(),
      execute: async ({
        promptPath,
        inputPaths,
        modelId,
        tools,
        responseSchemaPath,
        outputPath,
        outputMode,
      }) => {
        const resolvedModelId: GeminiModelId = isGeminiModelId(modelId ?? "")
          ? (modelId as GeminiModelId)
          : DEFAULT_GENERATE_TEXT_MODEL_ID;

        const promptTemplate = await readFile(
          resolveWorkspacePath(rootDir, promptPath),
          { encoding: "utf8" },
        );
        const expanded = await expandPromptTemplate({
          template: promptTemplate,
          rootDir,
        });
        let promptText = expanded.text;
        if (inputPaths && inputPaths.length > 0) {
          const attachments = await Promise.all(
            inputPaths.map(async (inputPath) => {
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

        const responseSchemaText =
          responseSchemaPath && responseSchemaPath.trim().length > 0
            ? await readFile(
                resolveWorkspacePath(rootDir, responseSchemaPath),
                {
                  encoding: "utf8",
                },
              )
            : null;
        const responseJsonSchema = responseSchemaText
          ? (() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(responseSchemaText);
              } catch (error) {
                throw new Error(
                  `Invalid JSON schema in "${responseSchemaPath}": ${errorAsString(error)}`,
                );
              }
              if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
              ) {
                throw new Error(
                  `Schema "${responseSchemaPath}" must be a JSON object schema.`,
                );
              }
              return parsed as Record<string, unknown>;
            })()
          : undefined;

        if (responseJsonSchema && toolConfigs.length > 0) {
          throw new Error(
            "generate_text cannot combine responseSchemaPath with tools; run web_search/python_exec separately or drop responseSchemaPath.",
          );
        }

        const text = await generateText({
          modelId: resolvedModelId,
          contents: [
            {
              role: "user",
              parts: [{ type: "text", text: promptText }],
            },
          ],
          ...(debug
            ? {
                debug: {
                  ...debug,
                  subStage: debug.subStage
                    ? `${debug.subStage}/generate_text`
                    : "generate_text",
                },
              }
            : {}),
          ...(toolConfigs.length > 0 ? { tools: toolConfigs } : {}),
          ...(responseJsonSchema
            ? {
                responseMimeType: "application/json",
                responseJsonSchema: responseJsonSchema,
              }
            : {}),
          ...(progress ? { progress } : {}),
        });

        const shouldFormatJson =
          Boolean(responseJsonSchema) ||
          Boolean(outputPath && outputPath.trim().endsWith(".json"));
        const formatted = shouldFormatJson
          ? (() => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(text);
              } catch (error) {
                throw new Error(
                  `generate_text returned invalid JSON: ${errorAsString(error)}`,
                );
              }
              return JSON.stringify(parsed, null, 2) + "\n";
            })()
          : text;

        const mode = outputMode ?? "overwrite";
        if (outputPath) {
          const resolved = resolveWorkspacePath(rootDir, outputPath);
          await ensureDir(path.dirname(resolved));
          if (mode === "append") {
            const existing = await readFile(resolved, {
              encoding: "utf8",
            }).catch(() => "");
            await writeFile(resolved, existing + formatted, {
              encoding: "utf8",
            });
          } else {
            await writeFile(resolved, formatted, { encoding: "utf8" });
          }
          workspace.scheduleUpdate(outputPath);
          return {
            status: "written",
            modelId: resolvedModelId,
            promptPath,
            inputPaths: inputPaths ?? [],
            outputPath,
            outputMode: mode,
            promptTemplateReplacements: expanded.replacements,
            textChars: formatted.length,
          };
        }

        return {
          status: "generated",
          modelId: resolvedModelId,
          promptPath,
          inputPaths: inputPaths ?? [],
          promptTemplateReplacements: expanded.replacements,
          text: formatted,
          textChars: formatted.length,
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
    read_file: tool({
      description: "Read a text file from the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        const content = await readFile(resolved, { encoding: "utf8" });
        const bytes = Buffer.byteLength(content, "utf8");
        return { path: inputPath, content, bytes };
      },
    }),
    read_files: tool({
      description: "Read multiple text files from the workspace.",
      inputSchema: z.object({
        paths: z.array(z.string().trim().min(1)).min(1),
      }),
      execute: async ({ paths }) => {
        const files = await Promise.all(
          paths.map(async (entry) => {
            const resolved = resolveWorkspacePath(rootDir, entry);
            const content = await readFile(resolved, { encoding: "utf8" });
            const bytes = Buffer.byteLength(content, "utf8");
            return { path: entry, content, bytes };
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
        if (
          shouldEnforceLessonPipeline &&
          isLessonGeneratedJsonPath(inputPath)
        ) {
          throw new Error(
            `Direct writes to "${inputPath}" are not allowed for lesson runs. Use generate_text with outputPath="${inputPath}" instead.`,
          );
        }
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
        if (shouldEnforceLessonPipeline) {
          for (const op of operations) {
            if (isLessonGeneratedJsonPath(op.path)) {
              throw new Error(
                `Direct patch writes to "${op.path}" are not allowed for lesson runs. Use generate_text with outputPath="${op.path}" instead.`,
              );
            }
          }
        }
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
}

export function buildSparkAgentToolsForTest(options: {
  workspace: SparkAgentWorkspace;
  rootDir: string;
  userId: string;
  serviceAccountJson: string;
  progress?: JobProgressReporter;
  enforceLessonPipeline?: boolean;
  debug?: LlmDebugOptions;
}): LlmToolSet {
  return buildAgentTools(options);
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
  readonly toolLoopResult: Awaited<ReturnType<typeof runToolLoop>>;
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
  const openAiReasoningEffort = resolveOpenAiReasoningEffort(modelId);
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

  const baseTools = buildAgentTools({
    workspace,
    rootDir: options.rootDir,
    userId: options.userId,
    serviceAccountJson: "{}",
    progress,
    enforceLessonPipeline: true,
    debug: options.debug,
  });

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
  const publish_lesson = tool({
    description:
      "Mock publish_lesson for local runs. Validates workspace JSON and returns counts but does not write Firestore.",
    inputSchema: baseTools.publish_lesson
      .inputSchema as z.ZodType<PublishLessonToolInput>,
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

  const toolLoopResult = await runToolLoop({
    modelId,
    systemPrompt: buildAgentSystemPrompt(),
    prompt: options.prompt,
    tools: {
      ...baseTools,
      publish_lesson,
      done,
    },
    modelTools: [{ type: "web-search", mode: "live" }],
    maxSteps,
    ...(options.debug ? { debug: options.debug } : {}),
    ...(progress ? { progress } : {}),
    ...(openAiReasoningEffort ? { openAiReasoningEffort } : {}),
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
  const agentDocPath = `users/${options.userId}/agents/${options.agentId}`;

  const statsTracker = new AgentRunStatsTracker();

  let prompt = "";
  let logSync: AgentLogSync | undefined;
  let workspaceRoot: string | undefined;
  let workspaceSync: WorkspaceSync | undefined;

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
      return;
    }

    await updateAgentStatus({
      serviceAccountJson,
      agentDocPath,
      status: "executing",
    });

    logSync = new AgentLogSync({
      serviceAccountJson,
      userId: options.userId,
      agentId: options.agentId,
      throttleMs: AGENT_LOG_THROTTLE_MS,
      initialStats: statsTracker.snapshot(),
    });
    console.log(
      `[spark-agent:${options.agentId}] start workspaceId=${options.workspaceId}`,
    );
    logSync.append(`start: workspaceId=${options.workspaceId}`);

    workspaceRoot = path.join(
      os.tmpdir(),
      "spark-agent-workspaces",
      options.workspaceId,
    );
    await ensureDir(workspaceRoot);
    workspaceSync = new WorkspaceSync({
      serviceAccountJson,
      userId: options.userId,
      workspaceId: options.workspaceId,
      rootDir: workspaceRoot,
    });
    await workspaceSync.load();

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

    const modelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
    const isLessonRun = Boolean(
      typeof agentData.lessonSessionId === "string" &&
      agentData.lessonSessionId.trim().length > 0,
    );
    const maxSteps =
      options.maxSteps ??
      (isLessonRun ? DEFAULT_LESSON_MAX_STEPS : DEFAULT_MAX_STEPS);
    const openAiReasoningEffort = resolveOpenAiReasoningEffort(modelId);
    const progress: JobProgressReporter = {
      log: (message) => {
        throwIfStopRequested();
        console.log(`[spark-agent:${options.agentId}] ${message}`);
        logSync?.append(message);
        statsTracker.parseLogLine(message);
        logSync?.setStats(statsTracker.snapshot());
      },
      startModelCall: (details) => {
        throwIfStopRequested();
        const handle = statsTracker.startModelCall({
          modelId: details.modelId,
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

    const tools: LlmToolSet = {
      ...buildAgentTools({
        workspace: workspaceSync,
        rootDir: workspaceRoot,
        userId: options.userId,
        serviceAccountJson,
        progress,
        enforceLessonPipeline: isLessonRun,
      }),
      done: tool({
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
          await updateAgentStatus({
            serviceAccountJson,
            agentDocPath,
            status: "done",
            resultSummary: summary,
          });
          return { status: "done", summary };
        },
      }),
    };

    progress.log(
      `[spark-agent:${options.agentId}] exposed tools: ${Object.keys(tools).sort().join(", ")}`,
    );

    await pollStopRequested();
    if (stopRequested) {
      throw new StopRequestedError();
    }
    startStopPolling();

    const toolLoopResult = await runToolLoop({
      modelId,
      systemPrompt: buildAgentSystemPrompt(),
      prompt,
      tools,
      modelTools: [{ type: "web-search", mode: "live" }],
      maxSteps,
      progress,
      openAiReasoningEffort,
      onDelta: (delta) => {
        if (delta.thoughtDelta) {
          logSync?.appendThoughtDelta(delta.thoughtDelta);
        }
        if (delta.textDelta) {
          logSync?.appendAssistantDelta(delta.textDelta);
        }
      },
    });

    if (!doneCalled) {
      const responseText = toolLoopResult.text.trim();
      const summary =
        responseText.length > 1000
          ? `${responseText.slice(0, 1000).trim()}…`
          : responseText;

      logSync?.append(
        "warn: model returned a final response without calling done; auto-completing run",
      );

      if (responseText.length > 0 && workspaceRoot) {
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

      await tools.done.execute({
        summary: summary.length > 0 ? summary : undefined,
      });
    }

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
    return;
  } finally {
    await stopStopPolling();
    logSync?.dispose();
    if (workspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
