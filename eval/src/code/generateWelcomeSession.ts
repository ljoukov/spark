import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  convertSessionPlanToItems,
  generateCodeProblems,
  generateSessionMetadata,
  generateQuizDefinitions,
} from "@spark/llm/code/sessionArtifacts";
import { generateSession } from "@spark/llm/code/generateSession";
import type { GenerateStoryResult } from "@spark/llm/code/generateStory";
import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "@spark/llm";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";
import { CodeProblemSchema, QuizDefinitionSchema } from "@spark/schemas";

const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";
const DEFAULT_STORY_PLAN_ITEM_ID = "story";

const optionsSchema = z.object({
  topic: z.string().trim().min(1, "topic cannot be empty"),
  sessionId: z.string().trim().min(1).optional(),
  seed: z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      const parsed = Number.parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        throw new Error("seed must be an integer");
      }
      return parsed;
    }),
  storyPlanItemId: z
    .string()
    .trim()
    .min(1, "story plan item id cannot be empty")
    .default(DEFAULT_STORY_PLAN_ITEM_ID),
  checkpointDir: z.string().trim().optional(),
  debugRootDir: z.string().trim().optional(),
});

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    value.constructor === Object
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (entryValue === undefined) {
        continue;
      }
      result[key] = stripUndefined(entryValue);
    }
    return result as T;
  }
  return value;
}

function slugifyTopic(topic: string): string {
  const ascii = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .trim()
    .toLowerCase();
  const collapsed = ascii.replace(/\s+/g, "-").replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  const baseSlug = trimmed || "session";
  const maxLength = 25;
  if (baseSlug.length <= maxLength) {
    return baseSlug;
  }
  let cutoff = maxLength;
  while (cutoff < baseSlug.length && baseSlug[cutoff] !== "-") {
    cutoff += 1;
  }
  const hash = createHash("sha256").update(topic).digest("hex").slice(0, 6);
  const prefix = baseSlug.slice(0, cutoff).replace(/-+$/g, "");
  const safePrefix = prefix.length > 0 ? prefix : baseSlug.slice(0, maxLength);
  return `${safePrefix}-${hash}`;
}

function getTemplateDocRef(sessionId: string) {
  const firestore = getFirebaseAdminFirestore();
  return firestore
    .collection(TEMPLATE_ROOT_COLLECTION)
    .doc(TEMPLATE_ROOT_DOC)
    .collection(TEMPLATE_SESSIONS_COLLECTION)
    .doc(sessionId);
}

async function copyStoryToTemplate(
  sessionId: string,
  planItemId: string,
  storyResult: GenerateStoryResult,
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const sourceDoc = firestore.doc(storyResult.narration.documentPath);
  const snapshot = await sourceDoc.get();
  if (!snapshot.exists) {
    console.warn(
      `[welcome/${sessionId}] narration document ${storyResult.narration.documentPath} missing; skipping copy`,
    );
    return;
  }

  const targetDoc = getTemplateDocRef(sessionId)
    .collection("media")
    .doc(planItemId);
  const payload = snapshot.data();
  if (!payload) {
    console.warn(
      `[welcome/${sessionId}] narration document ${storyResult.narration.documentPath} missing data; skipping copy`,
    );
    return;
  }
  await targetDoc.set(payload);
  console.log(
    `[welcome/${sessionId}] published story media to ${targetDoc.path}`,
  );
}

async function writeQuizzesToTemplate(
  sessionId: string,
  quizzes: readonly (typeof QuizDefinitionSchema)["_output"][],
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const batch = firestore.batch();
  const templateDoc = getTemplateDocRef(sessionId);

  for (const quiz of quizzes) {
    const target = templateDoc.collection("quiz").doc(quiz.id);
    const { id, ...rest } = quiz;
    void id;
    batch.set(target, stripUndefined(rest));
  }

  await batch.commit();
  console.log(
    `[welcome/${sessionId}] published ${quizzes.length} quizzes to template`,
  );
}

async function writeProblemsToTemplate(
  sessionId: string,
  problems: readonly (typeof CodeProblemSchema)["_output"][],
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const batch = firestore.batch();
  const templateDoc = getTemplateDocRef(sessionId);

  for (const problem of problems) {
    const target = templateDoc.collection("code").doc(problem.slug);
    const { slug, ...rest } = problem;
    void slug;
    batch.set(target, stripUndefined(rest));
  }

  await batch.commit();
  console.log(
    `[welcome/${sessionId}] published ${problems.length} problems to template`,
  );
}

