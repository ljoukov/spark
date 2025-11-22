import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { Command, Option } from "commander";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { Type, type Schema } from "@google/genai";

import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";
import {
  SessionGenerationPipeline,
  type SessionPlan,
  type PlanGrade,
  type SessionQuiz,
  type QuizzesGrade,
  type CodingProblem,
  type ProblemsGrade,
} from "@spark/llm/code/generateSession";
import {
  generateStory,
  type GenerateStoryResult,
} from "@spark/llm/code/generateStory";
import { generateJson } from "@spark/llm/utils/llm";
import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "@spark/llm";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";

const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";

const MAX_QUIZ_GRADE_RETRIES = 2;
const MAX_PROBLEM_GRADE_RETRIES = 2;

const TEXT_MODEL_ID = "gemini-2.5-pro";

const StageEnum = z.enum([
  "plan_ideas",
  "plan",
  "plan_grade",
  "quiz_ideas",
  "quizzes",
  "quizzes_grade",
  "problem_ideas",
  "problems",
  "problems_grade",
  "story",
  "publish",
]);
type StageName = z.infer<typeof StageEnum>;
const STAGE_ORDER: StageName[] = StageEnum.options;

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
  stages: z.array(StageEnum).default([]),
});

type CliOptions = z.infer<typeof optionsSchema>;

type StageContext = {
  planIdeas?: string;
  plan?: SessionPlan;
  planGrade?: PlanGrade;
  quizzes?: readonly SessionQuiz[];
  quizzesGrade?: QuizzesGrade;
  problems?: readonly CodingProblem[];
  problemsGrade?: ProblemsGrade;
  story?: GenerateStoryResult;
};

const MetadataSchema = z.object({
  tagline: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
});

const METADATA_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["tagline", "emoji"],
  properties: {
    tagline: { type: Type.STRING },
    emoji: { type: Type.STRING },
  },
};

async function generateMetadata(
  topic: string,
  plan: SessionPlan,
  progress?: SessionGenerationPipeline["logger"],
) {
  const prompt = `
    Generate a catchy tagline (max 10 words) and a single emoji for a coding session about "${topic}".
    The session story is about: "${plan.story.storyTopic}".
    
    Return JSON with "tagline" and "emoji".
  `;

  return generateJson<{ tagline: string; emoji: string }>({
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: MetadataSchema,
    responseSchema: METADATA_RESPONSE_SCHEMA,
    progress,
  });
}

