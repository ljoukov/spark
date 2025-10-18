import { z } from "zod";

// Accept Firestore Timestamp-like objects, JS Dates, ISO strings, or epoch numbers.
// Normalize everything to a JS Date via zod transforms.

export const FirestoreTimestampSchema = z.preprocess((value) => {
  // Already a Date
  if (value instanceof Date) {
    return value;
  }

  // Firestore Timestamp-like object { seconds, nanoseconds, [toDate] }
  if (
    value &&
    typeof value === "object" &&
    "seconds" in (value as Record<string, unknown>) &&
    "nanoseconds" in (value as Record<string, unknown>)
  ) {
    const v = value as { seconds: unknown; nanoseconds: unknown };
    const seconds = typeof v.seconds === "number" ? v.seconds : NaN;
    const nanoseconds = typeof v.nanoseconds === "number" ? v.nanoseconds : NaN;
    if (!Number.isNaN(seconds) && !Number.isNaN(nanoseconds)) {
      const millis = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
      return new Date(millis);
    }
    return value;
  }

  // ISO string or epoch millis
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
    return value;
  }

  return value;
}, z.date());

export type FirestoreTimestamp = z.infer<typeof FirestoreTimestampSchema>;
