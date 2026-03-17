import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import { Command } from "commander";
import { z } from "zod";
import {
  createToolLoopSteeringChannel as createAgentLoopSteeringChannel,
  isLlmTextModelId,
  parseJsonFromLlmText,
  runAgentLoop,
  tool,
  type LlmContentPart,
  type LlmTextModelId,
  type LlmToolSet,
} from "@ljoukov/llm";

import {
  buildSparkAgentFilesystemToolConfig,
  buildSparkAgentTools,
} from "@spark/llm/agent/sparkAgentRunner";
import {
  applyPdfTranscriptionSkillTools,
  PDF_TRANSCRIPTION_SKILL_TEXT,
} from "@spark/llm/agent/skills/pdfTranscription";
import {
  assertFileExists,
  createRepoPathHelpers,
  formatMs,
  formatUsd,
  generateTextWithMetrics,
  listFilesRecursive,
  summarizeToolLoopResult,
  toToolLoopEventLogRecords,
  toInlineImageParts,
  toModelSlug,
  toRunTimestampSlug,
  type ModelCallMetrics,
  type UsageTotals,
} from "@spark/llm/agent/benchmarks/agenticBenchmark";

import { ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const BENCHMARK_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DIR = path.resolve(BENCHMARK_DIR, "../../../..");
const { toRepoRelativePath, fromRepoRelativePath, sanitizeLogText } =
  createRepoPathHelpers({
    benchmarkDir: BENCHMARK_DIR,
    repoRootDir: REPO_ROOT_DIR,
  });
const DEFAULT_SOURCE_PDF_PATH = path.join(
  BENCHMARK_DIR,
  "data",
  "hamilton-2017-q.pdf",
);
const OUTPUT_ROOT_DIR = path.join(BENCHMARK_DIR, "output");
const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.4";
const JUDGE_MODEL_IDS = [
  "gemini-2.5-pro",
  "chatgpt-gpt-5.3-codex",
] as const satisfies readonly [LlmTextModelId, LlmTextModelId];
const MAX_STEPS = 200;
const TARGET_PROBLEM_IDS = ["H1", "H2", "H3"] as const;
const REQUIRED_CUSTOM_TOOL_NAMES = [
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
  outputReferenceTextPath: string;
  agentLogPath: string;
  llmLogsDir: string;
  eventLogPath: string;
  summaryJsonPath: string;
};

type CliArgs = {
  sourcePdfPath: string;
  modelIds: LlmTextModelId[];
  useSubagents: boolean;
  useReferenceText: boolean;
};

type JudgeVerdict = {
  modelId: LlmTextModelId;
  verdict: "pass" | "fail";
  summary: string;
  issues: string[];
  metrics: ModelCallMetrics;
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
  referenceTextPath?: string;
  agentLogPath: string;
  llmLogsDir: string;
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

type AgenticBenchmarkRunOutcome = {
  modelId: LlmTextModelId;
  useSubagents: boolean;
  useReferenceText: boolean;
  result?: AgenticBenchmarkResult;
  error?: string;
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

const Bbox1000Schema = z.object({
  left: z.number().int().min(0).max(1000),
  top: z.number().int().min(0).max(1000),
  right: z.number().int().min(0).max(1000),
  bottom: z.number().int().min(0).max(1000),
});

const AgentDiagramEntrySchema = z.object({
  problemId: z.string().trim().min(1),
  page: z.number().int().min(1),
  sourceImagePath: z.string().trim().min(1).optional(),
  cropPath: z.string().trim().min(1).optional(),
  bbox1000: Bbox1000Schema.optional(),
  status: z.enum(["ok", "imperfect", "failed"]).default("ok"),
  failureReason: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).optional(),
});

const AgentProblemDiagramAttemptSchema = z.object({
  cropPath: z.string().trim().min(1).optional(),
  trimmedPath: z.string().trim().min(1).optional(),
  result: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
});

const AgentProblemDiagramSchema = z.object({
  status: z.string().trim().min(1).optional(),
  finalPath: z.string().trim().min(1).optional(),
  sourcePage: z.string().trim().min(1).optional(),
  bbox1000: Bbox1000Schema.optional(),
  attempts: z.array(AgentProblemDiagramAttemptSchema).optional(),
  failureReason: z.string().trim().min(1).optional(),
});

function normaliseProblemDiagramStatus(input: {
  rawStatus: string | undefined;
  hasCropPath: boolean;
}): "ok" | "imperfect" | "failed" {
  const normalised = input.rawStatus?.trim().toLowerCase();
  if (normalised === "ok" || normalised === "success" || normalised === "accepted") {
    return "ok";
  }
  if (normalised === "failed" || normalised === "failure" || normalised === "error") {
    return "failed";
  }
  if (!input.hasCropPath) {
    return "failed";
  }
  return "imperfect";
}

const AgentDiagramManifestSchema = z.object({
  diagrams: z.array(AgentDiagramEntrySchema).min(1),
  globalNotes: z.string().trim().min(1).optional(),
});

const AgentDiagramManifestListSchema = z.array(AgentDiagramEntrySchema).min(1);

const AgentProblemManifestInputSchema = z.object({
  problems: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        page: z.number().int().min(1).optional(),
        diagram: AgentProblemDiagramSchema.optional(),
      }),
    )
    .min(1),
  globalNotes: z.string().trim().min(1).optional(),
});

