import { Buffer } from "node:buffer";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// NOTE: Keep eval/src/utils/LLM.md in sync with any API changes to this file.
// The markdown doc explains the public wrapper API and debug snapshot layout.
import {
  FinishReason,
  type Candidate,
  type Content,
  type GenerateContentResponse,
  type Part,
  type Schema,
  type Tool,
} from "@google/genai";
import { runGeminiCall, type GeminiModelId } from "@spark/llm/utils/gemini";
import { z } from "zod";

import type { JobProgressReporter } from "./concurrency";
import { formatByteSize, formatInteger, formatMillis } from "./format";

function estimateUploadBytes(parts: readonly LlmContentPart[]): number {
  return parts.reduce((total, part) => {
    switch (part.type) {
      case "text":
        return total + Buffer.byteLength(part.text, "utf8");
      case "inlineData": {
        try {
          return total + Buffer.from(part.data, "base64").byteLength;
        } catch {
          return total + Buffer.byteLength(part.data, "utf8");
        }
      }
      default:
        return total;
    }
  }, 0);
}

export function sanitisePartForLogging(part: LlmContentPart): unknown {
  switch (part.type) {
    case "text":
      return { type: "text", preview: part.text.slice(0, 200) };
    case "inlineData": {
      let omittedBytes: number;
      try {
        omittedBytes = Buffer.from(part.data, "base64").byteLength;
      } catch {
        omittedBytes = Buffer.byteLength(part.data, "utf8");
      }
      return {
        type: "inlineData",
        mimeType: part.mimeType,
        data: `[omitted:${omittedBytes}b]`,
      };
    }
    default:
      return "[unknown part]";
  }
}

type LlmInlineData = {
  readonly mimeType?: string;
  readonly data: string;
};

type LlmChunkData = {
  readonly textParts: string[];
  readonly thoughtParts: string[];
  readonly inlineData: LlmInlineData[];
};

function extractLlmChunkData(
  chunk: GenerateContentResponse,
): LlmChunkData {
  const textParts: string[] = [];
  const thoughtParts: string[] = [];
  const inlineData: LlmInlineData[] = [];
  const partsFromCandidate = (parts: readonly Part[] = []): void => {
    for (const part of parts) {
      if (typeof part.text === "string") {
        if (part.thought) {
          thoughtParts.push(part.text);
        } else {
          textParts.push(part.text);
        }
      }
      const inlinePayload = part.inlineData?.data;
      if (typeof inlinePayload === "string" && inlinePayload.length > 0) {
        inlineData.push({
          mimeType: part.inlineData?.mimeType,
          data: inlinePayload,
        });
      }
    }
  };
  if (Array.isArray(chunk.candidates)) {
    for (const candidate of chunk.candidates) {
      const parts = candidate.content?.parts ?? [];
      partsFromCandidate(parts);
    }
  }
  if (!chunk.candidates && typeof chunk.text === "string") {
    textParts.push(chunk.text);
  }
  return { textParts, thoughtParts, inlineData };
}

function estimateContentsUploadBytes(contents: readonly Content[]): number {
  return contents.reduce((total, content) => {
    const parts = content.parts ?? [];
    return total + estimateUploadBytes(convertGooglePartsToLlmParts(parts));
  }, 0);
}

function cloneContent(content: Content): Content {
  const cloned: Content = {
    ...content,
  };
  if (Array.isArray(content.parts)) {
    cloned.parts = content.parts.map((part) => {
      const clonedPart: Part = { ...part };
      if (part.inlineData) {
        clonedPart.inlineData = { ...part.inlineData };
      }
      if (part.fileData) {
        clonedPart.fileData = { ...part.fileData };
      }
      if (part.functionCall) {
        clonedPart.functionCall = { ...part.functionCall };
      }
      if (part.functionResponse) {
        clonedPart.functionResponse = { ...part.functionResponse };
      }
      return clonedPart;
    });
  }
  return cloned;
}

