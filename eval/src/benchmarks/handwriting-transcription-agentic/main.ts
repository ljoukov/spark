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
} from "@ljoukov/llm";

import { buildSparkAgentTools } from "@spark/llm/agent/sparkAgentRunner";
import { applyPdfTranscriptionSkillTools } from "@spark/llm/agent/skills/pdfTranscription";
import { HANDWRITING_TRANSCRIPTION_SKILL_TEXT } from "@spark/llm/agent/skills/handwritingTranscription";
import {
  assertFileExists,
  createAgenticBenchmarkLogger,
  createRepoPathHelpers,
  formatMs,
  formatUsd,
  listFilesRecursive,
  toModelSlug,
  toRunTimestampSlug,
  type UsageTotals,
} from "@spark/llm/agent/benchmarks/agenticBenchmark";
import {
  tool,
  type LlmTextModelId,
  type LlmToolSet,
} from "@spark/llm/utils/llm";

import { ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const { toRepoRelativePath, fromRepoRelativePath, sanitizeLogText } =
  createRepoPathHelpers({
    benchmarkDir: BENCHMARK_DIR,
    repoRootDir: REPO_ROOT_DIR,
  });
const DEFAULT_INPUT_FILE_PATHS = [
  path.join(BENCHMARK_DIR, "data", "clipboard-1.png"),
  path.join(BENCHMARK_DIR, "data", "hamilton2017-h1-h2.jpg"),
  path.join(BENCHMARK_DIR, "data", "hamilton-2017-solutions-p1.jpg"),
  path.join(BENCHMARK_DIR, "data", "hamilton-2017-solutions-p2.jpg"),
] as const;
const OUTPUT_ROOT_DIR = path.join(BENCHMARK_DIR, "output");
const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.3-codex";
const MAX_STEPS = 160;
const REQUIRED_TOOL_NAMES = [
  "list_files",
  "read_file",
  "read_files",
  "extract_text",
  "write_file",
  "move_file",
  "delete_file",
  "view_image",
  "crop_image",
  "done",
] as const;

type AgentPathConfig = {
  runRootDir: string;
  workspaceDir: string;
  taskPath: string;
  sourceDir: string;
  sourceDocuments: SourceDocument[];
  outputDir: string;
  transcriptionPath: string;
  outputNotesPath: string;
  agentLogPath: string;
  agentMainLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
};

type SourceDocument = {
  inputPath: string;
  sourceBasename: string;
  sourcePath: string;
  sourceRelativePath: string;
};

type CliArgs = {
  filePaths: string[];
  modelIds: LlmTextModelId[];
  useSubagents: boolean;
};

type AgenticBenchmarkResult = {
  generatedAt: string;
  modelId: string;
  status: "pass" | "fail";
  reason: string;
  runDir: string;
  workspaceDir: string;
  taskPath: string;
  inputFilePaths: string[];
  sourceDocumentPaths: string[];
  transcriptionPath: string;
  notesPath: string;
  inspectionImagePaths: string[];
  agentLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
  agent: {
    latencyMs: number;
    modelCalls: number;
    toolCalls: number;
    toolCallsByName: Record<string, number>;
    llmCostUsd: number;
    usage: UsageTotals;
    thoughtsChars: number;
    responseChars: number;
    doneSummary: string | null;
  };
  toolLlmCostByName: Record<string, number>;
  total: {
    latencyMs: number;
    costUsd: number;
    agentLlmCostUsd: number;
    toolLlmCostUsd: number;
  };
};

type AgenticBenchmarkRunOutcome = {
  modelId: LlmTextModelId;
  useSubagents: boolean;
  result?: AgenticBenchmarkResult;
  error?: string;
};

function extractToolLlmCostSummary(eventLogRecords: readonly Record<string, unknown>[]): {
  totalCostUsd: number;
  byToolName: Record<string, number>;
} {
  let totalCostUsd = 0;
  const byToolName: Record<string, number> = {};
  for (const record of eventLogRecords) {
    if (record.type !== "tool_call" || record.phase !== "completed") {
      continue;
    }
    const toolName =
      typeof record.toolName === "string" && record.toolName.trim().length > 0
        ? record.toolName
        : "unknown";
    const output =
      typeof record.output === "object" &&
      record.output !== null &&
      !Array.isArray(record.output)
        ? (record.output as Record<string, unknown>)
        : null;
    if (!output) {
      continue;
    }
    const rawCostUsd = output.costUsd;
    if (
      typeof rawCostUsd !== "number" ||
      !Number.isFinite(rawCostUsd) ||
      rawCostUsd < 0
    ) {
      continue;
    }
    totalCostUsd += rawCostUsd;
    byToolName[toolName] = (byToolName[toolName] ?? 0) + rawCostUsd;
  }
  return {
    totalCostUsd,
    byToolName,
  };
}

function formatToolCostByNameLine(byToolName: Record<string, number>): string {
  const entries = Object.entries(byToolName).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return "none";
  }
  return entries
    .map(([toolName, costUsd]) => `${toolName}:${formatUsd(costUsd)}`)
    .join(",");
}

