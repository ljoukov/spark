import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";

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
    kind: z.literal("grader-problem"),
    runId: trimmedString,
    problemId: trimmedString,
    problemIndex: z.number().int().min(1),
    problemTitle: trimmedString,
    verdict: z.enum(["correct", "partial", "incorrect", "ungraded"]).optional(),
    awardedMarks: z.number().min(0).optional(),
    maxMarks: z.number().min(0).optional(),
  }),
]);

export type SparkTutorSessionSource = z.infer<
  typeof SparkTutorSessionSourceSchema
>;

export const SparkTutorSessionSchema = z.object({
  id: trimmedString,
  workspaceId: trimmedString,
  status: SparkTutorSessionStatusSchema,
  source: SparkTutorSessionSourceSchema,
  title: trimmedString,
  preview: trimmedString.optional(),
  focusLabel: trimmedString.optional(),
  activeTurnAgentId: trimmedString.optional(),
  latestDraftRevision: z.number().int().min(0).optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  completedAt: FirestoreTimestampSchema.optional(),
  error: z.string().trim().optional(),
});

export type SparkTutorSession = z.infer<typeof SparkTutorSessionSchema>;

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
  draftRevision: z.number().int().min(0).optional(),
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
