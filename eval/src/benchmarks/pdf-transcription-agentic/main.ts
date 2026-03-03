import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { z } from "zod";

import { buildSparkAgentToolsForTest } from "@spark/llm/agent/sparkAgentRunner";
import {
  createToolLoopSteeringChannel,
  estimateCallCostUsd,
  generateText,
  parseJsonFromLlmText,
  runToolLoop,
  tool,
  type LlmContent,
  type LlmContentPart,
  type LlmStreamEvent,
  type LlmTextModelId,
  type LlmToolSet,
} from "@spark/llm/utils/llm";
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
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const DEFAULT_SOURCE_PDF_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "hamilton-2017-q.pdf",
);
const OUTPUT_ROOT_DIR = path.join(BENCHMARK_DIR, "output");
const RESULTS_MARKDOWN_PATH = path.join(BENCHMARK_DIR, "RESULTS.md");
const MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.3-codex";
const JUDGE_MODEL_IDS = [
  "gemini-2.5-pro",
  "chatgpt-gpt-5.3-codex",
] as const satisfies readonly [LlmTextModelId, LlmTextModelId];
const MAX_STEPS = 120;
const REQUIRED_TOOL_NAMES = [
  "list_files",
  "read_file",
  "read_files",
  "view_image",
  "write_file",
  "move_file",
  "delete_file",
  "pdf_to_images",
  "crop_image",
  "done",
] as const;

type AgentPathConfig = {
  runRootDir: string;
  workspaceDir: string;
  taskPath: string;
  sourceDir: string;
  sourcePdfPath: string;
  outputDir: string;
  outputMarkdownPath: string;
  outputManifestPath: string;
  outputNotesPath: string;
  agentLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
};

type CliArgs = {
  sourcePdfPath: string;
};

type ModelCallMetrics = {
  modelId: string;
  modelVersion: string | null;
  elapsedMs: number;
  costUsd: number;
  usageTokens: LlmUsageTokenUpdate | null;
};

type JudgeVerdict = {
  modelId: LlmTextModelId;
  verdict: "pass" | "fail";
  summary: string;
  issues: string[];
  metrics: ModelCallMetrics;
};

type ToolCallTrace = {
  ts: string;
  turn: number;
  toolIndex: number;
  toolName: string;
  phase: "started" | "completed";
  durationMs?: number;
  error?: string;
  inputSnippet: string;
  outputSnippet?: string;
};

type UsageTotals = {
  promptTokens: number;
  cachedTokens: number;
  responseTokens: number;
  responseImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  toolUsePromptTokens: number;
};

type AgenticBenchmarkResult = {
  generatedAt: string;
  modelId: string;
  status: "pass" | "fail";
  reason: string;
  sourcePdfPath: string;
  runDir: string;
  workspaceDir: string;
  taskPath: string;
  transcriptionPath: string;
  diagramManifestPath: string;
  notesPath: string;
  agentLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
  sourcePageImagePaths: string[];
  diagramImagePaths: string[];
  agent: {
    latencyMs: number;
    modelCalls: number;
    toolCalls: number;
    toolCallsByName: Record<string, number>;
    costUsd: number;
    usage: UsageTotals;
    thoughtsChars: number;
    responseChars: number;
    doneSummary: string | null;
  };
  judging: {
    latencyMs: number;
    modelCalls: number;
    costUsd: number;
    verdicts: JudgeVerdict[];
  };
  total: {
    latencyMs: number;
    costUsd: number;
  };
};

type JudgeResultJson = {
  verdict: "pass" | "fail";
  summary: string;
  issues: string[];
};

const JudgeResultSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  summary: z.string().trim().min(1),
  issues: z.array(z.string().trim().min(1)).default([]),
});

