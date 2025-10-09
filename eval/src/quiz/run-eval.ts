import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";

import { ProxyAgent, setGlobalDispatcher } from "undici";

import {
  JudgeAuditSchema,
  JudgeVerdictSchema,
  type InlineSourceFile,
  type JudgeAudit,
  type JudgeVerdict,
  type QuizGeneration,
  QuizGenerationSchema,
  QUIZ_RESPONSE_SCHEMA,
} from "@spark/llm/quiz/schemas";
import {
  buildExtensionPrompt,
  buildGenerationPrompt,
  buildSourceParts,
  normaliseQuizPayload,
  type GenerateQuizOptions,
} from "@spark/llm/quiz/prompts";
import {
  DEFAULT_EXTENSION_QUESTION_COUNT,
  DEFAULT_GENERATION_QUESTION_COUNT,
  QUIZ_GENERATION_MODEL_ID,
} from "@spark/llm/quiz/generator";
import { type Schema } from "@google/genai";
import {
  AUDIT_RESPONSE_SCHEMA,
  JUDGE_RESPONSE_SCHEMA,
  buildAuditPrompt,
  buildJudgePrompt,
  QUIZ_EVAL_MODEL_ID,
} from "@spark/llm/quiz/judge";
import type { GeminiModelId } from "@spark/llm/utils/gemini";
import {
  runJobsWithConcurrency,
  type JobProgressReporter,
  type StatusMode,
} from "../utils/concurrency";
import {
  AUDIT_CHECKPOINT_PATH,
  AUDIT_CHECKPOINT_VERSION,
  getFailedJobIdSet,
  readAuditCheckpoint,
  type AuditCheckpoint,
} from "./auditArtifacts";
import { WORKSPACE_PATHS, ensureEvalEnvLoaded } from "../utils/paths";
import { readJson, writeJson } from "../utils/fs";
import {
  LlmJsonCallError,
  convertGooglePartsToLlmParts,
  runLlmJsonCall,
  sanitisePartForLogging,
  type LlmContentPart,
} from "../utils/llm";
import { detectMimeType } from "../utils/mime";
import {
  createCliCommand,
  createIntegerParser,
  parseBooleanOption,
  parseStatusModeOption,
} from "../utils/cli";

import type { JudgeFilePayload, QuizFilePayload, SampleJob } from "./payload";

ensureEvalEnvLoaded();

const {
  repoRoot: REPO_ROOT,
  quizEvalInputDir: EVAL_INPUT_DIR,
  quizEvalOutputDir: EVAL_OUTPUT_DIR,
} = WORKSPACE_PATHS;
const DATA_ROOT = EVAL_INPUT_DIR;
const MAX_CONCURRENT_ANALYSES = 8;
const ALLOWED_SAMPLE_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const CHECKPOINT_DIR = path.join(EVAL_OUTPUT_DIR, "checkpoints");
const CHECKPOINT_INTERVAL_MS = 10_000;
const CHECKPOINT_HISTORY_LIMIT = 3;
const CHECKPOINT_VERSION = 1;

const proxyUrl =
  process.env.HTTPS_PROXY ??
  process.env.https_proxy ??
  process.env.HTTP_PROXY ??
  process.env.http_proxy ??
  process.env.npm_config_https_proxy ??
  process.env.npm_config_proxy ??
  process.env.npm_config_http_proxy;

if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
}

function rawPathForAttempt(basePath: string, attempt: number): string {
  const directory = path.dirname(basePath);
  const ext = path.extname(basePath);
  const baseName = path.basename(basePath, ext);
  const suffix = `.attempt${attempt}`;
  return path.join(directory, `${baseName}${suffix}${ext}`);
}

function requestPathForRaw(rawFilePath: string): string {
  const directory = path.dirname(rawFilePath);
  const ext = path.extname(rawFilePath);
  const baseName = path.basename(rawFilePath, ext);
  return path.join(directory, `${baseName}-request.json`);
}

function promptPathForRaw(rawFilePath: string): string {
  const directory = path.dirname(rawFilePath);
  const ext = path.extname(rawFilePath);
  const baseName = path.basename(rawFilePath, ext);
  return path.join(directory, `${baseName}-prompt.txt`);
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: readonly T[], seed: number): T[] {
  const rng = createSeededRng(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = temp;
  }
  return copy;
}

function extractPageBucketSegment(job: SampleJob): string | undefined {
  const relativeToRoot = path.relative(DATA_ROOT, job.sourcePath);
  if (relativeToRoot.startsWith("..")) {
    return undefined;
  }
  const [firstSegment] = relativeToRoot.split(path.sep);
  return firstSegment ?? undefined;
}

function extractNumericPrefix(bucket: string): number | undefined {
  const match = /^(\d{1,})/u.exec(bucket);
  if (!match) {
    return undefined;
  }
  return Number.parseInt(match[1] ?? "", 10);
}

