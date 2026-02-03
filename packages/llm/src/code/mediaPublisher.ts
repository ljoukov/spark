import path from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import {
  getFirestoreDocument,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import {
  parseGoogleServiceAccountJson,
} from "../utils/gcp/googleAccessToken";
import { uploadStorageObject } from "../utils/gcp/storageRest";
import {
  SessionMediaDocSchema,
  type SessionMediaDoc,
  type SessionMediaImage,
  type SessionMediaNarration,
  type SessionMediaSupplementaryImage,
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
  planItemId: string,
): string {
  return path
    .join("spark", userId, "sessions", sessionId, `${planItemId}.mp3`)
    .replace(/\\/g, "/");
}

function roundTime(value: number): number {
  const safe = Number.isFinite(value) && value >= 0 ? value : 0;
  return Math.round(safe * 1000) / 1000;
}

function normaliseImageStoragePath(imagePath: string): string {
  const path = imagePath.trim();
  if (!path) {
    return "";
  }
  if (path.startsWith("/")) {
    return path;
  }
  return `/${path}`;
}

function normaliseSupplementaryImage(
  image: SessionMediaSupplementaryImage | undefined,
): SessionMediaSupplementaryImage | undefined {
  if (!image) {
    return undefined;
  }
  return {
    storagePath: normaliseImageStoragePath(image.storagePath),
  };
}

function buildImages(
  segments: readonly MediaSegment[],
  audio: SessionAudioResult,
): SessionMediaImage[] {
  return segments.map((segment, index) => ({
    index,
    storagePath: normaliseImageStoragePath(segment.image),
    startSec: roundTime(audio.slideOffsets[index] ?? 0),
    durationSec: roundTime(audio.slideDurations[index] ?? 0),
  }));
}

function buildNarration(
  segments: readonly MediaSegment[],
  audio: SessionAudioResult,
): SessionMediaNarration[] {
  const narration: SessionMediaNarration[] = [];
  let offsetIndex = 0;
  for (const segment of segments) {
    for (const line of segment.narration) {
      const start = audio.lineOffsets[offsetIndex] ?? 0;
      const duration = audio.lineDurations[offsetIndex] ?? 0;
      narration.push({
        speaker: line.speaker,
        text: line.text,
        startSec: roundTime(start),
        durationSec: roundTime(duration),
      });
      offsetIndex += 1;
    }
  }
  return narration;
}

export type PublishSessionMediaInput = {
  userId: string;
  sessionId: string;
  planItemId: string;
  segments: readonly MediaSegment[];
  audio: SessionAudioResult;
  posterImage?: SessionMediaSupplementaryImage;
  endingImage?: SessionMediaSupplementaryImage;
};

export type PublishSessionMediaResult = {
  storagePath: string;
  documentPath: string;
  durationSec: number;
  totalBytes: number;
};

export async function publishSessionMediaClip(
  input: PublishSessionMediaInput,
): Promise<PublishSessionMediaResult> {
  const userId = assertId("userId", input.userId);
  const sessionId = assertId("sessionId", input.sessionId);
  const planItemId = assertId("planItemId", input.planItemId);

  if (input.segments.length === 0) {
    throw new Error("At least one media segment is required to publish audio");
  }

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
  const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;

  const storagePath = buildStoragePath(userId, sessionId, planItemId);

  const audioBytes = await readFile(input.audio.outputFilePath);
  await uploadStorageObject({
    serviceAccountJson,
    bucketName,
    objectName: storagePath,
    contentType: input.audio.outputMimeType,
    data: audioBytes,
  });

  const images = buildImages(input.segments, input.audio);
  const narration = buildNarration(input.segments, input.audio);
  const posterImage = normaliseSupplementaryImage(input.posterImage);
  const endingImage = normaliseSupplementaryImage(input.endingImage);
  const now = new Date();

  const documentPath = `spark/${userId}/sessions/${sessionId}/media/${planItemId}`;
  const existing = await getFirestoreDocument({ serviceAccountJson, documentPath });
  let createdAt = now;
  if (existing.exists) {
    const rawCreatedAt = existing.data?.createdAt;
    if (rawCreatedAt instanceof Date) {
      createdAt = rawCreatedAt;
    } else if (typeof rawCreatedAt === "string" || typeof rawCreatedAt === "number") {
      const parsed = new Date(rawCreatedAt);
      if (!Number.isNaN(parsed.getTime())) {
        createdAt = parsed;
      }
    }
  }

  const docData = {
    id: planItemId,
    planItemId,
    sessionId,
    audio: {
      storagePath: `/${storagePath}`,
      durationSec: roundTime(input.audio.totalDurationSec),
      mimeType: input.audio.outputMimeType,
    },
    images,
    narration,
    ...(posterImage ? { posterImage } : {}),
    ...(endingImage ? { endingImage } : {}),
    createdAt,
    updatedAt: now,
    metadataVersion: 3,
  };

  // Validate shape before writing.
  SessionMediaDocSchema.parse(docData satisfies SessionMediaDoc);

  await setFirestoreDocument({
    serviceAccountJson,
    documentPath,
    data: docData as unknown as Record<string, unknown>,
  });

  return {
    storagePath: `/${storagePath}`,
    documentPath,
    durationSec: roundTime(input.audio.totalDurationSec),
    totalBytes: input.audio.totalBytes,
  };
}
