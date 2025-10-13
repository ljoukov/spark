import OpenAI from "openai";

import { loadLocalEnv } from "./env";

let cachedApiKey: string | null = null;
let cachedClient: OpenAI | null = null;

function getOpenAiApiKey(): string {
  if (cachedApiKey !== null) {
    return cachedApiKey;
  }

  loadLocalEnv();

  const raw = process.env.OPENAI_API_KEY;
  const value = raw?.trim();
  if (!value) {
    throw new Error("OPENAI_API_KEY must be provided to access OpenAI APIs.");
  }

  cachedApiKey = value;
  return cachedApiKey;
}

export function getOpenAiClient(): OpenAI {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = getOpenAiApiKey();
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}