function convertPlan(plan: SessionPlan, storyPlanItemId: string) {
  return plan.parts.map((part) => {
    const base = {
      title: part.summary.split(".")[0] || "Session Part", // Simple title extraction
      summary: part.summary,
    };

    switch (part.kind) {
      case "story":
        return {
          ...base,
          id: storyPlanItemId,
          kind: "media",
          title: "The Story",
        };
      case "intro_quiz":
        return {
          ...base,
          id: "intro_quiz",
          kind: "quiz",
          title: "Warm-up",
        };
      case "coding_1":
        return {
          ...base,
          id: "p1",
          kind: "problem",
          title: "Challenge 1",
        };
      case "coding_2":
        return {
          ...base,
          id: "p2",
          kind: "problem",
          title: "Challenge 2",
        };
      case "wrap_up_quiz":
        return {
          ...base,
          id: "wrap_up_quiz",
          kind: "quiz",
          title: "Review",
        };
    }
  });
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

async function appendStageLog(
  baseDir: string,
  stage: StageName,
  lines: readonly string[],
): Promise<void> {
  const logDir = path.join(baseDir, "logs");
  await mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${stage}.log`);
  const timestamp = new Date().toISOString();
  const serialised = lines
    .map((line) => `[${timestamp}] ${line}`)
    .join("\n")
    .concat("\n");
  await appendFile(logPath, serialised, { encoding: "utf8" });
}

function resolveStageSequence(options: CliOptions): StageName[] {
  if (options.stages.length === 0) {
    return STAGE_ORDER;
  }
  const requested = new Set<StageName>(options.stages);
  return STAGE_ORDER.filter((stage) => requested.has(stage));
}

async function writeTemplateDoc(
  sessionId: string,
  topic: string,
  finalData: {
    plan: unknown[];
    tagline: string;
    emoji: string;
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

async function ensurePlanForStory(
  context: StageContext,
  pipeline: SessionGenerationPipeline,
): Promise<SessionPlan> {
  if (context.plan) {
    return context.plan;
  }
  const plan = await pipeline.ensurePlan();
  context.plan = plan;
  return plan;
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
    )
    .addOption(
      new Option("--stage <stage...>", "Stages to run").choices(STAGE_ORDER),
    )
    .addOption(
      new Option("--stages <stage...>", "Alias for --stage").choices(
        STAGE_ORDER,
      ),
    );

  program.parse(process.argv);

  const raw = program.opts<{
    topic: string;
    sessionId?: string;
    seed?: string;
    storyPlanItemId?: string;
    checkpointDir?: string;
    debugRootDir?: string;
    stage?: string[];
    stages?: string[];
  }>();

  const rawStages = [...(raw.stage ?? []), ...(raw.stages ?? [])];

  const parsed = optionsSchema.parse({
    topic: raw.topic,
    sessionId: raw.sessionId,
    seed: raw.seed,
    storyPlanItemId: raw.storyPlanItemId,
    checkpointDir: raw.checkpointDir,
    debugRootDir: raw.debugRootDir,
    stages: rawStages,
  });

  const targetSessionId = parsed.sessionId ?? slugifyTopic(parsed.topic);
  const checkpointDir =
    parsed.checkpointDir ?? resolveDefaultCheckpointDir(targetSessionId);
  const debugRootDir =
    parsed.debugRootDir ?? resolveDefaultDebugDir(targetSessionId);
  const baseDir = resolveSessionBaseDir(targetSessionId);

  console.log(
    `[welcome] generating session for topic "${parsed.topic}" (checkpointDir=${checkpointDir})`,
  );

  const stageContext: StageContext = {};
  const stageSequence = resolveStageSequence(parsed);

  await runJobsWithConcurrency({
    items: [parsed],
    concurrency: 1,
    getId: () => targetSessionId,
    label: `[welcome/${targetSessionId}]`,
    handler: async (_item, { progress }) => {
      const pipeline = new SessionGenerationPipeline({
        topic: parsed.topic,
        seed: parsed.seed,
        checkpointDir,
        debugRootDir,
        progress,
      });

      for (const stage of stageSequence) {
        progress.log(`[welcome/${targetSessionId}] stage: ${stage}`);
        await appendStageLog(baseDir, stage, ["stage started"]);

        switch (stage) {
          case "plan_ideas": {
            const ideas = await pipeline.ensurePlanIdeas();
            stageContext.planIdeas = ideas.markdown;
            const ideaLines = ideas.markdown.split("\n").length;
            progress.log(
              `[welcome/${targetSessionId}] plan ideas ready (${ideaLines} lines)`,
            );
            await appendStageLog(baseDir, stage, [
              `markdown lines=${ideaLines}`,
            ]);
            break;
          }
          case "plan": {
            const plan = await pipeline.ensurePlan();
            stageContext.plan = plan;
            progress.log(
              `[welcome/${targetSessionId}] plan ready (${plan.parts.length} parts, story topic="${plan.story.storyTopic}")`,
            );
            await appendStageLog(baseDir, stage, [
              `parts=${plan.parts.length}`,
              `storyTopic=${plan.story.storyTopic}`,
            ]);
            break;
          }
          case "plan_grade": {
            let lastGrade: PlanGrade | undefined;
            // 3 edit attempts, if all fail then retry from root (max 2 root retries)
            const MAX_EDIT_RETRIES = 3;
            const MAX_ROOT_RETRIES = 2;

            for (
              let rootAttempt = 1;
              rootAttempt <= MAX_ROOT_RETRIES + 1;
              rootAttempt++
            ) {
              let passed = false;
              for (
                let editAttempt = 1;
                editAttempt <= MAX_EDIT_RETRIES + 1;
                editAttempt++
              ) {
                const grade = await pipeline.ensurePlanGrade();
                lastGrade = grade;
                stageContext.planGrade = grade;

                const issues =
                  grade.issues.length > 0 ? grade.issues.join(" | ") : "none";
                progress.log(
                  `[welcome/${targetSessionId}] plan grade root=${rootAttempt} edit=${editAttempt}: ${grade.pass ? "pass" : "fail"} (issues=${issues})`,
                );
                await appendStageLog(baseDir, stage, [
                  `rootAttempt=${rootAttempt}`,
                  `editAttempt=${editAttempt}`,
                  `pass=${grade.pass}`,
                  `issues=${issues}`,
                ]);

                if (grade.pass) {
                  passed = true;
                  break;
                }

                if (editAttempt <= MAX_EDIT_RETRIES) {
                  progress.log(
                    `[welcome/${targetSessionId}] editing plan based on feedback...`,
                  );
                  const currentPlan = await pipeline.ensurePlan();
                  const newPlan = await pipeline.editPlan(currentPlan, grade);
                  stageContext.plan = newPlan;
                }
              }

              if (passed) {
                break;
              }

              if (rootAttempt <= MAX_ROOT_RETRIES) {
                progress.log(
                  `[welcome/${targetSessionId}] plan generation failed after edits. Retrying from scratch (new ideas)...`,
                );
                // Invalidate ideas so we get fresh ones
                await pipeline.invalidateStage("plan_ideas");
                // This will also clear 'plan' and 'plan_grade' caches via downstream invalidation
                // Trigger regeneration
                await pipeline.ensurePlanIdeas();
                const newPlan = await pipeline.ensurePlan();
                stageContext.plan = newPlan;
              } else {
                throw new Error(
                  `Plan grading failed after ${MAX_ROOT_RETRIES + 1} root attempts (and ${MAX_EDIT_RETRIES} edits per attempt).`,
                );
              }
            }
            if (!lastGrade?.pass) {
              throw new Error("Plan grade did not pass");
            }
            break;
          }
          case "quiz_ideas": {
            const coverage = await pipeline.ensureQuizIdeas();
            stageContext.planIdeas =
              stageContext.planIdeas ?? coverage.markdown;
            const lineCount = coverage.markdown.split("\n").length;
            progress.log(
              `[welcome/${targetSessionId}] quiz coverage ready (${lineCount} lines)`,
            );
            await appendStageLog(baseDir, stage, [
              `markdown lines=${lineCount}`,
            ]);
            break;
          }
          case "quizzes": {
            const quizzes = await pipeline.ensureQuizzes();
            stageContext.quizzes = quizzes;
            progress.log(
              `[welcome/${targetSessionId}] quizzes ready (${quizzes.length} quizzes)`,
            );
            await appendStageLog(baseDir, stage, [
              `count=${quizzes.length}`,
              `ids=${quizzes.map((quiz) => quiz.quiz_id).join(",")}`,
            ]);
            break;
          }
          case "quizzes_grade": {
            let lastGrade: QuizzesGrade | undefined;
            for (
              let attempt = 1;
              attempt <= MAX_QUIZ_GRADE_RETRIES + 1;
              attempt += 1
            ) {
              const grade = await pipeline.ensureQuizzesGrade();
              lastGrade = grade;
              stageContext.quizzesGrade = grade;
              const issues =
                grade.issues.length > 0 ? grade.issues.join(" | ") : "none";
              progress.log(
                `[welcome/${targetSessionId}] quizzes grade attempt ${attempt}: ${grade.pass ? "pass" : "fail"} (issues=${issues})`,
              );
              await appendStageLog(baseDir, stage, [
                `attempt=${attempt}`,
                `pass=${grade.pass}`,
                `issues=${issues}`,
                `uncovered=${grade.uncovered_skills.join(",")}`,
              ]);
              if (grade.pass) {
                break;
              }
              if (attempt === MAX_QUIZ_GRADE_RETRIES + 1) {
                throw new Error(
                  `Quiz grading failed after ${MAX_QUIZ_GRADE_RETRIES + 1} attempts`,
                );
              }
              await pipeline.invalidateStage("quizzes");
              const regenerated = await pipeline.ensureQuizzes();
              stageContext.quizzes = regenerated;
            }
            if (!lastGrade?.pass) {
              throw new Error("Quizzes grade did not pass");
            }
            break;
          }
          case "problem_ideas": {
            const ideas = await pipeline.ensureProblemIdeas();
            stageContext.planIdeas = stageContext.planIdeas ?? ideas.markdown;
            const lineCount = ideas.markdown.split("\n").length;
            progress.log(
              `[welcome/${targetSessionId}] problem ideas ready (${lineCount} lines)`,
            );
            await appendStageLog(baseDir, stage, [
              `markdown lines=${lineCount}`,
            ]);
            break;
          }
          case "problems": {
            const problems = await pipeline.ensureProblems();
            stageContext.problems = problems;
            progress.log(
              `[welcome/${targetSessionId}] problems ready (${problems.length} problems)`,
            );
            await appendStageLog(baseDir, stage, [
              `count=${problems.length}`,
              `ids=${problems.map((problem) => problem.id).join(",")}`,
            ]);
            break;
          }
          case "problems_grade": {
            let lastGrade: ProblemsGrade | undefined;
            for (
              let attempt = 1;
              attempt <= MAX_PROBLEM_GRADE_RETRIES + 1;
              attempt += 1
            ) {
              const grade = await pipeline.ensureProblemsGrade();
              lastGrade = grade;
              stageContext.problemsGrade = grade;
              const issues =
                grade.issues.length > 0 ? grade.issues.join(" | ") : "none";
              progress.log(
                `[welcome/${targetSessionId}] problems grade attempt ${attempt}: ${grade.pass ? "pass" : "fail"} (issues=${issues})`,
              );
              await appendStageLog(baseDir, stage, [
                `attempt=${attempt}`,
                `pass=${grade.pass}`,
                `issues=${issues}`,
                `tooHard=${grade.too_hard_reasons.join(",")}`,
              ]);
              if (grade.pass) {
                break;
              }
              if (attempt === MAX_PROBLEM_GRADE_RETRIES + 1) {
                throw new Error(
                  `Problem grading failed after ${MAX_PROBLEM_GRADE_RETRIES + 1} attempts`,
                );
              }
              await pipeline.invalidateStage("problems");
              const regenerated = await pipeline.ensureProblems();
              stageContext.problems = regenerated;
            }
            if (!lastGrade?.pass) {
              throw new Error("Problems grade did not pass");
            }
            break;
          }
          case "story": {
            const plan = await ensurePlanForStory(stageContext, pipeline);
            const storyCheckpointDir = path.join(checkpointDir, "story");
            const storyDebugDir = path.join(debugRootDir, "story");
            const story = await generateStory({
              topic: plan.story.storyTopic,
              userId: TEMPLATE_USER_ID,
              sessionId: targetSessionId,
              planItemId: parsed.storyPlanItemId,
              progress,
              debugRootDir: storyDebugDir,
              checkpointDir: storyCheckpointDir,
            });
            stageContext.story = story;
            progress.log(
              `[welcome/${targetSessionId}] story ready ("${story.title}")`,
            );
            await appendStageLog(baseDir, stage, [`title=${story.title}`]);
            break;
          }
          case "publish": {
            const plan = await ensurePlanForStory(stageContext, pipeline);
            if (!stageContext.story) {
              throw new Error(
                "Cannot publish story assets before generating the story. Run the 'story' stage first.",
              );
            }
            await copyStoryToTemplate(
              targetSessionId,
              parsed.storyPlanItemId,
              stageContext.story,
            );

            // Generate metadata
            progress.log(
              `[welcome/${targetSessionId}] generating metadata (tagline, emoji)...`,
            );
            // Reuse pipeline logger
            const metadata = await generateMetadata(parsed.topic, plan, {
              log: (msg) => progress.log(msg),
              startModelCall: (d) => pipeline["logger"].startModelCall(d), // hack to access logger
              recordModelUsage: (h, c) =>
                pipeline["logger"].recordModelUsage(h, c),
              finishModelCall: (h) => pipeline["logger"].finishModelCall(h),
            });

            // Transform plan
            const finalPlan = convertPlan(plan, parsed.storyPlanItemId);

            await writeTemplateDoc(targetSessionId, parsed.topic, {
              plan: finalPlan,
              tagline: metadata.tagline,
              emoji: metadata.emoji,
              title: stageContext.story.title,
            });

            await appendStageLog(baseDir, stage, [
              "story media copied",
              "metadata generated",
              "template finalized",
            ]);
            progress.log(`[welcome/${targetSessionId}] session published!`);
            break;
          }
          default:
            throw new Error(`Unsupported stage ${stage satisfies never}`);
        }

        await appendStageLog(baseDir, stage, ["stage completed"]);
      }
    },
  });

  console.log(
    `[welcome/${targetSessionId}] stages complete (${stageSequence.join(", ")})`,
  );
}

void main().catch((error: unknown) => {
  console.error("[welcome] generation failed:", error);
  process.exitCode = 1;
});
