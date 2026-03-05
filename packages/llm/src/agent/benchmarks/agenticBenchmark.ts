import path from "node:path";
import { appendFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";

import type { AgentTelemetryEvent } from "@ljoukov/llm";

import {
  estimateCallCostUsd,
  generateText,
  type LlmContent,
  type LlmContentPart,
  type LlmStreamEvent,
  type LlmTextModelId,
} from "../../utils/llm";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  LlmUsageTokenUpdate,
  ModelCallHandle,
} from "../../utils/concurrency";

export type ModelCallMetrics = {
  modelId: string;
  modelVersion: string | null;
  elapsedMs: number;
  costUsd: number;
  usageTokens: LlmUsageTokenUpdate | null;
};

export type UsageTotals = {
  promptTokens: number;
  cachedTokens: number;
  responseTokens: number;
  responseImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  toolUsePromptTokens: number;
};

export type RepoPathHelpers = {
  toRepoRelativePath: (inputPath: string) => string;
  fromRepoRelativePath: (inputPath: string) => string;
  sanitizeLogText: (input: string) => string;
};

export type AgenticBenchmarkLoggerSnapshot = {
  usageTotals: UsageTotals;
  usageCostUsd: number;
  thoughtChars: number;
  responseChars: number;
  doneSummary: string | null;
  toolCallsByName: Record<string, number>;
  eventLogRecords: Array<Record<string, unknown>>;
  splitLogPathsCreated: string[];
};

export type AgenticBenchmarkLogger = {
  logStage: (kind: "start" | "done", stage: string) => void;
  logLine: (line: string, actor?: string) => string;
  onTelemetryEvent: (event: AgentTelemetryEvent) => void;
  onEvent: (event: LlmStreamEvent) => void;
  overrideUsageCostUsd: (value: number) => void;
  snapshot: () => AgenticBenchmarkLoggerSnapshot;
};

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "n/a";
  }
  if (ms < 1000) {
    return `${Math.round(ms).toString()}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) {
    return "$0.0000";
  }
  return `$${usd.toFixed(4)}`;
}

export function toModelSlug(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (slug.length === 0) {
    return "model";
  }
  return slug;
}

export function toRunTimestampSlug(): string {
  return new Date().toISOString().replace(/[:.]/gu, "-");
}

export function toSingleLine(input: string): string {
  return input.replace(/\r?\n/gu, "\\n");
}

export function createRepoPathHelpers(options: {
  benchmarkDir: string;
  repoRootDir: string;
}): RepoPathHelpers {
  const toRepoRelativePath = (inputPath: string): string => {
    const absolutePath = path.isAbsolute(inputPath)
      ? inputPath
      : path.resolve(options.benchmarkDir, inputPath);
    const relative = path
      .relative(options.repoRootDir, absolutePath)
      .replaceAll("\\", "/");
    if (relative.length === 0) {
      return ".";
    }
    if (relative.startsWith("..")) {
      return path.basename(absolutePath);
    }
    return relative;
  };

  const fromRepoRelativePath = (inputPath: string): string => {
    if (path.isAbsolute(inputPath)) {
      return inputPath;
    }
    return path.resolve(options.repoRootDir, inputPath);
  };

  const sanitizeLogText = (input: string): string => {
    const repoRootNormalised = options.repoRootDir.replaceAll("\\", "/");
    return input.replaceAll("\\", "/").replaceAll(repoRootNormalised, ".");
  };

  return {
    toRepoRelativePath,
    fromRepoRelativePath,
    sanitizeLogText,
  };
}

export async function assertFileExists(inputPath: string): Promise<void> {
  await stat(inputPath).catch(() => {
    throw new Error(`File not found: ${inputPath}`);
  });
}

export async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      output.push(absolute);
    }
  };
  await visit(rootDir);
  output.sort((a, b) => a.localeCompare(b));
  return output;
}

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars)}…`;
}