function parseCliArgs(args: readonly string[]): CliArgs {
  const command = new Command("bench:handwriting-transcription-agentic")
    .description("Run handwriting transcription agentic benchmark.")
    .option(
      "--file <path>",
      "input file path (repeat flag to add more files)",
      (value: string, previous: string[] | undefined): string[] => {
        const collected = Array.isArray(previous) ? previous : [];
        return [...collected, value];
      },
    )
    .option(
      "--files <paths>",
      "comma-separated input file paths",
    )
    .option("--model-id <modelId>", "single model id")
    .option("--model <modelId>", "alias for --model-id")
    .option("--models <modelIds>", "comma-separated model ids")
    .option(
      "--use-subagents [enabled]",
      "enable subagents (true/false, 1/0, yes/no, on/off)",
    )
    .option("--no-use-subagents", "disable subagents");
  command.parse(args, { from: "user" });

  const options = command.opts<{
    file?: string[];
    files?: string;
    modelId?: string;
    model?: string;
    models?: string;
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
      repeatedFilePaths: z.array(z.string().trim().min(1)).default([]),
      files: z.string().trim().min(1).optional(),
      modelId: z.string().trim().min(1).optional(),
      modelAlias: z.string().trim().min(1).optional(),
      models: z.string().trim().min(1).optional(),
      useSubagents: z.string().trim().min(1).optional(),
    })
    .parse({
      repeatedFilePaths: options.file,
      files: options.files,
      modelId: options.modelId,
      modelAlias: options.model,
      models: options.models,
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

  const normaliseModelId = (modelId: string): LlmTextModelId => {
    const trimmed = modelId.trim();
    if (trimmed.length === 0) {
      throw new Error("Model id cannot be empty.");
    }
    return trimmed.replaceAll("-gtp-", "-gpt-");
  };

  const modelIds: LlmTextModelId[] = [];
  if (typeof parsed.models === "string") {
    for (const part of parsed.models.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        continue;
      }
      modelIds.push(normaliseModelId(trimmed));
    }
  }
  if (typeof parsed.modelId === "string") {
    modelIds.push(normaliseModelId(parsed.modelId));
  }
  if (typeof parsed.modelAlias === "string") {
    modelIds.push(normaliseModelId(parsed.modelAlias));
  }
  if (modelIds.length === 0) {
    modelIds.push(DEFAULT_AGENT_MODEL_ID);
  }

  const dedupedModelIds = Array.from(new Set(modelIds));
  const filePaths: string[] = [];
  for (const filePath of parsed.repeatedFilePaths) {
    filePaths.push(filePath);
  }
  if (typeof parsed.files === "string") {
    for (const part of parsed.files.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length === 0) {
        continue;
      }
      filePaths.push(trimmed);
    }
  }
  if (filePaths.length === 0) {
    for (const filePath of DEFAULT_INPUT_FILE_PATHS) {
      filePaths.push(filePath);
    }
  }

  return {
    filePaths: Array.from(new Set(filePaths)),
    modelIds: dedupedModelIds,
    useSubagents: parseBooleanFlag(
      parsed.useSubagents,
      false,
      "--use-subagents",
    ),
  };
}

