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
const DEFAULT_HANDWRITING_IMAGE_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "clipboard-1.png",
);
const DEFAULT_PROBLEMS_IMAGE_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "hamilton2017-h1-h2.jpg",
);
const DEFAULT_SOLUTIONS_P1_IMAGE_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "hamilton-2017-solutions-p1.jpg",
);
const DEFAULT_SOLUTIONS_P2_IMAGE_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "hamilton-2017-solutions-p2.jpg",
);
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
  handwritingImagePath: string;
  problemsImagePath: string;
  solutionsP1ImagePath: string;
  solutionsP2ImagePath: string;
  outputDir: string;
  outputV1Path: string;
  outputV2Path: string;
  outputV3Path: string;
  outputNotesPath: string;
  agentLogPath: string;
  agentMainLogPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
};

type CliArgs = {
  handwritingImagePath: string;
  problemsImagePath: string;
  solutionsP1ImagePath: string;
  solutionsP2ImagePath: string;
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
  handwritingImagePath: string;
  problemsImagePath: string;
  solutionsP1ImagePath: string;
  solutionsP2ImagePath: string;
  transcriptionV1Path: string;
  transcriptionV2Path: string;
  transcriptionV3Path: string;
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
    costUsd: number;
    usage: UsageTotals;
    thoughtsChars: number;
    responseChars: number;
    doneSummary: string | null;
  };
  total: {
    latencyMs: number;
    costUsd: number;
  };
};

type AgenticBenchmarkRunOutcome = {
  modelId: LlmTextModelId;
  useSubagents: boolean;
  result?: AgenticBenchmarkResult;
  error?: string;
};

