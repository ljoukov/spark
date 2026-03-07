import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { tool, type LlmToolSet } from "@ljoukov/llm";
import { z } from "zod";
import { getSharp } from "../../utils/sharp";

export const PDF_TRANSCRIPTION_SKILL_TEXT = `\
---
name: pdf-transcription
description: Trigger this skill when the task is to transcribe problem statements from a PDF into markdown while extracting clean diagram crops. Do not trigger this skill for plain text-only extraction where diagrams/layout do not matter, or for tasks that do not involve PDF page/image inspection.
---

# PDF Transcription Workflow

Use this workflow for high-fidelity PDF transcription with diagrams.

## Core Principles

- Render PDF pages to images first. Do not rely on raw PDF bytes alone for final transcription decisions.
- For final problem text and diagram correctness, page images are the source of truth.
- If 'extract_pdf_reference_text' is available, use it as an aid only.
- Keep diagram crops tight and clean: include all labels, exclude unrelated text/graphics.

## Page Discovery

- Convert the full PDF to page images with 'pdf_to_images' before per-problem extraction.
- If 'extract_pdf_reference_text' is available:
  - Extract once into 'output/reference/pdf-text.md'.
  - Read tool response metadata ('problemPages' and 'pages') to prioritize likely relevant pages.
  - Start visual inspection on those pages first; inspect additional pages only if needed.
- If 'extract_pdf_reference_text' is unavailable:
  - Inspect every rendered page with 'view_image'.

## Mandatory Grid-First Planning

- Before page-level diagram cropping, create a grid overlay image for the source page using 'draw_grid_overlay'.
- Use '*-grid.png' naming (example: 'page-0003-grid.png').
- Always inspect the grid image with 'view_image' before choosing crop coordinates.
- Do not start diagram crops from non-grid page inspection.

## Diagram Crop Loop

Use at most two attempts per diagram.

- Attempt pattern:
  - 'crop_image' with 'bbox1000' from the original page image
  - 'view_image' on crop output
  - 'trim_image' for content-aware tightening
  - 'view_image' on trimmed output
  - Re-crop from original full page if needed, then trim/view again
- 'crop_image' requirements:
  - Always use 'bbox1000' integer coordinates.
  - Do not omit bbox fields.
  - Do not use 'fullImage: true' for diagram extraction.
- If a crop clips any label/geometry, re-crop from the original full page.
- If a crop contains unrelated text/graphics, re-crop tighter.

## Subagent and Non-Subagent Execution

- If subagent tools are available ('spawn_agent', 'send_input', 'wait'), process independent diagrams/problems in parallel.
- Each subagent instruction should require:
  - step 1 is 'view_image' on the assigned '*-grid.png' page,
  - then crop/view/trim/view refinement loop.
- If subagent tools are unavailable, run the same workflow sequentially in the main agent.

## Quality Gate Before Completion

For each final diagram, verify:

- all required labels/annotations are visible,
- no unrelated text fragments are present,
- crop bounds are tight around the diagram.

Then re-read each problem statement with its diagram and resolve any inconsistencies against page images.

## Output Contract (Default)

If the task does not provide explicit output paths, use:

- 'output/transcription.md' with problem sections and LaTeX math,
- 'output/diagram-manifest.json' with per-problem crop metadata and status,
- 'output/agent-notes.md' documenting crop attempts and failures,
- 'output/diagrams/<name>.png' for final diagram crops,
- 'output/reference/pdf-text.md' only when reference-text extraction is available and requested.`;

const PDF_REFERENCE_PROMPT = [
  "Transcribe this PDF faithfully as markdown for human verification.",
  "Include headings '## Page N' for each page in order.",
  "Preserve punctuation, symbols, and math notation exactly where possible.",
  "Do not summarize and do not solve problems.",
].join("\n");

const PDF_REFERENCE_PROMPT_GEMINI = [
  PDF_REFERENCE_PROMPT,
  "For formulas/equations, use embedded LaTeX: inline '\\(...\\)', display '\\[...\\]'.",
].join("\n");

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  alpha: number;
};

