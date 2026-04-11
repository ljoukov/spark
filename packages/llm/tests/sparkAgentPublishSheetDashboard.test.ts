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
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "spark-sheet-dashboard-publish-test-"),
  );
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Spark agent tool: publish_sheet_dashboard", () => {
  it("requires dashboard/output/dashboard.json", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
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
        sheetDashboardPublish: {
          mode: "mock",
        },
      });

      const publishTool = tools.publish_sheet_dashboard;
      requireFunctionTool(publishTool);

      await expect(publishTool.execute({})).rejects.toThrow(
        /Missing required sheet dashboard output/iu,
      );
    });
  });

  it("publishes a valid sheet dashboard artifact in mock mode", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "dashboard/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "dashboard/output/dashboard.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            mode: "sheet_dashboard",
            headline: "Biology work is strengthening, but graph-reading still slips.",
            summaryMarkdown:
              "- Stronger recall on cells and transport.\n- Watch graph-reading and units.",
            strengths: [
              {
                id: "strength-cells",
                title: "Cell knowledge is sticking",
                summary: "Recent sheets show more secure recall on cell structure and transport.",
                evidenceRunIds: ["run-1"],
                subjectKeys: ["biology"],
                specifics: ["Cell structure", "Transport across membranes"],
                nextSteps: ["Turn the secure recall into full cause-and-effect explanations."],
                generalFeedback: "Keep the precise vocabulary sharp.",
              },
            ],
            weakSpots: [
              {
                id: "weak-graphs",
                title: "Graph-reading needs another pass",
                summary: "Marks are still being dropped when extracting values or trends from graphs.",
                evidenceRunIds: ["run-1"],
                subjectKeys: ["biology"],
                specifics: ["Reading values from line graphs", "Describing trends precisely"],
                nextSteps: ["Practice extracting exact values before writing the conclusion."],
                generalFeedback: "The underlying science looks better than the graph accuracy.",
              },
            ],
            subjects: [
              {
                key: "biology",
                label: "Biology",
                summary: "Biology is the main body of evidence so far.",
                runIds: ["run-1"],
                averagePercentage: 72,
                strongSpots: ["Cell recall"],
                weakSpots: ["Graph-reading"],
                specifics: ["Cells", "Graph interpretation"],
                nextSteps: ["Rehearse graph-reading with units and comparisons."],
                generalFeedback: "Biology is heading in the right direction overall.",
              },
            ],
            runAnalyses: [
              {
                runId: "run-1",
                subjectTags: [{ key: "biology", label: "Biology" }],
                primarySubjectKey: "biology",
                summary: "Mostly biology worksheet evidence.",
                strongSpots: ["Cell recall"],
                weakSpots: ["Graph-reading"],
                specifics: ["Transport vocabulary", "Reading graph values"],
                nextSteps: ["Write the value first, then the trend."],
                generalFeedback: "The paper is strongest when the question is direct.",
              },
            ],
          },
          null,
          2,
        ).concat("\n"),
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
        sheetDashboardPublish: {
          mode: "mock",
        },
      });

      const publishTool = tools.publish_sheet_dashboard;
      requireFunctionTool(publishTool);

      await expect(publishTool.execute({})).resolves.toMatchObject({
        status: "published",
        mode: "mock",
        headline:
          "Biology work is strengthening, but graph-reading still slips.",
        strengthCount: 1,
        weakSpotCount: 1,
        subjectCount: 1,
        runAnalysisCount: 1,
      });
    });
  });
});
