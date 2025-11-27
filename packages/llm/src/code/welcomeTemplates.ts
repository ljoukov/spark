import { Type, type Schema } from "@google/genai";
import {
  CodeProblemSchema,
  QuizDefinitionSchema,
  type CodeProblem,
  type QuizDefinition,
} from "@spark/schemas";
import { z } from "zod";

import { generateJson } from "../utils/llm";
import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "../utils/firebaseAdmin";
import {
  generateSession,
  type CodingProblem,
  type SessionPlan,
  type SessionQuiz,
} from "./generateSession";
import type { GenerateStoryResult } from "./generateStory";

const TEXT_MODEL_ID = "gemini-3-pro-preview" as const;
const TEMPLATE_USER_ID = "welcome-templates";
const TEMPLATE_ROOT_COLLECTION = "spark-admin";
const TEMPLATE_ROOT_DOC = "templates";
const TEMPLATE_SESSIONS_COLLECTION = "sessions";
const DEFAULT_STORY_PLAN_ITEM_ID = "story";

const GenerateWelcomeSessionOptionsSchema = z.object({
  topic: z.string().trim().min(1, "topic is required"),
  sessionId: z.string().trim().min(1).optional(),
  storyPlanItemId: z.string().trim().min(1).optional(),
});

export type GenerateWelcomeSessionOptions = z.infer<
  typeof GenerateWelcomeSessionOptionsSchema
>;

const METADATA_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["tagline", "emoji", "summary"],
  properties: {
    tagline: { type: Type.STRING },
    emoji: { type: Type.STRING },
    summary: { type: Type.STRING },
  },
};

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
        required: ["id", "title", "questions"],
        properties: {
          id: { type: Type.STRING, minLength: "1" },
          title: { type: Type.STRING, minLength: "1" },
          description: { type: Type.STRING },
          topic: { type: Type.STRING },
          estimatedMinutes: { type: Type.NUMBER },
          progressKey: { type: Type.STRING },
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

const CodeProblemsPayloadSchema = z.object({
  problems: z.array(CodeProblemSchema),
});

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

function slugifyTopic(topic: string): string {
  const ascii = topic
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\\s-]/g, " ")
    .trim()
    .toLowerCase();
  const collapsed = ascii.replace(/\\s+/g, "-").replace(/-+/g, "-");
  const trimmed = collapsed.replace(/^-+|-+$/g, "");
  return trimmed.slice(0, 60) || "session";
}

function buildQuizDefinitionsPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
): string {
  const quizCount = quizzes.length;
  return [
    "Convert the session quizzes into Spark quiz definitions for the learner dashboard.",
    `Return exactly ${quizCount} quiz objects (same order as provided) and nothing else.`,
    "Use only supported kinds: multiple-choice, type-answer, or an optional info-card primer when introducing a new concept.",
    "Each quiz should have 4-5 concise questions with short explanations; include correctFeedback (heading/message) for graded questions and keep it friendly and brief.",
    "Multiple-choice options need ids/labels (A, B, C, ...), text, and correctOptionId; type-answer uses answer plus optional acceptableAnswers.",
    "Keep prompts short, avoid jargon, and stick to the promised skills.",
    "Populate every required field; never emit empty objects or empty strings.",
    "IDs must be stable slugs (reuse any ids in the draft input when present). Titles must be non-empty. Each quiz requires at least one question.",
    "JSON schema (informal): { quizzes: [ { id, title, description?, topic?, estimatedMinutes?, progressKey?, questions: [ { kind: 'multiple-choice' | 'type-answer' | 'info-card', id, prompt, hint?, explanation?, correctFeedback? (for graded kinds), options/answer/body depending on kind } ] } ] }",
    "If you are unsure about any field, copy the draft value instead of leaving it blank.",
    'Sample shape (do NOT copy text, just the structure): {"quizzes":[{"id":"intro","title":"Starter Quiz","questions":[{"id":"intro_q1","kind":"multiple-choice","prompt":"...","options":[{"id":"A","label":"A","text":"..."},{"id":"B","label":"B","text":"..."}],"correctOptionId":"A","correctFeedback":{"heading":"Nice!","message":"Short friendly note"},"explanation":"One-line why"}]}]}',
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
  ].join("\\n");
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
    const description = asString(q.description, "") ?? "";
    const topic = asString(q.topic, undefined);
    const estimatedMinutes = asNumber(q.estimatedMinutes);
    const progressKey = asString(q.progressKey, undefined);

    const rawQuestions = asArray<unknown>(q.questions);
    const questions = rawQuestions.map(
      (rawQuestion, questionIndex): QuizDefinition["questions"][number] => {
        const rq =
          rawQuestion && typeof rawQuestion === "object"
            ? (rawQuestion as Record<string, unknown>)
            : {};
        const kind = asString(
          rq.kind,
          "multiple-choice",
        ) as QuizDefinition["questions"][number]["kind"];
        const base = {
          id: asString(rq.id, `question_${questionIndex + 1}`)!,
          prompt: asString(rq.prompt, "Placeholder question")!,
          hint: asString(rq.hint, undefined),
          explanation: asString(rq.explanation, undefined),
        };
        const feedbackHeading =
          rq.correctFeedback && typeof rq.correctFeedback === "object"
            ? asString(
                (rq.correctFeedback as { heading?: unknown }).heading,
                "Nice!",
              )
            : "Nice!";
        const feedbackMessage =
          rq.correctFeedback && typeof rq.correctFeedback === "object"
            ? asString(
                (rq.correctFeedback as { message?: unknown }).message,
                "Good work.",
              )
            : "Good work.";
        const correctFeedback = {
          heading: feedbackHeading,
          message: feedbackMessage ?? "Good work.",
          tone: "info" as const,
        };
        if (kind === "type-answer") {
          const acceptableAnswers =
            asArray<string>(rq.acceptableAnswers).filter(
              (value) => typeof value === "string" && value.trim().length > 0,
            );
          return {
            kind,
            ...base,
            answer: asString(rq.answer, "TODO answer")!,
            acceptableAnswers:
              acceptableAnswers.length > 0 ? acceptableAnswers : undefined,
            correctFeedback,
          };
        }
        if (kind === "info-card") {
          return {
            kind,
            ...base,
            body: asString(rq.body, "Placeholder body")!,
          };
        }
        const rawOptions = asArray<unknown>(rq.options);
        const options =
          rawOptions.length > 0
            ? rawOptions.map((rawOption, optionIndex) => {
                const ro =
                  rawOption && typeof rawOption === "object"
                    ? (rawOption as Record<string, unknown>)
                    : {};
                const fallbackId = String.fromCharCode(65 + optionIndex);
                return {
                  id: asString(ro.id, fallbackId)!,
                  label: asString(ro.label, fallbackId)!,
                  text: asString(ro.text, `Option ${fallbackId}`)!,
                };
              })
            : [
                {
                  id: "A",
                  label: "A",
                  text: "Placeholder A",
                },
                {
                  id: "B",
                  label: "B",
                  text: "Placeholder B",
                },
              ];
        return {
          kind: "multiple-choice",
          ...base,
          options,
          correctOptionId: asString(
            rq.correctOptionId,
            options[0]?.id ?? "A",
          )!,
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
): string {
  return [
    "Convert these two draft coding problems into Spark CodeProblem JSON (array with problems).",
    "",
    "Output must match the Spark CodeProblemSchema exactly. REQUIRED fields and types:",
    "- slug: string (use 'p1' and 'p2' respectively; do not invent other slugs)",
    "- title: string",
    "- topics: string[] (2-4 concise topics)",
    '- difficulty: \"warmup\" | \"intro\" | \"easy\" | \"medium\" | \"hard\" (use \"easy\" or \"medium\" here as appropriate)',
    "- description: markdown string (problem statement)",
    "- inputFormat: markdown string",
    "- constraints: string[] (plain bullet strings)",
    "- examples: exactly 3 items, each with { title, input, output, explanation }",
    "- tests: 10-14 items, each with { input, output, explanation }; tests[0-2] must MATCH examples[0-2] exactly",
    "- hints: exactly 3 markdown strings, ordered",
    '- solution: { language: \"python\", code: string } (full reference solution)',
    "- metadataVersion: 1",
    "",
    "STRICT rules:",
    "- Do NOT include fields like statement_md, function, edge_cases, or tests.public/private; only the fields listed above.",
    "- Keep inputs/outputs as plain text (no code fences).",
    "- Keep code in Python 3; no type hints needed beyond the code block itself.",
    "- Each test must include an explanation.",
    "- All strings must be non-empty; never return empty objects.",
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
  ].join("\\n");
}

function clampSummaryWords(summary: string, maxWords = 15): string {
  const words = summary.split(/\\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return summary.trim();
  }
  return words.slice(0, maxWords).join(" ").concat("...");
}

async function generateMetadata(
  topic: string,
  plan: SessionPlan,
): Promise<{ tagline: string; emoji: string; summary: string }> {
  const prompt = `
    Generate metadata for a coding session about "${topic}".
    - Tagline: punchy, max 10 words.
    - Emoji: single character.
    - Summary: 1-2 sentences (30-45 words) describing the overall session arc; do not reuse a single plan step.
    The session story is about: "${plan.story.storyTopic}".

    Return JSON with "tagline", "emoji", and "summary".
  `;

  const MetadataSchema = z.object({
    tagline: z.string().trim().min(1),
    emoji: z.string().trim().min(1),
    summary: z.string().trim().min(1),
  });

  return generateJson<{ tagline: string; emoji: string; summary: string }>({
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: MetadataSchema,
    responseSchema: METADATA_RESPONSE_SCHEMA,
  });
}

async function generateQuizDefinitions(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
): Promise<readonly QuizDefinition[]> {
  const prompt = buildQuizDefinitionsPrompt(plan, quizzes);
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

async function generateCodeProblems(
  plan: SessionPlan,
  problems: readonly CodingProblem[],
): Promise<readonly CodeProblem[]> {
  const prompt = buildCodeProblemsPrompt(plan, problems);
  const payload = await generateJson<{ problems: CodeProblem[] }>({
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: CodeProblemsPayloadSchema,
    responseSchema: CODE_PROBLEMS_RESPONSE_SCHEMA,
    maxAttempts: 4,
  });
  return payload.problems;
}

function convertPlan(
  plan: SessionPlan,
  storyPlanItemId: string,
  storyTitle: string,
) {
  return plan.parts.map((part) => {
    const conciseSummary = clampSummaryWords(part.summary, 15);
    const base = {
      title: part.summary.split(".")[0] || "Session Part",
      summary: conciseSummary,
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
          title: "Warm-up",
        };
      case "coding_1":
        return {
          ...base,
          id: "p1",
          kind: "problem" as const,
          title: "Challenge 1",
        };
      case "coding_2":
        return {
          ...base,
          id: "p2",
          kind: "problem" as const,
          title: "Challenge 2",
        };
      case "wrap_up_quiz":
        return {
          ...base,
          id: "wrap_up_quiz",
          kind: "quiz" as const,
          title: "Review",
        };
    }
  });
}

function getTemplateDocRef(sessionId: string) {
  const firestore = getFirebaseAdminFirestore();
  return firestore
    .collection(TEMPLATE_ROOT_COLLECTION)
    .doc(TEMPLATE_ROOT_DOC)
    .collection(TEMPLATE_SESSIONS_COLLECTION)
    .doc(sessionId);
}

async function copyStoryToTemplate(
  sessionId: string,
  planItemId: string,
  storyResult: GenerateStoryResult,
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const sourceDoc = firestore.doc(storyResult.narration.documentPath);
  const snapshot = await sourceDoc.get();
  if (!snapshot.exists) {
    console.warn(
      `[welcome/${sessionId}] narration document ${storyResult.narration.documentPath} missing; skipping copy`,
    );
    return;
  }

  const targetDoc = getTemplateDocRef(sessionId)
    .collection("media")
    .doc(planItemId);
  const payload = snapshot.data();
  if (!payload) {
    console.warn(
      `[welcome/${sessionId}] narration document ${storyResult.narration.documentPath} missing data; skipping copy`,
    );
    return;
  }
  await targetDoc.set(payload);
  console.log(
    `[welcome/${sessionId}] published story media to ${targetDoc.path}`,
  );
}

async function writeQuizzesToTemplate(
  sessionId: string,
  quizzes: readonly QuizDefinition[],
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const batch = firestore.batch();
  const templateDoc = getTemplateDocRef(sessionId);

  for (const quiz of quizzes) {
    const target = templateDoc.collection("quiz").doc(quiz.id);
    const { id, ...rest } = quiz;
    void id;
    batch.set(target, rest);
  }

  await batch.commit();
  console.log(
    `[welcome/${sessionId}] published ${quizzes.length} quizzes to template`,
  );
}

async function writeProblemsToTemplate(
  sessionId: string,
  problems: readonly CodeProblem[],
): Promise<void> {
  const firestore = getFirebaseAdminFirestore();
  const batch = firestore.batch();
  const templateDoc = getTemplateDocRef(sessionId);

  for (const problem of problems) {
    const target = templateDoc.collection("code").doc(problem.slug);
    const { slug, ...rest } = problem;
    void slug;
    batch.set(target, rest);
  }

  await batch.commit();
  console.log(
    `[welcome/${sessionId}] published ${problems.length} problems to template`,
  );
}

async function writeTemplateDoc(
  sessionId: string,
  topic: string,
  finalData: {
    plan: unknown[];
    tagline: string;
    emoji: string;
    summary?: string;
    title?: string;
  },
): Promise<void> {
  const { FieldValue, Timestamp } = getFirebaseAdminFirestoreModule();
  const templateDoc = getTemplateDocRef(sessionId);
  const payload: Record<string, unknown> = {
    id: sessionId,
    topic,
    updatedAt: Timestamp.now(),
  };

  payload.plan = finalData.plan;
  payload.tagline = finalData.tagline;
  payload.emoji = finalData.emoji;
  if (finalData.summary) {
    payload.summary = finalData.summary;
  }
  if (finalData.title) {
    payload.title = finalData.title;
  }

  const draftFieldsToDelete = [
    "planDraft",
    "planGrade",
    "quizzesDraft",
    "quizzesGrade",
    "problemsDraft",
    "problemsGrade",
    "storyTitle",
  ];
  for (const field of draftFieldsToDelete) {
    payload[field] = FieldValue.delete();
  }

  await templateDoc.set(payload, { merge: true });
}

export async function generateWelcomeSessionTemplate(
  options: GenerateWelcomeSessionOptions,
): Promise<{ sessionId: string; topic: string; title: string }> {
  const parsed = GenerateWelcomeSessionOptionsSchema.parse(options);
  const sessionId = parsed.sessionId ?? slugifyTopic(parsed.topic);
  const storyPlanItemId = parsed.storyPlanItemId ?? DEFAULT_STORY_PLAN_ITEM_ID;

  const generation = await generateSession({
    topic: parsed.topic,
    userId: TEMPLATE_USER_ID,
    sessionId,
    storyPlanItemId,
  });

  if (!generation.story) {
    throw new Error("Story generation is required for welcome templates.");
  }

  const quizDefinitions = await generateQuizDefinitions(
    generation.plan,
    generation.quizzes,
  );
  const filteredQuizzes = quizDefinitions.filter(
    (quiz) => quiz.id === "intro_quiz" || quiz.id === "wrap_up_quiz",
  );
  const missingQuizId = ["intro_quiz", "wrap_up_quiz"].find((required) =>
    filteredQuizzes.every((quiz) => quiz.id !== required),
  );
  if (missingQuizId) {
    throw new Error(
      `quiz definitions missing required id '${missingQuizId as string}'`,
    );
  }

  const codeProblems = await generateCodeProblems(
    generation.plan,
    generation.problems,
  );
  const filteredProblems = codeProblems.filter(
    (problem) => problem.slug === "p1" || problem.slug === "p2",
  );
  const missingProblemId = ["p1", "p2"].find((required) =>
    filteredProblems.every((problem) => problem.slug !== required),
  );
  if (missingProblemId) {
    throw new Error(
      `code problems missing required slug '${missingProblemId as string}'`,
    );
  }

  const metadata = await generateMetadata(parsed.topic, generation.plan);
  const storyTitle = generation.story.title;
  const finalPlan = convertPlan(generation.plan, storyPlanItemId, storyTitle);

  await copyStoryToTemplate(sessionId, storyPlanItemId, generation.story);

  await writeTemplateDoc(sessionId, parsed.topic, {
    plan: finalPlan,
    tagline: metadata.tagline,
    emoji: metadata.emoji,
    summary: metadata.summary,
    title: storyTitle,
  });

  await writeQuizzesToTemplate(sessionId, filteredQuizzes);
  await writeProblemsToTemplate(sessionId, filteredProblems);

  return { sessionId, topic: parsed.topic, title: storyTitle };
}
