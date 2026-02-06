import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFile,
  mkdir,
  rm,
  writeFile,
  rename,
  stat,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { inspect } from "node:util";

// NOTE: Keep docs/LLM.md in sync with any API changes to this file.
// The markdown doc explains the public wrapper API and debug snapshot layout.
import {
  FinishReason,
  FunctionCallingConfigMode,
  type Content,
  type GenerateContentConfig,
  type GroundingMetadata,
  type Part,
  type Tool,
} from "@google/genai";
import { zodToJsonSchema } from "@alcyone-labs/zod-to-json-schema";
import {
  getGeminiImagePreviewPricing,
  getGeminiProPreviewPricing,
  runGeminiCall,
  type GeminiModelId,
} from "./gemini";
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  getOpenAiPricing,
  isOpenAiModelVariantId,
  resolveOpenAiModelVariant,
  runOpenAiCall,
  type ChatGptOpenAiModelId,
  type OpenAiModelId,
  type OpenAiReasoningEffort,
} from "./openai-llm";
import {
  collectChatGptCodexResponse,
  type ChatGptInputItem,
  type ChatGptInputMessagePart,
} from "./chatgpt-codex";
import { z } from "zod";
import type {
  EasyInputMessage,
  FunctionTool as OpenAiFunctionTool,
  Response as OpenAiResponse,
  ResponseInput,
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseFunctionToolCall,
  ResponseTextConfig,
  Tool as OpenAiTool,
  ResponseUsage,
  ResponseIncludable,
} from "openai/resources/responses/responses";
import { getSharp } from "./sharp";

import type {
  JobProgressReporter,
  LlmUsageTokenUpdate,
  ModelCallHandle,
} from "./concurrency";
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

const debugDirUsageCounts = new Map<string, number>();
const debugLogDirUsageCounts = new Map<string, number>();

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

type GeminiCallConfig = GenerateContentConfig;

type LlmCallStage = {
  readonly label: string;
  readonly debugDir?: string;
};

export type LlmTextModelId =
  | GeminiModelId
  | OpenAiModelId
  | ChatGptOpenAiModelId;
export type LlmImageModelId = "gemini-3-pro-image-preview";
export type LlmModelId = LlmTextModelId | LlmImageModelId;
export type LlmImageSize = "1K" | "2K" | "4K";
export type JsonSchema = Record<string, unknown>;
type OpenAiReasoningEffortParam = "minimal" | "low" | "medium" | "high";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function applyNullableJsonSchema(schema: Record<string, unknown>): void {
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    if (!anyOf.some((entry) => isPlainRecord(entry) && entry.type === "null")) {
      anyOf.push({ type: "null" });
    }
    return;
  }
  const type = schema.type;
  if (typeof type === "string") {
    schema.type = type === "null" ? "null" : [type, "null"];
    return;
  }
  if (Array.isArray(type)) {
    const normalized = type.filter(
      (entry): entry is string => typeof entry === "string",
    );
    if (!normalized.includes("null")) {
      schema.type = [...normalized, "null"];
    } else {
      schema.type = normalized;
    }
    return;
  }
  schema.type = ["null"];
}

function toOpenAiReasoningEffort(
  effort: OpenAiReasoningEffort,
): OpenAiReasoningEffortParam {
  switch (effort) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "xhigh":
      return "high";
  }
}

function isOpenAiCodexModel(modelId: LlmTextModelId): boolean {
  return modelId.includes("codex");
}

function resolveOpenAiReasoningEffortForModel(
  modelId: LlmTextModelId,
  override?: OpenAiReasoningEffort,
): OpenAiReasoningEffort {
  if (override) {
    return override;
  }
  if (isOpenAiCodexModel(modelId)) {
    return "medium";
  }
  return DEFAULT_OPENAI_REASONING_EFFORT;
}

function resolveOpenAiVerbosity(
  modelId: LlmTextModelId,
): ResponseTextConfig["verbosity"] {
  if (isOpenAiCodexModel(modelId)) {
    return "medium";
  }
  return "high";
}

function orderedJsonSchemaKeys(
  properties: Record<string, unknown>,
  ordering: readonly string[] | undefined,
): string[] {
  const keys = Object.keys(properties);
  if (!ordering || ordering.length === 0) {
    return keys;
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const key of ordering) {
    if (Object.prototype.hasOwnProperty.call(properties, key)) {
      ordered.push(key);
      seen.add(key);
    }
  }
  for (const key of keys) {
    if (!seen.has(key)) {
      ordered.push(key);
    }
  }
  return ordered;
}

function addGeminiPropertyOrdering(schema: JsonSchema): JsonSchema {
  if (!isPlainRecord(schema)) {
    return schema;
  }
  if (typeof schema.$ref === "string") {
    return { $ref: schema.$ref };
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      continue;
    }
    if (key === "items") {
      output.items = isPlainRecord(value)
        ? addGeminiPropertyOrdering(value as JsonSchema)
        : value;
      continue;
    }
    if (key === "anyOf" || key === "oneOf") {
      output[key] = Array.isArray(value)
        ? value.map((entry) => addGeminiPropertyOrdering(entry as JsonSchema))
        : value;
      continue;
    }
    if (key === "$defs" && isPlainRecord(value)) {
      const defs: Record<string, unknown> = {};
      for (const [defKey, defValue] of Object.entries(value)) {
        if (isPlainRecord(defValue)) {
          defs[defKey] = addGeminiPropertyOrdering(defValue as JsonSchema);
        }
      }
      output.$defs = defs;
      continue;
    }
    output[key] = value;
  }
  const propertiesRaw = schema.properties;
  if (isPlainRecord(propertiesRaw)) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(propertiesRaw)) {
      properties[key] = isPlainRecord(value)
        ? addGeminiPropertyOrdering(value as JsonSchema)
        : value;
    }
    output.properties = properties;
    output.propertyOrdering = Object.keys(properties);
  }
  if (schema.nullable) {
    applyNullableJsonSchema(output);
  }
  return output;
}

function normalizeOpenAiSchema(schema: JsonSchema): JsonSchema {
  if (!isPlainRecord(schema)) {
    return schema;
  }
  if (typeof schema.$ref === "string") {
    return { $ref: schema.$ref };
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties") {
      continue;
    }
    if (key === "required") {
      continue;
    }
    if (key === "additionalProperties") {
      continue;
    }
    if (key === "propertyOrdering") {
      continue;
    }
    if (key === "items") {
      if (isPlainRecord(value)) {
        output.items = normalizeOpenAiSchema(value);
      }
      continue;
    }
    if (key === "anyOf" || key === "oneOf") {
      if (Array.isArray(value)) {
        output.anyOf = value.map((entry) =>
          normalizeOpenAiSchema(entry as JsonSchema),
        );
      }
      continue;
    }
    if (key === "$defs" && isPlainRecord(value)) {
      const defs: Record<string, unknown> = {};
      for (const [defKey, defValue] of Object.entries(value)) {
        if (isPlainRecord(defValue)) {
          defs[defKey] = normalizeOpenAiSchema(defValue);
        }
      }
      output.$defs = defs;
      continue;
    }
    output[key] = value;
  }

  const propertiesRaw = schema.properties;
  if (isPlainRecord(propertiesRaw)) {
    const ordering = Array.isArray(schema.propertyOrdering)
      ? schema.propertyOrdering
      : undefined;
    const orderedKeys = orderedJsonSchemaKeys(propertiesRaw, ordering);
    const properties: Record<string, unknown> = {};
    for (const key of orderedKeys) {
      const value = propertiesRaw[key];
      if (!isPlainRecord(value)) {
        properties[key] = value;
        continue;
      }
      properties[key] = normalizeOpenAiSchema(value as JsonSchema);
    }
    output.properties = properties;
    output.required = orderedKeys;
    output.additionalProperties = false;
  }

  const schemaType = schema.type;
  if (
    output.additionalProperties === undefined &&
    (schemaType === "object" ||
      (Array.isArray(schemaType) && schemaType.includes("object")))
  ) {
    output.additionalProperties = false;
    if (!Array.isArray(output.required)) {
      output.required = [];
    }
  }

  const normalizeExclusiveBound = (options: {
    exclusiveKey: "exclusiveMinimum" | "exclusiveMaximum";
    inclusiveKey: "minimum" | "maximum";
  }): void => {
    const exclusiveValue = output[options.exclusiveKey];
    if (exclusiveValue === false) {
      delete output[options.exclusiveKey];
      return;
    }
    const inclusiveValue = output[options.inclusiveKey];
    if (exclusiveValue === true) {
      if (
        typeof inclusiveValue === "number" &&
        Number.isFinite(inclusiveValue)
      ) {
        output[options.exclusiveKey] = inclusiveValue;
        delete output[options.inclusiveKey];
      } else {
        delete output[options.exclusiveKey];
      }
      return;
    }
    if (typeof exclusiveValue === "number" && Number.isFinite(exclusiveValue)) {
      delete output[options.inclusiveKey];
    }
  };

  normalizeExclusiveBound({
    exclusiveKey: "exclusiveMinimum",
    inclusiveKey: "minimum",
  });
  normalizeExclusiveBound({
    exclusiveKey: "exclusiveMaximum",
    inclusiveKey: "maximum",
  });

  return output;
}

function resolveOpenAiSchemaRoot(schema: JsonSchema): JsonSchema {
  if (!isPlainRecord(schema)) {
    return schema;
  }
  if (typeof schema.$ref !== "string") {
    return schema;
  }
  const refMatch = /^#\/(definitions|[$]defs)\/(.+)$/u.exec(schema.$ref);
  if (!refMatch) {
    return schema;
  }
  const [, section, key] = refMatch;
  const defsSource =
    section === "definitions" ? schema.definitions : schema.$defs;
  if (!isPlainRecord(defsSource)) {
    return schema;
  }
  const resolved = defsSource[key];
  if (!isPlainRecord(resolved)) {
    return schema;
  }
  return { ...resolved };
}

function isJsonSchemaObject(schema: JsonSchema | undefined): boolean {
  if (!schema || !isPlainRecord(schema)) {
    return false;
  }
  const type = schema.type;
  if (type === "object") {
    return true;
  }
  if (Array.isArray(type) && type.includes("object")) {
    return true;
  }
  if (isPlainRecord(schema.properties)) {
    return true;
  }
  return false;
}

export function toGeminiJsonSchema(
  schema: z.ZodType,
  options?: { name?: string },
): JsonSchema {
  const jsonSchema = zodToJsonSchema(schema, {
    name: options?.name,
    target: "jsonSchema7",
  }) as JsonSchema;
  return addGeminiPropertyOrdering(resolveOpenAiSchemaRoot(jsonSchema));
}

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

type OpenAiInputRole = EasyInputMessage["role"];
type OpenAiInputPart = ResponseInputContent;

const OPENAI_ROLE_FROM_LLM: Record<LlmRole, OpenAiInputRole> = {
  user: "user",
  model: "assistant",
  system: "system",
  tool: "assistant",
};

const OPENAI_ROLE_TO_LLM: Record<OpenAiInputRole, LlmRole> = {
  user: "user",
  assistant: "model",
  system: "system",
  developer: "system",
};

function isOpenAiInputRole(value: unknown): value is OpenAiInputRole {
  return (
    value === "user" ||
    value === "assistant" ||
    value === "system" ||
    value === "developer"
  );
}

function toOpenAiRole(role: LlmRole): OpenAiInputRole {
  return OPENAI_ROLE_FROM_LLM[role];
}

function toOpenAiInput(contents: readonly LlmContent[]): ResponseInput {
  return contents.map((content) => {
    const parts: OpenAiInputPart[] = [];
    for (const part of content.parts) {
      if (part.type === "text") {
        parts.push({ type: "input_text", text: part.text });
        continue;
      }
      const mimeType = part.mimeType ?? "application/octet-stream";
      const dataUrl = `data:${mimeType};base64,${part.data}`;
      parts.push({ type: "input_image", image_url: dataUrl, detail: "auto" });
    }
    if (
      parts.length === 1 &&
      parts[0]?.type === "input_text" &&
      typeof parts[0].text === "string"
    ) {
      return {
        role: toOpenAiRole(content.role),
        content: parts[0].text,
      };
    }
    return {
      role: toOpenAiRole(content.role),
      content: parts,
    };
  });
}

function fromOpenAiRole(role: OpenAiInputRole): LlmRole {
  return OPENAI_ROLE_TO_LLM[role];
}

function openAiInputToDebugContents(input: ResponseInput): LlmContent[] {
  const contents: LlmContent[] = [];
  for (const item of input) {
    if (!isPlainRecord(item)) {
      continue;
    }
    if ("role" in item && isOpenAiInputRole(item.role)) {
      const role = fromOpenAiRole(item.role);
      const parts: LlmContentPart[] = [];
      const content = item.content;
      if (typeof content === "string") {
        parts.push({ type: "text", text: content });
      } else if (Array.isArray(content)) {
        for (const entry of content) {
          if (!isPlainRecord(entry)) {
            continue;
          }
          const entryType = entry.type;
          if (entryType === "input_text") {
            const text = entry.text;
            if (typeof text === "string" && text.length > 0) {
              parts.push({ type: "text", text });
            }
            continue;
          }
          if (entryType === "input_image") {
            const imageUrl = entry.image_url;
            let urlValue: string | undefined;
            if (typeof imageUrl === "string") {
              urlValue = imageUrl;
            } else if (
              isPlainRecord(imageUrl) &&
              typeof imageUrl.url === "string"
            ) {
              urlValue = imageUrl.url;
            }
            if (typeof urlValue === "string") {
              const match = /^data:([^;]+);base64,(.*)$/.exec(urlValue);
              if (match && match[1] && match[2]) {
                parts.push({
                  type: "inlineData",
                  mimeType: match[1],
                  data: match[2],
                });
              } else {
                parts.push({
                  type: "text",
                  text: `[image] ${urlValue}`,
                });
              }
            }
          }
        }
      }
      if (parts.length === 0) {
        parts.push({ type: "text", text: "(empty content)" });
      }
      contents.push({ role, parts });
      continue;
    }
    const itemType = item.type;
    if (itemType === "function_call_output") {
      const callId =
        typeof item.call_id === "string" ? item.call_id : "unknown";
      const output = item.output;
      const outputText =
        typeof output === "string"
          ? output
          : JSON.stringify(output ?? null, null, 2);
      contents.push({
        role: "tool",
        parts: [
          {
            type: "text",
            text: `function_call_output (${callId}):\n${outputText ?? ""}`,
          },
        ],
      });
      continue;
    }
    contents.push({
      role: "tool",
      parts: [
        {
          type: "text",
          text: JSON.stringify(item, null, 2),
        },
      ],
    });
  }
  if (contents.length === 0) {
    contents.push({
      role: "user",
      parts: [{ type: "text", text: "(empty input)" }],
    });
  }
  return contents;
}

