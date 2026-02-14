import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { requireFunctionTool } from "./toolAssertions";

vi.mock("../src/utils/gcp/firestoreRest", () => {
  return {
    getFirestoreDocument: vi.fn(() =>
      Promise.resolve({ exists: false, data: null }),
    ),
    setFirestoreDocument: vi.fn(() => Promise.resolve({})),
    patchFirestoreDocument: vi.fn(() => Promise.resolve({})),
    listFirestoreDocuments: vi.fn(() => Promise.resolve([])),
    deleteFirestoreDocument: vi.fn(() => Promise.resolve({})),
  };
});

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-publish-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Spark agent tool: publish_lesson guards", () => {
  it("requires session-grade report when enforceLessonPipeline=true", async () => {
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

      const publishLessonTool = tools.publish_lesson;
      requireFunctionTool(publishLessonTool);

      await expect(
        publishLessonTool.execute({ sessionId: "s1" }),
      ).rejects.toThrow(/Missing required session grading report/iu);
    });
  });

  it("rejects publish when session-grade pass=false", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } =
        await import("../src/agent/sparkAgentRunner");

      await mkdir(path.join(rootDir, "lesson/feedback"), { recursive: true });
      await writeFile(
        path.join(rootDir, "lesson/feedback/session-grade.md"),
        "# Grade\npass: false\n\n## Issues\n- failing smoke guard\n",
        { encoding: "utf8" },
      );

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

      const publishLessonTool = tools.publish_lesson;
      requireFunctionTool(publishLessonTool);

      await expect(
        publishLessonTool.execute({ sessionId: "s1" }),
      ).rejects.toThrow(/pass=false/iu);
    });
  });
});
