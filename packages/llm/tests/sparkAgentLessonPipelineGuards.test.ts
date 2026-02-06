import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-pipeline-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Spark agent lesson pipeline guards", () => {
  it("exposes the expected toolset", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      const names = Object.keys(tools);
      const expected = [
        "publish_lesson",
        "python_exec",
        "generate_text",
        "generate_json",
        "validate_json",
        "validate_schema",
        "list_files",
        "read_file",
        "read_files",
        "write_file",
        "delete_file",
        "move_file",
        "apply_patch",
      ];

      for (const name of expected) {
        expect(names).toContain(name);
      }
    });
  });

  it("rejects JSON writes via generate_text", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      await expect(
        tools.generate_text.execute({
          promptPath: "lesson/prompts/session-draft.md",
          outputPath: "lesson/output/session.json",
        }),
      ).rejects.toThrow(/generate_text cannot write JSON/iu);
    });
  });

  it("accepts common LLM argument shapes for generate_text (string/null coercions)", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      const parsed = tools.generate_text.inputSchema.parse({
        promptPath: "lesson/prompts/session-draft.md",
        outputPath: "lesson/drafts/session.md",
        inputPaths: "lesson/requirements.md",
        tools: "web-search",
        modelId: null,
      }) as {
        inputPaths?: string[];
        tools?: string[];
        modelId?: string;
      };

      expect(parsed.inputPaths).toEqual(["lesson/requirements.md"]);
      expect(parsed.tools).toEqual(["web-search"]);
      expect(parsed.modelId).toBeUndefined();
    });
  });

  it("requires outputPath for session drafts during lesson runs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      const result = tools.generate_text.inputSchema.safeParse({
        promptPath: "lesson/prompts/session-draft.md",
      });

      expect(result.success).toBe(false);
    });
  });

  it("requires outputPath for quiz drafts during lesson runs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      const result = tools.generate_text.inputSchema.safeParse({
        promptPath: "lesson/prompts/quiz-draft.md",
      });

      expect(result.success).toBe(false);
    });
  });
});