type ChatGptInputBundle = {
  readonly instructions?: string;
  readonly input: ChatGptInputItem[];
};

const DEFAULT_CHATGPT_INSTRUCTIONS = "You are a helpful assistant.";

function toChatGptInput(contents: readonly LlmContent[]): ChatGptInputBundle {
  const instructionsParts: string[] = [];
  const input: ChatGptInputItem[] = [];
  for (const content of contents) {
    if (content.role === "system") {
      for (const part of content.parts) {
        if (part.type === "text") {
          instructionsParts.push(part.text);
        }
      }
      continue;
    }
    const isAssistant = content.role === "model";
    const parts: ChatGptInputMessagePart[] = [];
    for (const part of content.parts) {
      if (part.type === "text") {
        parts.push({
          type: isAssistant ? "output_text" : "input_text",
          text: part.text,
        });
        continue;
      }
      const mimeType = part.mimeType ?? "application/octet-stream";
      const dataUrl = `data:${mimeType};base64,${part.data}`;
      if (isAssistant) {
        parts.push({
          type: "output_text",
          text: `[image:${mimeType}]`,
        });
      } else {
        parts.push({
          type: "input_image",
          image_url: dataUrl,
          detail: "auto",
        });
      }
    }
    if (parts.length === 0) {
      parts.push({
        type: isAssistant ? "output_text" : "input_text",
        text: "(empty content)",
      });
    }
    if (isAssistant) {
      input.push({
        type: "message",
        role: "assistant",
        status: "completed",
        content: parts,
      });
    } else {
      input.push({
        role: "user",
        content: parts,
      });
    }
  }
  const instructions = instructionsParts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n\n");
  return {
    instructions: instructions.length > 0 ? instructions : undefined,
    input,
  };
}

function chatGptInputToDebugContents(
  input: readonly ChatGptInputItem[],
): LlmContent[] {
  const contents: LlmContent[] = [];
  for (const item of input) {
    if ("type" in item && item.type === "function_call_output") {
      const output =
        typeof item.output === "string"
          ? item.output
          : JSON.stringify(item.output ?? null, null, 2);
      contents.push({
        role: "tool",
        parts: [
          {
            type: "text",
            text: `function_call_output (${item.call_id}):\n${output}`,
          },
        ],
      });
      continue;
    }
    if ("type" in item && item.type === "function_call") {
      contents.push({
        role: "model",
        parts: [
          {
            type: "text",
            text: `function_call ${item.name}(${item.arguments})`,
          },
        ],
      });
      continue;
    }
    if ("role" in item) {
      const role: LlmRole = item.role === "assistant" ? "model" : "user";
      const parts: LlmContentPart[] = [];
      const content = item.content;
      if (typeof content === "string") {
        parts.push({ type: "text", text: content });
      } else if (Array.isArray(content)) {
        for (const entry of content) {
          if (!isPlainRecord(entry)) {
            continue;
          }
          if (entry.type === "input_text" || entry.type === "output_text") {
            if (typeof entry.text === "string") {
              parts.push({ type: "text", text: entry.text });
            }
            continue;
          }
          if (entry.type === "input_image") {
            const imageUrl = entry.image_url;
            const urlValue =
              typeof imageUrl === "string"
                ? imageUrl
                : isPlainRecord(imageUrl) && typeof imageUrl.url === "string"
                  ? imageUrl.url
                  : undefined;
            if (typeof urlValue === "string") {
              const match = /^data:([^;]+);base64,(.*)$/.exec(urlValue);
              if (match && match[1] && match[2]) {
                parts.push({
                  type: "inlineData",
                  mimeType: match[1],
                  data: match[2],
                });
              } else {
                parts.push({
                  type: "text",
                  text: `[image] ${urlValue}`,
                });
              }
            }
          }
        }
      }
      if (parts.length === 0) {
        parts.push({ type: "text", text: "(empty content)" });
      }
      contents.push({ role, parts });
    }
  }
  return contents;
}

function normalizeChatGptToolIds({
  callId,
  itemId,
}: {
  callId?: string;
  itemId?: string;
}): { callId: string; itemId: string } {
  let rawCallId = callId ?? "";
  let rawItemId = itemId ?? "";
  if (rawCallId.includes("|")) {
    const [nextCallId, nextItemId] = rawCallId.split("|");
    rawCallId = nextCallId ?? rawCallId;
    if (nextItemId) {
      rawItemId = nextItemId;
    }
  } else if (rawItemId.includes("|")) {
    const [nextCallId, nextItemId] = rawItemId.split("|");
    rawCallId = nextCallId ?? rawCallId;
    rawItemId = nextItemId ?? rawItemId;
  }
  const callValue = sanitizeChatGptToolId(
    rawCallId || rawItemId || randomBytes(8).toString("hex"),
  );
  let itemValue = sanitizeChatGptToolId(rawItemId || `fc-${callValue}`);
  if (!itemValue.startsWith("fc")) {
    itemValue = `fc-${itemValue}`;
  }
  return { callId: callValue, itemId: itemValue };
}

function sanitizeChatGptToolId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/gu, "");
  if (cleaned.length === 0) {
    return randomBytes(8).toString("hex");
  }
  return cleaned.slice(0, 64);
}

function extractOpenAiResponseParts(response: {
  output?: unknown;
  output_text?: unknown;
}): { parts: LlmContentPart[]; blocked: boolean } {
  const parts: LlmContentPart[] = [];
  let blocked = false;
  const output = response.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const itemType = (item as { type?: unknown }).type;
      if (itemType === "message") {
        const content = (item as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const entry of content) {
            if (!entry || typeof entry !== "object") {
              continue;
            }
            const entryType = (entry as { type?: unknown }).type;
            if (entryType === "output_text") {
              const text = (entry as { text?: unknown }).text;
              if (typeof text === "string" && text.length > 0) {
                parts.push({ type: "text", text });
              }
            } else if (entryType === "refusal") {
              blocked = true;
            }
          }
        }
      } else if (itemType === "reasoning") {
        const content = (item as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const entry of content) {
            if (!entry || typeof entry !== "object") {
              continue;
            }
            const entryType = (entry as { type?: unknown }).type;
            if (
              entryType === "reasoning_summary_text" ||
              entryType === "reasoning_summary"
            ) {
              const entryText =
                typeof (entry as { text?: unknown }).text === "string"
                  ? (entry as { text?: unknown }).text
                  : typeof (entry as { summary?: unknown }).summary === "string"
                    ? (entry as { summary?: unknown }).summary
                    : undefined;
              if (typeof entryText === "string" && entryText.length > 0) {
                parts.push({ type: "text", text: entryText, thought: true });
              }
            }
          }
        }
      } else if (
        itemType === "function_call" ||
        itemType === "tool_call" ||
        itemType === "custom_tool_call"
      ) {
        const serialized = JSON.stringify(item, null, 2);
        if (serialized.length > 0) {
          parts.push({
            type: "text",
            text: `[tool-call]\n${serialized}\n`,
          });
        }
      }
    }
  }
  if (parts.length === 0) {
    const outputText = response.output_text;
    if (typeof outputText === "string" && outputText.length > 0) {
      parts.push({ type: "text", text: outputText });
    }
  }
  return { parts, blocked };
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

function extractSnapshotText(content: LlmContent | undefined): string {
  if (!content) {
    return "";
  }
  const segments: string[] = [];
  for (const part of content.parts) {
    if (part.type !== "text") {
      continue;
    }
    const prefix = part.thought === true ? "[thought] " : "";
    segments.push(`${prefix}${part.text}`);
  }
  return segments.join("\n\n").trim();
}

