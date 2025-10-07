import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";

import { concatAudio, getAudioDetails } from "./ffmpeg";
import { runGeminiCall } from "./gemini";
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

const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";
const DEFAULT_OUTPUT_MIME = "audio/mpeg";
const DEFAULT_VOICE_MAP: Record<SpeakerCode, string> = {
  m: "Puck",
  f: "Charon",
};

type GenerateAudioOptions = {
  segments: readonly TtsSegmentInput[];
  outputFilePath: string;
  model?: string;
  voiceMap?: Partial<Record<SpeakerCode, string>>;
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

function parseMimeParameters(mimeType: string): Record<string, string> {
  return mimeType
    .split(";")
    .slice(1)
    .map((part) => part.trim())
    .reduce<Record<string, string>>((acc, part) => {
      if (!part) {
        return acc;
      }
      const [key, value] = part.split("=");
      if (!key || value === undefined) {
        return acc;
      }
      const normalisedKey = key.trim().toLowerCase();
      const normalisedValue = value.trim().replace(/^"|"$/g, "");
      if (normalisedKey) {
        acc[normalisedKey] = normalisedValue;
      }
      return acc;
    }, {});
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return undefined;
}

function convertRawPcmToWav(
  pcmData: Buffer,
  meta: { sampleRate?: number; bitsPerSample?: number; channels?: number },
): { buffer: Buffer; sampleRate: number; channels: 1 | 2 } {
  const sampleRate = meta.sampleRate && meta.sampleRate > 0 ? meta.sampleRate : 24000;
  const bitsPerSample = meta.bitsPerSample && meta.bitsPerSample > 0 ? meta.bitsPerSample : 16;
  const channelsRaw = meta.channels && meta.channels > 0 ? meta.channels : 1;
  const normalisedChannels = channelsRaw >= 2 ? 2 : 1;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = sampleRate * normalisedChannels * bytesPerSample;
  const blockAlign = normalisedChannels * bytesPerSample;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(normalisedChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);

  return {
    buffer: Buffer.concat([header, pcmData]),
    sampleRate,
    channels: normalisedChannels as 1 | 2,
  };
}

function normaliseAudioBuffer(
  rawBuffer: Buffer,
  mimeType: string | undefined,
): { data: Buffer; mimeType: string; sampleRate?: number; channels?: 1 | 2 } {
  if (!mimeType) {
    return { data: rawBuffer, mimeType: "audio/mpeg" };
  }
  const lower = mimeType.toLowerCase();
  if (
    lower.includes("audio/raw") ||
    lower.includes("audio/x-raw") ||
    lower.includes("linear16") ||
    lower.includes("pcm")
  ) {
    const params = parseMimeParameters(mimeType);
    const sampleRate =
      parsePositiveInteger(params.rate ?? params["sample-rate"] ?? params.samplerate) ?? 24000;
    const bitsPerSample =
      parsePositiveInteger(
        params.bits ?? params.bitdepth ?? params["bits-per-sample"] ?? params.samplewidth,
      ) ?? (lower.includes("8") ? 8 : 16);
    const channels =
      parsePositiveInteger(
        params.channels ?? params["channel-count"] ?? params.channel_count ?? params["channels"] ?? params["channel"],
      ) ?? 1;

    const { buffer, sampleRate: finalSampleRate, channels: finalChannels } = convertRawPcmToWav(
      rawBuffer,
      { sampleRate, bitsPerSample, channels },
    );
    return { data: buffer, mimeType: "audio/wav", sampleRate: finalSampleRate, channels: finalChannels };
  }
  if (lower.includes("wav") || lower.includes("wave")) {
    return { data: rawBuffer, mimeType: "audio/wav" };
  }
  if (lower.includes("ogg") || lower.includes("opus")) {
    return { data: rawBuffer, mimeType: "audio/ogg" };
  }
  if (lower.includes("flac")) {
    return { data: rawBuffer, mimeType: "audio/flac" };
  }
  if (lower.includes("mp3") || lower.includes("mpeg")) {
    return { data: rawBuffer, mimeType: "audio/mpeg" };
  }
  return { data: rawBuffer, mimeType };
}

function getVoiceName(
  speaker: SpeakerCode,
  overrides: Partial<Record<SpeakerCode, string>> | undefined,
): string | undefined {
  const raw = overrides?.[speaker] ?? DEFAULT_VOICE_MAP[speaker];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

async function synthesiseSegment(
  segment: z.infer<typeof SegmentSchema>,
  options: {
    voiceName?: string;
    model: string;
    progress?: AudioGenerationProgress;
    index: number;
    totalSegments: number;
    getActiveCount: () => number;
  },
): Promise<{
  data: Uint8Array;
  mimeType: string;
  totalBytes: number;
  sampleRate?: number;
  channels?: 1 | 2;
}> {
  const runAttempt = async (voiceName?: string) =>
    runGeminiCall(async (client) => {
      const config = {
        responseModalities: ["audio" as const],
        speechConfig: voiceName
          ? {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            }
          : undefined,
      } satisfies Record<string, unknown>;

      const stream = await client.models.generateContentStream({
        model: options.model,
        contents: [
          {
            role: "user",
            parts: [{ text: segment.text }],
          },
        ],
        config,
      });

      const buffers: Buffer[] = [];
      let mimeType: string | undefined;
      let totalBytes = 0;

      for await (const chunk of stream) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) {
          continue;
        }
        for (const part of parts) {
          const inline = (part as {
            inlineData?: { data?: string; mimeType?: string };
          }).inlineData;
          if (!inline || !inline.data) {
            continue;
          }
          const buffer = Buffer.from(inline.data, "base64");
          const chunkBytes = buffer.byteLength;
          totalBytes += chunkBytes;
          mimeType = inline.mimeType ?? mimeType;
          buffers.push(buffer);
          options.progress?.onSegmentChunk?.({
            index: options.index,
            totalSegments: options.totalSegments,
            chunkBytes,
            totalBytes,
            activeCount: options.getActiveCount(),
          });
        }
      }

      if (buffers.length === 0) {
        throw new Error("Gemini TTS response did not include inline audio data");
      }

      const combined = Buffer.concat(buffers);
      const normalised = normaliseAudioBuffer(combined, mimeType);
      return {
        data: normalised.data,
        mimeType: normalised.mimeType,
        totalBytes: normalised.data.byteLength,
        sampleRate: normalised.sampleRate,
        channels: normalised.channels,
      };
    });

  try {
    return await runAttempt(options.voiceName);
  } catch (error) {
    const message = errorAsString(error).toLowerCase();
    if (!options.voiceName || message.includes("gemini_api_key")) {
      throw error;
    }
    console.warn(
      `[tts] voice "${options.voiceName}" failed (${errorAsString(error)}); retrying with default voice`,
    );
    return runAttempt(undefined);
  }
}

