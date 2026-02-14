import { Buffer } from "node:buffer";

import {
  appendMarkdownSourcesSection,
  convertGooglePartsToLlmParts as convertGooglePartsToLlmPartsV2,
  estimateCallCostUsd,
  generateImageInBatches as generateImageInBatchesV2,
  generateImages as generateImagesV2,
  generateJson as generateJsonV2,
  getCurrentToolCallContext,
  LlmJsonCallError,
  parseJsonFromLlmText,
  runToolLoop as runToolLoopV2,
  sanitisePartForLogging,
  streamText,
  stripCodexCitationMarkers,
  toGeminiJsonSchema,
  tool,
  type JsonSchema,
  type LlmExecutableTool,
  type LlmImageData,
  type LlmImageSize,
  type LlmStreamEvent,
  type LlmToolCallContext,
  type LlmToolConfig,
  type LlmToolSet,
} from "@ljoukov/llm";
import type { Part as GooglePart } from "@google/genai";
import type { ResponseTextConfig } from "openai/resources/responses/responses";
import { z } from "zod";

import type { OpenAiReasoningEffort } from "./openai-llm";
import { loadLocalEnv } from "./env";
import type { JobProgressReporter, LlmUsageChunk, ModelCallHandle } from "./concurrency";

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
};

export type {
  JsonSchema,
  LlmExecutableTool,
  LlmImageData,
  LlmImageSize,
  LlmToolCallContext,
  LlmToolConfig,
  LlmToolSet,
};

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
};

export type LlmToolLoopStep = {
  readonly step: number;
  readonly modelId: LlmTextModelId;
  readonly text?: string;
  readonly toolCalls: readonly LlmToolCallResult[];
};

export type LlmToolLoopResult = {
  readonly text: string;
  readonly steps: readonly LlmToolLoopStep[];
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
  readonly maxSteps?: number;
  readonly progress?: JobProgressReporter;
  readonly debug?: LlmDebugOptions;
  readonly openAiReasoningEffort?: OpenAiReasoningEffort;
  readonly onDelta?: (delta: LlmTextDelta) => void;
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

export async function generateText(options: LlmTextCallOptions): Promise<string> {
  loadLocalEnv();

  const progress = options.progress ?? createFallbackProgress(options.modelId);
  const handle = progress.startModelCall({
    modelId: options.modelId,
    uploadBytes: estimateUploadBytes(options.contents),
    ...(options.imageSize ? { imageSize: options.imageSize } : {}),
  });

  reportPromptUsage(progress, handle, options.contents);

  const call = streamText({
    model: options.modelId,
    input: toInputMessages(options.contents),
    tools: options.tools,
    responseMimeType: options.responseMimeType,
    responseJsonSchema: options.responseJsonSchema,
    imageSize: options.imageSize,
    openAiReasoningEffort: options.openAiReasoningEffort,
    openAiTextFormat: options.openAiTextFormat,
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
    return result.text;
  } finally {
    progress.finishModelCall(handle);
  }
}

export async function generateJson<T>(options: LlmJsonCallOptions<T>): Promise<T> {
  loadLocalEnv();

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

  try {
    const { value } = await generateJsonV2({
      model: options.modelId,
      input: toInputMessages(options.contents),
      schema: options.schema,
      maxAttempts,
      ...(options.openAiSchemaName ? { openAiSchemaName: options.openAiSchemaName } : {}),
      ...(options.normalizeJson ? { normalizeJson: options.normalizeJson } : {}),
      openAiReasoningEffort: options.openAiReasoningEffort,
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
    return value;
  } finally {
    progress.finishModelCall(handle);
  }
}

export async function runToolLoop(options: LlmToolLoopOptions): Promise<LlmToolLoopResult> {
  loadLocalEnv();

  const progress = options.progress ?? createFallbackProgress(options.modelId);

  const onEvent: ((event: LlmStreamEvent) => void) | undefined = options.onDelta
    ? (event) => {
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

  // We do not currently stream per-step progress into JobProgressReporter; callers
  // still receive onDelta via events, and total usage/cost are available in logs
  // through model output when needed.
  void progress;

  const result = await runToolLoopV2({
    model: options.modelId,
    input,
    ...(instructions ? { instructions } : {}),
    tools: options.tools,
    modelTools: options.modelTools,
    maxSteps: options.maxSteps,
    openAiReasoningEffort: options.openAiReasoningEffort,
    ...(onEvent ? { onEvent } : {}),
  });

  return {
    text: result.text,
    steps: result.steps.map((step) => ({
      step: step.step,
      modelId: options.modelId,
      text: step.text,
      toolCalls: step.toolCalls,
    })),
  };
}

export async function generateImages(options: LlmGenerateImagesOptions): Promise<LlmImageData[]> {
  loadLocalEnv();

  void options.progress;
  void options.debug;

  return await generateImagesV2({
    model: options.modelId,
    stylePrompt: options.stylePrompt,
    styleImages: options.styleImages,
    imagePrompts: options.imagePrompts,
    imageGradingPrompt: options.imageGradingPrompt,
    maxAttempts: options.maxAttempts,
    imageAspectRatio: options.imageAspectRatio,
    imageSize: options.imageSize,
  });
}

export async function generateImageInBatches(
  options: LlmGenerateImagesOptions & { batchSize: number; overlapSize: number },
): Promise<LlmImageData[]> {
  loadLocalEnv();

  void options.progress;
  void options.debug;

  return await generateImageInBatchesV2({
    model: options.modelId,
    stylePrompt: options.stylePrompt,
    styleImages: options.styleImages,
    imagePrompts: options.imagePrompts,
    imageGradingPrompt: options.imageGradingPrompt,
    maxAttempts: options.maxAttempts,
    imageAspectRatio: options.imageAspectRatio,
    imageSize: options.imageSize,
    batchSize: options.batchSize,
    overlapSize: options.overlapSize,
  });
}
