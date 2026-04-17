import os from "node:os";
import path from "node:path";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";

import { PNG } from "pngjs";
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
    commitFirestoreWrites: vi.fn(() => Promise.resolve({})),
  };
});

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "spark-sheet-publish-test-"),
  );
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
          subtitle:
            "Student answers checked against the uploaded worksheet page.",
          summaryMarkdown:
            "Checked the visible worksheet page and prepared the first feedback notes.",
          footer: "Section 2 Test 5 · uploaded worksheet",
        },
        totals: {
          awardedMarks: 1,
          maxMarks: 1,
        },
        sheet: {
          title: "English grammar worksheet Section 2 Test 5",
          filePath: "grader/output/sheet.json",
        },
      },
      null,
      2,
    ).concat("\n"),
    { encoding: "utf8" },
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
                  after: "cat slept.",
                },
              ],
            },
          ],
        },
        answers: {
          q1: {
            "0": "black",
          },
        },
        review: {
          score: {
            got: 1,
            total: 1,
          },
          label: "1/1",
          message: "Solid start.",
          note: "Good first answer.",
          questions: {
            q1: {
              status: "correct",
              score: {
                got: 1,
                total: 1,
              },
              note: "",
            },
          },
        },
      },
      null,
      2,
    ).concat("\n"),
    { encoding: "utf8" },
  );
}

async function writeTestPng(options: {
  filePath: string;
  width: number;
  height: number;
  topEdgeLine?: boolean;
}): Promise<void> {
  const png = new PNG({ width: options.width, height: options.height });
  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const offset = (options.width * y + x) << 2;
      png.data[offset] = 255;
      png.data[offset + 1] = 255;
      png.data[offset + 2] = 255;
      png.data[offset + 3] = 255;
    }
  }
  if (options.topEdgeLine) {
    for (let x = 4; x < options.width - 4; x += 1) {
      const offset = x << 2;
      png.data[offset] = 0;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
      png.data[offset + 3] = 255;
    }
  }
  await writeFile(options.filePath, PNG.sync.write(png));
}

async function writeMockPublishArtifacts(options: {
  rootDir: string;
  report: unknown;
  title: string;
  awardedMarks: number;
  maxMarks: number;
  subtitle?: string;
  summaryMarkdown?: string;
  footer?: string;
}): Promise<void> {
  await mkdir(path.join(options.rootDir, "grader/output"), { recursive: true });
  await writeFile(
    path.join(options.rootDir, "grader/output/run-summary.json"),
    JSON.stringify(
      {
        presentation: {
          title: options.title,
          subtitle:
            options.subtitle ??
            "Student answers checked against the uploaded worksheet page.",
          summaryMarkdown:
            options.summaryMarkdown ??
            "Checked the visible worksheet page and prepared feedback notes.",
          footer: options.footer ?? "Uploaded worksheet",
        },
        totals: {
          awardedMarks: options.awardedMarks,
          maxMarks: options.maxMarks,
        },
        sheet: {
          title: options.title,
          filePath: "grader/output/sheet.json",
        },
      },
      null,
      2,
    ).concat("\n"),
    { encoding: "utf8" },
  );
  await writeFile(
    path.join(options.rootDir, "grader/output/sheet.json"),
    JSON.stringify(options.report, null, 2).concat("\n"),
    { encoding: "utf8" },
  );
}

function buildAwaitingAnswersReview(
  totalMarks: number,
  questionIds: readonly string[],
): unknown {
  return {
    mode: "awaiting_answers",
    score: {
      got: 0,
      total: totalMarks,
    },
    label: "Awaiting answers",
    message: "Awaiting answer.",
    note: "",
    questions: Object.fromEntries(
      questionIds.map((questionId) => [
        questionId,
        {
          status: "teacher-review",
          note: "",
        },
      ]),
    ),
  };
}

function buildSingleImageQuestionReport(assetPath: string): unknown {
  return {
    schemaVersion: 1,
    sheet: {
      id: "sheet-1",
      subject: "Science",
      level: "GCSE",
      title: "Science worksheet",
      subtitle: "Uploaded paper",
      color: "#123456",
      accent: "#345678",
      light: "#f0f4f8",
      border: "#89abcd",
      sections: [
        {
          id: "q1",
          label: "Question 1",
          questions: [
            {
              id: "q1",
              type: "lines",
              marks: 1,
              displayNumber: "1",
              prompt: `Figure 1 shows the apparatus.\n\n[![Figure 1](${assetPath})](${assetPath})`,
              lines: 2,
            },
          ],
        },
      ],
    },
    answers: {
      q1: "A suitable answer.",
    },
    review: {
      score: {
        got: 1,
        total: 1,
      },
      label: "1/1",
      message: "Checked.",
      note: "Answer reviewed.",
      questions: {
        q1: {
          status: "correct",
          score: {
            got: 1,
            total: 1,
          },
          note: "Correct.",
        },
      },
    },
  };
}

async function writeValidatedCropAsset(options: {
  rootDir: string;
  assetPath: string;
  sourceLabel: string;
  width?: number;
  height?: number;
}): Promise<void> {
  await mkdir(path.dirname(path.join(options.rootDir, options.assetPath)), {
    recursive: true,
  });
  await writeTestPng({
    filePath: path.join(options.rootDir, options.assetPath),
    width: options.width ?? 20,
    height: options.height ?? 20,
  });
  await writeFile(
    path.join(options.rootDir, "grader/output/crop-validation.md"),
    [
      "# Crop validation",
      "",
      `- crop path: ${options.assetPath}`,
      `  - source label: ${options.sourceLabel}`,
      "  - fresh-context subagent checked: yes",
      "  - reviewer-visible text: none",
      "  - pass/fail: pass",
      "  - all question-relevant content visible: yes",
      "",
    ].join("\n"),
    { encoding: "utf8" },
  );
  await mkdir(path.join(options.rootDir, "logs/agent"), { recursive: true });
  await writeFile(
    path.join(options.rootDir, "logs/agent/agent.log"),
    "tool=validate_crop_with_fresh_agent crop validation\n",
    { encoding: "utf8" },
  );
  await writeFreshCropReviewToolCall(options);
}

async function writeFreshCropReviewToolCall(options: {
  rootDir: string;
  assetPath: string;
  sourceLabel: string;
}): Promise<void> {
  const toolCallDir = path.join(
    options.rootDir,
    "logs/agent/llm_calls/2026-04-13T10-00-00.000Z-0001/chatgpt-gpt-5.4-fast",
  );
  await mkdir(toolCallDir, { recursive: true });
  await writeFile(
    path.join(toolCallDir, "tool_call.txt"),
    JSON.stringify(
      [
        {
          kind: "function",
          name: "validate_crop_with_fresh_agent",
          callId: "call_review",
          arguments: {
            cropPath: options.assetPath,
            sourceLabel: options.sourceLabel,
            questionContext: `Use ${options.sourceLabel}.`,
          },
        },
      ],
      null,
      2,
    ).concat("\n"),
    { encoding: "utf8" },
  );
}

async function writeSourceProblemStatementTranscription(
  rootDir: string,
  markdown = "## Source problem-statement transcription\n\n**Question 1** What is shown in the source paper?\n",
): Promise<void> {
  await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
  await writeFile(
    path.join(rootDir, "grader/output/transcription.md"),
    markdown,
    { encoding: "utf8" },
  );
}

