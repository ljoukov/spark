import { Buffer } from "node:buffer";

import {
  type AgentSubagentToolSelection,
  createToolLoopSteeringChannel as createToolLoopSteeringChannelV2,
  convertGooglePartsToLlmParts as convertGooglePartsToLlmPartsV2,
  generateImageInBatches as generateImageInBatchesV2,
  generateImages as generateImagesV2,
  generateJson as generateJsonV2,
  isLlmImageModelId,
  isLlmModelId,
  isLlmTextModelId,
  runAgentLoop as runAgentLoopV2,
  streamText,
  type JsonSchema,
  type LlmExecutableTool,
  type LlmImageData,
  type LlmImageModelId as LlmImageModelIdV2,
  type LlmImageSize,
  type LlmModelId as LlmModelIdV2,
  type LlmStreamEvent,
  type LlmThinkingLevel,
  type LlmTextModelId as LlmTextModelIdV2,
  type LlmToolCallContext,
  type LlmToolConfig,
  type LlmToolLoopSteeringChannel as LlmToolLoopSteeringChannelV2,
  type LlmToolSet,
} from "@ljoukov/llm";
import type { Part as GooglePart } from "@google/genai";
import type { ResponseTextConfig } from "openai/resources/responses/responses";
import { z } from "zod";

import type { OpenAiReasoningEffort } from "./openai-llm";
import { loadLocalEnv } from "./env";
import type { JobProgressReporter, LlmUsageChunk, ModelCallHandle } from "./concurrency";
import {
  configureSparkLlmTelemetryFromEnv,
  publishSparkLlmCallMetricsFromEnv,
  publishSparkToolLoopStepMetricsFromEnv,
  resolveSparkMetricProviderLabel,
} from "./gcp/monitoring";

// NOTE:
// This module intentionally preserves the existing @spark/llm "v1" call shapes
// (modelId + contents, generateText returns string, generateJson returns T)
// while delegating provider logic to @ljoukov/llm.

export {
  appendMarkdownSourcesSection,
  estimateCallCostUsd,
  getCurrentToolCallContext,
  LlmJsonCallError,
  parseJsonFromLlmText,
  sanitisePartForLogging,
  stripCodexCitationMarkers,
  toGeminiJsonSchema,
  tool,
} from "@ljoukov/llm";

export type {
  JsonSchema,
  LlmExecutableTool,
  LlmImageData,
  LlmImageSize,
  LlmStreamEvent,
  LlmToolCallContext,
  LlmToolConfig,
  LlmToolSet,
};

export type LlmToolLoopSteeringChannel = LlmToolLoopSteeringChannelV2;

export function createToolLoopSteeringChannel(): LlmToolLoopSteeringChannel {
  return createToolLoopSteeringChannelV2();
}

export type LlmRole = "user" | "model" | "system" | "tool";

type LlmInlineDataPart = {
  type: "inlineData";
  data: string;
  mimeType?: string;
};

export type LlmContentPart = { type: "text"; text: string; thought?: boolean } | LlmInlineDataPart;

export type LlmContent = {
  readonly role: LlmRole;
  readonly parts: readonly LlmContentPart[];
};

export function convertGooglePartsToLlmParts(parts: readonly GooglePart[]): LlmContentPart[] {
  // @ljoukov/llm depends on its own @google/genai version; cast via unknown to avoid coupling.
  return convertGooglePartsToLlmPartsV2(
    parts as unknown as Parameters<typeof convertGooglePartsToLlmPartsV2>[0],
  ) as unknown as LlmContentPart[];
}

export type LlmTextModelId = string;
export type LlmImageModelId = string;
export type LlmModelId = string;

const LEGACY_LLM_MODEL_ID_ALIASES = {
  "gpt-5.2-codex": "gpt-5.3-codex",
  "chatgpt-gpt-5.2-codex": "chatgpt-gpt-5.3-codex",
} as const;

