import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import type {
  generateCodeProblems,
  generateSessionMetadata,
  generateQuizDefinitions,
} from "@spark/llm/code/sessionArtifacts";
import type { GenerateStoryResult } from "@spark/llm/code/generateStory";
import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "@spark/llm/utils/firebaseAdmin";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";
import { CodeProblemSchema, QuizDefinitionSchema } from "@spark/schemas";

type SessionMetadata = Awaited<ReturnType<typeof generateSessionMetadata>>;
type QuizDefinitions = Awaited<ReturnType<typeof generateQuizDefinitions>>;
type CodeProblems = Awaited<ReturnType<typeof generateCodeProblems>>;
type GenerateSession =
  typeof import("@spark/llm/code/generateSession").generateSession;

const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";
const DEFAULT_STORY_PLAN_ITEM_ID = "story";

const SUPPORTED_BRIEF_EXTENSIONS = [".txt", ".md", ".markdown"] as const;
const OPENAI_TEXT_MODEL_ID = "gpt-5.2";
const QuizDefinitionsCheckpointSchema = z.array(QuizDefinitionSchema);

const optionsSchema = z
  .object({
    topic: z.string().trim().min(1, "topic cannot be empty").optional(),
    briefFile: z.string().trim().min(1).optional(),
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
    storySegmentCount: z
      .string()
      .optional()
      .transform((value) => {
        if (value === undefined) {
          return undefined;
        }
        const parsed = Number.parseInt(value, 10);
        if (Number.isNaN(parsed)) {
          throw new Error("story segment count must be an integer");
        }
        return parsed;
      })
      .refine((value) => value === undefined || (value >= 1 && value <= 10), {
        message: "story segment count must be between 1 and 10",
      }),
    storyPlanItemId: z
      .string()
      .trim()
      .min(1, "story plan item id cannot be empty")
      .default(DEFAULT_STORY_PLAN_ITEM_ID),
    checkpointDir: z.string().trim().optional(),
    debugRootDir: z.string().trim().optional(),
    noStory: z.boolean().optional(),
    story: z.boolean().optional(),
    noCoding: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.topic && !value.briefFile) {
      ctx.addIssue({
        code: "custom",
        message: "Provide --topic or --brief-file",
      });
    }
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

function formatSupportedExtensions(): string {
  return SUPPORTED_BRIEF_EXTENSIONS.join(", ");
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

async function readLessonBriefFile(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (
    !SUPPORTED_BRIEF_EXTENSIONS.includes(
      ext as (typeof SUPPORTED_BRIEF_EXTENSIONS)[number],
    )
  ) {
    throw new Error(
      `Lesson brief must be a text file (${formatSupportedExtensions()}); received "${filePath}"`,
    );
  }

  const buffer = await readFile(resolved);
  const prefix = buffer.subarray(0, 4).toString("utf8");
  if (prefix === "%PDF") {
    throw new Error(
      `Lesson brief must be plain text (${formatSupportedExtensions()}), not a PDF: "${filePath}"`,
    );
  }
  for (const byte of buffer) {
    if (byte === 0) {
      throw new Error(
        `Lesson brief must be plain text (${formatSupportedExtensions()}); file looks binary: "${filePath}"`,
      );
    }
  }
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n").trim();
  if (text.length === 0) {
    throw new Error(`Lesson brief file is empty: "${filePath}"`);
  }
  return text;
}

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
    return (value as unknown[]).map((item) => stripUndefined(item));
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

async function readCheckpoint<T>(filePath: string): Promise<T | undefined> {
  try {
    const raw = await readFile(filePath, { encoding: "utf8" });
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeCheckpoint(
  filePath: string,
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value, null, 2);
  await writeFile(filePath, json, { encoding: "utf8" });
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
    `[welcome/${sessionId}] published ${String(quizzes.length)} quizzes to template`,
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
    `[welcome/${sessionId}] published ${String(problems.length)} problems to template`,
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

async function main(): Promise<void> {
  ensureEvalEnvLoaded();
  process.env.SPARK_LLM_TEXT_MODEL_ID = OPENAI_TEXT_MODEL_ID;

  const [{ generateSession }, sessionArtifacts] = await Promise.all([
    import("@spark/llm/code/generateSession"),
    import("@spark/llm/code/sessionArtifacts"),
  ]);
  const {
    convertSessionPlanToItems,
    generateCodeProblems,
    generateSessionMetadata,
    generateQuizDefinitions,
  } = sessionArtifacts;

  const program = new Command();
  program
    .option("--topic <topic>", "Topic for the welcome session")
    .option(
      "--brief-file <path>",
      `Path to a text file containing extra lesson requirements (${formatSupportedExtensions()})`,
    )
    .option("--session-id <id>", "Override the generated session id")
    .option("--seed <int>", "Seed for deterministic prompting")
    .option("--no-story", "Skip story generation")
    .option("--no-coding", "Skip coding problem generation")
    .option("--story-segment-count <int>", "Number of story panels (1-10)")
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
    topic?: string;
    briefFile?: string;
    sessionId?: string;
    seed?: string;
    storySegmentCount?: string;
    storyPlanItemId?: string;
    checkpointDir?: string;
    debugRootDir?: string;
    noStory?: boolean;
    story?: boolean;
    noCoding?: boolean;
  }>();

  const parsed = optionsSchema.parse({
    topic: raw.topic,
    briefFile: raw.briefFile,
    sessionId: raw.sessionId,
    seed: raw.seed,
    storySegmentCount: raw.storySegmentCount,
    storyPlanItemId: raw.storyPlanItemId,
    checkpointDir: raw.checkpointDir,
    debugRootDir: raw.debugRootDir,
    noStory: raw.noStory,
    story: raw.story,
    noCoding: raw.noCoding,
  });

  const includeCodingOverride = parsed.noCoding === true ? false : undefined;
  const includeCoding = includeCodingOverride !== false;
  const lessonBriefRaw = parsed.briefFile
    ? await readLessonBriefFile(parsed.briefFile)
    : undefined;
  const topicFromBrief = lessonBriefRaw
    ? deriveTopicFromBrief(lessonBriefRaw)
    : "";
  const generationRequirements = [
    "Automation requirements (must follow):",
    "- Validate every example and test output by running the reference solution with the code execution tool.",
    "- If any mismatch occurs, fix the solution/spec/tests before responding; never leave inconsistent tests.",
    "- If the brief provides marking tests or fixed outputs, treat them as ground truth: do not change cases or outputs; adjust the solution to match.",
    "- Do not approximate counts; compute exact integers for outputs.",
  ].join("\n");
  const lessonBrief = lessonBriefRaw
    ? includeCoding
      ? `${lessonBriefRaw}\n\n${generationRequirements}`
      : lessonBriefRaw
    : undefined;
  const topic = (parsed.topic ?? topicFromBrief).trim();
  if (topic.length === 0) {
    throw new Error("Unable to determine topic; pass --topic");
  }

  const sessionId = parsed.sessionId ?? slugifyTopic(topic);
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
    `[welcome] generating session for topic "${topic}" (sessionId=${sessionId})`,
  );
  if (lessonBrief) {
    console.log(
      `[welcome/${sessionId}] using lesson brief from "${parsed.briefFile ?? ""}"`,
    );
  }
  const includeStoryOverride =
    parsed.noStory === true || parsed.story === false ? false : undefined;
  console.log(
    `[welcome/${sessionId}] flags includeStory=${includeStoryOverride === false ? "false" : "true"} includeCoding=${includeCoding ? "true" : "false"} storyPlanItemId=${parsed.storyPlanItemId} storySegmentCount=${String(parsed.storySegmentCount ?? "default")}`,
  );

  const metadataCheckpoint = path.join(checkpointDir, "metadata.json");
  const quizDefinitionsCheckpoint = path.join(
    checkpointDir,
    "quiz_definitions.json",
  );
  const codeProblemsCheckpoint = path.join(checkpointDir, "code_problems.json");

  const [session] = await runJobsWithConcurrency<
    "welcome-session",
    Awaited<ReturnType<GenerateSession>>
  >({
    items: ["welcome-session"],
    concurrency: 1,
    getId: () => sessionId,
    label: `[welcome/${sessionId}]`,
    handler: async (_item, { progress }) => {
      return generateSession({
        topic,
        lessonBrief,
        seed: parsed.seed,
        checkpointDir,
        debugRootDir,
        userId: TEMPLATE_USER_ID,
        sessionId,
        storyPlanItemId: parsed.storyPlanItemId,
        storySegmentCount: parsed.storySegmentCount,
        progress,
        includeStory: includeStoryOverride,
        includeCoding: includeCodingOverride,
      });
    },
  });

  const metadata =
    (await readCheckpoint<SessionMetadata>(metadataCheckpoint)) ??
    (await generateSessionMetadata({
      topic,
      plan: session.plan,
      storyTitle: session.story?.title,
      includeCoding,
    }));
  await writeCheckpoint(metadataCheckpoint, metadata);

  const quizDefinitionsFromCheckpointRaw = await readCheckpoint<unknown>(
    quizDefinitionsCheckpoint,
  );
  const quizDefinitionsFromCheckpoint = (() => {
    if (quizDefinitionsFromCheckpointRaw === undefined) {
      return undefined;
    }
    const parsedQuizDefinitions = QuizDefinitionsCheckpointSchema.safeParse(
      quizDefinitionsFromCheckpointRaw,
    );
    if (!parsedQuizDefinitions.success) {
      console.warn(
        `[welcome/${sessionId}] quiz_definitions checkpoint schema mismatch; regenerating`,
      );
      return undefined;
    }
    const expectedQuestionCounts = new Map<string, number>();
    for (const quiz of session.quizzes) {
      expectedQuestionCounts.set(quiz.quiz_id, quiz.questions.length);
    }
    for (const [quizId, expectedCount] of expectedQuestionCounts.entries()) {
      const checkpointQuiz = parsedQuizDefinitions.data.find(
        (quiz) => quiz.id === quizId,
      );
      if (!checkpointQuiz) {
        console.warn(
          `[welcome/${sessionId}] quiz_definitions checkpoint missing quiz '${quizId}'; regenerating`,
        );
        return undefined;
      }
      const checkpointCount = checkpointQuiz.questions.length;
      if (checkpointCount !== expectedCount) {
        console.warn(
          `[welcome/${sessionId}] quiz_definitions checkpoint has ${String(checkpointCount)} questions for '${quizId}' but session draft has ${String(expectedCount)}; regenerating`,
        );
        return undefined;
      }
    }
    return parsedQuizDefinitions.data satisfies QuizDefinitions;
  })();
  const quizDefinitions =
    quizDefinitionsFromCheckpoint ??
    (await generateQuizDefinitions(session.plan, session.quizzes, lessonBrief, {
      debug: {
        rootDir: debugRootDir,
        stage: "quiz-definitions",
      },
    }));
  await writeCheckpoint(quizDefinitionsCheckpoint, quizDefinitions);

  const problems = includeCoding
    ? ((await readCheckpoint<CodeProblems>(codeProblemsCheckpoint)) ??
      (await generateCodeProblems(session.plan, session.problems, lessonBrief)))
    : [];
  if (includeCoding) {
    await writeCheckpoint(codeProblemsCheckpoint, problems);
  }

  if (quizDefinitions.length === 0) {
    throw new Error("quiz definitions are required for welcome sessions.");
  }

  if (includeCoding && problems.length === 0) {
    throw new Error("code problems are required for welcome sessions.");
  }

  const { plan, storyTitle } = convertSessionPlanToItems(
    session,
    parsed.storyPlanItemId,
  );

  await writeTemplateDoc(sessionId, topic, {
    plan,
    tagline: metadata.tagline,
    emoji: metadata.emoji,
    summary: metadata.summary,
    title: storyTitle,
  });
  await writeQuizzesToTemplate(sessionId, quizDefinitions);
  if (includeCoding) {
    await writeProblemsToTemplate(sessionId, problems);
  }

  if (session.story) {
    await copyStoryToTemplate(sessionId, parsed.storyPlanItemId, session.story);
  } else {
    console.warn(
      `[welcome/${sessionId}] story missing; template will not include media`,
    );
  }

  console.log(`[welcome/${sessionId}] generation complete`);
}

main().catch((error: unknown) => {
  console.error("[welcome] generation failed", error);
  process.exitCode = 1;
});
