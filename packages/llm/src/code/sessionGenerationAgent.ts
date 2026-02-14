import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import { zodToJsonSchema } from "@alcyone-labs/zod-to-json-schema";

import {
  CodeProblemSchema,
  QuizDefinitionSchema,
  SessionSchema,
  SessionMediaDocSchema,
  type CodeProblem,
  type QuizDefinition,
  type Session,
} from "@spark/schemas";

import {
  estimateCallCostUsd,
  generateText,
  runToolLoop,
  tool,
  type LlmDebugOptions,
  type LlmTextModelId,
  type LlmToolConfig,
} from "../utils/llm";
import type { OpenAiReasoningEffort } from "../utils/openai-llm";
import type { JobProgressReporter, LlmUsageChunk } from "../utils/concurrency";
import { errorAsString } from "../utils/error";
import { loadEnvFromFile, loadLocalEnv } from "../utils/env";

const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.2-codex";
const DEFAULT_MAX_STEPS = 1000;
const DEFAULT_STORY_PLAN_ITEM_ID = "story";
const SUPPORTED_BRIEF_EXTENSIONS = [".txt", ".md", ".markdown"] as const;

function formatOptionalNumber(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  return value.toLocaleString("en-US");
}

function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0.0s";
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCurrencyUsd(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: safeValue < 1 ? 4 : 2,
    maximumFractionDigits: safeValue < 1 ? 4 : 2,
  }).format(safeValue);
}

function resolveOpenAiReasoningEffort(
  modelId: LlmTextModelId,
): OpenAiReasoningEffort | undefined {
  if (modelId.includes("gpt-5.2")) {
    return "medium";
  }
  return undefined;
}

type WorkspacePaths = {
  rootDir: string;
  workspaceDir: string;
  debugDir: string;
};

export type SessionAgentWorkspacePaths = WorkspacePaths;

export type SessionGenerationAgentOptions = {
  workingDirectory: string;
  briefFile?: string;
  brief?: string;
  topic?: string;
  userId: string;
  sessionId?: string;
  includeStory?: boolean;
  includeCoding?: boolean;
  storyPlanItemId?: string;
  storySegmentCount?: number;
  modelId?: LlmTextModelId;
  maxSteps?: number;
  progress?: JobProgressReporter;
};

export type SessionGenerationAgentResult = {
  sessionId: string;
  session: Session;
  quizzes: QuizDefinition[];
  problems: CodeProblem[];
};

type SessionAgentOutput = {
  session: Session;
  quizzes: QuizDefinition[];
  problems: CodeProblem[];
};

function useProgress(
  progress: JobProgressReporter | undefined,
): JobProgressReporter {
  return {
    log(message: string) {
      if (progress) {
        progress.log(message);
      } else {
        console.log(message);
      }
    },
    startModelCall(details: {
      modelId: string;
      uploadBytes: number;
      imageSize?: string;
    }) {
      if (progress) {
        return progress.startModelCall(details);
      }
      return Symbol("model-call");
    },
    recordModelUsage(handle: symbol, chunk: LlmUsageChunk) {
      if (progress) {
        progress.recordModelUsage(handle, chunk);
      }
    },
    finishModelCall(handle: symbol) {
      if (progress) {
        progress.finishModelCall(handle);
      }
    },
    startStage(stageName: string) {
      if (progress && progress.startStage) {
        return progress.startStage(stageName);
      }
      return Symbol("stage");
    },
    finishStage(handle: symbol) {
      if (progress && progress.finishStage) {
        progress.finishStage(handle);
      }
    },
    setActiveStages(stages: Iterable<string>) {
      if (progress && progress.setActiveStages) {
        progress.setActiveStages(stages);
      }
    },
  };
}

function resolveWorkspacePaths(workingDirectory: string): WorkspacePaths {
  const rootDir = path.resolve(workingDirectory);
  return {
    rootDir,
    workspaceDir: path.join(rootDir, "workspace"),
    debugDir: path.join(rootDir, "debug"),
  };
}

function formatSupportedExtensions(): string {
  return SUPPORTED_BRIEF_EXTENSIONS.join(", ");
}

async function readLessonBriefFile(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  const ext = path.extname(resolved).toLowerCase();
  if (
    !SUPPORTED_BRIEF_EXTENSIONS.includes(
      ext as (typeof SUPPORTED_BRIEF_EXTENSIONS)[number],
    )
  ) {
    throw new Error(
      `Lesson brief must be a text file (${formatSupportedExtensions()}); received "${filePath}"`,
    );
  }

  const buffer = await readFile(resolved);
  const prefix = buffer.subarray(0, 4).toString("utf8");
  if (prefix === "%PDF") {
    throw new Error(
      `Lesson brief must be plain text (${formatSupportedExtensions()}), not a PDF: "${filePath}"`,
    );
  }
  for (const byte of buffer) {
    if (byte === 0) {
      throw new Error(
        `Lesson brief must be plain text (${formatSupportedExtensions()}); file looks binary: "${filePath}"`,
      );
    }
  }
  const text = buffer.toString("utf8").replace(/\r\n/g, "\n").trim();
  if (text.length === 0) {
    throw new Error(`Lesson brief file is empty: "${filePath}"`);
  }
  return text;
}

function deriveTopicFromBrief(text: string): string {
  const lines = text.split(/\r?\n/u);
  for (const line of lines) {
    const match = line.match(
      /^\s*(?:topic|lesson topic|session topic|title)\s*:\s*(.+?)\s*$/iu,
    );
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmpty) {
    return "";
  }
  return firstNonEmpty.replace(/^\s*#+\s*/u, "").trim();
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  if (await fileExists(filePath)) {
    return;
  }
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, { encoding: "utf8" });
}

async function expandPromptTemplate(options: {
  template: string;
  workspaceDir: string;
}): Promise<{
  text: string;
  replacements: Array<{ path: string; chars: number }>;
}> {
  const { template, workspaceDir } = options;
  const regex = /{{\s*([^}]+?)\s*}}/g;
  let result = "";
  let lastIndex = 0;
  const replacements: Array<{ path: string; chars: number }> = [];
  const cache = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = regex.exec(template)) !== null) {
    const token = match[1]?.trim() ?? "";
    result += template.slice(lastIndex, match.index);
    lastIndex = regex.lastIndex;
    if (!token) {
      result += match[0];
      continue;
    }
    let content = cache.get(token);
    if (content === undefined) {
      try {
        const resolved = resolveWorkspacePath(workspaceDir, token);
        content = await readFile(resolved, "utf8");
      } catch (error) {
        const message = errorAsString(error);
        throw new Error(`Failed to expand {{${token}}}: ${message}`);
      }
      cache.set(token, content);
    }
    replacements.push({ path: token, chars: content.length });
    result += content;
  }
  result += template.slice(lastIndex);
  return { text: result, replacements };
}

