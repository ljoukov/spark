import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { Timestamp } from "firebase-admin/firestore";
import { Type, type Schema } from "@google/genai";
import { loadPyodide } from "pyodide";
import { z } from "zod";

import {
  generateJson,
  generateText,
  type LlmContent,
  type LlmDebugOptions,
} from "../utils/llm";
import type { JobProgressReporter, LlmUsageChunk } from "../utils/concurrency";
import { errorAsString } from "../utils/error";
import { getFirebaseAdminFirestore } from "../utils/firebaseAdmin";
import { generateStory } from "./generateStory";
import type { GenerateStoryResult } from "./generateStory";

const TEXT_MODEL_ID = "gemini-3-pro-preview" as const;

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
    startModelCall(details: { modelId: string; uploadBytes: number }) {
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

function buildSingleUserPrompt(
  systemInstruction: string,
  userPrompt: string,
): LlmContent[] {
  const trimmedSystem = systemInstruction.trim();
  const trimmedUser = userPrompt.trim();
  const combined =
    trimmedSystem.length > 0
      ? `${trimmedSystem}\n\n${trimmedUser}`
      : trimmedUser;
  return [
    {
      role: "user",
      parts: [{ type: "text", text: combined }],
    },
  ];
}

function normaliseProblemsPayload(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === "object" &&
    payload !== null &&
    "problems" in payload &&
    Array.isArray((payload as { problems?: unknown[] }).problems)
  ) {
    const original = payload as { problems: unknown[] };
    const normalisedProblems = original.problems.map((problem) => {
      if (
        problem &&
        typeof problem === "object" &&
        problem !== null &&
        "function" in problem
      ) {
        const fn = (problem as { function: unknown }).function;
        if (fn && typeof fn === "object" && fn !== null && "returns" in fn) {
          const returnsValue = (fn as { returns: unknown }).returns;
          let returns = returnsValue;
          if (
            returnsValue &&
            typeof returnsValue === "object" &&
            returnsValue !== null &&
            "type" in returnsValue &&
            typeof (returnsValue as { type: unknown }).type === "string"
          ) {
            returns = (returnsValue as { type: string }).type;
          }
          return {
            ...(problem as Record<string, unknown>),
            function: {
              ...(fn as Record<string, unknown>),
              returns,
            },
            tests: (() => {
              const tests = (problem as { tests?: unknown }).tests;
              if (
                tests &&
                typeof tests === "object" &&
                "private" in tests &&
                Array.isArray((tests as { private?: unknown[] }).private)
              ) {
                const privateTests = (tests as { private: unknown[] }).private;
                const privateCount = Number.isFinite(
                  (tests as { private_count?: unknown }).private_count,
                )
                  ? (tests as { private_count?: number }).private_count
                  : privateTests.length;
                return {
                  ...(tests as Record<string, unknown>),
                  private_count: privateCount,
                };
              }
              return (problem as { tests?: unknown }).tests;
            })(),
          };
        }
      }
      return problem;
    });
    return {
      ...(payload as Record<string, unknown>),
      problems: normalisedProblems,
    };
  }
  return payload;
}

const ASSUMPTIONS = [
  "basic Python syntax",
  "lists",
  "integer division (//)",
  "modulo (%)",
] as const;

const MAX_PLAN_ATTEMPTS = 3;
const MAX_PLAN_GRADE_RETRIES = 2;
const MAX_QUIZ_ATTEMPTS = 3;
const MAX_QUIZ_GRADE_RETRIES = 2;
const MAX_PROBLEM_ATTEMPTS = 3;
const MAX_PROBLEM_GRADE_RETRIES = 2;
const MAX_PROBLEM_SOLUTION_ATTEMPTS = 2;
const PLAN_LIMITS = {
  topic: 120,
  assumption: 80,
  story: {
    storyTopic: 120,
    protagonist: 120,
    anchorEvent: 160,
    anchorYear: 12,
    anchorPlace: 120,
    stakes: 200,
    analogySeed: 180,
    modernTieIn: 120,
    visualMotif: 160,
    namingNote: 160,
  },
  partSummary: 160,
  promisedSkill: 80,
  concept: 120,
  blueprintTitle: 120,
  blueprintIdea: 600,
  blueprintSkill: 80,
  blueprintConstraint: 160,
} as const;

const PlanPartSchema = z.object({
  order: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  kind: z.enum(["story", "intro_quiz", "coding_1", "coding_2", "wrap_up_quiz"]),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(PLAN_LIMITS.partSummary)
    .superRefine((value, ctx) => {
      const words = value.split(/\s+/).filter((part) => part.length > 0);
      if (words.length > 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "summary must be 15 words or fewer",
        });
      }
    }),
});

const CodingBlueprintSchema = z.object({
  id: z.enum(["p1", "p2"]),
  title: z.string().trim().min(1).max(PLAN_LIMITS.blueprintTitle),
  idea: z.string().trim().min(1).max(PLAN_LIMITS.blueprintIdea),
  required_skills: z
    .array(z.string().trim().min(1).max(PLAN_LIMITS.blueprintSkill))
    .min(1),
  constraints: z
    .array(z.string().trim().min(1).max(PLAN_LIMITS.blueprintConstraint))
    .optional(),
});

export const SessionPlanSchema = z
  .object({
    topic: z.string().trim().min(1).max(PLAN_LIMITS.topic),
    difficulty: z.enum(["easy", "medium", "hard"]),
    assumptions: z.array(z.string().trim().min(1).max(PLAN_LIMITS.assumption)),
    story: z.object({
      storyTopic: z.string().trim().min(1).max(PLAN_LIMITS.story.storyTopic),
      protagonist: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.protagonist)
        .optional(),
      anchor_event: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.anchorEvent)
        .optional(),
      anchor_year: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.anchorYear)
        .optional(),
      anchor_place: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.anchorPlace)
        .optional(),
      stakes: z.string().trim().min(1).max(PLAN_LIMITS.story.stakes).optional(),
      analogy_seed: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.analogySeed)
        .optional(),
      modern_tie_in: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.modernTieIn)
        .optional(),
      visual_motif: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.visualMotif)
        .optional(),
      naming_note: z
        .string()
        .trim()
        .min(1)
        .max(PLAN_LIMITS.story.namingNote)
        .optional(),
    }),
    parts: z.array(PlanPartSchema).length(5),
    promised_skills: z
      .array(z.string().trim().min(1).max(PLAN_LIMITS.promisedSkill))
      .min(1),
    concepts_to_teach: z.array(
      z.string().trim().min(1).max(PLAN_LIMITS.concept),
    ),
    coding_blueprints: z.array(CodingBlueprintSchema).length(2),
  })
  .superRefine((data, ctx) => {
    const requiredIds = new Set(["p1", "p2"]);
    for (const blueprint of data.coding_blueprints) {
      requiredIds.delete(blueprint.id);
    }
    if (requiredIds.size > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `coding_blueprints missing ids: ${Array.from(requiredIds).join(", ")}`,
      });
    }
    const expectedKinds = [
      "story",
      "intro_quiz",
      "coding_1",
      "coding_2",
      "wrap_up_quiz",
    ];
    data.parts.forEach((part, index) => {
      const expectedOrder = index + 1;
      if (part.order !== expectedOrder) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parts[${index}] order expected ${expectedOrder} but received ${part.order}`,
        });
      }
      if (part.kind !== expectedKinds[index]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parts[${index}] kind expected ${expectedKinds[index]} but received ${part.kind}`,
        });
      }
    });
  });

