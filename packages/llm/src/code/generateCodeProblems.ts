import { createRequire } from "node:module";
import path from "node:path";

import { Type, type Schema } from "@google/genai";
import { loadPyodide } from "pyodide";
import { z } from "zod";

import { errorAsString } from "../utils/error";

export const MAX_PROBLEM_ATTEMPTS = 3;
export const MAX_PROBLEM_GRADE_RETRIES = 2;
export const MAX_PROBLEM_SOLUTION_ATTEMPTS = 3;

const CodingProblemExampleSchema = z.object({
  input: z.string().trim().min(1),
  output: z.string().trim().min(1),
  explanation: z.string().trim().min(1).optional(),
});

const CodingProblemTestsSchema = z
  .object({
    public: z
      .array(
        z.object({
          input: z.string().trim().min(1),
          output: z.string().transform((value) => value.trim()),
        }),
      )
      .min(1),
    private: z
      .array(
        z.object({
          input: z.string().trim().min(1),
          output: z.string().transform((value) => value.trim()),
        }),
      )
      .min(1)
      .optional(),
    private_count: z.number().int().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const privateTests = Array.isArray(value.private) ? value.private : [];
    const hasPrivateList = privateTests.length > 0;
    if (!hasPrivateList && typeof value.private_count !== "number") {
      ctx.addIssue({
        code: "custom",
        path: ["private"],
        message: "Provide private tests or private_count",
      });
      return;
    }
    if (hasPrivateList && typeof value.private_count === "number") {
      const count = privateTests.length;
      if (value.private_count !== count) {
        ctx.addIssue({
          code: "custom",
          path: ["private_count"],
          message: `private_count ${value.private_count} must match private length ${count}`,
        });
      }
    }
  });

export const CodingProblemSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  difficulty: z.enum(["easy", "medium", "hard"]),
  story_callback: z.string().trim().min(1),
  statement_md: z.string().trim().min(1),
  input_format_md: z.string().trim().min(1),
  output_format_md: z.string().trim().min(1),
  constraints: z.array(z.string().trim().min(1)).min(1),
  examples: z.array(CodingProblemExampleSchema).min(1),
  edge_cases: z.array(z.string().trim().min(1)).min(1),
  hints: z.array(z.string().trim().min(1)).min(1),
  solution_overview_md: z.string().trim().min(1),
  reference_solution_py: z.string().trim().min(1),
  tests: CodingProblemTestsSchema,
});

export type CodingProblem = z.infer<typeof CodingProblemSchema>;

const ProblemPlanItemSchema = CodingProblemSchema.pick({
  id: true,
  title: true,
});

export type ProblemPlanItem = z.infer<typeof ProblemPlanItemSchema>;

export const ProblemPlanItemsSchema = z
  .array(ProblemPlanItemSchema)
  .superRefine((value, ctx) => {
    const seen = new Set<ProblemPlanItem["id"]>();
    value.forEach((problem, index) => {
      if (seen.has(problem.id)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: `duplicate problem id '${problem.id}'`,
        });
        return;
      }
      seen.add(problem.id);
    });
    if (seen.size === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["problems"],
        message: "problems must include at least one id",
      });
    }
  });

