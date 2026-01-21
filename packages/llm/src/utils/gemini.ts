import { GoogleGenAI } from "@google/genai";
import type {
  Content,
  GenerateContentResponse,
  GoogleGenAIOptions,
  Part,
} from "@google/genai";

import { getGoogleAuthOptions, getGoogleServiceAccount } from "./googleAuth";

const MAX_PARALLEL_REQUESTS = 3;
const MIN_INTERVAL_BETWEEN_START_MS = 200;
const START_JITTER_MS = 200;
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 4000;

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);
const RATE_LIMIT_REASONS = new Set([
  "RATE_LIMIT_EXCEEDED",
  "RESOURCE_EXHAUSTED",
  "QUOTA_EXCEEDED",
]);

export const GEMINI_MODEL_IDS = [
  "gemini-3-pro-preview",
  "gemini-2.5-pro",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
] as const;

export type GeminiModelId = (typeof GEMINI_MODEL_IDS)[number];

export type GeminiProPreviewPricing = {
  readonly threshold: number;
  readonly inputRateLow: number;
  readonly inputRateHigh: number;
  readonly cachedRateLow: number;
  readonly cachedRateHigh: number;
  readonly outputRateLow: number;
  readonly outputRateHigh: number;
};

export type GeminiImagePreviewPricing = {
  readonly inputRate: number;
  readonly cachedRate: number;
  readonly outputTextRate: number;
  readonly outputImageRate: number;
  readonly imagePrices: Record<string, number>;
};

const GEMINI_PRO_PREVIEW_PRICING: GeminiProPreviewPricing = {
  threshold: 200_000,
  inputRateLow: 2 / 1_000_000,
  inputRateHigh: 4 / 1_000_000,
  cachedRateLow: 0.2 / 1_000_000,
  cachedRateHigh: 0.4 / 1_000_000,
  outputRateLow: 12 / 1_000_000,
  outputRateHigh: 18 / 1_000_000,
};

const GEMINI_IMAGE_PREVIEW_PRICING: GeminiImagePreviewPricing = {
  inputRate: 2 / 1_000_000,
  cachedRate: 0.2 / 1_000_000,
  outputTextRate: 12 / 1_000_000,
  outputImageRate: 120 / 1_000_000,
  imagePrices: {
    "1K": 0.134,
    "2K": 0.134,
    "4K": 0.24,
  },
};

export function isGeminiModelId(value: string): value is GeminiModelId {
  return (GEMINI_MODEL_IDS as readonly string[]).includes(value);
}

export function getGeminiProPreviewPricing(
  modelId: string,
): GeminiProPreviewPricing | undefined {
  if (modelId.includes("gemini-3-pro")) {
    return GEMINI_PRO_PREVIEW_PRICING;
  }
  return undefined;
}

export function getGeminiImagePreviewPricing(
  modelId: string,
): GeminiImagePreviewPricing | undefined {
  if (modelId.includes("image-preview")) {
    return GEMINI_IMAGE_PREVIEW_PRICING;
  }
  return undefined;
}

let activeCount = 0;
let lastStartTime = 0;

type QueueJob = () => Promise<void>;

const queue: QueueJob[] = [];

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_VERTEX_LOCATION = "global";

let clientPromise: Promise<GoogleGenAI> | undefined;

type GeminiConfiguration = {
  readonly projectId?: string;
  readonly location?: string;
};

let geminiConfiguration: GeminiConfiguration = {};

