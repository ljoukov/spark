import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { tool, type LlmToolSet } from "@ljoukov/llm";
import { z } from "zod";
import { getSharp } from "../../utils/sharp";

const execFileAsync = promisify(execFile);

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
- For text-selectable PDFs, use 'extract_pdf_reference_text' once before bulk page viewing; it is a cheap navigation/transcription aid, not a replacement for visual checks of diagrams, tables, labels, or layout.
- Keep diagram crops tight and clean: include all labels, leave a small clean margin around required ink, and exclude unrelated text/graphics where practical.

## Page Discovery

- Convert the full PDF to page images with 'pdf_to_images' before per-problem extraction.
- If 'extract_pdf_reference_text' is available:
  - Extract once into 'output/reference/pdf-text.md'.
  - Read tool response metadata ('problemPages' and 'pages') to prioritize likely relevant pages.
  - Start visual inspection on those pages first; inspect additional pages only if needed.
  - Do not compensate for text extraction failures by loading many high-resolution pages or crops into the main context; use page overviews plus targeted crops, and delegate bulk crop validation through 'validate_crop_with_fresh_agent' when it is available.
- If 'extract_pdf_reference_text' is unavailable:
  - Inspect every rendered page with 'view_image'.

## Mandatory Grid-First Planning

- Before page-level diagram cropping, create a grid overlay image for the source page using 'draw_grid_overlay'.
- Use '*-grid.png' naming (example: 'page-0003-grid.png').
- Always inspect the grid image with 'view_image' before choosing crop coordinates.
- Do not start diagram crops from non-grid page inspection.
- For crop refinement, do not do mask segmentation. Isolate one clean rectangular crop per target figure. Start from a previous bad crop if it contains the whole figure; use the full source page only if the bad crop clips part of the figure. Inspect both the selected base image and its coordinate-grid overlay with 'view_image'. Choose a pixel bounding box in the selected base image coordinate space, with origin at top-left and right/bottom as exclusive crop boundaries.
- Prefer a small safe white margin over any clipping. Reject crops that include surrounding question text, mark text, answer lines, page borders, next-question content, or standalone figure/table captions already rendered by the worksheet.
- When documenting a crop-refinement decision, use JSON shape { "cropBase": "badCrop" | "fullPage", "bbox": { "left": number, "top": number, "right": number, "bottom": number }, "reasoning": "brief edge-by-edge explanation", "risks": [] }. Apply the box with 'crop_image' using 'bboxPixels' on the selected base image.

## Diagram Crop Loop

Use at most two attempts per diagram in the main agent, and never more than six 'crop_image' calls for the same output asset before switching strategy.
If one manual crop-and-view correction for the same target is still clipped, noisy, or uncertain, call 'propose_crop_bbox_with_fresh_agent' when available, or 'extract_pdf_diagrams' for that source page and target label, before spending more turns on hand-tuned crop boxes.

- Attempt pattern:
  - 'crop_image' with 'bboxPixels' from the original page image or selected complete bad crop
  - 'view_image' on crop output
  - 'trim_image' for content-aware tightening
  - 'view_image' on trimmed output
  - Re-crop from original full page if needed, then trim/view again
- 'crop_image' requirements:
  - Always use 'bboxPixels' integer coordinates.
  - Do not omit bboxPixels.
  - Do not use 'fullImage: true' for diagram extraction.
- If a crop clips any label/geometry or leaves required ink touching an edge, re-crop from the original full page and expand in the clipped direction before tightening any other side.
- If a crop contains unrelated text/graphics, re-crop tighter.
- Use pad_image only after a crop has passed fresh visual validation and only needs a clean white border. Do not use padding to fix a failed crop review, clipping, missing content, unrelated text, or duplicated standalone captions.
- For grading tasks, missing required labels, table cells, option text, axes, or annotations is worse than slight extra whitespace. Do not publish a tight crop that removes information needed by the question.
- For objective questions whose choices are diagrams, crop one complete options block or separate complete option crops. Every candidate label and every option diagram/shape must be fully visible; do not let a candidate option be cut at the crop edge.
- For worksheet/grading outputs, source/reference markdown is only an audit trail. If a problem statement mentions a diagram, figure, graph, chart, map, network, photo, or other answer-critical visual, the final visible worksheet prompt must include the linked crop near that text; do not hide the visual in references.
- If 'view_image' fails on any workspace image or rendered PDF page because file upload/canonical-file configuration is unavailable, use 'crop_image' to create a local PNG overview or relevant crop under the output/assets directory, then inspect that generated image with 'view_image' before grading or publishing. Do not switch to 'extract_pdf_diagrams' as a fallback for 'view_image' failures.