const ProblemsSchema = z.object({
  problems: z.array(CodingProblemSchema).superRefine((value, ctx) => {
    const ids = new Set<string>();
    for (const problem of value) {
      if (ids.has(problem.id)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate problem id '${problem.id}'`,
        });
      }
      ids.add(problem.id);
    }
    if (ids.size === 0) {
      ctx.addIssue({
        code: "custom",
        message: "problems must include at least one id",
      });
    }
  }),
});

export type ProblemsPayload = z.infer<typeof ProblemsSchema>;

export const ProblemsGradeSchema = z.object({
  pass: z.boolean(),
  issues: z.array(z.string().trim()).default([]),
  too_hard_reasons: z.array(z.string().trim()).default([]),
  misaligned_skills: z.array(z.string().trim()).default([]),
});

export type ProblemsGrade = z.infer<typeof ProblemsGradeSchema>;

const ProblemTechniqueSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  applies_to: z.array(z.string().trim().min(1)).min(1),
  tags: z.array(z.string().trim().min(1)).min(1),
});

export type ProblemTechnique = z.infer<typeof ProblemTechniqueSchema>;

export const ProblemTechniquesSchema = z.object({
  topic: z.string().trim().min(1),
  techniques: z.array(ProblemTechniqueSchema).min(1),
});

export type ProblemTechniquesPayload = z.infer<typeof ProblemTechniquesSchema>;

export function buildProblemTechniquesUserPrompt(
  plan: {
    topic: string;
    promised_skills: string[];
    concepts_to_teach: string[];
    coding_blueprints: { id: string; required_skills: string[] }[];
  },
  lessonBrief?: string,
): string {
  const parts = [`Topic: "${plan.topic}"`];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  parts.push(
    "",
    "Extract the problem-solving techniques needed to solve the coding problems implied by the coding_blueprints.",
    "Techniques include algorithms, patterns, invariants, decomposition steps, edge-case handling, math shortcuts, and data structure choices. Keep them aligned to the plan difficulty and promised skills; avoid advanced or unseen topics.",
    "Treat modulo (%) as an operator-only assumption; if a problem relies on modular arithmetic properties (cycles, congruence, divisibility), include those explicitly as techniques with brief reminders.",
    "Include preconditions and failure modes (when the technique does NOT apply), and highlight common misconceptions to guard against. Identify which techniques are unique to later problems vs shared with earlier ones. If any technique uses randomness or probabilistic testing, specify how to make it reproducible (fixed seeds, deterministic base sets) for solutions/tests.",
    'Return JSON {topic, techniques:[{id,title,summary,applies_to:["problem_id"],tags[]}]} where:',
    "- ids are short stable tokens (e.g., t1, t2, t3);",
    "- summary explains why the technique matters and the maneuver to apply;",
    "- applies_to lists which problem(s) require it (use coding_blueprints ids);",
    "- tags reference promised_skills or concepts_to_teach that match the technique.",
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
  );
  return parts.join("\n");
}

export function buildProblemIdeasUserPrompt(
  plan: {
    topic: string;
    difficulty: "easy" | "medium" | "hard";
    coding_blueprints: {
      id: string;
      title: string;
      required_skills: string[];
    }[];
  },
  techniques: readonly ProblemTechnique[],
  seed?: number,
  lessonBrief?: string,
): string {
  const parts = [`Topic: "${plan.topic}"`, `Seed: ${seed ?? "none"}`];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  const problemIds = plan.coding_blueprints.map((blueprint) => blueprint.id);
  const techniquesByProblem = new Map<
    string,
    Array<{ id: string; title: string }>
  >();
  for (const technique of techniques) {
    for (const problemId of technique.applies_to) {
      const list = techniquesByProblem.get(problemId) ?? [];
      list.push({ id: technique.id, title: technique.title });
      techniquesByProblem.set(problemId, list);
    }
  }
  const allowedTechniqueLines = problemIds.map((problemId) => {
    const allowed = techniquesByProblem.get(problemId) ?? [];
    if (allowed.length === 0) {
      return `- ${problemId}: (none listed)`;
    }
    return `- ${problemId}: ${allowed
      .map((technique) => `${technique.id} (${technique.title})`)
      .join(", ")}`;
  });
  parts.push(
    "",
    `Return "Problem Specs Markdown" with ${problemIds.length} sections titled: ${problemIds.map((id) => `"### ${id}"`).join(", ")}.`,
    "Each section must contain the FULL problem spec (no JSON) with these labeled fields in order:",
    "- Title:",
    "- Difficulty: (easy|medium|hard)",
    "- Story callback:",
    "- Statement:",
    "- Input format:",
    "- Output format:",
    "- Constraints:",
    "- Examples: (at least two; include stdin input, stdout output, and optional explanation)",
    "- Edge cases:",
    "- Hints:",
    "- Solution overview:",
    "- Reference solution (Python 3 program in a code block; read stdin, print stdout):",
    "- Public tests: list as stdin => stdout (use 3-5 cases unless the lesson brief specifies a different count or a fixed marking list).",
    "- Private tests: list as stdin => stdout (use 3-8 cases unless the lesson brief specifies otherwise; if the brief provides a marking list, include the remaining marking cases here in the same order).",
    "Input/Output style rules:",
    "- Inputs must be plain text, consisting of 1+ lines; tokens are separated by whitespace (spaces/newlines).",
    "- Do NOT use JSON, Python literals (e.g. [1,2], {'a':1}), or any structured encoding that requires complex parsing.",
    "- Outputs must be plain text exactly as printed to stdout (no extra labels or prompts).",
    '- Unless the lesson brief explicitly requires a structured format, outputs must be 1+ lines of whitespace-separated tokens only; never use list/tuple/dict literals, brackets, commas, or JSON (e.g., "[1, 2, 3]").',
    "- The problem must be posed as a stdin/stdout program (competitive programming style). Do NOT ask for a function signature or return values.",
    "Generate and VERIFY all examples and public/private tests against the reference solution using the code execution tool (run the program with each test input as stdin and compare stdout); fix the spec until they pass.",
    "If the lesson brief supplies a marking or official test list, use those cases exactly (no additions, no removals) and preserve their order.",
    "Spell out boundary behaviors so tests cannot imply hidden rules (e.g., whether a Rosette on the final index grants another turn, or how off-board moves behave) and ensure the reference solution matches that rule exactly.",
    "If any test fails when executed against the reference solution, revise the test/spec/solution until they are consistent—never return a failing test.",
    "Each problem must be clearly different from the others; later problems must introduce at least one additional technique beyond earlier ones (not a trivial re-skin).",
    "Explicitly call out any preconditions/limitations/pitfalls inside the Statement, Constraints, or Hints (e.g., one-way heuristics, coprime requirements, recurrence break cases, reproducibility if randomness is involved).",
    "Avoid non-deterministic behavior; if sampling is needed, include a seed or fixed witness list so tests are stable.",
    "Avoid advanced structures unless declared; stay within the provided techniques per problem id.",
    "STRICT technique compliance:",
    "- Use ONLY the techniques listed for that problem id. Do not introduce unlisted optimizations, data structures, or counting shortcuts even if they seem helpful.",
    "- If you find yourself relying on a technique not listed for the problem, revise the problem constraints or approach so only the listed techniques are required.",
    "- Make sure every hint and the solution overview reference only the allowed techniques for that problem.",
    "- If a problem needs “up to length” counts, summing over lengths directly is acceptable; do NOT introduce a separate cumulative-sum table unless that specific technique appears in the allowed list.",
    "Allowed techniques by problem id:",
    ...allowedTechniqueLines,
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify({ topic: plan.topic, techniques }, null, 2),
    "",
    "REMEMBER: Use code execution tool run reference solution agains EACH of public and EACH of private tests and MAKE SURE THEY PASS.",
    "CRITICAL: problem and solution and tests should be CONSISTENT in that solution should solve the problem and all tests SHOULD PASS",
  );
  return parts.join("\n");
}

export function buildProblemsGenerateUserPrompt(
  plan: object,
  problemIdeasMarkdown: string,
  lessonBrief?: string,
): string {
  const planIds = Array.isArray(
    (plan as { coding_blueprints?: { id?: string }[] }).coding_blueprints,
  )
    ? (plan as { coding_blueprints: { id?: string }[] }).coding_blueprints
        .map((blueprint) => blueprint.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const idsLabel =
    planIds.length > 0
      ? planIds.join(", ")
      : "Use the problem ids found in the Markdown sections.";
  const parts: string[] = [
    `Transcribe the "Problem Specs Markdown" below into a JSON object with key "problems" whose value is an array with one entry per section (ids: ${idsLabel}).`,
    "This is a STRICT transcription task: copy content verbatim from the markdown. Do NOT invent, summarize, or paraphrase.",
    "Output MUST include exactly these ids in this order: " +
      (planIds.length > 0 ? planIds.join(", ") : idsLabel) +
      ". No extra or missing ids.",
    "Each problem must include fields: id, title, difficulty (easy|medium|hard), story_callback, statement_md, input_format_md, output_format_md, constraints (string[]), examples (array of {input:string, output:string, explanation?}), edge_cases (string[]), hints (string[]), solution_overview_md, reference_solution_py, tests {public:[{input:string, output:string}], private:[{input:string, output:string}], private_count:int}.",
    "Map Statement => statement_md, Input format => input_format_md, Output format => output_format_md.",
    "Use the exact text from the markdown sections. If the markdown has code fences, remove the ``` markers and keep only the code content.",
    "Preserve inputs/outputs verbatim (escape newlines with \\n).",
    "Input/Output style rules:",
    "- tests.*.input and examples.*.input are stdin text (1+ lines, whitespace-separated tokens); do not encode JSON or Python literals.",
    "- tests.*.output and examples.*.output are exact stdout text; no extra prompts or labels.",
    "Do not re-run or change tests; just transcribe them into JSON. If something appears malformed, choose the most literal faithful transcription rather than patching logic.",
    "Do not include backslash-based notation (no LaTeX like \\ge or ad-hoc escapes inside prose); write comparisons and symbols in plain words. Only use backslashes for JSON newlines (\\\\n) where needed.",
    "Forbidden placeholders: do NOT output '-', '—', 'TBD', 'N/A', '...', or empty strings. Every field must contain real content copied from the markdown.",
    "Keep problem ids unique and map each spec to its matching id; do not swap or merge content.",
    'Do not include extra fields such as "prompt", "solution", or "private_tests". Do not wrap the JSON in Markdown fences or add commentary.',
  ];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  parts.push(
    "Problem Specs Markdown:",
    problemIdeasMarkdown,
  );
  return parts.join("\n");
}

export function buildProblemsGradeUserPrompt(
  plan: object,
  problems: readonly CodingProblem[],
  techniques: readonly ProblemTechnique[],
  lessonBrief?: string,
): string {
  const parts: string[] = [
    "Check each problem is easy, specs precise, skills aligned, reference solutions correct.",
    "Fail if any pair of problems is not meaningfully different (no reused statements, tests, or I/O goals).",
    "Fail if problems rely on techniques not listed for their applies_to ids or introduce advanced concepts absent from assumptions/techniques.",
    "Fail if the statement expects a function signature/return value instead of stdin/stdout program behavior.",
    "Fail if the input/output style requires complex parsing (JSON, Python literals, nested structured encodings) instead of simple whitespace tokenization.",
    "Fail if any example/test output uses serialized lists/tuples/dicts or JSON (brackets/commas) unless the lesson brief explicitly requires that exact format.",
    "Output {pass:boolean, issues:string[], too_hard_reasons:string[], misaligned_skills:string[]} JSON only.",
  ];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  parts.push(
    "",
    "Plan JSON:",
    JSON.stringify(plan, null, 2),
    "",
    "Problem Techniques JSON:",
    JSON.stringify(
      { topic: (plan as { topic?: string }).topic, techniques },
      null,
      2,
    ),
    "",
    "Problems JSON:",
    JSON.stringify(problems, null, 2),
  );
  return parts.join("\n");
}

export function buildProblemSolutionUserPrompt(problem: CodingProblem): string {
  const examples = problem.examples
    .map((example, index) => {
      const parts = [
        `Example ${index + 1}:`,
        `Input (stdin): ${example.input}`,
        `Output (stdout): ${example.output}`,
      ];
      if (example.explanation) {
        parts.push(`Explanation: ${example.explanation}`);
      }
      return parts.join("\n");
    })
    .join("\n\n");

  const constraints =
    problem.constraints.length > 0
      ? problem.constraints.map((constraint) => `- ${constraint}`).join("\n")
      : "None provided";
  const edgeCases =
    problem.edge_cases.length > 0
      ? problem.edge_cases.map((edge) => `- ${edge}`).join("\n")
      : "None provided";

  return [
    `Problem ID: ${problem.id} — ${problem.title}`,
    "",
    "Write a correct Python 3 solution using ONLY the statement and examples below.",
    "Write a complete program: read from stdin, write to stdout (no prompts / extra text).",
    "Input parsing must be simple BIO-style: 1+ lines of plain text; tokens are separated by whitespace. Use sys.stdin.read().split() or sys.stdin.readline().split() as appropriate.",
    "Use the code execution tool to verify your program against the examples (feed the example input on stdin and check stdout). If any example fails, fix the code and re-run until it passes.",
    "Respond in plain text, wrapping only the final code in <CODE>...</CODE> tags. Do not return JSON, markdown fences, or any other text.",
    "",
    "Problem statement:",
    problem.statement_md,
    "",
    "Input format:",
    problem.input_format_md,
    "",
    "Output format:",
    problem.output_format_md,
    "",
    "Constraints:",
    constraints,
    "",
    "Edge cases to consider:",
    edgeCases,
    "",
    "Examples:",
    examples,
  ].join("\n");
}

export const PROBLEM_TECHNIQUES_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["topic", "techniques"],
  propertyOrdering: ["topic", "techniques"],
  properties: {
    topic: { type: Type.STRING, minLength: "1" },
    techniques: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.OBJECT,
        required: ["id", "title", "summary", "applies_to", "tags"],
        propertyOrdering: ["id", "title", "summary", "applies_to", "tags"],
        properties: {
          id: { type: Type.STRING, minLength: "1" },
          title: { type: Type.STRING, minLength: "1" },
          summary: { type: Type.STRING, minLength: "1" },
          applies_to: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          tags: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
        },
      },
    },
  },
};

export const PROBLEMS_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["pass", "issues", "too_hard_reasons", "misaligned_skills"],
  properties: {
    pass: { type: Type.BOOLEAN },
    issues: { type: Type.ARRAY, items: { type: Type.STRING } },
    too_hard_reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
    misaligned_skills: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
};

export const CODING_PROBLEM_EXAMPLE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["input", "output"],
  propertyOrdering: ["input", "output", "explanation"],
  properties: {
    input: { type: Type.STRING, minLength: "1" },
    output: { type: Type.STRING, minLength: "1" },
    explanation: { type: Type.STRING, minLength: "1" },
  },
};