const MODERATION_FINISH_REASONS = new Set<FinishReason>([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

function isModerationFinish(reason: FinishReason | undefined): boolean {
  if (!reason) {
    return false;
  }
  return MODERATION_FINISH_REASONS.has(reason);
}

function findLastInlineDataIndex(parts: readonly Part[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const inlineData = parts[index].inlineData?.data;
    if (typeof inlineData === "string" && inlineData.length > 0) {
      return index;
    }
  }
  return -1;
}

function trimPartsForContinuation(
  parts: Part[],
  moderationFailure: boolean,
): void {
  if (parts.length === 0) {
    return;
  }
  const lastImageIndex = findLastInlineDataIndex(parts);
  if (lastImageIndex === -1) {
    if (moderationFailure) {
      parts.length = 0;
    }
    return;
  }
  if (moderationFailure) {
    parts.splice(lastImageIndex, 1);
    const precedingIndex = lastImageIndex - 1;
    if (
      precedingIndex >= 0 &&
      typeof parts[precedingIndex].text === "string"
    ) {
      parts.splice(precedingIndex, 1);
    }
  }
  const trimmedLastImageIndex = findLastInlineDataIndex(parts);
  for (let index = parts.length - 1; index > trimmedLastImageIndex; index -= 1) {
    if (typeof parts[index].text === "string") {
      parts.splice(index, 1);
    }
  }
}

function estimateInlineBytes(data: string): number {
  try {
    return Buffer.from(data, "base64").byteLength;
  } catch {
    return Buffer.byteLength(data, "utf8");
  }
}

type LlmDebugOptions = {
  readonly rootDir: string;
  readonly stage?: string;
  readonly subStage?: string;
  readonly attempt?: number | string;
  readonly enabled?: boolean;
};

type LlmToolConfig = {
  readonly type: "web-search";
};

type GeminiCallConfig = {
  thinkingConfig?: {
    includeThoughts: true;
    thinkingBudget: number;
  };
  responseMimeType?: string;
  responseSchema?: Schema;
  responseModalities?: string[];
  imageConfig?: {
    aspectRatio: string;
  };
  tools?: Tool[];
};

type LlmCallStage = {
  readonly label: string;
  readonly debugDir?: string;
};

export type LlmTextModelId = GeminiModelId;
export type LlmImageModelId = "gemini-2.5-flash-image";
export type LlmModelId = LlmTextModelId | LlmImageModelId;

export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "inlineData"; data: string; mimeType?: string };

export function convertGooglePartsToLlmParts(
  parts: readonly Part[],
): LlmContentPart[] {
  const result: LlmContentPart[] = [];
  for (const part of parts) {
    if (typeof part.text === "string") {
      result.push({ type: "text", text: part.text });
      continue;
    }
    const inline = part.inlineData;
    if (inline?.data) {
      result.push({
        type: "inlineData",
        data: inline.data,
        mimeType: inline.mimeType,
      });
      continue;
    }
    if (part.fileData?.fileUri) {
      throw new Error("fileData parts are not supported");
    }
  }
  return result;
}

type LlmCallBaseOptions = {
  readonly progress?: JobProgressReporter;
  readonly modelId: LlmModelId;
  readonly parts?: readonly LlmContentPart[];
  readonly contents?: readonly Content[];
  readonly debug?: LlmDebugOptions;
};

export type LlmTextCallOptions = LlmCallBaseOptions & {
  readonly parts: readonly LlmContentPart[];
  readonly responseMimeType?: string;
  readonly responseSchema?: Schema;
  readonly tools?: readonly LlmToolConfig[];
};

export type LlmImagePart = {
  readonly mimeType?: string;
  readonly data: Buffer;
};

export type LlmImageCallOptions = LlmCallBaseOptions & {
  readonly parts: readonly LlmContentPart[];
  readonly responseModalities?: readonly string[];
  readonly imageAspectRatio?: string;
};

function createFallbackProgress(label: string): JobProgressReporter {
  return {
    log: (message) => {
      console.log(`[${label}] ${message}`);
    },
    startModelCall: () => Symbol("model-call"),
    recordModelUsage: () => {},
    finishModelCall: () => {},
  };
}

function normalisePathSegment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-z0-9\-_/]+/gi, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_/]+|[-_/]+$/g, "");
  return cleaned.length > 0 ? cleaned : "segment";
}

