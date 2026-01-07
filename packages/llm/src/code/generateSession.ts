import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { generateJson, generateText, type LlmDebugOptions } from "../utils/llm";
import type { JobProgressReporter, LlmUsageChunk } from "../utils/concurrency";
import { errorAsString } from "../utils/error";
import { getFirebaseAdminFirestore } from "../utils/firebaseAdmin";
import {
  MAX_PROBLEM_ATTEMPTS,
  MAX_PROBLEM_GRADE_RETRIES,
  MAX_PROBLEM_SOLUTION_ATTEMPTS,
  ProblemPlanItemsSchema,
  ProblemSolutionsSchema,
  ProblemsGradeSchema,
  ProblemsSchema,
  PROBLEMS_GRADE_RESPONSE_SCHEMA,
  PROBLEMS_RESPONSE_SCHEMA,
  PROBLEM_TECHNIQUES_RESPONSE_SCHEMA,
  ProblemTechniquesSchema,
  buildProblemIdeasUserPrompt,
  buildProblemSolutionUserPrompt,
  buildProblemTechniquesUserPrompt,
  buildProblemsGenerateUserPrompt,
  buildProblemsGradeUserPrompt,
  extractPythonCode,
  normaliseProblemsPayload,
  runSolutionAgainstTests,
  type CodingProblem,
  type ProblemSolutions,
  type ProblemTechnique,
  type ProblemTechniquesPayload,
  type ProblemsGrade,
  type ProblemsPayload,
} from "./generateCodeProblems";
import {
  ASSUMPTIONS as HARD_CODED_ASSUMPTIONS,
  MAX_PLAN_ATTEMPTS,
  MAX_PLAN_GRADE_RETRIES,
  PlanGradeSchema,
  PLAN_GRADE_RESPONSE_SCHEMA,
  PLAN_PARSE_RESPONSE_SCHEMA,
  SessionPlanSchema,
  buildPlanEditUserPrompt,
  buildPlanGradeUserPrompt,
  buildPlanIdeasUserPrompt,
  buildPlanParseUserPrompt,
  type PlanGrade,
  type SessionPlan,
} from "./generateSessionPlan";
import {
  MAX_QUIZ_ATTEMPTS,
  MAX_QUIZ_GRADE_RETRIES,
  QUIZZES_GRADE_RESPONSE_SCHEMA,
  QUIZZES_RESPONSE_SCHEMA,
  QuizzesGradeSchema,
  QuizzesSchema,
  buildQuizIdeasUserPrompt,
  buildQuizzesGenerateUserPrompt,
  buildQuizzesGradeUserPrompt,
  type QuizzesGrade,
  type QuizzesPayload,
  type SessionQuiz,
} from "./generateQuizes";
import { generateStory } from "./generateStory";
import type { GenerateStoryResult } from "./generateStory";
import { buildSingleUserPrompt, TEXT_MODEL_ID } from "./sessionLlm";

export {
  SessionPlanSchema,
  PlanGradeSchema,
  type PlanGrade,
  type SessionPlan,
} from "./generateSessionPlan";
export {
  ProblemPlanItemsSchema,
  ProblemsSchema,
  ProblemsGradeSchema,
  ProblemSolutionsSchema,
  ProblemTechniquesSchema,
  extractPythonCode,
  runSolutionAgainstTests,
  type CodingProblem,
  type ProblemTechnique,
  type ProblemsGrade,
  type ProblemSolutions,
} from "./generateCodeProblems";
export { CodingProblemSchema } from "./generateCodeProblems";
export {
  QuizzesSchema,
  QuizzesGradeSchema,
  type SessionQuiz,
  type QuizzesGrade,
} from "./generateQuizes";

type SessionProgress = JobProgressReporter | undefined;

function useProgress(progress: SessionProgress): JobProgressReporter {
  return {
    log(message: string) {
      if (progress) {
        progress.log(message);
      } else {
        console.log(message);
      }
    },
    startModelCall(details: {
      modelId: string;
      uploadBytes: number;
      imageSize?: string;
    }) {
      if (progress) {
        return progress.startModelCall(details);
      }
      return Symbol("model-call");
    },
    recordModelUsage(handle: symbol, chunk: LlmUsageChunk) {
      if (progress) {
        progress.recordModelUsage(handle, chunk);
      }
    },
    finishModelCall(handle: symbol) {
      if (progress) {
        progress.finishModelCall(handle);
      }
    },
    startStage(stageName: string) {
      if (progress && progress.startStage) {
        return progress.startStage(stageName);
      }
      return Symbol("stage");
    },
    finishStage(handle: symbol) {
      if (progress && progress.finishStage) {
        progress.finishStage(handle);
      }
    },
    setActiveStages(stages: Iterable<string>) {
      if (progress && progress.setActiveStages) {
        progress.setActiveStages(stages);
      }
    },
  };
}

type PlanIdeasStageValue = {
  markdown: string;
};

type ProblemTechniquesStageValue = {
  techniques: ProblemTechnique[];
};

type ProblemSolutionsStageValue = {
  solutions: ProblemSolutions["solutions"];
};

type QuizIdeasStageValue = {
  markdown: string;
};

type ProblemIdeasStageValue = {
  markdown: string;
};

type StageCacheEntry<TValue> = {
  value: TValue;
  source: "checkpoint" | "generated";
  checkpointPath?: string;
};

type StageReadResult<TValue> = {
  value: TValue;
  filePath: string;
};

const MarkdownCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  lessonBriefHash: z.string().trim().min(1).optional(),
  markdown: z.string().trim().min(1),
});

function isEnoent(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
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

function applyHardCodedAssumptions(plan: SessionPlan): {
  plan: SessionPlan;
  changed: boolean;
} {
  const expected = Array.from(HARD_CODED_ASSUMPTIONS);
  const assumptionsMatch =
    plan.assumptions.length === expected.length &&
    plan.assumptions.every((assumption, index) => assumption === expected[index]);
  if (assumptionsMatch) {
    return { plan, changed: false };
  }
  return {
    plan: {
      ...plan,
      assumptions: expected,
    },
    changed: true,
  };
}

type SessionGenerationStageName =
  | "plan_ideas"
  | "plan"
  | "plan_grade"
  | "problem_techniques"
  | "problem_ideas"
  | "problems"
  | "problems_grade"
  | "problem_solutions"
  | "quiz_ideas"
  | "quizzes"
  | "quizzes_grade";

const SESSION_STAGE_ORDER: readonly SessionGenerationStageName[] = [
  "plan_ideas",
  "plan",
  "plan_grade",
  "problem_techniques",
  "problem_ideas",
  "problems",
  "problems_grade",
  "problem_solutions",
  "quiz_ideas",
  "quizzes",
  "quizzes_grade",
];

class ProblemReferenceSolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProblemReferenceSolutionError";
  }
}

class IndependentSolutionFailureError extends Error {
  constructor(
    readonly problemId: string,
    message: string,
  ) {
    super(message);
    this.name = "IndependentSolutionFailureError";
  }
}

type SessionGenerationPipelineOptions = {
  topic: string;
  lessonBrief?: string;
  seed?: number;
  checkpointDir?: string;
  debugRootDir?: string;
  progress?: SessionProgress;
  questionCounts?: {
    introQuiz?: number;
    wrapUpQuiz?: number;
  };
  pythonIndexUrl?: string;
};

