import { z } from "zod";

import { FirestoreTimestampSchema } from "./firestore";

const trimmedString = z.string().trim().min(1);

export const SparkAgentStatusSchema = z.enum([
  "created",
  "executing",
  "stopped",
  "failed",
  "done",
]);

export type SparkAgentStatus = z.infer<typeof SparkAgentStatusSchema>;

export const SparkAgentStateTimelineSchema = z.object({
  state: SparkAgentStatusSchema,
  timestamp: FirestoreTimestampSchema,
});

export type SparkAgentStateTimeline = z.infer<
  typeof SparkAgentStateTimelineSchema
>;

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const SparkAgentAvailableToolFormatSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("text"),
    }),
    z.object({
      type: z.literal("grammar"),
      syntax: z.enum(["lark", "regex"]),
      definition: trimmedString,
    }),
  ],
);

export const SparkAgentAvailableToolInputContractSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("json_schema"),
      schema: jsonObjectSchema,
    }),
    z.object({
      kind: z.literal("custom_format"),
      format: SparkAgentAvailableToolFormatSchema,
    }),
  ],
);

export const SparkAgentAvailableToolOutputContractSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("undeclared"),
    }),
    z.object({
      kind: z.literal("json_schema"),
      schema: jsonObjectSchema,
    }),
  ],
);

export const SparkAgentAvailableToolSchema = z.object({
  name: trimmedString,
  kind: z.enum(["filesystem", "function"]),
  callKind: z.enum(["function", "custom"]).optional(),
  description: trimmedString,
  inputContract: SparkAgentAvailableToolInputContractSchema.optional(),
  outputContract: SparkAgentAvailableToolOutputContractSchema.optional(),
});

export type SparkAgentAvailableTool = z.infer<
  typeof SparkAgentAvailableToolSchema
>;

export const SparkAgentStateSchema = z.object({
  id: trimmedString,
  prompt: trimmedString,
  status: SparkAgentStatusSchema,
  workspaceId: trimmedString,
  availableTools: z.array(SparkAgentAvailableToolSchema).optional(),
  stop_requested: z.boolean().optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  statesTimeline: z.array(SparkAgentStateTimelineSchema).min(1),
  resultSummary: z.string().trim().optional(),
  error: z.string().trim().optional(),
});

export type SparkAgentState = z.infer<typeof SparkAgentStateSchema>;

export const SparkAgentWorkspaceSchema = z.object({
  id: trimmedString,
  agentId: trimmedString.optional(),
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
});

export type SparkAgentWorkspace = z.infer<typeof SparkAgentWorkspaceSchema>;

const SparkAgentWorkspaceFileBaseSchema = z.object({
  path: trimmedString,
  createdAt: FirestoreTimestampSchema,
  updatedAt: FirestoreTimestampSchema,
  sizeBytes: z.number().int().min(0).optional(),
});

export const SparkAgentWorkspaceTextFileSchema =
  SparkAgentWorkspaceFileBaseSchema.extend({
    type: z.literal("text").optional(),
    content: z.string(),
    contentType: trimmedString.optional(),
  });

export const SparkAgentWorkspaceStorageLinkSchema =
  SparkAgentWorkspaceFileBaseSchema.extend({
    type: z.literal("storage_link"),
    storagePath: trimmedString,
    contentType: trimmedString,
  });

export const SparkAgentWorkspaceFileSchema = z.union([
  SparkAgentWorkspaceTextFileSchema,
  SparkAgentWorkspaceStorageLinkSchema,
]);

export type SparkAgentWorkspaceFile = z.infer<
  typeof SparkAgentWorkspaceFileSchema
>;

export const SparkAgentRunStatsSchema = z.object({
  modelCalls: z.number().int().min(0),
  modelsUsed: z.array(trimmedString),
  tokens: z.object({
    promptTokens: z.number().int().min(0),
    cachedTokens: z.number().int().min(0),
    responseTokens: z.number().int().min(0),
    responseImageTokens: z.number().int().min(0),
    thinkingTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
    toolUsePromptTokens: z.number().int().min(0),
  }),
  modelCostUsd: z.number().min(0),
  toolCalls: z.number().int().min(0),
  toolCallsByName: z.record(trimmedString, z.number().int().min(0)),
  toolCostUsd: z.number().min(0),
  totalCostUsd: z.number().min(0),
});

export type SparkAgentRunStats = z.infer<typeof SparkAgentRunStatsSchema>;

export const SparkAgentLogLineSchema = z.object({
  key: trimmedString,
  timestamp: FirestoreTimestampSchema,
  line: z.string(),
});

export type SparkAgentLogLine = z.infer<typeof SparkAgentLogLineSchema>;

export const SparkAgentRunStreamSchema = z.object({
  updatedAt: FirestoreTimestampSchema.optional(),
  assistant: z.string().optional(),
  thoughts: z.string().optional(),
});

export type SparkAgentRunStream = z.infer<typeof SparkAgentRunStreamSchema>;

export const SparkAgentRunLogSchema = z.object({
  updatedAt: FirestoreTimestampSchema.optional(),
  lines: z.array(SparkAgentLogLineSchema),
  stats: SparkAgentRunStatsSchema.optional(),
  stream: SparkAgentRunStreamSchema.optional(),
});

export type SparkAgentRunLog = z.infer<typeof SparkAgentRunLogSchema>;
