import { Type, type Schema } from "@google/genai";
import {
  CodeProblemSchema,
  QuizDefinitionSchema,
  type PlanItem,
  type CodeProblem,
  type QuizFeedback,
  type QuizDefinition,
} from "@spark/schemas";
import { z } from "zod";

import { generateJson } from "../utils/llm";
import {
  ProblemPlanItemsSchema,
  type CodingProblem,
  type GenerateSessionResult,
  type SessionPlan,
  type SessionQuiz,
} from "./generateSession";

const TEXT_MODEL_ID = "gemini-3-pro-preview" as const;

const SessionMetadataSchema = z.object({
  tagline: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

const QuizDefinitionsPayloadSchema = z.object({
  quizzes: z.array(QuizDefinitionSchema),
});

const QUIZ_FEEDBACK_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["message"],
  properties: {
    message: { type: Type.STRING, minLength: "1" },
    tone: { type: Type.STRING, enum: ["info", "success", "warning"] },
    heading: { type: Type.STRING },
  },
};

const QUIZ_OPTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["id", "label", "text"],
  properties: {
    id: { type: Type.STRING, minLength: "1" },
    label: { type: Type.STRING, minLength: "1" },
    text: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_QUESTION_BASE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["id", "prompt"],
  properties: {
    id: { type: Type.STRING, minLength: "1" },
    prompt: { type: Type.STRING, minLength: "1" },
    explanation: { type: Type.STRING },
    hint: { type: Type.STRING },
  },
};

const QUIZ_QUESTION_MCQ_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "kind",
    "id",
    "prompt",
    "options",
    "correctOptionId",
    "correctFeedback",
  ],
  properties: {
    kind: { type: Type.STRING, enum: ["multiple-choice"] },
    ...QUIZ_QUESTION_BASE_RESPONSE_SCHEMA.properties,
    options: {
      type: Type.ARRAY,
      minItems: "2",
      items: QUIZ_OPTION_RESPONSE_SCHEMA,
    },
    correctOptionId: { type: Type.STRING, minLength: "1" },
    correctFeedback: QUIZ_FEEDBACK_RESPONSE_SCHEMA,
  },
};

const QUIZ_QUESTION_TYPE_ANSWER_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["kind", "id", "prompt", "answer"],
  properties: {
    kind: { type: Type.STRING, enum: ["type-answer"] },
    ...QUIZ_QUESTION_BASE_RESPONSE_SCHEMA.properties,
    answer: { type: Type.STRING, minLength: "1" },
    acceptableAnswers: {
      type: Type.ARRAY,
      items: { type: Type.STRING, minLength: "1" },
    },
  },
};

const QUIZ_QUESTION_INFO_CARD_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["kind", "id", "prompt", "body"],
  properties: {
    kind: { type: Type.STRING, enum: ["info-card"] },
    ...QUIZ_QUESTION_BASE_RESPONSE_SCHEMA.properties,
    body: { type: Type.STRING, minLength: "1" },
  },
};

const QUIZ_DEFINITIONS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["quizzes"],
  properties: {
    quizzes: {
      type: Type.ARRAY,
      minItems: "1",
      items: {
        type: Type.OBJECT,
        required: ["id", "title", "description", "progressKey", "questions"],
        properties: {
          id: { type: Type.STRING, minLength: "1" },
          title: { type: Type.STRING, minLength: "1" },
          description: { type: Type.STRING, minLength: "1" },
          topic: { type: Type.STRING },
          estimatedMinutes: { type: Type.NUMBER },
          progressKey: { type: Type.STRING, minLength: "1" },
          questions: {
            type: Type.ARRAY,
            minItems: "1",
            items: {
              anyOf: [
                QUIZ_QUESTION_MCQ_RESPONSE_SCHEMA,
                QUIZ_QUESTION_TYPE_ANSWER_RESPONSE_SCHEMA,
                QUIZ_QUESTION_INFO_CARD_RESPONSE_SCHEMA,
              ],
            },
          },
        },
      },
    },
  },
};

const CODE_PROBLEM_EXAMPLE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["title", "input", "output", "explanation"],
  properties: {
    title: { type: Type.STRING, minLength: "1" },
    input: { type: Type.STRING, minLength: "1" },
    output: { type: Type.STRING, minLength: "1" },
    explanation: { type: Type.STRING, minLength: "1" },
  },
};