function filterJobsByMaxPrefix(
  jobs: SampleJob[],
  maxPrefix: number,
): SampleJob[] {
  return jobs.filter((job) => {
    const bucketSegment = extractPageBucketSegment(job);
    if (!bucketSegment) {
      return true;
    }
    const prefix = extractNumericPrefix(bucketSegment);
    if (prefix === undefined) {
      return true;
    }
    return prefix <= maxPrefix;
  });
}

type GenerationResult = {
  readonly job: SampleJob;
  readonly quiz: QuizFilePayload;
  readonly judge: JudgeFilePayload;
  readonly extension: QuizFilePayload;
  readonly extensionJudge: JudgeFilePayload;
};

type CheckpointJobEntry = {
  readonly completedAt: string;
};

type CheckpointState = {
  readonly version: number;
  readonly updatedAt: string;
  readonly seed?: number | null;
  readonly completedJobs: Record<string, CheckpointJobEntry>;
};

type EvalCliOptions = {
  readonly seed?: number;
  readonly maxPrefix?: number;
  readonly limit?: number;
  readonly statusMode: StatusMode;
  readonly auditFailuresOnly: boolean;
};

class CheckpointManager {
  private readonly directory: string;
  private state: CheckpointState;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;
  private lastWriteTimestamp = 0;

  private constructor(directory: string, state: CheckpointState) {
    this.directory = directory;
    this.state = state;
  }

  static async load(directory: string): Promise<CheckpointManager> {
    const state = await loadLatestCheckpointState(directory);
    if (!state) {
      console.log("[eval] No checkpoint state found; starting fresh.");
      return new CheckpointManager(directory, createEmptyCheckpointState());
    }
    if (state.version !== CHECKPOINT_VERSION) {
      console.warn(
        `[eval] WARN checkpoint version mismatch (found ${state.version}); starting fresh.`,
      );
      return new CheckpointManager(directory, createEmptyCheckpointState());
    }
    const normalisedState: CheckpointState = {
      ...state,
      seed: state.seed ?? null,
    };
    return new CheckpointManager(directory, normalisedState);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.writeIfDirty();
    }, CHECKPOINT_INTERVAL_MS);
    this.timer.unref?.();
  }

  isCompleted(jobId: string): boolean {
    return Boolean(this.state.completedJobs[jobId]);
  }

  markCompleted(jobId: string): void {
    if (this.state.completedJobs[jobId]) {
      return;
    }
    this.state = {
      ...this.state,
      completedJobs: {
        ...this.state.completedJobs,
        [jobId]: { completedAt: new Date().toISOString() },
      },
      updatedAt: new Date().toISOString(),
    };
    this.dirty = true;
  }

  ensureSeed(seed: number | undefined): void {
    const normalisedSeed = seed ?? null;
    const currentSeed = this.state.seed ?? null;
    if (currentSeed === normalisedSeed) {
      return;
    }
    if (currentSeed === null && normalisedSeed !== null) {
      const completedCount = Object.keys(this.state.completedJobs).length;
      if (completedCount > 0) {
        this.throwSeedMismatch(currentSeed, normalisedSeed);
      }
      this.state = {
        ...this.state,
        seed: normalisedSeed,
        updatedAt: new Date().toISOString(),
      };
      this.dirty = true;
      return;
    }
    if (currentSeed !== null && normalisedSeed === null) {
      this.throwSeedMismatch(currentSeed, normalisedSeed);
    }
    if (
      currentSeed !== null &&
      normalisedSeed !== null &&
      currentSeed !== normalisedSeed
    ) {
      this.throwSeedMismatch(currentSeed, normalisedSeed);
    }
  }

  private throwSeedMismatch(
    expected: number | null,
    received: number | null,
  ): never {
    const expectedLabel =
      expected === null ? "no --seed flag" : `--seed=${expected}`;
    const receivedLabel =
      received === null ? "no --seed flag" : `--seed=${received}`;
    throw new Error(
      `[eval] Seed mismatch: checkpoint was created with ${expectedLabel}, but the run is using ${receivedLabel}. ` +
        `Re-run with ${expectedLabel} or delete ${this.directory} to start fresh.`,
    );
  }

  async pruneTo(jobIds: Set<string>): Promise<void> {
    let changed = false;
    const nextEntries: Record<string, CheckpointJobEntry> = {};
    for (const [jobId, entry] of Object.entries(this.state.completedJobs)) {
      if (jobIds.has(jobId)) {
        nextEntries[jobId] = entry;
      } else {
        changed = true;
      }
    }
    if (changed) {
      this.state = {
        ...this.state,
        completedJobs: nextEntries,
        updatedAt: new Date().toISOString(),
      };
      this.dirty = true;
      await this.writeIfDirty(true);
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.writeIfDirty(true);
  }

  private async writeIfDirty(force = false): Promise<void> {
    if (!force && !this.dirty) {
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastWriteTimestamp < CHECKPOINT_INTERVAL_MS) {
      return;
    }
    try {
      await this.writeSnapshot();
      this.lastWriteTimestamp = Date.now();
      this.dirty = false;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[eval] WARN failed to write checkpoint: ${reason}`);
    }
  }

  private async writeSnapshot(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const isoTimestamp = new Date().toISOString();
    const safeTimestamp = isoTimestamp.replace(/[:.]/g, "-");
    const fileName = `checkpoint-${safeTimestamp}.json`;
    const filePath = path.join(this.directory, fileName);
    const payload: CheckpointState = {
      version: CHECKPOINT_VERSION,
      updatedAt: isoTimestamp,
      seed: this.state.seed ?? null,
      completedJobs: this.state.completedJobs,
    };
    await writeJson(filePath, payload);
    await this.cleanupOldSnapshots();
  }

  private async cleanupOldSnapshots(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = (await readdir(this.directory))
        .filter(
          (name) => name.startsWith("checkpoint-") && name.endsWith(".json"),
        )
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw error;
    }
    const excess = entries.length - CHECKPOINT_HISTORY_LIMIT;
    if (excess <= 0) {
      return;
    }
    for (let index = 0; index < excess; index += 1) {
      const name = entries[index];
      await rm(path.join(this.directory, name), { force: true });
    }
  }
}

function createEmptyCheckpointState(): CheckpointState {
  return {
    version: CHECKPOINT_VERSION,
    updatedAt: new Date().toISOString(),
    seed: null,
    completedJobs: {},
  };
}

async function loadLatestCheckpointState(
  directory: string,
): Promise<CheckpointState | undefined> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const checkpointFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("checkpoint-") &&
        entry.name.endsWith(".json"),
    )
    .map((entry) => entry.name)
    .sort();
  for (let index = checkpointFiles.length - 1; index >= 0; index -= 1) {
    const name = checkpointFiles[index];
    const filePath = path.join(directory, name);
    try {
      return await readJson<CheckpointState>(filePath);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[eval] WARN failed to read checkpoint ${name}: ${reason}`);
    }
  }
  return undefined;
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "")
      .replace(/-{2,}/g, "-")
      .trim() || "sample"
  );
}

