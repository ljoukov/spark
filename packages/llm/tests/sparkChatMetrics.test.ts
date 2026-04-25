import { afterEach, describe, expect, it, vi } from "vitest";

const runAgentLoopMock = vi.fn();
const configureSparkLlmTelemetryFromEnvMock = vi.fn();
const createSparkAgentRunTelemetryConfigMock = vi.fn(() => ({
  includeStreamEvents: false,
  sink: {
    emit: async () => {},
    flush: async () => {},
  },
}));
const publishSparkToolLoopStepMetricsFromEnvMock = vi.fn(() =>
  Promise.resolve(),
);
const publishSparkAgentProcessMetricsFromEnvMock = vi.fn(() =>
  Promise.resolve(),
);
const resolveSparkMetricProviderLabelMock = vi.fn(() => "chatgpt");

vi.mock("@ljoukov/llm", () => {
  return {
    runAgentLoop: runAgentLoopMock,
    tool: ({
      description,
      inputSchema,
      execute,
    }: {
      description: string;
      inputSchema: unknown;
      execute: (input: unknown) => Promise<unknown>;
    }) => ({
      description,
      inputSchema,
      execute,
    }),
  };
});

vi.mock("../src/utils/gcp/monitoring", () => {
  return {
    configureSparkLlmTelemetryFromEnv: configureSparkLlmTelemetryFromEnvMock,
    createSparkAgentRunTelemetryConfig: createSparkAgentRunTelemetryConfigMock,
    publishSparkToolLoopStepMetricsFromEnv:
      publishSparkToolLoopStepMetricsFromEnvMock,
    publishSparkAgentProcessMetricsFromEnv:
      publishSparkAgentProcessMetricsFromEnvMock,
    resolveSparkMetricProviderLabel: resolveSparkMetricProviderLabelMock,
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("runSparkChatAgentLoop", () => {
  it("publishes chat step and process metrics for successful runs", async () => {
    runAgentLoopMock.mockResolvedValue({
      text: "Hello",
      steps: [
        {
          step: 1,
          timing: {
            totalMs: 120,
            queueWaitMs: 10,
            connectionSetupMs: 5,
            activeGenerationMs: 90,
            toolExecutionMs: 10,
            waitToolMs: 3,
            schedulerDelayMs: 1,
            providerRetryDelayMs: 1,
            completedAt: "2026-03-24T10:05:00.000Z",
          },
        },
      ],
    });

    const { runSparkChatAgentLoop } =
      await import("../src/agent/sparkChatShared");
    const result = await runSparkChatAgentLoop({
      input: "Hi",
      instructions: "Be helpful.",
      tools: {},
    });

    expect(configureSparkLlmTelemetryFromEnvMock).toHaveBeenCalledTimes(1);
    expect(createSparkAgentRunTelemetryConfigMock).toHaveBeenCalledWith({
      agentType: "chat",
      job: "spark-chat",
      taskIdPrefix: "spark-chat",
    });
    expect(publishSparkToolLoopStepMetricsFromEnvMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "agent_run_tool_loop",
        model: "chatgpt-gpt-5.5-fast",
        provider: "chatgpt",
        status: "ok",
        agentType: "chat",
        job: "spark-chat",
        taskId: expect.stringContaining("-step-1"),
        timings: expect.objectContaining({
          totalMs: 120,
          activeGenerationMs: 90,
        }),
        timestamp: "2026-03-24T10:05:00.000Z",
      }),
    );
    expect(publishSparkAgentProcessMetricsFromEnvMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: "chat",
        status: "ok",
        job: "spark-chat",
        taskId: expect.stringContaining("-process"),
        cpuUtilization: expect.any(Number),
        cpuTimeMs: expect.any(Number),
        rssPeakBytes: expect.any(Number),
      }),
    );
    expect(result.text).toBe("Hello");
  });

  it("still records chat process metrics when the run fails", async () => {
    runAgentLoopMock.mockRejectedValue(new Error("boom"));

    const { runSparkChatAgentLoop } =
      await import("../src/agent/sparkChatShared");

    await expect(
      runSparkChatAgentLoop({
        input: "Hi",
        instructions: "Be helpful.",
        tools: {},
      }),
    ).rejects.toThrow("boom");

    expect(publishSparkToolLoopStepMetricsFromEnvMock).not.toHaveBeenCalled();
    expect(publishSparkAgentProcessMetricsFromEnvMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: "chat",
        status: "error",
        job: "spark-chat",
      }),
    );
  });
});
