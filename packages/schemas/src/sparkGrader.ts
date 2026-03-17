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

export const SparkGraderTotalsSchema = z.object({
  awardedMarks: z.number().min(0),
  maxMarks: z.number().min(0),
  problemCount: z.number().int().min(0),
  gradedCount: z.number().int().min(0),
  percentage: z.number().min(0).max(100).optional(),
});

export type SparkGraderTotals = z.infer<typeof SparkGraderTotalsSchema>;

export const SparkGraderSheetSummarySchema = z.object({
  title: trimmedString.optional(),
  filePath: trimmedString,
});

export type SparkGraderSheetSummary = z.infer<
  typeof SparkGraderSheetSummarySchema
>;

export const SparkGraderPaperSchema = z
  .object({
    contextLabel: trimmedString.optional(),
    olympiad: trimmedString.optional(),
    year: trimmedString.optional(),
    paperName: trimmedString.optional(),
    paperUrl: trimmedString.optional(),
    markSchemeUrl: trimmedString.optional(),
  })
  .transform(({ contextLabel, olympiad, ...rest }) => ({
    ...rest,
    ...(contextLabel ?? olympiad ? { contextLabel: contextLabel ?? olympiad } : {}),
  }));

export type SparkGraderPaper = z.infer<typeof SparkGraderPaperSchema>;

export const SparkGraderPresentationSchema = z.object({
  title: trimmedString.optional(),
  summaryMarkdown: trimmedString.optional(),
});

export type SparkGraderPresentation = z.infer<
  typeof SparkGraderPresentationSchema
>;

export const SparkGraderRunSchema = z.object({
  id: trimmedString,
  agentId: trimmedString,
  workspaceId: trimmedString,
  conversationId: trimmedString.optional(),
  userPrompt: trimmedString.optional(),
  olympiadKey: trimmedString,
  olympiadLabel: trimmedString,
  summaryPath: trimmedString,
  problemsDir: trimmedString.optional(),
  sheetPath: trimmedString,
  sourceAttachmentIds: z.array(trimmedString).optional(),
  sourceAttachmentCount: z.number().int().min(0).optional(),
  status: SparkGraderRunStatusSchema,
  paper: SparkGraderPaperSchema.optional(),
  presentation: SparkGraderPresentationSchema.optional(),
  totals: SparkGraderTotalsSchema.optional(),
  problems: z.array(SparkGraderProblemSummarySchema).optional(),
  sheet: SparkGraderSheetSummarySchema.optional(),
  resultSummary: z.string().trim().optional(),
  error: z.string().trim().optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  completedAt: FirestoreTimestampSchema.optional(),
});

export type SparkGraderRun = z.infer<typeof SparkGraderRunSchema>;
