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

export const CODE_DIFFICULTY_LEVELS = ["easy", "medium", "hard"] as const;

export const CodeProblemExampleSchema = z
  .object({
    label: TrimmedString,
    input: TrimmedString,
    output: TrimmedString,
    explanation: TrimmedString.optional(),
  })
  .transform((value) => ({
    ...value,
    explanation: value.explanation ?? "",
  }));

export const CodeProblemApproachSchema = z
  .object({
    title: TrimmedString,
    overview: TrimmedString,
    steps: z
      .array(TrimmedString)
      .optional()
      .transform((values) => normaliseStringArray(values)),
    timeComplexity: TrimmedString,
    spaceComplexity: TrimmedString,
    keyIdeas: z
      .array(TrimmedString)
      .optional()
      .transform((values) => normaliseStringArray(values)),
  })
  .transform((value) => ({
    ...value,
    steps: value.steps ?? [],
    keyIdeas: value.keyIdeas ?? [],
  }));

export const CodeProblemExtractionSchema = z.object({
  title: TrimmedString,
  summary: TrimmedString,
  difficulty: z.enum(CODE_DIFFICULTY_LEVELS),
  primaryTopic: TrimmedString,
  topics: z
    .array(TrimmedString)
    .min(1)
    .transform((values) => normaliseStringArray(values)),
  tags: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  tasks: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  constraints: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  edgeCases: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  followUpIdeas: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  summaryBullets: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  hints: z
    .array(TrimmedString)
    .optional()
    .transform((values) => normaliseStringArray(values)),
  examples: z
    .array(CodeProblemExampleSchema)
    .optional()
    .transform((values) => values ?? []),
  optimalApproach: CodeProblemApproachSchema,
  alternativeApproaches: z
    .array(CodeProblemApproachSchema)
    .optional()
    .transform((values) => values ?? []),
});

export type CodeProblemExample = z.infer<typeof CodeProblemExampleSchema>;
export type CodeProblemApproach = z.infer<typeof CodeProblemApproachSchema>;
export type CodeProblemExtraction = z.infer<typeof CodeProblemExtractionSchema>;

export const CODE_PROBLEM_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    difficulty: {
      type: Type.STRING,
      enum: CODE_DIFFICULTY_LEVELS as unknown as string[],
    },
    primaryTopic: { type: Type.STRING },
    topics: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    tags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    tasks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    constraints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    edgeCases: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    followUpIdeas: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    summaryBullets: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    hints: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    examples: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          input: { type: Type.STRING },
          output: { type: Type.STRING },
          explanation: { type: Type.STRING },
        },
        required: ["label", "input", "output"],
        propertyOrdering: ["label", "input", "output", "explanation"],
      },
    },
    optimalApproach: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        overview: { type: Type.STRING },
        steps: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        timeComplexity: { type: Type.STRING },
        spaceComplexity: { type: Type.STRING },
        keyIdeas: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: ["title", "overview", "timeComplexity", "spaceComplexity"],
      propertyOrdering: [
        "title",
        "overview",
        "steps",
        "timeComplexity",
        "spaceComplexity",
        "keyIdeas",
      ],
    },
    alternativeApproaches: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          overview: { type: Type.STRING },
          steps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          timeComplexity: { type: Type.STRING },
          spaceComplexity: { type: Type.STRING },
          keyIdeas: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: ["title", "overview", "timeComplexity", "spaceComplexity"],
        propertyOrdering: [
          "title",
          "overview",
          "steps",
          "timeComplexity",
          "spaceComplexity",
          "keyIdeas",
        ],
      },
    },
  },
  required: [
    "title",
    "summary",
    "difficulty",
    "primaryTopic",
    "topics",
    "optimalApproach",
  ],
  propertyOrdering: [
    "title",
    "summary",
    "difficulty",
    "primaryTopic",
    "topics",
    "tags",
    "tasks",
    "constraints",
    "edgeCases",
    "summaryBullets",
    "hints",
    "examples",
    "optimalApproach",
    "alternativeApproaches",
    "followUpIdeas",
  ],
};