export type SessionPlan = z.infer<typeof SessionPlanSchema>;

const PlanGradeSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim()).default([]),
  missing_skills: z.array(z.string().trim()).default([]),
  suggested_edits: z.array(z.string().trim()).default([]),
});

export type PlanGrade = z.infer<typeof PlanGradeSchema>;

const MarkdownCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
});

const QuizTheoryBlockSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  content_md: z.string().trim().min(1),
});

const QuizQuestionBaseSchema = z.object({
  id: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  explanation: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).min(1),
  covers_techniques: z.array(z.string().trim().min(1)).min(1),
});

const QuizQuestionMcqSchema = QuizQuestionBaseSchema.extend({
  type: z.literal("mcq"),
  options: z.array(z.string().trim().min(1)).min(2),
  correct: z.string().trim().min(1),
});

const QuizQuestionMultiSchema = QuizQuestionBaseSchema.extend({
  type: z.literal("multi"),
  options: z.array(z.string().trim().min(1)).min(2),
  correct: z.array(z.string().trim().min(1)).min(2),
});

const QuizQuestionShortSchema = QuizQuestionBaseSchema.extend({
  type: z.literal("short"),
  correct: z.string().trim().min(1),
});

const QuizQuestionNumericSchema = QuizQuestionBaseSchema.extend({
  type: z.literal("numeric"),
  correct: z.string().trim().min(1),
});

const QuizQuestionCodeReadingSchema = QuizQuestionBaseSchema.extend({
  type: z.literal("code_reading"),
  correct: z.string().trim().min(1),
});

const QuizQuestionSchema = z.discriminatedUnion("type", [
  QuizQuestionMcqSchema,
  QuizQuestionMultiSchema,
  QuizQuestionShortSchema,
  QuizQuestionNumericSchema,
  QuizQuestionCodeReadingSchema,
]);

const SessionQuizSchema = z.object({
  quiz_id: z.enum(["intro_quiz", "wrap_up_quiz"]),
  theory_blocks: z.array(QuizTheoryBlockSchema).optional(),
  questions: z.array(QuizQuestionSchema).min(1),
});

export type SessionQuiz = z.infer<typeof SessionQuizSchema>;

const QuizzesSchema = z.object({
  quizzes: z.array(SessionQuizSchema).superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const quiz of value) {
      if (seen.has(quiz.quiz_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate quiz_id '${quiz.quiz_id}'`,
        });
      }
      seen.add(quiz.quiz_id);
    }
    if (!seen.has("intro_quiz") || !seen.has("wrap_up_quiz")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "quizzes must include intro_quiz and wrap_up_quiz",
      });
    }
  }),
});

type QuizzesPayload = z.infer<typeof QuizzesSchema>;

const QuizzesGradeSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim()).default([]),
  uncovered_skills: z.array(z.string().trim()).default([]),
  missing_theory_for_concepts: z.array(z.string().trim()).default([]),
  missing_techniques: z.array(z.string().trim()).default([]),
});

export type QuizzesGrade = z.infer<typeof QuizzesGradeSchema>;

const CodingProblemFunctionParamSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
});

const CodingProblemExampleSchema = z.object({
  input: z.string().trim().min(1),
  output: z.string().trim().min(1),
  explanation: z.string().trim().min(1).optional(),
});

const CodingProblemTestsSchema = z
  .object({
    public: z
      .array(
        z.object({
          input: z.string().trim().min(1),
          output: z.string().transform((value) => value.trim()),
        }),
      )
      .min(1),
    private: z
      .array(
        z.object({
          input: z.string().trim().min(1),
          output: z.string().transform((value) => value.trim()),
        }),
      )
      .min(1)
      .max(10)
      .optional(),
    private_count: z.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const privateTests = Array.isArray(value.private) ? value.private : [];
    const hasPrivateList = privateTests.length > 0;
    if (!hasPrivateList && typeof value.private_count !== "number") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["private"],
        message: "Provide private tests or private_count",
      });
      return;
    }
    if (hasPrivateList && typeof value.private_count === "number") {
      const count = privateTests.length;
      if (value.private_count !== count) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["private_count"],
          message: `private_count ${value.private_count} must match private length ${count}`,
        });
      }
    }
  });

export const CodingProblemSchema = z.object({
  id: z.enum(["p1", "p2"]),
  title: z.string().trim().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  story_callback: z.string().trim().min(1),
  statement_md: z.string().trim().min(1),
  function: z.object({
    name: z.string().trim().min(1),
    signature: z.string().trim().min(1),
    params: z.array(CodingProblemFunctionParamSchema),
    returns: z.string().trim().min(1),
  }),
  constraints: z.array(z.string().trim().min(1)).min(1),
  examples: z.array(CodingProblemExampleSchema).min(1),
  edge_cases: z.array(z.string().trim().min(1)).min(1),
  hints: z.array(z.string().trim().min(1)).min(1),
  solution_overview_md: z.string().trim().min(1),
  reference_solution_py: z.string().trim().min(1),
  tests: CodingProblemTestsSchema,
});

export type CodingProblem = z.infer<typeof CodingProblemSchema>;

const ProblemsSchema = z.object({
  problems: z.array(CodingProblemSchema).superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const problem of value) {
      if (ids.has(problem.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate problem id '${problem.id}'`,
        });
      }
      ids.add(problem.id);
    }
    if (!ids.has("p1") || !ids.has("p2")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "problems must include ids p1 and p2",
      });
    }
  }),
});

type ProblemsPayload = z.infer<typeof ProblemsSchema>;

const ProblemsGradeSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim()).default([]),
  too_hard_reasons: z.array(z.string().trim()).default([]),
  misaligned_skills: z.array(z.string().trim()).default([]),
});

export type ProblemsGrade = z.infer<typeof ProblemsGradeSchema>;

const ProblemTechniqueSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  applies_to: z.array(z.enum(["p1", "p2"])).min(1),
  tags: z.array(z.string().trim().min(1)).min(1),
});

export type ProblemTechnique = z.infer<typeof ProblemTechniqueSchema>;

const ProblemTechniquesSchema = z.object({
  topic: z.string().trim().min(1),
  techniques: z.array(ProblemTechniqueSchema).min(1),
});

type ProblemTechniquesPayload = z.infer<typeof ProblemTechniquesSchema>;

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
  return trimmed.slice(0, 60) || "session";
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

type SessionGenerationPipelineOptions = {
  topic: string;
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
  markdown: string;
};

type QuizIdeasCheckpoint = {
  topic: string;
  markdown: string;
};

type ProblemTechniquesCheckpoint = ProblemTechniquesPayload;

