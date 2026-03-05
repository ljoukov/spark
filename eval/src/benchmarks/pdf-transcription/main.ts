import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  access,
  cp,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";

import { Command } from "commander";
import { z } from "zod";

import { buildSparkAgentTools } from "@spark/llm/agent/sparkAgentRunner";
import {
  estimateCallCostUsd,
  generateText,
  parseJsonFromLlmText,
  type LlmContent,
  type LlmContentPart,
  type LlmTextModelId,
} from "@spark/llm/utils/llm";
import {
  getPdfPageCount,
  cropBgraBitmapByNorm,
  encodeBgraBitmapToPng,
  renderPdfPagesBgra,
  type PdfiumBitmap,
} from "@spark/llm/utils/pdfium";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  LlmUsageTokenUpdate,
  ModelCallHandle,
  StageHandle,
} from "@spark/llm/utils/concurrency";

import { ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE_PDF_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "hamilton-2017-q.pdf",
);
const RESULTS_MARKDOWN_PATH = path.join(BENCHMARK_DIR, "RESULTS.md");
const BENCHMARK_OUTPUT_DIR = path.join(BENCHMARK_DIR, "output");
const REPORT_OUTPUT_DIR = path.join(BENCHMARK_OUTPUT_DIR, "report");
const RUNS_OUTPUT_DIR = path.join(BENCHMARK_OUTPUT_DIR, "runs");
const REPORT_JSON_BASENAME = "benchmark-results.json";
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const PROBLEM_IDS = ["H1", "H2", "H3"] as const;

type ProblemId = (typeof PROBLEM_IDS)[number];

type StrategyId = "bulk" | "individual";
type CoordinateMode = "norm" | "int1000";

type Approach = {
  id:
    | "pdf-gemini-flash"
    | "pdf-gemini-pro"
    | "images-chatgpt-5-3-codex"
    | "images-gpt-5-2";
  label: string;
  type: "pdf_tool" | "image_model";
  modelId: LlmTextModelId;
};

const APPROACHES: readonly Approach[] = [
  {
    id: "pdf-gemini-flash",
    label: "PDF + gemini-flash-latest",
    type: "pdf_tool",
    modelId: "gemini-flash-latest",
  },
  {
    id: "pdf-gemini-pro",
    label: "PDF + gemini-2.5-pro",
    type: "pdf_tool",
    modelId: "gemini-2.5-pro",
  },
  {
    id: "images-chatgpt-5-3-codex",
    label: "PDF as images + chatgpt-gpt-5.3-codex",
    type: "image_model",
    modelId: "chatgpt-gpt-5.3-codex",
  },
  {
    id: "images-gpt-5-2",
    label: "PDF as images + gpt-5.2",
    type: "image_model",
    modelId: "gpt-5.2",
  },
] as const;

const STRATEGIES: readonly StrategyId[] = ["bulk", "individual"] as const;
const COORDINATE_MODES: readonly CoordinateMode[] = ["norm", "int1000"] as const;

const JUDGE_MODEL_IDS = [
  "gemini-2.5-pro",
  "chatgpt-gpt-5.3-codex",
] as const satisfies readonly [LlmTextModelId, LlmTextModelId];

const DiagramManifestSchema = z.object({
  diagrams: z.array(
    z.object({
      id: z.string().trim().min(1),
      problemId: z.string().trim().min(1),
      page: z.number().int().min(1),
      bboxNorm: z.object({
        left: z.number().min(0).max(1),
        top: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      }),
      bbox1000: z
        .object({
          left: z.number().int().min(0).max(1000),
          top: z.number().int().min(0).max(1000),
          right: z.number().int().min(0).max(1000),
          bottom: z.number().int().min(0).max(1000),
        })
        .optional(),
      label: z.string().trim().min(1).optional(),
      description: z.string().trim().min(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }),
  ),
  notes: z.string().trim().min(1).optional(),
});

type DiagramManifest = z.infer<typeof DiagramManifestSchema>;

type FunctionToolLike = {
  inputSchema: { parse: (input: unknown) => unknown };
  execute: (input: unknown) => Promise<unknown>;
};

type ModelCallMetrics = {
  modelId: string;
  modelVersion: string | null;
  elapsedMs: number;
  costUsd: number;
  usageTokens: LlmUsageTokenUpdate | null;
};

type ToolCallResult = {
  result: Record<string, unknown>;
  metrics: ModelCallMetrics;
};

type JudgeVerdict = {
  modelId: LlmTextModelId;
  verdict: "pass" | "fail";
  summary: string;
  issues: string[];
  metrics: ModelCallMetrics;
};

type BenchmarkExperimentResult = {
  approachId: Approach["id"];
  approachLabel: string;
  strategy: StrategyId;
  coordinateMode: CoordinateMode;
  status: "pass" | "fail";
  reason: string;
  runDir: string;
  outputMarkdownPath: string;
  outputJsonPath: string;
  reportOutputDir: string;
  reportOutputMarkdownPath: string;
  reportDiagramImagePaths: string[];
  reportSourcePageImagePaths: string[];
  manifests: string[];
  pipeline: {
    modelCalls: number;
    latencyMs: number;
    costUsd: number;
  };
  judging: {
    modelCalls: number;
    latencyMs: number;
    costUsd: number;
    verdicts: JudgeVerdict[];
  };
  total: {
    latencyMs: number;
    costUsd: number;
  };
};

type BenchmarkReport = {
  generatedAt: string;
  sourcePdfPath: string;
  reportJsonPath: string;
  experiments: BenchmarkExperimentResult[];
};

const progressState: { total: number; completed: number } = {
  total: 1,
  completed: 0,
};

function setProgressTotal(total: number): void {
  progressState.total = Math.max(1, Math.floor(total));
  progressState.completed = 0;
}

function incrementProgress(): void {
  progressState.completed = Math.min(progressState.total, progressState.completed + 1);
}

function getProgressPercent(): number {
  if (progressState.total <= 0) {
    return 0;
  }
  return Math.round((progressState.completed / progressState.total) * 100);
}

function logStep(message: string): void {
  const percent = getProgressPercent().toString().padStart(2, "0");
  console.log(`[${percent}%] [pdf-bench] ${message}`);
}

function createToolProgressReporter(): JobProgressReporter {
  return {
    log: (message) => {
      logStep(message);
    },
    startModelCall: ({ modelId }) => {
      return Symbol(`pdf-bench-tool-model:${modelId}`);
    },
    recordModelUsage: (_handle: ModelCallHandle, _chunk: LlmUsageChunk) => {},
    finishModelCall: (_handle: ModelCallHandle) => {},
    startStage: (_stageName: string): StageHandle => {
      return Symbol("pdf-bench-tool-stage");
    },
    finishStage: (_handle: StageHandle) => {},
    setActiveStages: (_stages: Iterable<string>) => {},
  };
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "n/a";
  }
  if (ms < 1000) {
    return `${Math.round(ms).toString()}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) {
    return "$0.0000";
  }
  return `$${usd.toFixed(4)}`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }
  if (value < 1024) {
    return `${value.toFixed(0)} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function summarizeRecord(result: unknown): string {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return String(result);
  }
  const record = result as Record<string, unknown>;
  const keys = [
    "status",
    "modelId",
    "modelVersion",
    "elapsedMs",
    "costUsd",
    "outputPath",
    "diagramCount",
    "textChars",
    "outputBytes",
    "pdfBytes",
    "sourceUrl",
    "sourcePath",
  ] as const;
  const pairs: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (value === undefined) {
      continue;
    }
    if (key === "outputBytes" || key === "pdfBytes") {
      const numeric = typeof value === "number" ? value : Number.NaN;
      pairs.push(`${key}=${formatBytes(numeric)}`);
      continue;
    }
    if (key === "costUsd" && typeof value === "number") {
      pairs.push(`${key}=${formatUsd(value)}`);
      continue;
    }
    pairs.push(`${key}=${String(value)}`);
  }
  return pairs.length > 0 ? pairs.join(" ") : JSON.stringify(record);
}

