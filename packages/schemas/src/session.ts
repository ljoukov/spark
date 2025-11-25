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

export const SessionStatusSchema = z.enum([
  "generating",
  "ready",
  "in_progress",
  "completed",
  "error",
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const LessonProposalSchema = z.object({
  id: trimmedId,
  title: z.string().trim().min(1, "title is required"),
  tagline: z.string().trim().min(1, "tagline is required"),
  topics: z
    .array(z.string().trim().min(1, "topic is required"))
    .min(1, "at least one topic is required"),
  emoji: z.string().trim().min(1, "emoji is required"),
});

export type LessonProposal = z.infer<typeof LessonProposalSchema>;

export const SessionSchema = z
  .object({
    id: trimmedId,
    title: z.string().trim().min(1, "title is required").optional(),
    summary: optionalTrimmed,
    tagline: optionalTrimmed,
    emoji: optionalTrimmed,
    createdAt: FirestoreTimestampSchema,
    plan: z.array(PlanItemSchema).optional(),
    status: SessionStatusSchema.optional(),
    topics: z.array(z.string().trim().min(1)).optional(),
    sourceSessionId: optionalTrimmed,
    sourceProposalId: optionalTrimmed,
    nextLessonProposals: z.array(LessonProposalSchema).optional(),
    nextLessonProposalsGeneratedAt: FirestoreTimestampSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const status = value.status ?? "ready";
    if (status !== "generating" && status !== "error") {
      if (!value.plan || value.plan.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["plan"],
          message: "plan must contain at least one item",
        });
      }
    }
  })
  .transform(
    ({
      id,
      title,
      createdAt,
      plan,
      summary,
      tagline,
      emoji,
      status,
      topics,
      sourceSessionId,
      sourceProposalId,
      nextLessonProposals,
      nextLessonProposalsGeneratedAt,
    }) => {
      const planItems = (plan ?? []).map((item) => ({ ...item }));
      const resolvedStatus = status ?? "ready";
      const resolvedTitle = title ?? planItems[0]?.title ?? "Your session plan";
      const sessionTopics =
        topics
          ?.map((topic) => topic.trim())
          .filter((topic) => topic.length > 0) ?? undefined;
      const proposals =
        nextLessonProposals?.map((proposal) => ({
          ...proposal,
          topics: proposal.topics
            .map((topic) => topic.trim())
            .filter((topic) => topic.length > 0),
        })) ?? [];

      const result: {
        id: string;
        title: string;
        createdAt: Date;
        plan: PlanItem[];
        status: SessionStatus;
        nextLessonProposals: LessonProposal[];
        summary?: string;
        tagline?: string;
        emoji?: string;
        topics?: string[];
        sourceSessionId?: string;
        sourceProposalId?: string;
        nextLessonProposalsGeneratedAt?: Date;
      } = {
        id,
        title: resolvedTitle,
        createdAt,
        plan: planItems,
        status: resolvedStatus,
        nextLessonProposals: proposals,
      };

      if (summary !== undefined) {
        result.summary = summary;
      }
      if (tagline !== undefined) {
        result.tagline = tagline;
      }
      if (emoji !== undefined) {
        result.emoji = emoji;
      }
      if (sessionTopics !== undefined) {
        result.topics = sessionTopics;
      }
      if (sourceSessionId !== undefined) {
        result.sourceSessionId = sourceSessionId;
      }
      if (sourceProposalId !== undefined) {
        result.sourceProposalId = sourceProposalId;
      }
      if (nextLessonProposalsGeneratedAt !== undefined) {
        result.nextLessonProposalsGeneratedAt = nextLessonProposalsGeneratedAt;
      }

      return result;
    },
  );

export type Session = z.infer<typeof SessionSchema>;
