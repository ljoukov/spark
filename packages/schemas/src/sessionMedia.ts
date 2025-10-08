import { z } from "zod";
import { FirestoreTimestampSchema } from "./firestore";

const trimmed = z
  .string()
  .trim()
  .min(1, "Expected a non-empty value");

const nonNegativeNumber = z.number().finite().min(0, "Value must be non-negative");

const SpeakerSchema = z.union([z.literal("m"), z.literal("f")]);

export const SessionMediaCaptionSchema = z.object({
  speaker: SpeakerSchema,
  text: trimmed,
  startSec: nonNegativeNumber,
  durationSec: nonNegativeNumber,
});

export type SessionMediaCaption = z.infer<typeof SessionMediaCaptionSchema>;

export const SessionMediaSlideSchema = z.object({
  index: z.number().int().min(0, "Slide index must be non-negative"),
  markdown: trimmed,
  startSec: nonNegativeNumber,
  durationSec: nonNegativeNumber,
});

export type SessionMediaSlide = z.infer<typeof SessionMediaSlideSchema>;

export const SessionMediaDocSchema = z
  .object({
    id: trimmed,
    planItemId: trimmed,
    sessionId: trimmed,
    audio: z.object({
      storagePath: trimmed,
      downloadUrl: trimmed.optional(),
      durationSec: nonNegativeNumber,
      mimeType: trimmed.optional(),
    }),
    slides: z.array(SessionMediaSlideSchema).min(1, "At least one slide required"),
    captions: z.array(SessionMediaCaptionSchema).min(1, "At least one caption line required"),
    createdAt: FirestoreTimestampSchema,
    updatedAt: FirestoreTimestampSchema,
    metadataVersion: z.number().int().min(1).default(1),
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
