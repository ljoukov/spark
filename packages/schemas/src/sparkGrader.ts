import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";
import {
  PaperSheetAnswersSchema,
  SparkGraderWorksheetReportSchema,
  SparkSolveSheetDraftSchema,
} from "./paperSheet";
import { SparkTutorReviewStateSchema } from "./sparkTutorSession";

const trimmedString = z.string().trim().min(1);

export const SparkGraderRunStatusSchema = z.enum([
  "created",
  "executing",
  "stopped",
  "failed",
  "done",
]);

export type SparkGraderRunStatus = z.infer<typeof SparkGraderRunStatusSchema>;

export const SparkSheetPhaseSchema = z.enum([
  "building",
  "solving",
  "grading",
  "graded",
]);

export type SparkSheetPhase = z.infer<typeof SparkSheetPhaseSchema>;

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
  subtitle: trimmedString.optional(),
  summaryMarkdown: trimmedString.optional(),
  footer: trimmedString.optional(),
});

export type SparkGraderPresentation = z.infer<
  typeof SparkGraderPresentationSchema
>;

export const SparkSheetDashboardSubjectTagSchema = z.object({
  key: trimmedString,
  label: trimmedString,
});

export type SparkSheetDashboardSubjectTag = z.infer<
  typeof SparkSheetDashboardSubjectTagSchema
>;

const dashboardDetailListSchema = z.array(trimmedString).max(6).default([]);

export const SparkSheetRunAnalysisSchema = z
  .object({
    runId: trimmedString,
    subjectTags: z.array(SparkSheetDashboardSubjectTagSchema).min(1).max(4),
    primarySubjectKey: trimmedString.optional(),
    summary: trimmedString.optional(),
    strongSpots: z.array(trimmedString).max(5).default([]),
    weakSpots: z.array(trimmedString).max(5).default([]),
    specifics: dashboardDetailListSchema,
    nextSteps: dashboardDetailListSchema,
    generalFeedback: trimmedString.optional(),
  })
  .superRefine((analysis, ctx) => {
    if (
      analysis.primarySubjectKey &&
      !analysis.subjectTags.some((tag) => tag.key === analysis.primarySubjectKey)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primarySubjectKey"],
        message: "primarySubjectKey must match one of subjectTags[].key.",
      });
    }
  });

export type SparkSheetRunAnalysis = z.infer<
  typeof SparkSheetRunAnalysisSchema
>;

export const SparkSheetDashboardFocusAreaSchema = z.object({
  id: trimmedString,
  title: trimmedString,
  summary: trimmedString,
  evidenceRunIds: z.array(trimmedString).max(12).default([]),
  subjectKeys: z.array(trimmedString).max(6).default([]),
  specifics: dashboardDetailListSchema,
  nextSteps: dashboardDetailListSchema,
  generalFeedback: trimmedString.optional(),
});

export type SparkSheetDashboardFocusArea = z.infer<
  typeof SparkSheetDashboardFocusAreaSchema
>;

export const SparkSheetDashboardSubjectSummarySchema = z.object({
  key: trimmedString,
  label: trimmedString,
  summary: trimmedString,
  runIds: z.array(trimmedString).max(24).default([]),
  averagePercentage: z.number().min(0).max(100).nullable().optional(),
  strongSpots: z.array(trimmedString).max(4).default([]),
  weakSpots: z.array(trimmedString).max(4).default([]),
  specifics: dashboardDetailListSchema,
  nextSteps: dashboardDetailListSchema,
  generalFeedback: trimmedString.optional(),
});

export type SparkSheetDashboardSubjectSummary = z.infer<
  typeof SparkSheetDashboardSubjectSummarySchema
>;