describe("Spark agent tool: publish_sheet guards", () => {
  it("requires grader/output/run-summary.json", async () => {
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
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "grader/output/run-summary.json"),
        JSON.stringify(
          {
            presentation: {
              title: "English grammar worksheet Section 2 Test 5",
              subtitle:
                "Student answers checked against the uploaded worksheet page.",
              summaryMarkdown: "Checked the visible worksheet page.",
              footer: "Section 2 Test 5 · uploaded worksheet",
            },
            totals: {
              awardedMarks: 1,
              maxMarks: 1,
            },
            sheet: {
              title: "English grammar worksheet Section 2 Test 5",
              filePath: "grader/output/sheet.json",
            },
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
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
                      words: ["teh"],
                    },
                  ],
                },
              ],
            },
            answers: {
              q1: {
                "0": "the",
              },
            },
            review: {
              score: {
                got: 1,
                total: 1,
              },
              label: "1/1",
              message: "Solid start.",
              note: "Good first answer.",
              questions: {
                q1: {
                  status: "correct",
                  note: "That fixes the spelling.",
                },
              },
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
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

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

  it("normalizes worksheet aggregate scores from per-question scores before publishing", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeValidSheetArtifacts(rootDir);
      const sheetPath = path.join(rootDir, "grader/output/sheet.json");
      const summaryPath = path.join(rootDir, "grader/output/run-summary.json");
      const sheet = JSON.parse(await readFile(sheetPath, { encoding: "utf8" }));
      sheet.review.score.got = 0;
      sheet.review.label = "0/1";
      await writeFile(sheetPath, JSON.stringify(sheet, null, 2).concat("\n"), {
        encoding: "utf8",
      });
      const summary = JSON.parse(
        await readFile(summaryPath, { encoding: "utf8" }),
      );
      summary.totals.awardedMarks = 0;
      await writeFile(
        summaryPath,
        JSON.stringify(summary, null, 2).concat("\n"),
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
      const normalizedSheet = JSON.parse(
        await readFile(sheetPath, { encoding: "utf8" }),
      );
      const normalizedSummary = JSON.parse(
        await readFile(summaryPath, { encoding: "utf8" }),
      );
      expect(normalizedSheet.review.score.got).toBe(1);
      expect(normalizedSheet.review.label).toBe("1/1");
      expect(normalizedSummary.totals.awardedMarks).toBe(1);
    });
  });

  it("normalizes mechanical grader JSON misses before publishing", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeValidSheetArtifacts(rootDir);
      const sheetPath = path.join(rootDir, "grader/output/sheet.json");
      const summaryPath = path.join(rootDir, "grader/output/run-summary.json");
      const sheet = JSON.parse(await readFile(sheetPath, { encoding: "utf8" }));
      sheet.sheet.color = "green";
      sheet.sheet.accent = "forest";
      sheet.sheet.sections[0].type = "section";
      sheet.sheet.sections[0].title = "Section A";
      delete sheet.sheet.sections[0].id;
      delete sheet.sheet.sections[0].label;
      sheet.sheet.sections[0].questions[0] = {
        id: "q1",
        type: "lines",
        marks: 1,
        prompt: "Explain the answer.",
      };
      sheet.answers.q1 = "Because it matches the mark scheme.";
      sheet.review.mode = "submitted";
      delete sheet.review.questions.q1.status;
      await writeFile(sheetPath, JSON.stringify(sheet, null, 2).concat("\n"), {
        encoding: "utf8",
      });
      const summary = JSON.parse(
        await readFile(summaryPath, { encoding: "utf8" }),
      );
      summary.year = 2024;
      await writeFile(
        summaryPath,
        JSON.stringify(summary, null, 2).concat("\n"),
        { encoding: "utf8" },
      );

      let publishedYear: string | undefined;
      const scheduledPaths: string[] = [];
      const tools = buildSparkAgentTools({
        workspace: {
          scheduleUpdate: (filePath) => {
            scheduledPaths.push(filePath);
          },
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
        onPublishSheet: (publication) => {
          publishedYear = publication.paper?.year;
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
      expect(publishedYear).toBe("2024");
      const normalizedSheet = JSON.parse(
        await readFile(sheetPath, { encoding: "utf8" }),
      );
      const normalizedSummary = JSON.parse(
        await readFile(summaryPath, { encoding: "utf8" }),
      );
      expect(normalizedSheet.review.questions.q1.status).toBe("correct");
      expect(normalizedSheet.sheet.color).toBe("#2F6F3E");
      expect(normalizedSheet.sheet.accent).toBe("#327A45");
      expect(normalizedSheet.sheet.sections[0].id).toBe("section-1");
      expect(normalizedSheet.sheet.sections[0].label).toBe("Section A");
      expect(normalizedSheet.sheet.sections[0].type).toBeUndefined();
      expect(normalizedSheet.sheet.sections[0].questions[0].lines).toBe(4);
      expect(normalizedSheet.review.mode).toBe("graded");
      expect(normalizedSummary.year).toBe("2024");
      expect(scheduledPaths).toEqual(
        expect.arrayContaining([
          "grader/output/sheet.json",
          "grader/output/run-summary.json",
        ]),
      );
    });
  });

  it("coerces a bare worksheet-shaped grader artifact before publishing", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "AQA Biology Paper 1H work",
        awardedMarks: 1,
        maxMarks: 2,
        report: {
          title: "AQA Biology Paper 1H work",
          subtitle: "June 2024",
          subject: "Biology",
          level: "GCSE",
          review: {
            mode: "graded",
            score: { got: 1, total: 2 },
            message: "Good start.",
            questions: {
              q01_1: {
                score: { got: 1, total: 2 },
                note: "Add the second marking point.",
              },
            },
          },
          references: {
            overallFeedbackMarkdown: "Compared with the uploaded mark scheme.",
          },
          sections: [
            {
              id: "sec01",
              type: "group",
              displayNumber: "01",
              prompt: "Cardiovascular disease",
              questions: [
                {
                  id: "q01_1",
                  type: "lines",
                  displayNumber: "01.1",
                  marks: 2,
                  prompt: "Explain why pressure on the heart helps.",
                  answer: "It pushes blood.",
                },
              ],
            },
          ],
        },
      });

      const scheduledPaths: string[] = [];
      const tools = buildSparkAgentTools({
        workspace: {
          scheduleUpdate: (filePath) => {
            scheduledPaths.push(filePath);
          },
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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 2,
      });
      const normalizedSheet = JSON.parse(
        await readFile(path.join(rootDir, "grader/output/sheet.json"), {
          encoding: "utf8",
        }),
      );
      expect(normalizedSheet.schemaVersion).toBe(1);
      expect(normalizedSheet.sheet.sections[0].questions[0].questions[0].lines).toBe(
        4,
      );
      expect(normalizedSheet.answers.q01_1).toBe("It pushes blood.");
      expect(normalizedSheet.review.label).toBe("1/2");
      expect(normalizedSheet.review.note).toBe("");
      expect(normalizedSheet.review.questions.q01_1.status).toBe("incorrect");
      expect(scheduledPaths).toContain("grader/output/sheet.json");
    });
  });

  it("publishes a source-paper-only unanswered MCQ worksheet with blank answers", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "What is 2 + 2?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "3" },
                      { id: "B", label: "B", text: "4" },
                      { id: "C", label: "C", text: "5" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: buildAwaitingAnswersReview(5, ["q1"]),
          references: {
            officialProblemMarkdown:
              "Uploaded source paper only. No answer key or solution baseline is included in this worksheet.",
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Problem statement transcription\n\n**Question 1** What is 2 + 2?\n",
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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 0,
        maxMarks: 5,
      });
    });
  });

  it("rejects source-paper-only unanswered worksheets with per-question zero scores", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "What is 2 + 2?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "3" },
                      { id: "B", label: "B", text: "4" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: {
            mode: "awaiting_answers",
            score: {
              got: 0,
              total: 5,
            },
            label: "Awaiting answers",
            message: "Awaiting answer.",
            note: "This worksheet is ready for the student to answer.",
            questions: {
              q1: {
                status: "teacher-review",
                statusLabel: "Awaiting answer",
                score: {
                  got: 0,
                  total: 5,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Problem statement transcription\n\n**Question 1** What is 2 + 2?\n",
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
        /includes a per-question score/iu,
      );
    });
  });

  it("publishes source-paper-only label-only MCQ options without invented option text", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt:
                      "The diagram labels the possible positions A, B, C, D and E. Which position is correct?\n\n[![Question 1 diagram](grader/output/assets/q1-diagram.png)](grader/output/assets/q1-diagram.png)",
                    displayMode: "labels_only",
                    options: [
                      { id: "A", label: "A" },
                      { id: "B", label: "B" },
                      { id: "C", label: "C" },
                      { id: "D", label: "D" },
                      { id: "E", label: "E" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: buildAwaitingAnswersReview(5, ["q1"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Problem statement transcription\n\n**Question 1** Which position is correct?\n",
      );
      await writeValidatedCropAsset({
        rootDir,
        assetPath: "grader/output/assets/q1-diagram.png",
        sourceLabel: "Question 1 diagram",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 0,
        maxMarks: 5,
      });
    });
  });

  it("normalizes linked worksheet crop assets to 512px JPEGs on publish", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");
      const { getSharp } = await import("../src/utils/sharp");
      const assetPath = "grader/output/assets/figure-1.png";

      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
        width: 1600,
        height: 900,
      });

      const scheduledPaths: string[] = [];
      const tools = buildSparkAgentTools({
        workspace: {
          scheduleUpdate: (filePath) => {
            scheduledPaths.push(filePath);
          },
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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });

      const jpgPath = "grader/output/assets/figure-1.jpg";
      const sheetRaw = await readFile(
        path.join(rootDir, "grader/output/sheet.json"),
        { encoding: "utf8" },
      );
      expect(sheetRaw).toContain(jpgPath);
      expect(sheetRaw).not.toContain(assetPath);
      const cropValidationRaw = await readFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        { encoding: "utf8" },
      );
      expect(cropValidationRaw).toContain(jpgPath);
      expect(cropValidationRaw).not.toContain(assetPath);
      const metadata = await getSharp()(
        await readFile(path.join(rootDir, jpgPath)),
      ).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(
        Math.max(metadata.width ?? 0, metadata.height ?? 0),
      ).toBeLessThanOrEqual(512);
      expect(scheduledPaths).toEqual(
        expect.arrayContaining([
          jpgPath,
          "grader/output/crop-validation.md",
          "grader/output/sheet.json",
        ]),
      );
    });
  });

  it("rejects visual prompts that defer the crop to references", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q15",
                label: "Question 15",
                questions: [
                  {
                    id: "q15",
                    type: "mcq",
                    displayNumber: "15",
                    marks: 5,
                    prompt:
                      "The diagram shows five possible folds. Source figure included in transcription/reference markdown.",
                    displayMode: "labels_only",
                    options: [
                      { id: "A", label: "A" },
                      { id: "B", label: "B" },
                      { id: "C", label: "C" },
                      { id: "D", label: "D" },
                      { id: "E", label: "E" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q15: "",
          },
          review: buildAwaitingAnswersReview(5, ["q15"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /references a visual.*visible worksheet crop/iu,
      );
    });
  });

  it("allows explicit linked-source PDF visual references without worksheet crops", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 0,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q4",
                label: "Question 4",
                questions: [
                  {
                    id: "q4",
                    type: "lines",
                    displayNumber: "4",
                    marks: 2,
                    prompt:
                      "Use Figure 3 in the linked original PDF. Explain how the structure is adapted.",
                    lines: 3,
                  },
                ],
              },
            ],
          },
          answers: {
            q4: "",
          },
          review: buildAwaitingAnswersReview(2, ["q4"]),
          references: {
            paperUrl: "https://example.com/original-paper.pdf",
            officialProblemMarkdown:
              "The source paper is linked as the original PDF for visual reference.",
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Source problem-statement transcription\n\n**Question 4** Figure 3 shows the structure used in this question.\n",
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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 0,
        maxMarks: 2,
      });
    });
  });

  it("allows compact handwritten grading reports without full source-paper visual reconstruction", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Science grading report",
        awardedMarks: 4,
        maxMarks: 4,
        footer: "Submitted answer booklet",
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Science",
            level: "GCSE",
            title: "GCSE Science grading report",
            subtitle: "Uploaded work",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "questions-1-2",
                label: "Questions 1-2",
                questions: [
                  {
                    id: "q1",
                    type: "group",
                    displayNumber: "1",
                    prompt:
                      "Use Figure 1 in the linked original PDF for the source context.",
                    questions: [
                      {
                        id: "q1a",
                        type: "lines",
                        displayNumber: "1(a)",
                        marks: 1,
                        prompt: "Explain the feature labelled in Figure 1.",
                        lines: 2,
                      },
                      {
                        id: "q1b",
                        type: "lines",
                        displayNumber: "1(b)",
                        marks: 1,
                        prompt: "Use the student's answer to grade the reason.",
                        lines: 2,
                      },
                    ],
                  },
                  {
                    id: "q2",
                    type: "group",
                    displayNumber: "2",
                    prompt:
                      "Use Table 1 in the linked original PDF for the source context.",
                    questions: [
                      {
                        id: "q2a",
                        type: "lines",
                        displayNumber: "2(a)",
                        marks: 1,
                        prompt: "Compare the values in Table 1.",
                        lines: 2,
                      },
                      {
                        id: "q2b",
                        type: "lines",
                        displayNumber: "2(b)",
                        marks: 1,
                        prompt: "State the conclusion from the comparison.",
                        lines: 2,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1a: "Correct feature",
            q1b: "Correct reason",
            q2a: "Correct comparison",
            q2b: "Correct conclusion",
          },
          review: {
            score: {
              got: 4,
              total: 4,
            },
            label: "4/4",
            message: "Strong answers across the submitted work.",
            note: "The submitted answers meet the mark points.",
            questions: {
              q1a: {
                status: "correct",
                score: { got: 1, total: 1 },
                note: "",
              },
              q1b: {
                status: "correct",
                score: { got: 1, total: 1 },
                note: "",
              },
              q2a: {
                status: "correct",
                score: { got: 1, total: 1 },
                note: "",
              },
              q2b: {
                status: "correct",
                score: { got: 1, total: 1 },
                note: "",
              },
            },
          },
          references: {
            paperUrl: "https://example.com/original-paper.pdf",
            officialProblemMarkdown:
              "Figure 1 and Table 1 appear in the linked original PDF.\n\n| Trial | Value |\n| --- | --- |\n| A | 1 |",
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Please grade my handwritten work against the uploaded PDF.",
            input: {},
            attachments: [
              {
                id: "student-page",
                contentType: "image/png",
                sizeBytes: 100,
                filename: "student-page.png",
              },
              {
                id: "source-paper",
                contentType: "application/pdf",
                sizeBytes: 1000,
                filename: "source-paper.pdf",
              },
            ],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        [
          "## Source problem-statement transcription",
          "",
          "**Question 1(a)** Figure 1 shows the labelled feature.",
          "",
          "**Question 2(a)** Table 1 gives the values to compare.",
          "",
        ].join("\n"),
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

      const result = await publishSheetTool.execute({});

      expect(result).toMatchObject({
        status: "published",
        awardedMarks: 4,
        maxMarks: 4,
      });
    });
  });

  it("allows non-visual networking prompts without worksheet crops", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Computer systems worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Computer Science",
            level: "GCSE",
            title: "Computer systems worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "q2",
                label: "Question 2",
                questions: [
                  {
                    id: "q2",
                    type: "lines",
                    displayNumber: "2",
                    marks: 1,
                    prompt:
                      "Describe one benefit of using a wired network in a local area network.",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q2: "Lower latency.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Checked.",
            note: "Answer reviewed.",
            questions: {
              q2: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("uses the structured source-paper-only flag even when request text is neutral", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 5,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "What is 2 + 2?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "4" },
                      { id: "B", label: "B", text: "5" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "A",
          },
          review: {
            score: {
              got: 5,
              total: 5,
            },
            label: "5/5",
            message: "Complete.",
            note: "Solved from the source paper.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 5,
                  total: 5,
                },
                note: "Correct.",
              },
            },
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText: "Use the attached material.",
            input: {},
            attachments: [],
            sourcePaperOnlyNoStudent: true,
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /source-paper-only request has no student answers/iu,
      );
    });
  });

  it("rejects source-paper-only no-student runs that add fake blank MCQ options", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "What is 2 + 2?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "3" },
                      { id: "B", label: "B", text: "4" },
                      { id: "blank", label: "-", text: "No answer marked" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: buildAwaitingAnswersReview(5, ["q1"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /fake blank\/no-answer or placeholder option/iu,
      );
    });
  });

  it("rejects source-paper-only no-student runs that invent placeholder option text", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt:
                      "The diagram labels the possible positions A, B, C, D and E.",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "Option A" },
                      { id: "B", label: "B", text: "Option B" },
                      { id: "C", label: "C", text: "Option C" },
                      { id: "D", label: "D", text: "Option D" },
                      { id: "E", label: "E", text: "Option E" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: buildAwaitingAnswersReview(5, ["q1"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /fake blank\/no-answer or placeholder option/iu,
      );
    });
  });

  it("rejects fake no-answer labels in source-paper-only label-only MCQs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "The diagram labels positions A and B.",
                    displayMode: "labels_only",
                    options: [
                      { id: "A", label: "A" },
                      { id: "B", label: "B" },
                      { id: "blank", label: "No answer" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: buildAwaitingAnswersReview(5, ["q1"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /fake blank\/no-answer or placeholder option/iu,
      );
    });
  });

  it("rejects source-paper-only no-student runs that record solved answers", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 5,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "What is 2 + 2?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "4" },
                      { id: "B", label: "B", text: "5" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "A",
          },
          review: {
            score: {
              got: 5,
              total: 5,
            },
            label: "5/5",
            message: "Complete.",
            note: "Solved from the source paper.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 5,
                  total: 5,
                },
                note: "Correct.",
              },
            },
          },
          references: {
            gradingMarkdown: "Answer key: Q1 A",
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*no student answers/iu,
      );
    });
  });

  it("rejects source-paper-only no-student runs with answer-bearing reference fields", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt: "What is 2 + 2?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "3" },
                      { id: "B", label: "B", text: "4" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: buildAwaitingAnswersReview(5, ["q1"]),
          references: {
            officialSolutionMarkdown: "The correct option is B.",
          },
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);

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
        /source-paper-only.*officialSolutionMarkdown is non-empty/iu,
      );
    });
  });

  it("rejects flattened worksheet structure that should stay grouped or structured", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
      await writeFile(
        path.join(rootDir, "grader/output/run-summary.json"),
        JSON.stringify(
          {
            presentation: {
              title: "GCSE Biology worksheet",
              subtitle: "Student answers checked against the uploaded paper.",
              summaryMarkdown:
                "Prepared a worksheet review from the uploaded paper.",
              footer: "Uploaded paper",
            },
            totals: {
              awardedMarks: 1,
              maxMarks: 3,
            },
            sheet: {
              title: "GCSE Biology worksheet",
              filePath: "grader/output/sheet.json",
            },
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeFile(
        path.join(rootDir, "grader/output/sheet.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            sheet: {
              id: "sheet-1",
              subject: "Biology",
              level: "GCSE",
              title: "GCSE Biology worksheet",
              subtitle: "Paper extract",
              color: "#123456",
              accent: "#345678",
              light: "#f0f4f8",
              border: "#89abcd",
              sections: [
                {
                  id: "S1",
                  label: "Question 1",
                  questions: [
                    {
                      id: "q1",
                      type: "lines",
                      marks: 1,
                      prompt: "01.1 What is a tissue?",
                      lines: 2,
                    },
                    {
                      id: "q2",
                      type: "lines",
                      marks: 1,
                      displayNumber: "01.2",
                      prompt:
                        "Name the type of tissue in plants that contains stem cells. Options: meristem, xylem, phloem.",
                      lines: 2,
                    },
                    {
                      id: "q3",
                      type: "lines",
                      marks: 1,
                      displayNumber: "01.3",
                      prompt: "Which plant does aspirin originate from?",
                      lines: 2,
                    },
                  ],
                },
              ],
            },
            answers: {
              q1: "A group of similar cells.",
              q2: "meristem",
              q3: "willow",
            },
            review: {
              score: {
                got: 1,
                total: 3,
              },
              label: "1/3",
              message: "Needs revision.",
              note: "Review the shared stem.",
              questions: {
                q1: {
                  status: "correct",
                  score: {
                    got: 1,
                    total: 1,
                  },
                  note: "Correct.",
                },
                q2: {
                  status: "incorrect",
                  score: {
                    got: 0,
                    total: 1,
                  },
                  note: "Use the correct tissue name.",
                },
                q3: {
                  status: "incorrect",
                  score: {
                    got: 0,
                    total: 1,
                  },
                  note: "Check the plant source again.",
                },
              },
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*synthetic per-question wrapper|failed publish guards.*flattened objective prompt|failed publish guards.*embeds source numbering in prompt/iu,
      );
    });
  });

  it("rejects lone subpart numbering without an explicit parent/group entry", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "A",
                label: "Questions",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "01.1",
                    prompt: "What is a tissue?",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "A group of similar cells.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, "grader/output/assets/figure-1.png"),
        width: 20,
        height: 20,
      });

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
        /failed publish guards.*explicit parent question\/group entry/iu,
      );
    });
  });

  it("rejects flattened MCQ prompts even without a literal Options label", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 0,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "A",
                label: "Questions",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "01",
                    prompt:
                      "Which one of the following tissues contains stem cells? (A) Meristem (B) Xylem (C) Phloem",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "Meristem",
          },
          review: {
            score: {
              got: 0,
              total: 1,
            },
            label: "0/1",
            message: "Needs revision.",
            note: "Use the structured option list.",
            questions: {
              q1: {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 1,
                },
                note: "This should stay as MCQ.",
              },
            },
          },
        },
      });

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
        /failed publish guards.*flattened objective prompt/iu,
      );
    });
  });

  it("rejects worksheets that drop figures or tables preserved in official references", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "A",
                label: "Questions",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "01",
                    prompt: "Use the source material to answer the question.",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "Meristem",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
          references: {
            officialProblemMarkdown:
              "Figure 1 shows a root tip.\n\n| Tissue | Cells |\n| --- | --- |\n| Meristem | Stem cells |",
          },
        },
      });

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
        /failed publish guards.*linked image asset|failed publish guards.*Markdown table/iu,
      );
    });
  });

  it("rejects named source figures and transcribed tables omitted from the worksheet", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "1",
                    prompt:
                      "Figure 9 shows how the investigation was set up. Table 5 shows the results.",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "Blue was fastest.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        [
          "Figure 9 shows how the investigation was set up.",
          "",
          "Table 5",
          "",
          "| Colour of light | Time in seconds |",
          "| --- | --- |",
          "| Blue | 115 |",
        ].join("\n"),
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*Figure 9.*image|failed publish guards.*Table 5.*Markdown table/iu,
      );
    });
  });

  it("rejects transcribed tables represented only as an image crop", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q6",
                label: "Question 6",
                questions: [
                  {
                    id: "q6",
                    type: "group",
                    marks: 1,
                    displayNumber: "6",
                    prompt:
                      "Figure 10 and Table 6 show chlorophyll absorption and wavelength colours.\n\n[![Figure 10 and Table 6](grader/output/assets/q6-figure10-table6.png)](grader/output/assets/q6-figure10-table6.png)",
                    questions: [
                      {
                        id: "q6_9",
                        type: "lines",
                        displayNumber: "6.9",
                        marks: 1,
                        prompt: "Explain the investigation results.",
                        lines: 2,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q6_9: "Blue is absorbed more than green.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q6_9: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath: "grader/output/assets/q6-figure10-table6.png",
        sourceLabel: "Figure 10 and Table 6",
      });
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        [
          "Figure 10 and Table 6 show chlorophyll absorption and wavelength colours.",
          "",
          "Table 6:",
          "",
          "| Range of wavelength of light in nm | 380-435 | 450-499 |",
          "| --- | --- | --- |",
          "| Colour of light | violet | blue |",
        ].join("\n"),
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*Table 6.*Markdown table/iu,
      );
    });
  });

  it("rejects figures whose caption is separated from the crop by a table", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");
      const assetPath = "grader/output/assets/figure-10.png";

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q6",
                label: "Question 6",
                questions: [
                  {
                    id: "q6_8",
                    type: "lines",
                    displayNumber: "6.8",
                    marks: 1,
                    prompt: `Figure 10 shows chlorophyll absorption.\n\nTable 6\n\n| Colour | Range |\n| --- | --- |\n| blue | 450-499 |\n\n[![Figure 10](${assetPath})](${assetPath})\n\nSuggest one advantage.`,
                    lines: 2,
                    renderMode: "markdown",
                  },
                ],
              },
            ],
          },
          answers: {
            q6_8: "It absorbs more light.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q6_8: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath,
        sourceLabel: "Figure 10",
      });

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
        /failed publish guards.*Figure 10.*separated from its image by Table 6/iu,
      );
    });
  });

  it("allows source instructions that mention a table before the adjacent figure crop caption", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");
      const assetPath = "grader/output/assets/figure-1.png";

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1_7",
                    type: "lines",
                    displayNumber: "1",
                    marks: 1,
                    prompt: `Complete Figure 1.\nYou should:\n- label the y-axis\n- add the correct scale to the y-axis\n- plot the data from Table 1\n- label each bar\n\nFigure 1\n[![Figure 1](${assetPath})](${assetPath})`,
                    lines: 2,
                    renderMode: "markdown",
                  },
                ],
              },
            ],
          },
          answers: {
            q1_7: "Bar chart drawn.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q1_7: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        "## Source problem-statement transcription\n\n**1** Complete Figure 1 using the data shown above.\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      const result = await publishSheetTool.execute({});
      expect(result).toMatchObject({
        status: "published",
        mode: "mock",
      });
    });
  });

  it("rejects prompts that repeat source tables instead of referring above", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q6",
                label: "Question 6",
                questions: [
                  {
                    id: "q6_9",
                    type: "lines",
                    displayNumber: "6.9",
                    marks: 1,
                    prompt:
                      "Table 5 is repeated below.\n\n| Colour | Time |\n| --- | --- |\n| Blue | 115 |\n\nExplain the results.",
                    lines: 2,
                    renderMode: "markdown",
                  },
                ],
              },
            ],
          },
          answers: {
            q6_9: "Blue is fastest.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q6_9: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });

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
        /failed publish guards.*repeats a source figure\/table/iu,
      );
    });
  });

  it("rejects repeated linked crop images for later references", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-3.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 2,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "q02_6",
                    type: "lines",
                    displayNumber: "1",
                    marks: 1,
                    prompt: `Complete **Figure 3**.\n\n[![Figure 3](${assetPath})](${assetPath})`,
                    lines: 2,
                    renderMode: "markdown",
                  },
                  {
                    id: "q02_7",
                    type: "lines",
                    displayNumber: "2",
                    marks: 1,
                    prompt: `Predict the blood flow.\n\nUse **Figure 3**.\n\n[![Figure 3](${assetPath})](${assetPath})`,
                    lines: 1,
                    renderMode: "markdown",
                  },
                ],
              },
            ],
          },
          answers: {
            q02_6: "Graph completed.",
            q02_7: "25",
          },
          review: {
            score: {
              got: 2,
              total: 2,
            },
            label: "2/2",
            message: "Solid work.",
            note: "Good answers.",
            questions: {
              q02_6: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
              q02_7: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath,
        sourceLabel: "Figure 3",
      });

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
        /failed publish guards.*repeats linked crop image.*figure-3\.jpg/iu,
      );
    });
  });

  it("rejects the same named figure linked twice under different asset files", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const firstAsset = "grader/output/assets/figure-3-a.png";
      const secondAsset = "grader/output/assets/figure-3-b.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Biology worksheet",
        awardedMarks: 0,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "q2a",
                    type: "lines",
                    displayNumber: "02.4",
                    marks: 1,
                    prompt: `Use Figure 3.\n\n[![Figure 3](${firstAsset})](${firstAsset})`,
                    lines: 2,
                  },
                  {
                    id: "q2b",
                    type: "lines",
                    displayNumber: "02.7",
                    marks: 1,
                    prompt: `Use Figure 3.\n\n[![Figure 3](${secondAsset})](${secondAsset})`,
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q2a: "Answer",
            q2b: "Answer",
          },
          review: {
            score: {
              got: 0,
              total: 2,
            },
            label: "0/2",
            message: "Needs review.",
            note: "Use the graph carefully.",
            questions: {
              q2a: {
                status: "incorrect",
                score: { got: 0, total: 1 },
                note: "Check the graph trend.",
              },
              q2b: {
                status: "incorrect",
                score: { got: 0, total: 1 },
                note: "Use the same graph rather than a second copy.",
              },
            },
          },
        },
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, firstAsset),
        width: 24,
        height: 24,
      });
      await writeTestPng({
        filePath: path.join(rootDir, secondAsset),
        width: 24,
        height: 24,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${firstAsset}`,
          "  - source label: Figure 3",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: graph labels",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
          `- crop path: ${secondAsset}`,
          "  - source label: Figure 3",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: graph labels",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Source problem-statement transcription\n\n**02.4** Use Figure 3.\n\n**02.7** Use Figure 3.\n",
      );
      await mkdir(
        path.join(
          rootDir,
          "logs/agent/llm_calls/2026-04-13T10-00-00.000Z-0001/chatgpt-gpt-5.4-fast",
        ),
        { recursive: true },
      );
      await writeFile(
        path.join(
          rootDir,
          "logs/agent/llm_calls/2026-04-13T10-00-00.000Z-0001/chatgpt-gpt-5.4-fast/tool_call.txt",
        ),
        JSON.stringify(
          [
            {
              name: "validate_crop_with_fresh_agent",
              arguments: {
                cropPath: firstAsset,
                sourceLabel: "Figure 3",
                questionContext: "Use Figure 3.",
              },
            },
            {
              name: "validate_crop_with_fresh_agent",
              arguments: {
                cropPath: secondAsset,
                sourceLabel: "Figure 3",
                questionContext: "Use Figure 3.",
              },
            },
          ],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /links Figure 3 more than once/iu,
      );
    });
  });

  it("allows adjacent different figure crops when the next figure label follows an image", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const figure4Asset = "grader/output/assets/figure-4.png";
      const figure5Asset = "grader/output/assets/figure-5.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Chemistry worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Chemistry",
            level: "GCSE",
            title: "Chemistry worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q5",
                label: "Question 5",
                questions: [
                  {
                    id: "g05",
                    type: "group",
                    displayNumber: "05",
                    prompt: "This question is about electrolysis.",
                    questions: [
                      {
                        id: "q5",
                        type: "lines",
                        displayNumber: "05.5",
                        marks: 1,
                        prompt: [
                          `**Figure 4**\n\n[![Figure 4](${figure4Asset})](${figure4Asset})`,
                          `**Figure 5**\n\n[![Figure 5](${figure5Asset})](${figure5Asset})`,
                          "Explain the results shown in Figure 5.",
                        ].join("\n\n"),
                        lines: 2,
                        renderMode: "markdown",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q5: "Blue ions moved to the negative electrode.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Good source use.",
            note: "The diagram evidence is used correctly.",
            questions: {
              q5: {
                status: "correct",
                score: { got: 1, total: 1 },
                note: "Correct.",
              },
            },
          },
        },
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, figure4Asset),
        width: 80,
        height: 80,
      });
      await writeTestPng({
        filePath: path.join(rootDir, figure5Asset),
        width: 80,
        height: 80,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${figure4Asset}`,
          "  - source label: Figure 4",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: apparatus",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
          `- crop path: ${figure5Asset}`,
          "  - source label: Figure 5",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: results",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Source problem-statement transcription\n\n**05.5** Figure 4 shows the apparatus. Figure 5 shows the results.\n",
      );
      await mkdir(
        path.join(
          rootDir,
          "logs/agent/llm_calls/2026-04-13T10-00-00.000Z-0001/chatgpt-gpt-5.4-fast",
        ),
        { recursive: true },
      );
      await writeFile(
        path.join(
          rootDir,
          "logs/agent/llm_calls/2026-04-13T10-00-00.000Z-0001/chatgpt-gpt-5.4-fast/tool_call.txt",
        ),
        JSON.stringify(
          [
            {
              name: "validate_crop_with_fresh_agent",
              arguments: {
                cropPath: figure4Asset,
                sourceLabel: "Figure 4",
                questionContext: "Use Figure 4.",
              },
            },
            {
              name: "validate_crop_with_fresh_agent",
              arguments: {
                cropPath: figure5Asset,
                sourceLabel: "Figure 5",
                questionContext: "Use Figure 5.",
              },
            },
          ],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("accepts later figure references that link to the first crop anchor", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-3.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 2,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "q02_6",
                    type: "lines",
                    displayNumber: "1",
                    marks: 1,
                    prompt: `Complete **Figure 3**.\n\n[![Figure 3](${assetPath})](${assetPath})`,
                    lines: 2,
                    renderMode: "markdown",
                  },
                  {
                    id: "q02_7",
                    type: "lines",
                    displayNumber: "2",
                    marks: 1,
                    prompt:
                      "Predict the blood flow.\n\nUse [Figure 3](#figure-3).",
                    lines: 1,
                    renderMode: "markdown",
                  },
                ],
              },
            ],
          },
          answers: {
            q02_6: "Graph completed.",
            q02_7: "25",
          },
          review: {
            score: {
              got: 2,
              total: 2,
            },
            label: "2/2",
            message: "Solid work.",
            note: "Good answers.",
            questions: {
              q02_6: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
              q02_7: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath,
        sourceLabel: "Figure 3",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 2,
        maxMarks: 2,
      });
    });
  });

  it("recognizes abbreviated figure labels and decimal table labels in source transcripts", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Science",
            level: "GCSE",
            title: "Science worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "q2",
                    type: "lines",
                    marks: 1,
                    displayNumber: "2",
                    prompt:
                      "Fig. 2 shows the apparatus. Table 2.1 shows the results.",
                    lines: 1,
                  },
                ],
              },
            ],
          },
          answers: {
            q2: "Blue was fastest.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q2: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        [
          "Fig. 2 shows the apparatus.",
          "",
          "Table 2.1",
          "",
          "| Colour | Time / s |",
          "| --- | --- |",
          "| Blue | 115 |",
        ].join("\n"),
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*Figure 2.*image|failed publish guards.*Table 2\.1.*Markdown table/iu,
      );
    });
  });

  it("requires fresh-context crop validation for linked image assets", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "1",
                    prompt:
                      "Figure 1 shows the root tip.\n\n[![Figure 1](grader/output/assets/figure-1.png)](grader/output/assets/figure-1.png)",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "Meristem.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });

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
        /failed publish guards.*crop-validation\.md.*fresh crop-review agent/iu,
      );
    });
  });

  it("accepts fresh-context crop validation that says required content is not clipped", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "1",
                    prompt:
                      "Figure 1 shows the root tip.\n\n[![Figure 1](grader/output/assets/figure-1.png)](grader/output/assets/figure-1.png)",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "Meristem.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, "grader/output/assets/figure-1.png"),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        "- `grader/output/assets/figure-1.png` — Figure 1 — fresh-context subagent checked: yes — reviewer-visible text: Figure 1 — **PASS** — all required labels are visible and not clipped.\n",
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=validate_crop_with_fresh_agent crop validation\n",
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath: "grader/output/assets/figure-1.png",
        sourceLabel: "Figure 1",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("accepts fresh crop validation recorded in llm_calls tool logs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - source label: Figure 1",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: none",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);
      const toolCallDir = path.join(
        rootDir,
        "logs/agent/llm_calls/2026-04-13T10-00-00.000Z-0001/chatgpt-gpt-5.4-fast",
      );
      await mkdir(toolCallDir, { recursive: true });
      await writeFile(
        path.join(toolCallDir, "tool_call.txt"),
        JSON.stringify(
          [
            {
              kind: "function",
              name: "validate_crop_with_fresh_agent",
              callId: "call_review",
              arguments: {
                cropPath: assetPath,
                sourceLabel: "Figure 1",
                questionContext: "Use Figure 1.",
              },
            },
          ],
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
        graderPublish: {
          mode: "mock",
          runId: "sheet-1",
        },
      });

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("accepts block-style crop validation for each linked image asset", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Junior Mathematical Challenge worksheet",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Challenge",
            title: "Junior Mathematical Challenge worksheet",
            subtitle: "Question paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q15",
                label: "Question 15",
                questions: [
                  {
                    id: "q15",
                    type: "mcq",
                    marks: 5,
                    displayNumber: "15",
                    prompt:
                      "Which option shows the resulting shape?\n\n[![Question 15 options](grader/output/assets/q15-options.png)](grader/output/assets/q15-options.png)",
                    displayMode: "labels_only",
                    options: [
                      { id: "A", label: "A", text: "" },
                      { id: "B", label: "B", text: "" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q15: "",
          },
          review: buildAwaitingAnswersReview(5, ["q15"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, "grader/output/assets/q15-options.png"),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          "- crop path: grader/output/assets/q15-options.png",
          "  - source label: Question 15 envelope/options diagram",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: A B C D E",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "  - page border, separator line, answer line, or neighbouring-question fragment present: no",
          "  - crop fixes made: final crop was accepted after an earlier image-edit budget warning; all option diagrams are now visible.",
          "  - notes: Early review found clipped content; after recrop, all option diagrams A-E are visible and cleanly isolated.",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        "## Source problem-statement transcription\n\n**Question 15** Which option shows the resulting shape?\n",
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=validate_crop_with_fresh_agent crop validation\n",
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath: "grader/output/assets/q15-options.png",
        sourceLabel: "Question 15 envelope/options diagram",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 0,
        maxMarks: 5,
      });
    });
  });

  it("accepts crop validation risk fields explicitly marked absent", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 24,
        height: 24,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `## ${assetPath}`,
          `- crop path: ${assetPath}`,
          "- source question/figure/table label: Figure 1",
          "- fresh-context subagent checked: yes",
          "- reviewer-visible text transcribed from the crop: none",
          "- pass/fail: pass",
          "- all question-relevant content visible: yes",
          "- duplicated caption/question/table text excluded unless it is part of a visual label/axis/legend: yes",
          "- unrelated visible text or non-target ink present: no",
          "- edge clipping/content touching an edge present: no",
          "- page borders/separator lines/answer lines/neighbouring-question fragments present: no",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=validate_crop_with_fresh_agent crop validation\n",
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("rejects crop validation records with explicit visible:no fields", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - source label: Figure 1",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: Figure 1",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: no",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=spawn_agent crop validation\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*crop-validation\.md.*unresolved failed crop review/iu,
      );
    });
  });

  it("rejects crop validation records with explicit pass/fail: fail fields", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - source label: Figure 1",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: Figure 1",
          "  - pass/fail: fail",
          "  - all question-relevant content visible: yes",
          "  - issues: crop includes surrounding question text",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=validate_crop_with_fresh_agent crop validation\n",
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });

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
        /failed publish guards.*crop-validation\.md.*unresolved failed crop review/iu,
      );
    });
  });

  it("allows passing crop validation records with minor duplicate/context notes", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Math worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - source label: Figure 1",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: E 96",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "  - duplicated caption/question/table text excluded: yes",
          "  - unrelated visible text or non-target ink present: yes",
          "  - edge clipping or content touching edge present: no",
          "  - page border, separator line, answer line, or neighbouring-question fragment present: no",
          "  - issues: minor neighbouring caption fragment remains after fresh review",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=validate_crop_with_fresh_agent crop validation\n",
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("allows crop records marked fail only for duplicated prompt text when content is complete", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - source label: Figure 1",
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: Figure 1; Required label",
          "  - pass/fail: fail",
          "  - all question-relevant content visible: yes",
          "  - duplicated caption/question/table text excluded: no",
          "  - unrelated neighbouring content present: no",
          "  - edge clipping or content touching edge present: no",
          "  - page border, separator line, answer line, or neighbouring-question fragment present: no",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeSourceProblemStatementTranscription(rootDir);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=validate_crop_with_fresh_agent crop validation\n",
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
      });
    });
  });

  it("rejects full-page crop fallbacks linked as worksheet figures", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Junior Mathematical Challenge worksheet",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Challenge",
            title: "Junior Mathematical Challenge worksheet",
            subtitle: "Question extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q15",
                label: "Question 15",
                questions: [
                  {
                    id: "q15",
                    type: "mcq",
                    marks: 5,
                    displayNumber: "15",
                    prompt:
                      "Which option shows the resulting shape?\n\n[![Question 15 source page](grader/output/assets/q15-page.png)](grader/output/assets/q15-page.png)",
                    displayMode: "labels_only",
                    options: [
                      { id: "A", label: "A", text: "" },
                      { id: "B", label: "B", text: "" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q15: "",
          },
          review: buildAwaitingAnswersReview(5, ["q15"]),
        },
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, "grader/output/assets/q15-page.png"),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        "- crop path: grader/output/assets/q15-page.png\n  - source label: Question 15 source page\n  - fresh-context subagent checked: yes\n  - reviewer-visible text: Question 15 source page\n  - pass/fail: pass\n  - all question-relevant content visible: yes\n",
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=spawn_agent crop validation\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*full-page fallback/iu,
      );
    });
  });

  it("rejects stale crop validation after a final crop_image edit", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.dirname(path.join(rootDir, assetPath)), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 30,
        height: 30,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: Figure 1",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      const validationTime = new Date("2026-04-13T10:00:00.000Z");
      const editTime = new Date("2026-04-13T10:02:00.000Z");
      await utimes(
        path.join(rootDir, "grader/output/crop-validation.md"),
        validationTime,
        validationTime,
      );
      await utimes(path.join(rootDir, assetPath), editTime, editTime);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        [
          "[spark-agent:test] 2026-04-13T09:59:00.000Z [agent:test] tool_call_started: turn=1 index=1 tool=spawn_agent callId=call_review",
          "[spark-agent:test] 2026-04-13T10:02:00.000Z [agent:test] tool_call_started: turn=2 index=1 tool=crop_image callId=call_crop",
          `[spark-agent:test] 2026-04-13T10:02:00.000Z [agent:test] tool_call_input: {"sourcePath":"grader/output/pages/page-0001.png","outputPath":"${assetPath}","bbox1000":{"left":1,"top":1,"right":2,"bottom":2}}`,
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });

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
        /failed publish guards.*changed with crop_image after grader\/output\/crop-validation\.md/iu,
      );
    });
  });

  it("allows pad_image after crop validation without requiring a fresh subagent pass", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-1.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(assetPath),
      });
      await mkdir(path.dirname(path.join(rootDir, assetPath)), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, assetPath),
        width: 30,
        height: 30,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${assetPath}`,
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: Figure 1",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      const validationTime = new Date("2026-04-13T10:00:00.000Z");
      const editTime = new Date("2026-04-13T10:02:00.000Z");
      await utimes(
        path.join(rootDir, "grader/output/crop-validation.md"),
        validationTime,
        validationTime,
      );
      await utimes(path.join(rootDir, assetPath), editTime, editTime);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        [
          "[spark-agent:test] 2026-04-13T09:59:00.000Z [agent:test] tool_call_started: turn=1 index=1 tool=spawn_agent callId=call_review",
          "[spark-agent:test] 2026-04-13T10:02:00.000Z [agent:test] tool_call_started: turn=2 index=1 tool=pad_image callId=call_pad",
          `[spark-agent:test] 2026-04-13T10:02:00.000Z [agent:test] tool_call_input: {"sourcePath":"${assetPath}","outputPath":"${assetPath}"}`,
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath,
        sourceLabel: "Figure 1",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("allows pad_image to write a new linked worksheet asset after validating the source crop", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const sourceAssetPath = "grader/output/assets/figure-1.png";
      const paddedAssetPath = "grader/output/assets/figure-1-pad.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Science worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: buildSingleImageQuestionReport(paddedAssetPath),
      });
      await mkdir(path.dirname(path.join(rootDir, sourceAssetPath)), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, sourceAssetPath),
        width: 30,
        height: 30,
      });
      await writeTestPng({
        filePath: path.join(rootDir, paddedAssetPath),
        width: 40,
        height: 40,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        [
          "# Crop validation",
          "",
          `- crop path: ${sourceAssetPath}`,
          "  - fresh-context subagent checked: yes",
          "  - reviewer-visible text: Figure 1",
          "  - pass/fail: pass",
          "  - all question-relevant content visible: yes",
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      const validationTime = new Date("2026-04-13T10:00:00.000Z");
      const editTime = new Date("2026-04-13T10:02:00.000Z");
      await utimes(
        path.join(rootDir, "grader/output/crop-validation.md"),
        validationTime,
        validationTime,
      );
      await utimes(path.join(rootDir, paddedAssetPath), editTime, editTime);
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        [
          "[spark-agent:test] 2026-04-13T09:59:00.000Z [agent:test] tool_call_started: turn=1 index=1 tool=spawn_agent callId=call_review",
          "[spark-agent:test] 2026-04-13T10:02:00.000Z [agent:test] tool_call_started: turn=2 index=1 tool=pad_image callId=call_pad",
          `[spark-agent:test] 2026-04-13T10:02:00.000Z [agent:test] tool_call_input: {"sourcePath":"${sourceAssetPath}","outputPath":"${paddedAssetPath}"}`,
          "",
        ].join("\n"),
        { encoding: "utf8" },
      );
      await writeFreshCropReviewToolCall({
        rootDir,
        assetPath: sourceAssetPath,
        sourceLabel: "Figure 1",
      });

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

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
        awardedMarks: 1,
        maxMarks: 1,
      });
    });
  });

  it("rejects option diagram crops recorded as partial split fragments", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Junior Mathematical Challenge worksheet",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Challenge",
            title: "Junior Mathematical Challenge worksheet",
            subtitle: "Question paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q15",
                label: "Question 15",
                questions: [
                  {
                    id: "q15",
                    type: "mcq",
                    marks: 5,
                    displayNumber: "15",
                    prompt:
                      "Which option shows the resulting shape?\n\n[![Question 15 options top](grader/output/assets/q15-options-top.png)](grader/output/assets/q15-options-top.png)",
                    displayMode: "labels_only",
                    options: [
                      { id: "A", label: "A", text: "" },
                      { id: "B", label: "B", text: "" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q15: "",
          },
          review: buildAwaitingAnswersReview(5, ["q15"]),
        },
      });
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Render this question paper as a source-faithful worksheet. No student answers were provided; leave answers blank.",
            input: {},
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(
          rootDir,
          "grader/output/assets/q15-options-top.png",
        ),
        width: 20,
        height: 20,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        "- `grader/output/assets/q15-options-top.png` — Q15 options A-C plus top of D/E — fresh-context subagent checked: yes — reviewer-visible text: A B C partial D/E — **PASS** — clean crop used together with bottom options crop.\n",
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=spawn_agent crop validation\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /partial\/split option crop|complete options block/iu,
      );
    });
  });

  it("rejects linked crop images with content touching the crop edge", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    marks: 1,
                    displayNumber: "1",
                    prompt:
                      "Figure 1 shows the root tip.\n\n[![Figure 1](grader/output/assets/figure-1.png)](grader/output/assets/figure-1.png)",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "Meristem.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Solid start.",
            note: "Good first answer.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });
      await mkdir(path.join(rootDir, "grader/output/assets"), {
        recursive: true,
      });
      await writeTestPng({
        filePath: path.join(rootDir, "grader/output/assets/figure-1.png"),
        width: 20,
        height: 20,
        topEdgeLine: true,
      });
      await writeFile(
        path.join(rootDir, "grader/output/crop-validation.md"),
        "- `grader/output/assets/figure-1.png` — Figure 1 — fresh-context subagent checked: yes — reviewer-visible text: Figure 1 — **PASS** — all required labels are visible and not clipped.\n",
        { encoding: "utf8" },
      );
      await mkdir(path.join(rootDir, "logs/agent"), { recursive: true });
      await writeFile(
        path.join(rootDir, "logs/agent/agent.log"),
        "tool=spawn_agent crop validation\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /content touching the top.*edge/iu,
      );
    });
  });

  it("rejects one giant section for many root questions", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 5,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q",
                label: "Questions",
                questions: Array.from({ length: 5 }, (_item, index) => ({
                  id: `q${(index + 1).toString()}`,
                  type: "lines" as const,
                  displayNumber: (index + 1).toString(),
                  marks: 1,
                  prompt: `Question ${(index + 1).toString()} prompt.`,
                  lines: 1,
                })),
              },
            ],
          },
          answers: {
            q1: "A",
            q2: "B",
            q3: "C",
            q4: "D",
            q5: "E",
          },
          review: {
            score: {
              got: 5,
              total: 5,
            },
            label: "5/5",
            message: "Complete.",
            note: "Good work.",
            questions: Object.fromEntries(
              Array.from({ length: 5 }, (_item, index) => [
                `q${(index + 1).toString()}`,
                {
                  status: "correct",
                  score: {
                    got: 1,
                    total: 1,
                  },
                  note: "Correct.",
                },
              ]),
            ),
          },
        },
      });

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
        /failed publish guards.*one collapsible content section/iu,
      );
    });
  });

  it("rejects numeric-range sections that group several multi-part roots", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 4,
        maxMarks: 4,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "q1-2",
                label: "Questions 01-02",
                questions: [
                  {
                    id: "g01",
                    type: "group",
                    displayNumber: "01",
                    marks: 2,
                    prompt: "A root is a plant organ.",
                    questions: [
                      {
                        id: "q01_1",
                        type: "lines",
                        displayNumber: "01.1",
                        marks: 1,
                        prompt: "What is a tissue?",
                        lines: 1,
                      },
                      {
                        id: "q01_2",
                        type: "lines",
                        displayNumber: "01.2",
                        marks: 1,
                        prompt: "Name the tissue.",
                        lines: 1,
                      },
                    ],
                  },
                  {
                    id: "g02",
                    type: "group",
                    displayNumber: "02",
                    marks: 2,
                    prompt: "The heart pumps blood.",
                    questions: [
                      {
                        id: "q02_1",
                        type: "lines",
                        displayNumber: "02.1",
                        marks: 1,
                        prompt: "Which chamber receives blood?",
                        lines: 1,
                      },
                      {
                        id: "q02_2",
                        type: "lines",
                        displayNumber: "02.2",
                        marks: 1,
                        prompt: "Explain the valve function.",
                        lines: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q01_1: "Cells together.",
            q01_2: "Meristem.",
            q02_1: "Left atrium.",
            q02_2: "Stops backflow.",
          },
          review: {
            score: {
              got: 4,
              total: 4,
            },
            label: "4/4",
            message: "Complete.",
            note: "Good work.",
            questions: Object.fromEntries(
              ["q01_1", "q01_2", "q02_1", "q02_2"].map((id) => [
                id,
                {
                  status: "correct",
                  score: {
                    got: 1,
                    total: 1,
                  },
                  note: "",
                },
              ]),
            ),
          },
        },
      });

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
        /groups 2 multi-part root questions/iu,
      );
    });
  });

  it("rejects figure/table artifacts hoisted into section theory", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      const assetPath = "grader/output/assets/figure-3.png";
      await writeMockPublishArtifacts({
        rootDir,
        title: "Biology worksheet",
        awardedMarks: 0,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "Biology worksheet",
            subtitle: "Paper extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                theory: `Figure 3\n\n[![Figure 3](${assetPath})](${assetPath})`,
                questions: [
                  {
                    id: "q2",
                    type: "lines",
                    displayNumber: "02.4",
                    marks: 1,
                    prompt: "Use the graph to answer the question.",
                    lines: 2,
                  },
                ],
              },
            ],
          },
          answers: {
            q2: "Answer",
          },
          review: {
            score: {
              got: 0,
              total: 1,
            },
            label: "0/1",
            message: "Needs review.",
            note: "Use the graph carefully.",
            questions: {
              q2: {
                status: "incorrect",
                score: { got: 0, total: 1 },
                note: "Check where the graph changes.",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath,
        sourceLabel: "Figure 3",
      });
      await writeSourceProblemStatementTranscription(
        rootDir,
        "## Source problem-statement transcription\n\n**02.4** Use Figure 3.\n",
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
        /section "Q2" theory contains a named figure\/table or linked crop/iu,
      );
    });
  });

  it("rejects grouped subparts whose parent prompt is only a stub label", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "group",
                    displayNumber: "01",
                    marks: 2,
                    prompt: "Question 1",
                    questions: [
                      {
                        id: "q1-1",
                        type: "lines",
                        displayNumber: "01.1",
                        marks: 1,
                        prompt: "What is a tissue?",
                        lines: 1,
                      },
                      {
                        id: "q1-2",
                        type: "lines",
                        displayNumber: "01.2",
                        marks: 1,
                        prompt: "Name the plant tissue with stem cells.",
                        lines: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            "q1-1": "A group of similar cells.",
            "q1-2": "",
          },
          review: {
            score: {
              got: 1,
              total: 2,
            },
            label: "1/2",
            message: "Needs revision.",
            note: "Question 1 needs one follow-up.",
            questions: {
              "q1-1": {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
              "q1-2": {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 1,
                },
                note: "Look back at the tissue found at root tips.",
              },
            },
          },
        },
      });

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
        /generic label/iu,
      );
    });
  });

  it("rejects child-specific figures hoisted into the parent group prompt", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 2,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "g02",
                    type: "group",
                    displayNumber: "02",
                    marks: 2,
                    prompt:
                      "The human heart pumps blood.\n\n**Figure 3**\n\n[![Figure 3](grader/output/assets/figure-3-heart.png)](grader/output/assets/figure-3-heart.png)",
                    questions: [
                      {
                        id: "q02_1",
                        type: "lines",
                        displayNumber: "02.1",
                        marks: 1,
                        prompt: "Name one blood vessel.",
                        lines: 1,
                      },
                      {
                        id: "q02_4",
                        type: "lines",
                        displayNumber: "02.4",
                        marks: 1,
                        prompt:
                          "Figure 3 shows the human heart.\n\nWhich part of the heart receives oxygenated blood from the lungs?",
                        lines: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q02_1: "Aorta.",
            q02_4: "Left atrium.",
          },
          review: {
            score: {
              got: 2,
              total: 2,
            },
            label: "2/2",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q02_1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
              q02_4: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath: "grader/output/assets/figure-3-heart.png",
        sourceLabel: "Figure 3 heart diagram",
      });

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
        /places Figure 3 in the parent prompt.*child question "q02_4"/iu,
      );
    });
  });

  it("rejects parent figures tied to a later child in the source transcript", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 2,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "g02",
                    type: "group",
                    displayNumber: "02",
                    marks: 2,
                    prompt:
                      "The human heart pumps blood.\n\nFigure 3 shows a graph grid.\n\n[![Figure 3](grader/output/assets/figure-3-graph.png)](grader/output/assets/figure-3-graph.png)",
                    questions: [
                      {
                        id: "q02_1",
                        type: "lines",
                        displayNumber: "02.1",
                        marks: 1,
                        prompt: "Name one blood vessel.",
                        lines: 1,
                      },
                      {
                        id: "q02_4",
                        type: "lines",
                        displayNumber: "02.4",
                        marks: 1,
                        prompt: "Complete the graph grid.",
                        lines: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q02_1: "Aorta.",
            q02_4: "Graph drawn.",
          },
          review: {
            score: {
              got: 2,
              total: 2,
            },
            label: "2/2",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q02_1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
              q02_4: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeValidatedCropAsset({
        rootDir,
        assetPath: "grader/output/assets/figure-3-graph.png",
        sourceLabel: "Figure 3 graph grid",
      });
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        "02.4 `Complete Figure 3 using the data from Table 2.` [1 mark]\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /source transcript ties it to later child question "q02_4"/iu,
      );
    });
  });

  it("rejects parent tables tied to a later child in the source transcript", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 2,
        maxMarks: 2,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q6",
                label: "Question 6",
                questions: [
                  {
                    id: "g06",
                    type: "group",
                    displayNumber: "06",
                    marks: 2,
                    prompt:
                      "This question is about photosynthesis.\n\nTable 5 shows the results.\n\n| Colour | Time |\n| --- | ---: |\n| Blue | 115 |",
                    questions: [
                      {
                        id: "q06_1",
                        type: "lines",
                        displayNumber: "06.1",
                        marks: 1,
                        prompt: "Complete the equation.",
                        lines: 1,
                      },
                      {
                        id: "q06_9",
                        type: "lines",
                        displayNumber: "06.9",
                        marks: 1,
                        prompt: "Explain the leaf disc results.",
                        lines: 1,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q06_1: "CO2 + H2O.",
            q06_9: "Blue was faster.",
          },
          review: {
            score: {
              got: 2,
              total: 2,
            },
            label: "2/2",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q06_1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
              q06_9: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        "06.9 `Use data from Table 5 to explain the results.` [1 mark]\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /source transcript ties it to later child question "q06_9"/iu,
      );
    });
  });

  it("rejects MCQ prompts that repeat bare option labels already in options", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q2",
                label: "Question 2",
                questions: [
                  {
                    id: "q02_1",
                    type: "mcq",
                    displayNumber: "02.1",
                    marks: 1,
                    prompt:
                      "Which part of the heart receives oxygenated blood from the lungs?\n\n(A)\n(B)\n(C)\n(D)",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "Aorta" },
                      { id: "B", label: "B", text: "Left atrium" },
                      { id: "C", label: "C", text: "Right atrium" },
                      { id: "D", label: "D", text: "Vena cava" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q02_1: "B",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q02_1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });

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
        /repeats standalone option labels/iu,
      );
    });
  });

  it("rejects MCQ prompts that duplicate structured option text", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Mathematics worksheet",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Junior",
            title: "Mathematics worksheet",
            subtitle: "Question extract",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 5,
                    prompt:
                      "Which value is correct?\n\n(A) twenty four\n(B) twenty five",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "twenty four" },
                      { id: "B", label: "B", text: "twenty five" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "A",
          },
          review: {
            score: {
              got: 0,
              total: 5,
            },
            label: "0/5",
            message: "Needs review.",
            note: "Check the value.",
            questions: {
              q1: {
                status: "incorrect",
                score: { got: 0, total: 5 },
                note: "Recompute the value from the source expression.",
              },
            },
          },
        },
      });

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
        /duplicates structured MCQ option text/iu,
      );
    });
  });

  it("rejects literal escaped newlines in visible worksheet prompts", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Mathematics worksheet",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Junior",
            title: "Mathematics worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "q11-15",
                label: "Questions 11-15",
                questions: [
                  {
                    id: "q12",
                    type: "mcq",
                    displayNumber: "12",
                    marks: 5,
                    prompt: String.raw`In this subtraction:

