import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { runSparkLessonAgentLocal } from "../src/agent/sparkAgentRunner";
import { loadEnvFromFile } from "../src/utils/env";
import {
  runToolLoop,
  tool,
  type LlmToolLoopResult,
  type LlmToolSet,
} from "../src/utils/llm";
import {
  QuizDefinitionSchema,
  SessionSchema,
  type QuizDefinition,
  type Session,
} from "@spark/schemas";

const shouldRun = process.env.RUN_LLM_INTEGRATION_TESTS === "1";

const testDescribe = shouldRun ? describe : describe.skip;

function resolveRepoRoot(): string {
  const filePath = fileURLToPath(import.meta.url);
  const dir = path.dirname(filePath);
  return path.resolve(dir, "../../..");
}

function writeLogLine(logPath: string, message: string): void {
  fs.appendFileSync(logPath, message.trimEnd() + "\n", { encoding: "utf8" });
}

const quizQuestionKindSchema = z
  .enum(["multiple-choice", "type-answer", "info-card"])
  .describe("Quiz question kind.");

const quizQuestionKindCountSchema = z
  .object({
    kind: quizQuestionKindSchema.describe("Question kind."),
    count: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("How many questions of this kind."),
  })
  .strict();

const quizPreferencesSchema = z
  .object({
    questionCount: z
      .number()
      .int()
      .min(1)
      .max(50)
      .describe("Total number of questions for this quiz plan item.")
      .optional(),
    questionKinds: z
      .array(quizQuestionKindCountSchema)
      .min(1)
      .describe("Exact mix of question kinds for this quiz plan item.")
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.questionCount && !value.questionKinds) {
      return;
    }
    const kinds = value.questionKinds ?? [];
    const seenKinds = new Set<string>();
    let sum = 0;
    for (const entry of kinds) {
      if (seenKinds.has(entry.kind)) {
        ctx.addIssue({
          code: "custom",
          path: ["questionKinds"],
          message: `Duplicate question kind "${entry.kind}"`,
        });
      }
      seenKinds.add(entry.kind);
      sum += entry.count;
    }
    if (
      typeof value.questionCount === "number" &&
      kinds.length > 0 &&
      sum !== value.questionCount
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["questionKinds"],
        message: `questionKinds sum (${sum}) must equal questionCount (${value.questionCount})`,
      });
    }
  });

const planItemPreferencesSchema = z
  .object({
    kind: z
      .enum(["quiz", "problem", "media"])
      .describe("Plan item kind: quiz, coding problem, or media/story."),
    title: z
      .string()
      .trim()
      .min(1)
      .describe("Optional short title for the plan item.")
      .optional(),
    description: z
      .string()
      .trim()
      .min(1)
      .describe("Optional description for the plan item.")
      .optional(),
    quiz: quizPreferencesSchema
      .describe('Quiz constraints (only when kind="quiz").')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind !== "quiz" && value.quiz) {
      ctx.addIssue({
        code: "custom",
        path: ["quiz"],
        message: 'quiz preferences can only be set when kind="quiz"',
      });
    }
  });

const planPreferencesSchema = z
  .object({
    items: z
      .array(planItemPreferencesSchema)
      .min(1)
      .max(20)
      .describe(
        "Preferred plan items. Array length controls number of plan items.",
      ),
  })
  .strict()
  .describe("Plan shape preferences for integration test.");

const materialsSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === "string") {
      const entries = value
        .split(/[\n,;]+/u)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      return entries.length > 0 ? entries : undefined;
    }
    return value;
  },
  z.array(z.string().trim().min(1)).optional(),
);

type LessonCreateInput = {
  topic: string;
  title?: string;
  level?: string;
  goal?: string;
  plan: {
    items: Array<{
      kind: "quiz" | "problem" | "media";
      title?: string;
      description?: string;
      quiz?: {
        questionCount?: number;
        questionKinds?: Array<{
          kind: "multiple-choice" | "type-answer" | "info-card";
          count: number;
        }>;
      };
    }>;
  };
  materials?: string[];
};