async function loadInlineSource(filePath: string): Promise<InlineSourceFile> {
  const buffer = await readFile(filePath);
  const mimeType = detectMimeType(filePath);
  if (mimeType === "application/octet-stream") {
    throw new Error(
      `Unsupported extension for inline data: ${path.extname(filePath)}`,
    );
  }
  return {
    displayName: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
  };
}

async function collectJobs(): Promise<SampleJob[]> {
  console.log(`[eval] Scanning for samples in ${DATA_ROOT}`);
  const slugCounts = new Map<string, number>();
  const jobs: SampleJob[] = [];
  const stack: Array<{ absolutePath: string; relativePath: string }> = [
    { absolutePath: DATA_ROOT, relativePath: "" },
  ];
  const visitedDirs = new Set<string>();
  const seenFiles = new Set<string>();
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    const { absolutePath, relativePath } = next;
    const resolvedDirPath = path.resolve(absolutePath);
    if (visitedDirs.has(resolvedDirPath)) {
      continue;
    }
    visitedDirs.add(resolvedDirPath);
    const entries = await readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const entryAbsolute = path.join(absolutePath, entry.name);
      const entryRelative = relativePath
        ? path.join(relativePath, entry.name)
        : entry.name;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDir && !isFile && entry.isSymbolicLink()) {
        try {
          const stats = await stat(entryAbsolute);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(
            `[eval] WARN unable to stat symlink at ${entryAbsolute}: ${reason}`,
          );
          continue;
        }
      }
      if (isDir) {
        stack.push({
          absolutePath: entryAbsolute,
          relativePath: entryRelative,
        });
        continue;
      }
      if (!isFile) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_SAMPLE_EXTENSIONS.has(ext)) {
        continue;
      }
      const sourcePath = entryAbsolute;
      const resolvedFilePath = path.resolve(sourcePath);
      if (seenFiles.has(resolvedFilePath)) {
        continue;
      }
      seenFiles.add(resolvedFilePath);
      const displayName = entry.name;
      const relativeSegments = entryRelative.split(path.sep);
      const category =
        relativeSegments.length > 1 ? relativeSegments[0] : "root";
      const baseSlug = `${slugify(category)}-${slugify(path.parse(displayName).name)}`;
      const count = slugCounts.get(baseSlug) ?? 0;
      slugCounts.set(baseSlug, count + 1);
      const id = count === 0 ? baseSlug : `${baseSlug}-${count + 1}`;
      const relativeSourcePath = path
        .relative(REPO_ROOT, sourcePath)
        .split(path.sep)
        .join("/");
      const questionCount = DEFAULT_GENERATION_QUESTION_COUNT;
      jobs.push({
        id,
        category,
        displayName,
        sourcePath,
        relativeSourcePath,
        questionCount,
      });
    }
  }
  jobs.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`[eval] Found ${jobs.length} sample files.`);
  return jobs;
}

