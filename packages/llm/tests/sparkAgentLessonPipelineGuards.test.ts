import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { createFilesystemToolSetForModel } from "@ljoukov/llm";

import { requireFunctionTool } from "./toolAssertions";

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
      const {
        buildSparkAgentFilesystemToolConfig,
        buildSparkAgentTools,
        resolveSparkAgentFilesystemToolNames,
      } =
        await import("../src/agent/sparkAgentRunner");

      const workspace = {
        scheduleUpdate: () => {},
        deleteFile: () => Promise.resolve(),
        moveFile: () => Promise.resolve(),
      };
      const tools = buildSparkAgentTools({
        workspace,
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });
      const filesystemToolConfig = buildSparkAgentFilesystemToolConfig({
        workspace,
        rootDir,
      });
      const filesystemTools = createFilesystemToolSetForModel(
        "chatgpt-gpt-5.5-fast",
        filesystemToolConfig.profile ?? "auto",
        filesystemToolConfig.options,
      );

      expect(Object.keys(filesystemTools).sort()).toEqual(
        [...resolveSparkAgentFilesystemToolNames()].sort(),
      );

      const names = new Set([
        ...Object.keys(tools),
        ...Object.keys(filesystemTools),
      ]);
      const expected = [
        "publish_lesson",
        "python_exec",
        "generate_text",
        "generate_json",
        "validate_json",
        "validate_schema",
        "apply_patch",
        "read_file",
        "list_dir",
        "grep_files",
        "view_image",
      ];

      for (const name of expected) {
        expect(names.has(name)).toBe(true);
      }
      expect(Object.keys(tools)).not.toContain("list_files");
      expect(Object.keys(tools)).not.toContain("read_files");
      expect(Object.keys(tools)).not.toContain("write_file");
      expect(Object.keys(tools)).not.toContain("move_file");
      expect(Object.keys(tools)).not.toContain("delete_file");
    });
  });

  it("mirrors native codex filesystem edits through workspace hooks", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentFilesystemToolConfig } =
        await import("../src/agent/sparkAgentRunner");

      const scheduled: string[] = [];
      const deleted: string[] = [];
      const moved: Array<{ from: string; to: string }> = [];
      const filesystemToolConfig = buildSparkAgentFilesystemToolConfig({
        workspace: {
          scheduleUpdate: (filePath) => {
            scheduled.push(filePath);
          },
          deleteFile: async (filePath) => {
            deleted.push(filePath);
          },
          moveFile: async (from, to) => {
            moved.push({ from, to });
          },
        },
        rootDir,
      });
      const filesystemTools = createFilesystemToolSetForModel(
        "chatgpt-gpt-5.5-fast",
        filesystemToolConfig.profile ?? "auto",
        filesystemToolConfig.options,
      );
      const applyPatchTool = filesystemTools.apply_patch as {
        execute: (input: string) => Promise<unknown>;
      };

      await applyPatchTool.execute(`*** Begin Patch
*** Add File: created.txt
+hello
*** End Patch
`);
      await expect(readFile(path.join(rootDir, "created.txt"), "utf8")).resolves.toBe(
        "hello\n",
      );
      expect(scheduled).toContain("created.txt");

      await writeFile(path.join(rootDir, "old.txt"), "old\n", "utf8");
      await applyPatchTool.execute(`*** Begin Patch
*** Update File: old.txt
*** Move to: renamed.txt
@@
-old
+new
*** End Patch
`);
      await expect(
        readFile(path.join(rootDir, "renamed.txt"), "utf8"),
      ).resolves.toBe("new\n");
      expect(moved).toEqual([{ from: "old.txt", to: "renamed.txt" }]);

      await writeFile(path.join(rootDir, "gone.txt"), "bye\n", "utf8");
      await applyPatchTool.execute(`*** Begin Patch
*** Delete File: gone.txt
*** End Patch
`);
      expect(deleted).toEqual(["gone.txt"]);
    });
  });

  it("rejects JSON writes via generate_text", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentTools({
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

      const generateTextTool = tools.generate_text;
      requireFunctionTool(generateTextTool);

      await expect(
        generateTextTool.execute({
          promptPath: "lesson/prompts/session-draft.md",
          outputPath: "lesson/output/session.json",
        }),
      ).rejects.toThrow(/generate_text cannot write JSON/iu);
    });
  });

  it("accepts common LLM argument shapes for generate_text (string/null coercions)", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentTools({
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

      const generateTextTool = tools.generate_text;
      requireFunctionTool(generateTextTool);

      const parsed = generateTextTool.inputSchema.parse({
        promptPath: "lesson/prompts/session-draft.md",
        outputPath: "lesson/drafts/session.md",
        inputPaths: "lesson/requirements.md",
        tools: "web-search",
      }) as {
        inputPaths?: string[];
        tools?: string[];
      };

      expect(parsed.inputPaths).toEqual(["lesson/requirements.md"]);
      expect(parsed.tools).toEqual(["web-search"]);
    });
  });

  it("requires outputPath for session drafts during lesson runs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentTools({
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

      const generateTextTool = tools.generate_text;
      requireFunctionTool(generateTextTool);

      const result = generateTextTool.inputSchema.safeParse({
        promptPath: "lesson/prompts/session-draft.md",
      });

      expect(result.success).toBe(false);
    });
  });

  it("requires outputPath for quiz drafts during lesson runs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const tools = buildSparkAgentTools({
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

      const generateTextTool = tools.generate_text;
      requireFunctionTool(generateTextTool);

      const result = generateTextTool.inputSchema.safeParse({
        promptPath: "lesson/prompts/quiz-draft.md",
      });

      expect(result.success).toBe(false);
    });
  });
});