export const SparkSheetDashboardSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.literal("sheet_dashboard"),
    headline: trimmedString,
    summaryMarkdown: trimmedString.optional(),
    focusNote: trimmedString.optional(),
    generatedFromRunId: trimmedString.optional(),
    strengths: z.array(SparkSheetDashboardFocusAreaSchema).max(8).default([]),
    weakSpots: z.array(SparkSheetDashboardFocusAreaSchema).max(8).default([]),
    subjects: z.array(SparkSheetDashboardSubjectSummarySchema).max(12).default([]),
    runAnalyses: z.array(SparkSheetRunAnalysisSchema).default([]),
  })
  .superRefine((dashboard, ctx) => {
    const seenRunIds = new Set<string>();
    for (let index = 0; index < dashboard.runAnalyses.length; index += 1) {
      const analysis = dashboard.runAnalyses[index];
      if (seenRunIds.has(analysis.runId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["runAnalyses", index, "runId"],
          message: "runAnalyses must not contain duplicate runIds.",
        });
      }
      seenRunIds.add(analysis.runId);
    }
  });

export type SparkSheetDashboard = z.infer<typeof SparkSheetDashboardSchema>;

export const SparkSheetDashboardStateSchema =
  SparkSheetDashboardSchema.extend({
    updatedAt: FirestoreTimestampSchema,
  });

export type SparkSheetDashboardState = z.infer<
  typeof SparkSheetDashboardStateSchema
>;

export const SparkGraderRunDisplaySchema = z.object({
  title: trimmedString,
  subtitle: z.string().trim().min(1).nullable(),
  metaLine: z.string().trim().min(1).nullable(),
  summaryMarkdown: z.string().trim().min(1).nullable(),
  footer: z.string().trim().min(1).nullable(),
});

export type SparkGraderRunDisplay = z.infer<
  typeof SparkGraderRunDisplaySchema
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
  draftAnswersPath: trimmedString.optional(),
  sourceAttachmentIds: z.array(trimmedString).optional(),
  sourceAttachmentCount: z.number().int().min(0).optional(),
  status: SparkGraderRunStatusSchema,
  sheetPhase: SparkSheetPhaseSchema.optional(),
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

export const SparkSheetPageRunSchema = z.object({
  id: trimmedString,
  workspaceId: trimmedString,
  status: SparkGraderRunStatusSchema,
  sheetPhase: SparkSheetPhaseSchema,
  display: SparkGraderRunDisplaySchema,
  totals: z
    .object({
      awardedMarks: z.number().min(0),
      maxMarks: z.number().min(0),
      percentage: z.number().min(0).max(100).nullable(),
    })
    .nullable(),
  error: z.string().trim().min(1).nullable(),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});

export type SparkSheetPageRun = z.infer<typeof SparkSheetPageRunSchema>;

export const SparkSheetPageSourceLinkSchema = z.object({
  label: trimmedString,
  href: trimmedString,
});

export type SparkSheetPageSourceLink = z.infer<
  typeof SparkSheetPageSourceLinkSchema
>;

export const SparkSheetPageArtifactPathsSchema = z.object({
  draft: trimmedString,
  report: trimmedString,
  draftAnswers: trimmedString,
});

export type SparkSheetPageArtifactPaths = z.infer<
  typeof SparkSheetPageArtifactPathsSchema
>;

export const SparkSheetPageInteractionSchema = z.object({
  id: trimmedString,
  workspaceId: trimmedString,
  status: z.string().trim().min(1),
  reviewState: SparkTutorReviewStateSchema,
  activeTurnAgentId: z.string().trim().min(1).nullable(),
  activeTurnQuestionId: z.string().trim().min(1).nullable(),
  error: z.string().trim().min(1).nullable(),
});

export type SparkSheetPageInteraction = z.infer<
  typeof SparkSheetPageInteractionSchema
>;

export const SparkSheetPageStateSchema = z.object({
  run: SparkSheetPageRunSchema,
  artifactPaths: SparkSheetPageArtifactPathsSchema,
  draft: SparkSolveSheetDraftSchema.nullable(),
  draftAnswers: PaperSheetAnswersSchema,
  report: SparkGraderWorksheetReportSchema.nullable(),
  initialReviewState: SparkTutorReviewStateSchema.nullable(),
  interaction: SparkSheetPageInteractionSchema.nullable(),
  sourceLinks: z.array(SparkSheetPageSourceLinkSchema),
});

export type SparkSheetPageState = z.infer<typeof SparkSheetPageStateSchema>;