async function callModel<T>({
  model,
  responseSchema,
  schema,
  parts,
  rawFilePath,
  label,
  normalise,
  progress,
}: {
  model: GeminiModelId;
  responseSchema: Schema;
  schema: z.ZodType<T>;
  parts: LlmContentPart[];
  rawFilePath: string;
  label: string;
  normalise?: (value: unknown) => unknown;
  progress: JobProgressReporter;
}): Promise<{ modelId: string; data: T }> {
  const maxAttempts = 3;
  const requestFilePath = requestPathForRaw(rawFilePath);
  const promptFilePath = promptPathForRaw(rawFilePath);
  const sanitisedParts = parts.map((part) => sanitisePartForLogging(part));
  const requestRecord = {
    model,
    label,
    contents: [
      {
        role: "user" as const,
        parts: sanitisedParts,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: JSON.parse(JSON.stringify(responseSchema)),
      thinkingConfig: { includeThoughts: true, thinkingBudget: 32_768 },
    },
  };
  const promptSegments = parts
    .map((part) => (part.type === "text" ? part.text : undefined))
    .filter((segment): segment is string =>
      Boolean(segment && segment.length > 0),
    );
  if (promptSegments.length > 0) {
    let promptContent = promptSegments.join("\n\n---\n\n");
    if (!promptContent.endsWith("\n")) {
      promptContent = `${promptContent}\n`;
    }
    await writeFile(promptFilePath, promptContent, "utf8");
  } else {
    await writeFile(promptFilePath, "", "utf8");
  }
  await writeFile(
    requestFilePath,
    JSON.stringify(requestRecord, null, 2),
    "utf8",
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const parsed = await runLlmJsonCall<T>({
        progress,
        modelId: model,
        parts,
        responseSchema,
        schema,
        maxAttempts: 1,
      });

      const serialised = JSON.stringify(parsed, null, 2);
      await writeFile(rawFilePath, `${serialised}\n`, "utf8");
      const attemptPath = rawPathForAttempt(rawFilePath, attempt);
      await writeFile(attemptPath, `${serialised}\n`, "utf8");

      let candidate: unknown = parsed;
      if (normalise) {
        try {
          candidate = normalise(candidate);
        } catch (error) {
          progress.log(
            `[${model}] ${label}: WARN failed to normalise response on attempt ${attempt}: ${error}`,
          );
          continue;
        }
      }

      return { modelId: model, data: candidate as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.log(
        `[${model}] ${label}: attempt ${attempt} failed: ${message}`,
      );
      if (error instanceof LlmJsonCallError) {
        const last = error.attempts.at(-1);
        if (last?.rawText) {
          await writeFile(rawFilePath, last.rawText, "utf8");
        }
      }
    }
  }

  throw new Error(
    `[${model}] ${label}: failed to produce a valid response after ${maxAttempts} attempts`,
  );
}

async function generateQuizPayload(
  job: SampleJob,
  source: InlineSourceFile,
  rawFilePath: string,
  label: string,
  progress: JobProgressReporter,
): Promise<QuizFilePayload> {
  const options: GenerateQuizOptions = {
    questionCount: job.questionCount,
    subject: job.subject,
    sourceFiles: [source],
  };
  const prompt = buildGenerationPrompt(options);
  const parts: LlmContentPart[] = [
    { type: "text", text: prompt },
    ...convertGooglePartsToLlmParts(buildSourceParts(options.sourceFiles)),
  ];
  const { data: quiz } = await callModel<QuizGeneration>({
    model: QUIZ_GENERATION_MODEL_ID,
    responseSchema: QUIZ_RESPONSE_SCHEMA,
    schema: QuizGenerationSchema,
    normalise: (value) => normaliseQuizPayload(value, job.questionCount),
    parts,
    rawFilePath,
    label,
    progress,
  });
  const generatedAt = new Date().toISOString();
  return {
    id: job.id,
    mode: quiz.mode,
    subject: quiz.subject,
    generatedAt,
    request: {
      model: QUIZ_GENERATION_MODEL_ID,
      questionCount: job.questionCount,
    },
    source: {
      relativePath: job.relativeSourcePath,
      displayName: job.displayName,
    },
    prompt,
    quiz,
    model: {
      modelId: QUIZ_GENERATION_MODEL_ID,
    },
    job,
  };
}

async function generateExtensionPayload(
  job: SampleJob,
  source: InlineSourceFile,
  baseQuiz: QuizGeneration,
  rawFilePath: string,
  label: string,
  progress: JobProgressReporter,
): Promise<QuizFilePayload> {
  const prompt = buildExtensionPrompt({
    additionalQuestionCount: DEFAULT_EXTENSION_QUESTION_COUNT,
    subject: baseQuiz.subject ?? job.subject,
  });
  const pastQuizLines = baseQuiz.questions.map(
    (question, index) => `${index + 1}. ${question.prompt}`,
  );
  const pastQuizBlock = `<PAST_QUIZES>\n${pastQuizLines.join("\n")}\n</PAST_QUIZES>`;
  const parts: LlmContentPart[] = [
    { type: "text", text: prompt },
    ...convertGooglePartsToLlmParts(buildSourceParts([source])),
    { type: "text", text: `Previous quiz prompts:\n${pastQuizBlock}` },
  ];
  const { data: generated } = await callModel<QuizGeneration>({
    model: QUIZ_GENERATION_MODEL_ID,
    responseSchema: QUIZ_RESPONSE_SCHEMA,
    schema: QuizGenerationSchema,
    normalise: (value) =>
      normaliseQuizPayload(value, DEFAULT_EXTENSION_QUESTION_COUNT),
    parts,
    rawFilePath,
    label,
    progress,
  });
  let quiz = generated;
  if (quiz.questionCount !== DEFAULT_EXTENSION_QUESTION_COUNT) {
    progress.log(
      `[eval] WARN extension returned ${quiz.questionCount} questions; trimming to ${DEFAULT_EXTENSION_QUESTION_COUNT}.`,
    );
    const trimmedQuestions = quiz.questions.slice(
      0,
      DEFAULT_EXTENSION_QUESTION_COUNT,
    );
    quiz = {
      ...quiz,
      questions: trimmedQuestions,
      questionCount: trimmedQuestions.length,
    };
  }
  const generatedAt = new Date().toISOString();
  return {
    id: job.id,
    mode: quiz.mode,
    subject: quiz.subject,
    generatedAt,
    request: {
      model: QUIZ_GENERATION_MODEL_ID,
      questionCount: DEFAULT_EXTENSION_QUESTION_COUNT,
    },
    source: {
      relativePath: job.relativeSourcePath,
      displayName: job.displayName,
    },
    prompt,
    quiz,
    model: {
      modelId: QUIZ_GENERATION_MODEL_ID,
    },
    job,
  };
}

async function judgeQuizPayload(
  job: SampleJob,
  source: InlineSourceFile,
  quiz: QuizGeneration,
  rawFilePath: string,
  label: string,
  progress: JobProgressReporter,
): Promise<JudgeFilePayload> {
  const prompt = buildJudgePrompt({
    sourceFiles: [source],
    candidateQuiz: quiz,
  });
  const parts: LlmContentPart[] = [
    { type: "text", text: prompt },
    ...convertGooglePartsToLlmParts(buildSourceParts([source])),
    {
      type: "text",
      text: `Candidate quiz JSON:\n${JSON.stringify(quiz, null, 2)}`,
    },
  ];
  const { data: parsedVerdict, modelId } = await callModel<JudgeVerdict>({
    model: QUIZ_EVAL_MODEL_ID,
    responseSchema: JUDGE_RESPONSE_SCHEMA,
    schema: JudgeVerdictSchema,
    parts,
    rawFilePath,
    label,
    progress,
  });
  const evaluatedAt = new Date().toISOString();
  return {
    id: job.id,
    evaluatedAt,
    prompt,
    source: {
      relativePath: job.relativeSourcePath,
      displayName: job.displayName,
    },
    job,
    judge: {
      model: {
        modelId,
      },
      verdict: parsedVerdict,
    },
  };
}

async function auditJudgeDecisionPayload(
  job: SampleJob,
  source: InlineSourceFile,
  quiz: QuizGeneration,
  judgeVerdict: JudgeVerdict,
  rawFilePath: string,
  label: string,
  progress: JobProgressReporter,
): Promise<JudgeFilePayload["audit"]> {
  const prompt = buildAuditPrompt();
  const parts: LlmContentPart[] = [
    { type: "text", text: prompt },
    ...convertGooglePartsToLlmParts(buildSourceParts([source])),
    {
      type: "text",
      text: `Judge verdict JSON:\n${JSON.stringify(judgeVerdict, null, 2)}\n\nCandidate quiz JSON:\n${JSON.stringify(
        quiz,
        null,
        2,
      )}`,
    },
  ];
  const { data: result, modelId } = await callModel<JudgeAudit>({
    model: QUIZ_EVAL_MODEL_ID,
    responseSchema: AUDIT_RESPONSE_SCHEMA,
    schema: JudgeAuditSchema,
    parts,
    rawFilePath,
    label,
    progress,
  });
  return {
    model: {
      modelId,
    },
    result,
    auditedAt: new Date().toISOString(),
  };
}

async function runSampleGeneration(
  job: SampleJob,
  rawDir: string,
  progress: JobProgressReporter,
): Promise<GenerationResult> {
  const source = await loadInlineSource(job.sourcePath);
  const baseRawPath = path.join(rawDir, "quiz.txt");
  const baseJudgeRawPath = path.join(rawDir, "judge.txt");
  const baseJudgeAuditRawPath = path.join(rawDir, "judge-audit.txt");
  const extensionRawPath = path.join(rawDir, "extension.txt");
  const extensionJudgeRawPath = path.join(rawDir, "extension-judge.txt");
  const extensionJudgeAuditRawPath = path.join(
    rawDir,
    "extension-judge-audit.txt",
  );

  const quiz = await generateQuizPayload(
    job,
    source,
    baseRawPath,
    `base quiz ${job.id}`,
    progress,
  );
  const judge = await judgeQuizPayload(
    job,
    source,
    quiz.quiz,
    baseJudgeRawPath,
    `base judgement ${job.id}`,
    progress,
  );
  const audit = await auditJudgeDecisionPayload(
    job,
    source,
    quiz.quiz,
    judge.judge.verdict,
    baseJudgeAuditRawPath,
    `base audit ${job.id}`,
    progress,
  );
  const extension = await generateExtensionPayload(
    job,
    source,
    quiz.quiz,
    extensionRawPath,
    `extension quiz ${job.id}`,
    progress,
  );
  const extensionJudge = await judgeQuizPayload(
    job,
    source,
    extension.quiz,
    extensionJudgeRawPath,
    `extension judgement ${job.id}`,
    progress,
  );
  const extensionAudit = await auditJudgeDecisionPayload(
    job,
    source,
    extension.quiz,
    extensionJudge.judge.verdict,
    extensionJudgeAuditRawPath,
    `extension audit ${job.id}`,
    progress,
  );
  return {
    job,
    quiz,
    judge: {
      ...judge,
      audit,
    },
    extension,
    extensionJudge: {
      ...extensionJudge,
      audit: extensionAudit,
    },
  };
}

async function loadExistingGenerationResult(
  job: SampleJob,
): Promise<GenerationResult | undefined> {
  const sampleDir = path.join(EVAL_OUTPUT_DIR, job.id);
  const quizPath = path.join(sampleDir, "quiz.json");
  const judgePath = path.join(sampleDir, "quiz-judgement.json");
  const extensionPath = path.join(sampleDir, "quiz-extension.json");
  const extensionJudgePath = path.join(
    sampleDir,
    "quiz-extension-judgement.json",
  );
  if (
    !existsSync(quizPath) ||
    !existsSync(judgePath) ||
    !existsSync(extensionPath) ||
    !existsSync(extensionJudgePath)
  ) {
    return undefined;
  }
  try {
    const [quiz, judge, extension, extensionJudge] = await Promise.all([
      readJson<QuizFilePayload>(quizPath),
      readJson<JudgeFilePayload>(judgePath),
      readJson<QuizFilePayload>(extensionPath),
      readJson<JudgeFilePayload>(extensionJudgePath),
    ]);
    return { job, quiz, judge, extension, extensionJudge };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[eval] WARN failed to load existing outputs for ${job.id}: ${reason}`,
    );
    return undefined;
  }
}

function parseCliOptions(argv: readonly string[]): EvalCliOptions {
  const program = createCliCommand(
    "run-eval",
    "Generate sample quizzes using curated study materials",
  );

  program
    .option(
      "--seed <number>",
      "Shuffle jobs deterministically",
      parseSeedOption,
    )
    .option(
      "--maxPrefix <number>",
      "Limit processing to bucket prefixes up to the provided number",
      createIntegerParser({ name: "maxPrefix", min: 0 }),
    )
    .option(
      "--max-prefix <number>",
      "Alias for --maxPrefix",
      createIntegerParser({ name: "maxPrefix", min: 0 }),
    )
    .option(
      "--limit <number>",
      "Process only the first N jobs after filtering",
      createIntegerParser({ name: "limit", min: 1 }),
    )
    .option(
      "--status <mode>",
      "Progress display mode: interactive | plain | off",
      parseStatusModeOption,
      "interactive",
    )
    .option(
      "--auditFailuresOnly [boolean]",
      "Regenerate only jobs flagged by the latest audit checkpoint",
      parseAuditFailuresOnlyOption,
      false,
    )
    .option(
      "--audit-failures-only [boolean]",
      "Alias for --auditFailuresOnly",
      parseAuditFailuresOnlyOption,
    );

  const parsed = program.parse(argv, { from: "user" }).opts<{
    seed?: number;
    maxPrefix?: number;
    limit?: number;
    status: StatusMode;
    auditFailuresOnly: boolean;
  }>();

  return {
    seed: parsed.seed,
    maxPrefix: parsed.maxPrefix,
    limit: parsed.limit,
    statusMode: parsed.status,
    auditFailuresOnly: parsed.auditFailuresOnly ?? false,
  } satisfies EvalCliOptions;
}

function parseSeedOption(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid --seed value: ${raw}`);
  }
  return value;
}