function normalizeJsonText(rawText: string): string {
  let text = rawText.trim();

  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
    text = text.replace(/```(?:\s*)?$/, "").trim();
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  if (!text.startsWith("{") && !text.startsWith("[")) {
    const firstBrace = text.indexOf("{");
    if (firstBrace !== -1) {
      const lastBrace = text.lastIndexOf("}");
      if (lastBrace !== -1 && lastBrace > firstBrace) {
        text = text.slice(firstBrace, lastBrace + 1).trim();
      }
    }
  }

  return text;
}

function escapeNewlinesInStrings(jsonText: string): string {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonText.length; i += 1) {
    const char = jsonText[i] ?? "";
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === '"') {
        output += char;
        inString = false;
        continue;
      }
      if (char === "\n") {
        output += "\\n";
        continue;
      }
      if (char === "\r") {
        output += "\\r";
        continue;
      }
      output += char;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    output += char;
  }
  return output;
}

export function parseJsonFromLlmText(rawText: string): unknown {
  const cleanedText = normalizeJsonText(rawText);
  const repairedText = escapeNewlinesInStrings(cleanedText);
  return JSON.parse(repairedText);
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

type PromptStats = {
  textChars: number;
  imageCount: number;
  imageBytes: number;
};

function summarisePromptStats(contents: readonly LlmContent[]): PromptStats {
  let textChars = 0;
  let imageCount = 0;
  let imageBytes = 0;
  for (const content of contents) {
    for (const part of content.parts) {
      if (part.type === "text") {
        textChars += part.text.length;
        continue;
      }
      imageCount += 1;
      imageBytes += estimateInlineBytes(part.data);
    }
  }
  return {
    textChars,
    imageCount,
    imageBytes,
  };
}

export type LlmCallBaseOptions = {
  readonly modelId: LlmModelId;
  readonly contents: readonly LlmContent[];
  readonly progress?: JobProgressReporter;
  readonly debug?: LlmDebugOptions;
  readonly imageSize?: LlmImageSize;
  readonly openAiReasoningEffort?: OpenAiReasoningEffort;
};

type OpenAiTextFormat = ResponseTextConfig["format"];

export type LlmTextDelta = {
  readonly textDelta?: string;
  readonly thoughtDelta?: string;
};

export type LlmTextCallOptions = LlmCallBaseOptions & {
  readonly responseMimeType?: string;
  readonly responseJsonSchema?: JsonSchema;
  readonly tools?: readonly LlmToolConfig[];
  readonly openAiTextFormat?: OpenAiTextFormat;
  readonly onDelta?: (delta: LlmTextDelta) => void;
};

// Gemini does not support tool calls when responseJsonSchema/JSON mode is used, so tools are excluded here.
export type LlmJsonCallOptions<T> = Omit<
  LlmTextCallOptions,
  "responseJsonSchema" | "tools"
> & {
  readonly schema: z.ZodType<T>;
  readonly responseJsonSchema?: JsonSchema;
  readonly openAiSchemaName?: string;
  readonly maxAttempts?: number;
  readonly maxRetries?: number;
  readonly normalizeJson?: (value: unknown) => unknown;
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
  readonly imageSize?: LlmImageSize;
  readonly imageGradingPrompt: string;
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

export type LlmWebSearchMode = "cached" | "live";

export type LlmToolConfig =
  | { readonly type: "web-search"; readonly mode?: LlmWebSearchMode }
  | { readonly type: "code-execution" };

export type LlmExecutableTool<Schema extends z.ZodType, Output> = {
  readonly description?: string;
  readonly inputSchema: Schema;
  readonly execute: (input: z.output<Schema>) => Promise<Output> | Output;
};

export type LlmToolSet = Record<string, LlmExecutableTool<z.ZodType, unknown>>;

export function tool<Schema extends z.ZodType, Output>(options: {
  readonly description?: string;
  readonly inputSchema: Schema;
  readonly execute: (input: z.output<Schema>) => Promise<Output> | Output;
}): LlmExecutableTool<Schema, Output> {
  return options;
}

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
    startModelCall: (details) => {
      void details;
      return Symbol("model-call");
    },
    recordModelUsage: () => {},
    finishModelCall: () => {},
    startStage: () => Symbol("stage"),
    finishStage: () => {},
    setActiveStages: () => {},
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
      const sharp = getSharp();
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
        sharedMediaDir !== undefined ? sharedMediaDir : path.join(dir, "media");
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
      case "code-execution":
        return { codeExecution: {} };
      default:
        throw new Error("Unsupported tool configuration");
    }
  });
}

function toOpenAiTools(
  tools: readonly LlmToolConfig[] | undefined,
): OpenAiTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => {
    const openAiTool: OpenAiTool = (() => {
      switch (tool.type) {
        case "web-search": {
          // ChatGPT / Responses API accepts `external_web_access` to control whether
          // the search uses live internet access (true) or cached-only (false).
          const external_web_access = tool.mode !== "cached";
          return {
            type: "web_search",
            external_web_access,
          } as unknown as OpenAiTool;
        }
        case "code-execution": {
          return { type: "code_interpreter", container: { type: "auto" } };
        }
      }
    })();
    return openAiTool;
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
  const segments = [debug.rootDir, "stages", stageSegment];
  if (debug.subStage) {
    segments.push(normalisePathSegment(debug.subStage));
  }
  segments.push(
    normalisePathSegment(
      `attempt-${String(attempt).padStart(2, "0")}-of-${String(maxAttempts).padStart(2, "0")}`,
    ),
  );
  const basePath = path.join(...segments);
  const usageCount = debugDirUsageCounts.get(basePath) ?? 0;
  const nextCount = usageCount + 1;
  debugDirUsageCounts.set(basePath, nextCount);
  if (nextCount === 1) {
    return basePath;
  }
  return `${basePath}-run-${String(nextCount).padStart(2, "0")}`;
}

function resolveDebugLogDir(baseDir: string): string {
  const usageCount = debugLogDirUsageCounts.get(baseDir) ?? 0;
  const nextCount = usageCount + 1;
  debugLogDirUsageCounts.set(baseDir, nextCount);
  if (nextCount === 1) {
    return baseDir;
  }
  return `${baseDir}-run-${String(nextCount).padStart(2, "0")}`;
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
  configLabel = "LLM Request",
}: {
  modelId: LlmModelId;
  stageLabel: string;
  attempt: number;
  maxAttempts: number;
  uploadBytes: number;
  config: unknown;
  configLabel?: string;
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
  lines.push("", `${configLabel}:`, configSummary ?? "{}");
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
  grounding,
}: {
  pathname: string;
  summary?: readonly string[];
  text: string;
  contents?: readonly LlmContent[];
  grounding?: GroundingMetadata | undefined;
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
  if (grounding) {
    sections.push("===== Grounding =====");
    sections.push(JSON.stringify(grounding, null, 2), "");
  }
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, sections.join("\n"), { encoding: "utf8" });
}

class IncrementalResponseSnapshotWriter {
  private readonly paths: readonly string[];
  private readonly flushThreshold: number;
  private buffer = "";
  private lastThought: boolean | undefined;
  private pending: Promise<void> = Promise.resolve();
  private started = false;

  constructor(paths: readonly string[], flushThreshold = 200) {
    this.paths = paths;
    this.flushThreshold = flushThreshold;
  }

  async start(summary: readonly string[]): Promise<void> {
    if (this.paths.length === 0) {
      return;
    }
    const headerLines = [...summary, "===== Response =====", ""];
    const header = headerLines.join("\n");
    await Promise.all(
      this.paths.map(async (pathname) => {
        await mkdir(path.dirname(pathname), { recursive: true });
        await writeFile(pathname, header, { encoding: "utf8" });
      }),
    );
    this.started = true;
  }

  appendText(text: string, { isThought }: { isThought: boolean }): void {
    if (!this.started || this.paths.length === 0 || text.length === 0) {
      return;
    }
    const needsSeparator =
      this.lastThought !== undefined && this.lastThought !== isThought;
    if (needsSeparator) {
      this.buffer += "\n\n";
    }
    const needsPrefix = isThought && this.lastThought !== true;
    if (needsPrefix) {
      this.buffer += "[thought] ";
    }
    this.buffer += text;
    this.lastThought = isThought;
    if (this.buffer.length >= this.flushThreshold) {
      this.queueFlush();
    }
  }

  flush(): void {
    this.queueFlush();
  }

  async complete(): Promise<void> {
    if (this.buffer.length > 0) {
      this.queueFlush();
    }
    await this.pending;
  }

  private queueFlush(): void {
    if (this.buffer.length === 0 || this.paths.length === 0) {
      return;
    }
    const chunk = this.buffer;
    this.buffer = "";
    this.pending = this.pending.then(async () => {
      await Promise.all(
        this.paths.map(async (pathname) => {
          await appendFile(pathname, chunk, { encoding: "utf8" });
        }),
      );
    });
  }
}

type ResponseSnapshotStats = {
  readonly responseTextChars: number;
  readonly responseImages: number;
  readonly responseImageBytes: number;
  readonly thinkingChars: number;
};

function summariseResponseStats(
  content: LlmContent | undefined,
): ResponseSnapshotStats {
  let responseTextChars = 0;
  let responseImages = 0;
  let responseImageBytes = 0;
  let thinkingChars = 0;
  if (!content) {
    return {
      responseTextChars,
      responseImages,
      responseImageBytes,
      thinkingChars,
    };
  }
  for (const part of content.parts) {
    if (part.type === "text") {
      if (part.thought === true) {
        thinkingChars += part.text.length;
      } else {
        responseTextChars += part.text.length;
      }
      continue;
    }
    responseImages += 1;
    responseImageBytes += estimateInlineBytes(part.data);
  }
  return {
    responseTextChars,
    responseImages,
    responseImageBytes,
    thinkingChars,
  };
}

function formatOptionalNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toLocaleString("en-US");
}

function formatCurrencyUsd(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: safeValue < 1 ? 4 : 2,
    maximumFractionDigits: safeValue < 1 ? 4 : 2,
  }).format(safeValue);
}

function buildTokenSummaryLine(usage: LlmUsageTokenUpdate | undefined): string {
  if (!usage) {
    return "Tokens: n/a";
  }
  return [
    "Tokens:",
    `prompt=${formatOptionalNumber(usage.promptTokens)}`,
    `cached=${formatOptionalNumber(usage.cachedTokens)}`,
    `response=${formatOptionalNumber(usage.responseTokens)}`,
    `response_images=${formatOptionalNumber(usage.responseImageTokens)}`,
    `thinking=${formatOptionalNumber(usage.thinkingTokens)}`,
    `tool_use_prompt=${formatOptionalNumber(usage.toolUsePromptTokens)}`,
    `total=${formatOptionalNumber(usage.totalTokens)}`,
  ].join(" ");
}

function buildPromptMediaSummaryLine({
  promptStats,
  uploadBytes,
}: {
  promptStats: PromptStats;
  uploadBytes: number;
}): string {
  return [
    "Input:",
    `text_chars=${formatOptionalNumber(promptStats.textChars)}`,
    `images=${formatOptionalNumber(promptStats.imageCount)}`,
    `image_bytes=${formatOptionalNumber(promptStats.imageBytes)}`,
    `upload_bytes=${formatOptionalNumber(uploadBytes)}`,
  ].join(" ");
}

function buildResponseMediaSummaryLine(stats: ResponseSnapshotStats): string {
  return [
    "Output:",
    `text_chars=${formatOptionalNumber(stats.responseTextChars)}`,
    `thinking_chars=${formatOptionalNumber(stats.thinkingChars)}`,
    `images=${formatOptionalNumber(stats.responseImages)}`,
    `image_bytes=${formatOptionalNumber(stats.responseImageBytes)}`,
  ].join(" ");
}

function resolveUsageNumber(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return 0;
}

export function estimateCallCostUsd({
  modelId,
  tokens,
  responseImages,
  imageSize,
}: {
  modelId: string;
  tokens: LlmUsageTokenUpdate | undefined;
  responseImages: number;
  imageSize?: string;
}): number {
  if (!tokens) {
    return 0;
  }
  const promptTokens = resolveUsageNumber(tokens.promptTokens);
  const cachedTokens = resolveUsageNumber(tokens.cachedTokens);
  const responseTokens = resolveUsageNumber(tokens.responseTokens);
  const responseImageTokens = resolveUsageNumber(tokens.responseImageTokens);
  const thinkingTokens = resolveUsageNumber(tokens.thinkingTokens);
  const toolUsePromptTokens = resolveUsageNumber(tokens.toolUsePromptTokens);
  const promptTokenTotal = promptTokens + toolUsePromptTokens;
  const nonCachedPrompt = Math.max(0, promptTokenTotal - cachedTokens);
  const imagePreviewPricing = getGeminiImagePreviewPricing(modelId);
  if (imagePreviewPricing) {
    const resolvedImageSize =
      imageSize && imagePreviewPricing.imagePrices[imageSize]
        ? imageSize
        : "2K";
    const imageRate = imagePreviewPricing.imagePrices[resolvedImageSize];
    const tokensPerImage =
      imagePreviewPricing.outputImageRate > 0
        ? imageRate / imagePreviewPricing.outputImageRate
        : 0;
    let responseTextForPricing = Math.max(
      0,
      responseTokens - responseImageTokens,
    );
    let imageTokensForPricing = responseImageTokens;
    if (
      imageTokensForPricing <= 0 &&
      responseImages > 0 &&
      tokensPerImage > 0
    ) {
      const estimatedImageTokens = responseImages * tokensPerImage;
      imageTokensForPricing = estimatedImageTokens;
      if (responseTextForPricing >= estimatedImageTokens) {
        responseTextForPricing -= estimatedImageTokens;
      }
    }
    const textOutputCost =
      (responseTextForPricing + thinkingTokens) *
      imagePreviewPricing.outputTextRate;
    const inputCost = nonCachedPrompt * imagePreviewPricing.inputRate;
    const cachedCost = cachedTokens * imagePreviewPricing.cachedRate;
    const imageOutputCost =
      imageTokensForPricing * imagePreviewPricing.outputImageRate;
    return inputCost + cachedCost + textOutputCost + imageOutputCost;
  }
  const geminiPricing = getGeminiProPreviewPricing(modelId);
  if (geminiPricing) {
    const useHighTier = promptTokenTotal > geminiPricing.threshold;
    const inputRate = useHighTier
      ? geminiPricing.inputRateHigh
      : geminiPricing.inputRateLow;
    const cachedRate = useHighTier
      ? geminiPricing.cachedRateHigh
      : geminiPricing.cachedRateLow;
    const outputRate = useHighTier
      ? geminiPricing.outputRateHigh
      : geminiPricing.outputRateLow;
    const inputCost = nonCachedPrompt * inputRate;
    const cachedCost = cachedTokens * cachedRate;
    const outputTokens = responseTokens + thinkingTokens;
    const outputCost = outputTokens * outputRate;
    return inputCost + cachedCost + outputCost;
  }
  const openAiPricing = getOpenAiPricing(modelId);
  if (openAiPricing) {
    const inputCost = nonCachedPrompt * openAiPricing.inputRate;
    const cachedCost = cachedTokens * openAiPricing.cachedRate;
    const outputTokens = responseTokens + thinkingTokens;
    const outputCost = outputTokens * openAiPricing.outputRate;
    return inputCost + cachedCost + outputCost;
  }
  return 0;
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

async function writeToolLoopDebugSnapshot(params: {
  debug: LlmDebugOptions | undefined;
  modelId: OpenAiModelId;
  step: number;
  maxSteps: number;
  input: ResponseInput;
  debugPromptContents?: readonly LlmContent[];
  response: OpenAiResponse;
  elapsedMs: number;
  requestConfig: unknown;
}): Promise<void> {
  const {
    debug,
    modelId,
    step,
    maxSteps,
    input,
    debugPromptContents,
    response,
    elapsedMs,
    requestConfig,
  } = params;
  if (!debug || !debug.rootDir || debug.enabled === false) {
    return;
  }
  const stepLabel = `tool-loop-step-${String(step).padStart(2, "0")}`;
  const stepDebug = appendDebugSubStage(debug, stepLabel);
  const stage = buildCallStage({
    modelId,
    debug: stepDebug,
    attempt: step,
    maxAttempts: maxSteps,
  });
  const debugRootDir = debug.rootDir;
  const debugLogSegment = normalisePathSegment(
    new Date().toISOString().replace(/[:]/g, "-"),
  );
  const debugLogDir = path.join(
    debugRootDir,
    "log",
    debugLogSegment,
    normalisePathSegment(stepLabel),
  );
  const debugOutputDirs = Array.from(
    new Set(
      [stage.debugDir, debugLogDir].filter(
        (dir): dir is string => typeof dir === "string",
      ),
    ),
  );

  await resetDebugDir(stage.debugDir);
  await ensureDebugDir(stage.debugDir);
  await ensureDebugDir(debugLogDir);

  const promptContents =
    debugPromptContents ?? openAiInputToDebugContents(input);
  const promptStats = summarisePromptStats(promptContents);
  const uploadBytes = estimateContentsUploadBytes(promptContents);

  if (debugOutputDirs.length > 0) {
    const requestSnapshot = buildRequestSnapshot({
      modelId,
      stageLabel: stage.label,
      attempt: step,
      maxAttempts: maxSteps,
      uploadBytes,
      config: requestConfig,
      configLabel: "OpenAI Request",
    });
    await writeDebugTextFile({
      dirs: debugOutputDirs,
      filename: "request.txt",
      contents: requestSnapshot,
    });
  }

  if (stage.debugDir) {
    await writePromptSnapshot(
      path.join(stage.debugDir, "prompt.txt"),
      promptContents,
    );
  }
  if (debugLogDir) {
    await writePromptSnapshot(
      path.join(debugLogDir, "prompt.txt"),
      promptContents,
    );
  }

  const responseParts = extractOpenAiResponseParts(response).parts;
  const mergedParts = mergeConsecutiveTextParts(responseParts);
  const responseContent: LlmContent | undefined =
    mergedParts.length > 0
      ? {
          role: "model",
          parts: mergedParts,
        }
      : undefined;

  const responseStats = summariseResponseStats(responseContent);
  const usageTokens = extractOpenAiUsageTokens(response.usage);
  const resolvedModel = response.model ?? modelId;
  const costUsd = estimateCallCostUsd({
    modelId: resolvedModel,
    tokens: usageTokens,
    responseImages: responseStats.responseImages,
  });
  const snapshotSummary: readonly string[] = [
    `Model: ${resolvedModel}`,
    `Elapsed: ${formatMillis(elapsedMs)}`,
    buildTokenSummaryLine(usageTokens),
    buildPromptMediaSummaryLine({ promptStats, uploadBytes }),
    buildResponseMediaSummaryLine(responseStats),
    `Estimated cost: ${usageTokens ? formatCurrencyUsd(costUsd) : "n/a"}`,
  ];
  const snapshotContents = responseContent ? [responseContent] : undefined;
  const responseText = extractSnapshotText(responseContent);

  if (stage.debugDir) {
    await writeTextResponseSnapshot({
      pathname: path.join(stage.debugDir, "response.txt"),
      summary: snapshotSummary,
      text: responseText,
      contents: snapshotContents,
    });
  }
  if (debugLogDir) {
    await writeTextResponseSnapshot({
      pathname: path.join(debugLogDir, "response.txt"),
      summary: snapshotSummary,
      text: responseText,
      contents: snapshotContents,
    });
  }

  if (debugOutputDirs.length > 0) {
    const conversationHtml = buildConversationHtml({
      promptContents,
      responseContent,
    });
    await writeDebugTextFile({
      dirs: debugOutputDirs,
      filename: "conversation.html",
      contents: conversationHtml,
    });
  }
}

function toMaybeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function sumModalityTokenCounts(details: unknown, modality: string): number {
  if (!Array.isArray(details)) {
    return 0;
  }
  let total = 0;
  for (const entry of details) {
    const entryModality = (entry as { modality?: unknown }).modality;
    if (typeof entryModality !== "string") {
      continue;
    }
    if (entryModality.toUpperCase() !== modality.toUpperCase()) {
      continue;
    }
    const tokenCount = toMaybeNumber(
      (entry as { tokenCount?: unknown }).tokenCount,
    );
    if (tokenCount !== undefined && tokenCount > 0) {
      total += tokenCount;
    }
  }
  return total;
}

function mergeTokenUpdates(
  current: LlmUsageTokenUpdate | undefined,
  next: LlmUsageTokenUpdate | undefined,
): LlmUsageTokenUpdate | undefined {
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
    responseImageTokens:
      next.responseImageTokens ?? current.responseImageTokens,
    thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    toolUsePromptTokens:
      next.toolUsePromptTokens ?? current.toolUsePromptTokens,
  };
}

function extractUsageTokens(usage: unknown): LlmUsageTokenUpdate | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const promptTokens = toMaybeNumber(
    (usage as { promptTokenCount?: unknown }).promptTokenCount,
  );
  const cachedTokens = toMaybeNumber(
    (usage as { cachedContentTokenCount?: unknown }).cachedContentTokenCount,
  );
  const responseTokens = toMaybeNumber(
    (usage as { candidatesTokenCount?: unknown }).candidatesTokenCount ??
      (usage as { responseTokenCount?: unknown }).responseTokenCount,
  );
  const thinkingTokens = toMaybeNumber(
    (usage as { thoughtsTokenCount?: unknown }).thoughtsTokenCount,
  );
  const totalTokens = toMaybeNumber(
    (usage as { totalTokenCount?: unknown }).totalTokenCount,
  );
  const toolUsePromptTokens = toMaybeNumber(
    (usage as { toolUsePromptTokenCount?: unknown }).toolUsePromptTokenCount,
  );
  const responseDetails =
    (usage as { candidatesTokensDetails?: unknown }).candidatesTokensDetails ??
    (usage as { responseTokensDetails?: unknown }).responseTokensDetails;
  const responseImageTokens = sumModalityTokenCounts(responseDetails, "IMAGE");
  if (
    promptTokens === undefined &&
    cachedTokens === undefined &&
    responseTokens === undefined &&
    responseImageTokens === 0 &&
    thinkingTokens === undefined &&
    totalTokens === undefined &&
    toolUsePromptTokens === undefined
  ) {
    return undefined;
  }
  return {
    promptTokens,
    cachedTokens,
    responseTokens,
    responseImageTokens:
      responseImageTokens > 0 ? responseImageTokens : undefined,
    thinkingTokens,
    totalTokens,
    toolUsePromptTokens,
  };
}

function extractOpenAiUsageTokens(
  usage: ResponseUsage | undefined,
): LlmUsageTokenUpdate | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = toMaybeNumber(usage.input_tokens);
  const cachedTokens = toMaybeNumber(usage.input_tokens_details?.cached_tokens);
  const outputTokensRaw = toMaybeNumber(usage.output_tokens);
  const reasoningTokens = toMaybeNumber(
    usage.output_tokens_details?.reasoning_tokens,
  );
  const totalTokens = toMaybeNumber(usage.total_tokens);
  let responseTokens: number | undefined;
  if (outputTokensRaw !== undefined) {
    const adjusted = outputTokensRaw - (reasoningTokens ?? 0);
    responseTokens = adjusted >= 0 ? adjusted : 0;
  }
  if (
    promptTokens === undefined &&
    cachedTokens === undefined &&
    responseTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    promptTokens,
    cachedTokens,
    responseTokens,
    thinkingTokens: reasoningTokens,
    totalTokens,
  };
}

function extractChatGptUsageTokens(
  usage: { [key: string]: unknown } | undefined,
): LlmUsageTokenUpdate | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = toMaybeNumber(usage.input_tokens);
  const cachedTokens = toMaybeNumber(
    (usage.input_tokens_details as { cached_tokens?: unknown } | undefined)
      ?.cached_tokens,
  );
  const outputTokensRaw = toMaybeNumber(usage.output_tokens);
  const reasoningTokens = toMaybeNumber(
    (usage.output_tokens_details as { reasoning_tokens?: unknown } | undefined)
      ?.reasoning_tokens,
  );
  const totalTokens = toMaybeNumber(usage.total_tokens);
  let responseTokens: number | undefined;
  if (outputTokensRaw !== undefined) {
    const adjusted = outputTokensRaw - (reasoningTokens ?? 0);
    responseTokens = adjusted >= 0 ? adjusted : 0;
  }
  if (
    promptTokens === undefined &&
    cachedTokens === undefined &&
    responseTokens === undefined &&
    reasoningTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    promptTokens,
    cachedTokens,
    responseTokens,
    thinkingTokens: reasoningTokens,
    totalTokens,
  };
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
  readonly responseJsonSchema?: JsonSchema;
  readonly responseModalities?: readonly string[];
  readonly imageAspectRatio?: string;
  readonly imageSize?: LlmImageSize;
  readonly tools?: readonly LlmToolConfig[];
  readonly openAiTextFormat?: OpenAiTextFormat;
  readonly onDelta?: (delta: LlmTextDelta) => void;
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
  const debugLogDirBase =
    debugLogSegment !== undefined && debugRootDir !== undefined
      ? path.join(debugRootDir, "log", debugLogSegment)
      : undefined;
  const debugLogDir = debugLogDirBase ? resolveDebugLogDir(debugLogDirBase) : undefined;
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
  const openAiModelInfo = resolveOpenAiModelVariant(options.modelId);
  const openAiModelId = openAiModelInfo?.modelId;
  const openAiTextModelId = openAiModelInfo
    ? (options.modelId as LlmTextModelId)
    : undefined;
  const isChatGpt = openAiModelInfo?.provider === "chatgpt";
  const isOpenAi = openAiModelInfo?.provider === "api";
  const isGemini = openAiModelInfo === undefined;
  const effectiveImageSize =
    isGemini && options.modelId === "gemini-3-pro-image-preview"
      ? (options.imageSize ?? "2K")
      : isGemini
        ? options.imageSize
        : undefined;

  const responseSnapshotWriter = new IncrementalResponseSnapshotWriter(
    Array.from(
      new Set(
        [stage.debugDir, debugLogDir]
          .filter((dir): dir is string => typeof dir === "string")
          .map((dir) => path.join(dir, "response.txt")),
      ),
    ),
  );
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
    const openAiInput = isOpenAi ? toOpenAiInput(promptContents) : undefined;
    const openAiTools = isOpenAi ? toOpenAiTools(options.tools) : undefined;
    const chatGptInput = isChatGpt ? toChatGptInput(promptContents) : undefined;
    const chatGptTools = isChatGpt ? toOpenAiTools(options.tools) : undefined;
    const openAiReasoningEffort = openAiTextModelId
      ? resolveOpenAiReasoningEffortForModel(
          openAiTextModelId,
          options.openAiReasoningEffort,
        )
      : undefined;
    const openAiTextConfig: ResponseTextConfig | undefined = openAiTextModelId
      ? {
          format: options.openAiTextFormat ?? { type: "text" },
          verbosity: resolveOpenAiVerbosity(openAiTextModelId),
        }
      : undefined;
    const chatGptTextConfig =
      openAiTextConfig && openAiTextConfig.verbosity
        ? { verbosity: openAiTextConfig.verbosity }
        : undefined;
    const openAiReasoningPayload = openAiReasoningEffort
      ? {
          effort: toOpenAiReasoningEffort(openAiReasoningEffort),
          summary: "detailed" as const,
        }
      : undefined;
    const chatGptReasoningPayload = openAiReasoningEffort
      ? {
          effort: toOpenAiReasoningEffort(openAiReasoningEffort),
          summary: "detailed" as const,
        }
      : undefined;
    const openAiInclude: ResponseIncludable[] | undefined = isOpenAi
      ? ["code_interpreter_call.outputs", "reasoning.encrypted_content"]
      : undefined;
    const openAiRequestConfig = isOpenAi
      ? {
          reasoning: openAiReasoningPayload,
          ...(openAiTextConfig ? { text: openAiTextConfig } : {}),
          ...(openAiTools ? { tools: openAiTools } : {}),
          ...(openAiInclude ? { include: openAiInclude } : {}),
          stream: true,
        }
      : undefined;
    const chatGptRequestConfig = isChatGpt
      ? {
          reasoning: chatGptReasoningPayload,
          ...(chatGptTextConfig ? { text: chatGptTextConfig } : {}),
          ...(chatGptTools ? { tools: chatGptTools } : {}),
          include: ["reasoning.encrypted_content"],
          stream: true,
          store: false,
        }
      : undefined;

    const geminiPromptContents = isGemini
      ? promptContents.map(convertLlmContentToGoogleContent)
      : undefined;
    const geminiConfig: GeminiCallConfig | undefined = isGemini
      ? {
          maxOutputTokens: 32_000,
        }
      : undefined;
    if (geminiConfig) {
      const thinkingConfig: GeminiCallConfig["thinkingConfig"] = (() => {
        switch (options.modelId) {
          case "gemini-3-pro-preview":
            return {
              includeThoughts: true,
            } as const;
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
          case "gemini-3-pro-image-preview":
            return undefined;
        }
      })();
      if (thinkingConfig) {
        geminiConfig.thinkingConfig = thinkingConfig;
      }
      if (options.responseMimeType) {
        geminiConfig.responseMimeType = options.responseMimeType;
      }
      if (options.responseJsonSchema) {
        geminiConfig.responseJsonSchema = options.responseJsonSchema;
      }
      if (options.responseModalities) {
        geminiConfig.responseModalities = Array.from(
          options.responseModalities,
        );
      }
      if (options.imageAspectRatio || effectiveImageSize) {
        geminiConfig.imageConfig = {
          ...(options.imageAspectRatio
            ? { aspectRatio: options.imageAspectRatio }
            : {}),
          ...(effectiveImageSize ? { imageSize: effectiveImageSize } : {}),
        };
      }
      // temperature is intentionally not configurable in this wrapper.
      const geminiTools = toGeminiTools(options.tools);
      if (geminiTools) {
        geminiConfig.tools = geminiTools;
      }
    }

    if (debugOutputDirs.length > 0) {
      const requestSnapshot = buildRequestSnapshot({
        modelId: options.modelId,
        stageLabel: stage.label,
        attempt,
        maxAttempts,
        uploadBytes,
        config: isOpenAi
          ? openAiRequestConfig
          : isChatGpt
            ? chatGptRequestConfig
            : geminiConfig,
        configLabel: isOpenAi
          ? "OpenAI Request"
          : isChatGpt
            ? "ChatGPT Codex Request"
            : "Gemini Call Config",
      });
      await writeDebugTextFile({
        dirs: debugOutputDirs,
        filename: "request.txt",
        contents: requestSnapshot,
      });
    }

    const promptStats = summarisePromptStats(promptContents);
    const callHandle = reporter.startModelCall({
      modelId: options.modelId,
      uploadBytes,
      imageSize: effectiveImageSize,
    });
    if (
      promptStats.textChars > 0 ||
      promptStats.imageCount > 0 ||
      promptStats.imageBytes > 0
    ) {
      reporter.recordModelUsage(callHandle, {
        prompt: {
          textChars:
            promptStats.textChars > 0 ? promptStats.textChars : undefined,
          imageCount:
            promptStats.imageCount > 0 ? promptStats.imageCount : undefined,
          imageBytes:
            promptStats.imageBytes > 0 ? promptStats.imageBytes : undefined,
        },
      });
    }
    await responseSnapshotWriter.start([
      `Model: ${options.modelId}`,
      "Elapsed: streaming...",
      buildPromptMediaSummaryLine({ promptStats, uploadBytes }),
      "Tokens: pending",
      "Estimated cost: pending",
    ]);

    const startedAt = Date.now();
    let resolvedModelVersion: string = options.modelId;
    const responseParts: LlmContentPart[] = [];
    let responseRole: LlmRole | undefined;
    let blocked = false;
    let responseGroundingMetadata: GroundingMetadata | undefined;
    let imageCounter = 0;
    let latestUsageTokens: LlmUsageTokenUpdate | undefined;
    let responseTextChars = 0;
    let responseImages = 0;
    let responseImageBytes = 0;
    let thinkingTextChars = 0;

    const onDelta = options.onDelta;
    const appendTextPart = (text: string, isThought: boolean): void => {
      if (text.length === 0) {
        return;
      }
      responseParts.push({
        type: "text",
        text,
        thought: isThought ? true : undefined,
      });
      responseSnapshotWriter.appendText(text, { isThought });
      if (onDelta) {
        if (isThought) {
          onDelta({ thoughtDelta: text });
        } else {
          onDelta({ textDelta: text });
        }
      }
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
    ): {
      responseText: number;
      responseImages: number;
      responseImageBytes: number;
      thinkingText: number;
    } => {
      let responseText = 0;
      let responseImages = 0;
      let responseImageBytes = 0;
      let thinkingText = 0;
      if (!responseRole) {
        responseRole = content.role;
      }
      for (const part of content.parts) {
        if (part.type === "text") {
          const text = part.text;
          appendTextPart(text, part.thought === true);
          if (part.thought === true) {
            thinkingText += text.length;
          } else {
            responseText += text.length;
          }
        } else {
          appendInlinePart(part.data, part.mimeType);
          responseImages += 1;
          responseImageBytes += estimateInlineBytes(part.data);
        }
      }
      return { responseText, responseImages, responseImageBytes, thinkingText };
    };

    try {
      if (isOpenAi) {
        if (!openAiInput) {
          throw new Error("OpenAI call received an empty prompt");
        }
        await runOpenAiCall(async (client) => {
          const stream = client.responses.stream({
            model: openAiModelId ?? options.modelId,
            input: openAiInput,
            reasoning: openAiReasoningPayload,
            ...(openAiTextConfig ? { text: openAiTextConfig } : {}),
            ...(openAiTools ? { tools: openAiTools } : {}),
            ...(openAiInclude ? { include: openAiInclude } : {}),
          });
	          for await (const event of stream) {
	            switch (event.type) {
	              case "response.output_text.delta": {
                const delta = event.delta ?? "";
                if (delta.length > 0) {
                  appendTextPart(delta, false);
                  responseTextChars += delta.length;
                  reporter.recordModelUsage(callHandle, {
                    response: { textCharsDelta: delta.length },
                  });
                  responseSnapshotWriter.flush();
                }
	                break;
	              }
	              case "response.reasoning_text.delta": {
	                // Avoid collecting raw chain-of-thought; summaries are handled below.
	                break;
	              }
	              case "response.reasoning_summary_text.delta": {
	                const delta = event.delta ?? "";
	                if (delta.length > 0) {
	                  appendTextPart(delta, true);
                  thinkingTextChars += delta.length;
                  reporter.recordModelUsage(callHandle, {
                    thinking: { textCharsDelta: delta.length },
                  });
                  responseSnapshotWriter.flush();
                }
                break;
              }
              case "response.refusal.delta": {
                blocked = true;
                break;
              }
              default:
                break;
            }
          }
          const finalResponse = await stream.finalResponse();
          if (finalResponse.model) {
            resolvedModelVersion = finalResponse.model;
          }
          if (finalResponse.error) {
            const message =
              typeof finalResponse.error.message === "string"
                ? finalResponse.error.message
                : "OpenAI response failed";
            throw new Error(message);
          }
          if (
            finalResponse.status &&
            finalResponse.status !== "completed" &&
            finalResponse.status !== "in_progress"
          ) {
            const detail = finalResponse.incomplete_details?.reason;
            throw new Error(
              `OpenAI response status ${finalResponse.status}${
                detail ? ` (${detail})` : ""
              }`,
            );
          }
          latestUsageTokens = extractOpenAiUsageTokens(finalResponse.usage);
          if (responseParts.length === 0) {
            const fallback = extractOpenAiResponseParts(finalResponse);
            if (fallback.blocked) {
              blocked = true;
            }
            if (fallback.parts.length > 0) {
              const deltas = accumulateContent({
                role: "model",
                parts: fallback.parts,
              });
              responseTextChars += deltas.responseText;
              responseImages += deltas.responseImages;
              responseImageBytes += deltas.responseImageBytes;
              thinkingTextChars += deltas.thinkingText;
              responseSnapshotWriter.flush();
            }
          }
        });
      } else if (isChatGpt) {
        if (!chatGptInput || !chatGptRequestConfig) {
          throw new Error("ChatGPT Codex call received an empty prompt");
        }
        const request = {
          model: openAiModelId ?? options.modelId,
          store: chatGptRequestConfig.store,
          stream: chatGptRequestConfig.stream,
          instructions:
            chatGptInput.instructions ?? DEFAULT_CHATGPT_INSTRUCTIONS,
          input: chatGptInput.input,
          ...(chatGptTextConfig ? { text: chatGptTextConfig } : {}),
          include: ["reasoning.encrypted_content"],
          ...(chatGptReasoningPayload
            ? { reasoning: chatGptReasoningPayload }
            : {}),
        };
	        const result = await collectChatGptCodexResponse({ request });
        if (result.model) {
          resolvedModelVersion = isChatGpt
            ? (`chatgpt-${result.model}` as LlmModelId)
            : result.model;
        }
        if (
          result.status &&
          result.status !== "completed" &&
          result.status !== "in_progress"
        ) {
          throw new Error(`ChatGPT response status ${result.status}`);
        }
	        blocked = blocked || result.blocked;
	        const responseText = result.text ?? "";
	        const reasoningSummaryText =
	          result.reasoningSummaryText ?? result.reasoningText ?? "";
	        if (reasoningSummaryText.length > 0) {
	          appendTextPart(reasoningSummaryText, true);
	          thinkingTextChars += reasoningSummaryText.length;
	          reporter.recordModelUsage(callHandle, {
	            thinking: { textCharsDelta: reasoningSummaryText.length },
	          });
	        }
	        if (responseText.length > 0) {
          appendTextPart(responseText, false);
          responseTextChars += responseText.length;
          reporter.recordModelUsage(callHandle, {
            response: { textCharsDelta: responseText.length },
          });
        }
        if (responseText.length > 0 || reasoningText.length > 0) {
          responseSnapshotWriter.flush();
        }
        latestUsageTokens = extractChatGptUsageTokens(
          result.usage as { [key: string]: unknown } | undefined,
        );
      } else {
        if (!geminiPromptContents || !geminiConfig) {
          throw new Error("Gemini call received an empty prompt");
        }
        await runGeminiCall(async (client) => {
          const stream = await client.models.generateContentStream({
            model: options.modelId,
            contents: geminiPromptContents,
            config: geminiConfig,
          });
          let latestGroundingMetadata: GroundingMetadata | undefined;
          for await (const chunk of stream) {
            if (chunk.modelVersion) {
              resolvedModelVersion = chunk.modelVersion;
            }
            if (chunk.promptFeedback?.blockReason) {
              blocked = true;
            }
            latestUsageTokens = mergeTokenUpdates(
              latestUsageTokens,
              extractUsageTokens(chunk.usageMetadata),
            );
            const candidates = chunk.candidates;
            let chunkResponseText = 0;
            let chunkResponseImages = 0;
            let chunkResponseImageBytes = 0;
            let chunkThinkingText = 0;
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
                if (candidate.groundingMetadata) {
                  latestGroundingMetadata = candidate.groundingMetadata;
                }
                try {
                  const content =
                    convertGoogleContentToLlmContent(candidateContent);
                  const deltas = accumulateContent(content);
                  chunkResponseText += deltas.responseText;
                  chunkResponseImages += deltas.responseImages;
                  chunkResponseImageBytes += deltas.responseImageBytes;
                  chunkThinkingText += deltas.thinkingText;
                  responseTextChars += deltas.responseText;
                  responseImages += deltas.responseImages;
                  responseImageBytes += deltas.responseImageBytes;
                  thinkingTextChars += deltas.thinkingText;
                } catch (error) {
                  log(
                    `failed to convert candidate content: ${error instanceof Error ? error.message : String(error)}`,
                  );
                }
              }
            }
            if (
              chunkResponseText > 0 ||
              chunkResponseImages > 0 ||
              chunkResponseImageBytes > 0 ||
              chunkThinkingText > 0 ||
              chunk.modelVersion
            ) {
              reporter.recordModelUsage(callHandle, {
                modelVersion: chunk.modelVersion,
                response:
                  chunkResponseText > 0 ||
                  chunkResponseImages > 0 ||
                  chunkResponseImageBytes > 0
                    ? {
                        textCharsDelta:
                          chunkResponseText > 0 ? chunkResponseText : undefined,
                        imageCountDelta:
                          chunkResponseImages > 0
                            ? chunkResponseImages
                            : undefined,
                        imageBytesDelta:
                          chunkResponseImageBytes > 0
                            ? chunkResponseImageBytes
                            : undefined,
                      }
                    : undefined,
                thinking:
                  chunkThinkingText > 0
                    ? { textCharsDelta: chunkThinkingText }
                    : undefined,
              });
              if (chunkResponseText > 0 || chunkThinkingText > 0) {
                responseSnapshotWriter.flush();
              }
            }
          }
          if (latestGroundingMetadata) {
            responseGroundingMetadata = latestGroundingMetadata;
          }
        });
      }
      if (latestUsageTokens || resolvedModelVersion !== options.modelId) {
        reporter.recordModelUsage(callHandle, {
          modelVersion: resolvedModelVersion,
          tokens: latestUsageTokens,
        });
      }
    } finally {
      reporter.finishModelCall(callHandle);
    }

    const elapsedMs = Date.now() - startedAt;
    log(
      `completed model ${resolvedModelVersion} in ${formatMillis(elapsedMs)}`,
    );

    await responseSnapshotWriter.complete();
    await Promise.all(debugWriteTasks);
    const mergedParts = mergeConsecutiveTextParts(responseParts);
    const responseContent =
      mergedParts.length > 0
        ? {
            role: responseRole ?? "model",
            parts: mergedParts,
          }
        : undefined;
    const responseStats: ResponseSnapshotStats = {
      responseTextChars,
      responseImages,
      responseImageBytes,
      thinkingChars: thinkingTextChars,
    };
    const costUsd = estimateCallCostUsd({
      modelId: resolvedModelVersion,
      tokens: latestUsageTokens,
      responseImages,
      imageSize: effectiveImageSize,
    });

    if (stage.debugDir || debugLogDir) {
      const trimmedResponseText = extractSnapshotText(responseContent);
      const costSummary =
        latestUsageTokens !== undefined
          ? `Estimated cost: ${formatCurrencyUsd(costUsd)}`
          : "Estimated cost: n/a";
      const snapshotSummary: readonly string[] = [
        `Model: ${resolvedModelVersion}`,
        `Elapsed: ${formatMillis(elapsedMs)}`,
        buildTokenSummaryLine(latestUsageTokens),
        buildPromptMediaSummaryLine({ promptStats, uploadBytes }),
        buildResponseMediaSummaryLine(responseStats),
        costSummary,
      ];
      const snapshotContents = responseContent ? [responseContent] : undefined;
      if (stage.debugDir) {
        await writeTextResponseSnapshot({
          pathname: path.join(stage.debugDir, "response.txt"),
          summary: snapshotSummary,
          text: trimmedResponseText,
          contents: snapshotContents,
          grounding: responseGroundingMetadata,
        });
      }
      if (debugLogDir) {
        await writeTextResponseSnapshot({
          pathname: path.join(debugLogDir, "response.txt"),
          summary: snapshotSummary,
          text: trimmedResponseText,
          contents: snapshotContents,
          grounding: responseGroundingMetadata,
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
            await writeFile(
              path.join(dir, "conversation.html"),
              conversationHtml,
              {
                encoding: "utf8",
              },
            );
          }),
        );
      }
    }

    return {
      content: responseContent,
      feedback: blocked ? { blockedReason: "blocked" } : undefined,
    };
  } catch (error) {
    try {
      await responseSnapshotWriter.complete();
    } catch (writeError) {
      log(
        `failed to flush response snapshot: ${
          writeError instanceof Error ? writeError.message : String(writeError)
        }`,
      );
    }
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
    responseJsonSchema,
    maxAttempts: maxAttemptsOption,
    maxRetries,
    openAiSchemaName,
    normalizeJson,
    ...rest
  } = options;
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
  const maxAttempts =
    normaliseAttempts(maxAttemptsOption) ?? normaliseAttempts(maxRetries) ?? 2;
  const isOpenAi = isOpenAiModelVariantId(rest.modelId);
  const resolvedSchemaName = normalisePathSegment(
    openAiSchemaName ?? rest.debug?.stage ?? "llm-response",
  );
  const baseJsonSchema = zodToJsonSchema(schema, {
    name: resolvedSchemaName,
    target: isOpenAi ? "openAi" : "jsonSchema7",
  }) as JsonSchema;
  const openAiJsonSchema = isOpenAi
    ? resolveOpenAiSchemaRoot(baseJsonSchema)
    : undefined;
  const geminiJsonSchema = !isOpenAi
    ? addGeminiPropertyOrdering(baseJsonSchema)
    : undefined;
  const resolvedResponseJsonSchema = isOpenAi
    ? openAiJsonSchema
    : (responseJsonSchema ?? geminiJsonSchema);
  if (isOpenAi && !isJsonSchemaObject(resolvedResponseJsonSchema)) {
    throw new Error(
      "OpenAI structured outputs require a JSON object schema at the root.",
    );
  }
  let openAiTextFormat: OpenAiTextFormat | undefined;
  if (isOpenAi) {
    if (!resolvedResponseJsonSchema) {
      throw new Error(
        "OpenAI structured outputs require a JSON schema response config.",
      );
    }
    const openAiSchema = resolvedResponseJsonSchema;
    openAiTextFormat = {
      type: "json_schema",
      name: resolvedSchemaName,
      strict: true,
      schema: normalizeOpenAiSchema(openAiSchema),
    };
  }

  const textOptions: LlmTextCallOptions = {
    ...rest,
    responseJsonSchema: resolvedResponseJsonSchema,
    responseMimeType: rest.responseMimeType ?? "application/json",
    ...(openAiTextFormat ? { openAiTextFormat } : {}),
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
      const cleanedText = normalizeJsonText(rawText);
      const repairedText = escapeNewlinesInStrings(cleanedText);
      const payload: unknown = JSON.parse(repairedText);
      const normalized =
        typeof normalizeJson === "function" ? normalizeJson(payload) : payload;
      const parsed = schema.parse(normalized);
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

const DEFAULT_TOOL_LOOP_STEPS = 8;

function resolveToolLoopContents(options: LlmToolLoopOptions): LlmContent[] {
  if ("contents" in options) {
    return [...options.contents];
  }
  const contents: LlmContent[] = [];
  if (options.systemPrompt) {
    contents.push({
      role: "system",
      parts: [{ type: "text", text: options.systemPrompt }],
    });
  }
  contents.push({
    role: "user",
    parts: [{ type: "text", text: options.prompt }],
  });
  return contents;
}

function resolveToolLoopMaxSteps(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TOOL_LOOP_STEPS;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_TOOL_LOOP_STEPS;
  }
  const floored = Math.floor(value);
  return floored > 0 ? floored : DEFAULT_TOOL_LOOP_STEPS;
}

function buildOpenAiToolSchema(schema: z.ZodType, name: string): JsonSchema {
  const rawSchema = zodToJsonSchema(schema, {
    name,
    target: "openAi",
  }) as JsonSchema;
  const normalized = normalizeOpenAiSchema(resolveOpenAiSchemaRoot(rawSchema));
  if (!isJsonSchemaObject(normalized)) {
    throw new Error(
      `OpenAI tool schema for ${name} must be a JSON object at the root.`,
    );
  }
  return normalized;
}

function buildGeminiToolSchema(schema: z.ZodType, name: string): JsonSchema {
  const jsonSchema = toGeminiJsonSchema(schema, { name });
  if (!isJsonSchemaObject(jsonSchema)) {
    throw new Error(
      `Gemini tool schema for ${name} must be a JSON object at the root.`,
    );
  }
  return jsonSchema;
}

function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string {
  const messages: string[] = [];
  for (const issue of issues) {
    const path =
      issue.path.length > 0 ? issue.path.map(String).join(".") : "input";
    messages.push(`${path}: ${issue.message}`);
  }
  return messages.join("; ");
}

function buildToolErrorOutput(
  message: string,
  issues?: readonly z.core.$ZodIssue[],
): Record<string, unknown> {
  const output: Record<string, unknown> = { error: message };
  if (issues && issues.length > 0) {
    output.issues = issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
      code: issue.code,
    }));
  }
  return output;
}

function serializeToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded : "null";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({
      error: "Failed to serialize tool output",
      detail: message,
    });
  }
}

function wrapGeminiToolOutput(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) {
    return value;
  }
  return { output: value };
}

function parseOpenAiToolArguments(raw: string): {
  value: unknown;
  error?: string;
} {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: {} };
  }
  try {
    return { value: JSON.parse(trimmed) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { value: raw, error: message };
  }
}

async function executeToolCall(params: {
  toolName: string;
  tool: LlmExecutableTool<z.ZodType, unknown> | undefined;
  rawInput: unknown;
  parseError?: string;
}): Promise<{
  result: LlmToolCallResult;
  outputPayload: unknown;
}> {
  const { toolName, tool, rawInput, parseError } = params;
  if (!tool) {
    const message = `Unknown tool: ${toolName}`;
    return {
      result: {
        toolName,
        input: rawInput,
        output: { error: message },
        error: message,
      },
      outputPayload: buildToolErrorOutput(message),
    };
  }
  if (parseError) {
    const message = `Invalid JSON for tool ${toolName}: ${parseError}`;
    return {
      result: {
        toolName,
        input: rawInput,
        output: { error: message },
        error: message,
      },
      outputPayload: buildToolErrorOutput(message),
    };
  }
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const message = `Invalid tool arguments for ${toolName}: ${formatZodIssues(
      parsed.error.issues,
    )}`;
    const outputPayload = buildToolErrorOutput(message, parsed.error.issues);
    return {
      result: {
        toolName,
        input: rawInput,
        output: outputPayload,
        error: message,
      },
      outputPayload,
    };
  }
  try {
    const output = await tool.execute(parsed.data);
    return {
      result: {
        toolName,
        input: parsed.data,
        output,
      },
      outputPayload: output,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outputPayload = buildToolErrorOutput(
      `Tool ${toolName} failed: ${message}`,
    );
    return {
      result: {
        toolName,
        input: parsed.data,
        output: outputPayload,
        error: message,
      },
      outputPayload,
    };
  }
}

function extractOpenAiFunctionCalls(
  output: readonly ResponseOutputItem[] | undefined,
): ResponseFunctionToolCall[] {
  const calls: ResponseFunctionToolCall[] = [];
  if (!output) {
    return calls;
  }
  for (const item of output) {
    if (item.type === "function_call") {
      calls.push(item);
    }
  }
  return calls;
}

function extractOpenAiText(response: OpenAiResponse): string {
  const { parts } = extractOpenAiResponseParts(response);
  if (parts.length > 0) {
    const content: LlmContent = { role: "model", parts };
    return extractVisibleText(content);
  }
  if (typeof response.output_text === "string") {
    return response.output_text;
  }
  return "";
}

function extractOpenAiReasoningSummary(
  response: OpenAiResponse,
): string | undefined {
  const output = response.output;
  if (!Array.isArray(output)) {
    return undefined;
  }
  const summaries: string[] = [];
  for (const item of output) {
    if (item.type !== "reasoning") {
      continue;
    }
    for (const entry of item.summary) {
      if (entry.type !== "summary_text") {
        continue;
      }
      const trimmed = entry.text.trim();
      if (trimmed.length > 0) {
        summaries.push(trimmed);
      }
    }
  }
  if (summaries.length === 0) {
    return undefined;
  }
  return summaries.join("\n\n");
}

function truncateForLog(value: string, maxChars: number = 400): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…(${value.length} chars)`;
}

export function stripCodexCitationMarkers(value: string): {
  text: string;
  stripped: boolean;
} {
  const citationBlockPattern = /\uE200cite\uE202[^\uE201]*\uE201/gu;
  const leftoverMarkersPattern = /[\uE200\uE201\uE202]/gu;

  const withoutBlocks = value.replace(citationBlockPattern, "");
  const withoutMarkers = withoutBlocks.replace(leftoverMarkersPattern, "");
  const stripped = withoutMarkers !== value;
  return { text: withoutMarkers, stripped };
}

function hasMarkdownSourcesSection(value: string): boolean {
  return /^##\s+Sources\s*$/gmu.test(value);
}

export function appendMarkdownSourcesSection(
  value: string,
  sources: readonly string[],
): string {
  const trimmed = value.trimEnd();
  if (sources.length === 0) {
    return trimmed;
  }
  if (hasMarkdownSourcesSection(trimmed)) {
    return trimmed;
  }
  const lines = sources.map((url) => `- <${url}>`).join("\n");
  return `${trimmed}\n\n## Sources\n${lines}\n`;
}

function normalizeWebSearchUrls(urls: Iterable<string>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const trimmed = url.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function rewriteWriteFileInputForUserFacingCitations(options: {
  toolName: string;
  rawInput: unknown;
  webSearchUrls: Set<string>;
}): unknown {
  if (options.toolName !== "write_file") {
    return options.rawInput;
  }
  if (!options.rawInput || typeof options.rawInput !== "object") {
    return options.rawInput;
  }
  const record = options.rawInput as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : null;
  if (!content) {
    return options.rawInput;
  }

  const stripped = stripCodexCitationMarkers(content);
  if (!stripped.stripped) {
    return options.rawInput;
  }

  const sources = normalizeWebSearchUrls(options.webSearchUrls);
  const nextContent = appendMarkdownSourcesSection(stripped.text, sources);
  return { ...record, content: nextContent };
}

function formatToolValue(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  switch (typeof value) {
    case "string":
      return value.length > 0 ? value : undefined;
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return value.toString();
    default: {
      try {
        const json = JSON.stringify(value);
        return typeof json === "string" && json.length > 0 ? json : undefined;
      } catch {
        return undefined;
      }
    }
  }
}

function normalizePathList(value: unknown): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  const rawEntries = Array.isArray(value) ? value : [value];
  const paths: string[] = [];
  for (const entry of rawEntries) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    paths.push(trimmed);
  }
  return paths;
}

function summarizeToolCallInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== "object") {
    return "";
  }
  const record = input as Record<string, unknown>;
  switch (toolName) {
    case "read_file": {
      const paths = normalizePathList(record.path ?? record.paths);
      if (paths.length === 0) {
        return "";
      }
      if (paths.length === 1) {
        return `path=${paths[0]}`;
      }
      return `paths=${paths.join(", ")}`;
    }
    case "read_files": {
      const paths = normalizePathList(record.paths);
      if (paths.length === 0) {
        return "";
      }
      return `paths=${paths.join(", ")}`;
    }
    case "read_file_summary": {
      const pathValue = formatToolValue(record.path);
      const questionValue = formatToolValue(record.question);
      const pathLabel = pathValue ? `path=${pathValue}` : "";
      const question = questionValue
        ? `question=${truncateForLog(questionValue, 80)}`
        : "";
      return [pathLabel, question].filter(Boolean).join(" ");
    }
    case "list_dir": {
      const pathValue = formatToolValue(record.path);
      return pathValue ? `path=${pathValue}` : "";
    }
    case "list_files": {
      const pathValue = formatToolValue(record.path);
      const pathLabel = pathValue ? `path=${pathValue}` : "";
      const depthValue = formatToolValue(record.maxDepth);
      const depth = depthValue ? `maxDepth=${depthValue}` : "";
      return [pathLabel, depth].filter(Boolean).join(" ");
    }
    case "rg_search": {
      const patternValue = formatToolValue(record.pattern);
      const pattern = patternValue
        ? `pattern=${truncateForLog(patternValue, 120)}`
        : "";
      const pathValue = formatToolValue(record.path);
      const pathLabel = pathValue ? `path=${pathValue}` : "";
      return [pattern, pathLabel].filter(Boolean).join(" ");
    }
    case "create_file": {
      const pathValue = formatToolValue(record.path);
      const pathLabel = pathValue ? `path=${pathValue}` : "";
      const content = typeof record.content === "string" ? record.content : "";
      const chars = content ? `chars=${content.length}` : "";
      return [pathLabel, chars].filter(Boolean).join(" ");
    }
    case "write_file": {
      const paths = normalizePathList(record.path ?? record.paths);
      if (paths.length === 0) {
        return "";
      }
      if (paths.length === 1) {
        return `path=${paths[0]}`;
      }
      return `paths=${paths.join(", ")}`;
    }
    case "delete_file": {
      const pathValue = formatToolValue(record.path);
      return pathValue ? `path=${pathValue}` : "";
    }
    case "move_file": {
      const fromValue = formatToolValue(record.from);
      const toValue = formatToolValue(record.to);
      const fromLabel = fromValue ? `from=${fromValue}` : "";
      const toLabel = toValue ? `to=${toValue}` : "";
      return [fromLabel, toLabel].filter(Boolean).join(" ");
    }
    case "apply_patch": {
      const ops = Array.isArray(record.operations) ? record.operations : [];
      const summaries = ops.slice(0, 3).map((op) => {
        if (!op || typeof op !== "object") {
          return "op";
        }
        const opRec = op as Record<string, unknown>;
        const typeValue = formatToolValue(opRec.type);
        const type = typeValue ?? "op";
        const pathValue = formatToolValue(opRec.path);
        const pathLabel = pathValue ? `:${pathValue}` : "";
        const diffLen =
          typeof opRec.diff === "string" ? `(${opRec.diff.length} chars)` : "";
        return `${type}${pathLabel}${diffLen}`;
      });
      const extra = ops.length > 3 ? ` +${ops.length - 3} more` : "";
      return summaries.length > 0
        ? `ops=${ops.length} ${summaries.join(", ")}${extra}`
        : "";
    }
    case "generate_text": {
      const promptValue = formatToolValue(record.promptPath);
      const outputValue = formatToolValue(record.outputPath);
      const promptPath = promptValue ? `promptPath=${promptValue}` : "";
      const outputPath = outputValue ? `outputPath=${outputValue}` : "";
      const inputPaths = normalizePathList(record.inputPaths);
      const inputPathsLabel =
        inputPaths.length > 0 ? `inputPaths=${inputPaths.join(", ")}` : "";
      const responseSchemaValue = formatToolValue(record.responseSchemaPath);
      const responseSchema = responseSchemaValue
        ? `responseSchemaPath=${responseSchemaValue}`
        : "";
      const debugLabelValue = formatToolValue(record.debugLabel);
      const debugLabel = debugLabelValue ? `debugLabel=${debugLabelValue}` : "";
      const modelIdValue = formatToolValue(record.modelId);
      const modelId = modelIdValue ? `modelId=${modelIdValue}` : "";
      const outputModeValue = formatToolValue(record.outputMode);
      const outputMode = outputModeValue ? `outputMode=${outputModeValue}` : "";
      const tools = Array.isArray(record.tools)
        ? `tools=${record.tools.join(",")}`
        : "";
      return [
        promptPath,
        outputPath,
        inputPathsLabel,
        responseSchema,
        debugLabel,
        modelId,
        outputMode,
        tools,
      ]
        .filter(Boolean)
        .join(" ");
    }
    case "generate_json": {
      const sourceValue = formatToolValue(record.sourcePath);
      const schemaValue = formatToolValue(record.schemaPath);
      const outputValue = formatToolValue(record.outputPath);
      const source = sourceValue ? `sourcePath=${sourceValue}` : "";
      const schema = schemaValue ? `schemaPath=${schemaValue}` : "";
      const output = outputValue ? `outputPath=${outputValue}` : "";
      const modelIdValue = formatToolValue(record.modelId);
      const modelId = modelIdValue ? `modelId=${modelIdValue}` : "";
      return [source, schema, output, modelId].filter(Boolean).join(" ");
    }
    case "validate_json":
    case "validate_schema": {
      const schemaValue = formatToolValue(record.schemaPath);
      const inputValue = formatToolValue(record.inputPath);
      const sessionIdValue = formatToolValue(record.sessionId);
      const schema = schemaValue ? `schemaPath=${schemaValue}` : "";
      const inputPath = inputValue ? `inputPath=${inputValue}` : "";
      const sessionId = sessionIdValue ? `sessionId=${sessionIdValue}` : "";
      return [schema, inputPath, sessionId].filter(Boolean).join(" ");
    }
    case "create_lesson": {
      const topicValue = formatToolValue(record.topic);
      const topic = topicValue ? `topic=${truncateForLog(topicValue, 120)}` : "";
      const title = (() => {
        if (!Object.prototype.hasOwnProperty.call(record, "title")) {
          return "";
        }
        if (record.title === null) {
          return "title=null";
        }
        const value = formatToolValue(record.title);
        return value ? `title=${truncateForLog(value, 80)}` : "";
      })();
      const level = (() => {
        if (!Object.prototype.hasOwnProperty.call(record, "level")) {
          return "";
        }
        if (record.level === null) {
          return "level=null";
        }
        const value = formatToolValue(record.level);
        return value ? `level=${truncateForLog(value, 80)}` : "";
      })();
      const goal = (() => {
        if (!Object.prototype.hasOwnProperty.call(record, "goal")) {
          return "";
        }
        if (record.goal === null) {
          return "goal=null";
        }
        const value = formatToolValue(record.goal);
        return value ? `goal=${truncateForLog(value, 120)}` : "";
      })();

      const planRaw =
        record.plan && typeof record.plan === "object"
          ? (record.plan as Record<string, unknown>)
          : null;
      const itemsRaw = planRaw && Array.isArray(planRaw.items) ? planRaw.items : [];
      const itemSummaries = itemsRaw.slice(0, 3).map((item) => {
        if (!item || typeof item !== "object") {
          return "item";
        }
        const itemRec = item as Record<string, unknown>;
        const kindValue = formatToolValue(itemRec.kind);
        const kind = kindValue ? kindValue : "item";
        const quizRaw =
          itemRec.quiz && typeof itemRec.quiz === "object"
            ? (itemRec.quiz as Record<string, unknown>)
            : null;
        const kindsRaw = quizRaw && Array.isArray(quizRaw.questionKinds)
          ? quizRaw.questionKinds
          : [];
        const kinds = kindsRaw
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return "";
            }
            const entryRec = entry as Record<string, unknown>;
            const kindName = formatToolValue(entryRec.kind);
            const countValue = formatToolValue(entryRec.count);
            if (!kindName || !countValue) {
              return "";
            }
            return `${kindName}:${countValue}`;
          })
          .filter(Boolean)
          .join(",");
        return kinds ? `${kind}(${kinds})` : kind;
      });
      const extra = itemsRaw.length > 3 ? ` +${itemsRaw.length - 3} more` : "";
      const planItems =
        itemSummaries.length > 0
          ? `items=${itemsRaw.length} ${itemSummaries.join(" | ")}${extra}`
          : itemsRaw.length > 0
            ? `items=${itemsRaw.length}`
            : "";

      return [topic, title, level, goal, planItems].filter(Boolean).join(" ");
    }
    default:
      return "";
  }
}

