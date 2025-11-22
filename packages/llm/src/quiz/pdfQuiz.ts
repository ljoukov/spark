import type { QuizDefinition } from "@spark/schemas";

import {
  SPARK_UPLOAD_QUIZ_MODEL_ID,
  SPARK_UPLOAD_QUIZ_QUESTION_COUNT,
  SPARK_UPLOAD_QUIZ_RESPONSE_SCHEMA,
  SparkUploadQuizPayloadSchema,
  convertSparkUploadPayloadToQuizDefinition,
  type SparkUploadQuizPayload,
} from "./sparkUpload";
import { toInlineSourceFiles } from "./common";
import { generateJson, type LlmContent } from "../utils/llm";
import type { JobProgressReporter } from "../utils/concurrency";
import type { SparkQuizSourceFile } from "./common";

export interface GeneratePdfQuizOptions {
  readonly quizId: string;
  readonly sources: ReadonlyArray<SparkQuizSourceFile>;
  readonly questionCount?: number;
  readonly subject?: string;
  readonly board?: string;
  readonly topicHint?: string;
  readonly progress?: JobProgressReporter;
}

export async function generateSparkPdfQuizDefinition(
  options: GeneratePdfQuizOptions,
): Promise<QuizDefinition> {
  const questionCount =
    options.questionCount ?? SPARK_UPLOAD_QUIZ_QUESTION_COUNT;
  if (questionCount <= 0) {
    throw new Error("questionCount must be a positive integer");
  }

  const inlineFiles = toInlineSourceFiles(options.sources);
  const prompt = buildPdfQuizPrompt({
    questionCount,
    subject: options.subject,
    board: options.board,
    topicHint: options.topicHint,
    inlineFiles,
  });

  options.progress?.log(
    `[spark-quiz] generating ${questionCount} questions from PDF`,
  );

  const contents: LlmContent[] = [
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: prompt,
        },
        ...inlineFiles.map((file) => ({
          type: "inlineData" as const,
          data: file.data,
          mimeType: file.mimeType,
        })),
      ],
    },
  ];

  const payload = await generateJson<SparkUploadQuizPayload>({
    modelId: SPARK_UPLOAD_QUIZ_MODEL_ID,
    contents,
    schema: SparkUploadQuizPayloadSchema,
    responseSchema: SPARK_UPLOAD_QUIZ_RESPONSE_SCHEMA,
    progress: options.progress,
  });

  return convertSparkUploadPayloadToQuizDefinition(payload, {
    uploadId: options.quizId,
    quizId: options.quizId,
    sources: options.sources,
    questionCount,
    subject: options.subject,
    board: options.board,
    topicHint: options.topicHint,
  });
}

type PromptOptions = {
  readonly questionCount: number;
  readonly subject?: string;
  readonly board?: string;
  readonly topicHint?: string;
  readonly inlineFiles: ReturnType<typeof toInlineSourceFiles>;
};

function buildPdfQuizPrompt(options: PromptOptions): string {
  const lines: string[] = [
    "You are Spark's GCSE Triple Science quiz author.",
    `Craft ${options.questionCount} high-quality questions drawn strictly from the attached study material.`,
    "Audience: GCSE students preparing for combined or separate sciences (AQA, Edexcel, OCR). Respect syllabus terminology and stay grounded in the sources.",
    "",
    "Question mix requirements:",
    "- Use a blend of multiple-choice and short constructed response (type-answer) questions.",
    "- Include at least 30% application or calculation items when the material permits.",
    "- Cover the breadth of the material; avoid clustering on a single sub-topic.",
    "",
    "Output JSON (schema enforced separately) with fields:",
    "- quizId: reuse the provided quiz identifier.",
    "- title: concise quiz title derived from the material.",
    "- description: optional single-paragraph overview of the set.",
    "- topic / subject / board: optional metadata when confidently deduced.",
    "- questionCount: must match the number of questions returned.",
    "- questions: ordered list of question objects following the provided schema.",
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
