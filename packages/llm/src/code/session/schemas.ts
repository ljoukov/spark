import { z } from "zod";

const TrimmedString = z.string().transform((v, ctx) => {
  const s = (v ?? "").trim();
  if (!s) {
    ctx.addIssue({ code: "custom", message: "Required non-empty string" });
    return z.NEVER;
  }
  // collapse internal whitespace to single spaces for stability
  return s.replace(/\s+/g, " ");
});

export const SpeakerSchema = z.union([z.literal("m"), z.literal("f")]);

export const NarrationLineSchema = z.object({
  speaker: SpeakerSchema,
  text: TrimmedString,
});

export const MediaSegmentSchema = z.object({
  image: TrimmedString, // storage path or absolute URL for the segment image
  narration: z.array(NarrationLineSchema).min(1),
});

export type NarrationLine = z.infer<typeof NarrationLineSchema>;
export type MediaSegment = z.infer<typeof MediaSegmentSchema>;
