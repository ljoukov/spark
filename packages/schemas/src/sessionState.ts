import { z } from "zod";
import { FirestoreTimestampSchema } from "./firestore";

const trimmedId = z.string().trim().min(1, "id is required");

const sessionStateStatus = z.enum(["not_started", "in_progress", "completed"]);

export const PlanItemStateSchema = z.object({
  status: sessionStateStatus,
  score: z.number().finite().min(0).optional(),
  startedAt: FirestoreTimestampSchema.optional(),
  completedAt: FirestoreTimestampSchema.optional(),
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
