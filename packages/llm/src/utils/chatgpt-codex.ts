import os from "node:os";
import { TextDecoder } from "node:util";

import { getChatGptAuthProfile } from "./chatgpt-auth";

const CHATGPT_CODEX_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/responses";

export type ChatGptInputTextPart = {
  type: "input_text";
  text: string;
};

export type ChatGptOutputTextPart = {
  type: "output_text";
  text: string;
};

export type ChatGptInputImagePart = {
  type: "input_image";
  image_url: string | { url: string };
  detail?: "auto";
};

export type ChatGptInputMessagePart =
  | ChatGptInputTextPart
  | ChatGptOutputTextPart
  | ChatGptInputImagePart;

export type ChatGptInputMessage = {
  role: "user" | "assistant";
  content: string | ChatGptInputMessagePart[];
  type?: "message";
  status?: "completed";
};

export type ChatGptFunctionCall = {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: "completed";
};

export type ChatGptFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ChatGptInputItem =
  | ChatGptInputMessage
  | ChatGptFunctionCall
  | ChatGptFunctionCallOutput;

export type ChatGptCodexRequest = {
  model: string;
  store: boolean;
  stream: boolean;
  instructions?: string;
  input: ChatGptInputItem[];
  text?: { verbosity?: string; format?: unknown };
  include?: string[];
  prompt_cache_key?: string;
  tool_choice?: "auto" | "required" | "none";
  parallel_tool_calls?: boolean;
  temperature?: number;
  tools?: unknown[];
  reasoning?: { effort: string; summary: string };
};

export type ChatGptCodexStreamEvent = {
  type?: string;
  [key: string]: unknown;
};

export type ChatGptCodexUsage = {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
  total_tokens?: number;
};

export type ChatGptCodexToolCall = {
  id: string;
  callId: string;
  name: string;
  arguments: string;
};

export type ChatGptCodexCollectedResponse = {
  text: string;
  reasoningText: string;
  toolCalls: ChatGptCodexToolCall[];
  usage?: ChatGptCodexUsage;
  model?: string;
  status?: string;
  blocked: boolean;
};

