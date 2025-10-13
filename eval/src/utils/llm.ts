import { Buffer } from "node:buffer";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// NOTE: Keep eval/src/utils/LLM.md in sync with any API changes to this file.
// The markdown doc explains the public wrapper API and debug snapshot layout.
import {
  FinishReason,
  type Content,
  type Part,
  type Schema,
  type Tool,
} from "@google/genai";
import { runGeminiCall, type GeminiModelId } from "@spark/llm/utils/gemini";
import { z } from "zod";
import sharp from "sharp";

import type { JobProgressReporter } from "./concurrency";
import { formatMillis } from "./format";

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

function estimateInlineBytes(data: string): number {
  try {
    return Buffer.from(data, "base64").byteLength;
  } catch {
    return Buffer.byteLength(data, "utf8");
  }
}

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
  parts: readonly Part[],
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

function extractVisibleText(content: LlmContent | undefined): string {
  if (!content) {
    return "";
  }
  let text = "";
  for (const part of content.parts) {
    if (part.type === "text" && part.thought !== true) {
      text += part.text;
    }
  }
  return text.trim();
}

function extractImages(content: LlmContent | undefined): LlmImageData[] {
  if (!content) {
    return [];
  }
  const images: LlmImageData[] = [];
  for (const part of content.parts) {
    if (part.type !== "inlineData") {
      continue;
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(part.data, "base64");
    } catch {
      buffer = Buffer.from(part.data, "base64url");
    }
    images.push({ mimeType: part.mimeType, data: buffer });
  }
  return images;
}

export type LlmCallBaseOptions = {
  readonly modelId: LlmModelId;
  readonly contents: readonly LlmContent[];
  readonly progress?: JobProgressReporter;
  readonly debug?: LlmDebugOptions;
};

export type LlmTextCallOptions = LlmCallBaseOptions & {
  readonly responseMimeType?: string;
  readonly responseSchema?: Schema;
  readonly tools?: readonly LlmToolConfig[];
};

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
    }>,
  ) {
    super(message);
    this.name = "LlmJsonCallError";
  }
}

export type LlmGenerateImagesOptions = Omit<LlmCallBaseOptions, "contents"> & {
  readonly contents?: never;
  readonly imageAspectRatio?: string;
  readonly stylePrompt: string;
  readonly styleImages?: readonly LlmImageData[];
  readonly imagePrompts: readonly string[];
  readonly maxAttempts?: number;
};

export type LlmImageData = {
  readonly mimeType?: string;
  readonly data: Buffer;
};

export type LlmDebugOptions = {
  readonly rootDir: string;
  readonly stage?: string;
  readonly subStage?: string;
  readonly attempt?: number | string;
  readonly enabled?: boolean;
};

export type LlmToolConfig = {
  readonly type: "web-search";
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
            lines.push(
              `${header} (${part.thought === true ? "thought" : "text"}):`,
            );
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
        partIndex += 1;
      }
      lines.push("");
    }
    contentIndex += 1;
  }
  return lines.join("\n");
}

async function writePromptSnapshot(
  pathname: string,
  contents: readonly LlmContent[],
): Promise<void> {
  const snapshot = formatContentsForSnapshot(contents);
  await writeFile(pathname, snapshot, { encoding: "utf8" });
}