const lessonCreateSchema = z
  .object({
    topic: z.string().trim().min(1).describe("Lesson topic."),
    title: z
      .string()
      .trim()
      .min(1)
      .describe("Optional lesson title override.")
      .optional(),
    level: z
      .string()
      .trim()
      .min(1)
      .describe("Optional learner level.")
      .optional(),
    goal: z
      .string()
      .trim()
      .min(1)
      .describe("Optional learning goal.")
      .optional(),
    plan: planPreferencesSchema,
    materials: materialsSchema.describe(
      "Optional list of materials/links to incorporate.",
    ),
  })
  .strict();

type LessonAgentLocalRunResult = {
  toolLoopResult: LlmToolLoopResult;
  publishResult: {
    status: "published";
    sessionId: string;
    includeStory: boolean | null;
    includeCoding: boolean | null;
    quizCount: number;
    problemCount: number;
    mediaCount: number;
    href: string;
    mode: "mock";
  } | null;
  doneSummary: string | null;
};

function buildLessonBrief(input: LessonCreateInput): string {
  const lines: string[] = [
    "# Lesson request",
    "",
    `## Topic`,
    input.topic.trim(),
  ];
  if (input.title) {
    lines.push("", "## Title", input.title.trim());
  }
  if (input.level) {
    lines.push("", "## Level", input.level.trim());
  }
  if (input.goal) {
    lines.push("", "## Goal", input.goal.trim());
  }
  if (input.plan.items.length > 0) {
    lines.push("", "## Plan preferences");
    lines.push(`- Total plan items: ${input.plan.items.length}`);
    let index = 0;
    for (const item of input.plan.items) {
      index += 1;
      const titleSuffix = item.title ? ` - ${item.title.trim()}` : "";
      if (item.kind === "quiz") {
        const questionCount =
          item.quiz?.questionCount ??
          (item.quiz?.questionKinds
            ? item.quiz.questionKinds.reduce(
                (sum, entry) => sum + entry.count,
                0,
              )
            : null);
        const kinds =
          item.quiz?.questionKinds && item.quiz.questionKinds.length > 0
            ? item.quiz.questionKinds
                .map((entry) => `${entry.kind}: ${entry.count}`)
                .join(", ")
            : null;
        const detailBits = [
          questionCount ? `${questionCount} questions` : null,
          kinds ? `mix: ${kinds}` : null,
        ].filter((value): value is string => Boolean(value));
        const details =
          detailBits.length > 0 ? ` (${detailBits.join("; ")})` : "";
        lines.push(`- ${index}. quiz${titleSuffix}${details}`);
        continue;
      }
      lines.push(`- ${index}. ${item.kind}${titleSuffix}`);
    }
    lines.push(
      "",
      "Notes:",
      "- Lesson duration is inferred from plan items + question counts (no fixed minutes).",
    );
  }
  if (input.materials && input.materials.length > 0) {
    lines.push("", "## Materials");
    for (const item of input.materials) {
      lines.push(`- ${item}`);
    }
  }
  lines.push(
    "",
    "## Notes",
    "- Publish this lesson into the user's sessions (not welcome templates).",
  );
  return lines.join("\n").trim() + "\n";
}

