import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runSparkLessonAgentLocal } from "@spark/llm/agent/sparkAgentRunner";
import {
  runToolLoop,
  tool,
  type LlmDebugOptions,
  type LlmTextModelId,
  type LlmToolLoopResult,
  type LlmToolSet,
} from "@spark/llm/utils/llm";
import {
  QuizDefinitionSchema,
  SessionSchema,
  type QuizDefinition,
  type Session,
} from "@spark/schemas";
import { z } from "zod";

import { createCliCommand, createIntegerParser } from "../utils/cli";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";

type CliOptions = {
  query: string;
  chatModelId: LlmTextModelId;
  agentModelId: LlmTextModelId;
  chatMaxSteps: number;
  agentMaxSteps: number;
  artifactsDir?: string;
};

function requireNonEmptyEnv(name: string): void {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing ${name}.`);
  }
}

function writeLogLine(logPath: string, message: string): void {
  fs.appendFileSync(logPath, message.trimEnd() + "\n", { encoding: "utf8" });
}

function teeLogLine(logPath: string, message: string): void {
  const line = message.trimEnd();
  writeLogLine(logPath, line);
  process.stdout.write(line + "\n");
}

function teeLogBlock(logPath: string, header: string, block: string): void {
  teeLogLine(logPath, header);
  for (const line of block.split("\n")) {
    teeLogLine(logPath, line);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function nullableOptionalString(): z.ZodType<string | undefined> {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) {
        return undefined;
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
      return value;
    },
    z.string().trim().min(1).optional(),
  );
}

const quizQuestionKindSchema = z.enum([
  "multiple-choice",
  "type-answer",
  "info-card",
]);

const quizQuestionKindCountSchema = z
  .object({
    kind: quizQuestionKindSchema,
    count: z.number().int().min(1).max(50),
  })
  .strict();

const quizPreferencesSchema = z
  .object({
    questionCount: z.number().int().min(1).max(50).optional(),
    questionKinds: z.array(quizQuestionKindCountSchema).min(1).optional(),
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
        message: `questionKinds sum (${sum.toString()}) must equal questionCount (${value.questionCount.toString()})`,
      });
    }
  });

const planItemPreferencesSchema = z
  .object({
    kind: z.enum(["quiz", "problem", "media"]),
    title: nullableOptionalString(),
    description: nullableOptionalString(),
    quiz: quizPreferencesSchema.optional(),
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
    items: z.array(planItemPreferencesSchema).min(1).max(20),
  })
  .strict();

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
    topic: z.string().trim().min(1),
    title: nullableOptionalString(),
    level: nullableOptionalString(),
    goal: nullableOptionalString(),
    plan: planPreferencesSchema,
    materials: materialsSchema,
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
  const lines: string[] = ["# Lesson request", "", "## Topic", input.topic.trim()];
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
    lines.push(`- Total plan items: ${input.plan.items.length.toString()}`);
    let index = 0;
    for (const item of input.plan.items) {
      index += 1;
      const titleSuffix = item.title ? ` - ${item.title.trim()}` : "";
      if (item.kind === "quiz") {
        const questionCount =
          item.quiz?.questionCount ??
          (item.quiz?.questionKinds
            ? item.quiz.questionKinds.reduce((sum, entry) => sum + entry.count, 0)
            : null);
        const kinds =
          item.quiz?.questionKinds && item.quiz.questionKinds.length > 0
            ? item.quiz.questionKinds
                .map((entry) => `${entry.kind}: ${entry.count.toString()}`)
                .join(", ")
            : null;
        const detailBits = [
          questionCount ? `${questionCount.toString()} questions` : null,
          kinds ? `mix: ${kinds}` : null,
        ].filter((value): value is string => Boolean(value));
        const details = detailBits.length > 0 ? ` (${detailBits.join("; ")})` : "";
        lines.push(`- ${index.toString()}. quiz${titleSuffix}${details}`);
        continue;
      }
      lines.push(`- ${index.toString()}. ${item.kind}${titleSuffix}`);
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
        return `- ${(index + 1).toString()}. ${item.kind}${titleSuffix}`;
      }
      const questionCount =
        item.quiz?.questionCount ??
        (item.quiz?.questionKinds
          ? item.quiz.questionKinds.reduce((sum, entry) => sum + entry.count, 0)
          : null);
      const kinds =
        item.quiz?.questionKinds && item.quiz.questionKinds.length > 0
          ? item.quiz.questionKinds
              .map((entry) => `${entry.kind}: ${entry.count.toString()}`)
              .join(", ")
          : null;
      const detailBits = [
        questionCount ? `${questionCount.toString()} questions` : null,
        kinds ? `mix: ${kinds}` : null,
      ].filter((value): value is string => Boolean(value));
      const details = detailBits.length > 0 ? ` (${detailBits.join("; ")})` : "";
      return `- ${(index + 1).toString()}. quiz${titleSuffix}${details}`;
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
  const schemaDir = path.join(repoRoot, "web/src/lib/server/lessonAgent/schema");
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
    await writeFile(path.join(rootDir, "lesson/schema", file), content.trimEnd() + "\n", {
      encoding: "utf8",
    });
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

function buildLessonAgentPrompt(sessionId: string, workspaceId: string): string {
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
  let multipleChoice = 0;
  let typeAnswer = 0;
  let infoCard = 0;
  for (const question of quiz.questions) {
    switch (question.kind) {
      case "multiple-choice": {
        multipleChoice += 1;
        break;
      }
      case "type-answer": {
        typeAnswer += 1;
        break;
      }
      case "info-card": {
        infoCard += 1;
        break;
      }
    }
  }

  assert(quiz.questions.length === 5, "quiz must have 5 questions");
  assert(multipleChoice === 3, "quiz must have 3 multiple-choice questions");
  assert(typeAnswer === 1, "quiz must have 1 type-answer question");
  assert(infoCard === 1, "quiz must have 1 info-card question");

  const first = quiz.questions[0];
  assert(first.kind === "info-card", "quiz must start with an info-card");

  const typeAnswerQuestion = quiz.questions.find(
    (question) => question.kind === "type-answer",
  );
  assert(
    typeAnswerQuestion !== undefined,
    "quiz must include a type-answer question",
  );
  const marks = typeAnswerQuestion.marks;
  assert(typeof marks === "number", "type-answer question must include numeric marks");
  assert(marks >= 6 && marks <= 8, "type-answer marks must be in [6,8]");
}

function buildDefaultArtifactsDir(now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replaceAll(".", "");
  return path.join(
    WORKSPACE_PATHS.evalRoot,
    "output",
    "llm-smoke",
    "lesson-agent",
    stamp,
  );
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "lesson-agent-smoke",
    "Run an end-to-end lesson creation smoke run (ChatGPT tool loop -> local lesson agent -> mock publish).",
  );

  program
    .option(
      "--query <text>",
      "User query to send to the chat LLM",
      "please create a lesson (2 parts, each part with 5 steps: questions (mix MCQ and 6-8 marker free text) and info panels) on GCSE P2 PD and currents (5 steps split as 3 MCQ/1 free text/1 panel, make sure info panels go before the material which is tested)",
    )
    .option(
      "--chat-model <id>",
      "Chat model ID for the routing tool loop",
      "chatgpt-gpt-5.2-codex",
    )
    .option(
      "--agent-model <id>",
      "Agent model ID for the lesson-generation tool loop",
      "chatgpt-gpt-5.2-codex",
    )
    .option(
      "--chat-max-steps <number>",
      "Maximum tool-loop steps for the chat router",
      createIntegerParser({ name: "chat-max-steps", min: 1, max: 12 }),
      4,
    )
    .option(
      "--agent-max-steps <number>",
      "Maximum tool-loop steps for the lesson agent",
      createIntegerParser({ name: "agent-max-steps", min: 50, max: 2000 }),
      300,
    )
    .option(
      "--artifacts-dir <path>",
      "Directory to write artifacts/logs (default: eval/output/llm-smoke/lesson-agent/<timestamp>)",
    );

  const parsed = program.parse(argv, { from: "node" });
  const opts = parsed.opts<{
    query: string;
    chatModel: string;
    agentModel: string;
    chatMaxSteps: number;
    agentMaxSteps: number;
    artifactsDir?: string;
  }>();

  const schema = z.object({
    query: z.string().trim().min(1),
    chatModelId: z.string().trim().min(1),
    agentModelId: z.string().trim().min(1),
    chatMaxSteps: z.number().int().min(1).max(12),
    agentMaxSteps: z.number().int().min(50).max(2000),
    artifactsDir: z
      .string()
      .trim()
      .transform((value) => (value.length > 0 ? value : undefined))
      .optional(),
  });

  const validated = schema.parse({
    query: opts.query,
    chatModelId: opts.chatModel,
    agentModelId: opts.agentModel,
    chatMaxSteps: opts.chatMaxSteps,
    agentMaxSteps: opts.agentMaxSteps,
    artifactsDir: opts.artifactsDir,
  });

  return {
    query: validated.query,
    chatModelId: validated.chatModelId as LlmTextModelId,
    agentModelId: validated.agentModelId as LlmTextModelId,
    chatMaxSteps: validated.chatMaxSteps,
    agentMaxSteps: validated.agentMaxSteps,
    artifactsDir: validated.artifactsDir,
  };
}

async function runLessonSmoke(options: CliOptions): Promise<void> {
  const repoRoot = WORKSPACE_PATHS.repoRoot;

  requireNonEmptyEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  const hasChatGptAuth =
    Boolean(process.env.CHATGPT_AUTH_JSON_B64?.trim()) ||
    Boolean(process.env.CHATGPT_AUTH_JSON?.trim()) ||
    Boolean(process.env.CHATGPT_ACCESS_TOKEN?.trim()) ||
    Boolean(process.env.CHATGPT_ACCESS?.trim());
  assert(
    hasChatGptAuth,
    "Missing ChatGPT auth env (e.g. CHATGPT_AUTH_JSON_B64).",
  );

  const now = new Date();
  const artifactsDir = options.artifactsDir
    ? path.resolve(options.artifactsDir)
    : buildDefaultArtifactsDir(now);
  await mkdir(artifactsDir, { recursive: true });

  const logPath = path.join(artifactsDir, "integration.log");
  teeLogLine(logPath, `LLM smoke artifacts: ${artifactsDir}`);

  const debugRootDir = path.join(artifactsDir, "llm-debug");
  await mkdir(debugRootDir, { recursive: true });
  teeLogLine(logPath, `LLM debug snapshots: ${debugRootDir}`);

  const chatDebug: LlmDebugOptions = { rootDir: debugRootDir, stage: "chat" };
  const lessonAgentDebug: LlmDebugOptions = {
    rootDir: debugRootDir,
    stage: "lesson-agent",
  };

  const createLessonToolOutputSchema = z
    .object({
      status: z.literal("completed"),
      sessionId: z.string().trim().min(1),
      workspaceId: z.string().trim().min(1),
      href: z.string().trim().min(1),
      workspaceRoot: z.string().trim().min(1),
      input: lessonCreateSchema,
      agentDoneSummary: z.string().trim().min(1).nullable().optional(),
    })
    .strict();
  type CreateLessonToolOutput = z.infer<typeof createLessonToolOutputSchema>;

  const create_lesson = tool({
    description:
      "Create a lesson by writing a local workspace and running the lesson-generation agent to completion (mock publish).",
    inputSchema: lessonCreateSchema as z.ZodType<LessonCreateInput>,
    execute: async (input: LessonCreateInput) => {
      teeLogBlock(
        logPath,
        "[chat] create_lesson args:",
        JSON.stringify(input, null, 2),
      );

      const sessionId = "llm-smoke-session";
      const workspaceId = "llm-smoke-workspace";

      const workspaceRoot = path.join(artifactsDir, "agent-workspace");
      await mkdir(workspaceRoot, { recursive: true });
      await copyLessonAgentTemplates(repoRoot, workspaceRoot);

      const taskTemplate = await readFile(
        path.join(repoRoot, "web/src/lib/server/lessonAgent/task-template.md"),
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

      await writeFile(path.join(workspaceRoot, "brief.md"), buildLessonBrief(input), {
        encoding: "utf8",
      });
      await writeFile(
        path.join(workspaceRoot, "request.json"),
        JSON.stringify(request, null, 2) + "\n",
        { encoding: "utf8" },
      );
      await mkdir(path.join(workspaceRoot, "lesson"), { recursive: true });
      await writeFile(path.join(workspaceRoot, "lesson/task.md"), lessonTask, {
        encoding: "utf8",
      });
      await writeFile(path.join(workspaceRoot, "lesson/plan.md"), plan + "\n", {
        encoding: "utf8",
      });
      await writeFile(
        path.join(workspaceRoot, "lesson/requirements.md"),
        requirements,
        { encoding: "utf8" },
      );

      const agentPrompt = buildLessonAgentPrompt(sessionId, workspaceId);
      teeLogLine(logPath, "starting lesson agent");

      const agentResult: LessonAgentLocalRunResult = await runSparkLessonAgentLocal({
        rootDir: workspaceRoot,
        userId: "llm-smoke-user",
        prompt: agentPrompt,
        modelId: options.agentModelId,
        maxSteps: options.agentMaxSteps,
        progress: {
          log: (message) => {
            teeLogLine(logPath, `[agent] ${message}`);
          },
          startModelCall: () => Symbol("model-call"),
          recordModelUsage: () => {},
          finishModelCall: () => {},
          startStage: () => Symbol("stage"),
          finishStage: () => {},
          setActiveStages: () => {},
        },
        debug: lessonAgentDebug,
      });

      teeLogLine(
        logPath,
        `agent done summary=${agentResult.doneSummary ?? ""}`,
      );

      return {
        status: "completed",
        sessionId,
        workspaceId,
        href: `/spark/lesson/${sessionId}`,
        workspaceRoot,
        input,
        agentDoneSummary: agentResult.doneSummary,
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

  teeLogBlock(logPath, "chat system prompt:", chatSystemPrompt);
  teeLogBlock(logPath, "chat user query:", options.query);

  const tools: LlmToolSet = {
    create_lesson,
  };

  const chatResult = await runToolLoop({
    modelId: options.chatModelId,
    systemPrompt: chatSystemPrompt,
    prompt: options.query,
    tools,
    maxSteps: options.chatMaxSteps,
    debug: chatDebug,
    progress: {
      log: (message) => {
        teeLogLine(logPath, `[chat] ${message}`);
      },
      startModelCall: () => Symbol("model-call"),
      recordModelUsage: () => {},
      finishModelCall: () => {},
      startStage: () => Symbol("stage"),
      finishStage: () => {},
      setActiveStages: () => {},
    },
  });

  teeLogBlock(logPath, "chat response:", chatResult.text);

  const createLessonCalls = chatResult.steps.flatMap((step) => step.toolCalls);
  const createLessonCandidates = createLessonCalls.filter(
    (call) => call.toolName === "create_lesson",
  );
  assert(createLessonCandidates.length > 0, "chat did not call create_lesson");
  const successfulCreateLessonCall = [...createLessonCandidates]
    .reverse()
    .find((call) => !call.error);
  assert(
    successfulCreateLessonCall !== undefined,
    `create_lesson did not succeed: ${createLessonCandidates[createLessonCandidates.length - 1]?.error ?? "unknown error"}`,
  );
  const createLessonOutput: CreateLessonToolOutput =
    createLessonToolOutputSchema.parse(successfulCreateLessonCall.output);
  teeLogBlock(
    logPath,
    "create_lesson result:",
    JSON.stringify(createLessonOutput, null, 2),
  );

  const input: LessonCreateInput = createLessonOutput.input;
  assert(
    input.plan.items.length === 2,
    `expected plan.items length=2, got ${input.plan.items.length.toString()}`,
  );
  for (const item of input.plan.items) {
    assert(item.kind === "quiz", "expected each plan item kind to be quiz");
    const kinds = item.quiz?.questionKinds ?? [];
    const mcq = kinds.find((k) => k.kind === "multiple-choice")?.count ?? 0;
    const ta = kinds.find((k) => k.kind === "type-answer")?.count ?? 0;
    const info = kinds.find((k) => k.kind === "info-card")?.count ?? 0;
    assert(mcq === 3, "expected multiple-choice count=3");
    assert(ta === 1, "expected type-answer count=1");
    assert(info === 1, "expected info-card count=1");
  }

  const workspaceRoot = createLessonOutput.workspaceRoot;
  const sessionText = await readFile(path.join(workspaceRoot, "lesson/output/session.json"), {
    encoding: "utf8",
  });
  const rawSession = JSON.parse(sessionText) as Record<string, unknown>;
  const session: Session = SessionSchema.parse({
    ...rawSession,
    id: createLessonOutput.sessionId,
    createdAt: new Date().toISOString(),
    status: "ready",
    nextLessonProposals: [],
  });

  assert(session.plan.length === 2, "expected session.plan length=2");
  assert(session.plan.every((item) => item.kind === "quiz"), "expected only quiz plan items");

  for (const planItem of session.plan) {
    const quizText = await readFile(
      path.join(workspaceRoot, `lesson/output/quiz/${planItem.id}.json`),
      { encoding: "utf8" },
    );
    const rawQuiz = JSON.parse(quizText) as Record<string, unknown>;
    const quiz: QuizDefinition = QuizDefinitionSchema.parse({
      ...rawQuiz,
      id: planItem.id,
      sessionId: session.id,
      createdAt: new Date().toISOString(),
      status: "ready",
    });
    assertQuizShape(quiz);
  }

  teeLogLine(logPath, "DONE");
}

async function main(argv: readonly string[]): Promise<void> {
  ensureEvalEnvLoaded();
  const options = parseCliOptions(argv);
  await runLessonSmoke(options);
}

void main(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