export const CODING_PROBLEM_TEST_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["input", "output"],
  propertyOrdering: ["input", "output"],
  properties: {
    input: { type: Type.STRING, minLength: "1" },
    output: { type: Type.STRING },
  },
};

export const CODING_PROBLEM_TESTS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["public"],
  propertyOrdering: ["public", "private", "private_count"],
  properties: {
    public: {
      type: Type.ARRAY,
      minItems: "1",
      items: CODING_PROBLEM_TEST_RESPONSE_SCHEMA,
    },
    private: {
      type: Type.ARRAY,
      items: CODING_PROBLEM_TEST_RESPONSE_SCHEMA,
    },
    private_count: { type: Type.INTEGER, minimum: 1 },
  },
};

export const PROBLEMS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["problems"],
  propertyOrdering: ["problems"],
  properties: {
    problems: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.OBJECT,
        required: [
          "id",
          "title",
          "difficulty",
          "story_callback",
          "statement_md",
          "input_format_md",
          "output_format_md",
          "constraints",
          "examples",
          "edge_cases",
          "hints",
          "solution_overview_md",
          "reference_solution_py",
          "tests",
        ],
        propertyOrdering: [
          "id",
          "title",
          "difficulty",
          "story_callback",
          "statement_md",
          "input_format_md",
          "output_format_md",
          "constraints",
          "examples",
          "edge_cases",
          "hints",
          "solution_overview_md",
          "reference_solution_py",
          "tests",
        ],
        properties: {
          id: { type: Type.STRING, minLength: "1" },
          title: { type: Type.STRING, minLength: "1" },
          difficulty: {
            type: Type.STRING,
            enum: ["easy", "medium", "hard"],
          },
          story_callback: { type: Type.STRING, minLength: "1" },
          statement_md: { type: Type.STRING, minLength: "1" },
          input_format_md: { type: Type.STRING, minLength: "1" },
          output_format_md: { type: Type.STRING, minLength: "1" },
          constraints: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          examples: {
            type: Type.ARRAY,
            minItems: "1",
            items: CODING_PROBLEM_EXAMPLE_RESPONSE_SCHEMA,
          },
          edge_cases: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          hints: {
            type: Type.ARRAY,
            minItems: "1",
            items: { type: Type.STRING, minLength: "1" },
          },
          solution_overview_md: { type: Type.STRING, minLength: "1" },
          reference_solution_py: { type: Type.STRING, minLength: "1" },
          tests: CODING_PROBLEM_TESTS_RESPONSE_SCHEMA,
        },
      },
    },
  },
};