function parseCliArgs(args: readonly string[]): CliArgs {
  const raw: {
    handwritingImagePath?: string;
    problemsImagePath?: string;
    solutionsP1ImagePath?: string;
    solutionsP2ImagePath?: string;
    modelId?: string;
    models?: string;
    useSubagents?: string;
  } = {};
  for (const arg of args) {
    if (arg.startsWith("--handwriting-image=")) {
      raw.handwritingImagePath = arg.slice("--handwriting-image=".length).trim();
      continue;
    }
    if (arg.startsWith("--problems-image=")) {
      raw.problemsImagePath = arg.slice("--problems-image=".length).trim();
      continue;
    }
    if (arg.startsWith("--solutions-p1-image=")) {
      raw.solutionsP1ImagePath = arg.slice("--solutions-p1-image=".length).trim();
      continue;
    }
    if (arg.startsWith("--solutions-p2-image=")) {
      raw.solutionsP2ImagePath = arg.slice("--solutions-p2-image=".length).trim();
      continue;
    }
    if (arg.startsWith("--model-id=")) {
      raw.modelId = arg.slice("--model-id=".length).trim();
      continue;
    }
    if (arg.startsWith("--models=")) {
      raw.models = arg.slice("--models=".length).trim();
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
      handwritingImagePath: z.string().trim().min(1).default(DEFAULT_HANDWRITING_IMAGE_PATH),
      problemsImagePath: z.string().trim().min(1).default(DEFAULT_PROBLEMS_IMAGE_PATH),
      solutionsP1ImagePath: z.string().trim().min(1).default(DEFAULT_SOLUTIONS_P1_IMAGE_PATH),
      solutionsP2ImagePath: z.string().trim().min(1).default(DEFAULT_SOLUTIONS_P2_IMAGE_PATH),
      modelId: z.string().trim().min(1).optional(),
      models: z.string().trim().min(1).optional(),
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
  if (modelIds.length === 0) {
    modelIds.push(DEFAULT_AGENT_MODEL_ID);
  }

  const dedupedModelIds = Array.from(new Set(modelIds));
  return {
    handwritingImagePath: parsed.handwritingImagePath,
    problemsImagePath: parsed.problemsImagePath,
    solutionsP1ImagePath: parsed.solutionsP1ImagePath,
    solutionsP2ImagePath: parsed.solutionsP2ImagePath,
    modelIds: dedupedModelIds,
    useSubagents: parseBooleanFlag(parsed.useSubagents, false, "--use-subagents"),
  };
}

async function buildPathConfig(options: {
  handwritingImagePath: string;
  problemsImagePath: string;
  solutionsP1ImagePath: string;
  solutionsP2ImagePath: string;
  modelId: string;
}): Promise<AgentPathConfig> {
  const modelSlug = toModelSlug(options.modelId);
  const runId = `${toRunTimestampSlug()}-${randomUUID().slice(0, 8)}`;
  const runRootDir = path.join(OUTPUT_ROOT_DIR, modelSlug, runId);
  const workspaceDir = path.join(runRootDir, "workspace");
  const taskPath = path.join(workspaceDir, "TASK.md");
  const sourceDir = path.join(workspaceDir, "source");
  const handwritingImagePath = path.join(sourceDir, "clipboard-1.png");
  const problemsImagePath = path.join(sourceDir, "hamilton2017-h1-h2.jpg");
  const solutionsP1ImagePath = path.join(sourceDir, "hamilton-2017-solutions-p1.jpg");
  const solutionsP2ImagePath = path.join(sourceDir, "hamilton-2017-solutions-p2.jpg");
  const outputDir = path.join(workspaceDir, "output");
  const outputV1Path = path.join(outputDir, "transcription_v1.md");
  const outputV2Path = path.join(outputDir, "transcription_v2.md");
  const outputV3Path = path.join(outputDir, "transcription_v3.md");
  const outputNotesPath = path.join(outputDir, "agent-notes.md");
  const agentLogPath = path.join(runRootDir, "agent.log");
  const agentMainLogPath = path.join(runRootDir, "agent_main.log");
  const eventLogPath = path.join(runRootDir, "agent-log.jsonl");
  const summaryJsonPath = path.join(runRootDir, "summary.json");

  await rm(runRootDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await copyFile(options.handwritingImagePath, handwritingImagePath);
  await copyFile(options.problemsImagePath, problemsImagePath);
  await copyFile(options.solutionsP1ImagePath, solutionsP1ImagePath);
  await copyFile(options.solutionsP2ImagePath, solutionsP2ImagePath);
  await writeFile(taskPath, `${createAgentTaskDescription()}\n`, "utf8");

  return {
    runRootDir,
    workspaceDir,
    taskPath,
    sourceDir,
    handwritingImagePath,
    problemsImagePath,
    solutionsP1ImagePath,
    solutionsP2ImagePath,
    outputDir,
    outputV1Path,
    outputV2Path,
    outputV3Path,
    outputNotesPath,
    agentLogPath,
    agentMainLogPath,
    eventLogPath,
    summaryJsonPath,
  };
}

function createAgentTaskDescription(): string {
  return [
    "# Task",
    "Transcribe the student handwriting from source/clipboard-1.png.",
    "",
    "## Required Inputs",
    "- Handwriting: `source/clipboard-1.png`",
    "- Problem context: `source/hamilton2017-h1-h2.jpg`",
    "- Official solutions: `source/hamilton-2017-solutions-p1.jpg` and `source/hamilton-2017-solutions-p2.jpg`",
    "",
    "## Required Outputs",
    "- First pass: `output/transcription_v1.md`",
    "- Second pass: `output/transcription_v2.md`",
    "- Final pass: `output/transcription_v3.md`",
    "- Ambiguity notes: `output/agent-notes.md`",
    "",
    "## Required Benchmark Workflow",
    "1. For first-pass output, call `extract_text` with:",
    "   - `documentPaths: [source/clipboard-1.png]`",
    "   - `supportingPaths: [source/hamilton2017-h1-h2.jpg]`",
    "   - `outputPath: output/transcription_v1.md`",
    "   - Call `extract_text` exactly once for v1. Do not repeat the same `documentPaths` + `outputPath` call.",
    "   - After that single call, use `read_file output/transcription_v1.md` and edit from that text instead of rerunning extraction.",
    "   - DO NOT call `extract_text` with only `outputPath`; include `documentPaths` explicitly on every call.",
    "   - `instructions` that explicitly states: the primary goal is handwriting transcription from the primary document(s), and this call is for student work rather than problem statements.",
    "   - `supportingInstructions` that explicitly states: supporting documents are context only for ambiguity resolution and should not be transcribed.",
    "   - Optional for multi-page inputs: request explicit page markers in the output markdown.",
    "   - Important: `extract_text` does not inherently know filenames/paths of attached files; include any identifying file-role details explicitly inside instruction text.",
    "   - Example payload:",
    "     `{ \"documentPaths\": [\"<primary-document-1>\", \"<primary-document-2>\"], \"outputPath\": \"<first-pass-output-path>\", \"instructions\": \"Primary goal: transcribe student handwriting from the primary document(s).\", \"supportingPaths\": [\"<context-document-1>\"], \"supportingInstructions\": \"Use supporting document(s) only for disambiguation, not as transcription targets.\" }`",
    "2. Then verify/correct using visual evidence:",
    "   - `view_image source/clipboard-1.png`",
    "   - `view_image source/hamilton2017-h1-h2.jpg`",
    "   - `read_file output/transcription_v1.md`",
    "   - do not rerun `extract_text` for this stage unless the source document set changes.",
    "   - do one cleanup pass only and write corrected second pass to `output/transcription_v2.md`.",
    "   - avoid crop/grid refinement loops; if a token is still uncertain, mark `[?]` instead of repeated inspections.",
    "3. View `source/hamilton-2017-solutions-p1.jpg` and `source/hamilton-2017-solutions-p2.jpg`, resolve remaining ambiguities, and write `output/transcription_v3.md`.",
    "4. Before finalizing v3, run a focused literal audit on likely risk lines in this benchmark: header start/end times and the first Pythagoras/equality line in Q1; correct v3 if needed.",
    "5. Write ambiguity decisions to `output/agent-notes.md`.",
    "",
    "## Workflow Skill",
    "Use this workflow skill for general transcription behavior:",
    "",
    "~~~markdown",
    HANDWRITING_TRANSCRIPTION_SKILL_TEXT,
    "~~~",
    "",
    "Reminder: keep the flow lightweight (single extract + single verification/cleanup pass) and avoid crop/grid loops unless explicitly required.",
    "",
    "When complete, call `done` with a concise summary of ambiguity decisions.",
  ].join("\n");
}

function createAgentPrompt(): string {
  return [
    "Read 'TASK.md' from the workspace root.",
    "Follow it exactly.",
  ].join("\n");
}

async function runAgenticBenchmark(options: {
  handwritingImagePath: string;
  problemsImagePath: string;
  solutionsP1ImagePath: string;
  solutionsP2ImagePath: string;
  modelId: LlmTextModelId;
  useSubagents: boolean;
}): Promise<AgenticBenchmarkResult> {
  const paths = await buildPathConfig({
    handwritingImagePath: options.handwritingImagePath,
    problemsImagePath: options.problemsImagePath,
    solutionsP1ImagePath: options.solutionsP1ImagePath,
    solutionsP2ImagePath: options.solutionsP2ImagePath,
    modelId: options.modelId,
  });
  const logLines: string[] = [];
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
    benchLabel: "handwriting-bench",
    runRootDir: paths.runRootDir,
    agentLogPath: paths.agentLogPath,
    useSubagents: options.useSubagents,
    ...(options.useSubagents ? { agentMainLogPath: paths.agentMainLogPath } : {}),
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
      `exposed tools: ${Object.keys(selectedTools).sort((a, b) => a.localeCompare(b)).join(", ")}`,
    );
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

    const afterLoop = logger.snapshot();
    const agentLatencyMs = Date.now() - startedAt;
    logger.logLine(
      `agent_loop_done: steps=${toolLoopResult.steps.length.toString()} latency=${formatMs(agentLatencyMs)} cost=${formatUsd(afterLoop.usageCostUsd)}`,
    );

    logger.logStage("start", "collect-agent-outputs");
    const workspaceFiles = await listFilesRecursive(paths.workspaceDir);
    const [v1, v2, v3, notes] = await Promise.all([
      readFile(paths.outputV1Path, "utf8"),
      readFile(paths.outputV2Path, "utf8"),
      readFile(paths.outputV3Path, "utf8"),
      readFile(paths.outputNotesPath, "utf8"),
    ]);
    for (const [label, content] of [
      ["v1", v1],
      ["v2", v2],
      ["v3", v3],
      ["notes", notes],
    ] as const) {
      if (content.trim().length === 0) {
        throw new Error(`Missing required output content in ${label}.`);
      }
    }
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
        `outputs_collected: workspaceFiles=${workspaceFiles.length.toString()}`,
        `v1Chars=${v1.length.toString()}`,
        `v2Chars=${v2.length.toString()}`,
        `v3Chars=${v3.length.toString()}`,
        `notesChars=${notes.length.toString()}`,
        `inspectionImages=${inspectionImagePaths.length.toString()}`,
      ].join(" "),
    );
    logger.logStage("done", "collect-agent-outputs");

    const overallPass = true;
    const reason = "Agent run completed and produced all required outputs.";

    const finalSnapshot = logger.snapshot();
    const agentCostUsd = finalSnapshot.usageCostUsd;
    const toolCallCount = Object.values(finalSnapshot.toolCallsByName).reduce(
      (sum, count) => sum + count,
      0,
    );
    const totalLatencyMs = agentLatencyMs;
    const totalCostUsd = agentCostUsd;

    logLines.push(
      `model=${options.modelId} maxSteps=${MAX_STEPS.toString()} useSubagents=${options.useSubagents ? "true" : "false"}`,
    );
    logLines.push(
      `agent_latency=${formatMs(agentLatencyMs)} agent_cost=${formatUsd(agentCostUsd)}`,
    );
    logLines.push(`tool_calls=${toolCallCount.toString()}`);
    logLines.push(`workspace_files=${workspaceFiles.length.toString()}`);
    logLines.push(`agent_log=${toRepoRelativePath(paths.agentLogPath)}`);
    if (options.useSubagents) {
      logLines.push(`agent_main_log=${toRepoRelativePath(paths.agentMainLogPath)}`);
      const subagentLogs = finalSnapshot.splitLogPathsCreated
        .filter((item) => path.basename(item) !== path.basename(paths.agentMainLogPath))
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
      handwritingImagePath: toRepoRelativePath(paths.handwritingImagePath),
      problemsImagePath: toRepoRelativePath(paths.problemsImagePath),
      solutionsP1ImagePath: toRepoRelativePath(paths.solutionsP1ImagePath),
      solutionsP2ImagePath: toRepoRelativePath(paths.solutionsP2ImagePath),
      transcriptionV1Path: toRepoRelativePath(paths.outputV1Path),
      transcriptionV2Path: toRepoRelativePath(paths.outputV2Path),
      transcriptionV3Path: toRepoRelativePath(paths.outputV3Path),
      notesPath: toRepoRelativePath(paths.outputNotesPath),
      inspectionImagePaths: inspectionImagePaths.map((item) => toRepoRelativePath(item)),
      agentLogPath: toRepoRelativePath(paths.agentLogPath),
      eventLogPath: toRepoRelativePath(paths.eventLogPath),
      summaryJsonPath: toRepoRelativePath(paths.summaryJsonPath),
      agent: {
        latencyMs: agentLatencyMs,
        modelCalls: toolLoopResult.steps.length,
        toolCalls: toolCallCount,
        toolCallsByName: finalSnapshot.toolCallsByName,
        costUsd: agentCostUsd,
        usage: finalSnapshot.usageTotals,
        thoughtsChars: finalSnapshot.thoughtChars,
        responseChars: finalSnapshot.responseChars,
        doneSummary: finalSnapshot.doneSummary,
      },
      total: {
        latencyMs: totalLatencyMs,
        costUsd: totalCostUsd,
      },
    };

    await writeFile(paths.summaryJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(path.join(paths.runRootDir, "run.log"), `${logLines.join("\n")}\n`, "utf8");
    logger.logStage("done", "write-artifacts");
    logger.logLine(
      `done: status=${result.status} totalLatency=${formatMs(result.total.latencyMs)} totalCost=${formatUsd(result.total.costUsd)} runDir=${result.runDir}`,
    );

    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.logLine(`error: ${sanitizeLogText(message)}`);
    throw error;
  }
}

