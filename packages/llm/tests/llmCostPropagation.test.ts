import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { JobProgressReporter, LlmUsageChunk } from "../src/utils/concurrency";

const streamTextMock = vi.fn();
const generateJsonMock = vi.fn();
const configureSparkLlmTelemetryFromEnvMock = vi.fn();
const publishSparkLlmCallMetricsFromEnvMock = vi.fn(() => Promise.resolve());
const publishSparkToolLoopStepMetricsFromEnvMock = vi.fn(() =>
  Promise.resolve(),
);
const resolveSparkMetricProviderLabelMock = vi.fn(() => "chatgpt");

vi.mock("@ljoukov/llm", async () => {
  const actual = await vi.importActual<typeof import("@ljoukov/llm")>("@ljoukov/llm");
  return {
    ...actual,
    streamText: streamTextMock,
    generateJson: generateJsonMock,
  };
});

vi.mock("../src/utils/gcp/monitoring", () => {
  return {
    configureSparkLlmTelemetryFromEnv: configureSparkLlmTelemetryFromEnvMock,
    publishSparkLlmCallMetricsFromEnv: publishSparkLlmCallMetricsFromEnvMock,
    publishSparkToolLoopStepMetricsFromEnv:
      publishSparkToolLoopStepMetricsFromEnvMock,
    resolveSparkMetricProviderLabel: resolveSparkMetricProviderLabelMock,
  };
});

function createCapturingProgress(chunks: LlmUsageChunk[]): JobProgressReporter {
  return {
    log: () => {},
    startModelCall: () => Symbol("model-call"),
    recordModelUsage: (_handle, chunk) => {
      chunks.push(chunk);
    },
    finishModelCall: () => {},
    startStage: () => Symbol("stage"),
    finishStage: () => {},
    setActiveStages: () => {},
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("Spark LLM wrapper cost propagation", () => {
  it("records final generateText cost even without usage tokens", async () => {
    streamTextMock.mockReturnValue({
      events: (async function* () {
        yield {
          type: "model",
          modelVersion: "chatgpt-gpt-5.4-fast",
        };
      })(),
      result: Promise.resolve({
        provider: "chatgpt",
        model: "chatgpt-gpt-5.4-fast",
        modelVersion: "chatgpt-gpt-5.4-fast",
        text: "ok",
        thoughts: "",
        blocked: false,
        usage: undefined,
        costUsd: 0.25,
      }),
      abort: () => {},
    });

    const { generateText } = await import("../src/utils/llm");
    const chunks: LlmUsageChunk[] = [];

    await generateText({
      modelId: "chatgpt-gpt-5.4-fast",
      contents: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      progress: createCapturingProgress(chunks),
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        modelVersion: "chatgpt-gpt-5.4-fast",
        costUsd: 0.25,
      }),
    );
  });

  it("records final generateJson cost even without usage tokens", async () => {
    generateJsonMock.mockResolvedValue({
      value: { ok: true },
      result: {
        provider: "chatgpt",
        model: "chatgpt-gpt-5.4-fast",
        modelVersion: "chatgpt-gpt-5.4-fast",
        text: '{"ok":true}',
        thoughts: "",
        blocked: false,
        usage: undefined,
        costUsd: 0.33,
      },
    });

    const { generateJson } = await import("../src/utils/llm");
    const chunks: LlmUsageChunk[] = [];

    await generateJson({
      modelId: "chatgpt-gpt-5.4-fast",
      contents: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      schema: z.object({ ok: z.boolean() }),
      progress: createCapturingProgress(chunks),
    });

    expect(chunks).toContainEqual(
      expect.objectContaining({
        modelVersion: "chatgpt-gpt-5.4-fast",
        costUsd: 0.33,
      }),
    );
  });
});