type PlanCheckpoint = SessionPlan & {
  topic: string;
};

type PlanGradeCheckpoint = PlanGrade & {
  topic: string;
};

type QuizzesCheckpoint = {
  topic: string;
  quizzes: SessionQuiz[];
};

type QuizzesGradeCheckpoint = QuizzesGrade & {
  topic: string;
};

type ProblemIdeasCheckpoint = {
  topic: string;
  markdown: string;
};

type ProblemSolutionsCheckpoint = {
  topic: string;
  solutions: ProblemSolutions["solutions"];
};

type ProblemsCheckpoint = {
  topic: string;
  problems: CodingProblem[];
};

type ProblemsGradeCheckpoint = ProblemsGrade & {
  topic: string;
};

function buildPlanIdeasUserPrompt(topic: string, seed?: number): string {
  return [
    `Topic: "${topic}"`,
    `Seed: ${seed ?? "none"}`,
    "",
    "Task: Produce at least 3 distinct lesson ideas in Markdown.",
    "Each idea must include:",
    "- Title line",
    "- Story paragraph ending with `in todays's lesson...` that is historically grounded (no fictional worlds).",
    "- Historical Hook bullets: protagonist (name + role), specific event with year/place, and the stakes.",
    "- Analogy Seed: a one-sentence functional analogy that maps to the concept’s core behaviour.",
    "- Modern Tie-in Domain: one noun phrase to reserve for the ending pivot (keep it aligned to the lesson).",
    "- Visual Motif: one physical, period-appropriate object/scene to reuse in illustrations (no neon/abstract).",
    "- Naming Note (optional): why the concept/name stuck, if relevant and safe to include.",
    "- Five-Part Progression with numbered list (1 story, 2 intro/quiz, 3 first coding problem, 4 second coding problem, 5 wrap up quiz)",
    "- Promised Skills bullet list",
    "- Concepts To Teach list (may be empty)",
    "- Two Coding Blueprints with required skills; blueprint 2 must add at least one new concept/skill or pattern beyond blueprint 1 (not just bigger inputs or a light reskin)",
    "- Note any common pitfalls/limitations (preconditions, one-way theorems, false positives) that must be surfaced in quizzes",
    "- Call out any randomness or probabilistic steps and how to make them reproducible (fixed seeds, deterministic base sets) so grading and reference solutions are stable",
    "",
    "Use clear labels for each idea (e.g., Historical Hook, Analogy Seed, Modern Tie-in Domain, Visual Motif, Naming Note) so they can be parsed into the plan.",
  ].join("\n");
}

function buildPlanParseUserPrompt(markdown: string): string {
  return [
    "Schema: {topic, difficulty, assumptions, story{storyTopic, protagonist?, anchor_event?, anchor_year?, anchor_place?, stakes?, analogy_seed?, modern_tie_in?, visual_motif?, naming_note?}, parts[{order,kind,summary}], promised_skills[], concepts_to_teach[], coding_blueprints[{id,title,idea,required_skills[],constraints?[]}]}",
    `Include relevant assumptions from ${JSON.stringify(ASSUMPTIONS)}`,
    'Set "difficulty" to "easy", "medium", or "hard".',
    "Keep story.* strings compact: <=120 chars (stakes<=200, analogy_seed<=180, visual_motif<=15 words and <=160 chars).",
    "visual_motif must be one concrete object/scene only—no art styles, palettes, resolution tokens, or repeated adjectives.",
    "Parts must be exactly 1=story, 2=intro_quiz, 3=coding_1, 4=coding_2, 5=wrap_up_quiz.",
    "Each parts.summary must be crisp (10-15 words max) and focused on the learner task for that step.",
    "coding_blueprints must have ids p1 and p2.",
    "Populate story.* fields from the historical hook (protagonist, anchor event/year/place, stakes, analogy seed, modern tie-in domain, visual motif, naming note when present).",
    "Keep story fields concise, historical, and free of fictional settings.",
    "Output strict JSON only.",
    "",
    "Markdown ideas:",
    markdown,
  ].join("\n");
}

function buildPlanEditUserPrompt(plan: SessionPlan, grade: PlanGrade): string {
  return [
    "The following session plan received a failing grade.",
    "Please revise the plan to address the reported issues.",
    "Keep each part summary concise (no more than 15 words).",
    "",
    "Grading Report:",
    `Pass: ${grade.pass}`,
    `Issues: ${grade.issues.join("; ")}`,
    `Missing Skills: ${grade.missing_skills.join("; ")}`,
    `Suggested Edits: ${grade.suggested_edits.join("; ")}`,
    "",
    "Current Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Return the fully corrected SessionPlan JSON.",
  ].join("\n");
}

function buildPlanGradeUserPrompt(plan: SessionPlan): string {
  return [
    "Check rules:",
    "R1 parts ordered;",
    "R2 promised skills cover blueprint requirements;",
    "R3 concepts_to_teach referenced and manageable;",
    "R4 each parts.summary is concise (<=15 words) and specific;",
    "Output {pass:boolean, issues:string[], missing_skills:string[], suggested_edits:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
  ].join("\n");
}

function buildProblemTechniquesUserPrompt(plan: SessionPlan): string {
  return [
    `Topic: "${plan.topic}"`,
    "",
    "Extract the problem-solving techniques needed to solve the two coding problems implied by the coding_blueprints (ids p1 and p2).",
    "Techniques include algorithms, patterns, invariants, decomposition steps, edge-case handling, math shortcuts, and data structure choices. Keep them aligned to the plan difficulty and promised skills; avoid advanced or unseen topics.",
    "Include preconditions and failure modes (when the technique does NOT apply), and highlight common misconceptions to guard against. Identify which techniques are unique to p2 vs shared with p1. If any technique uses randomness or probabilistic testing, specify how to make it reproducible (fixed seeds, deterministic base sets) for solutions/tests.",
    'Return JSON {topic, techniques:[{id,title,summary,applies_to:["p1"|"p2"],tags[]}]} where:',
    "- ids are short stable tokens (e.g., t1, t2, t3);",
    "- summary explains why the technique matters and the maneuver to apply;",
    "- applies_to lists which problem(s) require it (p1, p2, or both);",
    "- tags reference promised_skills or concepts_to_teach that match the technique.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
  ].join("\n");
}

function buildQuizIdeasUserPrompt(
  plan: SessionPlan,
  techniques: readonly ProblemTechnique[],
  problems: readonly CodingProblem[],
  markdownPlanIdeas: string,
  seed?: number,
): string {
  return [
    `Topic: "${plan.topic}"`,
    `Seed: ${seed ?? "none"}`,
    "",
    "Provide Markdown describing intro and wrap-up quiz coverage that fully teaches the techniques required for the coding problems before students attempt them.",
    "Learners will see quizzes immediately after the story and BEFORE reading the coding problems, so the quizzes must stand alone without assuming the problem text or solution is known.",
    "Plan for a thorough warm-up with 15 purposeful questions and a focused review with 10 questions.",
    "Avoid quoting or previewing the reference solutions; keep the focus on concepts, patterns, and how to reason through the problems.",
    "Include theory primers when a technique or concept is not already covered by assumptions.",
    "List question stems with types and map them to promised skills AND technique ids.",
    "Call out misconceptions, preconditions, and limitations (e.g., when a heuristic can give false positives, or when a recurrence no longer fits) so quizzes can include checks on them.",
    "If any technique involves randomness or probabilistic error, include coverage on reproducibility (seeding/fixed witness sets) and on the residual error probability/one-way nature of the guarantee.",
    "Call out which techniques are introduced in theory blocks vs. practiced in questions (especially in the intro quiz).",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
    "",
    "Problems JSON:",
    JSON.stringify(problems, null, 2),
    "",
    "Original Plan Ideas:",
    markdownPlanIdeas,
  ].join("\n");
}