function buildOpenAiFunctionTools(tools: LlmToolSet): OpenAiFunctionTool[] {
  const toolEntries = Object.entries(tools);
  const openAiTools: OpenAiFunctionTool[] = [];
  for (const [name, toolDef] of toolEntries) {
    openAiTools.push({
      type: "function",
      name,
      description: toolDef.description ?? undefined,
      parameters: buildOpenAiToolSchema(toolDef.inputSchema, name),
      strict: true,
    });
  }
  return openAiTools;
}

function buildGeminiFunctionDeclarations(tools: LlmToolSet): Tool[] {
  const toolEntries = Object.entries(tools);
  const functionDeclarations = toolEntries.map(([name, toolDef]) => ({
    name,
    description: toolDef.description ?? "",
    parametersJsonSchema: buildGeminiToolSchema(toolDef.inputSchema, name),
  }));
  return [{ functionDeclarations }];
}

export async function runToolLoop(
  options: LlmToolLoopOptions,
): Promise<LlmToolLoopResult> {
  const toolEntries = Object.entries(options.tools);
  if (toolEntries.length === 0) {
    throw new Error("Tool loop requires at least one tool definition.");
  }
  const contents = resolveToolLoopContents(options);
  if (contents.length === 0) {
    throw new Error("Tool loop prompt must not be empty.");
  }
  const maxSteps = resolveToolLoopMaxSteps(options.maxSteps);
  const reporter = options.progress ?? createFallbackProgress("tool-loop");
  const recordPromptUsage = (
    handle: ModelCallHandle,
    promptContents: readonly LlmContent[],
  ): void => {
    const stats = summarisePromptStats(promptContents);
    if (
      stats.textChars === 0 &&
      stats.imageCount === 0 &&
      stats.imageBytes === 0
    ) {
      return;
    }
    reporter.recordModelUsage(handle, {
      prompt: {
        textChars: stats.textChars > 0 ? stats.textChars : undefined,
        imageCount: stats.imageCount > 0 ? stats.imageCount : undefined,
        imageBytes: stats.imageBytes > 0 ? stats.imageBytes : undefined,
      },
    });
  };
  const steps: LlmToolLoopStep[] = [];
  const openAiModelInfo = resolveOpenAiModelVariant(options.modelId);
  if (openAiModelInfo) {
    if (openAiModelInfo.provider === "chatgpt") {
      const chatGptModelId = openAiModelInfo.modelId;
      const textModelId = options.modelId;
      const openAiFunctionTools = buildOpenAiFunctionTools(options.tools);
      const openAiNativeTools = toOpenAiTools(options.modelTools);
      const openAiTools: OpenAiTool[] = openAiNativeTools
        ? [...openAiNativeTools, ...openAiFunctionTools]
        : [...openAiFunctionTools];
      const openAiReasoningEffort = resolveOpenAiReasoningEffortForModel(
        textModelId,
        options.openAiReasoningEffort,
      );
      const openAiTextConfig: ResponseTextConfig = {
        format: { type: "text" },
        verbosity: resolveOpenAiVerbosity(textModelId),
      };
      const chatGptTextConfig =
        openAiTextConfig.verbosity !== null && openAiTextConfig.verbosity
          ? { verbosity: openAiTextConfig.verbosity }
          : undefined;
	      const chatGptReasoningPayload = {
	        effort: toOpenAiReasoningEffort(openAiReasoningEffort),
	        summary: "detailed" as const,
	      };
      const toolLoopInput = toChatGptInput(contents);
      let input: ChatGptInputItem[] = [...toolLoopInput.input];
      let totalCostUsd = 0;
      const loopStartedAt = Date.now();
      const webSearchUrls = new Set<string>();
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        reporter.log(`${options.modelId} step ${stepIndex + 1}`);
        const promptContents = chatGptInputToDebugContents(input);
        const callHandle = reporter.startModelCall({
          modelId: options.modelId,
          uploadBytes: estimateContentsUploadBytes(promptContents),
        });
        recordPromptUsage(callHandle, promptContents);
        try {
          const request = {
            model: chatGptModelId,
            store: false,
            stream: true,
            instructions:
              toolLoopInput.instructions ?? DEFAULT_CHATGPT_INSTRUCTIONS,
            input,
            ...(chatGptTextConfig ? { text: chatGptTextConfig } : {}),
            include: [
              "reasoning.encrypted_content",
              "web_search_call.action.sources",
            ],
            tools: openAiTools,
            tool_choice: "auto" as const,
            parallel_tool_calls: true,
            reasoning: chatGptReasoningPayload,
          };
          const startedAt = Date.now();
          const response = await collectChatGptCodexResponse({
            request,
            onDelta: options.onDelta,
          });
          const elapsedMs = Date.now() - startedAt;
          if (
            response.status &&
            response.status !== "completed" &&
            response.status !== "in_progress"
          ) {
            throw new Error(`ChatGPT response status ${response.status}`);
          }
          for (const call of response.webSearchCalls) {
            const action = call.action;
            const pieces: string[] = [];
            if (action?.type) {
              pieces.push(`action=${action.type}`);
            }
            if (action?.query) {
              pieces.push(`query=${truncateForLog(action.query, 160)}`);
            }
            if (action?.queries && action.queries.length > 0) {
              pieces.push(`queries=${action.queries.length}`);
            }
            if (action?.url) {
              pieces.push(`url=${truncateForLog(action.url, 160)}`);
            }
            if (action?.pattern) {
              pieces.push(`pattern=${truncateForLog(action.pattern, 160)}`);
            }
            if (action?.sources && action.sources.length > 0) {
              pieces.push(`sources=${action.sources.length}`);
            }
            if (call.status) {
              pieces.push(`status=${call.status}`);
            }
            reporter.log(
              pieces.length > 0
                ? `tool: web_search ${pieces.join(" ")}`
                : "tool: web_search",
            );
            if (action?.url) {
              webSearchUrls.add(action.url);
            }
            if (action?.sources && action.sources.length > 0) {
              for (const source of action.sources) {
                webSearchUrls.add(source.url);
              }
            }
          }
          const usageTokens = extractChatGptUsageTokens(
            response.usage as { [key: string]: unknown } | undefined,
          );
          const resolvedModelId = response.model
            ? (`chatgpt-${response.model}` as LlmTextModelId)
            : options.modelId;
          reporter.recordModelUsage(callHandle, {
            modelVersion: resolvedModelId,
            tokens: usageTokens,
          });
          const stepCostUsd = estimateCallCostUsd({
            modelId: resolvedModelId,
            tokens: usageTokens,
            responseImages: 0,
          });
          totalCostUsd += stepCostUsd;
          reporter.log(
            [
              `[tool-step:${stepIndex + 1}]`,
              `prompt=${formatOptionalNumber(usageTokens?.promptTokens)}`,
              `cached=${formatOptionalNumber(usageTokens?.cachedTokens)}`,
              `thinking=${formatOptionalNumber(usageTokens?.thinkingTokens)}`,
              `out=${formatOptionalNumber(usageTokens?.responseTokens)}`,
              `${formatCurrencyUsd(stepCostUsd)}`,
              `${formatMillis(elapsedMs)},`,
              `total: out=${formatOptionalNumber(usageTokens?.totalTokens)}`,
              `${formatCurrencyUsd(totalCostUsd)}`,
              `${formatMillis(Date.now() - loopStartedAt)}`,
            ].join(" "),
	          );
	          const responseText = response.text ?? "";
	          const reasoningSummaryText =
	            response.reasoningSummaryText ?? response.reasoningText ?? "";
	          const functionCalls = response.toolCalls ?? [];
	          if (reasoningSummaryText.trim().length > 0) {
	            const flattened = reasoningSummaryText.replace(/\s+/gu, " ").trim();
	            reporter.log(`thoughts: ${truncateForLog(flattened, 800)}`);
	          }
	          if (responseText.trim().length > 0) {
	            const flattened = responseText.replace(/\s+/gu, " ").trim();
	            reporter.log(`assistant: ${truncateForLog(flattened, 800)}`);
	          }
          if (functionCalls.length === 0) {
            if (!responseText) {
              throw new Error(
                "Tool loop response did not include text output.",
              );
            }
            steps.push({
              step: steps.length + 1,
              modelId: options.modelId,
              text: responseText,
              toolCalls: [],
            });
            return { text: responseText, steps };
          }
          const toolCalls: LlmToolCallResult[] = [];
          const toolOutputs: ChatGptInputItem[] = [];
          const callInputs = functionCalls.map((call) => {
            const toolName = call.name;
            const { value, error: parseError } = parseOpenAiToolArguments(
              call.arguments,
            );
            const toolSummary = summarizeToolCallInput(toolName, value);
            reporter.log(
              toolSummary
                ? `tool: ${toolName} ${toolSummary}`
                : `tool: ${toolName}`,
            );
            const ids = normalizeChatGptToolIds({
              callId: call.callId,
              itemId: call.id,
            });
            return {
              call,
              toolName,
              value,
              parseError,
              ids,
            };
          });
          const callResults = await Promise.all(
            callInputs.map(async (entry) => {
              const rawInput = rewriteWriteFileInputForUserFacingCitations({
                toolName: entry.toolName,
                rawInput: entry.value,
                webSearchUrls,
              });
              const { result, outputPayload } = await executeToolCall({
                toolName: entry.toolName,
                tool: options.tools[entry.toolName],
                rawInput,
                parseError: entry.parseError,
              });
              return { entry, result, outputPayload };
            }),
          );
          const truncateToolError = (value: string): string => {
            const max = 800;
            if (value.length <= max) {
              return value;
            }
            return `${value.slice(0, max)}…`;
          };
          for (const { entry, result, outputPayload } of callResults) {
            if (result.error) {
              reporter.log(
                `tool_error: ${entry.toolName} ${truncateToolError(result.error)}`,
              );
              continue;
            }
            if (
              entry.toolName === "generate_text" ||
              entry.toolName === "generate_json"
            ) {
              if (
                outputPayload &&
                typeof outputPayload === "object" &&
                !Array.isArray(outputPayload)
              ) {
                const record = outputPayload as Record<string, unknown>;
                const status =
                  typeof record.status === "string" ? record.status : "ok";
                const outputPath =
                  typeof record.outputPath === "string"
                    ? record.outputPath
                    : "";
                const textChars =
                  typeof record.textChars === "number"
                    ? record.textChars
                    : null;
                const gradePass =
                  typeof record.gradePass === "boolean" ? record.gradePass : null;
                reporter.log(
                  [
                    `tool_result: ${entry.toolName}`,
                    `status=${status}`,
                    gradePass !== null ? `pass=${gradePass.toString()}` : "",
                    outputPath ? `outputPath=${outputPath}` : "",
                    textChars !== null ? `chars=${textChars}` : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                continue;
              }
              reporter.log(`tool_result: ${entry.toolName} status=ok`);
              continue;
            }
            if (entry.toolName === "validate_json" || entry.toolName === "validate_schema") {
              if (
                outputPayload &&
                typeof outputPayload === "object" &&
                !Array.isArray(outputPayload)
              ) {
                const record = outputPayload as Record<string, unknown>;
                const ok = record.ok === true;
                const kind =
                  typeof record.kind === "string" ? record.kind : "unknown";
                if (ok) {
                  reporter.log(`tool_result: ${entry.toolName} ok=true kind=${kind}`);
                  continue;
                }
                const errorValue =
                  typeof record.error === "string" ? record.error : "validation failed";
                const issuesRaw = record.issues;
                const issueCount = Array.isArray(issuesRaw) ? issuesRaw.length : 0;
                const firstIssue =
                  Array.isArray(issuesRaw) && issuesRaw.length > 0 && issuesRaw[0] && typeof issuesRaw[0] === "object"
                    ? (issuesRaw[0] as { path?: unknown; message?: unknown })
                    : null;
                const issuePreview = firstIssue
                  ? `${String(firstIssue.path ?? "(root)")}: ${String(firstIssue.message ?? "")}`
                  : "";
                reporter.log(
                  [
                    `tool_result: ${entry.toolName}`,
                    "ok=false",
                    `kind=${kind}`,
                    `issues=${issueCount.toString()}`,
                    `error=${truncateToolError(errorValue)}`,
                    issuePreview ? `first=${truncateForLog(issuePreview, 160)}` : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                );
                continue;
              }
              reporter.log(`tool_result: ${entry.toolName} ok=false`);
              continue;
            }
          }
          if (responseText.length > 0) {
            input.push({
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: responseText }],
            });
          }
          for (const { entry, result, outputPayload } of callResults) {
            toolCalls.push({
              ...result,
              callId: entry.ids.callId,
            });
            toolOutputs.push({
              type: "function_call",
              id: entry.ids.itemId,
              call_id: entry.ids.callId,
              name: entry.toolName,
              arguments: entry.call.arguments,
              status: "completed",
            });
            toolOutputs.push({
              type: "function_call_output",
              call_id: entry.ids.callId,
              output: serializeToolOutput(outputPayload),
            });
          }
          steps.push({
            step: steps.length + 1,
            modelId: options.modelId,
            text: responseText.length > 0 ? responseText : undefined,
            toolCalls,
          });
          input = input.concat(toolOutputs);
        } finally {
          reporter.finishModelCall(callHandle);
        }
      }
    } else {
      const openAiModelId = openAiModelInfo.modelId;
      const openAiFunctionTools = buildOpenAiFunctionTools(options.tools);
      const openAiNativeTools = toOpenAiTools(options.modelTools);
      const openAiTools: OpenAiTool[] = openAiNativeTools
        ? [...openAiNativeTools, ...openAiFunctionTools]
        : [...openAiFunctionTools];
      const openAiReasoningEffort = resolveOpenAiReasoningEffortForModel(
        openAiModelId,
        options.openAiReasoningEffort,
      );
      const openAiTextConfig: ResponseTextConfig = {
        format: { type: "text" },
        verbosity: resolveOpenAiVerbosity(openAiModelId),
      };
      const openAiReasoningPayload = {
        effort: toOpenAiReasoningEffort(openAiReasoningEffort),
        summary: "detailed" as const,
      };
      let previousResponseId: string | undefined;
      let totalCostUsd = 0;
      const loopStartedAt = Date.now();
      const webSearchUrls = new Set<string>();
      let input: ResponseInput = toOpenAiInput(contents);
      let debugPromptContents: LlmContent[] = [...contents];
      for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
        reporter.log(`${options.modelId} step ${stepIndex + 1}`);
        const promptContents = openAiInputToDebugContents(input);
        const callHandle = reporter.startModelCall({
          modelId: options.modelId,
          uploadBytes: estimateContentsUploadBytes(promptContents),
        });
        recordPromptUsage(callHandle, promptContents);
        try {
          const requestConfig = {
            ...(previousResponseId
              ? { previous_response_id: previousResponseId }
              : {}),
            ...(openAiTools.length > 0 ? { tools: openAiTools } : {}),
            ...(openAiTools.length > 0 ? { parallel_tool_calls: true } : {}),
            ...(openAiTools.some(
              (tool) =>
                tool &&
                typeof tool === "object" &&
                (tool as { type?: unknown }).type === "web_search",
            )
              ? {
                  include: [
                    "web_search_call.action.sources" as ResponseIncludable,
                  ],
                }
              : {}),
            reasoning: openAiReasoningPayload,
            text: openAiTextConfig,
          };
          const startedAt = Date.now();
          const response = await runOpenAiCall(async (client) =>
            client.responses.create({
              model: openAiModelId,
              input,
              ...requestConfig,
            }),
          );
          const elapsedMs = Date.now() - startedAt;
          if (response.error) {
            const message =
              typeof response.error.message === "string"
                ? response.error.message
                : "OpenAI response failed";
            throw new Error(message);
          }
          if (
            response.status &&
            response.status !== "completed" &&
            response.status !== "in_progress"
          ) {
            const detail = response.incomplete_details?.reason;
            throw new Error(
              `OpenAI response status ${response.status}${
                detail ? ` (${detail})` : ""
              }`,
            );
          }
          try {
            await writeToolLoopDebugSnapshot({
              debug: options.debug,
              modelId: openAiModelId,
              step: stepIndex + 1,
              maxSteps,
              input,
              debugPromptContents,
              response,
              elapsedMs,
              requestConfig,
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            reporter.log(`failed to write debug snapshot: ${message}`);
          }
          const reasoningSummary = extractOpenAiReasoningSummary(response);
          if (reasoningSummary) {
            reporter.log(`summary: ${truncateForLog(reasoningSummary, 800)}`);
          }
          const outputItems = response.output;
          if (Array.isArray(outputItems)) {
            for (const item of outputItems) {
              if (!item || item.type !== "web_search_call") {
                continue;
              }
              const record = item as unknown as {
                status?: unknown;
                action?: unknown;
              };
              const statusValue =
                typeof record.status === "string" ? record.status : undefined;
              const actionRaw =
                record.action && typeof record.action === "object"
                  ? (record.action as Record<string, unknown>)
                  : null;
              const pieces: string[] = [];
              const actionType =
                actionRaw && typeof actionRaw.type === "string"
                  ? actionRaw.type
                  : null;
              if (actionType) {
                pieces.push(`action=${actionType}`);
              }
              const queryValue =
                actionRaw && typeof actionRaw.query === "string"
                  ? actionRaw.query
                  : null;
              if (queryValue && queryValue.trim().length > 0) {
                pieces.push(`query=${truncateForLog(queryValue.trim(), 160)}`);
              }
              const urlValue =
                actionRaw && typeof actionRaw.url === "string"
                  ? actionRaw.url
                  : null;
              if (urlValue && urlValue.trim().length > 0) {
                const trimmed = urlValue.trim();
                pieces.push(`url=${truncateForLog(trimmed, 160)}`);
                webSearchUrls.add(trimmed);
              }
              const patternValue =
                actionRaw && typeof actionRaw.pattern === "string"
                  ? actionRaw.pattern
                  : null;
              if (patternValue && patternValue.trim().length > 0) {
                pieces.push(
                  `pattern=${truncateForLog(patternValue.trim(), 160)}`,
                );
              }
              if (statusValue) {
                pieces.push(`status=${statusValue}`);
              }

              const sourcesRaw = actionRaw ? actionRaw["sources"] : null;
              if (Array.isArray(sourcesRaw)) {
                for (const entry of sourcesRaw) {
                  if (!entry || typeof entry !== "object") {
                    continue;
                  }
                  const url = (entry as { url?: unknown }).url;
                  if (typeof url !== "string") {
                    continue;
                  }
                  const trimmed = url.trim();
                  if (trimmed.length === 0) {
                    continue;
                  }
                  webSearchUrls.add(trimmed);
                }
              }

              reporter.log(
                pieces.length > 0
                  ? `tool: web_search ${pieces.join(" ")}`
                  : "tool: web_search",
              );
            }
          }
          const usageTokens = extractOpenAiUsageTokens(response.usage);
          const resolvedModelId = response.model ?? openAiModelId;
          reporter.recordModelUsage(callHandle, {
            modelVersion: resolvedModelId,
            tokens: usageTokens,
          });
          const stepCostUsd = estimateCallCostUsd({
            modelId: resolvedModelId,
            tokens: usageTokens,
            responseImages: 0,
          });
          totalCostUsd += stepCostUsd;
          reporter.log(
            [
              `[tool-step:${stepIndex + 1}]`,
              `prompt=${formatOptionalNumber(usageTokens?.promptTokens)}`,
              `cached=${formatOptionalNumber(usageTokens?.cachedTokens)}`,
              `thinking=${formatOptionalNumber(usageTokens?.thinkingTokens)}`,
              `out=${formatOptionalNumber(usageTokens?.responseTokens)}`,
              `${formatCurrencyUsd(stepCostUsd)}`,
              `${formatMillis(elapsedMs)},`,
              `total: out=${formatOptionalNumber(usageTokens?.totalTokens)}`,
              `${formatCurrencyUsd(totalCostUsd)}`,
              `${formatMillis(Date.now() - loopStartedAt)}`,
            ].join(" "),
          );
          previousResponseId = response.id;
          const responseText = extractOpenAiText(response);
          const functionCalls = extractOpenAiFunctionCalls(response.output);
          if (functionCalls.length === 0) {
            if (!responseText) {
              throw new Error(
                "Tool loop response did not include text output.",
              );
            }
            steps.push({
              step: steps.length + 1,
              modelId: options.modelId,
              text: responseText,
              toolCalls: [],
            });
            return { text: responseText, steps };
          }
          const toolCalls: LlmToolCallResult[] = [];
          const toolOutputs: ResponseInput = [];
          const callInputs = functionCalls.map((call) => {
            const toolName = call.name;
            const { value, error: parseError } = parseOpenAiToolArguments(
              call.arguments,
            );
            const toolSummary = summarizeToolCallInput(toolName, value);
            reporter.log(
              toolSummary
                ? `tool: ${toolName} ${toolSummary}`
                : `tool: ${toolName}`,
            );
            return { call, toolName, value, parseError };
          });
          const callResults = await Promise.all(
            callInputs.map(async (entry) => {
              const rawInput = rewriteWriteFileInputForUserFacingCitations({
                toolName: entry.toolName,
                rawInput: entry.value,
                webSearchUrls,
              });
              const { result, outputPayload } = await executeToolCall({
                toolName: entry.toolName,
                tool: options.tools[entry.toolName],
                rawInput,
                parseError: entry.parseError,
              });
              return { entry, result, outputPayload };
            }),
          );
          const truncateToolError = (value: string): string => {
            const max = 800;
            if (value.length <= max) {
              return value;
            }
            return `${value.slice(0, max)}…`;
          };
          for (const { entry, result, outputPayload } of callResults) {
            if (result.error) {
              reporter.log(
                `tool_error: ${entry.toolName} ${truncateToolError(result.error)}`,
              );
              continue;
            }
            if (entry.toolName !== "generate_text") {
              continue;
            }
            if (
              outputPayload &&
              typeof outputPayload === "object" &&
              !Array.isArray(outputPayload)
            ) {
              const record = outputPayload as Record<string, unknown>;
              const status =
                typeof record.status === "string" ? record.status : "ok";
              const outputPath =
                typeof record.outputPath === "string" ? record.outputPath : "";
              const textChars =
                typeof record.textChars === "number" ? record.textChars : null;
              reporter.log(
                [
                  "tool_result: generate_text",
                  `status=${status}`,
                  outputPath ? `outputPath=${outputPath}` : "",
                  textChars !== null ? `chars=${textChars}` : "",
                ]
                  .filter(Boolean)
                  .join(" "),
              );
              continue;
            }
            reporter.log("tool_result: generate_text status=ok");
          }
          for (const { entry, result, outputPayload } of callResults) {
            toolCalls.push({
              ...result,
              callId: entry.call.call_id,
            });
            toolOutputs.push({
              type: "function_call_output",
              call_id: entry.call.call_id,
              output: serializeToolOutput(outputPayload),
            } as ResponseInputItem.FunctionCallOutput);
          }
          steps.push({
            step: steps.length + 1,
            modelId: options.modelId,
            text: responseText.length > 0 ? responseText : undefined,
            toolCalls,
          });
          if (toolOutputs.length > 0) {
            debugPromptContents = debugPromptContents.concat(
              openAiInputToDebugContents(toolOutputs),
            );
          }
          input = toolOutputs;
        } finally {
          reporter.finishModelCall(callHandle);
        }
      }
    }
  } else {
    const geminiFunctionTools = buildGeminiFunctionDeclarations(options.tools);
    const geminiNativeTools = toGeminiTools(options.modelTools);
    const geminiTools = geminiNativeTools
      ? geminiNativeTools.concat(geminiFunctionTools)
      : geminiFunctionTools;
    const geminiContents = contents.map(convertLlmContentToGoogleContent);
    for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
      reporter.log(`${options.modelId} step ${stepIndex + 1}`);
      let promptContents: LlmContent[] = contents;
      try {
        promptContents = geminiContents.map(convertGoogleContentToLlmContent);
      } catch {
        promptContents = contents;
      }
      const callHandle = reporter.startModelCall({
        modelId: options.modelId,
        uploadBytes: estimateContentsUploadBytes(promptContents),
      });
      recordPromptUsage(callHandle, promptContents);
      try {
        const response = await runGeminiCall(async (client) =>
          client.models.generateContent({
            model: options.modelId,
            contents: geminiContents,
            config: {
              maxOutputTokens: 32_000,
              tools: geminiTools,
              toolConfig: {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.VALIDATED,
                },
              },
            },
          }),
        );
        const usageTokens = extractUsageTokens(
          (response as { usageMetadata?: unknown }).usageMetadata,
        );
        const modelVersion =
          (response as { modelVersion?: string }).modelVersion ??
          (response as { model?: string }).model ??
          undefined;
        if (usageTokens || modelVersion) {
          reporter.recordModelUsage(callHandle, {
            modelVersion,
            tokens: usageTokens,
          });
        }
        const responseText = response.text ?? "";
        const functionCalls = response.functionCalls;
        if (!functionCalls || functionCalls.length === 0) {
          if (!responseText) {
            throw new Error("Tool loop response did not include text output.");
          }
          steps.push({
            step: steps.length + 1,
            modelId: options.modelId,
            text: responseText,
            toolCalls: [],
          });
          return { text: responseText, steps };
        }
        const toolCalls: LlmToolCallResult[] = [];
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          geminiContents.push(modelContent);
        } else {
          const parts: Part[] = [];
          if (responseText) {
            parts.push({ text: responseText });
          }
          for (const call of functionCalls) {
            parts.push({ functionCall: call });
          }
          geminiContents.push({ role: "model", parts });
        }
        const responseParts: Part[] = [];
        const callInputs = functionCalls.map((call) => ({
          call,
          toolName: call.name ?? "unknown",
          rawInput: call.args ?? {},
        }));
        const callResults = await Promise.all(
          callInputs.map(async (entry) => {
            const { result, outputPayload } = await executeToolCall({
              toolName: entry.toolName,
              tool: options.tools[entry.toolName],
              rawInput: entry.rawInput,
            });
            return { entry, result, outputPayload };
          }),
        );
        for (const { entry, result, outputPayload } of callResults) {
          toolCalls.push({
            ...result,
            callId: entry.call.id,
          });
          const responsePayload = wrapGeminiToolOutput(outputPayload);
          responseParts.push({
            functionResponse: {
              name: entry.toolName,
              response: responsePayload,
              ...(entry.call.id ? { id: entry.call.id } : {}),
            },
          });
        }
        steps.push({
          step: steps.length + 1,
          modelId: options.modelId,
          text: responseText.length > 0 ? responseText : undefined,
          toolCalls,
        });
        geminiContents.push({ role: "user", parts: responseParts });
      } finally {
        reporter.finishModelCall(callHandle);
      }
    }
  }
  throw new Error(
    `Tool loop exceeded max steps (${maxSteps}) without final response.`,
  );
}