async function writeTextResponseSnapshot({
  pathname,
  summary = [],
  text,
  contents,
}: {
  pathname: string;
  summary?: readonly string[];
  text: string;
  contents?: readonly LlmContent[];
}): Promise<void> {
  const sections: string[] = [];
  if (summary.length > 0) {
    sections.push(...summary, "");
  }
  sections.push("===== Response =====");
  sections.push(text, "");
  if (contents && contents.length > 0) {
    sections.push("===== Content =====");
    const contentLines = formatContentsForSnapshot(contents).split("\n");
    sections.push(...contentLines);
    if (sections[sections.length - 1] !== "") {
      sections.push("");
    }
  }
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, sections.join("\n"), { encoding: "utf8" });
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
  if (attemptLabel !== undefined) {
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

export type LlmStreamContent = LlmContent;

export type LlmBlockedReason = "blocked";

export type LlmStreamFeedback = {
  readonly blockedReason: LlmBlockedReason;
};

export type LlmStreamResult = {
  readonly content?: LlmStreamContent;
  readonly feedback?: LlmStreamFeedback;
};

async function llmStream({
  options,
  attemptLabel,
}: {
  readonly options: LlmStreamCallOptions;
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
  const promptContents = options.contents;
  const googlePromptContents = promptContents.map(
    convertLlmContentToGoogleContent,
  );
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
      promptContents,
    );
  }

  const uploadBytes = estimateContentsUploadBytes(promptContents);
  const callHandle = reporter.startModelCall({
    modelId: options.modelId,
    uploadBytes,
  });

  const startedAt = Date.now();
  let resolvedModelVersion: string = options.modelId;
  const responseParts: LlmContentPart[] = [];
  let responseRole: LlmRole | undefined;
  let blocked = false;
  const debugWriteTasks: Array<Promise<void>> = [];
  let imageCounter = 0;

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

  const appendInlinePart = (
    data: string,
    mimeType: string | undefined,
  ): void => {
    if (data.length === 0) {
      return;
    }
    responseParts.push({
      type: "inlineData",
      data,
      mimeType,
    });
    if (
      stage.debugDir &&
      mimeType &&
      mimeType.toLowerCase().startsWith("image/")
    ) {
      const debugDir = stage.debugDir;
      const index = ++imageCounter;
      debugWriteTasks.push(
        (async () => {
          let buffer: Buffer;
          try {
            buffer = Buffer.from(data, "base64");
          } catch {
            buffer = Buffer.from(data, "base64url");
          }
          const extensionSegment = mimeType?.split(";")[0]?.split("/")[1];
          let outputBuffer = buffer;
          let outputExtension = extensionSegment ?? "bin";
          if (mimeType?.toLowerCase().startsWith("image/")) {
            try {
              const jpegBuffer = await sharp(buffer)
                .jpeg({
                  quality: 92,
                  progressive: true,
                  chromaSubsampling: "4:4:4",
                })
                .toBuffer();
              outputBuffer = jpegBuffer;
              outputExtension = "jpg";
            } catch (error) {
              log(
                `failed to convert debug image to JPEG: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }
          }
          const filename = `image-${String(index).padStart(
            2,
            "0",
          )}.${outputExtension}`;
          await writeFile(path.join(debugDir, filename), outputBuffer);
        })(),
      );
    }
  };

  const accumulateContent = (
    content: LlmContent,
  ): { charDelta: number; byteDelta: number } => {
    let charDelta = 0;
    let byteDelta = 0;
    if (!responseRole) {
      responseRole = content.role;
    }
    for (const part of content.parts) {
      if (part.type === "text") {
        const text = part.text;
        appendTextPart(text, part.thought === true);
        charDelta += text.length;
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
          for (const candidate of candidates) {
            const candidateContent = candidate.content;
            if (!candidateContent) {
              continue;
            }
            try {
              const content =
                convertGoogleContentToLlmContent(candidateContent);
              const deltas = accumulateContent(content);
              chunkCharDelta += deltas.charDelta;
              chunkByteDelta += deltas.byteDelta;
            } catch (error) {
              log(
                `failed to convert candidate content: ${error instanceof Error ? error.message : String(error)}`,
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
      }
    });
  } finally {
    reporter.finishModelCall(callHandle);
  }

  const elapsedMs = Date.now() - startedAt;
  log(`completed model ${resolvedModelVersion} in ${formatMillis(elapsedMs)}`);

  const mergedParts = mergeConsecutiveTextParts(responseParts);
  const responseContent =
    mergedParts.length > 0
      ? {
          role: responseRole ?? "model",
          parts: mergedParts,
        }
      : undefined;

  if (stage.debugDir) {
    await Promise.all(debugWriteTasks);
    const trimmedResponseText = extractVisibleText(responseContent);
    await writeTextResponseSnapshot({
      pathname: path.join(stage.debugDir, "response.txt"),
      summary: [
        `Model: ${resolvedModelVersion}`,
        `Elapsed: ${formatMillis(elapsedMs)}`,
      ],
      text: trimmedResponseText,
      contents: responseContent ? [responseContent] : undefined,
    });
  }

  return {
    content: responseContent,
    feedback: blocked ? { blockedReason: "blocked" } : undefined,
  };
}

function mergeConsecutiveTextParts(
  parts: readonly LlmContentPart[],
): LlmContentPart[] {
  if (parts.length === 0) {
    return [];
  }
  const merged: LlmContentPart[] = [];
  for (const part of parts) {
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
    if (last && last.type === "text" && (last.thought === true) === isThought) {
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

export async function generateText(
  options: LlmTextCallOptions,
  attemptLabel?: number | string,
): Promise<string> {
  const result = await llmStream({
    options,
    attemptLabel,
  });
  const resolvedText = extractVisibleText(result.content);
  if (!resolvedText) {
    throw new Error("LLM response did not include any text output");
  }
  return resolvedText;
}

export async function generateJson<T>(
  options: LlmJsonCallOptions<T>,
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
    const attemptOptions: LlmTextCallOptions =
      textOptions.debug !== undefined
        ? {
            ...textOptions,
            debug: { ...textOptions.debug, attempt },
          }
        : textOptions;
    const rawText = await generateText(attemptOptions, attempt);
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
          failures,
        );
      }
    }
  }

  throw new LlmJsonCallError("LLM JSON call failed", failures);
}

export async function generateImages(
  options: LlmGenerateImagesOptions,
): Promise<LlmImageData[]> {
  const {
    stylePrompt,
    styleImages,
    imagePrompts,
    maxAttempts = 4,
    progress,
    modelId,
    debug,
    imageAspectRatio,
  } = options;

  type PromptEntry = { index: number; prompt: string };
  const promptList = Array.from(imagePrompts);
  const promptEntries: PromptEntry[] = promptList.map(
    (rawPrompt, arrayIndex) => {
      const trimmedPrompt = rawPrompt.trim();
      if (!trimmedPrompt) {
        throw new Error(
          `imagePrompts[${arrayIndex}] must be a non-empty string`,
        );
      }
      return {
        index: arrayIndex + 1,
        prompt: trimmedPrompt,
      };
    },
  );

  const numImages = promptEntries.length;
  if (numImages <= 0) {
    return [];
  }

  const addText = (parts: LlmContentPart[], text: string) => {
    const lastPart = parts[parts.length - 1];
    if (lastPart !== undefined && lastPart.type === "text") {
      lastPart.text = `${lastPart.text}\n${text}`;
    } else {
      parts.push({ type: "text", text });
    }
  };

  const buildInitialPrompt = (): LlmContentPart[] => {
    const parts: LlmContentPart[] = [];
    addText(
      parts,
      [
        `Please make all ${numImages} requested images:`,
        "",
        "Follow the style:",
        stylePrompt,
      ].join("\n"),
    );
    if (styleImages !== undefined && styleImages.length > 0) {
      addText(
        parts,
        "\nFollow the visual style, composition and the characters from these images:",
      );
      for (const styleImage of styleImages) {
        parts.push({
          type: "inlineData",
          data: styleImage.data.toString("base64"),
          mimeType: styleImage.mimeType,
        });
      }
    }
    const lines: string[] = ["", "Image descriptions:"];
    for (const entry of promptEntries) {
      lines.push(`\nImage ${entry.index}: ${entry.prompt}`);
    }
    lines.push("");
    lines.push(`Please make all ${numImages} images.`);
    const linesText = lines.join("\n");
    addText(parts, linesText);
    return parts;
  };

  const buildContinuationPrompt = (
    pending: PromptEntry[],
  ): LlmContentPart[] => {
    const pendingIds = pending.map((entry) => entry.index).join(", ");
    const lines: string[] = [
      `Please continue generating the remaining images: ${pendingIds}.`,
    ];
    lines.push("");
    lines.push("Image descriptions:");
    for (const entry of pending) {
      lines.push(`\nImage ${entry.index}: ${entry.prompt}`);
    }
    lines.join("");
    lines.push(`\nPlease make all ${pendingIds.length} remaining images.`);
    return [
      {
        type: "text",
        text: lines.join("\n"),
      },
    ];
  };

  const collectedImages: LlmImageData[] = [];

  const totalAttempts = Math.max(1, maxAttempts);

  const contents: LlmContent[] = [
    {
      role: "user",
      parts: buildInitialPrompt(),
    },
  ];
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const result = await llmStream({
      options: {
        modelId,
        contents,
        progress,
        debug,
        responseModalities: ["IMAGE", "TEXT"],
        imageAspectRatio,
      },
      attemptLabel: attempt,
    });
    const { content } = result;
    if (result.feedback !== undefined || content === undefined) {
      continue;
    }
    const images = extractImages(content);
    if (images.length > 0) {
      collectedImages.push(...images);
      const completedCount = Math.min(images.length, promptEntries.length);
      if (completedCount > 0) {
        promptEntries.splice(0, completedCount);
      }
    }
    if (promptEntries.length === 0) {
      break;
    }
    contents.push(content);
    contents.push({
      role: "user",
      parts: buildContinuationPrompt(promptEntries),
    });
  }

  return collectedImages.slice(0, numImages);
}

export async function generateImageInBatches(
  options: LlmGenerateImagesOptions & {
    batchSize: number;
    overlapSize: number;
  },
): Promise<LlmImageData[]> {
  const {
    batchSize,
    overlapSize,
    imagePrompts,
    styleImages: baseStyleImagesInput,
    debug: baseDebug,
    ...restOptions
  } = options;

  if (batchSize <= 0) {
    throw new Error("batchSize must be greater than 0");
  }
  if (imagePrompts.length === 0) {
    return [];
  }

  const baseStyleImages = baseStyleImagesInput ? [...baseStyleImagesInput] : [];
  const generatedImages: LlmImageData[] = [];
  const totalPrompts = imagePrompts.length;

  for (
    let startIndex = 0, batchIndex = 0;
    startIndex < totalPrompts;
    startIndex += batchSize, batchIndex += 1
  ) {
    const endIndex = Math.min(startIndex + batchSize, totalPrompts);
    const batchPrompts = imagePrompts.slice(startIndex, endIndex);

    let styleImagesForBatch: readonly LlmImageData[] = baseStyleImages;
    if (overlapSize > 0 && generatedImages.length > 0) {
      const overlapImages = generatedImages.slice(
        Math.max(0, generatedImages.length - overlapSize),
      );
      if (overlapImages.length > 0) {
        styleImagesForBatch = [...baseStyleImages, ...overlapImages];
      }
    }

    const batchDebug =
      baseDebug !== undefined
        ? {
            ...baseDebug,
            subStage: baseDebug.subStage
              ? `${baseDebug.subStage}_batch-${batchIndex + 1}`
              : `batch-${batchIndex + 1}`,
          }
        : undefined;

    const batchImages = await generateImages({
      ...restOptions,
      styleImages: styleImagesForBatch,
      imagePrompts: batchPrompts,
      debug: batchDebug,
    });

    generatedImages.push(...batchImages);
  }

  return generatedImages;
}
