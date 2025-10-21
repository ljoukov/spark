import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AudioGenerationProgress,
  MediaSegment,
  SpeakerCode,
  Voice,
} from "@spark/llm";
import { generateSessionAudio, publishSessionMediaClip } from "@spark/llm";

import {
  formatByteSize,
  formatDurationSeconds,
  formatInteger,
  formatMillis,
} from "../utils/format";

function formatTimestamp(seconds: number): string {
  return formatDurationSeconds(seconds);
}

export function createConsoleProgress(label: string): AudioGenerationProgress {
  const startTime = Date.now();
  return {
    onStart({ totalSegments }) {
      console.log(
        `[${label}] Starting audio generation for ${totalSegments} segments (parallel launch)`,
      );
    },
    onSegmentStart({
      index,
      totalSegments,
      speaker,
      activeCount,
      textPreview,
    }) {
      const preview =
        textPreview.length > 60 ? `${textPreview.slice(0, 57)}…` : textPreview;
      console.log(
        `[${label}] ▶ Segment ${index + 1}/${totalSegments} (${speaker}) started • active ${activeCount}`,
      );
      if (preview.length > 0) {
        console.log(`[${label}]    text preview: ${preview}`);
      }
    },
    onSegmentChunk({
      index,
      totalSegments,
      chunkBytes,
      totalBytes,
      activeCount,
    }) {
      console.log(
        `[${label}]    segment ${index + 1}/${totalSegments} +${formatByteSize(chunkBytes)} (cum ${formatByteSize(totalBytes)}) • active ${activeCount}`,
      );
    },
    onSegmentComplete({
      index,
      totalSegments,
      durationSec,
      totalBytes,
      activeCount,
    }) {
      console.log(
        `[${label}] ✔ Segment ${index + 1}/${totalSegments} finished ${formatTimestamp(durationSec)} (${formatByteSize(totalBytes)}) • active now ${activeCount}`,
      );
    },
    onComplete({ totalSegments, totalBytes, totalDurationSec }) {
      const wallSeconds = (Date.now() - startTime) / 1000;
      console.log(
        `[${label}] ✅ Completed ${totalSegments} segments • audio ${formatTimestamp(totalDurationSec)} • size ${formatByteSize(totalBytes)} • wall ${formatTimestamp(wallSeconds)}`,
      );
    },
  };
}

export type NarrationSupplementaryImage = {
  storagePath: string;
};

export type NarrationJob = {
  userId: string;
  sessionId: string;
  planItemId: string;
  segments: readonly MediaSegment[];
  storageBucket: string;
  posterImage?: NarrationSupplementaryImage;
  endingImage?: NarrationSupplementaryImage;
  voiceMap?: Partial<Record<SpeakerCode, Voice>>;
  progress?: AudioGenerationProgress;
};

export type NarrationJobResult = Awaited<
  ReturnType<typeof publishSessionMediaClip>
>;

export async function synthesizeAndPublishNarration(
  job: NarrationJob,
): Promise<NarrationJobResult> {
  if (job.segments.length === 0) {
    throw new Error(
      "At least one media segment is required to synthesise audio",
    );
  }

  const flattenedNarration = job.segments.flatMap(
    (segment) => segment.narration,
  );
  const segmentCount = flattenedNarration.length;
  const totalTextChars = flattenedNarration.reduce(
    (acc, line) => acc + line.text.length,
    0,
  );

  const label = `session/audio/${job.planItemId}`;
  const tmpPath = path.join(
    os.tmpdir(),
    `session-${job.planItemId}-${Date.now()}.mp3`,
  );

  const startedAt = Date.now();
  const audioResult = await generateSessionAudio({
    segments: job.segments,
    outputFilePath: tmpPath,
    voiceMap: job.voiceMap,
    progress: job.progress ?? createConsoleProgress(job.planItemId),
  });
  const elapsedMs = Date.now() - startedAt;

  const notes = [
    `segments ${formatInteger(segmentCount)}`,
    `text ${formatInteger(totalTextChars)} chars`,
    `audio ${formatTimestamp(audioResult.totalDurationSec)} • ${formatByteSize(audioResult.totalBytes)}`,
  ].join(" | ");
  console.log(`[${label}] ${notes} | elapsed ${formatMillis(elapsedMs)}`);

  const publishResult = await publishSessionMediaClip({
    userId: job.userId,
    sessionId: job.sessionId,
    planItemId: job.planItemId,
    segments: job.segments,
    audio: audioResult,
    storageBucket: job.storageBucket,
    posterImage: job.posterImage,
    endingImage: job.endingImage,
  });

  try {
    await fs.rm(tmpPath, { force: true });
  } catch {
    /* noop */
  }

  console.log(
    `Published media ${job.planItemId} -> ${publishResult.storagePath} (doc ${publishResult.documentPath})`,
  );

  return publishResult;
}
