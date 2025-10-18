import type { ReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import { concatAudio, getAudioDetails } from "./ffmpeg";
import { errorAsString } from "./error";
import { getTempFilePath } from "./file";
import { tts, type Voice } from "./tts";

export type SpeakerCode = "m" | "f";

export type TtsSegmentInput = {
  speaker: SpeakerCode;
  text: string;
};

export type AudioGenerationProgress = {
  onStart?(info: { totalSegments: number }): void;
  onSegmentStart?(info: {
    index: number;
    totalSegments: number;
    speaker: SpeakerCode;
    activeCount: number;
    textPreview: string;
  }): void;
  onSegmentChunk?(info: {
    index: number;
    totalSegments: number;
    chunkBytes: number;
    totalBytes: number;
    activeCount: number;
  }): void;
  onSegmentComplete?(info: {
    index: number;
    totalSegments: number;
    durationSec: number;
    totalBytes: number;
    activeCount: number;
  }): void;
  onComplete?(info: {
    totalSegments: number;
    totalBytes: number;
    totalDurationSec: number;
  }): void;
};

const SegmentSchema = z.object({
  speaker: z.union([z.literal("m"), z.literal("f")]),
  text: z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, "Narration text is required")),
});

export type SynthesisedAudioResult = {
  outputFilePath: string;
  outputMimeType: string;
  totalDurationSec: number;
  segmentOffsets: number[];
  segmentDurations: number[];
  sampleRate: number;
  channels: 1 | 2;
  totalBytes: number;
  segmentFiles: string[];
};

const DEFAULT_VOICE_MAP: Record<SpeakerCode, Voice> = {
  m: "echo",
  f: "shimmer",
};

const DEFAULT_OUTPUT_EXTENSION = "mp3";
const DEFAULT_OUTPUT_MIME_TYPE = "audio/mpeg";

type GenerateAudioOptions = {
  segments: readonly TtsSegmentInput[];
  outputFilePath: string;
  voiceMap?: Partial<Record<SpeakerCode, Voice>>;
  progress?: AudioGenerationProgress;
  persistSegmentsDir?: string;
};

type SegmentArtifact = {
  tempFileName: string;
  tempFilePath: string;
  durationSec: number;
  sampleRate: number;
  channels: 1 | 2;
  byteLength: number;
  persisted: boolean;
};

function resolveVoicePreference(
  speaker: SpeakerCode,
  overrides: Partial<Record<SpeakerCode, Voice>> | undefined,
): { primary: Voice; fallback?: Voice } {
  const defaultVoice = DEFAULT_VOICE_MAP[speaker];
  const override = overrides?.[speaker];
  if (!override || override === defaultVoice) {
    return { primary: defaultVoice };
  }
  return { primary: override, fallback: defaultVoice };
}

async function readStreamToBuffer(
  stream: ReadableStream<Uint8Array>,
): Promise<{ buffer: Buffer; totalBytes: number }> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const chunk = Buffer.from(value);
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) {
    return { buffer: Buffer.alloc(0), totalBytes: 0 };
  }

  if (chunks.length === 1) {
    return { buffer: chunks[0], totalBytes };
  }

  return {
    buffer: Buffer.concat(chunks, totalBytes),
    totalBytes,
  };
}

async function synthesiseSegment(
  segment: z.infer<typeof SegmentSchema>,
  options: {
    voice: Voice;
    fallbackVoice?: Voice;
    progress?: AudioGenerationProgress;
    index: number;
    totalSegments: number;
    getActiveCount: () => number;
  },
): Promise<{
  data: Buffer;
  mimeType: string;
  totalBytes: number;
}> {
  const runAttempt = async (voice: Voice) => {
    const stream = await tts({
      voice,
      input: segment.text,
    });
    const { buffer, totalBytes } = await readStreamToBuffer(stream);

    options.progress?.onSegmentChunk?.({
      index: options.index,
      totalSegments: options.totalSegments,
      chunkBytes: totalBytes,
      totalBytes,
      activeCount: options.getActiveCount(),
    });

    return {
      data: buffer,
      mimeType: DEFAULT_OUTPUT_MIME_TYPE,
      totalBytes,
    };
  };

  try {
    return await runAttempt(options.voice);
  } catch (error) {
    if (!options.fallbackVoice || options.fallbackVoice === options.voice) {
      throw error;
    }
    console.warn(
      `[tts] voice "${options.voice}" failed (${errorAsString(error)}); retrying with fallback "${options.fallbackVoice}"`,
    );
    return runAttempt(options.fallbackVoice);
  }
}