function normaliseLlmModelId(modelId: string): string {
  const mapped =
    LEGACY_LLM_MODEL_ID_ALIASES[modelId as keyof typeof LEGACY_LLM_MODEL_ID_ALIASES];
  if (mapped !== undefined) {
    return mapped;
  }
  return modelId;
}

function resolveLlmModelId(modelId: string): LlmModelIdV2 {
  const normalisedModelId = normaliseLlmModelId(modelId);
  const trimmedModelId = normalisedModelId.trim();
  if (trimmedModelId.length === 0) {
    throw new Error(`Unsupported model id: ${modelId}`);
  }
  if (isLlmModelId(trimmedModelId)) {
    return trimmedModelId;
  }
  throw new Error(`Unsupported model id: ${modelId}`);
}

function resolveLlmTextModelId(modelId: string): LlmTextModelIdV2 {
  const resolvedModelId = resolveLlmModelId(modelId);
  if (isLlmTextModelId(resolvedModelId)) {
    return resolvedModelId;
  }
  throw new Error(`Unsupported text model id: ${modelId}`);
}

function resolveLlmImageModelId(modelId: string): LlmImageModelIdV2 {
  const resolvedModelId = resolveLlmModelId(modelId);
  if (isLlmImageModelId(resolvedModelId)) {
    return resolvedModelId;
  }
  throw new Error(`Unsupported image model id: ${modelId}`);
}

export type LlmDebugOptions = {
  readonly rootDir: string;
  readonly stage?: string;
  readonly subStage?: string;
  readonly enabled?: boolean;
};

export type LlmTextDelta = {
  readonly textDelta?: string;
  readonly thoughtDelta?: string;
};

type OpenAiTextFormat = ResponseTextConfig["format"];

export type LlmCallBaseOptions = {
  readonly modelId: LlmModelId;
  readonly contents: readonly LlmContent[];
  readonly progress?: JobProgressReporter;
  readonly debug?: LlmDebugOptions;
  readonly imageSize?: LlmImageSize;
  readonly openAiReasoningEffort?: OpenAiReasoningEffort;
};

export type LlmTextCallOptions = LlmCallBaseOptions & {
  readonly responseMimeType?: string;
  readonly responseJsonSchema?: JsonSchema;
  readonly tools?: readonly LlmToolConfig[];
  readonly openAiTextFormat?: OpenAiTextFormat;
  readonly onDelta?: (delta: LlmTextDelta) => void;
};

// Gemini does not support tool calls when responseJsonSchema/JSON mode is used, so tools are excluded here.
export type LlmJsonCallOptions<T> = Omit<LlmTextCallOptions, "responseJsonSchema" | "tools"> & {
  readonly schema: z.ZodType<T>;
  readonly responseJsonSchema?: JsonSchema;
  readonly openAiSchemaName?: string;
  readonly maxAttempts?: number;
  readonly maxRetries?: number;
  readonly normalizeJson?: (value: unknown) => unknown;
};

export type LlmGenerateImagesOptions = Omit<LlmCallBaseOptions, "contents"> & {
  readonly contents?: never;
  readonly imageAspectRatio?: string;
  readonly imageSize?: LlmImageSize;
  readonly imageGradingPrompt: string;
  readonly stylePrompt: string;
  readonly styleImages?: readonly LlmImageData[];
  readonly imagePrompts: readonly string[];
  readonly maxAttempts?: number;
};

export type LlmToolCallResult = {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly error?: string;
  readonly callId?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly metrics?: Record<string, unknown>;
};

export type LlmToolLoopStep = {
  readonly step: number;
  readonly modelId: LlmTextModelId;
  readonly modelVersion?: string;
  readonly text?: string;
  readonly thoughts?: string;
  readonly toolCalls: readonly LlmToolCallResult[];
  readonly usage?: {
    readonly promptTokens?: number;
    readonly cachedTokens?: number;
    readonly responseTokens?: number;
    readonly responseImageTokens?: number;
    readonly thinkingTokens?: number;
  readonly totalTokens?: number;
  readonly toolUsePromptTokens?: number;
  };
  readonly costUsd?: number;
  readonly timing?: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly totalMs: number;
    readonly queueWaitMs: number;
    readonly connectionSetupMs: number;
    readonly activeGenerationMs: number;
    readonly toolExecutionMs: number;
    readonly waitToolMs: number;
    readonly schedulerDelayMs: number;
    readonly providerRetryDelayMs: number;
    readonly providerAttempts: number;
  };
};

