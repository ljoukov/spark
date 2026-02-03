import { createHash } from "node:crypto";

import { type CodeProblem, type QuizDefinition } from "@spark/schemas";
import { z } from "zod";

import {
  commitFirestoreWrites,
  getFirestoreDocument,
  patchFirestoreDocument,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import { generateSession } from "./generateSession";
import type { GenerateStoryResult } from "./generateStory";
import {
  convertSessionPlanToItems,
  generateCodeProblems,
  generateSessionMetadata,
  generateQuizDefinitions,
} from "./sessionArtifacts";
const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";
const DEFAULT_STORY_PLAN_ITEM_ID = "story";

function requireServiceAccountJson(): string {
  const value = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!value || value.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  return value;
}

const GenerateWelcomeSessionOptionsSchema = z.object({
  topic: z.string().trim().min(1, "topic is required"),
  sessionId: z.string().trim().min(1).optional(),
  storyPlanItemId: z.string().trim().min(1).optional(),
});

export type GenerateWelcomeSessionOptions = z.infer<
  typeof GenerateWelcomeSessionOptionsSchema
>;

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
  return `${TEMPLATE_ROOT_COLLECTION}/${TEMPLATE_ROOT_DOC}/${TEMPLATE_SESSIONS_COLLECTION}/${sessionId}`;
}

async function copyStoryToTemplate(
  serviceAccountJson: string,
  sessionId: string,
  planItemId: string,
  storyResult: GenerateStoryResult,
): Promise<void> {
  const snapshot = await getFirestoreDocument({
    serviceAccountJson,
    documentPath: storyResult.narration.documentPath,
  });
  if (!snapshot.exists || !snapshot.data) {
    console.warn(
      `[welcome/${sessionId}] narration document ${storyResult.narration.documentPath} missing; skipping copy`,
    );
    return;
  }

  const targetDocPath = `${getTemplateDocRef(sessionId)}/media/${planItemId}`;
  await setFirestoreDocument({
    serviceAccountJson,
    documentPath: targetDocPath,
    data: snapshot.data,
  });
  console.log(
    `[welcome/${sessionId}] published story media to ${targetDocPath}`,
  );
}

async function writeQuizzesToTemplate(
  serviceAccountJson: string,
  sessionId: string,
  quizzes: readonly QuizDefinition[],
): Promise<void> {
  const templateDoc = getTemplateDocRef(sessionId);
  const writes = quizzes.map((quiz) => {
    const { id, ...rest } = quiz;
    void id;
    return {
      type: "set" as const,
      documentPath: `${templateDoc}/quiz/${quiz.id}`,
      data: rest,
    };
  });

  const MAX_WRITES_PER_BATCH = 450;
  for (let i = 0; i < writes.length; i += MAX_WRITES_PER_BATCH) {
    await commitFirestoreWrites({
      serviceAccountJson,
      writes: writes.slice(i, i + MAX_WRITES_PER_BATCH),
    });
  }
  console.log(
    `[welcome/${sessionId}] published ${quizzes.length} quizzes to template`,
  );
}

async function writeProblemsToTemplate(
  serviceAccountJson: string,
  sessionId: string,
  problems: readonly CodeProblem[],
): Promise<void> {
  const templateDoc = getTemplateDocRef(sessionId);
  const writes = problems.map((problem) => {
    const { slug, ...rest } = problem;
    void slug;
    return {
      type: "set" as const,
      documentPath: `${templateDoc}/code/${problem.slug}`,
      data: rest,
    };
  });

  const MAX_WRITES_PER_BATCH = 450;
  for (let i = 0; i < writes.length; i += MAX_WRITES_PER_BATCH) {
    await commitFirestoreWrites({
      serviceAccountJson,
      writes: writes.slice(i, i + MAX_WRITES_PER_BATCH),
    });
  }
  console.log(
    `[welcome/${sessionId}] published ${problems.length} problems to template`,
  );
}

async function writeTemplateDoc(
  serviceAccountJson: string,
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
  const templateDoc = getTemplateDocRef(sessionId);
  const payload: Record<string, unknown> = {
    id: sessionId,
    topic,
    updatedAt: new Date(),
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

  await patchFirestoreDocument({
    serviceAccountJson,
    documentPath: templateDoc,
    updates: payload,
    deletes: draftFieldsToDelete,
  });
}

export async function generateWelcomeSessionTemplate(
  options: GenerateWelcomeSessionOptions,
): Promise<{ sessionId: string; topic: string; title: string }> {
  const serviceAccountJson = requireServiceAccountJson();
  const parsed = GenerateWelcomeSessionOptionsSchema.parse(options);
  const sessionId = parsed.sessionId ?? slugifyTopic(parsed.topic);
  const storyPlanItemId = parsed.storyPlanItemId ?? DEFAULT_STORY_PLAN_ITEM_ID;

  const generation = await generateSession({
    topic: parsed.topic,
    userId: TEMPLATE_USER_ID,
    sessionId,
    storyPlanItemId,
  });

  if (!generation.story) {
    throw new Error("Story generation is required for welcome templates.");
  }

  const quizDefinitions = await generateQuizDefinitions(
    generation.plan,
    generation.quizzes,
  );
  if (quizDefinitions.length === 0) {
    throw new Error("quiz definitions are required for welcome templates.");
  }

  const codeProblems = await generateCodeProblems(
    generation.plan,
    generation.problems,
  );
  if (codeProblems.length === 0) {
    throw new Error("code problems are required for welcome templates.");
  }

  const metadata = await generateSessionMetadata({
    topic: parsed.topic,
    plan: generation.plan,
    storyTitle: generation.story?.title,
  });
  const { plan: finalPlan, storyTitle } = convertSessionPlanToItems(
    generation,
    storyPlanItemId,
  );

  await copyStoryToTemplate(
    serviceAccountJson,
    sessionId,
    storyPlanItemId,
    generation.story,
  );

  await writeTemplateDoc(serviceAccountJson, sessionId, parsed.topic, {
    plan: finalPlan,
    tagline: metadata.tagline,
    emoji: metadata.emoji,
    summary: metadata.summary,
    title: storyTitle,
  });

  await writeQuizzesToTemplate(serviceAccountJson, sessionId, quizDefinitions);
  await writeProblemsToTemplate(serviceAccountJson, sessionId, codeProblems);

  return { sessionId, topic: parsed.topic, title: storyTitle };
}
