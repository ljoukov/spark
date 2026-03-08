import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";

const trimmedString = z.string().trim().min(1);

export const SparkAgentRoleSchema = z.enum([
  "user",
  "assistant",
  "tool",
  "system",
]);

export type SparkAgentRole = z.infer<typeof SparkAgentRoleSchema>;

export const SparkAgentAuthorSchema = z.object({
  userId: trimmedString,
  displayName: trimmedString.optional(),
  role: z.enum(["parent", "dependent"]).optional(),
});

export type SparkAgentAuthor = z.infer<typeof SparkAgentAuthorSchema>;

export const SparkAgentFileSchema = z.object({
  id: trimmedString.optional(),
  storagePath: trimmedString,
  contentType: trimmedString,
  filename: trimmedString.optional(),
  downloadUrl: trimmedString.optional(),
  sizeBytes: z.number().int().min(1),
  pageCount: z.number().int().min(1).optional(),
});

export type SparkAgentFile = z.infer<typeof SparkAgentFileSchema>;

export const SparkAgentAttachmentStatusSchema = z.enum([
  "uploading",
  "attaching",
  "attached",
  "failed",
]);

export type SparkAgentAttachmentStatus = z.infer<
  typeof SparkAgentAttachmentStatusSchema
>;

export const SparkAgentAttachmentSchema = z.object({
  id: trimmedString,
  storagePath: trimmedString,
  contentType: trimmedString,
  filename: trimmedString.optional(),
  downloadUrl: trimmedString.optional(),
  sizeBytes: z.number().int().min(1),
  pageCount: z.number().int().min(1).optional(),
  status: SparkAgentAttachmentStatusSchema,
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  messageId: trimmedString.optional(),
  error: trimmedString.optional(),
});

export type SparkAgentAttachment = z.infer<typeof SparkAgentAttachmentSchema>;

export const SparkAgentToolCallSchema = z.object({
  id: trimmedString,
  name: trimmedString,
  argsJson: z.string().trim(),
});

export type SparkAgentToolCall = z.infer<typeof SparkAgentToolCallSchema>;

export const SparkAgentToolResultSchema = z.object({
  toolCallId: trimmedString,
  outputJson: z.string().trim(),
  status: z.enum(["ok", "error"]),
});

export type SparkAgentToolResult = z.infer<typeof SparkAgentToolResultSchema>;

const SparkAgentLessonRunCardSchema = z.object({
  kind: z.literal("lesson"),
  sessionId: trimmedString,
  href: trimmedString,
  listHref: trimmedString,
  title: trimmedString.optional(),
});

const SparkAgentGraderRunCardSchema = z.object({
  kind: z.literal("grader"),
  runId: trimmedString,
  href: trimmedString,
  listHref: trimmedString,
  title: trimmedString.optional(),
  sourceAttachmentCount: z.number().int().min(0).optional(),
});

export const SparkAgentRunCardSchema = z.discriminatedUnion("kind", [
  SparkAgentLessonRunCardSchema,
  SparkAgentGraderRunCardSchema,
]);

export type SparkAgentRunCard = z.infer<typeof SparkAgentRunCardSchema>;

const SparkAgentTextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const SparkAgentImagePartSchema = z.object({
  type: z.literal("image"),
  file: SparkAgentFileSchema,
});

const SparkAgentFilePartSchema = z.object({
  type: z.literal("file"),
  file: SparkAgentFileSchema,
});

const SparkAgentToolCallPartSchema = z.object({
  type: z.literal("tool_call"),
  toolCall: SparkAgentToolCallSchema,
});

const SparkAgentToolResultPartSchema = z.object({
  type: z.literal("tool_result"),
  toolResult: SparkAgentToolResultSchema,
});

const SparkAgentRunCardPartSchema = z.object({
  type: z.literal("agent_run"),
  runCard: SparkAgentRunCardSchema,
});

export const SparkAgentContentPartSchema = z.union([
  SparkAgentTextPartSchema,
  SparkAgentImagePartSchema,
  SparkAgentFilePartSchema,
  SparkAgentToolCallPartSchema,
  SparkAgentToolResultPartSchema,
  SparkAgentRunCardPartSchema,
]);

export type SparkAgentContentPart = z.infer<typeof SparkAgentContentPartSchema>;

export const SparkAgentMessageSchema = z.object({
  id: trimmedString,
  role: SparkAgentRoleSchema,
  author: SparkAgentAuthorSchema.optional(),
  createdAt: FirestoreTimestampSchema,
  content: z.array(SparkAgentContentPartSchema),
});

export type SparkAgentMessage = z.infer<typeof SparkAgentMessageSchema>;

export const SparkAgentConversationSchema = z.object({
  id: trimmedString,
  familyId: trimmedString.optional(),
  participantIds: z.array(trimmedString).min(1),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  lastMessageAt: FirestoreTimestampSchema,
  messages: z.array(SparkAgentMessageSchema),
  attachments: z.array(SparkAgentAttachmentSchema).optional(),
});

export type SparkAgentConversation = z.infer<
  typeof SparkAgentConversationSchema
>;

export type SparkAgentConversationNormalizationIssues = {
  repairedId: boolean;
  defaultedParticipantIds: boolean;
  defaultedCreatedAt: boolean;
  defaultedUpdatedAt: boolean;
  defaultedLastMessageAt: boolean;
  droppedMessages: number;
  droppedAttachments: number;
  droppedContentParts: number;
};

