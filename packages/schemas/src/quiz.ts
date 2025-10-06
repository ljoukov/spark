import { z } from "zod";

const trimmedString = z.string().trim().min(1);

export const QuizChoiceOptionSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  text: z.string().min(1),
});

const QuizQuestionBaseSchema = z.object({
  id: trimmedString,
  prompt: z.string().min(1),
  hint: z.string().optional(),
  explanation: z.string().optional(),
  audioLabel: z.string().optional(),
});

export const QuizMultipleChoiceSchema = QuizQuestionBaseSchema.extend({
  kind: z.literal("multiple-choice"),
  options: z.array(QuizChoiceOptionSchema).min(2),
  correctOptionId: trimmedString,
});

export const QuizTypeAnswerSchema = QuizQuestionBaseSchema.extend({
  kind: z.literal("type-answer"),
  answer: z.string().min(1),
  acceptableAnswers: z.array(trimmedString).optional(),
  placeholder: z.string().optional(),
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

export const QuizDefinitionSchema = z.object({
  id: trimmedString,
  title: trimmedString,
  description: z.string().optional(),
  topic: z.string().optional(),
  estimatedMinutes: z.number().int().positive().optional(),
  progressKey: z.string().optional(),
  questions: z.array(QuizQuestionSchema).min(1),
});

export type QuizDefinition = z.infer<typeof QuizDefinitionSchema>;