export type LlmToolLoopResult = {
  readonly text: string;
  readonly steps: readonly LlmToolLoopStep[];
  readonly totalCostUsd: number;
};

type LlmToolLoopPromptOptions = {
  readonly prompt: string;
  readonly systemPrompt?: string;
};

type LlmToolLoopContentsOptions = {
  readonly contents: readonly LlmContent[];
};

export type LlmToolLoopOptions = {
  readonly modelId: LlmTextModelId;
  readonly tools: LlmToolSet;
  readonly modelTools?: readonly LlmToolConfig[];
  readonly subagents?: AgentSubagentToolSelection | false;
  readonly maxSteps?: number;
  readonly progress?: JobProgressReporter;
  readonly debug?: LlmDebugOptions;
  readonly openAiReasoningEffort?: OpenAiReasoningEffort;
  readonly onDelta?: (delta: LlmTextDelta) => void;
  readonly onEvent?: (event: LlmStreamEvent) => void;
  readonly steering?: LlmToolLoopSteeringChannel;
} & (LlmToolLoopPromptOptions | LlmToolLoopContentsOptions);

function createFallbackProgress(label: string): JobProgressReporter {
  return {
    log: (message) => {
      console.log(`[${label}] ${message}`);
    },
    startModelCall: () => Symbol("model-call"),
    recordModelUsage: () => {},
    finishModelCall: () => {},
    startStage: () => Symbol("stage"),
    finishStage: () => {},
    setActiveStages: () => {},
  };
}

function isInlineImageMime(mimeType: string | undefined): boolean {
  return typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/");
}

function estimateInlineBytes(data: string): number {
  try {
    return Buffer.from(data, "base64").byteLength;
  } catch {
    return Buffer.byteLength(data, "utf8");
  }
}

function summarisePromptStats(contents: readonly LlmContent[]): {
  textChars: number;
  imageCount: number;
  imageBytes: number;
} {
  let textChars = 0;
  let imageCount = 0;
  let imageBytes = 0;
  for (const content of contents) {
    for (const part of content.parts) {
      if (part.type === "text") {
        textChars += part.text.length;
        continue;
      }
      if (isInlineImageMime(part.mimeType)) {
        imageCount += 1;
      }
      imageBytes += estimateInlineBytes(part.data);
    }
  }
  return { textChars, imageCount, imageBytes };
}

function estimateUploadBytes(contents: readonly LlmContent[]): number {
  let total = 0;
  for (const content of contents) {
    for (const part of content.parts) {
      if (part.type === "text") {
        total += Buffer.byteLength(part.text, "utf8");
      } else {
        total += estimateInlineBytes(part.data);
      }
    }
  }
  return total;
}

const INPUT_ROLE_FROM_CONTENT_ROLE = {
  user: "user",
  model: "assistant",
  system: "system",
  tool: "assistant",
} as const satisfies Record<LlmRole, "user" | "assistant" | "system" | "developer">;

function resolveThinkingLevel(
  openAiReasoningEffort: OpenAiReasoningEffort | undefined,
): LlmThinkingLevel | undefined {
  if (openAiReasoningEffort === undefined) {
    return undefined;
  }
  if (openAiReasoningEffort === "xhigh") {
    return "high";
  }
  return openAiReasoningEffort;
}

function toInputMessages(contents: readonly LlmContent[]): Array<{
  role: "user" | "assistant" | "system" | "developer";
  content: string | readonly LlmContentPart[];
}> {
  return contents.map((content) => ({
    role: INPUT_ROLE_FROM_CONTENT_ROLE[content.role],
    content: content.parts,
  }));
}

