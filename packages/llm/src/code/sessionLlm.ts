import type { LlmContent } from "../utils/llm";

export const TEXT_MODEL_ID = "gemini-3-pro-preview" as const;

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