const CODE_PROBLEM_TEST_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["input", "output", "explanation"],
  properties: {
    input: { type: Type.STRING, minLength: "1" },
    output: { type: Type.STRING, minLength: "1" },
    explanation: { type: Type.STRING, minLength: "1" },
  },
};

const CODE_PROBLEM_SOLUTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["language", "code"],
  properties: {
    language: { type: Type.STRING, enum: ["python"] },
    code: { type: Type.STRING, minLength: "1" },
  },
};

const CODE_PROBLEM_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: [
    "slug",
    "title",
    "topics",
    "difficulty",
    "description",
    "inputFormat",
    "constraints",
    "examples",
    "tests",
    "hints",
    "solution",
    "metadataVersion",
  ],
  properties: {
    slug: { type: Type.STRING, minLength: "1" },
    title: { type: Type.STRING, minLength: "1" },
    topics: {
      type: Type.ARRAY,
      minItems: "1",
      items: { type: Type.STRING, minLength: "1" },
    },
    difficulty: {
      type: Type.STRING,
      enum: ["warmup", "intro", "easy", "medium", "hard"],
    },
    description: { type: Type.STRING, minLength: "1" },
    inputFormat: { type: Type.STRING, minLength: "1" },
    constraints: {
      type: Type.ARRAY,
      minItems: "1",
      items: { type: Type.STRING, minLength: "1" },
    },
    examples: {
      type: Type.ARRAY,
      minItems: "3",
      maxItems: "3",
      items: CODE_PROBLEM_EXAMPLE_RESPONSE_SCHEMA,
    },
    tests: {
      type: Type.ARRAY,
      minItems: "10",
      maxItems: "25",
      items: CODE_PROBLEM_TEST_RESPONSE_SCHEMA,
    },
    hints: {
      type: Type.ARRAY,
      minItems: "3",
      maxItems: "3",
      items: { type: Type.STRING, minLength: "1" },
    },
    solution: CODE_PROBLEM_SOLUTION_RESPONSE_SCHEMA,
    metadataVersion: { type: Type.NUMBER },
  },
};

const CodeProblemsPayloadSchema = z.object({
  problems: z.array(CodeProblemSchema),
});

const CODE_PROBLEMS_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["problems"],
  properties: {
    problems: {
      type: Type.ARRAY,
      minItems: "2",
      maxItems: "2",
      items: CODE_PROBLEM_RESPONSE_SCHEMA,
    },
  },
};

const SESSION_METADATA_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["tagline", "emoji", "summary"],
  properties: {
    tagline: { type: Type.STRING },
    emoji: { type: Type.STRING },
    summary: { type: Type.STRING },
  },
};

function buildQuizDefinitionsPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
  lessonBrief?: string,
): string {
  const quizCount = quizzes.length;
  const parts: string[] = [
    "Convert the session quizzes into Spark quiz definitions for the learner dashboard.",
    `Return exactly ${quizCount} quiz objects (same order as provided) and nothing else.`,
    "Use only supported kinds: multiple-choice, type-answer, or an optional info-card primer when introducing a new concept.",
    "Each quiz should have 4-5 concise questions with short explanations; include correctFeedback (heading/message) for graded questions and keep it friendly and brief.",
    "Every graded question MUST include a short hint and a short explanation (1-2 sentences each). Do not omit these fields or leave them blank.",
    "Multiple-choice options need ids/labels (A, B, C, ...), text, and correctOptionId; type-answer uses answer plus optional acceptableAnswers.",
    "Keep prompts short, avoid jargon, and stick to the promised skills.",
    "Populate every required field; never emit empty objects or empty strings. Every quiz must include a non-empty description and progressKey.",
    "IDs must be stable slugs (reuse any ids in the draft input when present). Titles must be non-empty. Each quiz requires at least one question.",
    "JSON schema (informal): { quizzes: [ { id, title, description, progressKey, topic?, estimatedMinutes?, questions: [ { kind: 'multiple-choice' | 'type-answer' | 'info-card', id, prompt, hint (required for graded), explanation (required for graded), correctFeedback? (for graded kinds), options/answer/body depending on kind } ] } ] }",
    "If you are unsure about any field, copy the draft value instead of leaving it blank, and still provide a helpful hint/explanation.",
    'Sample shape (do NOT copy text, just the structure): {"quizzes":[{"id":"intro","title":"Starter Quiz","questions":[{"id":"intro_q1","kind":"multiple-choice","prompt":"...","options":[{"id":"A","label":"A","text":"..."},{"id":"B","label":"B","text":"..."}],"correctOptionId":"A","correctFeedback":{"heading":"Nice!","message":"Short friendly note"},"explanation":"One-line why"}]}]}',
  ];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  parts.push(
    "",
    `Topic: "${plan.topic}" (story topic: "${plan.story.storyTopic}")`,
    "Promised skills:",
    plan.promised_skills.map((skill) => `- ${skill}`).join("\\n"),
    "",
    "Plan parts:",
    plan.parts.map((part) => `- ${part.kind}: ${part.summary}`).join("\\n"),
    "",
    "Draft quizzes JSON:",
    JSON.stringify(quizzes, null, 2),
  );
  return parts.join("\\n");
}

