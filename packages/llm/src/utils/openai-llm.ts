import OpenAI from "openai";

import { getOpenAiClient } from "./openai";

const MAX_PARALLEL_REQUESTS = 3;
const MIN_INTERVAL_BETWEEN_START_MS = 200;
const START_JITTER_MS = 200;

export const OPENAI_MODEL_IDS = [
  "gpt-5.2",
  "gpt-5.2-codex",
] as const;

export type OpenAiModelId = (typeof OPENAI_MODEL_IDS)[number];

export const DEFAULT_OPENAI_MODEL_ID: OpenAiModelId = "gpt-5.2";

export type OpenAiPricing = {
  readonly inputRate: number;
  readonly cachedRate: number;
  readonly outputRate: number;
};

const OPENAI_GPT_52_PRICING: OpenAiPricing = {
  inputRate: 1.75 / 1_000_000,
  cachedRate: 0.175 / 1_000_000,
  outputRate: 14 / 1_000_000,
};

export type OpenAiReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const DEFAULT_OPENAI_REASONING_EFFORT: OpenAiReasoningEffort = "medium";

export function isOpenAiModelId(value: string): value is OpenAiModelId {
  return (OPENAI_MODEL_IDS as readonly string[]).includes(value);
}

export function getOpenAiPricing(modelId: string): OpenAiPricing | undefined {
  if (modelId.includes("gpt-5.2")) {
    return OPENAI_GPT_52_PRICING;
  }
  return undefined;
}

let activeCount = 0;
let lastStartTime = 0;

type QueueJob = () => Promise<void>;

const queue: QueueJob[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function applyStartSpacing(): Promise<void> {
  if (lastStartTime > 0 && MIN_INTERVAL_BETWEEN_START_MS > 0) {
    const elapsed = Date.now() - lastStartTime;
    const remaining = MIN_INTERVAL_BETWEEN_START_MS - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
  }
  if (START_JITTER_MS > 0) {
    await sleep(Math.floor(Math.random() * START_JITTER_MS));
  }
  lastStartTime = Date.now();
}

function drainQueue(): void {
  while (activeCount < MAX_PARALLEL_REQUESTS && queue.length > 0) {
    const job = queue.shift();
    if (!job) {
      continue;
    }
    activeCount += 1;
    void job();
  }
}

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const job = async () => {
      try {
        await applyStartSpacing();
        const result = await fn();
        resolve(result);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        activeCount -= 1;
        queueMicrotask(drainQueue);
      }
    };
    queue.push(job);
    drainQueue();
  });
}

export async function runOpenAiCall<T>(
  fn: (client: OpenAI) => Promise<T>,
): Promise<T> {
  return schedule(async () => fn(getOpenAiClient()));
}
