import { Type, type Schema } from "@google/genai";
import { z } from "zod";

const TrimmedString = z.string().trim().min(1);

function normaliseStringArray(values: readonly string[] | undefined): string[] {
  if (!values) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalised = trimmed.replace(/\s+/g, " ");
    if (seen.has(normalised.toLowerCase())) {
      continue;
    }
    seen.add(normalised.toLowerCase());
    result.push(normalised);
  }
  return result;
}

const NormalisedMultiline = z
  .string()
  .transform((value) =>
    value
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\s+$/u, ""),
  )
  .refine((value) => value.trim().length > 0, "Value cannot be empty");

export const CODE_DIFFICULTY_LEVELS = [
  "warmup",
  "intro",
  "easy",
  "medium",
  "hard",
] as const;

export const CodeProblemExampleSchema = z.object({
  title: TrimmedString,
  input: NormalisedMultiline,
  output: NormalisedMultiline,
  explanation: TrimmedString,
});

export const CodeProblemTestSchema = z.object({
  input: NormalisedMultiline,
  output: NormalisedMultiline,
  explanation: TrimmedString.optional(),
});

export const CodeProblemExtractionSchema = z.object({
  title: TrimmedString,
  difficulty: z.enum(CODE_DIFFICULTY_LEVELS),
  topics: z
    .array(TrimmedString)
    .min(1)
    .transform((values) => normaliseStringArray(values)),
  description: TrimmedString,
  inputFormat: TrimmedString,
  constraints: z
    .array(TrimmedString)
    .min(1)
    .transform((values) => normaliseStringArray(values)),
  examples: z.array(CodeProblemExampleSchema).length(3),
  tests: z.array(CodeProblemTestSchema).min(10).max(25),
  hints: z.array(TrimmedString).length(3),
  solutionCode: NormalisedMultiline,
});

export type CodeProblemExample = z.infer<typeof CodeProblemExampleSchema>;
export type CodeProblemTest = z.infer<typeof CodeProblemTestSchema>;
export type CodeProblemExtraction = z.infer<typeof CodeProblemExtractionSchema>;

export const CODE_PROBLEM_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    difficulty: {
      type: Type.STRING,
      enum: CODE_DIFFICULTY_LEVELS as unknown as string[],
    },
    topics: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    description: { type: Type.STRING },
    inputFormat: { type: Type.STRING },
    constraints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    examples: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          input: { type: Type.STRING },
          output: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ["title", "input", "output", "explanation"],
        propertyOrdering: ["title", "input", "output", "explanation"],
      },
    },
    tests: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          input: { type: Type.STRING },
          output: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ["input", "output"],
        propertyOrdering: ["input", "output", "explanation"],
      },
    },
    hints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    solutionCode: { type: Type.STRING },
  },
  required: [
    "title",
    "difficulty",
    "topics",
    "description",
    "inputFormat",
    "constraints",
    "examples",
    "tests",
    "hints",
    "solutionCode",
  ],
  propertyOrdering: [
    "title",
    "difficulty",
    "topics",
    "description",
    "inputFormat",
    "constraints",
    "examples",
    "tests",
    "hints",
    "solutionCode",
  ],
};
