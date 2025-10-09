import { z } from "zod";

import {
  generateAudioFromSegments,
  type SynthesisedAudioResult,
  type SpeakerCode,
  type AudioGenerationProgress,
} from "../../utils/audio";
import type { SynthesizeAudioEncoding } from "../../utils/googleTextToSpeechClient";
import { errorAsString } from "../../utils/error";
import { MediaSegmentSchema, type MediaSegment } from "./schemas";

export type SessionAudioResult = SynthesisedAudioResult & {
  slideOffsets: number[];
  slideDurations: number[];
  lineOffsets: number[];
  lineDurations: number[];
};

const MediaSegmentsSchema = z.array(MediaSegmentSchema);

type GenerateSessionAudioOptions = {
  segments: readonly MediaSegment[];
  outputFilePath: string;
  voiceMap?: Partial<Record<SpeakerCode, string>>;
  progress?: AudioGenerationProgress;
  persistSegmentsDir?: string;
  languageCode?: string;
  audioEncoding?: SynthesizeAudioEncoding;
};

export async function generateSessionAudio(
  options: GenerateSessionAudioOptions,
): Promise<SessionAudioResult> {
  const parsedSegments = (() => {
    try {
      return MediaSegmentsSchema.parse(options.segments);
    } catch (error) {
      throw new Error(`Invalid media segments: ${errorAsString(error)}`);
    }
  })();

  if (parsedSegments.length === 0) {
    throw new Error("At least one media segment is required to generate audio");
  }

  const flattenedNarration: { speaker: SpeakerCode; text: string }[] = [];
  const slideLineCounts: number[] = [];

  for (const segment of parsedSegments) {
    slideLineCounts.push(segment.narration.length);
    for (const line of segment.narration) {
      flattenedNarration.push({ speaker: line.speaker, text: line.text });
    }
  }

  const baseResult = await generateAudioFromSegments({
    segments: flattenedNarration,
    outputFilePath: options.outputFilePath,
    voiceMap: options.voiceMap,
    progress: options.progress,
    persistSegmentsDir: options.persistSegmentsDir,
    languageCode: options.languageCode,
    audioEncoding: options.audioEncoding,
  });

  const slideOffsets: number[] = [];
  const slideDurations: number[] = [];
  const lineOffsets = baseResult.segmentOffsets.slice();
  const lineDurations = baseResult.segmentDurations.slice();

  let cursor = 0;
  for (let slideIndex = 0; slideIndex < slideLineCounts.length; slideIndex++) {
    const lineCount = slideLineCounts[slideIndex] ?? 0;
    if (lineCount === 0) {
      slideOffsets.push(cursor === 0 ? 0 : lineOffsets[cursor - 1]);
      slideDurations.push(0);
      continue;
    }
    const slideOffset = lineOffsets[cursor] ?? 0;
    let duration = 0;
    for (let i = 0; i < lineCount; i++) {
      const lineDuration = lineDurations[cursor + i] ?? 0;
      duration += lineDuration;
    }
    slideOffsets.push(slideOffset);
    slideDurations.push(duration);
    cursor += lineCount;
  }

  return {
    ...baseResult,
    slideOffsets,
    slideDurations,
    lineOffsets,
    lineDurations,
  };
}
