import type { LlmContent, LlmTextModelId } from "../utils/llm";
import { isGeminiModelId } from "../utils/gemini";
import { isOpenAiModelVariantId } from "../utils/openai-llm";

const DEFAULT_TEXT_MODEL_ID: LlmTextModelId = "gpt-5.2";

const ENV_TEXT_MODEL_ID = process.env.SPARK_LLM_TEXT_MODEL_ID?.trim();

export const TEXT_MODEL_ID: LlmTextModelId =
  ENV_TEXT_MODEL_ID &&
  (isGeminiModelId(ENV_TEXT_MODEL_ID) ||
    isOpenAiModelVariantId(ENV_TEXT_MODEL_ID))
    ? ENV_TEXT_MODEL_ID
    : DEFAULT_TEXT_MODEL_ID;

export function buildSingleUserPrompt(
  systemInstruction: string,
  userPrompt: string,
): LlmContent[] {
  const trimmedSystem = systemInstruction.trim();
  const trimmedUser = userPrompt.trim();
  const combined =
    trimmedSystem.length > 0
      ? `${trimmedSystem}\n\n${trimmedUser}`
      : trimmedUser;
  return [
    {
      role: "user",
      parts: [{ type: "text", text: combined }],
    },
  ];
}
