import {
  CodeProblemSchema,
  QuizDefinitionSchema,
  type PlanItem,
  type CodeProblem,
  type QuizFeedback,
  type QuizDefinition,
} from "@spark/schemas";
import { z } from "zod";

import { generateJson, type LlmDebugOptions } from "../utils/llm";
import { TEXT_MODEL_ID } from "./sessionLlm";
import {
  ProblemPlanItemsSchema,
  type CodingProblem,
  type GenerateSessionResult,
  type SessionPlan,
  type SessionQuiz,
} from "./generateSession";

const QUIZ_DEFINITIONS_MODEL_ID = TEXT_MODEL_ID;

const SessionMetadataSchema = z.object({
  tagline: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

const QuizDefinitionsPayloadSchema = z.object({
  quizzes: z.array(QuizDefinitionSchema),
});

const CodeProblemsPayloadSchema = z.object({
  problems: z.array(CodeProblemSchema).min(1),
});

function formatQuizDraftsMarkdown(quizzes: readonly SessionQuiz[]): string {
  if (quizzes.length === 0) {
    return "None";
  }
  const sections: string[] = [];
  for (const quiz of quizzes) {
    sections.push(`### ${quiz.quiz_id}`);
    if (quiz.theory_blocks && quiz.theory_blocks.length > 0) {
      sections.push("Theory blocks:");
      let theoryIndex = 0;
      for (const block of quiz.theory_blocks) {
        theoryIndex += 1;
        sections.push(`- ${theoryIndex}. ${block.id}: ${block.title}`);
        sections.push(`  - ${block.content_md}`);
      }
    }
    sections.push("Questions:");
    let questionIndex = 0;
    for (const question of quiz.questions) {
      questionIndex += 1;
      sections.push(
        `- Q${questionIndex} ${question.id} [${question.type}] ${question.prompt}`,
      );
      if ("options" in question) {
        sections.push(`  - options: ${question.options.join(" | ")}`);
      }
      const correct = Array.isArray(question.correct)
        ? question.correct.join(", ")
        : question.correct;
      sections.push(`  - correct: ${correct}`);
      sections.push(`  - explanation: ${question.explanation}`);
      sections.push(`  - tags: ${question.tags.join(", ")}`);
      sections.push(
        `  - covers_techniques: ${question.covers_techniques.join(", ")}`,
      );
    }
    sections.push("");
  }
  return sections.join("\n").trim();
}

function buildQuizDefinitionsPrompt(
  plan: SessionPlan,
  quizzes: readonly SessionQuiz[],
  lessonBrief?: string,
): string {
  const quizCount = quizzes.length;
  const parts: string[] = [
    "## Instructions",
    "- Convert the session quizzes into Spark quiz definitions for the learner dashboard.",
    `- Return exactly ${quizCount} quiz objects (same order as provided) and nothing else.`,
    "- Use only supported kinds: multiple-choice, type-answer, or an optional info-card primer when introducing a new concept.",
    "- Do NOT drop questions: each output quiz must include every draft question in the same order (one output question per draft question).",
    "- Convert each draft question into a supported quiz kind (multiple-choice or type-answer); include correctFeedback (heading/message) for graded questions and keep it friendly and brief.",
    "- Draft question type mapping guidance: mcq -> multiple-choice; short/numeric -> type-answer; code_reading -> multiple-choice or type-answer with the snippet in the prompt; multi -> rewrite into a single-answer multiple-choice (options can be combinations like “A and C”).",
    "- Every graded question MUST include a short hint and a short explanation (1-2 sentences each). Do not omit these fields or leave them blank.",
    "- Quizzes must be self-contained: do NOT mention source documents, sections, page numbers, or quotes from the materials.",
    "- Each quiz must include a gradingPrompt: a short instruction for how to grade type-answer responses across the quiz.",
    "- Multiple-choice options need ids/labels (A, B, C, ...), text, and correctOptionId.",
    "- Type-answer questions must include answer, marks (integer, typically 3-6), and markScheme (short bullet list or concise rubric). acceptableAnswers is optional.",
    "- Keep prompts short, avoid jargon, and stick to the promised skills.",
    "- Populate every required field; never emit empty objects or empty strings. Every quiz must include a non-empty description and progressKey.",
    "- IDs must be stable slugs (reuse any ids in the draft input when present). Titles must be non-empty. Each quiz requires at least one question.",
    "- JSON schema (informal): { quizzes: [ { id, title, description, progressKey, gradingPrompt, topic?, estimatedMinutes?, questions: [ { kind: 'multiple-choice' | 'type-answer' | 'info-card', id, prompt, hint (required for graded), explanation (required for graded), correctFeedback? (for graded kinds), options/answer/body depending on kind, marks/markScheme for type-answer } ] } ] }",
    "- If you are unsure about any field, copy the draft value instead of leaving it blank, and still provide a helpful hint/explanation.",
    '- Sample shape (do NOT copy text, just the structure): {"quizzes":[{"id":"intro","title":"Starter Quiz","gradingPrompt":"Grade free-text answers using the mark scheme...","questions":[{"id":"intro_q1","kind":"multiple-choice","prompt":"...","options":[{"id":"A","label":"A","text":"..."},{"id":"B","label":"B","text":"..."}],"correctOptionId":"A","correctFeedback":{"heading":"Nice!","message":"Short friendly note"},"explanation":"One-line why"},{"id":"intro_q2","kind":"type-answer","prompt":"...","answer":"...","marks":4,"markScheme":"- point one\\n- point two","correctFeedback":{"heading":"Great!","message":"..."}}]}]}',
  ];
  if (lessonBrief) {
    parts.push("", "## Lesson brief (authoritative)", lessonBrief);
  }
  parts.push("", "## Topic", plan.topic, "");
  if (plan.story?.storyTopic) {
    parts.push("## Story topic", plan.story.storyTopic, "");
  }
  parts.push(
    "## Promised skills",
    plan.promised_skills.map((skill) => `- ${skill}`).join("\\n"),
    "",
    "## Plan parts",
    plan.parts.map((part) => `- ${part.kind}: ${part.summary}`).join("\\n"),
    "",
    "## Draft quizzes (markdown)",
    formatQuizDraftsMarkdown(quizzes),
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
    const gradingPrompt =
      asString(q.gradingPrompt) ??
      "Grade free-text answers using the provided mark scheme. Award partial credit and keep feedback concise.";
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
          const marks = asNumber(rq.marks);
          const markScheme =
            asString(rq.markScheme) ??
            `Award marks for including the key idea: ${answer}.`;
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
            marks: marks ?? 3,
            markScheme,
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
      gradingPrompt,
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
    "Convert these draft coding problems into Spark CodeProblem JSON (array with problems).",
    "",
    "Output must match the Spark CodeProblemSchema exactly. REQUIRED fields and types:",
    "- slug: string (use the coding_blueprints ids exactly; do not invent other slugs)",
    "- Include one problem per coding_blueprint, in the same order as listed.",
    "- title: string",
    "- topics: string[] (2-4 concise topics)",
    '- difficulty: "warmup" | "intro" | "easy" | "medium" | "hard" (use "easy" or "medium" here as appropriate)',
    "- description: markdown string (problem statement)",
    "- inputFormat: markdown string",
    "- constraints: string[] (plain bullet strings)",
    "- examples: exactly 3 items, each with { title, input, output, explanation }",
    "- tests: follow the count required by the lesson brief when specified; otherwise use 10-14 items. Each test includes { input, output, explanation }, and tests[0-2] must MATCH examples[0-2] exactly.",
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
    "- If the lesson brief supplies a fixed test list or marking scheme, use those cases exactly (no additions, no removals).",
  ];
  if (lessonBrief) {
    parts.push("", "Lesson brief (authoritative):", lessonBrief);
  }
  const storyLabel = plan.story?.storyTopic
    ? ` (story topic: "${plan.story.storyTopic}")`
    : "";
  parts.push(
    "",
    "Return JSON only in this shape (no prose):",
    '{"problems":[{"slug":"problem_id","title":"...","topics":["topic1","topic2"],"difficulty":"easy","description":"...","inputFormat":"...","constraints":["..."],"examples":[{"title":"...","input":"...","output":"...","explanation":"..."}],"tests":[{"input":"...","output":"...","explanation":"..."}],"hints":["...","...","..."],"solution":{"language":"python","code":"..."},"metadataVersion":1}]}',
    "",
    `Topic: "${plan.topic}"${storyLabel}`,
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
  options?: { debug?: LlmDebugOptions },
): Promise<readonly QuizDefinition[]> {
  const prompt = buildQuizDefinitionsPrompt(plan, quizzes, lessonBrief);
  try {
    const payload = await generateJson<{ quizzes: QuizDefinition[] }>({
      modelId: QUIZ_DEFINITIONS_MODEL_ID,
      contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
      schema: QuizDefinitionsPayloadSchema,
      debug: options?.debug,
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
    maxAttempts: 4,
  });
  return payload.problems;
}

export async function generateSessionMetadata(options: {
  topic: string;
  plan: SessionPlan;
  storyTitle?: string;
  includeCoding?: boolean;
}): Promise<{ tagline: string; emoji: string; summary: string }> {
  const includeCoding = options.includeCoding ?? true;
  const sessionLabel = includeCoding ? "coding session" : "lesson session";
  const storyTopic = options.plan.story?.storyTopic;
  const storyTitle = options.storyTitle ?? storyTopic ?? options.topic;
  const storyLine = storyTopic
    ? `The session story is about: "${storyTopic}".`
    : "This session has no story segment.";
  const storyTitleLine = storyTopic
    ? `Use the story title "${storyTitle}" if helpful.`
    : `Use the session topic "${options.topic}" if helpful.`;
  const prompt = `
    Generate metadata for a ${sessionLabel} about "${options.topic}".
    - Tagline: punchy, max 10 words.
    - Emoji: single character.
    - Summary: exactly one academic-style sentence (max 25 words) that states the session focus and approach; avoid marketing fluff and do not reuse a single plan step.
    ${storyLine}
    ${storyTitleLine}

    Return JSON with "tagline", "emoji", and "summary".
  `;

  return generateJson<{ tagline: string; emoji: string; summary: string }>({
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: SessionMetadataSchema,
  });
}

export function convertSessionPlanToItems(
  session: GenerateSessionResult,
  storyPlanItemId: string,
): { plan: PlanItem[]; storyTitle: string } {
  const problemTitles = new Map<string, string>();
  if (session.problems.length > 0) {
    const problems = ProblemPlanItemsSchema.parse(session.problems);
    for (const problem of problems) {
      problemTitles.set(problem.id, problem.title);
    }
  } else if (session.plan.coding_blueprints.length > 0) {
    for (const blueprint of session.plan.coding_blueprints) {
      problemTitles.set(blueprint.id, blueprint.title);
    }
  }
  const storyTitle =
    session.story?.title ??
    session.plan.story?.storyTopic ??
    session.plan.topic;
  let quizIndex = 0;
  let problemIndex = 0;
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
      case "quiz": {
        quizIndex += 1;
        const quizId = part.id ?? `quiz_${quizIndex}`;
        return {
          ...base,
          id: quizId,
          kind: "quiz" as const,
        };
      }
      case "problem": {
        problemIndex += 1;
        const problemId = part.id ?? `p${problemIndex}`;
        const problemTitle = problemTitles.get(problemId);
        return {
          ...base,
          id: problemId,
          kind: "problem" as const,
          title: problemTitle ?? part.summary,
        };
      }
    }
  });

  return { plan: parts, storyTitle };
}
