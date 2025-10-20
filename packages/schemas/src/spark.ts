import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";
import { QuizDefinitionSchema } from "./quiz";

const trimmedString = z.string().trim().min(1);

export const SparkUploadStatusSchema = z.enum([
  "uploaded",
  "processing",
  "ready",
  "failed",
]);

export type SparkUploadStatus = z.infer<typeof SparkUploadStatusSchema>;

export const SparkUploadQuizStatusSchema = z.enum([
  "pending",
  "generating",
  "ready",
  "failed",
]);

export type SparkUploadQuizStatus = z.infer<typeof SparkUploadQuizStatusSchema>;

export const SparkUploadDocumentSchema = z.object({
  filename: trimmedString,
  storagePath: trimmedString,
  contentType: trimmedString,
  hash: trimmedString,
  sizeBytes: z.number().int().min(1),
  status: SparkUploadStatusSchema,
  quizStatus: SparkUploadQuizStatusSchema,
  quizQuestionCount: z.number().int().min(0),
  uploadedAt: FirestoreTimestampSchema,
  lastUpdatedAt: FirestoreTimestampSchema.optional(),
  activeQuizId: trimmedString.optional(),
  latestError: z
    .string()
    .trim()
    .refine((value) => value.length > 0, "latestError cannot be empty")
    .optional(),
});

export type SparkUploadDocument = z.infer<typeof SparkUploadDocumentSchema>;

export const SparkUploadQuizDocumentSchema = z.object({
  uploadId: trimmedString,
  status: SparkUploadQuizStatusSchema,
  requestedQuestionCount: z.number().int().min(1),
  definition: QuizDefinitionSchema.optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema.optional(),
  failureReason: z
    .string()
    .trim()
    .refine((value) => value.length > 0, "failureReason cannot be empty")
    .optional(),
});

export type SparkUploadQuizDocument = z.infer<
  typeof SparkUploadQuizDocumentSchema
>;
