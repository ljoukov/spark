import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { z } from "zod";
import {
  createToolLoopSteeringChannel as createAgentLoopSteeringChannel,
  isLlmTextModelId,
  runAgentLoop,
} from "@ljoukov/llm";

import { buildSparkAgentTools } from "@spark/llm/agent/sparkAgentRunner";
import {
  assertFileExists,
  createAgenticBenchmarkLogger,
  createRepoPathHelpers,
  formatMs,
  formatUsd,
  toModelSlug,
  toRunTimestampSlug,
  type UsageTotals,
} from "@spark/llm/agent/benchmarks/agenticBenchmark";
import { tool, type LlmTextModelId, type LlmToolSet } from "@spark/llm/utils/llm";

import { ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const { toRepoRelativePath, sanitizeLogText } = createRepoPathHelpers({
  benchmarkDir: BENCHMARK_DIR,
  repoRootDir: REPO_ROOT_DIR,
});
const DEFAULT_SOURCE_FILE_PATH = path.join(BENCHMARK_DIR, "data", "clipboard-1.png");
const OUTPUT_ROOT_DIR = path.join(BENCHMARK_DIR, "output");
const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.3-codex";
const MAX_STEPS = 40;
const REQUIRED_TOOL_NAMES = ["list_files", "read_file", "extract_text", "done"] as const;

type CliArgs = {
  sourceFilePath: string;
  modelId: LlmTextModelId;
  useSubagents: boolean;
};

type BenchmarkPathConfig = {
  runRootDir: string;
  workspaceDir: string;
  sourceDir: string;
  outputDir: string;
  sourceRelativePath: string;
  outputRelativePath: string;
  sourceWorkspacePath: string;
  outputWorkspacePath: string;
  taskPath: string;
  agentLogPath: string;
  agentMainLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
  resultsMarkdownPath: string;
};

type BenchmarkResult = {
  generatedAt: string;
  modelId: string;
  useSubagents: boolean;
  status: "pass" | "fail";
  reason: string;
  runDir: string;
  workspaceDir: string;
  sourceFilePath: string;
  taskPath: string;
  outputPath: string;
  outputChars: number;
  outputText: string;
  agentLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
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
};

function parseCliArgs(args: readonly string[]): CliArgs {
  const raw: {
    sourceFilePath?: string;
    modelId?: string;
    useSubagents?: string;
  } = {};

  for (const arg of args) {
    if (arg.startsWith("--input-file=")) {
      raw.sourceFilePath = arg.slice("--input-file=".length).trim();
      continue;
    }
    if (arg.startsWith("--source-file=")) {
      raw.sourceFilePath = arg.slice("--source-file=".length).trim();
      continue;
    }
    if (arg.startsWith("--model-id=")) {
      raw.modelId = arg.slice("--model-id=".length).trim();
      continue;
    }
    if (arg === "--use-subagents") {
      raw.useSubagents = "true";
      continue;
    }
    if (arg === "--no-use-subagents") {
      raw.useSubagents = "false";
      continue;
    }
    if (arg.startsWith("--use-subagents=")) {
      raw.useSubagents = arg.slice("--use-subagents=".length).trim();
      continue;
    }
  }

  const parsed = z
    .object({
      sourceFilePath: z.string().trim().min(1).default(DEFAULT_SOURCE_FILE_PATH),
      modelId: z.string().trim().min(1).default(DEFAULT_AGENT_MODEL_ID),
      useSubagents: z.string().trim().min(1).optional(),
    })
    .parse(raw);

  const parseBooleanFlag = (
    value: string | undefined,
    defaultValue: boolean,
    flagName: string,
  ): boolean => {
    if (typeof value !== "string") {
      return defaultValue;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    throw new Error(
      `Invalid ${flagName} value: "${value}". Use true/false (or 1/0, yes/no, on/off).`,
    );
  };

  const modelId = parsed.modelId.replaceAll("-gtp-", "-gpt-");
  return {
    sourceFilePath: parsed.sourceFilePath,
    modelId,
    useSubagents: parseBooleanFlag(parsed.useSubagents, false, "--use-subagents"),
  };
}

function createAgentTaskDescription(options: {
  sourceRelativePath: string;
  outputRelativePath: string;
}): string {
  return [
    "# Task",
    "Use `extract_text` to transcribe the source document into markdown.",
    "",
    "## Required Steps",
    "1. Call `extract_text` exactly once with this payload shape:",
    `   - documentPaths: ["${options.sourceRelativePath}"]`,
    `   - outputPath: "${options.outputRelativePath}"`,
    "   - instructions: explain that this call should transcribe only the primary source document into markdown and preserve math notation.",
    "2. Read the extracted markdown file with `read_file`.",
    "3. Call `done` with a concise summary.",
    "",
    "## Rules",
    "- Do not call `extract_text` more than once unless it fails.",
    "- Do not use `view_image` or `crop_image` for this benchmark.",
    "- Keep the output faithful to the source content; if uncertain, mark uncertainty explicitly.",
  ].join("\n");
}

function createAgentPrompt(): string {
  return ["Read `TASK.md` from the workspace root.", "Follow it exactly."].join("\n");
}

async function buildPathConfig(options: {
  sourceFilePath: string;
  modelId: string;
}): Promise<BenchmarkPathConfig> {
  const modelSlug = toModelSlug(options.modelId);
  const runId = `${toRunTimestampSlug()}-${randomUUID().slice(0, 8)}`;
  const runRootDir = path.join(OUTPUT_ROOT_DIR, modelSlug, runId);
  const workspaceDir = path.join(runRootDir, "workspace");
  const sourceDir = path.join(workspaceDir, "source");
  const outputDir = path.join(workspaceDir, "output");
  const sourceBaseName = path.basename(options.sourceFilePath);
  const sourceRelativePath = `source/${sourceBaseName}`;
  const outputRelativePath = "output/extracted.md";
  const sourceWorkspacePath = path.join(sourceDir, sourceBaseName);
  const outputWorkspacePath = path.join(outputDir, "extracted.md");
  const taskPath = path.join(workspaceDir, "TASK.md");
  const agentLogPath = path.join(runRootDir, "agent.log");
  const agentMainLogPath = path.join(runRootDir, "agent_main.log");
  const eventLogPath = path.join(runRootDir, "agent-log.jsonl");
  const summaryJsonPath = path.join(runRootDir, "summary.json");
  const resultsMarkdownPath = path.join(runRootDir, "RESULTS.md");

  await rm(runRootDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await copyFile(options.sourceFilePath, sourceWorkspacePath);
  await writeFile(
    taskPath,
    `${createAgentTaskDescription({ sourceRelativePath, outputRelativePath })}\n`,
    "utf8",
  );

  return {
    runRootDir,
    workspaceDir,
    sourceDir,
    outputDir,
    sourceRelativePath,
    outputRelativePath,
    sourceWorkspacePath,
    outputWorkspacePath,
    taskPath,
    agentLogPath,
    agentMainLogPath,
    eventLogPath,
    summaryJsonPath,
    resultsMarkdownPath,
  };
}

async function runBenchmark(options: {
  sourceFilePath: string;
  modelId: LlmTextModelId;
  useSubagents: boolean;
}): Promise<BenchmarkResult> {
  const paths = await buildPathConfig({
    sourceFilePath: options.sourceFilePath,
    modelId: options.modelId,
  });
  const stageOrder = [
    "prepare-workspace",
    "resolve-tools",
    "agent-loop",
    "collect-agent-outputs",
    "write-artifacts",
  ] as const;
  await writeFile(paths.agentLogPath, "", "utf8");
  if (options.useSubagents) {
    await writeFile(paths.agentMainLogPath, "", "utf8");
  }

  const logger = createAgenticBenchmarkLogger({
    benchLabel: "text-extract-bench",
    runRootDir: paths.runRootDir,
    agentLogPath: paths.agentLogPath,
    useSubagents: options.useSubagents,
    ...(options.useSubagents ? { agentMainLogPath: paths.agentMainLogPath } : {}),
    stageOrder,
    sanitizeLine: sanitizeLogText,
  });

  logger.logLine(
    `start: workspaceDir=${toRepoRelativePath(paths.workspaceDir)} source=${paths.sourceRelativePath} output=${paths.outputRelativePath} model=${options.modelId} useSubagents=${options.useSubagents ? "true" : "false"}`,
  );
  logger.logStage("start", "prepare-workspace");
  const workspace = {
    scheduleUpdate: (inputPath: string): void => {
      void inputPath;
    },
    deleteFile: async (): Promise<void> => {
      // Filesystem deletion already happened inside buildSparkAgentTools.
    },
    moveFile: async (): Promise<void> => {
      // Filesystem move already happened inside buildSparkAgentTools.
    },
  };
  logger.logStage("done", "prepare-workspace");

  logger.logStage("start", "resolve-tools");
  const allTools = buildSparkAgentTools({
    workspace,
    rootDir: paths.workspaceDir,
    userId: "benchmark-runner",
    serviceAccountJson: "{}",
    progress: logger.progress,
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
  logger.logLine(`exposed tools: ${Object.keys(selectedTools).sort().join(", ")}`);
  logger.logStage("done", "resolve-tools");

  const steering = createAgentLoopSteeringChannel();
  const startedAt = Date.now();
  logger.logStage("start", "agent-loop");
  if (!isLlmTextModelId(options.modelId)) {
    throw new Error(`Unsupported model id for runAgentLoop: ${options.modelId}`);
  }
  const toolLoopResult = await runAgentLoop({
    model: options.modelId,
    input: createAgentPrompt(),
    maxSteps: MAX_STEPS,
    openAiReasoningEffort: "high",
    tools: selectedTools,
    subagents: options.useSubagents ? { promptPattern: "codex" } : false,
    telemetry: {
      includeLlmStreamEvents: true,
      sink: {
        emit: logger.onTelemetryEvent,
      },
    },
    steering,
    onEvent: logger.onEvent,
  });
  logger.overrideUsageCostUsd(toolLoopResult.totalCostUsd);
  logger.logStage("done", "agent-loop");
  const agentLatencyMs = Date.now() - startedAt;

  logger.logStage("start", "collect-agent-outputs");
  const outputText = await readFile(paths.outputWorkspacePath, "utf8");
  if (outputText.trim().length === 0) {
    throw new Error(`Output file is empty: ${paths.outputRelativePath}`);
  }
  logger.logLine(
    `output_collected: chars=${outputText.length.toString()} path=${paths.outputRelativePath}`,
  );
  logger.logStage("done", "collect-agent-outputs");

  logger.logStage("start", "write-artifacts");
  const snapshot = logger.snapshot();
  const toolCallCount = Object.values(snapshot.toolCallsByName).reduce(
    (sum, count) => sum + count,
    0,
  );

  await writeFile(
    paths.eventLogPath,
    `${snapshot.eventLogRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  const result: BenchmarkResult = {
    generatedAt: new Date().toISOString(),
    modelId: options.modelId,
    useSubagents: options.useSubagents,
    status: "pass",
    reason: "Agent produced a non-empty extracted markdown output.",
    runDir: toRepoRelativePath(paths.runRootDir),
    workspaceDir: toRepoRelativePath(paths.workspaceDir),
    sourceFilePath: toRepoRelativePath(paths.sourceWorkspacePath),
    taskPath: toRepoRelativePath(paths.taskPath),
    outputPath: toRepoRelativePath(paths.outputWorkspacePath),
    outputChars: outputText.length,
    outputText,
    agentLogPath: toRepoRelativePath(paths.agentLogPath),
    eventLogPath: toRepoRelativePath(paths.eventLogPath),
    summaryJsonPath: toRepoRelativePath(paths.summaryJsonPath),
    agent: {
      latencyMs: agentLatencyMs,
      modelCalls: toolLoopResult.steps.length,
      toolCalls: toolCallCount,
      toolCallsByName: snapshot.toolCallsByName,
      costUsd: snapshot.usageCostUsd,
      usage: snapshot.usageTotals,
      thoughtsChars: snapshot.thoughtChars,
      responseChars: snapshot.responseChars,
      doneSummary: snapshot.doneSummary,
    },
  };

  await writeFile(paths.summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  logger.logStage("done", "write-artifacts");
  logger.logLine(
    `done: status=${result.status} latency=${formatMs(result.agent.latencyMs)} cost=${formatUsd(result.agent.costUsd)} runDir=${result.runDir}`,
  );

  const resultsMarkdown = [
    "# Text Extraction Benchmark Results",
    "",
    `Generated at: ${result.generatedAt}`,
    `Model: ${result.modelId}`,
    `Use subagents: ${result.useSubagents ? "true" : "false"}`,
    `Status: ${result.status.toUpperCase()}`,
    `Reason: ${result.reason}`,
    "",
    "## Paths",
    "",
    `- Run dir: ${result.runDir}`,
    `- Workspace dir: ${result.workspaceDir}`,
    `- Source file: ${result.sourceFilePath}`,
    `- Task file: ${result.taskPath}`,
    `- Output file: ${result.outputPath}`,
    `- Agent log: ${result.agentLogPath}`,
    `- Event log: ${result.eventLogPath}`,
    `- Summary JSON: ${result.summaryJsonPath}`,
    "",
    "## Metrics",
    "",
    `- Latency: ${formatMs(result.agent.latencyMs)}`,
    `- Cost: ${formatUsd(result.agent.costUsd)}`,
    `- Model calls: ${result.agent.modelCalls.toString()}`,
    `- Tool calls: ${result.agent.toolCalls.toString()}`,
    `- Output chars: ${result.outputChars.toString()}`,
    "",
    "## Extracted Output",
    "",
    "```markdown",
    result.outputText.trimEnd(),
    "```",
    "",
  ].join("\n");
  await writeFile(paths.resultsMarkdownPath, resultsMarkdown, "utf8");

  return result;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  await assertFileExists(cli.sourceFilePath);
  const result = await runBenchmark({
    sourceFilePath: cli.sourceFilePath,
    modelId: cli.modelId,
    useSubagents: cli.useSubagents,
  });
  console.log(
    [
      `status=${result.status.toUpperCase()}`,
      `reason="${result.reason}"`,
      `runDir=${result.runDir}`,
      `output=${result.outputPath}`,
      `agentLog=${result.agentLogPath}`,
      `eventLog=${result.eventLogPath}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[text-extract-bench] failed: ${message}`);
  process.exitCode = 1;
});