\[
\begin{array}{ccccc}
7 & Q & 2 & S & T \\n-P & 3 & R & 9 & 6
\end{array}
\]`,
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "30" },
                      { id: "B", label: "B", text: "29" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q12: "A",
          },
          review: {
            score: {
              got: 0,
              total: 5,
            },
            label: "0/5",
            message: "Needs review.",
            note: "Check the subtraction layout.",
            questions: {
              q12: {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 5,
                },
                note: "Check the subtraction layout.",
              },
            },
          },
        },
      });

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
        /literal escaped newline sequence/iu,
      );
    });
  });

  it("rejects raw LaTeX layout environments in visible worksheet prompts", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Mathematics worksheet",
        awardedMarks: 0,
        maxMarks: 5,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Junior",
            title: "Mathematics worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "q11-15",
                label: "Questions 11-15",
                questions: [
                  {
                    id: "q12",
                    type: "mcq",
                    displayNumber: "12",
                    marks: 5,
                    prompt: String.raw`In this subtraction:

\[
\begin{array}{ccccc}
7 & Q & 2 & S & T \\
-P & 3 & R & 9 & 6
\end{array}
\]`,
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "30" },
                      { id: "B", label: "B", text: "29" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q12: "A",
          },
          review: {
            score: {
              got: 0,
              total: 5,
            },
            label: "0/5",
            message: "Needs review.",
            note: "Check the subtraction layout.",
            questions: {
              q12: {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 5,
                },
                note: "Check the subtraction layout.",
              },
            },
          },
        },
      });

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
        /raw LaTeX layout environment/iu,
      );
    });
  });

  it("rejects visible cover-page administration boilerplate", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Competition paper",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Competition paper",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    displayNumber: "1",
                    marks: 1,
                    prompt:
                      "Do not open the paper until the Invigilator tells you to do so.\n\nWhat is 2 + 2?",
                    lines: 1,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "4",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "Correct.",
              },
            },
          },
        },
      });

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
        /failed publish guards.*administration boilerplate/iu,
      );
    });
  });

  it("rejects redundant question-paper worksheet titles", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Junior Mathematical Challenge 2014",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Junior",
            title: "Junior Mathematical Challenge 2014 question paper",
            subtitle: "Thursday 1 May 2014",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "q1-section",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "fill",
                    displayNumber: "1",
                    marks: 1,
                    prompt: "The answer is",
                    blanks: [{ placeholder: "number" }],
                    after: ".",
                  },
                ],
              },
            ],
          },
          answers: {
            q1: {
              "0": "4",
            },
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });

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
        /failed publish guards.*question paper/iu,
      );
    });
  });

  it("rejects presentation footers that repeat visible sheet metadata", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Junior Mathematical Challenge 2014",
        awardedMarks: 1,
        maxMarks: 1,
        footer: "Junior · Mathematics · Junior Mathematical Challenge 2014",
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Mathematics",
            level: "Junior",
            title: "Junior Mathematical Challenge 2014",
            subtitle: "Thursday 1 May 2014",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "q1-section",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "fill",
                    displayNumber: "1",
                    marks: 1,
                    prompt: "The answer is",
                    blanks: [{ placeholder: "number" }],
                    after: ".",
                  },
                ],
              },
            ],
          },
          answers: {
            q1: {
              "0": "4",
            },
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });

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
        /failed publish guards.*presentation\.footer repeats visible sheet metadata/iu,
      );
    });
  });

  it("rejects presentation metadata that exposes transcription process labels", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeValidSheetArtifacts(rootDir);
      const summaryPath = path.join(rootDir, "grader/output/run-summary.json");
      const summary = JSON.parse(
        await readFile(summaryPath, { encoding: "utf8" }),
      ) as {
        presentation: {
          footer: string;
        };
      };
      summary.presentation.footer = "Question paper transcription";
      await writeFile(
        summaryPath,
        JSON.stringify(summary, null, 2).concat("\n"),
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*presentation\.footer contains process wording/iu,
      );
    });
  });

  it("allows OCR when it names the exam board in presentation metadata", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeValidSheetArtifacts(rootDir);
      const summaryPath = path.join(rootDir, "grader/output/run-summary.json");
      const summary = JSON.parse(
        await readFile(summaryPath, { encoding: "utf8" }),
      ) as {
        presentation: {
          summaryMarkdown: string;
          footer: string;
        };
      };
      summary.presentation.summaryMarkdown =
        "This OCR paper went well on the short-answer questions.";
      summary.presentation.footer = "OCR GCSE Computer Science J277/01";
      await writeFile(
        summaryPath,
        JSON.stringify(summary, null, 2).concat("\n"),
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).resolves.toMatchObject({
        status: "published",
      });
    });
  });

  it("rejects score summary messages that only repeat the numeric score", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeValidSheetArtifacts(rootDir);
      const sheetPath = path.join(rootDir, "grader/output/sheet.json");
      const report = JSON.parse(
        await readFile(sheetPath, { encoding: "utf8" }),
      ) as {
        review: {
          message: string;
        };
      };
      report.review.message = "1 / 1";
      await writeFile(sheetPath, JSON.stringify(report, null, 2).concat("\n"), {
        encoding: "utf8",
      });

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
        /failed publish guards.*review\.message repeats only the numeric score/iu,
      );
    });
  });

  it("requires source problem-statement transcription for structure-sensitive paper runs", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeValidSheetArtifacts(rootDir);
      await writeFile(
        path.join(rootDir, "request.json"),
        JSON.stringify(
          {
            createdAt: new Date(0).toISOString(),
            sourceText:
              "Please render this uploaded question paper and preserve question structure, root stems, and subquestion numbering.",
            input: {
              title: "Uploaded question paper",
              notes: "Preserve question structure from the source paper.",
              referenceSourcePolicy: "uploaded-only",
            },
            attachments: [],
          },
          null,
          2,
        ).concat("\n"),
        { encoding: "utf8" },
      );
      await writeFile(
        path.join(rootDir, "grader/output/transcription.md"),
        "## Problem statement audit note\n\nThe uploaded paper was used.\n",
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

      const publishSheetTool = tools.publish_sheet;
      requireFunctionTool(publishSheetTool);

      await expect(publishSheetTool.execute({})).rejects.toThrow(
        /failed publish guards.*source problem-statement transcription/iu,
      );
    });
  });

  it("rejects worksheet images linked outside guarded crop assets", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "GCSE Biology worksheet",
        awardedMarks: 1,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "GCSE Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    displayNumber: "1",
                    marks: 1,
                    prompt:
                      "Figure 1 shows the setup.\n\n[![Figure 1](grader/uploads/figure-1.png)](grader/uploads/figure-1.png)\n\nWhat is shown?",
                    lines: 1,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "A setup.",
          },
          review: {
            score: {
              got: 1,
              total: 1,
            },
            label: "1/1",
            message: "Complete.",
            note: "Good work.",
            questions: {
              q1: {
                status: "correct",
                score: {
                  got: 1,
                  total: 1,
                },
                note: "",
              },
            },
          },
        },
      });

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
        /outside grader\/output\/assets/iu,
      );
    });
  });

  it("rejects unresolved review notes that reveal the answer immediately", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Biology worksheet",
        awardedMarks: 0,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "lines",
                    displayNumber: "1",
                    marks: 1,
                    prompt: "Name the type of cell produced by the fusion.",
                    lines: 1,
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: {
            score: {
              got: 0,
              total: 1,
            },
            label: "0/1",
            message: "Needs revision.",
            note: "Try the feedback prompt.",
            questions: {
              q1: {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 1,
                },
                note: "The correct cell type is hybridoma.",
              },
            },
          },
        },
      });

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
        /failed publish guards.*gives away the answer/iu,
      );
    });
  });

  it("rejects additional direct-answer review note phrasings", async () => {
    const answerRevealNotes = [
      "No selected option was visible. Athlete D tested positive.",
      "No clear answer was visible. The key idea was that Salmonella release toxins.",
      "No clear answer was visible. The useful property is that the antibody binds only to the steroid.",
      "A value around **18 to 24 cm3/minute** was expected from the graph.",
      "Think about how increased muscle mass changes performance. Link the larger muscles to stronger contractions or improved speed / strength.",
      "Use both sources together here. Compare how much blue light and green light chlorophyll absorbs, then link that to faster or slower photosynthesis.",
    ];

    for (const note of answerRevealNotes) {
      await withTempDir(async (rootDir) => {
        const { buildSparkAgentTools } =
          await import("../src/agent/sparkAgentRunner");

        await writeMockPublishArtifacts({
          rootDir,
          title: "Biology worksheet",
          awardedMarks: 0,
          maxMarks: 1,
          report: {
            schemaVersion: 1,
            sheet: {
              id: "sheet-1",
              subject: "Biology",
              level: "GCSE",
              title: "Biology worksheet",
              subtitle: "Uploaded paper",
              color: "#123456",
              accent: "#345678",
              light: "#f0f4f8",
              border: "#89abcd",
              sections: [
                {
                  id: "Q1",
                  label: "Question 1",
                  questions: [
                    {
                      id: "q1",
                      type: "lines",
                      displayNumber: "1",
                      marks: 1,
                      prompt: "Answer the question.",
                      lines: 1,
                    },
                  ],
                },
              ],
            },
            answers: {
              q1: "",
            },
            review: {
              score: {
                got: 0,
                total: 1,
              },
              label: "0/1",
              message: "Needs revision.",
              note: "Try the feedback prompt.",
              questions: {
                q1: {
                  status: "incorrect",
                  score: {
                    got: 0,
                    total: 1,
                  },
                  note,
                },
              },
            },
          },
        });

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
          /failed publish guards.*gives away the answer/iu,
        );
      });
    }
  });

  it("rejects unresolved feedback that repeats objective option text", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Biology worksheet",
        awardedMarks: 0,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Biology",
            level: "GCSE",
            title: "Biology worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 1,
                    prompt: "Which statement describes the useful property?",
                    displayMode: "full_options",
                    options: [
                      {
                        id: "A",
                        label: "A",
                        text: "It binds only to the anabolic steroid",
                      },
                      {
                        id: "B",
                        label: "B",
                        text: "It binds to every hormone",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "",
          },
          review: {
            score: {
              got: 0,
              total: 1,
            },
            label: "0/1",
            message: "Needs revision.",
            note: "Try the feedback prompt.",
            questions: {
              q1: {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 1,
                },
                note: "It binds only to the anabolic steroid.",
              },
            },
          },
        },
      });

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
        /failed publish guards.*gives away the answer/iu,
      );
    });
  });

  it("rejects unresolved follow-up text that reveals the answer immediately", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } =
        await import("../src/agent/sparkAgentRunner");

      await writeMockPublishArtifacts({
        rootDir,
        title: "Maths worksheet",
        awardedMarks: 0,
        maxMarks: 1,
        report: {
          schemaVersion: 1,
          sheet: {
            id: "sheet-1",
            subject: "Maths",
            level: "Junior",
            title: "Maths worksheet",
            subtitle: "Uploaded paper",
            color: "#123456",
            accent: "#345678",
            light: "#f0f4f8",
            border: "#89abcd",
            sections: [
              {
                id: "Q1",
                label: "Question 1",
                questions: [
                  {
                    id: "q1",
                    type: "mcq",
                    displayNumber: "1",
                    marks: 1,
                    prompt: "Which option is correct?",
                    displayMode: "full_options",
                    options: [
                      { id: "A", label: "A", text: "First" },
                      { id: "B", label: "B", text: "Second" },
                    ],
                  },
                ],
              },
            ],
          },
          answers: {
            q1: "A",
          },
          review: {
            score: {
              got: 0,
              total: 1,
            },
            label: "0/1",
            message: "Needs revision.",
            note: "Try the feedback prompt.",
            questions: {
              q1: {
                status: "incorrect",
                score: {
                  got: 0,
                  total: 1,
                },
                note: "Compare both options carefully.",
                followUp: "Pick B.",
              },
            },
          },
        },
      });

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
        /failed publish guards.*gives away the answer/iu,
      );
    });
  });
});