function normaliseConfigValue(value?: string | null): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function configureGemini(options: GeminiConfiguration = {}): void {
  const nextProjectId = normaliseConfigValue(options.projectId);
  const nextLocation = normaliseConfigValue(options.location);
  geminiConfiguration = {
    projectId:
      nextProjectId !== undefined
        ? nextProjectId
        : geminiConfiguration.projectId,
    location:
      nextLocation !== undefined ? nextLocation : geminiConfiguration.location,
  };
  clientPromise = undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveProjectId(): string {
  const override = geminiConfiguration.projectId;
  if (override) {
    return override;
  }
  const serviceAccount = getGoogleServiceAccount();
  return serviceAccount.projectId;
}

function resolveLocation(): string {
  const override = geminiConfiguration.location;
  if (override) {
    return override;
  }
  return DEFAULT_VERTEX_LOCATION;
}

async function getGeminiClient(): Promise<GoogleGenAI> {
  if (!clientPromise) {
    clientPromise = Promise.resolve().then(() => {
      const projectId = resolveProjectId();
      const location = resolveLocation();
      const googleAuthOptions = getGoogleAuthOptions(CLOUD_PLATFORM_SCOPE);
      return new GoogleGenAI({
        vertexai: true,
        project: projectId,
        location,
        googleAuthOptions:
          googleAuthOptions as GoogleGenAIOptions["googleAuthOptions"],
      });
    });
  }
  return clientPromise;
}

function getStatus(error: unknown): number | undefined {
  const maybe = error as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  const candidates = [
    maybe?.status,
    maybe?.statusCode,
    maybe?.response?.status,
  ];
  for (const value of candidates) {
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }
  if (typeof maybe?.code === "number") {
    return maybe.code;
  }
  return undefined;
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const maybe = error as { code?: unknown; cause?: unknown };
  if (typeof maybe.code === "string") {
    return maybe.code;
  }
  if (maybe.cause && typeof maybe.cause === "object") {
    const causeCode = (maybe.cause as { code?: unknown }).code;
    if (typeof causeCode === "string") {
      return causeCode;
    }
  }
  return undefined;
}

function getErrorReason(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const details = (error as { errorDetails?: unknown }).errorDetails;
  if (Array.isArray(details) && details.length > 0) {
    const reason = (details[0] as { reason?: unknown }).reason;
    if (typeof reason === "string") {
      return reason;
    }
  }
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const nestedDetails = (cause as { errorDetails?: unknown }).errorDetails;
    if (Array.isArray(nestedDetails) && nestedDetails.length > 0) {
      const reason = (nestedDetails[0] as { reason?: unknown }).reason;
      if (typeof reason === "string") {
        return reason;
      }
    }
  }
  return undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

function parseRetryInfo(details: unknown): number | undefined {
  if (Array.isArray(details)) {
    for (const entry of details) {
      const ms = parseRetryInfo(entry);
      if (ms !== undefined) {
        return ms;
      }
    }
    return undefined;
  }
  if (!details || typeof details !== "object") {
    return undefined;
  }
  const retryDelay = (details as { retryDelay?: unknown }).retryDelay as
    | { seconds?: unknown; nanos?: unknown }
    | undefined;
  if (retryDelay) {
    const secondsRaw = retryDelay.seconds;
    const nanosRaw = retryDelay.nanos;
    const seconds =
      typeof secondsRaw === "number"
        ? secondsRaw
        : typeof secondsRaw === "string"
          ? Number.parseFloat(secondsRaw)
          : 0;
    const nanos =
      typeof nanosRaw === "number"
        ? nanosRaw
        : typeof nanosRaw === "string"
          ? Number.parseInt(nanosRaw, 10)
          : 0;
    if (Number.isFinite(seconds) || Number.isFinite(nanos)) {
      const totalMs = seconds * 1000 + nanos / 1_000_000;
      if (totalMs > 0) {
        return totalMs;
      }
    }
  }
  const nestedDetails = (details as { details?: unknown }).details;
  if (nestedDetails) {
    const nested = parseRetryInfo(nestedDetails);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function parseRetryAfterFromMessage(message: string): number | undefined {
  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }
  const regex = /retry in\s+([0-9]+(?:\.[0-9]+)?)\s*(s|sec|secs|seconds?)/iu;
  const match = regex.exec(trimmed);
  if (match && match[1]) {
    const value = Number.parseFloat(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return value * 1000;
    }
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const infoFromDetails = parseRetryInfo(
    (error as { errorDetails?: unknown }).errorDetails,
  );
  if (infoFromDetails !== undefined) {
    return infoFromDetails;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const nested = getRetryAfterMs(cause);
    if (nested !== undefined) {
      return nested;
    }
  }

  const message = getErrorMessage(error);
  if (message) {
    const fromMessage = parseRetryAfterFromMessage(message.toLowerCase());
    if (fromMessage !== undefined) {
      return fromMessage;
    }
  }

  return undefined;
}

function shouldRetry(error: unknown): boolean {
  const status = getStatus(error);
  if (status && RETRYABLE_STATUSES.has(status)) {
    return true;
  }

  const reason = getErrorReason(error);
  if (reason && RATE_LIMIT_REASONS.has(reason)) {
    return true;
  }

  const code = getErrorCode(error);
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  const message = getErrorMessage(error).toLowerCase();
  if (
    message.includes("rate limit") ||
    message.includes("temporarily unavailable")
  ) {
    return true;
  }
  if (message.includes("fetch failed") || message.includes("socket hang up")) {
    return true;
  }
  if (message.includes("quota") || message.includes("insufficient")) {
    return false;
  }
  if (message.includes("timeout") || message.includes("network")) {
    return true;
  }
  return false;
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
  );
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  return new Error("Unknown error");
}

async function attemptWithRetries<T>(
  fn: () => Promise<T>,
  attempt: number,
): Promise<T> {
  try {
    return await fn();
  } catch (error: unknown) {
    if (attempt >= MAX_ATTEMPTS || !shouldRetry(error)) {
      throw error;
    }
    const hintedDelay = getRetryAfterMs(error);
    const delay = hintedDelay ?? retryDelayMs(attempt);
    const message = getErrorMessage(error);
    console.warn(
      hintedDelay !== undefined
        ? `[gemini] attempt ${attempt} failed: ${message || "unknown error"}; respecting retry hint ${Math.round(delay)}ms`
        : `[gemini] attempt ${attempt} failed: ${message || "unknown error"}; retrying in ${delay}ms`,
    );
    await sleep(delay);
    return attemptWithRetries(fn, attempt + 1);
  }
}

async function applyStartSpacing(): Promise<void> {
  const now = Date.now();
  const earliestNext = lastStartTime + MIN_INTERVAL_BETWEEN_START_MS;
  const wait = Math.max(0, earliestNext - now);
  const jitter = Math.floor(Math.random() * (START_JITTER_MS + 1));
  const delay = wait + jitter;
  if (delay > 0) {
    await sleep(delay);
  }
  lastStartTime = Date.now();
}

function drainQueue(): void {
  while (activeCount < MAX_PARALLEL_REQUESTS && queue.length > 0) {
    const task = queue.shift();
    if (!task) {
      continue;
    }
    activeCount += 1;
    void task();
  }
}

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: QueueJob = async () => {
      try {
        const result = await attemptWithRetries(async () => {
          await applyStartSpacing();
          return fn();
        }, 1);
        resolve(result);
      } catch (error: unknown) {
        reject(toError(error));
      } finally {
        activeCount -= 1;
        queueMicrotask(drainQueue);
      }
    };
    queue.push(job);
    drainQueue();
  });
}