type PlanIdeasCheckpoint = {
  topic: string;
  lessonBriefHash?: string;
  markdown: string;
};

type QuizIdeasCheckpoint = {
  topic: string;
  lessonBriefHash?: string;
  markdown: string;
};

type ProblemTechniquesCheckpoint = ProblemTechniquesPayload & {
  lessonBriefHash?: string;
};

type PlanCheckpoint = SessionPlan & {
  topic: string;
  lessonBriefHash?: string;
};

type PlanGradeCheckpoint = PlanGrade & {
  topic: string;
  lessonBriefHash?: string;
};

type QuizzesCheckpoint = {
  topic: string;
  lessonBriefHash?: string;
  quizzes: SessionQuiz[];
};

type QuizzesGradeCheckpoint = QuizzesGrade & {
  topic: string;
  lessonBriefHash?: string;
};

type ProblemIdeasCheckpoint = {
  topic: string;
  lessonBriefHash?: string;
  markdown: string;
};

type ProblemSolutionsCheckpoint = {
  topic: string;
  lessonBriefHash?: string;
  solutions: ProblemSolutions["solutions"];
};

type ProblemsCheckpoint = {
  topic: string;
  lessonBriefHash?: string;
  problems: CodingProblem[];
};

type ProblemsGradeCheckpoint = ProblemsGrade & {
  topic: string;
  lessonBriefHash?: string;
};

export class SessionGenerationPipeline {
  private readonly logger: JobProgressReporter;
  private readonly lessonBriefHash: string | undefined;

  private readonly caches: {
    planIdeas?: StageCacheEntry<PlanIdeasStageValue>;
    plan?: StageCacheEntry<SessionPlan>;
    planGrade?: StageCacheEntry<PlanGrade>;
    problemTechniques?: StageCacheEntry<ProblemTechniquesStageValue>;
    problemSolutions?: StageCacheEntry<ProblemSolutionsStageValue>;
    quizIdeas?: StageCacheEntry<QuizIdeasStageValue>;
    quizzes?: StageCacheEntry<QuizzesPayload>;
    quizzesGrade?: StageCacheEntry<QuizzesGrade>;
    problemIdeas?: StageCacheEntry<ProblemIdeasStageValue>;
    problems?: StageCacheEntry<ProblemsPayload>;
    problemsGrade?: StageCacheEntry<ProblemsGrade>;
  } = {};

  constructor(private readonly options: SessionGenerationPipelineOptions) {
    this.logger = useProgress(options.progress);
    this.lessonBriefHash = options.lessonBrief
      ? createHash("sha256").update(options.lessonBrief).digest("hex")
      : undefined;
  }

  private checkpointLessonBriefMatches(checkpointHash: unknown): boolean {
    const checkpoint =
      typeof checkpointHash === "string" && checkpointHash.trim().length > 0
        ? checkpointHash.trim()
        : undefined;
    if (this.lessonBriefHash) {
      return checkpoint === this.lessonBriefHash;
    }
    return checkpoint === undefined;
  }

  private get checkpointDir(): string | undefined {
    return this.options.checkpointDir;
  }

  private async withStage<T>(
    stage: SessionGenerationStageName,
    action: () => Promise<T>,
  ): Promise<T> {
    const handle = this.logger.startStage(stage);
    try {
      return await action();
    } finally {
      this.logger.finishStage(handle);
    }
  }

  private stageFile(stage: SessionGenerationStageName): string | undefined {
    if (!this.checkpointDir) {
      return undefined;
    }
    return path.join(this.checkpointDir, `${stage}.json`);
  }

  private clearStageCache(stage: SessionGenerationStageName): void {
    switch (stage) {
      case "plan_ideas":
        delete this.caches.planIdeas;
        break;
      case "plan":
        delete this.caches.plan;
        break;
      case "plan_grade":
        delete this.caches.planGrade;
        break;
      case "problem_techniques":
        delete this.caches.problemTechniques;
        break;
      case "problem_solutions":
        delete this.caches.problemSolutions;
        break;
      case "quiz_ideas":
        delete this.caches.quizIdeas;
        break;
      case "quizzes":
        delete this.caches.quizzes;
        break;
      case "quizzes_grade":
        delete this.caches.quizzesGrade;
        break;
      case "problem_ideas":
        delete this.caches.problemIdeas;
        break;
      case "problems":
        delete this.caches.problems;
        break;
      case "problems_grade":
        delete this.caches.problemsGrade;
        break;
    }
  }

  private async invalidateDownstreamStages(
    stage: SessionGenerationStageName,
  ): Promise<void> {
    const index = SESSION_STAGE_ORDER.indexOf(stage);
    if (index === -1) {
      return;
    }
    const downstream = SESSION_STAGE_ORDER.slice(index + 1);
    for (const name of downstream) {
      this.clearStageCache(name);
      const filePath = this.stageFile(name);
      if (filePath) {
        await rm(filePath, { force: true });
      }
    }
  }