type ReferencePageSummary = {
  page: number;
  textChars: number;
  containsTargetProblem: boolean;
  problemIds: string[];
};

type CropImageInput = {
  sourcePath: string;
  outputPath: string;
  bbox1000: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
};

type ReadPdfInput = {
  pdfPath: string;
  prompt: string;
  outputPath: string;
  maxChars?: number;
  modelId?: string;
};

function resolveWorkspacePath(rootDir: string, inputPath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, inputPath);
  if (
    resolvedTarget !== resolvedRoot &&
    !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolvedTarget;
}

function parseProblemIdsFromText(text: string): string[] {
  const matches = text.match(/\b[A-Z]\d{1,3}\b/gu) ?? [];
  const unique = Array.from(new Set(matches.map((item) => item.toUpperCase())));
  unique.sort((a, b) => a.localeCompare(b));
  return unique;
}

function parseReferencePages(options: {
  referenceText: string;
  targetProblemIds?: readonly string[];
}): ReferencePageSummary[] {
  const headingPattern = /^##\s*Page\s+(\d+)\b.*$/gimu;
  const matches = Array.from(options.referenceText.matchAll(headingPattern));
  if (matches.length === 0) {
    return [];
  }
  const targetSet = new Set(
    (options.targetProblemIds ?? []).map((item) => item.trim().toUpperCase()),
  );

  const summaries: ReferencePageSummary[] = [];
  for (const [index, match] of matches.entries()) {
    const start = match.index;
    const end =
      index + 1 < matches.length
        ? matches[index + 1].index
        : options.referenceText.length;
    const section = options.referenceText.slice(start, end);
    const pageRaw = match[1];
    const page = Number.parseInt(pageRaw, 10);
    if (!Number.isFinite(page) || page <= 0) {
      continue;
    }
    const problemIds = parseProblemIdsFromText(section);
    const containsTargetProblem =
      targetSet.size > 0
        ? problemIds.some((problemId) => targetSet.has(problemId))
        : problemIds.length > 0;
    summaries.push({
      page,
      textChars: section.length,
      containsTargetProblem,
      problemIds,
    });
  }
  return summaries;
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function buildGridOverlaySvg(options: {
  width: number;
  height: number;
  stepPx: number;
  lineWidth: number;
  showLabels: boolean;
}): string {
  const lines: string[] = [];
  const labels: string[] = [];

  for (let x = 0; x <= options.width; x += options.stepPx) {
    lines.push(
      `<line x1="${x.toString()}" y1="0" x2="${x.toString()}" y2="${options.height.toString()}" stroke="rgba(220,32,32,0.8)" stroke-width="${options.lineWidth.toString()}" />`,
    );
    if (options.showLabels) {
      const labelX = Math.min(options.width - 42, Math.max(4, x + 2));
      labels.push(
        `<rect x="${(labelX - 2).toString()}" y="2" width="40" height="14" fill="rgba(255,255,255,0.82)" />`,
      );
      labels.push(
        `<text x="${labelX.toString()}" y="13" fill="rgb(220,32,32)" font-size="10" font-family="monospace">${x.toString()}</text>`,
      );
    }
  }

  for (let y = 0; y <= options.height; y += options.stepPx) {
    lines.push(
      `<line x1="0" y1="${y.toString()}" x2="${options.width.toString()}" y2="${y.toString()}" stroke="rgba(24,120,220,0.8)" stroke-width="${options.lineWidth.toString()}" />`,
    );
    if (options.showLabels) {
      const labelY = Math.min(options.height - 4, Math.max(12, y + 12));
      labels.push(
        `<rect x="2" y="${(labelY - 11).toString()}" width="42" height="14" fill="rgba(255,255,255,0.82)" />`,
      );
      labels.push(
        `<text x="5" y="${labelY.toString()}" fill="rgb(24,120,220)" font-size="10" font-family="monospace">${y.toString()}</text>`,
      );
    }
  }

  return [
    `<svg width="${options.width.toString()}" height="${options.height.toString()}" viewBox="0 0 ${options.width.toString()} ${options.height.toString()}" xmlns="http://www.w3.org/2000/svg">`,
    ...lines,
    ...labels,
    "</svg>",
  ].join("");
}

function readRawPixel(options: {
  data: Uint8Array;
  width: number;
  channels: number;
  x: number;
  y: number;
}): RgbaColor {
  const offset = (options.y * options.width + options.x) * options.channels;
  return {
    r: options.data[offset] ?? 0,
    g: options.data[offset + 1] ?? 0,
    b: options.data[offset + 2] ?? 0,
    alpha: options.channels >= 4 ? (options.data[offset + 3] ?? 255) : 255,
  };
}

function averageColor(colors: readonly RgbaColor[]): RgbaColor {
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
    alpha += color.alpha;
  }
  const count = Math.max(1, colors.length);
  return {
    r: clampChannel(r / count),
    g: clampChannel(g / count),
    b: clampChannel(b / count),
    alpha: clampChannel(alpha / count),
  };
}

