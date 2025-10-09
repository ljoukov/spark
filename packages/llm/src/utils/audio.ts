import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import { concatAudio, getAudioDetails } from "./ffmpeg";
import {
  GoogleTextToSpeechClient,
  type SynthesizeAudioEncoding,
} from "./googleTextToSpeechClient";
import { errorAsString } from "./error";
import { getTempFilePath } from "./file";

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

const ttsClient = new GoogleTextToSpeechClient();

const DEFAULT_LANGUAGE_CODE = "en-GB";
const DEFAULT_AUDIO_ENCODING: SynthesizeAudioEncoding = "MP3";
const DEFAULT_VOICE_MAP: Record<SpeakerCode, string> = {
  m: "en-GB-Chirp3-HD-Sadaltager",
  f: "en-GB-Chirp3-HD-Leda",
};

type GenerateAudioOptions = {
  segments: readonly TtsSegmentInput[];
  outputFilePath: string;
  voiceMap?: Partial<Record<SpeakerCode, string>>;
  progress?: AudioGenerationProgress;
  persistSegmentsDir?: string;
  languageCode?: string;
  audioEncoding?: SynthesizeAudioEncoding;
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

function mimeTypeFromEncoding(encoding: SynthesizeAudioEncoding): string {
  switch (encoding) {
    case "MP3":
      return "audio/mpeg";
    case "OGG_OPUS":
      return "audio/ogg";
    case "LINEAR16":
      return "audio/wav";
  }
}

function extensionFromEncoding(encoding: SynthesizeAudioEncoding): string {
  switch (encoding) {
    case "MP3":
      return "mp3";
    case "OGG_OPUS":
      return "ogg";
    case "LINEAR16":
      return "wav";
  }
}

function getVoiceName(
  speaker: SpeakerCode,
  overrides: Partial<Record<SpeakerCode, string>> | undefined
): string | undefined {
  const raw = overrides?.[speaker] ?? DEFAULT_VOICE_MAP[speaker];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

async function synthesiseSegment(
  segment: z.infer<typeof SegmentSchema>,
  options: {
    voiceName?: string;
    languageCode: string;
    audioEncoding: SynthesizeAudioEncoding;
    progress?: AudioGenerationProgress;
    index: number;
    totalSegments: number;
    getActiveCount: () => number;
  }
): Promise<{
  data: Uint8Array;
  mimeType: string;
  totalBytes: number;
  sampleRate?: number;
  channels?: 1 | 2;
}> {
  const runAttempt = async (voiceName?: string) => {
    const { audio, audioConfig } = await ttsClient.synthesize({
      text: segment.text,
      voice: {
        languageCode: options.languageCode,
        ...(voiceName ? { name: voiceName } : {}),
      },
      audioConfig: {
        audioEncoding: options.audioEncoding,
      },
    });

    const buffer = Buffer.from(audio);
    const totalBytes = buffer.byteLength;
    options.progress?.onSegmentChunk?.({
      index: options.index,
      totalSegments: options.totalSegments,
      chunkBytes: totalBytes,
      totalBytes,
      activeCount: options.getActiveCount(),
    });

    return {
      data: buffer,
      mimeType: mimeTypeFromEncoding(options.audioEncoding),
      totalBytes,
      sampleRate: audioConfig?.sampleRateHertz,
      channels: undefined,
    };
  };

  try {
    return await runAttempt(options.voiceName);
  } catch (error) {
    if (!options.voiceName) {
      throw error;
    }
    console.warn(
      `[tts] voice "${options.voiceName}" failed (${errorAsString(error)}); retrying with default voice`
    );
    return runAttempt(undefined);
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
  languageCode = DEFAULT_LANGUAGE_CODE,
  audioEncoding = DEFAULT_AUDIO_ENCODING,
}: GenerateAudioOptions): Promise<SynthesisedAudioResult> {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error("At least one narration segment is required");
  }

  const parsedSegments = segments.map((segment, index) => {
    try {
      return SegmentSchema.parse(segment);
    } catch (error) {
      throw new Error(
        `Invalid segment at index ${index}: ${errorAsString(error)}`
      );
    }
  });

  const totalSegments = parsedSegments.length;
  progress?.onStart?.({ totalSegments });

  const tempArtifacts: (SegmentArtifact | undefined)[] = new Array(
    totalSegments
  );
  const extraTempFiles: string[] = [];
  let totalBytesAll = 0;
  let activeCount = 0;

  try {
    await Promise.all(
      parsedSegments.map(async (segment, index) => {
        const voiceName = getVoiceName(segment.speaker, voiceMap);
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
            voiceName,
            languageCode,
            audioEncoding,
            progress,
            index,
            totalSegments,
            getActiveCount: () => activeCount,
          });
          byteLength = totalBytes;
          const extension = extensionFromEncoding(audioEncoding);
          const tempFileName = `tts-segment-${index}-${randomUUID()}.${extension}`;
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
      })
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
          `Inconsistent sample rate detected: expected ${sampleRate}, got ${artifact.sampleRate}`
        );
      }
      if (artifact.channels !== channels) {
        throw new Error(
          `Inconsistent channel count detected: expected ${channels}, got ${artifact.channels}`
        );
      }
    }

    const concatListFileName = `tts-concat-${randomUUID()}.txt`;
    const concatListPath = getTempFilePath(concatListFileName);
    const concatListContent = artifacts
      .map(
        (artifact) => `file '${escapeForFfmpegConcat(artifact.tempFilePath)}'`
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
      0
    );

    progress?.onComplete?.({
      totalSegments,
      totalBytes: totalBytesAll,
      totalDurationSec,
    });

    return {
      outputFilePath,
      outputMimeType: mimeTypeFromEncoding(audioEncoding),
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
            `[tts] Failed to remove temp file ${artifact.tempFilePath}: ${errorAsString(error)}`
          );
        }
      })
    );
    await Promise.all(
      extraTempFiles.map(async (filePath) => {
        try {
          await fs.rm(filePath, { force: true });
        } catch (error) {
          console.warn(
            `[tts] Failed to remove temp file ${filePath}: ${errorAsString(error)}`
          );
        }
      })
    );
  }
}