async function renderSingleResultsMarkdown(result: AgenticBenchmarkResult): Promise<string> {
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
  lines.push(`- Handwriting image: ${result.handwritingImagePath}`);
  lines.push(`- Problem context image: ${result.problemsImagePath}`);
  lines.push(`- Solutions image p1: ${result.solutionsP1ImagePath}`);
  lines.push(`- Solutions image p2: ${result.solutionsP2ImagePath}`);
  lines.push(`- Transcription v1: ${result.transcriptionV1Path}`);
  lines.push(`- Transcription v2: ${result.transcriptionV2Path}`);
  lines.push(`- Transcription v3: ${result.transcriptionV3Path}`);
  lines.push(`- Agent notes: ${result.notesPath}`);
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
    ["Transcription v1", result.transcriptionV1Path],
    ["Transcription v2", result.transcriptionV2Path],
    ["Transcription v3", result.transcriptionV3Path],
    ["Agent Notes", result.notesPath],
  ] as const) {
    lines.push(`## ${label}`);
    lines.push("");
    const text = await readFile(fromRepoRelativePath(resultPath), "utf8").catch(() => "");
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
  const ordered = [...outcomes].sort((a, b) => a.modelId.localeCompare(b.modelId));
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
      const bodyStart = singleLines.findIndex((line) => line.startsWith("## Paths"));
      if (bodyStart >= 0) {
        lines.push(...singleLines.slice(bodyStart));
      } else {
        lines.push(...singleLines);
      }
    } else {
      lines.push(`- Subagents: ${outcome.useSubagents ? "ENABLED" : "DISABLED"}`);
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

function resolveResultsMarkdownPath(outcomes: readonly AgenticBenchmarkRunOutcome[]): string {
  if (outcomes.length === 1 && outcomes[0]?.result) {
    const runDir = fromRepoRelativePath(outcomes[0].result.runDir);
    return path.join(runDir, "RESULTS.md");
  }
  return path.join(OUTPUT_ROOT_DIR, `RESULTS-${toRunTimestampSlug()}.md`);
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  await Promise.all([
    assertFileExists(cli.handwritingImagePath),
    assertFileExists(cli.problemsImagePath),
    assertFileExists(cli.solutionsP1ImagePath),
    assertFileExists(cli.solutionsP2ImagePath),
  ]);

  await mkdir(OUTPUT_ROOT_DIR, { recursive: true });

  const outcomes = await Promise.all(
    cli.modelIds.map(async (modelId): Promise<AgenticBenchmarkRunOutcome> => {
      try {
        const result = await runAgenticBenchmark({
          handwritingImagePath: cli.handwritingImagePath,
          problemsImagePath: cli.problemsImagePath,
          solutionsP1ImagePath: cli.solutionsP1ImagePath,
          solutionsP2ImagePath: cli.solutionsP2ImagePath,
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
  console.log(`[handwriting-bench] wrote ${toRepoRelativePath(resultsMarkdownPath)}`);

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