function detectForegroundBounds(options: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  fuzzPercent: number;
}): {
  hasForeground: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  tolerance: number;
} {
  if (options.width <= 0 || options.height <= 0) {
    throw new Error("Image dimensions must be positive.");
  }
  if (options.channels < 3) {
    throw new Error(`Expected RGB(A) image, received ${options.channels.toString()} channel(s).`);
  }

  const samplePoints = [
    { x: 0, y: 0 },
    { x: options.width - 1, y: 0 },
    { x: 0, y: options.height - 1 },
    { x: options.width - 1, y: options.height - 1 },
    { x: Math.floor(options.width / 2), y: 0 },
    { x: 0, y: Math.floor(options.height / 2) },
    { x: options.width - 1, y: Math.floor(options.height / 2) },
    { x: Math.floor(options.width / 2), y: options.height - 1 },
  ];

  const cornerColors = samplePoints.map((point) =>
    readRawPixel({
      data: options.data,
      width: options.width,
      channels: options.channels,
      x: point.x,
      y: point.y,
    }),
  );
  const background = averageColor(cornerColors);
  const tolerance = Math.max(0, Math.min(255, Math.round((options.fuzzPercent / 100) * 255)));

  let minX = options.width;
  let minY = options.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const color = readRawPixel({
        data: options.data,
        width: options.width,
        channels: options.channels,
        x,
        y,
      });
      const delta = Math.max(
        Math.abs(color.r - background.r),
        Math.abs(color.g - background.g),
        Math.abs(color.b - background.b),
        Math.abs(color.alpha - background.alpha),
      );
      if (delta <= tolerance) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      hasForeground: false,
      left: 0,
      top: 0,
      right: options.width,
      bottom: options.height,
      tolerance,
    };
  }

  return {
    hasForeground: true,
    left: minX,
    top: minY,
    right: maxX + 1,
    bottom: maxY + 1,
    tolerance,
  };
}

function expandBounds(options: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  paddingPx: number;
  width: number;
  height: number;
}): { left: number; top: number; right: number; bottom: number } {
  const left = Math.max(0, options.left - options.paddingPx);
  const top = Math.max(0, options.top - options.paddingPx);
  const right = Math.min(options.width, options.right + options.paddingPx);
  const bottom = Math.min(options.height, options.bottom + options.paddingPx);
  if (right <= left || bottom <= top) {
    return {
      left: 0,
      top: 0,
      right: options.width,
      bottom: options.height,
    };
  }
  return { left, top, right, bottom };
}

