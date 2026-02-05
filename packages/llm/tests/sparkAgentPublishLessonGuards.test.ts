import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/gcp/firestoreRest", () => {
  return {
    getFirestoreDocument: vi.fn(async () => ({ exists: false, data: null })),
    setFirestoreDocument: vi.fn(async () => ({})),
    patchFirestoreDocument: vi.fn(async () => ({})),
    listFirestoreDocuments: vi.fn(async () => []),
    deleteFirestoreDocument: vi.fn(async () => ({})),
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
      const { buildSparkAgentToolsForTest } = await import(
        "../src/agent/sparkAgentRunner"
      );

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: async () => {},
          moveFile: async () => {},
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      await expect(
        tools.publish_lesson.execute({ sessionId: "s1" }),
      ).rejects.toThrow(/Missing required session grading report/iu);
    });
  });

  it("rejects publish when session-grade pass=false", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentToolsForTest } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "lesson/feedback"), { recursive: true });
      await writeFile(
        path.join(rootDir, "lesson/feedback/session-grade.json"),
        JSON.stringify({ pass: false }, null, 2) + "\n",
        { encoding: "utf8" },
      );

      const tools = buildSparkAgentToolsForTest({
        workspace: {
          scheduleUpdate: () => {},
          deleteFile: async () => {},
          moveFile: async () => {},
        },
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        enforceLessonPipeline: true,
      });

      await expect(
        tools.publish_lesson.execute({ sessionId: "s1" }),
      ).rejects.toThrow(/pass=false/iu);
    });
  });
});
