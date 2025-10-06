import { z } from "zod";

const trimmedString = z.string().trim().min(1);
const optionalString = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? "");

const listOfStrings = z
  .array(trimmedString)
  .default([])
  .transform((items) => items.map((item) => item.trim()).filter(Boolean));

const exampleSchema = z.object({
  label: trimmedString,
  input: trimmedString,
  output: trimmedString,
  explanation: optionalString,
});

const approachSchema = z.object({
  title: trimmedString,
  overview: trimmedString,
  steps: listOfStrings,
  timeComplexity: trimmedString,
  spaceComplexity: trimmedString,
  keyIdeas: listOfStrings,
});

export const CodeProblemSchema = z
  .object({
    slug: trimmedString,
    title: trimmedString,
    summary: trimmedString,
    summaryBullets: listOfStrings,
    difficulty: z.enum(["easy", "medium", "hard"]),
    primaryTopic: trimmedString,
    topics: listOfStrings,
    tags: listOfStrings,
    tasks: listOfStrings,
    constraints: listOfStrings,
    edgeCases: listOfStrings,
    hints: listOfStrings,
    followUpIdeas: listOfStrings,
    examples: z.array(exampleSchema).default([]),
    solution: z.object({
      optimal: approachSchema,
      alternatives: z.array(approachSchema).default([]),
    }),
    source: z.object({
      path: trimmedString,
      markdown: z.string(),
    }),
    metadataVersion: z.number().int().nonnegative(),
    starterCode: z.string().optional().nullable(),
  })
  .transform((value) => ({
    ...value,
    starterCode: value.starterCode ?? "",
  }));

export type CodeProblem = z.infer<typeof CodeProblemSchema>;