  private async readPlanIdeasCheckpoint(): Promise<
    StageReadResult<PlanIdeasStageValue> | undefined
  > {
    const filePath = this.stageFile("plan_ideas");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as unknown;
      const result = MarkdownCheckpointSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan_ideas' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      if (result.data.topic !== this.options.topic) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan_ideas' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(result.data.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan_ideas' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      return { value: { markdown: result.data.markdown }, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writePlanIdeasCheckpoint(value: PlanIdeasStageValue) {
    const filePath = this.stageFile("plan_ideas");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: PlanIdeasCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      markdown: value.markdown,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(`[session/checkpoint] wrote 'plan_ideas' to ${filePath}`);
  }

  private async readPlanCheckpoint(): Promise<
    StageReadResult<SessionPlan> | undefined
  > {
    const filePath = this.stageFile("plan");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpointTopic = parsed?.topic;
      if (
        typeof checkpointTopic === "string" &&
        checkpointTopic !== this.options.topic
      ) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      const result = SessionPlanSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: result.data, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writePlanCheckpoint(value: SessionPlan) {
    const filePath = this.stageFile("plan");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: PlanCheckpoint = {
      ...value,
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(`[session/checkpoint] wrote 'plan' to ${filePath}`);
  }

  private async readPlanGradeCheckpoint(): Promise<
    StageReadResult<PlanGrade> | undefined
  > {
    const filePath = this.stageFile("plan_grade");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpointTopic = parsed?.topic;
      if (
        typeof checkpointTopic === "string" &&
        checkpointTopic !== this.options.topic
      ) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan_grade' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan_grade' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      const result = PlanGradeSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'plan_grade' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: result.data, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writePlanGradeCheckpoint(value: PlanGrade) {
    const filePath = this.stageFile("plan_grade");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: PlanGradeCheckpoint = {
      ...value,
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(`[session/checkpoint] wrote 'plan_grade' to ${filePath}`);
  }

  private async readProblemTechniquesCheckpoint(): Promise<
    StageReadResult<ProblemTechniquesStageValue> | undefined
  > {
    const filePath = this.stageFile("problem_techniques");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = ProblemTechniquesSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_techniques' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      if (result.data.topic !== this.options.topic) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_techniques' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_techniques' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      return {
        value: { techniques: result.data.techniques },
        filePath,
      };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProblemTechniquesCheckpoint(
    value: ProblemTechniquesStageValue,
  ) {
    const filePath = this.stageFile("problem_techniques");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: ProblemTechniquesCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      techniques: value.techniques,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(
      `[session/checkpoint] wrote 'problem_techniques' to ${filePath}`,
    );
  }

  private async readProblemSolutionsCheckpoint(): Promise<
    StageReadResult<ProblemSolutionsStageValue> | undefined
  > {
    const filePath = this.stageFile("problem_solutions");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = ProblemSolutionsSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_solutions' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      if (result.data.topic !== this.options.topic) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_solutions' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_solutions' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      return {
        value: { solutions: result.data.solutions },
        filePath,
      };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProblemSolutionsCheckpoint(
    value: ProblemSolutionsStageValue,
  ) {
    const filePath = this.stageFile("problem_solutions");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: ProblemSolutionsCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      solutions: value.solutions,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(
      `[session/checkpoint] wrote 'problem_solutions' to ${filePath}`,
    );
  }

  private async readQuizIdeasCheckpoint(): Promise<
    StageReadResult<QuizIdeasStageValue> | undefined
  > {
    const filePath = this.stageFile("quiz_ideas");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as unknown;
      const result = MarkdownCheckpointSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quiz_ideas' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      if (result.data.topic !== this.options.topic) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quiz_ideas' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(result.data.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quiz_ideas' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      return { value: { markdown: result.data.markdown }, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeQuizIdeasCheckpoint(value: QuizIdeasStageValue) {
    const filePath = this.stageFile("quiz_ideas");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: QuizIdeasCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      markdown: value.markdown,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(`[session/checkpoint] wrote 'quiz_ideas' to ${filePath}`);
  }

  private async readQuizzesCheckpoint(): Promise<
    StageReadResult<QuizzesPayload> | undefined
  > {
    const filePath = this.stageFile("quizzes");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpointTopic = parsed?.topic;
      if (
        typeof checkpointTopic === "string" &&
        checkpointTopic !== this.options.topic
      ) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quizzes' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quizzes' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      const result = QuizzesSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quizzes' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: result.data, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeQuizzesCheckpoint(value: QuizzesPayload) {
    const filePath = this.stageFile("quizzes");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: QuizzesCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      quizzes: value.quizzes,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(`[session/checkpoint] wrote 'quizzes' to ${filePath}`);
  }

  private async readQuizzesGradeCheckpoint(): Promise<
    StageReadResult<QuizzesGrade> | undefined
  > {
    const filePath = this.stageFile("quizzes_grade");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpointTopic = parsed?.topic;
      if (
        typeof checkpointTopic === "string" &&
        checkpointTopic !== this.options.topic
      ) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quizzes_grade' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quizzes_grade' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      const result = QuizzesGradeSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'quizzes_grade' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: result.data, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeQuizzesGradeCheckpoint(value: QuizzesGrade) {
    const filePath = this.stageFile("quizzes_grade");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: QuizzesGradeCheckpoint = {
      ...value,
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(
      `[session/checkpoint] wrote 'quizzes_grade' to ${filePath}`,
    );
  }

  private async readProblemIdeasCheckpoint(): Promise<
    StageReadResult<ProblemIdeasStageValue> | undefined
  > {
    const filePath = this.stageFile("problem_ideas");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as unknown;
      const result = MarkdownCheckpointSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_ideas' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      if (result.data.topic !== this.options.topic) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_ideas' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(result.data.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problem_ideas' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      return { value: { markdown: result.data.markdown }, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProblemIdeasCheckpoint(value: ProblemIdeasStageValue) {
    const filePath = this.stageFile("problem_ideas");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: ProblemIdeasCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      markdown: value.markdown,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(
      `[session/checkpoint] wrote 'problem_ideas' to ${filePath}`,
    );
  }

  private async readProblemsCheckpoint(): Promise<
    StageReadResult<ProblemsPayload> | undefined
  > {
    const filePath = this.stageFile("problems");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpointTopic = parsed?.topic;
      if (
        typeof checkpointTopic === "string" &&
        checkpointTopic !== this.options.topic
      ) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problems' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problems' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      const result = ProblemsSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problems' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: result.data, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProblemsCheckpoint(value: ProblemsPayload) {
    const filePath = this.stageFile("problems");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: ProblemsCheckpoint = {
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
      problems: value.problems,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(`[session/checkpoint] wrote 'problems' to ${filePath}`);
  }

  private async readProblemsGradeCheckpoint(): Promise<
    StageReadResult<ProblemsGrade> | undefined
  > {
    const filePath = this.stageFile("problems_grade");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const checkpointTopic = parsed?.topic;
      if (
        typeof checkpointTopic === "string" &&
        checkpointTopic !== this.options.topic
      ) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problems_grade' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (!this.checkpointLessonBriefMatches(parsed?.lessonBriefHash)) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problems_grade' checkpoint at ${filePath} (lesson brief mismatch)`,
        );
        return undefined;
      }
      const result = ProblemsGradeSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.log(
          `[session/checkpoint] ignoring 'problems_grade' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: result.data, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProblemsGradeCheckpoint(value: ProblemsGrade) {
    const filePath = this.stageFile("problems_grade");
    if (!filePath || !this.checkpointDir) {
      return;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: ProblemsGradeCheckpoint = {
      ...value,
      topic: this.options.topic,
      lessonBriefHash: this.lessonBriefHash,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    this.logger.log(
      `[session/checkpoint] wrote 'problems_grade' to ${filePath}`,
    );
  }

  private createDebugOptions(
    stage: string,
    subStage?: string,
  ): LlmDebugOptions | undefined {
    if (!this.options.debugRootDir) {
      return undefined;
    }
    return {
      rootDir: this.options.debugRootDir,
      stage,
      subStage,
    };
  }

  private async ensurePlanIdeasInternal(): Promise<
    StageCacheEntry<PlanIdeasStageValue>
  > {
    if (this.caches.planIdeas) {
      return this.caches.planIdeas;
    }
    const checkpoint = await this.readPlanIdeasCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'plan_ideas' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<PlanIdeasStageValue> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.planIdeas = entry;
      return entry;
    }

    return this.withStage("plan_ideas", async () => {
      for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt += 1) {
        const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(MAX_PLAN_ATTEMPTS).padStart(2, "0")}`;
        try {
          const debugOptions = this.createDebugOptions(
            "plan-ideas",
            attemptLabel,
          );
          const userPrompt = buildPlanIdeasUserPrompt(
            this.options.topic,
            this.options.seed,
            this.options.lessonBrief,
          );
          this.logger.log(
            `[session/plan-ideas] generating plan ideas (${attemptLabel})`,
          );
          const contents = buildSingleUserPrompt(
            `Expert CS educator generating engaging beginner-friendly Python lesson ideas. Produce diverse concepts that align story, promised skills, and five-part progression. Difficulty is “easy”; assume learners only know: ${HARD_CODED_ASSUMPTIONS.map((assumption) => `"${assumption}"`).join(", ")}. Call out any new concepts you introduce.`,
            userPrompt,
          );
          const markdown = await generateText({
            modelId: TEXT_MODEL_ID,
            contents,
            progress: this.logger,
            debug: debugOptions,
          });
          const value: PlanIdeasStageValue = { markdown };
          await this.writePlanIdeasCheckpoint(value);
          const entry: StageCacheEntry<PlanIdeasStageValue> = {
            value,
            source: "generated",
          };
          this.caches.planIdeas = entry;
          return entry;
        } catch (error) {
          const message = errorAsString(error);
          this.logger.log(
            `[session/plan-ideas] attempt ${attempt} failed (${message})`,
          );
          if (attempt === MAX_PLAN_ATTEMPTS) {
            throw new Error(
              `Plan idea generation failed after ${MAX_PLAN_ATTEMPTS} attempts: ${message}`,
            );
          }
        }
      }
      throw new Error("Plan idea generation failed");
    });
  }

  async ensurePlanIdeas(): Promise<PlanIdeasStageValue> {
    const entry = await this.ensurePlanIdeasInternal();
    return entry.value;
  }

  private async ensurePlanInternal(): Promise<StageCacheEntry<SessionPlan>> {
    if (this.caches.plan) {
      return this.caches.plan;
    }
    const checkpoint = await this.readPlanCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'plan' from ${checkpoint.filePath}`,
      );
      const hardened = applyHardCodedAssumptions(checkpoint.value);
      if (hardened.changed) {
        this.logger.log(
          `[session/plan] overwriting assumptions in restored plan checkpoint at ${checkpoint.filePath}`,
        );
        await this.writePlanCheckpoint(hardened.plan);
      }
      const entry: StageCacheEntry<SessionPlan> = {
        value: hardened.plan,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.plan = entry;
      return entry;
    }

    const { value: planIdeas } = await this.ensurePlanIdeasInternal();
    return this.withStage("plan", async () => {
      const userPrompt = buildPlanParseUserPrompt(planIdeas.markdown);
      const debugOptions = this.createDebugOptions("plan-parse");
      this.logger.log("[session/plan] parsing ideas into plan JSON");
      const planJson = await generateJson<SessionPlan>({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "Convert Markdown ideas into plan JSON. Enforce ordering, coverage of required skills, and difficulty.",
          userPrompt,
        ),
        responseSchema: PLAN_PARSE_RESPONSE_SCHEMA,
        schema: SessionPlanSchema,
        progress: this.logger,
        debug: debugOptions,
      });
      const hardened = applyHardCodedAssumptions(planJson);
      await this.writePlanCheckpoint(hardened.plan);
      const entry: StageCacheEntry<SessionPlan> = {
        value: hardened.plan,
        source: "generated",
      };
      this.caches.plan = entry;
      return entry;
    });
  }

  async ensurePlan(): Promise<SessionPlan> {
    const entry = await this.ensurePlanInternal();
    return entry.value;
  }

  private async ensurePlanGradeInternal(): Promise<StageCacheEntry<PlanGrade>> {
    if (this.caches.planGrade) {
      return this.caches.planGrade;
    }
    const checkpoint = await this.readPlanGradeCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'plan_grade' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<PlanGrade> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.planGrade = entry;
      return entry;
    }
    const plan = await this.ensurePlan();
    return this.withStage("plan_grade", async () => {
      const userPrompt = buildPlanGradeUserPrompt(plan);
      const debugOptions = this.createDebugOptions("plan-grade");
      this.logger.log("[session/plan-grade] grading plan");
      const grade = await generateJson<PlanGrade>({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "Rubric QA, diagnose only.",
          userPrompt,
        ),
        responseSchema: PLAN_GRADE_RESPONSE_SCHEMA,
        schema: PlanGradeSchema,
        progress: this.logger,
        debug: debugOptions,
      });
      await this.writePlanGradeCheckpoint(grade);
      const entry: StageCacheEntry<PlanGrade> = {
        value: grade,
        source: "generated",
      };
      this.caches.planGrade = entry;
      return entry;
    });
  }

  async ensurePlanGrade(): Promise<PlanGrade> {
    const entry = await this.ensurePlanGradeInternal();
    return entry.value;
  }

  private async ensureProblemTechniquesInternal(): Promise<
    StageCacheEntry<ProblemTechniquesStageValue>
  > {
    if (this.caches.problemTechniques) {
      return this.caches.problemTechniques;
    }
    const checkpoint = await this.readProblemTechniquesCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'problem_techniques' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<ProblemTechniquesStageValue> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.problemTechniques = entry;
      return entry;
    }
    return this.withStage("problem_techniques", async () => {
      const plan = await this.ensurePlan();
      const userPrompt = buildProblemTechniquesUserPrompt(
        plan,
        this.options.lessonBrief,
      );
      const debugOptions = this.createDebugOptions("problem-techniques");
      this.logger.log("[session/problem-techniques] extracting techniques");
      const payload = await generateJson<ProblemTechniquesPayload>({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "List concrete techniques learners must know before solving the problems.",
          userPrompt,
        ),
        responseSchema: PROBLEM_TECHNIQUES_RESPONSE_SCHEMA,
        schema: ProblemTechniquesSchema,
        progress: this.logger,
        debug: debugOptions,
      });
      const value: ProblemTechniquesStageValue = {
        techniques: payload.techniques,
      };
      await this.writeProblemTechniquesCheckpoint(value);
      const entry: StageCacheEntry<ProblemTechniquesStageValue> = {
        value,
        source: "generated",
      };
      this.caches.problemTechniques = entry;
      return entry;
    });
  }

  async ensureProblemTechniques(): Promise<ProblemTechnique[]> {
    const entry = await this.ensureProblemTechniquesInternal();
    return entry.value.techniques;
  }

  async editPlan(
    currentPlan: SessionPlan,
    grade: PlanGrade,
  ): Promise<SessionPlan> {
    const userPrompt = buildPlanEditUserPrompt(currentPlan, grade);
    const debugOptions = this.createDebugOptions("plan-edit");
    this.logger.log("[session/plan-edit] editing plan based on feedback");

    const planJson = await generateJson<SessionPlan>({
      modelId: TEXT_MODEL_ID,
      contents: buildSingleUserPrompt(
        "Fix the session plan based on the grading feedback. Maintain JSON structure.",
        userPrompt,
      ),
      responseSchema: PLAN_PARSE_RESPONSE_SCHEMA,
      schema: SessionPlanSchema,
      progress: this.logger,
      debug: debugOptions,
    });

    const hardened = applyHardCodedAssumptions(planJson);
    await this.writePlanCheckpoint(hardened.plan);
    const entry: StageCacheEntry<SessionPlan> = {
      value: hardened.plan,
      source: "generated",
    };
    this.caches.plan = entry;

    await this.invalidateStage("plan_grade");
    return hardened.plan;
  }

  private async ensureQuizIdeasInternal(): Promise<
    StageCacheEntry<QuizIdeasStageValue>
  > {
    if (this.caches.quizIdeas) {
      return this.caches.quizIdeas;
    }
    const checkpoint = await this.readQuizIdeasCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'quiz_ideas' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<QuizIdeasStageValue> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.quizIdeas = entry;
      return entry;
    }
    const planEntry = await this.ensurePlanInternal();
    const plan = planEntry.value;
    const planIdeas = await this.ensurePlanIdeas();
    const techniques = await this.ensureProblemTechniques();
    const problems = await this.ensureProblems();
    return this.withStage("quiz_ideas", async () => {
      for (let attempt = 1; attempt <= MAX_QUIZ_ATTEMPTS; attempt += 1) {
        const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(MAX_QUIZ_ATTEMPTS).padStart(2, "0")}`;
        try {
          const debugOptions = this.createDebugOptions(
            "quiz-ideas",
            attemptLabel,
          );
          const userPrompt = buildQuizIdeasUserPrompt(
            plan,
            techniques,
            problems,
            planIdeas.markdown,
            this.options.seed,
            this.options.lessonBrief,
          );
          this.logger.log(
            `[session/quiz-ideas] generating coverage markdown (${attemptLabel})`,
          );
          const coverageMarkdown = await generateText({
            modelId: TEXT_MODEL_ID,
            contents: buildSingleUserPrompt(
              "Expand plan into quiz coverage ensuring primers precede practice and every technique is taught before coding.",
              userPrompt,
            ),
            progress: this.logger,
            debug: debugOptions,
          });
          const value: QuizIdeasStageValue = { markdown: coverageMarkdown };
          await this.writeQuizIdeasCheckpoint(value);
          const entry: StageCacheEntry<QuizIdeasStageValue> = {
            value,
            source: "generated",
          };
          this.caches.quizIdeas = entry;
          return entry;
        } catch (error) {
          const message = errorAsString(error);
          this.logger.log(
            `[session/quiz-ideas] attempt ${attempt} failed (${message})`,
          );
          if (attempt === MAX_QUIZ_ATTEMPTS) {
            throw new Error(
              `Quiz idea generation failed after ${MAX_QUIZ_ATTEMPTS} attempts: ${message}`,
            );
          }
        }
      }
      throw new Error("Quiz idea generation failed");
    });
  }

  async ensureQuizIdeas(): Promise<QuizIdeasStageValue> {
    const entry = await this.ensureQuizIdeasInternal();
    return entry.value;
  }

  private validateQuizCounts(quizzes: QuizzesPayload): void {
    const introCount =
      typeof this.options.questionCounts?.introQuiz === "number" &&
      this.options.questionCounts.introQuiz > 0
        ? this.options.questionCounts.introQuiz
        : 15;
    const wrapCount =
      typeof this.options.questionCounts?.wrapUpQuiz === "number" &&
      this.options.questionCounts.wrapUpQuiz > 0
        ? this.options.questionCounts.wrapUpQuiz
        : 10;
    let introQuestions = 0;
    let wrapQuestions = 0;
    for (const quiz of quizzes.quizzes) {
      if (quiz.quiz_id === "intro_quiz") {
        introQuestions = quiz.questions.length;
      } else if (quiz.quiz_id === "wrap_up_quiz") {
        wrapQuestions = quiz.questions.length;
      }
    }
    if (introQuestions !== introCount) {
      throw new Error(
        `intro_quiz expected ${introCount} questions but found ${introQuestions}`,
      );
    }
    if (wrapQuestions !== wrapCount) {
      throw new Error(
        `wrap_up_quiz expected ${wrapCount} questions but found ${wrapQuestions}`,
      );
    }
  }

  private async ensureQuizzesInternal(): Promise<
    StageCacheEntry<QuizzesPayload>
  > {
    if (this.caches.quizzes) {
      return this.caches.quizzes;
    }
    const checkpoint = await this.readQuizzesCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'quizzes' from ${checkpoint.filePath}`,
      );
      this.validateQuizCounts(checkpoint.value);
      const entry: StageCacheEntry<QuizzesPayload> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.quizzes = entry;
      return entry;
    }
    const plan = await this.ensurePlan();
    const quizIdeas = await this.ensureQuizIdeas();
    const techniques = await this.ensureProblemTechniques();
    const problems = await this.ensureProblems();
    return this.withStage("quizzes", async () => {
      const userPrompt = buildQuizzesGenerateUserPrompt(
        plan,
        quizIdeas.markdown,
        problems,
        techniques,
        this.options.questionCounts,
        this.options.lessonBrief,
      );
      const debugOptions = this.createDebugOptions("quizzes-generate");
      this.logger.log("[session/quizzes] generating quiz JSON");
      const quizzes = await generateJson<QuizzesPayload>({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "Produce final quizzes with concise explanations, optional theory blocks, and explicit technique coverage.",
          userPrompt,
        ),
        responseSchema: QUIZZES_RESPONSE_SCHEMA,
        schema: QuizzesSchema,
        progress: this.logger,
        debug: debugOptions,
      });
      this.validateQuizCounts(quizzes);
      await this.writeQuizzesCheckpoint(quizzes);
      const entry: StageCacheEntry<QuizzesPayload> = {
        value: quizzes,
        source: "generated",
      };
      this.caches.quizzes = entry;
      return entry;
    });
  }

  async ensureQuizzes(): Promise<readonly SessionQuiz[]> {
    const entry = await this.ensureQuizzesInternal();
    return entry.value.quizzes;
  }

  private async ensureQuizzesGradeInternal(): Promise<
    StageCacheEntry<QuizzesGrade>
  > {
    if (this.caches.quizzesGrade) {
      return this.caches.quizzesGrade;
    }
    const checkpoint = await this.readQuizzesGradeCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'quizzes_grade' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<QuizzesGrade> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.quizzesGrade = entry;
      return entry;
    }
    const plan = await this.ensurePlan();
    const quizzes = await this.ensureQuizzes();
    const techniques = await this.ensureProblemTechniques();
    return this.withStage("quizzes_grade", async () => {
      const userPrompt = buildQuizzesGradeUserPrompt(
        plan,
        quizzes,
        techniques,
        this.options.questionCounts,
        this.options.lessonBrief,
      );
      const debugOptions = this.createDebugOptions("quizzes-grade");
      this.logger.log("[session/quizzes-grade] grading quizzes");
      const grade = await generateJson<QuizzesGrade>({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "QA quizzes for coverage, theory, clarity, and technique readiness for problems.",
          userPrompt,
        ),
        responseSchema: QUIZZES_GRADE_RESPONSE_SCHEMA,
        schema: QuizzesGradeSchema,
        progress: this.logger,
        debug: debugOptions,
      });
      await this.writeQuizzesGradeCheckpoint(grade);
      const entry: StageCacheEntry<QuizzesGrade> = {
        value: grade,
        source: "generated",
      };
      this.caches.quizzesGrade = entry;
      return entry;
    });
  }

  async ensureQuizzesGrade(): Promise<QuizzesGrade> {
    const entry = await this.ensureQuizzesGradeInternal();
    return entry.value;
  }

  private async ensureProblemIdeasInternal(): Promise<
    StageCacheEntry<ProblemIdeasStageValue>
  > {
    if (this.caches.problemIdeas) {
      return this.caches.problemIdeas;
    }
    const checkpoint = await this.readProblemIdeasCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'problem_ideas' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<ProblemIdeasStageValue> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.problemIdeas = entry;
      return entry;
    }
    const plan = await this.ensurePlan();
    const techniques = await this.ensureProblemTechniques();
    return this.withStage("problem_ideas", async () => {
      for (let attempt = 1; attempt <= MAX_PROBLEM_ATTEMPTS; attempt += 1) {
        const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(MAX_PROBLEM_ATTEMPTS).padStart(2, "0")}`;
        try {
          const debugOptions = this.createDebugOptions(
            "problem-ideas",
            attemptLabel,
          );
          const userPrompt = buildProblemIdeasUserPrompt(
            plan,
            techniques,
            this.options.seed,
            this.options.lessonBrief,
          );
          this.logger.log(
            `[session/problem-ideas] generating markdown (${attemptLabel})`,
          );
          const markdown = await generateText({
            modelId: TEXT_MODEL_ID,
            contents: buildSingleUserPrompt(
              "Generate full Problem Specs Markdown (p1 and p2) with verified examples and tests.",
              userPrompt,
            ),
            tools: [{ type: "code-execution" }],
            progress: this.logger,
            debug: debugOptions,
          });
          const value: ProblemIdeasStageValue = { markdown };
          await this.writeProblemIdeasCheckpoint(value);
          const entry: StageCacheEntry<ProblemIdeasStageValue> = {
            value,
            source: "generated",
          };
          this.caches.problemIdeas = entry;
          return entry;
        } catch (error) {
          const message = errorAsString(error);
          this.logger.log(
            `[session/problem-ideas] attempt ${attempt} failed (${message})`,
          );
          if (attempt === MAX_PROBLEM_ATTEMPTS) {
            throw new Error(
              `Problem idea generation failed after ${MAX_PROBLEM_ATTEMPTS} attempts: ${message}`,
            );
          }
        }
      }
      throw new Error("Problem idea generation failed");
    });
  }

  async ensureProblemIdeas(): Promise<ProblemIdeasStageValue> {
    const entry = await this.ensureProblemIdeasInternal();
    return entry.value;
  }

  private async validateReferenceSolutions(
    payload: ProblemsPayload,
  ): Promise<void> {
    const failures: string[] = [];
    for (const problem of payload.problems) {
      const result = await runSolutionAgainstTests(
        problem,
        problem.reference_solution_py,
        this.options.pythonIndexUrl,
      );
      if (result.length === 0) {
        continue;
      }
      const summary = result
        .map((failure) => {
          const label =
            failure.index >= 0 ? `test ${failure.index + 1}` : "setup";
          return `${problem.id} ${label}: ${failure.message}`;
        })
        .join("; ");
      failures.push(summary);
    }
    if (failures.length === 0) {
      return;
    }
    throw new ProblemReferenceSolutionError(
      `Reference solution validation failed (${failures.join("; ")})`,
    );
  }

  private async ensureProblemsInternal(): Promise<
    StageCacheEntry<ProblemsPayload>
  > {
    if (this.caches.problems) {
      return this.caches.problems;
    }
    const checkpoint = await this.readProblemsCheckpoint();
    let problemsPayload: ProblemsPayload;
    let source: StageCacheEntry<ProblemsPayload>["source"] = "generated";
    let checkpointPath: string | undefined;
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'problems' from ${checkpoint.filePath}`,
      );
      problemsPayload = checkpoint.value;
      source = "checkpoint";
      checkpointPath = checkpoint.filePath;
    } else {
      problemsPayload = await this.withStage("problems", async () => {
        const plan = await this.ensurePlan();
        const problemIdeas = await this.ensureProblemIdeas();
        const techniques = await this.ensureProblemTechniques();
        const userPrompt = buildProblemsGenerateUserPrompt(
          plan,
          problemIdeas.markdown,
          techniques,
          this.options.lessonBrief,
        );
        const debugOptions = this.createDebugOptions("problems-generate");
        this.logger.log("[session/problems] generating coding problems");
        const rawProblems = await generateJson<ProblemsPayload>({
          modelId: TEXT_MODEL_ID,
          contents: buildSingleUserPrompt(
            "Produce full beginner-friendly specs with reference solutions and tests that use only the listed techniques.",
            userPrompt,
          ),
          responseSchema: PROBLEMS_RESPONSE_SCHEMA,
          schema: ProblemsSchema,
          progress: this.logger,
          debug: debugOptions,
        });
        const cleaned = normaliseProblemsPayload(rawProblems);
        return ProblemsSchema.parse(cleaned);
      });
    }

    this.logger.log("[session/problems] validating reference solutions");
    await this.validateReferenceSolutions(problemsPayload);
    await this.writeProblemsCheckpoint(problemsPayload);
    const entry: StageCacheEntry<ProblemsPayload> = {
      value: problemsPayload,
      source,
      checkpointPath,
    };
    this.caches.problems = entry;
    return entry;
  }

  private async solveProblemsWithIndependentSolver(
    payload: ProblemsPayload,
  ): Promise<ProblemsPayload> {
    const solvedProblems: CodingProblem[] = [];
    for (const problem of payload.problems) {
      const solution = await this.generateIndependentSolution(problem);
      solvedProblems.push({
        ...problem,
        reference_solution_py: solution,
      });
    }
    return { ...payload, problems: solvedProblems };
  }

  private applySolutionsToProblems(
    problems: readonly CodingProblem[],
    solutions: ReadonlyArray<ProblemSolutions["solutions"][number]>,
  ): CodingProblem[] {
    return problems.map((problem) => {
      const solved = solutions.find((solution) => solution.id === problem.id);
      if (!solved) {
        return problem;
      }
      return { ...problem, reference_solution_py: solved.solution_py };
    });
  }

  private summariseSolutionFailures(
    problem: CodingProblem,
    failures: ReadonlyArray<{ index: number; message: string }>,
  ): string {
    if (failures.length === 0) {
      return "";
    }
    const tests = [...problem.tests.public, ...(problem.tests.private ?? [])];
    const publicCount = problem.tests.public.length;
    const lines: string[] = [
      "Previous attempt failed the following tests. Fix the logic to satisfy these cases and re-run them with the code execution tool before returning the final <CODE> block:",
    ];
    for (const failure of failures) {
      if (failure.index < 0 || failure.index >= tests.length) {
        lines.push(`- setup: ${failure.message}`);
        continue;
      }
      const test = tests[failure.index];
      const label =
        failure.index < publicCount
          ? `public test #${failure.index + 1}`
          : `private test #${failure.index - publicCount + 1}`;
      lines.push(
        `- ${label} (input: ${test.input} => expected: ${test.output}) - ${failure.message}`,
      );
    }
    return lines.join("\n");
  }

  private async generateIndependentSolution(
    problem: CodingProblem,
  ): Promise<string> {
    let previousFailures: { index: number; message: string }[] | null = null;
    for (
      let attempt = 1;
      attempt <= MAX_PROBLEM_SOLUTION_ATTEMPTS;
      attempt += 1
    ) {
      const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(MAX_PROBLEM_SOLUTION_ATTEMPTS).padStart(2, "0")}`;
      const debugOptions = this.createDebugOptions(
        "problem-solution",
        `${problem.id}-${attemptLabel}`,
      );
      const failureNote =
        previousFailures && previousFailures.length > 0
          ? `\n\n${this.summariseSolutionFailures(problem, previousFailures)}`
          : "";
      const userPrompt = `${buildProblemSolutionUserPrompt(problem)}${failureNote}`;
      this.logger.log(
        `[session/problem-solution] solving ${problem.id} (${attemptLabel})`,
      );
      const solutionText = await generateText({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "Solve the problem using only the provided statement and examples. Use the code execution tool to verify; wrap ONLY the final code in <CODE>...</CODE>.",
          userPrompt,
        ),
        tools: [{ type: "code-execution" }],
        progress: this.logger,
        debug: debugOptions,
      });
      const candidate = extractPythonCode(solutionText);
      const failures = await runSolutionAgainstTests(
        problem,
        candidate,
        this.options.pythonIndexUrl,
      );
      if (failures.length === 0) {
        return candidate;
      }
      const firstFailure = failures[0];
      const failureSummary =
        firstFailure && firstFailure.index >= 0
          ? `test ${firstFailure.index + 1}: ${firstFailure.message}`
          : (firstFailure?.message ?? "unknown failure");
      this.logger.log(
        `[session/problem-solution] ${problem.id} ${attemptLabel} failed (${failureSummary})`,
      );
      previousFailures = failures;
    }
    throw new IndependentSolutionFailureError(
      problem.id,
      `Failed to validate independent solution for problem ${problem.id} after ${MAX_PROBLEM_SOLUTION_ATTEMPTS} attempts`,
    );
  }

  async ensureProblems(): Promise<readonly CodingProblem[]> {
    const entry = await this.ensureProblemsInternal();
    return entry.value.problems;
  }

  private async ensureProblemsGradeInternal(): Promise<
    StageCacheEntry<ProblemsGrade>
  > {
    if (this.caches.problemsGrade) {
      return this.caches.problemsGrade;
    }
    const checkpoint = await this.readProblemsGradeCheckpoint();
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'problems_grade' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<ProblemsGrade> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.problemsGrade = entry;
      return entry;
    }
    const plan = await this.ensurePlan();
    const problems = await this.ensureProblems();
    const techniques = await this.ensureProblemTechniques();
    return this.withStage("problems_grade", async () => {
      const userPrompt = buildProblemsGradeUserPrompt(
        plan,
        problems,
        techniques,
        this.options.lessonBrief,
      );
      const debugOptions = this.createDebugOptions("problems-grade");
      this.logger.log("[session/problems-grade] grading coding problems");
      const grade = await generateJson<ProblemsGrade>({
        modelId: TEXT_MODEL_ID,
        contents: buildSingleUserPrompt(
          "QA problems for alignment, clarity, difficulty, and technique alignment.",
          userPrompt,
        ),
        responseSchema: PROBLEMS_GRADE_RESPONSE_SCHEMA,
        schema: ProblemsGradeSchema,
        progress: this.logger,
        debug: debugOptions,
      });
      await this.writeProblemsGradeCheckpoint(grade);
      const entry: StageCacheEntry<ProblemsGrade> = {
        value: grade,
        source: "generated",
      };
      this.caches.problemsGrade = entry;
      return entry;
    });
  }

  async ensureProblemsGrade(): Promise<ProblemsGrade> {
    const entry = await this.ensureProblemsGradeInternal();
    return entry.value;
  }

  private async ensureProblemSolutionsInternal(): Promise<
    StageCacheEntry<ProblemSolutionsStageValue>
  > {
    if (this.caches.problemSolutions) {
      return this.caches.problemSolutions;
    }
    const checkpoint = await this.readProblemSolutionsCheckpoint();
    const problemsEntry = await this.ensureProblemsInternal();
    const problemsPayload = problemsEntry.value;
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'problem_solutions' from ${checkpoint.filePath}`,
      );
      const mergedProblems = this.applySolutionsToProblems(
        problemsPayload.problems,
        checkpoint.value.solutions,
      );
      const mergedPayload: ProblemsPayload = { problems: mergedProblems };
      await this.writeProblemsCheckpoint(mergedPayload);
      const mergedProblemsEntry: StageCacheEntry<ProblemsPayload> = {
        value: mergedPayload,
        source: problemsEntry.source,
        checkpointPath: problemsEntry.checkpointPath,
      };
      this.caches.problems = mergedProblemsEntry;
      const entry: StageCacheEntry<ProblemSolutionsStageValue> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.problemSolutions = entry;
      return entry;
    }

    return this.withStage("problem_solutions", async () => {
      const solvedPayload =
        await this.solveProblemsWithIndependentSolver(problemsPayload);
      const solutions: ProblemSolutions["solutions"] =
        solvedPayload.problems.map((problem) => ({
          id: problem.id,
          solution_py: problem.reference_solution_py,
        }));
      const value: ProblemSolutionsStageValue = { solutions };
      await this.writeProblemSolutionsCheckpoint(value);
      await this.writeProblemsCheckpoint(solvedPayload);
      const updatedProblemsEntry: StageCacheEntry<ProblemsPayload> = {
        value: solvedPayload,
        source: problemsEntry.source,
        checkpointPath: problemsEntry.checkpointPath,
      };
      this.caches.problems = updatedProblemsEntry;
      const entry: StageCacheEntry<ProblemSolutionsStageValue> = {
        value,
        source: "generated",
      };
      this.caches.problemSolutions = entry;
      return entry;
    });
  }