async function withTimeout<T>(
  label: string,
  ms: number,
  run: () => Promise<T>,
): Promise<T> {
  let timer!: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms.toString()}ms`));
    }, ms);
  });
  try {
    return await Promise.race([run(), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function withRetries<T>(
  label: string,
  attempts: number,
  run: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run(attempt);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts) {
        break;
      }
      logStep(`${label} attempt ${attempt.toString()} failed: ${message}`);
      logStep(
        `${label} retrying (${(attempt + 1).toString()}/${attempts.toString()})...`,
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function parseCliArgs(args: readonly string[]): { sourcePdfPath: string } {
  const command = new Command("bench:pdf-transcription")
    .description("Run non-agentic PDF transcription benchmark.")
    .option("--source-pdf <path>", "source PDF path", DEFAULT_SOURCE_PDF_PATH);
  command.parse(args, { from: "user" });
  const options = command.opts<{ sourcePdf: string }>();

  return z
    .object({
      sourcePdfPath: z.string().trim().min(1),
    })
    .parse({ sourcePdfPath: options.sourcePdf });
}

async function assertFileExists(inputPath: string): Promise<void> {
  await access(inputPath).catch(() => {
    throw new Error(`File not found: ${inputPath}`);
  });
}

function requireFunctionTool(value: unknown, name: string): asserts value is FunctionToolLike {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Tool "${name}" is not an object.`);
  }
  const record = value as Record<string, unknown>;
  if (!record.inputSchema || typeof record.inputSchema !== "object") {
    throw new Error(`Tool "${name}" is missing inputSchema.`);
  }
  if (typeof record.execute !== "function") {
    throw new Error(`Tool "${name}" is missing execute().`);
  }
}

function mergeUsageTokens(
  current: LlmUsageTokenUpdate | null,
  next: LlmUsageTokenUpdate | undefined,
): LlmUsageTokenUpdate | null {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return {
    promptTokens: next.promptTokens ?? current.promptTokens,
    cachedTokens: next.cachedTokens ?? current.cachedTokens,
    responseTokens: next.responseTokens ?? current.responseTokens,
    responseImageTokens: next.responseImageTokens ?? current.responseImageTokens,
    thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
    totalTokens: next.totalTokens ?? current.totalTokens,
    toolUsePromptTokens: next.toolUsePromptTokens ?? current.toolUsePromptTokens,
  };
}

