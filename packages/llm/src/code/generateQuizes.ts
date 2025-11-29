import { Type, type Schema } from "@google/genai";
import { z } from "zod";

import type { CodingProblem, ProblemTechnique } from "./generateCodeProblems";
import type { SessionPlan } from "./generateSessionPlan";

export const MAX_QUIZ_ATTEMPTS = 3;
export const MAX_QUIZ_GRADE_RETRIES = 2;

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

export const QuizzesSchema = z.object({
  quizzes: z.array(SessionQuizSchema).superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const quiz of value) {
      if (seen.has(quiz.quiz_id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate quiz_id '${quiz.quiz_id}'`,
        });
      }
      seen.add(quiz.quiz_id);
    }
    if (!seen.has("intro_quiz") || !seen.has("wrap_up_quiz")) {
      ctx.addIssue({
        code: "custom",
        message: "quizzes must include intro_quiz and wrap_up_quiz",
      });
    }
  }),
});

export type QuizzesPayload = z.infer<typeof QuizzesSchema>;

export const QuizzesGradeSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim()).default([]),
  uncovered_skills: z.array(z.string().trim()).default([]),
  missing_theory_for_concepts: z.array(z.string().trim()).default([]),
  missing_techniques: z.array(z.string().trim()).default([]),
});

export type QuizzesGrade = z.infer<typeof QuizzesGradeSchema>;

export function buildQuizIdeasUserPrompt(
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

export function buildQuizzesGenerateUserPrompt(
  plan: SessionPlan,
  coverageMarkdown: string,
  problems: readonly CodingProblem[],
  techniques: readonly ProblemTechnique[],
  questionCounts?: {
    introQuiz?: number;
    wrapUpQuiz?: number;
  },
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

export function buildQuizzesGradeUserPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
  techniques: readonly ProblemTechnique[],
  questionCounts?: {
    introQuiz?: number;
    wrapUpQuiz?: number;
  },
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

export const QUIZZES_RESPONSE_SCHEMA: Schema = {
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

export const QUIZZES_GRADE_RESPONSE_SCHEMA: Schema = {
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
