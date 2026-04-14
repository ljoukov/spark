import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

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
  };
});

function buildMinimalWorkspace() {
  return {
    scheduleUpdate: () => {},
    deleteFile: () => Promise.resolve(),
    moveFile: () => Promise.resolve(),
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "spark-pdf-tool-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeSourcePng(filePath: string): Promise<void> {
  const png = new PNG({ width: 100, height: 100 });
  for (let y = 0; y < 100; y += 1) {
    for (let x = 0; x < 100; x += 1) {
      const offset = (100 * y + x) << 2;
      png.data[offset] = 255;
      png.data[offset + 1] = 255;
      png.data[offset + 2] = 255;
      png.data[offset + 3] = 255;
    }
  }
  for (let y = 40; y < 60; y += 1) {
    for (let x = 40; x < 60; x += 1) {
      const offset = (100 * y + x) << 2;
      png.data[offset] = 0;
      png.data[offset + 1] = 0;
      png.data[offset + 2] = 0;
      png.data[offset + 3] = 255;
    }
  }
  await writeFile(filePath, PNG.sync.write(png));
}

describe("Spark agent PDF tool inputs", () => {
  it("exposes reference PDF text extraction without deprecated read_pdf", async () => {
    const { buildSparkAgentTools } = await import(
      "../src/agent/sparkAgentRunner"
    );
    const { applyPdfTranscriptionSkillTools } = await import(
      "../src/agent/skills/pdfTranscription"
    );

    const baseTools = buildSparkAgentTools({
      workspace: buildMinimalWorkspace(),
      rootDir: "/tmp/spark-agent-pdf-tools",
      userId: "test-user",
      serviceAccountJson: "{}",
    });

    expect(baseTools.read_pdf).toBeUndefined();
    const tools = applyPdfTranscriptionSkillTools({
      tools: baseTools,
      rootDir: "/tmp/spark-agent-pdf-tools",
      includeReferenceTextTool: true,
    });

    const referenceTextTool = tools.extract_pdf_reference_text;
    requireFunctionTool(referenceTextTool);

    const parsed = referenceTextTool.inputSchema.parse({
      pdfPath: "grader/uploads/paper.pdf",
      outputPath: "grader/output/reference/pdf-text.md",
      maxChars: null,
      modelId: null,
    }) as {
      pdfPath: string;
      outputPath: string;
      maxChars?: unknown;
      modelId?: unknown;
    };
    expect(parsed).toMatchObject({
      pdfPath: "grader/uploads/paper.pdf",
      outputPath: "grader/output/reference/pdf-text.md",
    });
    expect(parsed.maxChars).toBeUndefined();
    expect(parsed.modelId).toBeUndefined();
  });

  it("normalizes nullable optional fields on extract_pdf_diagrams", async () => {
    const { buildSparkAgentTools } = await import(
      "../src/agent/sparkAgentRunner"
    );

    const tools = buildSparkAgentTools({
      workspace: buildMinimalWorkspace(),
      rootDir: "/tmp/spark-agent-pdf-tools",
      userId: "test-user",
      serviceAccountJson: "{}",
    });

    const diagramTool = tools.extract_pdf_diagrams;
    requireFunctionTool(diagramTool);

    const parsed = diagramTool.inputSchema.parse({
      url: null,
      pdfPath: "grader/uploads/paper.pdf",
      prompt: "Find the source figures.",
      promptPath: null,
      outputPath: "grader/output/diagram-manifest.json",
      modelId: null,
    });

    expect(parsed).toMatchObject({
      pdfPath: "grader/uploads/paper.pdf",
      prompt: "Find the source figures.",
      outputPath: "grader/output/diagram-manifest.json",
    });
  });

  it("allows redundant extract_pdf_diagrams alternatives and runtime source/prompt inference", async () => {
    const { buildSparkAgentTools } = await import(
      "../src/agent/sparkAgentRunner"
    );

    const tools = buildSparkAgentTools({
      workspace: buildMinimalWorkspace(),
      rootDir: "/tmp/spark-agent-pdf-tools",
      userId: "test-user",
      serviceAccountJson: "{}",
    });

    const diagramTool = tools.extract_pdf_diagrams;
    requireFunctionTool(diagramTool);

    expect(
      diagramTool.inputSchema.safeParse({
        url: "https://example.test/paper.pdf",
        pdfPath: "grader/uploads/paper.pdf",
        prompt: "Find all source figures and option diagrams.",
        promptPath: "grader/task.md",
        outputPath: "grader/output/diagram-manifest.json",
        modelId: "gemini-2.5-pro",
        maxDiagrams: 20,
      }).success,
    ).toBe(true);

    expect(
      diagramTool.inputSchema.safeParse({
        url: null,
        pdfPath: null,
        prompt: "Find all diagrams.",
        outputPath: "grader/output/diagram-manifest.json",
      }).success,
    ).toBe(true);

    expect(
      diagramTool.inputSchema.safeParse({
        pdfPath: "grader/uploads/paper.pdf",
        prompt: null,
        promptPath: null,
        outputPath: "grader/output/diagram-manifest.json",
      }).success,
    ).toBe(true);
  });

  it("uses exact crop_image bbox coordinates by default", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "assets"), { recursive: true });
      await writeSourcePng(path.join(rootDir, "assets/source.png"));

      const tools = buildSparkAgentTools({
        workspace: buildMinimalWorkspace(),
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
      });

      const cropTool = tools.crop_image;
      requireFunctionTool(cropTool);

      const output = await cropTool.execute({
        sourcePath: "assets/source.png",
        outputPath: "assets/crop.png",
        bbox1000: {
          left: 400,
          top: 400,
          right: 600,
          bottom: 600,
        },
      });
      const cropped = PNG.sync.read(
        await readFile(path.join(rootDir, "assets/crop.png")),
      );

      expect(output).toMatchObject({
        paddingPx: 0,
        requestedBBoxPixels: {
          left: 40,
          top: 40,
          right: 60,
          bottom: 60,
        },
        bboxPixels: {
          left: 40,
          top: 40,
          right: 60,
          bottom: 60,
        },
      });
      expect(cropped.width).toBe(20);
      expect(cropped.height).toBe(20);
    });
  });

  it("accepts pixel coordinates for crop refinement", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );
      const { applyPdfTranscriptionSkillTools } = await import(
        "../src/agent/skills/pdfTranscription"
      );

      await mkdir(path.join(rootDir, "assets"), { recursive: true });
      await writeSourcePng(path.join(rootDir, "assets/source.png"));

      const baseTools = buildSparkAgentTools({
        workspace: buildMinimalWorkspace(),
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
      });
      const tools = applyPdfTranscriptionSkillTools({
        tools: baseTools,
        rootDir,
        includeReferenceTextTool: true,
      });

      const cropTool = tools.crop_image;
      requireFunctionTool(cropTool);

      expect(
        cropTool.inputSchema.safeParse({
          sourcePath: "assets/source.png",
          outputPath: "assets/crop.png",
        }).success,
      ).toBe(false);
      expect(
        cropTool.inputSchema.safeParse({
          sourcePath: "assets/source.png",
          outputPath: "assets/crop.png",
          bboxPixels: {
            left: 40,
            top: 40,
            right: 60,
            bottom: 60,
          },
        }).success,
      ).toBe(true);
      expect(
        cropTool.inputSchema.safeParse({
          sourcePath: "assets/source.png",
          outputPath: "assets/crop.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        }).success,
      ).toBe(false);
      expect(
        cropTool.inputSchema.safeParse({
          sourcePath: "assets/source.png",
          outputPath: "assets/crop.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
          bboxPixels: {
            left: 40,
            top: 40,
            right: 60,
            bottom: 60,
          },
        }).success,
      ).toBe(false);

      const output = await cropTool.execute({
        sourcePath: "assets/source.png",
        outputPath: "assets/crop.png",
        bboxPixels: {
          left: 40,
          top: 40,
          right: 60,
          bottom: 60,
        },
      });
      const cropped = PNG.sync.read(
        await readFile(path.join(rootDir, "assets/crop.png")),
      );

      expect(output).toMatchObject({
        paddingPx: 0,
        requestedBBoxPixels: {
          left: 40,
          top: 40,
          right: 60,
          bottom: 60,
        },
        bboxPixels: {
          left: 40,
          top: 40,
          right: 60,
          bottom: 60,
        },
      });
      expect(cropped.width).toBe(20);
      expect(cropped.height).toBe(20);
    });
  });

  it("exposes a dedicated fresh crop validation tool", async () => {
    const { buildSparkAgentTools } = await import(
      "../src/agent/sparkAgentRunner"
    );

    const tools = buildSparkAgentTools({
      workspace: buildMinimalWorkspace(),
      rootDir: "/tmp/spark-agent-pdf-tools",
      userId: "test-user",
      serviceAccountJson: "{}",
      graderPublish: { mode: "mock", runId: "sheet-1" },
    });

    const reviewTool = tools.validate_crop_with_fresh_agent;
    requireFunctionTool(reviewTool);
    const proposeTool = tools.propose_crop_bbox_with_fresh_agent;
    requireFunctionTool(proposeTool);
    expect(
      reviewTool.inputSchema.safeParse({
        cropPath: "grader/output/assets/figure-1.png",
        sourceLabel: "Figure 1",
        questionContext: "Use Figure 1 to answer question 1.",
      }).success,
    ).toBe(true);
    expect(
      proposeTool.inputSchema.safeParse({
        targetLabel: "Figure 1",
        questionContext: "Use Figure 1 to answer question 1.",
        fullPagePath: "grader/output/page-images/page-0001.png",
        fullPageGridPath: "grader/output/page-images/page-0001-grid.png",
        badCropPath: "grader/output/assets/figure-1-bad.png",
        badCropGridPath: "grader/output/assets/figure-1-bad-grid.png",
      }).success,
    ).toBe(true);
  });

  it("adds a clean white border around final crops with pad_image", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "assets"), { recursive: true });
      await writeSourcePng(path.join(rootDir, "assets/source.png"));

      const tools = buildSparkAgentTools({
        workspace: buildMinimalWorkspace(),
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
      });

      const padTool = tools.pad_image;
      requireFunctionTool(padTool);

      const output = await padTool.execute({
        sourcePath: "assets/source.png",
        outputPath: "assets/padded.png",
        paddingPx: 6,
      });
      const padded = PNG.sync.read(
        await readFile(path.join(rootDir, "assets/padded.png")),
      );

      expect(output).toMatchObject({
        sourceWidth: 100,
        sourceHeight: 100,
        outputWidth: 112,
        outputHeight: 112,
        paddingPx: 6,
      });
      expect(padded.width).toBe(112);
      expect(padded.height).toBe(112);
      expect([padded.data[0], padded.data[1], padded.data[2], padded.data[3]]).toEqual([
        255,
        255,
        255,
        255,
      ]);
      const blackOffset = (112 * 46 + 46) << 2;
      expect([
        padded.data[blackOffset],
        padded.data[blackOffset + 1],
        padded.data[blackOffset + 2],
        padded.data[blackOffset + 3],
      ]).toEqual([0, 0, 0, 255]);
    });
  });

  it("blocks excessive grader image edits before publish artifacts exist", async () => {
    await withTempDir(async (rootDir) => {
      const { buildSparkAgentTools } = await import(
        "../src/agent/sparkAgentRunner"
      );

      await mkdir(path.join(rootDir, "assets"), { recursive: true });
      await writeSourcePng(path.join(rootDir, "assets/source.png"));

      const tools = buildSparkAgentTools({
        workspace: buildMinimalWorkspace(),
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        graderPublish: { mode: "mock" },
      });

      const cropTool = tools.crop_image;
      requireFunctionTool(cropTool);

      for (let index = 0; index < 80; index += 1) {
        await cropTool.execute({
          sourcePath: "assets/source.png",
          outputPath: `assets/crop${index.toString()}.png`,
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        });
      }

      await expect(
        cropTool.execute({
          sourcePath: "assets/source.png",
          outputPath: "assets/crop-blocked.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        message: expect.stringContaining("pre-publish image-edit budget exceeded"),
      });

      const repeatedTools = buildSparkAgentTools({
        workspace: buildMinimalWorkspace(),
        rootDir,
        userId: "test-user",
        serviceAccountJson: "{}",
        graderPublish: { mode: "mock" },
      });
      const repeatedCropTool = repeatedTools.crop_image;
      requireFunctionTool(repeatedCropTool);
      for (let index = 0; index < 6; index += 1) {
        await repeatedCropTool.execute({
          sourcePath: "assets/source.png",
          outputPath: "assets/repeated-crop.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        });
      }

      await expect(
        repeatedCropTool.execute({
          sourcePath: "assets/source.png",
          outputPath: "assets/repeated-crop-final.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        }),
      ).resolves.toMatchObject({
        status: "blocked",
        message: expect.stringContaining(
          "repeated pre-publish crop-attempt budget exceeded",
        ),
      });

      await expect(
        repeatedCropTool.execute({
          sourcePath: "assets/source.png",
          outputPath: "assets/different-crop.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        }),
      ).resolves.toMatchObject({ status: "written" });

      await mkdir(path.join(rootDir, "grader/output"), { recursive: true });
      await writeFile(path.join(rootDir, "grader/output/sheet.json"), "{}");
      await writeFile(path.join(rootDir, "grader/output/run-summary.json"), "{}");

      await expect(
        cropTool.execute({
          sourcePath: "assets/source.png",
          outputPath: "assets/crop-after-artifact.png",
          bbox1000: {
            left: 400,
            top: 400,
            right: 600,
            bottom: 600,
          },
        }),
      ).resolves.toMatchObject({ status: "written" });
    });
  });
});