const AgentDiagramManifestSchema = z.object({
  diagrams: z.array(
    z.object({
      id: z.string().trim().min(1).optional(),
      problemId: z.string().trim().min(1),
      page: z.number().int().min(1),
      sourceImagePath: z.string().trim().min(1).optional(),
      cropPath: z.string().trim().min(1),
      bbox1000: z.object({
        left: z.number().int().min(0).max(1000),
        top: z.number().int().min(0).max(1000),
        right: z.number().int().min(0).max(1000),
        bottom: z.number().int().min(0).max(1000),
      }),
      notes: z.string().trim().min(1).optional(),
    }),
  ),
  notes: z.string().trim().min(1).optional(),
});

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

function sanitizeLogText(input: string): string {
  const repoRootNormalised = REPO_ROOT_DIR.replaceAll("\\", "/");
  return input.replaceAll("\\", "/").replaceAll(repoRootNormalised, ".");
}

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return `${input.slice(0, maxChars)}…`;
}

function serialiseSnippet(value: unknown, maxChars = 500): string {
  if (typeof value === "string") {
    return truncateText(value.replace(/\s+/gu, " ").trim(), maxChars);
  }
  try {
    const text = JSON.stringify(value);
    if (typeof text === "string") {
      return truncateText(text.replace(/\s+/gu, " ").trim(), maxChars);
    }
    return "<unserializable>";
  } catch {
    return "<unserializable>";
  }
}

function toSingleLine(input: string): string {
  return input.replace(/\r?\n/gu, "\\n");
}

function parseCliArgs(args: readonly string[]): CliArgs {
  const raw: { sourcePdfPath?: string } = {};
  for (const arg of args) {
    if (arg.startsWith("--source-pdf=")) {
      raw.sourcePdfPath = arg.slice("--source-pdf=".length).trim();
    }
  }
  return z
    .object({
      sourcePdfPath: z.string().trim().min(1).default(DEFAULT_SOURCE_PDF_PATH),
    })
    .parse(raw);
}