async function writeTemplateDoc(
  sessionId: string,
  topic: string,
  finalData: {
    plan: unknown[];
    tagline: string;
    emoji: string;
    summary?: string;
    title?: string;
  },
): Promise<void> {
  const { FieldValue } = getFirebaseAdminFirestoreModule();
  const templateDoc = getTemplateDocRef(sessionId);
  const payload: Record<string, unknown> = {
    id: sessionId,
    topic,
    updatedAt: Timestamp.now(),
  };

  payload.plan = finalData.plan;
  payload.tagline = finalData.tagline;
  payload.emoji = finalData.emoji;
  if (finalData.summary) {
    payload.summary = finalData.summary;
  }
  if (finalData.title) {
    payload.title = finalData.title;
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
}

function normaliseQuizDefinition(
  quiz: (typeof QuizDefinitionSchema)["_output"],
  plan: { id: string; summary?: string; title?: string }[],
): (typeof QuizDefinitionSchema)["_output"] {
  const planSummaryById: Record<string, string | undefined> = {};
  for (const item of plan) {
    planSummaryById[item.id] = item.summary ?? item.title;
  }

  const progressKey =
    quiz.progressKey ??
    (quiz.id === "intro_quiz"
      ? "primer"
      : quiz.id === "wrap_up_quiz"
        ? "wrap"
        : quiz.id);
  const description =
    quiz.description ?? planSummaryById[quiz.id] ?? quiz.title;

  return {
    ...quiz,
    progressKey,
    description,
  };
}

async function main(): Promise<void> {
  ensureEvalEnvLoaded();

  const program = new Command();
  program
    .requiredOption("--topic <topic>", "Topic for the welcome session")
    .option("--session-id <id>", "Override the generated session id")
    .option("--seed <int>", "Seed for deterministic prompting")
    .option(
      "--story-plan-item-id <id>",
      "Plan item id used for the story media",
      DEFAULT_STORY_PLAN_ITEM_ID,
    )
    .option(
      "--checkpoint-dir <path>",
      "Directory for session checkpoints (defaults to synthetic workspace)",
    )
    .option(
      "--debug-root <path>",
      "Directory for LLM debug transcripts (defaults to synthetic workspace)",
    );

  program.parse(process.argv);

  const raw = program.opts<{
    topic: string;
    sessionId?: string;
    seed?: string;
    storyPlanItemId?: string;
    checkpointDir?: string;
    debugRootDir?: string;
  }>();

  const parsed = optionsSchema.parse({
    topic: raw.topic,
    sessionId: raw.sessionId,
    seed: raw.seed,
    storyPlanItemId: raw.storyPlanItemId,
    checkpointDir: raw.checkpointDir,
    debugRootDir: raw.debugRootDir,
  });

  const sessionId = parsed.sessionId ?? slugifyTopic(parsed.topic);
  const checkpointDir =
    parsed.checkpointDir ??
    path.join(
      WORKSPACE_PATHS.codeSyntheticDir,
      "sessions",
      "welcome",
      sessionId,
      "checkpoints",
    );
  const debugRootDir =
    parsed.debugRootDir ??
    path.join(
      WORKSPACE_PATHS.codeSyntheticDir,
      "sessions",
      "welcome",
      sessionId,
      "debug",
    );

  await mkdir(checkpointDir, { recursive: true });
  await mkdir(debugRootDir, { recursive: true });

  console.log(
    `[welcome] generating session for topic "${parsed.topic}" (sessionId=${sessionId})`,
  );

  const [session] = await runJobsWithConcurrency<
    "welcome-session",
    Awaited<ReturnType<typeof generateSession>>
  >({
    items: ["welcome-session"],
    concurrency: 1,
    getId: () => sessionId,
    label: `[welcome/${sessionId}]`,
    handler: async (_item, { progress }) => {
      return generateSession({
        topic: parsed.topic,
        seed: parsed.seed,
        checkpointDir,
        debugRootDir,
        userId: TEMPLATE_USER_ID,
        sessionId,
        storyPlanItemId: parsed.storyPlanItemId,
        progress,
      });
    },
  });

  const metadata = await generateSessionMetadata({
    topic: parsed.topic,
    plan: session.plan,
    storyTitle: session.story?.title,
  });
  const quizDefinitions = await generateQuizDefinitions(
    session.plan,
    session.quizzes,
  );
  const problems = await generateCodeProblems(session.plan, session.problems);

  const filteredQuizzes = quizDefinitions.filter(
    (quiz) => quiz.id === "intro_quiz" || quiz.id === "wrap_up_quiz",
  );
  const missingQuizId = ["intro_quiz", "wrap_up_quiz"].find((required) =>
    filteredQuizzes.every((quiz) => quiz.id !== required),
  );
  if (missingQuizId) {
    throw new Error(`quiz definitions missing required id '${missingQuizId}'`);
  }

  const filteredProblems = problems.filter(
    (problem) => problem.slug === "p1" || problem.slug === "p2",
  );
  const missingProblemId = ["p1", "p2"].find((required) =>
    filteredProblems.every((problem) => problem.slug !== required),
  );
  if (missingProblemId) {
    throw new Error(
      `code problems missing required slug '${missingProblemId}'`,
    );
  }

  const { plan, storyTitle } = convertSessionPlanToItems(
    session,
    parsed.storyPlanItemId,
  );
  const quizzesWithDefaults = filteredQuizzes.map((quiz) =>
    normaliseQuizDefinition(quiz, plan),
  );

  await writeTemplateDoc(sessionId, parsed.topic, {
    plan,
    tagline: metadata.tagline,
    emoji: metadata.emoji,
    summary: metadata.summary,
    title: storyTitle,
  });
  await writeQuizzesToTemplate(sessionId, quizzesWithDefaults);
  await writeProblemsToTemplate(sessionId, filteredProblems);

  if (session.story) {
    await copyStoryToTemplate(sessionId, parsed.storyPlanItemId, session.story);
  } else {
    console.warn(
      `[welcome/${sessionId}] story missing; template will not include media`,
    );
  }

  console.log(`[welcome/${sessionId}] generation complete`);
}

main().catch((error) => {
  console.error("[welcome] generation failed", error);
  process.exitCode = 1;
});
