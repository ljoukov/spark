import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile, rename, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

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

type LlmInlineDataPart = {
  type: "inlineData";
  data: string;
  mimeType?: string;
  debugImageHash?: string;
  debugImageFilename?: string;
};

export type LlmContentPart =
  | { type: "text"; text: string; thought?: boolean }
  | LlmInlineDataPart;

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
  readonly maxRetries?: number;
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

function isInlineImageMime(mimeType: string | undefined): boolean {
  return (
    typeof mimeType === "string" && mimeType.toLowerCase().startsWith("image/")
  );
}

function decodeInlineDataBuffer(data: string): Buffer {
  try {
    return Buffer.from(data, "base64");
  } catch {
    return Buffer.from(data, "base64url");
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  );
}

async function writeImageToMediaDir({
  mediaDir,
  filename,
  buffer,
}: {
  mediaDir: string;
  filename: string;
  buffer: Buffer;
}): Promise<void> {
  await mkdir(mediaDir, { recursive: true });
  const finalPath = path.join(mediaDir, filename);
  try {
    await stat(finalPath);
    return;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      // File does not exist yet; proceed with write.
    } else {
      throw error;
    }
  }
  const tempPath = path.join(
    mediaDir,
    `${filename}.${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`,
  );
  await writeFile(tempPath, buffer);
  try {
    await rename(tempPath, finalPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      await rm(tempPath, { force: true });
      return;
    }
    await rm(tempPath, { force: true });
    throw error;
  }
}

function toPosixRelativePath(value: string): string {
  if (path.sep === "/") {
    return value;
  }
  return value.replace(/\\/g, "/");
}