function repairQuizzesJson(rawText: string): { quizzes: QuizDefinition[] } {
  const parseJson = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start !== -1 && end !== -1 && end > start) {
        return JSON.parse(text.slice(start, end + 1));
      }
      throw new Error("could not parse JSON for repair");
    }
  };

  const asString = (value: unknown, fallback?: string): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value : fallback;

  const asNumber = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

  const asArray = <T>(value: unknown): T[] =>
    Array.isArray(value) ? (value as T[]) : [];

  const json = parseJson(rawText);
  if (!json || typeof json !== "object" || !("quizzes" in json)) {
    throw new Error("parsed JSON missing quizzes");
  }

  const rawQuizzes = asArray<unknown>((json as { quizzes: unknown }).quizzes);

  const repaired: QuizDefinition[] = rawSubsectionsToQuizzes(
    rawQuizzes,
    asString,
    asNumber,
    asArray,
  );

  return { quizzes: repaired };
}

function rawSubsectionsToQuizzes(
  rawQuizzes: unknown[],
  asString: (value: unknown, fallback?: string) => string | undefined,
  asNumber: (value: unknown) => number | undefined,
  asArray: <T>(value: unknown) => T[],
): QuizDefinition[] {
  return rawQuizzes.map((rawQuiz, quizIndex): QuizDefinition => {
    const q =
      rawQuiz && typeof rawQuiz === "object"
        ? (rawQuiz as Record<string, unknown>)
        : {};
    const id = asString(q.id, `quiz_${quizIndex + 1}`)!;
    const title = asString(q.title, `Quiz ${quizIndex + 1}`)!;
    const description = asString(q.description);
    const topic = asString(q.topic);
    const estimatedMinutes = asNumber(q.estimatedMinutes);
    const progressKey = asString(q.progressKey);
    const rawQuestions = asArray<unknown>(q.questions);

    const questions = rawQuestions.map(
      (rawQuestion, questionIndex): QuizDefinition["questions"][number] => {
        const rq =
          rawQuestion && typeof rawQuestion === "object"
            ? (rawQuestion as Record<string, unknown>)
            : {};
        const kind = (asString(rq.kind, "multiple-choice") ??
          "multiple-choice") as QuizDefinition["questions"][number]["kind"];
        const questionId =
          asString(
            rq.id,
            `${id}_${kind.replace(/[^a-z0-9]+/gi, "_")}_${questionIndex + 1}`,
          ) ?? `q_${questionIndex + 1}`;
        const prompt = asString(rq.prompt, "Edit to add prompt")!;
        const hint =
          asString(rq.hint) ??
          "Hint: use the main concept from this lesson to narrow the choices.";
        const explanation =
          asString(rq.explanation) ??
          "The correct answer follows directly from the key idea in the prompt.";

        if (kind === "info-card") {
          const body = asString(rq.body, explanation ?? "Concept primer")!;
          return { kind, id: questionId, prompt, body, hint, explanation };
        }

        if (kind === "type-answer") {
          const answer = asString(rq.answer, "TODO")!;
          const acceptableAnswers = asArray<string>(rq.acceptableAnswers).map(
            (value) => value ?? "",
          );
          const feedback = (() => {
            const rf =
              rq.correctFeedback && typeof rq.correctFeedback === "object"
                ? (rq.correctFeedback as Record<string, unknown>)
                : undefined;
            const message = asString(rf?.message) ?? "Well done.";
            const tone = asString(rf?.tone) as QuizFeedback["tone"];
            const heading = asString(rf?.heading);
            return {
              message,
              tone,
              heading,
            };
          })();
          return {
            kind,
            id: questionId,
            prompt,
            answer,
            acceptableAnswers,
            hint,
            explanation,
            correctFeedback: feedback,
          };
        }

        const options = asArray<unknown>(rq.options).map(
          (option, optionIndex) => {
            const ro =
              option && typeof option === "object"
                ? (option as Record<string, unknown>)
                : {};
            return {
              id: asString(ro.id, String.fromCharCode(65 + optionIndex))!,
              label: asString(ro.label, String.fromCharCode(65 + optionIndex))!,
              text: asString(
                ro.text,
                (ro.id as string | undefined) ?? "Option",
              )!,
            };
          },
        );

        const correctFeedback = (() => {
          const rf =
            rq.correctFeedback && typeof rq.correctFeedback === "object"
              ? (rq.correctFeedback as Record<string, unknown>)
              : undefined;
          const message = asString(rf?.message) ?? "Great work!";
          const tone = asString(rf?.tone) as QuizFeedback["tone"];
          const heading = asString(rf?.heading);
          return {
            message,
            tone,
            heading,
          };
        })();

        return {
          kind: "multiple-choice",
          id: questionId,
          prompt,
          hint,
          explanation,
          options,
          correctOptionId: asString(rq.correctOptionId, options[0]?.id ?? "A")!,
          correctFeedback,
        };
      },
    );

    return QuizDefinitionSchema.parse({
      id,
      title,
      description,
      topic,
      estimatedMinutes,
      progressKey,
      questions,
    });
  });
}