function toGeminiTools(
  tools: readonly LlmToolConfig[] | undefined,
): Tool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => {
    switch (tool.type) {
      case "web-search":
        return { googleSearch: {} };
      default:
        throw new Error("Unsupported tool configuration");
    }
  });
}

async function ensureDebugDir(debugDir?: string): Promise<void> {
  if (!debugDir) {
    return;
  }
  await mkdir(debugDir, { recursive: true });
}

async function resetDebugDir(debugDir?: string): Promise<void> {
  if (!debugDir) {
    return;
  }
  await rm(debugDir, { recursive: true, force: true });
}

function resolveDebugDir(
  debug: LlmDebugOptions | undefined,
  attemptLabel?: number | string,
): string | undefined {
  if (!debug || !debug.rootDir || debug.enabled === false) {
    return undefined;
  }
  const stageSegment = normalisePathSegment(debug.stage ?? "llm");
  const segments = [debug.rootDir, stageSegment];
  if (debug.subStage) {
    segments.push(normalisePathSegment(debug.subStage));
  }
  const attemptValue = debug.attempt ?? attemptLabel;
  if (attemptValue !== undefined) {
    const attemptSegment =
      typeof attemptValue === "number"
        ? `attempt-${String(attemptValue).padStart(2, "0")}`
        : String(attemptValue);
    segments.push(normalisePathSegment(attemptSegment));
  }
  return path.join(...segments);
}

function formatContentsForSnapshot(contents: readonly Content[]): string {
  const lines: string[] = [];
  contents.forEach((content, contentIndex) => {
    const role = content.role ?? "unspecified";
    lines.push(`=== Message ${contentIndex + 1} (${role}) ===`);
    const parts = content.parts ?? [];
    if (parts.length === 0) {
      lines.push("(no parts)", "");
      return;
    }
    const llmParts = convertGooglePartsToLlmParts(parts);
    if (llmParts.length === 0) {
      lines.push("(no serialisable parts)", "");
      return;
    }
    llmParts.forEach((part, partIndex) => {
      const header = `Part ${partIndex + 1}`;
      switch (part.type) {
        case "text":
          lines.push(`${header} (text):`);
          lines.push(part.text);
          break;
        case "inlineData": {
          const bytes = estimateInlineBytes(part.data);
          lines.push(
            `${header} (inline ${part.mimeType ?? "binary"}, ${bytes} bytes)`,
          );
          break;
        }
        default:
          lines.push(`${header}: [unknown part]`);
      }
      lines.push("");
    });
  });
  return lines.join("\n");
}

async function writePromptSnapshot(
  pathname: string,
  contents: readonly Content[],
): Promise<void> {
  const snapshot = formatContentsForSnapshot(contents);
  await writeFile(pathname, snapshot, { encoding: "utf8" });
}

async function writeTextResponseSnapshot({
  pathname,
  summary,
  thoughts,
  text,
  chunkLog,
}: {
  pathname: string;
  summary: string[];
  thoughts: readonly string[];
  text: string;
  chunkLog: readonly string[];
}): Promise<void> {
  const sections: string[] = [];
  if (summary.length > 0) {
    sections.push(...summary, "");
  }
  sections.push("===== Thoughts =====");
  if (thoughts.length === 0) {
    sections.push("(none)");
  } else {
    sections.push(...thoughts);
  }
  sections.push("", "===== Response =====", text, "");
  if (chunkLog.length > 0) {
    sections.push("===== Chunks =====", ...chunkLog, "");
  }
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, sections.join("\n"), { encoding: "utf8" });
}

async function writeImageDebugArtifacts({
  stage,
  modelVersion,
  elapsedMs,
  charCount,
  chunkLog,
  thoughts,
  text,
  images,
}: {
  stage: LlmCallStage;
  modelVersion: string;
  elapsedMs: number;
  charCount: number;
  chunkLog: string[];
  thoughts: string[];
  text: string;
  images: readonly LlmImagePart[];
}): Promise<void> {
  const { debugDir } = stage;
  if (!debugDir) {
    return;
  }
  const responsePath = path.join(debugDir, "response.txt");
  await writeTextResponseSnapshot({
    pathname: responsePath,
    summary: [
      `Model: ${modelVersion}`,
      `Elapsed: ${formatMillis(elapsedMs)}`,
      `Characters: ${formatInteger(charCount)}`,
      `Images: ${images.length}`,
    ],
    thoughts,
    text,
    chunkLog,
  });
  await Promise.all(
    images.map(async (image, index) => {
      const extension = image.mimeType?.split("/")[1] ?? "bin";
      const filename = `image-${String(index + 1).padStart(2, "0")}.${extension}`;
      await writeFile(path.join(debugDir, filename), image.data);
    }),
  );
}