function renderLessonTask(options: {
  template: string;
  sessionId: string;
  workspaceId: string;
  input: LessonCreateInput;
}): string {
  const title = options.input.title?.trim() ?? "-";
  const level = options.input.level?.trim() ?? "-";
  const goal = options.input.goal?.trim() ?? "-";
  const planItems = options.input.plan.items
    .map((item, index) => {
      const titleSuffix = item.title ? ` - ${item.title.trim()}` : "";
      if (item.kind !== "quiz") {
        return `- ${index + 1}. ${item.kind}${titleSuffix}`;
      }
      const questionCount =
        item.quiz?.questionCount ??
        (item.quiz?.questionKinds
          ? item.quiz.questionKinds.reduce((sum, entry) => sum + entry.count, 0)
          : null);
      const kinds =
        item.quiz?.questionKinds && item.quiz.questionKinds.length > 0
          ? item.quiz.questionKinds
              .map((entry) => `${entry.kind}: ${entry.count}`)
              .join(", ")
          : null;
      const detailBits = [
        questionCount ? `${questionCount} questions` : null,
        kinds ? `mix: ${kinds}` : null,
      ].filter((value): value is string => Boolean(value));
      const details =
        detailBits.length > 0 ? ` (${detailBits.join("; ")})` : "";
      return `- ${index + 1}. quiz${titleSuffix}${details}`;
    })
    .join("\n");
  const materials =
    options.input.materials && options.input.materials.length > 0
      ? options.input.materials.map((item) => `- ${item}`).join("\n")
      : "- (none)";

  return options.template
    .replaceAll("{{SESSION_ID}}", options.sessionId)
    .replaceAll("{{WORKSPACE_ID}}", options.workspaceId)
    .replaceAll("{{TOPIC}}", options.input.topic.trim())
    .replaceAll("{{TITLE}}", title)
    .replaceAll("{{LEVEL}}", level)
    .replaceAll("{{GOAL}}", goal)
    .replaceAll("{{PLAN_ITEMS_BULLETS}}", planItems)
    .replaceAll("{{MATERIALS_BULLETS}}", materials)
    .trim()
    .concat("\n");
}

async function copyLessonAgentTemplates(
  repoRoot: string,
  rootDir: string,
): Promise<void> {
  const schemaDir = path.join(
    repoRoot,
    "web/src/lib/server/lessonAgent/schema",
  );
  const promptsDir = path.join(
    repoRoot,
    "web/src/lib/server/lessonAgent/prompts",
  );

  await mkdir(path.join(rootDir, "lesson/schema"), { recursive: true });
  await mkdir(path.join(rootDir, "lesson/prompts"), { recursive: true });

  const schemaFiles = [
    "README.md",
    "session.schema.json",
    "quiz.schema.json",
    "code.schema.json",
    "media.schema.json",
  ];
  for (const file of schemaFiles) {
    const content = await readFile(path.join(schemaDir, file), {
      encoding: "utf8",
    });
    await writeFile(
      path.join(rootDir, "lesson/schema", file),
      content.trimEnd() + "\n",
      { encoding: "utf8" },
    );
  }

  const promptFiles = [
    "session-draft.md",
    "session-grade.md",
    "session-revise.md",
    "quiz-draft.md",
    "quiz-grade.md",
    "quiz-revise.md",
    "code-draft.md",
    "code-grade.md",
    "code-revise.md",
  ];
  for (const file of promptFiles) {
    const content = await readFile(path.join(promptsDir, file), {
      encoding: "utf8",
    });
    await writeFile(
      path.join(rootDir, "lesson/prompts", file),
      content.trimEnd() + "\n",
      { encoding: "utf8" },
    );
  }
}

function buildLessonAgentPrompt(
  sessionId: string,
  workspaceId: string,
): string {
  return [
    "Create and publish a Spark lesson using the workspace files (brief.md + lesson/*).",
    "",
    `sessionId: ${sessionId}`,
    `workspaceId: ${workspaceId}`,
    "",
    "Instructions:",
    "1) Read brief.md, request.json, and lesson/task.md.",
    "2) Fill lesson/requirements.md with hard requirements + decisions (includeCoding/includeStory).",
    "3) Use generate_text + the templates in lesson/prompts/ to do a generate -> grade -> revise loop for session/quizzes/problems.",
    "   - For JSON outputs, pass responseSchemaPath pointing at lesson/schema/*.schema.json.",
    "4) Write final JSON under lesson/output/.",
    "",
    "Examples:",
    " - generate_text({ promptPath: 'lesson/prompts/session-draft.md', responseSchemaPath: 'lesson/schema/session.schema.json', outputPath: 'lesson/output/session.json' })",
    " - generate_text({ promptPath: 'lesson/prompts/session-grade.md', outputPath: 'lesson/feedback/session-grade.json' })  (must pass=true before publishing)",
    " - generate_text({ promptPath: 'lesson/prompts/quiz-grade.md', inputPaths: ['lesson/output/quiz/q1.json'], outputPath: 'lesson/feedback/quiz-grade.json' })",
    "",
    "5) Call publish_lesson with:",
    `   - sessionId: ${sessionId}`,
    "   - sessionPath: 'lesson/output/session.json'",
    "   - briefPath: 'brief.md' (optional fallback for topic/topics)",
    '   - includeCoding: true if you included any plan items with kind="problem"; otherwise false.',
    '   - includeStory: true if you included any plan items with kind="media"; otherwise false.',
    "6) If publish_lesson fails, fix the files and retry.",
    "7) Call done with a short summary including the sessionId.",
    "",
    "Do not publish into welcome templates.",
  ].join("\n");
}

