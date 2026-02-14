import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { requireFunctionTool } from "./toolAssertions";

vi.mock("pyodide", () => {
  return {
    loadPyodide: () => {
      return {
        runPythonAsync: () => {
          return JSON.stringify({
            ok: true,
            stdout: "STDOUT\n",
            stderr: "",
          });
        },
      };
    },
  };
});

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-python-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Spark agent tool: python_exec", () => {
  it("writes stdout/stderr files and reports ok", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      await writeFile(path.join(rootDir, "script.py"), "print('hi')\n", "utf8");
      await writeFile(path.join(rootDir, "in.txt"), "input\n", "utf8");

      const scheduled: string[] = [];
      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: (p) => {
            scheduled.push(p);
          },
          deleteFile: () => Promise.resolve(),
          moveFile: () => Promise.resolve(),
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
      });

      const pythonExecTool = tools.python_exec;
      requireFunctionTool(pythonExecTool);

      const out = await pythonExecTool.execute({
        scriptPath: "script.py",
        stdinPath: "in.txt",
        stdoutPath: "out.txt",
        stderrPath: "err.txt",
      });

      if (!out || typeof out !== "object" || Array.isArray(out)) {
        throw new Error("python_exec result must be a plain object");
      }
      const record = out as Record<string, unknown>;
      expect(record.ok).toBe(true);
      expect(record.written).toEqual(["out.txt", "err.txt"]);
      expect(scheduled).toContain("out.txt");
      expect(scheduled).toContain("err.txt");

      const stdout = await readFile(path.join(rootDir, "out.txt"), "utf8");
      const stderr = await readFile(path.join(rootDir, "err.txt"), "utf8");
      expect(stdout).toBe("STDOUT\n");
      expect(stderr).toBe("");
    });
  });
});