function reportPromptUsage(progress: JobProgressReporter, handle: ModelCallHandle, contents: readonly LlmContent[]): void {
  const promptStats = summarisePromptStats(contents);
  const chunk: LlmUsageChunk = {
    prompt: {
      textChars: promptStats.textChars,
      imageCount: promptStats.imageCount,
      imageBytes: promptStats.imageBytes,
    },
  };
  progress.recordModelUsage(handle, chunk);
}

function resolveMetricsStatus(blocked: boolean): "ok" | "blocked" {
  return blocked ? "blocked" : "ok";
}

export async function generateText(options: LlmTextCallOptions): Promise<string> {
  loadLocalEnv();
  configureSparkLlmTelemetryFromEnv();

  const progress = options.progress ?? createFallbackProgress(options.modelId);
  const handle = progress.startModelCall({
    modelId: options.modelId,
    uploadBytes: estimateUploadBytes(options.contents),
    ...(options.imageSize ? { imageSize: options.imageSize } : {}),
  });

  reportPromptUsage(progress, handle, options.contents);
  const startedAtMs = Date.now();

  const call = streamText({
    model: resolveLlmModelId(options.modelId),
    input: toInputMessages(options.contents),
    tools: options.tools,
    responseMimeType: options.responseMimeType,
    responseJsonSchema: options.responseJsonSchema,
    imageSize: options.imageSize,
    thinkingLevel: resolveThinkingLevel(options.openAiReasoningEffort),
    openAiTextFormat: options.openAiTextFormat,
    telemetry: false,
  });

  try {
    for await (const event of call.events) {
      if (event.type === "delta") {
        if (event.channel === "response") {
          options.onDelta?.({ textDelta: event.text });
          progress.recordModelUsage(handle, {
            response: { textCharsDelta: event.text.length },
          });
        } else {
          options.onDelta?.({ thoughtDelta: event.text });
          progress.recordModelUsage(handle, {
            thinking: { textCharsDelta: event.text.length },
          });
        }
        continue;
      }

      if (event.type === "model") {
        progress.recordModelUsage(handle, { modelVersion: event.modelVersion });
        continue;
      }

      if (event.type === "usage") {
        progress.recordModelUsage(handle, {
          modelVersion: event.modelVersion,
          tokens: event.usage,
        });
        continue;
      }
    }
    const result = await call.result;
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_text",
      model: options.modelId,
      provider: result.provider,
      status: resolveMetricsStatus(result.blocked),
      latencyMs: Date.now() - startedAtMs,
      totalTokens: result.usage?.totalTokens,
      costUsd: result.costUsd,
    });
    return result.text;
  } catch (error) {
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_text",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "error",
      latencyMs: Date.now() - startedAtMs,
    });
    throw error;
  } finally {
    progress.finishModelCall(handle);
  }
}

