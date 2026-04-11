import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("prepareSparkGraderReplayWorkspace", () => {
  it("requires captured replay artifacts", async () => {
    const { prepareSparkGraderReplayWorkspace } = await import(
      "../src/agent/sparkAgentReplay"
    );

    const sourceRunDir = await makeTempDir("spark-replay-source-");
    const targetWorkspaceDir = await makeTempDir("spark-replay-target-");

    await mkdir(path.join(sourceRunDir, "grader"), { recursive: true });
    await writeFile(path.join(sourceRunDir, "brief.md"), "brief\n", "utf8");
    await writeFile(path.join(sourceRunDir, "request.json"), "{}\n", "utf8");
    await writeFile(
      path.join(sourceRunDir, "grader", "task.md"),
      "legacy fallback seed\n",
      "utf8",
    );

    await expect(
      prepareSparkGraderReplayWorkspace({
        sourceRunDir,
        targetWorkspaceDir,
      }),
    ).rejects.toThrowError(/Legacy grader fallback replays are no longer supported\./);
  });

  it("copies the captured snapshot and reuses the captured prompts", async () => {
    const { prepareSparkGraderReplayWorkspace } = await import(
      "../src/agent/sparkAgentReplay"
    );
    const {
      SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
      SPARK_AGENT_REPLAY_MANIFEST_PATH,
    } = await import("../src/agent/sparkAgentReplayArtifacts");

    const sourceRunDir = await makeTempDir("spark-replay-source-");
    const targetWorkspaceDir = await makeTempDir("spark-replay-target-");
    const snapshotDir = path.join(
      sourceRunDir,
      SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
    );
    await mkdir(path.join(snapshotDir, "grader", "uploads"), {
      recursive: true,
    });
    await writeFile(path.join(snapshotDir, "brief.md"), "snapshot brief\n", "utf8");
    await writeFile(
      path.join(snapshotDir, "grader", "uploads", "index.json"),
      '{"attachments":[]}\n',
      "utf8",
    );
    await writeFile(
      path.join(sourceRunDir, SPARK_AGENT_REPLAY_MANIFEST_PATH),
      JSON.stringify(
        {
          version: 1,
          agentKind: "grader",
          capturedAt: "2026-03-16T12:00:00.000Z",
          prompt: "captured prompt",
          systemPrompt: "captured system prompt",
          modelId: "chatgpt-gpt-5.4-fast",
          thinkingLevel: "medium",
          maxSteps: 123,
          useSubagents: false,
          grader: {
            summaryPath: "grader/output/run-summary.json",
            sheetPath: "grader/output/sheet.json",
          },
        },
        null,
        2,
      ).concat("\n"),
      "utf8",
    );

    const prepared = await prepareSparkGraderReplayWorkspace({
      sourceRunDir,
      targetWorkspaceDir,
    });

    expect(prepared).toMatchObject({
      sourceMode: "captured-snapshot",
      prompt: "captured prompt",
      systemPrompt: "captured system prompt",
      sourceModelId: "chatgpt-gpt-5.4-fast",
      sourceThinkingLevel: "medium",
      sourceMaxSteps: 123,
      sourceUseSubagents: false,
    });
    await expect(readFile(path.join(targetWorkspaceDir, "brief.md"), "utf8")).resolves.toBe(
      "snapshot brief\n",
    );
  });
});