function buildQuizzesGenerateUserPrompt(
  plan: SessionPlan,
  coverageMarkdown: string,
  problems: readonly CodingProblem[],
  techniques: readonly ProblemTechnique[],
  questionCounts?: SessionGenerationPipelineOptions["questionCounts"],
): string {
  const introCount =
    typeof questionCounts?.introQuiz === "number" &&
    questionCounts.introQuiz > 0
      ? questionCounts.introQuiz
      : 15;
  const wrapCount =
    typeof questionCounts?.wrapUpQuiz === "number" &&
    questionCounts.wrapUpQuiz > 0
      ? questionCounts.wrapUpQuiz
      : 10;
  const constraints: string[] = [
    'Return a JSON object with a single key "quizzes" whose value is an array of exactly two quiz definitions.',
    'Each quiz definition must include "quiz_id" (either "intro_quiz" or "wrap_up_quiz"), optional "theory_blocks" (array of {id,title,content_md}), and "questions".',
    'Every question object must follow the schema: {"id","type","prompt","explanation","tags","covers_techniques", ...}. Use "options" (array of strings) and "correct" (string for mcq/short/numeric/code_reading, array of strings for multi). Do not use aliases like "stem", "answer", or "solution".',
    'If a question has only one correct answer, use "mcq" (not "multi"). For "multi", return at least two correct answers in the "correct" array.',
    "Each quiz uses varied question types (mcq, multi, short, numeric, code_reading).",
    `Intro quiz (warm-up) must have exactly ${introCount} questions; pace them from quick comprehension checks to slightly richer applications so the flow stays engaging, not repetitive.`,
    `Wrap-up quiz must have exactly ${wrapCount} questions to reinforce principles and transfer, not to memorize solutions.`,
    "Intro quiz must teach every technique required for p1/p2 before coding: include at least one intro question per technique and set covers_techniques to the matching ids.",
    'Quizzes come right after the story and before learners read the coding problems; never assume the problem text is known or refer to "in problem 1/2".',
    "Do not quote or paraphrase the reference solutions. If you include code_reading, write a fresh, minimal snippet that illustrates the principle instead of copying the problem solution.",
    "covers_techniques must use ids from the provided Problem Techniques JSON.",
    "If a technique or concept is not in assumptions, add a concise theory block before its first use.",
    "Tags must include promised skills, concept tags, and technique-aligned tags.",
    "Provide concise explanations that teach the technique being covered.",
    "Avoid filler: vary question styles and cognitive load (recall -> apply -> debug), and do not repeat near-identical prompts.",
    "For any technique with preconditions, one-way guarantees, or known pitfalls (e.g., heuristic tests with false positives, base must be coprime, recurrence that breaks on certain inputs), include at least one question that surfaces those limits.",
    "If any technique uses randomness or probabilistic sampling, add theory/questions on reproducibility (seeding or fixed witness sets) and on the residual probability of error.",
    "Do not wrap the JSON in Markdown fences or add commentary; output strict JSON only.",
  ];
  return [
    constraints.join("\n"),
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
    "",
    "Problems JSON:",
    JSON.stringify(problems, null, 2),
    "",
    "Quiz coverage Markdown:",
    coverageMarkdown,
  ].join("\n");
}

function buildQuizzesGradeUserPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
  techniques: readonly ProblemTechnique[],
  questionCounts?: SessionGenerationPipelineOptions["questionCounts"],
): string {
  const introCount =
    typeof questionCounts?.introQuiz === "number" &&
    questionCounts.introQuiz > 0
      ? questionCounts.introQuiz
      : 15;
  const wrapCount =
    typeof questionCounts?.wrapUpQuiz === "number" &&
    questionCounts.wrapUpQuiz > 0
      ? questionCounts.wrapUpQuiz
      : 10;
  return [
    `Fail if intro_quiz does not have exactly ${introCount} questions or wrap_up_quiz does not have exactly ${wrapCount}.`,
    "Ensure all required skills covered.",
    "Ensure theory blocks present when needed for new concepts.",
    "Ensure answers unambiguous and explanations correct.",
    "Ensure every technique required for p1/p2 appears in the intro quiz with at least one question covering it (covers_techniques).",
    "Ensure quizzes stand alone even if the learner has not read the coding problems; avoid referencing the problem text or quoting reference solutions (code_reading snippets must be fresh teaching examples, not lifted from solutions).",
    "Fail if the question set is repetitive definition-drills without conceptual application, debugging, or limitation checks.",
    "Fail if techniques with preconditions/one-way guarantees lack any question that tests their limits or misuse cases (e.g., false positives, missing coprimality, recurrence invalid cases).",
    "Fail if techniques that use randomness/probabilistic sampling lack any coverage of reproducibility (seeding/fixed witnesses) or residual error probability.",
    "Flag any question that tests memorization of a provided solution rather than understanding of the underlying principle.",
    "Output {pass:boolean, issues:string[], uncovered_skills:string[], missing_theory_for_concepts:string[], missing_techniques:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
    "",
    "Quizzes JSON:",
    JSON.stringify(quizzes, null, 2),
  ].join("\n");
}

function buildProblemIdeasUserPrompt(
  plan: SessionPlan,
  techniques: readonly ProblemTechnique[],
  seed?: number,
): string {
  return [
    `Topic: "${plan.topic}"`,
    `Seed: ${seed ?? "none"}`,
    "",
    'Return "Problem Specs Markdown" with two sections titled "### p1" and "### p2".',
    "Each section must contain the FULL problem spec (no JSON) with these labeled fields in order:",
    "- Title:",
    "- Difficulty: (easy|medium|hard)",
    "- Story callback:",
    "- Statement:",
    "- Function name:",
    "- Function signature:",
    "- Params: (name and type list)",
    "- Returns:",
    "- Constraints:",
    "- Examples: (at least two; include input, output, and explanation)",
    "- Edge cases:",
    "- Hints:",
    "- Solution overview:",
    "- Reference solution (Python code block):",
    "- Public tests: (3-5 cases; list as input => output)",
    "- Private tests: (3-8 cases; list as input => output)",
    "Generate and VERIFY all examples and public/private tests against the reference solution using the code execution tool; fix the spec until they pass.",
    "The two problems must be clearly different: p2 must introduce a distinct goal/data shape/recurrence and require at least one additional technique beyond p1 (not a trivial re-skin).",
    "Explicitly call out any preconditions/limitations/pitfalls inside the Statement, Constraints, or Hints (e.g., one-way heuristics, coprime requirements, recurrence break cases, reproducibility if randomness is involved).",
    "Avoid non-deterministic behavior; if sampling is needed, include a seed or fixed witness list so tests are stable.",
    "Avoid advanced structures unless declared; stay within the provided techniques per problem id.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
    "",
    "REMEMBER: Use code execution tool run reference solution agains EACH of public and EACH of private tests and MAKE SURE THEY PASS.",
    "CRITICAL: problem and solution and tests should be CONSISTENT in that solution should solve the problem and all tests SHOULD PASS",
  ].join("\n");
}

