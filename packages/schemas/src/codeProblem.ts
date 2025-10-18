import { z } from "zod";

const trimmedString = z.string().trim().min(1);
const markdownString = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "Markdown text cannot be empty");

const uniqueStringArray = z
  .array(trimmedString)
  .min(1)
  .transform((items) => {
    const seen = new Set<string>();
    return items
      .map((item) => item.trim())
      .filter((item) => {
        if (!item) {
          return false;
        }
        if (seen.has(item.toLowerCase())) {
          return false;
        }
        seen.add(item.toLowerCase());
        return true;
      });
  });

const normalizedMultiline = z
  .string()
  .transform((value) =>
    value
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\s+$/u, ""),
  )
  .refine((value) => value.trim().length > 0, "Value cannot be empty");

const exampleSchema = z.object({
  title: trimmedString,
  input: normalizedMultiline,
  output: normalizedMultiline,
  explanation: markdownString,
});

const testCaseSchema = z.object({
  input: normalizedMultiline,
  output: normalizedMultiline,
  explanation: markdownString.optional(),
});

const solutionSchema = z.object({
  language: z.literal("python").default("python"),
  code: normalizedMultiline,
});

export const CodeProblemSchema = z
  .object({
    slug: trimmedString,
    title: trimmedString,
    topics: uniqueStringArray,
    difficulty: z.enum(["warmup", "intro", "easy", "medium", "hard"]),
    description: markdownString,
    inputFormat: markdownString,
    constraints: z
      .array(trimmedString)
      .min(1)
      .transform((items) => items.map((item) => item.trim())),
    examples: z
      .array(exampleSchema)
      .length(3, "Provide exactly three examples"),
    tests: z
      .array(testCaseSchema)
      .min(10, "Provide at least ten tests")
      .max(25, "Provide at most twenty-five tests"),
    hints: z
      .array(markdownString)
      .length(3, "Provide exactly three ordered hints"),
    solution: solutionSchema,
    metadataVersion: z.number().int().nonnegative(),
  })
  .superRefine((value, ctx) => {
    for (let index = 0; index < value.examples.length; index += 1) {
      const example = value.examples[index];
      const test = value.tests[index];
      if (!test) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tests", index],
          message: `Missing test case for example ${index + 1}`,
        });
        continue;
      }
      if (test.input.trim() !== example.input.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tests", index, "input"],
          message: `Test case ${index + 1} input must match example ${index + 1}`,
        });
      }
      if (test.output.trim() !== example.output.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tests", index, "output"],
          message: `Test case ${index + 1} output must match example ${index + 1}`,
        });
      }
      if (!test.explanation) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tests", index, "explanation"],
          message: `Provide an explanation for test case ${index + 1} (example ${index + 1})`,
        });
      }
    }
  });

export type CodeProblem = z.infer<typeof CodeProblemSchema>;
