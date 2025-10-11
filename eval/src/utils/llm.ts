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
      return {
        type: "text",
        thought: part.thought === true ? true : undefined,
        preview: part.text.slice(0, 200),
      };
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

function estimateContentsUploadBytes(contents: readonly LlmContent[]): number {
  let total = 0;
  for (const content of contents) {
    total += estimateUploadBytes(content.parts);
  }
  return total;
}

function clonePart(part: Part): Part {
  const cloned: Part = { ...part };
  if (part.inlineData) {
    cloned.inlineData = { ...part.inlineData };
  }
  if (part.fileData) {
    cloned.fileData = { ...part.fileData };
  }
  if (part.functionCall) {
    cloned.functionCall = { ...part.functionCall };
  }
  if (part.functionResponse) {
    cloned.functionResponse = { ...part.functionResponse };
  }
  return cloned;
}

function cloneContent(content: Content): Content {
  const cloned: Content = {
    ...content,
  };
  const originalParts = content.parts;
  if (originalParts !== undefined) {
    cloned.parts = originalParts.map(clonePart);
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
    if (inlineData !== undefined && inlineData.length > 0) {
      return index;
    }
  }
  return -1;
}

function trimPartsForContinuation(
  parts: Part[],
  moderationFailure: boolean
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
    if (precedingIndex >= 0 && parts[precedingIndex].text !== undefined) {
      parts.splice(precedingIndex, 1);
    }
  }
  const trimmedLastImageIndex = findLastInlineDataIndex(parts);
  for (
    let index = parts.length - 1;
    index > trimmedLastImageIndex;
    index -= 1
  ) {
    if (parts[index].text !== undefined) {
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
  | { type: "text"; text: string; thought?: boolean }
  | { type: "inlineData"; data: string; mimeType?: string };

export type LlmRole = "user" | "model" | "system" | "tool";

export type LlmContent = {
  readonly role: LlmRole;
  readonly parts: readonly LlmContentPart[];
};

export function convertGooglePartsToLlmParts(
  parts: readonly Part[]
): LlmContentPart[] {
  const result: LlmContentPart[] = [];
  for (const part of parts) {
    if (part.text !== undefined) {
      result.push({
        type: "text",
        text: part.text,
        thought: part.thought ? true : undefined,
      });
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

function assertLlmRole(value: string | undefined): LlmRole {
  switch (value) {
    case "user":
    case "model":
    case "system":
    case "tool":
      return value;
    default:
      throw new Error(`Unsupported LLM role: ${String(value)}`);
  }
}

function convertGoogleContentToLlmContent(content: Content): LlmContent {
  return {
    role: assertLlmRole(content.role),
    parts: convertGooglePartsToLlmParts(content.parts ?? []),
  };
}

function convertLlmContentToGoogleContent(content: LlmContent): Content {
  return {
    role: content.role,
    parts: content.parts.map(toGooglePart),
  };
}

function cloneLlmPart(part: LlmContentPart): LlmContentPart {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        thought: part.thought ? true : undefined,
      };
    case "inlineData":
      return {
        type: "inlineData",
        data: part.data,
        mimeType: part.mimeType,
      };
    default:
      return part;
  }
}

function cloneLlmContent(content: LlmContent): LlmContent {
  const clonedParts: LlmContentPart[] = [];
  for (const part of content.parts) {
    clonedParts.push(cloneLlmPart(part));
  }
  return {
    role: content.role,
    parts: clonedParts,
  };
}

export type LlmCallBaseOptions = {
  readonly progress?: JobProgressReporter;
  readonly modelId: LlmModelId;
  readonly contents: readonly LlmContent[];
  readonly debug?: LlmDebugOptions;
};

export type LlmTextCallOptions = LlmCallBaseOptions & {
  readonly responseMimeType?: string;
  readonly responseSchema?: Schema;
  readonly tools?: readonly LlmToolConfig[];
};

export type LlmImagePart = {
  readonly mimeType?: string;
  readonly data: Buffer;
};

export type LlmImageCallOptions = LlmCallBaseOptions & {
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
  tools: readonly LlmToolConfig[] | undefined
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
  attemptLabel?: number | string
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

function formatContentsForSnapshot(contents: readonly LlmContent[]): string {
  const lines: string[] = [];
  let contentIndex = 0;
  for (const content of contents) {
    lines.push(`=== Message ${contentIndex + 1} (${content.role}) ===`);
    const parts = content.parts;
    if (parts.length === 0) {
      lines.push("(no parts)", "");
    } else {
      let partIndex = 0;
      for (const part of parts) {
        const header = `Part ${partIndex + 1}`;
        switch (part.type) {
          case "text":
            lines.push(`${header} (text):`);
            lines.push(part.text);
          break;
        case "inlineData": {
          const bytes = estimateInlineBytes(part.data);
          lines.push(
            `${header} (inline ${part.mimeType ?? "binary"}, ${bytes} bytes)`
          );
          break;
        }
        default:
          lines.push(`${header}: [unknown part]`);
      }
      lines.push("");
    }
    contentIndex += 1;
  }
  return lines.join("\n");
}

async function writePromptSnapshot(
  pathname: string,
  contents: readonly LlmContent[]
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
  contents,
}: {
  pathname: string;
  summary: string[];
  thoughts: readonly string[];
  text: string;
  chunkLog: readonly string[];
  contents?: readonly LlmContent[];
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
  sections.push("", "===== Response =====");
  sections.push(text, "");
  if (contents && contents.length > 0) {
    sections.push("===== Content =====");
    const contentLines = formatContentsForSnapshot(contents).split("\n");
    sections.push(...contentLines);
    if (sections[sections.length - 1] !== "") {
      sections.push("");
    }
  }
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
  contents,
}: {
  stage: LlmCallStage;
  modelVersion: string;
  elapsedMs: number;
  charCount: number;
  chunkLog: string[];
  thoughts: string[];
  text: string;
  images: readonly LlmImagePart[];
  contents?: readonly LlmContent[];
}): Promise<void> {
  const { debugDir } = stage;
  if (!debugDir) {
    return;
  }
  const responsePath = path.join(debugDir, "response.txt");
  // Build a snapshot-friendly view of the response content. The GenAI streaming
  // API may expose only the latest candidate parts at the end of the stream,
  // which can omit earlier inline images. Prefer reconstructing content from
  // the collected images to ensure all generated images are listed in the
  // snapshot. Fall back to provided contents when no images were collected.
  const contentsForSnapshot: readonly LlmContent[] | undefined =
    images.length > 0
      ? (() => {
          const generatedParts: LlmContentPart[] = [];
          for (const image of images) {
            generatedParts.push({
              type: "inlineData",
              mimeType: image.mimeType,
              data: image.data.toString("base64"),
            });
          }
          return [
            {
              role: "model",
              parts: generatedParts,
            },
          ];
        })()
      : contents;
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
    contents: contentsForSnapshot,
  });
  const writeTasks: Array<Promise<void>> = [];
  for (const [index, image] of images.entries()) {
    const extension = image.mimeType?.split("/")[1] ?? "bin";
    const filename = `image-${String(index + 1).padStart(2, "0")}.${extension}`;
    writeTasks.push(writeFile(path.join(debugDir, filename), image.data));
  }
  await Promise.all(writeTasks);
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

type LlmStreamCallOptions = LlmCallBaseOptions & {
  readonly responseMimeType?: string;
  readonly responseSchema?: Schema;
  readonly responseModalities?: readonly string[];
  readonly imageAspectRatio?: string;
  readonly tools?: readonly LlmToolConfig[];
};

export type LlmStreamStats = {
  readonly elapsedMs: number;
  readonly modelVersion: string;
  readonly charCount: number;
  readonly totalBytes: number;
};

export type LlmStreamDebug = {
  readonly label: string;
  readonly directory?: string;
  readonly chunkLog: readonly string[];
  readonly thoughts: readonly string[];
};

export type LlmStreamContent = LlmContent;

export type LlmBlockedReason = "blocked";

export type LlmStreamFeedback = {
  readonly blockedReason?: LlmBlockedReason;
};

export type LlmStreamResult = {
  readonly stats: LlmStreamStats;
  readonly debug: LlmStreamDebug;
  readonly content?: LlmStreamContent;
  readonly feedback: LlmStreamFeedback;
};

export async function llmStream({
  options,
  handleChunk,
  attemptLabel,
}: {
  readonly options: LlmStreamCallOptions;
  readonly handleChunk?: (content: LlmContent) => void;
  readonly attemptLabel?: number | string;
}): Promise<LlmStreamResult> {
  const stage = buildCallStage({
    modelId: options.modelId,
    debug: options.debug,
    attemptLabel,
  });
  const reporter = options.progress ?? createFallbackProgress(stage.label);
  const log = (message: string) => {
    reporter.log(`[${stage.label}] ${message}`);
  };

  if (options.contents.length === 0) {
    throw new Error("LLM call received an empty prompt");
  }
  const promptContents: LlmContent[] = [];
  const googlePromptContents: Content[] = [];
  for (const content of options.contents) {
    const cloned = cloneLlmContent(content);
    promptContents.push(cloned);
    googlePromptContents.push(convertLlmContentToGoogleContent(cloned));
  }
  const config: GeminiCallConfig = {};
  // Enable thinking only when supported. Image models and image responses do
  // not support thinking and will fail if requested.
  const responseModalities = options.responseModalities;
  let hasImageModality = false;
  if (responseModalities !== undefined) {
    for (const modality of responseModalities) {
      if (String(modality).toUpperCase() === "IMAGE") {
        hasImageModality = true;
        break;
      }
    }
  }
  const isImageCall = Boolean(options.imageAspectRatio || hasImageModality);
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
    await writePromptSnapshot(
      path.join(stage.debugDir, "prompt.txt"),
      promptContents
    );
  }

  const uploadBytes = estimateContentsUploadBytes(promptContents);
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
  const responseParts: LlmContentPart[] = [];
  let responseRole: LlmRole | undefined;
  let blocked = false;

  const appendTextPart = (text: string, isThought: boolean): void => {
    if (text.length === 0) {
      return;
    }
    responseParts.push({
      type: "text",
      text,
      thought: isThought ? true : undefined,
    });
  };

  const appendInlinePart = (data: string, mimeType: string | undefined): void => {
    if (data.length === 0) {
      return;
    }
    responseParts.push({
      type: "inlineData",
      data,
      mimeType,
    });
  };

  const accumulateContent = (content: LlmContent): { charDelta: number; byteDelta: number } => {
    let charDelta = 0;
    let byteDelta = 0;
    if (!responseRole) {
      responseRole = content.role;
    }
    for (let index = 0; index < content.parts.length; index += 1) {
      const part = content.parts[index];
      if (part.type === "text") {
        const text = part.text;
        appendTextPart(text, part.thought === true);
        charDelta += text.length;
        if (part.thought === true) {
          thoughts.push(text);
        }
      } else {
        appendInlinePart(part.data, part.mimeType);
        byteDelta += estimateInlineBytes(part.data);
      }
    }
    return { charDelta, byteDelta };
  };

  try {
    await runGeminiCall(async (client) => {
      const stream = await client.models.generateContentStream({
        model: options.modelId,
        contents: googlePromptContents,
        config,
      });
      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          resolvedModelVersion = chunk.modelVersion;
        }
        if (chunk.promptFeedback?.blockReason) {
          blocked = true;
        }
        const candidates = chunk.candidates;
        let chunkCharDelta = 0;
        let chunkByteDelta = 0;
        if (candidates !== undefined && candidates.length > 0) {
          const primary = candidates[0];
          if (isModerationFinish(primary.finishReason)) {
            blocked = true;
          }
          for (let index = 0; index < candidates.length; index += 1) {
            const candidate = candidates[index];
            const candidateContent = candidate.content;
            if (!candidateContent) {
              continue;
            }
            try {
              const content = convertGoogleContentToLlmContent(candidateContent);
              const deltas = accumulateContent(content);
              chunkCharDelta += deltas.charDelta;
              chunkByteDelta += deltas.byteDelta;
              handleChunk?.(content);
            } catch (error) {
              log(
                `failed to convert candidate content: ${error instanceof Error ? error.message : String(error)}`
              );
            }
          }
        }
        if (chunkCharDelta > 0 || chunkByteDelta > 0) {
          reporter.recordModelUsage(callHandle, {
            modelVersion: chunk.modelVersion,
            outputCharsDelta: chunkCharDelta > 0 ? chunkCharDelta : undefined,
            outputBytesDelta: chunkByteDelta > 0 ? chunkByteDelta : undefined,
          });
        }
        totalChars += chunkCharDelta;
        totalBytes += chunkByteDelta;
        chunkIndex += 1;
        chunkLog.push(
          `chunk ${chunkIndex}: +${chunkCharDelta} chars, +${formatByteSize(chunkByteDelta)} bytes`
        );
        // Do not emit per-model periodic progress logs; aggregate display handles this.
        // Keep tracking for snapshots and final completion log.
      }
    });
  } finally {
    reporter.finishModelCall(callHandle);
  }

  const elapsedMs = Date.now() - startedAt;
  log(
    `completed model ${resolvedModelVersion} in ${formatMillis(elapsedMs)} (${formatInteger(totalChars)} chars, ${formatByteSize(totalBytes)} down)`
  );

  const mergedParts = mergeConsecutiveTextParts(responseParts);
  const responseContent =
    mergedParts.length > 0
      ? {
          role: responseRole ?? "model",
          parts: mergedParts,
        }
      : undefined;

  return {
    stats: {
      elapsedMs,
      modelVersion: resolvedModelVersion,
      charCount: totalChars,
      totalBytes,
    },
    debug: {
      label: stage.label,
      directory: stage.debugDir,
      chunkLog,
      thoughts,
    },
    content: responseContent,
    feedback: blocked ? { blockedReason: "blocked" } : {},
  };
}

