import path from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import {
  getFirebaseAdminFirestore,
  getFirebaseAdminStorage,
} from "../../utils/firebaseAdmin";
import {
  SessionMediaDocSchema,
  type SessionMediaDoc,
  type SessionMediaSlide,
  type SessionMediaCaption,
} from "@spark/schemas";
import type { SessionAudioResult } from "./audio";
import type { MediaSegment } from "./schemas";

const idSchema = z.string().trim().min(1);

function assertId(label: string, value: string): string {
  try {
    return idSchema.parse(value);
  } catch (error) {
    throw new Error(`${label} is required: ${String(error)}`);
  }
}

function buildStoragePath(
  userId: string,
  sessionId: string,
  planItemId: string
): string {
  return path
    .join("spark", userId, "sessions", sessionId, `${planItemId}.mp3`)
    .replace(/\\/g, "/");
}

function roundTime(value: number): number {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  return Math.round(safe * 1000) / 1000;
}

function buildSlides(
  segments: readonly MediaSegment[],
  audio: SessionAudioResult
): SessionMediaSlide[] {
  return segments.map((segment, index) => ({
    index,
    markdown: segment.slide,
    startSec: roundTime(audio.slideOffsets[index] ?? 0),
    durationSec: roundTime(audio.slideDurations[index] ?? 0),
  }));
}

function buildCaptions(
  segments: readonly MediaSegment[],
  audio: SessionAudioResult
): SessionMediaCaption[] {
  const captions: SessionMediaCaption[] = [];
  let offsetIndex = 0;
  for (const segment of segments) {
    for (const line of segment.narration) {
      const start = audio.lineOffsets[offsetIndex] ?? 0;
      const duration = audio.lineDurations[offsetIndex] ?? 0;
      captions.push({
        speaker: line.speaker,
        text: line.text,
        startSec: roundTime(start),
        durationSec: roundTime(duration),
      });
      offsetIndex += 1;
    }
  }
  return captions;
}

export type PublishSessionMediaInput = {
  userId: string;
  sessionId: string;
  planItemId: string;
  segments: readonly MediaSegment[];
  audio: SessionAudioResult;
  storageBucket: string;
};

export type PublishSessionMediaResult = {
  storagePath: string;
  documentPath: string;
  durationSec: number;
  totalBytes: number;
};

export async function publishSessionMediaClip(
  input: PublishSessionMediaInput
): Promise<PublishSessionMediaResult> {
  const userId = assertId("userId", input.userId);
  const sessionId = assertId("sessionId", input.sessionId);
  const planItemId = assertId("planItemId", input.planItemId);
  const bucketName = assertId("storageBucket", input.storageBucket);

  if (input.segments.length === 0) {
    throw new Error("At least one media segment is required to publish audio");
  }

  const firestore = getFirebaseAdminFirestore();
  const storage = getFirebaseAdminStorage(undefined, {
    storageBucket: bucketName,
  });
  const bucket = storage.bucket(bucketName);

  const storagePath = buildStoragePath(userId, sessionId, planItemId);

  await bucket.upload(input.audio.outputFilePath, {
    destination: storagePath,
    metadata: {
      contentType: input.audio.outputMimeType,
      cacheControl: "public, max-age=0",
    },
    resumable: false,
  });

  const docRef = firestore
    .collection("spark")
    .doc(userId)
    .collection("sessions")
    .doc(sessionId)
    .collection("media")
    .doc(planItemId);

  const slides = buildSlides(input.segments, input.audio);
  const captions = buildCaptions(input.segments, input.audio);
  const now = Timestamp.now();

  const existing = await docRef.get();
  const createdAt =
    existing.exists && existing.get("createdAt") instanceof Timestamp
      ? (existing.get("createdAt") as Timestamp)
      : now;

  const docData = {
    id: planItemId,
    planItemId,
    sessionId,
    audio: {
      storagePath: `/${storagePath}`,
      durationSec: roundTime(input.audio.totalDurationSec),
      mimeType: input.audio.outputMimeType,
    },
    slides,
    captions,
    createdAt,
    updatedAt: now,
    metadataVersion: 1,
  };

  // Validate shape before writing (convert timestamps to Date for schema parsing).
  SessionMediaDocSchema.parse({
    ...docData,
    createdAt: createdAt.toDate(),
    updatedAt: now.toDate(),
  } satisfies SessionMediaDoc);

  await docRef.set(docData);

  return {
    storagePath: `/${storagePath}`,
    documentPath: docRef.path,
    durationSec: roundTime(input.audio.totalDurationSec),
    totalBytes: input.audio.totalBytes,
  };
}
