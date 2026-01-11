import { Type, type Part, type Schema } from "@google/genai";
import type { QuizDefinition } from "@spark/schemas";
import { QuizDefinitionSchema } from "@spark/schemas";
import { z } from "zod";

import {
  buildCorrectFeedback,
  coerceQuestionId,
  normaliseStringList,
  toInlineSourceFiles,
  type InlineSourceFile,
  type SparkQuizSourceFile,
} from "./common";
export type { SparkQuizSourceFile } from "./common";
import { streamGeminiTextResponse, type GeminiModelId } from "../utils/gemini";
import { toGeminiJsonSchema } from "../utils/llm";

type QuizQuestionDefinition = QuizDefinition["questions"][number];

function buildSourceParts(files: InlineSourceFile[]): Part[] {
  return files.map((file) => ({
    inlineData: {
      data: file.data,
      mimeType: file.mimeType,
    },
  }));
}

export const SPARK_UPLOAD_QUIZ_MODEL_ID: GeminiModelId = "gemini-2.5-pro";
export const SPARK_UPLOAD_QUIZ_QUESTION_COUNT = 20;

const trimmedString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().min(1).optional();

const SparkMultipleChoiceQuestionSchema = z
  .object({
    kind: z.literal("multiple-choice"),
    id: trimmedString,
    prompt: trimmedString,
    hint: optionalTrimmedString,
    explanation: trimmedString,
    options: z.array(trimmedString).min(3).max(5),
    correctOptionIndex: z.number().int().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.correctOptionIndex > value.options.length) {
      ctx.addIssue({
        code: "custom",
        message: "correctOptionIndex must reference an existing option",
        path: ["correctOptionIndex"],
      });
    }
  });

const SparkTypeAnswerQuestionSchema = z.object({
  kind: z.literal("type-answer"),
  id: trimmedString,
  prompt: trimmedString,
  hint: optionalTrimmedString,
  explanation: trimmedString,
  answer: trimmedString,
  acceptableAnswers: z.array(trimmedString).max(6).optional(),
});

export const SparkUploadQuizQuestionSchema = z.discriminatedUnion("kind", [
  SparkMultipleChoiceQuestionSchema,
  SparkTypeAnswerQuestionSchema,
]);

export type SparkUploadQuizQuestion = z.infer<
  typeof SparkUploadQuizQuestionSchema
>;

export const SparkUploadQuizPayloadSchema = z.object({
  quizId: trimmedString,
  title: trimmedString,
  description: z.string().optional(),
  topic: z.string().optional(),
  subject: z.string().optional(),
  board: z.string().optional(),
  questionCount: z.number().int().min(1),
  questions: z.array(SparkUploadQuizQuestionSchema).min(1),
});

export type SparkUploadQuizPayload = z.infer<
  typeof SparkUploadQuizPayloadSchema
>;

export const SPARK_UPLOAD_QUIZ_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["quizId", "title", "questionCount", "questions"],
  properties: {
    quizId: { type: Type.STRING },
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    topic: { type: Type.STRING },
    subject: { type: Type.STRING },
    board: { type: Type.STRING },
    questionCount: { type: Type.INTEGER, minimum: 1, maximum: 40 },
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["id", "kind", "prompt", "explanation"],
        properties: {
          id: { type: Type.STRING },
          kind: {
            type: Type.STRING,
            enum: ["multiple-choice", "type-answer"],
          },
          prompt: { type: Type.STRING },
          hint: { type: Type.STRING },
          explanation: { type: Type.STRING },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Only for multiple-choice questions. Provide 3-5 concise answer choices without letter prefixes.",
          },
          correctOptionIndex: {
            type: Type.INTEGER,
            minimum: 1,
            description:
              "1-based index pointing to the correct option in the options array. Required for multiple-choice.",
          },
          answer: {
            type: Type.STRING,
            description:
              "Canonical short answer for type-answer questions. Omit for multiple-choice.",
          },
          acceptableAnswers: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              "Optional additional acceptable responses for type-answer questions.",
          },
        },
        propertyOrdering: [
          "id",
          "kind",
          "prompt",
          "hint",
          "explanation",
          "options",
          "correctOptionIndex",
          "answer",
          "acceptableAnswers",
        ],
      },
    },
  },
  propertyOrdering: [
    "quizId",
    "title",
    "description",
    "topic",
    "subject",
    "board",
    "questionCount",
    "questions",
  ],
};

