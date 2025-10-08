import { z } from "zod";
import { FirestoreTimestampSchema } from "./firestore";

const trimmedId = z.string().trim().min(1, "id is required");

const optionalTrimmed = z.string().trim().min(1).optional();

const planItemBase = z.object({
  id: trimmedId,
  title: z.string().trim().min(1, "title is required"),
  summary: optionalTrimmed,
  description: optionalTrimmed,
  icon: optionalTrimmed,
  meta: optionalTrimmed,
});

const QuizPlanItemSchema = planItemBase.extend({
  kind: z.literal("quiz"),
  progressKey: optionalTrimmed,
});

const ProblemPlanItemSchema = planItemBase.extend({
  kind: z.literal("problem"),
  difficulty: optionalTrimmed,
  topic: optionalTrimmed,
});

const MediaPlanItemSchema = planItemBase.extend({
  kind: z.literal("media"),
  duration: z.number().nonnegative().optional(),
});

export const PlanItemSchema = z.discriminatedUnion("kind", [
  QuizPlanItemSchema,
  ProblemPlanItemSchema,
  MediaPlanItemSchema,
]);

export type PlanItem = z.infer<typeof PlanItemSchema>;

export const SessionSchema = z
  .object({
    id: trimmedId,
    title: z.string().trim().min(1, "title is required").optional(),
    createdAt: FirestoreTimestampSchema,
    plan: z.array(PlanItemSchema).min(1, "plan must contain at least one item"),
  })
  .transform(({ id, title, createdAt, plan }) => {
    const planItems = plan.map((item) => ({ ...item }));
    const resolvedTitle = title ?? planItems[0]?.title ?? "Your session plan";

    return {
      id,
      title: resolvedTitle,
      createdAt,
      plan: planItems,
    };
  });

export type Session = z.infer<typeof SessionSchema>;