function parseAuditFailuresOnlyOption(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  return parseBooleanOption(value);
}

async function resolveAuditFailureFilter(): Promise<{
  checkpoint: AuditCheckpoint;
  failingJobIds: Set<string>;
}> {
  const checkpoint = await readAuditCheckpoint();
  if (!checkpoint) {
    throw new Error(
      `[eval] Audit checkpoint not found at ${AUDIT_CHECKPOINT_PATH}; run audit-eval before using --auditFailuresOnly.`,
    );
  }
  if (checkpoint.version !== AUDIT_CHECKPOINT_VERSION) {
    throw new Error(
      `[eval] Audit checkpoint version mismatch: expected ${AUDIT_CHECKPOINT_VERSION}, found ${checkpoint.version}. Run audit-eval to refresh the checkpoint.`,
    );
  }
  const failingJobIds = getFailedJobIdSet(checkpoint);
  return { checkpoint, failingJobIds };
}

type SampleIndexEntry = {
  readonly id: string;
  readonly label: string;
  readonly mode: QuizGeneration["mode"];
  readonly subject?: string;
  readonly questionCount: number;
  readonly request: QuizFilePayload["request"];
  readonly source: QuizFilePayload["source"];
  readonly quizTitle: string;
  readonly outputPath: string;
  readonly generatedAt: string;
  readonly outputs: {
    readonly quiz: string;
    readonly judge: string;
    readonly extension: string;
    readonly extensionJudge: string;
  };
  readonly extension: {
    readonly quizTitle: string;
    readonly questionCount: number;
    readonly generatedAt: string;
  };
  readonly judge: {
    readonly verdict: JudgeVerdict["verdict"];
    readonly outputPath: string;
  };
  readonly extensionJudge: {
    readonly verdict: JudgeVerdict["verdict"];
    readonly outputPath: string;
  };
};

