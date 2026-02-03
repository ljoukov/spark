import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import {
  runSessionAgentSmokeTest,
  runSessionGenerationAgent,
} from "@spark/llm/code/sessionGenerationAgent";
import { estimateCallCostUsd, type LlmTextModelId } from "@spark/llm/utils/llm";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  ModelCallHandle,
} from "@spark/llm/utils/concurrency";
import {
  commitFirestoreWrites,
  patchFirestoreDocument,
} from "@spark/llm/utils/gcp/firestoreRest";
import type { CodeProblem, QuizDefinition, Session } from "@spark/schemas";
import { ensureEvalEnvLoaded } from "../utils/paths";
import { requireServiceAccountJson } from "../utils/gcp";

ensureEvalEnvLoaded();

type CliOptions = {
  workingDirectory: string;
  briefFile?: string;
  topic?: string;
  userId: string;
  sessionId?: string;
  storyPlanItemId?: string;
  storySegmentCount?: number;
  modelId?: string;
  maxSteps?: number;
  story: boolean;
  coding: boolean;
  smokeTest: boolean;
  publish: boolean;
};

type TokenState = {
  promptTokens: number;
  cachedTokens: number;
  responseTokens: number;
  responseImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  toolUsePromptTokens: number;
};

type CallState = {
  modelId: string;
  modelVersion?: string;
  imageSize?: string;
  tokens: TokenState;
  responseImages: number;
};

type UsageTotals = {
  calls: number;
  costUsd: number;
  tokens?: {
    input: number;
    prompt: number;
    cached: number;
    toolUsePrompt: number;
    output: number;
    response: number;
    responseImageTokens: number;
    thinking: number;
    total: number;
  };
};

type UsageSummary = {
  generatedAt: string;
  elapsedMs?: {
    total: number;
    model: number;
    tool: number;
  };
  totals: UsageTotals;
  models: Record<string, UsageTotals>;
};