const ProblemSolutionEntrySchema = z.object({
  id: z.string().trim().min(1),
  solution_py: z.string().trim().min(1),
});

export const ProblemSolutionsSchema = z
  .object({
    topic: z.string().trim().min(1),
    solutions: z.array(ProblemSolutionEntrySchema).min(1),
  })
  .superRefine((data, ctx) => {
    const ids = new Set(data.solutions.map((solution) => solution.id));
    if (ids.size !== data.solutions.length) {
      ctx.addIssue({
        code: "custom",
        message: "solutions contain duplicate ids",
      });
    }
    if (ids.size === 0) {
      ctx.addIssue({
        code: "custom",
        message: "solutions must include at least one id",
      });
    }
  });

export type ProblemSolutions = z.infer<typeof ProblemSolutionsSchema>;

export function normaliseProblemsPayload(payload: unknown): unknown {
  if (
    !payload ||
    typeof payload !== "object" ||
    payload === null ||
    !("problems" in payload) ||
    !Array.isArray((payload as { problems?: unknown[] }).problems)
  ) {
    return payload;
  }

  const original = payload as { problems: unknown[] };
  const normalisedProblems = original.problems.map((problem) => {
    if (!problem || typeof problem !== "object" || problem === null) {
      return problem;
    }
    const record = problem as Record<string, unknown>;
    const tests = record.tests;
    if (
      !tests ||
      typeof tests !== "object" ||
      tests === null ||
      !("private" in tests) ||
      !Array.isArray((tests as { private?: unknown[] }).private)
    ) {
      return problem;
    }

    const privateTests = (tests as { private: unknown[] }).private;
    const privateCountRaw = (tests as { private_count?: unknown })
      .private_count;
    const privateCount = Number.isFinite(privateCountRaw as number)
      ? (privateCountRaw as number)
      : privateTests.length;

    return {
      ...record,
      tests: {
        ...(tests as Record<string, unknown>),
        private_count: privateCount,
      },
    };
  });

  return {
    ...(payload as Record<string, unknown>),
    problems: normalisedProblems,
  };
}

