import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/gcp/googleAccessToken", () => {
  return {
    getGoogleAccessToken: vi.fn(async () => ({
      accessToken: "test-access-token",
      projectId: "test-project",
    })),
    parseGoogleServiceAccountJson: vi.fn(() => ({
      projectId: "test-project",
    })),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("listSparkMetricPoints", () => {
  it("returns an empty result when Cloud Monitoring reports a missing metric type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 404,
              message:
                'Cannot find metric(s) that match type = "custom.googleapis.com/spark/llm/call_cost_usd".',
              status: "NOT_FOUND",
            },
          }),
          {
            status: 404,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }),
    );

    const { listSparkMetricPoints } = await import(
      "../src/utils/gcp/monitoring"
    );

    await expect(
      listSparkMetricPoints({
        serviceAccountJson: '{"project_id":"test-project"}',
        metricType: "custom.googleapis.com/spark/llm/call_cost_usd",
        startTime: new Date("2026-03-14T00:00:00.000Z"),
      }),
    ).resolves.toEqual([]);
  });

  it("still throws for other Cloud Monitoring API failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            error: {
              code: 500,
              message: "Internal error",
              status: "INTERNAL",
            },
          }),
          {
            status: 500,
            headers: {
              "content-type": "application/json",
            },
          },
        );
      }),
    );

    const { listSparkMetricPoints } = await import(
      "../src/utils/gcp/monitoring"
    );

    await expect(
      listSparkMetricPoints({
        serviceAccountJson: '{"project_id":"test-project"}',
        metricType: "custom.googleapis.com/spark/llm/call_latency_ms",
        startTime: new Date("2026-03-14T00:00:00.000Z"),
      }),
    ).rejects.toThrow("Monitoring timeSeries.list failed (500)");
  });
});