async function buildPathConfig(options: {
  filePaths: string[];
  modelId: string;
}): Promise<AgentPathConfig> {
  const modelSlug = toModelSlug(options.modelId);
  const runId = `${toRunTimestampSlug()}-${randomUUID().slice(0, 8)}`;
  const runRootDir = path.join(OUTPUT_ROOT_DIR, modelSlug, runId);
  const workspaceDir = path.join(runRootDir, "workspace");
  const taskPath = path.join(workspaceDir, "TASK.md");
  const sourceDir = path.join(workspaceDir, "source");
  const outputDir = path.join(workspaceDir, "output");
  const transcriptionPath = path.join(outputDir, "transcription.md");
  const outputNotesPath = path.join(outputDir, "agent-notes.md");
  const agentLogPath = path.join(runRootDir, "agent.log");
  const agentMainLogPath = path.join(runRootDir, "agent_main.log");
  const eventLogPath = path.join(runRootDir, "agent-log.jsonl");
  const summaryJsonPath = path.join(runRootDir, "summary.json");

  await rm(runRootDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  const sourceDocuments: SourceDocument[] = [];
  for (const [index, inputPath] of options.filePaths.entries()) {
    const sourceBasename = `${(index + 1).toString().padStart(2, "0")}-${path.basename(inputPath)}`;
    const sourcePath = path.join(sourceDir, sourceBasename);
    const sourceRelativePath = `source/${sourceBasename}`;
    await copyFile(inputPath, sourcePath);
    sourceDocuments.push({
      inputPath,
      sourceBasename,
      sourcePath,
      sourceRelativePath,
    });
  }
  await writeFile(
    taskPath,
    `${createAgentTaskDescription({
      sourceRelativePaths: sourceDocuments.map((item) => item.sourceRelativePath),
    })}\n`,
    "utf8",
  );

  return {
    runRootDir,
    workspaceDir,
    taskPath,
    sourceDir,
    sourceDocuments,
    outputDir,
    transcriptionPath,
    outputNotesPath,
    agentLogPath,
    agentMainLogPath,
    eventLogPath,
    summaryJsonPath,
  };
}

function createAgentTaskDescription(options: {
  sourceRelativePaths: string[];
}): string {
  const documentPathsJson = JSON.stringify(options.sourceRelativePaths);
  const sourceList = options.sourceRelativePaths.map((item) => `- \`${item}\``);
  return [
    "# Task",
    "Transcribe and evaluate the provided files.",
    "The file bundle may include handwritten student work, problem statements, and optional official solutions.",
    "Infer each file's role from its content; do not assume role from filename.",
    "For each problem the student attempted to solve, produce a nicely formatted markdown report with embedded LaTeX:",
    "- Problem statement",
    "- Transcription of student solution",
    "- Grading of the student solution",
    "- Line-by-line feedback on the student solution",
    "- Overall feedback and grading explanation",
    "If no official solution is available in the attached files, solve the problem yourself first and use your own solution as the grading reference.",
    "",
    "## Required Inputs",
    ...sourceList,
    "",
    "## Required extract_text call",
    "Use a single `extract_text` call to transcribe all target documents.",
    "Do not use `supportingPaths` for this benchmark because all listed files are transcription targets.",
    "Use exactly this shape:",
    `- \`documentPaths: ${documentPathsJson}\``,
    "- `outputPath: \"output/transcription.md\"`",
    "- Include `instructions` that keep source-file boundaries clear in the output.",
    "After this call, use `read_file output/transcription.md` for any edits; do not repeat an identical `extract_text` call.",
    "",
    "Include all relevant text from each file and ignore unrelated page clutter.",
    "",
    "Write benchmark artifacts to these exact paths: `output/transcription.md` and `output/agent-notes.md`.",
    "Use `tmp/` for temporary files.",
    "",
    "## Workflow Skill",
    "Use this workflow skill for general transcription behavior:",
    "",
    "~~~markdown",
    HANDWRITING_TRANSCRIPTION_SKILL_TEXT,
    "~~~",
    "",
    "When complete, call `done` with a concise summary of role-inference decisions and ambiguity handling.",
  ].join("\n");
}

function createAgentPrompt(): string {
  return ["Read 'TASK.md' from the workspace root.", "Follow it exactly."].join(
    "\n",
  );
}

async function runAgenticBenchmark(options: {
  filePaths: string[];
  modelId: LlmTextModelId;
  useSubagents: boolean;
}): Promise<AgenticBenchmarkResult> {
  const paths = await buildPathConfig({
    filePaths: options.filePaths,
    modelId: options.modelId,
  });
  const logLines: string[] = [];
  const stageOrder = [
    "prepare-workspace",
    "resolve-tools",
    "agent-loop",
    "write-artifacts",
  ] as const;

  await writeFile(paths.agentLogPath, "", "utf8");
  if (options.useSubagents) {
    await writeFile(paths.agentMainLogPath, "", "utf8");
  }
  const logger = createAgenticBenchmarkLogger({
    benchLabel: "handwriting-bench",
    runRootDir: paths.runRootDir,
    agentLogPath: paths.agentLogPath,
    useSubagents: options.useSubagents,
    ...(options.useSubagents
      ? { agentMainLogPath: paths.agentMainLogPath }
      : {}),
    stageOrder,
    sanitizeLine: sanitizeLogText,
  });

  try {
    logger.logLine(
      `start: workspaceDir=${toRepoRelativePath(paths.workspaceDir)} taskPath=${toRepoRelativePath(paths.taskPath)} model=${options.modelId} useSubagents=${options.useSubagents ? "true" : "false"}`,
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
      extractTextDebugRootDir: path.join(paths.runRootDir, "debug"),
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
    const selectedToolsBase: LlmToolSet = {};
    for (const toolName of REQUIRED_TOOL_NAMES) {
      const candidate = (allToolsWithDone as Record<string, unknown>)[toolName];
      if (!candidate) {
        throw new Error(`Required tool missing: ${toolName}`);
      }
      (selectedToolsBase as Record<string, unknown>)[toolName] = candidate;
    }
    const selectedTools = applyPdfTranscriptionSkillTools({
      tools: selectedToolsBase,
      rootDir: paths.workspaceDir,
      includeReferenceTextTool: false,
      onFileWritten: (outputPath) => {
        workspace.scheduleUpdate(outputPath);
      },
    });
    logger.logLine(
      `exposed tools: ${Object.keys(selectedTools)
        .sort((a, b) => a.localeCompare(b))
        .join(", ")}`,
    );
    logger.logStage("done", "resolve-tools");

    const steering = createAgentLoopSteeringChannel();
    const startedAt = Date.now();
    logger.logStage("start", "agent-loop");
    if (!isLlmTextModelId(options.modelId)) {
      throw new Error(
        `Unsupported model id for runAgentLoop: ${options.modelId}`,
      );
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
    logger.logStage("done", "agent-loop");

    const agentLlmCostUsd = toolLoopResult.totalCostUsd;
    const agentLatencyMs = Date.now() - startedAt;
    logger.logLine(
      `agent_loop_done: steps=${toolLoopResult.steps.length.toString()} latency=${formatMs(agentLatencyMs)} agentLlmCost=${formatUsd(agentLlmCostUsd)}`,
    );

    const workspaceFiles = await listFilesRecursive(paths.workspaceDir);
    const outputDirPrefix = `${path.resolve(paths.outputDir)}${path.sep}`;
    const inspectionImagePaths = workspaceFiles.filter((item) => {
      if (!item.startsWith(outputDirPrefix)) {
        return false;
      }
      const extension = path.extname(item).toLowerCase();
      return [".png", ".jpg", ".jpeg", ".webp"].includes(extension);
    });
    logger.logLine(
      [
        `workspace_scanned: workspaceFiles=${workspaceFiles.length.toString()}`,
        `inspectionImages=${inspectionImagePaths.length.toString()}`,
      ].join(" "),
    );

    const overallPass = true;
    const reason = "Agent run completed.";

    const finalSnapshot = logger.snapshot();
    const toolLlmCostSummary = extractToolLlmCostSummary(
      finalSnapshot.eventLogRecords,
    );
    const toolLlmCostUsd = toolLlmCostSummary.totalCostUsd;
    const toolCallCount = Object.values(finalSnapshot.toolCallsByName).reduce(
      (sum, count) => sum + count,
      0,
    );
    const totalLatencyMs = agentLatencyMs;
    const totalCostUsd = agentLlmCostUsd + toolLlmCostUsd;

    logLines.push(
      `model=${options.modelId} maxSteps=${MAX_STEPS.toString()} useSubagents=${options.useSubagents ? "true" : "false"}`,
    );
    logLines.push(
      `agent_latency=${formatMs(agentLatencyMs)} agent_llm_cost=${formatUsd(agentLlmCostUsd)} tool_llm_cost=${formatUsd(toolLlmCostUsd)} total_cost=${formatUsd(totalCostUsd)}`,
    );
    logLines.push(
      `tool_llm_cost_by_name=${formatToolCostByNameLine(toolLlmCostSummary.byToolName)}`,
    );
    logLines.push(`tool_calls=${toolCallCount.toString()}`);
    logLines.push(`workspace_files=${workspaceFiles.length.toString()}`);
    logLines.push(`agent_log=${toRepoRelativePath(paths.agentLogPath)}`);
    if (options.useSubagents) {
      logLines.push(
        `agent_main_log=${toRepoRelativePath(paths.agentMainLogPath)}`,
      );
      const subagentLogs = finalSnapshot.splitLogPathsCreated
        .filter(
          (item) =>
            path.basename(item) !== path.basename(paths.agentMainLogPath),
        )
        .map((item) => toRepoRelativePath(item))
        .sort((a, b) => a.localeCompare(b));
      logLines.push(
        `agent_subagent_logs=${subagentLogs.length > 0 ? subagentLogs.join(",") : "none"}`,
      );
    }
    logLines.push(`event_log=${toRepoRelativePath(paths.eventLogPath)}`);

    logger.logStage("start", "write-artifacts");
    await writeFile(
      paths.eventLogPath,
      `${finalSnapshot.eventLogRecords.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );

    const result: AgenticBenchmarkResult = {
      generatedAt: new Date().toISOString(),
      modelId: options.modelId,
      status: overallPass ? "pass" : "fail",
      reason,
      runDir: toRepoRelativePath(paths.runRootDir),
      workspaceDir: toRepoRelativePath(paths.workspaceDir),
      taskPath: toRepoRelativePath(paths.taskPath),
      inputFilePaths: options.filePaths,
      sourceDocumentPaths: paths.sourceDocuments.map((item) =>
        toRepoRelativePath(item.sourcePath),
      ),
      transcriptionPath: toRepoRelativePath(paths.transcriptionPath),
      notesPath: toRepoRelativePath(paths.outputNotesPath),
      inspectionImagePaths: inspectionImagePaths.map((item) =>
        toRepoRelativePath(item),
      ),
      agentLogPath: toRepoRelativePath(paths.agentLogPath),
      eventLogPath: toRepoRelativePath(paths.eventLogPath),
      summaryJsonPath: toRepoRelativePath(paths.summaryJsonPath),
      agent: {
        latencyMs: agentLatencyMs,
        modelCalls: toolLoopResult.steps.length,
        toolCalls: toolCallCount,
        toolCallsByName: finalSnapshot.toolCallsByName,
        llmCostUsd: agentLlmCostUsd,
        usage: finalSnapshot.usageTotals,
        thoughtsChars: finalSnapshot.thoughtChars,
        responseChars: finalSnapshot.responseChars,
        doneSummary: finalSnapshot.doneSummary,
      },
      toolLlmCostByName: toolLlmCostSummary.byToolName,
      total: {
        latencyMs: totalLatencyMs,
        costUsd: totalCostUsd,
        agentLlmCostUsd,
        toolLlmCostUsd,
      },
    };

    await writeFile(
      paths.summaryJsonPath,
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(paths.runRootDir, "run.log"),
      `${logLines.join("\n")}\n`,
      "utf8",
    );
    logger.logStage("done", "write-artifacts");
    logger.logLine(
      `done: status=${result.status} totalLatency=${formatMs(result.total.latencyMs)} totalCost=${formatUsd(result.total.costUsd)} agentLlmCost=${formatUsd(result.total.agentLlmCostUsd)} toolLlmCost=${formatUsd(result.total.toolLlmCostUsd)} runDir=${result.runDir}`,
    );

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.logLine(`error: ${sanitizeLogText(message)}`);
    throw error;
  }
}

async function renderSingleResultsMarkdown(
  result: AgenticBenchmarkResult,
): Promise<string> {
  const lines: string[] = [];
  lines.push("# Handwriting Transcription Agentic Benchmark Results");
  lines.push("");
  lines.push(`Generated at: ${result.generatedAt}`);
  lines.push(`Model: ${result.modelId}`);
  lines.push(`Status: ${result.status.toUpperCase()}`);
  lines.push(`Reason: ${result.reason}`);
  lines.push("");
  lines.push("## Paths");
  lines.push("");
  lines.push(`- Run dir: ${result.runDir}`);
  lines.push(`- Workspace dir: ${result.workspaceDir}`);
  lines.push(`- Task file: ${result.taskPath}`);
  lines.push(`- Source documents: ${result.sourceDocumentPaths.join(", ")}`);
  lines.push(`- Original input files: ${result.inputFilePaths.join(", ")}`);
  lines.push(`- Transcription: ${result.transcriptionPath}`);
  lines.push(`- Agent notes: ${result.notesPath}`);
  lines.push(`- Agent log: ${result.agentLogPath}`);
  lines.push(`- Agent event log: ${result.eventLogPath}`);
  lines.push(`- Summary JSON: ${result.summaryJsonPath}`);
  lines.push("");
  lines.push("## Metrics");
  lines.push("");
  lines.push(
    `- Agent: latency=${formatMs(result.agent.latencyMs)} llmCost=${formatUsd(result.agent.llmCostUsd)} modelCalls=${result.agent.modelCalls.toString()} toolCalls=${result.agent.toolCalls.toString()}`,
  );
  lines.push(
    `- Tool LLM: cost=${formatUsd(result.total.toolLlmCostUsd)}`,
  );
  lines.push(
    `- Total: latency=${formatMs(result.total.latencyMs)} cost=${formatUsd(result.total.costUsd)} (agent=${formatUsd(result.total.agentLlmCostUsd)} + tools=${formatUsd(result.total.toolLlmCostUsd)})`,
  );
  lines.push(
    `- Agent text chars: thoughts=${result.agent.thoughtsChars.toString()} response=${result.agent.responseChars.toString()}`,
  );
  lines.push("");
  lines.push("### Tool Calls By Name");
  lines.push("");
  for (const [toolName, count] of Object.entries(
    result.agent.toolCallsByName,
  ).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${toolName}: ${count.toString()}`);
  }
  lines.push("");
  lines.push("### Tool LLM Cost By Name");
  lines.push("");
  const toolCostByNameEntries = Object.entries(result.toolLlmCostByName).sort(
    (a, b) => b[1] - a[1],
  );
  if (toolCostByNameEntries.length === 0) {
    lines.push("_No tool LLM costs recorded._");
  } else {
    for (const [toolName, costUsd] of toolCostByNameEntries) {
      lines.push(`- ${toolName}: ${formatUsd(costUsd)}`);
    }
  }
  lines.push("");
  lines.push("## Inspection Images");
  lines.push("");
  if (result.inspectionImagePaths.length === 0) {
    lines.push("_No inspection images found in output directory._");
  } else {
    for (const imagePath of result.inspectionImagePaths) {
      const alt = path.basename(imagePath);
      lines.push(`![${alt}](${imagePath})`);
    }
  }
  lines.push("");
  for (const [label, resultPath] of [
    ["Transcription", result.transcriptionPath],
    ["Agent Notes", result.notesPath],
  ] as const) {
    lines.push(`## ${label}`);
    lines.push("");
    const text = await readFile(fromRepoRelativePath(resultPath), "utf8").catch(
      () => "",
    );
    if (text.trim().length === 0) {
      lines.push(`_Missing ${label.toLowerCase()} output._`);
    } else {
      lines.push("```markdown");
      lines.push(text.trimEnd());
      lines.push("```");
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function renderResultsMarkdown(
  outcomes: readonly AgenticBenchmarkRunOutcome[],
): Promise<string> {
  const ordered = [...outcomes].sort((a, b) =>
    a.modelId.localeCompare(b.modelId),
  );
  if (ordered.length === 1 && ordered[0]?.result) {
    return await renderSingleResultsMarkdown(ordered[0].result);
  }

  const generatedAt = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# Handwriting Transcription Agentic Benchmark Results");
  lines.push("");
  lines.push(`Generated at: ${generatedAt}`);
  lines.push(`Runs: ${ordered.length.toString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const outcome of ordered) {
    if (outcome.result) {
      lines.push(
        `- ${outcome.modelId}: subagents=${outcome.useSubagents ? "ENABLED" : "DISABLED"} status=${outcome.result.status.toUpperCase()} latency=${formatMs(outcome.result.total.latencyMs)} cost=${formatUsd(outcome.result.total.costUsd)} runDir=${outcome.result.runDir}`,
      );
    } else {
      lines.push(
        `- ${outcome.modelId}: subagents=${outcome.useSubagents ? "ENABLED" : "DISABLED"} status=ERROR latency=n/a cost=n/a runDir=${toRepoRelativePath(path.join(OUTPUT_ROOT_DIR, toModelSlug(outcome.modelId)))} error=${outcome.error ?? "unknown error"}`,
      );
    }
  }
  lines.push("");

  for (const outcome of ordered) {
    lines.push(`## Model: ${outcome.modelId}`);
    lines.push("");
    if (outcome.result) {
      const single = await renderSingleResultsMarkdown(outcome.result);
      const singleLines = single.trimEnd().split("\n");
      const bodyStart = singleLines.findIndex((line) =>
        line.startsWith("## Paths"),
      );
      if (bodyStart >= 0) {
        lines.push(...singleLines.slice(bodyStart));
      } else {
        lines.push(...singleLines);
      }
    } else {
      lines.push(
        `- Subagents: ${outcome.useSubagents ? "ENABLED" : "DISABLED"}`,
      );
      lines.push(`- Status: ERROR`);
      lines.push(`- Error: ${outcome.error ?? "unknown error"}`);
      lines.push(
        `- Run dir: ${toRepoRelativePath(path.join(OUTPUT_ROOT_DIR, toModelSlug(outcome.modelId)))}`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function resolveResultsMarkdownPath(
  outcomes: readonly AgenticBenchmarkRunOutcome[],
): string {
  if (outcomes.length === 1 && outcomes[0]?.result) {
    const runDir = fromRepoRelativePath(outcomes[0].result.runDir);
    return path.join(runDir, "RESULTS.md");
  }
  return path.join(OUTPUT_ROOT_DIR, `RESULTS-${toRunTimestampSlug()}.md`);
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  await Promise.all(cli.filePaths.map((filePath) => assertFileExists(filePath)));

  await mkdir(OUTPUT_ROOT_DIR, { recursive: true });

  const outcomes = await Promise.all(
    cli.modelIds.map(async (modelId): Promise<AgenticBenchmarkRunOutcome> => {
      try {
        const result = await runAgenticBenchmark({
          filePaths: cli.filePaths,
          modelId,
          useSubagents: cli.useSubagents,
        });
        return {
          modelId,
          useSubagents: cli.useSubagents,
          result,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          modelId,
          useSubagents: cli.useSubagents,
          error: sanitizeLogText(message),
        };
      }
    }),
  );
  const markdown = await renderResultsMarkdown(outcomes);
  const resultsMarkdownPath = resolveResultsMarkdownPath(outcomes);
  await writeFile(resultsMarkdownPath, markdown, "utf8");
  console.log(
    `[handwriting-bench] wrote ${toRepoRelativePath(resultsMarkdownPath)}`,
  );

  const failedCount = outcomes.filter((outcome) => !outcome.result).length;
  if (failedCount > 0) {
    throw new Error(
      `Benchmark finished with ${failedCount.toString()} failed model run(s). See ${toRepoRelativePath(resultsMarkdownPath)}.`,
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[handwriting-bench] error: ${sanitizeLogText(message)}`);
  process.exit(1);
});