type MutableGlobal = typeof globalThis & {
  location?: { href: string };
  self?: typeof globalThis;
};

const PYODIDE_VERSION = "0.28.3";
const require = createRequire(import.meta.url);
const PYODIDE_PACKAGE_JSON_PATH = require.resolve("pyodide/package.json");
const PYODIDE_BASE_DIR = path.dirname(PYODIDE_PACKAGE_JSON_PATH);
const LOCAL_PYTHON_INDEX_URL = path.join(PYODIDE_BASE_DIR, path.sep);
const CDN_PYTHON_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const DEFAULT_PYTHON_INDEX_URL = LOCAL_PYTHON_INDEX_URL;

function resolvePythonIndexUrl(explicit?: string): string {
  const fromEnv =
    process.env.PYODIDE_INDEX_URL ??
    process.env.PYODIDE_BASE_URL ??
    process.env.PYTHON_RUNTIME_INDEX_URL;
  const candidates = [
    explicit,
    fromEnv,
    DEFAULT_PYTHON_INDEX_URL,
    CDN_PYTHON_INDEX_URL,
  ].filter((value): value is string =>
    Boolean(value && value.trim().length > 0),
  );

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("file://")
    ) {
      return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    }
    if (trimmed.endsWith(path.sep)) {
      return trimmed;
    }
    return `${trimmed}${path.sep}`;
  }

  return CDN_PYTHON_INDEX_URL;
}