export interface GenerateSparkUploadQuizOptions {
  readonly uploadId: string;
  readonly quizId: string;
  readonly sources: ReadonlyArray<SparkQuizSourceFile>;
  readonly questionCount?: number;
  readonly subject?: string;
  readonly board?: string;
  readonly topicHint?: string;
}

function convertMultipleChoiceQuestion(
  question: Extract<SparkUploadQuizQuestion, { kind: "multiple-choice" }>,
  index: number,
  seenIds: Set<string>,
): QuizQuestionDefinition {
  const questionId = coerceQuestionId(question.id, index, seenIds);
  const options = question.options.map((text, optionIndex) => {
    const label = String.fromCharCode(65 + optionIndex);
    return {
      id: `${questionId}-option-${optionIndex + 1}`,
      label,
      text: text.trim(),
    };
  });
  if (options.length < 2) {
    throw new Error(`Question ${questionId} must include at least two options`);
  }
  const optionIndex =
    question.correctOptionIndex >= 1
      ? Math.min(question.correctOptionIndex, options.length) - 1
      : 0;
  const correctOption = options[optionIndex] ?? options[0];
  return {
    kind: "multiple-choice",
    id: questionId,
    prompt: question.prompt.trim(),
    hint: question.hint?.trim(),
    explanation: question.explanation.trim(),
    correctFeedback: buildCorrectFeedback(question.explanation),
    options,
    correctOptionId: correctOption.id,
  };
}

function convertTypeAnswerQuestion(
  question: Extract<SparkUploadQuizQuestion, { kind: "type-answer" }>,
  index: number,
  seenIds: Set<string>,
): QuizQuestionDefinition {
  const questionId = coerceQuestionId(question.id, index, seenIds);
  const acceptable = normaliseStringList(question.acceptableAnswers);
  return {
    kind: "type-answer",
    id: questionId,
    prompt: question.prompt.trim(),
    hint: question.hint?.trim(),
    explanation: question.explanation.trim(),
    correctFeedback: buildCorrectFeedback(question.explanation),
    answer: question.answer.trim(),
    acceptableAnswers: acceptable.length > 0 ? acceptable : undefined,
  };
}