async function assertFileExists(inputPath: string): Promise<void> {
  await stat(inputPath).catch(() => {
    throw new Error(`File not found: ${inputPath}`);
  });
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const output: string[] = [];
  const visit = async (currentDir: string): Promise<void> => {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      output.push(absolute);
    }
  };
  await visit(rootDir);
  output.sort((a, b) => a.localeCompare(b));
  return output;
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
    startModelCall: () => {
      const handle = Symbol("judge-model-call");
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
    finishModelCall: () => {},
    startStage: () => Symbol("stage"),
    finishStage: () => {},
    setActiveStages: () => {},
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

async function toImageParts(paths: readonly string[]): Promise<LlmContentPart[]> {
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
  sourcePageImagePaths: readonly string[];
  markdownPath: string;
  diagramImagePaths: readonly string[];
}): Promise<JudgeVerdict> {
  const markdown = await readFile(options.markdownPath, "utf8");
  const attachPdf = !options.modelId.startsWith("chatgpt-");

  const parts: LlmContentPart[] = [
    {
      type: "text",
      text: [
        "Validate transcription fidelity and crop quality for Hamilton 2017 H1-H3.",
        attachPdf
          ? "Use attached PDF + source page images as ground truth."
          : "Use attached source page images as ground truth.",
        "Check that extracted diagrams do not contain unrelated surrounding text where avoidable.",
        'Return JSON only: {"verdict":"pass|fail","summary":"string","issues":["string"]}',
      ].join("\n"),
    },
    {
      type: "text",
      text: ["Transcription markdown:", "```markdown", markdown, "```"].join("\n"),
    },
  ];

  if (attachPdf) {
    const pdfBytes = await readFile(options.sourcePdfPath);
    parts.push({
      type: "inlineData",
      mimeType: "application/pdf",
      data: pdfBytes.toString("base64"),
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
  const verdict = JudgeResultSchema.parse(parsed) as JudgeResultJson;
  return {
    modelId: options.modelId,
    verdict: verdict.verdict,
    summary: verdict.summary,
    issues: verdict.issues,
    metrics,
  };
}

async function buildPathConfig(sourcePdfPath: string): Promise<AgentPathConfig> {
  const runId = new Date().toISOString().replace(/[:.]/gu, "-");
  const runRootDir = path.join(OUTPUT_ROOT_DIR, runId);
  const workspaceDir = path.join(runRootDir, "workspace");
  const taskPath = path.join(workspaceDir, "task.md");
  const sourceDir = path.join(workspaceDir, "source");
  const sourcePdfTargetPath = path.join(sourceDir, "hamilton-2017-q.pdf");
  const outputDir = path.join(workspaceDir, "output");
  const outputMarkdownPath = path.join(outputDir, "transcription.md");
  const outputManifestPath = path.join(outputDir, "diagram-manifest.json");
  const outputNotesPath = path.join(outputDir, "agent-notes.md");
  const agentLogPath = path.join(runRootDir, "agent.log");
  const eventLogPath = path.join(runRootDir, "agent-log.jsonl");
  const summaryJsonPath = path.join(runRootDir, "summary.json");

  await mkdir(sourceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await copyFile(sourcePdfPath, sourcePdfTargetPath);
  await writeFile(taskPath, `${createAgentTaskDescription()}\n`, "utf8");

  return {
    runRootDir,
    workspaceDir,
    taskPath,
    sourceDir,
    sourcePdfPath: sourcePdfTargetPath,
    outputDir,
    outputMarkdownPath,
    outputManifestPath,
    outputNotesPath,
    agentLogPath,
    eventLogPath,
    summaryJsonPath,
  };
}

function createAgentTaskDescription(): string {
  return [
    "# Task",
    "Transcribe Hamilton Olympiad 2017 problems H1, H2, H3 with diagrams.",
    "",
    "## Constraints",
    "- You must convert the PDF into page images first using `pdf_to_images` on `source/hamilton-2017-q.pdf`.",
    "- Do NOT call `read_file` on `source/hamilton-2017-q.pdf` in any mode (`text`, `auto`, or `base64`).",
    "- The benchmark expects extraction/transcription from rendered page images only.",
    "- `read_file` is text-only. Use `view_image` for every PNG/JPEG image check.",
    "- After rendering, open each page image file with `view_image` to inspect content.",
    "- You must use `crop_image` with `bbox1000` integer coordinates to extract diagrams for H1/H2/H3.",
    "- Every `crop_image` call for diagrams must include `bbox1000`; do not omit bbox fields.",
    "- Do not use `fullImage: true` for diagram crops.",
    "- After every crop, call `view_image` for the crop image to inspect quality.",
    "- Keep improving crops until they are tightly centered on the diagram and avoid unrelated text/graphics when possible.",
    "- If perfect crop is impossible, state that explicitly in notes.",
    "",
    "## Required outputs",
    "1) `output/transcription.md` with sections `## H1`, `## H2`, `## H3` and LaTeX math.",
    "2) `output/diagram-manifest.json` with:",
    "```json",
    "{",
    '  "diagrams": [',
    "    {",
    '      "problemId": "H1|H2|H3",',
    '      "page": 1,',
    '      "sourceImagePath": "output/source-pages/source-page-01.png",',
    '      "cropPath": "output/diagrams/h1.png",',
    '      "bbox1000": { "left": 0, "top": 0, "right": 1000, "bottom": 1000 },',
    '      "notes": "optional"',
    "    }",
    "  ]",
    "}",
    "```",
    "3) `output/agent-notes.md` summarizing crop-correction decisions.",
    "",
    "When complete, call `done` with a concise summary including total diagrams extracted and correction count.",
  ].join("\n");
}

function createAgentPrompt(): string {
  return [
    "Read `task.md` from the workspace root.",
    "Follow it exactly.",
  ].join("\n");
}

function emptyUsageTotals(): UsageTotals {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    responseTokens: 0,
    responseImageTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    toolUsePromptTokens: 0,
  };
}

function addUsageTotals(target: UsageTotals, next: LlmUsageTokenUpdate): void {
  target.promptTokens += next.promptTokens ?? 0;
  target.cachedTokens += next.cachedTokens ?? 0;
  target.responseTokens += next.responseTokens ?? 0;
  target.responseImageTokens += next.responseImageTokens ?? 0;
  target.thinkingTokens += next.thinkingTokens ?? 0;
  target.totalTokens += next.totalTokens ?? 0;
  target.toolUsePromptTokens += next.toolUsePromptTokens ?? 0;
}

async function runAgenticBenchmark(sourcePdfPath: string): Promise<AgenticBenchmarkResult> {
  const paths = await buildPathConfig(sourcePdfPath);
  const logLines: string[] = [];
  const agentLogLines: string[] = [];
  const eventLogRecords: Array<Record<string, unknown>> = [];
  const toolCallTrace: ToolCallTrace[] = [];
  const toolCallsByName: Record<string, number> = {};
  const usageTotals = emptyUsageTotals();
  let usageCostUsd = 0;
  let thoughtChars = 0;
  let responseChars = 0;
  let doneSummary: string | null = null;
  const stageOrder = [
    "prepare-workspace",
    "resolve-tools",
    "agent-loop",
    "collect-agent-outputs",
    "judge-outputs",
    "write-artifacts",
  ] as const;
  let completedStages = 0;
  let failedToWriteAgentLog = false;

  await writeFile(paths.agentLogPath, "", "utf8");

  const stagePercent = (): string => {
    const total = stageOrder.length;
    const value = Math.round((completedStages / total) * 100);
    return value.toString().padStart(2, "0");
  };

  const logStage = (kind: "start" | "done", stage: (typeof stageOrder)[number]): void => {
    if (kind === "done") {
      completedStages = Math.min(stageOrder.length, completedStages + 1);
    }
    const line = `[${stagePercent()}%] [pdf-bench] stage:${kind} ${stage}`;
    console.log(line);
    const agentLine = `[spark-agent:pdf-bench] stage:${kind} ${stage}`;
    console.log(agentLine);
    const timestamped = `${new Date().toISOString()} ${agentLine}`;
    agentLogLines.push(timestamped);
    if (!failedToWriteAgentLog) {
      try {
        appendFileSync(paths.agentLogPath, `${timestamped}\n`, "utf8");
      } catch (error: unknown) {
        failedToWriteAgentLog = true;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[pdf-bench] failed to write agent.log: ${message}`);
      }
    }
  };

  const logAgent = (line: string): void => {
    const normalisedLine = `[spark-agent:pdf-bench] ${sanitizeLogText(line)}`;
    console.log(normalisedLine);
    const timestamped = `${new Date().toISOString()} ${normalisedLine}`;
    agentLogLines.push(timestamped);
    if (!failedToWriteAgentLog) {
      try {
        appendFileSync(paths.agentLogPath, `${timestamped}\n`, "utf8");
      } catch (error: unknown) {
        failedToWriteAgentLog = true;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[pdf-bench] failed to write agent.log: ${message}`);
      }
    }
  };

  try {
    logAgent(
      `start: workspaceDir=${toRepoRelativePath(paths.workspaceDir)} taskPath=${toRepoRelativePath(paths.taskPath)} model=${MODEL_ID}`,
    );
    logStage("start", "prepare-workspace");
    const workspace = {
      scheduleUpdate: (_inputPath: string): void => {},
      deleteFile: async (inputPath: string): Promise<void> => {
        const resolved = path.resolve(paths.workspaceDir, inputPath);
        await rm(resolved, { recursive: true, force: true });
      },
      moveFile: async (from: string, to: string): Promise<void> => {
        const source = path.resolve(paths.workspaceDir, from);
        const target = path.resolve(paths.workspaceDir, to);
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, target);
        await rm(source, { force: true });
      },
    };
    logStage("done", "prepare-workspace");

    logStage("start", "resolve-tools");
    const allTools = buildSparkAgentToolsForTest({
      workspace,
      rootDir: paths.workspaceDir,
      userId: "benchmark-runner",
      serviceAccountJson: "{}",
    });
    const doneTool = tool({
      description: "Finish the run and provide summary.",
      inputSchema: z.object({
        summary: z.string().trim().min(1),
      }),
      execute: ({ summary }) => {
        return { status: "done", summary };
      },
    });
    const allToolsWithDone: LlmToolSet = {
      ...allTools,
      done: doneTool,
    };
    const selectedTools: LlmToolSet = {};
    for (const toolName of REQUIRED_TOOL_NAMES) {
      const candidate = (allToolsWithDone as Record<string, unknown>)[toolName];
      if (!candidate) {
        throw new Error(`Required tool missing: ${toolName}`);
      }
      (selectedTools as Record<string, unknown>)[toolName] = candidate;
    }

    const cropToolCandidate = (selectedTools as Record<string, unknown>).crop_image;
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
        "Crop a PNG image using required bbox1000 integer coordinates.",
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
          execute: (input: {
            sourcePath: string;
            outputPath: string;
            bbox1000: {
              left: number;
              top: number;
              right: number;
              bottom: number;
            };
          }) => Promise<unknown> | unknown;
        };
        return await delegate.execute({
          sourcePath,
          outputPath,
          bbox1000,
        });
      },
    });
    (selectedTools as Record<string, unknown>).crop_image = strictCropImageTool;

    logAgent(
      `exposed tools: ${Object.keys(selectedTools).sort((a, b) => a.localeCompare(b)).join(", ")}`,
    );
    logStage("done", "resolve-tools");

    const steering = createToolLoopSteeringChannel();
    const startedAt = Date.now();

  const onEvent = (event: LlmStreamEvent): void => {
    const nowIso = new Date().toISOString();
    if (event.type === "delta") {
      if (event.channel === "thought") {
        thoughtChars += event.text.length;
        logAgent(`thought_delta: ${toSingleLine(event.text)}`);
      } else {
        responseChars += event.text.length;
        logAgent(`response_delta: ${toSingleLine(event.text)}`);
      }
      eventLogRecords.push({
        ts: nowIso,
        type: event.type,
        channel: event.channel,
        text: truncateText(event.text, 300),
      });
      return;
    }

    if (event.type === "usage") {
      usageCostUsd += event.costUsd;
      addUsageTotals(usageTotals, event.usage);
      logAgent(
        `usage: modelVersion=${event.modelVersion ?? "n/a"} cost=${formatUsd(event.costUsd)} tokens=${serialiseSnippet(event.usage, 300)}`,
      );
      eventLogRecords.push({
        ts: nowIso,
        type: event.type,
        costUsd: event.costUsd,
        usage: event.usage,
        modelVersion: event.modelVersion,
      });
      return;
    }

    if (event.type === "model") {
      logAgent(`model: ${event.modelVersion}`);
      eventLogRecords.push({
        ts: nowIso,
        type: event.type,
        modelVersion: event.modelVersion,
      });
      return;
    }

    if (event.type !== "tool_call") {
      logAgent(`event: ${event.type}`);
      eventLogRecords.push({ ts: nowIso, type: event.type });
      return;
    }

    const inputSnippet = serialiseSnippet(event.input);
    const outputSnippet =
      event.phase === "completed" ? serialiseSnippet(event.output) : undefined;
    if (event.phase === "started") {
      logAgent(
        `trace_tool_call: turn=${event.turn.toString()} index=${event.toolIndex.toString()} tool=${event.toolName} input=${inputSnippet}`,
      );
    } else {
      const status = typeof event.error === "string" ? `error=${event.error}` : "ok";
      logAgent(
        `trace_tool_result: turn=${event.turn.toString()} index=${event.toolIndex.toString()} tool=${event.toolName} durationMs=${typeof event.durationMs === "number" ? event.durationMs.toString() : "n/a"} ${status} output=${outputSnippet ?? "<none>"}`,
      );
    }
    const trace: ToolCallTrace = {
      ts: nowIso,
      turn: event.turn,
      toolIndex: event.toolIndex,
      toolName: event.toolName,
      phase: event.phase,
      inputSnippet,
      ...(outputSnippet ? { outputSnippet } : {}),
      ...(event.phase === "completed" && typeof event.durationMs === "number"
        ? { durationMs: event.durationMs }
        : {}),
      ...(event.phase === "completed" && typeof event.error === "string"
        ? { error: event.error }
        : {}),
    };
    toolCallTrace.push(trace);
    if (event.phase === "completed") {
      toolCallsByName[event.toolName] = (toolCallsByName[event.toolName] ?? 0) + 1;
      if (event.toolName === "done") {
        const output =
          event.output && typeof event.output === "object" && !Array.isArray(event.output)
            ? (event.output as Record<string, unknown>)
            : null;
        const summary = output?.summary;
        if (typeof summary === "string" && summary.trim().length > 0) {
          doneSummary = summary.trim();
        }
      }
    }
    eventLogRecords.push({
      ts: nowIso,
      type: "tool_call",
      phase: event.phase,
      turn: event.turn,
      toolIndex: event.toolIndex,
      toolName: event.toolName,
      input: event.input,
      ...(event.phase === "completed" ? { output: event.output } : {}),
      ...(event.phase === "completed" && typeof event.durationMs === "number"
        ? { durationMs: event.durationMs }
        : {}),
      ...(event.phase === "completed" && typeof event.error === "string"
        ? { error: event.error }
        : {}),
    });
  };

  logStage("start", "agent-loop");
  const toolLoopResult = await runToolLoop({
    modelId: MODEL_ID,
    maxSteps: MAX_STEPS,
    openAiReasoningEffort: "high",
    tools: selectedTools,
    steering,
    onEvent,
    contents: [
      {
        role: "user",
        parts: [{ type: "text", text: createAgentPrompt() }],
      },
    ],
  });
  logStage("done", "agent-loop");

  const agentLatencyMs = Date.now() - startedAt;
  logAgent(
    `agent_loop_done: steps=${toolLoopResult.steps.length.toString()} latency=${formatMs(agentLatencyMs)} cost=${formatUsd(usageCostUsd)}`,
  );
  logStage("start", "collect-agent-outputs");
  const workspaceFiles = await listFilesRecursive(paths.workspaceDir);
  const sourcePageImagePaths = workspaceFiles.filter((item) =>
    /source-page-\d+\.png$/u.test(path.basename(item)),
  );

  const manifestText = await readFile(paths.outputManifestPath, "utf8");
  const manifest = AgentDiagramManifestSchema.parse(JSON.parse(manifestText));
  const diagramImagePaths = manifest.diagrams
    .map((item) => path.resolve(paths.workspaceDir, item.cropPath))
    .filter((item) => path.extname(item).toLowerCase() === ".png");
  logAgent(
    `outputs_collected: workspaceFiles=${workspaceFiles.length.toString()} sourcePages=${sourcePageImagePaths.length.toString()} diagrams=${diagramImagePaths.length.toString()}`,
  );
  logStage("done", "collect-agent-outputs");

  logStage("start", "judge-outputs");
  const judgingStartedAt = Date.now();
  const verdicts = await Promise.all(
    JUDGE_MODEL_IDS.map(async (judgeModelId) => {
      logAgent(`judge_start: ${judgeModelId}`);
      return await runJudge({
        modelId: judgeModelId,
        sourcePdfPath: paths.sourcePdfPath,
        sourcePageImagePaths,
        markdownPath: paths.outputMarkdownPath,
        diagramImagePaths,
      });
    }),
  );
  const judgingLatencyMs = Date.now() - judgingStartedAt;
  const judgingCostUsd = verdicts.reduce((sum, verdict) => sum + verdict.metrics.costUsd, 0);
  for (const verdict of verdicts) {
    logAgent(
      `judge_done: ${verdict.modelId} verdict=${verdict.verdict} latency=${formatMs(verdict.metrics.elapsedMs)} cost=${formatUsd(verdict.metrics.costUsd)} summary=${toSingleLine(verdict.summary)}`,
    );
  }
  logStage("done", "judge-outputs");

  const overallPass = verdicts.every((item) => item.verdict === "pass");
  const reason = overallPass
    ? "All judges passed"
    : verdicts
        .filter((item) => item.verdict === "fail")
        .map((item) => `[${item.modelId}] ${item.summary}`)
        .join("; ");

  const totalLatencyMs = agentLatencyMs + judgingLatencyMs;
  const totalCostUsd = usageCostUsd + judgingCostUsd;

  logLines.push(`model=${MODEL_ID} maxSteps=${MAX_STEPS.toString()}`);
  logLines.push(`agent_latency=${formatMs(agentLatencyMs)} agent_cost=${formatUsd(usageCostUsd)}`);
  logLines.push(
    `judging_latency=${formatMs(judgingLatencyMs)} judging_cost=${formatUsd(judgingCostUsd)}`,
  );
  logLines.push(`tool_calls=${Object.values(toolCallsByName).reduce((sum, n) => sum + n, 0).toString()}`);
  logLines.push(`workspace_files=${workspaceFiles.length.toString()}`);
  logLines.push(`agent_log=${toRepoRelativePath(paths.agentLogPath)}`);
  logLines.push(`event_log=${toRepoRelativePath(paths.eventLogPath)}`);

  logStage("start", "write-artifacts");

  await writeFile(
    paths.eventLogPath,
    `${eventLogRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  const result: AgenticBenchmarkResult = {
    generatedAt: new Date().toISOString(),
    modelId: MODEL_ID,
    status: overallPass ? "pass" : "fail",
    reason,
    sourcePdfPath: toRepoRelativePath(paths.sourcePdfPath),
    runDir: toRepoRelativePath(paths.runRootDir),
    workspaceDir: toRepoRelativePath(paths.workspaceDir),
    taskPath: toRepoRelativePath(paths.taskPath),
    transcriptionPath: toRepoRelativePath(paths.outputMarkdownPath),
    diagramManifestPath: toRepoRelativePath(paths.outputManifestPath),
    notesPath: toRepoRelativePath(paths.outputNotesPath),
    agentLogPath: toRepoRelativePath(paths.agentLogPath),
    eventLogPath: toRepoRelativePath(paths.eventLogPath),
    summaryJsonPath: toRepoRelativePath(paths.summaryJsonPath),
    sourcePageImagePaths: sourcePageImagePaths.map((item) => toRepoRelativePath(item)),
    diagramImagePaths: diagramImagePaths.map((item) => toRepoRelativePath(item)),
    agent: {
      latencyMs: agentLatencyMs,
      modelCalls: toolLoopResult.steps.length,
      toolCalls: Object.values(toolCallsByName).reduce((sum, n) => sum + n, 0),
      toolCallsByName,
      costUsd: usageCostUsd,
      usage: usageTotals,
      thoughtsChars: thoughtChars,
      responseChars,
      doneSummary,
    },
    judging: {
      latencyMs: judgingLatencyMs,
      modelCalls: verdicts.length,
      costUsd: judgingCostUsd,
      verdicts,
    },
    total: {
      latencyMs: totalLatencyMs,
      costUsd: totalCostUsd,
    },
  };

  await writeFile(paths.summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await writeFile(path.join(paths.runRootDir, "run.log"), `${logLines.join("\n")}\n`, "utf8");

  const toolTraceLines = toolCallTrace
    .map((entry) => {
      const duration = typeof entry.durationMs === "number" ? `${entry.durationMs.toString()}ms` : "n/a";
      const status = entry.error ? `error=${entry.error}` : "ok";
      return `- [${entry.ts}] turn=${entry.turn.toString()} idx=${entry.toolIndex.toString()} tool=${entry.toolName} phase=${entry.phase} duration=${duration} ${status}`;
    })
    .join("\n");
  await writeFile(
    path.join(paths.runRootDir, "tool-trace.md"),
    `${toolTraceLines}\n`,
    "utf8",
  );
  logStage("done", "write-artifacts");
  logAgent(
    `done: status=${result.status} totalLatency=${formatMs(result.total.latencyMs)} totalCost=${formatUsd(result.total.costUsd)} runDir=${result.runDir}`,
  );

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logAgent(`error: ${sanitizeLogText(message)}`);
    throw error;
  }
}

async function renderResultsMarkdown(result: AgenticBenchmarkResult): Promise<string> {
  const lines: string[] = [];
  lines.push("# PDF Transcription Agentic Benchmark Results");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Model: ${result.modelId}`);
  lines.push(`Status: ${result.status.toUpperCase()}`);
  lines.push(`Reason: ${result.reason}`);
  lines.push("");
  lines.push("## Paths");
  lines.push("");
  lines.push(`- Source PDF: ${result.sourcePdfPath}`);
  lines.push(`- Run dir: ${result.runDir}`);
  lines.push(`- Workspace dir: ${result.workspaceDir}`);
  lines.push(`- Task file: ${result.taskPath}`);
  lines.push(`- Transcription: ${result.transcriptionPath}`);
  lines.push(`- Diagram manifest: ${result.diagramManifestPath}`);
  lines.push(`- Notes: ${result.notesPath}`);
  lines.push(`- Agent log: ${result.agentLogPath}`);
  lines.push(`- Agent event log: ${result.eventLogPath}`);
  lines.push(`- Summary JSON: ${result.summaryJsonPath}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push(
    `- Agent: latency=${formatMs(result.agent.latencyMs)} cost=${formatUsd(result.agent.costUsd)} modelCalls=${result.agent.modelCalls.toString()} toolCalls=${result.agent.toolCalls.toString()}`,
  );
  lines.push(
    `- Judging: latency=${formatMs(result.judging.latencyMs)} cost=${formatUsd(result.judging.costUsd)} calls=${result.judging.modelCalls.toString()}`,
  );
  lines.push(
    `- Total: latency=${formatMs(result.total.latencyMs)} cost=${formatUsd(result.total.costUsd)}`,
  );
  lines.push(
    `- Agent text chars: thoughts=${result.agent.thoughtsChars.toString()} response=${result.agent.responseChars.toString()}`,
  );
  lines.push("");
  lines.push("### Tool Calls By Name");
  lines.push("");
  for (const [toolName, count] of Object.entries(result.agent.toolCallsByName).sort((a, b) =>
    b[1] - a[1],
  )) {
    lines.push(`- ${toolName}: ${count.toString()}`);
  }
  lines.push("");
  lines.push("### Judge Verdicts");
  lines.push("");
  for (const verdict of result.judging.verdicts) {
    lines.push(
      `- ${verdict.modelId}: ${verdict.verdict.toUpperCase()} (${formatMs(verdict.metrics.elapsedMs)}, ${formatUsd(verdict.metrics.costUsd)}) - ${verdict.summary}`,
    );
    if (verdict.issues.length > 0) {
      lines.push(`- Issues: ${verdict.issues.join(" | ")}`);
    }
  }
  lines.push("");
  lines.push("## Diagram Crops");
  lines.push("");
  if (result.diagramImagePaths.length === 0) {
    lines.push("_No diagram crops found._");
  } else {
    for (const imagePath of result.diagramImagePaths) {
      const alt = path.basename(imagePath);
      lines.push(`![${alt}](${imagePath})`);
    }
  }
  lines.push("");
  lines.push("## Transcription");
  lines.push("");
  const transcription = await readFile(fromRepoRelativePath(result.transcriptionPath), "utf8").catch(() => "");
  if (transcription.trim().length === 0) {
    lines.push("_Missing transcription output._");
  } else {
    lines.push("```markdown");
    lines.push(transcription.trimEnd());
    lines.push("```");
  }
  lines.push("");
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  await assertFileExists(cli.sourcePdfPath);

  await mkdir(OUTPUT_ROOT_DIR, { recursive: true });

  const result = await runAgenticBenchmark(cli.sourcePdfPath);
  const markdown = await renderResultsMarkdown(result);
  await writeFile(RESULTS_MARKDOWN_PATH, markdown, "utf8");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pdf-bench] error: ${sanitizeLogText(message)}`);
  process.exit(1);
});