async function generateTextWithMetrics(options: {
  modelId: LlmTextModelId;
  contents: readonly LlmContent[];
  responseMimeType?: string;
  openAiReasoningEffort?: "low" | "medium" | "high";
}): Promise<{ text: string; metrics: ModelCallMetrics }> {
  let activeHandle: ModelCallHandle | null = null;
  let modelVersion: string | null = null;
  let usageTokens: LlmUsageTokenUpdate | null = null;

  const progress: JobProgressReporter = {
    log: () => {},
    startModelCall: ({ modelId }) => {
      const handle = Symbol(modelId);
      activeHandle = handle;
      return handle;
    },
    recordModelUsage: (handle: ModelCallHandle, chunk: LlmUsageChunk) => {
      if (activeHandle !== handle) {
        return;
      }
      if (typeof chunk.modelVersion === "string" && chunk.modelVersion.trim().length > 0) {
        modelVersion = chunk.modelVersion.trim();
      }
      usageTokens = mergeUsageTokens(usageTokens, chunk.tokens);
    },
    finishModelCall: (_handle: ModelCallHandle) => {},
    startStage: (_stageName: string): StageHandle => Symbol("stage"),
    finishStage: (_handle: StageHandle) => {},
    setActiveStages: (_stages: Iterable<string>) => {},
  };

  const startedAt = Date.now();
  const text = await generateText({
    modelId: options.modelId,
    contents: options.contents,
    ...(options.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
    ...(options.openAiReasoningEffort
      ? { openAiReasoningEffort: options.openAiReasoningEffort }
      : {}),
    progress,
  });
  const elapsedMs = Date.now() - startedAt;

  const resolvedModel = modelVersion ?? options.modelId;
  const costUsd = usageTokens
    ? estimateCallCostUsd({
        modelId: resolvedModel,
        tokens: usageTokens,
        responseImages: 0,
      })
    : 0;

  return {
    text,
    metrics: {
      modelId: options.modelId,
      modelVersion,
      elapsedMs,
      costUsd,
      usageTokens,
    },
  };
}

function metricFromToolRecord(
  fallbackModelId: string,
  result: Record<string, unknown>,
): ModelCallMetrics {
  const modelIdRaw = result.modelId;
  const modelVersionRaw = result.modelVersion;
  const elapsedRaw = result.elapsedMs;
  const costRaw = result.costUsd;
  const usageRaw = result.usageTokens;
  const usageTokens =
    usageRaw && typeof usageRaw === "object" && !Array.isArray(usageRaw)
      ? (usageRaw as LlmUsageTokenUpdate)
      : null;
  return {
    modelId:
      typeof modelIdRaw === "string" && modelIdRaw.trim().length > 0
        ? modelIdRaw
        : fallbackModelId,
    modelVersion:
      typeof modelVersionRaw === "string" && modelVersionRaw.trim().length > 0
        ? modelVersionRaw
        : null,
    elapsedMs:
      typeof elapsedRaw === "number" && Number.isFinite(elapsedRaw)
        ? elapsedRaw
        : 0,
    costUsd:
      typeof costRaw === "number" && Number.isFinite(costRaw) ? costRaw : 0,
    usageTokens,
  };
}

function normaliseProblemId(problemId: string): string {
  return problemId.trim().toUpperCase();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toFiniteInteger(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return null;
  }
  return Math.round(numeric);
}

function normaliseDiagramManifest(raw: unknown, maxDiagrams: number): DiagramManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Diagram extraction output is not an object.");
  }
  const rawRecord = raw as Record<string, unknown>;
  const rawDiagrams = rawRecord.diagrams;
  if (!Array.isArray(rawDiagrams)) {
    throw new Error('Diagram extraction output missing "diagrams" array.');
  }

  const normalizedDiagrams: DiagramManifest["diagrams"] = [];
  for (const [index, rawEntry] of rawDiagrams.entries()) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }
    const entry = rawEntry as Record<string, unknown>;
    const problemIdRaw =
      (typeof entry.problemId === "string" && entry.problemId.trim().length > 0
        ? entry.problemId
        : typeof entry.problem === "string" && entry.problem.trim().length > 0
          ? entry.problem
          : "unknown").trim();
    const page = toFiniteInteger(entry.page ?? entry.pageNumber ?? entry.page_number);
    if (page === null || page < 1) {
      continue;
    }

    let bboxNorm: DiagramManifest["diagrams"][number]["bboxNorm"] | null = null;
    let bbox1000:
      | {
          left: number;
          top: number;
          right: number;
          bottom: number;
        }
      | undefined;

    const bbox1000Raw =
      entry.bbox1000 &&
      typeof entry.bbox1000 === "object" &&
      !Array.isArray(entry.bbox1000)
        ? (entry.bbox1000 as Record<string, unknown>)
        : null;
    if (bbox1000Raw) {
      const left = toFiniteInteger(bbox1000Raw.left ?? bbox1000Raw.x0);
      const top = toFiniteInteger(bbox1000Raw.top ?? bbox1000Raw.y0);
      const right = toFiniteInteger(bbox1000Raw.right ?? bbox1000Raw.x1);
      const bottom = toFiniteInteger(bbox1000Raw.bottom ?? bbox1000Raw.y1);
      if (left !== null && top !== null && right !== null && bottom !== null) {
        const leftClamped = Math.max(0, Math.min(1000, left));
        const topClamped = Math.max(0, Math.min(1000, top));
        const rightClamped = Math.max(0, Math.min(1000, right));
        const bottomClamped = Math.max(0, Math.min(1000, bottom));
        if (rightClamped > leftClamped && bottomClamped > topClamped) {
          bbox1000 = {
            left: leftClamped,
            top: topClamped,
            right: rightClamped,
            bottom: bottomClamped,
          };
          bboxNorm = {
            left: leftClamped / 1000,
            top: topClamped / 1000,
            width: (rightClamped - leftClamped) / 1000,
            height: (bottomClamped - topClamped) / 1000,
          };
        }
      }
    }

    if (bboxNorm === null) {
      const bboxNormRaw =
        entry.bboxNorm && typeof entry.bboxNorm === "object" && !Array.isArray(entry.bboxNorm)
          ? (entry.bboxNorm as Record<string, unknown>)
          : entry.bbox && typeof entry.bbox === "object" && !Array.isArray(entry.bbox)
            ? (entry.bbox as Record<string, unknown>)
            : null;
      if (!bboxNormRaw) {
        continue;
      }
      const left = toFiniteNumber(bboxNormRaw.left ?? bboxNormRaw.x);
      const top = toFiniteNumber(bboxNormRaw.top ?? bboxNormRaw.y);
      const width = toFiniteNumber(bboxNormRaw.width ?? bboxNormRaw.w);
      const height = toFiniteNumber(bboxNormRaw.height ?? bboxNormRaw.h);
      if (
        left === null ||
        top === null ||
        width === null ||
        height === null ||
        left < 0 ||
        top < 0 ||
        width <= 0 ||
        height <= 0
      ) {
        continue;
      }
      const right = left + width;
      const bottom = top + height;
      if (right > 1.001 || bottom > 1.001) {
        continue;
      }
      bboxNorm = { left, top, width, height };
    }

    const id =
      typeof entry.id === "string" && entry.id.trim().length > 0
        ? entry.id.trim()
        : `${problemIdRaw.toLowerCase()}-${(index + 1).toString()}`;
    const label =
      typeof entry.label === "string" && entry.label.trim().length > 0
        ? entry.label.trim()
        : undefined;
    const description =
      typeof entry.description === "string" && entry.description.trim().length > 0
        ? entry.description.trim()
        : undefined;
    const confidenceRaw = toFiniteNumber(entry.confidence);
    const confidence =
      confidenceRaw !== null ? Math.max(0, Math.min(1, confidenceRaw)) : undefined;

    normalizedDiagrams.push({
      id,
      problemId: problemIdRaw,
      page,
      bboxNorm,
      ...(bbox1000 ? { bbox1000 } : {}),
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }

  const notes =
    typeof rawRecord.notes === "string" && rawRecord.notes.trim().length > 0
      ? rawRecord.notes.trim()
      : undefined;
  return DiagramManifestSchema.parse({
    diagrams: normalizedDiagrams.slice(0, Math.max(1, maxDiagrams)),
    ...(notes ? { notes } : {}),
  });
}

async function renderPdfAssets(options: {
  pdfPath: string;
  sourcePagesDir: string;
}): Promise<{
  renderedByPage: Map<number, PdfiumBitmap>;
  sourcePageImages: string[];
}> {
  const pdfBytes = await readFile(options.pdfPath);
  const pageCount = await getPdfPageCount({ pdfBytes: Uint8Array.from(pdfBytes) });
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);
  const renderedByPage = await renderPdfPagesBgra({
    pdfBytes: Uint8Array.from(pdfBytes),
    pageNumbers,
    scale: 2,
  });

  const sourcePageImages: string[] = [];
  for (const pageNumber of pageNumbers) {
    const bitmap = renderedByPage.get(pageNumber);
    if (!bitmap) {
      continue;
    }
    const imagePath = path.join(
      options.sourcePagesDir,
      `source-page-${pageNumber.toString().padStart(2, "0")}.png`,
    );
    await writeFile(imagePath, encodeBgraBitmapToPng(bitmap));
    sourcePageImages.push(imagePath);
  }

  return { renderedByPage, sourcePageImages };
}

function paddedBboxNorm(bbox: {
  left: number;
  top: number;
  width: number;
  height: number;
}): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const pad = 0.02;
  const left = Math.max(0, bbox.left - pad);
  const top = Math.max(0, bbox.top - pad);
  const right = Math.min(1, bbox.left + bbox.width + pad);
  const bottom = Math.min(1, bbox.top + bbox.height + pad);
  return {
    left,
    top,
    width: Math.max(0.001, right - left),
    height: Math.max(0.001, bottom - top),
  };
}