function ensurePythonEnvironment(indexURL: string): void {
  const globalObject = globalThis as MutableGlobal;
  if (!globalObject.location) {
    globalObject.location = { href: indexURL } as unknown as Location;
  } else if (!globalObject.location.href) {
    globalObject.location.href = indexURL;
  }
  if (!globalObject.self) {
    globalObject.self = globalThis as unknown as Window & typeof globalThis;
  }
}

let pythonRuntimePromise: ReturnType<typeof loadPyodide> | null = null;

async function ensurePythonRuntime(indexURL?: string) {
  if (!pythonRuntimePromise) {
    const resolvedIndex = resolvePythonIndexUrl(indexURL);
    ensurePythonEnvironment(resolvedIndex);
    pythonRuntimePromise = loadPyodide({ indexURL: resolvedIndex });
  }
  return pythonRuntimePromise;
}

type SolutionTestFailure = {
  index: number;
  message: string;
};

export async function runSolutionAgainstTests(
  problem: CodingProblem,
  solutionSource: string,
  indexURL?: string,
): Promise<SolutionTestFailure[]> {
  const python = await ensurePythonRuntime(indexURL);
  const testsJson = JSON.stringify([
    ...problem.tests.public,
    ...(problem.tests.private ?? []),
  ]);
  const script = [
    "import json",
    "import io",
    "import sys",
    `tests = json.loads(${JSON.stringify(testsJson)})`,
    `solution_source = ${JSON.stringify(solutionSource)}`,
    "failures = []",
    "def normalize(text: str) -> str:",
    "    return str(text).replace('\\r\\n', '\\n').replace('\\r', '\\n').rstrip()",
    "for index, test in enumerate(tests):",
    "    stdin_text = str(test.get('input', ''))",
    "    expected = str(test.get('output', ''))",
    "    global_env = {'__name__': '__main__'}",
    "    buffer_in = io.StringIO(stdin_text)",
    "    buffer_out = io.StringIO()",
    "    original_stdin = sys.stdin",
    "    original_stdout = sys.stdout",
    "    try:",
    "        sys.stdin = buffer_in",
    "        sys.stdout = buffer_out",
    "        exec(solution_source, global_env)",
    "    except Exception as exc:",
    "        failures.append({'index': index, 'message': f'{type(exc).__name__}: {exc}'})",
    "        continue",
    "    finally:",
    "        sys.stdin = original_stdin",
    "        sys.stdout = original_stdout",
    "    actual = buffer_out.getvalue()",
    "    if normalize(actual) != normalize(expected):",
    "        failures.append({'index': index, 'message': f'expected {repr(normalize(expected))} but got {repr(normalize(actual))}'})",
    "",
    "json.dumps({'failures': failures})",
  ].join("\n");

  try {
    const result: unknown = await python.runPythonAsync(script);
    if (typeof result === "string") {
      const parsed: unknown = JSON.parse(result);
      if (
        parsed &&
        typeof parsed === "object" &&
        "failures" in parsed &&
        Array.isArray((parsed as { failures?: unknown }).failures)
      ) {
        return (parsed as { failures?: SolutionTestFailure[] }).failures ?? [];
      }
    }
    return [];
  } catch (error) {
    return [{ index: -1, message: errorAsString(error) }];
  }
}

export function extractPythonCode(text: string): string {
  const tagged = text.match(/<CODE>([\s\S]*?)<\/CODE>/i);
  if (tagged && tagged[1]) {
    return tagged[1].trim();
  }
  const fenced =
    text.match(/```python\s*([\s\S]*?)```/i) ?? text.match(/```([\s\S]*?)```/);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  return text.trim();
}

export { ProblemsSchema };
