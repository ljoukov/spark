import { z } from "zod";

import { getGoogleAuth } from "./googleAuth";

const GOOGLE_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1beta1/voices";
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

export type GoogleTextToSpeechVoice = z.infer<typeof VoiceSchema>;

export type ListVoicesOptions = {
  languageCode?: string;
};

export class GoogleTextToSpeechClient {
  private readonly auth = getGoogleAuth(CLOUD_PLATFORM_SCOPE);

  async listVoices(options: ListVoicesOptions = {}): Promise<GoogleTextToSpeechVoice[]> {
    const accessToken = await this.getAccessToken();
    const url = new URL(GOOGLE_TTS_ENDPOINT);
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

  private async getAccessToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error("Failed to obtain Google access token for Text-to-Speech.");
    }
    return token;
  }
}