function mergeConsecutiveTextParts(
  parts: readonly LlmContentPart[]
): LlmContentPart[] {
  if (parts.length === 0) {
    return [];
  }
  const merged: LlmContentPart[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.type !== "text") {
      merged.push({
        type: "inlineData",
        data: part.data,
        mimeType: part.mimeType,
      });
      continue;
    }
    const isThought = part.thought === true;
    const last = merged[merged.length - 1];
    if (
      last &&
      last.type === "text" &&
      (last.thought === true) === isThought
    ) {
      last.text += part.text;
      last.thought = isThought ? true : undefined;
    } else {
      merged.push({
        type: "text",
        text: part.text,
        thought: isThought ? true : undefined,
      });
    }
  }
  return merged;
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
  attemptLabel?: number | string
): Promise<LlmTextCallMeta> {
  const {
    elapsedMs,
    modelVersion,
    charCount,
    chunkLog,
    thoughts,
    textAggregator,
    stage,
    latestCandidateParts,
    latestCandidateRole,
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
      contents:
        latestCandidateParts && latestCandidateParts.length > 0
          ? [
              {
                role: latestCandidateRole ?? "model",
                parts: latestCandidateParts.map(clonePart),
              },
            ]
          : undefined,
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
  options: LlmTextCallOptions
): Promise<string> {
  const { text } = await executeLlmText(options);
  return text;
}

export async function runLlmImageCall(
  options: LlmImageCallOptions
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
    latestCandidateParts,
    latestCandidateRole,
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
    contents:
      latestCandidateParts && latestCandidateParts.length > 0
        ? [
            {
              role: latestCandidateRole ?? "model",
              parts: latestCandidateParts.map(clonePart),
            },
          ]
        : undefined,
  });

  return images;
}

