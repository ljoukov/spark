import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

import { Command } from "commander";
import { z } from "zod";
import { isLlmTextModelId, type LlmTextModelId } from "@ljoukov/llm";
import {
  createRepoPathHelpers,
  formatUsd,
  listFilesRecursive,
  prepareSparkGraderReplayWorkspace,
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
const DEFAULT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.4";
const DEFAULT_MAX_STEPS = 200;
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
  outputRootDir: string;
};

type BenchmarkResult = {
  generatedAt: string;
  sourceRunPath: string;
  sourceManifestPath: string | null;
  sourceMode: "captured-snapshot" | "grader-fallback";
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
  };
  sourceDefaults: {
    modelId: string | null;
    thinkingLevel: "low" | "medium" | "high" | null;
    useSubagents: boolean | null;
    maxSteps: number | null;
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
      "Replay a Spark grader workspace from data/spark-agent/... with model or thinking overrides.",
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
      outputRootDir: z.string().trim().min(1).default(OUTPUT_ROOT_DIR),
    })
    .parse({
      runPath: options.runPath,
      modelId: options.modelId,
      thinking: options.thinking,
      maxSteps: options.maxSteps,
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

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const sourceRunDir = path.resolve(process.cwd(), cli.runPath);
  const sourceManifest = await readSparkAgentReplayManifest(sourceRunDir);

  const modelId = resolveReplayModelId({
    cliModelId: cli.modelId,
    sourceModelId: sourceManifest?.modelId ?? null,
  });
  const thinkingLevel = resolveReplayThinkingLevel({
    cliThinking: cli.thinking,
    cliModelId: cli.modelId,
    chosenModelId: modelId,
    sourceModelId: sourceManifest?.modelId ?? null,
    sourceThinkingLevel: sourceManifest?.thinkingLevel ?? null,
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
  const promptPath = path.join(runDir, "prompt.txt");
  const systemPromptPath = path.join(runDir, "system-prompt.txt");
  await writeFile(promptPath, prepared.prompt.concat("\n"), {
    encoding: "utf8",
  });
  await writeFile(systemPromptPath, prepared.systemPrompt.concat("\n"), {
    encoding: "utf8",
  });

  const result = await runSparkGraderReplayLocal({
    workspaceDir,
    prompt: prepared.prompt,
    systemPrompt: prepared.systemPrompt,
    modelId,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    maxSteps: cli.maxSteps ?? prepared.sourceMaxSteps ?? DEFAULT_MAX_STEPS,
    useSubagents: cli.useSubagents ?? prepared.sourceUseSubagents ?? true,
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
    sourceManifestPath:
      prepared.manifest !== null
        ? toRepoRelativePath(
            path.join(sourceRunDir, SPARK_AGENT_REPLAY_MANIFEST_PATH),
          )
        : null,
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

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