export function convertSparkUploadPayloadToQuizDefinition(
  payload: SparkUploadQuizPayload,
  options: GenerateSparkUploadQuizOptions,
): QuizDefinition {
  const expectedCount =
    options.questionCount ?? SPARK_UPLOAD_QUIZ_QUESTION_COUNT;
  if (payload.questions.length !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} questions but received ${payload.questions.length}`,
    );
  }
  if (payload.questionCount !== payload.questions.length) {
    throw new Error(
      "questionCount must match the number of questions returned",
    );
  }
  const seenIds = new Set<string>();
  const questions = payload.questions.map((question, index) => {
    if (question.kind === "multiple-choice") {
      return convertMultipleChoiceQuestion(question, index, seenIds);
    }
    return convertTypeAnswerQuestion(question, index, seenIds);
  });

  const title = payload.title.trim();
  const description =
    payload.description?.trim() && payload.description.trim().length > 0
      ? payload.description.trim()
      : title;
  const topic =
    payload.topic?.trim() ||
    payload.subject?.trim() ||
    options.topicHint?.trim();

  const quiz: QuizDefinition = {
    id: options.quizId,
    title: title.length > 0 ? title : "Spark Quiz",
    description,
    topic: topic && topic.length > 0 ? topic : undefined,
    progressKey: options.quizId,
    questions,
  };

  return QuizDefinitionSchema.parse(quiz);
}

function buildSparkUploadQuizPrompt(
  options: GenerateSparkUploadQuizOptions & {
    readonly questionCount: number;
    readonly inlineFiles: ReadonlyArray<InlineSourceFile>;
  },
): string {
  const lines: string[] = [
    "You are Spark's GCSE Triple Science quiz author.",
    `Craft ${options.questionCount} high-quality questions from the attached study material.`,
    "Audience: GCSE students preparing for combined or separate sciences (AQA, Edexcel, OCR). Respect syllabus terminology and stay grounded in the sources.",
    "Question mix requirements:",
    "- Use a blend of multiple-choice and short constructed response (type-answer) questions.",
    "- Include at least 30% application or calculation items when the material permits.",
    "- Cover the breadth of the material; avoid clustering on a single sub-topic.",
    "",
    "Output JSON (schema enforced separately) with fields:",
    "- quizId: reuse the provided quiz identifier when supplied.",
    "- title: concise quiz title derived from the material.",
    "- description: optional single-paragraph overview of the set.",
    "- topic / subject / board: optional metadata when confidently deduced.",
    "- questionCount: must match the number of questions returned.",
    "- questions: ordered list of question objects.",
    "",
    "Question rules:",
    "- IDs should follow Q1, Q2, ... (duplicates will be normalised downstream).",
    "- Prompts must stand alone without referencing page numbers.",
    "- Provide hints sparingly; they should nudge, not give away the answer.",
    "- Explanations must justify the correct response referencing the source.",
    "- Formulas: inline `$...$` or block `$$...$$` LaTeX is allowed; stay within KaTeX-supported math (fractions, exponents, subscripts, roots) and avoid LaTeX packages/environments.",
    "- Multiple-choice: supply 3-5 options, uncluttered text, one correct option marked by correctOptionIndex (1-based).",
    "- Type-answer: keep answers short; include acceptableAnswers when multiple phrasings are equivalent.",
    "- Do not include true/false or numeric kinds; stick to multiple-choice and type-answer.",
    "",
    "Return JSON only.",
    "",
    `Upload context: uploadId ${options.uploadId}.`,
  ];

  if (options.subject) {
    lines.push(`Subject focus: ${options.subject.trim()}.`);
  }
  if (options.board) {
    lines.push(`Exam board signal: ${options.board.trim()}.`);
  }
  if (options.topicHint) {
    lines.push(`Topic hint: ${options.topicHint.trim()}.`);
  }

  lines.push("", "Attached assets (PDF unless stated otherwise):");
  options.inlineFiles.forEach((file, index) => {
    lines.push(`- [${index + 1}] ${file.displayName} (${file.mimeType})`);
  });

  return lines.join("\n");
}

export async function generateSparkUploadQuizDefinition(
  options: GenerateSparkUploadQuizOptions,
): Promise<QuizDefinition> {
  const questionCount =
    options.questionCount ?? SPARK_UPLOAD_QUIZ_QUESTION_COUNT;
  const inlineFiles = toInlineSourceFiles(options.sources);
  const prompt = buildSparkUploadQuizPrompt({
    ...options,
    questionCount,
    inlineFiles,
  });

  const parts = [{ text: prompt }, ...buildSourceParts(inlineFiles)];
  const { text } = await streamGeminiTextResponse({
    model: SPARK_UPLOAD_QUIZ_MODEL_ID,
    parts,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: toGeminiJsonSchema(SPARK_UPLOAD_QUIZ_RESPONSE_SCHEMA),
    },
    trimOutput: false,
  });

  if (!text) {
    throw new Error("Gemini did not return any text for Spark quiz generation");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Failed to parse Spark quiz generation response: ${(error as Error).message}`,
    );
  }

  const payload = SparkUploadQuizPayloadSchema.parse(parsed);
  return convertSparkUploadPayloadToQuizDefinition(payload, {
    ...options,
    questionCount,
  });
}