type SampleIndex = {
  readonly generatedAt: string;
  readonly samples: SampleIndexEntry[];
};

async function runGenerationStage(
  jobs: SampleJob[],
  {
    checkpoint,
    statusMode,
    forceRegenerate = false,
  }: {
    checkpoint: CheckpointManager;
    statusMode: StatusMode;
    forceRegenerate?: boolean;
  },
): Promise<{ results: GenerationResult[]; index: SampleIndex }> {
  await mkdir(EVAL_OUTPUT_DIR, { recursive: true });
  const resultMap = new Map<string, GenerationResult>();
  const pendingJobs: SampleJob[] = [];
  let reusedCount = 0;

  for (const job of jobs) {
    if (!forceRegenerate && checkpoint.isCompleted(job.id)) {
      const existing = await loadExistingGenerationResult(job);
      if (existing) {
        resultMap.set(job.id, existing);
        reusedCount += 1;
        continue;
      }
      console.warn(
        `[eval] WARN checkpoint marked ${job.id} complete but outputs are missing; regenerating.`,
      );
    }
    pendingJobs.push(job);
  }

  if (reusedCount > 0) {
    console.log(`[eval] Reusing ${reusedCount} samples from checkpoint.`);
  }

  if (pendingJobs.length > 0) {
    const concurrency = Math.min(MAX_CONCURRENT_ANALYSES, pendingJobs.length);
    console.log(
      `[eval] Generating ${pendingJobs.length} of ${jobs.length} samples with concurrency ${concurrency}.`,
    );
    const generated = await runJobsWithConcurrency<SampleJob, GenerationResult>(
      {
        items: pendingJobs,
        concurrency,
        getId: (job) => job.id,
        label: "[eval]",
        statusMode,
        updateIntervalMs: statusMode === "plain" ? 10_000 : undefined,
        handler: async (job, { progress }) => {
          const sampleDir = path.join(EVAL_OUTPUT_DIR, job.id);
          const rawDir = path.join(sampleDir, "raw");
          await rm(sampleDir, { recursive: true, force: true });
          await mkdir(sampleDir, { recursive: true });
          await mkdir(rawDir, { recursive: true });
          try {
            const result = await runSampleGeneration(job, rawDir, progress);
            await writeJson(path.join(sampleDir, "quiz.json"), result.quiz);
            await writeJson(path.join(sampleDir, "detail.json"), result.quiz);
            await writeJson(
              path.join(sampleDir, "quiz-judgement.json"),
              result.judge,
            );
            await writeJson(
              path.join(sampleDir, "quiz-extension.json"),
              result.extension,
            );
            await writeJson(
              path.join(sampleDir, "quiz-extension-judgement.json"),
              result.extensionJudge,
            );
            checkpoint.markCompleted(job.id);
            return result;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            progress.log(`ERROR ${message}`);
            throw error;
          }
        },
      },
    );
    for (const result of generated) {
      resultMap.set(result.job.id, result);
    }
  } else if (jobs.length > 0) {
    console.log(
      `[eval] No pending samples to generate; using checkpoint outputs for all ${jobs.length} samples.`,
    );
  }

  const orderedResults = jobs.map((job) => {
    const result = resultMap.get(job.id);
    if (!result) {
      throw new Error(`Missing generation result for job ${job.id}`);
    }
    return result;
  });

  const indexGeneratedAt = new Date().toISOString();
  const index: SampleIndex = {
    generatedAt: indexGeneratedAt,
    samples: orderedResults.map((result, indexPosition) => ({
      id: result.job.id,
      label: `Sample ${indexPosition + 1}: ${result.job.displayName}`,
      mode: result.quiz.quiz.mode,
      subject: result.quiz.quiz.subject,
      questionCount: result.quiz.quiz.questionCount,
      request: result.quiz.request,
      source: result.quiz.source,
      quizTitle: result.quiz.quiz.quizTitle,
      outputPath: `/admin/sample-quizzes/${result.job.id}/detail.json`,
      generatedAt: result.quiz.generatedAt,
      outputs: {
        quiz: `/admin/sample-quizzes/${result.job.id}/quiz.json`,
        judge: `/admin/sample-quizzes/${result.job.id}/quiz-judgement.json`,
        extension: `/admin/sample-quizzes/${result.job.id}/quiz-extension.json`,
        extensionJudge: `/admin/sample-quizzes/${result.job.id}/quiz-extension-judgement.json`,
      },
      extension: {
        quizTitle: result.extension.quiz.quizTitle,
        questionCount: result.extension.quiz.questionCount,
        generatedAt: result.extension.generatedAt,
      },
      judge: {
        verdict: result.judge.judge.verdict.verdict,
        outputPath: `/admin/sample-quizzes/${result.job.id}/quiz-judgement.json`,
      },
      extensionJudge: {
        verdict: result.extensionJudge.judge.verdict.verdict,
        outputPath: `/admin/sample-quizzes/${result.job.id}/quiz-extension-judgement.json`,
      },
    })),
  };

  await writeJson(path.join(EVAL_OUTPUT_DIR, "index.json"), index);
  console.log(`[eval] Wrote index.json with ${orderedResults.length} entries.`);

  return { results: orderedResults, index };
}