export type SparkAgentConversationNormalizationResult = {
  conversation: SparkAgentConversation;
  issues: SparkAgentConversationNormalizationIssues;
};

function resolveSparkAgentTimestamp(
  value: unknown,
  fallback: Date,
): { value: Date; defaulted: boolean } {
  const parsed = FirestoreTimestampSchema.safeParse(value);
  if (parsed.success) {
    return { value: parsed.data, defaulted: false };
  }
  return { value: fallback, defaulted: true };
}

function normalizeSparkAgentAuthor(value: unknown): SparkAgentAuthor | undefined {
  const parsed = SparkAgentAuthorSchema.safeParse(value);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data;
}

function normalizeSparkAgentContentParts(value: unknown): {
  content: SparkAgentContentPart[];
  droppedContentParts: number;
} {
  if (!Array.isArray(value)) {
    return { content: [], droppedContentParts: 0 };
  }
  const content: SparkAgentContentPart[] = [];
  let droppedContentParts = 0;
  for (const entry of value) {
    const parsed = SparkAgentContentPartSchema.safeParse(entry);
    if (!parsed.success) {
      droppedContentParts += 1;
      continue;
    }
    content.push(parsed.data);
  }
  return { content, droppedContentParts };
}

function normalizeSparkAgentMessage(
  value: unknown,
  fallbackDate: Date,
): { message: SparkAgentMessage | null; droppedContentParts: number } {
  if (!value || typeof value !== "object") {
    return { message: null, droppedContentParts: 0 };
  }
  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "string" && record.id.trim().length > 0
      ? record.id.trim()
      : "";
  const roleResult = SparkAgentRoleSchema.safeParse(record.role);
  if (!id || !roleResult.success) {
    return { message: null, droppedContentParts: 0 };
  }
  const { value: createdAt } = resolveSparkAgentTimestamp(
    record.createdAt,
    fallbackDate,
  );
  const { content, droppedContentParts } = normalizeSparkAgentContentParts(
    record.content,
  );
  return {
    message: {
      id,
      role: roleResult.data,
      author: normalizeSparkAgentAuthor(record.author),
      createdAt,
      content,
    },
    droppedContentParts,
  };
}

function normalizeSparkAgentAttachment(
  value: unknown,
  fallbackDate: Date,
): SparkAgentAttachment | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const parsed = SparkAgentAttachmentSchema.safeParse({
    ...record,
    createdAt: record.createdAt ?? fallbackDate,
    updatedAt: record.updatedAt ?? fallbackDate,
  });
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export function hasSparkAgentConversationNormalizationIssues(
  issues: SparkAgentConversationNormalizationIssues,
): boolean {
  return (
    issues.repairedId ||
    issues.defaultedParticipantIds ||
    issues.defaultedCreatedAt ||
    issues.defaultedUpdatedAt ||
    issues.defaultedLastMessageAt ||
    issues.droppedMessages > 0 ||
    issues.droppedAttachments > 0 ||
    issues.droppedContentParts > 0
  );
}

export function normalizeSparkAgentConversation(
  value: unknown,
  options: {
    conversationId: string;
    fallbackParticipantId: string;
    fallbackDate?: Date;
  },
): SparkAgentConversationNormalizationResult {
  const fallbackDate = options.fallbackDate ?? new Date();
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const participantIds = Array.isArray(record.participantIds)
    ? record.participantIds.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
  const {
    value: createdAt,
    defaulted: defaultedCreatedAt,
  } = resolveSparkAgentTimestamp(record.createdAt, fallbackDate);
  const {
    value: updatedAt,
    defaulted: defaultedUpdatedAt,
  } = resolveSparkAgentTimestamp(record.updatedAt, createdAt);
  const {
    value: lastMessageAt,
    defaulted: defaultedLastMessageAt,
  } = resolveSparkAgentTimestamp(record.lastMessageAt, updatedAt);

  const messages: SparkAgentMessage[] = [];
  let droppedMessages = 0;
  let droppedContentParts = 0;
  if (Array.isArray(record.messages)) {
    for (const entry of record.messages) {
      const normalized = normalizeSparkAgentMessage(entry, createdAt);
      droppedContentParts += normalized.droppedContentParts;
      if (!normalized.message) {
        droppedMessages += 1;
        continue;
      }
      messages.push(normalized.message);
    }
  }

  const attachments: SparkAgentAttachment[] = [];
  let droppedAttachments = 0;
  if (Array.isArray(record.attachments)) {
    for (const entry of record.attachments) {
      const normalized = normalizeSparkAgentAttachment(entry, updatedAt);
      if (!normalized) {
        droppedAttachments += 1;
        continue;
      }
      attachments.push(normalized);
    }
  }

  return {
    conversation: {
      id: options.conversationId,
      familyId:
        typeof record.familyId === "string" && record.familyId.trim().length > 0
          ? record.familyId
          : undefined,
      participantIds:
        participantIds.length > 0
          ? participantIds
          : [options.fallbackParticipantId],
      createdAt,
      updatedAt,
      lastMessageAt,
      messages,
      attachments,
    },
    issues: {
      repairedId:
        typeof record.id !== "string" || record.id !== options.conversationId,
      defaultedParticipantIds: participantIds.length === 0,
      defaultedCreatedAt,
      defaultedUpdatedAt,
      defaultedLastMessageAt,
      droppedMessages,
      droppedAttachments,
      droppedContentParts,
    },
  };
}