function createEmptyTokenState(): TokenState {
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

function resolveNumber(next: number | undefined, prev: number): number {
  if (typeof next === "number" && Number.isFinite(next)) {
    return Math.max(0, next);
  }
  return prev;
}

function createUsageTotals(withTokens: boolean): UsageTotals {
  return {
    calls: 0,
    costUsd: 0,
    ...(withTokens
      ? {
          tokens: {
            input: 0,
            prompt: 0,
            cached: 0,
            toolUsePrompt: 0,
            output: 0,
            response: 0,
            responseImageTokens: 0,
            thinking: 0,
            total: 0,
          },
        }
      : {}),
  };
}

class UsageAggregator {
  private readonly calls = new Map<ModelCallHandle, CallState>();
  private readonly modelTotals = new Map<string, UsageTotals>();
  private readonly overallTotals: UsageTotals = createUsageTotals(false);
  private modelElapsedMs = 0;

  constructor(initial?: UsageSummary) {
    if (!initial) {
      return;
    }
    this.overallTotals.calls = initial.totals.calls;
    this.overallTotals.costUsd = initial.totals.costUsd;
    if (initial.elapsedMs) {
      this.modelElapsedMs = initial.elapsedMs.model;
    }
    for (const [modelId, totals] of Object.entries(initial.models)) {
      const hydrated = createUsageTotals(Boolean(totals.tokens));
      hydrated.calls = totals.calls;
      hydrated.costUsd = totals.costUsd;
      if (totals.tokens) {
        hydrated.tokens = {
          input: totals.tokens.input,
          prompt: totals.tokens.prompt,
          cached: totals.tokens.cached,
          toolUsePrompt: totals.tokens.toolUsePrompt,
          output: totals.tokens.output,
          response: totals.tokens.response,
          responseImageTokens: totals.tokens.responseImageTokens,
          thinking: totals.tokens.thinking,
          total: totals.tokens.total,
        };
      }
      this.modelTotals.set(modelId, hydrated);
    }
  }

  start(details: { modelId: string; imageSize?: string }): ModelCallHandle {
    const handle: ModelCallHandle = Symbol("usage-call");
    this.calls.set(handle, {
      modelId: details.modelId,
      imageSize: details.imageSize,
      tokens: createEmptyTokenState(),
      responseImages: 0,
    });
    return handle;
  }

  record(handle: ModelCallHandle, chunk: LlmUsageChunk): void {
    const state = this.calls.get(handle);
    if (!state) {
      return;
    }
    if (chunk.modelVersion) {
      state.modelVersion = chunk.modelVersion;
    }
    if (chunk.response?.imageCountDelta) {
      state.responseImages += Math.max(0, chunk.response.imageCountDelta);
    }
    if (chunk.tokens) {
      const prev = state.tokens;
      state.tokens = {
        promptTokens: resolveNumber(
          chunk.tokens.promptTokens,
          prev.promptTokens,
        ),
        cachedTokens: resolveNumber(
          chunk.tokens.cachedTokens,
          prev.cachedTokens,
        ),
        responseTokens: resolveNumber(
          chunk.tokens.responseTokens,
          prev.responseTokens,
        ),
        responseImageTokens: resolveNumber(
          chunk.tokens.responseImageTokens,
          prev.responseImageTokens,
        ),
        thinkingTokens: resolveNumber(
          chunk.tokens.thinkingTokens,
          prev.thinkingTokens,
        ),
        totalTokens: resolveNumber(chunk.tokens.totalTokens, prev.totalTokens),
        toolUsePromptTokens: resolveNumber(
          chunk.tokens.toolUsePromptTokens,
          prev.toolUsePromptTokens,
        ),
      };
    }
  }

  finish(handle: ModelCallHandle): void {
    const state = this.calls.get(handle);
    if (!state) {
      return;
    }
    this.calls.delete(handle);
    const modelId = state.modelVersion ?? state.modelId;
    const costUsd = estimateCallCostUsd({
      modelId,
      tokens: state.tokens,
      responseImages: state.responseImages,
      imageSize: state.imageSize,
    });
    this.overallTotals.calls += 1;
    this.overallTotals.costUsd += costUsd;
    const modelTotals =
      this.modelTotals.get(modelId) ?? createUsageTotals(true);
    this.applyModelTotals(modelTotals, state, costUsd);
    this.modelTotals.set(modelId, modelTotals);
  }

  addModelElapsedMs(delta: number): void {
    if (Number.isFinite(delta) && delta > 0) {
      this.modelElapsedMs += delta;
    }
  }

  private applyModelTotals(
    totals: UsageTotals,
    state: CallState,
    costUsd: number,
  ): void {
    totals.calls += 1;
    totals.costUsd += costUsd;
    if (!totals.tokens) {
      totals.tokens = {
        input: 0,
        prompt: 0,
        cached: 0,
        toolUsePrompt: 0,
        output: 0,
        response: 0,
        responseImageTokens: 0,
        thinking: 0,
        total: 0,
      };
    }
    const inputTokens =
      state.tokens.promptTokens + state.tokens.toolUsePromptTokens;
    const outputTokens = state.tokens.responseTokens;
    const totalTokens =
      state.tokens.totalTokens > 0
        ? state.tokens.totalTokens
        : inputTokens +
          state.tokens.responseTokens +
          state.tokens.thinkingTokens;
    totals.tokens.input += inputTokens;
    totals.tokens.prompt += state.tokens.promptTokens;
    totals.tokens.cached += state.tokens.cachedTokens;
    totals.tokens.toolUsePrompt += state.tokens.toolUsePromptTokens;
    totals.tokens.output += outputTokens;
    totals.tokens.response += state.tokens.responseTokens;
    totals.tokens.responseImageTokens += state.tokens.responseImageTokens;
    totals.tokens.thinking += state.tokens.thinkingTokens;
    totals.tokens.total += totalTokens;
  }

  summary(totalElapsedMs?: number): UsageSummary {
    const elapsedTotal =
      Number.isFinite(totalElapsedMs) && totalElapsedMs !== undefined
        ? Math.max(0, totalElapsedMs)
        : undefined;
    const elapsedModel = this.modelElapsedMs;
    const elapsedTool =
      elapsedTotal !== undefined
        ? Math.max(0, elapsedTotal - elapsedModel)
        : undefined;
    const models: Record<string, UsageTotals> = {};
    for (const [modelId, totals] of this.modelTotals.entries()) {
      models[modelId] = totals;
    }
    return {
      generatedAt: new Date().toISOString(),
      ...(elapsedTotal !== undefined && elapsedTool !== undefined
        ? {
            elapsedMs: {
              total: elapsedTotal,
              model: elapsedModel,
              tool: elapsedTool,
            },
          }
        : {}),
      totals: this.overallTotals,
      models,
    };
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatUsd(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: safe < 1 ? 4 : 2,
    maximumFractionDigits: safe < 1 ? 4 : 2,
  }).format(safe);
}

function printUsageSummary(summary: UsageSummary): void {
  const entries = Object.entries(summary.models).sort(
    (a, b) => b[1].costUsd - a[1].costUsd,
  );
  console.log("\nUsage summary:");
  for (const [modelId, totals] of entries) {
    const tokens = totals.tokens;
    console.log(
      `- ${modelId}: calls=${formatNumber(totals.calls)} in=${formatNumber(
        tokens?.input ?? 0,
      )} cached=${formatNumber(tokens?.cached ?? 0)} out=${formatNumber(
        tokens?.output ?? 0,
      )} thinking=${formatNumber(
        tokens?.thinking ?? 0,
      )} total=${formatNumber(tokens?.total ?? 0)} cost=${formatUsd(
        totals.costUsd,
      )}`,
    );
  }
  const overall = summary.totals;
  if (summary.elapsedMs) {
    console.log(
      `Elapsed: total=${formatNumber(
        summary.elapsedMs.total,
      )}ms model=${formatNumber(summary.elapsedMs.model)}ms tool=${formatNumber(
        summary.elapsedMs.tool,
      )}ms`,
    );
  }
  console.log(
    `Total: calls=${formatNumber(overall.calls)} cost=${formatUsd(
      overall.costUsd,
    )}`,
  );
}

function parseCliOptions(): CliOptions {
  const program = new Command();
  program
    .requiredOption("--working-directory <path>")
    .option("--brief-file <path>")
    .option("--topic <topic>")
    .option("--user-id <id>", "session user id", "session-agent")
    .option("--session-id <id>")
    .option("--story-plan-item-id <id>")
    .option("--story-segment-count <count>")
    .option("--model-id <id>")
    .option("--max-steps <count>")
    .option("--no-story")
    .option("--no-coding")
    .option("--smoke-test")
    .option("--no-publish");

  program.parse(process.argv);
  const opts = program.opts();
  const storySegmentCount = opts.storySegmentCount
    ? Number.parseInt(String(opts.storySegmentCount), 10)
    : undefined;
  const maxSteps = opts.maxSteps
    ? Number.parseInt(String(opts.maxSteps), 10)
    : undefined;

  if (
    opts.briefFile === undefined &&
    opts.topic === undefined &&
    !opts.smokeTest
  ) {
    throw new Error("Provide --brief-file or --topic (or use --smoke-test)");
  }

  return {
    workingDirectory: String(opts.workingDirectory),
    briefFile: opts.briefFile ? String(opts.briefFile) : undefined,
    topic: opts.topic ? String(opts.topic) : undefined,
    userId: String(opts.userId ?? "session-agent"),
    sessionId: opts.sessionId ? String(opts.sessionId) : undefined,
    storyPlanItemId: opts.storyPlanItemId
      ? String(opts.storyPlanItemId)
      : undefined,
    storySegmentCount,
    modelId: opts.modelId ? String(opts.modelId) : undefined,
    maxSteps,
    story: Boolean(opts.story),
    coding: Boolean(opts.coding),
    smokeTest: Boolean(opts.smokeTest),
    publish: opts.publish !== false,
  };
}

const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";

function getTemplateDocRef(sessionId: string) {
  return `${TEMPLATE_ROOT_COLLECTION}/${TEMPLATE_ROOT_DOC}/${TEMPLATE_SESSIONS_COLLECTION}/${sessionId}`;
}

function stripUndefined<T>(value: T): T;
function stripUndefined(value: unknown): unknown {
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    const next: unknown[] = [];
    for (const item of value) {
      next.push(stripUndefined(item));
    }
    return next;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) {
        continue;
      }
      result[key] = stripUndefined(val);
    }
    return result;
  }
  return value;
}

function truncateWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/u);
  if (words.length <= maxWords) {
    return words.join(" ");
  }
  return words.slice(0, maxWords).join(" ");
}

function extractEmoji(value: string): string | undefined {
  const match = value.match(/\p{Extended_Pictographic}/u);
  return match?.[0];
}

function resolveTemplateTagline(
  session: Record<string, unknown>,
): string | undefined {
  const tagline =
    typeof session.tagline === "string" ? session.tagline.trim() : "";
  if (tagline.length > 0) {
    return tagline;
  }
  const summary =
    typeof session.summary === "string" ? session.summary.trim() : "";
  if (summary.length > 0) {
    return truncateWords(summary, 10);
  }
  const title = typeof session.title === "string" ? session.title.trim() : "";
  if (title.length > 0) {
    return truncateWords(title, 10);
  }
  return undefined;
}

function resolveTemplateEmoji(
  session: Record<string, unknown>,
): string | undefined {
  const emoji = typeof session.emoji === "string" ? session.emoji.trim() : "";
  if (emoji.length > 0) {
    return emoji;
  }
  const title = typeof session.title === "string" ? session.title : undefined;
  if (title) {
    const match = extractEmoji(title);
    if (match) {
      return match;
    }
  }
  const plan = session.plan;
  if (Array.isArray(plan)) {
    for (const item of plan) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const itemTitle = (item as { title?: unknown }).title;
      if (typeof itemTitle !== "string") {
        continue;
      }
      const match = extractEmoji(itemTitle);
      if (match) {
        return match;
      }
    }
  }
  return "📘";
}