function assertQuizShape(quiz: QuizDefinition): void {
  const counts = {
    multipleChoice: 0,
    typeAnswer: 0,
    infoCard: 0,
  };
  for (const question of quiz.questions) {
    if (question.kind === "multiple-choice") {
      counts.multipleChoice += 1;
      continue;
    }
    if (question.kind === "type-answer") {
      counts.typeAnswer += 1;
      continue;
    }
    if (question.kind === "info-card") {
      counts.infoCard += 1;
      continue;
    }
  }

  expect(quiz.questions.length).toBe(5);
  expect(counts.multipleChoice).toBe(3);
  expect(counts.typeAnswer).toBe(1);
  expect(counts.infoCard).toBe(1);

  const first = quiz.questions[0];
  expect(first.kind).toBe("info-card");

  const typeAnswer = quiz.questions.find(
    (question) => question.kind === "type-answer",
  );
  expect(typeAnswer).toBeTruthy();
  if (typeAnswer && typeAnswer.kind === "type-answer") {
    expect(typeAnswer.marks).toBeGreaterThanOrEqual(6);
    expect(typeAnswer.marks).toBeLessThanOrEqual(8);
  }
}

testDescribe("LLM integration: lesson creation", () => {
  it("routes a chat request into create_lesson, runs the lesson agent, and produces valid outputs", async () => {
    const repoRoot = resolveRepoRoot();
    loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });

    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
    if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
      throw new Error(
        "Missing GOOGLE_SERVICE_ACCOUNT_JSON (required for Gemini generate_text).",
      );
    }
    const hasChatGptAuth =
      Boolean(process.env.CHATGPT_AUTH_JSON_B64?.trim()) ||
      Boolean(process.env.CHATGPT_AUTH_JSON?.trim()) ||
      Boolean(process.env.CHATGPT_ACCESS_TOKEN?.trim()) ||
      Boolean(process.env.CHATGPT_ACCESS?.trim());
    if (!hasChatGptAuth) {
      throw new Error(
        "Missing ChatGPT auth env (e.g. CHATGPT_AUTH_JSON_B64). Required to run chatgpt-gpt-5.2-codex tool loops.",
      );
    }

    const workDir = await mkdtemp(
      path.join(os.tmpdir(), "spark-llm-integration-lesson-"),
    );
    const logPath = path.join(workDir, "integration.log");
    writeLogLine(logPath, `workspaceRoot=${workDir}`);

    let observedCreateInput: LessonCreateInput | null = null;
    let agentWorkspaceRoot: string | null = null;
    let agentResult: LessonAgentLocalRunResult | null = null;

    const create_lesson = tool({
      description:
        "Create a lesson by writing a local workspace and running the lesson-generation agent to completion (mock publish).",
      inputSchema: lessonCreateSchema as z.ZodType<LessonCreateInput>,
      execute: async (input: LessonCreateInput) => {
        observedCreateInput = input;
        const sessionId = "llm-int-session";
        const workspaceId = "llm-int-workspace";

        agentWorkspaceRoot = path.join(workDir, "agent-workspace");
        await mkdir(agentWorkspaceRoot, { recursive: true });
        await copyLessonAgentTemplates(repoRoot, agentWorkspaceRoot);

        const taskTemplate = await readFile(
          path.join(
            repoRoot,
            "web/src/lib/server/lessonAgent/task-template.md",
          ),
          { encoding: "utf8" },
        );
        const lessonTask = renderLessonTask({
          template: taskTemplate,
          sessionId,
          workspaceId,
          input,
        });
        const requirements = [
          "# Requirements and decisions",
          "",
          "Fill this file with:",
          "- Hard requirements from brief.md (topic, level, goal, plan shape, materials).",
          "- Decisions: includeCoding (true/false), includeStory (true/false).",
          "- If plan preferences were provided, restate them here as constraints (plan items + question counts/types).",
          "- Any assumptions you are making.",
          "",
          `Session ID: ${sessionId}`,
          `Workspace ID: ${workspaceId}`,
          "",
        ].join("\n");
        const plan = [
          "# Plan",
          "",
          "- [running] Read brief.md, request.json, and lesson/task.md.",
          "- [pending] Write lesson/requirements.md (hard requirements + decisions).",
          "- [pending] Generate session draft (generate_text -> lesson/output/session.json).",
          "- [pending] Grade + revise session until pass (lesson/feedback/session-grade.json).",
          "- [pending] Generate quizzes (generate_text -> lesson/output/quiz/*.json).",
          "- [pending] Grade + revise quizzes (lesson/feedback/*).",
          "- [pending] Generate code problems if needed (lesson/output/code/*.json).",
          "- [pending] Verify code problems with python_exec (if coding).",
          "- [pending] Call publish_lesson (fix errors until published).",
          "- [pending] Call done.",
        ].join("\n");

        const request = {
          sessionId,
          createdAt: new Date().toISOString(),
          input,
        };

        await writeFile(
          path.join(agentWorkspaceRoot, "brief.md"),
          buildLessonBrief(input),
          {
            encoding: "utf8",
          },
        );
        await writeFile(
          path.join(agentWorkspaceRoot, "request.json"),
          JSON.stringify(request, null, 2),
          {
            encoding: "utf8",
          },
        );
        await mkdir(path.join(agentWorkspaceRoot, "lesson"), {
          recursive: true,
        });
        await writeFile(
          path.join(agentWorkspaceRoot, "lesson/task.md"),
          lessonTask,
          { encoding: "utf8" },
        );
        await writeFile(
          path.join(agentWorkspaceRoot, "lesson/plan.md"),
          plan + "\n",
          { encoding: "utf8" },
        );
        await writeFile(
          path.join(agentWorkspaceRoot, "lesson/requirements.md"),
          requirements,
          {
            encoding: "utf8",
          },
        );

        const agentPrompt = buildLessonAgentPrompt(sessionId, workspaceId);
        writeLogLine(logPath, "starting lesson agent");

        agentResult = await runSparkLessonAgentLocal({
          rootDir: agentWorkspaceRoot,
          userId: "integration-user",
          prompt: agentPrompt,
          modelId: "chatgpt-gpt-5.2-codex",
          maxSteps:
            Number.parseInt(
              process.env.LLM_INTEGRATION_MAX_STEPS ?? "300",
              10,
            ) || 300,
          progress: {
            log: (message) => {
              writeLogLine(logPath, message);
            },
            startModelCall: () => Symbol("model-call"),
            recordModelUsage: () => {},
            finishModelCall: () => {},
            startStage: () => Symbol("stage"),
            finishStage: () => {},
            setActiveStages: () => {},
          },
        });

        writeLogLine(
          logPath,
          `agent done summary=${agentResult.doneSummary ?? ""}`,
        );

        return {
          status: "completed",
          sessionId,
          workspaceId,
          href: `/spark/lesson/${sessionId}`,
          workspaceRoot: agentWorkspaceRoot,
        };
      },
    });

    const chatSystemPrompt = [
      "You are Spark Chat.",
      "When the user asks to create a lesson, you MUST call create_lesson with a plan that matches the requested shape.",
      "Use plan.items to express 'parts'. For this request, use exactly 2 quiz items.",
      "Each quiz item MUST have quiz.questionKinds set to:",
      "- multiple-choice: 3",
      "- type-answer: 1 (marks 6-8 will be enforced by the lesson agent prompts)",
      "- info-card: 1 (info panel must come first in the quiz)",
      "After calling create_lesson, respond with a short confirmation and the returned href.",
    ].join("\n");

    const userQuery =
      "please create a lesson (2 parts, each part with 5 steps: questions (mix MCQ and 6-8 marker free text) and info panels) on GCSE P2 PD and currents (5 steps split as 3 MCQ/1 free text/1 panel, make sure info panels go before the material which is tested)";

    const tools: LlmToolSet = {
      create_lesson,
    };

    const chatResult = await runToolLoop({
      modelId: "chatgpt-gpt-5.2-codex",
      systemPrompt: chatSystemPrompt,
      prompt: userQuery,
      tools,
      maxSteps: 4,
      progress: {
        log: (message) => {
          writeLogLine(logPath, `[chat] ${message}`);
        },
        startModelCall: () => Symbol("model-call"),
        recordModelUsage: () => {},
        finishModelCall: () => {},
        startStage: () => Symbol("stage"),
        finishStage: () => {},
        setActiveStages: () => {},
      },
    });

    expect(observedCreateInput).toBeTruthy();
    expect(agentWorkspaceRoot).toBeTruthy();
    expect(agentResult).toBeTruthy();

    if (!observedCreateInput) {
      throw new Error(
        "create_lesson did not run (observedCreateInput is null).",
      );
    }
    if (!agentWorkspaceRoot) {
      throw new Error("lesson agent did not create a workspace directory.");
    }
    if (!agentResult) {
      throw new Error("lesson agent did not run (agentResult is null).");
    }

    const input: LessonCreateInput = observedCreateInput;
    expect(input.plan.items.length).toBe(2);
    for (const item of input.plan.items) {
      expect(item.kind).toBe("quiz");
      expect(item.quiz?.questionKinds?.length).toBeTruthy();
      const kinds = item.quiz?.questionKinds ?? [];
      expect(kinds.find((k) => k.kind === "multiple-choice")?.count).toBe(3);
      expect(kinds.find((k) => k.kind === "type-answer")?.count).toBe(1);
      expect(kinds.find((k) => k.kind === "info-card")?.count).toBe(1);
    }

    const workspaceRoot = agentWorkspaceRoot;
    const sessionText = await readFile(
      path.join(workspaceRoot, "lesson/output/session.json"),
      {
        encoding: "utf8",
      },
    );
    const rawSession = JSON.parse(sessionText) as Record<string, unknown>;
    const session: Session = SessionSchema.parse({
      ...rawSession,
      id: "llm-int-session",
      createdAt: new Date().toISOString(),
      status: "ready",
      nextLessonProposals: [],
    });
    expect(session.plan.length).toBe(2);
    expect(session.plan.every((item) => item.kind === "quiz")).toBe(true);

    for (const planItem of session.plan) {
      if (planItem.kind !== "quiz") {
        continue;
      }
      const quizText = await readFile(
        path.join(workspaceRoot, `lesson/output/quiz/${planItem.id}.json`),
        {
          encoding: "utf8",
        },
      );
      const rawQuiz = JSON.parse(quizText) as Record<string, unknown>;
      const quiz: QuizDefinition = QuizDefinitionSchema.parse({
        ...rawQuiz,
        id: planItem.id,
        progressKey: `lesson:llm-int-session:${planItem.id}`,
      });
      assertQuizShape(quiz);
    }

    const runResult: LessonAgentLocalRunResult = agentResult;
    expect(runResult.publishResult).toBeTruthy();
    expect(chatResult.text.length).toBeGreaterThan(0);

    writeLogLine(logPath, `chat result chars=${chatResult.text.length}`);
    writeLogLine(logPath, `DONE; inspect artifacts under: ${workDir}`);
    console.log(`LLM integration artifacts: ${workDir}`);
  });
});