async function main(): Promise<void> {
  const {
    seed,
    maxPrefix,
    limit: jobLimit,
    statusMode,
    auditFailuresOnly,
  } = parseCliOptions(process.argv);
  let auditFilterApplied = false;

  const checkpoint = await CheckpointManager.load(CHECKPOINT_DIR);
  checkpoint.ensureSeed(seed);

  const jobs = await collectJobs();
  await checkpoint.pruneTo(new Set(jobs.map((job) => job.id)));
  if (jobs.length === 0) {
    console.warn("[eval] No sample files found.");
    await checkpoint.flush();
    return;
  }

  let workingJobs =
    seed !== undefined ? shuffleWithSeed(jobs, seed) : [...jobs];
  if (seed !== undefined) {
    console.log(
      `[eval] Shuffling ${workingJobs.length} samples with --seed=${seed}.`,
    );
  }

  if (maxPrefix !== undefined) {
    const beforeCount = workingJobs.length;
    workingJobs = filterJobsByMaxPrefix(workingJobs, maxPrefix);
    console.log(
      `[eval] Applying --maxPrefix=${maxPrefix}; ${workingJobs.length} of ${beforeCount} samples match.`,
    );
  }

  if (auditFailuresOnly) {
    const { checkpoint: auditCheckpoint, failingJobIds } =
      await resolveAuditFailureFilter();
    if (failingJobIds.size === 0) {
      const checkpointRelativePath = path.relative(
        REPO_ROOT,
        AUDIT_CHECKPOINT_PATH,
      );
      console.warn(
        `[eval] Audit checkpoint at ${checkpointRelativePath} lists no flagged quizzes; nothing to regenerate.`,
      );
      await checkpoint.flush();
      return;
    }
    const beforeCount = workingJobs.length;
    const availableJobIds = new Set(workingJobs.map((job) => job.id));
    const missingJobIds = Array.from(failingJobIds).filter(
      (id) => !availableJobIds.has(id),
    );
    if (missingJobIds.length > 0) {
      const preview = missingJobIds.slice(0, 5).join(", ");
      console.warn(
        `[eval] WARN audit checkpoint references ${missingJobIds.length} job${missingJobIds.length === 1 ? "" : "s"} not present in inputs: ${preview}${missingJobIds.length > 5 ? ", ..." : ""}.`,
      );
    }
    workingJobs = workingJobs.filter((job) => failingJobIds.has(job.id));
    auditFilterApplied = true;
    const checkpointRelativePath = path.relative(
      REPO_ROOT,
      AUDIT_CHECKPOINT_PATH,
    );
    console.log(
      `[eval] Applying --auditFailuresOnly using ${checkpointRelativePath}; ${workingJobs.length} of ${beforeCount} samples match ${failingJobIds.size} flagged sample${failingJobIds.size === 1 ? "" : "s"} (checkpoint entries: ${auditCheckpoint.failures.length}).`,
    );
  }

  if (workingJobs.length === 0) {
    if (auditFailuresOnly && auditFilterApplied) {
      console.warn(
        "[eval] No failing samples remain after applying --auditFailuresOnly.",
      );
    } else {
      console.warn("[eval] No sample files remain after applying filters.");
    }
    await checkpoint.flush();
    return;
  }

  const effectiveJobs =
    jobLimit !== undefined
      ? workingJobs.slice(0, Math.max(0, jobLimit))
      : workingJobs;
  if (jobLimit !== undefined) {
    console.log(
      `[eval] Applying --limit=${jobLimit}; processing ${effectiveJobs.length} of ${workingJobs.length} samples.`,
    );
  }
  checkpoint.start();
  try {
    await runGenerationStage(effectiveJobs, {
      checkpoint,
      statusMode,
      forceRegenerate: auditFailuresOnly,
    });
    return;
  } finally {
    await checkpoint.flush();
  }
}

main().catch((error) => {
  console.error("[eval] Unhandled error:", error);
  process.exitCode = 1;
});
