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
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-sheet-publish-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeValidSheetArtifacts(rootDir: string): Promise<void> {
  await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
  await writeFile(
    path.join(rootDir, "grader/output/run-summary.json"),
    JSON.stringify(
      {
        contextLabel: "Section 2 Test 5",
        presentation: {
          title: "English grammar worksheet Section 2 Test 5",
          subtitle: "Student answers checked against the uploaded worksheet page.",
          summaryMarkdown: "Checked the visible worksheet page and prepared the first feedback notes.",
          footer: "Section 2 Test 5 · uploaded worksheet"
        },
        totals: {
          awardedMarks: 1,
          maxMarks: 1
        },
        sheet: {
          title: "English grammar worksheet Section 2 Test 5",
          filePath: "grader/output/sheet.json"
        }
      },
      null,
      2
    ).concat("\n"),
    { encoding: "utf8" }
  );
  await writeFile(
    path.join(rootDir, "grader/output/sheet.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        sheet: {
          id: "sheet-1",
          subject: "English",
          level: "KS2",
          title: "English grammar worksheet Section 2 Test 5",
          subtitle: "Schofield & Sims worksheet",
          color: "#123456",
          accent: "#345678",
          light: "#f0f4f8",
          border: "#89abcd",
          sections: [
            {
              id: "A",
              label: "Section A",
              questions: [
                {
                  id: "q1",
                  type: "fill",
                  marks: 1,
                  prompt: "The",
                  blanks: [{ placeholder: "word" }],
                  after: "cat slept."
                }
              ]
            }
          ]
        },
        answers: {
          q1: {
            "0": "black"
          }
        },
        review: {
          score: {
            got: 1,
            total: 1
          },
          label: "1/1",
          message: "Solid start.",
          note: "Good first answer.",
          questions: {
            q1: {
              status: "correct",
              note: "That fits the sentence."
            }
          }
        }
      },
      null,
      2
    ).concat("\n"),
    { encoding: "utf8" }
  );
}

describe("Spark agent tool: publish_sheet guards", () => {
  it("requires grader/output/run-summary.json", async () => {
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /Missing required grader summary/iu,
      );
    });
  });

  it("rejects publish when the worksheet artifact fails schema validation", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "grader/output/run-summary.json"),
        JSON.stringify(
          {
            presentation: {
              title: "English grammar worksheet Section 2 Test 5",
              subtitle: "Student answers checked against the uploaded worksheet page.",
              summaryMarkdown: "Checked the visible worksheet page.",
              footer: "Section 2 Test 5 · uploaded worksheet"
            },
            totals: {
              awardedMarks: 1,
              maxMarks: 1
            },
            sheet: {
              title: "English grammar worksheet Section 2 Test 5",
              filePath: "grader/output/sheet.json"
            }
          },
          null,
          2
        ).concat("\n"),
        { encoding: "utf8" }
      );
      await writeFile(
        path.join(rootDir, "grader/output/sheet.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            sheet: {
              id: "sheet-1",
              subject: "English",
              level: "KS2",
              title: "English grammar worksheet Section 2 Test 5",
              subtitle: "Schofield & Sims worksheet",
              color: "#123456",
              accent: "#345678",
              light: "#f0f4f8",
              border: "#89abcd",
              sections: [
                {
                  id: "A",
                  label: "Section A",
                  questions: [
                    {
                      id: "q1",
                      type: "spelling",
                      marks: 1,
                      prompt: "Fix the spelling.",
                      words: ["teh"]
                    }
                  ]
                }
              ]
            },
            answers: {
              q1: {
                "0": "the"
              }
            },
            review: {
              score: {
                got: 1,
                total: 1
              },
              label: "1/1",
              message: "Solid start.",
              note: "Good first answer.",
              questions: {
                q1: {
                  status: "correct",
                  note: "That fixes the spelling."
                }
              }
            }
          },
          null,
          2
        ).concat("\n"),
        { encoding: "utf8" }
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed schema validation/iu,
      );
    });
  });

  it("publishes a valid worksheet artifact in mock mode", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await writeValidSheetArtifacts(rootDir);
      let published = false;

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
          href: "/spark/sheets/sheet-1",
        },
        onPublishSheet: () => {
          published = true;
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        mode: "mock",
        href: "/spark/sheets/sheet-1",
        presentationTitle: "English grammar worksheet Section 2 Test 5",
        awardedMarks: 1,
        maxMarks: 1,
      });
      expect(published).toBe(true);
    });
  });
});
