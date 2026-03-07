import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";

import {
  generateText,
  type LlmContentPart,
  type LlmInputMessage,
  type LlmThinkingLevel,
  type LlmTextModelId,
  type LlmToolLoopResult,
  type LlmUsageTokens,
} from "@ljoukov/llm";

export type ModelCallMetrics = {
  modelId: string;
  modelVersion: string | null;
  elapsedMs: number;
  costUsd: number;
  usageTokens: LlmUsageTokens | null;
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

export type ToolLoopSummary = {
  usageTotals: UsageTotals;
  toolCallsByName: Record<string, number>;
  modelCalls: number;
  toolCalls: number;
  doneSummary: string | null;
  thoughtsChars: number;
  responseChars: number;
  agentCostUsd: number;
  toolLlmCostUsd: number;
};

export type RepoPathHelpers = {
  toRepoRelativePath: (inputPath: string) => string;
  fromRepoRelativePath: (inputPath: string) => string;
  sanitizeLogText: (input: string) => string;
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

function addUsageTotals(
  target: UsageTotals,
  next: LlmUsageTokens,
): void {
  target.promptTokens += next.promptTokens ?? 0;
  target.cachedTokens += next.cachedTokens ?? 0;
  target.responseTokens += next.responseTokens ?? 0;
  target.responseImageTokens += next.responseImageTokens ?? 0;
  target.thinkingTokens += next.thinkingTokens ?? 0;
  target.totalTokens += next.totalTokens ?? 0;
  target.toolUsePromptTokens += next.toolUsePromptTokens ?? 0;
}

export function summarizeToolLoopResult(result: LlmToolLoopResult): ToolLoopSummary {
  const usageTotals = emptyUsageTotals();
  const toolCallsByName: Record<string, number> = {};
  let doneSummary: string | null = null;
  let toolLlmCostUsd = 0;

  for (const step of result.steps) {
    if (step.usage) {
      addUsageTotals(usageTotals, step.usage);
    }
    for (const toolCall of step.toolCalls) {
      toolCallsByName[toolCall.toolName] = (toolCallsByName[toolCall.toolName] ?? 0) + 1;
      if (toolCall.toolName === "done") {
        const outputRecord =
          toolCall.output && typeof toolCall.output === "object" && !Array.isArray(toolCall.output)
            ? (toolCall.output as Record<string, unknown>)
            : null;
        const summary = outputRecord?.summary;
        if (typeof summary === "string" && summary.trim().length > 0) {
          doneSummary = summary.trim();
        }
      }
      const outputRecord =
        toolCall.output && typeof toolCall.output === "object" && !Array.isArray(toolCall.output)
          ? (toolCall.output as Record<string, unknown>)
          : null;
      const rawToolCost = outputRecord?.costUsd;
      if (typeof rawToolCost === "number" && Number.isFinite(rawToolCost) && rawToolCost >= 0) {
        toolLlmCostUsd += rawToolCost;
      }
    }
  }

  const toolCalls = Object.values(toolCallsByName).reduce((sum, count) => sum + count, 0);
  return {
    usageTotals,
    toolCallsByName,
    modelCalls: result.steps.length,
    toolCalls,
    doneSummary,
    thoughtsChars: result.thoughts.length,
    responseChars: result.text.length,
    agentCostUsd: result.totalCostUsd,
    toolLlmCostUsd,
  };
}

export function toToolLoopEventLogRecords(result: LlmToolLoopResult): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const step of result.steps) {
    records.push({
      type: "model_step",
      step: step.step,
      modelVersion: step.modelVersion,
      costUsd: step.costUsd,
      usage: step.usage ?? null,
      textChars: step.text?.length ?? 0,
      thoughtChars: step.thoughts?.length ?? 0,
      toolCalls: step.toolCalls.length,
      timing: step.timing ?? null,
    });
    for (const [toolIndex, toolCall] of step.toolCalls.entries()) {
      records.push({
        type: "tool_call",
        step: step.step,
        toolIndex,
        toolName: toolCall.toolName,
        callId: toolCall.callId,
        input: toolCall.input,
        output: toolCall.output,
        ...(typeof toolCall.error === "string" ? { error: toolCall.error } : {}),
      });
    }
  }
  return records;
}

export async function generateTextWithMetrics(options: {
  modelId: LlmTextModelId;
  input: readonly LlmInputMessage[];
  responseMimeType?: string;
  thinkingLevel?: LlmThinkingLevel;
}): Promise<{ text: string; metrics: ModelCallMetrics }> {
  const startedAt = Date.now();
  const result = await generateText({
    model: options.modelId,
    input: options.input,
    ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
    ...(options.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
  });
  const elapsedMs = Date.now() - startedAt;

  return {
    text: result.text,
    metrics: {
      modelId: options.modelId,
      modelVersion: result.modelVersion,
      elapsedMs,
      costUsd: result.costUsd,
      usageTokens: result.usage ?? null,
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