function redactInlineDataUrls(input: string): string {
  return input.replaceAll(
    /(data:[^;,\s"]+;base64,)[^"\s]+/gu,
    "$1...",
  );
}

function serialiseSnippet(value: unknown, maxChars = 500): string {
  if (typeof value === "string") {
    return truncateText(redactInlineDataUrls(value).replace(/\s+/gu, " ").trim(), maxChars);
  }
  try {
    const text = JSON.stringify(value);
    if (typeof text === "string") {
      return truncateText(redactInlineDataUrls(text).replace(/\s+/gu, " ").trim(), maxChars);
    }
    return "<unserializable>";
  } catch {
    return "<unserializable>";
  }
}

function sanitiseActorLabel(actor: string): string {
  const trimmed = actor.trim();
  if (trimmed.length === 0) {
    return "main";
  }
  return trimmed.replaceAll(/[^a-zA-Z0-9:_-]/gu, "_");
}

function resolveToolEventActor(event: Extract<LlmStreamEvent, { type: "tool_call" }>): string {
  const input = event.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return "main";
  }
  const record = input as Record<string, unknown>;

  const explicitActorKeys = ["subagentName", "subagent", "agentName", "agent"] as const;
  for (const key of explicitActorKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return sanitiseActorLabel(value);
    }
  }

  const idValue = record.id;
  if (
    typeof idValue === "string" &&
    idValue.trim().length > 0 &&
    (event.toolName === "send_input" ||
      event.toolName === "wait" ||
      event.toolName === "close_agent" ||
      event.toolName === "resume_agent")
  ) {
    return `agent:${sanitiseActorLabel(idValue)}`;
  }

  return "main";
}

function shortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

function extractAgentIdFromSpawnOutput(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const record = output as Record<string, unknown>;
  const directAgentId = record.agent_id;
  if (typeof directAgentId === "string" && directAgentId.trim().length > 0) {
    return directAgentId.trim();
  }
  const directId = record.id;
  if (typeof directId === "string" && directId.trim().length > 0) {
    return directId.trim();
  }
  const nestedAgent = record.agent;
  if (!nestedAgent || typeof nestedAgent !== "object" || Array.isArray(nestedAgent)) {
    return null;
  }
  const nestedRecord = nestedAgent as Record<string, unknown>;
  const nestedAgentId = nestedRecord.agent_id;
  if (typeof nestedAgentId === "string" && nestedAgentId.trim().length > 0) {
    return nestedAgentId.trim();
  }
  const nestedId = nestedRecord.id;
  if (typeof nestedId === "string" && nestedId.trim().length > 0) {
    return nestedId.trim();
  }
  return null;
}

export function emptyUsageTotals(): UsageTotals {
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

function addUsageTotals(target: UsageTotals, next: LlmUsageTokenUpdate): void {
  target.promptTokens += next.promptTokens ?? 0;
  target.cachedTokens += next.cachedTokens ?? 0;
  target.responseTokens += next.responseTokens ?? 0;
  target.responseImageTokens += next.responseImageTokens ?? 0;
  target.thinkingTokens += next.thinkingTokens ?? 0;
  target.totalTokens += next.totalTokens ?? 0;
  target.toolUsePromptTokens += next.toolUsePromptTokens ?? 0;
}

function mergeUsageTokens(
  current: LlmUsageTokenUpdate | null,
  next: LlmUsageTokenUpdate | undefined,
): LlmUsageTokenUpdate | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return {
    promptTokens: next.promptTokens ?? current.promptTokens,
    cachedTokens: next.cachedTokens ?? current.cachedTokens,
    responseTokens: next.responseTokens ?? current.responseTokens,
    responseImageTokens: next.responseImageTokens ?? current.responseImageTokens,
    thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    toolUsePromptTokens: next.toolUsePromptTokens ?? current.toolUsePromptTokens,
  };
}

