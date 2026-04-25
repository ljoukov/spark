import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { Command } from "commander";
import { z } from "zod";
import { isLlmTextModelId, type LlmTextModelId } from "@ljoukov/llm";
import {
  createRepoPathHelpers,
  formatUsd,
  listFilesRecursive,
  prepareSparkGraderReplayWorkspace,
  buildSparkGraderBrief,
  buildSparkAgentSystemPrompt,
  buildSparkGraderAgentPrompt,
  renderSparkGraderTask,
  SparkGraderRequestPayloadSchema,
  resolveSparkAgentSkillFiles,
  SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
  SPARK_GRADER_SHEET_PATH,
  SPARK_GRADER_SKILL_IDS,
  SPARK_GRADER_SUMMARY_PATH,
  readSparkAgentReplayManifest,
  resolveSparkAgentThinkingLevel,
  runSparkGraderReplayLocal,
  SPARK_AGENT_REPLAY_MANIFEST_PATH,
  summarizeToolLoopResult,
  toModelSlug,
  toRunTimestampSlug,
  toToolLoopEventLogRecords,
  type UsageTotals,
} from "@spark/llm";

import { ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const OUTPUT_ROOT_DIR = path.join(BENCHMARK_DIR, "output");
const DEFAULT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.5-fast";
const { toRepoRelativePath } = createRepoPathHelpers({
  benchmarkDir: BENCHMARK_DIR,
  repoRootDir: REPO_ROOT_DIR,
});

type CliArgs = {
  runPath: string;
  modelId?: string;
  thinking: "auto" | "none" | "low" | "medium" | "high";
  useSubagents?: boolean;
  maxSteps?: number;
  disableExtractTextTool: boolean;
  currentPrompts: boolean;
  freshOutput: boolean;
  outputRootDir: string;
};

type BenchmarkResult = {
  generatedAt: string;
  sourceRunPath: string;
  sourceManifestPath: string;
  sourceMode: "captured-snapshot";
  runDir: string;
  workspaceDir: string;
  promptPath: string;
  systemPromptPath: string;
  eventLogPath: string;
  summaryJsonPath: string;
  agentLogPath: string;
  llmLogsDir: string;
  workspaceFilePaths: string[];
  inlineAttachmentPaths: string[];
  replayInput: {
    modelId: string;
    thinkingLevel: "low" | "medium" | "high" | null;
    useSubagents: boolean;
    maxSteps: number;
    disableExtractTextTool: boolean;
    currentPrompts: boolean;
    freshOutput: boolean;
  };
  sourceDefaults: {
    modelId: string;
    thinkingLevel: "low" | "medium" | "high" | null;
    useSubagents: boolean;
    maxSteps: number;
  };
  agent: {
    modelCalls: number;
    toolCalls: number;
    toolCallsByName: Record<string, number>;
    usage: UsageTotals;
    costUsd: number;
    toolLlmCostUsd: number;
    thoughtsChars: number;
    responseChars: number;
    doneSummary: string | null;
  };
};

function parseCliArgs(args: readonly string[]): CliArgs {
  const command = new Command("bench:spark-agent-replay")
    .description(
      "Replay a captured Spark grader workspace from data/spark-agent/... with model or thinking overrides.",
    )
    .requiredOption(
      "--run-path <path>",
      "path to the persisted Spark agent workspace directory",
    )
    .option("--model-id <modelId>", "override model id for the replay")
    .option(
      "--thinking <mode>",
      "thinking override: auto, none, low, medium, or high",
      "auto",
    )
    .option(
      "--use-subagents [enabled]",
      "enable subagents (true/false, 1/0, yes/no, on/off)",
    )
    .option("--no-use-subagents", "disable subagents")
    .option("--max-steps <count>", "override max tool steps")
    .option(
      "--disable-extract-text",
      "remove the extract_text tool from the replay run",
      false,
    )
    .option(
      "--current-prompts",
      "run with the current Spark grader prompt, task template, and skill files instead of captured prompt text",
      false,
    )
    .option(
      "--fresh-output",
      "delete grader/output before replaying so the run must republish artifacts",
      false,
    )
    .option(
      "--output-root <path>",
      "override benchmark output root",
      OUTPUT_ROOT_DIR,
    );
  command.parse(args, { from: "user" });

  const options = command.opts<{
    runPath?: string;
    modelId?: string;
    thinking?: string;
    useSubagents?: boolean | string;
    maxSteps?: string;
    disableExtractText?: boolean;
    currentPrompts?: boolean;
    freshOutput?: boolean;
    outputRoot?: string;
  }>();

  const parsed = z
    .object({
      runPath: z.string().trim().min(1),
      modelId: z.string().trim().min(1).optional(),
      thinking: z
        .enum(["auto", "none", "low", "medium", "high"])
        .default("auto"),
      maxSteps: z
        .string()
        .trim()
        .min(1)
        .optional()
        .transform((value) => {
          if (value === undefined) {
            return undefined;
          }
          const parsedCount = Number.parseInt(value, 10);
          if (!Number.isInteger(parsedCount) || parsedCount < 1) {
            throw new Error(`Invalid --max-steps value: "${value}"`);
          }
          return parsedCount;
        }),
      disableExtractTextTool: z.boolean().default(false),
      currentPrompts: z.boolean().default(false),
      freshOutput: z.boolean().default(false),
      outputRootDir: z.string().trim().min(1).default(OUTPUT_ROOT_DIR),
    })
    .parse({
      runPath: options.runPath,
      modelId: options.modelId,
      thinking: options.thinking,
      maxSteps: options.maxSteps,
      disableExtractTextTool: options.disableExtractText,
      currentPrompts: options.currentPrompts,
      freshOutput: options.freshOutput,
      outputRootDir: options.outputRoot,
    });

  const parseBooleanFlag = (
    value: boolean | string | undefined,
  ): boolean | undefined => {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === undefined) {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
    throw new Error(
      `Invalid --use-subagents value: "${value}". Use true/false (or 1/0, yes/no, on/off).`,
    );
  };

  return {
    ...parsed,
    useSubagents: parseBooleanFlag(options.useSubagents),
  };
}

function resolveReplayModelId(input: {
  cliModelId?: string;
  sourceModelId: string | null;
}): LlmTextModelId {
  const candidate = input.cliModelId ?? input.sourceModelId ?? DEFAULT_MODEL_ID;
  if (!isLlmTextModelId(candidate)) {
    throw new Error(`Unsupported replay model id: ${candidate}`);
  }
  return candidate;
}

function resolveReplayThinkingLevel(input: {
  cliThinking: CliArgs["thinking"];
  cliModelId?: string;
  chosenModelId: LlmTextModelId;
  sourceModelId: string | null;
  sourceThinkingLevel: "low" | "medium" | "high" | null;
}): "low" | "medium" | "high" | null {
  if (input.cliThinking === "none") {
    return null;
  }
  if (input.cliThinking !== "auto") {
    return input.cliThinking;
  }
  if (!input.cliModelId && input.sourceThinkingLevel) {
    return input.sourceThinkingLevel;
  }
  if (
    input.sourceThinkingLevel &&
    input.sourceModelId === input.chosenModelId
  ) {
    return input.sourceThinkingLevel;
  }
  return resolveSparkAgentThinkingLevel(input.chosenModelId) ?? null;
}

async function materializeCurrentGraderRuntime(options: {
  workspaceDir: string;
}): Promise<{ prompt: string; systemPrompt: string }> {
  const graderTaskTemplate = await readFile(
    path.join(REPO_ROOT_DIR, "web/src/lib/server/graderAgent/task-template.md"),
    { encoding: "utf8" },
  );
  const requestPayload = SparkGraderRequestPayloadSchema.parse(
    JSON.parse(
      await readFile(path.join(options.workspaceDir, "request.json"), {
        encoding: "utf8",
      }),
    ),
  );
  const graderInput = {
    ...requestPayload.input,
    ...(requestPayload.sourcePaperOnlyNoStudent !== undefined
      ? { sourcePaperOnlyNoStudent: requestPayload.sourcePaperOnlyNoStudent }
      : {}),
  };
  const brief = buildSparkGraderBrief({
    sourceText: requestPayload.sourceText ?? undefined,
    input: graderInput,
    attachments: requestPayload.attachments,
  });
  const prompt = buildSparkGraderAgentPrompt({
    summaryPath: SPARK_GRADER_SUMMARY_PATH,
    sheetPath: SPARK_GRADER_SHEET_PATH,
  });
  const systemPrompt = buildSparkAgentSystemPrompt({
    includePdfTranscriptionSkill: true,
  });
  await writeFile(
    path.join(options.workspaceDir, "brief.md"),
    brief,
    { encoding: "utf8" },
  );
  await writeFile(
    path.join(options.workspaceDir, "grader/task.md"),
    renderSparkGraderTask(graderTaskTemplate),
    { encoding: "utf8" },
  );
  for (const skillFile of resolveSparkAgentSkillFiles(SPARK_GRADER_SKILL_IDS)) {
    const targetPath = path.join(options.workspaceDir, skillFile.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, skillFile.content, {
      encoding: "utf8",
    });
  }
  return { prompt, systemPrompt };
}

function resolveSourceRunDir(runPath: string): string {
  if (path.isAbsolute(runPath)) {
    return runPath;
  }
  return path.resolve(REPO_ROOT_DIR, runPath);
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const sourceRunDir = resolveSourceRunDir(cli.runPath);
  const sourceManifest = await readSparkAgentReplayManifest(sourceRunDir);
  if (sourceManifest === null) {
    throw new Error(
      [
        `Replay source must contain ${SPARK_AGENT_REPLAY_MANIFEST_PATH}: ${sourceRunDir}`,
        `Replay source must also contain ${SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR}/.`,
        "Legacy grader fallback replays are no longer supported.",
      ].join("\n"),
    );
  }

  const modelId = resolveReplayModelId({
    cliModelId: cli.modelId,
    sourceModelId: sourceManifest.modelId,
  });
  const thinkingLevel = resolveReplayThinkingLevel({
    cliThinking: cli.thinking,
    cliModelId: cli.modelId,
    chosenModelId: modelId,
    sourceModelId: sourceManifest.modelId,
    sourceThinkingLevel: sourceManifest.thinkingLevel,
  });
  const runDir = path.join(
    path.resolve(process.cwd(), cli.outputRootDir),
    toRunTimestampSlug(),
    toModelSlug(modelId),
  );
  const workspaceDir = path.join(runDir, "workspace");
  await mkdir(runDir, { recursive: true });

  const prepared = await prepareSparkGraderReplayWorkspace({
    sourceRunDir,
    targetWorkspaceDir: workspaceDir,
  });
  if (cli.freshOutput) {
    await rm(path.join(workspaceDir, "grader/output"), {
      recursive: true,
      force: true,
    });
  }
  const runtime = cli.currentPrompts
    ? await materializeCurrentGraderRuntime({ workspaceDir })
    : { prompt: prepared.prompt, systemPrompt: prepared.systemPrompt };
  const promptPath = path.join(runDir, "prompt.txt");
  const systemPromptPath = path.join(runDir, "system-prompt.txt");
  await writeFile(promptPath, runtime.prompt.concat("\n"), {
    encoding: "utf8",
  });
  await writeFile(systemPromptPath, runtime.systemPrompt.concat("\n"), {
    encoding: "utf8",
  });

  const result = await runSparkGraderReplayLocal({
    workspaceDir,
    prompt: runtime.prompt,
    systemPrompt: runtime.systemPrompt,
    modelId,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    maxSteps: cli.maxSteps ?? prepared.sourceMaxSteps,
    useSubagents: cli.useSubagents ?? prepared.sourceUseSubagents,
    disableExtractTextTool: cli.disableExtractTextTool,
  });

  const workspaceFiles = await listFilesRecursive(workspaceDir);
  const toolLoopSummary = summarizeToolLoopResult(result.toolLoopResult);
  const eventLogPath = path.join(runDir, "event-log.json");
  const summaryJsonPath = path.join(runDir, "summary.json");
  await writeFile(
    eventLogPath,
    JSON.stringify(
      toToolLoopEventLogRecords(result.toolLoopResult),
      null,
      2,
    ).concat("\n"),
    { encoding: "utf8" },
  );

  const benchmarkResult: BenchmarkResult = {
    generatedAt: new Date().toISOString(),
    sourceRunPath: toRepoRelativePath(sourceRunDir),
    sourceManifestPath: toRepoRelativePath(
      path.join(sourceRunDir, SPARK_AGENT_REPLAY_MANIFEST_PATH),
    ),
    sourceMode: prepared.sourceMode,
    runDir: toRepoRelativePath(runDir),
    workspaceDir: toRepoRelativePath(workspaceDir),
    promptPath: toRepoRelativePath(promptPath),
    systemPromptPath: toRepoRelativePath(systemPromptPath),
    eventLogPath: toRepoRelativePath(eventLogPath),
    summaryJsonPath: toRepoRelativePath(summaryJsonPath),
    agentLogPath: toRepoRelativePath(result.agentLogPath),
    llmLogsDir: toRepoRelativePath(result.llmLogsDir),
    workspaceFilePaths: workspaceFiles.map((filePath) =>
      toRepoRelativePath(filePath),
    ),
    inlineAttachmentPaths: result.usedInlineAttachmentPaths,
    replayInput: {
      modelId,
      thinkingLevel,
      useSubagents: result.useSubagents,
      maxSteps: result.maxSteps,
      disableExtractTextTool: result.disableExtractTextTool,
      currentPrompts: cli.currentPrompts,
      freshOutput: cli.freshOutput,
    },
    sourceDefaults: {
      modelId: prepared.sourceModelId,
      thinkingLevel: prepared.sourceThinkingLevel,
      useSubagents: prepared.sourceUseSubagents,
      maxSteps: prepared.sourceMaxSteps,
    },
    agent: {
      modelCalls: toolLoopSummary.modelCalls,
      toolCalls: toolLoopSummary.toolCalls,
      toolCallsByName: toolLoopSummary.toolCallsByName,
      usage: toolLoopSummary.usageTotals,
      costUsd: toolLoopSummary.agentCostUsd,
      toolLlmCostUsd: toolLoopSummary.toolLlmCostUsd,
      thoughtsChars: toolLoopSummary.thoughtsChars,
      responseChars: toolLoopSummary.responseChars,
      doneSummary: result.doneSummary ?? toolLoopSummary.doneSummary,
    },
  };

  await writeFile(
    summaryJsonPath,
    JSON.stringify(benchmarkResult, null, 2).concat("\n"),
    {
      encoding: "utf8",
    },
  );

  const lines = [
    `Spark grader replay complete: ${benchmarkResult.runDir}`,
    `- Source run: ${benchmarkResult.sourceRunPath} (${benchmarkResult.sourceMode})`,
    `- Model: ${modelId}`,
    `- Thinking: ${thinkingLevel ?? "none"}`,
    `- Subagents: ${result.useSubagents ? "on" : "off"}`,
    `- Max steps: ${result.maxSteps.toString()}`,
    `- Extract text: ${result.disableExtractTextTool ? "off" : "on"}`,
    `- Current prompts: ${cli.currentPrompts ? "on" : "off"}`,
    `- Fresh output: ${cli.freshOutput ? "on" : "off"}`,
    `- Model calls: ${toolLoopSummary.modelCalls.toString()}`,
    `- Tool calls: ${toolLoopSummary.toolCalls.toString()}`,
    `- Agent cost: ${formatUsd(toolLoopSummary.agentCostUsd)}`,
    `- Tool LLM cost: ${formatUsd(toolLoopSummary.toolLlmCostUsd)}`,
    `- Summary JSON: ${benchmarkResult.summaryJsonPath}`,
    `- Agent log: ${benchmarkResult.agentLogPath}`,
  ];
  if (benchmarkResult.agent.doneSummary) {
    lines.push(`- Done summary: ${benchmarkResult.agent.doneSummary}`);
  }
  lines.push(`- Workspace files: ${workspaceFiles.length.toString()}`);
  console.log(lines.join("\n"));
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
