import { z } from "zod";

const timestampBase = z.object({
  seconds: z.number(),
  nanoseconds: z.number(),
});

const firestoreTimestampObjectSchema = timestampBase
  .extend({
    toDate: z.custom<() => Date>((value) => typeof value === "function"),
  })
  .transform(({ seconds, nanoseconds }) => {
    const millis = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
    return new Date(millis);
  });

export const FirestoreTimestampSchema = z
  .union([firestoreTimestampObjectSchema, z.date()])
  .transform((value) => (value instanceof Date ? value : value));

export type FirestoreTimestamp = z.infer<typeof FirestoreTimestampSchema>;
