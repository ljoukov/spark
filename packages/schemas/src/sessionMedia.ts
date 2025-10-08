import { z } from "zod";
import { FirestoreTimestampSchema } from "./firestore";

const trimmed = z
  .string()
  .trim()
  .min(1, "Expected a non-empty value");

const nonNegativeNumber = z.number().finite().min(0, "Value must be non-negative");

const NarrationSpeakerSchema = z.union([z.literal("m"), z.literal("f")]);

export const SessionMediaNarrationSchema = z.object({
  speaker: NarrationSpeakerSchema.optional(),
  text: trimmed,
  startSec: nonNegativeNumber,
  durationSec: nonNegativeNumber,
});

export type SessionMediaNarration = z.infer<typeof SessionMediaNarrationSchema>;

export const SessionMediaImageSchema = z
  .object({
    index: z.number().int().min(0, "Image index must be non-negative"),
    storagePath: trimmed,
    startSec: nonNegativeNumber,
    durationSec: nonNegativeNumber,
  });

export type SessionMediaImage = z.infer<typeof SessionMediaImageSchema>;

export const SessionMediaDocSchema = z
  .object({
    id: trimmed,
    planItemId: trimmed,
    sessionId: trimmed,
    audio: z.object({
      storagePath: trimmed,
      durationSec: nonNegativeNumber,
      mimeType: trimmed.optional(),
    }),
    images: z.array(SessionMediaImageSchema).min(1, "At least one image required"),
    narration: z.array(SessionMediaNarrationSchema).min(1, "At least one narration line required"),
    createdAt: FirestoreTimestampSchema,
    updatedAt: FirestoreTimestampSchema,
    metadataVersion: z.number().int().min(1).default(2),
  })
  .transform(
    ({ createdAt, updatedAt, metadataVersion, ...rest }) => ({
      ...rest,
      metadataVersion,
      createdAt,
      updatedAt,
    }),
  );

export type SessionMediaDoc = z.infer<typeof SessionMediaDocSchema>;