function normaliseProblemManifest(
  manifest: z.infer<typeof AgentProblemManifestInputSchema>,
): z.infer<typeof AgentDiagramManifestSchema> {
  const diagrams = manifest.problems.map((problem) => {
    const attempts = problem.diagram?.attempts ?? [];

    let fallbackCropPath: string | undefined;
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const attempt = attempts[index];
      if (typeof attempt.trimmedPath === "string" && attempt.trimmedPath.length > 0) {
        fallbackCropPath = attempt.trimmedPath;
        break;
      }
      if (typeof attempt.cropPath === "string" && attempt.cropPath.length > 0) {
        fallbackCropPath = attempt.cropPath;
        break;
      }
    }

    const cropPath =
      typeof problem.diagram?.finalPath === "string" && problem.diagram.finalPath.length > 0
        ? problem.diagram.finalPath
        : fallbackCropPath;

    let attemptReason: string | undefined;
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const attempt = attempts[index];
      if (typeof attempt.reason === "string" && attempt.reason.length > 0) {
        attemptReason = attempt.reason;
        break;
      }
    }

    const failureReason =
      typeof problem.diagram?.failureReason === "string" && problem.diagram.failureReason.length > 0
        ? problem.diagram.failureReason
        : attemptReason;
    const status = normaliseProblemDiagramStatus({
      rawStatus: problem.diagram?.status,
      hasCropPath: typeof cropPath === "string" && cropPath.length > 0,
    });

    return {
      problemId: problem.id,
      page: problem.page ?? 1,
      ...(typeof problem.diagram?.sourcePage === "string" && problem.diagram.sourcePage.length > 0
        ? { sourceImagePath: problem.diagram.sourcePage }
        : {}),
      ...(typeof cropPath === "string" && cropPath.length > 0 ? { cropPath } : {}),
      ...(problem.diagram?.bbox1000 ? { bbox1000: problem.diagram.bbox1000 } : {}),
      status,
      ...(status === "failed"
        ? { failureReason: failureReason ?? "Missing diagram crop output in manifest." }
        : {}),
      ...(status !== "failed" && typeof failureReason === "string" && failureReason.length > 0
        ? { notes: failureReason }
        : {}),
    };
  });

  return AgentDiagramManifestSchema.parse({
    diagrams,
    ...(typeof manifest.globalNotes === "string" ? { globalNotes: manifest.globalNotes } : {}),
  });
}

function parseAgentDiagramManifest(input: unknown): z.infer<typeof AgentDiagramManifestSchema> {
  const asObject = AgentDiagramManifestSchema.safeParse(input);
  if (asObject.success) {
    return asObject.data;
  }

  const asList = AgentDiagramManifestListSchema.safeParse(input);
  if (asList.success) {
    return { diagrams: asList.data };
  }

  const asProblemManifest = AgentProblemManifestInputSchema.safeParse(input);
  if (asProblemManifest.success) {
    return normaliseProblemManifest(asProblemManifest.data);
  }

  throw asObject.error;
}