export async function generateJson<T>(options: LlmJsonCallOptions<T>): Promise<T> {
  loadLocalEnv();
  configureSparkLlmTelemetryFromEnv();

  const progress = options.progress ?? createFallbackProgress(options.modelId);
  const handle = progress.startModelCall({
    modelId: options.modelId,
    uploadBytes: estimateUploadBytes(options.contents),
    ...(options.imageSize ? { imageSize: options.imageSize } : {}),
  });

  reportPromptUsage(progress, handle, options.contents);

  const normaliseAttempts = (value: number | undefined): number | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (!Number.isFinite(value)) {
      return undefined;
    }
    const floored = Math.floor(value);
    if (floored <= 0) {
      return undefined;
    }
    return floored;
  };
  const maxAttempts = normaliseAttempts(options.maxAttempts) ?? normaliseAttempts(options.maxRetries) ?? 2;
  const startedAtMs = Date.now();

  try {
    const { value, result } = await generateJsonV2({
      model: resolveLlmTextModelId(options.modelId),
      input: toInputMessages(options.contents),
      schema: options.schema,
      maxAttempts,
      ...(options.openAiSchemaName ? { openAiSchemaName: options.openAiSchemaName } : {}),
      ...(options.normalizeJson ? { normalizeJson: options.normalizeJson } : {}),
      thinkingLevel: resolveThinkingLevel(options.openAiReasoningEffort),
      telemetry: false,
      onEvent: (event) => {
        if (event.type === "delta") {
          if (event.channel === "response") {
            options.onDelta?.({ textDelta: event.text });
            progress.recordModelUsage(handle, {
              response: { textCharsDelta: event.text.length },
            });
          } else {
            options.onDelta?.({ thoughtDelta: event.text });
            progress.recordModelUsage(handle, {
              thinking: { textCharsDelta: event.text.length },
            });
          }
        } else if (event.type === "model") {
          progress.recordModelUsage(handle, { modelVersion: event.modelVersion });
        } else if (event.type === "usage") {
          progress.recordModelUsage(handle, {
            modelVersion: event.modelVersion,
            tokens: event.usage,
          });
        }
      },
    });
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_json",
      model: options.modelId,
      provider: result.provider,
      status: resolveMetricsStatus(result.blocked),
      latencyMs: Date.now() - startedAtMs,
      totalTokens: result.usage?.totalTokens,
      costUsd: result.costUsd,
    });
    return value;
  } catch (error) {
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_json",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "error",
      latencyMs: Date.now() - startedAtMs,
    });
    throw error;
  } finally {
    progress.finishModelCall(handle);
  }
}

export async function runToolLoop(options: LlmToolLoopOptions): Promise<LlmToolLoopResult> {
  loadLocalEnv();
  configureSparkLlmTelemetryFromEnv();

  const progress = options.progress ?? createFallbackProgress(options.modelId);

  const onEvent: ((event: LlmStreamEvent) => void) | undefined =
    options.onDelta || options.onEvent
    ? (event) => {
        options.onEvent?.(event);
        if (event.type !== "delta") {
          return;
        }
        if (event.channel === "response") {
          options.onDelta?.({ textDelta: event.text });
        } else {
          options.onDelta?.({ thoughtDelta: event.text });
        }
      }
    : undefined;

  const input =
    "prompt" in options
      ? options.prompt
      : toInputMessages(options.contents);
  const instructions = "systemPrompt" in options ? options.systemPrompt : undefined;
  const resolvedModelId = resolveLlmTextModelId(options.modelId);

  // We do not currently stream per-step progress into JobProgressReporter; callers
  // still receive onDelta via events, and total usage/cost are available in logs
  // through model output when needed.
  void progress;

  const request = {
    model: resolvedModelId,
    input,
    ...(instructions ? { instructions } : {}),
    tools: options.tools,
    modelTools: options.modelTools,
    maxSteps: options.maxSteps,
    thinkingLevel: resolveThinkingLevel(options.openAiReasoningEffort),
    steering: options.steering,
    ...(onEvent ? { onEvent } : {}),
  };

  const startedAtMs = Date.now();
  const toolLoopMetricTaskIdPrefix = `tool-loop-${startedAtMs.toString()}`;
  try {
    const result = await runAgentLoopV2({
      ...request,
      telemetry: false,
      ...(options.subagents !== undefined ? { subagents: options.subagents } : {}),
    });

    const publishedSteps: LlmToolLoopStep[] = result.steps.map((step) => ({
      step: step.step,
      modelId: options.modelId,
      modelVersion: step.modelVersion,
      text: step.text,
      thoughts: step.thoughts,
      toolCalls: step.toolCalls.map((toolCall) => ({
        toolName: toolCall.toolName,
        input: toolCall.input,
        output: toolCall.output,
        ...(toolCall.error ? { error: toolCall.error } : {}),
        ...(toolCall.callId ? { callId: toolCall.callId } : {}),
        ...(toolCall.startedAt ? { startedAt: toolCall.startedAt } : {}),
        ...(toolCall.completedAt ? { completedAt: toolCall.completedAt } : {}),
        ...(typeof toolCall.durationMs === "number"
          ? { durationMs: toolCall.durationMs }
          : {}),
        ...(toolCall.metrics ? { metrics: toolCall.metrics } : {}),
      })),
      ...(step.usage ? { usage: step.usage } : {}),
      ...(typeof step.costUsd === "number" ? { costUsd: step.costUsd } : {}),
      ...(step.timing ? { timing: step.timing } : {}),
    }));

    await publishSparkLlmCallMetricsFromEnv({
      operation: "run_tool_loop",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "ok",
      latencyMs: Date.now() - startedAtMs,
      totalTokens: publishedSteps.reduce((total, step) => {
        const nextTotal = step.usage?.totalTokens;
        return total + (typeof nextTotal === "number" ? nextTotal : 0);
      }, 0),
      costUsd: result.totalCostUsd,
    });

    await Promise.all(
      publishedSteps.map(async (step) => {
        if (!step.timing) {
          return;
        }
        await publishSparkToolLoopStepMetricsFromEnv({
          operation: "run_tool_loop",
          model: options.modelId,
          provider: resolveSparkMetricProviderLabel(options.modelId),
          status: "ok",
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
          taskId: `${toolLoopMetricTaskIdPrefix}-step-${step.step.toString()}`,
        });
      }),
    );

    return {
      text: result.text,
      steps: publishedSteps,
      totalCostUsd: result.totalCostUsd,
    };
  } catch (error) {
    await publishSparkLlmCallMetricsFromEnv({
      operation: "run_tool_loop",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "error",
      latencyMs: Date.now() - startedAtMs,
    });
    throw error;
  }
}