async function listFilesRecursive(options: {
  rootDir: string;
  maxDepth: number;
}): Promise<string[]> {
  const results: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [
    { dir: options.rootDir, depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = await readdir(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current.dir, entry.name);
      const relative = path.relative(options.rootDir, entryPath);
      const normalized = relative.split(path.sep).join("/");
      results.push(normalized);
      if (entry.isDirectory() && current.depth < options.maxDepth) {
        stack.push({ dir: entryPath, depth: current.depth + 1 });
      }
    }
  }
  return results;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withWildcards = escaped
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${withWildcards}$`);
}

async function searchFiles(options: {
  rootDir: string;
  pattern: string;
  caseSensitive: boolean;
  glob?: string;
  maxResults: number;
  maxFileSizeBytes: number;
}): Promise<Array<{ file: string; line: number; text: string }>> {
  const files = await listFilesRecursive({
    rootDir: options.rootDir,
    maxDepth: 10,
  });
  const matcher = options.glob ? globToRegex(options.glob) : undefined;
  const regex = new RegExp(options.pattern, options.caseSensitive ? "g" : "gi");
  const results: Array<{ file: string; line: number; text: string }> = [];

  for (const relative of files) {
    if (results.length >= options.maxResults) {
      break;
    }
    const normalized = relative.split("/").join(path.sep);
    const fullPath = path.join(options.rootDir, normalized);
    const stats = await stat(fullPath).catch(() => undefined);
    if (!stats || !stats.isFile()) {
      continue;
    }
    if (stats.size > options.maxFileSizeBytes) {
      continue;
    }
    if (matcher && !matcher.test(relative)) {
      continue;
    }
    const content = await readFile(fullPath, "utf8").catch(() => undefined);
    if (!content) {
      continue;
    }
    if (content.includes("\0")) {
      continue;
    }
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      regex.lastIndex = 0;
      if (regex.test(lines[index] ?? "")) {
        results.push({
          file: relative,
          line: index + 1,
          text: lines[index] ?? "",
        });
        if (results.length >= options.maxResults) {
          break;
        }
      }
    }
  }
  return results;
}

function buildSchemaSummary(
  includeStory: boolean,
  includeCoding: boolean,
): string {
  const storySection = includeStory
    ? [
        "Story draft lives in story.md and may map to a media plan item later.",
        "storyTopic is the narrative hook/topic for the story (not the session topic).",
        "anchor_event/anchor_year/anchor_place describe the historical anchor for the story (real event/time/place), not the contest year unless the story itself is about that contest.",
        "visual_scene must be {setting, focal_object, props[]} with 1-3 props.",
      ]
    : ["Story disabled: omit story.md and do not include media plan items."];
  const codingSection = includeCoding
    ? [
        "Include code plan items and firestore/code/*.json outputs.",
        "Each code file is a CodeProblem doc (slug is the filename).",
      ]
    : ["Coding disabled: omit code plan items and firestore/code outputs."];
  return [
    "# Output JSON summary",
    "- Firestore-ready outputs live under firestore/:",
    "  - firestore/session.json (session doc)",
    "  - firestore/quiz/*.json (quiz docs; doc id = filename, omit id field)",
    "  - firestore/code/*.json (code docs; doc id = filename, omit slug field)",
    '- firestore/session.json must include: id, title, summary, tagline, emoji, createdAt, status="ready", topics (non-empty), plan (non-empty).',
    "- firestore/quiz/*.json must include gradingPrompt; type-answer questions must include marks and markScheme.",
    "- Do NOT include draft/grade fields in firestore outputs: planDraft, planGrade, quizzesDraft, quizzesGrade, problemsDraft, problemsGrade, storyTitle.",
    "- Drafts remain Markdown: session-plan.md, quizzes/*.md, problems/*.md, story.md.",
    "- Full field definitions live in firestore-schema.json.",
    "- Plan item icon should be an emoji (single character). If unsure, omit icon so the UI uses defaults.",
    "- Do not use generate_text to write firestore/*.json; write JSON directly after reading drafts + firestore-schema.json.",
    "",
    "Story:",
    ...storySection,
    "",
    "Coding:",
    ...codingSection,
    "",
    "Remember: do not create a monolithic session.json. Use Firestore outputs instead.",
  ].join("\n");
}

const FORBIDDEN_SESSION_FIELDS = [
  "planDraft",
  "planGrade",
  "quizzesDraft",
  "quizzesGrade",
  "problemsDraft",
  "problemsGrade",
  "storyTitle",
];

function validateQuizTemplateFields(
  quiz: QuizDefinition,
  quizId: string,
): void {
  const gradingPrompt =
    typeof quiz.gradingPrompt === "string" ? quiz.gradingPrompt.trim() : "";
  if (gradingPrompt.length === 0) {
    throw new Error(
      `firestore/quiz/${quizId}.json must include gradingPrompt as a non-empty string.`,
    );
  }
  for (const question of quiz.questions) {
    if (question.kind !== "type-answer") {
      continue;
    }
    const marks =
      typeof question.marks === "number" ? question.marks : undefined;
    if (!marks || !Number.isFinite(marks) || marks <= 0) {
      throw new Error(
        `firestore/quiz/${quizId}.json type-answer question "${question.id}" must include a positive marks value.`,
      );
    }
    const markScheme =
      typeof question.markScheme === "string" ? question.markScheme.trim() : "";
    if (markScheme.length === 0) {
      throw new Error(
        `firestore/quiz/${quizId}.json type-answer question "${question.id}" must include markScheme.`,
      );
    }
  }
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `firestore/session.json must include ${label} as a non-empty string.`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `firestore/session.json must include ${label} as a non-empty string.`,
    );
  }
  return trimmed;
}

function requireNonEmptyStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `firestore/session.json must include ${label} as a non-empty array of strings.`,
    );
  }
  const trimmed = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  if (trimmed.length === 0) {
    throw new Error(
      `firestore/session.json must include ${label} as a non-empty array of strings.`,
    );
  }
  return trimmed;
}

function validateSessionTemplateFields(rawSession: unknown): void {
  if (
    !rawSession ||
    typeof rawSession !== "object" ||
    Array.isArray(rawSession)
  ) {
    throw new Error("firestore/session.json must be a JSON object.");
  }
  const session = rawSession as Record<string, unknown>;
  const forbidden = FORBIDDEN_SESSION_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(session, field),
  );
  if (forbidden.length > 0) {
    throw new Error(
      `firestore/session.json must not include draft/grade fields: ${forbidden.join(", ")}.`,
    );
  }
  requireNonEmptyString(session.title, "title");
  requireNonEmptyString(session.summary, "summary");
  requireNonEmptyString(session.tagline, "tagline");
  requireNonEmptyString(session.emoji, "emoji");
  requireNonEmptyStringArray(session.topics, "topics");
  if (session.createdAt === undefined) {
    throw new Error("firestore/session.json must include createdAt.");
  }
  if (!Array.isArray(session.plan) || session.plan.length === 0) {
    throw new Error(
      "firestore/session.json must include a non-empty plan array.",
    );
  }
  const status =
    typeof session.status === "string" ? session.status.trim() : "";
  if (status.length === 0) {
    throw new Error('firestore/session.json must include status="ready".');
  }
  if (status !== "ready") {
    throw new Error(
      `firestore/session.json status must be "ready" (received "${status}").`,
    );
  }
}

function buildStoryPromptContent(): string {
  return [
    "# Story prompt guide (from generateStory)",
    "",
    "Use this when drafting story.md and plan.story fields.",
    "",
    "Story hook schema:",
    "- storyTopic: short narrative hook tied to the concept; not the session topic.",
    "- protagonist: historical or fictional protagonist in the story.",
    "- anchor_event/anchor_year/anchor_place: the historical anchor event/time/place for the story. This is NOT the contest year unless the story itself is about that contest.",
    "- stakes: what is at risk for the protagonist or community.",
    "- analogy_seed: metaphor that foreshadows the core trick (no step-by-step teaching).",
    "- modern_tie_in: modern domain that echoes the historical hook (short phrase).",
    "- visual_scene: {setting, focal_object, props[]} with 1–3 props.",
    "- naming_note: optional naming/wordplay note.",
    "",
    "Story constraints:",
    "- Stay grounded in the hook; do not change protagonist or setting once chosen.",
    "- Do not outline algorithms or step-by-step computations.",
    "- Align with promised skills/techniques without explicitly teaching them.",
    "- End with a line that tees up the warm-up quiz next.",
    "- Keep the narrative tight and age-appropriate.",
    "",
    "If historical details are uncertain, keep them generic or verify with web-search before asserting specifics.",
  ].join("\n");
}

function buildVerificationPromptContent(): string {
  return [
    "# Verification prompt",
    "",
    "Goal: verify Firestore JSON outputs match the markdown drafts exactly.",
    "",
    "Process:",
    "1) Read firestore/session.json and every draft file (session-plan.md, quizzes/*.md, problems/*.md, story.md if present).",
    "2) Read firestore/quiz/*.json and firestore/code/*.json outputs.",
    "3) Cross-check: counts, titles, IDs, prompts, answers, explanations, tags, techniques, constraints, examples, and tests.",
    "4) Ensure plan item IDs match quiz/problem filenames and contents.",
    '5) Ensure firestore/session.json includes title, summary, tagline, emoji, topics, status="ready", and no draft/grade fields.',
    "6) Ensure each quiz includes gradingPrompt and type-answer questions include marks + markScheme.",
    "7) Ensure quiz prompts/explanations are self-contained and do not reference the source documents, sections, or page numbers.",
    "8) Ensure story fields in story.md align with any media plan item (if present).",
    "9) If mismatches exist, fix Firestore JSON outputs (do not change drafts unless absolutely necessary).",
    "10) Write verification.md summarizing checks and confirming alignment.",
    "",
    "Parallelize independent reads/verifications when possible.",
  ].join("\n");
}

function safeToJsonSchema(
  schema: z.ZodType,
  name: string,
): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { target: "draft-07" }) as Record<
      string,
      unknown
    >;
  } catch {
    const fallback = zodToJsonSchema(schema, {
      name,
      target: "jsonSchema7",
    }) as Record<string, unknown>;
    return fallback;
  }
}

function enforceSessionTemplateSchema(schema: Record<string, unknown>): void {
  const definitions = schema.definitions as Record<string, unknown> | undefined;
  if (!definitions || typeof definitions !== "object") {
    return;
  }
  const sessionSchema = definitions.Session as
    | { required?: unknown; type?: unknown }
    | undefined;
  if (!sessionSchema || sessionSchema.type !== "object") {
    return;
  }
  const required = new Set<string>();
  const existing = sessionSchema.required;
  if (Array.isArray(existing)) {
    for (const entry of existing) {
      if (typeof entry === "string") {
        required.add(entry);
      }
    }
  }
  const mustHave = [
    "id",
    "title",
    "summary",
    "tagline",
    "emoji",
    "createdAt",
    "status",
    "topics",
    "plan",
  ];
  for (const field of mustHave) {
    required.add(field);
  }
  sessionSchema.required = Array.from(required);
}

function buildFirestoreSchemaJsonContent(): string {
  const sessionSchema = safeToJsonSchema(SessionSchema, "Session");
  enforceSessionTemplateSchema(sessionSchema);
  const quizSchema = safeToJsonSchema(QuizDefinitionSchema, "QuizDefinition");
  const codeSchema = safeToJsonSchema(CodeProblemSchema, "CodeProblem");
  const mediaSchema = safeToJsonSchema(
    SessionMediaDocSchema,
    "SessionMediaDoc",
  );
  const payload = {
    session: sessionSchema,
    quiz: quizSchema,
    code: codeSchema,
    media: mediaSchema,
  };
  return JSON.stringify(payload, null, 2);
}

function buildTaskContent(options: {
  topic: string;
  includeStory: boolean;
  includeCoding: boolean;
  brief: string;
}): string {
  const orderingLines = options.includeCoding
    ? [
        "Ordering (coding-first):",
        "- Draft problems and verify solvability with code execution.",
        "- Summarize verified techniques (summaries/techniques.md).",
        "- Draft/adjust session-plan.md based on verified techniques.",
        "- Draft quizzes from verified techniques (not just the initial plan).",
        "- Draft story if enabled.",
        "- Only after all drafts are verified, create firestore/*.json.",
      ]
    : [
        "Ordering:",
        "- Draft session-plan.md.",
        "- Draft quizzes from the finalized plan.",
        "- Draft story if enabled.",
        "- Only after all drafts are verified, create firestore/*.json.",
      ];
  return [
    "# Session Generation Task",
    "",
    `Topic: ${options.topic}`,
    `Include story: ${options.includeStory ? "yes" : "no"}`,
    `Include coding: ${options.includeCoding ? "yes" : "no"}`,
    "",
    "Goal: produce Firestore-ready JSON outputs (see firestore-schema.json).",
    "Use markdown drafts for session-plan.md, quizzes/quiz-XX.md, problems/problem-XX.md, and story.md.",
    "You control the workspace for this run; reuse or overwrite existing files from prior runs as needed.",
    "Create one quiz file per quiz set and one problem file per coding problem.",
    "For each draft: generate -> grade with feedback -> revise using feedback.",
    "When writing firestore/session.json, set session.id to a descriptive kebab-case slug derived from the topic (avoid generic ids like session-01).",
    'firestore/session.json must include title, summary, tagline, emoji, topics, and status="ready".',
    "Each firestore/quiz/*.json must include gradingPrompt and type-answer questions must include marks + markScheme.",
    "Quiz prompts/explanations must be self-contained; do not mention the source documents, sections, or page numbers.",
    "After writing or updating any firestore/*.json outputs, run validate_schema with schemaPath=firestore-schema.json. If it returns ok:false, fix and re-run until ok:true before proceeding.",
    "If validate_schema fails, fix firestore/*.json directly; do not regenerate draft prompts unless the drafts themselves are incorrect.",
    "Use generate_text tool only for drafting/grading Markdown (session-plan.md, quizzes/*.md, problems/*.md, story.md, feedback).",
    "Do NOT use generate_text to write firestore/*.json; read the drafts + firestore-schema.json and write JSON directly.",
    "Do not create prompts/*-json.md; JSON outputs should be authored directly via create_file/apply_patch.",
    'For problem draft/revision/verification prompts, explicitly require code execution to run the solution against all tests and fix failures. Always call generate_text with tools=["code-execution"] for those.',
    "generate_text should write markdown drafts directly to files via outputPath; do not paste large drafts into the tool response.",
    "generate_text should read its prompt from a file via promptPath; do not inline large prompts in tool arguments.",
    "Store prompts under prompts/ (e.g., prompts/session-plan-draft.md).",
    "Prompt templates may include {{path/to/file.md}} placeholders that will be replaced with file contents before calling generate_text.",
    "If only a subset of a large file is needed, create a shorter summary under summaries/ and reference that instead.",
    "",
    ...orderingLines,
    "Write Firestore JSON outputs under firestore/:",
    "- firestore/session.json",
    "- firestore/quiz/<quizId>.json",
    "- firestore/code/<problemSlug>.json",
    "Refer to firestore-schema.json for exact Firestore fields and document rules.",
    "Use story-prompt.md when drafting story.md.",
    "Use verification-prompt.md when writing verification.md.",
    "Math/LaTeX formatting: use $...$ for inline math and $$...$$ (or \\[...\\]) for display math.",
    "Avoid LaTeX list environments like \\begin{enumerate} and \\item; use Markdown lists instead.",
    "",
    "Brief (authoritative):",
    options.brief,
    "",
  ].join("\n");
}

function buildPlanTrackerContent(options: {
  includeStory: boolean;
  includeCoding: boolean;
}): string {
  const lines: string[] = [
    "# Plan",
    "- [running] Review brief and list hard requirements.",
  ];
  if (options.includeCoding) {
    lines.push(
      "- [pending] Draft problems/problem-XX.md (one per problem), verify with code execution, and revise.",
      "- [pending] Summarize verified techniques (summaries/techniques.md).",
      "- [pending] Draft session-plan.md based on verified techniques.",
    );
  } else {
    lines.push("- [pending] Draft session-plan.md (markdown).");
  }
  lines.push(
    "- [pending] Draft quizzes/quiz-XX.md (one per quiz set), grade, and revise.",
  );
  if (options.includeStory) {
    lines.push("- [pending] Draft story.md (markdown), grade, and revise.");
  }
  lines.push(
    "- [pending] Compile Firestore JSON outputs manually from drafts (no generate_text).",
    "- [pending] Run validate_schema (schemaPath=firestore-schema.json) and fix any errors.",
    "- [pending] Verify Firestore JSON outputs match markdown drafts (write verification.md).",
  );
  return lines.join("\n");
}

function buildAgentSystemPrompt(workspaceDir: string): string {
  return [
    "You are a session generation agent.",
    `You may only edit files under: ${workspaceDir}`,
    "Assume you control the workspace during this run; some files may already exist from earlier runs.",
    "Use workspace-relative paths only (no absolute paths, no .. segments).",
    "Use apply_patch for edits to existing files. For large rewrites, prefer delete_file then create_file with full contents.",
    "Use create_file for new files, move_file for renames, and delete_file for deletions.",
    "Use list_files and rg_search to explore files; avoid shell usage.",
    "Use read_files to fetch multiple files at once.",
    "Use read_file for full file contents when needed.",
    "Use read_file_summary (fast model) for quick checks; provide a short question.",
    "Work in the shortest path possible: avoid repeated listing/reading unless needed.",
    "Maintain plan.md with [running] and [done] updates as you progress.",
    "Use generate_text tool for drafting/grading Markdown only. Do not use it for JSON outputs.",
    "When using generate_text, set outputPath so it writes files directly.",
    "When using generate_text, set promptPath so it reads prompts from files (avoid inline prompts).",
    "Prompt templates may include {{path/to/file.md}} placeholders that will be expanded before calling generate_text.",
    "If prompts need context from large files, create summaries under summaries/ and reference those instead.",
    "Prompt files must be self-contained: include all necessary context via placeholders or summaries. Do not reference p2/p3 or other content unless it is included in the prompt text.",
    "For each draft: generate -> grade (write feedback) -> revise using feedback.",
    "Do not write any firestore/*.json outputs until all drafts are verified and finalized.",
    "Never call generate_text with outputPath under firestore/ or any .json file.",
    "Do not create prompts/*-json.md; write firestore/*.json manually using create_file/apply_patch.",
    "If coding is enabled, draft and verify problems first, then derive techniques and update session-plan.md before drafting quizzes.",
    'For all problem draft/revision/verification generate_text calls, set tools=["code-execution"] and include an explicit prompt instruction to run the solution against all tests and fix any failures.',
    "Read story-prompt.md before drafting story.md.",
    "Read verification-prompt.md before writing verification.md.",
    "Math/LaTeX formatting: use $...$ for inline math and $$...$$ (or \\[...\\]) for display math.",
    "Avoid LaTeX list environments like \\begin{enumerate} and \\item; use Markdown lists instead.",
    "Read firestore-schema.json before writing firestore/*.json outputs.",
    "Write Firestore JSON outputs under firestore/session.json, firestore/quiz/*.json, firestore/code/*.json.",
    "Use a descriptive kebab-case session.id in firestore/session.json; avoid generic ids like session-01.",
    "Use Markdown for drafts; only firestore/*.json files should contain JSON.",
    "When creating firestore/*.json, read the finalized drafts + schema and author JSON directly; do not generate JSON via prompts.",
    "If validate_schema fails, fix firestore/*.json directly; do not regenerate drafts unless the drafts are wrong.",
    "Store prompts under prompts/ (e.g., prompts/session-plan-draft.md).",
    "Create quiz drafts under quizzes/quiz-01.md, quizzes/quiz-02.md, etc.",
    "Create problem drafts under problems/problem-01.md, problems/problem-02.md, etc.",
    "Write feedback in feedback/ with matching filenames (e.g., feedback/quiz-01.md).",
    "After Firestore JSON outputs are written, re-read all draft files and firestore/*.json, verify alignment, and write verification.md.",
    "You can call validate_schema (schemaPath=firestore-schema.json) to check Firestore outputs mid-run; fix any errors before final verification.",
    "If independent steps exist, call tools in parallel (e.g., read multiple files or verify multiple problems simultaneously).",
    "Do not output large JSON in the chat response; write it to firestore/*.json.",
    "Stop after verification.md is written; respond DONE with no further tool calls.",
  ].join("\n");
}

function buildAgentUserPrompt(options: {
  workspaceDir: string;
  includeStory: boolean;
  includeCoding: boolean;
  validationError?: string;
}): string {
  const sections = [
    `Workspace: ${options.workspaceDir}`,
    "Files:",
    "- task.md (goal + brief)",
    "- schema.md (schema summary)",
    "- firestore-schema.json (Firestore JSON schema)",
    "- story-prompt.md (story hook guidance)",
    "- verification-prompt.md (verification guidance)",
    "- plan.md (status tracker)",
    "- session-plan.md (draft plan markdown)",
    "- quizzes/quiz-XX.md (one per quiz set)",
    "- problems/problem-XX.md (one per coding problem)",
    "- story.md (draft story markdown, if includeStory)",
    "- feedback/*.md (grading feedback)",
    "- prompts/*.md (generation + grading prompts)",
    "- summaries/*.md (shortened context extracts when full files are too large)",
    "- firestore/session.json (session doc)",
    "- firestore/quiz/*.json (quiz docs)",
    "- firestore/code/*.json (code docs)",
    "- verification.md (final cross-check summary)",
    "",
    `Include story: ${options.includeStory ? "yes" : "no"}`,
    `Include coding: ${options.includeCoding ? "yes" : "no"}`,
    "Workspace may already contain files from prior runs; overwrite or reuse as needed.",
  ];
  if (options.validationError) {
    sections.push("", "Validation errors to fix:", options.validationError);
  }
  sections.push(
    "",
    "Use the brief as authoritative. Respect exactness rules from the brief.",
    "Use firestore-schema.json for the Firestore JSON output fields and rules.",
    'firestore/session.json must include title, summary, tagline, emoji, topics, and status="ready" (no draft/grade fields).',
    "firestore/quiz/*.json must include gradingPrompt and type-answer questions must include marks + markScheme.",
    "Set session.id in firestore/session.json to a descriptive kebab-case slug derived from the topic (avoid generic ids like session-01).",
    "Plan item icons must be emoji (single character). If unsure, omit icon so the UI uses defaults.",
    "Ensure quiz/problem counts match the plan parts.",
    "Proceed in order:",
    options.includeCoding
      ? "problems/problem-XX.md -> verify with code execution -> summaries/techniques.md -> session-plan.md -> quizzes/quiz-XX.md -> story.md (if needed) -> firestore outputs."
      : "session-plan.md -> quizzes/quiz-XX.md -> story.md (if needed) -> firestore outputs.",
    "For each draft: generate -> grade (write feedback) -> revise using feedback.",
    "Use generate_text for drafting and grading Markdown only; set promptPath/outputPath so it reads/writes files directly; enable web-search or code-execution only when needed.",
    "Do NOT use generate_text to write firestore/*.json; read drafts + firestore-schema.json and write JSON directly.",
    "Do not create prompts/*-json.md; author firestore/*.json with create_file/apply_patch.",
    "Use read_files to pull multiple files in one call; use read_file_summary for quick checks instead of reading full files.",
    "Problem drafting, revision, and verification must use generate_text with code-execution.",
    "Problem prompts must explicitly instruct the model to run the solution against all tests and fix any failures.",
    "Use story-prompt.md for story fields and historical anchor meaning.",
    "Use verification-prompt.md during the final cross-check.",
    "Math/LaTeX formatting: use $...$ for inline math and $$...$$ (or \\[...\\]) for display math.",
    "Avoid LaTeX list environments like \\begin{enumerate} and \\item; use Markdown lists instead.",
    "Prompt templates may include {{path/to/file.md}} placeholders that will be expanded before calling generate_text.",
    "If a prompt needs only part of a large file, create a summaries/*.md file and reference that instead of the full file.",
    "Ensure every prompt file is self-contained; include needed context via {{...}} or summaries.",
    "Parallelize independent tool calls where possible.",
    "For large rewrites, delete_file then create_file with full contents.",
    "After writing each draft and feedback, update plan.md statuses.",
    "If validate_schema fails, fix firestore/*.json directly; do not redo drafts unless the drafts are wrong.",
    "Before finishing, re-read all drafts and firestore/*.json and write verification.md confirming alignment.",
    "Use validate_schema (schemaPath=firestore-schema.json) to catch schema issues early; repair errors before final verification.",
    "After verification.md is complete, reply DONE (no summary).",
  );
  return sections.join("\n");
}

function resolveWorkspacePath(
  workspaceDir: string,
  targetPath: string,
): string {
  if (path.isAbsolute(targetPath)) {
    throw new Error(`Absolute paths are not allowed: "${targetPath}".`);
  }
  const rawParts = targetPath.split(/[/\\]+/);
  if (rawParts.some((part) => part === "..")) {
    throw new Error(`Path traversal ("..") is not allowed: "${targetPath}".`);
  }
  const resolved = path.resolve(workspaceDir, targetPath);
  const relative = path.relative(workspaceDir, resolved);
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  for (const part of parts) {
    if (part === "..") {
      throw new Error(`Path "${targetPath}" is outside workspace.`);
    }
  }
  if (relative.length === 0) {
    return resolved;
  }
  if (parts.length === 0) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  return resolved;
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} {
  const match = line.match(/^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/);
  if (!match) {
    throw new Error(`Invalid hunk header: ${line}`);
  }
  const oldStart = Number.parseInt(match[1], 10);
  const oldLines = match[2] ? Number.parseInt(match[2], 10) : 1;
  const newStart = Number.parseInt(match[3], 10);
  const newLines = match[4] ? Number.parseInt(match[4], 10) : 1;
  return { oldStart, oldLines, newStart, newLines };
}

function applyV4Patch(original: string, diff: string): string {
  const originalLines = splitLines(original);
  const diffLines = splitLines(diff);
  const filtered = diffLines.filter((line) => !line.startsWith("*** "));
  const hunks: string[][] = [];
  let current: string[] = [];
  for (const line of filtered) {
    if (line.startsWith("@@")) {
      if (current.length > 0) {
        hunks.push(current);
      }
      current = [];
      continue;
    }
    if (line.length === 0) {
      current.push(" " + line);
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    hunks.push(current);
  }

  let index = 0;
  const output: string[] = [];

  for (const hunk of hunks) {
    const anchor = hunk.find(
      (line) => line.startsWith(" ") || line.startsWith("-"),
    );
    if (anchor) {
      const expected = anchor.slice(1);
      let foundIndex = -1;
      for (let i = index; i < originalLines.length; i += 1) {
        if (originalLines[i] === expected) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex >= 0 && foundIndex > index) {
        output.push(...originalLines.slice(index, foundIndex));
        index = foundIndex;
      }
    }

    for (const line of hunk) {
      if (line.startsWith(" ")) {
        const expected = line.slice(1);
        const actual = originalLines[index] ?? "";
        if (actual !== expected) {
          throw new Error(
            `Patch context mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        output.push(actual);
        index += 1;
        continue;
      }
      if (line.startsWith("-")) {
        const expected = line.slice(1);
        const actual = originalLines[index] ?? "";
        if (actual !== expected) {
          throw new Error(
            `Patch removal mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        index += 1;
        continue;
      }
      if (line.startsWith("+")) {
        output.push(line.slice(1));
        continue;
      }
      throw new Error(`Unsupported diff line: ${line}`);
    }
  }

  output.push(...originalLines.slice(index));
  return output.join("\n");
}

function applyUnifiedDiff(original: string, diff: string): string {
  const originalLines = splitLines(original);
  const diffLines = splitLines(diff);
  let originalIndex = 0;
  const output: string[] = [];
  let diffIndex = 0;

  while (diffIndex < diffLines.length) {
    const line = diffLines[diffIndex];
    if (!line.startsWith("@@")) {
      diffIndex += 1;
      continue;
    }
    const { oldStart } = parseHunkHeader(line);
    const targetIndex = Math.max(oldStart - 1, 0);
    if (targetIndex < originalIndex) {
      throw new Error("Patch hunk overlaps earlier changes.");
    }
    output.push(...originalLines.slice(originalIndex, targetIndex));
    originalIndex = targetIndex;
    diffIndex += 1;

    while (diffIndex < diffLines.length) {
      const hunkLine = diffLines[diffIndex];
      if (hunkLine.startsWith("@@")) {
        break;
      }
      if (hunkLine.startsWith(" ")) {
        const expected = hunkLine.slice(1);
        const actual = originalLines[originalIndex] ?? "";
        if (actual !== expected) {
          throw new Error(
            `Patch context mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        output.push(actual);
        originalIndex += 1;
      } else if (hunkLine.startsWith("-")) {
        const expected = hunkLine.slice(1);
        const actual = originalLines[originalIndex] ?? "";
        if (actual !== expected) {
          throw new Error(
            `Patch removal mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        originalIndex += 1;
      } else if (hunkLine.startsWith("+")) {
        output.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith("\\ No newline")) {
        // ignore
      } else {
        throw new Error(`Unsupported diff line: ${hunkLine}`);
      }
      diffIndex += 1;
    }
  }

  output.push(...originalLines.slice(originalIndex));
  return output.join("\n");
}

function applyDiff(original: string, diff: string): string {
  if (diff.trim().length === 0) {
    return original;
  }
  if (diff.includes("*** Begin Patch")) {
    return applyV4Patch(original, diff);
  }
  if (diff.includes("@@")) {
    const hasRangeHeader = diff
      .split("\n")
      .some(
        (line) =>
          line.startsWith("@@") && line.includes("-") && line.includes("+"),
      );
    if (!hasRangeHeader) {
      return applyV4Patch(original, diff);
    }
    return applyUnifiedDiff(original, diff);
  }

  const lines = splitLines(diff);
  const hasMarkers = lines.some(
    (line) =>
      line.startsWith("+") || line.startsWith("-") || line.startsWith(" "),
  );
  if (!hasMarkers) {
    return diff;
  }
  const allPlus = lines.every((line) => line === "" || line.startsWith("+"));
  if (allPlus) {
    return lines
      .map((line) => (line.startsWith("+") ? line.slice(1) : line))
      .join("\n");
  }
  const allSpaceOrPlus = lines.every(
    (line) => line === "" || line.startsWith("+") || line.startsWith(" "),
  );
  if (allSpaceOrPlus) {
    return lines
      .map((line) => {
        if (line.startsWith("+") || line.startsWith(" ")) {
          return line.slice(1);
        }
        return line;
      })
      .join("\n");
  }
  throw new Error("Unsupported diff format (missing hunk headers).");
}

function formatIssueValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return value.toString();
    case "undefined":
      return "undefined";
    default: {
      try {
        const json = JSON.stringify(value);
        return typeof json === "string" ? json : "[unserializable]";
      } catch {
        return "[unserializable]";
      }
    }
  }
}

function buildValidationError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .map((issue) => {
        const pathLabel =
          issue.path.length > 0 ? issue.path.join(".") : "(root)";
        const codeLabel = issue.code ? ` [${issue.code}]` : "";
        const expected =
          "expected" in issue && issue.expected !== undefined
            ? ` expected=${formatIssueValue(issue.expected)}`
            : "";
        const received =
          "received" in issue && issue.received !== undefined
            ? ` received=${formatIssueValue(issue.received)}`
            : "";
        return `${pathLabel}: ${issue.message}${codeLabel}${expected}${received}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

async function readJsonFile(pathname: string): Promise<unknown> {
  const text = await readFile(pathname, { encoding: "utf8" });
  return JSON.parse(text);
}

async function loadFirestoreOutputs(options: {
  paths: WorkspacePaths;
  includeStory: boolean;
  includeCoding: boolean;
}): Promise<SessionAgentOutput> {
  const sessionPath = path.join(
    options.paths.workspaceDir,
    "firestore",
    "session.json",
  );
  const rawSession = await readJsonFile(sessionPath);
  validateSessionTemplateFields(rawSession);
  const session = SessionSchema.parse(rawSession);
  if (!session.plan || session.plan.length === 0) {
    throw new Error("firestore/session.json must include a non-empty plan.");
  }

  const quizDir = path.join(options.paths.workspaceDir, "firestore", "quiz");
  const quizEntries = await readdir(quizDir, { withFileTypes: true }).catch(
    () => [],
  );
  const quizzes: QuizDefinition[] = [];
  for (const entry of quizEntries) {
    if (!entry.isFile() || path.extname(entry.name) !== ".json") {
      continue;
    }
    const quizId = path.basename(entry.name, ".json");
    const rawDoc = await readJsonFile(path.join(quizDir, entry.name));
    if (rawDoc && typeof rawDoc === "object" && "id" in rawDoc) {
      throw new Error(
        `firestore/quiz/${entry.name} should omit "id" (doc id is the filename).`,
      );
    }
    const quiz = QuizDefinitionSchema.parse({ id: quizId, ...(rawDoc ?? {}) });
    validateQuizTemplateFields(quiz, quizId);
    quizzes.push(quiz);
  }

  const codeDir = path.join(options.paths.workspaceDir, "firestore", "code");
  const codeEntries = await readdir(codeDir, { withFileTypes: true }).catch(
    () => [],
  );
  const problems: CodeProblem[] = [];
  for (const entry of codeEntries) {
    if (!entry.isFile() || path.extname(entry.name) !== ".json") {
      continue;
    }
    const slug = path.basename(entry.name, ".json");
    const rawDoc = await readJsonFile(path.join(codeDir, entry.name));
    if (rawDoc && typeof rawDoc === "object" && "slug" in rawDoc) {
      throw new Error(
        `firestore/code/${entry.name} should omit "slug" (doc id is the filename).`,
      );
    }
    const problem = CodeProblemSchema.parse({
      slug,
      ...(rawDoc ?? {}),
    });
    problems.push(problem);
  }

  const planQuizIds = session.plan
    .filter((item) => item.kind === "quiz")
    .map((item) => item.id);
  const planProblemIds = session.plan
    .filter((item) => item.kind === "coding_problem")
    .map((item) => item.id);
  const quizIds = new Set(quizzes.map((quiz) => quiz.id));
  const problemIds = new Set(problems.map((problem) => problem.slug));

  if (planQuizIds.length !== quizzes.length) {
    throw new Error(
      `Plan has ${planQuizIds.length} quiz items but firestore/quiz has ${quizzes.length} docs.`,
    );
  }
  for (const id of planQuizIds) {
    if (!quizIds.has(id)) {
      throw new Error(`Plan quiz id '${id}' missing firestore/quiz/${id}.json`);
    }
  }

  if (options.includeCoding) {
    if (planProblemIds.length !== problems.length) {
      throw new Error(
        `Plan has ${planProblemIds.length} coding_problem items but firestore/code has ${problems.length} docs.`,
      );
    }
    for (const id of planProblemIds) {
      if (!problemIds.has(id)) {
        throw new Error(
          `Plan coding_problem id '${id}' missing firestore/code/${id}.json`,
        );
      }
    }
  } else if (problems.length > 0 || planProblemIds.length > 0) {
    throw new Error("Coding disabled but code docs or plan items are present.");
  }

  return {
    session,
    quizzes,
    problems,
  };
}

async function prepareWorkspace(options: {
  paths: WorkspacePaths;
  brief: string;
  topic: string;
  includeStory: boolean;
  includeCoding: boolean;
}): Promise<void> {
  await ensureDir(options.paths.workspaceDir);
  await ensureDir(options.paths.debugDir);
  await ensureDir(path.join(options.paths.workspaceDir, "quizzes"));
  await ensureDir(path.join(options.paths.workspaceDir, "problems"));
  await ensureDir(path.join(options.paths.workspaceDir, "feedback"));
  await ensureDir(path.join(options.paths.workspaceDir, "prompts"));
  await ensureDir(path.join(options.paths.workspaceDir, "summaries"));
  await ensureDir(path.join(options.paths.workspaceDir, "firestore", "quiz"));
  await ensureDir(path.join(options.paths.workspaceDir, "firestore", "code"));

  await ensureFile(
    path.join(options.paths.workspaceDir, "brief.md"),
    options.brief,
  );
  await ensureFile(
    path.join(options.paths.workspaceDir, "schema.md"),
    buildSchemaSummary(options.includeStory, options.includeCoding),
  );
  await ensureFile(
    path.join(options.paths.workspaceDir, "firestore-schema.json"),
    buildFirestoreSchemaJsonContent(),
  );
  await ensureFile(
    path.join(options.paths.workspaceDir, "story-prompt.md"),
    buildStoryPromptContent(),
  );
  await ensureFile(
    path.join(options.paths.workspaceDir, "verification-prompt.md"),
    buildVerificationPromptContent(),
  );
  await ensureFile(
    path.join(options.paths.workspaceDir, "task.md"),
    buildTaskContent({
      topic: options.topic,
      includeStory: options.includeStory,
      includeCoding: options.includeCoding,
      brief: options.brief,
    }),
  );
  await ensureFile(
    path.join(options.paths.workspaceDir, "plan.md"),
    buildPlanTrackerContent({
      includeStory: options.includeStory,
      includeCoding: options.includeCoding,
    }),
  );
}

function loadAgentEnv(): void {
  loadLocalEnv();
  const currentFile = fileURLToPath(import.meta.url);
  const fileDir = path.dirname(currentFile);
  const repoRoot = path.resolve(fileDir, "..", "..", "..", "..");
  loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });
}

function buildSessionAgentTools(options: {
  paths: WorkspacePaths;
  progress?: JobProgressReporter;
  includeStory: boolean;
  includeCoding: boolean;
}) {
  const { paths, progress, includeStory, includeCoding } = options;
  const log = (message: string) => {
    if (progress) {
      progress.log(message);
    } else {
      console.log(message);
    }
  };
  const logPath = path.join(paths.debugDir, "tool-calls.jsonl");
  let totalGenerateCostUsd = 0;
  let totalGenerateMs = 0;
  let totalSummaryCostUsd = 0;
  let totalSummaryMs = 0;
  const logTool = async (entry: {
    tool: string;
    input: unknown;
    output?: unknown;
    error?: string;
  }) => {
    const payload = {
      time: new Date().toISOString(),
      ...entry,
    };
    await appendFile(logPath, `${JSON.stringify(payload)}\n`, "utf8").catch(
      () => undefined,
    );
  };
  return {
    list_dir: tool({
      description: "List entries in a workspace directory.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        try {
          const resolved = resolveWorkspacePath(paths.workspaceDir, inputPath);
          const entries = await readdir(resolved, { withFileTypes: true });
          const output = {
            path: inputPath,
            entries: entries.map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? "dir" : "file",
            })),
          };
          await logTool({
            tool: "list_dir",
            input: { path: inputPath },
            output,
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "list_dir",
            input: { path: inputPath },
            error: message,
          });
          throw error;
        }
      },
    }),
    validate_schema: tool({
      description:
        "Validate firestore outputs against schema and plan. Provide schemaPath to the JSON schema file. Returns errors without throwing so the agent can repair.",
      inputSchema: z
        .object({
          schemaPath: z.string().trim().min(1),
        })
        .strict(),
      execute: async ({ schemaPath }) => {
        try {
          const resolvedSchemaPath = resolveWorkspacePath(
            paths.workspaceDir,
            schemaPath,
          );
          const schemaText = await readFile(resolvedSchemaPath, "utf8");
          const schemaJson = JSON.parse(schemaText) as Record<string, unknown>;
          if (!schemaJson || typeof schemaJson !== "object") {
            throw new Error("Schema JSON must be an object.");
          }
          const outputs = await loadFirestoreOutputs({
            paths,
            includeStory,
            includeCoding,
          });
          const output = {
            ok: true,
            sessionId: outputs.session.id,
            quizzes: outputs.quizzes.map((quiz) => quiz.id),
            problems: outputs.problems.map((problem) => problem.slug),
          };
          await logTool({
            tool: "validate_schema",
            input: { schemaPath },
            output,
          });
          return output;
        } catch (error) {
          const message = buildValidationError(error);
          const output = { ok: false, error: message };
          await logTool({
            tool: "validate_schema",
            input: { schemaPath },
            output,
          });
          return output;
        }
      },
    }),
    list_files: tool({
      description: "Recursively list files under a workspace path.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        maxDepth: z.number().int().min(0).max(20).optional(),
      }),
      execute: async ({ path: inputPath, maxDepth }) => {
        try {
          const resolved = resolveWorkspacePath(paths.workspaceDir, inputPath);
          const items = await listFilesRecursive({
            rootDir: resolved,
            maxDepth: maxDepth ?? 4,
          });
          const entries: Array<{
            path: string;
            type: "file" | "dir";
            sizeBytes?: number;
          }> = [];
          for (const entry of items) {
            const fullPath = path.join(resolved, entry);
            const stats = await stat(fullPath).catch(() => undefined);
            if (!stats) {
              continue;
            }
            entries.push({
              path: entry,
              type: stats.isDirectory() ? "dir" : "file",
              ...(stats.isFile() ? { sizeBytes: stats.size } : {}),
            });
          }
          const output = { path: inputPath, entries };
          const sampleNames = entries
            .slice(0, 10)
            .map((entry) =>
              entry.type === "dir" ? `${entry.path}/` : entry.path,
            )
            .join(", ");
          log(
            `[agent-tool] list_files path=${inputPath} entries=${entries.length}${
              sampleNames.length > 0 ? ` sample=${sampleNames}` : ""
            }`,
          );
          await logTool({
            tool: "list_files",
            input: { path: inputPath, maxDepth },
            output: {
              path: inputPath,
              entries: entries.slice(0, 10),
              totalEntries: entries.length,
            },
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "list_files",
            input: { path: inputPath, maxDepth },
            error: message,
          });
          throw error;
        }
      },
    }),
    read_file: tool({
      description: "Read a text file from the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        try {
          const resolved = resolveWorkspacePath(paths.workspaceDir, inputPath);
          const content = await readFile(resolved, { encoding: "utf8" });
          const bytes = Buffer.byteLength(content, "utf8");
          const output = { path: inputPath, content, bytes };
          log(`[agent-tool] read_file path=${inputPath} bytes=${bytes}`);
          await logTool({
            tool: "read_file",
            input: { path: inputPath },
            output: {
              path: inputPath,
              chars: content.length,
              bytes,
            },
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "read_file",
            input: { path: inputPath },
            error: message,
          });
          throw error;
        }
      },
    }),
    read_files: tool({
      description: "Read multiple text files from the workspace.",
      inputSchema: z.object({
        paths: z.array(z.string().trim().min(1)).min(1),
      }),
      execute: async ({ paths: inputPaths }) => {
        try {
          const entries = await Promise.all(
            inputPaths.map(async (inputPath) => {
              const resolved = resolveWorkspacePath(
                paths.workspaceDir,
                inputPath,
              );
              const content = await readFile(resolved, { encoding: "utf8" });
              const bytes = Buffer.byteLength(content, "utf8");
              return {
                path: inputPath,
                content,
                bytes,
              };
            }),
          );
          const output = { files: entries };
          log(`[agent-tool] read_files paths=${inputPaths.join(", ")}`);
          await logTool({
            tool: "read_files",
            input: { paths: inputPaths },
            output: {
              files: entries.map((entry) => ({
                path: entry.path,
                chars: entry.content.length,
                bytes: entry.bytes,
              })),
            },
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "read_files",
            input: { paths: inputPaths },
            error: message,
          });
          throw error;
        }
      },
    }),
    read_file_summary: tool({
      description:
        "Summarize or answer a focused question about a file using a fast model.",
      inputSchema: z
        .object({
          path: z.string().trim().min(1),
          question: z.string().trim().min(1),
        })
        .strict(),
      execute: async ({ path: inputPath, question }) => {
        try {
          const resolved = resolveWorkspacePath(paths.workspaceDir, inputPath);
          const content = await readFile(resolved, { encoding: "utf8" });
          const bytes = Buffer.byteLength(content, "utf8");
          const summaryPrompt = [
            "You are a fast file analyst. Answer the question concisely.",
            "If the file does not require action based on the question, reply only with NO_CHANGES.",
            "",
            `Question: ${question}`,
            "",
            "File contents:",
            content,
          ].join("\n");
          type UsageState = {
            tokens?: LlmUsageChunk["tokens"];
            modelVersion?: string;
          };
          const usageState: UsageState = {};
          const mergeTokens = (
            current: LlmUsageChunk["tokens"] | undefined,
            next: LlmUsageChunk["tokens"] | undefined,
          ): LlmUsageChunk["tokens"] | undefined => {
            if (!next) {
              return current;
            }
            if (!current) {
              return next;
            }
            return {
              promptTokens: next.promptTokens ?? current.promptTokens,
              cachedTokens: next.cachedTokens ?? current.cachedTokens,
              responseTokens: next.responseTokens ?? current.responseTokens,
              responseImageTokens:
                next.responseImageTokens ?? current.responseImageTokens,
              thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
              totalTokens: next.totalTokens ?? current.totalTokens,
              toolUsePromptTokens:
                next.toolUsePromptTokens ?? current.toolUsePromptTokens,
            };
          };
          const trackingProgress: JobProgressReporter = (() => {
            const handleMap = new Map<symbol, symbol>();
            return {
              log: () => {},
              startModelCall: (details) => {
                const handle = Symbol("summary-call");
                if (progress) {
                  const outerHandle = progress.startModelCall(details);
                  handleMap.set(handle, outerHandle);
                }
                return handle;
              },
              recordModelUsage: (handle, chunk) => {
                if (chunk.tokens) {
                  usageState.tokens = mergeTokens(
                    usageState.tokens,
                    chunk.tokens,
                  );
                }
                if (chunk.modelVersion) {
                  usageState.modelVersion = chunk.modelVersion;
                }
                const outerHandle = handleMap.get(handle);
                if (outerHandle && progress) {
                  progress.recordModelUsage(outerHandle, chunk);
                }
              },
              finishModelCall: (handle) => {
                const outerHandle = handleMap.get(handle);
                if (outerHandle && progress) {
                  progress.finishModelCall(outerHandle);
                }
                handleMap.delete(handle);
              },
              startStage: () => Symbol("summary-stage"),
              finishStage: () => {},
              setActiveStages: () => {},
            };
          })();
          const debug: LlmDebugOptions | undefined = {
            rootDir: paths.debugDir,
            stage: "agent-tool",
            subStage: "summary",
          };
          const startedAt = Date.now();
          const summary = await generateText({
            modelId: "gemini-flash-latest",
            contents: [
              { role: "user", parts: [{ type: "text", text: summaryPrompt }] },
            ],
            debug,
            progress: trackingProgress,
          });
          const elapsedMs = Date.now() - startedAt;
          const tokens = usageState.tokens;
          const costUsd = estimateCallCostUsd({
            modelId: usageState.modelVersion ?? "gemini-flash-latest",
            tokens,
            responseImages: 0,
          });
          totalSummaryCostUsd += costUsd;
          totalSummaryMs += elapsedMs;
          log(
            `[agent-tool] read_file_summary path=${inputPath} bytes=${bytes} ` +
              `tokens prompt=${formatOptionalNumber(tokens?.promptTokens)} cached=${formatOptionalNumber(tokens?.cachedTokens)} ` +
              `response=${formatOptionalNumber(tokens?.responseTokens)} thinking=${formatOptionalNumber(tokens?.thinkingTokens)} total=${formatOptionalNumber(tokens?.totalTokens)} ` +
              `elapsed=${formatSeconds(elapsedMs)} cost=${formatCurrencyUsd(costUsd)} ` +
              `totalCost=${formatCurrencyUsd(totalSummaryCostUsd)} totalTime=${formatSeconds(totalSummaryMs)}`,
          );
          const output = {
            path: inputPath,
            summary,
            bytes,
          };
          await logTool({
            tool: "read_file_summary",
            input: { path: inputPath, question },
            output,
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "read_file_summary",
            input: { path: inputPath, question },
            error: message,
          });
          throw error;
        }
      },
    }),
    rg_search: tool({
      description: "Search for a regex pattern in workspace files.",
      inputSchema: z.object({
        pattern: z.string().trim().min(1),
        path: z.string().trim().min(1).optional(),
        caseSensitive: z.boolean().optional(),
        glob: z.string().trim().min(1).optional(),
        maxResults: z.number().int().min(1).max(500).optional(),
        maxFileSizeBytes: z.number().int().min(1).max(10_000_000).optional(),
      }),
      execute: async (input) => {
        try {
          const searchRoot = input.path ?? ".";
          const resolved = resolveWorkspacePath(paths.workspaceDir, searchRoot);
          const matches = await searchFiles({
            rootDir: resolved,
            pattern: input.pattern,
            caseSensitive: input.caseSensitive ?? false,
            glob: input.glob,
            maxResults: input.maxResults ?? 200,
            maxFileSizeBytes: input.maxFileSizeBytes ?? 1_500_000,
          });
          const output = { path: searchRoot, matches };
          await logTool({ tool: "rg_search", input, output });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({ tool: "rg_search", input, error: message });
          throw error;
        }
      },
    }),
    create_file: tool({
      description: "Create a new file with the provided content.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        content: z.string(),
      }),
      execute: async ({ path: inputPath, content }) => {
        try {
          const resolved = resolveWorkspacePath(paths.workspaceDir, inputPath);
          const exists = await fileExists(resolved);
          if (exists) {
            throw new Error(`File already exists: ${inputPath}`);
          }
          await ensureDir(path.dirname(resolved));
          await writeFile(resolved, content, { encoding: "utf8" });
          const output = { path: inputPath, status: "created" };
          await logTool({
            tool: "create_file",
            input: { path: inputPath, chars: content.length },
            output,
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "create_file",
            input: { path: inputPath },
            error: message,
          });
          throw error;
        }
      },
    }),
    move_file: tool({
      description: "Rename or move a file within the workspace.",
      inputSchema: z.object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1),
      }),
      execute: async ({ from, to }) => {
        try {
          const resolvedFrom = resolveWorkspacePath(paths.workspaceDir, from);
          const resolvedTo = resolveWorkspacePath(paths.workspaceDir, to);
          const exists = await fileExists(resolvedFrom);
          if (!exists) {
            throw new Error(`File not found: ${from}`);
          }
          const targetExists = await fileExists(resolvedTo);
          if (targetExists) {
            throw new Error(`Target already exists: ${to}`);
          }
          await ensureDir(path.dirname(resolvedTo));
          await rename(resolvedFrom, resolvedTo);
          const output = { from, to, status: "moved" };
          await logTool({ tool: "move_file", input: { from, to }, output });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "move_file",
            input: { from, to },
            error: message,
          });
          throw error;
        }
      },
    }),
    delete_file: tool({
      description: "Delete a file inside the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        try {
          const resolved = resolveWorkspacePath(paths.workspaceDir, inputPath);
          const stats = await stat(resolved);
          if (stats.isDirectory()) {
            throw new Error(`Refusing to delete directory: ${inputPath}`);
          }
          await rm(resolved);
          const output = { path: inputPath, status: "deleted" };
          await logTool({
            tool: "delete_file",
            input: { path: inputPath },
            output,
          });
          return output;
        } catch (error) {
          const message = errorAsString(error);
          await logTool({
            tool: "delete_file",
            input: { path: inputPath },
            error: message,
          });
          throw error;
        }
      },
    }),
    apply_patch: tool({
      description:
        "Apply patch operations to existing files (update only). Use unified diffs or full file contents.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              type: z.enum(["create_file", "update_file", "delete_file"]),
              path: z.string().trim().min(1),
              diff: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ operations }) => {
        const results: Array<{
          path: string;
          status: "completed" | "failed";
          error?: string;
        }> = [];

        for (const operation of operations) {
          try {
            const resolved = resolveWorkspacePath(
              paths.workspaceDir,
              operation.path,
            );
            if (operation.type !== "update_file") {
              throw new Error(
                `Use create_file/move_file/delete_file instead of apply_patch for ${operation.type}`,
              );
            }
            if (!operation.diff) {
              throw new Error("diff is required for create_file/update_file");
            }
            const exists = await fileExists(resolved);
            if (!exists) {
              throw new Error(`File not found: ${operation.path}`);
            }
            const original = await readFile(resolved, { encoding: "utf8" });
            const nextContent = applyDiff(original, operation.diff);
            await ensureDir(path.dirname(resolved));
            await writeFile(resolved, nextContent, { encoding: "utf8" });
            results.push({ path: operation.path, status: "completed" });
          } catch (error) {
            results.push({
              path: operation.path,
              status: "failed",
              error: errorAsString(error),
            });
          }
        }

        await logTool({
          tool: "apply_patch",
          input: {
            operations: operations.map((op) => ({
              ...op,
              diff: op.diff ? `[${op.diff.length} chars]` : undefined,
            })),
          },
          output: results,
        });
        return { results };
      },
    }),
    generate_text: tool({
      description:
        "Call a sub-LLM (Gemini 2.5 Pro) to produce text/markdown; optionally enable web-search or code-execution tools. promptPath is required and must point to a file in the workspace. If outputPath is provided, the tool writes the text to that file (overwrite by default).",
      inputSchema: z
        .object({
          promptPath: z.string().trim().min(1),
          tools: z.array(z.enum(["web-search", "code-execution"])).optional(),
          debugLabel: z.string().trim().optional(),
          outputPath: z.string().trim().optional(),
          outputMode: z.enum(["overwrite", "append"]).optional(),
        })
        .strict(),
      execute: async (input) => {
        type UsageState = {
          tokens?: LlmUsageChunk["tokens"];
          modelVersion?: string;
        };
        const usageState: UsageState = {};
        const mergeTokens = (
          current: LlmUsageChunk["tokens"] | undefined,
          next: LlmUsageChunk["tokens"] | undefined,
        ): LlmUsageChunk["tokens"] | undefined => {
          if (!next) {
            return current;
          }
          if (!current) {
            return next;
          }
          return {
            promptTokens: next.promptTokens ?? current.promptTokens,
            cachedTokens: next.cachedTokens ?? current.cachedTokens,
            responseTokens: next.responseTokens ?? current.responseTokens,
            responseImageTokens:
              next.responseImageTokens ?? current.responseImageTokens,
            thinkingTokens: next.thinkingTokens ?? current.thinkingTokens,
            totalTokens: next.totalTokens ?? current.totalTokens,
            toolUsePromptTokens:
              next.toolUsePromptTokens ?? current.toolUsePromptTokens,
          };
        };
        const trackingProgress: JobProgressReporter = (() => {
          const handleMap = new Map<symbol, symbol>();
          return {
            log: () => {},
            startModelCall: (details) => {
              const handle = Symbol("generate-text-call");
              if (progress) {
                const outerHandle = progress.startModelCall(details);
                handleMap.set(handle, outerHandle);
              }
              return handle;
            },
            recordModelUsage: (handle, chunk) => {
              if (chunk.tokens) {
                usageState.tokens = mergeTokens(
                  usageState.tokens,
                  chunk.tokens,
                );
              }
              if (chunk.modelVersion) {
                usageState.modelVersion = chunk.modelVersion;
              }
              const outerHandle = handleMap.get(handle);
              if (outerHandle && progress) {
                progress.recordModelUsage(outerHandle, chunk);
              }
            },
            finishModelCall: (handle) => {
              const outerHandle = handleMap.get(handle);
              if (outerHandle && progress) {
                progress.finishModelCall(outerHandle);
              }
              handleMap.delete(handle);
            },
            startStage: () => Symbol("generate-text-stage"),
            finishStage: () => {},
            setActiveStages: () => {},
          };
        })();
        const toolConfigs: LlmToolConfig[] = [];
        if (input.tools) {
          for (const toolType of input.tools) {
            toolConfigs.push({ type: toolType });
          }
        }
        const debug: LlmDebugOptions | undefined = {
          rootDir: paths.debugDir,
          stage: "agent-tool",
          subStage: input.debugLabel ?? "call",
        };
        const generationModelId: LlmTextModelId = "gemini-2.5-pro";
        const generationReasoning =
          resolveOpenAiReasoningEffort(generationModelId);
        const templateText = await readFile(
          resolveWorkspacePath(paths.workspaceDir, input.promptPath),
          "utf8",
        );
        const expanded = await expandPromptTemplate({
          template: templateText,
          workspaceDir: paths.workspaceDir,
        });
        const promptText = expanded.text;
        const normalizedOutputPath = input.outputPath
          ? input.outputPath.replace(/\\/g, "/")
          : undefined;
        const startedAt = Date.now();
        try {
          if (
            normalizedOutputPath &&
            (normalizedOutputPath.endsWith(".json") ||
              normalizedOutputPath.startsWith("firestore/") ||
              normalizedOutputPath.includes("/firestore/"))
          ) {
            throw new Error(
              "generate_text cannot write JSON outputs. Write firestore/*.json manually with create_file/apply_patch and run validate_schema.",
            );
          }
          const text = await generateText({
            modelId: generationModelId,
            openAiReasoningEffort: generationReasoning,
            contents: [
              {
                role: "user",
                parts: [{ type: "text", text: promptText }],
              },
            ],
            tools: toolConfigs.length > 0 ? toolConfigs : undefined,
            debug,
            progress: trackingProgress,
          });
          const outputPath = input.outputPath
            ? resolveWorkspacePath(paths.workspaceDir, input.outputPath)
            : undefined;
          const outputMode = input.outputMode ?? "overwrite";
          if (outputPath) {
            await ensureDir(path.dirname(outputPath));
            if (outputMode === "append") {
              await appendFile(outputPath, text, "utf8");
            } else {
              await writeFile(outputPath, text, "utf8");
            }
          }
          const output = outputPath
            ? {
                outputPath: input.outputPath,
                outputMode,
                textChars: text.length,
              }
            : { text };
          const elapsedMs = Date.now() - startedAt;
          const tokens = usageState.tokens;
          const promptTokens = tokens?.promptTokens;
          const cachedTokens = tokens?.cachedTokens;
          const responseTokens = tokens?.responseTokens;
          const thinkingTokens = tokens?.thinkingTokens;
          const totalTokens = tokens?.totalTokens;
          const costUsd = estimateCallCostUsd({
            modelId: usageState.modelVersion ?? generationModelId,
            tokens,
            responseImages: 0,
          });
          totalGenerateCostUsd += costUsd;
          totalGenerateMs += elapsedMs;
          log(
            `[agent-tool] generate_text ${input.promptPath} -> ${input.outputPath ?? "(no output)"} ` +
              `tokens prompt=${formatOptionalNumber(promptTokens)} cached=${formatOptionalNumber(cachedTokens)} ` +
              `response=${formatOptionalNumber(responseTokens)} thinking=${formatOptionalNumber(thinkingTokens)} total=${formatOptionalNumber(totalTokens)} ` +
              `elapsed=${formatSeconds(elapsedMs)} cost=${formatCurrencyUsd(costUsd)} ` +
              `totalCost=${formatCurrencyUsd(totalGenerateCostUsd)} totalTime=${formatSeconds(totalGenerateMs)}`,
          );
          await logTool({
            tool: "generate_text",
            input: {
              promptChars: promptText.length,
              modelId: generationModelId,
              tools: input.tools ?? [],
              outputPath: input.outputPath,
              outputMode: input.outputMode,
              promptPath: input.promptPath,
              promptTemplateReplacements: expanded.replacements,
            },
            output: outputPath
              ? { textChars: text.length, outputPath: input.outputPath }
              : { textChars: text.length },
          });
          return output;
        } catch (error) {
          const elapsedMs = Date.now() - startedAt;
          log(
            `[agent-tool] generate_text failed after ${elapsedMs}ms (${input.promptPath})`,
          );
          const message = errorAsString(error);
          await logTool({
            tool: "generate_text",
            input: {
              promptChars: promptText.length,
              promptPath: input.promptPath,
              promptTemplateReplacements: expanded.replacements,
            },
            error: message,
          });
          throw error;
        }
      },
    }),
  };
}

