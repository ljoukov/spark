import { z } from "zod";
import { FirestoreTimestampSchema } from "./firestore";

const trimmedId = z.string().trim().min(1, "id is required");

const sessionStateStatus = z.enum(["not_started", "in_progress", "completed"]);

const quizAttemptStatus = z.enum(["pending", "correct", "incorrect", "skipped"]);

export const QuizQuestionStateSchema = z
  .object({
    status: quizAttemptStatus.default("pending"),
    selectedOptionId: trimmedId.optional(),
    typedValue: z.string().optional(),
    hintUsed: z.boolean().optional(),
    dontKnow: z.boolean().optional(),
    firstViewedAt: FirestoreTimestampSchema.optional(),
    answeredAt: FirestoreTimestampSchema.optional(),
  })
  .transform((value) => {
    const result: {
      status: z.infer<typeof quizAttemptStatus>;
      selectedOptionId?: string;
      typedValue?: string;
      hintUsed?: boolean;
      dontKnow?: boolean;
      firstViewedAt?: Date;
      answeredAt?: Date;
    } = {
      status: value.status,
    };

    const trimmedTypedValue = value.typedValue?.trim();
    if (value.selectedOptionId) {
      result.selectedOptionId = value.selectedOptionId;
    }
    if (trimmedTypedValue) {
      result.typedValue = trimmedTypedValue;
    }
    if (value.hintUsed === true) {
      result.hintUsed = true;
    }
    if (value.dontKnow === true) {
      result.dontKnow = true;
    }
    if (value.firstViewedAt) {
      result.firstViewedAt = value.firstViewedAt;
    }
    if (value.answeredAt) {
      result.answeredAt = value.answeredAt;
    }

    return result;
  });

export type QuizQuestionState = z.infer<typeof QuizQuestionStateSchema>;

export const PlanItemQuizStateSchema = z
  .object({
    lastQuestionIndex: z.number().int().min(0).optional(),
    lastQuestionId: trimmedId.optional(),
    questions: z.record(trimmedId, QuizQuestionStateSchema).default({}),
    serverCompletedAt: FirestoreTimestampSchema.optional(),
  })
  .transform(({ lastQuestionIndex, lastQuestionId, questions, serverCompletedAt }) => {
    const result: {
      lastQuestionIndex?: number;
      lastQuestionId?: string;
      questions: Record<string, z.infer<typeof QuizQuestionStateSchema>>;
      serverCompletedAt?: Date;
    } = {
      questions,
    };

    if (typeof lastQuestionIndex === "number") {
      result.lastQuestionIndex = lastQuestionIndex;
    }
    if (lastQuestionId) {
      result.lastQuestionId = lastQuestionId;
    }
    if (serverCompletedAt) {
      result.serverCompletedAt = serverCompletedAt;
    }

    return result;
  });

export type PlanItemQuizState = z.infer<typeof PlanItemQuizStateSchema>;

export const PlanItemStateSchema = z
  .object({
    status: sessionStateStatus,
    startedAt: FirestoreTimestampSchema.optional(),
    completedAt: FirestoreTimestampSchema.optional(),
    quiz: PlanItemQuizStateSchema.optional(),
  })
  .transform(({ status, startedAt, completedAt, quiz }) => {
    const result: {
      status: z.infer<typeof sessionStateStatus>;
      startedAt?: Date;
      completedAt?: Date;
      quiz?: z.infer<typeof PlanItemQuizStateSchema>;
    } = {
      status,
    };

    if (startedAt) {
      result.startedAt = startedAt;
    }
    if (completedAt) {
      result.completedAt = completedAt;
    }
    if (quiz) {
      result.quiz = quiz;
    }

    return result;
  });

export type PlanItemState = z.infer<typeof PlanItemStateSchema>;

export const SessionStateSchema = z
  .object({
    sessionId: trimmedId,
    items: z.record(z.string(), PlanItemStateSchema).default({}),
    lastUpdatedAt: FirestoreTimestampSchema,
  })
  .transform(({ sessionId, items, lastUpdatedAt }) => ({
    sessionId,
    items,
    lastUpdatedAt,
  }));

export type SessionState = z.infer<typeof SessionStateSchema>;
