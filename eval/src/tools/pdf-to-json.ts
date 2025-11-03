import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { Type, type Schema } from "@google/genai";
import { z } from "zod";

import { generateJson, type LlmContent } from "@spark/llm/utils/llm";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";

import { createCliCommand } from "../utils/cli";
import { detectMimeType } from "../utils/mime";
import { ensureEvalEnvLoaded } from "../utils/paths";

type CliOptions = {
  inputFile: string;
};

const CliOptionsSchema = z.object({
  inputFile: z
    .string()
    .min(1, "Input file path is required")
    .transform((value) => path.resolve(value)),
});

type PdfPageDescription = {
  pageNumber: number;
  description: string;
};

type PdfAnalysis = {
  pages: PdfPageDescription[];
  documentSummary: string;
};

const PdfAnalysisSchema = z
  .object({
    pages: z
      .array(
        z.object({
          page_number: z.number().int().min(1),
          description: z.string().trim().min(1),
        }),
      )
      .min(1),
    document_summary: z.string().trim().min(1),
  })
  .transform((raw) => ({
    pages: raw.pages.map((page) => ({
      pageNumber: page.page_number,
      description: page.description,
    })),
    documentSummary: raw.document_summary,
  }));

const PAGE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["page_number", "description"],
  propertyOrdering: ["page_number", "description"],
  properties: {
    page_number: {
      type: Type.NUMBER,
      minimum: 1,
      description: "1-based index of the PDF page being described",
    },
    description: {
      type: Type.STRING,
      minLength: "1",
      description:
        "Concise but complete description of the page content, notable visuals, and its role in the document",
    },
  },
};

const PDF_ANALYSIS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["pages", "document_summary"],
  propertyOrdering: ["pages", "document_summary"],
  properties: {
    pages: {
      type: Type.ARRAY,
      items: PAGE_RESPONSE_SCHEMA,
      description: "List of page descriptions ordered from the first page to the last page",
    },
    document_summary: {
      type: Type.STRING,
      minLength: "1",
      description:
        "Short overall description that captures the document's purpose and the key ideas linking the pages together",
    },
  },
};

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "pdf-to-json",
    "Generate structured page-by-page descriptions for a PDF using Gemini",
  );

  program.requiredOption("-i, --input-file <path>", "Path to the PDF file to analyse");

  const parsed = program.parse(argv, { from: "node" }).opts<{
    inputFile?: string;
  }>();

  return CliOptionsSchema.parse({
    inputFile: parsed.inputFile,
  });
}

async function readPdfBase64(filePath: string): Promise<string> {
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
  const buffer = await readFile(filePath);
  return buffer.toString("base64");
}

function buildPrompt({
  fileName,
  pdfBase64,
}: {
  fileName: string;
  pdfBase64: string;
}): LlmContent[] {
  const instructions = [
    `Analyse the attached PDF "${fileName}".`,
    "Describe every page in order. For each page provide a grounded summary that calls out the main topics, diagrams, data, and why the page matters.",
    "After you have described every page, provide a short overall document summary that captures the intent, audience, and major takeaways tying the pages together.",
    "Avoid speculation and rely only on the document contents.",
  ].join("\n\n");

  return [
    {
      role: "user",
      parts: [
        {
          type: "text",
          text: instructions,
        },
        {
          type: "inlineData",
          data: pdfBase64,
          mimeType: "application/pdf",
        },
      ],
    },
  ];
}

async function main(argv: readonly string[]): Promise<void> {
  ensureEvalEnvLoaded();
  const options = parseCliOptions(argv);
  const pdfBase64 = await readPdfBase64(options.inputFile);
  const fileName = path.basename(options.inputFile);
  const contents = buildPrompt({
    fileName,
    pdfBase64,
  });

  const [analysis] = await runJobsWithConcurrency<
    { fileName: string; contents: LlmContent[] },
    PdfAnalysis
  >({
    items: [{ fileName, contents }],
    concurrency: 1,
    getId: (item) => item.fileName,
    label: "[pdf-to-json]",
    handler: async (item, { progress }) => {
      progress.log(`starting Gemini analysis for ${item.fileName}`);
      const result = await generateJson<PdfAnalysis>({
        modelId: "gemini-2.5-pro",
        contents: item.contents,
        schema: PdfAnalysisSchema,
        responseSchema: PDF_ANALYSIS_RESPONSE_SCHEMA,
        progress,
      });
      progress.log(`completed Gemini analysis for ${item.fileName}`);
      return result;
    },
  });

  console.log(JSON.stringify(analysis, null, 2));
}

void main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
