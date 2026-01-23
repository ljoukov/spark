import { z } from "zod";

import { loadLocalEnv } from "./env";

export type OpenAiProvider = "api" | "chatgpt";

const OpenAiProviderSchema = z.enum(["api", "chatgpt"]);

export function resolveOpenAiProvider(
  explicit?: OpenAiProvider,
): OpenAiProvider {
  if (explicit) {
    return explicit;
  }
  loadLocalEnv();
  const raw =
    process.env.OPENAI_AUTH_PROVIDER ?? process.env.OPENAI_PROVIDER ?? "api";
  const trimmed = raw.trim().toLowerCase();
  const parsed = OpenAiProviderSchema.safeParse(trimmed);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Invalid OPENAI_AUTH_PROVIDER: ${message}`);
  }
  return parsed.data;
}