export function buildSessionAgentToolsForTest(options: {
  workingDirectory: string;
  includeStory: boolean;
  includeCoding: boolean;
  progress?: JobProgressReporter;
}): {
  paths: SessionAgentWorkspacePaths;
  tools: ReturnType<typeof buildSessionAgentTools>;
} {
  const paths = resolveWorkspacePaths(options.workingDirectory);
  const tools = buildSessionAgentTools({
    paths,
    progress: options.progress,
    includeStory: options.includeStory,
    includeCoding: options.includeCoding,
  });
  return { paths, tools };
}

export async function runSessionAgentSmokeTest(options: {
  workingDirectory: string;
  modelId?: LlmTextModelId;
  progress?: JobProgressReporter;
}): Promise<void> {
  if (!options.workingDirectory) {
    throw new Error("--working-directory is required");
  }
  loadAgentEnv();
  const paths = resolveWorkspacePaths(options.workingDirectory);
  await ensureDir(paths.workspaceDir);
  await ensureDir(paths.debugDir);
  const modelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const includeStory = true;
  const includeCoding = true;
  const openAiReasoningEffort = resolveOpenAiReasoningEffort(modelId);
  const tools = buildSessionAgentTools({
    paths,
    progress: options.progress,
    includeStory,
    includeCoding,
  });
  const systemPrompt = [
    "You are a tool-using agent.",
    `You may only edit files under: ${paths.workspaceDir}`,
    "Use create_file to create new files.",
    "Use read_file to confirm outputs.",
    "Reply with a short confirmation after completing the task.",
  ].join("\n");

  const result = await runToolLoop({
    modelId,
    systemPrompt,
    prompt:
      "Create hello.txt with the single line 'hello from agent'. " +
      "Then update it to add a second line 'second line' using apply_patch. " +
      "Rename hello.txt to greeting.txt using move_file. " +
      "Use list_files to list the workspace and rg_search to find 'hello'. " +
      "Finally read greeting.txt. After that read_file, respond with DONE and make no further tool calls.",
    tools,
    maxSteps: 20,
    progress: options.progress,
    openAiReasoningEffort,
    debug: { rootDir: paths.debugDir, stage: "agent-smoke" },
  });

  const seenTools = new Set<string>();
  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      seenTools.add(call.toolName);
    }
  }
  const requiredTools = [
    "create_file",
    "apply_patch",
    "move_file",
    "list_files",
    "rg_search",
    "read_file",
  ];
  const missingTools = requiredTools.filter((name) => !seenTools.has(name));
  if (missingTools.length > 0) {
    throw new Error(
      `Smoke test failed: missing tool calls (${missingTools.join(", ")}).`,
    );
  }

  const greetingPath = path.join(paths.workspaceDir, "greeting.txt");
  const content = await readFile(greetingPath, { encoding: "utf8" }).catch(
    () => "",
  );
  if (
    !content.includes("hello from agent") ||
    !content.includes("second line")
  ) {
    throw new Error("Smoke test failed: greeting.txt missing or incorrect.");
  }
}