const IMAGE_GRADE_SCHEMA = z.enum(["pass", "fail"]);

const IMAGE_GRADING_MODEL_ID: LlmTextModelId = "gpt-5.2";

function appendDebugSubStage(
  debug: LlmDebugOptions | undefined,
  suffix: string,
): LlmDebugOptions | undefined {
  if (!debug) {
    return undefined;
  }
  const cleaned = suffix.trim();
  const nextSubStage = debug.subStage
    ? `${debug.subStage}/${cleaned}`
    : cleaned;
  return {
    ...debug,
    subStage: nextSubStage,
  };
}

function buildImageGradingContents(params: {
  gradingPrompt: string;
  imagePrompt: string;
  image: LlmImageData;
}): LlmContent[] {
  const { gradingPrompt, imagePrompt, image } = params;
  const parts: LlmContentPart[] = [
    {
      type: "text",
      text: [
        gradingPrompt,
        "",
        "Image prompt to grade:",
        imagePrompt,
        "",
        'Respond with the JSON string "pass" or "fail".',
      ].join("\n"),
    },
    {
      type: "inlineData",
      data: image.data.toString("base64"),
      mimeType: image.mimeType ?? "image/png",
    },
  ];
  return [{ role: "user", parts }];
}

async function gradeGeneratedImage(params: {
  gradingPrompt: string;
  imagePrompt: string;
  image: LlmImageData;
  progress: JobProgressReporter;
  debug: LlmDebugOptions | undefined;
}): Promise<z.infer<typeof IMAGE_GRADE_SCHEMA>> {
  const contents = buildImageGradingContents({
    gradingPrompt: params.gradingPrompt,
    imagePrompt: params.imagePrompt,
    image: params.image,
  });
  const result = await generateJson({
    progress: params.progress,
    modelId: IMAGE_GRADING_MODEL_ID,
    contents,
    schema: IMAGE_GRADE_SCHEMA,
    debug: params.debug,
  });
  return result;
}