export async function streamChatGptCodexResponse(options: {
  request: ChatGptCodexRequest;
  sessionId?: string;
  signal?: AbortSignal;
}): Promise<AsyncIterable<ChatGptCodexStreamEvent>> {
  const { access, accountId } = await getChatGptAuthProfile();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${access}`,
    "chatgpt-account-id": accountId,
    "OpenAI-Beta": "responses=experimental",
    originator: "spark",
    "User-Agent": buildUserAgent(),
    Accept: "text/event-stream",
    "Content-Type": "application/json",
  };
  if (options.sessionId) {
    headers.session_id = options.sessionId;
  }
  const response = await fetch(CHATGPT_CODEX_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(options.request),
    signal: options.signal,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `ChatGPT Codex request failed (${response.status}): ${body}`,
    );
  }
  const body = response.body;
  if (!body) {
    throw new Error("ChatGPT Codex response body was empty.");
  }
  return parseEventStream(body);
}

export async function collectChatGptCodexResponse(options: {
  request: ChatGptCodexRequest;
  sessionId?: string;
  signal?: AbortSignal;
}): Promise<ChatGptCodexCollectedResponse> {
  const stream = await streamChatGptCodexResponse(options);
  const toolCalls = new Map<string, ChatGptCodexToolCall>();
  const toolCallOrder: string[] = [];
  let text = "";
  let reasoningText = "";
  let sawOutputTextDelta = false;
  let sawReasoningDelta = false;
  let usage: ChatGptCodexUsage | undefined;
  let model: string | undefined;
  let status: string | undefined;
  let blocked = false;
  for await (const event of stream) {
    const type = typeof event.type === "string" ? event.type : undefined;
    if (type === "response.output_text.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta.length > 0) {
        sawOutputTextDelta = true;
        text += delta;
      }
      continue;
    }
    if (
      type === "response.reasoning_text.delta" ||
      type === "response.reasoning_summary_text.delta"
    ) {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta.length > 0) {
        sawReasoningDelta = true;
        reasoningText += delta;
      }
      continue;
    }
    if (type === "response.refusal.delta") {
      blocked = true;
      continue;
    }
    if (
      type === "response.output_item.added" ||
      type === "response.output_item.done"
    ) {
      const item = event.item as Record<string, unknown> | undefined;
      if (item) {
        if (item.type === "function_call") {
          const id = typeof item.id === "string" ? item.id : "";
          const callId = typeof item.call_id === "string" ? item.call_id : id;
          const name = typeof item.name === "string" ? item.name : "";
          const args = typeof item.arguments === "string" ? item.arguments : "";
          if (callId) {
            const existing = toolCalls.get(callId);
            if (existing) {
              if (!existing.id && id) {
                existing.id = id;
              }
              if (!existing.name && name) {
                existing.name = name;
              }
              if (args.length > existing.arguments.length) {
                existing.arguments = args;
              }
            } else {
              toolCalls.set(callId, {
                id,
                callId,
                name,
                arguments: args,
              });
              toolCallOrder.push(callId);
            }
          }
        } else if (item.type === "message" && !sawOutputTextDelta) {
          const content = Array.isArray(item.content) ? item.content : [];
          for (const entry of content) {
            if (
              entry &&
              typeof entry === "object" &&
              (entry as { type?: unknown }).type === "output_text"
            ) {
              const entryText = (entry as { text?: unknown }).text;
              if (typeof entryText === "string" && entryText.length > 0) {
                text += entryText;
              }
            }
          }
        } else if (item.type === "reasoning" && !sawReasoningDelta) {
          const content = Array.isArray(item.content) ? item.content : [];
          for (const entry of content) {
            if (!entry || typeof entry !== "object") {
              continue;
            }
            const entryType = (entry as { type?: unknown }).type;
            if (
              entryType === "reasoning_text" ||
              entryType === "reasoning_summary_text"
            ) {
              const entryText = (entry as { text?: unknown }).text;
              if (typeof entryText === "string" && entryText.length > 0) {
                reasoningText += entryText;
              }
            }
          }
        }
      }
      continue;
    }
    if (type === "response.function_call_arguments.delta") {
      const callId = typeof event.call_id === "string" ? event.call_id : "";
      const delta = typeof event.delta === "string" ? event.delta : "";
      const existing = toolCalls.get(callId);
      if (existing) {
        existing.arguments += delta;
      } else if (callId) {
        toolCalls.set(callId, {
          id: callId,
          callId,
          name: "",
          arguments: delta,
        });
        toolCallOrder.push(callId);
      }
      continue;
    }
    if (type === "response.completed" || type === "response.done") {
      const responsePayload = event.response as
        | Record<string, unknown>
        | undefined;
      if (responsePayload) {
        const usagePayload = responsePayload.usage as
          | ChatGptCodexUsage
          | undefined;
        usage = usagePayload ?? usage;
        const modelValue =
          typeof responsePayload.model === "string"
            ? responsePayload.model
            : undefined;
        model = modelValue ?? model;
        const statusValue =
          typeof responsePayload.status === "string"
            ? responsePayload.status
            : undefined;
        status = statusValue ?? status;
      }
      continue;
    }
    if (type === "response.failed" || type === "error") {
      const errorPayload = event.error as Record<string, unknown> | undefined;
      const message =
        typeof errorPayload?.message === "string"
          ? errorPayload?.message
          : "ChatGPT Codex response failed.";
      throw new Error(message);
    }
  }
  const orderedCalls = toolCallOrder
    .map((key) => toolCalls.get(key))
    .filter((call): call is ChatGptCodexToolCall => Boolean(call));
  return {
    text,
    reasoningText,
    toolCalls: orderedCalls,
    usage,
    model,
    status,
    blocked,
  };
}

function buildUserAgent(): string {
  const platform = os.platform();
  const release = os.release();
  const arch = os.arch();
  return `pi (${platform} ${release}; ${arch})`;
}

async function* parseEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<ChatGptCodexStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = findEventBoundary(buffer);
    while (boundary) {
      const raw = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const event = parseEventBlock(raw);
      if (event) {
        yield event;
      }
      boundary = findEventBoundary(buffer);
    }
  }
  if (buffer.trim().length > 0) {
    const event = parseEventBlock(buffer);
    if (event) {
      yield event;
    }
  }
}

function parseEventBlock(raw: string): ChatGptCodexStreamEvent | null {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  if (dataLines.length === 0) {
    return null;
  }
  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return null;
  }
  try {
    return JSON.parse(data) as ChatGptCodexStreamEvent;
  } catch {
    return null;
  }
}

function findEventBoundary(
  buffer: string,
): { index: number; length: number } | null {
  const lfIndex = buffer.indexOf("\n\n");
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  if (lfIndex === -1 && crlfIndex === -1) {
    return null;
  }
  if (lfIndex === -1) {
    return { index: crlfIndex, length: 4 };
  }
  if (crlfIndex === -1) {
    return { index: lfIndex, length: 2 };
  }
  return lfIndex < crlfIndex
    ? { index: lfIndex, length: 2 }
    : { index: crlfIndex, length: 4 };
}
