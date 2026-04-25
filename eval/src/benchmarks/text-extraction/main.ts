import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { Command } from "commander";
import { z } from "zod";
import {
  createToolLoopSteeringChannel as createAgentLoopSteeringChannel,
  isLlmTextModelId,
  runAgentLoop,
  tool,
  type LlmTextModelId,
  type LlmToolSet,
} from "@ljoukov/llm";

import {
  buildSparkAgentFilesystemToolConfig,
  buildSparkAgentTools,
} from "@spark/llm/agent/sparkAgentRunner";
import {
  assertFileExists,
  createRepoPathHelpers,
  formatMs,
  formatUsd,
  summarizeToolLoopResult,
  toToolLoopEventLogRecords,
  toModelSlug,
  toRunTimestampSlug,
  type UsageTotals,
} from "@spark/llm/agent/benchmarks/agenticBenchmark";

import { ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const { toRepoRelativePath } = createRepoPathHelpers({
  benchmarkDir: BENCHMARK_DIR,
  repoRootDir: REPO_ROOT_DIR,
});
const DEFAULT_SOURCE_FILE_PATH = path.join(BENCHMARK_DIR, "data", "clipboard-1.png");
const OUTPUT_ROOT_DIR = path.join(BENCHMARK_DIR, "output");
const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.5-fast";
const MAX_STEPS = 40;
const REQUIRED_CUSTOM_TOOL_NAMES = ["extract_text", "done"] as const;

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
  llmLogsDir: string;
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
  llmLogsDir: string;
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
  const command = new Command("bench:text-extraction")
    .description("Run text extraction benchmark with extract_text tool.")
    .option(
      "--source-file <path>",
      "source file path to extract text from",
      DEFAULT_SOURCE_FILE_PATH,
    )
    .option("--input-file <path>", "alias for --source-file")
    .option("--model-id <modelId>", "model id for runAgentLoop", DEFAULT_AGENT_MODEL_ID)
    .option("--model <modelId>", "alias for --model-id")
    .option(
      "--use-subagents [enabled]",
      "enable subagents (true/false, 1/0, yes/no, on/off)",
    )
    .option("--no-use-subagents", "disable subagents");
  command.parse(args, { from: "user" });

  const options = command.opts<{
    sourceFile: string;
    inputFile?: string;
    modelId: string;
    model?: string;
    useSubagents?: string | boolean;
  }>();

  const useSubagentsRaw =
    typeof options.useSubagents === "boolean"
      ? options.useSubagents
        ? "true"
        : "false"
      : options.useSubagents;

  const parsed = z
    .object({
      sourceFilePath: z.string().trim().min(1),
      modelId: z.string().trim().min(1),
      modelAlias: z.string().trim().min(1).optional(),
      useSubagents: z.string().trim().min(1).optional(),
    })
    .parse({
      sourceFilePath: options.inputFile ?? options.sourceFile,
      modelId: options.modelId,
      modelAlias: options.model,
      useSubagents: useSubagentsRaw,
    });

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

  const modelId = (parsed.modelAlias ?? parsed.modelId).replaceAll("-gtp-", "-gpt-");
  if (!isLlmTextModelId(modelId)) {
    throw new Error(`Unsupported model id: ${modelId}`);
  }
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
  const agentLogPath = path.join(workspaceDir, "agent.log");
  const llmLogsDir = path.join(runRootDir, "logs");
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
    llmLogsDir,
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
  const workspace = {
    scheduleUpdate: (inputPath: string): void => {
      void inputPath;
    },
    deleteFile: async (): Promise<void> => {
      // Native filesystem tools already updated the local workspace.
    },
    moveFile: async (): Promise<void> => {
      // Native filesystem tools already updated the local workspace.
    },
  };
  const allTools = buildSparkAgentTools({
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
  for (const toolName of REQUIRED_CUSTOM_TOOL_NAMES) {
    const candidate = (allToolsWithDone as Record<string, unknown>)[toolName];
    if (!candidate) {
      throw new Error(`Required tool missing: ${toolName}`);
    }
    (selectedTools as Record<string, unknown>)[toolName] = candidate;
  }

  const steering = createAgentLoopSteeringChannel();
  const startedAt = Date.now();
  if (!isLlmTextModelId(options.modelId)) {
    throw new Error(`Unsupported model id for runAgentLoop: ${options.modelId}`);
  }
  const thinkingLevel =
    options.modelId.startsWith("chatgpt-") || options.modelId.startsWith("gpt-")
      ? ("high" as const)
      : undefined;
  const toolLoopResult = await runAgentLoop({
    model: options.modelId,
    input: createAgentPrompt(),
    maxSteps: MAX_STEPS,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    filesystemTool: buildSparkAgentFilesystemToolConfig({
      workspace,
      rootDir: paths.workspaceDir,
    }),
    tools: selectedTools,
    subagents: options.useSubagents ? { promptPattern: "codex" } : false,
    logging: {
      workspaceDir: paths.workspaceDir,
    },
    steering,
  });
  const agentLatencyMs = Date.now() - startedAt;
  const summary = summarizeToolLoopResult(toolLoopResult);

  const outputText = await readFile(paths.outputWorkspacePath, "utf8");
  if (outputText.trim().length === 0) {
    throw new Error(`Output file is empty: ${paths.outputRelativePath}`);
  }

  await writeFile(
    paths.eventLogPath,
    `${toToolLoopEventLogRecords(toolLoopResult).map((record) => JSON.stringify(record)).join("\n")}\n`,
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
    llmLogsDir: toRepoRelativePath(paths.llmLogsDir),
    eventLogPath: toRepoRelativePath(paths.eventLogPath),
    summaryJsonPath: toRepoRelativePath(paths.summaryJsonPath),
    agent: {
      latencyMs: agentLatencyMs,
      modelCalls: summary.modelCalls,
      toolCalls: summary.toolCalls,
      toolCallsByName: summary.toolCallsByName,
      costUsd: summary.agentCostUsd,
      usage: summary.usageTotals,
      thoughtsChars: summary.thoughtsChars,
      responseChars: summary.responseChars,
      doneSummary: summary.doneSummary,
    },
  };

  await writeFile(paths.summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

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
    `- Native LLM logs dir: ${result.llmLogsDir}`,
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
      `llmLogs=${result.llmLogsDir}`,
      `eventLog=${result.eventLogPath}`,
    ].join(" "),
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[text-extract-bench] failed: ${message}`);
  process.exitCode = 1;
});
