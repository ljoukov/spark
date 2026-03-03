import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";

const trimmedString = z.string().trim().min(1);

export const SparkGraderRunStatusSchema = z.enum([
  "created",
  "executing",
  "stopped",
  "failed",
  "done",
]);

export type SparkGraderRunStatus = z.infer<typeof SparkGraderRunStatusSchema>;

export const SparkGraderProblemVerdictSchema = z.enum([
  "correct",
  "partial",
  "incorrect",
  "ungraded",
]);

export type SparkGraderProblemVerdict = z.infer<
  typeof SparkGraderProblemVerdictSchema
>;

export const SparkGraderTotalsSchema = z.object({
  awardedMarks: z.number().min(0),
  maxMarks: z.number().min(0),
  problemCount: z.number().int().min(0),
  gradedCount: z.number().int().min(0),
  percentage: z.number().min(0).max(100).optional(),
});

export type SparkGraderTotals = z.infer<typeof SparkGraderTotalsSchema>;

export const SparkGraderProblemSummarySchema = z.object({
  id: trimmedString,
  index: z.number().int().min(1),
  title: trimmedString.optional(),
  awardedMarks: z.number().min(0).optional(),
  maxMarks: z.number().min(0).optional(),
  verdict: SparkGraderProblemVerdictSchema.optional(),
  filePath: trimmedString,
});

export type SparkGraderProblemSummary = z.infer<
  typeof SparkGraderProblemSummarySchema
>;

export const SparkGraderPaperSchema = z.object({
  olympiad: trimmedString.optional(),
  year: trimmedString.optional(),
  paperName: trimmedString.optional(),
  paperUrl: trimmedString.optional(),
  markSchemeUrl: trimmedString.optional(),
});

export type SparkGraderPaper = z.infer<typeof SparkGraderPaperSchema>;

export const SparkGraderRunSchema = z.object({
  id: trimmedString,
  agentId: trimmedString,
  workspaceId: trimmedString,
  conversationId: trimmedString.optional(),
  userPrompt: trimmedString.optional(),
  olympiadKey: trimmedString,
  olympiadLabel: trimmedString,
  memoryPath: trimmedString,
  summaryPath: trimmedString,
  problemsDir: trimmedString,
  sourceAttachmentIds: z.array(trimmedString).optional(),
  sourceAttachmentCount: z.number().int().min(0).optional(),
  status: SparkGraderRunStatusSchema,
  paper: SparkGraderPaperSchema.optional(),
  totals: SparkGraderTotalsSchema.optional(),
  problems: z.array(SparkGraderProblemSummarySchema).optional(),
  resultSummary: z.string().trim().optional(),
  error: z.string().trim().optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  completedAt: FirestoreTimestampSchema.optional(),
});

export type SparkGraderRun = z.infer<typeof SparkGraderRunSchema>;

export const SparkGraderMemoryFileSchema = z.object({
  path: z.literal("memory.md"),
  content: z.string(),
  olympiadKey: trimmedString,
  olympiadLabel: trimmedString,
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  sizeBytes: z.number().int().min(0).optional(),
  contentType: trimmedString.optional(),
});

export type SparkGraderMemoryFile = z.infer<typeof SparkGraderMemoryFileSchema>;
