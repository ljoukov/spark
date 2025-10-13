import { Buffer } from "node:buffer";
import { ReadableStream } from "node:stream/web";

import { z } from "zod";

import { getGoogleAuth } from "./googleAuth";

const GOOGLE_TTS_BASE_URL = "https://texttospeech.googleapis.com/v1beta1";
const GOOGLE_TTS_VOICES_ENDPOINT = `${GOOGLE_TTS_BASE_URL}/voices`;
const GOOGLE_TTS_SYNTHESIZE_ENDPOINT = `${GOOGLE_TTS_BASE_URL}/text:synthesize`;
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

const VoiceSchema = z
  .object({
    languageCodes: z.array(z.string().min(1)).optional(),
    name: z.string().min(1),
    ssmlGender: z.string().min(1).optional(),
    naturalSampleRateHertz: z.number().int().positive().optional(),
  })
  .passthrough();

const ListVoicesResponseSchema = z
  .object({
    voices: z.array(VoiceSchema).optional(),
  })
  .passthrough();

const SynthesizeResponseSchema = z
  .object({
    audioContent: z.string().min(1),
    audioConfig: z
      .object({
        audioEncoding: z.string().optional(),
        speakingRate: z.number().optional(),
        pitch: z.number().optional(),
        volumeGainDb: z.number().optional(),
        sampleRateHertz: z.number().optional(),
        effectsProfileId: z.array(z.string()).optional(),
        voiceProfile: z.string().optional(),
      })
      .passthrough()
      .optional(),
    timepoints: z
      .array(
        z
          .object({
            markName: z.string().optional(),
            timeSeconds: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export type GoogleTextToSpeechVoice = z.infer<typeof VoiceSchema>;

export type ListVoicesOptions = {
  languageCode?: string;
};

export type SynthesizeAudioEncoding = "MP3" | "OGG_OPUS" | "LINEAR16";

export type SynthesizeOptions = {
  text: string;
  voice: {
    languageCode: string;
    name?: string;
    ssmlGender?: string;
  };
  audioConfig?: {
    audioEncoding?: SynthesizeAudioEncoding;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
    sampleRateHertz?: number;
    effectsProfileId?: string[];
  };
};

export type SynthesizeResult = {
  audio: Uint8Array;
  audioConfig?: z.infer<typeof SynthesizeResponseSchema>["audioConfig"];
};

export const googleVoices = [
  "en-GB-Chirp3-HD-Sadaltager",
  "en-GB-Chirp3-HD-Leda",
  "en-GB-Chirp3-HD-Achernar",
] as const;

export type GoogleVoice = (typeof googleVoices)[number];

export function isGoogleVoice(voice: string): voice is GoogleVoice {
  return (googleVoices as readonly string[]).includes(voice);
}

export class GoogleTextToSpeechClient {
  private readonly auth = getGoogleAuth(CLOUD_PLATFORM_SCOPE);

  async listVoices(options: ListVoicesOptions = {}): Promise<GoogleTextToSpeechVoice[]> {
    const accessToken = await this.getAccessToken();
    const url = new URL(GOOGLE_TTS_VOICES_ENDPOINT);
    if (options.languageCode && options.languageCode.trim().length > 0) {
      url.searchParams.set("languageCode", options.languageCode.trim());
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      method: "GET",
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Google Text-to-Speech voices.list failed (${response.status} ${response.statusText}): ${bodyText}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch (error) {
      throw new Error(
        `Google Text-to-Speech voices.list returned invalid JSON: ${(error as Error).message}`,
      );
    }

    const parsed = ListVoicesResponseSchema.parse(payload);
    return parsed.voices ?? [];
  }

  async synthesize(options: SynthesizeOptions): Promise<SynthesizeResult> {
    const accessToken = await this.getAccessToken();
    const audioEncoding = options.audioConfig?.audioEncoding ?? "MP3";
    const requestBody = {
      input: {
        text: options.text,
      },
      voice: {
        languageCode: options.voice.languageCode,
        ...(options.voice.name ? { name: options.voice.name } : {}),
        ...(options.voice.ssmlGender ? { ssmlGender: options.voice.ssmlGender } : {}),
      },
      audioConfig: {
        audioEncoding,
        ...(options.audioConfig?.speakingRate !== undefined
          ? { speakingRate: options.audioConfig.speakingRate }
          : {}),
        ...(options.audioConfig?.pitch !== undefined
          ? { pitch: options.audioConfig.pitch }
          : {}),
        ...(options.audioConfig?.volumeGainDb !== undefined
          ? { volumeGainDb: options.audioConfig.volumeGainDb }
          : {}),
        ...(options.audioConfig?.sampleRateHertz !== undefined
          ? { sampleRateHertz: options.audioConfig.sampleRateHertz }
          : {}),
        ...(options.audioConfig?.effectsProfileId
          ? { effectsProfileId: options.audioConfig.effectsProfileId }
          : {}),
      },
    };

    const response = await fetch(GOOGLE_TTS_SYNTHESIZE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify(requestBody),
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Google Text-to-Speech text:synthesize failed (${response.status} ${response.statusText}): ${bodyText}`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch (error) {
      throw new Error(
        `Google Text-to-Speech text:synthesize returned invalid JSON: ${(error as Error).message}`,
      );
    }

    const parsed = SynthesizeResponseSchema.parse(payload);
    const audio = new Uint8Array(Buffer.from(parsed.audioContent, "base64"));

    return {
      audio,
      audioConfig: parsed.audioConfig,
    };
  }

  private async getAccessToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error("Failed to obtain Google access token for Text-to-Speech.");
    }
    return token;
  }
}

const defaultGoogleTtsClient = new GoogleTextToSpeechClient();

function deriveLanguageCode(voice: GoogleVoice): string {
  const parts = voice.split("-");
  if (parts.length >= 2) {
    return `${parts[0]}-${parts[1]}`;
  }
  return "en-US";
}

function toReadableStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

export async function googleTts({
  voice,
  input,
}: {
  voice: GoogleVoice;
  input: string;
}): Promise<ReadableStream<Uint8Array>> {
  const { audio } = await defaultGoogleTtsClient.synthesize({
    text: input,
    voice: {
      languageCode: deriveLanguageCode(voice),
      name: voice,
    },
    audioConfig: {
      audioEncoding: "MP3",
    },
  });

  return toReadableStream(audio);
}