export async function generateTextWithMetrics(options: {
  modelId: LlmTextModelId;
  contents: readonly LlmContent[];
  responseMimeType?: string;
  openAiReasoningEffort?: "low" | "medium" | "high";
}): Promise<{ text: string; metrics: ModelCallMetrics }> {
  let activeHandle: ModelCallHandle | null = null;
  let modelVersion: string | null = null;
  let usageTokens: LlmUsageTokenUpdate | null = null;

  const progress: JobProgressReporter = {
    log: () => {},
    startModelCall: () => {
      const handle = Symbol("agentic-benchmark-model-call");
      activeHandle = handle;
      return handle;
    },
    recordModelUsage: (handle: ModelCallHandle, chunk: LlmUsageChunk) => {
      if (activeHandle !== handle) {
        return;
      }
      if (typeof chunk.modelVersion === "string" && chunk.modelVersion.trim().length > 0) {
        modelVersion = chunk.modelVersion.trim();
      }
      usageTokens = mergeUsageTokens(usageTokens, chunk.tokens);
    },
    finishModelCall: () => {},
    startStage: () => Symbol("stage"),
    finishStage: () => {},
    setActiveStages: () => {},
  };

  const startedAt = Date.now();
  const text = await generateText({
    modelId: options.modelId,
    contents: options.contents,
    ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
    ...(options.openAiReasoningEffort
      ? { openAiReasoningEffort: options.openAiReasoningEffort }
      : {}),
    progress,
  });
  const elapsedMs = Date.now() - startedAt;
  const costUsd = estimateCallCostUsd({
    modelId: options.modelId,
    tokens: usageTokens ?? {},
    responseImages: 0,
  });

  return {
    text,
    metrics: {
      modelId: options.modelId,
      modelVersion,
      elapsedMs,
      costUsd,
      usageTokens,
    },
  };
}

function inferImageMimeType(imagePath: string): string {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".heic" || extension === ".heif") {
    return "image/heic";
  }
  return "application/octet-stream";
}

export async function toInlineImageParts(paths: readonly string[]): Promise<LlmContentPart[]> {
  const parts: LlmContentPart[] = [];
  for (const [index, imagePath] of paths.entries()) {
    const data = await readFile(imagePath);
    parts.push({
      type: "text",
      text: `Image ${(index + 1).toString()}: ${path.basename(imagePath)}`,
    });
    parts.push({
      type: "inlineData",
      mimeType: inferImageMimeType(imagePath),
      data: data.toString("base64"),
    });
  }
  return parts;
}

