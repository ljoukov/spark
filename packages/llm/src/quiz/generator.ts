import type { Part } from "@google/genai";

import { runGeminiCall, type GeminiModelId } from "../utils/gemini";
import {
  QUIZ_RESPONSE_SCHEMA,
  QuizGenerationSchema,
  type InlineSourceFile,
  type QuizGeneration,
} from "./schemas";
import {
  type GenerateQuizOptions,
  buildGenerationPrompt,
  buildSourceParts,
  buildExtensionPrompt,
  normaliseQuizPayload,
} from "./prompts";

export const QUIZ_GENERATION_MODEL_ID: GeminiModelId = "gemini-2.5-pro";
export const DEFAULT_GENERATION_QUESTION_COUNT = 10;
export const DEFAULT_EXTENSION_QUESTION_COUNT = 10;

export type { GenerateQuizOptions } from "./prompts";

export interface ExtendQuizOptions {
  readonly sourceFiles: InlineSourceFile[];
  readonly baseQuiz: QuizGeneration;
  readonly additionalQuestionCount?: number;
  readonly subject?: string;
  readonly board?: string;
}

export async function generateQuizFromSource(
  options: GenerateQuizOptions
): Promise<QuizGeneration> {
  const prompt = buildGenerationPrompt(options);
  const parts: Part[] = [
    { text: prompt },
    ...buildSourceParts(options.sourceFiles),
  ];

  const response = await runGeminiCall((client) =>
    client.models.generateContent({
      model: QUIZ_GENERATION_MODEL_ID,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: QUIZ_RESPONSE_SCHEMA,
      },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini did not return any text for quiz generation");
  }

  const parsed: unknown = JSON.parse(text);
  const normalised = normaliseQuizPayload(parsed, options.questionCount);
  return QuizGenerationSchema.parse(normalised);
}

export async function extendQuizWithMoreQuestions(
  options: ExtendQuizOptions
): Promise<QuizGeneration> {
  const additionalQuestionCount =
    options.additionalQuestionCount ?? DEFAULT_EXTENSION_QUESTION_COUNT;
  const prompt = buildExtensionPrompt({
    additionalQuestionCount,
    subject: options.subject ?? options.baseQuiz.subject,
    board: options.board,
  });
  const pastQuizLines = options.baseQuiz.questions.map(
    (question, index) => `${index + 1}. ${question.prompt}`
  );
  const pastQuizBlock = `<PAST_QUIZES>\n${pastQuizLines.join("\n")}\n</PAST_QUIZES>`;
  const parts: Part[] = [
    { text: prompt },
    ...buildSourceParts(options.sourceFiles),
    {
      text: `Previous quiz prompts:\n${pastQuizBlock}`,
    },
  ];

  const response = await runGeminiCall((client) =>
    client.models.generateContent({
      model: QUIZ_GENERATION_MODEL_ID,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: QUIZ_RESPONSE_SCHEMA,
      },
    })
  );

  const text = response.text;
  if (!text) {
    throw new Error("Gemini did not return any text for quiz extension");
  }
  const parsed: unknown = JSON.parse(text);
  const normalised = normaliseQuizPayload(parsed, additionalQuestionCount);
  return QuizGenerationSchema.parse(normalised);
}
