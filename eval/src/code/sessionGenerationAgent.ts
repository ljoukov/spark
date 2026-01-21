import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
import { Timestamp } from "firebase-admin/firestore";

import {
  runSessionAgentSmokeTest,
  runSessionGenerationAgent,
} from "@spark/llm/code/sessionGenerationAgent";
import {
  estimateCallCostUsd,
  type LlmTextModelId,
} from "@spark/llm/utils/llm";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  ModelCallHandle,
} from "@spark/llm/utils/concurrency";
import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "@spark/llm/utils/firebaseAdmin";
import type { CodeProblem, QuizDefinition, Session } from "@spark/schemas";
import { ensureEvalEnvLoaded } from "../utils/paths";

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
  tokens: {
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

function ensureUsageTotals(target: UsageTotals | undefined): UsageTotals {
  if (target) {
    return target;
  }
  return {
    calls: 0,
    costUsd: 0,
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
  };
}

class UsageAggregator {
  private readonly calls = new Map<ModelCallHandle, CallState>();
  private readonly modelTotals = new Map<string, UsageTotals>();
  private readonly overallTotals: UsageTotals = ensureUsageTotals(undefined);

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
        promptTokens: resolveNumber(chunk.tokens.promptTokens, prev.promptTokens),
        cachedTokens: resolveNumber(chunk.tokens.cachedTokens, prev.cachedTokens),
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
    this.applyTotals(this.overallTotals, state, costUsd);
    const modelTotals = ensureUsageTotals(this.modelTotals.get(modelId));
    this.applyTotals(modelTotals, state, costUsd);
    this.modelTotals.set(modelId, modelTotals);
  }

  private applyTotals(
    totals: UsageTotals,
    state: CallState,
    costUsd: number,
  ): void {
    totals.calls += 1;
    totals.costUsd += costUsd;
    const inputTokens =
      state.tokens.promptTokens + state.tokens.toolUsePromptTokens;
    const outputTokens = state.tokens.responseTokens;
    const totalTokens =
      state.tokens.totalTokens > 0
        ? state.tokens.totalTokens
        : inputTokens + state.tokens.responseTokens + state.tokens.thinkingTokens;
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

  summary(): UsageSummary {
    const models: Record<string, UsageTotals> = {};
    for (const [modelId, totals] of this.modelTotals.entries()) {
      models[modelId] = totals;
    }
    return {
      generatedAt: new Date().toISOString(),
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
    console.log(
      `- ${modelId}: calls=${formatNumber(totals.calls)} in=${formatNumber(
        totals.tokens.input,
      )} cached=${formatNumber(totals.tokens.cached)} out=${formatNumber(
        totals.tokens.output,
      )} thinking=${formatNumber(
        totals.tokens.thinking,
      )} total=${formatNumber(totals.tokens.total)} cost=${formatUsd(
        totals.costUsd,
      )}`,
    );
  }
  const overall = summary.totals;
  console.log(
    `Total: calls=${formatNumber(overall.calls)} in=${formatNumber(
      overall.tokens.input,
    )} cached=${formatNumber(overall.tokens.cached)} out=${formatNumber(
      overall.tokens.output,
    )} thinking=${formatNumber(
      overall.tokens.thinking,
    )} total=${formatNumber(overall.tokens.total)} cost=${formatUsd(
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
  const firestore = getFirebaseAdminFirestore();
  return firestore
    .collection(TEMPLATE_ROOT_COLLECTION)
    .doc(TEMPLATE_ROOT_DOC)
    .collection(TEMPLATE_SESSIONS_COLLECTION)
    .doc(sessionId);
}

function stripUndefined<T>(value: T): T;
function stripUndefined(value: unknown): unknown {
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
  const firestore = getFirebaseAdminFirestore();
  const templateDoc = getTemplateDocRef(options.sessionId);
  const { FieldValue } = getFirebaseAdminFirestoreModule();

  if (options.quizzes.length > 0) {
    const quizBatch = firestore.batch();
    for (const quiz of options.quizzes) {
      const target = templateDoc.collection("quiz").doc(quiz.id);
      const { id, ...rest } = quiz;
      void id;
      quizBatch.set(target, stripUndefined(rest));
    }
    await quizBatch.commit();
    console.log(
      `[welcome/${options.sessionId}] published ${String(options.quizzes.length)} quizzes to template`,
    );
  } else {
    console.log(`[welcome/${options.sessionId}] no quizzes to publish`);
  }

  if (options.problems.length > 0) {
    const problemBatch = firestore.batch();
    for (const problem of options.problems) {
      const target = templateDoc.collection("code").doc(problem.slug);
      const { slug, ...rest } = problem;
      void slug;
      problemBatch.set(target, stripUndefined(rest));
    }
    await problemBatch.commit();
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
    updatedAt: Timestamp.now(),
  };

  if (session.plan) {
    payload.plan = session.plan;
  }
  if (typeof session.tagline === "string") {
    payload.tagline = session.tagline;
  }
  if (typeof session.emoji === "string") {
    payload.emoji = session.emoji;
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
  for (const field of draftFieldsToDelete) {
    payload[field] = FieldValue.delete();
  }

  await templateDoc.set(stripUndefined(payload), { merge: true });
  console.log(`[welcome/${options.sessionId}] published session doc`);
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const usage = new UsageAggregator();
  const progress: JobProgressReporter = {
    log(message: string) {
      console.log(message);
    },
    startModelCall(details: {
      modelId: string;
      uploadBytes: number;
      imageSize?: string;
    }) {
      return usage.start({ modelId: details.modelId, imageSize: details.imageSize });
    },
    recordModelUsage(handle: ModelCallHandle, chunk: LlmUsageChunk) {
      usage.record(handle, chunk);
    },
    finishModelCall(handle: ModelCallHandle) {
      usage.finish(handle);
    },
    startStage(_stageName: string) {
      return Symbol("stage");
    },
    finishStage(_handle: symbol) {},
    setActiveStages(_stages?: Iterable<string>) {},
  };
  if (options.smokeTest) {
    await runSessionAgentSmokeTest({
      workingDirectory: options.workingDirectory,
      modelId: options.modelId as unknown as LlmTextModelId,
      progress,
    });
    process.stdout.write("Smoke test succeeded.\n");
    const usageSummary = usage.summary();
    const usagePath = path.join(options.workingDirectory, "usage.json");
    await writeFile(usagePath, JSON.stringify(usageSummary, null, 2), "utf8");
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
      (options.briefFile
        ? deriveTopicFromBrief(
            await readFile(options.briefFile, "utf8"),
          )
        : result.session.title ?? "session");
    await publishToWelcomeTemplate({
      sessionId: result.sessionId,
      topic,
      session: result.session,
      quizzes: result.quizzes,
      problems: result.problems,
    });
  }

  const usageSummary = usage.summary();
  const usagePath = path.join(options.workingDirectory, "usage.json");
  await writeFile(usagePath, JSON.stringify(usageSummary, null, 2), "utf8");
  const loaded = JSON.parse(await readFile(usagePath, "utf8")) as UsageSummary;
  printUsageSummary(loaded);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