export async function runGeminiCall<T>(
  fn: (client: GoogleGenAI) => Promise<T>,
): Promise<T> {
  return schedule(async () => fn(await getGeminiClient()));
}

function collectTextChunk(chunk: GenerateContentResponse): string {
  let text = "";
  if (Array.isArray(chunk.candidates)) {
    for (const candidate of chunk.candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if (typeof part.text === "string" && !part.thought) {
          text += part.text;
        }
      }
    }
  }
  if (!chunk.candidates && typeof chunk.text === "string") {
    text += chunk.text;
  }
  return text;
}

export async function streamGeminiTextResponse({
  model,
  parts,
  contents,
  config,
  trimOutput = true,
}: {
  readonly model: string;
  readonly parts?: Part[];
  readonly contents?: Content[];
  readonly config?: Record<string, unknown>;
  readonly trimOutput?: boolean;
}): Promise<{ text: string; modelVersion: string }> {
  const effectiveContents = contents ?? [
    {
      role: "user",
      parts: parts ?? [],
    },
  ];
  let aggregated = "";
  let resolvedModelVersion = model;
  await runGeminiCall(async (client) => {
    const stream = await client.models.generateContentStream({
      model,
      contents: effectiveContents,
      config,
    });
    for await (const chunk of stream) {
      if (chunk.modelVersion) {
        resolvedModelVersion = chunk.modelVersion;
      }
      aggregated += collectTextChunk(chunk);
    }
  });
  const finalText = trimOutput ? aggregated.trim() : aggregated;
  if (!finalText) {
    throw new Error("Gemini returned empty text response");
  }
  return {
    text: finalText,
    modelVersion: resolvedModelVersion,
  };
}