function deriveTopicFromBrief(text: string): string {
  const lines = text.split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(
      /^\s*(?:topic|lesson topic|session topic|title)\s*:\s*(.+?)\s*$/iu,
    );
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmpty) {
    return "";
  }
  return firstNonEmpty.replace(/^\s*#+\s*/u, "").trim();
}

async function publishToWelcomeTemplate(options: {
  sessionId: string;
  topic: string;
  session: Session;
  quizzes: readonly QuizDefinition[];
  problems: readonly CodeProblem[];
}): Promise<void> {
  const serviceAccountJson = requireServiceAccountJson();
  const templateDoc = getTemplateDocRef(options.sessionId);

  if (options.quizzes.length > 0) {
    const quizWrites = options.quizzes.map((quiz) => {
      const { id, ...rest } = quiz;
      void id;
      return {
        type: "set" as const,
        documentPath: `${templateDoc}/quiz/${quiz.id}`,
        data: stripUndefined(rest) as Record<string, unknown>,
      };
    });
    const MAX_WRITES_PER_BATCH = 450;
    for (let i = 0; i < quizWrites.length; i += MAX_WRITES_PER_BATCH) {
      await commitFirestoreWrites({
        serviceAccountJson,
        writes: quizWrites.slice(i, i + MAX_WRITES_PER_BATCH),
      });
    }
    console.log(
      `[welcome/${options.sessionId}] published ${String(options.quizzes.length)} quizzes to template`,
    );
  } else {
    console.log(`[welcome/${options.sessionId}] no quizzes to publish`);
  }

  if (options.problems.length > 0) {
    const problemWrites = options.problems.map((problem) => {
      const { slug, ...rest } = problem;
      void slug;
      return {
        type: "set" as const,
        documentPath: `${templateDoc}/code/${problem.slug}`,
        data: stripUndefined(rest) as Record<string, unknown>,
      };
    });
    const MAX_WRITES_PER_BATCH = 450;
    for (let i = 0; i < problemWrites.length; i += MAX_WRITES_PER_BATCH) {
      await commitFirestoreWrites({
        serviceAccountJson,
        writes: problemWrites.slice(i, i + MAX_WRITES_PER_BATCH),
      });
    }
    console.log(
      `[welcome/${options.sessionId}] published ${String(options.problems.length)} problems to template`,
    );
  } else {
    console.log(`[welcome/${options.sessionId}] no problems to publish`);
  }

  const session = options.session as Record<string, unknown>;
  const payload: Record<string, unknown> = {
    id: options.sessionId,
    topic: options.topic,
    updatedAt: new Date(),
  };

  if (session.plan) {
    payload.plan = session.plan;
  }
  const resolvedTagline = resolveTemplateTagline(session);
  if (resolvedTagline) {
    payload.tagline = resolvedTagline;
  }
  const resolvedEmoji = resolveTemplateEmoji(session);
  if (resolvedEmoji) {
    payload.emoji = resolvedEmoji;
  }
  if (typeof session.summary === "string") {
    payload.summary = session.summary;
  }
  if (typeof session.title === "string") {
    payload.title = session.title;
  }

  const draftFieldsToDelete = [
    "planDraft",
    "planGrade",
    "quizzesDraft",
    "quizzesGrade",
    "problemsDraft",
    "problemsGrade",
    "storyTitle",
  ];
  await patchFirestoreDocument({
    serviceAccountJson,
    documentPath: templateDoc,
    updates: stripUndefined(payload) as Record<string, unknown>,
    deletes: draftFieldsToDelete,
  });
  console.log(`[welcome/${options.sessionId}] published session doc`);
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const usagePath = path.join(options.workingDirectory, "debug", "usage.json");
  let baselineElapsedMs = 0;
  let existingSummary: UsageSummary | undefined;
  try {
    const existing = JSON.parse(
      await readFile(usagePath, "utf8"),
    ) as UsageSummary;
    existingSummary = existing;
    if (existing.elapsedMs?.total) {
      baselineElapsedMs = existing.elapsedMs.total;
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && code !== "ENOENT") {
      console.error(
        `Failed to read existing usage.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  const usage = new UsageAggregator(existingSummary);
  const runStartedAt = Date.now();
  let usageWritePromise: Promise<void> | undefined;
  const callStartTimes = new Map<ModelCallHandle, number>();
  const scheduleUsageWrite = () => {
    const totalElapsedMs = baselineElapsedMs + (Date.now() - runStartedAt);
    const payload = JSON.stringify(usage.summary(totalElapsedMs), null, 2);
    const writeOp = async () => {
      await mkdir(path.dirname(usagePath), { recursive: true });
      await writeFile(usagePath, payload, "utf8");
    };
    usageWritePromise = usageWritePromise
      ? usageWritePromise.then(writeOp).catch(() => undefined)
      : writeOp().catch(() => undefined);
  };
  const progress: JobProgressReporter = {
    log(message: string) {
      console.log(message);
    },
    startModelCall(details: {
      modelId: string;
      uploadBytes: number;
      imageSize?: string;
    }) {
      const handle = usage.start({
        modelId: details.modelId,
        imageSize: details.imageSize,
      });
      callStartTimes.set(handle, Date.now());
      return handle;
    },
    recordModelUsage(handle: ModelCallHandle, chunk: LlmUsageChunk) {
      usage.record(handle, chunk);
    },
    finishModelCall(handle: ModelCallHandle) {
      const startedAt = callStartTimes.get(handle);
      if (startedAt) {
        const elapsedMs = Date.now() - startedAt;
        usage.addModelElapsedMs(elapsedMs);
        callStartTimes.delete(handle);
      }
      usage.finish(handle);
      scheduleUsageWrite();
    },
    startStage() {
      return Symbol("stage");
    },
    finishStage() {},
    setActiveStages() {},
  };
  if (options.smokeTest) {
    await runSessionAgentSmokeTest({
      workingDirectory: options.workingDirectory,
      modelId: options.modelId as unknown as LlmTextModelId,
      progress,
    });
    process.stdout.write("Smoke test succeeded.\n");
    if (!usageWritePromise) {
      scheduleUsageWrite();
    }
    await usageWritePromise;
    const usageSummary = JSON.parse(
      await readFile(usagePath, "utf8"),
    ) as UsageSummary;
    printUsageSummary(usageSummary);
    return;
  }

  const result = await runSessionGenerationAgent({
    workingDirectory: options.workingDirectory,
    briefFile: options.briefFile,
    topic: options.topic,
    userId: options.userId,
    sessionId: options.sessionId,
    includeStory: options.story,
    includeCoding: options.coding,
    storyPlanItemId: options.storyPlanItemId,
    storySegmentCount: options.storySegmentCount,
    modelId: options.modelId as unknown as LlmTextModelId,
    maxSteps: options.maxSteps,
    progress,
  });

  process.stdout.write(
    `Session generated: ${result.sessionId} (${result.session.title})\n`,
  );

  if (options.publish) {
    const topic =
      options.topic ??
      (result.session.title ||
        (options.briefFile
          ? deriveTopicFromBrief(await readFile(options.briefFile, "utf8"))
          : "session"));
    await publishToWelcomeTemplate({
      sessionId: result.sessionId,
      topic,
      session: result.session,
      quizzes: result.quizzes,
      problems: result.problems,
    });
  }

  if (!usageWritePromise) {
    scheduleUsageWrite();
  }
  await usageWritePromise;
  const loaded = JSON.parse(await readFile(usagePath, "utf8")) as UsageSummary;
  printUsageSummary(loaded);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
