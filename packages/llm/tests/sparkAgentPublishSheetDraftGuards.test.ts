import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { SparkSolveSheetDraftSchema } from "@spark/schemas";

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
    path.join(os.tmpdir(), "spark-sheet-draft-publish-test-"),
  );
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("Spark agent tool: publish_sheet_draft guards", () => {
  it("normalizes legacy worksheet draft fields before publishing", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "sheet/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "sheet/output/run-summary.json"),
        JSON.stringify(
          {
            presentation: {
              title: "Division of fractions (2)",
              summaryMarkdown:
                "Worksheet draft prepared from the uploaded fractions exercise.",
            },
            sheet: {
              title: "Division of fractions (2)",
              filePath: "sheet/output/draft.json",
            },
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeFile(
        path.join(rootDir, "sheet/output/draft.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            mode: "draft",
            sheet: {
              id: "division-of-fractions-2",
              subject: "Mathematics",
              level: "Fractions",
              title: "Division of fractions (2)",
              subtitle:
                "Learning objective: Divide an integer or a fraction by a fraction and use the notation of reciprocals.",
              color: "#36587A",
              accent: "#4D7AA5",
              light: "#E8F2FB",
              border: "#BFD0E0",
              sections: [
                {
                  title: "A. Multiple choice questions",
                  instructions: "Choose the correct answer.",
                  questions: [
                    {
                      type: "mcq",
                      displayNumber: "1",
                      promptMarkdown:
                        "The correct calculation of the following is (___).",
                      options: [
                        { id: "A", text: "$$\\frac{1}{2}$$" },
                        { id: "B", text: "$$\\frac{3}{4}$$" },
                      ],
                    },
                  ],
                },
                {
                  title: "B. Fill in the blanks",
                  questions: [
                    {
                      type: "fill",
                      displayNumber: "5",
                      promptMarkdown: "___________ of $\\frac{1}{8}$ is 5.",
                    },
                  ],
                },
                {
                  title: "C. Questions that require solutions",
                  questions: [
                    {
                      type: "calc",
                      displayNumber: "9(a)",
                      promptMarkdown:
                        "Calculate.\n\n$$3\\frac{1}{3}\\div \\frac{9}{2}$$",
                    },
                    {
                      type: "flow",
                      displayNumber: "12",
                      promptMarkdown:
                        "Complete the flow chart of calculation. Write a suitable number in each box.",
                      boxes: [
                        { id: "top0", initialValue: "1", editable: false },
                        { id: "top1" },
                        { id: "top2" },
                        { id: "bottom1" },
                        { id: "bottom0" },
                      ],
                      arrows: [
                        {
                          from: "top0",
                          to: "top1",
                          label: "$\\div\\ \\frac{2}{3}$",
                        },
                        { from: "top1", to: "top2", label: "$\\times\\ 2$" },
                        { from: "bottom1", to: "bottom0", label: "$-\\ 3$" },
                      ],
                    },
                  ],
                },
              ],
            },
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
        sheetDraftPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetDraftTool = tools.publish_sheet_draft;
      requireFunctionTool(publishSheetDraftTool);

      await expect(publishSheetDraftTool.execute({})).resolves.toMatchObject({
        status: "published",
        mode: "mock",
      });

      const normalizedRaw = await readFile(
        path.join(rootDir, "sheet/output/draft.json"),
        "utf8",
      );
      const normalized = SparkSolveSheetDraftSchema.parse(
        JSON.parse(normalizedRaw),
      );
      expect(normalized.sheet.sections[0]).toMatchObject({
        id: "A",
        label: "Multiple choice questions",
      });
      const secondSection = normalized.sheet.sections[1];
      if (!("id" in secondSection)) {
        throw new Error("Expected normalized content section.");
      }
      expect(secondSection.questions?.[0]?.type).toBe("cloze");
      const thirdSection = normalized.sheet.sections[2];
      if (!("id" in thirdSection)) {
        throw new Error("Expected normalized content section.");
      }
      expect(thirdSection.questions?.[0]?.type).toBe("lines");
      expect(thirdSection.questions?.[1]?.type).toBe("flow");
    });
  });

  it("rejects worksheet drafts with empty content sections", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "sheet/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "sheet/output/run-summary.json"),
        JSON.stringify(
          {
            presentation: {
              title: "Interest worksheet",
              summaryMarkdown: "Student worksheet prepared from the upload.",
            },
            sheet: {
              title: "Interest worksheet",
              filePath: "sheet/output/draft.json",
            },
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeFile(
        path.join(rootDir, "sheet/output/draft.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            mode: "draft",
            sheet: {
              id: "interest-worksheet",
              subject: "Mathematics",
              level: "Secondary",
              title: "Interest worksheet",
              subtitle: "Solve the worksheet.",
              color: "#36587A",
              accent: "#4D7AA5",
              light: "#E8F2FB",
              border: "#BFD0E0",
              sections: [
                {
                  id: "A",
                  label: "Multiple choice questions",
                  questions: [
                    {
                      id: "q1",
                      type: "mcq",
                      displayNumber: "1",
                      marks: 1,
                      prompt: "Choose the correct answer.",
                      options: ["A", "B"],
                    },
                  ],
                },
                {
                  id: "B",
                  label: "Fill in the blanks",
                },
              ],
            },
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
        sheetDraftPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetDraftTool = tools.publish_sheet_draft;
      requireFunctionTool(publishSheetDraftTool);

      await expect(publishSheetDraftTool.execute({})).rejects.toThrow(
        "Worksheet content sections need at least one question, theory block, or info box.",
      );
    });
  });

  it("accepts grouped multipart questions and counts child questions", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "sheet/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "sheet/output/run-summary.json"),
        JSON.stringify(
          {
            presentation: {
              title: "Interest worksheet",
              summaryMarkdown: "Student worksheet prepared from the upload.",
            },
            sheet: {
              title: "Interest worksheet",
              filePath: "sheet/output/draft.json",
            },
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeFile(
        path.join(rootDir, "sheet/output/draft.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            mode: "draft",
            sheet: {
              id: "interest-worksheet",
              subject: "Mathematics",
              level: "Secondary",
              title: "Interest worksheet",
              subtitle: "Solve the worksheet.",
              color: "#36587A",
              accent: "#4D7AA5",
              light: "#E8F2FB",
              border: "#BFD0E0",
              sections: [
                {
                  id: "C",
                  label: "Questions that require solutions",
                  questions: [
                    {
                      id: "q10",
                      type: "group",
                      displayNumber: "10",
                      prompt:
                        "For Question 10, use the table below.\n\n| Duration | Before | After |\n| --- | ---: | ---: |\n| 2 years | 4.14% | 3.06% |",
                      questions: [
                        {
                          id: "q10a",
                          type: "fill",
                          displayNumber: "10(a)",
                          badgeLabel: "a",
                          marks: 1,
                          prompt: "The difference is £",
                          blanks: [{}],
                          after: ".",
                        },
                        {
                          id: "q10b",
                          type: "lines",
                          displayNumber: "10(b)",
                          badgeLabel: "b",
                          marks: 1,
                          prompt: "Explain which option earns more interest.",
                          lines: 4,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
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
        sheetDraftPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetDraftTool = tools.publish_sheet_draft;
      requireFunctionTool(publishSheetDraftTool);

      await expect(publishSheetDraftTool.execute({})).resolves.toMatchObject({
        status: "published",
        mode: "mock",
      });

      const normalizedRaw = await readFile(
        path.join(rootDir, "sheet/output/draft.json"),
        "utf8",
      );
      const normalized = SparkSolveSheetDraftSchema.parse(
        JSON.parse(normalizedRaw),
      );
      const section = normalized.sheet.sections[0];
      if (!("id" in section)) {
        throw new Error("Expected grouped content section.");
      }
      expect(section.questions?.[0]).toMatchObject({
        type: "group",
        displayNumber: "10",
      });
      if (section.questions?.[0]?.type !== "group") {
        throw new Error("Expected grouped question.");
      }
      expect(section.questions[0].questions[0]).toMatchObject({
        displayNumber: "10(a)",
        badgeLabel: "a",
      });
      expect(section.questions[0].questions[1]).toMatchObject({
        displayNumber: "10(b)",
        badgeLabel: "b",
      });
    });
  });
});
