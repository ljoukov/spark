import { Type, type Schema } from "@google/genai";
import { z } from "zod";

export interface InlineSourceFile {
  readonly displayName: string;
  readonly mimeType: string;
  readonly data: string;
}

// LLM responses still report whether they refined source questions ("extraction"),
// authored new ones ("synthesis"), or added follow-ups ("extension"), so keep all
// three modes in the schema even though callers no longer pre-select them.
export const QUIZ_MODES = ["extraction", "synthesis", "extension"] as const;

export const QUESTION_TYPES = [
  "multiple_choice",
  "short_answer",
  "true_false",
  "numeric",
] as const;

export const QUESTION_REVIEW_STATUSES = [
  "approved",
  "unapproved",
] as const;

const QuestionReviewSchema = z.object({
  status: z.enum(QUESTION_REVIEW_STATUSES),
  notes: z.string().min(1),
});

const MULTIPLE_CHOICE_OPTION_LIMITS = new Map<number, Set<string>>([
  [2, new Set(["A", "B"])],
  [3, new Set(["A", "B", "C"])],
  [4, new Set(["A", "B", "C", "D"])],
]);

const QuizQuestionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(QUESTION_TYPES),
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).optional(),
    answer: z
      .array(z.string().min(1, "answer entries must not be empty"))
      .min(1, "answer must include at least one entry"),
    explanation: z.string().min(1),
    hint: z.string().min(1, "hint must not be empty"),
    sourceReference: z.string().min(1).optional(),
    review: QuestionReviewSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "multiple_choice") {
      if (!value.options || value.options.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "multiple_choice questions must include options",
          path: ["options"],
        });
        return;
      }
      if (!MULTIPLE_CHOICE_OPTION_LIMITS.has(value.options.length)) {
        ctx.addIssue({
          code: "custom",
          message: "multiple_choice questions must include 2, 3, or 4 options",
          path: ["options"],
        });
      }
      const labelledOption = value.options.find((option) =>
        /^[A-D]\)\. /i.test(option.trimStart()),
      );
      if (labelledOption) {
        ctx.addIssue({
          code: "custom",
          message: `option text must not start with leading choice labels, found "${labelledOption.substring(0, 10)}"`,
          path: ["options"],
        });
      }
      const allowedLetters = MULTIPLE_CHOICE_OPTION_LIMITS.get(
        value.options.length,
      );
      if (allowedLetters) {
        for (const entry of value.answer) {
          if (!/^[A-D]$/.test(entry)) {
            ctx.addIssue({
              code: "custom",
              message:
                "multiple_choice answer entries must be single letters (A-D)",
              path: ["answer"],
            });
            break;
          }
          if (!allowedLetters.has(entry)) {
            ctx.addIssue({
              code: "custom",
              message: `multiple_choice answers must match available options (${Array.from(allowedLetters).join(", ")})`,
              path: ["answer"],
            });
            break;
          }
        }
      }
      if (value.answer.length > 1) {
        if (value.options.length < 2) {
          ctx.addIssue({
            code: "custom",
            message: "multiple_answer questions must offer at least 2 options",
            path: ["options"],
          });
        }
      }
      return;
    }
    if (value.options && value.options.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "options are only allowed for multiple_choice questions",
        path: ["options"],
      });
    }
  });

// QuizGenerationSchema schema needs to be in strict sync with QUIZ_RESPONSE_SCHEMA
export const QuizGenerationSchema = z
  .object({
    mode: z.enum(QUIZ_MODES),
    subject: z.string().min(1),
    questionCount: z.number().int().min(1),
    questions: z.array(QuizQuestionSchema).min(1),
    quizTitle: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.questions.length !== value.questionCount) {
      ctx.addIssue({
        code: "custom",
        message: "questionCount must match the number of questions returned",
        path: ["questionCount"],
      });
    }
  });

// QUIZ_RESPONSE_SCHEMA schema needs to be in strict sync with QuizGenerationSchema
// This schema could be potentially generated programmatically from QuizGenerationSchema,
// but we want to take advantage from "propertyOrdering" which is essential for LLMs.
export const QUIZ_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    mode: { type: Type.STRING, enum: ["extraction", "synthesis", "extension"] },
    subject: { type: Type.STRING },
    questionCount: { type: Type.INTEGER, minimum: 1 },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          type: {
            type: Type.STRING,
            enum: ["multiple_choice", "short_answer", "true_false", "numeric"],
          },
          prompt: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Provide 2-4 plain-text option bodies without leading labels; leave empty when type is not multiple_choice.",
          },
          answer: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "List correct choices. For multiple_choice use single letters (A-D) matching the UI labels; include one entry per correct choice.",
          },
          explanation: { type: Type.STRING },
          hint: {
            type: Type.STRING,
            description:
              "Short insight that guides a learner without giving away the exact answer.",
          },
          sourceReference: { type: Type.STRING },
          review: {
            type: Type.OBJECT,
            properties: {
              status: {
                type: Type.STRING,
                enum: ["approved", "unapproved"],
              },
              notes: {
                type: Type.STRING,
                description:
                  "Short self-check note describing why the item passed or failed.",
              },
            },
            required: ["status", "notes"],
            propertyOrdering: ["status", "notes"],
          },
        },
        required: ["id", "type", "prompt", "answer", "explanation", "hint"],
        propertyOrdering: [
          "id",
          "type",
          "prompt",
          "options",
          "answer",
          "explanation",
          "hint",
          "sourceReference",
          "review",
        ],
      },
    },
    quizTitle: { type: Type.STRING },
  },
  required: ["mode", "subject", "questionCount", "questions", "quizTitle"],
  propertyOrdering: [
    "mode",
    "subject",
    "questionCount",
    "questions",
    "quizTitle",
  ],
};

export const JudgeRubricItemSchema = z.object({
  criterion: z.string().min(1),
  justification: z.string().min(1),
  score: z.number().min(0).max(1),
});

export const JudgeVerdictSchema = z.object({
  explanation: z.string().min(1),
  rubricFindings: z.array(JudgeRubricItemSchema).min(1),
  verdict: z.enum(["approve", "revise"]),
});

export const JudgeAuditSchema = z.object({
  explanation: z.string().min(1),
  verdictAgreement: z.enum(["agree", "needs_review", "disagree"]),
  confidence: z.enum(["high", "medium", "low"]),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type QuizGeneration = z.infer<typeof QuizGenerationSchema>;
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
export type JudgeAudit = z.infer<typeof JudgeAuditSchema>;