export async function runSessionGenerationAgent(
  options: SessionGenerationAgentOptions,
): Promise<SessionGenerationAgentResult> {
  if (!options.workingDirectory) {
    throw new Error("--working-directory is required");
  }
  loadAgentEnv();
  const logger = useProgress(options.progress);
  const includeStory = options.includeStory ?? true;
  const includeCoding = options.includeCoding ?? true;
  const modelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const openAiReasoningEffort = resolveOpenAiReasoningEffort(modelId);
  const paths = resolveWorkspacePaths(options.workingDirectory);

  const brief =
    options.brief ??
    (options.briefFile
      ? await readLessonBriefFile(options.briefFile)
      : undefined);
  if (!brief && !options.topic) {
    throw new Error("Provide brief/briefFile or topic.");
  }
  const topic = options.topic ?? deriveTopicFromBrief(brief ?? "");
  if (!topic) {
    throw new Error("Could not derive topic from brief.");
  }
  if (!brief) {
    throw new Error(
      "Brief text is required when topic-only runs are not supported.",
    );
  }

  await prepareWorkspace({
    paths,
    brief,
    topic,
    includeStory,
    includeCoding,
  });

  const tools = buildSessionAgentTools({
    paths,
    progress: options.progress,
    includeStory,
    includeCoding,
  });

  const systemPrompt = buildAgentSystemPrompt(paths.workspaceDir);
  let validationError: string | undefined;
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    logger.log(`[session-agent] attempt ${attempt} of ${maxAttempts}`);
    await runToolLoop({
      modelId,
      systemPrompt,
      prompt: buildAgentUserPrompt({
        workspaceDir: paths.workspaceDir,
        includeStory,
        includeCoding,
        validationError,
      }),
      tools,
      maxSteps,
      progress: options.progress,
      openAiReasoningEffort,
      debug: {
        rootDir: paths.debugDir,
        stage: "agent-loop",
        subStage: `attempt-${attempt}`,
      },
    });

    try {
      const outputs = await loadFirestoreOutputs({
        paths,
        includeStory,
        includeCoding,
      });

      if (options.sessionId && options.sessionId !== outputs.session.id) {
        throw new Error(
          `session id mismatch: expected '${options.sessionId}', got '${outputs.session.id}'`,
        );
      }

      return {
        sessionId: outputs.session.id,
        session: outputs.session,
        quizzes: outputs.quizzes,
        problems: outputs.problems,
      };
    } catch (error) {
      validationError = buildValidationError(error);
      logger.log(`[session-agent] validation failed: ${validationError}`);
      if (attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("Session agent failed without a final result.");
}

function parseCliArgs(args: readonly string[]): {
  workingDirectory: string;
  briefFile?: string;
  topic?: string;
  userId: string;
  sessionId?: string;
  includeStory: boolean;
  includeCoding: boolean;
  storyPlanItemId: string;
  storySegmentCount?: number;
  modelId?: LlmTextModelId;
  maxSteps?: number;
} {
  const raw: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--working-directory" && args[index + 1]) {
      raw.workingDirectory = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--brief-file" && args[index + 1]) {
      raw.briefFile = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--topic" && args[index + 1]) {
      raw.topic = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--user-id" && args[index + 1]) {
      raw.userId = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--session-id" && args[index + 1]) {
      raw.sessionId = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--story-plan-item-id" && args[index + 1]) {
      raw.storyPlanItemId = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--story-segment-count" && args[index + 1]) {
      raw.storySegmentCount = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--model-id" && args[index + 1]) {
      raw.modelId = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--max-steps" && args[index + 1]) {
      raw.maxSteps = String(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--working-directory=")) {
      raw.workingDirectory = arg.slice("--working-directory=".length);
      continue;
    }
    if (arg.startsWith("--brief-file=")) {
      raw.briefFile = arg.slice("--brief-file=".length);
      continue;
    }
    if (arg.startsWith("--topic=")) {
      raw.topic = arg.slice("--topic=".length);
      continue;
    }
    if (arg.startsWith("--user-id=")) {
      raw.userId = arg.slice("--user-id=".length);
      continue;
    }
    if (arg.startsWith("--session-id=")) {
      raw.sessionId = arg.slice("--session-id=".length);
      continue;
    }
    if (arg.startsWith("--story-plan-item-id=")) {
      raw.storyPlanItemId = arg.slice("--story-plan-item-id=".length);
      continue;
    }
    if (arg.startsWith("--story-segment-count=")) {
      raw.storySegmentCount = arg.slice("--story-segment-count=".length);
      continue;
    }
    if (arg.startsWith("--model-id=")) {
      raw.modelId = arg.slice("--model-id=".length);
      continue;
    }
    if (arg.startsWith("--max-steps=")) {
      raw.maxSteps = arg.slice("--max-steps=".length);
      continue;
    }
    if (arg === "--no-story") {
      raw.includeStory = false;
      continue;
    }
    if (arg === "--no-coding") {
      raw.includeCoding = false;
      continue;
    }
  }

  const schema = z
    .object({
      workingDirectory: z.string().trim().min(1),
      briefFile: z.string().trim().min(1).optional(),
      topic: z.string().trim().min(1).optional(),
      userId: z.string().trim().min(1).default("session-agent"),
      sessionId: z.string().trim().min(1).optional(),
      includeStory: z.boolean().default(true),
      includeCoding: z.boolean().default(true),
      storyPlanItemId: z
        .string()
        .trim()
        .min(1)
        .default(DEFAULT_STORY_PLAN_ITEM_ID),
      storySegmentCount: z
        .string()
        .optional()
        .transform((value) => {
          if (value === undefined) {
            return undefined;
          }
          const parsed = Number.parseInt(value, 10);
          if (Number.isNaN(parsed)) {
            throw new Error("story segment count must be an integer");
          }
          return parsed;
        }),
      modelId: z.string().trim().optional(),
      maxSteps: z
        .string()
        .optional()
        .transform((value) => {
          if (value === undefined) {
            return undefined;
          }
          const parsed = Number.parseInt(value, 10);
          if (Number.isNaN(parsed)) {
            throw new Error("max-steps must be an integer");
          }
          return parsed;
        }),
    })
    .superRefine((value, ctx) => {
      if (!value.briefFile && !value.topic) {
        ctx.addIssue({
          code: "custom",
          message: "Provide --brief-file or --topic",
        });
      }
    });

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return {
    workingDirectory: parsed.data.workingDirectory,
    briefFile: parsed.data.briefFile,
    topic: parsed.data.topic,
    userId: parsed.data.userId,
    sessionId: parsed.data.sessionId,
    includeStory: parsed.data.includeStory,
    includeCoding: parsed.data.includeCoding,
    storyPlanItemId: parsed.data.storyPlanItemId,
    storySegmentCount: parsed.data.storySegmentCount,
    modelId: parsed.data.modelId,
    maxSteps: parsed.data.maxSteps,
  };
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const result = await runSessionGenerationAgent({
    workingDirectory: cli.workingDirectory,
    briefFile: cli.briefFile,
    topic: cli.topic,
    userId: cli.userId,
    sessionId: cli.sessionId,
    includeStory: cli.includeStory,
    includeCoding: cli.includeCoding,
    storyPlanItemId: cli.storyPlanItemId,
    storySegmentCount: cli.storySegmentCount,
    modelId: cli.modelId,
    maxSteps: cli.maxSteps,
  });
  const sessionTitle =
    result.session.title ?? result.session.plan?.[0]?.title ?? "session";
  process.stdout.write(
    `Session generated: ${result.sessionId} (${sessionTitle})\n`,
  );
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
