import { type CodeProblem, type QuizDefinition } from "@spark/schemas";
import { z } from "zod";

import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "../utils/firebaseAdmin";
import { generateSession, type SessionPlan } from "./generateSession";
import type { GenerateStoryResult } from "./generateStory";
import {
  generateCodeProblems,
  generateSessionMetadata,
  generateQuizDefinitions,
} from "./sessionArtifacts";
const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";
const DEFAULT_STORY_PLAN_ITEM_ID = "story";

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
    .replace(/[^a-zA-Z0-9\\s-]/g, " ")
    .trim()
    .toLowerCase();
  const collapsed = ascii.replace(/\\s+/g, "-").replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  return trimmed.slice(0, 60) || "session";
}

function clampSummaryWords(summary: string, maxWords = 15): string {
  const words = summary.split(/\\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return summary.trim();
  }
  return words.slice(0, maxWords).join(" ").concat("...");
}

function convertPlan(
  plan: SessionPlan,
  storyPlanItemId: string,
  storyTitle: string,
) {
  return plan.parts.map((part) => {
    const conciseSummary = clampSummaryWords(part.summary, 15);
    const base = {
      title: part.summary.split(".")[0] || "Session Part",
      summary: conciseSummary,
    };

    switch (part.kind) {
      case "story":
        return {
          ...base,
          id: storyPlanItemId,
          kind: "media" as const,
          title: storyTitle,
        };
      case "intro_quiz":
        return {
          ...base,
          id: "intro_quiz",
          kind: "quiz" as const,
          title: "Warm-up",
        };
      case "coding_1":
        return {
          ...base,
          id: "p1",
          kind: "problem" as const,
          title: "Challenge 1",
        };
      case "coding_2":
        return {
          ...base,
          id: "p2",
          kind: "problem" as const,
          title: "Challenge 2",
        };
      case "wrap_up_quiz":
        return {
          ...base,
          id: "wrap_up_quiz",
          kind: "quiz" as const,
          title: "Review",
        };
    }
  });
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
  quizzes: readonly QuizDefinition[],
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const batch = firestore.batch();
  const templateDoc = getTemplateDocRef(sessionId);

  for (const quiz of quizzes) {
    const target = templateDoc.collection("quiz").doc(quiz.id);
    const { id, ...rest } = quiz;
    void id;
    batch.set(target, rest);
  }

  await batch.commit();
  console.log(
    `[welcome/${sessionId}] published ${quizzes.length} quizzes to template`,
  );
}

async function writeProblemsToTemplate(
  sessionId: string,
  problems: readonly CodeProblem[],
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const batch = firestore.batch();
  const templateDoc = getTemplateDocRef(sessionId);

  for (const problem of problems) {
    const target = templateDoc.collection("code").doc(problem.slug);
    const { slug, ...rest } = problem;
    void slug;
    batch.set(target, rest);
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
  const { FieldValue, Timestamp } = getFirebaseAdminFirestoreModule();
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

  await templateDoc.set(payload, { merge: true });
}

export async function generateWelcomeSessionTemplate(
  options: GenerateWelcomeSessionOptions,
): Promise<{ sessionId: string; topic: string; title: string }> {
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
  const filteredQuizzes = quizDefinitions.filter(
    (quiz) => quiz.id === "intro_quiz" || quiz.id === "wrap_up_quiz",
  );
  const missingQuizId = ["intro_quiz", "wrap_up_quiz"].find((required) =>
    filteredQuizzes.every((quiz) => quiz.id !== required),
  );
  if (missingQuizId) {
    throw new Error(`quiz definitions missing required id '${missingQuizId}'`);
  }

  const codeProblems = await generateCodeProblems(
    generation.plan,
    generation.problems,
  );
  const filteredProblems = codeProblems.filter(
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

  const metadata = await generateSessionMetadata({
    topic: parsed.topic,
    plan: generation.plan,
    storyTitle: generation.story?.title,
  });
  const storyTitle = generation.story.title;
  const finalPlan = convertPlan(generation.plan, storyPlanItemId, storyTitle);

  await copyStoryToTemplate(sessionId, storyPlanItemId, generation.story);

  await writeTemplateDoc(sessionId, parsed.topic, {
    plan: finalPlan,
    tagline: metadata.tagline,
    emoji: metadata.emoji,
    summary: metadata.summary,
    title: storyTitle,
  });

  await writeQuizzesToTemplate(sessionId, filteredQuizzes);
  await writeProblemsToTemplate(sessionId, filteredProblems);

  return { sessionId, topic: parsed.topic, title: storyTitle };
}
