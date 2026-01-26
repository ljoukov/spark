import { z } from "zod";

const trimmedString = z.string().trim().min(1);

export const QuizFeedbackToneSchema = z.enum(["info", "success", "warning"]);

export const QuizFeedbackSchema = z.object({
  message: z.string().min(1),
  tone: QuizFeedbackToneSchema.optional(),
  heading: z.string().optional(),
});

export const QuizChoiceOptionSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  text: z.string().min(1),
});

const QuizQuestionBaseSchema = z.object({
  id: trimmedString,
  prompt: z.string().min(1),
  hint: z.string().optional(),
  audioLabel: z.string().optional(),
});

const QuizQuestionWithExplanationSchema = QuizQuestionBaseSchema.extend({
  explanation: z.string().optional(),
});

const QuizQuestionWithFeedbackSchema = QuizQuestionWithExplanationSchema.extend(
  {
    correctFeedback: QuizFeedbackSchema,
  },
);

const QuizQuestionWithFeedbackNoExplanationSchema =
  QuizQuestionBaseSchema.extend({
    correctFeedback: QuizFeedbackSchema,
  });

export const QuizMultipleChoiceSchema = QuizQuestionWithFeedbackSchema.extend({
  kind: z.literal("multiple-choice"),
  options: z.array(QuizChoiceOptionSchema).min(2),
  correctOptionId: trimmedString,
});

export const QuizTypeAnswerSchema =
  QuizQuestionWithFeedbackNoExplanationSchema.extend({
    kind: z.literal("type-answer"),
    answer: z.string().min(1),
    acceptableAnswers: z.array(trimmedString).optional(),
    placeholder: z.string().optional(),
    marks: z.number().int().min(1).max(20).optional(),
    markScheme: z.string().min(1).optional(),
  });

export const QuizInfoCardSchema = QuizQuestionBaseSchema.extend({
  kind: z.literal("info-card"),
  body: z.string().min(1),
  continueLabel: z.string().optional(),
  eyebrow: z.string().nullable().optional(),
});

export const QuizQuestionSchema = z.discriminatedUnion("kind", [
  QuizMultipleChoiceSchema,
  QuizTypeAnswerSchema,
  QuizInfoCardSchema,
]);

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export type QuizFeedback = z.infer<typeof QuizFeedbackSchema>;

export const QuizDefinitionSchema = z.object({
  id: trimmedString,
  title: trimmedString,
  description: trimmedString,
  gradingPrompt: z.string().trim().min(1).optional(),
  topic: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  progressKey: trimmedString,
  questions: z.array(QuizQuestionSchema).min(1),
});

export type QuizDefinition = z.infer<typeof QuizDefinitionSchema>;