function escapeForFfmpegConcat(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

export async function generateAudioFromSegments({
  segments,
  outputFilePath,
  voiceMap,
  progress,
  persistSegmentsDir,
}: GenerateAudioOptions): Promise<SynthesisedAudioResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("At least one narration segment is required");
  }

  const parsedSegments = segments.map((segment, index) => {
    try {
      return SegmentSchema.parse(segment);
    } catch (error) {
      throw new Error(
        `Invalid segment at index ${index}: ${errorAsString(error)}`,
      );
    }
  });

  const totalSegments = parsedSegments.length;
  progress?.onStart?.({ totalSegments });

  const tempArtifacts: (SegmentArtifact | undefined)[] = Array.from(
    { length: totalSegments },
    () => undefined,
  );
  const extraTempFiles: string[] = [];
  let totalBytesAll = 0;
  let activeCount = 0;

  try {
    await Promise.all(
      parsedSegments.map(async (segment, index) => {
        const { primary: voice, fallback: fallbackVoice } =
          resolveVoicePreference(segment.speaker, voiceMap);
        activeCount += 1;
        progress?.onSegmentStart?.({
          index,
          totalSegments,
          speaker: segment.speaker,
          activeCount,
          textPreview: segment.text.slice(0, 80),
        });

        let artifact: SegmentArtifact | undefined;
        let byteLength = 0;

        try {
          const { data, totalBytes } = await synthesiseSegment(segment, {
            voice,
            fallbackVoice,
            progress,
            index,
            totalSegments,
            getActiveCount: () => activeCount,
          });
          byteLength = totalBytes;
          const tempFileName = `tts-segment-${index}-${randomUUID()}.${DEFAULT_OUTPUT_EXTENSION}`;
          let tempFilePath: string;
          let persisted = false;
          if (persistSegmentsDir) {
            await fs.mkdir(persistSegmentsDir, { recursive: true });
            tempFilePath = path.join(persistSegmentsDir, tempFileName);
            persisted = true;
          } else {
            tempFilePath = getTempFilePath(tempFileName);
          }
          await fs.writeFile(tempFilePath, data);
          const details = await getAudioDetails(tempFilePath);
          artifact = {
            tempFileName,
            tempFilePath,
            durationSec: details.durationSec,
            sampleRate: details.sampleRate,
            channels: details.channels,
            byteLength,
            persisted,
          };
          tempArtifacts[index] = artifact;
        } finally {
          activeCount -= 1;
          if (artifact) {
            totalBytesAll += byteLength;
            progress?.onSegmentComplete?.({
              index,
              totalSegments,
              durationSec: artifact.durationSec,
              totalBytes: byteLength,
              activeCount,
            });
          }
        }
      }),
    );

    const artifacts = tempArtifacts.map((artifact, index) => {
      if (!artifact) {
        throw new Error(`Missing audio artifact for segment ${index}`);
      }
      return artifact;
    });

    const sampleRate = artifacts[0]?.sampleRate;
    const channels = artifacts[0]?.channels;
    if (!sampleRate || !channels) {
      throw new Error("Failed to determine audio parameters for concatenation");
    }

    for (const artifact of artifacts) {
      if (artifact.sampleRate !== sampleRate) {
        throw new Error(
          `Inconsistent sample rate detected: expected ${sampleRate}, got ${artifact.sampleRate}`,
        );
      }
      if (artifact.channels !== channels) {
        throw new Error(
          `Inconsistent channel count detected: expected ${channels}, got ${artifact.channels}`,
        );
      }
    }

    const concatListFileName = `tts-concat-${randomUUID()}.txt`;
    const concatListPath = getTempFilePath(concatListFileName);
    const concatListContent = artifacts
      .map(
        (artifact) => `file '${escapeForFfmpegConcat(artifact.tempFilePath)}'`,
      )
      .join("\n");
    await fs.writeFile(concatListPath, concatListContent, "utf8");
    extraTempFiles.push(concatListPath);

    await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
    await fs.rm(outputFilePath, { force: true });
    await concatAudio({
      listFileName: concatListPath,
      sampleRate,
      channels,
      outputFileName: outputFilePath,
    });

    const segmentOffsets: number[] = [];
    const segmentDurations = artifacts.map((artifact) => artifact.durationSec);
    for (let i = 0; i < segmentDurations.length; i++) {
      const previous = segmentOffsets[i - 1] ?? 0;
      const offset = i === 0 ? 0 : previous + segmentDurations[i - 1];
      segmentOffsets.push(offset);
    }

    const totalDurationSec = segmentDurations.reduce(
      (acc, value) => acc + value,
      0,
    );

    progress?.onComplete?.({
      totalSegments,
      totalBytes: totalBytesAll,
      totalDurationSec,
    });

    return {
      outputFilePath,
      outputMimeType: DEFAULT_OUTPUT_MIME_TYPE,
      totalDurationSec,
      segmentOffsets,
      segmentDurations,
      sampleRate,
      channels,
      totalBytes: totalBytesAll,
      segmentFiles: artifacts.map((artifact) => artifact.tempFilePath),
    };
  } finally {
    await Promise.all(
      tempArtifacts.map(async (artifact) => {
        if (!artifact) {
          return;
        }
        try {
          if (!artifact.persisted) {
            await fs.rm(artifact.tempFilePath, { force: true });
          }
        } catch (error) {
          console.warn(
            `[tts] Failed to remove temp file ${artifact.tempFilePath}: ${errorAsString(error)}`,
          );
        }
      }),
    );
    await Promise.all(
      extraTempFiles.map(async (filePath) => {
        try {
          await fs.rm(filePath, { force: true });
        } catch (error) {
          console.warn(
            `[tts] Failed to remove temp file ${filePath}: ${errorAsString(error)}`,
          );
        }
      }),
    );
  }
}