function parseCliArgs(args: readonly string[]): CliArgs {
  const command = new Command("bench:pdf-transcription-agentic")
    .description("Run PDF transcription agentic benchmark.")
    .option("--source-pdf <path>", "source PDF path", DEFAULT_SOURCE_PDF_PATH)
    .option("--model-id <modelId>", "single model id")
    .option("--model <modelId>", "alias for --model-id")
    .option("--models <modelIds>", "comma-separated model ids")
    .option(
      "--use-subagents [enabled]",
      "enable subagents (true/false, 1/0, yes/no, on/off)",
    )
    .option("--no-use-subagents", "disable subagents")
    .option(
      "--use-reference-text [enabled]",
      "enable read_pdf_reference_text tool (true/false, 1/0, yes/no, on/off)",
    )
    .option("--no-use-reference-text", "disable read_pdf_reference_text tool")
    .option("--enable-reference-text", "alias for --use-reference-text")
    .option("--disable-reference-text", "alias for --no-use-reference-text")
    .option("--reference-text [enabled]", "alias for --use-reference-text");
  command.parse(args, { from: "user" });

  const options = command.opts<{
    sourcePdf: string;
    modelId?: string;
    model?: string;
    models?: string;
    useSubagents?: string | boolean;
    useReferenceText?: string | boolean;
    enableReferenceText?: boolean;
    disableReferenceText?: boolean;
    referenceText?: string | boolean;
  }>();

  const useSubagentsRaw =
    typeof options.useSubagents === "boolean"
      ? options.useSubagents
        ? "true"
        : "false"
      : options.useSubagents;

  const useReferenceTextRaw = (() => {
    if (typeof options.referenceText === "boolean") {
      return options.referenceText ? "true" : "false";
    }
    if (typeof options.referenceText === "string") {
      return options.referenceText;
    }
    if (options.enableReferenceText === true) {
      return "true";
    }
    if (options.disableReferenceText === true) {
      return "false";
    }
    if (typeof options.useReferenceText === "boolean") {
      return options.useReferenceText ? "true" : "false";
    }
    return options.useReferenceText;
  })();

  const parsed = z
    .object({
      sourcePdfPath: z.string().trim().min(1),
      modelId: z.string().trim().min(1).optional(),
      modelAlias: z.string().trim().min(1).optional(),
      models: z.string().trim().min(1).optional(),
      useSubagents: z.string().trim().min(1).optional(),
      useReferenceText: z.string().trim().min(1).optional(),
    })
    .parse({
      sourcePdfPath: options.sourcePdf,
      modelId: options.modelId,
      modelAlias: options.model,
      models: options.models,
      useSubagents: useSubagentsRaw,
      useReferenceText: useReferenceTextRaw,
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
    const corrected = trimmed.replaceAll("-gtp-", "-gpt-");
    if (!isLlmTextModelId(corrected)) {
      throw new Error(`Unsupported model id: ${corrected}`);
    }
    return corrected;
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
  return {
    sourcePdfPath: parsed.sourcePdfPath,
    modelIds: dedupedModelIds,
    useSubagents: parseBooleanFlag(parsed.useSubagents, false, "--use-subagents"),
    useReferenceText: parseBooleanFlag(parsed.useReferenceText, true, "--use-reference-text"),
  };
}

function resolveManifestImagePath(options: {
  workspaceDir: string;
  manifestDir: string;
  rawPath: string;
  workspaceFileSet: ReadonlySet<string>;
}): string | null {
  const normalisedPath = options.rawPath.replaceAll("\\", "/");
  const candidates = Array.from(
    new Set([
      path.resolve(options.workspaceDir, normalisedPath),
      path.resolve(options.manifestDir, normalisedPath),
    ]),
  );
  for (const candidatePath of candidates) {
    if (options.workspaceFileSet.has(candidatePath)) {
      return candidatePath;
    }
  }
  return null;
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
        "Validate transcription fidelity and diagram crop quality for Hamilton 2017 H1-H3.",
        attachPdf
          ? "Use attached PDF + source page images as ground truth."
          : "Use attached source page images as ground truth.",
        "Use attached extracted diagram crops to check whether crops are tight and readable.",
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

  parts.push(...(await toInlineImageParts(options.sourcePageImagePaths)));
  parts.push(...(await toInlineImageParts(options.diagramImagePaths)));

  const { text, metrics } = await generateTextWithMetrics({
    modelId: options.modelId,
    input: [{ role: "user", content: parts }],
    responseMimeType: "application/json",
    ...(options.modelId.startsWith("chatgpt-")
      ? { thinkingLevel: "low" as const }
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

async function buildPathConfig(options: {
  sourcePdfPath: string;
  modelId: string;
}): Promise<AgentPathConfig> {
  const modelSlug = toModelSlug(options.modelId);
  const runId = `${toRunTimestampSlug()}-${randomUUID().slice(0, 8)}`;
  const runRootDir = path.join(OUTPUT_ROOT_DIR, modelSlug, runId);
  const workspaceDir = path.join(runRootDir, "workspace");
  const taskPath = path.join(workspaceDir, "TASK.md");
  const sourceDir = path.join(workspaceDir, "source");
  const sourcePdfTargetPath = path.join(sourceDir, "hamilton-2017-q.pdf");
  const outputDir = path.join(workspaceDir, "output");
  const outputMarkdownPath = path.join(outputDir, "transcription.md");
  const outputManifestPath = path.join(outputDir, "diagram-manifest.json");
  const outputNotesPath = path.join(outputDir, "agent-notes.md");
  const outputReferenceTextPath = path.join(outputDir, "reference", "pdf-text.md");
  const agentLogPath = path.join(workspaceDir, "agent.log");
  const llmLogsDir = path.join(runRootDir, "logs");
  const eventLogPath = path.join(runRootDir, "agent-log.jsonl");
  const summaryJsonPath = path.join(runRootDir, "summary.json");

  await rm(runRootDir, { recursive: true, force: true });
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await copyFile(options.sourcePdfPath, sourcePdfTargetPath);
  await writeFile(
    taskPath,
    `${createAgentTaskDescription()}\n`,
    "utf8",
  );

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
    outputReferenceTextPath,
    agentLogPath,
    llmLogsDir,
    eventLogPath,
    summaryJsonPath,
  };
}

function createAgentTaskDescription(): string {
  return [
    "# Task",
    "Transcribe Hamilton Olympiad 2017 problems H1, H2, H3 with diagrams.",
    "",
    "## Workflow Skill",
    "Follow this workflow text exactly:",
    "",
    "~~~markdown",
    PDF_TRANSCRIPTION_SKILL_TEXT,
    "~~~",
    "",
    "When complete, call 'done' with a concise summary including diagrams extracted and any crop failures.",
  ].join("\n");
}

function createAgentPrompt(): string {
  return [
    "Read 'TASK.md' from the workspace root.",
    "Follow it exactly.",
  ].join("\n");
}

async function runAgenticBenchmark(options: {
  sourcePdfPath: string;
  modelId: LlmTextModelId;
  useSubagents: boolean;
  useReferenceText: boolean;
}): Promise<AgenticBenchmarkResult> {
  const paths = await buildPathConfig({
    sourcePdfPath: options.sourcePdfPath,
    modelId: options.modelId,
  });
  const logLines: string[] = [];
  const workspace = {
    scheduleUpdate: (inputPath: string): void => {
      void inputPath;
    },
    deleteFile: async (): Promise<void> => {
      // Native filesystem tools already updated the local workspace.
      // This benchmark workspace does not mirror state to an external store.
    },
    moveFile: async (): Promise<void> => {
      // Native filesystem tools already updated the local workspace.
      // This benchmark workspace does not mirror state to an external store.
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
  const selectedToolsBase: LlmToolSet = {};
  for (const toolName of REQUIRED_CUSTOM_TOOL_NAMES) {
    const candidate = (allToolsWithDone as Record<string, unknown>)[toolName];
    if (!candidate) {
      throw new Error(`Required tool missing: ${toolName}`);
    }
    (selectedToolsBase as Record<string, unknown>)[toolName] = candidate;
  }
  const selectedTools = applyPdfTranscriptionSkillTools({
    tools: selectedToolsBase,
    rootDir: paths.workspaceDir,
    includeReferenceTextTool: options.useReferenceText,
    targetProblemIds: TARGET_PROBLEM_IDS,
    onFileWritten: (outputPath) => {
      workspace.scheduleUpdate(outputPath);
    },
  });

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
  const agentSummary = summarizeToolLoopResult(toolLoopResult);
  const agentLatencyMs = Date.now() - startedAt;
  const workspaceFiles = await listFilesRecursive(paths.workspaceDir);
  const outputDirPrefix = `${path.resolve(paths.outputDir)}${path.sep}`;
  const sourcePageImagePaths = workspaceFiles.filter((item) => {
    if (!item.startsWith(outputDirPrefix)) {
      return false;
    }
    if (item.includes(`${path.sep}diagrams${path.sep}`)) {
      return false;
    }
    if (path.extname(item).toLowerCase() !== ".png") {
      return false;
    }
    return /^page-\d{4}\.png$/u.test(path.basename(item));
  });
  const manifestText = await readFile(paths.outputManifestPath, "utf8");
  const manifest = parseAgentDiagramManifest(JSON.parse(manifestText));
  const notesText = await readFile(paths.outputNotesPath, "utf8");
  const referenceText = options.useReferenceText
    ? await readFile(paths.outputReferenceTextPath, "utf8")
    : null;
  const workspaceFileSet = new Set(workspaceFiles.map((item) => path.resolve(item)));
  const manifestDir = path.dirname(paths.outputManifestPath);
  const diagramImagePaths = Array.from(
    new Set(
      manifest.diagrams
        .map((item) => {
          if (typeof item.cropPath !== "string") {
            return null;
          }
          return resolveManifestImagePath({
            workspaceDir: paths.workspaceDir,
            manifestDir,
            rawPath: item.cropPath,
            workspaceFileSet,
          });
        })
        .filter((item): item is string => item !== null)
        .filter((item) => path.extname(item).toLowerCase() === ".png"),
    ),
  );
  const judgingStartedAt = Date.now();
  const verdicts = await Promise.all(
    JUDGE_MODEL_IDS.map(async (judgeModelId) => {
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
  const overallPass = verdicts.every((item) => item.verdict === "pass");
  const reason = overallPass
    ? "All judges passed"
    : verdicts
        .filter((item) => item.verdict === "fail")
        .map((item) => `[${item.modelId}] ${item.summary}`)
        .join("; ");
  const totalLatencyMs = agentLatencyMs + judgingLatencyMs;
  const totalCostUsd = agentSummary.agentCostUsd + judgingCostUsd;

  logLines.push(
    `model=${options.modelId} maxSteps=${MAX_STEPS.toString()} useSubagents=${options.useSubagents ? "true" : "false"} useReferenceText=${options.useReferenceText ? "true" : "false"}`,
  );
  logLines.push(
    `agent_latency=${formatMs(agentLatencyMs)} agent_cost=${formatUsd(agentSummary.agentCostUsd)}`,
  );
  logLines.push(
    `judging_latency=${formatMs(judgingLatencyMs)} judging_cost=${formatUsd(judgingCostUsd)}`,
  );
  logLines.push(`tool_calls=${agentSummary.toolCalls.toString()}`);
  logLines.push(`workspace_files=${workspaceFiles.length.toString()}`);
  logLines.push(`agent_log=${toRepoRelativePath(paths.agentLogPath)}`);
  logLines.push(`llm_logs_dir=${toRepoRelativePath(paths.llmLogsDir)}`);
  logLines.push(`event_log=${toRepoRelativePath(paths.eventLogPath)}`);
  logLines.push(`notes_chars=${notesText.length.toString()}`);
  logLines.push(
    `reference_chars=${referenceText === null ? "disabled" : referenceText.length.toString()}`,
  );

  await writeFile(
    paths.eventLogPath,
    `${toToolLoopEventLogRecords(toolLoopResult).map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  const result: AgenticBenchmarkResult = {
    generatedAt: new Date().toISOString(),
    modelId: options.modelId,
    status: overallPass ? "pass" : "fail",
    reason,
    sourcePdfPath: toRepoRelativePath(paths.sourcePdfPath),
    runDir: toRepoRelativePath(paths.runRootDir),
    workspaceDir: toRepoRelativePath(paths.workspaceDir),
    taskPath: toRepoRelativePath(paths.taskPath),
    transcriptionPath: toRepoRelativePath(paths.outputMarkdownPath),
    diagramManifestPath: toRepoRelativePath(paths.outputManifestPath),
    notesPath: toRepoRelativePath(paths.outputNotesPath),
    ...(options.useReferenceText
      ? { referenceTextPath: toRepoRelativePath(paths.outputReferenceTextPath) }
      : {}),
    agentLogPath: toRepoRelativePath(paths.agentLogPath),
    llmLogsDir: toRepoRelativePath(paths.llmLogsDir),
    eventLogPath: toRepoRelativePath(paths.eventLogPath),
    summaryJsonPath: toRepoRelativePath(paths.summaryJsonPath),
    sourcePageImagePaths: sourcePageImagePaths.map((item) => toRepoRelativePath(item)),
    diagramImagePaths: diagramImagePaths.map((item) => toRepoRelativePath(item)),
    agent: {
      latencyMs: agentLatencyMs,
      modelCalls: agentSummary.modelCalls,
      toolCalls: agentSummary.toolCalls,
      toolCallsByName: agentSummary.toolCallsByName,
      costUsd: agentSummary.agentCostUsd,
      usage: agentSummary.usageTotals,
      thoughtsChars: agentSummary.thoughtsChars,
      responseChars: agentSummary.responseChars,
      doneSummary: agentSummary.doneSummary,
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

  return result;
}

async function renderSingleResultsMarkdown(result: AgenticBenchmarkResult): Promise<string> {
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
  lines.push(`- Agent notes: ${result.notesPath}`);
  if (typeof result.referenceTextPath === "string") {
    lines.push(`- PDF reference text: ${result.referenceTextPath}`);
  }
  lines.push(`- Agent log: ${result.agentLogPath}`);
  lines.push(`- Native LLM logs dir: ${result.llmLogsDir}`);
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
  lines.push("## Crop Notes");
  lines.push("");
  const notesMarkdown = await readFile(fromRepoRelativePath(result.notesPath), "utf8").catch(() => "");
  if (notesMarkdown.trim().length === 0) {
    lines.push("_Missing crop notes output._");
  } else {
    lines.push("```markdown");
    lines.push(notesMarkdown.trimEnd());
    lines.push("```");
  }
  lines.push("");
  if (typeof result.referenceTextPath === "string") {
    lines.push("## PDF Reference Text");
    lines.push("");
    const referenceText = await readFile(
      fromRepoRelativePath(result.referenceTextPath),
      "utf8",
    ).catch(() => "");
    if (referenceText.trim().length === 0) {
      lines.push("_Missing reference text output._");
    } else {
      lines.push("```markdown");
      lines.push(referenceText.trimEnd());
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
  lines.push("# PDF Transcription Agentic Benchmark Results");
  lines.push("");
  lines.push(`Generated at: ${generatedAt}`);
  lines.push(`Runs: ${ordered.length.toString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const outcome of ordered) {
    if (outcome.result) {
      lines.push(
        `- ${outcome.modelId}: subagents=${outcome.useSubagents ? "ENABLED" : "DISABLED"} referenceText=${outcome.useReferenceText ? "ENABLED" : "DISABLED"} status=${outcome.result.status.toUpperCase()} latency=${formatMs(outcome.result.total.latencyMs)} cost=${formatUsd(outcome.result.total.costUsd)} runDir=${outcome.result.runDir}`,
      );
    } else {
      lines.push(
        `- ${outcome.modelId}: subagents=${outcome.useSubagents ? "ENABLED" : "DISABLED"} referenceText=${outcome.useReferenceText ? "ENABLED" : "DISABLED"} status=ERROR latency=n/a cost=n/a runDir=${toRepoRelativePath(path.join(OUTPUT_ROOT_DIR, toModelSlug(outcome.modelId)))} error=${outcome.error ?? "unknown error"}`,
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
      lines.push(`- Reference text: ${outcome.useReferenceText ? "ENABLED" : "DISABLED"}`);
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
  await assertFileExists(cli.sourcePdfPath);

  await mkdir(OUTPUT_ROOT_DIR, { recursive: true });

  const outcomes = await Promise.all(
    cli.modelIds.map(
      async (modelId): Promise<AgenticBenchmarkRunOutcome> => {
        try {
          const result = await runAgenticBenchmark({
            sourcePdfPath: cli.sourcePdfPath,
            modelId,
            useSubagents: cli.useSubagents,
            useReferenceText: cli.useReferenceText,
          });
          return {
            modelId,
            useSubagents: cli.useSubagents,
            useReferenceText: cli.useReferenceText,
            result,
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            modelId,
            useSubagents: cli.useSubagents,
            useReferenceText: cli.useReferenceText,
            error: sanitizeLogText(message),
          };
        }
      },
    ),
  );
  const markdown = await renderResultsMarkdown(outcomes);
  const resultsMarkdownPath = resolveResultsMarkdownPath(outcomes);
  await writeFile(resultsMarkdownPath, markdown, "utf8");
  console.log(`[pdf-bench] wrote ${toRepoRelativePath(resultsMarkdownPath)}`);

  const failedCount = outcomes.filter((outcome) => !outcome.result).length;
  if (failedCount > 0) {
    throw new Error(
      `Benchmark finished with ${failedCount.toString()} failed model run(s). See ${toRepoRelativePath(resultsMarkdownPath)}.`,
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pdf-bench] error: ${sanitizeLogText(message)}`);
  process.exit(1);
});