export type GenerateImagesOptions = Omit<LlmImageCallOptions, "parts"> & {
  readonly stylePrompt: readonly string[];
  readonly imagePrompts: readonly string[];
  readonly maxAttempts?: number;
};

export async function generateImages(
  options: GenerateImagesOptions
): Promise<LlmImagePart[]> {
  const {
    stylePrompt,
    imagePrompts,
    maxAttempts = 4,
    contents,
    progress,
    modelId,
    debug,
    responseModalities,
    imageAspectRatio,
  } = options;

  if (contents && contents.length > 0) {
    throw new Error("generateImages does not support pre-seeded contents");
  }

  const styleLines = Array.from(stylePrompt);
  const cleanedStyle = styleLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  type PromptEntry = { index: number; prompt: string };
  const promptList = Array.from(imagePrompts);
  const promptEntries: PromptEntry[] = promptList.map(
    (rawPrompt, arrayIndex) => {
      const trimmedPrompt = rawPrompt.trim();
      if (!trimmedPrompt) {
        throw new Error(
          `imagePrompts[${arrayIndex}] must be a non-empty string`
        );
      }
      return {
        index: arrayIndex + 1,
        prompt: trimmedPrompt,
      };
    }
  );

  const numImages = promptEntries.length;
  if (numImages <= 0) {
    return [];
  }

  const entryByIndex = new Map<number, PromptEntry>();
  for (const entry of promptEntries) {
    entryByIndex.set(entry.index, entry);
  }

  const buildOutputFormatLines = (entries: PromptEntry[]): string[] => {
    const formatLines: string[] = [];
    for (const entry of entries) {
      formatLines.push(
        `${entry.index}. <repeat prompt for image ${entry.index}>`
      );
      formatLines.push("<image>");
    }
    return formatLines;
  };

  const buildInitialPrompt = (): string => {
    const headerLines: string[] = [
      `Please make a total of ${numImages} images:`,
      "",
      "Follow the style:",
      ...cleanedStyle,
      "",
      "Image descriptions:",
    ];
    const lines = [...headerLines];
    for (const entry of promptEntries) {
      lines.push(`\nImage ${entry.index}: ${entry.prompt}`);
    }
    lines.push("");
    lines.push("Output format:");
    lines.push(...buildOutputFormatLines(promptEntries));
    return lines.join("\n");
  };

  const buildContinuationPrompt = (pending: PromptEntry[]): string => {
    const pendingIds = pending.map((entry) => entry.index).join(", ");
    const lines: string[] = [
      `Please continue generating the remaining images: ${pendingIds}.`,
    ];
    if (cleanedStyle.length > 0) {
      lines.push("");
      lines.push("Follow the style:");
      lines.push(...cleanedStyle);
    }
    lines.push("");
    lines.push("Image descriptions:");
    for (const entry of pending) {
      lines.push(`\nImage ${entry.index}: ${entry.prompt}`);
    }
    lines.push("");
    lines.push("Output format:");
    lines.push(...buildOutputFormatLines(pending));
    return lines.join("\n");
  };

  const generationPrompt = buildInitialPrompt();
  const promptParts: LlmContentPart[] = [{ type: "text", text: generationPrompt }];

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

  const totalAttempts = Math.max(1, maxAttempts);

  const runImageAttempt = async (
    attempt: number,
    contentsOverride?: readonly Content[]
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
      contents:
        result.latestCandidateParts && result.latestCandidateParts.length > 0
          ? [
              {
                role: result.latestCandidateRole ?? "model",
                parts: result.latestCandidateParts.map(clonePart),
              },
            ]
          : undefined,
    });

    return {
      images: attemptImages,
      lastCandidates: result.lastCandidates,
      promptFeedback: result.promptFeedback,
      latestCandidateParts: result.latestCandidateParts,
      latestCandidateRole: result.latestCandidateRole,
    };
  };

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
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
    if (attempt === totalAttempts) {
      break;
    }
    // Build continuation content from all images produced in this attempt.
    // Relying on the last candidate's parts can drop earlier images since
    // candidates often only include the latest chunk. Using collected images
    // guarantees we preserve the full attempt output in the conversation.
    let continuationParts: Part[] | undefined;
    if (attemptImages.length > 0) {
      continuationParts = attemptImages.map((img) => ({
        inlineData: {
          data: img.data.toString("base64"),
          mimeType: img.mimeType,
        },
      }));
    } else if (candidate?.content) {
      // Fallback to candidate content when no images were collected (e.g. text-only)
      const responseClone = cloneContent(candidate.content);
      const sourceParts = responseClone.parts;
      const responseParts = sourceParts !== undefined ? sourceParts.slice() : [];
      trimPartsForContinuation(responseParts, moderationFailure);
      continuationParts = responseParts;
    } else {
      break;
    }

    if (!historyContent) {
      historyContent = {
        role: "model",
        parts: continuationParts,
      };
    } else {
      const aggregatedParts = [
        ...(historyContent.parts ?? []),
        ...(continuationParts ?? []),
      ];
      historyContent = {
        role: historyContent.role ?? "model",
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

    const pendingEntries = pendingIndices
      .map((index) => entryByIndex.get(index))
      .filter((entry): entry is PromptEntry => Boolean(entry));
    if (pendingEntries.length === 0) {
      break;
    }

    const instruction = buildContinuationPrompt(pendingEntries);
    const continuation: Content[] = [promptContent];
    if (historyContent) {
      continuation.push(historyContent);
    }
    continuation.push({
      role: "user",
      parts: [{ text: instruction }],
    });
    pendingContents = continuation;
  }

  return collectedImages.slice(0, numImages);
}

export type LlmJsonCallOptions<T> = Omit<
  LlmTextCallOptions,
  "responseSchema"
> & {
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
    }>
  ) {
    super(message);
    this.name = "LlmJsonCallError";
  }
}

export async function runLlmJsonCall<T>(
  options: LlmJsonCallOptions<T>
): Promise<T> {
  const { schema, responseSchema, maxAttempts = 2, ...rest } = options;
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
      const handledError =
        error instanceof Error ? error : new Error(String(error));
      failures.push({ attempt, rawText, error: handledError });
      if (attempt >= totalAttempts) {
        throw new LlmJsonCallError(
          `LLM JSON call failed after ${attempt} attempt(s)`,
          failures
        );
      }
    }
  }

  throw new LlmJsonCallError("LLM JSON call failed", failures);
}
function toGooglePart(part: LlmContentPart): Part {
  switch (part.type) {
    case "text":
      return {
        text: part.text,
        thought: part.thought === true ? true : undefined,
      };
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