function buildCodeProblemsPrompt(
  plan: SessionPlan,
  problems: readonly CodingProblem[],
  lessonBrief?: string,
): string {
  const parts: string[] = [
    "Convert these two draft coding problems into Spark CodeProblem JSON (array with problems).",
    "",
    "Output must match the Spark CodeProblemSchema exactly. REQUIRED fields and types:",
    "- slug: string (use 'p1' and 'p2' respectively; do not invent other slugs)",
    "- title: string",
    "- topics: string[] (2-4 concise topics)",
    '- difficulty: "warmup" | "intro" | "easy" | "medium" | "hard" (use "easy" or "medium" here as appropriate)',
    "- description: markdown string (problem statement)",
    "- inputFormat: markdown string",
    "- constraints: string[] (plain bullet strings)",
    "- examples: exactly 3 items, each with { title, input, output, explanation }",
    "- tests: 10-14 items, each with { input, output, explanation }; tests[0-2] must MATCH examples[0-2] exactly",
    "- hints: exactly 3 markdown strings, ordered",
    '- solution: { language: "python", code: string } (full reference solution)',
    "- metadataVersion: 1",
    "",
    "STRICT rules:",
    "- Do NOT include fields like statement_md, function, edge_cases, or tests.public/private; only the fields listed above.",
    "- Keep inputs/outputs as plain text (no code fences).",
    "- Keep code in Python 3; no type hints needed beyond the code block itself.",
    "- The solution must be a complete program that reads stdin and prints stdout (no function signatures, no prompts).",
    "- Each test must include an explanation.",
    "- All strings must be non-empty; never return empty objects.",
  ];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  parts.push(
    "",
    "Return JSON only in this shape (no prose):",
    '{"problems":[{"slug":"p1","title":"...","topics":["topic1","topic2"],"difficulty":"easy","description":"...","inputFormat":"...","constraints":["..."],"examples":[{"title":"...","input":"...","output":"...","explanation":"..."}],"tests":[{"input":"...","output":"...","explanation":"..."}],"hints":["...","...","..."],"solution":{"language":"python","code":"..."},"metadataVersion":1},{"slug":"p2","title":"...","topics":["topic1","topic2"],"difficulty":"easy","description":"...","inputFormat":"...","constraints":["..."],"examples":[{"title":"...","input":"...","output":"...","explanation":"..."}],"tests":[{"input":"...","output":"...","explanation":"..."}],"hints":["...","...","..."],"solution":{"language":"python","code":"..."},"metadataVersion":1}]}',
    "",
    `Topic: "${plan.topic}" (story topic: "${plan.story.storyTopic}")`,
    "Promised skills:",
    plan.promised_skills.map((skill) => `- ${skill}`).join("\\n"),
    "",
    "Coding blueprints:",
    plan.coding_blueprints
      .map(
        (blueprint) =>
          `- ${blueprint.id}: ${blueprint.title} (${blueprint.required_skills.join(", ")})`,
      )
      .join("\\n"),
    "",
    "Draft coding problems JSON:",
    JSON.stringify(problems, null, 2),
  );
  return parts.join("\\n");
}

