import type { ReadableStream } from "node:stream/web";

import { z } from "zod";

import {
  googleTts,
  googleVoices,
  isGoogleVoice,
} from "./googleTTS";
import {
  isOpenAiVoice,
  openAiTts,
  openAiVoices,
} from "./openaiTTS";

export const voices = [
  ...openAiVoices,
  ...googleVoices,
] as const;

export const ttsVoiceSchema = z.enum(voices);

export type TTSVoice = (typeof voices)[number];

export const ttsRequestSchema = z.object({
  input: z.string(),
  voice: z.enum(voices),
});

export type TTSRequest = z.infer<typeof ttsRequestSchema>;

export async function tts(request: TTSRequest): Promise<ReadableStream<Uint8Array>> {
  const { voice, input } = ttsRequestSchema.parse(request);
  if (isOpenAiVoice(voice)) {
    return openAiTts({ voice, input });
  }
  if (isGoogleVoice(voice)) {
    return googleTts({ voice, input });
  }
  const _exhaustiveCheck: never = voice;
  return _exhaustiveCheck;
}