  async ensureProblemSolutions(): Promise<ProblemSolutionsStageValue> {
    const entry = await this.ensureProblemSolutionsInternal();
    return entry.value;
  }

  async invalidateStagesAfter(
    stage: SessionGenerationStageName,
  ): Promise<void> {
    await this.invalidateDownstreamStages(stage);
  }

  async invalidateStage(stage: SessionGenerationStageName): Promise<void> {
    this.clearStageCache(stage);
    const filePath = this.stageFile(stage);
    if (filePath) {
      await rm(filePath, { force: true });
    }
    await this.invalidateDownstreamStages(stage);
  }
}

async function persistProblemSolutionsToFirestore(options: {
  userId: string;
  sessionId: string;
  problems: readonly CodingProblem[];
  logger: JobProgressReporter;
}): Promise<void> {
  const { userId, sessionId, problems, logger } = options;
  try {
    const firestore = getFirebaseAdminFirestore();
    const batch = firestore.batch();
    const sessionDoc = firestore
      .collection("spark")
      .doc(userId)
      .collection("sessions")
      .doc(sessionId);

    for (const problem of problems) {
      const docRef = sessionDoc.collection("solutions").doc(problem.id);
      const publicCount = problem.tests.public.length;
      const privateCount = problem.tests.private?.length ?? 0;
      batch.set(docRef, {
        problemId: problem.id,
        language: "python",
        solution_py: problem.reference_solution_py,
        tests_checked: publicCount + privateCount,
        source: "independent_solver",
        updatedAt: Timestamp.now(),
      });
    }

    await batch.commit();
    logger.log(
      `[session/problem-solution] stored ${problems.length} solutions for session '${sessionId}'`,
    );
  } catch (error) {
    const message = errorAsString(error);
    logger.log(
      `[session/problem-solution] failed to store solutions in Firestore (${message})`,
    );
    throw new Error(
      `Failed to store problem solutions in Firestore: ${message}`,
    );
  }
}