async function createDebugImageArtifact({
  base64Data,
  mimeType,
  index,
  prefix,
  sharedMediaDir,
  targetDirs,
  log,
}: {
  base64Data: string;
  mimeType?: string;
  index: number;
  prefix: string;
  sharedMediaDir?: string;
  targetDirs: readonly string[];
  log: (message: string) => void;
}): Promise<{ hash: string; filename: string }> {
  const buffer = decodeInlineDataBuffer(base64Data);
  const originalHash = createHash("sha256").update(buffer).digest("hex");
  let outputBuffer = buffer;
  if (isInlineImageMime(mimeType)) {
    try {
      outputBuffer = await sharp(buffer)
        .jpeg({
          quality: 92,
          progressive: true,
          chromaSubsampling: "4:4:4",
        })
        .toBuffer();
    } catch (error) {
      log(
        `failed to convert debug image to JPEG: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const mediaFilename = `${originalHash}.jpg`;
  if (sharedMediaDir !== undefined) {
    await writeImageToMediaDir({
      mediaDir: sharedMediaDir,
      filename: mediaFilename,
      buffer: outputBuffer,
    });
  } else {
    await Promise.all(
      targetDirs.map(async (dir) =>
        writeImageToMediaDir({
          mediaDir: path.join(dir, "media"),
          filename: mediaFilename,
          buffer: outputBuffer,
        }),
      ),
    );
  }
  const shortHash = `${prefix}-${String(index).padStart(3, "0")}-${originalHash.slice(
    0,
    6,
  )}`;
  const symlinkFilename = `${prefix}-${String(index).padStart(3, "0")}.jpg`;
  await Promise.all(
    targetDirs.map(async (dir) => {
      const linkPath = path.join(dir, symlinkFilename);
      const mediaBaseDir =
        sharedMediaDir !== undefined
          ? sharedMediaDir
          : path.join(dir, "media");
      const absoluteTarget = path.join(mediaBaseDir, mediaFilename);
      let relativeTarget = path.relative(dir, absoluteTarget);
      if (relativeTarget.length === 0) {
        relativeTarget = path.basename(absoluteTarget);
      }
      try {
        await rm(linkPath, { force: true });
      } catch (error) {
        log(
          `failed to remove existing link at ${linkPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      try {
        await symlink(relativeTarget, linkPath, "file");
      } catch (error) {
        log(
          `failed to create symlink ${linkPath} -> ${relativeTarget}: ${
            error instanceof Error ? error.message : String(error)
          } (falling back to copy)`,
        );
        try {
          await writeFile(linkPath, outputBuffer);
        } catch (fallbackError) {
          log(
            `failed to write image copy to ${linkPath}: ${
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError)
            }`,
          );
        }
      }
    }),
  );
  return { hash: shortHash, filename: symlinkFilename };
}

function cloneContentForDebug(content: LlmContent): LlmContent {
  const parts: LlmContentPart[] = content.parts.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text,
        thought: part.thought === true ? true : undefined,
      };
    }
    return {
      type: "inlineData",
      data: part.data,
      mimeType: part.mimeType,
    };
  });
  return {
    role: content.role,
    parts,
  };
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
  { attempt, maxAttempts }: { attempt: number; maxAttempts: number },
): string | undefined {
  if (!debug || !debug.rootDir || debug.enabled === false) {
    return undefined;
  }
  const stageSegment = normalisePathSegment(debug.stage ?? "llm");
  const segments = [debug.rootDir, stageSegment];
  if (debug.subStage) {
    segments.push(normalisePathSegment(debug.subStage));
  }
  segments.push(
    normalisePathSegment(
      `attempt-${String(attempt).padStart(2, "0")}-of-${String(maxAttempts).padStart(2, "0")}`,
    ),
  );
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
            const hashLabel =
              part.debugImageHash !== undefined
                ? `, ${part.debugImageHash}`
                : "";
            lines.push(
              `${header} (inline ${part.mimeType ?? "binary"}, ${bytes} bytes${hashLabel})`,
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

async function writeDebugTextFile({
  dirs,
  filename,
  contents,
}: {
  dirs: readonly string[];
  filename: string;
  contents: string;
}): Promise<void> {
  if (dirs.length === 0) {
    return;
  }
  await Promise.all(
    dirs.map(async (dir) =>
      writeFile(path.join(dir, filename), contents, { encoding: "utf8" }),
    ),
  );
}

function buildRequestSnapshot({
  modelId,
  stageLabel,
  attempt,
  maxAttempts,
  uploadBytes,
  config,
}: {
  modelId: LlmModelId;
  stageLabel: string;
  attempt: number;
  maxAttempts: number;
  uploadBytes: number;
  config: GeminiCallConfig;
}): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [
    `Timestamp: ${timestamp}`,
    `Stage: ${stageLabel}`,
    `Model ID: ${modelId}`,
    `Attempt: ${attempt} of ${maxAttempts}`,
    `Estimated Upload Bytes: ${uploadBytes}`,
  ];
  const configSummary = JSON.stringify(config, null, 2);
  lines.push("", "Gemini Call Config:", configSummary ?? "{}");
  return lines.join("\n");
}

function buildExceptionSnapshot({
  error,
  modelId,
  stageLabel,
  attempt,
  maxAttempts,
}: {
  error: unknown;
  modelId: LlmModelId;
  stageLabel: string;
  attempt: number;
  maxAttempts: number;
}): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [
    `Timestamp: ${timestamp}`,
    `Stage: ${stageLabel}`,
    `Model ID: ${modelId}`,
    `Attempt: ${attempt} of ${maxAttempts}`,
  ];
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : error
          ? inspect(error, { depth: 0 })
          : "Unknown error";
  lines.push("", "Error Message:", message);
  if (error instanceof Error && typeof error.stack === "string") {
    lines.push("", "Stack Trace:", error.stack);
  }
  const inspected = inspect(error, { depth: null });
  lines.push("", "Error Details:", inspected);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function formatRoleLabel(role: LlmRole): string {
  switch (role) {
    case "user":
      return "User";
    case "model":
      return "Model";
    case "system":
      return "System";
    case "tool":
      return "Tool";
    default:
      return "Message";
  }
}

function buildConversationHtml({
  promptContents,
  responseContent,
  resolveImageHref,
}: {
  promptContents: readonly LlmContent[];
  responseContent?: LlmContent;
  resolveImageHref?: (filename: string | undefined) => string | undefined;
}): string {
  const messages: LlmContent[] = [
    ...promptContents,
    ...(responseContent ? [responseContent] : []),
  ];
  const html: string[] = [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    "  <title>LLM Conversation</title>",
    "  <style>",
    "    body { font-family: system-ui, sans-serif; margin: 24px; background: #f9fafb; color: #111827; }",
    "    .message { border: 1px solid #d1d5db; border-radius: 8px; margin-bottom: 20px; padding: 16px; background: #fff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1); }",
    "    .message h2 { margin: 0 0 12px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.05em; color: #374151; }",
    "    .parts { display: flex; flex-direction: column; gap: 12px; }",
    "    .part { padding: 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: #f8fafc; }",
    "    .part-label { font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 8px; }",
    '    .part-text pre { margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: ui-monospace, SFMono-Regular, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #e5e7eb; }',
    "    .part-image img { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid #d1d5db; background: #fff; }",
    "  </style>",
    "</head>",
    "<body>",
  ];
  messages.forEach((message, messageIndex) => {
    html.push(
      `  <section class="message role-${escapeAttribute(message.role)}">`,
    );
    html.push(
      `    <h2>${escapeHtml(formatRoleLabel(message.role))} #${
        messageIndex + 1
      }</h2>`,
    );
    html.push('    <div class="parts">');
    message.parts.forEach((part, partIndex) => {
      if (part.type === "text") {
        const flavour = part.thought === true ? "thought" : "text";
        html.push('      <div class="part part-text">');
        html.push(
          `        <div class="part-label">Part ${partIndex + 1} (${escapeHtml(
            flavour,
          )})</div>`,
        );
        html.push(`        <pre>${escapeHtml(part.text)}</pre>`);
        html.push("      </div>");
        return;
      }
      const bytes = estimateInlineBytes(part.data);
      const hashLabel =
        part.debugImageHash !== undefined ? `, ${part.debugImageHash}` : "";
      const isImage = isInlineImageMime(part.mimeType);
      const resolvedSrc =
        isImage && resolveImageHref
          ? resolveImageHref(part.debugImageFilename)
          : part.debugImageFilename;
      html.push('      <div class="part part-image">');
      html.push(
        `        <div class="part-label">Part ${partIndex + 1} (inline ${escapeHtml(
          part.mimeType ?? "binary",
        )}, ${bytes} bytes${hashLabel})</div>`,
      );
      if (isImage && resolvedSrc) {
        html.push(
          `        <img src="${escapeAttribute(
            resolvedSrc,
          )}" alt="Part ${partIndex + 1} image" />`,
        );
      } else if (isImage) {
        html.push(
          "        <div>Image bytes omitted (debug file not available).</div>",
        );
      } else {
        html.push("        <div>Inline data omitted from snapshot.</div>");
      }
      html.push("      </div>");
    });
    html.push("    </div>");
    html.push("  </section>");
  });
  html.push("</body>", "</html>");
  return html.join("\n");
}

function buildCallStage({
  modelId,
  debug,
  attempt,
  maxAttempts,
}: {
  modelId: LlmModelId;
  debug?: LlmDebugOptions;
  attempt: number;
  maxAttempts: number;
}): LlmCallStage {
  const labelParts: string[] = [debug?.stage ?? modelId];
  if (attempt !== undefined) {
    labelParts.push(`attempt ${attempt} / ${maxAttempts}`);
  }
  const debugDir = resolveDebugDir(debug, { attempt, maxAttempts });
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
  attempt,
  maxAttempts,
}: {
  readonly options: LlmStreamCallOptions;
  readonly attempt: number;
  readonly maxAttempts: number;
}): Promise<LlmStreamResult> {
  const stage = buildCallStage({
    modelId: options.modelId,
    debug: options.debug,
    attempt,
    maxAttempts,
  });
  const reporter = options.progress ?? createFallbackProgress(stage.label);
  const log = (message: string) => {
    reporter.log(`[${stage.label}] ${message}`);
  };
  const debugRootDir =
    options.debug && options.debug.rootDir && options.debug.enabled !== false
      ? options.debug.rootDir
      : undefined;
  const debugLogSegment =
    debugRootDir !== undefined
      ? normalisePathSegment(new Date().toISOString().replace(/[:]/g, "-"))
      : undefined;
  const debugLogDir =
    debugLogSegment !== undefined && debugRootDir !== undefined
      ? path.join(debugRootDir, "log", debugLogSegment)
      : undefined;
  const debugOutputDirs = Array.from(
    new Set(
      [stage.debugDir, debugLogDir].filter(
        (dir): dir is string => typeof dir === "string",
      ),
    ),
  );
  const sharedMediaDir =
    debugRootDir !== undefined ? path.join(debugRootDir, "media") : undefined;
  const promptContents = options.contents;
  const promptDebugContents = promptContents.map(cloneContentForDebug);
  const googlePromptContents = promptContents.map(
    convertLlmContentToGoogleContent,
  );
  const config: GeminiCallConfig = {};
  const thinkingConfig = (() => {
    switch (options.modelId) {
      case "gemini-2.5-pro":
        return {
          includeThoughts: true,
          thinkingBudget: 32_768,
        } as const;
      case "gemini-flash-latest":
      case "gemini-flash-lite-latest":
        return {
          includeThoughts: true,
          thinkingBudget: 24_576,
        } as const;
      case "gemini-2.5-flash-image":
        return undefined;
    }
  })();
  if (thinkingConfig) {
    config.thinkingConfig = thinkingConfig;
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

  const debugWriteTasks: Array<Promise<void>> = [];

  try {
    if (promptContents.length === 0) {
      throw new Error("LLM call received an empty prompt");
    }

    await resetDebugDir(stage.debugDir);
    await ensureDebugDir(stage.debugDir);
    await ensureDebugDir(debugLogDir);

    if (debugOutputDirs.length > 0) {
      let promptImageCounter = 0;
      const promptImageTasks: Array<Promise<void>> = [];
      for (const content of promptDebugContents) {
        for (const part of content.parts) {
          if (part.type !== "inlineData") {
            continue;
          }
          if (!isInlineImageMime(part.mimeType)) {
            continue;
          }
          const index = ++promptImageCounter;
          const task = (async () => {
            const { hash, filename } = await createDebugImageArtifact({
              base64Data: part.data,
              mimeType: part.mimeType,
              index,
              prefix: "prompt-image",
              sharedMediaDir,
              targetDirs: debugOutputDirs,
              log,
            });
            part.debugImageHash = hash;
            part.debugImageFilename = filename;
          })();
          promptImageTasks.push(task);
        }
      }
      await Promise.all(promptImageTasks);
    }

    if (stage.debugDir) {
      await writePromptSnapshot(
        path.join(stage.debugDir, "prompt.txt"),
        promptDebugContents,
      );
    }
    if (debugLogDir) {
      await writePromptSnapshot(
        path.join(debugLogDir, "prompt.txt"),
        promptDebugContents,
      );
    }

    const uploadBytes = estimateContentsUploadBytes(promptContents);
    if (debugOutputDirs.length > 0) {
      const requestSnapshot = buildRequestSnapshot({
        modelId: options.modelId,
        stageLabel: stage.label,
        attempt,
        maxAttempts,
        uploadBytes,
        config,
      });
      await writeDebugTextFile({
        dirs: debugOutputDirs,
        filename: "request.txt",
        contents: requestSnapshot,
      });
    }

    const callHandle = reporter.startModelCall({
      modelId: options.modelId,
      uploadBytes,
    });

    const startedAt = Date.now();
    let resolvedModelVersion: string = options.modelId;
    const responseParts: LlmContentPart[] = [];
    let responseRole: LlmRole | undefined;
    let blocked = false;
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
      const inlinePart: LlmInlineDataPart = {
        type: "inlineData",
        data,
        mimeType,
      };
      responseParts.push(inlinePart);
      if (!isInlineImageMime(mimeType) || debugOutputDirs.length === 0) {
        return;
      }
      const index = ++imageCounter;
      debugWriteTasks.push(
        (async () => {
          const { hash, filename } = await createDebugImageArtifact({
            base64Data: data,
            mimeType,
            index,
            prefix: "image",
            sharedMediaDir,
            targetDirs: debugOutputDirs,
            log,
          });
          inlinePart.debugImageHash = hash;
          inlinePart.debugImageFilename = filename;
        })(),
      );
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
    log(
      `completed model ${resolvedModelVersion} in ${formatMillis(elapsedMs)}`,
    );

    await Promise.all(debugWriteTasks);
    const mergedParts = mergeConsecutiveTextParts(responseParts);
    const responseContent =
      mergedParts.length > 0
        ? {
            role: responseRole ?? "model",
            parts: mergedParts,
          }
        : undefined;

    if (stage.debugDir || debugLogDir) {
      const trimmedResponseText = extractVisibleText(responseContent);
      const snapshotSummary: readonly string[] = [
        `Model: ${resolvedModelVersion}`,
        `Elapsed: ${formatMillis(elapsedMs)}`,
      ];
      const snapshotContents = responseContent ? [responseContent] : undefined;
      if (stage.debugDir) {
        await writeTextResponseSnapshot({
          pathname: path.join(stage.debugDir, "response.txt"),
          summary: snapshotSummary,
          text: trimmedResponseText,
          contents: snapshotContents,
        });
      }
      if (debugLogDir) {
        await writeTextResponseSnapshot({
          pathname: path.join(debugLogDir, "response.txt"),
          summary: snapshotSummary,
          text: trimmedResponseText,
          contents: snapshotContents,
        });
      }
      if (debugOutputDirs.length > 0) {
        await Promise.all(
          debugOutputDirs.map(async (dir) => {
            const conversationHtml = buildConversationHtml({
              promptContents: promptDebugContents,
              responseContent,
              resolveImageHref: (filename) => {
                if (!filename) {
                  return undefined;
                }
                if (!filename.includes("/") && !filename.includes("\\")) {
                  return toPosixRelativePath(filename);
                }
                if (debugRootDir) {
                  const absolutePath = path.join(debugRootDir, filename);
                  let relativePath = path.relative(dir, absolutePath);
                  if (relativePath.length === 0) {
                    relativePath = path.basename(absolutePath);
                  }
                  return toPosixRelativePath(relativePath);
                }
                return toPosixRelativePath(filename);
              },
            });
            await writeFile(path.join(dir, "conversation.html"), conversationHtml, {
              encoding: "utf8",
            });
          }),
        );
      }
    }

    return {
      content: responseContent,
      feedback: blocked ? { blockedReason: "blocked" } : undefined,
    };
  } catch (error) {
    await Promise.allSettled(debugWriteTasks);
    if (debugOutputDirs.length > 0) {
      const exceptionSnapshot = buildExceptionSnapshot({
        error,
        modelId: options.modelId,
        stageLabel: stage.label,
        attempt,
        maxAttempts,
      });
      await Promise.all(
        debugOutputDirs.map(async (dir) => {
          try {
            await ensureDebugDir(dir);
            await writeFile(
              path.join(dir, "exception.txt"),
              exceptionSnapshot,
              {
                encoding: "utf8",
              },
            );
          } catch (writeError) {
            log(
              `failed to write exception snapshot to ${dir}: ${
                writeError instanceof Error
                  ? writeError.message
                  : String(writeError)
              }`,
            );
          }
        }),
      );
    }
    throw error;
  }
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
        debugImageHash: part.debugImageHash,
        debugImageFilename: part.debugImageFilename,
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

async function generateTextWithAttempts(
  options: LlmTextCallOptions,
  { attempt, maxAttempts }: { attempt: number; maxAttempts: number },
): Promise<string> {
  const result = await llmStream({
    options,
    attempt,
    maxAttempts,
  });
  const resolvedText = extractVisibleText(result.content);
  if (!resolvedText) {
    throw new Error("LLM response did not include any text output");
  }
  return resolvedText;
}

export async function generateText(
  options: LlmTextCallOptions,
): Promise<string> {
  return await generateTextWithAttempts(options, {
    attempt: 1,
    maxAttempts: 1,
  });
}

export async function generateJson<T>(
  options: LlmJsonCallOptions<T>,
): Promise<T> {
  const {
    schema,
    responseSchema,
    maxAttempts: maxAttemptsOption,
    maxRetries,
    ...rest
  } = options;
  const normaliseAttempts = (
    value: number | undefined,
  ): number | undefined => {
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
  const maxAttempts =
    normaliseAttempts(maxAttemptsOption) ??
    normaliseAttempts(maxRetries) ??
    2;
  const textOptions: LlmTextCallOptions = {
    ...rest,
    responseSchema,
    responseMimeType: rest.responseMimeType ?? "application/json",
  };

  const failures: Array<{
    attempt: number;
    rawText: string;
    error: unknown;
  }> = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let rawText: string | undefined;
    try {
      rawText = await generateTextWithAttempts(textOptions, {
        attempt,
        maxAttempts,
      });
      const payload = JSON.parse(rawText);
      const parsed = schema.parse(payload);
      return parsed;
    } catch (error) {
      const handledError =
        error instanceof Error ? error : new Error(String(error));
      failures.push({
        attempt,
        rawText:
          typeof rawText === "string" && rawText.length > 0 ? rawText : "",
        error: handledError,
      });
      if (attempt >= maxAttempts) {
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
    // Ask for the correct remaining count (number of pending prompts),
    // not the string length of the comma-separated ID list.
    lines.push(`\nPlease make all ${pending.length} remaining images.`);
    return [
      {
        type: "text",
        text: lines.join("\n"),
      },
    ];
  };

  const collectedImages: LlmImageData[] = [];

  const contents: LlmContent[] = [
    {
      role: "user",
      parts: buildInitialPrompt(),
    },
  ];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await llmStream({
      options: {
        modelId,
        contents,
        progress,
        debug,
        responseModalities: ["IMAGE", "TEXT"],
        imageAspectRatio,
      },
      attempt,
      maxAttempts,
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