## Subagent and Non-Subagent Execution

- Process page/diagram discovery in the main agent. Generic 'spawn_agent' may be unavailable in grader runs and must not be used for intake or file summaries.
- For long papers with many final crops, keep the main context small: spot-check at most 4 representative final crops in the main agent, then call 'validate_crop_with_fresh_agent' once per final linked figure/image crop with workspace paths and question context instead of opening every final crop in the main agent.
- If 'validate_crop_with_fresh_agent' is unavailable, run the same visual check sequentially in the main agent.

## Quality Gate Before Completion

For each final diagram, verify:

- all required labels/annotations are visible,
- no unrelated text fragments are present,
- crop bounds are tight around the diagram.
- for grading outputs, have 'validate_crop_with_fresh_agent' inspect each final linked figure/image crop with the question context and 'view_image' before completion.
- write 'grader/output/crop-validation.md' (or the caller's requested validation path) listing each final linked crop path, source question/figure/table label, 'fresh-context subagent checked: yes', reviewer-visible text transcribed from the crop, exact pass/fail, whether all required content is visible, whether unrelated visible text/non-target ink is present, whether required content touches or clips at an edge, and whether page borders/separator lines/answer lines/neighbouring-question fragments are present.

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
  "For formulas/equations, use embedded LaTeX: inline '\\(...\\)', display '\\[...\\]'. Use real Markdown line breaks, never literal escaped newline text like '\\n'. For arranged arithmetic, grids, or layout-critical text, prefer a Markdown table or a clean crop over raw LaTeX array/tabular environments.",
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
  bbox1000?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  bboxPixels?: {
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeLocalPdfText(options: {
  rawText: string;
  maxChars: number;
}): { text: string; pageCount: number; truncated: boolean } {
  const normalized = options.rawText.replace(/\r\n?/gu, "\n");
  const rawPages = normalized.split("\f");
  const pageSections: string[] = [];

  for (const [index, rawPage] of rawPages.entries()) {
    const pageText = rawPage.replace(/[ \t]+\n/gu, "\n").trim();
    const isTrailingFormFeed =
      index === rawPages.length - 1 &&
      pageText.length === 0 &&
      rawPages.length > 1;
    if (isTrailingFormFeed) {
      continue;
    }
    pageSections.push(`## Page ${index + 1}\n\n${pageText}`.trimEnd());
  }

  const fullText = pageSections.join("\n\n").trim();
  const text =
    fullText.length > options.maxChars
      ? fullText.slice(0, options.maxChars)
      : fullText;
  return {
    text,
    pageCount: pageSections.length,
    truncated: text.length < fullText.length,
  };
}

async function extractReferenceTextWithPdftotext(options: {
  pdfPath: string;
  maxChars: number;
}): Promise<{ text: string; pageCount: number; truncated: boolean }> {
  const maxBuffer = Math.min(
    Math.max(options.maxChars * 8, 1024 * 1024),
    24 * 1024 * 1024,
  );
  const { stdout } = await execFileAsync(
    "pdftotext",
    ["-layout", "-enc", "UTF-8", options.pdfPath, "-"],
    { maxBuffer },
  );
  const rawText = stdout;
  const normalized = normalizeLocalPdfText({
    rawText,
    maxChars: options.maxChars,
  });
  if (normalized.text.trim().length === 0) {
    throw new Error("pdftotext produced no text.");
  }
  return normalized;
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

  const strictCropBboxPixelsSchema = z
    .object({
      left: z.number().int().min(0),
      top: z.number().int().min(0),
      right: z.number().int().min(0),
      bottom: z.number().int().min(0),
    })
    .superRefine((bbox, context) => {
      if (bbox.right <= bbox.left) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxPixels.right must be greater than left.",
          path: ["right"],
        });
      }
      if (bbox.bottom <= bbox.top) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxPixels.bottom must be greater than top.",
          path: ["bottom"],
        });
      }
    });
  const strictCropInputSchema = z
    .object({
      sourcePath: z.string().trim().min(1),
      outputPath: z.string().trim().min(1),
      bboxPixels: strictCropBboxPixelsSchema,
    })
    .strict();

  const strictCropImageTool = tool({
    description: [
      "Crop an image (JPG/PNG/WEBP/GIF/HEIC/HEIF) using a required bboxPixels rectangle.",
      "Use bboxPixels for crop-refinement JSON based on a rendered page or bad-crop coordinate grid: origin is top-left and right/bottom are exclusive.",
      "The cropped output is written as PNG with the exact bboxPixels rectangle by default; include the intended safe white margin in bboxPixels.",
      "Always provide bboxPixels; do not call this tool without bbox values.",
      "Do not pass null, zero, or tiny placeholder coordinates.",
      "If a crop is clipped or ink touches an edge, expand the bbox outward from the source page; do not tighten the bbox to silence edge checks.",
    ].join("\n"),
    inputSchema: strictCropInputSchema,
    execute: async ({ sourcePath, outputPath, bboxPixels }) => {
      const delegate = cropToolCandidate as {
        execute: (input: CropImageInput) => unknown;
      };
      return await Promise.resolve(
        delegate.execute({
          sourcePath,
          outputPath,
          bboxPixels,
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
      "Use only after a complete crop is known; trim_image cannot recover labels, options, axes, or table cells that crop_image already clipped.",
      "After trimming, inspect with view_image. If required ink touches an edge, recrop from the original page or rerun trim_image with larger padding.",
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
    const hasReadPdfDelegate =
      readPdfToolCandidate !== null &&
      readPdfToolCandidate !== undefined &&
      typeof readPdfToolCandidate === "object" &&
      "execute" in readPdfToolCandidate &&
      typeof (readPdfToolCandidate as { execute?: unknown }).execute ===
        "function";

    const extractPdfReferenceTextTool = tool({
      description: [
        "Extract faithful reference text from a workspace PDF into markdown using local PDF text when available.",
        "Use this before transcription so image-based reading can be cross-checked against PDF text without loading every page image into the main context.",
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
        const safeMaxChars = maxChars ?? 180_000;
        const resolvedOutputPath = resolveWorkspacePath(
          options.rootDir,
          outputPath,
        );
        let resultRecord: Record<string, unknown>;
        let extractedReferenceText: string;

        try {
          const resolvedPdfPath = resolveWorkspacePath(options.rootDir, pdfPath);
          const localExtraction = await extractReferenceTextWithPdftotext({
            pdfPath: resolvedPdfPath,
            maxChars: safeMaxChars,
          });
          await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
          await writeFile(resolvedOutputPath, localExtraction.text, "utf8");
          onFileWritten(outputPath);
          extractedReferenceText = localExtraction.text;
          resultRecord = {
            status: "written",
            extractionMode: "pdftotext",
            outputPath,
            textChars: localExtraction.text.length,
            pageCount: localExtraction.pageCount,
            ...(localExtraction.truncated ? { truncated: true } : {}),
          };
        } catch (localError) {
          if (!hasReadPdfDelegate) {
            throw new Error(
              `extract_pdf_reference_text could not run local pdftotext and no read_pdf fallback is available: ${errorMessage(localError)}`,
            );
          }

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
              maxChars: safeMaxChars,
              ...(typeof modelId === "string" ? { modelId } : {}),
            }),
          );

          const delegateRecord =
            delegateResult &&
            typeof delegateResult === "object" &&
            !Array.isArray(delegateResult)
              ? (delegateResult as Record<string, unknown>)
              : {};
          extractedReferenceText = await readFile(resolvedOutputPath, "utf8");
          resultRecord = {
            ...delegateRecord,
            extractionMode: "read_pdf_fallback",
            localExtractionError: errorMessage(localError),
          };
        }
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
