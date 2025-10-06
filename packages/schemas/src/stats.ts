import { z } from "zod";

export const DEFAULT_USER_STATS = Object.freeze({
  xp: 0,
  level: 1,
  streakDays: 1,
  solvedCount: 0,
});

export const UserStatsSchema = z
  .object({
    xp: z.number().int().nonnegative().default(DEFAULT_USER_STATS.xp),
    level: z.number().int().min(1).default(DEFAULT_USER_STATS.level),
    streakDays: z.number().int().min(1).default(DEFAULT_USER_STATS.streakDays),
    solvedCount: z
      .number()
      .int()
      .nonnegative()
      .default(DEFAULT_USER_STATS.solvedCount),
  })
  .transform(({ xp, level, streakDays, solvedCount }) => ({
    xp,
    level,
    streakDays,
    solvedCount,
  }));

export type UserStats = z.infer<typeof UserStatsSchema>;