export function applyPdfTranscriptionSkillTools(options: {
  tools: LlmToolSet;
  rootDir: string;
  includeReferenceTextTool: boolean;
  targetProblemIds?: readonly string[];
  onFileWritten?: (outputPath: string) => void;
}): LlmToolSet {
  const toolsRecord = options.tools as Record<string, unknown>;
  const onFileWritten =
    typeof options.onFileWritten === "function" ? options.onFileWritten : () => {};

  const cropToolCandidate = toolsRecord.crop_image;
  if (
    !cropToolCandidate ||
    typeof cropToolCandidate !== "object" ||
    !("execute" in cropToolCandidate) ||
    typeof (cropToolCandidate as { execute?: unknown }).execute !== "function"
  ) {
    throw new Error("Required crop_image tool is not executable.");
  }

  const strictCropImageTool = tool({
    description: [
      "Crop an image (JPG/PNG/WEBP/GIF/HEIC/HEIF) using required bbox1000 integer coordinates.",
      "The cropped output is written as PNG.",
      "Always provide bbox1000; do not call this tool without bbox values.",
    ].join("\n"),
    inputSchema: z
      .object({
        sourcePath: z.string().trim().min(1),
        outputPath: z.string().trim().min(1),
        bbox1000: z.object({
          left: z.number().int().min(0).max(1000),
          top: z.number().int().min(0).max(1000),
          right: z.number().int().min(0).max(1000),
          bottom: z.number().int().min(0).max(1000),
        }),
      })
      .strict(),
    execute: async ({ sourcePath, outputPath, bbox1000 }) => {
      const delegate = cropToolCandidate as {
        execute: (input: CropImageInput) => unknown;
      };
      return await Promise.resolve(
        delegate.execute({
          sourcePath,
          outputPath,
          bbox1000,
        }),
      );
    },
  });

  const drawGridOverlayTool = tool({
    description: [
      "Draw a coordinate grid on top of an image (JPG/PNG/WEBP/GIF/HEIC/HEIF) to help estimate crop coordinates.",
      "The grid output is written as PNG.",
      "Use this only for planning; keep final diagram crops grid-free.",
    ].join("\n"),
    inputSchema: z
      .object({
        sourcePath: z.string().trim().min(1),
        outputPath: z.string().trim().min(1),
        stepPx: z.number().int().min(20).max(1200).optional(),
        lineWidth: z.number().int().min(1).max(6).optional(),
        showLabels: z.boolean().optional(),
      })
      .strict(),
    execute: async ({ sourcePath, outputPath, stepPx, lineWidth, showLabels }) => {
      const sourceAbsolutePath = resolveWorkspacePath(options.rootDir, sourcePath);
      const outputAbsolutePath = resolveWorkspacePath(options.rootDir, outputPath);
      const sourceBytes = await readFile(sourceAbsolutePath);
      const sharp = getSharp();
      const metadata = await sharp(sourceBytes).metadata();
      const width = metadata.width;
      const height = metadata.height;
      if (
        typeof width !== "number" ||
        typeof height !== "number" ||
        width <= 0 ||
        height <= 0
      ) {
        throw new Error(`Cannot read image dimensions for ${sourcePath}`);
      }
      const resolvedStep = stepPx ?? 200;
      const resolvedLineWidth = lineWidth ?? 1;
      const overlaySvg = buildGridOverlaySvg({
        width,
        height,
        stepPx: resolvedStep,
        lineWidth: resolvedLineWidth,
        showLabels: showLabels ?? true,
      });
      const outputBytes = await sharp(sourceBytes)
        .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
        .png()
        .toBuffer();
      await mkdir(path.dirname(outputAbsolutePath), { recursive: true });
      await writeFile(outputAbsolutePath, outputBytes);
      onFileWritten(outputPath);
      return {
        status: "written",
        sourcePath,
        outputPath,
        width,
        height,
        stepPx: resolvedStep,
        lineWidth: resolvedLineWidth,
        showLabels: showLabels ?? true,
        outputBytes: outputBytes.byteLength,
      };
    },
  });

  const trimImageTool = tool({
    description: [
      "Content-aware trim for images (JPG/PNG/WEBP/GIF/HEIC/HEIF): removes near-background margins and keeps a small border.",
      "The trimmed output is written as PNG.",
      "Use after crop_image to tighten diagram bounds while preserving labels.",
    ].join("\n"),
    inputSchema: z
      .object({
        sourcePath: z.string().trim().min(1),
        outputPath: z.string().trim().min(1),
        fuzzPercent: z.number().min(0).max(10).optional(),
        paddingPx: z.number().int().min(0).max(128).optional(),
      })
      .strict(),
    execute: async ({ sourcePath, outputPath, fuzzPercent, paddingPx }) => {
      const sourceAbsolutePath = resolveWorkspacePath(options.rootDir, sourcePath);
      const outputAbsolutePath = resolveWorkspacePath(options.rootDir, outputPath);
      const sourceBytes = await readFile(sourceAbsolutePath);
      const sharp = getSharp();
      const decoded = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({
        resolveWithObject: true,
      });
      const bounds = detectForegroundBounds({
        data: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels,
        fuzzPercent: fuzzPercent ?? 1,
      });
      const padded = expandBounds({
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        paddingPx: paddingPx ?? 14,
        width: decoded.info.width,
        height: decoded.info.height,
      });
      const cropped = await sharp(sourceBytes)
        .extract({
          left: padded.left,
          top: padded.top,
          width: padded.right - padded.left,
          height: padded.bottom - padded.top,
        })
        .png()
        .toBuffer();
      await mkdir(path.dirname(outputAbsolutePath), { recursive: true });
      await writeFile(outputAbsolutePath, cropped);
      onFileWritten(outputPath);
      return {
        status: "written",
        sourcePath,
        outputPath,
        sourceWidth: decoded.info.width,
        sourceHeight: decoded.info.height,
        hasForeground: bounds.hasForeground,
        trimBounds: {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
        },
        outputBounds: padded,
        tolerance: bounds.tolerance,
        outputBytes: cropped.byteLength,
      };
    },
  });

  const nextTools: LlmToolSet = {
    ...options.tools,
    crop_image: strictCropImageTool,
    draw_grid_overlay: drawGridOverlayTool,
    trim_image: trimImageTool,
  };

  if (options.includeReferenceTextTool) {
    const readPdfToolCandidate = toolsRecord.read_pdf;
    if (
      !readPdfToolCandidate ||
      typeof readPdfToolCandidate !== "object" ||
      !("execute" in readPdfToolCandidate) ||
      typeof (readPdfToolCandidate as { execute?: unknown }).execute !== "function"
    ) {
      throw new Error("Required read_pdf tool is not executable.");
    }

    const extractPdfReferenceTextTool = tool({
      description: [
        "Extract faithful reference text from a workspace PDF into markdown.",
        "Use this before transcription so image-based reading can be cross-checked against PDF text.",
      ].join("\n"),
      inputSchema: z
        .object({
          pdfPath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
          maxChars: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              return value;
            },
            z.number().int().min(200).max(180_000).optional(),
          ),
          modelId: z.preprocess(
            (value) => {
              if (value === null || value === undefined) {
                return undefined;
              }
              return value;
            },
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({ pdfPath, outputPath, maxChars, modelId }) => {
        const useGeminiPrompt =
          typeof modelId === "string"
            ? modelId.toLowerCase().startsWith("gemini-")
            : true;
        const promptText = useGeminiPrompt
          ? PDF_REFERENCE_PROMPT_GEMINI
          : PDF_REFERENCE_PROMPT;

        const delegate = readPdfToolCandidate as {
          execute: (input: ReadPdfInput) => unknown;
        };
        const delegateResult = await Promise.resolve(
          delegate.execute({
            pdfPath,
            prompt: promptText,
            outputPath,
            ...(typeof maxChars === "number" ? { maxChars } : {}),
            ...(typeof modelId === "string" ? { modelId } : {}),
          }),
        );

        const resultRecord =
          delegateResult && typeof delegateResult === "object" && !Array.isArray(delegateResult)
            ? (delegateResult as Record<string, unknown>)
            : {};
        const resolvedOutputPath = resolveWorkspacePath(options.rootDir, outputPath);
        const extractedReferenceText = await readFile(resolvedOutputPath, "utf8");
        const pages = parseReferencePages({
          referenceText: extractedReferenceText,
          targetProblemIds: options.targetProblemIds,
        });
        const problemPages = pages
          .filter((entry) => entry.containsTargetProblem)
          .map((entry) => entry.page);

        return {
          ...resultRecord,
          pageCountFromHeadings: pages.length,
          problemPages,
          pages,
        };
      },
    });
    (nextTools as Record<string, unknown>).extract_pdf_reference_text = extractPdfReferenceTextTool;
  }

  return nextTools;
}