export async function generateQuizDefinitions(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
  lessonBrief?: string,
): Promise<readonly QuizDefinition[]> {
  const prompt = buildQuizDefinitionsPrompt(plan, quizzes, lessonBrief);
  try {
    const payload = await generateJson<{ quizzes: QuizDefinition[] }>({
      modelId: TEXT_MODEL_ID,
      contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
      schema: QuizDefinitionsPayloadSchema,
      responseSchema: QUIZ_DEFINITIONS_RESPONSE_SCHEMA,
      maxAttempts: 4,
    });
    return payload.quizzes;
  } catch (error) {
    const attempts = (error as { attempts?: { rawText: string }[] }).attempts;
    const lastRaw =
      attempts && attempts.length > 0
        ? attempts[attempts.length - 1]?.rawText
        : undefined;
    if (lastRaw) {
      try {
        const repaired = repairQuizzesJson(lastRaw);
        return repaired.quizzes;
      } catch {
        // fall through to rethrow original error
      }
    }
    throw error;
  }
}

export async function generateCodeProblems(
  plan: SessionPlan,
  problems: readonly CodingProblem[],
  lessonBrief?: string,
): Promise<readonly CodeProblem[]> {
  const prompt = buildCodeProblemsPrompt(plan, problems, lessonBrief);
  const payload = await generateJson<{ problems: CodeProblem[] }>({
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: CodeProblemsPayloadSchema,
    responseSchema: CODE_PROBLEMS_RESPONSE_SCHEMA,
    maxAttempts: 4,
  });
  return payload.problems;
}

export async function generateSessionMetadata(options: {
  topic: string;
  plan: SessionPlan;
  storyTitle?: string;
}): Promise<{ tagline: string; emoji: string; summary: string }> {
  const prompt = `
    Generate metadata for a coding session about "${options.topic}".
    - Tagline: punchy, max 10 words.
    - Emoji: single character.
    - Summary: exactly one academic-style sentence (max 25 words) that states the session focus and approach; avoid marketing fluff and do not reuse a single plan step.
    The session story is about: "${options.plan.story.storyTopic}".
    Use the story title "${options.storyTitle ?? options.plan.story.storyTopic}" if helpful.

    Return JSON with "tagline", "emoji", and "summary".
  `;

  return generateJson<{ tagline: string; emoji: string; summary: string }>({
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: SessionMetadataSchema,
    responseSchema: SESSION_METADATA_RESPONSE_SCHEMA,
  });
}

export function convertSessionPlanToItems(
  session: GenerateSessionResult,
  storyPlanItemId: string,
): { plan: PlanItem[]; storyTitle: string } {
  const problems = ProblemPlanItemsSchema.parse(session.problems);
  const problemTitles: Record<"p1" | "p2", string> = {
    p1: "",
    p2: "",
  };
  for (const problem of problems) {
    problemTitles[problem.id] = problem.title;
  }
  const storyTitle = session.story?.title ?? session.plan.story.storyTopic;
  const parts = session.plan.parts.map((part) => {
    const base = {
      title: part.summary,
      summary: part.summary,
    };

    switch (part.kind) {
      case "story":
        return {
          ...base,
          id: storyPlanItemId,
          kind: "media" as const,
          title: storyTitle,
        };
      case "intro_quiz":
        return {
          ...base,
          id: "intro_quiz",
          kind: "quiz" as const,
        };
      case "coding_1": {
        return {
          ...base,
          id: "p1",
          kind: "problem" as const,
          title: problemTitles.p1,
        };
      }
      case "coding_2": {
        return {
          ...base,
          id: "p2",
          kind: "problem" as const,
          title: problemTitles.p2,
        };
      }
      case "wrap_up_quiz":
        return {
          ...base,
          id: "wrap_up_quiz",
          kind: "quiz" as const,
        };
    }
  });

  return { plan: parts, storyTitle };
}
