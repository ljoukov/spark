import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { runJobsWithConcurrency } from "../src/utils/concurrency";

describe("runJobsWithConcurrency cost tracking", () => {
  it("shows reported cost even when no token usage is available", async () => {
    const output = new PassThrough();
    let rendered = "";
    output.on("data", (chunk) => {
      rendered += chunk.toString("utf8");
    });

    await runJobsWithConcurrency({
      items: ["job"],
      concurrency: 1,
      label: "Cost check",
      statusMode: "plain",
      updateIntervalMs: 1,
      output: output as unknown as NodeJS.WriteStream,
      getId: (item) => item,
      handler: async (_item, { progress }) => {
        const handle = progress.startModelCall({
          modelId: "chatgpt-gpt-5.4-fast",
          uploadBytes: 0,
        });
        progress.recordModelUsage(handle, {
          modelVersion: "chatgpt-gpt-5.4-fast",
          costUsd: 0.25,
        });
        progress.finishModelCall(handle);
        return null;
      },
    });

    expect(rendered).toContain("cost: $0.2500");
    expect(rendered).toContain("models: chatgpt-gpt-5.4-fast");
  });
});