type SessionGenerationQuestionCounts =
  SessionGenerationPipelineOptions["questionCounts"];

export type GenerateSessionOptions = {
  topic: string;
  lessonBrief?: string;
  seed?: number;
  checkpointDir?: string;
  debugRootDir?: string;
  progress?: JobProgressReporter;
  questionCounts?: SessionGenerationQuestionCounts;
  pythonIndexUrl?: string;
  userId: string;
  sessionId?: string;
  storyPlanItemId: string;
  storagePrefix?: string;
  includeStory?: boolean;
};

export type GenerateSessionResult = {
  sessionId: string;
  slug: string;
  plan: SessionPlan;
  planGrade: PlanGrade;
  quizzes: readonly SessionQuiz[];
  quizzesGrade: QuizzesGrade;
  problems: readonly CodingProblem[];
  problemsGrade: ProblemsGrade;
  story?: GenerateStoryResult;
};

async function solveProblemsWithRetries(options: {
  pipeline: SessionGenerationPipeline;
  logger: JobProgressReporter;
}): Promise<boolean> {
  const { pipeline, logger } = options;
  for (let attempt = 1; attempt <= MAX_PROBLEM_ATTEMPTS; attempt += 1) {
    try {
      await pipeline.ensureProblemSolutions();
      return true;
    } catch (error) {
      if (error instanceof IndependentSolutionFailureError) {
        logger.log(
          `[session/problem-solution] independent solver failed for ${error.problemId} (attempt ${attempt} of ${MAX_PROBLEM_ATTEMPTS})`,
        );
        if (attempt === MAX_PROBLEM_ATTEMPTS) {
          logger.log(
            `[session/problem-solution] exhausted solver retries for ${error.problemId}`,
          );
          return false;
        }
        continue;
      }
      throw error;
    }
  }
  return false;
}