export function createAgenticBenchmarkLogger(options: {
  benchLabel: string;
  runRootDir: string;
  agentLogPath: string;
  useSubagents: boolean;
  agentMainLogPath?: string;
  stageOrder: readonly string[];
  sanitizeLine?: (input: string) => string;
}): AgenticBenchmarkLogger {
  const sanitizeLine = options.sanitizeLine ?? ((input: string): string => input);
  const usageTotals = emptyUsageTotals();
  let usageCostUsd = 0;
  let thoughtChars = 0;
  let responseChars = 0;
  let doneSummary: string | null = null;
  const eventLogRecords: Array<Record<string, unknown>> = [];
  const toolCallsByName: Record<string, number> = {};
  let completedStages = 0;
  let failedToWriteAgentLog = false;
  const failedSplitLogPaths = new Set<string>();
  const bufferedSubagentLogLinesByRunId = new Map<string, string[]>();
  const subagentRunIdToAgentId = new Map<string, string>();
  const pendingSubagentRunIds: string[] = [];
  const pendingSpawnedAgentIds: string[] = [];
  const splitLogPathsCreated = new Set<string>();

  const buildAgentPrefix = (actor: string): string => {
    return `[spark-agent:${options.benchLabel}/${sanitiseActorLabel(actor)}]`;
  };

  const appendLine = (line: string): void => {
    if (failedToWriteAgentLog) {
      return;
    }
    try {
      appendFileSync(options.agentLogPath, `${line}\n`, "utf8");
    } catch (error: unknown) {
      failedToWriteAgentLog = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${options.benchLabel}] failed to write agent.log: ${message}`);
    }
  };

  const resolveSplitLogPath = (actor: string): string | null => {
    if (!options.useSubagents) {
      return null;
    }
    if (actor === "main") {
      return options.agentMainLogPath ?? null;
    }
    if (actor.startsWith("agent:")) {
      const rawAgentId = actor.slice("agent:".length).trim();
      if (rawAgentId.length === 0) {
        return null;
      }
      return path.join(options.runRootDir, `agent_${sanitiseActorLabel(rawAgentId)}.log`);
    }
    return null;
  };

  const appendSplitLogLine = (actor: string, timestampedLine: string): void => {
    const splitLogPath = resolveSplitLogPath(actor);
    if (!splitLogPath) {
      return;
    }
    if (failedSplitLogPaths.has(splitLogPath)) {
      return;
    }
    try {
      appendFileSync(splitLogPath, `${timestampedLine}\n`, "utf8");
      splitLogPathsCreated.add(splitLogPath);
    } catch (error: unknown) {
      failedSplitLogPaths.add(splitLogPath);
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[${options.benchLabel}] failed to write ${path.basename(splitLogPath)}: ${message}`,
      );
    }
  };

  const flushBufferedSubagentLines = (runId: string, agentId: string): void => {
    const buffered = bufferedSubagentLogLinesByRunId.get(runId);
    if (!buffered || buffered.length === 0) {
      return;
    }
    const actor = `agent:${agentId}`;
    for (const line of buffered) {
      appendSplitLogLine(actor, line);
    }
    bufferedSubagentLogLinesByRunId.delete(runId);
  };

  const tryPairPendingSubagentIds = (): void => {
    while (pendingSubagentRunIds.length > 0 && pendingSpawnedAgentIds.length > 0) {
      const runId = pendingSubagentRunIds.shift();
      const agentId = pendingSpawnedAgentIds.shift();
      if (!runId || !agentId) {
        continue;
      }
      const safeAgentId = sanitiseActorLabel(agentId);
      subagentRunIdToAgentId.set(runId, safeAgentId);
      flushBufferedSubagentLines(runId, safeAgentId);
      const mappingLine = `subagent_mapping: runId=${runId} agentId=${safeAgentId}`;
      const mappedLine = `${buildAgentPrefix("main")} ${mappingLine}`;
      console.log(mappedLine);
      const timestamped = `${new Date().toISOString()} ${mappedLine}`;
      appendLine(timestamped);
      appendSplitLogLine("main", timestamped);
    }
  };

  const registerPendingSubagentRun = (runId: string): void => {
    if (subagentRunIdToAgentId.has(runId)) {
      return;
    }
    if (pendingSubagentRunIds.includes(runId)) {
      return;
    }
    pendingSubagentRunIds.push(runId);
    tryPairPendingSubagentIds();
  };

  const registerSpawnedAgentId = (agentId: string): void => {
    const safeAgentId = sanitiseActorLabel(agentId);
    pendingSpawnedAgentIds.push(safeAgentId);
    tryPairPendingSubagentIds();
  };

  const resolveTelemetryActor = (runId: string): string => {
    const agentId = subagentRunIdToAgentId.get(runId);
    if (agentId) {
      return `agent:${agentId}`;
    }
    return `subagent-run:${shortId(runId)}`;
  };

  const trackUnmappedTelemetryLine = (runId: string, timestampedLine: string): void => {
    if (subagentRunIdToAgentId.has(runId)) {
      return;
    }
    const existing = bufferedSubagentLogLinesByRunId.get(runId) ?? [];
    existing.push(timestampedLine);
    bufferedSubagentLogLinesByRunId.set(runId, existing);
  };

  const logLine = (line: string, actor = "main"): string => {
    const normalisedLine = `${buildAgentPrefix(actor)} ${sanitizeLine(line)}`;
    console.log(normalisedLine);
    const timestamped = `${new Date().toISOString()} ${normalisedLine}`;
    appendLine(timestamped);
    appendSplitLogLine(actor, timestamped);
    return timestamped;
  };

  const logSubagentTelemetry = (runId: string, line: string): void => {
    const actor = resolveTelemetryActor(runId);
    const timestamped = logLine(line, actor);
    trackUnmappedTelemetryLine(runId, timestamped);
  };

  const logStage = (kind: "start" | "done", stage: string): void => {
    if (kind === "done") {
      completedStages = Math.min(options.stageOrder.length, completedStages + 1);
    }
    const stageCount = Math.max(1, options.stageOrder.length);
    const value = Math.round((completedStages / stageCount) * 100);
    const line = `[${value.toString().padStart(2, "0")}%] [${options.benchLabel}] stage:${kind} ${stage}`;
    console.log(line);
    const agentLine = `${buildAgentPrefix("main")} stage:${kind} ${stage}`;
    console.log(agentLine);
    const timestamped = `${new Date().toISOString()} ${agentLine}`;
    appendLine(timestamped);
    appendSplitLogLine("main", timestamped);
  };

  const onTelemetryEvent = (event: AgentTelemetryEvent): void => {
    if (event.depth <= 0) {
      return;
    }
    registerPendingSubagentRun(event.runId);
    const modelName = typeof event.model === "string" ? event.model : String(event.model);

    if (event.type === "agent.run.started") {
      logSubagentTelemetry(
        event.runId,
        `subagent_started: runId=${event.runId} parentRunId=${event.parentRunId ?? "n/a"} depth=${event.depth.toString()} model=${modelName}`,
      );
      return;
    }

    if (event.type === "agent.run.completed") {
      logSubagentTelemetry(
        event.runId,
        `subagent_done: runId=${event.runId} success=${event.success ? "true" : "false"} duration=${formatMs(event.durationMs)} steps=${event.stepCount?.toString() ?? "n/a"} toolCalls=${event.toolCallCount?.toString() ?? "n/a"} cost=${formatUsd(event.totalCostUsd ?? 0)}${event.error ? ` error=${toSingleLine(event.error)}` : ""}`,
      );
      return;
    }

    const streamEvent = event.event;
    if (streamEvent.type !== "tool_call") {
      return;
    }

    const inputSnippet = serialiseSnippet(streamEvent.input);
    if (streamEvent.phase === "started") {
      logSubagentTelemetry(
        event.runId,
        `trace_tool_call: turn=${streamEvent.turn.toString()} index=${streamEvent.toolIndex.toString()} tool=${streamEvent.toolName} input=${inputSnippet}`,
      );
      return;
    }

    const outputSnippet = serialiseSnippet(streamEvent.output);
    const status = typeof streamEvent.error === "string" ? `error=${streamEvent.error}` : "ok";
    logSubagentTelemetry(
      event.runId,
      `trace_tool_result: turn=${streamEvent.turn.toString()} index=${streamEvent.toolIndex.toString()} tool=${streamEvent.toolName} durationMs=${typeof streamEvent.durationMs === "number" ? streamEvent.durationMs.toString() : "n/a"} ${status} output=${outputSnippet}`,
    );
  };

  const onEvent = (event: LlmStreamEvent): void => {
    const nowIso = new Date().toISOString();
    if (event.type === "delta") {
      if (event.channel === "thought") {
        thoughtChars += event.text.length;
        logLine(`thought_delta: ${toSingleLine(event.text)}`, "main");
      } else {
        responseChars += event.text.length;
        logLine(`response_delta: ${toSingleLine(event.text)}`, "main");
      }
      eventLogRecords.push({
        ts: nowIso,
        type: event.type,
        channel: event.channel,
        text: truncateText(event.text, 300),
      });
      return;
    }

    if (event.type === "usage") {
      usageCostUsd += event.costUsd;
      addUsageTotals(usageTotals, event.usage);
      const modelVersionLabel =
        typeof event.modelVersion === "string" ? event.modelVersion : "n/a";
      logLine(
        `usage: modelVersion=${modelVersionLabel} cost=${formatUsd(event.costUsd)} tokens=${serialiseSnippet(event.usage, 300)}`,
        "main",
      );
      eventLogRecords.push({
        ts: nowIso,
        type: event.type,
        costUsd: event.costUsd,
        usage: event.usage,
        modelVersion: event.modelVersion,
      });
      return;
    }

    if (event.type === "model") {
      logLine(`model: ${event.modelVersion}`, "main");
      eventLogRecords.push({
        ts: nowIso,
        type: event.type,
        modelVersion: event.modelVersion,
      });
      return;
    }

    if (event.type !== "tool_call") {
      logLine(`event: ${event.type}`, "main");
      eventLogRecords.push({ ts: nowIso, type: event.type });
      return;
    }

    const actor = resolveToolEventActor(event);
    const inputSnippet = serialiseSnippet(event.input);
    const outputSnippet =
      event.phase === "completed" ? serialiseSnippet(event.output) : undefined;
    if (event.phase === "started") {
      logLine(
        `trace_tool_call: turn=${event.turn.toString()} index=${event.toolIndex.toString()} tool=${event.toolName} input=${inputSnippet}`,
        actor,
      );
    } else {
      const status = typeof event.error === "string" ? `error=${event.error}` : "ok";
      logLine(
        `trace_tool_result: turn=${event.turn.toString()} index=${event.toolIndex.toString()} tool=${event.toolName} durationMs=${typeof event.durationMs === "number" ? event.durationMs.toString() : "n/a"} ${status} output=${outputSnippet ?? "<none>"}`,
        actor,
      );
    }
    if (event.phase === "completed") {
      toolCallsByName[event.toolName] = (toolCallsByName[event.toolName] ?? 0) + 1;
      if (event.toolName === "spawn_agent") {
        const agentId = extractAgentIdFromSpawnOutput(event.output);
        if (agentId) {
          registerSpawnedAgentId(agentId);
        }
      }
      if (event.toolName === "done") {
        const output =
          event.output && typeof event.output === "object" && !Array.isArray(event.output)
            ? (event.output as Record<string, unknown>)
            : null;
        const summary = output?.summary;
        if (typeof summary === "string" && summary.trim().length > 0) {
          doneSummary = summary.trim();
        }
      }
    }
    eventLogRecords.push({
      ts: nowIso,
      type: "tool_call",
      phase: event.phase,
      turn: event.turn,
      toolIndex: event.toolIndex,
      toolName: event.toolName,
      input: event.input,
      ...(event.phase === "completed" ? { output: event.output } : {}),
      ...(event.phase === "completed" && typeof event.durationMs === "number"
        ? { durationMs: event.durationMs }
        : {}),
      ...(event.phase === "completed" && typeof event.error === "string"
        ? { error: event.error }
        : {}),
    });
  };

  const overrideUsageCostUsd = (value: number): void => {
    if (Number.isFinite(value) && value >= 0) {
      usageCostUsd = value;
    }
  };

  const snapshot = (): AgenticBenchmarkLoggerSnapshot => {
    return {
      usageTotals: {
        promptTokens: usageTotals.promptTokens,
        cachedTokens: usageTotals.cachedTokens,
        responseTokens: usageTotals.responseTokens,
        responseImageTokens: usageTotals.responseImageTokens,
        thinkingTokens: usageTotals.thinkingTokens,
        totalTokens: usageTotals.totalTokens,
        toolUsePromptTokens: usageTotals.toolUsePromptTokens,
      },
      usageCostUsd,
      thoughtChars,
      responseChars,
      doneSummary,
      toolCallsByName: { ...toolCallsByName },
      eventLogRecords: [...eventLogRecords],
      splitLogPathsCreated: Array.from(splitLogPathsCreated),
    };
  };

  return {
    logStage,
    logLine,
    onTelemetryEvent,
    onEvent,
    overrideUsageCostUsd,
    snapshot,
  };
}
