import path from "node:path";

import { Command } from "commander";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";
import {
  generateSession,
  type GenerateSessionResult,
} from "@spark/llm/code/generateSession";
import { createConsoleProgress } from "@spark/llm/code/generateNarration";
import { getFirebaseAdminFirestore } from "@spark/llm";

const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";

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
    .default("story"),
  checkpointDir: z.string().trim().optional(),
  debugRootDir: z.string().trim().optional(),
});

function slugifyTopic(topic: string): string {
  const ascii = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .trim()
    .toLowerCase();
  const collapsed = ascii.replace(/\s+/g, "-").replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  return trimmed.slice(0, 60) || "session";
}

function resolveSessionBaseDir(sessionId: string): string {
  return path.join(
    WORKSPACE_PATHS.codeSyntheticDir,
    "sessions",
    "welcome",
    sessionId,
  );
}

function resolveDefaultCheckpointDir(sessionId: string): string {
  return path.join(resolveSessionBaseDir(sessionId), "checkpoints");
}

function resolveDefaultDebugDir(sessionId: string): string {
  return path.join(resolveSessionBaseDir(sessionId), "debug");
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
  storyResult: GenerateSessionResult["story"],
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
  await targetDoc.set(snapshot.data());
  console.log(
    `[welcome/${sessionId}] published story media to ${targetDoc.path}`,
  );
}

function createSessionTemplatePayload(
  result: GenerateSessionResult,
  sessionId: string,
) {
  return {
    id: sessionId,
    topic: result.plan.topic,
    storyTitle: result.story.title,
    updatedAt: Timestamp.now(),
    planDraft: result.plan,
    planGrade: result.planGrade,
    quizzesDraft: result.quizzes,
    quizzesGrade: result.quizzesGrade,
    problemsDraft: result.problems,
    problemsGrade: result.problemsGrade,
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
      "story",
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

  const targetSessionId = parsed.sessionId ?? slugifyTopic(parsed.topic);
  const checkpointDir =
    parsed.checkpointDir ??
    resolveDefaultCheckpointDir(targetSessionId);
  const debugRootDir =
    parsed.debugRootDir ?? resolveDefaultDebugDir(targetSessionId);

  console.log(
    `[welcome] generating session for topic "${parsed.topic}" (checkpointDir=${checkpointDir})`,
  );

  const result = await generateSession({
    topic: parsed.topic,
    seed: parsed.seed,
    checkpointDir,
    debugRootDir,
    progress: createConsoleProgress(`[welcome/${targetSessionId}]`),
    userId: TEMPLATE_USER_ID,
    sessionId: parsed.sessionId,
    storyPlanItemId: parsed.storyPlanItemId,
  });

  const finalSessionId = result.sessionId;

  await copyStoryToTemplate(
    finalSessionId,
    parsed.storyPlanItemId,
    result.story,
  );

  const templateDoc = getTemplateDocRef(finalSessionId);
  await templateDoc.set(createSessionTemplatePayload(result, finalSessionId), {
    merge: true,
  });

  console.log(
    `[welcome/${finalSessionId}] stored session draft under ${templateDoc.path}`,
  );
}

void main().catch((error: unknown) => {
  console.error("[welcome] generation failed:", error);
  process.exitCode = 1;
});