export async function generateSession(
  options: GenerateSessionOptions,
): Promise<GenerateSessionResult> {
  const logger = useProgress(options.progress);
  const includeStory = options.includeStory ?? true;
  const pipeline = new SessionGenerationPipeline({
    topic: options.topic,
    lessonBrief: options.lessonBrief,
    seed: options.seed,
    checkpointDir: options.checkpointDir,
    debugRootDir: options.debugRootDir,
    questionCounts: options.questionCounts,
    pythonIndexUrl: options.pythonIndexUrl,
    progress: options.progress,
  });

  let plan: SessionPlan | undefined;
  let planGrade: PlanGrade | undefined;
  for (let attempt = 1; attempt <= 1 + MAX_PLAN_GRADE_RETRIES; attempt += 1) {
    plan = await pipeline.ensurePlan();
    planGrade = await pipeline.ensurePlanGrade();
    if (planGrade.pass) {
      break;
    }
    if (attempt === 1 + MAX_PLAN_GRADE_RETRIES) {
      throw new Error(
        `Plan grading failed after ${MAX_PLAN_GRADE_RETRIES + 1} attempts: ${planGrade.issues.join("; ")}`,
      );
    }
    plan = await pipeline.editPlan(plan, planGrade);
  }

  if (!plan || !planGrade) {
    throw new Error("Plan generation failed");
  }

  let problems: readonly CodingProblem[] | undefined;
  let problemsGrade: ProblemsGrade | undefined;
  for (
    let attempt = 1;
    attempt <= 1 + MAX_PROBLEM_GRADE_RETRIES;
    attempt += 1
  ) {
    try {
      problems = await pipeline.ensureProblems();
    } catch (error) {
      if (error instanceof ProblemReferenceSolutionError) {
        logger.log(
          `[session/problems] reference solution check failed (attempt ${attempt} of ${MAX_PROBLEM_GRADE_RETRIES + 1}): ${error.message}`,
        );
        if (attempt === 1 + MAX_PROBLEM_GRADE_RETRIES) {
          throw new Error(
            `Problem generation failed after ${MAX_PROBLEM_GRADE_RETRIES + 1} attempts: ${error.message}`,
          );
        }
        await pipeline.invalidateStage("problem_ideas");
        await pipeline.invalidateStage("problems");
        continue;
      }
      throw error;
    }
    problemsGrade = await pipeline.ensureProblemsGrade();
    if (problemsGrade.pass) {
      const solved = await solveProblemsWithRetries({ pipeline, logger });
      if (solved) {
        break;
      }
      if (attempt === 1 + MAX_PROBLEM_GRADE_RETRIES) {
        throw new Error(
          `Problem solving failed after ${MAX_PROBLEM_GRADE_RETRIES + 1} attempts`,
        );
      }
      await pipeline.invalidateStage("problems");
      continue;
    }
    if (attempt === 1 + MAX_PROBLEM_GRADE_RETRIES) {
      throw new Error(
        `Problem grading failed after ${MAX_PROBLEM_GRADE_RETRIES + 1} attempts: ${problemsGrade.issues.join("; ")}`,
      );
    }
    await pipeline.invalidateStage("problem_ideas");
  }

  if (!problems || !problemsGrade) {
    throw new Error("Problem generation failed");
  }

  problems = await pipeline.ensureProblems();
  ProblemPlanItemsSchema.parse(problems);

  let quizzes: readonly SessionQuiz[] | undefined;
  let quizzesGrade: QuizzesGrade | undefined;
  for (let attempt = 1; attempt <= 1 + MAX_QUIZ_GRADE_RETRIES; attempt += 1) {
    quizzes = await pipeline.ensureQuizzes();
    quizzesGrade = await pipeline.ensureQuizzesGrade();
    if (quizzesGrade.pass) {
      break;
    }
    if (attempt === 1 + MAX_QUIZ_GRADE_RETRIES) {
      throw new Error(
        `Quiz grading failed after ${MAX_QUIZ_GRADE_RETRIES + 1} attempts: ${quizzesGrade.issues.join("; ")}`,
      );
    }
    await pipeline.invalidateStage("quizzes");
  }

  if (!quizzes || !quizzesGrade) {
    throw new Error("Quiz generation failed");
  }

  const slug = slugifyTopic(options.topic);
  const sessionId = options.sessionId ?? slug;

  await persistProblemSolutionsToFirestore({
    userId: options.userId,
    sessionId,
    problems,
    logger,
  });

  const techniques = await pipeline.ensureProblemTechniques();

  let story: GenerateStoryResult | undefined;
  if (includeStory) {
    story = await generateStory({
      topic: plan.story.storyTopic,
      userId: options.userId,
      sessionId,
      planItemId: options.storyPlanItemId,
      storagePrefix: options.storagePrefix,
      progress: options.progress,
      debugRootDir: options.debugRootDir,
      checkpointDir: options.checkpointDir
        ? path.join(options.checkpointDir, "story")
        : undefined,
      lessonContext: {
        planTopic: plan.topic,
        promisedSkills: plan.promised_skills,
        techniques,
        problems: problems.map((problem) => {
          const summary =
            problem.statement_md.split("\n").find((line) => line.trim()) ??
            problem.statement_md.slice(0, 160);
          return {
            id: problem.id,
            title: problem.title,
            story_callback: problem.story_callback,
            summary: summary.trim(),
          };
        }),
        storyHook: {
          storyTopic: plan.story.storyTopic,
          protagonist: plan.story.protagonist,
          anchor_event: plan.story.anchor_event,
          anchor_year: plan.story.anchor_year,
          anchor_place: plan.story.anchor_place,
          stakes: plan.story.stakes,
          analogy_seed: plan.story.analogy_seed,
          modern_tie_in: plan.story.modern_tie_in,
          visual_motif: plan.story.visual_motif,
          naming_note: plan.story.naming_note,
        },
      },
    });
  }

  return {
    sessionId,
    slug,
    plan,
    planGrade,
    quizzes,
    quizzesGrade,
    problems,
    problemsGrade,
    story,
  };
}