function buildProblemsGenerateUserPrompt(
  plan: SessionPlan,
  problemIdeasMarkdown: string,
  techniques: readonly ProblemTechnique[],
): string {
  return [
    'Parse the "Problem Specs Markdown" below (sections "### p1" and "### p2") into a JSON object with key "problems" whose value is an array with exactly two entries (ids "p1" and "p2").',
    "Do NOT invent or alter content—carry over titles, statements, constraints, examples, hints, reference solutions, and ALL tests exactly as given. Preserve inputs/outputs verbatim (escape newlines with \\n).",
    "Each problem must include fields: id, title, difficulty (easy|medium|hard), story_callback, statement_md, function {name, signature, params[{name,type}], returns}, constraints (string[]), examples (array of {input:string, output:string, explanation?}), edge_cases (string[]), hints (string[]), solution_overview_md, reference_solution_py, tests {public:[{input:string, output:string}], private:[{input:string, output:string}], private_count:int}.",
    "Do not re-run or change tests; just transcribe them into JSON. If something appears malformed, choose the most literal faithful transcription rather than patching logic.",
    "Do not include backslash-based notation (no LaTeX like \\ge or ad-hoc escapes inside prose); write comparisons and symbols in plain words. Only use backslashes for JSON newlines (\\\\n) where needed.",
    "Keep p1/p2 unique and map each spec to its matching id; do not swap or merge content.",
    'Do not include extra fields such as "prompt", "solution", or "private_tests". Do not wrap the JSON in Markdown fences or add commentary.',
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Specs Markdown:",
    problemIdeasMarkdown,
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
  ].join("\n");
}

function buildProblemsGradeUserPrompt(
  plan: SessionPlan,
  problems: readonly CodingProblem[],
  techniques: readonly ProblemTechnique[],
): string {
  return [
    "Check each problem is easy, specs precise, skills aligned, reference solutions correct.",
    "Fail if p1 and p2 are not meaningfully different (no reused statements, tests, or function goals).",
    "Fail if problems rely on techniques not listed for their applies_to ids or introduce advanced concepts absent from assumptions/techniques.",
    "Output {pass:boolean, issues:string[], too_hard_reasons:string[], misaligned_skills:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
    "",
    "Problems JSON:",
    JSON.stringify(problems, null, 2),
  ].join("\n");
}

const PLAN_PART_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["order", "kind", "summary"],
  propertyOrdering: ["order", "kind", "summary"],
  properties: {
    order: { type: Type.NUMBER, minimum: 1, maximum: 5 },
    kind: {
      type: Type.STRING,
      enum: ["story", "intro_quiz", "coding_1", "coding_2", "wrap_up_quiz"],
    },
    summary: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.partSummary),
    },
  },
};

const CODING_BLUEPRINT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["id", "title", "idea", "required_skills"],
  propertyOrdering: ["id", "title", "idea", "required_skills", "constraints"],
  properties: {
    id: { type: Type.STRING, enum: ["p1", "p2"] },
    title: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.blueprintTitle),
    },
    idea: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.blueprintIdea),
    },
    required_skills: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.blueprintSkill),
      },
    },
    constraints: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.blueprintConstraint),
      },
    },
  },
};

const PLAN_PARSE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "topic",
    "difficulty",
    "assumptions",
    "story",
    "parts",
    "promised_skills",
    "concepts_to_teach",
    "coding_blueprints",
  ],
  properties: {
    topic: {
      type: Type.STRING,
      minLength: "1",
      maxLength: String(PLAN_LIMITS.topic),
    },
    difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] },
    assumptions: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.assumption),
      },
    },
    story: {
      type: Type.OBJECT,
      required: ["storyTopic"],
      properties: {
        storyTopic: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.storyTopic),
        },
        protagonist: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.protagonist),
        },
        anchor_event: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.anchorEvent),
        },
        anchor_year: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.anchorYear),
        },
        anchor_place: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.anchorPlace),
        },
        stakes: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.stakes),
        },
        analogy_seed: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.analogySeed),
        },
        modern_tie_in: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.modernTieIn),
        },
        visual_motif: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.visualMotif),
        },
        naming_note: {
          type: Type.STRING,
          minLength: "1",
          maxLength: String(PLAN_LIMITS.story.namingNote),
        },
      },
    },
    parts: {
      type: Type.ARRAY,
      minItems: "5",
      maxItems: "5",
      items: {
        ...PLAN_PART_RESPONSE_SCHEMA,
      },
    },
    promised_skills: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.STRING,
        minLength: "1",
        maxLength: String(PLAN_LIMITS.promisedSkill),
      },
    },
    concepts_to_teach: {
      type: Type.ARRAY,
      items: {
        type: Type.STRING,
        maxLength: String(PLAN_LIMITS.concept),
      },
    },
    coding_blueprints: {
      type: Type.ARRAY,
      minItems: "2",
      maxItems: "2",
      items: {
        ...CODING_BLUEPRINT_RESPONSE_SCHEMA,
      },
    },
  },
};

const PLAN_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["pass", "issues", "missing_skills", "suggested_edits"],
  properties: {
    pass: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    missing_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    suggested_edits: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

const PROBLEM_TECHNIQUES_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["topic", "techniques"],
  propertyOrdering: ["topic", "techniques"],
  properties: {
    topic: { type: Type.STRING, minLength: "1" },
    techniques: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.OBJECT,
        required: ["id", "title", "summary", "applies_to", "tags"],
        propertyOrdering: ["id", "title", "summary", "applies_to", "tags"],
        properties: {
          id: { type: Type.STRING, minLength: "1" },
          title: { type: Type.STRING, minLength: "1" },
          summary: { type: Type.STRING, minLength: "1" },
          applies_to: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, enum: ["p1", "p2"] },
          },
          tags: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
        },
      },
    },
  },
};

