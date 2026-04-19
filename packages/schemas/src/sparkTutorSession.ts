import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";
import {
  PaperSheetFeedbackAttachmentSchema,
  PaperSheetAnswersSchema,
  PaperSheetDataSchema,
  PaperSheetReviewSchema,
} from "./paperSheet";
import { SparkLearningGapGuidedPresentationSchema } from "./sparkGaps";

const trimmedString = z.string().trim().min(1);

export const SparkTutorSessionStatusSchema = z.enum([
  "booting",
  "awaiting_student",
  "responding",
  "completed",
  "failed",
]);

export type SparkTutorSessionStatus = z.infer<
  typeof SparkTutorSessionStatusSchema
>;

export const SparkTutorConfidenceSchema = z.enum(["low", "mid", "high"]);

export type SparkTutorConfidence = z.infer<typeof SparkTutorConfidenceSchema>;

export const SparkTutorHintLevelSchema = z.enum([
  "nudge",
  "pointer",
  "key_step",
]);

export type SparkTutorHintLevel = z.infer<typeof SparkTutorHintLevelSchema>;

export const SparkTutorSessionSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sheet"),
    runId: trimmedString,
    sheetTitle: trimmedString,
    awardedMarks: z.number().min(0).optional(),
    maxMarks: z.number().min(0).optional(),
  }),
]);

export type SparkTutorSessionSource = z.infer<
  typeof SparkTutorSessionSourceSchema
>;

export const SparkTutorHintButtonSchema = z.object({
  id: trimmedString,
  label: trimmedString,
  kind: z.literal("hint"),
  hintLevel: SparkTutorHintLevelSchema,
});

export type SparkTutorHintButton = z.infer<typeof SparkTutorHintButtonSchema>;

export const SparkTutorComposerStateSchema = z.object({
  placeholder: trimmedString,
  disabled: z.boolean(),
  submitLabel: trimmedString.optional(),
  allowConfidence: z.boolean().optional(),
  confidenceLabel: trimmedString.optional(),
  hintButtons: z.array(SparkTutorHintButtonSchema).optional(),
});

export type SparkTutorComposerState = z.infer<
  typeof SparkTutorComposerStateSchema
>;

export const SparkTutorScreenStateSchema = z.object({
  status: SparkTutorSessionStatusSchema,
  title: trimmedString,
  focusLabel: trimmedString.optional(),
  updatedAt: z.string().datetime({ offset: true }),
});

export type SparkTutorScreenState = z.infer<typeof SparkTutorScreenStateSchema>;

export const SparkTutorHistoryEntrySchema = z.object({
  role: z.enum(["assistant", "student"]),
  kind: z.enum(["full_turn", "reply", "hint_request"]),
  text: z.string(),
  confidence: SparkTutorConfidenceSchema.optional(),
  hintLevel: SparkTutorHintLevelSchema.optional(),
  createdAt: z.string().datetime({ offset: true }),
});

export type SparkTutorHistoryEntry = z.infer<
  typeof SparkTutorHistoryEntrySchema
>;

export const SparkTutorReviewThreadStatusSchema = z.enum([
  "open",
  "responding",
  "resolved",
]);

export type SparkTutorReviewThreadStatus = z.infer<
  typeof SparkTutorReviewThreadStatusSchema
>;

export const SparkTutorReviewGapBandSchema = z.enum([
  "large_gap",
  "medium_gap",
  "small_gap",
  "closed",
]);

export type SparkTutorReviewGapBand = z.infer<
  typeof SparkTutorReviewGapBandSchema
>;

export const SparkTutorGuidedPhaseSchema = z.enum([
  "questions",
  "memory",
  "compose",
  "feedback",
  "model",
]);

export type SparkTutorGuidedPhase = z.infer<typeof SparkTutorGuidedPhaseSchema>;

export const SparkTutorGuidedFieldStatusSchema = z.enum([
  "idle",
  "judging",
  "correct",
  "partial",
  "incorrect",
  "error",
]);

export type SparkTutorGuidedFieldStatus = z.infer<
  typeof SparkTutorGuidedFieldStatusSchema
>;

export const SparkTutorGuidedFieldResultSchema = z.object({
  status: SparkTutorGuidedFieldStatusSchema,
  feedback: z.string(),
});

export type SparkTutorGuidedFieldResult = z.infer<
  typeof SparkTutorGuidedFieldResultSchema
>;

export const SparkTutorGuidedFieldAttemptSchema = z.object({
  answer: z.string().max(400),
  result: z.enum(["correct", "partial", "incorrect"]),
  feedback: z.string().max(400),
});