function extensionFromMime(mimeType: string): string {
  const value = mimeType.toLowerCase();
  if (value.includes("wav") || value.includes("wave")) {
    return "wav";
  }
  if (value.includes("ogg") || value.includes("opus")) {
    return "ogg";
  }
  if (value.includes("flac")) {
    return "flac";
  }
  if (
    value.includes("audio/raw") ||
    value.includes("audio/x-raw") ||
    value.includes("linear16") ||
    value.includes("pcm")
  ) {
    return "wav";
  }
  if (value.includes("mp3") || value.includes("mpeg")) {
    return "mp3";
  }
  return "mp3";
}

function escapeForFfmpegConcat(filePath: string): string {
  return filePath.replace(/'/g, "'\\''");
}

export async function generateAudioFromSegments({
  segments,
  outputFilePath,
  model = DEFAULT_TTS_MODEL,
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
      throw new Error(`Invalid segment at index ${index}: ${errorAsString(error)}`);
    }
  });

  const totalSegments = parsedSegments.length;
  progress?.onStart?.({ totalSegments });

  const tempArtifacts: (SegmentArtifact | undefined)[] = new Array(totalSegments);
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
          const { data, mimeType, totalBytes } = await synthesiseSegment(segment, {
            voiceName,
            model,
            progress,
            index,
            totalSegments,
            getActiveCount: () => activeCount,
          });
          byteLength = totalBytes;
          const extension = extensionFromMime(mimeType);
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
      .map((artifact) => `file '${escapeForFfmpegConcat(artifact.tempFilePath)}'`)
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
      outputMimeType: DEFAULT_OUTPUT_MIME,
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