export async function generateImages(
  options: LlmGenerateImagesOptions,
): Promise<LlmImageData[]> {
  const {
    stylePrompt,
    styleImages,
    imagePrompts,
    imageGradingPrompt,
    maxAttempts = 4,
    progress,
    modelId,
    debug,
    imageAspectRatio,
    imageSize = "2K",
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

  const gradingPrompt = imageGradingPrompt.trim();
  if (!gradingPrompt) {
    throw new Error("imageGradingPrompt must be a non-empty string");
  }

  const numImages = promptEntries.length;
  if (numImages <= 0) {
    return [];
  }

  const orderedEntries = [...promptEntries];
  const resolvedImages = new Map<number, LlmImageData>();
  const removeResolvedEntries = (resolved: ReadonlySet<number>) => {
    if (resolved.size === 0) {
      return;
    }
    for (let i = promptEntries.length - 1; i >= 0; i -= 1) {
      const entry = promptEntries[i];
      if (resolved.has(entry.index)) {
        promptEntries.splice(i, 1);
      }
    }
  };

  const reporter = progress ?? createFallbackProgress(debug?.stage ?? modelId);

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
        progress: reporter,
        debug,
        responseModalities: ["IMAGE", "TEXT"],
        imageAspectRatio,
        imageSize,
      },
      attempt,
      maxAttempts,
    });
    const { content } = result;
    if (result.feedback !== undefined || content === undefined) {
      continue;
    }
    const images = extractImages(content);
    if (images.length > 0 && promptEntries.length > 0) {
      const assignedCount = Math.min(images.length, promptEntries.length);
      const pendingAssignments = promptEntries.slice(0, assignedCount);
      const assignedImages = images.slice(0, assignedCount);
      const gradeResults = await Promise.all(
        pendingAssignments.map((entry, index) =>
          gradeGeneratedImage({
            gradingPrompt,
            imagePrompt: entry.prompt,
            image: assignedImages[index],
            progress: reporter,
            debug: appendDebugSubStage(debug, `grade-image-${entry.index}`),
          }),
        ),
      );
      const passedEntries = new Set<number>();
      for (let i = 0; i < gradeResults.length; i += 1) {
        const grade = gradeResults[i];
        const entry = pendingAssignments[i];
        if (grade === "pass") {
          resolvedImages.set(entry.index, assignedImages[i]);
          passedEntries.add(entry.index);
        } else {
          reporter.log(
            `Image ${entry.index} failed grading; retrying generation.`,
          );
        }
      }
      removeResolvedEntries(passedEntries);
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

  const orderedImages: LlmImageData[] = [];
  for (const entry of orderedEntries) {
    const image = resolvedImages.get(entry.index);
    if (image) {
      orderedImages.push(image);
    }
  }

  return orderedImages.slice(0, numImages);
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