function buildCallStage({
  modelId,
  debug,
  attemptLabel,
}: {
  modelId: LlmModelId;
  debug?: LlmDebugOptions;
  attemptLabel?: number | string;
}): LlmCallStage {
  const labelParts: string[] = [debug?.stage ?? modelId];
  if (typeof attemptLabel !== "undefined") {
    labelParts.push(`attempt ${attemptLabel}`);
  }
  const debugDir = resolveDebugDir(debug, attemptLabel);
  return { label: labelParts.join("/"), debugDir };
}

async function runLlmStream({
  options,
  handleChunk,
  attemptLabel,
}: {
  options: LlmCallBaseOptions & {
    readonly responseMimeType?: string;
    readonly responseSchema?: Schema;
    readonly responseModalities?: readonly string[];
    readonly imageAspectRatio?: string;
    readonly tools?: readonly LlmToolConfig[];
  };
  handleChunk: (
    chunk: GenerateContentResponse,
    data: LlmChunkData,
  ) => void;
  attemptLabel?: number | string;
}): Promise<{
  elapsedMs: number;
  modelVersion: string;
  charCount: number;
  totalBytes: number;
  chunkLog: string[];
  thoughts: string[];
  textAggregator: { value: string };
  stage: LlmCallStage;
  lastCandidates?: Candidate[];
  promptFeedback?: GenerateContentResponse["promptFeedback"];
}> {
  const stage = buildCallStage({
    modelId: options.modelId,
    debug: options.debug,
    attemptLabel,
  });
  const reporter =
    options.progress ?? createFallbackProgress(stage.label);
  const log = (message: string) => {
    reporter.log(`[${stage.label}] ${message}`);
  };

  if (
    !options.contents &&
    (!options.parts || options.parts.length === 0)
  ) {
    throw new Error("LLM call requires parts or contents");
  }

  const contentsSource: readonly Content[] | undefined =
    options.contents && options.contents.length > 0
      ? options.contents
      : options.parts
        ? [
            {
              role: "user",
              parts: options.parts.map(toGooglePart),
            },
          ]
        : undefined;
  if (!contentsSource || contentsSource.length === 0) {
    throw new Error("LLM call received an empty prompt");
  }
  const contents = contentsSource.map(cloneContent);
  const config: GeminiCallConfig = {};
  // Enable thinking only when supported. Image models (e.g. gemini-2.5-flash-image)
  // do not support thinking and will fail with INVALID_ARGUMENT if requested.
  const responseModalities = options.responseModalities;
  const isImageCall = Boolean(
    options.imageAspectRatio ||
      (Array.isArray(responseModalities) &&
        responseModalities.some((m) => String(m).toUpperCase() === "IMAGE")),
  );
  const isImageModel = options.modelId === "gemini-2.5-flash-image";
  const supportsThinking = !isImageCall && !isImageModel;
  if (supportsThinking) {
    config.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: 32_768,
    };
  }
  if (options.responseMimeType) {
    config.responseMimeType = options.responseMimeType;
  }
  if (options.responseSchema) {
    config.responseSchema = options.responseSchema;
  }
  if (options.responseModalities) {
    config.responseModalities = Array.from(options.responseModalities);
  }
  if (options.imageAspectRatio) {
    config.imageConfig = { aspectRatio: options.imageAspectRatio };
  }
  // temperature is intentionally not configurable in this wrapper.
  const geminiTools = toGeminiTools(options.tools);
  if (geminiTools) {
    config.tools = geminiTools;
  }

  await resetDebugDir(stage.debugDir);
  await ensureDebugDir(stage.debugDir);
  if (stage.debugDir) {
    await writePromptSnapshot(path.join(stage.debugDir, "prompt.txt"), contents);
  }

  const uploadBytes = estimateContentsUploadBytes(contents);
  const callHandle = reporter.startModelCall({
    modelId: options.modelId,
    uploadBytes,
  });

  const startedAt = Date.now();
  let resolvedModelVersion: string = options.modelId;
  let totalChars = 0;
  let totalBytes = 0;
  let chunkIndex = 0;
  const thoughts: string[] = [];
  const chunkLog: string[] = [];
  const textAggregator = { value: "" };
  let lastCandidates: Candidate[] | undefined;
  let promptFeedback: GenerateContentResponse["promptFeedback"] | undefined;

  const summariseChunk = (
    data: LlmChunkData,
    chunk: GenerateContentResponse,
  ): { charDelta: number; byteDelta: number } => {
    let charDelta = 0;
    // Count visible response text
    for (const text of data.textParts) {
      charDelta += text.length;
      textAggregator.value += text;
    }
    // Include thinking tokens in char counts/speed metrics
    for (const thought of data.thoughtParts) {
      charDelta += thought.length;
    }
    let byteDelta = 0;
    for (const inline of data.inlineData) {
      byteDelta += estimateInlineBytes(inline.data);
    }
    if (data.thoughtParts.length > 0) {
      thoughts.push(...data.thoughtParts);
    }
    reporter.recordModelUsage(callHandle, {
      modelVersion: chunk.modelVersion,
      outputCharsDelta: charDelta > 0 ? charDelta : undefined,
      outputBytesDelta: byteDelta > 0 ? byteDelta : undefined,
    });
    return { charDelta, byteDelta };
  };

  try {
    await runGeminiCall(async (client) => {
      const stream = await client.models.generateContentStream({
        model: options.modelId,
        contents,
        config,
      });
      let lastLog = startedAt;
      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          resolvedModelVersion = chunk.modelVersion;
        }
        if (chunk.promptFeedback) {
          promptFeedback = chunk.promptFeedback;
        }
        if (Array.isArray(chunk.candidates) && chunk.candidates.length > 0) {
          lastCandidates = chunk.candidates;
        }
        const data = extractLlmChunkData(chunk);
        const { charDelta, byteDelta } = summariseChunk(data, chunk);
        totalChars += charDelta;
        totalBytes += byteDelta;
        chunkIndex += 1;
        chunkLog.push(
          `chunk ${chunkIndex}: +${charDelta} chars, +${formatByteSize(byteDelta)} bytes`,
        );
        // Do not emit per-model periodic progress logs; aggregate display handles this.
        // Keep tracking for snapshots and final completion log.
        const now = Date.now();
        if (now - lastLog >= 1_000) {
          lastLog = now;
        }
        handleChunk(chunk, data);
      }
    });
  } finally {
    reporter.finishModelCall(callHandle);
  }

  const elapsedMs = Date.now() - startedAt;
  log(
    `completed model ${resolvedModelVersion} in ${formatMillis(elapsedMs)} (${formatInteger(totalChars)} chars, ${formatByteSize(totalBytes)} down)`,
  );

  return {
    elapsedMs,
    modelVersion: resolvedModelVersion,
    charCount: totalChars,
    totalBytes,
    chunkLog,
    thoughts,
    textAggregator,
    stage,
    lastCandidates,
    promptFeedback,
  };
}

