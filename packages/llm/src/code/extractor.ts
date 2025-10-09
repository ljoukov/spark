import type { Part } from "@google/genai";

import {
  streamGeminiTextResponse,
  type GeminiModelId,
} from "../utils/gemini";
import {
  CodeProblemExtractionSchema,
  CODE_PROBLEM_RESPONSE_SCHEMA,
  type CodeProblemExtraction,
} from "./schemas";
import { buildCodeProblemExtractionPrompt } from "./prompts";

export interface CodeProblemExtractionRequest {
  readonly modelId: GeminiModelId;
  readonly prompt: string;
  readonly parts: Part[];
}

export const CODE_PROBLEM_EXTRACTION_MODEL_ID: GeminiModelId = "gemini-2.5-pro";

export interface ExtractCodeProblemOptions {
  readonly slug: string;
  readonly markdown: string;
  readonly modelId?: GeminiModelId;
}

export function buildCodeProblemExtractionRequest(
  options: ExtractCodeProblemOptions,
): CodeProblemExtractionRequest {
  const modelId = options.modelId ?? CODE_PROBLEM_EXTRACTION_MODEL_ID;
  const prompt = buildCodeProblemExtractionPrompt({
    slug: options.slug,
    sourceMarkdown: options.markdown,
  });
  const parts: Part[] = [{ text: prompt }];
  return {
    modelId,
    prompt,
    parts,
  };
}

export function parseCodeProblemExtractionResponse(
  text: string,
): CodeProblemExtraction {
  const parsed: unknown = JSON.parse(text);
  return CodeProblemExtractionSchema.parse(parsed);
}

export async function extractCodeProblemFromMarkdown(
  options: ExtractCodeProblemOptions,
): Promise<CodeProblemExtraction> {
  const request = buildCodeProblemExtractionRequest(options);

  const { text } = await streamGeminiTextResponse({
    model: request.modelId,
    parts: request.parts,
    config: {
      responseMimeType: "application/json",
      responseSchema: CODE_PROBLEM_RESPONSE_SCHEMA,
    },
    trimOutput: false,
  });
  if (!text) {
    throw new Error("Gemini did not return text for code problem extraction");
  }
  return parseCodeProblemExtractionResponse(text);
}
