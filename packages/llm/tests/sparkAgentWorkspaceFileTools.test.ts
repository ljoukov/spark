import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildSparkAgentTools } from "../src/agent/sparkAgentRunner";
import { requireFunctionTool } from "./toolAssertions";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-file-tools-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Spark agent workspace file tools", () => {
  it("blocks repeated unbounded reads of large generated references", async () => {
    await withTempDir(async (rootDir) => {
      await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "grader/output/qp-reference.md"),
        Array.from(
          { length: 900 },
          (_, index) =>
            `0 1 . ${(index + 1).toString()} Figure 1 source line ${index + 1}`,
        ).join("\n"),
        { encoding: "utf8" },
      );

      const tools = buildSparkAgentTools({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });
      const readTool = tools.read_workspace_file;
      requireFunctionTool(readTool);

      await expect(
        readTool.execute({ filePath: "grader/output/qp-reference.md" }),
      ).resolves.toContain("compact line-numbered outline");
      await expect(
        readTool.execute({ filePath: "grader/output/qp-reference.md" }),
      ).rejects.toThrow(/repeated unbounded read blocked/iu);
      await expect(
        readTool.execute({
          filePath: "grader/output/qp-reference.md",
          startLine: 68,
          lineCount: 2,
        }),
      ).resolves.toContain("source line 68\n0 1 . 69");
    });
  });

  it("accepts common line-range suffixes on read_workspace_file paths", async () => {
    await withTempDir(async (rootDir) => {
      await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "grader/output/ref.md"),
        Array.from({ length: 20 }, (_, index) =>
          index === 15 ? "literal (? token" : `line ${index + 1}`,
        ).join("\n"),
        { encoding: "utf8" },
      );

      const tools = buildSparkAgentTools({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });
      const readTool = tools.read_workspace_file;
      requireFunctionTool(readTool);

      await expect(
        readTool.execute({ filePath: "grader/output/ref.md#L4-L6" }),
      ).resolves.toContain("line 4\nline 5\nline 6");
      await expect(
        readTool.execute({ filePath: "grader/output/ref.md#dummy-anchor" }),
      ).resolves.toContain("line 1");
      await expect(
        readTool.execute({
          filePath: "grader/output/ref.md?startLine=7&lineCount=2",
        }),
      ).resolves.toContain("line 7\nline 8");
      await expect(
        readTool.execute({ filePath: "grader/output/ref.md:9-10" }),
      ).resolves.toContain("line 9\nline 10");
      await expect(
        readTool.execute({
          filePath: "grader/output/ref.md:startLine=11,lineCount=3",
        }),
      ).resolves.toContain("line 11\nline 12\nline 13");
      await expect(
        readTool.execute({
          filePath: "grader/output/ref.md,startLine=16,lineCount=2",
        }),
      ).resolves.toContain("literal (? token\nline 17");
      await expect(
        readTool.execute({
          filePath: "grader/output/ref.md:line=14&count=2",
        }),
      ).resolves.toContain("line 14\nline 15");
      const startCountResult = await readTool.execute({
        filePath: "grader/output/ref.md:start=18,count=2",
      });
      expect(startCountResult).toContain("line 18\nline 19");
      expect(startCountResult).not.toContain("line 1\nline 2");

      const grepTool = tools.grep_workspace_files;
      requireFunctionTool(grepTool);
      await expect(
        grepTool.execute({
          directoryPath: "grader/output",
          pattern: "(?",
        }),
      ).resolves.toMatchObject({
        patternMode: "literal",
        matches: [expect.objectContaining({ text: "literal (? token" })],
      });
    });
  });
});