export async function generateImages(options: LlmGenerateImagesOptions): Promise<LlmImageData[]> {
  loadLocalEnv();
  configureSparkLlmTelemetryFromEnv();

  void options.progress;
  void options.debug;
  const startedAtMs = Date.now();
  try {
    const result = await generateImagesV2({
      model: resolveLlmImageModelId(options.modelId),
      stylePrompt: options.stylePrompt,
      styleImages: options.styleImages,
      imagePrompts: options.imagePrompts,
      imageGradingPrompt: options.imageGradingPrompt,
      maxAttempts: options.maxAttempts,
      imageAspectRatio: options.imageAspectRatio,
      imageSize: options.imageSize,
      telemetry: false,
    });
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_images",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "ok",
      latencyMs: Date.now() - startedAtMs,
    });
    return result;
  } catch (error) {
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_images",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "error",
      latencyMs: Date.now() - startedAtMs,
    });
    throw error;
  }
}

export async function generateImageInBatches(
  options: LlmGenerateImagesOptions & { batchSize: number; overlapSize: number },
): Promise<LlmImageData[]> {
  loadLocalEnv();
  configureSparkLlmTelemetryFromEnv();

  void options.progress;
  void options.debug;
  const startedAtMs = Date.now();
  try {
    const result = await generateImageInBatchesV2({
      model: resolveLlmImageModelId(options.modelId),
      stylePrompt: options.stylePrompt,
      styleImages: options.styleImages,
      imagePrompts: options.imagePrompts,
      imageGradingPrompt: options.imageGradingPrompt,
      maxAttempts: options.maxAttempts,
      imageAspectRatio: options.imageAspectRatio,
      imageSize: options.imageSize,
      batchSize: options.batchSize,
      overlapSize: options.overlapSize,
      telemetry: false,
    });
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_image_batches",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "ok",
      latencyMs: Date.now() - startedAtMs,
    });
    return result;
  } catch (error) {
    await publishSparkLlmCallMetricsFromEnv({
      operation: "generate_image_batches",
      model: options.modelId,
      provider: resolveSparkMetricProviderLabel(options.modelId),
      status: "error",
      latencyMs: Date.now() - startedAtMs,
    });
    throw error;
  }
}