type LlmTextCallMeta = {
  readonly text: string;
  readonly charCount: number;
  readonly thoughts: string[];
  readonly modelVersion: string;
  readonly elapsedMs: number;
  readonly chunkLog: string[];
  readonly stage: LlmCallStage;
};

async function executeLlmText(
  options: LlmTextCallOptions,
  attemptLabel?: number | string,
): Promise<LlmTextCallMeta> {
  const {
    elapsedMs,
    modelVersion,
    charCount,
    chunkLog,
    thoughts,
    textAggregator,
    stage,
  } = await runLlmStream({
    options: {
      ...options,
      responseMimeType: options.responseMimeType,
      responseSchema: options.responseSchema,
    },
    handleChunk: () => {
      /* noop for text */
    },
    attemptLabel,
  });

  const resolvedText = textAggregator.value.trim();
  if (!resolvedText) {
    throw new Error("LLM response did not include any text output");
  }

  const { debugDir } = stage;

  if (debugDir) {
    await writeTextResponseSnapshot({
      pathname: path.join(debugDir, "response.txt"),
      summary: [
        `Model: ${modelVersion}`,
        `Elapsed: ${formatMillis(elapsedMs)}`,
        `Characters: ${formatInteger(charCount)}`,
      ],
      thoughts,
      text: resolvedText,
      chunkLog,
    });
  }

  return {
    text: resolvedText,
    charCount,
    thoughts,
    modelVersion,
    elapsedMs,
    chunkLog,
    stage,
  };
}