const QUIZZES_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "pass",
    "issues",
    "uncovered_skills",
    "missing_theory_for_concepts",
    "missing_techniques",
  ],
  properties: {
    pass: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    uncovered_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    missing_theory_for_concepts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    missing_techniques: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

const QUIZ_QUESTION_BASE_PROPERTIES: Record<string, Schema> = {
  id: { type: Type.STRING, minLength: "1" },
  prompt: { type: Type.STRING, minLength: "1" },
  explanation: { type: Type.STRING, minLength: "1" },
  tags: {
    type: Type.ARRAY,
    minItems: "1",
    items: { type: Type.STRING, minLength: "1" },
  },
  covers_techniques: {
    type: Type.ARRAY,
    minItems: "1",
    items: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_THEORY_BLOCK_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["id", "title", "content_md"],
  propertyOrdering: ["id", "title", "content_md"],
  properties: {
    id: { type: Type.STRING, minLength: "1" },
    title: { type: Type.STRING, minLength: "1" },
    content_md: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_QUESTION_MCQ_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "id",
    "type",
    "prompt",
    "options",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  propertyOrdering: [
    "id",
    "type",
    "prompt",
    "options",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  properties: {
    ...QUIZ_QUESTION_BASE_PROPERTIES,
    type: { type: Type.STRING, enum: ["mcq"] },
    options: {
      type: Type.ARRAY,
      minItems: "2",
      items: { type: Type.STRING, minLength: "1" },
    },
    correct: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_QUESTION_MULTI_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "id",
    "type",
    "prompt",
    "options",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  propertyOrdering: [
    "id",
    "type",
    "prompt",
    "options",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  properties: {
    ...QUIZ_QUESTION_BASE_PROPERTIES,
    type: { type: Type.STRING, enum: ["multi"] },
    options: {
      type: Type.ARRAY,
      minItems: "2",
      items: { type: Type.STRING, minLength: "1" },
    },
    correct: {
      type: Type.ARRAY,
      minItems: "2",
      items: { type: Type.STRING, minLength: "1" },
    },
  },
};

const QUIZ_QUESTION_SHORT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "id",
    "type",
    "prompt",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  propertyOrdering: [
    "id",
    "type",
    "prompt",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  properties: {
    ...QUIZ_QUESTION_BASE_PROPERTIES,
    type: { type: Type.STRING, enum: ["short"] },
    correct: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_QUESTION_NUMERIC_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "id",
    "type",
    "prompt",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  propertyOrdering: [
    "id",
    "type",
    "prompt",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  properties: {
    ...QUIZ_QUESTION_BASE_PROPERTIES,
    type: { type: Type.STRING, enum: ["numeric"] },
    correct: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_QUESTION_CODE_READING_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "id",
    "type",
    "prompt",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  propertyOrdering: [
    "id",
    "type",
    "prompt",
    "correct",
    "explanation",
    "tags",
    "covers_techniques",
  ],
  properties: {
    ...QUIZ_QUESTION_BASE_PROPERTIES,
    type: { type: Type.STRING, enum: ["code_reading"] },
    correct: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZZES_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["quizzes"],
  propertyOrdering: ["quizzes"],
  properties: {
    quizzes: {
      type: Type.ARRAY,
      minItems: "2",
      maxItems: "2",
      items: {
        type: Type.OBJECT,
        required: ["quiz_id", "questions"],
        propertyOrdering: ["quiz_id", "theory_blocks", "questions"],
        properties: {
          quiz_id: { type: Type.STRING, enum: ["intro_quiz", "wrap_up_quiz"] },
          theory_blocks: {
            type: Type.ARRAY,
            items: QUIZ_THEORY_BLOCK_RESPONSE_SCHEMA,
          },
          questions: {
            type: Type.ARRAY,
            minItems: "1",
            items: {
              anyOf: [
                QUIZ_QUESTION_MCQ_RESPONSE_SCHEMA,
                QUIZ_QUESTION_MULTI_RESPONSE_SCHEMA,
                QUIZ_QUESTION_SHORT_RESPONSE_SCHEMA,
                QUIZ_QUESTION_NUMERIC_RESPONSE_SCHEMA,
                QUIZ_QUESTION_CODE_READING_RESPONSE_SCHEMA,
              ],
            },
          },
        },
      },
    },
  },
};

const PROBLEMS_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["pass", "issues", "too_hard_reasons", "misaligned_skills"],
  properties: {
    pass: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    too_hard_reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    misaligned_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

const CODING_PROBLEM_FUNCTION_PARAM_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["name", "type"],
  propertyOrdering: ["name", "type"],
  properties: {
    name: { type: Type.STRING, minLength: "1" },
    type: { type: Type.STRING, minLength: "1" },
  },
};

const CODING_PROBLEM_FUNCTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["name", "signature", "params", "returns"],
  propertyOrdering: ["name", "signature", "params", "returns"],
  properties: {
    name: { type: Type.STRING, minLength: "1" },
    signature: { type: Type.STRING, minLength: "1" },
    params: {
      type: Type.ARRAY,
      items: CODING_PROBLEM_FUNCTION_PARAM_RESPONSE_SCHEMA,
    },
    returns: { type: Type.STRING, minLength: "1" },
  },
};

const CODING_PROBLEM_EXAMPLE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["input", "output"],
  propertyOrdering: ["input", "output", "explanation"],
  properties: {
    input: { type: Type.STRING, minLength: "1" },
    output: { type: Type.STRING, minLength: "1" },
    explanation: { type: Type.STRING, minLength: "1" },
  },
};

const CODING_PROBLEM_TEST_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["input", "output"],
  propertyOrdering: ["input", "output"],
  properties: {
    input: { type: Type.STRING, minLength: "1" },
    output: { type: Type.STRING },
  },
};

const CODING_PROBLEM_TESTS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["public"],
  propertyOrdering: ["public", "private", "private_count"],
  properties: {
    public: {
      type: Type.ARRAY,
      minItems: "1",
      items: CODING_PROBLEM_TEST_RESPONSE_SCHEMA,
    },
    private: {
      type: Type.ARRAY,
      items: CODING_PROBLEM_TEST_RESPONSE_SCHEMA,
    },
    private_count: { type: Type.INTEGER, minimum: 1 },
  },
};

const PROBLEMS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["problems"],
  propertyOrdering: ["problems"],
  properties: {
    problems: {
      type: Type.ARRAY,
      minItems: "2",
      maxItems: "2",
      items: {
        type: Type.OBJECT,
        required: [
          "id",
          "title",
          "difficulty",
          "story_callback",
          "statement_md",
          "function",
          "constraints",
          "examples",
          "edge_cases",
          "hints",
          "solution_overview_md",
          "reference_solution_py",
          "tests",
        ],
        propertyOrdering: [
          "id",
          "title",
          "difficulty",
          "story_callback",
          "statement_md",
          "function",
          "constraints",
          "examples",
          "edge_cases",
          "hints",
          "solution_overview_md",
          "reference_solution_py",
          "tests",
        ],
        properties: {
          id: { type: Type.STRING, enum: ["p1", "p2"] },
          title: { type: Type.STRING, minLength: "1" },
          difficulty: {
            type: Type.STRING,
            enum: ["easy", "medium", "hard"],
          },
          story_callback: { type: Type.STRING, minLength: "1" },
          statement_md: { type: Type.STRING, minLength: "1" },
          function: CODING_PROBLEM_FUNCTION_RESPONSE_SCHEMA,
          constraints: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          examples: {
            type: Type.ARRAY,
            minItems: "1",
            items: CODING_PROBLEM_EXAMPLE_RESPONSE_SCHEMA,
          },
          edge_cases: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          hints: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          solution_overview_md: { type: Type.STRING, minLength: "1" },
          reference_solution_py: { type: Type.STRING, minLength: "1" },
          tests: CODING_PROBLEM_TESTS_RESPONSE_SCHEMA,
        },
      },
    },
  },
};

const ProblemSolutionEntrySchema = z.object({
  id: z.enum(["p1", "p2"]),
  solution_py: z.string().trim().min(1),
});

const ProblemSolutionsSchema = z
  .object({
    topic: z.string().trim().min(1),
    solutions: z.array(ProblemSolutionEntrySchema).length(2),
  })
  .superRefine((data, ctx) => {
    const ids = new Set(data.solutions.map((solution) => solution.id));
    if (!ids.has("p1") || !ids.has("p2")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "solutions must include ids p1 and p2",
      });
    }
  });

type ProblemSolutions = z.infer<typeof ProblemSolutionsSchema>;

type SolutionTestFailure = {
  index: number;
  message: string;
};

const PYODIDE_VERSION = "0.28.3";
const require = createRequire(import.meta.url);
const PYODIDE_PACKAGE_JSON_PATH = require.resolve("pyodide/package.json");
const PYODIDE_BASE_DIR = path.dirname(PYODIDE_PACKAGE_JSON_PATH);
const LOCAL_PYTHON_INDEX_URL = path.join(PYODIDE_BASE_DIR, path.sep);
const CDN_PYTHON_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const DEFAULT_PYTHON_INDEX_URL = LOCAL_PYTHON_INDEX_URL;

type MutableGlobal = typeof globalThis & {
  location?: { href: string };
  self?: typeof globalThis;
};

function resolvePythonIndexUrl(explicit?: string): string {
  const fromEnv =
    process.env.PYODIDE_INDEX_URL ??
    process.env.PYODIDE_BASE_URL ??
    process.env.PYTHON_RUNTIME_INDEX_URL;
  const candidates = [
    explicit,
    fromEnv,
    DEFAULT_PYTHON_INDEX_URL,
    CDN_PYTHON_INDEX_URL,
  ].filter((value): value is string =>
    Boolean(value && value.trim().length > 0),
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("file://")
    ) {
      return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    }
    if (trimmed.endsWith(path.sep)) {
      return trimmed;
    }
    return `${trimmed}${path.sep}`;
  }

  return CDN_PYTHON_INDEX_URL;
}

function ensurePythonEnvironment(indexURL: string): void {
  const globalObject = globalThis as MutableGlobal;
  if (!globalObject.location) {
    globalObject.location = { href: indexURL } as unknown as Location;
  } else if (!globalObject.location.href) {
    globalObject.location.href = indexURL;
  }
  if (!globalObject.self) {
    globalObject.self = globalThis as unknown as Window & typeof globalThis;
  }
}

let pythonRuntimePromise: ReturnType<typeof loadPyodide> | null = null;

async function ensurePythonRuntime(indexURL?: string) {
  if (!pythonRuntimePromise) {
    const resolvedIndex = resolvePythonIndexUrl(indexURL);
    ensurePythonEnvironment(resolvedIndex);
    pythonRuntimePromise = loadPyodide({ indexURL: resolvedIndex });
  }
  return pythonRuntimePromise;
}

function buildProblemSolutionUserPrompt(problem: CodingProblem): string {
  const examples = problem.examples
    .map((example, index) => {
      const parts = [
        `Example ${index + 1}:`,
        `Input: ${example.input}`,
        `Output: ${example.output}`,
      ];
      if (example.explanation) {
        parts.push(`Explanation: ${example.explanation}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");

  const constraints =
    problem.constraints.length > 0
      ? problem.constraints.map((constraint) => `- ${constraint}`).join("\n")
      : "None provided";
  const edgeCases =
    problem.edge_cases.length > 0
      ? problem.edge_cases.map((edge) => `- ${edge}`).join("\n")
      : "None provided";

  return [
    `Problem ID: ${problem.id} — ${problem.title}`,
    "",
    "Write a correct Python 3 solution using ONLY the statement and examples below.",
    "Use the exact function signature and return values (no input()/print()).",
    "Use the code execution tool to verify your solution against the examples. If any example fails, fix the code and re-run until it passes.",
    "Respond in plain text, wrapping only the final code in <CODE>...</CODE> tags. Do not return JSON, markdown fences, or any other text.",
    "",
    "Function signature:",
    problem.function.signature,
    "",
    "Problem statement:",
    problem.statement_md,
    "",
    "Constraints:",
    constraints,
    "",
    "Edge cases to consider:",
    edgeCases,
    "",
    "Examples:",
    examples,
  ].join("\n");
}

function extractPythonCode(text: string): string {
  const tagged = text.match(/<CODE>([\s\S]*?)<\/CODE>/i);
  if (tagged && tagged[1]) {
    return tagged[1].trim();
  }
  const fenced =
    text.match(/```python\s*([\s\S]*?)```/i) ?? text.match(/```([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return text.trim();
}

export async function runSolutionAgainstTests(
  problem: CodingProblem,
  solutionSource: string,
  indexURL?: string,
): Promise<SolutionTestFailure[]> {
  const python = await ensurePythonRuntime(indexURL);
  const paramNames = problem.function.params.map((param) => param.name);
  const testsJson = JSON.stringify([
    ...problem.tests.public,
    ...(problem.tests.private ?? []),
  ]);
  const paramNamesJson = JSON.stringify(paramNames);
  const functionName = problem.function.name;
  const script = [
    "import ast",
    "import json",
    "from typing import Any, Dict, List, Tuple, Set, Optional, Deque, DefaultDict",
    "import math",
    "import itertools",
    "import collections",
    "import heapq",
    `param_names = json.loads(${JSON.stringify(paramNamesJson)})`,
    `tests = json.loads(${JSON.stringify(testsJson)})`,
    `solution_source = ${JSON.stringify(solutionSource)}`,
    "failures: List[Dict[str, object]] = []",
    "global_env: Dict[str, object] = {}",
    'exec("from typing import Any, Dict, List, Tuple, Set, Optional, Deque, DefaultDict\\nimport math\\nimport itertools\\nimport collections\\nimport heapq", global_env)',
    "try:",
    "    exec(solution_source, global_env)",
    "except Exception as exc:",
    "    failures.append({'index': -1, 'message': f'exec error: {exc}'})",
    `fn = global_env.get(${JSON.stringify(functionName)})`,
    "if not callable(fn):",
    "    failures.append({'index': -1, 'message': 'solution did not define the target function'})",
    "else:",
    "    def parse_args(raw: str):",
    "        text = raw.strip()",
    "        if text == '':",
    "            return []",
    "        def _normalize_commas(expr: str) -> str:",
    "            depth = 0",
    "            in_str = False",
    "            str_char = ''",
    "            escape = False",
    "            normalized: list[str] = []",
    "            for ch in expr:",
    "                if in_str:",
    "                    normalized.append(ch)",
    "                    if escape:",
    "                        escape = False",
    "                        continue",
    "                    if ch == '\\\\':",
    "                        escape = True",
    "                        continue",
    "                    if ch == str_char:",
    "                        in_str = False",
    "                    continue",
    "                if ch in ('\"', \"'\"):",
    "                    in_str = True",
    "                    str_char = ch",
    "                    normalized.append(ch)",
    "                    continue",
    "                if ch in '([{':",
    "                    depth += 1",
    "                    normalized.append(ch)",
    "                    continue",
    "                if ch in ')]}':",
    "                    depth = max(0, depth - 1)",
    "                    normalized.append(ch)",
    "                    continue",
    "                if ch == ',' and depth == 0:",
    "                    normalized.append(';')",
    "                    continue",
    "                normalized.append(ch)",
    "            return ''.join(normalized)",
    "        try:",
    "            env: Dict[str, object] = {}",
    "            exec(text, {}, env)",
    "            values = [env[name] for name in param_names if name in env]",
    "            if len(values) == len(param_names):",
    "                return values",
    "            if len(values) > 0 and len(values) < len(param_names) and param_names[-1] == 'memo':",
    "                return values + [None] * (len(param_names) - len(values))",
    "        except Exception:",
    "            pass",
    "        normalized = _normalize_commas(text)",
    "        if normalized != text:",
    "            try:",
    "                env: Dict[str, object] = {}",
    "                exec(normalized, {}, env)",
    "                values = [env[name] for name in param_names if name in env]",
    "                if len(values) == len(param_names):",
    "                    return values",
    "                if len(values) > 0 and len(values) < len(param_names) and param_names[-1] == 'memo':",
    "                    return values + [None] * (len(param_names) - len(values))",
    "            except Exception:",
    "                pass",
    "        try:",
    "            parsed = ast.literal_eval(text)",
    "            if isinstance(parsed, dict) and all(name in parsed for name in param_names):",
    "                return [parsed[name] for name in param_names]",
    "            if len(param_names) == 1:",
    "                return [parsed]",
    "            if len(param_names) > 1 and param_names[-1] == 'memo':",
    "                return [parsed] + [None] * (len(param_names) - 1)",
    "            if isinstance(parsed, (list, tuple)) and len(parsed) == len(param_names):",
    "                return list(parsed)",
    "        except Exception:",
    "            pass",
    "        lines = [line for line in text.splitlines() if line.strip()]",
    "        if len(lines) == len(param_names):",
    "            parsed_lines = []",
    "            for line in lines:",
    "                try:",
    "                    parsed_lines.append(ast.literal_eval(line))",
    "                except Exception:",
    "                    parsed_lines.append(line.strip())",
    "            return parsed_lines",
    "        parts = [part for part in text.split(',') if part.strip()]",
    "        if len(parts) == len(param_names):",
    "            parsed_parts = []",
    "            for part in parts:",
    "                try:",
    "                    parsed_parts.append(ast.literal_eval(part))",
    "                except Exception:",
    "                    parsed_parts.append(part.strip())",
    "            return parsed_parts",
    "        if len(param_names) == 1:",
    "            return [text]",
    "        raise ValueError('unable to parse inputs for parameters')",
    "",
    "    def parse_expected(raw: str):",
    "        text = raw.strip()",
    "        try:",
    "            return ast.literal_eval(text)",
    "        except Exception:",
    "            return text",
    "",
    "    def values_match(result, expected):",
    "        if result == expected:",
    "            return True",
    "        if isinstance(result, float) and isinstance(expected, float):",
    "            return abs(result - expected) < 1e-6",
    "        return str(result).strip() == str(expected).strip()",
    "",
    "    for index, test in enumerate(tests):",
    "        try:",
    "            args = parse_args(test.get('input', ''))",
    "            if len(args) != len(param_names):",
    "                raise ValueError(f'parsed {len(args)} args, expected {len(param_names)}')",
    "            expected = parse_expected(test.get('output', ''))",
    "            actual = fn(*args)",
    "        except Exception as exc:",
    "            failures.append({'index': index, 'message': str(exc)})",
    "            continue",
    "        if not values_match(actual, expected):",
    "            failures.append({'index': index, 'message': f'expected {repr(expected)} but got {repr(actual)}'})",
    "",
    "json.dumps({'failures': failures})",
  ].join("\n");

  try {
    const result: unknown = await python.runPythonAsync(script);
    if (typeof result === "string") {
      const parsed: unknown = JSON.parse(result);
      if (
        parsed &&
        typeof parsed === "object" &&
        "failures" in parsed &&
        Array.isArray((parsed as { failures?: unknown }).failures)
      ) {
        return (parsed as { failures?: SolutionTestFailure[] }).failures ?? [];
      }
    }
    return [];
  } catch (error) {
    return [{ index: -1, message: errorAsString(error) }];
  }
}

export class SessionGenerationPipeline {
  private readonly logger: JobProgressReporter;

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
    const payload: PlanCheckpoint = { ...value, topic: this.options.topic };
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
          );
          this.logger.log(
            `[session/plan-ideas] generating plan ideas (${attemptLabel})`,
          );
          const contents = buildSingleUserPrompt(
            "Expert CS educator generating engaging beginner-friendly Python lesson ideas. Produce diverse concepts that align story, promised skills, and five-part progression. Difficulty is “easy”; assume base knowledge listed above. Call out new concepts when needed.",
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
      const entry: StageCacheEntry<SessionPlan> = {
        value: checkpoint.value,
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
      await this.writePlanCheckpoint(planJson);
      const entry: StageCacheEntry<SessionPlan> = {
        value: planJson,
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
      const userPrompt = buildProblemTechniquesUserPrompt(plan);
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

    await this.writePlanCheckpoint(planJson);
    const entry: StageCacheEntry<SessionPlan> = {
      value: planJson,
      source: "generated",
    };
    this.caches.plan = entry;

    await this.invalidateStage("plan_grade");
    return planJson;
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

  private async generateIndependentSolution(
    problem: CodingProblem,
  ): Promise<string> {
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
      const userPrompt = buildProblemSolutionUserPrompt(problem);
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
    }
    throw new Error(
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

export async function generateSession(
  options: GenerateSessionOptions,
): Promise<GenerateSessionResult> {
  const logger = useProgress(options.progress);
  const includeStory = options.includeStory ?? true;
  const pipeline = new SessionGenerationPipeline({
    topic: options.topic,
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
    await pipeline.invalidateStage("plan");
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
    problems = await pipeline.ensureProblems();
    problemsGrade = await pipeline.ensureProblemsGrade();
    if (problemsGrade.pass) {
      break;
    }
    if (attempt === 1 + MAX_PROBLEM_GRADE_RETRIES) {
      throw new Error(
        `Problem grading failed after ${MAX_PROBLEM_GRADE_RETRIES + 1} attempts: ${problemsGrade.issues.join("; ")}`,
      );
    }
    await pipeline.invalidateStage("problems");
  }

  if (!problems || !problemsGrade) {
    throw new Error("Problem generation failed");
  }

  await pipeline.ensureProblemSolutions();
  problems = await pipeline.ensureProblems();

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
