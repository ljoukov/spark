import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  generateSparkPdfQuizDefinition,
  SPARK_UPLOAD_QUIZ_QUESTION_COUNT,
  type SparkQuizSourceFile,
} from "@spark/llm";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";

import { createCliCommand } from "../utils/cli";
import { detectMimeType } from "../utils/mime";
import { ensureEvalEnvLoaded } from "../utils/paths";

type CliOptions = {
  readonly inputFile: string;
};

const CliOptionsSchema = z.object({
  inputFile: z
    .string()
    .min(1, "Input file path is required")
    .transform((value) => path.resolve(value)),
});

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "generate-quiz",
    "Generate a Spark quiz definition from a PDF study resource using Gemini",
  );

  program.requiredOption(
    "-i, --input-file <path>",
    "Path to the PDF file to convert into a quiz",
  );

  const parsed = program.parse(argv, { from: "node" }).opts<{
    inputFile?: string;
  }>();

  return CliOptionsSchema.parse({
    inputFile: parsed.inputFile,
  });
}

async function readPdfAsQuizSource(filePath: string): Promise<SparkQuizSourceFile> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`Input path ${filePath} is not a file`);
  }
  if (fileStats.size <= 0) {
    throw new Error(`Input file ${filePath} is empty`);
  }
  const mimeType = detectMimeType(filePath);
  if (mimeType !== "application/pdf") {
    throw new Error(
      `Input file ${filePath} is not a PDF (detected mime type: ${mimeType})`,
    );
  }
  const data = await readFile(filePath);
  const filename = path.basename(filePath);
  return {
    filename,
    mimeType,
    data,
  };
}

async function main(argv: readonly string[]): Promise<void> {
  ensureEvalEnvLoaded();
  const options = parseCliOptions(argv);
  const source = await readPdfAsQuizSource(options.inputFile);

  const [quizDefinition] = await runJobsWithConcurrency<
    { source: SparkQuizSourceFile },
    Awaited<ReturnType<typeof generateSparkPdfQuizDefinition>>
  >({
    items: [{ source }],
    concurrency: 1,
    getId: (item) => item.source.filename,
    label: "[quiz]",
    handler: async (item, { progress }) => {
      progress.log(
        `starting quiz generation for ${item.source.filename} (${SPARK_UPLOAD_QUIZ_QUESTION_COUNT} questions)`,
      );
      const quizId = randomUUID();
      const definition = await generateSparkPdfQuizDefinition({
        quizId,
        sources: [item.source],
        questionCount: SPARK_UPLOAD_QUIZ_QUESTION_COUNT,
        progress,
      });
      progress.log(
        `completed quiz generation for ${item.source.filename} (quizId ${definition.id})`,
      );
      return definition;
    },
  });

  console.log(JSON.stringify(quizDefinition, null, 2));
}

void main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