export async function runLlmTextCall(
  options: LlmTextCallOptions,
): Promise<string> {
  const { text } = await executeLlmText(options);
  return text;
}

export async function runLlmImageCall(
  options: LlmImageCallOptions,
): Promise<LlmImagePart[]> {
  const images: LlmImagePart[] = [];

  const {
    elapsedMs,
    modelVersion,
    charCount,
    chunkLog,
    thoughts,
    textAggregator,
    stage,
  } = await runLlmStream({
    options: {
      ...options,
      responseModalities: options.responseModalities ?? ["IMAGE", "TEXT"],
    },
    handleChunk: (_chunk, data) => {
      for (const inline of data.inlineData) {
        let buffer: Buffer;
        try {
          buffer = Buffer.from(inline.data, "base64");
        } catch {
          buffer = Buffer.from(inline.data, "base64url");
        }
        images.push({
          mimeType: inline.mimeType,
          data: buffer,
        });
      }
    },
  });

  await writeImageDebugArtifacts({
    stage,
    modelVersion,
    elapsedMs,
    charCount,
    chunkLog,
    thoughts,
    text: textAggregator.value,
    images,
  });

  return images;
}

export type GenerateImagesOptions = LlmImageCallOptions & {
  readonly numImages: number;
  readonly maxAttempts?: number;
};

export async function generateImages(
  options: GenerateImagesOptions,
): Promise<LlmImagePart[]> {
  const { numImages, maxAttempts = 2, ...rest } = options;
  if (!Number.isFinite(numImages) || numImages <= 0) {
    return [];
  }
  if (!rest.parts || rest.parts.length === 0) {
    throw new Error("generateImages requires at least one prompt part");
  }
  if (rest.contents && rest.contents.length > 0) {
    throw new Error("generateImages does not support pre-seeded contents");
  }

  const {
    parts: promptParts,
    progress,
    modelId,
    debug,
    responseModalities,
    imageAspectRatio,
  } = rest;

  const resolvedResponseModalities =
    responseModalities && responseModalities.length > 0
      ? responseModalities
      : ["IMAGE", "TEXT"];

  const promptContent: Content = {
    role: "user",
    parts: promptParts.map(toGooglePart),
  };

  const sharedStreamOptions = {
    progress,
    modelId,
    debug,
    responseModalities: resolvedResponseModalities,
    imageAspectRatio,
  } satisfies Omit<LlmImageCallOptions, "parts" | "contents">;

  const collectedImages: LlmImagePart[] = [];
  let pendingContents: Content[] | undefined;
  let historyContent: Content | undefined;

  const runImageAttempt = async (
    attempt: number,
    contentsOverride?: readonly Content[],
  ) => {
    const attemptImages: LlmImagePart[] = [];
    const streamOptions =
      contentsOverride && contentsOverride.length > 0
        ? {
            ...sharedStreamOptions,
            contents: contentsOverride,
          }
        : {
            ...sharedStreamOptions,
            parts: promptParts,
          };
    const result = await runLlmStream({
      options: streamOptions,
      handleChunk: (_chunk, data) => {
        for (const inline of data.inlineData) {
          let buffer: Buffer;
          try {
            buffer = Buffer.from(inline.data, "base64");
          } catch {
            buffer = Buffer.from(inline.data, "base64url");
          }
          attemptImages.push({
            mimeType: inline.mimeType,
            data: buffer,
          });
        }
      },
      attemptLabel: attempt,
    });

    await writeImageDebugArtifacts({
      stage: result.stage,
      modelVersion: result.modelVersion,
      elapsedMs: result.elapsedMs,
      charCount: result.charCount,
      chunkLog: result.chunkLog,
      thoughts: result.thoughts,
      text: result.textAggregator.value,
      images: attemptImages,
    });

    return {
      images: attemptImages,
      lastCandidates: result.lastCandidates,
      promptFeedback: result.promptFeedback,
    };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptResult = await runImageAttempt(attempt, pendingContents);
    let attemptImages = attemptResult.images;
    const candidate = attemptResult.lastCandidates?.[0];
    const moderationFailure =
      isModerationFinish(candidate?.finishReason) ||
      Boolean(attemptResult.promptFeedback?.blockReason);

    if (moderationFailure && attemptImages.length > 0) {
      attemptImages = attemptImages.slice(0, -1);
    }

    if (attemptImages.length > 0) {
      collectedImages.push(...attemptImages);
    }
    const generatedSoFar = collectedImages.length;
    if (generatedSoFar >= numImages) {
      break;
    }
    if (attempt === maxAttempts) {
      break;
    }
    if (!candidate?.content) {
      break;
    }

    const responseClone = cloneContent(candidate.content);
    const responseParts = Array.isArray(responseClone.parts)
      ? responseClone.parts.slice()
      : [];
    trimPartsForContinuation(responseParts, moderationFailure);
    responseClone.parts = responseParts;

    if (!historyContent) {
      historyContent = {
        role: responseClone.role ?? "model",
        parts: responseParts,
      };
    } else {
      const aggregatedParts = [
        ...(historyContent.parts ?? []),
        ...responseParts,
      ];
      historyContent = {
        role: historyContent.role ?? responseClone.role ?? "model",
        parts: aggregatedParts,
      };
    }

    const pendingIndices: number[] = [];
    for (let index = generatedSoFar + 1; index <= numImages; index += 1) {
      pendingIndices.push(index);
    }
    if (pendingIndices.length === 0) {
      break;
    }

    const instruction = `Please continue generating images ${pendingIndices.join(", ")}.`;
    pendingContents = [
      promptContent,
      historyContent,
      {
        role: "user",
        parts: [{ text: instruction }],
      },
    ];
  }

  return collectedImages.slice(0, numImages);
}

