import type { ReadableStream } from "node:stream/web";

import { getOpenAiClient } from "./openai";

export const openAiVoices = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

export type OpenAiVoice = (typeof openAiVoices)[number];

export function isOpenAiVoice(voice: string): voice is OpenAiVoice {
  return (openAiVoices as readonly string[]).includes(voice);
}

export async function openAiTts(request: {
  voice: OpenAiVoice;
  input: string;
}): Promise<ReadableStream<Uint8Array>> {
  const client = getOpenAiClient();
  const response = await client.audio.speech.create({
    model: "tts-1",
    voice: request.voice,
    input: request.input,
  });

  const stream = response.body;
  if (!stream) {
    throw new Error(
      "OpenAI returned an empty body for text-to-speech synthesis.",
    );
  }

  return stream as ReadableStream<Uint8Array>;
}
