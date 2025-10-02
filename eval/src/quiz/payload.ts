import { z } from "zod";

import {
  JudgeAuditSchema,
  JudgeVerdictSchema,
  QUIZ_MODES,
  QuizGenerationSchema,
  type JudgeAudit,
  type JudgeVerdict,
  type QuizGeneration,
} from "@spark/llm/quiz/schemas";

export const QuizModelRunSchema = z.object({
  modelId: z.string().min(1),
});

export type QuizModelRun = z.infer<typeof QuizModelRunSchema>;

export const SampleJobSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  displayName: z.string().min(1),
  sourcePath: z.string().min(1),
  relativeSourcePath: z.string().min(1),
  questionCount: z.number().int().min(1),
  subject: z.string().min(1).optional(),
});

export type SampleJob = z.infer<typeof SampleJobSchema>;

export const QuizFileRequestSchema = z.object({
  model: z.string().min(1),
  questionCount: z.number().int().min(1),
});

export type QuizFileRequest = z.infer<typeof QuizFileRequestSchema>;

export const QuizFileSourceSchema = z.object({
  relativePath: z.string().min(1),
  displayName: z.string().min(1),
});

export type QuizFileSource = z.infer<typeof QuizFileSourceSchema>;

export const QuizFilePayloadSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(QUIZ_MODES),
  subject: z.string().min(1).optional(),
  generatedAt: z.string().min(1),
  request: QuizFileRequestSchema,
  source: QuizFileSourceSchema,
  prompt: z.string().min(1),
  quiz: QuizGenerationSchema,
  model: QuizModelRunSchema,
  job: SampleJobSchema,
});

export type QuizFilePayload = z.infer<typeof QuizFilePayloadSchema>;

export const JudgeFilePayloadSchema = z.object({
  id: z.string().min(1),
  evaluatedAt: z.string().min(1),
  prompt: z.string().min(1),
  source: QuizFileSourceSchema,
  job: SampleJobSchema,
  judge: z.object({
    model: QuizModelRunSchema,
    verdict: JudgeVerdictSchema,
  }),
  audit: z
    .object({
      model: QuizModelRunSchema,
      result: JudgeAuditSchema,
      auditedAt: z.string().min(1).optional(),
    })
    .optional(),
});

export type JudgeFilePayload = z.infer<typeof JudgeFilePayloadSchema>;

export const JudgeAuditFilePayloadSchema = z.object({
  id: z.string().min(1),
  evaluationType: z.enum(["quiz", "extension"]),
  evaluatedAt: z.string().min(1),
  auditedAt: z.string().min(1),
  source: QuizFileSourceSchema,
  job: SampleJobSchema,
  judge: z.object({
    model: QuizModelRunSchema,
    verdict: JudgeVerdictSchema,
  }),
  audit: z.object({
    model: QuizModelRunSchema,
    result: JudgeAuditSchema,
  }),
});

export type JudgeAuditFilePayload = z.infer<typeof JudgeAuditFilePayloadSchema>;

export type { JudgeAudit, JudgeVerdict, QuizGeneration };
