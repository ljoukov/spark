import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Type, type Schema } from "@google/genai";
import { z } from "zod";

import {
  generateJson,
  generateText,
  type LlmContent,
  type LlmDebugOptions,
} from "../utils/llm";
import type { JobProgressReporter, LlmUsageChunk } from "../utils/concurrency";
import { errorAsString } from "../utils/error";
import { generateStory, TEXT_MODEL_ID } from "./generateStory";
import type { GenerateStoryResult } from "./generateStory";

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

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return raw;
  }
  const fenceStart = trimmed.indexOf("\n");
  if (fenceStart === -1) {
    return raw;
  }
  const fenceLabel = trimmed.slice(0, fenceStart).replace(/```/g, "");
  const withoutOpening = trimmed.slice(fenceStart + 1);
  const fenceEndIndex = withoutOpening.lastIndexOf("```");
  if (fenceEndIndex === -1) {
    return raw;
  }
  const inner = withoutOpening.slice(0, fenceEndIndex);
  return inner.trim();
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

const PlanPartSchema = z.object({
  order: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  kind: z.enum(["story", "intro_quiz", "coding_1", "coding_2", "wrap_up_quiz"]),
  summary: z.string().trim().min(1),
});

const CodingBlueprintSchema = z.object({
  id: z.enum(["p1", "p2"]),
  title: z.string().trim().min(1),
  idea: z.string().trim().min(1),
  required_skills: z.array(z.string().trim().min(1)).min(1),
  constraints: z.array(z.string().trim().min(1)).optional(),
});

export const SessionPlanSchema = z
  .object({
    topic: z.string().trim().min(1),
    difficulty: z.literal("easy"),
    assumptions: z.array(z.string().trim().min(1)),
    story: z.object({
      storyTopic: z.string().trim().min(1),
    }),
    parts: z.array(PlanPartSchema).length(5),
    promised_skills: z.array(z.string().trim().min(1)).min(1),
    concepts_to_teach: z.array(z.string().trim().min(1)),
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

const CodingProblemTestsSchema = z.object({
  public: z
    .array(
      z.object({
        input: z.string().trim().min(1),
        output: z.string().transform((value) => value.trim()),
      }),
    )
    .min(1),
  private_count: z.number().int().min(1),
});

export const CodingProblemSchema = z.object({
  id: z.enum(["p1", "p2"]),
  title: z.string().trim().min(1),
  difficulty: z.literal("easy"),
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

type PlanIdeasStageValue = {
  markdown: string;
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
  | "quiz_ideas"
  | "quizzes"
  | "quizzes_grade"
  | "problem_ideas"
  | "problems"
  | "problems_grade";

const SESSION_STAGE_ORDER: readonly SessionGenerationStageName[] = [
  "plan_ideas",
  "plan",
  "plan_grade",
  "quiz_ideas",
  "quizzes",
  "quizzes_grade",
  "problem_ideas",
  "problems",
  "problems_grade",
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
};

type PlanIdeasCheckpoint = {
  topic: string;
  markdown: string;
};

type QuizIdeasCheckpoint = {
  topic: string;
  markdown: string;
};

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
    "- Story paragraph ending with `in todays's lesson...`",
    "- Five-Part Progression with numbered list (1 story, 2 intro/quiz, 3 first coding problem, 4 second coding problem, 5 wrap up quiz)",
    "- Promised Skills bullet list",
    "- Concepts To Teach list (may be empty)",
    "- Two Coding Blueprints with required skills",
  ].join("\n");
}

function buildPlanParseUserPrompt(markdown: string): string {
  return [
    "Schema: {topic, difficulty, assumptions, storyTopic, parts[{order,kind,summary}], promised_skills[], concepts_to_teach[], coding_blueprints[{id,title,idea,required_skills[],constraints?[]}]}",
    `Include assumptions ${JSON.stringify(ASSUMPTIONS)}`,
    'Set "difficulty" exactly to "easy" (lowercase).',
    "Parts must be exactly 1=story, 2=intro_quiz, 3=coding_1, 4=coding_2, 5=wrap_up_quiz.",
    "coding_blueprints must have ids p1 and p2.",
    "Output strict JSON only.",
    "",
    "Markdown ideas:",
    markdown,
  ].join("\n");
}

function buildPlanGradeUserPrompt(plan: SessionPlan): string {
  return [
    "Check rules:",
    "R1 parts ordered;",
    "R2 promised skills cover blueprint requirements;",
    "R3 concepts_to_teach referenced and manageable;",
    'R5 difficulty "easy".',
    "Output {pass:boolean, issues:string[], missing_skills:string[], suggested_edits:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
  ].join("\n");
}

function buildQuizIdeasUserPrompt(
  plan: SessionPlan,
  markdownPlanIdeas: string,
  seed?: number,
): string {
  return [
    `Topic: "${plan.topic}"`,
    `Seed: ${seed ?? "none"}`,
    "",
    "Provide Markdown describing intro and wrap-up quiz coverage.",
    "Include theory primers if concepts_to_teach is non-empty.",
    "List question stems with types.",
    "Map stems to promised skills.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Original Plan Ideas:",
    markdownPlanIdeas,
  ].join("\n");
}

function buildQuizzesGenerateUserPrompt(
  plan: SessionPlan,
  coverageMarkdown: string,
  questionCounts?: SessionGenerationPipelineOptions["questionCounts"],
): string {
  const introCount = questionCounts?.introQuiz;
  const wrapCount = questionCounts?.wrapUpQuiz;
  const constraints: string[] = [
    'Return a JSON object with a single key "quizzes" whose value is an array of exactly two quiz definitions.',
    'Each quiz definition must include "quiz_id" (either "intro_quiz" or "wrap_up_quiz"), optional "theory_blocks" (array of {id,title,content_md}), and "questions".',
    'Every question object must follow the schema: {"id","type","prompt","explanation","tags", ...}. Use "options" (array of strings) and "correct" (string for mcq/short/numeric/code_reading, array of strings for multi). Do not use aliases like "stem", "answer", or "solution".',
    "Each quiz uses varied question types (mcq, multi, short, numeric, code_reading).",
    "Each quiz must include exactly 4 questions unless overrides provided.",
    "If concepts introduced, add theory block before first related question and tag accordingly.",
    "Tags must include promised skills and any concept tags.",
    "Provide concise explanations.",
    "Do not wrap the JSON in Markdown fences or add commentary; output strict JSON only.",
  ];
  if (typeof introCount === "number" && introCount > 0) {
    constraints.push(
      `Override: intro_quiz must have exactly ${introCount} questions.`,
    );
  }
  if (typeof wrapCount === "number" && wrapCount > 0) {
    constraints.push(
      `Override: wrap_up_quiz must have exactly ${wrapCount} questions.`,
    );
  }
  return [
    constraints.join("\n"),
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Quiz coverage Markdown:",
    coverageMarkdown,
  ].join("\n");
}

function buildQuizzesGradeUserPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
): string {
  return [
    "Ensure all required skills covered.",
    "Ensure theory blocks present when needed for new concepts.",
    "Ensure answers unambiguous and explanations correct.",
    "Output {pass:boolean, issues:string[], uncovered_skills:string[], missing_theory_for_concepts:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Quizzes JSON:",
    JSON.stringify(quizzes, null, 2),
  ].join("\n");
}

function buildProblemIdeasUserPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
  quizCoverageMarkdown: string,
  seed?: number,
): string {
  return [
    `Topic: "${plan.topic}"`,
    `Seed: ${seed ?? "none"}`,
    "",
    "Generate Markdown summaries for two easy coding problems aligned with promised skills and story.",
    "Include Title, One-line Pitch, Story alignment note, Required Skills, Any New Concept, Example I/O.",
    "Avoid advanced structures unless declared.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Quiz Coverage Markdown:",
    quizCoverageMarkdown,
    "",
    "Quizzes JSON:",
    JSON.stringify(quizzes, null, 2),
  ].join("\n");
}

function buildProblemsGenerateUserPrompt(
  plan: SessionPlan,
  problemIdeasMarkdown: string,
  quizzes: readonly SessionQuiz[],
): string {
  return [
    'Return a JSON object with key "problems" whose value is an array with exactly two entries (ids "p1" and "p2").',
    'Each problem must include fields: id, title, difficulty (set to "easy"), story_callback, statement_md, function {name, signature, params[{name,type}], returns}, constraints (string[]), examples (array of {input:string, output:string, explanation?}), edge_cases (string[]), hints (string[]), solution_overview_md, reference_solution_py, tests {public:[{input:string, output:string}], private_count:int}.',
    "Represent inputs and outputs as strings (escape newlines with \\n); do not return nested objects for these fields.",
    "Include story_callback, constraints, and at least two examples per problem.",
    "Provide 3-5 public tests per problem and private_count between 3 and 8.",
    'Do not include extra fields such as "prompt", "solution", or "private_tests".',
    'Problem "p1" must implement the first idea from the Markdown above (connection check). Problem "p2" must implement the second idea (shortest path/path reconstruction). Do not skip the connection-check problem.',
    "Ensure reference_solution_py uses return type hints consistent with the declared function signature.",
    "Solutions must be simple Python 3.",
    "Do not wrap the JSON in Markdown fences or add commentary.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Idea Markdown:",
    problemIdeasMarkdown,
    "",
    "Quizzes JSON:",
    JSON.stringify(quizzes, null, 2),
  ].join("\n");
}

function buildProblemsGradeUserPrompt(
  plan: SessionPlan,
  problems: readonly CodingProblem[],
): string {
  return [
    "Check each problem is easy, specs precise, skills aligned, reference solutions correct.",
    "Output {pass:boolean, issues:string[], too_hard_reasons:string[], misaligned_skills:string[]} JSON only.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problems JSON:",
    JSON.stringify(problems, null, 2),
  ].join("\n");
}

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
    topic: { type: Type.STRING, minLength: "1" },
    difficulty: { type: Type.STRING },
    assumptions: {
      type: Type.ARRAY,
      items: { type: Type.STRING, minLength: "1" },
    },
    story: {
      type: Type.OBJECT,
      required: ["storyTopic"],
      properties: {
        storyTopic: { type: Type.STRING, minLength: "1" },
      },
    },
    parts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["order", "kind", "summary"],
        properties: {
          order: { type: Type.NUMBER },
          kind: { type: Type.STRING },
          summary: { type: Type.STRING, minLength: "1" },
        },
      },
    },
    promised_skills: {
      type: Type.ARRAY,
      items: { type: Type.STRING, minLength: "1" },
    },
    concepts_to_teach: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    coding_blueprints: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["id", "title", "idea", "required_skills"],
        properties: {
          id: { type: Type.STRING, minLength: "1" },
          title: { type: Type.STRING, minLength: "1" },
          idea: { type: Type.STRING, minLength: "1" },
          required_skills: {
            type: Type.ARRAY,
            items: { type: Type.STRING, minLength: "1" },
          },
          constraints: {
            type: Type.ARRAY,
            items: { type: Type.STRING, minLength: "1" },
          },
        },
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

