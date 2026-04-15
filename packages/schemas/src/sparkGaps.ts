import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";

const trimmedString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().min(1).optional();

export const SparkLearningGapTypeSchema = z.enum([
  "knowledge_gap",
  "misconception",
  "oversight",
]);

export type SparkLearningGapType = z.infer<typeof SparkLearningGapTypeSchema>;

export const SparkLearningGapStatusSchema = z.enum(["active", "archived"]);

export type SparkLearningGapStatus = z.infer<
  typeof SparkLearningGapStatusSchema
>;

const SparkLearningGapStepBaseSchema = z.object({
  id: trimmedString,
  label: optionalTrimmedString,
  prompt: trimmedString,
});

export const SparkLearningGapFreeTextStepSchema =
  SparkLearningGapStepBaseSchema.extend({
    kind: z.literal("free_text"),
    expectedAnswer: trimmedString,
    modelAnswer: trimmedString,
    markScheme: trimmedString,
    gradingPrompt: optionalTrimmedString,
    maxMarks: z.number().int().min(1).max(4),
    placeholder: optionalTrimmedString,
  });

export const SparkLearningGapMultipleChoiceOptionSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  text: trimmedString,
});

export type SparkLearningGapMultipleChoiceOption = z.infer<
  typeof SparkLearningGapMultipleChoiceOptionSchema
>;

export const SparkLearningGapMultipleChoiceStepSchema =
  SparkLearningGapStepBaseSchema.extend({
    kind: z.literal("multiple_choice"),
    options: z.array(SparkLearningGapMultipleChoiceOptionSchema).min(2).max(5),
    correctOptionId: trimmedString,
    explanation: trimmedString,
  }).superRefine((step, ctx) => {
    if (!step.options.some((option) => option.id === step.correctOptionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctOptionId"],
        message: "correctOptionId must match one of the options.",
      });
    }
  });

export const SparkLearningGapModelAnswerStepSchema =
  SparkLearningGapStepBaseSchema.extend({
    kind: z.literal("model_answer"),
    body: trimmedString,
  });

export const SparkLearningGapMemoryChainStepSchema =
  SparkLearningGapStepBaseSchema.extend({
    kind: z.literal("memory_chain"),
    body: trimmedString,
  });

export const SparkLearningGapStepSchema = z.discriminatedUnion("kind", [
  SparkLearningGapFreeTextStepSchema,
  SparkLearningGapMultipleChoiceStepSchema,
  SparkLearningGapModelAnswerStepSchema,
  SparkLearningGapMemoryChainStepSchema,
]);

export type SparkLearningGapStep = z.infer<
  typeof SparkLearningGapStepSchema
>;

export const SparkLearningGapSourceSchema = z.object({
  runId: trimmedString,
  runVersion: trimmedString,
  questionId: trimmedString,
  questionLabel: optionalTrimmedString,
  questionPrompt: optionalTrimmedString,
  sheetTitle: optionalTrimmedString,
  paperLabel: optionalTrimmedString,
  awardedMarks: z.number().min(0).optional(),
  maxMarks: z.number().min(0).optional(),
});

export type SparkLearningGapSource = z.infer<
  typeof SparkLearningGapSourceSchema
>;

export const SparkLearningGapSchema = z.object({
  id: trimmedString,
  schemaVersion: z.literal(1),
  status: SparkLearningGapStatusSchema,
  type: SparkLearningGapTypeSchema,
  title: trimmedString,
  cardQuestion: trimmedString,
  shortRationale: optionalTrimmedString,
  subjectKey: trimmedString,
  subjectLabel: trimmedString,
  dedupeKey: trimmedString,
  severity: z.number().int().min(1).max(5),
  source: SparkLearningGapSourceSchema,
  steps: z.array(SparkLearningGapStepSchema).min(2).max(14),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
});

export type SparkLearningGap = z.infer<typeof SparkLearningGapSchema>;

export const SparkGapsFinderPendingRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: trimmedString,
  runVersion: trimmedString,
  completedAt: FirestoreTimestampSchema.optional(),
  queuedAt: FirestoreTimestampSchema,
  status: z.enum(["pending", "processing"]),
});

export type SparkGapsFinderPendingRun = z.infer<
  typeof SparkGapsFinderPendingRunSchema
>;

export const SparkGapsFinderProcessedRunSchema = z.object({
  schemaVersion: z.literal(1),
  runId: trimmedString,
  runVersion: trimmedString,
  completedAt: FirestoreTimestampSchema.optional(),
  processedAt: FirestoreTimestampSchema,
  gapCount: z.number().int().min(0),
  candidateCount: z.number().int().min(0),
  workspaceId: trimmedString.optional(),
});

export type SparkGapsFinderProcessedRun = z.infer<
  typeof SparkGapsFinderProcessedRunSchema
>;

export const SparkGapsFinderStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["idle", "running", "failed"]),
  leaseId: z.string().trim().min(1).nullable().optional(),
  startedAt: FirestoreTimestampSchema.nullable().optional(),
  updatedAt: FirestoreTimestampSchema,
  lastCompletedAt: FirestoreTimestampSchema.optional(),
  lastWorkspaceId: optionalTrimmedString,
  lastError: optionalTrimmedString,
});

export type SparkGapsFinderState = z.infer<
  typeof SparkGapsFinderStateSchema
>;