async function cropDiagramImages(options: {
  manifest: DiagramManifest;
  renderedByPage: Map<number, PdfiumBitmap>;
  diagramsDir: string;
}): Promise<Array<{ problemId: string; imagePath: string; label?: string }>> {
  const diagrams: Array<{ problemId: string; imagePath: string; label?: string }> = [];
  for (const [index, entry] of options.manifest.diagrams.entries()) {
    const pageBitmap = options.renderedByPage.get(entry.page);
    if (!pageBitmap) {
      continue;
    }
    const cropped = cropBgraBitmapByNorm({
      bitmap: pageBitmap,
      bboxNorm: paddedBboxNorm(entry.bboxNorm),
    });
    const safeProblem = normaliseProblemId(entry.problemId)
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/gu, "-")
      .replaceAll(/^-+|-+$/gu, "");
    const imagePath = path.join(
      options.diagramsDir,
      `${safeProblem || "unknown"}-${(index + 1).toString()}.png`,
    );
    await writeFile(imagePath, encodeBgraBitmapToPng(cropped));
    diagrams.push({
      problemId: entry.problemId,
      imagePath,
      label: entry.label,
    });
  }
  return diagrams;
}

function appendDiagramMarkdown(options: {
  markdown: string;
  markdownPath: string;
  diagrams: Array<{ problemId: string; imagePath: string; label?: string }>;
}): string {
  const lines: string[] = [];
  lines.push(options.markdown.trimEnd());
  lines.push("");
  lines.push("## Extracted Diagrams");

  const grouped = new Map<string, Array<{ imagePath: string; label?: string }>>();
  for (const entry of options.diagrams) {
    const key = normaliseProblemId(entry.problemId);
    const existing = grouped.get(key);
    if (existing) {
      existing.push({ imagePath: entry.imagePath, label: entry.label });
    } else {
      grouped.set(key, [{ imagePath: entry.imagePath, label: entry.label }]);
    }
  }

  const sortedProblemIds = [...grouped.keys()].sort();
  for (const problemId of sortedProblemIds) {
    lines.push("");
    lines.push(`### ${problemId}`);
    const entries = grouped.get(problemId) ?? [];
    for (const [index, entry] of entries.entries()) {
      const rel = path
        .relative(path.dirname(options.markdownPath), entry.imagePath)
        .replaceAll("\\", "/");
      const label = entry.label?.trim() ?? `${problemId} diagram ${(index + 1).toString()}`;
      lines.push(`![${label}](${rel})`);
    }
  }

  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

async function toImageParts(paths: string[]): Promise<LlmContentPart[]> {
  const parts: LlmContentPart[] = [];
  for (const [index, imagePath] of paths.entries()) {
    const data = await readFile(imagePath);
    parts.push({
      type: "text",
      text: `Image ${(index + 1).toString()}: ${path.basename(imagePath)}`,
    });
    parts.push({
      type: "inlineData",
      mimeType: "image/png",
      data: data.toString("base64"),
    });
  }
  return parts;
}

async function runJudge(options: {
  modelId: LlmTextModelId;
  sourcePdfPath: string;
  sourcePageImagePaths: string[];
  markdownPath: string;
  diagramImagePaths: string[];
}): Promise<JudgeVerdict> {
  const markdownText = await readFile(options.markdownPath, "utf8");
  const shouldAttachPdf = !options.modelId.startsWith("chatgpt-");

  const parts: LlmContentPart[] = [
    {
      type: "text",
      text: [
        "You are validating OCR/transcription fidelity.",
        shouldAttachPdf
          ? "Use the attached original PDF and images as ground truth."
          : "Use attached source page images as ground truth.",
        "PASS only if transcription is materially faithful.",
        "FAIL if key statements, formulas, or diagrams are incorrect/missing.",
        'Return JSON only: {"verdict":"pass|fail","summary":"string","issues":["string"]}',
      ].join("\n"),
    },
    {
      type: "text",
      text: ["Transcription markdown:", "```markdown", markdownText, "```"].join("\n"),
    },
  ];

  if (shouldAttachPdf) {
    const pdfData = await readFile(options.sourcePdfPath);
    parts.push({
      type: "inlineData",
      mimeType: "application/pdf",
      data: pdfData.toString("base64"),
    });
  }

  parts.push(...(await toImageParts(options.sourcePageImagePaths)));
  parts.push(...(await toImageParts(options.diagramImagePaths)));

  const { text, metrics } = await generateTextWithMetrics({
    modelId: options.modelId,
    contents: [{ role: "user", parts }],
    responseMimeType: "application/json",
    ...(options.modelId.startsWith("chatgpt-")
      ? { openAiReasoningEffort: "low" as const }
      : {}),
  });

  const parsed = parseJsonFromLlmText(text);
  const verdict = z
    .object({
      verdict: z.enum(["pass", "fail"]),
      summary: z.string().trim().min(1),
      issues: z.array(z.string().trim().min(1)).default([]),
    })
    .parse(parsed);

  return {
    modelId: options.modelId,
    verdict: verdict.verdict,
    summary: verdict.summary,
    issues: verdict.issues,
    metrics,
  };
}

function createPromptForDiagramExtraction(
  problemIds: readonly ProblemId[],
  coordinateMode: CoordinateMode,
): string {
  const bboxLine =
    coordinateMode === "int1000"
      ? '      "bbox1000": { "left": 0, "top": 0, "right": 1000, "bottom": 1000 },'
      : '      "bboxNorm": { "left": 0.0, "top": 0.0, "width": 0.0, "height": 0.0 },';
  const coordinateRules =
    coordinateMode === "int1000"
      ? [
          "Use ONLY bbox1000 in output (do not include bboxNorm).",
          "bbox1000 must use integer coordinates in [0, 1000].",
        ]
      : [
          "Use ONLY bboxNorm in output (do not include bbox1000).",
          "bboxNorm must use normalized fractions in [0, 1].",
        ];

  return [
    `Extract diagram bounding boxes only for: ${problemIds.join(", ")}.`,
    "Return JSON only with schema:",
    "{",
    '  "diagrams": [',
    "    {",
    '      "id": "string",',
    '      "problemId": "H1|H2|H3",',
    '      "page": 1,',
    bboxLine,
    '      "label": "string (optional)",',
    '      "description": "string (optional)",',
    '      "confidence": 0.0',
    "    }",
    "  ],",
    '  "notes": "string (optional)"',
    "}",
    ...coordinateRules,
    "Exclude non-diagram regions.",
  ].join("\n");
}

function createPromptForTranscription(problemIds: readonly ProblemId[]): string {
  return [
    `Transcribe only these problems: ${problemIds.join(", ")}.`,
    "Return markdown only.",
    "For each requested problem use heading format: ## Hx",
    "Preserve math using LaTeX ($...$ and $$...$$).",
    "Do not include solutions.",
  ].join("\n");
}

function mergeManifests(manifests: DiagramManifest[]): DiagramManifest {
  const diagrams = manifests.flatMap((item) => item.diagrams);
  const notes = manifests
    .map((item) => item.notes)
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join("\n");
  return DiagramManifestSchema.parse({
    diagrams,
    ...(notes.length > 0 ? { notes } : {}),
  });
}

function sumCost(metrics: readonly ModelCallMetrics[]): number {
  return metrics.reduce((sum, metric) => sum + metric.costUsd, 0);
}

async function buildToolHarness(runDir: string): Promise<{
  readPdfTool: FunctionToolLike;
  extractPdfDiagramsTool: FunctionToolLike;
  scheduledUpdates: string[];
}> {
  const scheduledUpdates: string[] = [];
  const progress = createToolProgressReporter();
  const tools = buildSparkAgentTools({
    workspace: {
      scheduleUpdate: (inputPath) => {
        scheduledUpdates.push(inputPath);
      },
      deleteFile: async (inputPath) => {
        const resolved = path.resolve(runDir, inputPath);
        await rm(resolved, { recursive: true, force: true });
      },
      moveFile: async (from, to) => {
        const source = path.resolve(runDir, from);
        const target = path.resolve(runDir, to);
        await mkdir(path.dirname(target), { recursive: true });
        await rename(source, target);
      },
    },
    rootDir: runDir,
    userId: "benchmark-runner",
    serviceAccountJson: "{}",
    progress,
  });

  const readPdfTool = tools.read_pdf;
  const extractPdfDiagramsTool = tools.extract_pdf_diagrams;
  requireFunctionTool(readPdfTool, "read_pdf");
  requireFunctionTool(extractPdfDiagramsTool, "extract_pdf_diagrams");
  return { readPdfTool, extractPdfDiagramsTool, scheduledUpdates };
}

async function executeToolCall(options: {
  label: string;
  timeoutMs: number;
  tool: FunctionToolLike;
  input: Record<string, unknown>;
  fallbackModelId: string;
}): Promise<ToolCallResult> {
  const raw = await withRetries(options.label, 2, () =>
    withTimeout(options.label, options.timeoutMs, () =>
      Promise.resolve(options.tool.execute(options.input)),
    ),
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${options.label} returned non-object output.`);
  }
  const result = raw as Record<string, unknown>;
  logStep(`${options.label} -> ${summarizeRecord(result)}`);
  return {
    result,
    metrics: metricFromToolRecord(options.fallbackModelId, result),
  };
}

function getOutputPathOrThrow(result: Record<string, unknown>, label: string): string {
  const outputPath = result.outputPath;
  if (typeof outputPath !== "string" || outputPath.trim().length === 0) {
    throw new Error(`${label} missing outputPath.`);
  }
  return outputPath;
}

async function runPdfToolPipeline(options: {
  approach: Approach;
  strategy: StrategyId;
  coordinateMode: CoordinateMode;
  runDir: string;
  workspaceRelativePdfPath: string;
  readPdfTool: FunctionToolLike;
  extractPdfDiagramsTool: FunctionToolLike;
}): Promise<{
  manifest: DiagramManifest;
  transcriptionMarkdown: string;
  pipelineMetrics: ModelCallMetrics[];
  manifestPaths: string[];
}> {
  const labelPrefix = `${options.approach.id}:${options.strategy}:${options.coordinateMode}`;
  const metrics: ModelCallMetrics[] = [];
  const manifestPaths: string[] = [];

  if (options.strategy === "bulk") {
    const diagramCall = await executeToolCall({
      label: `${labelPrefix}:bulk:extract_pdf_diagrams`,
      timeoutMs: 240_000,
      tool: options.extractPdfDiagramsTool,
      fallbackModelId: options.approach.modelId,
      input: {
        pdfPath: options.workspaceRelativePdfPath,
        prompt: createPromptForDiagramExtraction(PROBLEM_IDS, options.coordinateMode),
        outputPath: "output/diagrams-bulk.json",
        maxDiagrams: 24,
        modelId: options.approach.modelId,
      },
    });
    metrics.push(diagramCall.metrics);
    const diagramPath = getOutputPathOrThrow(
      diagramCall.result,
      `${labelPrefix}:bulk:extract_pdf_diagrams`,
    );
    manifestPaths.push(diagramPath);

    const transcriptionCall = await executeToolCall({
      label: `${labelPrefix}:bulk:read_pdf`,
      timeoutMs: 300_000,
      tool: options.readPdfTool,
      fallbackModelId: options.approach.modelId,
      input: {
        pdfPath: options.workspaceRelativePdfPath,
        prompt: createPromptForTranscription(PROBLEM_IDS),
        outputPath: "output/transcription-bulk.md",
        maxChars: 200_000,
        modelId: options.approach.modelId,
      },
    });
    metrics.push(transcriptionCall.metrics);
    const transcriptionPath = getOutputPathOrThrow(
      transcriptionCall.result,
      `${labelPrefix}:bulk:read_pdf`,
    );

    const manifest = DiagramManifestSchema.parse(
      JSON.parse(await readFile(path.join(options.runDir, diagramPath), "utf8")),
    );
    const transcriptionMarkdown = await readFile(
      path.join(options.runDir, transcriptionPath),
      "utf8",
    );

    return {
      manifest,
      transcriptionMarkdown,
      pipelineMetrics: metrics,
      manifestPaths,
    };
  }

  const manifests: DiagramManifest[] = [];
  const transcriptionBlocks: string[] = [];

  for (const problemId of PROBLEM_IDS) {
    const key = problemId.toLowerCase();
    const diagramCall = await executeToolCall({
      label: `${labelPrefix}:individual:${problemId}:extract_pdf_diagrams`,
      timeoutMs: 240_000,
      tool: options.extractPdfDiagramsTool,
      fallbackModelId: options.approach.modelId,
      input: {
        pdfPath: options.workspaceRelativePdfPath,
        prompt: createPromptForDiagramExtraction([problemId], options.coordinateMode),
        outputPath: `output/diagrams-${key}.json`,
        maxDiagrams: 8,
        modelId: options.approach.modelId,
      },
    });
    metrics.push(diagramCall.metrics);
    const diagramPath = getOutputPathOrThrow(
      diagramCall.result,
      `${labelPrefix}:individual:${problemId}:extract_pdf_diagrams`,
    );
    manifestPaths.push(diagramPath);
    manifests.push(
      DiagramManifestSchema.parse(
        JSON.parse(await readFile(path.join(options.runDir, diagramPath), "utf8")),
      ),
    );

    const transcriptionCall = await executeToolCall({
      label: `${labelPrefix}:individual:${problemId}:read_pdf`,
      timeoutMs: 300_000,
      tool: options.readPdfTool,
      fallbackModelId: options.approach.modelId,
      input: {
        pdfPath: options.workspaceRelativePdfPath,
        prompt: createPromptForTranscription([problemId]),
        outputPath: `output/transcription-${key}.md`,
        maxChars: 100_000,
        modelId: options.approach.modelId,
      },
    });
    metrics.push(transcriptionCall.metrics);
    const transcriptionPath = getOutputPathOrThrow(
      transcriptionCall.result,
      `${labelPrefix}:individual:${problemId}:read_pdf`,
    );
    transcriptionBlocks.push(await readFile(path.join(options.runDir, transcriptionPath), "utf8"));
  }

  return {
    manifest: mergeManifests(manifests),
    transcriptionMarkdown: transcriptionBlocks.join("\n\n").trim(),
    pipelineMetrics: metrics,
    manifestPaths,
  };
}

async function runImageModelPipeline(options: {
  approach: Approach;
  strategy: StrategyId;
  coordinateMode: CoordinateMode;
  runDir: string;
  sourcePageImagePaths: string[];
}): Promise<{
  manifest: DiagramManifest;
  transcriptionMarkdown: string;
  pipelineMetrics: ModelCallMetrics[];
  manifestPaths: string[];
}> {
  const labelPrefix = `${options.approach.id}:${options.strategy}:${options.coordinateMode}`;
  const metrics: ModelCallMetrics[] = [];
  const manifests: DiagramManifest[] = [];
  const transcriptions: string[] = [];
  const manifestPaths: string[] = [];

  const tasks: Array<{ type: "bulk"; problems: readonly ProblemId[] } | { type: "single"; problems: readonly [ProblemId] }> =
    options.strategy === "bulk"
      ? [{ type: "bulk", problems: PROBLEM_IDS }]
      : PROBLEM_IDS.map((problemId) => ({ type: "single", problems: [problemId] as const }));

  for (const task of tasks) {
    const suffix =
      task.type === "bulk"
        ? "bulk"
        : `problem-${task.problems[0].toLowerCase()}`;

    const diagramPrompt = createPromptForDiagramExtraction(
      task.problems,
      options.coordinateMode,
    );
    const diagramParts: LlmContentPart[] = [{ type: "text", text: diagramPrompt }];
    diagramParts.push(...(await toImageParts(options.sourcePageImagePaths)));

    const diagramCall = await withRetries(
      `${labelPrefix}:${suffix}:extract_diagrams`,
      2,
      () =>
        withTimeout(
          `${labelPrefix}:${suffix}:extract_diagrams`,
          300_000,
          async () => {
            return await generateTextWithMetrics({
              modelId: options.approach.modelId,
              contents: [{ role: "user", parts: diagramParts }],
              responseMimeType: "application/json",
              openAiReasoningEffort: "low",
            });
          },
        ),
    );
    metrics.push(diagramCall.metrics);
    const rawDiagramManifest = parseJsonFromLlmText(diagramCall.text);
    const normalizedManifest = normaliseDiagramManifest(rawDiagramManifest, 24);
    const manifestPath = path.join(options.runDir, "output", `diagrams-${suffix}.json`);
    await writeFile(`${manifestPath}`, `${JSON.stringify(normalizedManifest, null, 2)}\n`, "utf8");
    manifestPaths.push(path.relative(options.runDir, manifestPath).replaceAll("\\", "/"));
    manifests.push(normalizedManifest);

    const transcriptionPrompt = createPromptForTranscription(task.problems);
    const transcriptionParts: LlmContentPart[] = [{ type: "text", text: transcriptionPrompt }];
    transcriptionParts.push(...(await toImageParts(options.sourcePageImagePaths)));

    const transcriptionCall = await withRetries(
      `${labelPrefix}:${suffix}:transcribe`,
      2,
      () =>
        withTimeout(
          `${labelPrefix}:${suffix}:transcribe`,
          300_000,
          async () => {
            return await generateTextWithMetrics({
              modelId: options.approach.modelId,
              contents: [{ role: "user", parts: transcriptionParts }],
              openAiReasoningEffort: "low",
            });
          },
        ),
    );
    metrics.push(transcriptionCall.metrics);
    transcriptions.push(transcriptionCall.text.trim());

    logStep(
      `${labelPrefix}:${suffix}:extract_diagrams -> model=${diagramCall.metrics.modelId} elapsed=${formatMs(diagramCall.metrics.elapsedMs)} cost=${formatUsd(diagramCall.metrics.costUsd)}`,
    );
    logStep(
      `${labelPrefix}:${suffix}:transcribe -> model=${transcriptionCall.metrics.modelId} elapsed=${formatMs(transcriptionCall.metrics.elapsedMs)} cost=${formatUsd(transcriptionCall.metrics.costUsd)} chars=${transcriptionCall.text.length.toString()}`,
    );
  }

  return {
    manifest: mergeManifests(manifests),
    transcriptionMarkdown: transcriptions.join("\n\n").trim(),
    pipelineMetrics: metrics,
    manifestPaths,
  };
}

function configNameForExperiment(options: {
  approach: Approach;
  strategy: StrategyId;
  coordinateMode: CoordinateMode;
}): string {
  return `${options.approach.id}-${options.strategy}-${options.coordinateMode}`;
}

function toRepoRelativePath(inputPath: string): string {
  const absolutePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(BENCHMARK_DIR, inputPath);
  const relative = path
    .relative(REPO_ROOT_DIR, absolutePath)
    .replaceAll("\\", "/");
  if (relative.length === 0) {
    return ".";
  }
  if (relative.startsWith("..")) {
    return path.basename(absolutePath);
  }
  return relative;
}

function fromRepoRelativePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(REPO_ROOT_DIR, inputPath);
}

async function runSingleExperiment(options: {
  sourcePdfPath: string;
  runRoot: string;
  reportOutputRoot: string;
  approach: Approach;
  strategy: StrategyId;
  coordinateMode: CoordinateMode;
}): Promise<BenchmarkExperimentResult> {
  const experimentLabel = `${options.approach.id}:${options.strategy}:${options.coordinateMode}`;
  const configName = configNameForExperiment(options);
  const experimentDir = path.join(options.runRoot, configName);
  const sourceDir = path.join(experimentDir, "source");
  const outputDir = path.join(experimentDir, "output");
  const diagramsDir = path.join(outputDir, "diagrams");
  const sourcePagesDir = path.join(outputDir, "source-pages");
  const reportOutputDir = path.join(options.reportOutputRoot, configName);

  await mkdir(sourceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(diagramsDir, { recursive: true });
  await mkdir(sourcePagesDir, { recursive: true });

  const workspacePdfPath = path.join(sourceDir, "hamilton-2017-q.pdf");
  await copyFile(options.sourcePdfPath, workspacePdfPath);

  logStep(`Experiment start: ${experimentLabel}`);
  const totalStartedAt = Date.now();
  const pipelineStartedAt = Date.now();

  const { renderedByPage, sourcePageImages } = await renderPdfAssets({
    pdfPath: workspacePdfPath,
    sourcePagesDir,
  });
  logStep(
    `${experimentLabel} source pages rendered: count=${sourcePageImages.length.toString()}`,
  );

  const { readPdfTool, extractPdfDiagramsTool } = await buildToolHarness(experimentDir);
  const workspaceRelativePdfPath = "source/hamilton-2017-q.pdf";

  const pipelineResult =
    options.approach.type === "pdf_tool"
      ? await runPdfToolPipeline({
          approach: options.approach,
          strategy: options.strategy,
          coordinateMode: options.coordinateMode,
          runDir: experimentDir,
          workspaceRelativePdfPath,
          readPdfTool,
          extractPdfDiagramsTool,
        })
      : await runImageModelPipeline({
          approach: options.approach,
          strategy: options.strategy,
          coordinateMode: options.coordinateMode,
          runDir: experimentDir,
          sourcePageImagePaths: sourcePageImages,
        });

  const croppedDiagrams = await cropDiagramImages({
    manifest: pipelineResult.manifest,
    renderedByPage,
    diagramsDir,
  });

  const transcriptionWithDiagrams = appendDiagramMarkdown({
    markdown: pipelineResult.transcriptionMarkdown,
    markdownPath: path.join(outputDir, "transcription-with-diagrams.md"),
    diagrams: croppedDiagrams,
  });
  const outputMarkdownPath = path.join(outputDir, "transcription-with-diagrams.md");
  await writeFile(outputMarkdownPath, transcriptionWithDiagrams, "utf8");

  const pipelineLatencyMs = Date.now() - pipelineStartedAt;
  const pipelineCostUsd = sumCost(pipelineResult.pipelineMetrics);

  const judgingStartedAt = Date.now();
  const judgeTasks = JUDGE_MODEL_IDS.map(async (judgeModelId) => {
    return await runJudge({
      modelId: judgeModelId,
      sourcePdfPath: workspacePdfPath,
      sourcePageImagePaths: sourcePageImages,
      markdownPath: outputMarkdownPath,
      diagramImagePaths: croppedDiagrams.map((item) => item.imagePath),
    });
  });
  const verdicts = await Promise.all(judgeTasks);
  const judgingLatencyMs = Date.now() - judgingStartedAt;
  const judgingCostUsd = verdicts.reduce((sum, verdict) => sum + verdict.metrics.costUsd, 0);

  const overallPass = verdicts.every((item) => item.verdict === "pass");
  const totalLatencyMs = Date.now() - totalStartedAt;
  const totalCostUsd = pipelineCostUsd + judgingCostUsd;

  const outputJsonPath = path.join(outputDir, "experiment-result.json");
  const reportOutputMarkdownPath = path.join(reportOutputDir, "transcription-with-diagrams.md");
  const reportDiagramImagePaths = croppedDiagrams.map((item) => {
    return path.join(reportOutputDir, "diagrams", path.basename(item.imagePath));
  });
  const reportSourcePageImagePaths = sourcePageImages.map((item) => {
    return path.join(reportOutputDir, "source-pages", path.basename(item));
  });
  const experimentResult: BenchmarkExperimentResult = {
    approachId: options.approach.id,
    approachLabel: options.approach.label,
    strategy: options.strategy,
    coordinateMode: options.coordinateMode,
    status: overallPass ? "pass" : "fail",
    reason: overallPass
      ? "All judges passed"
      : verdicts
          .filter((item) => item.verdict === "fail")
          .map((item) => `[${item.modelId}] ${item.summary}`)
          .join("; "),
    runDir: toRepoRelativePath(experimentDir),
    outputMarkdownPath: toRepoRelativePath(outputMarkdownPath),
    outputJsonPath: toRepoRelativePath(outputJsonPath),
    reportOutputDir: toRepoRelativePath(reportOutputDir),
    reportOutputMarkdownPath: toRepoRelativePath(reportOutputMarkdownPath),
    reportDiagramImagePaths: reportDiagramImagePaths.map((item) =>
      toRepoRelativePath(item),
    ),
    reportSourcePageImagePaths: reportSourcePageImagePaths.map((item) =>
      toRepoRelativePath(item),
    ),
    manifests: pipelineResult.manifestPaths,
    pipeline: {
      modelCalls: pipelineResult.pipelineMetrics.length,
      latencyMs: pipelineLatencyMs,
      costUsd: pipelineCostUsd,
    },
    judging: {
      modelCalls: verdicts.length,
      latencyMs: judgingLatencyMs,
      costUsd: judgingCostUsd,
      verdicts,
    },
    total: {
      latencyMs: totalLatencyMs,
      costUsd: totalCostUsd,
    },
  };

  await writeFile(outputJsonPath, `${JSON.stringify(experimentResult, null, 2)}\n`, "utf8");
  await rm(reportOutputDir, { recursive: true, force: true });
  await mkdir(path.dirname(reportOutputDir), { recursive: true });
  await cp(outputDir, reportOutputDir, { recursive: true, force: true });

  logStep(
    `${experimentLabel} -> status=${experimentResult.status} pipeline(lat=${formatMs(pipelineLatencyMs)}, cost=${formatUsd(pipelineCostUsd)}) judging(lat=${formatMs(judgingLatencyMs)}, cost=${formatUsd(judgingCostUsd)}) total(lat=${formatMs(totalLatencyMs)}, cost=${formatUsd(totalCostUsd)})`,
  );

  return experimentResult;
}

async function toMarkdownReport(report: BenchmarkReport): Promise<string> {
  const lines: string[] = [];
  lines.push("# PDF Transcription Benchmark Results");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push(`Source PDF: ${report.sourcePdfPath}`);
  lines.push(`JSON report: ${report.reportJsonPath}`);
  lines.push("");
  lines.push("Output copies are stored under `output/report/<config-name>/`.");
  lines.push("");
  lines.push("## Results");
  lines.push("");
  const judgeHeaders = JUDGE_MODEL_IDS.map((modelId) => `Judge ${modelId}`);
  const headerColumns = [
    "Approach",
    "Strategy",
    "Coord Mode",
    "Status",
    "Pipeline Latency",
    "Pipeline Cost",
    "Total Latency",
    "Total Cost",
    ...judgeHeaders,
  ];
  const separatorColumns = [
    "---",
    "---",
    "---",
    "---",
    "---:",
    "---:",
    "---:",
    "---:",
    ...judgeHeaders.map(() => "---"),
  ];
  lines.push(`| ${headerColumns.join(" | ")} |`);
  lines.push(`| ${separatorColumns.join(" | ")} |`);

  for (const item of report.experiments) {
    const verdictByModel = new Map(item.judging.verdicts.map((verdict) => [verdict.modelId, verdict]));
    const judgeCells = JUDGE_MODEL_IDS.map((modelId) => {
      const verdict = verdictByModel.get(modelId);
      if (!verdict) {
        return "N/A";
      }
      return verdict.verdict.toUpperCase();
    });
    lines.push(
      `| ${item.approachLabel} | ${item.strategy} | ${item.coordinateMode} | ${item.status.toUpperCase()} | ${formatMs(item.pipeline.latencyMs)} | ${formatUsd(item.pipeline.costUsd)} | ${formatMs(item.total.latencyMs)} | ${formatUsd(item.total.costUsd)} | ${judgeCells.join(" | ")} |`,
    );
  }

  lines.push("");
  lines.push("## Detailed Outputs");
  lines.push("");
  for (const item of report.experiments) {
    lines.push(`### ${item.approachLabel} / ${item.strategy} / ${item.coordinateMode}`);
    lines.push(`- Status: ${item.status.toUpperCase()}`);
    lines.push(`- Reason: ${item.reason}`);
    lines.push(`- Copied output dir: ${item.reportOutputDir}`);
    lines.push(`- Run dir: ${item.runDir}`);
    lines.push(`- Output markdown: ${item.reportOutputMarkdownPath}`);
    for (const verdict of item.judging.verdicts) {
      lines.push(
        `- Judge ${verdict.modelId}: ${verdict.verdict.toUpperCase()} (${formatMs(verdict.metrics.elapsedMs)}, ${formatUsd(verdict.metrics.costUsd)}) - ${verdict.summary}`,
      );
      if (verdict.issues.length > 0) {
        lines.push(`- Issues: ${verdict.issues.join(" | ")}`);
      }
    }
    const transcription = await readFile(
      fromRepoRelativePath(item.reportOutputMarkdownPath),
      "utf8",
    ).catch(() => "");
    lines.push("");
    lines.push("#### Transcription");
    if (transcription.trim().length === 0) {
      lines.push("_Missing transcription markdown in copied output._");
    } else {
      lines.push("```markdown");
      lines.push(transcription.trimEnd());
      lines.push("```");
    }
    lines.push("");
    lines.push("#### Cropped Diagram Images");
    if (item.reportDiagramImagePaths.length === 0) {
      lines.push("_No diagram crops were produced._");
    } else {
      for (const diagramPath of item.reportDiagramImagePaths) {
        const alt = path.basename(diagramPath);
        lines.push(`![${alt}](${diagramPath})`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  await assertFileExists(cli.sourcePdfPath);
  logStep(`Source PDF: ${cli.sourcePdfPath}`);

  const runId = new Date().toISOString().replace(/[:.]/gu, "-");
  const runRoot = path.join(RUNS_OUTPUT_DIR, runId);
  await mkdir(runRoot, { recursive: true });
  await rm(REPORT_OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(REPORT_OUTPUT_DIR, { recursive: true });

  const experimentConfigs = APPROACHES.flatMap((approach) => {
    return STRATEGIES.flatMap((strategy) => {
      return COORDINATE_MODES.map((coordinateMode) => {
        return { approach, strategy, coordinateMode };
      });
    });
  });
  setProgressTotal(experimentConfigs.length);

  logStep(
    `Launching ${experimentConfigs.length.toString()} experiment instances in parallel.`,
  );

  const experiments = await Promise.all(
    experimentConfigs.map(async ({ approach, strategy, coordinateMode }) => {
      const configName = configNameForExperiment({ approach, strategy, coordinateMode });
      const experimentDir = path.join(runRoot, configName);
      const reportOutputDir = path.join(REPORT_OUTPUT_DIR, configName);
      try {
        return await runSingleExperiment({
          sourcePdfPath: cli.sourcePdfPath,
          runRoot,
          reportOutputRoot: REPORT_OUTPUT_DIR,
          approach,
          strategy,
          coordinateMode,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logStep(
          `Experiment failed: ${approach.id}:${strategy}:${coordinateMode} -> ${reason}`,
        );
        const outputDir = path.join(experimentDir, "output");
        const outputJsonPath = path.join(outputDir, "experiment-result.json");
        const fallback: BenchmarkExperimentResult = {
          approachId: approach.id,
          approachLabel: approach.label,
          strategy,
          coordinateMode,
          status: "fail",
          reason,
          runDir: toRepoRelativePath(experimentDir),
          outputMarkdownPath: toRepoRelativePath(
            path.join(outputDir, "transcription-with-diagrams.md"),
          ),
          outputJsonPath: toRepoRelativePath(outputJsonPath),
          reportOutputDir: toRepoRelativePath(reportOutputDir),
          reportOutputMarkdownPath: toRepoRelativePath(
            path.join(reportOutputDir, "transcription-with-diagrams.md"),
          ),
          reportDiagramImagePaths: [],
          reportSourcePageImagePaths: [],
          manifests: [],
          pipeline: {
            modelCalls: 0,
            latencyMs: 0,
            costUsd: 0,
          },
          judging: {
            modelCalls: 0,
            latencyMs: 0,
            costUsd: 0,
            verdicts: [],
          },
          total: {
            latencyMs: 0,
            costUsd: 0,
          },
        };
        await mkdir(outputDir, { recursive: true });
        await writeFile(outputJsonPath, `${JSON.stringify(fallback, null, 2)}\n`, "utf8");
        await rm(reportOutputDir, { recursive: true, force: true });
        await mkdir(path.dirname(reportOutputDir), { recursive: true });
        await cp(outputDir, reportOutputDir, { recursive: true, force: true });
        return fallback;
      } finally {
        incrementProgress();
      }
    }),
  );

  const reportJsonPath = path.join(runRoot, REPORT_JSON_BASENAME);
  const report: BenchmarkReport = {
    generatedAt: new Date().toISOString(),
    sourcePdfPath: toRepoRelativePath(cli.sourcePdfPath),
    reportJsonPath: toRepoRelativePath(reportJsonPath),
    experiments,
  };
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const markdown = await toMarkdownReport(report);
  await writeFile(RESULTS_MARKDOWN_PATH, markdown, "utf8");

  logStep(`Benchmark complete.`);
  logStep(`JSON report: ${toRepoRelativePath(reportJsonPath)}`);
  logStep(`Markdown report: ${toRepoRelativePath(RESULTS_MARKDOWN_PATH)}`);
  logStep(`Copied outputs: ${toRepoRelativePath(REPORT_OUTPUT_DIR)}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[100%] [pdf-bench] error: ${message}`);
  process.exit(1);
});
