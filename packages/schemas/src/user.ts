import { z } from "zod";
import { DEFAULT_USER_STATS, UserStatsSchema } from "./stats";

const optionalId = z.string().trim().min(1).optional();

export const UserDocSchema = z
  .object({
    currentSessionId: optionalId,
    stats: UserStatsSchema.optional(),
  })
  .partial()
  .passthrough()
  .transform(({ currentSessionId, stats }) => ({
    currentSessionId: currentSessionId ?? null,
    stats: stats ?? DEFAULT_USER_STATS,
  }));

export type UserDoc = z.infer<typeof UserDocSchema>;
