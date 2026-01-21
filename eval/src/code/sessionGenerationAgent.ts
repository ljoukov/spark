import { readFile } from "node:fs/promises";

import { Command } from "commander";
import { Timestamp } from "firebase-admin/firestore";

import {
  runSessionAgentSmokeTest,
  runSessionGenerationAgent,
} from "@spark/llm/code/sessionGenerationAgent";
import type { LlmTextModelId } from "@spark/llm/utils/llm";
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
  if (options.smokeTest) {
    await runSessionAgentSmokeTest({
      workingDirectory: options.workingDirectory,
      modelId: options.modelId as unknown as LlmTextModelId,
    });
    process.stdout.write("Smoke test succeeded.\n");
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
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