export type SparkTutorGuidedFieldAttempt = z.infer<
  typeof SparkTutorGuidedFieldAttemptSchema
>;

export const SparkTutorGuidedAnnotationSchema = z.object({
  id: trimmedString,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  type: trimmedString,
  label: trimmedString,
  comment: trimmedString,
});

export const SparkTutorGuidedAnnotationTypeSchema = z.object({
  label: trimmedString.optional(),
  lightColor: trimmedString,
  lightBackground: trimmedString,
  lightBorderColor: trimmedString,
  darkColor: trimmedString,
  darkBackground: trimmedString,
  darkBorderColor: trimmedString,
});

export const SparkTutorGuidedGradeResultSchema = z.object({
  awardedMarks: z.number().int().nonnegative(),
  maxMarks: z.number().int().positive(),
  summary: trimmedString,
  document: z.object({
    heading: trimmedString,
    description: trimmedString,
    text: z.string(),
    annotations: z.array(SparkTutorGuidedAnnotationSchema).max(16),
    annotationTypes: z.record(
      trimmedString,
      SparkTutorGuidedAnnotationTypeSchema,
    ),
  }),
});

export type SparkTutorGuidedGradeResult = z.infer<
  typeof SparkTutorGuidedGradeResultSchema
>;

export const SparkTutorGuidedStateSchema = z.object({
  phase: SparkTutorGuidedPhaseSchema.optional(),
  maxVisitedPhaseIndex: z.number().int().min(0).max(4).optional(),
  answers: z.record(trimmedString, z.string().max(1000)).optional(),
  writtenAnswer: z.string().max(4000).optional(),
  fieldResults: z
    .record(trimmedString, SparkTutorGuidedFieldResultSchema)
    .optional(),
  lastChecked: z.record(trimmedString, z.string().max(1000)).optional(),
  fieldAttempts: z
    .record(trimmedString, z.array(SparkTutorGuidedFieldAttemptSchema).max(8))
    .optional(),
  gradeResult: SparkTutorGuidedGradeResultSchema.nullable().optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

export type SparkTutorGuidedState = z.infer<typeof SparkTutorGuidedStateSchema>;

export const SparkTutorReviewMessageSchema = z
  .object({
    id: trimmedString,
    author: z.enum(["assistant", "student"]),
    markdown: z.string().trim(),
    attachments: z.array(PaperSheetFeedbackAttachmentSchema).optional(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .superRefine((message, ctx) => {
    if (message.markdown.length > 0) {
      return;
    }
    if ((message.attachments?.length ?? 0) > 0) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["markdown"],
      message: "Review messages need markdown or at least one attachment.",
    });
  });

export type SparkTutorReviewMessage = z.infer<
  typeof SparkTutorReviewMessageSchema
>;

export const SparkTutorReviewThreadSchema = z.object({
  questionId: trimmedString,
  status: SparkTutorReviewThreadStatusSchema,
  gapBand: SparkTutorReviewGapBandSchema.optional(),
  messages: z.array(SparkTutorReviewMessageSchema),
  guidedPresentation: SparkLearningGapGuidedPresentationSchema.optional(),
  guidedState: SparkTutorGuidedStateSchema.optional(),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
});

export type SparkTutorReviewThread = z.infer<
  typeof SparkTutorReviewThreadSchema
>;

export const SparkTutorReviewStateSchema = z.object({
  sheet: PaperSheetDataSchema,
  answers: PaperSheetAnswersSchema,
  review: PaperSheetReviewSchema,
  threads: z.record(trimmedString, SparkTutorReviewThreadSchema),
  updatedAt: z.string().datetime({ offset: true }),
});

export type SparkTutorReviewState = z.infer<typeof SparkTutorReviewStateSchema>;

export const SparkTutorSessionSchema = z.object({
  id: trimmedString,
  workspaceId: trimmedString,
  status: SparkTutorSessionStatusSchema,
  source: SparkTutorSessionSourceSchema,
  title: trimmedString,
  preview: trimmedString.optional(),
  focusLabel: trimmedString.optional(),
  activeTurnAgentId: trimmedString.optional(),
  activeTurnQuestionId: trimmedString.optional(),
  reviewState: SparkTutorReviewStateSchema.optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  completedAt: FirestoreTimestampSchema.optional(),
  error: z.string().trim().optional(),
});

export type SparkTutorSession = z.infer<typeof SparkTutorSessionSchema>;