const QUIZZES_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "pass",
    "issues",
    "uncovered_skills",
    "missing_theory_for_concepts",
  ],
  properties: {
    pass: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    uncovered_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
    missing_theory_for_concepts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
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

export class SessionGenerationPipeline {
  private readonly logger: JobProgressReporter;

  private readonly caches: {
    planIdeas?: StageCacheEntry<PlanIdeasStageValue>;
    plan?: StageCacheEntry<SessionPlan>;
    planGrade?: StageCacheEntry<PlanGrade>;
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
    const userPrompt = buildPlanGradeUserPrompt(plan);
    const debugOptions = this.createDebugOptions("plan-grade");
    this.logger.log("[session/plan-grade] grading plan");
    const grade = await generateJson<PlanGrade>({
      modelId: TEXT_MODEL_ID,
      contents: buildSingleUserPrompt("Rubric QA, diagnose only.", userPrompt),
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
  }

  async ensurePlanGrade(): Promise<PlanGrade> {
    const entry = await this.ensurePlanGradeInternal();
    return entry.value;
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
    for (let attempt = 1; attempt <= MAX_QUIZ_ATTEMPTS; attempt += 1) {
      const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(MAX_QUIZ_ATTEMPTS).padStart(2, "0")}`;
      try {
        const debugOptions = this.createDebugOptions(
          "quiz-ideas",
          attemptLabel,
        );
        const userPrompt = buildQuizIdeasUserPrompt(
          plan,
          planIdeas.markdown,
          this.options.seed,
        );
        this.logger.log(
          `[session/quiz-ideas] generating coverage markdown (${attemptLabel})`,
        );
        const coverageMarkdown = await generateText({
          modelId: TEXT_MODEL_ID,
          contents: buildSingleUserPrompt(
            "Expand plan into quiz coverage ensuring primers precede practice.",
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
  }

  async ensureQuizIdeas(): Promise<QuizIdeasStageValue> {
    const entry = await this.ensureQuizIdeasInternal();
    return entry.value;
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
    const userPrompt = buildQuizzesGenerateUserPrompt(
      plan,
      quizIdeas.markdown,
      this.options.questionCounts,
    );
    const debugOptions = this.createDebugOptions("quizzes-generate");
    this.logger.log("[session/quizzes] generating quiz JSON");
    const raw = await generateText({
      modelId: TEXT_MODEL_ID,
      contents: buildSingleUserPrompt(
        "Produce final quizzes with concise explanations, optional theory blocks.",
        userPrompt,
      ),
      progress: this.logger,
      debug: debugOptions,
    });
    const jsonText = stripMarkdownFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new Error(
        `Failed to parse quizzes JSON: ${errorAsString(error)}\nRaw output:\n${raw}`,
      );
    }
    const quizzes = QuizzesSchema.parse(parsed);
    await this.writeQuizzesCheckpoint(quizzes);
    const entry: StageCacheEntry<QuizzesPayload> = {
      value: quizzes,
      source: "generated",
    };
    this.caches.quizzes = entry;
    return entry;
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
    const userPrompt = buildQuizzesGradeUserPrompt(plan, quizzes);
    const debugOptions = this.createDebugOptions("quizzes-grade");
    this.logger.log("[session/quizzes-grade] grading quizzes");
    const grade = await generateJson<QuizzesGrade>({
      modelId: TEXT_MODEL_ID,
      contents: buildSingleUserPrompt(
        "QA quizzes for coverage, theory, clarity.",
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
    const quizzes = await this.ensureQuizzes();
    const quizIdeas = await this.ensureQuizIdeas();
    for (let attempt = 1; attempt <= MAX_PROBLEM_ATTEMPTS; attempt += 1) {
      const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(MAX_PROBLEM_ATTEMPTS).padStart(2, "0")}`;
      try {
        const debugOptions = this.createDebugOptions(
          "problem-ideas",
          attemptLabel,
        );
        const userPrompt = buildProblemIdeasUserPrompt(
          plan,
          quizzes,
          quizIdeas.markdown,
          this.options.seed,
        );
        this.logger.log(
          `[session/problem-ideas] generating markdown (${attemptLabel})`,
        );
        const markdown = await generateText({
          modelId: TEXT_MODEL_ID,
          contents: buildSingleUserPrompt(
            "Generate two easy ideas aligned with promised skills and story.",
            userPrompt,
          ),
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
    if (checkpoint) {
      this.logger.log(
        `[session/checkpoint] restored 'problems' from ${checkpoint.filePath}`,
      );
      const entry: StageCacheEntry<ProblemsPayload> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.problems = entry;
      return entry;
    }
    const plan = await this.ensurePlan();
    const problemIdeas = await this.ensureProblemIdeas();
    const quizzes = await this.ensureQuizzes();
    const userPrompt = buildProblemsGenerateUserPrompt(
      plan,
      problemIdeas.markdown,
      quizzes,
    );
    const debugOptions = this.createDebugOptions("problems-generate");
    this.logger.log("[session/problems] generating coding problems");
    const raw = await generateText({
      modelId: TEXT_MODEL_ID,
      contents: buildSingleUserPrompt(
        "Produce full beginner-friendly specs with reference solutions and tests.",
        userPrompt,
      ),
      progress: this.logger,
      debug: debugOptions,
    });
    const jsonText = stripMarkdownFences(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (error) {
      throw new Error(
        `Failed to parse problems JSON: ${errorAsString(error)}\nRaw output:\n${raw}`,
      );
    }
    const normalised = Array.isArray(parsed) ? { problems: parsed } : parsed;
    const cleaned = normaliseProblemsPayload(normalised);
    const problems = ProblemsSchema.parse(cleaned);
    await this.writeProblemsCheckpoint(problems);
    const entry: StageCacheEntry<ProblemsPayload> = {
      value: problems,
      source: "generated",
    };
    this.caches.problems = entry;
    return entry;
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
    const userPrompt = buildProblemsGradeUserPrompt(plan, problems);
    const debugOptions = this.createDebugOptions("problems-grade");
    this.logger.log("[session/problems-grade] grading coding problems");
    const grade = await generateJson<ProblemsGrade>({
      modelId: TEXT_MODEL_ID,
      contents: buildSingleUserPrompt(
        "QA problems for alignment, clarity, and difficulty.",
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
  }

  async ensureProblemsGrade(): Promise<ProblemsGrade> {
    const entry = await this.ensureProblemsGradeInternal();
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

type SessionGenerationQuestionCounts =
  SessionGenerationPipelineOptions["questionCounts"];

export type GenerateSessionOptions = {
  topic: string;
  seed?: number;
  checkpointDir?: string;
  debugRootDir?: string;
  progress?: JobProgressReporter;
  questionCounts?: SessionGenerationQuestionCounts;
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
  const includeStory = options.includeStory ?? true;
  const pipeline = new SessionGenerationPipeline({
    topic: options.topic,
    seed: options.seed,
    checkpointDir: options.checkpointDir,
    debugRootDir: options.debugRootDir,
    questionCounts: options.questionCounts,
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

  const slug = slugifyTopic(options.topic);
  const sessionId = options.sessionId ?? slug;

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
