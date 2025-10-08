import type { GenerateContentResponse } from "@google/genai";

import { formatByteSize, formatInteger, formatMillis } from "./format";

export { formatInteger } from "./format";

export type GeminiStreamingSummary = {
  readonly label: string;
  readonly modelId: string;
  readonly uploadBytes: number;
  readonly chunkCount: number;
  readonly totalTextChars: number;
  readonly totalInlineBytes: number;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly inferenceTokens: number;
  readonly firstChunkLatencyMs?: number;
  readonly elapsedMs: number;
};

export type GeminiStreamingStatsTracker = {
  observeChunk(chunk: GenerateContentResponse): void;
  recordTextChars(delta: number): void;
  recordInlineBytes(delta: number): void;
  summary(): GeminiStreamingSummary;
};

export function createGeminiStreamingStats(
  label: string,
  modelId: string,
  uploadBytes: number
): GeminiStreamingStatsTracker {
  console.log(
    `[${label}] upload ${formatByteSize(uploadBytes)} • model ${modelId}`
  );
  const startTime = Date.now();
  let firstChunkTimestamp: number | undefined;
  let chunkCount = 0;
  let totalTextChars = 0;
  let totalInlineBytes = 0;
  let lastPromptTokens = 0;
  let lastCachedTokens = 0;
  let lastInferenceTokens = 0;
  let accumulatedPromptTokens = 0;
  let accumulatedCachedTokens = 0;
  let accumulatedInferenceTokens = 0;

  return {
    observeChunk(chunk: GenerateContentResponse): void {
      chunkCount += 1;
      if (firstChunkTimestamp === undefined) {
        firstChunkTimestamp = Date.now();
      }
      const usage = chunk.usageMetadata;
      if (!usage) {
        return;
      }
      const promptTokensNow = usage.promptTokenCount ?? 0;
      const cachedTokensNow = usage.cachedContentTokenCount ?? 0;
      const inferenceTokensNow =
        (usage.thoughtsTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0);
      const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
      const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
      const inferenceDelta = Math.max(
        0,
        inferenceTokensNow - lastInferenceTokens
      );
      if (promptDelta > 0) {
        accumulatedPromptTokens += promptDelta;
      }
      if (cachedDelta > 0) {
        accumulatedCachedTokens += cachedDelta;
      }
      if (inferenceDelta > 0) {
        accumulatedInferenceTokens += inferenceDelta;
      }
      lastPromptTokens = promptTokensNow;
      lastCachedTokens = cachedTokensNow;
      lastInferenceTokens = inferenceTokensNow;
    },
    recordTextChars(delta: number): void {
      if (delta > 0) {
        totalTextChars += delta;
      }
    },
    recordInlineBytes(delta: number): void {
      if (delta > 0) {
        totalInlineBytes += delta;
      }
    },
    summary(): GeminiStreamingSummary {
      const endTime = Date.now();
      const promptTokens = Math.max(
        accumulatedPromptTokens,
        lastPromptTokens
      );
      const cachedTokens = Math.max(accumulatedCachedTokens, lastCachedTokens);
      const inferenceTokens = Math.max(
        accumulatedInferenceTokens,
        lastInferenceTokens
      );
      return {
        label,
        modelId,
        uploadBytes,
        chunkCount,
        totalTextChars,
        totalInlineBytes,
        promptTokens,
        cachedTokens,
        inferenceTokens,
        firstChunkLatencyMs:
          firstChunkTimestamp !== undefined
            ? Math.max(firstChunkTimestamp - startTime, 0)
            : undefined,
        elapsedMs: Math.max(endTime - startTime, 0),
      };
    },
  };
}

export function logGeminiStreamingSummary(
  summary: GeminiStreamingSummary,
  options?: { modelVersion?: string; notes?: string }
): void {
  const {
    label,
    modelId,
    uploadBytes,
    chunkCount,
    totalTextChars,
    totalInlineBytes,
    promptTokens,
    cachedTokens,
    inferenceTokens,
    firstChunkLatencyMs,
    elapsedMs,
  } = summary;
  const latencyDisplay =
    firstChunkLatencyMs !== undefined
      ? formatMillis(firstChunkLatencyMs)
      : "n/a";
  const notes = options?.notes ? ` | ${options.notes}` : "";
  console.log(
    `[${label}] stats • duration ${formatMillis(elapsedMs)} (first chunk ${latencyDisplay})` +
      ` • chunks ${formatInteger(chunkCount)}` +
      ` • text ${formatInteger(totalTextChars)} chars` +
      ` • inline ${formatByteSize(totalInlineBytes)}` +
      ` • tokens prompt ${formatInteger(promptTokens)} cached ${formatInteger(cachedTokens)} inference ${formatInteger(inferenceTokens)}` +
      ` • upload ${formatByteSize(uploadBytes)}` +
      ` • model ${options?.modelVersion ?? modelId}${notes}`
  );
}
