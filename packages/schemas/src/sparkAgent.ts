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

export const SparkAgentContentPartSchema = z.union([
  SparkAgentTextPartSchema,
  SparkAgentImagePartSchema,
  SparkAgentFilePartSchema,
  SparkAgentToolCallPartSchema,
  SparkAgentToolResultPartSchema,
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