export type LlmJsonCallOptions<T> = Omit<LlmTextCallOptions, "responseSchema"> & {
  readonly schema: z.ZodSchema<T>;
  readonly responseSchema: Schema;
  readonly maxAttempts?: number;
};

export class LlmJsonCallError extends Error {
  constructor(
    message: string,
    readonly attempts: ReadonlyArray<{
      readonly attempt: number;
      readonly rawText: string;
      readonly error: unknown;
    }>,
  ) {
    super(message);
    this.name = "LlmJsonCallError";
  }
}

export async function runLlmJsonCall<T>(
  options: LlmJsonCallOptions<T>,
): Promise<T> {
  const {
    schema,
    responseSchema,
    maxAttempts = 2,
    ...rest
  } = options;
  const textOptions: LlmTextCallOptions = {
    ...rest,
    responseSchema,
    responseMimeType: rest.responseMimeType ?? "application/json",
  };

  const totalAttempts = Math.max(1, maxAttempts);
  const failures: Array<{
    attempt: number;
    rawText: string;
    error: unknown;
  }> = [];

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const meta = await executeLlmText(textOptions, attempt);
    const rawText = meta.text;
    try {
      const payload = JSON.parse(rawText);
      const parsed = schema.parse(payload);
      return parsed;
    } catch (error) {
      const handledError = error instanceof Error ? error : new Error(String(error));
      failures.push({ attempt, rawText, error: handledError });
      if (attempt >= totalAttempts) {
        throw new LlmJsonCallError(
          `LLM JSON call failed after ${attempt} attempt(s)`,
          failures,
        );
      }
    }
  }

  throw new LlmJsonCallError("LLM JSON call failed", failures);
}
function toGooglePart(part: LlmContentPart): Part {
  switch (part.type) {
    case "text":
      return { text: part.text };
    case "inlineData":
      return {
        inlineData: {
          data: part.data,
          mimeType: part.mimeType,
        },
      };
    default:
      throw new Error("Unsupported LLM content part");
  }
}
