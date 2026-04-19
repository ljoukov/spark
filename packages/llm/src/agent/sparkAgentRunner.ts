import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { promisify } from "node:util";

import type { PyodideInterface } from "pyodide";
import { zodToJsonSchema } from "@alcyone-labs/zod-to-json-schema";
import { z } from "zod";
import {
  type AgentFilesystem,
  type AgentFilesystemToolAccessContext,
  type AgentFilesystemToolConfig,
  type AgentSubagentToolSelection,
  createCodexFilesystemToolSet,
  createNodeAgentFilesystem,
  estimateCallCostUsd,
  generateText,
  getCurrentToolCallContext,
  isChatGptModelId,
  isFireworksModelId,
  isGeminiModelId,
  isLlmTextModelId,
  isOpenAiModelId,
  parseJsonFromLlmText,
  runAgentLoop,
  toGeminiJsonSchema,
  tool,
  type LlmContentPart,
  type LlmExecutableTool,
  type LlmInputMessage,
  type LlmStreamEvent,
  type LlmTextModelId,
  type LlmTextResult,
  type LlmThinkingLevel,
  type LlmToolConfig,
  type LlmToolLoopResult,
  type LlmToolSet,
  type LlmUsageTokens,
} from "@ljoukov/llm";
import {
  countPaperSheetQuestions,
  SparkAgentAvailableToolSchema,
  CodeProblemSchema,
  QuizDefinitionSchema,
  SessionSchema,
  SessionMediaDocSchema,
  SparkAgentStateTimelineSchema,
  SparkGraderWorksheetReferencesSchema,
  SparkGraderWorksheetReportSchema,
  SparkSolveSheetDraftSchema,
  SparkTutorComposerStateSchema,
  SparkTutorHistoryEntrySchema,
  SparkTutorReviewStateSchema,
  SparkTutorReviewThreadSchema,
  SparkTutorScreenStateSchema,
  SparkAgentWorkspaceFileSchema,
  applyPaperSheetSubjectTheme,
  coerceSparkSolveSheetDraft,
  normalizeTutorMarkdown,
  visitPaperSheetQuestions,
  type CodeProblem,
  type PaperSheetQuestionEntry,
  type PaperSheetQuestion,
  type QuizDefinition,
  type Session,
  type SessionMediaDoc,
  type SparkAgentAvailableTool,
  type SparkAgentStateTimeline,
  type SparkGraderWorksheetReport,
  type SparkSolveSheetDraft,
  type SparkTutorComposerState,
  type SparkTutorReviewState,
} from "@spark/schemas";

import { errorAsString } from "../utils/error";
import {
  loadEnvFromFile,
  loadLocalEnv,
  preferGoogleServiceAccountAuth,
} from "../utils/env";
import { formatByteSize, formatMillis } from "../utils/format";
import {
  deleteFirestoreDocument,
  getFirestoreDocument,
  listFirestoreDocuments,
  patchFirestoreDocument,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import { parseGoogleServiceAccountJson } from "../utils/gcp/googleAccessToken";
import {
  configureSparkLlmTelemetryFromEnv,
  createSparkAgentRunTelemetryConfig,
  publishSparkAgentProcessMetricsFromEnv,
  publishSparkToolLoopStepMetricsFromEnv,
  resolveSparkMetricProviderLabel,
} from "../utils/gcp/monitoring";
import { downloadStorageObject } from "../utils/gcp/storageRest";
import { applyPdfTranscriptionSkillTools } from "./skills/pdfTranscription";
import {
  renderSparkAgentSkillReadList,
  SPARK_GRADER_SKILL_IDS,
} from "./sparkAgentSkills";
import { AgentProcessUsageMonitor } from "./agentProcessUsageMonitor";
import {
  SparkGraderRequestPayloadSchema,
  resolveSparkGraderModelTools,
  type SparkGraderRequestPayload,
} from "./sparkChatShared";
import { captureSparkAgentReplayState } from "./sparkAgentReplayArtifacts";
import {
  buildWorkspaceFileDocPath,
  buildWorkspaceFilesCollectionPath,
  normalizeStorageObjectName,
  persistWorkspaceFileFromLocalFs,
  resolveWorkspaceFilePathFromFirestoreDocument,
  resolveWorkspacePathContentType,
} from "./workspaceFileStore";
import {
  cacheSharedPdfFromUrl,
  downloadSharedPdfToWorkspace,
  findSharedPdfKnowledgeBaseByUrl,
  listSharedPdfKnowledgeBase,
  searchSharedPdfKnowledgeBaseEntries,
  writeKnowledgeBaseWorkspaceFiles,
  writeSharedPdfKnowledgeBaseEntryFile,
  type SharedPdfKnowledgeBaseEntry,
} from "./sharedPdfKnowledgeBase";
import { launchSparkGapsFinderForRun } from "./gapsFinderAgent";
import {
  encodeBgraBitmapToPng,
  getPdfPageCount,
  renderPdfPagesBgra,
} from "../utils/pdfium";
import { getSharp } from "../utils/sharp";
import type {
  JobProgressReporter,
  LlmUsageChunk,
  LlmUsageTokenUpdate,
  ModelCallHandle,
  StageHandle,
} from "../utils/concurrency";

const execFileAsync = promisify(execFile);

const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.4-fast";
const SPARK_AGENT_FILESYSTEM_TOOL_PROFILE = "codex" as const;

type LlmDebugOptions = {
  readonly rootDir: string;
  readonly stage?: string;
  readonly subStage?: string;
  readonly enabled?: boolean;
};
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_LESSON_MAX_STEPS = 1000;
const DEFAULT_PDF_EXTRACTION_MODEL_ID: LlmTextModelId = "gemini-2.5-pro";
const DEFAULT_EXTRACT_TEXT_MODEL_ID: LlmTextModelId = "gemini-flash-latest";
const SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;
const SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPE_SET = new Set<string>(
  SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES,
);
const READ_WORKSPACE_FILE_DEFAULT_MAX_CHARS = 24_000;
const READ_WORKSPACE_FILE_MAX_CHARS = 200_000;
const READ_WORKSPACE_FILE_DEFAULT_RANGE_LINES = 240;
const READ_WORKSPACE_FILE_MAX_RANGE_LINES = 2_000;
const READ_WORKSPACE_FILE_LARGE_OUTLINE_MAX_LINES = 90;

type TrackedSubmodelCallSummary = {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly elapsedMs: number;
  readonly usageTokens: LlmUsageTokenUpdate | null;
  readonly costUsd: number | null;
};

type PdfImagesListEntry = {
  readonly page: number;
  readonly imageNumber: number;
  readonly type: string;
  readonly width: number;
  readonly height: number;
  readonly color: string;
  readonly components: number | null;
  readonly bitsPerComponent: number | null;
  readonly encoding: string;
  readonly interpolate: string;
  readonly objectId: string | null;
  readonly xPpi: number | null;
  readonly yPpi: number | null;
  readonly size: string | null;
  readonly ratio: string | null;
};

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parsePdfImagesListOutput(stdout: string): PdfImagesListEntry[] {
  const entries: PdfImagesListEntry[] = [];
  for (const line of stdout.split(/\r?\n/gu)) {
    const columns = line.trim().split(/\s+/u).filter(Boolean);
    if (columns.length < 10 || !/^\d+$/u.test(columns[0] ?? "")) {
      continue;
    }

    const page = Number.parseInt(columns[0] ?? "", 10);
    const imageNumber = Number.parseInt(columns[1] ?? "", 10);
    const width = Number.parseInt(columns[3] ?? "", 10);
    const height = Number.parseInt(columns[4] ?? "", 10);
    if (
      !Number.isFinite(page) ||
      !Number.isFinite(imageNumber) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      continue;
    }

    const objectNumber = columns[10];
    const objectGeneration = columns[11];
    const xPpi = Number.parseInt(columns[12] ?? "", 10);
    const yPpi = Number.parseInt(columns[13] ?? "", 10);
    const components = Number.parseInt(columns[6] ?? "", 10);
    const bitsPerComponent = Number.parseInt(columns[7] ?? "", 10);

    entries.push({
      page,
      imageNumber,
      type: columns[2] ?? "unknown",
      width,
      height,
      color: columns[5] ?? "unknown",
      components: Number.isFinite(components) ? components : null,
      bitsPerComponent: Number.isFinite(bitsPerComponent)
        ? bitsPerComponent
        : null,
      encoding: columns[8] ?? "unknown",
      interpolate: columns[9] ?? "unknown",
      objectId:
        objectNumber !== undefined && objectGeneration !== undefined
          ? `${objectNumber} ${objectGeneration}`
          : null,
      xPpi: Number.isFinite(xPpi) ? xPpi : null,
      yPpi: Number.isFinite(yPpi) ? yPpi : null,
      size: columns[14] ?? null,
      ratio: columns[15] ?? null,
    });
  }
  return entries;
}

function sanitizePdfImageFilenamePrefix(value: string | undefined): string {
  const normalized = (value ?? "embedded-image")
    .trim()
    .replace(/[^a-z0-9_-]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
  if (normalized.length > 0) {
    return normalized.slice(0, 80);
  }
  return "embedded-image";
}

async function resolvePdfImagesExtractedFiles(options: {
  outputDir: string;
  absoluteOutputDir: string;
  filenamePrefix: string;
}): Promise<
  Array<{
    path: string;
    width: number | null;
    height: number | null;
    bytes: number;
  }>
> {
  const entries = await readdir(options.absoluteOutputDir, {
    withFileTypes: true,
  }).catch(() => []);
  const imageFiles = entries
    .filter((entry) => {
      if (!entry.isFile()) {
        return false;
      }
      if (!entry.name.startsWith(`${options.filenamePrefix}-`)) {
        return false;
      }
      return /\.(?:png|jpe?g|ppm|pbm|tiff?|jp2|jb2[eg]?)$/iu.test(entry.name);
    })
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const results: Array<{
    path: string;
    width: number | null;
    height: number | null;
    bytes: number;
  }> = [];
  for (const fileName of imageFiles) {
    const absolutePath = path.join(options.absoluteOutputDir, fileName);
    const relativePath = `${options.outputDir}/${fileName}`;
    const fileStat = await stat(absolutePath);
    let width: number | null = null;
    let height: number | null = null;
    try {
      const metadata = await getSharp()(absolutePath).metadata();
      if (typeof metadata.width === "number" && metadata.width > 0) {
        width = metadata.width;
      }
      if (typeof metadata.height === "number" && metadata.height > 0) {
        height = metadata.height;
      }
    } catch {
      width = null;
      height = null;
    }
    results.push({
      path: relativePath,
      width,
      height,
      bytes: fileStat.size,
    });
  }
  return results;
}

function attachExtractedPdfImagePaths(options: {
  images: PdfImagesListEntry[];
  files: Array<{
    path: string;
    width: number | null;
    height: number | null;
    bytes: number;
  }>;
}): Array<Record<string, unknown>> {
  const usedFiles = new Set<number>();
  return options.images.map((image) => {
    const fileIndex = options.files.findIndex((file, index) => {
      return (
        !usedFiles.has(index) &&
        file.width === image.width &&
        file.height === image.height
      );
    });
    if (fileIndex !== -1) {
      usedFiles.add(fileIndex);
    }
    const file = fileIndex !== -1 ? options.files[fileIndex] : null;
    return {
      page: image.page,
      imageNumber: image.imageNumber,
      type: image.type,
      width: image.width,
      height: image.height,
      color: image.color,
      components: image.components,
      bitsPerComponent: image.bitsPerComponent,
      encoding: image.encoding,
      interpolate: image.interpolate,
      objectId: image.objectId,
      xPpi: image.xPpi,
      yPpi: image.yPpi,
      size: image.size,
      ratio: image.ratio,
      ...(file
        ? {
            path: file.path,
            outputBytes: file.bytes,
          }
        : {}),
    };
  });
}
const DEFAULT_GENERATE_TEXT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.4-fast";
const WORKSPACE_UPDATE_THROTTLE_MS = 10_000;
const AGENT_LOG_THROTTLE_MS = 2_000;
const AGENT_TOOL_LOG_SNIPPET_MAX_BYTES = 4 * 1024;
const AGENT_TOOL_LOG_SNIPPET_MAX_CHARS = 1_000;
const STOP_POLL_INTERVAL_MS = 10_000;
const AGENT_INLINE_ATTACHMENTS_MAX_COUNT = 24;
const AGENT_INLINE_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const ATTACHMENT_DOWNLOAD_CONCURRENCY = 6;
const DEFAULT_PDF_PAGE_IMAGE_SCALE = 4.75;
const DEFAULT_PDF_PAGE_IMAGE_MAX_DIMENSION = 4000;
const PDF_PAGE_NUMBERS_PREFERRED_THRESHOLD = 12;
const PDF_PAGE_NUMBERS_REQUIRED_THRESHOLD =
  PDF_PAGE_NUMBERS_PREFERRED_THRESHOLD;
const GRADER_PRE_PUBLISH_IMAGE_EDIT_BUDGET = 80;
const GRADER_PRE_PUBLISH_CROP_ATTEMPTS_PER_OUTPUT_BUDGET = 6;
const WEB_FETCH_TIMEOUT_MS = 20_000;
const WEB_FETCH_MAX_BYTES = 6 * 1024 * 1024;
const WEB_FETCH_DEFAULT_MAX_CHARS = 20_000;
const PDF_EXTRACTION_MAX_BYTES = 16 * 1024 * 1024;
const PDF_EXTRACTION_DEFAULT_MAX_CHARS = 200_000;
const EXTRACT_TEXT_MAX_BYTES = 16 * 1024 * 1024;
const EXTRACT_TEXT_DEFAULT_MAX_CHARS = 200_000;
const EXTRACT_TEXT_MAX_DOCUMENT_FILES = 12;
const EXTRACT_TEXT_MAX_CONTEXT_FILES = 8;
const EXTRACT_TEXT_CONTEXT_TEXT_MAX_CHARS = 20_000;
const EXTRACT_TEXT_RESPONSE_STREAM_LOG_THROTTLE_MS = 5_000;
const EXTRACT_TEXT_DEFAULT_SUPPORTING_PROMPT =
  "Supporting documents are for ambiguity resolution only; do not transcribe them unless explicitly instructed.";
const PDF_DIAGRAM_DEFAULT_MAX_ITEMS = 32;
const PDF_DIAGRAM_MAX_ITEMS = 64;
const GRADER_PRE_PUBLISH_DIAGRAM_EXTRACTION_BUDGET = 8;
const DEFAULT_PDF_DIAGRAM_EXTRACTION_PROMPT =
  "Identify answer-critical figures, diagrams, graphs, tables, and option-diagram blocks in this PDF. Return coarse rectangular bounding boxes that include all labels, axes, legends, option labels, and required annotations while excluding surrounding question text where practical.";
const PDF_EMBEDDED_IMAGE_MAX_ITEMS = 300;
const PDF_EMBEDDED_IMAGE_DEFAULT_MAX_ITEMS = 100;
const PDF_IMAGES_CLI_MAX_BUFFER = 16 * 1024 * 1024;
const TUTOR_CONTEXT_PROBLEM_PATH = "context/problem.md";
const TUTOR_CONTEXT_REPORT_PATH = "context/report.json";
const TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH = "context/official-solution.md";
const TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH = "context/student-transcript.md";
const TUTOR_CONTEXT_GRADING_PATH = "context/grading.md";
const TUTOR_CONTEXT_ANNOTATIONS_PATH = "context/annotations.md";
const TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH = "context/overall-feedback.md";
const TUTOR_UI_TOP_PANEL_PATH = "ui/tutor.md";
const TUTOR_UI_INLINE_FEEDBACK_PATH = "ui/inline-feedback.md";
const TUTOR_STATE_SESSION_PATH = "state/session.json";
const TUTOR_STATE_COMPOSER_PATH = "state/composer.json";
const TUTOR_STATE_REVIEW_PATH = "state/review.json";
const TUTOR_HISTORY_TURNS_PATH = "history/turns.jsonl";
const TUTOR_FEEDBACK_ROOT_DIR = "feedback/questions";

async function loadSparkGraderRequestPayloadFromWorkspace(rootDir: string) {
  const requestPath = path.join(rootDir, "request.json");
  try {
    const raw = await readFile(requestPath, { encoding: "utf8" });
    return SparkGraderRequestPayloadSchema.parse(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function collectRawWorksheetScoreTotals(sheetJson: unknown): {
  awardedMarks: number;
  maxMarks: number;
  scoredQuestions: number;
} | null {
  const root = asJsonObject(sheetJson);
  const review = asJsonObject(root?.review);
  const questions = asJsonObject(review?.questions);
  if (!questions) {
    return null;
  }
  let awardedMarks = 0;
  let maxMarks = 0;
  let scoredQuestions = 0;
  for (const value of Object.values(questions)) {
    const questionReview = asJsonObject(value);
    const score = asJsonObject(questionReview?.score);
    const got = score?.got;
    const total = score?.total;
    if (typeof got !== "number" || typeof total !== "number") {
      continue;
    }
    if (!Number.isFinite(got) || !Number.isFinite(total)) {
      continue;
    }
    awardedMarks += got;
    maxMarks += total;
    scoredQuestions += 1;
  }
  if (scoredQuestions === 0) {
    return null;
  }
  return {
    awardedMarks,
    maxMarks,
    scoredQuestions,
  };
}

async function normalizeRawGraderAggregateScoresForPublish(options: {
  rootDir: string;
  summaryPath: string;
  sheetPath: string;
  sheetJson: unknown;
  summary: GraderRunSummary;
  onWorkspaceFileChanged?: (filePath: string) => void;
}): Promise<{
  sheetJson: unknown;
  sheetRaw: string | null;
  summaryRaw: string | null;
  summary: GraderRunSummary;
}> {
  const totals = collectRawWorksheetScoreTotals(options.sheetJson);
  if (!totals) {
    return {
      sheetJson: options.sheetJson,
      sheetRaw: null,
      summaryRaw: null,
      summary: options.summary,
    };
  }

  const root = asJsonObject(options.sheetJson);
  const review = asJsonObject(root?.review);
  const score = asJsonObject(review?.score);
  if (!root || !review || !score) {
    return {
      sheetJson: options.sheetJson,
      sheetRaw: null,
      summaryRaw: null,
      summary: options.summary,
    };
  }

  const currentGot = score.got;
  const currentTotal = score.total;
  let sheetChanged = false;
  if (currentGot !== totals.awardedMarks) {
    score.got = totals.awardedMarks;
    sheetChanged = true;
  }
  if (currentTotal !== totals.maxMarks) {
    score.total = totals.maxMarks;
    sheetChanged = true;
  }
  const label = review.label;
  if (
    typeof label === "string" &&
    /^\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:marks?)?\s*$/iu.test(label)
  ) {
    const normalizedLabel = `${totals.awardedMarks.toString()}/${totals.maxMarks.toString()}`;
    if (label !== normalizedLabel) {
      review.label = normalizedLabel;
      sheetChanged = true;
    }
  }

  let sheetRaw: string | null = null;
  const summaryTotals = options.summary.totals;
  if (!summaryTotals) {
    return {
      sheetJson: options.sheetJson,
      sheetRaw,
      summaryRaw: null,
      summary: options.summary,
    };
  }
  let summaryChanged = false;
  if (summaryTotals.awardedMarks !== totals.awardedMarks) {
    summaryTotals.awardedMarks = totals.awardedMarks;
    summaryChanged = true;
  }
  if (summaryTotals.maxMarks !== totals.maxMarks) {
    summaryTotals.maxMarks = totals.maxMarks;
    summaryChanged = true;
  }

  if (sheetChanged) {
    sheetRaw = JSON.stringify(options.sheetJson, null, 2).concat("\n");
    await writeFile(
      resolveWorkspacePath(options.rootDir, options.sheetPath),
      sheetRaw,
      { encoding: "utf8" },
    );
    options.onWorkspaceFileChanged?.(options.sheetPath);
  }
  if (summaryChanged) {
    const summaryRaw = JSON.stringify(options.summary, null, 2).concat("\n");
    await writeFile(
      resolveWorkspacePath(options.rootDir, options.summaryPath),
      summaryRaw,
      { encoding: "utf8" },
    );
    options.onWorkspaceFileChanged?.(options.summaryPath);
    return {
      sheetJson: options.sheetJson,
      sheetRaw,
      summaryRaw,
      summary: options.summary,
    };
  }

  return {
    sheetJson: options.sheetJson,
    sheetRaw,
    summaryRaw: null,
    summary: options.summary,
  };
}

async function normalizeRawGraderSummaryMetadataForPublish(options: {
  rootDir: string;
  summaryPath: string;
  summaryJson: unknown;
  onWorkspaceFileChanged?: (filePath: string) => void;
}): Promise<{
  summaryJson: unknown;
  summaryRaw: string | null;
}> {
  const summary = asJsonObject(options.summaryJson);
  if (!summary) {
    return {
      summaryJson: options.summaryJson,
      summaryRaw: null,
    };
  }

  let changed = false;
  if (typeof summary.year === "number" && Number.isFinite(summary.year)) {
    summary.year = summary.year.toString();
    changed = true;
  }

  if (!changed) {
    return {
      summaryJson: options.summaryJson,
      summaryRaw: null,
    };
  }

  const summaryRaw = JSON.stringify(options.summaryJson, null, 2).concat("\n");
  await writeFile(
    resolveWorkspacePath(options.rootDir, options.summaryPath),
    summaryRaw,
    { encoding: "utf8" },
  );
  options.onWorkspaceFileChanged?.(options.summaryPath);

  return {
    summaryJson: options.summaryJson,
    summaryRaw,
  };
}

function isSupportedQuestionReviewStatus(value: unknown): boolean {
  return (
    value === "correct" || value === "incorrect" || value === "teacher-review"
  );
}

function inferQuestionReviewStatusFromRawScore(
  score: Record<string, unknown> | null,
): "correct" | "incorrect" | "teacher-review" {
  const got = score?.got;
  const total = score?.total;
  if (
    typeof got === "number" &&
    typeof total === "number" &&
    Number.isFinite(got) &&
    Number.isFinite(total)
  ) {
    return got >= total ? "correct" : "incorrect";
  }
  return "teacher-review";
}

function normalizeRawPaperSheetAnswerValue(
  value: unknown,
): SparkGraderWorksheetReport["answers"][string] | undefined {
  if (typeof value === "string") {
    return value;
  }
  const record = asJsonObject(value);
  if (!record) {
    return undefined;
  }

  const answer: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") {
      answer[key] = entry;
      continue;
    }
    if (typeof entry === "number" && Number.isFinite(entry)) {
      answer[key] = entry.toString();
    }
  }
  return answer;
}

function collectRawInlineQuestionAnswers(
  value: unknown,
  answers: Map<string, SparkGraderWorksheetReport["answers"][string]>,
): void {
  const record = asJsonObject(value);
  if (!record) {
    return;
  }

  const id = record.id;
  if (typeof id === "string" && "answer" in record) {
    const answer = normalizeRawPaperSheetAnswerValue(record.answer);
    if (answer !== undefined) {
      answers.set(id, answer);
    }
  }

  const children = record.questions;
  if (Array.isArray(children)) {
    for (const child of children) {
      collectRawInlineQuestionAnswers(child, answers);
    }
  }

  const sections = record.sections;
  if (Array.isArray(sections)) {
    for (const section of sections) {
      collectRawInlineQuestionAnswers(section, answers);
    }
  }
}

function defaultPaperSheetAnswerForQuestion(
  question: PaperSheetQuestion,
): SparkGraderWorksheetReport["answers"][string] {
  if (
    question.type === "mcq" ||
    question.type === "lines" ||
    question.type === "calc"
  ) {
    return "";
  }

  if (
    question.type === "fill" ||
    question.type === "cloze" ||
    question.type === "answer_bank"
  ) {
    return Object.fromEntries(
      question.blanks.map((_, index) => [index.toString(), ""]),
    );
  }

  if (question.type === "match") {
    return Object.fromEntries(question.pairs.map((pair) => [pair.term, ""]));
  }

  if (question.type === "spelling") {
    return Object.fromEntries(
      question.words.map((_, index) => [index.toString(), ""]),
    );
  }

  const answer: Record<string, string> = {};
  for (const box of question.boxes) {
    if (box.initialValue === undefined && box.readonly !== true) {
      answer[box.id] = "";
    }
  }
  return answer;
}

function coerceBareGraderWorksheetReportForPublish(
  value: unknown,
): SparkGraderWorksheetReport | null {
  const direct = SparkGraderWorksheetReportSchema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  const root = asJsonObject(value);
  if (!root || root.sheet !== undefined || !Array.isArray(root.sections)) {
    return null;
  }

  const sourceSections = root.sections;
  const title =
    typeof root.title === "string" && root.title.trim().length > 0
      ? root.title.trim()
      : "Graded worksheet";
  const subtitle =
    typeof root.subtitle === "string" && root.subtitle.trim().length > 0
      ? root.subtitle.trim()
      : "Submitted answers";
  const subject =
    typeof root.subject === "string" && root.subject.trim().length > 0
      ? root.subject.trim()
      : "Worksheet";
  const level =
    typeof root.level === "string" && root.level.trim().length > 0
      ? root.level.trim()
      : subject;

  const candidateSections = [
    {
      id: "questions",
      label: "Questions",
      questions: sourceSections,
    },
  ];
  const draft = coerceSparkSolveSheetDraft({
    schemaVersion: 1,
    mode: "draft",
    sheet: {
      id:
        typeof root.id === "string" && root.id.trim().length > 0
          ? root.id.trim()
          : "graded-worksheet",
      subject,
      level,
      title,
      subtitle,
      color: typeof root.color === "string" ? root.color : "#2F6F3E",
      accent: typeof root.accent === "string" ? root.accent : "#327A45",
      light: typeof root.light === "string" ? root.light : "#EAF6EE",
      border: typeof root.border === "string" ? root.border : "#B7D8C1",
      sections: candidateSections,
    },
    ...(root.references !== undefined ? { references: root.references } : {}),
  });
  if (!draft) {
    return null;
  }

  const inlineAnswers = new Map<
    string,
    SparkGraderWorksheetReport["answers"][string]
  >();
  collectRawInlineQuestionAnswers(root, inlineAnswers);
  const explicitAnswers = asJsonObject(root.answers);
  if (explicitAnswers) {
    for (const [questionId, rawAnswer] of Object.entries(explicitAnswers)) {
      const answer = normalizeRawPaperSheetAnswerValue(rawAnswer);
      if (answer !== undefined) {
        inlineAnswers.set(questionId, answer);
      }
    }
  }

  const rawReview = asJsonObject(root.review);
  const rawReviewQuestions = asJsonObject(rawReview?.questions) ?? {};
  const answers: SparkGraderWorksheetReport["answers"] = {};
  const reviewQuestions: SparkGraderWorksheetReport["review"]["questions"] = {};
  visitPaperSheetQuestions(
    draft.sheet.sections.flatMap((section) => {
      return "questions" in section && section.questions
        ? section.questions
        : [];
    }),
    (question) => {
      answers[question.id] =
        inlineAnswers.get(question.id) ??
        defaultPaperSheetAnswerForQuestion(question);
      const rawReviewEntry =
        asJsonObject(rawReviewQuestions[question.id]) ?? {};
      const rawScore = asJsonObject(rawReviewEntry.score);
      const status = isSupportedQuestionReviewStatus(rawReviewEntry.status)
        ? (rawReviewEntry.status as "correct" | "incorrect" | "teacher-review")
        : inferQuestionReviewStatusFromRawScore(rawScore);
      reviewQuestions[question.id] = {
        ...rawReviewEntry,
        status,
        note:
          typeof rawReviewEntry.note === "string" ? rawReviewEntry.note : "",
      };
    },
  );

  const rawScore = asJsonObject(rawReview?.score);
  const got = rawScore?.got;
  const total = rawScore?.total;
  const score = {
    got: typeof got === "number" && Number.isFinite(got) ? got : 0,
    total: typeof total === "number" && Number.isFinite(total) ? total : 0,
  };
  const review = {
    mode:
      rawReview?.mode === "awaiting_answers"
        ? ("awaiting_answers" as const)
        : ("graded" as const),
    score,
    label:
      typeof rawReview?.label === "string" && rawReview.label.trim().length > 0
        ? rawReview.label.trim()
        : `${score.got.toString()}/${score.total.toString()}`,
    message:
      typeof rawReview?.message === "string" &&
      rawReview.message.trim().length > 0
        ? rawReview.message.trim()
        : "Graded submitted work.",
    note: typeof rawReview?.note === "string" ? rawReview.note : "",
    questions: reviewQuestions,
  };

  const references = SparkGraderWorksheetReferencesSchema.safeParse(
    root.references,
  );
  const report = SparkGraderWorksheetReportSchema.safeParse({
    schemaVersion: 1,
    sheet: draft.sheet,
    answers,
    review,
    ...(references.success ? { references: references.data } : {}),
  });
  return report.success ? report.data : null;
}

const PAPER_SHEET_DEFAULT_COLORS = {
  color: "#2F6F3E",
  accent: "#327A45",
  light: "#EAF6EE",
  border: "#B7D8C1",
} as const;

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/u.test(value);
}

function normalizeRawPaperSheetShapeForPublish(value: unknown): {
  readonly value: unknown;
  readonly changed: boolean;
} {
  const root = asJsonObject(value);
  if (!root) {
    return { value, changed: false };
  }

  const rootSheet = asJsonObject(root.sheet);
  const sheet = rootSheet ?? root;
  if (!Array.isArray(sheet.sections)) {
    return { value, changed: false };
  }

  let changed = false;
  const nextRoot: Record<string, unknown> = { ...root };
  const nextSheet: Record<string, unknown> = { ...sheet };
  const review = asJsonObject(root.review);
  const nextReview = review ? { ...review } : null;
  const questionById = new Map<string, Record<string, unknown>>();

  if (
    nextReview &&
    nextReview.mode !== "graded" &&
    nextReview.mode !== "awaiting_answers"
  ) {
    nextReview.mode = "graded";
    changed = true;
  }

  for (const [key, fallback] of Object.entries(PAPER_SHEET_DEFAULT_COLORS)) {
    if (!isHexColor(nextSheet[key])) {
      nextSheet[key] = fallback;
      changed = true;
    }
  }

  const normalizeQuestionEntry = (entry: unknown): unknown => {
    const question = asJsonObject(entry);
    if (!question) {
      return entry;
    }
    const nextQuestion: Record<string, unknown> = { ...question };
    if (typeof nextQuestion.id === "string") {
      questionById.set(nextQuestion.id, nextQuestion);
    }
    if (
      nextQuestion.type === "calc" &&
      (typeof nextQuestion.inputLabel !== "string" ||
        nextQuestion.inputLabel.trim().length === 0 ||
        typeof nextQuestion.unit !== "string")
    ) {
      nextQuestion.type = "lines";
      nextQuestion.lines = 4;
      delete nextQuestion.inputLabel;
      delete nextQuestion.unit;
      delete nextQuestion.hint;
      changed = true;
    } else if (
      nextQuestion.type === "fill" &&
      Array.isArray(nextQuestion.segments)
    ) {
      nextQuestion.type = "cloze";
      changed = true;
    } else if (
      nextQuestion.type === "fill" &&
      Array.isArray(nextQuestion.blanks) &&
      typeof nextQuestion.after !== "string"
    ) {
      nextQuestion.after = "";
      changed = true;
    }
    if (nextQuestion.type === "mcq") {
      const displayMode = normalizeRawPaperSheetMcqDisplayMode(nextQuestion);
      if (nextQuestion.displayMode !== displayMode) {
        nextQuestion.displayMode = displayMode;
        changed = true;
      }
    }
    if (
      nextQuestion.type === "lines" &&
      typeof nextQuestion.lines !== "number"
    ) {
      nextQuestion.lines = 4;
      changed = true;
    }
    if (Array.isArray(nextQuestion.questions)) {
      nextQuestion.questions = nextQuestion.questions.map((child) =>
        normalizeQuestionEntry(child),
      );
    }
    return nextQuestion;
  };

  const normalizeMcqAnswerToken = (answer: string): string => {
    return answer
      .normalize("NFKD")
      .replace(/\\(?:text|mathrm|operatorname)\s*\{([^{}]*)\}/giu, "$1")
      .replace(/[{}$]/gu, "")
      .replace(/−/gu, "-")
      .replace(/\s+/gu, "")
      .replace(/[^0-9A-Za-z+\-()]/gu, "")
      .toLowerCase();
  };

  const promptLooksLikePrintedChoiceQuestion = (prompt: unknown): boolean => {
    if (typeof prompt !== "string") {
      return false;
    }
    return /\b(?:tick|select|choose)\b[^.\n]{0,80}\bbox\b|\btick\s*\([^)]*\)\s*one\s*box\b|\btick\s+one\s+box\b/iu.test(
      prompt,
    );
  };

  const normalizeMcqAnswers = (): void => {
    const answers = asJsonObject(
      rootSheet ? nextRoot.answers : nextSheet.answers,
    );
    if (!answers) {
      return;
    }

    for (const [questionId, rawAnswer] of Object.entries(answers)) {
      if (typeof rawAnswer !== "string") {
        continue;
      }
      if (rawAnswer.trim().length === 0) {
        continue;
      }
      const question = questionById.get(questionId);
      if (!question || question.type !== "mcq") {
        continue;
      }
      if (!Array.isArray(question.options)) {
        continue;
      }

      const options = question.options
        .map((option) => asJsonObject(option))
        .filter((option): option is Record<string, unknown> => option !== null);
      const candidate = normalizeMcqAnswerToken(rawAnswer);
      const matchedOption = options.find((option) => {
        for (const fieldName of ["id", "label", "text"] as const) {
          const value = option[fieldName];
          if (
            typeof value === "string" &&
            normalizeMcqAnswerToken(value) === candidate
          ) {
            return true;
          }
        }
        return false;
      });
      const matchedId = matchedOption?.id;
      if (typeof matchedId === "string" && matchedId.length > 0) {
        if (answers[questionId] !== matchedId) {
          answers[questionId] = matchedId;
          changed = true;
        }
        continue;
      }

      const allOptionTextBlank = options.every((option) => {
        return (
          typeof option.text !== "string" || option.text.trim().length === 0
        );
      });
      if (
        allOptionTextBlank ||
        !promptLooksLikePrintedChoiceQuestion(question.prompt)
      ) {
        question.type = "lines";
        question.lines = 4;
        delete question.options;
        delete question.displayMode;
        changed = true;
      }
    }
  };

  nextSheet.sections = sheet.sections.map((section, index) => {
    const sectionRecord = asJsonObject(section);
    if (!sectionRecord) {
      return section;
    }
    const nextSection: Record<string, unknown> = { ...sectionRecord };
    if (nextSection.type === "section" || nextSection.type === "content") {
      delete nextSection.type;
      changed = true;
    }
    if (
      typeof nextSection.id !== "string" ||
      nextSection.id.trim().length === 0
    ) {
      nextSection.id = `section-${(index + 1).toString()}`;
      changed = true;
    }
    if (typeof nextSection.label !== "string") {
      if (typeof nextSection.title === "string") {
        nextSection.label = nextSection.title;
        delete nextSection.title;
        changed = true;
      } else if (
        nextSection.type !== "hook" &&
        (Array.isArray(nextSection.questions) ||
          typeof nextSection.theory === "string" ||
          nextSection.infoBox !== undefined)
      ) {
        nextSection.label = `Section ${(index + 1).toString()}`;
        changed = true;
      }
    }
    if (Array.isArray(nextSection.questions)) {
      nextSection.questions = nextSection.questions.map((question) =>
        normalizeQuestionEntry(question),
      );
    }
    return nextSection;
  });
  normalizeMcqAnswers();

  if (!changed) {
    return { value, changed: false };
  }

  if (rootSheet) {
    nextRoot.sheet = nextSheet;
    if (nextReview) {
      nextRoot.review = nextReview;
    }
    return { value: nextRoot, changed: true };
  }

  if (nextReview) {
    nextSheet.review = nextReview;
  }

  return { value: nextSheet, changed: true };
}

function normalizeRawPaperSheetMcqDisplayMode(
  question: Record<string, unknown>,
): "full_options" | "labels_only" {
  if (question.displayMode === "full_options") {
    return "full_options";
  }
  if (question.displayMode === "labels_only") {
    return "labels_only";
  }

  const rawMode =
    typeof question.displayMode === "string"
      ? question.displayMode.trim().toLowerCase()
      : "";
  if (
    rawMode === "labels" ||
    rawMode === "label" ||
    rawMode === "label_only" ||
    rawMode === "labels-only"
  ) {
    return "labels_only";
  }
  if (
    rawMode === "full" ||
    rawMode === "full-options" ||
    rawMode === "full options"
  ) {
    return "full_options";
  }

  const options = Array.isArray(question.options)
    ? question.options
        .map((option) => asJsonObject(option))
        .filter((option): option is Record<string, unknown> => option !== null)
    : [];
  if (options.length === 0) {
    return "full_options";
  }

  const prompt =
    typeof question.prompt === "string" ? question.prompt.trim() : "";
  const labels = options.map((option) => {
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (label.length > 0) {
      return label;
    }
    return typeof option.id === "string" ? option.id.trim() : "";
  });
  const texts = options.map((option) =>
    typeof option.text === "string" ? option.text.trim() : "",
  );
  const everyTextIsPlaceholder = texts.every((text, index) => {
    if (text.length === 0) {
      return true;
    }
    const label = labels[index] ?? "";
    if (label.length === 0) {
      return false;
    }
    const escapedLabel = escapeRegExpLiteral(label);
    return new RegExp(
      `^(?:option|model|diagram|figure)?\\s*${escapedLabel}$`,
      "iu",
    ).test(text);
  });
  if (everyTextIsPlaceholder) {
    return "labels_only";
  }

  const hasVisualPrompt =
    prompt.length > 0 && VISUAL_CONTEXT_PROMPT_PATTERN.test(prompt);
  const everyOptionHasLabel = labels.every((label) => label.length > 0);
  if (hasVisualPrompt && everyOptionHasLabel) {
    return "labels_only";
  }

  return "full_options";
}

async function normalizeRawGraderQuestionReviewsForPublish(options: {
  rootDir: string;
  sheetPath: string;
  sheetJson: unknown;
  onWorkspaceFileChanged?: (filePath: string) => void;
}): Promise<{
  sheetJson: unknown;
  sheetRaw: string | null;
}> {
  const root = asJsonObject(options.sheetJson);
  const review = asJsonObject(root?.review);
  const questions = asJsonObject(review?.questions);
  if (!questions) {
    return {
      sheetJson: options.sheetJson,
      sheetRaw: null,
    };
  }

  let changed = false;
  for (const questionReviewValue of Object.values(questions)) {
    const questionReview = asJsonObject(questionReviewValue);
    if (!questionReview) {
      continue;
    }
    if (!isSupportedQuestionReviewStatus(questionReview.status)) {
      questionReview.status = inferQuestionReviewStatusFromRawScore(
        asJsonObject(questionReview.score),
      );
      changed = true;
    }
    if (typeof questionReview.note !== "string") {
      questionReview.note = "";
      changed = true;
    }
    const questionReviewNote =
      typeof questionReview.note === "string" ? questionReview.note : "";
    if (
      questionReview.status !== "correct" &&
      questionReviewNote.trim().length === 0
    ) {
      questionReview.note =
        "Review this part against the mark scheme and identify the missing step or evidence.";
      changed = true;
    }
  }

  if (!changed) {
    return {
      sheetJson: options.sheetJson,
      sheetRaw: null,
    };
  }

  const sheetRaw = JSON.stringify(options.sheetJson, null, 2).concat("\n");
  await writeFile(
    resolveWorkspacePath(options.rootDir, options.sheetPath),
    sheetRaw,
    {
      encoding: "utf8",
    },
  );
  options.onWorkspaceFileChanged?.(options.sheetPath);

  return {
    sheetJson: options.sheetJson,
    sheetRaw,
  };
}

function formatUsdTotal(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `$${safeValue.toFixed(4)}`;
}

type ToolLlmCostName =
  | "generate_text"
  | "generate_json"
  | "extract_text"
  | "extract_pdf_text"
  | "read_pdf"
  | "extract_pdf_diagrams";

function serializeTraceValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (typeof serialized === "string") {
      return serialized;
    }
    return String(value);
  } catch (error) {
    return `<<unserializable trace payload: ${errorAsString(error)}>>`;
  }
}

function sanitizeJsonLikeValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeJsonLikeValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (key.startsWith("~")) {
        continue;
      }
      const sanitized = sanitizeJsonLikeValue(entry);
      if (sanitized === undefined) {
        continue;
      }
      next[key] = sanitized;
    }
    return next;
  }
  return undefined;
}

function sanitizeJsonSchemaForPersistence(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = sanitizeJsonLikeValue(schema);
  if (
    typeof sanitized !== "object" ||
    sanitized === null ||
    Array.isArray(sanitized)
  ) {
    return {};
  }
  return sanitized as Record<string, unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function orderedJsonSchemaKeys(
  properties: Record<string, unknown>,
  ordering: readonly string[] | undefined,
): string[] {
  const keys = Object.keys(properties);
  if (!ordering || ordering.length === 0) {
    return keys;
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const key of ordering) {
    if (Object.hasOwn(properties, key)) {
      ordered.push(key);
      seen.add(key);
    }
  }
  for (const key of keys) {
    if (!seen.has(key)) {
      ordered.push(key);
    }
  }
  return ordered;
}

function normalizeOpenAiSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof schema.$ref === "string") {
    return { $ref: schema.$ref };
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (
      key === "properties" ||
      key === "required" ||
      key === "additionalProperties" ||
      key === "propertyOrdering"
    ) {
      continue;
    }
    if (key === "items") {
      if (isPlainRecord(value)) {
        output.items = normalizeOpenAiSchema(value);
      }
      continue;
    }
    if (key === "anyOf" || key === "oneOf") {
      if (Array.isArray(value)) {
        output.anyOf = value.map((entry) =>
          isPlainRecord(entry) ? normalizeOpenAiSchema(entry) : entry,
        );
      }
      continue;
    }
    if (key === "$defs" && isPlainRecord(value)) {
      const defs: Record<string, unknown> = {};
      for (const [defKey, defValue] of Object.entries(value)) {
        if (isPlainRecord(defValue)) {
          defs[defKey] = normalizeOpenAiSchema(defValue);
        }
      }
      output.$defs = defs;
      continue;
    }
    output[key] = value;
  }

  const propertiesRaw = schema.properties;
  if (isPlainRecord(propertiesRaw)) {
    const ordering = Array.isArray(schema.propertyOrdering)
      ? schema.propertyOrdering.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : undefined;
    const orderedKeys = orderedJsonSchemaKeys(propertiesRaw, ordering);
    const properties: Record<string, unknown> = {};
    for (const key of orderedKeys) {
      const value = propertiesRaw[key];
      properties[key] = isPlainRecord(value)
        ? normalizeOpenAiSchema(value)
        : value;
    }
    output.properties = properties;
    output.required = orderedKeys;
    output.additionalProperties = false;
  }

  const schemaType = output.type;
  if (
    output.additionalProperties === undefined &&
    (schemaType === "object" ||
      (Array.isArray(schemaType) && schemaType.includes("object")))
  ) {
    output.additionalProperties = false;
    if (!Array.isArray(output.required)) {
      output.required = [];
    }
  }

  const normalizeExclusiveBound = (options: {
    exclusiveKey: "exclusiveMinimum" | "exclusiveMaximum";
    inclusiveKey: "minimum" | "maximum";
  }): void => {
    const exclusiveValue = output[options.exclusiveKey];
    if (exclusiveValue === false) {
      delete output[options.exclusiveKey];
      return;
    }
    const inclusiveValue = output[options.inclusiveKey];
    if (exclusiveValue === true) {
      if (
        typeof inclusiveValue === "number" &&
        Number.isFinite(inclusiveValue)
      ) {
        output[options.exclusiveKey] = inclusiveValue;
        delete output[options.inclusiveKey];
      } else {
        delete output[options.exclusiveKey];
      }
      return;
    }
    if (typeof exclusiveValue === "number" && Number.isFinite(exclusiveValue)) {
      delete output[options.inclusiveKey];
    }
  };

  normalizeExclusiveBound({
    exclusiveKey: "exclusiveMinimum",
    inclusiveKey: "minimum",
  });
  normalizeExclusiveBound({
    exclusiveKey: "exclusiveMaximum",
    inclusiveKey: "maximum",
  });

  return output;
}

function resolveOpenAiSchemaRoot(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (typeof schema.$ref !== "string") {
    return schema;
  }
  const refMatch = /^#\/(definitions|[$]defs)\/(.+)$/u.exec(schema.$ref);
  if (!refMatch) {
    return schema;
  }
  const section = refMatch[1];
  const key = refMatch[2];
  if (!section || !key) {
    return schema;
  }
  const defsSource =
    section === "definitions" ? schema.definitions : schema.$defs;
  if (!isPlainRecord(defsSource)) {
    return schema;
  }
  const resolved = defsSource[key];
  if (!isPlainRecord(resolved)) {
    return schema;
  }
  return { ...resolved };
}

function buildProviderToolJsonSchema(options: {
  schema: z.ZodType;
  name: string;
  modelId: string;
}): Record<string, unknown> {
  if (isGeminiModelId(options.modelId)) {
    return sanitizeJsonSchemaForPersistence(
      toGeminiJsonSchema(options.schema, { name: options.name }) as Record<
        string,
        unknown
      >,
    );
  }
  if (
    isOpenAiModelId(options.modelId) ||
    isChatGptModelId(options.modelId) ||
    isFireworksModelId(options.modelId)
  ) {
    return sanitizeJsonSchemaForPersistence(
      normalizeOpenAiSchema(
        resolveOpenAiSchemaRoot(
          zodToJsonSchema(options.schema, {
            name: options.name,
            target: "openAi",
          }) as Record<string, unknown>,
        ),
      ),
    );
  }
  return sanitizeJsonSchemaForPersistence(
    zodToJsonSchema(options.schema, {
      name: options.name,
      target: "jsonSchema7",
    }) as Record<string, unknown>,
  );
}

function redactDataUrlPayload(value: string): string {
  if (!value.startsWith("data:")) {
    return value;
  }
  const commaIndex = value.indexOf(",");
  if (commaIndex < 0) {
    return value;
  }
  const prefix = value.slice(0, commaIndex + 1);
  if (value === `${prefix}...`) {
    return value;
  }
  return `${prefix}...`;
}

function sanitizeViewImageTraceOutput(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  let changed = false;
  const sanitizedParts: unknown[] = [];
  for (const part of value) {
    if (
      part !== null &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      "image_url" in part
    ) {
      const partRecord = part as Record<string, unknown>;
      const imageUrl = partRecord.image_url;
      if (typeof imageUrl === "string") {
        const redactedImageUrl = redactDataUrlPayload(imageUrl);
        if (redactedImageUrl !== imageUrl) {
          changed = true;
          sanitizedParts.push({
            ...partRecord,
            image_url: redactedImageUrl,
          });
          continue;
        }
      }
    }
    sanitizedParts.push(part);
  }
  if (!changed) {
    return value;
  }
  return sanitizedParts;
}

function sanitizeToolTraceValue(options: {
  toolName: string;
  direction: "input" | "output";
  value: unknown;
}): unknown {
  if (options.toolName === "view_image" && options.direction === "output") {
    return sanitizeViewImageTraceOutput(options.value);
  }
  return options.value;
}

const COMMON_RAW_LATEX_COMMAND_PATTERN =
  /^(?:alpha|angle|approx|array|begin|beta|boxed|cdot|cdots|circ|cong|cos|Delta|delta|dfrac|div|end|equiv|frac|gamma|ge|geq|hline|infty|int|lambda|land|left|leftarrow|le|leq|lim|ln|log|lor|mathit|mathbf|mathrm|mp|mu|nabla|neg|neq|not|operatorname|over|parallel|perp|phantom|pi|pm|qquad|quad|rightarrow|right|sigma|sim|sin|sqrt|sum|tan|text|textbf|tfrac|therefore|theta|times|to|triangle|underbrace|underline|vline|xrightarrow)/u;

function repairCommonRawLatexJsonBackslashes(jsonText: string): string {
  let changed = false;
  let output = "";
  for (let index = 0; index < jsonText.length; index += 1) {
    const character = jsonText[index];
    if (character !== "\\") {
      output += character;
      continue;
    }

    const next = jsonText[index + 1];
    if (next === undefined) {
      output += "\\\\";
      changed = true;
      continue;
    }
    if (next === "\\") {
      output += "\\\\";
      index += 1;
      continue;
    }

    const tail = jsonText.slice(index + 1);
    if (
      next === "(" ||
      next === ")" ||
      next === "[" ||
      next === "]" ||
      COMMON_RAW_LATEX_COMMAND_PATTERN.test(tail) ||
      (next === "u" && !/^u[0-9a-fA-F]{4}/u.test(tail))
    ) {
      output += "\\\\";
      changed = true;
      continue;
    }

    if (`"\\/bfnrtu`.includes(next)) {
      output += "\\";
      continue;
    }

    output += "\\\\";
    changed = true;
  }

  return changed ? output : jsonText;
}

function formatToolLogSnippet(value: unknown): string {
  const capped = capUtf8Text(
    serializeTraceValue(value),
    AGENT_TOOL_LOG_SNIPPET_MAX_BYTES,
  );
  const compact = capped.replace(/\s+/gu, " ").trim();
  if (compact.length === 0) {
    return "<empty>";
  }
  if (compact.length <= AGENT_TOOL_LOG_SNIPPET_MAX_CHARS) {
    return compact;
  }
  return `${compact.slice(0, AGENT_TOOL_LOG_SNIPPET_MAX_CHARS)}…`;
}

async function persistToolLoopTrace(options: {
  serviceAccountJson: string;
  userId: string;
  agentId: string;
  toolLoopResult: LlmToolLoopResult;
  consolePrefix: string;
  toolCallsRootDir?: string;
}): Promise<{ stepCount: number; toolCallCount: number }> {
  const logDocPath = `users/${options.userId}/agents/${options.agentId}/logs/log`;
  const now = new Date();
  let toolCallCount = 0;

  for (const step of options.toolLoopResult.steps) {
    const stepDocPath = `${logDocPath}/toolTraceSteps/s${String(step.step).padStart(6, "0")}`;
    const stepText = typeof step.text === "string" ? step.text : "";
    const toolCalls = step.toolCalls;
    toolCallCount += toolCalls.length;

    await setFirestoreDocument({
      serviceAccountJson: options.serviceAccountJson,
      documentPath: stepDocPath,
      data: {
        step: step.step,
        modelId: step.modelVersion,
        text: stepText,
        toolCallCount: toolCalls.length,
        createdAt: now,
        updatedAt: now,
      },
    });

    for (const [toolIndex, toolCall] of toolCalls.entries()) {
      const callIndex = toolIndex + 1;
      const input = serializeTraceValue(
        sanitizeToolTraceValue({
          toolName: toolCall.toolName,
          direction: "input",
          value: toolCall.input,
        }),
      );
      const traceOutputValue = await enrichToolTraceOutputValue({
        toolName: toolCall.toolName,
        value: toolCall.output,
        step: step.step,
        toolIndex: callIndex,
        toolCallsRootDir: options.toolCallsRootDir,
      });
      const output = serializeTraceValue(
        sanitizeToolTraceValue({
          toolName: toolCall.toolName,
          direction: "output",
          value: traceOutputValue,
        }),
      );
      const callId =
        typeof toolCall.callId === "string" && toolCall.callId.trim().length > 0
          ? toolCall.callId
          : undefined;
      const error =
        typeof toolCall.error === "string" && toolCall.error.trim().length > 0
          ? toolCall.error
          : undefined;

      await setFirestoreDocument({
        serviceAccountJson: options.serviceAccountJson,
        documentPath: `${stepDocPath}/toolCalls/c${String(callIndex).padStart(6, "0")}`,
        data: {
          step: step.step,
          toolIndex: callIndex,
          toolName: toolCall.toolName,
          ...(callId ? { callId } : {}),
          ...(error ? { error } : {}),
          input,
          output,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
  }

  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: logDocPath,
    updates: {
      "trace.updatedAt": now,
      "trace.stepCount": options.toolLoopResult.steps.length,
      "trace.toolCallCount": toolCallCount,
    },
  });

  return {
    stepCount: options.toolLoopResult.steps.length,
    toolCallCount,
  };
}

async function readOptionalJsonRecord(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, { encoding: "utf8" });
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

async function enrichToolTraceOutputValue(options: {
  toolName: string;
  value: unknown;
  step: number;
  toolIndex: number;
  toolCallsRootDir?: string;
}): Promise<unknown> {
  if (options.toolName !== "extract_text") {
    return options.value;
  }
  const toolCallsRootDir = options.toolCallsRootDir?.trim() ?? "";
  if (toolCallsRootDir.length === 0) {
    return options.value;
  }
  const toolIdSegment = `turn${options.step}tool${options.toolIndex}`;
  const baseDir = path.join(toolCallsRootDir, "extract_text", toolIdSegment);
  const [requestMetadata, responseMetadata] = await Promise.all([
    readOptionalJsonRecord(path.join(baseDir, "request.metadata.json")),
    readOptionalJsonRecord(path.join(baseDir, "response.metadata.json")),
  ]);
  if (!requestMetadata && !responseMetadata) {
    return options.value;
  }
  const baseOutput =
    options.value &&
    typeof options.value === "object" &&
    !Array.isArray(options.value)
      ? { ...(options.value as Record<string, unknown>) }
      : { output: options.value };
  return {
    ...baseOutput,
    trace: {
      ...(requestMetadata ? { request: requestMetadata } : {}),
      ...(responseMetadata ? { response: responseMetadata } : {}),
    },
  };
}

type MutableGlobal = Omit<typeof globalThis, "location" | "self"> & {
  location?: { href: string };
  self?: typeof globalThis;
};

let cachedLocalPyodideIndexUrl: string | null | undefined;

function getLocalPyodideIndexUrl(): string | null {
  if (cachedLocalPyodideIndexUrl !== undefined) {
    return cachedLocalPyodideIndexUrl;
  }
  try {
    const moduleUrl = import.meta.url;
    if (!moduleUrl) {
      cachedLocalPyodideIndexUrl = null;
      return cachedLocalPyodideIndexUrl;
    }
    const require = createRequire(moduleUrl);
    const packageJsonPath = require.resolve("pyodide/package.json");
    const baseDir = path.dirname(packageJsonPath);
    cachedLocalPyodideIndexUrl = path.join(baseDir, path.sep);
    return cachedLocalPyodideIndexUrl;
  } catch {
    cachedLocalPyodideIndexUrl = null;
    return cachedLocalPyodideIndexUrl;
  }
}

function resolvePyodideIndexUrl(explicit?: string): string {
  const fromEnv =
    process.env.PYODIDE_INDEX_URL ??
    process.env.PYODIDE_BASE_URL ??
    process.env.PYTHON_RUNTIME_INDEX_URL;
  const raw = explicit?.trim() ?? fromEnv?.trim() ?? "";
  const normalise = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    // Pyodide's Node loader resolves indexURL as a filesystem path (path.resolve),
    // which breaks http(s) URLs (e.g. "https://..." becomes "https:/...") and then
    // attempts to read them via fs. For server-side agent runs, prefer the local
    // indexURL shipped with the `pyodide` npm package.
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return null;
    }

    if (trimmed.startsWith("file://")) {
      try {
        const resolved = fileURLToPath(trimmed);
        return resolved.endsWith(path.sep)
          ? resolved
          : `${resolved}${path.sep}`;
      } catch {
        return null;
      }
    }

    if (trimmed.endsWith(path.sep)) {
      return trimmed;
    }
    return `${trimmed}${path.sep}`;
  };

  const localIndexUrl = getLocalPyodideIndexUrl();
  if (!raw) {
    if (localIndexUrl) {
      return localIndexUrl;
    }
    throw new Error(
      "Pyodide local runtime is unavailable in this environment. Set PYODIDE_INDEX_URL to a local filesystem path before using python_exec.",
    );
  }

  return normalise(raw) ?? localIndexUrl ?? raw;
}

function ensurePyodideEnvironment(indexURL: string): void {
  const globalObject = globalThis as MutableGlobal;
  if (!globalObject.location) {
    globalObject.location = { href: indexURL };
  } else if (!globalObject.location.href) {
    globalObject.location.href = indexURL;
  }
  if (!globalObject.self) {
    globalObject.self = globalThis;
  }
}

let pythonRuntimePromise: Promise<PyodideInterface> | null = null;

async function ensurePythonRuntime(
  indexURL?: string,
): Promise<PyodideInterface> {
  if (!pythonRuntimePromise) {
    pythonRuntimePromise = (async (): Promise<PyodideInterface> => {
      const pyodideModule = (await import(
        /* @vite-ignore */ "pyodide"
      )) as typeof import("pyodide");
      const resolvedIndex = resolvePyodideIndexUrl(indexURL);
      ensurePyodideEnvironment(resolvedIndex);
      return await pyodideModule.loadPyodide({ indexURL: resolvedIndex });
    })();
  }
  return pythonRuntimePromise;
}

async function expandPromptTemplate(options: {
  template: string;
  rootDir: string;
}): Promise<{
  text: string;
  replacements: Array<{ path: string; chars: number }>;
}> {
  const { template, rootDir } = options;
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
        const resolved = resolveWorkspacePath(rootDir, token);
        content = await readFile(resolved, { encoding: "utf8" });
      } catch (error) {
        throw new Error(
          `Failed to expand {{${token}}}: ${errorAsString(error)}`,
        );
      }
      cache.set(token, content);
    }

    replacements.push({ path: token, chars: content.length });
    result += content;
  }

  result += template.slice(lastIndex);
  return { text: result, replacements };
}

type AgentStatus = "created" | "executing" | "stopped" | "failed" | "done";

class StopRequestedError extends Error {
  constructor() {
    super("Agent stop requested.");
    this.name = "StopRequestedError";
  }
}

type WorkspaceFileMeta = {
  createdAt?: Date;
  updatedAt?: Date;
  lastWriteAt: number;
  pending: boolean;
  timer?: NodeJS.Timeout;
  inFlight?: Promise<void>;
  disposed?: boolean;
};

type WorkspaceSyncOptions = {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  bucketName: string;
  rootDir: string;
};

export type SparkAgentWorkspace = {
  scheduleUpdate: (path: string) => void;
  deleteFile: (path: string) => Promise<void>;
  moveFile: (from: string, to: string) => Promise<void>;
};

type AgentRunStatsSnapshot = {
  readonly modelCalls: number;
  readonly modelsUsed: readonly string[];
  readonly tokens: {
    readonly promptTokens: number;
    readonly cachedTokens: number;
    readonly responseTokens: number;
    readonly responseImageTokens: number;
    readonly thinkingTokens: number;
    readonly totalTokens: number;
    readonly toolUsePromptTokens: number;
  };
  readonly modelCostUsd: number;
  readonly toolCalls: number;
  readonly toolCallsByName: Record<string, number>;
  readonly toolCostUsd: number;
  readonly totalCostUsd: number;
};

type AgentRunOptions = {
  userId: string;
  agentId: string;
  workspaceId: string;
  modelId?: LlmTextModelId;
  maxSteps?: number;
};

function parseOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed;
}

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsedValue =
    typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number.parseInt(value.trim(), 10)
      : value;
  if (typeof parsedValue !== "number") {
    return undefined;
  }
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    return undefined;
  }
  return parsedValue;
}

function renderWorkspaceFileReadResult(input: {
  readonly filePath: string;
  readonly content: string;
  readonly startLine?: number;
  readonly lineCount?: number;
  readonly maxChars?: number;
  readonly largeOutlineReadCount?: number;
}): string {
  const lines = input.content.split(/\r?\n/u);
  const hasExplicitBounds =
    input.startLine !== undefined ||
    input.lineCount !== undefined ||
    input.maxChars !== undefined;
  const totalLines = lines.length;
  const requestedStartLine = input.startLine ?? 1;
  const startLine = Math.min(Math.max(requestedStartLine, 1), totalLines);
  const requestedLineCount =
    input.lineCount ??
    (input.startLine !== undefined
      ? READ_WORKSPACE_FILE_DEFAULT_RANGE_LINES
      : totalLines);
  const lineCount = Math.min(
    Math.max(requestedLineCount, 1),
    READ_WORKSPACE_FILE_MAX_RANGE_LINES,
  );
  const endLine = Math.min(startLine + lineCount - 1, totalLines);
  const isLineRange =
    input.startLine !== undefined ||
    input.lineCount !== undefined ||
    endLine < totalLines ||
    startLine > 1;
  const normalizedFilePath = input.filePath.replace(/\\/gu, "/");
  const shouldUseLargeFilePreview =
    normalizedFilePath.startsWith("grader/output/") ||
    normalizedFilePath.startsWith("sheet/output/");
  if (
    !hasExplicitBounds &&
    shouldUseLargeFilePreview &&
    input.content.length > READ_WORKSPACE_FILE_DEFAULT_MAX_CHARS
  ) {
    if (
      input.largeOutlineReadCount !== undefined &&
      input.largeOutlineReadCount > 1
    ) {
      return [
        `[read_workspace_file] ${input.filePath}`,
        `large generated output/reference file already returned a compact outline in this run (repeat #${input.largeOutlineReadCount.toString()})`,
        `content omitted=true; do not call this file unbounded again; use grep_workspace_files with specific question/page labels, then read_workspace_file with startLine/lineCount for exact sections; example: read_workspace_file({"filePath":"${input.filePath}","startLine":68,"lineCount":80})`,
      ].join("; ");
    }
    return renderLargeGeneratedWorkspaceFileOutline({
      filePath: input.filePath,
      lines,
      contentChars: input.content.length,
    });
  }
  const maxChars = Math.min(
    Math.max(input.maxChars ?? READ_WORKSPACE_FILE_DEFAULT_MAX_CHARS, 1),
    READ_WORKSPACE_FILE_MAX_CHARS,
  );
  const selected = lines.slice(startLine - 1, endLine).join("\n");
  if (!isLineRange && selected.length <= maxChars) {
    return selected;
  }
  const truncatedContent =
    selected.length > maxChars ? selected.slice(0, maxChars) : selected;
  const contentTruncated = selected.length > truncatedContent.length;
  const rangeTruncated = startLine > 1 || endLine < totalLines;
  const notices = [
    `[read_workspace_file] ${input.filePath}`,
    `showing lines ${startLine.toString()}-${endLine.toString()} of ${totalLines.toString()}`,
    `chars ${truncatedContent.length.toString()} of ${selected.length.toString()} selected`,
  ];
  if (contentTruncated || rangeTruncated) {
    notices.push(
      `truncated=true; use grep_workspace_files to locate headings/question labels, then read_workspace_file with startLine/lineCount for exact sections; use maxChars only when a larger bounded preview is necessary; example: read_workspace_file({"filePath":"${input.filePath}","startLine":${startLine.toString()},"lineCount":${lineCount.toString()}})`,
    );
  }
  return `${notices.join("; ")}\n\n${truncatedContent}`;
}

function parseWorkspaceFileReadPathHints(filePath: string): {
  readonly filePath: string;
  readonly startLine?: number;
  readonly lineCount?: number;
} {
  let normalizedPath = filePath.trim();
  let startLine: number | undefined;
  let endLine: number | undefined;
  let lineCount: number | undefined;

  const queryIndex = normalizedPath.indexOf("?");
  if (queryIndex !== -1) {
    const query = normalizedPath.slice(queryIndex + 1);
    normalizedPath = normalizedPath.slice(0, queryIndex);
    const params = new URLSearchParams(query);
    startLine = parseOptionalPositiveInt(
      params.get("startLine") ?? params.get("line") ?? params.get("start"),
    );
    lineCount = parseOptionalPositiveInt(
      params.get("lineCount") ?? params.get("lines") ?? params.get("count"),
    );
    endLine = parseOptionalPositiveInt(
      params.get("endLine") ?? params.get("end"),
    );
  }

  const fragmentMatch = /#L(\d+)(?:-L?(\d+))?$/iu.exec(normalizedPath);
  if (fragmentMatch) {
    normalizedPath = normalizedPath.slice(0, fragmentMatch.index);
    startLine = Number.parseInt(fragmentMatch[1] ?? "", 10);
    endLine =
      fragmentMatch[2] !== undefined
        ? Number.parseInt(fragmentMatch[2], 10)
        : undefined;
  }

  const genericFragmentIndex = normalizedPath.indexOf("#");
  if (
    genericFragmentIndex !== -1 &&
    /\.(?:md|txt|json|jsonl)#/iu.test(normalizedPath)
  ) {
    normalizedPath = normalizedPath.slice(0, genericFragmentIndex);
  }

  const namedSuffixMatch =
    /[:,](?:startLine|start|line)=\d+(?:(?:,|&)(?:lineCount|lines|count|endLine|end)=\d+)*$/iu.exec(
      normalizedPath,
    );
  if (
    namedSuffixMatch &&
    /\.(?:md|txt|json|jsonl)[:,](?:startLine|start|line)=/iu.test(
      normalizedPath,
    )
  ) {
    const suffix = normalizedPath
      .slice(namedSuffixMatch.index + 1)
      .replaceAll(",", "&");
    normalizedPath = normalizedPath.slice(0, namedSuffixMatch.index);
    const params = new URLSearchParams(suffix);
    startLine = parseOptionalPositiveInt(
      params.get("startLine") ?? params.get("line") ?? params.get("start"),
    );
    lineCount = parseOptionalPositiveInt(
      params.get("lineCount") ?? params.get("lines") ?? params.get("count"),
    );
    endLine = parseOptionalPositiveInt(
      params.get("endLine") ?? params.get("end"),
    );
  }

  const suffixMatch = /:(\d+)(?:-(\d+))?$/u.exec(normalizedPath);
  if (suffixMatch && /\.(?:md|txt|json|jsonl):\d/iu.test(normalizedPath)) {
    normalizedPath = normalizedPath.slice(0, suffixMatch.index);
    startLine = Number.parseInt(suffixMatch[1] ?? "", 10);
    endLine =
      suffixMatch[2] !== undefined
        ? Number.parseInt(suffixMatch[2], 10)
        : undefined;
  }

  if (
    startLine !== undefined &&
    endLine !== undefined &&
    Number.isFinite(startLine) &&
    Number.isFinite(endLine) &&
    endLine >= startLine
  ) {
    lineCount = endLine - startLine + 1;
  }

  return {
    filePath: normalizedPath,
    ...(startLine !== undefined && Number.isFinite(startLine)
      ? { startLine }
      : {}),
    ...(lineCount !== undefined && Number.isFinite(lineCount)
      ? { lineCount }
      : {}),
  };
}

function renderLargeGeneratedWorkspaceFileOutline(input: {
  readonly filePath: string;
  readonly lines: readonly string[];
  readonly contentChars: number;
}): string {
  const referenceLinePattern =
    /(?:^#{1,6}\s|^question\s+\d+\b|^\s*\d{1,2}\s*\.\s*\d+\b|^\s*0\s*\d\s*\.\s*\d+\b|\b\d{2}\.\d\b|\b(?:figure|table)\s+\d+\b|\[\d+\s+marks?\]|\bgrade\b|\bboundar|\bthreshold|\bmedal|\bprize)/iu;
  const outlineLines: string[] = [];
  for (const [index, line] of input.lines.entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!referenceLinePattern.test(trimmed)) {
      continue;
    }
    outlineLines.push(`${(index + 1).toString()}: ${trimmed.slice(0, 500)}`);
    if (outlineLines.length >= READ_WORKSPACE_FILE_LARGE_OUTLINE_MAX_LINES) {
      break;
    }
  }
  if (outlineLines.length === 0) {
    const fallbackStride = Math.max(
      1,
      Math.ceil(
        input.lines.length / READ_WORKSPACE_FILE_LARGE_OUTLINE_MAX_LINES,
      ),
    );
    for (
      let index = 0;
      index < input.lines.length &&
      outlineLines.length < READ_WORKSPACE_FILE_LARGE_OUTLINE_MAX_LINES;
      index += fallbackStride
    ) {
      const trimmed = input.lines[index]?.trim();
      if (!trimmed) {
        continue;
      }
      outlineLines.push(`${(index + 1).toString()}: ${trimmed.slice(0, 500)}`);
    }
  }
  const notices = [
    `[read_workspace_file] ${input.filePath}`,
    `large generated output/reference file: ${input.lines.length.toString()} lines, ${input.contentChars.toString()} chars`,
    `showing compact line-numbered outline (${outlineLines.length.toString()} entries, max ${READ_WORKSPACE_FILE_LARGE_OUTLINE_MAX_LINES.toString()})`,
    `truncated=true; use grep_workspace_files for specific labels or read_workspace_file with startLine/lineCount for exact source-paper or mark-scheme sections; example: read_workspace_file({"filePath":"${input.filePath}","startLine":68,"lineCount":80})`,
  ];
  return `${notices.join("; ")}\n\n${outlineLines.join("\n")}`;
}

const AgentAttachmentInputSchema = z.object({
  id: z.preprocess(
    (value) => parseOptionalString(value),
    z.string().trim().min(1).optional(),
  ),
  storagePath: z.string().trim().min(1),
  contentType: z.string().trim().min(1),
  filename: z.preprocess(
    (value) => parseOptionalString(value),
    z.string().trim().min(1).optional(),
  ),
  sizeBytes: z.number().int().min(1),
  pageCount: z.preprocess(
    (value) => parseOptionalPositiveInt(value),
    z.number().int().min(1).optional(),
  ),
});

type AgentAttachmentInput = z.infer<typeof AgentAttachmentInputSchema>;

type GraderPublishConfig =
  | {
      mode: "live";
      runId: string;
    }
  | {
      mode: "mock";
      runId?: string;
      href?: string;
    };

type SheetDraftPublishConfig =
  | {
      mode: "live";
      runId: string;
    }
  | {
      mode: "mock";
      runId?: string;
      href?: string;
    };

const GraderSummarySheetSchema = z.object({
  title: z.string().trim().min(1).optional(),
  filePath: z.string().trim().min(1),
});

const GraderRunPresentationSchema = z.object({
  title: z.string().trim().min(1).optional(),
  subtitle: z.string().trim().min(1).optional(),
  summaryMarkdown: z.string().trim().min(1).optional(),
  footer: z.string().trim().min(1).optional(),
});

const GraderRunSummarySchema = z
  .object({
    contextLabel: z.string().trim().min(1).optional(),
    olympiad: z.string().trim().min(1).optional(),
    year: z.string().trim().min(1).optional(),
    paperName: z.string().trim().min(1).optional(),
    paperUrl: z.string().trim().min(1).optional(),
    paperStoragePath: z.string().trim().min(1).optional(),
    markSchemeUrl: z.string().trim().min(1).optional(),
    markSchemeStoragePath: z.string().trim().min(1).optional(),
    presentation: GraderRunPresentationSchema.optional(),
    totals: z
      .object({
        awardedMarks: z.number().min(0),
        maxMarks: z.number().min(0),
      })
      .optional(),
    sheet: GraderSummarySheetSchema,
  })
  .transform(({ contextLabel, olympiad, ...rest }) => ({
    ...rest,
    ...((contextLabel ?? olympiad)
      ? { contextLabel: contextLabel ?? olympiad }
      : {}),
  }));

type GraderRunSummary = z.infer<typeof GraderRunSummarySchema>;

function summarizeFirstActionableReviewIssue(
  report: SparkGraderWorksheetReport,
): string | null {
  for (const review of Object.values(report.review.questions)) {
    const note = review.note.trim();
    if (review.status !== "correct" && note.length > 0) {
      const [firstSentence] = note.split(/(?<=[.!?])\s+/u);
      const summary = firstSentence?.trim();
      if (
        summary &&
        !/\b\d{1,3}\s*\/\s*\d{1,3}\b/u.test(summary) &&
        !USER_VISIBLE_PROCESS_METADATA_PATTERN.test(summary)
      ) {
        return summary;
      }
    }
  }
  return null;
}

function buildDerivedGraderRunSummary(options: {
  report: SparkGraderWorksheetReport;
  sheetPath: string;
}): GraderRunSummary {
  const { report } = options;
  const reviewMessage = report.review.message.trim();
  const reviewMessageIsUsable =
    reviewMessage.length > 0 &&
    !SCORE_ONLY_REVIEW_MESSAGE_PATTERN.test(reviewMessage) &&
    !/\b\d{1,3}\s*\/\s*\d{1,3}\b/u.test(reviewMessage) &&
    !USER_VISIBLE_PROCESS_METADATA_PATTERN.test(reviewMessage);
  const summaryMarkdown =
    (reviewMessageIsUsable ? reviewMessage : null) ??
    summarizeFirstActionableReviewIssue(report) ??
    "Review the response-needed notes and add clearer working where asked.";
  const references = report.references;
  return {
    ...(references?.paperUrl ? { paperUrl: references.paperUrl } : {}),
    ...(references?.paperStoragePath
      ? { paperStoragePath: references.paperStoragePath }
      : {}),
    ...(references?.markSchemeUrl
      ? { markSchemeUrl: references.markSchemeUrl }
      : {}),
    ...(references?.markSchemeStoragePath
      ? { markSchemeStoragePath: references.markSchemeStoragePath }
      : {}),
    presentation: {
      title: report.sheet.title,
      subtitle: report.sheet.subtitle,
      summaryMarkdown,
      footer: "Question paper and mark scheme supplied.",
    },
    totals: {
      awardedMarks: report.review.score.got,
      maxMarks: report.review.score.total,
    },
    sheet: {
      title: report.sheet.title,
      filePath: options.sheetPath,
    },
  };
}

type PublishedGraderSheetArtifacts = {
  summaryPath: string;
  sheetPath: string;
  summarySha256: string;
  sheetSha256: string;
  paper?: {
    contextLabel?: string;
    year?: string;
    paperName?: string;
    paperUrl?: string;
    paperStoragePath?: string;
    markSchemeUrl?: string;
    markSchemeStoragePath?: string;
  };
  presentation: {
    title: string;
    subtitle: string;
    summaryMarkdown: string;
    footer: string;
  };
  totals: {
    awardedMarks: number;
    maxMarks: number;
    problemCount: number;
    gradedCount: number;
    percentage: number;
  };
  sheet: {
    title?: string;
    filePath: string;
  };
  resultSummary?: string;
};

type PublishedSheetDraftArtifacts = {
  summaryPath: string;
  sheetPath: string;
  summarySha256: string;
  sheetSha256: string;
  presentation: {
    title: string;
    subtitle: string;
    summaryMarkdown: string;
    footer: string;
  };
  sheet: {
    title?: string;
    filePath: string;
  };
};

function selectGraderResultSummary(options: {
  doneSummary?: string;
  runSummary: GraderRunSummary | null;
}): string | undefined {
  const preferred = options.runSummary?.presentation?.summaryMarkdown?.trim();
  if (preferred && preferred.length > 0) {
    return preferred;
  }
  const fallback = options.doneSummary?.trim();
  if (fallback && fallback.length > 0) {
    return fallback;
  }
  return undefined;
}

function normalizeSparkGraderWorksheetReportTheme(
  report: SparkGraderWorksheetReport,
): { report: SparkGraderWorksheetReport; changed: boolean } {
  const sheet = applyPaperSheetSubjectTheme(report.sheet);
  if (sheet === report.sheet) {
    return { report, changed: false };
  }
  return {
    report: {
      ...report,
      sheet,
    },
    changed: true,
  };
}

function normalizeSparkSolveSheetDraftTheme(draft: SparkSolveSheetDraft): {
  draft: SparkSolveSheetDraft;
  changed: boolean;
} {
  const sheet = applyPaperSheetSubjectTheme(draft.sheet);
  if (sheet === draft.sheet) {
    return { draft, changed: false };
  }
  return {
    draft: {
      ...draft,
      sheet,
    },
    changed: true,
  };
}

function resolveSparkRepoRoot(): string {
  const currentWorkingDirectory = path.resolve(process.cwd());
  const currentBaseName = path.basename(currentWorkingDirectory);
  if (currentBaseName === "web" || currentBaseName === "eval") {
    return path.resolve(currentWorkingDirectory, "..");
  }
  return currentWorkingDirectory;
}

function loadAgentEnv(): void {
  loadLocalEnv();
  const repoRoot = resolveSparkRepoRoot();
  loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });
  loadEnvFromFile(path.join(repoRoot, "web", ".env.local"), {
    override: false,
  });
  preferGoogleServiceAccountAuth();
}

function formatWorkspaceRunTimestamp(value: Date): string {
  return value.toISOString().replace(/[:.]/gu, "-");
}

function shouldUsePersistentDevWorkspaceRoot(): boolean {
  const forced = parseOptionalString(process.env.SPARK_AGENT_LOCAL_WORKSPACE);
  if (forced) {
    const normalized = forced.toLowerCase();
    if (
      normalized === "1" ||
      normalized === "true" ||
      normalized === "yes" ||
      normalized === "on"
    ) {
      return true;
    }
    if (
      normalized === "0" ||
      normalized === "false" ||
      normalized === "no" ||
      normalized === "off"
    ) {
      return false;
    }
  }
  return process.env.NODE_ENV !== "production";
}

export function resolveSparkAgentWorkspaceRoot(options: {
  workspaceId: string;
  runStartedAt: Date;
}): { rootDir: string; cleanupOnExit: boolean } {
  if (shouldUsePersistentDevWorkspaceRoot()) {
    const configuredWorkspaceBaseDir = parseOptionalString(
      process.env.SPARK_AGENT_LOCAL_WORKSPACE_BASE_DIR,
    );
    const workspaceBaseDir =
      configuredWorkspaceBaseDir !== undefined
        ? path.resolve(process.cwd(), configuredWorkspaceBaseDir)
        : path.join(resolveSparkRepoRoot(), "data");
    const timestamp = formatWorkspaceRunTimestamp(options.runStartedAt);
    return {
      rootDir: path.join(
        workspaceBaseDir,
        "spark-agent",
        timestamp,
        options.workspaceId,
      ),
      cleanupOnExit: false,
    };
  }
  return {
    rootDir: path.join(
      os.tmpdir(),
      "spark-agent-workspaces",
      options.workspaceId,
    ),
    cleanupOnExit: true,
  };
}

export function resolveSparkAgentLogsDir(rootDir: string): string {
  return path.join(rootDir, "logs", "agent");
}

export function resolveSparkAgentToolCallsDir(rootDir: string): string {
  return path.join(resolveSparkAgentLogsDir(rootDir), "tool_calls");
}

export function resolveSparkAgentThinkingLevel(
  modelId: LlmTextModelId,
): LlmThinkingLevel | undefined {
  if (modelId.includes("gpt-5.4") || modelId.includes("gpt-5.3-codex-spark")) {
    return "medium";
  }
  if (modelId.includes("gpt-5.2")) {
    return "medium";
  }
  return undefined;
}

export function resolveSparkAgentSubagentSelection(): AgentSubagentToolSelection {
  return {
    promptPattern: "codex",
    maxAgents: 6,
    instructions: [
      "Grader subagent policy: when this workspace contains grader/task.md, keep intake, upload inventory, workspace file reading, transcription, final grading synthesis, and worksheet assembly on the main grader agent. The main grader has the required tools and must own the final outputs.",
      "In grader runs, spawn_agent may be used only for bounded sidecar work that keeps context clean: official-source lookup/verification when request.json allows online official references, or visual localization/proposal work for ambiguous source images. For long handwritten papers, use the dedicated score_answers_with_fresh_agent tool for bounded root-question scoring instead of generic spawn_agent. Do not delegate sheet JSON assembly.",
      "If the main grader is worried it is on the wrong path, it should use the dedicated review_run_progress_with_fresh_agent tool rather than generic spawn_agent.",
      "Final figure/image crop validation must use the dedicated validate_crop_with_fresh_agent tool with exactly one final crop, crop path, and question context per validation call.",
      "If you are tempted to ask a subagent to read brief.md, request.json, grader/task.md, grader/uploads/index.json, transcription files, or reference text, do not spawn; read those files yourself.",
    ].join("\n"),
  };
}

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

type SparkAgentMetricType = "chat" | "lesson" | "grader" | "tutor";

function resolveSparkAgentMetricType(
  agentData: Record<string, unknown>,
): SparkAgentMetricType {
  if (
    typeof agentData.sheetRunId === "string" &&
    agentData.sheetRunId.trim().length > 0
  ) {
    return "grader";
  }
  if (
    typeof agentData.graderRunId === "string" &&
    agentData.graderRunId.trim().length > 0
  ) {
    return "grader";
  }
  if (
    typeof agentData.tutorSessionId === "string" &&
    agentData.tutorSessionId.trim().length > 0
  ) {
    return "tutor";
  }
  if (
    typeof agentData.lessonSessionId === "string" &&
    agentData.lessonSessionId.trim().length > 0
  ) {
    return "lesson";
  }
  return "chat";
}

function resolveTextModelId(
  value: string | undefined,
  fallback: LlmTextModelId,
): LlmTextModelId {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const trimmed = value.trim();
  if (isLlmTextModelId(trimmed)) {
    return trimmed;
  }
  throw new Error(`Unsupported model id: ${value}`);
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

function resolveWorkspaceRelativePath(
  workspaceDir: string,
  absolutePath: string,
): string {
  const relative = path.relative(
    path.resolve(workspaceDir),
    path.resolve(absolutePath),
  );
  if (relative.length === 0) {
    throw new Error(`Path "${absolutePath}" resolves to the workspace root.`);
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path "${absolutePath}" is outside workspace.`);
  }
  return relative.replace(/\\/gu, "/");
}

async function countWorkspaceJsonFiles(
  workspaceDir: string,
  targetDir: string,
): Promise<number> {
  try {
    const entries = await readdir(resolveWorkspacePath(workspaceDir, targetDir), {
      withFileTypes: true,
    });
    return entries.filter((entry) => {
      return entry.isFile() && /\.json$/iu.test(entry.name);
    }).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return 0;
    }
    throw error;
  }
}

function isUserUploadPath(userId: string, storagePath: string): boolean {
  return storagePath.startsWith(`spark/uploads/${userId}/`);
}

type ResolvedAttachmentInput = {
  id: string;
  storagePath: string;
  contentType: string;
  filename?: string;
  sizeBytes: number;
  pageCount?: number;
};

function toResolvedAttachmentInput(
  entry: AgentAttachmentInput,
): ResolvedAttachmentInput {
  const fallbackId = `${entry.storagePath}#${entry.contentType}`;
  const attachmentId =
    typeof entry.id === "string" && entry.id.trim().length > 0
      ? entry.id.trim()
      : fallbackId;
  const filename =
    typeof entry.filename === "string" && entry.filename.trim().length > 0
      ? entry.filename.trim()
      : undefined;
  const pageCount =
    typeof entry.pageCount === "number" && entry.pageCount > 0
      ? entry.pageCount
      : undefined;
  return {
    id: attachmentId,
    storagePath: entry.storagePath,
    contentType: entry.contentType,
    ...(filename ? { filename } : {}),
    sizeBytes: entry.sizeBytes,
    ...(pageCount ? { pageCount } : {}),
  };
}

function mergeAttachmentInputs(options: {
  primary: ResolvedAttachmentInput[];
  secondary: ResolvedAttachmentInput[];
}): ResolvedAttachmentInput[] {
  const merged: ResolvedAttachmentInput[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const push = (entry: ResolvedAttachmentInput): void => {
    if (seenIds.has(entry.id) || seenPaths.has(entry.storagePath)) {
      return;
    }
    seenIds.add(entry.id);
    seenPaths.add(entry.storagePath);
    merged.push(entry);
  };
  for (const entry of options.primary) {
    push(entry);
  }
  for (const entry of options.secondary) {
    push(entry);
  }
  return merged;
}

async function mapWithConcurrency<Item, Result>(options: {
  items: Item[];
  concurrency: number;
  mapper: (item: Item, index: number) => Promise<Result>;
}): Promise<Result[]> {
  if (options.items.length === 0) {
    return [];
  }
  const requested = Number.isFinite(options.concurrency)
    ? Math.floor(options.concurrency)
    : 1;
  const workerCount = Math.max(1, Math.min(options.items.length, requested));
  const results = new Array<Result>(options.items.length);
  let nextIndex = 0;
  const workers: Promise<void>[] = [];
  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push(
      (async () => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= options.items.length) {
            return;
          }
          results[currentIndex] = await options.mapper(
            options.items[currentIndex] as Item,
            currentIndex,
          );
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

function resolveAttachmentLabel(attachment: ResolvedAttachmentInput): string {
  const filename =
    typeof attachment.filename === "string" ? attachment.filename.trim() : "";
  if (filename.length > 0) {
    return filename;
  }
  return attachment.id;
}

async function loadAttachmentParts(options: {
  serviceAccountJson: string;
  bucketName: string;
  userId: string;
  attachments: ResolvedAttachmentInput[];
  log?: (line: string) => void;
}): Promise<{ parts: LlmContentPart[]; notes: string[] }> {
  type AttachmentLoadResult = {
    part?: LlmContentPart;
    note?: string;
    logLine?: string;
  };

  const parts: LlmContentPart[] = [];
  const notes: string[] = [];
  const selectedAttachments = options.attachments.slice(
    0,
    AGENT_INLINE_ATTACHMENTS_MAX_COUNT,
  );
  const outcomes = await mapWithConcurrency({
    items: selectedAttachments,
    concurrency: ATTACHMENT_DOWNLOAD_CONCURRENCY,
    mapper: async (
      attachment,
      attachmentIndex,
    ): Promise<AttachmentLoadResult> => {
      const index = attachmentIndex + 1;
      const label = resolveAttachmentLabel(attachment);
      if (!isUserUploadPath(options.userId, attachment.storagePath)) {
        const note = `[${index.toString()}] skipped ${label}: disallowed storage path`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      let downloaded:
        | {
            bytes: Uint8Array;
            contentType: string | null;
          }
        | undefined;
      try {
        downloaded = await downloadStorageObject({
          serviceAccountJson: options.serviceAccountJson,
          bucketName: options.bucketName,
          objectName: attachment.storagePath,
        });
      } catch (error) {
        const note = `[${index.toString()}] skipped ${label}: download failed (${errorAsString(error)})`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      const bytes = downloaded.bytes;
      if (bytes.length <= 0) {
        const note = `[${index.toString()}] skipped ${label}: file is empty`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      if (bytes.length > AGENT_INLINE_ATTACHMENT_MAX_BYTES) {
        const note = `[${index.toString()}] skipped ${label}: file too large (${bytes.length.toString()} bytes)`;
        return {
          note,
          logLine: `warn: ${note}`,
        };
      }
      const mimeType =
        downloaded.contentType && downloaded.contentType.trim().length > 0
          ? downloaded.contentType
          : attachment.contentType;
      if (!mimeType.startsWith("image/")) {
        const note = `[${index.toString()}] omitted ${label} from inline prompt: document uploads stay available through workspace tools`;
        return {
          note,
          logLine: `info: ${note}`,
        };
      }
      const data = Buffer.from(bytes).toString("base64");
      return {
        part: {
          type: "inlineData",
          data,
          mimeType,
        },
        logLine: `input_attachment: added ${label} mime=${mimeType} bytes=${bytes.length.toString()}`,
      };
    },
  });
  for (const outcome of outcomes) {
    if (outcome.note) {
      notes.push(outcome.note);
    }
    if (outcome.part) {
      parts.push(outcome.part);
    }
    if (outcome.logLine) {
      options.log?.(outcome.logLine);
    }
  }
  return { parts, notes };
}

function buildInitialToolLoopInput(options: {
  systemPrompt: string;
  prompt: string;
  inlineParts: LlmContentPart[];
  notes: string[];
}): LlmInputMessage[] {
  const userParts: LlmContentPart[] = [{ type: "text", text: options.prompt }];
  if (options.notes.length > 0) {
    userParts.push({
      type: "text",
      text: [
        "",
        "Attachment ingestion notes:",
        ...options.notes.map((entry) => `- ${entry}`),
      ].join("\n"),
    });
  }
  for (const part of options.inlineParts) {
    userParts.push(part);
  }
  return [
    {
      role: "system",
      content: [{ type: "text", text: options.systemPrompt }],
    },
    {
      role: "user",
      content: userParts,
    },
  ];
}

function buildSingleUserInput(
  parts: readonly LlmContentPart[],
): LlmInputMessage[] {
  return [{ role: "user", content: parts }];
}

function recordLlmTextResult(options: {
  progress?: JobProgressReporter;
  modelId: string;
  result: Pick<LlmTextResult, "modelVersion" | "usage" | "costUsd">;
}): void {
  if (!options.progress) {
    return;
  }
  const handle = options.progress.startModelCall({
    modelId: options.modelId,
    uploadBytes: 0,
  });
  options.progress.recordModelUsage(handle, {
    modelVersion: options.result.modelVersion,
    ...(options.result.usage ? { tokens: options.result.usage } : {}),
    costUsd: options.result.costUsd,
  });
  options.progress.finishModelCall(handle);
}

function createTrackedSubmodelCallSummary(options: {
  modelId: string;
  startedAt: number;
  result: Pick<LlmTextResult, "modelVersion" | "usage" | "costUsd">;
}): TrackedSubmodelCallSummary {
  return {
    modelId: options.modelId,
    modelVersion: options.result.modelVersion,
    elapsedMs: Date.now() - options.startedAt,
    usageTokens: options.result.usage ?? null,
    costUsd: options.result.costUsd,
  };
}

function recordToolLlmCost(
  onToolLlmCost:
    | ((toolName: ToolLlmCostName, costUsd: number) => void)
    | undefined,
  toolName: ToolLlmCostName,
  costUsd: number | null,
): void {
  if (
    typeof costUsd !== "number" ||
    !Number.isFinite(costUsd) ||
    costUsd <= 0
  ) {
    return;
  }
  onToolLlmCost?.(toolName, costUsd);
}

async function readGraderRunSummaryFromWorkspace(options: {
  rootDir: string;
  summaryPath: string;
  log?: (line: string) => void;
}): Promise<GraderRunSummary | null> {
  let text = "";
  try {
    text = await readFile(
      resolveWorkspacePath(options.rootDir, options.summaryPath),
      {
        encoding: "utf8",
      },
    );
  } catch (error) {
    options.log?.(
      `warn: unable to read grader summary "${options.summaryPath}": ${errorAsString(error)}`,
    );
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (error) {
    options.log?.(
      `warn: grader summary "${options.summaryPath}" is invalid JSON: ${errorAsString(error)}`,
    );
    return null;
  }
  const parsed = GraderRunSummarySchema.safeParse(parsedJson);
  if (!parsed.success) {
    options.log?.(
      `warn: grader summary "${options.summaryPath}" failed schema validation`,
    );
    return null;
  }
  return parsed.data;
}

function summariseGraderTotals(summary: GraderRunSummary): {
  awardedMarks: number;
  maxMarks: number;
  problemCount: number;
  gradedCount: number;
  percentage: number;
} {
  const awardedMarks =
    typeof summary.totals?.awardedMarks === "number"
      ? summary.totals.awardedMarks
      : 0;
  const maxMarks =
    typeof summary.totals?.maxMarks === "number" ? summary.totals.maxMarks : 0;
  const percentage = maxMarks > 0 ? (awardedMarks / maxMarks) * 100 : 0;
  return {
    awardedMarks,
    maxMarks,
    problemCount: 1,
    gradedCount: 1,
    percentage: Number.isFinite(percentage) ? percentage : 0,
  };
}

function formatZodIssueSummary(
  error: z.ZodError<unknown>,
  maxIssues = 10,
): string {
  const summary = error.issues
    .flatMap((issue) => flattenZodIssueForSummary(issue))
    .slice(0, maxIssues)
    .join("; ");
  return summary.length > 0 ? summary : "unknown schema issue";
}

function flattenZodIssueForSummary(
  issue: z.ZodIssue,
  parentPath: readonly (string | number)[] = [],
): string[] {
  const issuePath = [...parentPath, ...issue.path];
  if (issue.code === "invalid_union") {
    const nestedIssueGroups = (issue as { errors?: unknown }).errors;
    if (Array.isArray(nestedIssueGroups)) {
      const nestedSummaries: string[] = [];
      for (const nestedIssues of nestedIssueGroups) {
        if (!Array.isArray(nestedIssues)) {
          continue;
        }
        for (const nestedIssue of nestedIssues) {
          if (!isZodIssueLike(nestedIssue)) {
            continue;
          }
          nestedSummaries.push(
            ...flattenZodIssueForSummary(nestedIssue, issuePath),
          );
        }
      }
      if (nestedSummaries.length > 0) {
        return nestedSummaries;
      }
    }
  }
  return [`${issuePath.join(".") || "(root)"}: ${issue.message}`];
}

function isZodIssueLike(value: unknown): value is z.ZodIssue {
  return (
    isPlainRecord(value) &&
    Array.isArray(value.path) &&
    typeof value.message === "string"
  );
}

function collectRawGraderWorksheetShapeIssues(
  value: unknown,
  pathParts: readonly string[] = [],
): string[] {
  const issues: string[] = [];
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      issues.push(
        ...collectRawGraderWorksheetShapeIssues(item, [
          ...pathParts,
          index.toString(),
        ]),
      );
    }
    return issues;
  }
  if (!isPlainRecord(value)) {
    return issues;
  }

  if (value.type === "calc") {
    const id =
      typeof value.id === "string" && value.id.trim().length > 0
        ? value.id.trim()
        : pathParts.join(".") || "(unknown calc question)";
    if (
      typeof value.inputLabel !== "string" ||
      value.inputLabel.trim().length === 0 ||
      typeof value.unit !== "string"
    ) {
      issues.push(
        `calc question "${id}" is missing required inputLabel/unit fields; use type "lines" for handwritten calculation or worked-method leaves unless the source is a single answer blank`,
      );
    }
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    issues.push(
      ...collectRawGraderWorksheetShapeIssues(nestedValue, [
        ...pathParts,
        key,
      ]),
    );
  }
  return issues;
}

const SYNTHETIC_QUESTION_SECTION_ID_PATTERN = /^s\d+$/iu;
const SYNTHETIC_QUESTION_SECTION_LABEL_PATTERN = /^question\s+\d+$/iu;
const FLATTENED_OPTIONS_PATTERN = /\boptions:\s/iu;
const OBJECTIVE_OPTION_LABEL_PATTERN =
  /(?:^|[\s([])(?:[A-H]|[1-9])(?:[.)\]])(?=\s)/u;
const OBJECTIVE_PROMPT_PATTERN =
  /\bwhich(?:\s+\w+){0,3}\s+of\s+the\s+following\b|\bmultiple\s+choice\b|\b(?:choose|select)\s+one\s+(?:option|answer|choice)\b/iu;
const LEADING_PROMPT_NUMBERING_PATTERN =
  /^\s*(?:0?\d+(?:\.\d+)+|0?\d+\([^)]+\)|0?\d+\s*[.)])\s+/u;
const SUBPART_DISPLAY_NUMBER_PATTERN = /^0?\d+(?:\.\d+|\([^)]+\))/u;
const ONE_LEVEL_BRACKET_DISPLAY_NUMBER_PATTERN = /^0?(\d+)\(([^)]+)\)$/u;
const TWO_LEVEL_BRACKET_DISPLAY_NUMBER_PATTERN =
  /^0?(\d+)\(([^)]+)\)\(([^)]+)\)/u;
const DECIMAL_SUBPART_DISPLAY_NUMBER_PATTERN = /^0?(\d+)\.(\d+)$/u;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]+\)/u;
const FIGURE_REFERENCE_PATTERN = /\b(?:figure|diagram|photo|graph|chart)\b/iu;
const VISUAL_CONTEXT_PROMPT_PATTERN =
  /\b(?:figure|fig\.?|diagram|photo(?:graph)?|graph|chart|map)\b|\bimage\s+(?:shows?|below|above|labelled|labeled|of)\b|\b(?:shown|labelled|labeled)\s+in\s+the\s+image\b/iu;
const SOURCE_PDF_VISUAL_REFERENCE_PATTERN =
  /\b(?:linked|original|source|uploaded|official)(?:\s+(?:linked|original|source|uploaded|official))*\s+(?:PDF|paper|question\s+paper|document)\b|\b(?:PDF|paper|question\s+paper|document)\s+(?:link|reference)\b|\blink\s+to\s+(?:the\s+)?(?:linked|original|source|uploaded|official)(?:\s+(?:PDF|paper|question\s+paper|document))?\b/iu;
const ANCHORED_VISUAL_REFERENCE_PATTERN =
  /\[(?:Figure|Fig\.?|Diagram)\s+\d+(?:\.\d+)*[A-Za-z]?\]\(#(?:figure|fig|diagram)-[^)\s]+\)/iu;
const ANCHORED_TABLE_REFERENCE_PATTERN =
  /\[Table\s+\d+(?:\.\d+)*[A-Za-z]?\]\(#table-[^)\s]+\)/iu;
const MARKDOWN_TABLE_PATTERN = /^\s*\|?(?:\s*:?-{3,}:?\s*\|){2,}\s*$/mu;
const NAMED_FIGURE_REFERENCE_PATTERN =
  /\b(?:Figure|Fig\.?|Diagram)\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/giu;
const NAMED_TABLE_REFERENCE_PATTERN = /\bTable\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/giu;
const REPEATED_SOURCE_ARTIFACT_PATTERN =
  /\b(?:Figure|Fig\.?|Diagram|Table)\s+\d+(?:\.\d+)*[A-Za-z]?\s+(?:is\s+)?(?:repeated|shown\s+again|copied\s+again)\s+(?:below|here|again)\b/iu;
const RAW_ESCAPED_NEWLINE_PATTERN = /\\n/u;
const RAW_LAYOUT_LATEX_PATTERN = /\\begin\{(?:tabular)\b/iu;
const LATEX_LAYOUT_ENVIRONMENT_PATTERN =
  /\\begin\{(?:array|aligned|matrix|pmatrix|bmatrix)\b/iu;
const MATH_GRID_ROWS_PROSE_PATTERN =
  /\b(?:first|second|left|right)\s+grid\s+rows\s*:/iu;
const MATH_GRID_BLOCK_PROSE_PATTERN =
  /\b(?:first|second|left|right)?\s*grid\s*:\s*(?:\r?\n)+\s*\d+(?:\s+\d+){2,}\s*(?:\r?\n)+\s*\d+(?:\s+\d+){2,}\s*(?:\r?\n)+\s*\d+(?:\s+\d+){2,}/iu;
const INLINE_SIGN_ROW_PATTERN = /\bsigns?\s+(?:[+-]\s+){6,}[+-](?:[\s.]|$)/u;
const BARE_SIGN_ROW_PATTERN = /(?:^|\n)\s*(?:[+-]\s*){8,}(?:\n|$)/u;
const DISPLAY_MATH_LAYOUT_PATTERN =
  /\\\[|\\begin\{(?:array|aligned|alignedat|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|gathered|cases)\b|\$\$/u;
const TABLE_PROMPT_WITHOUT_TABLE_PATTERN =
  /\b(?:complete|fill\s+in|fill|use|answer)\s+(?:the\s+)?table\b|\btable\s+(?:below|above|shows?|has|gives?|contains?)\b/iu;
const COLUMN_METHOD_PROMPT_WITHOUT_LAYOUT_PATTERN =
  /\b(?:column\s+method|binary\s+addition|stacked\s+addition|show\s+(?:your\s+)?working\s+out)\b/iu;
const QUESTIONS_RANGE_SECTION_LABEL_PATTERN =
  /^Questions\s+0?\d+\s*[-–]\s*0?\d+$/iu;
const STANDALONE_OPTION_LABEL_LINE_PATTERN =
  /^\s*(?:[-*]\s*)?\(?[A-H]\)?(?:[.)])?\s*$/u;
const SPAWN_AGENT_TOOL_PATTERN = /\btool=spawn_agent\b/u;
const FRESH_CROP_REVIEW_TOOL_PATTERN =
  /\btool=validate_crop_with_fresh_agent\b/u;
const SOURCE_FIDELITY_REVIEW_TOOL_SUCCESS_PATTERN =
  /\btool_call_completed:.*\btool=validate_source_fidelity_with_fresh_agent\b.*\bstatus=ok\b/u;
const SCORE_ANSWERS_REVIEW_TOOL_PATTERN =
  /\btool=score_answers_with_fresh_agent\b/u;
const CROP_VALIDATION_SUBAGENT_PATTERN = /\b(?:fresh-context\s+)?subagent\b/iu;
const CROP_VALIDATION_PASS_PATTERN =
  /\b(?:pass(?:ed)?|validated|complete|all\s+(?:required\s+)?(?:content|information)|visible|not\s+clipped|included)\b/iu;
const CROP_VALIDATION_RESOLVED_PATTERN =
  /\b(?:pass(?:ed)?|after\s+recrop|recropped|fixed|resolved|corrected|now\s+(?:visible|included|present|safe)|confirmed)\b/iu;
const CROP_VALIDATION_UNRESOLVED_PATTERN =
  /(?:\b(?:fail(?:ed)?|unresolved|still|not\s+(?:visible|fixed|resolved|included|safe)|unsafe|overbroad|noisy|full\s+page|whole\s+page|broad\s+page|page\s+context|image-edit\s+budget)\b|(?:^|[;,\n-]\s*)(?:pass\/fail|visible|included|complete|safe|(?:all\s+)?question[-\s]?relevant\s+(?:content|information)\s+(?:visible|included|complete|safe)|(?:required|important)\s+(?:content|information)\s+(?:visible|included|complete|safe)|(?:content|information)\s+(?:visible|included|complete|safe))\s*:\s*(?:no|fail|failed)\b)/iu;
const CROP_VALIDATION_NEGATIVE_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?(?:pass\/fail|all\s+question[-\s]?relevant\s+content\s+visible|all\s+question[-\s]?relevant\s+information\s+visible|required\s+content\s+visible|required\s+information\s+visible|important\s+content\s+visible|important\s+information\s+visible)\s*:\s*(?:no|fail|failed)\b/iu;
const CROP_VALIDATION_PASS_FAIL_PASS_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?pass\/fail\s*:\s*pass\b/iu;
const CROP_VALIDATION_PASS_FAIL_FAIL_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?pass\/fail\s*:\s*(?:fail|failed)\b/iu;
const CROP_VALIDATION_VISIBLE_CONTENT_YES_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?(?:all\s+question[-\s]?relevant\s+content\s+visible|all\s+question[-\s]?relevant\s+information\s+visible|required\s+content\s+visible|required\s+information\s+visible|important\s+content\s+visible|important\s+information\s+visible)\s*:\s*yes\b/iu;
const CROP_VALIDATION_DUPLICATE_NOT_EXCLUDED_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?duplicated\s+caption\/question\/table\s+text\s+excluded\s*:\s*no\b/iu;
const CROP_VALIDATION_NEGATED_RISK_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?(?=[^:\n]*(?:unrelated|non[-\s]?target|edge\s+clipping|edge\s+touching|touching\s+(?:an\s+)?edge|page\s+borders?|separator\s+lines?|answer\s+lines?|neighbou?r(?:ing)?[-\s]?question))[^:\n]+:\s*(?:no|none|not[_\s-]?applicable|n\/a|false|absent)\b/iu;
const CROP_VALIDATION_POSITIVE_RISK_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?(?=[^:\n]*(?:unrelated|non[-\s]?target|edge\s+clipping|edge\s+touching|touching\s+(?:an\s+)?edge|page\s+borders?|separator\s+lines?|answer\s+lines?|neighbou?r(?:ing)?[-\s]?question))[^:\n]+:\s*(?:yes|true|present|included|visible)\b/iu;
const CROP_VALIDATION_ASSET_SUBAGENT_CHECK_PATTERN =
  /\bfresh-context\s+subagent\s+checked\s*:\s*yes\b|\bsubagent\s+checked\s*:\s*yes\b|\bfresh-context\s+subagent\b.*\b(?:pass(?:ed)?|checked|validated|confirmed)\b/iu;
const CROP_VALIDATION_VISIBLE_TEXT_PATTERN =
  /\b(?:reviewer[-\s]?visible\s+text|visible\s+text|text\s+(?:visible|transcribed)\s+(?:in|from)\s+(?:the\s+)?crop|crop\s+text|transcribed\s+text)\s*:\s*(?:none|n\/a|no\s+text|[^\n]{2,})/iu;
const SOURCE_FIDELITY_SUBAGENT_CHECK_PATTERN =
  /\bfresh-context\s+subagent\s+checked\s*:\s*yes\b|\bsource[-\s]?fidelity\s+audit\b.*\b(?:pass(?:ed)?|checked|validated|confirmed)\b/iu;
const SOURCE_FIDELITY_PASS_PATTERN =
  /\bpass\/fail\s*:\s*pass\b|\bsource[-\s]?fidelity\s+audit\b.*\bpass(?:ed)?\b/iu;
const SOURCE_FIDELITY_BLOCKING_PATTERN =
  /\bpass\/fail\s*:\s*(?:fail|failed)\b|\b(?:visible\s+source\s+items\s+represented|verbatim\s+wording\s+preserved|numbering\s+and\s+badges\s+correct|figures\/tables\/layouts\s+preserved|answer\s+evidence\s+aligned)\s*:\s*no\b/iu;
const SOURCE_FIDELITY_BLOCKING_ISSUES_FIELD_PATTERN =
  /(?:^|\n)\s*(?:[-*]\s*)?blocking\s+issues\s*:\s*([^\n]*)/giu;
const SOURCE_FIDELITY_NO_BLOCKING_ISSUES_PATTERN =
  /^(?:none|n\/a|not[_\s-]?applicable|no(?:\s+blocking\s+issues?)?)[.!;]*$/iu;
const SOURCE_TRANSCRIPTION_INCOMPLETE_PLACEHOLDER_PATTERN =
  /\b(?:full\s+source\s+wording\s+[^.\n]{0,80}not\s+yet|not\s+yet\s+(?:copied|transcribed|included|complete)|source\s+wording\s+(?:missing|incomplete)|(?:todo|tbd)\b)/iu;
const SOURCE_TRANSCRIPTION_SUMMARY_ONLY_PATTERN =
  /\bcompact\s+(?:source\s+)?audit\b|\bsource\s+paper\s+prompts?\s+actually\s+needed\s+for\s+grading\b|\bsource\s+items?\s+actually\s+needed\s+for\s+grading\b|\bonly\s+(?:the\s+)?source\s+items?\s+(?:visibly\s+)?answered\b|\bsource\s+items?\s+(?:visibly\s+)?answered\s+in\s+the\s+student\s+submission\b/iu;
const SOURCE_TRANSCRIPTION_VISUAL_SUMMARY_PATTERN =
  /\boptions?\s*(?::|shown\s+as)\s*(?:[*_`]+)?[A-H](?:[*_`]+)?(?:(?:\s*,\s*|\s+)(?:[*_`]+)?[A-H](?:[*_`]+)?){2,}\s+(?:shown\s+as\s+)?(?:diagram|visual|image)\s+(?:choices|labels)\b|\boptions?\s*(?::|shown\s+as|\s+)\s*(?:(?:[*_`]+)?[A-H](?:[*_`]+)?(?:(?:\s*,\s*|\s+)(?:[*_`]+)?[A-H](?:[*_`]+)?){2,}|[A-H]\s*[-–]\s*[A-H])\s+(?:shown\s+)?in\s+(?:Figure|Fig\.?|Diagram)\s+\d+\b|\boptions?\s+shown\s+(?:as|in)\b[^.\n]{0,120}\b(?:Figure|Fig\.?|Diagram)\s+\d+(?:\.\d+)*\b|\boptions?\s+shown\s+in\s+(?:Figure|Fig\.?|Diagram)\s+\d+(?:\.\d+)*\s+with\s+labels?\s+(?:[*_`]+)?[A-H](?:(?:\s*,\s*|\s+)(?:[*_`]+)?[A-H](?:[*_`]+)?){2,}(?:[*_`]+)?|\boptions?\s+(?:are\s+)?(?:diagram|visual|image)\s+labels?\s+[A-H](?:(?:\s*,\s*|\s+)[A-H]){2,}\b|\boptions?\s+shown\s+as\s+(?:diagram|visual|image)\s+(?:choices|labels)\b|\bshown\s+as\s+(?:diagram|visual|image)\s+(?:choices|labels)\b/iu;
const SOURCE_TRANSCRIPTION_FORMULA_SUMMARY_PATTERN =
  /\b(?:displayed\s+formula(?:\s+equation)?|equation|formula)\s+shown\s+(?:for|as)\b|\b(?:formula|equation)\s+shown\s+for\b/iu;
const SYNTHETIC_SOURCE_WORKFLOW_PHRASE_PATTERN =
  /\b(?:planned\s+as\s+crop|crop\s+path|(?:Figure|Fig\.?|Diagram|Table)\s+\d+(?:\.\d+)*[A-Za-z]?\s+(?:is|are)\s+used\s+in\s+this\s+question)\b/iu;
const SYNTHETIC_WORKSHEET_BRIDGE_PHRASE_PATTERN =
  /\b(?:shown\s+in\s+the\s+source\s+(?:paper|pdf|file)|(?:Figure|Fig\.?|Diagram|Table)\s+\d+(?:\.\d+)*[A-Za-z]?\s+(?:is|are)\s+used\s+in\s+this\s+question)\b/iu;
const SHEET_PLAN_VISUAL_OMISSION_PATTERN =
  /\bno\s+(?:final\s+)?(?:linked\s+)?(?:crop|crops|image|images|visual|visuals)(?:\s+assets?)?\s+(?:is\s+|are\s+)?(?:planned|needed|required)\b|\bno\s+crop\s+(?:is\s+)?(?:planned|needed|required)\b|\bwithout\s+(?:reproducing|rendering|showing|including)\s+(?:the\s+)?(?:figure|figures|diagram|diagrams|graph|graphs|visual|visuals|table|tables)\b|\b(?:grading|grade|marking|mark\s+scheme)\b[^.\n]{0,160}\bwithout\s+(?:reproducing|rendering|showing|including)\b/iu;
const CROP_VALIDATION_HISTORY_FIELD_PATTERN =
  /^\s*(?:[-*]\s*)?crop\s+fixes\s+made\s*:/iu;
const OPTION_CROP_ASSET_PATTERN = /\boptions?\b/iu;
const FULL_PAGE_CROP_ASSET_PATTERN =
  /(?:^|[/_-])(?:full[-_]?page|source[-_]?page|page)(?:[/_.-]|\d|$)/iu;
const PARTIAL_OPTION_CROP_VALIDATION_PATTERN =
  /\b(?:partial(?:ly)?|portion|fragment|split\s+across|used\s+together\s+with|continued|continues|top\s+of|bottom\s+of|upper\s+part|lower\s+part)\b/iu;
const ADMIN_BOILERPLATE_PATTERN =
  /\b(?:do not open the paper until|invigilator|use\s+B\s+or\s+HB\s+pencil|answer sheet will be read|candidates in england|calculators and measuring instruments are forbidden|rough paper is allowed)\b/iu;
const USER_VISIBLE_PROCESS_METADATA_PATTERN =
  /\b(?:question\s+paper\s+transcription|transcription|transcribed|ocr\s+(?:text|output|cleanup|artifact|transcription)|optical\s+character\s+recognition|extracted\s+text|source\s+transcript|worksheet\s+json|artifact|publish(?:ed)?\s+sheet)\b/iu;
const ANSWER_REVEAL_NOTE_PATTERN = new RegExp(
  [
    String.raw`\b(?:the\s+)?correct\s+(?:answer|response|option|choice|cell\s+type|term|value)\s+is\b`,
    String.raw`\bshould\s+be\s+["'\x60]?[-\w\s()[\]./]+`,
    String.raw`\b(?:pick|choose|select|circle)\s+(?:option\s+)?[A-H]\b`,
    String.raw`\b(?:answer|option|choice)\s+(?:is|=)\s+[A-H]\b`,
    String.raw`\b(?:the\s+)?(?:answer|value|length|angle|mass|distance)\s+(?:is|=)\s+[-+]?\d`,
    String.raw`\b(?:no\s+(?:clear\s+)?answer|no\s+selected\s+option|left\s+blank|was\s+left\s+blank)[^.?!]*[.?!]\s*(?:the\s+)?(?:correct|key|useful|needed|expected)\b`,
    String.raw`\b(?:the\s+)?(?:key\s+idea|idea\s+needed|useful\s+property|expected\s+(?:answer|value|range)|mark\s+scheme\s+wanted)\s+(?:is|was|wanted|expected)\b`,
    String.raw`\ba\s+value\s+around\s+[-+*]*\d`,
    String.raw`\b(?:athlete|option|choice|answer)\s+[A-H]\s+(?:tested|is|was)\b`,
    String.raw`\blink\s+(?:the\s+)?(?:larger\s+)?muscles?\b`,
    String.raw`\bcompare\s+how\s+much\s+[^.?!]*(?:absorbs?|absorption)\b`,
  ].join("|"),
  "iu",
);
const SCORE_ONLY_REVIEW_MESSAGE_PATTERN =
  /^\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:marks?)?\s*$/iu;
const SCORE_FRACTION_PATTERN = /\b(\d{1,3})\s*\/\s*(\d{1,3})\b/gu;
const NO_STUDENT_ANSWERS_REQUEST_PATTERN =
  /\b(?:no\s+student\s+answers?\s+(?:were\s+)?provided|no\s+student\s+submission|no\s+submitted\s+answers?|unanswered\s+worksheet|leave\s+answers?\s+blank|awaiting\s+student\s+work)\b/iu;
const QUESTION_STRUCTURE_REQUEST_PATTERN =
  /\b(?:question\s+paper|problem\s+statement|printed\s+paper|source\s+paper|preserve\s+(?:question\s+)?structure|root\s+stems?|subquestion\s+numbering|whole\s+graded\s+sheet|unanswered\s+worksheet|render\s+(?:the\s+)?source)\b/iu;
const PROBLEM_STATEMENT_TRANSCRIPTION_HEADING_PATTERN =
  /^#{1,}\s+(?:problem\s+statement|source\s+problem[-\s]statement|question\s+paper|source\s+paper|printed\s+paper|source\s+question)[^\n]*(?:transcription|text|questions?)/imu;
const ANSWER_KEY_REFERENCE_PATTERN =
  /\b(?:answer\s+key|official\s+solution|correct\s+(?:answer|option|choice|response|value)\s+is|solutions?\s*:)\b/iu;
const SHEET_PLAN_TOTAL_MARKS_PATTERN =
  /^\s*[-*]?\s*Total\s+source\s+marks\s*(?::|=)\s*(?:[*_`]+)?\s*(\d{1,3})\s*(?:[*_`]+)?\??\s*(?:$|[-–—>])/imu;
const SHEET_PLAN_TOTAL_LEAVES_PATTERN =
  /^\s*[-*]?\s*Total\s+answer-bearing\s+leaves(?:\s+(?:included|listed))?\s*(?::|=)\s*(?:[*_`]+)?\s*(\d{1,3})\s*(?:[*_`]+)?\??\s*(?:$|[-–—>])/imu;
const SHEET_PLAN_SECTION_TOTAL_MARKS_PATTERN =
  /^#{2,6}\s+Question\b[^\n]*?(?:\btotal\s+|\()(\d{1,3})\s+marks?\b/gimu;
const SHEET_PLAN_LEAF_MARKS_PATTERN =
  /^\s*[-*]\s+.*?(?:(?:→|->)\s*(\d{1,3})\s+marks?\b|\bmarks?\s+(\d{1,3})\b).*$/gimu;
const SHEET_PLAN_SCORING_BATCH_MARKS_PATTERN =
  /^\s*(?:\d+[.)]\s*)?Batch\b[^\n]*?[-–—]\s*(\d{1,3})\s+marks?\s*$/gimu;
const SHEET_PLAN_SELF_CHECK_FAILURE_PATTERN =
  /\b(?:self-check\s+failure|mismatch\s+flags|must\s+be\s+corrected\s+before\s+publication|incorrect\s+initial\s+mental\s+sum)\b/iu;

function containsMathGridAsProse(markdown: string): boolean {
  return (
    MATH_GRID_ROWS_PROSE_PATTERN.test(markdown) ||
    MATH_GRID_BLOCK_PROSE_PATTERN.test(markdown)
  );
}

function containsLongSignRowOutsideDisplayMath(markdown: string): boolean {
  return (
    INLINE_SIGN_ROW_PATTERN.test(markdown) ||
    (BARE_SIGN_ROW_PATTERN.test(markdown) &&
      !DISPLAY_MATH_LAYOUT_PATTERN.test(markdown))
  );
}

const FAKE_BLANK_OBJECTIVE_OPTION_PATTERN =
  /^(?:blank|no\s+answer(?:\s+(?:marked|selected|given))?|unanswered|not\s+answered)$/iu;
const FAKE_OBJECTIVE_OPTION_TEXT_PATTERN =
  /^(?:option\s+[A-Z]|choice\s+[A-Z])$/iu;
const WORKSHEET_CROP_ASSET_PATH_PATTERN =
  /^(?:grader\/(?:output\/)?assets\/|sheet\/(?:output\/)?assets\/)/u;
const INTERMEDIATE_WORKSHEET_ASSET_BASENAME_PATTERN =
  /(?:^|[-_])(?:raw|candidate|draft|tmp|temp)(?:[-_.]|$)/iu;
const MARKDOWN_IMAGE_TARGET_PATTERN = /!\[[^\]]*\]\(<?([^)>\s]+)>?\)/gu;
const MARKDOWN_IMAGE_OCCURRENCE_PATTERN = /!\[([^\]]*)\]\(<?([^)>\s]+)>?\)/gu;
const AGENT_LOG_IMAGE_EDIT_STARTED_PATTERN =
  /^(?:\[[^\]]+\]\s+)?(?<timestamp>\d{4}-\d{2}-\d{2}T[^\s]+)\s+\[[^\]]+\]\s+tool_call_started:.*\btool=(?<tool>crop_image|trim_image|pad_image)\b/iu;
const AGENT_LOG_TOOL_INPUT_PREFIX = "tool_call_input:";
const CROP_EDGE_BAND_PX = 6;
const CROP_EDGE_DARK_PIXEL_THRESHOLD = 245;
const CROP_EDGE_TOUCH_RATIO_THRESHOLD = 0.001;
const DEFAULT_CROP_IMAGE_MARGIN_PX = 36;
const GRADER_WORKSHEET_ASSET_MAX_DIMENSION = 512;
const GRADER_WORKSHEET_ASSET_JPEG_QUALITY = 82;

function getBlockedIntermediateWorksheetAssetMessage(
  outputPath: string,
): string | null {
  const normalizedOutputPath = outputPath.trim().replace(/\\/gu, "/");
  if (!WORKSHEET_CROP_ASSET_PATH_PATTERN.test(normalizedOutputPath)) {
    return null;
  }
  const basename = path.posix.basename(normalizedOutputPath);
  if (!INTERMEDIATE_WORKSHEET_ASSET_BASENAME_PATTERN.test(basename)) {
    return null;
  }
  return `Refusing to write intermediate worksheet asset "${outputPath}". In grader/sheet runs, crop_image outputPath under grader/output/assets or sheet/output/assets must be the final linked path from the sheet plan, not a raw/candidate/draft/temp path. Retry immediately with the planned final asset path, for example "grader/output/assets/q01-figure-1.png", and use that exact path in sheet.json.`;
}

type SparkGraderWorksheetContentSection = Extract<
  SparkGraderWorksheetReport["sheet"]["sections"][number],
  { id: string }
>;

function normalizeDisplayNumberRoot(displayNumber: string): string | null {
  const trimmed = displayNumber.trim();
  const decimalMatch = /^0?(\d+)\.\d+/u.exec(trimmed);
  if (decimalMatch?.[1]) {
    return decimalMatch[1];
  }
  const bracketMatch = /^0?(\d+)\([^)]+\)/u.exec(trimmed);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }
  const wholeMatch = /^0?(\d+)$/u.exec(trimmed);
  if (wholeMatch?.[1]) {
    return wholeMatch[1];
  }
  return null;
}

function normalizeDisplayNumberForComparison(
  displayNumber: string | undefined,
): string | null {
  if (!displayNumber) {
    return null;
  }
  const trimmed = displayNumber.trim().toLowerCase();
  const decimalMatch = /^0?(\d+)\.(\d+)$/u.exec(trimmed);
  if (decimalMatch?.[1] && decimalMatch[2]) {
    return `${decimalMatch[1]}.${decimalMatch[2]}`;
  }
  const bracketMatch = /^0?(\d+)\(([^)]+)\)$/u.exec(trimmed);
  if (bracketMatch?.[1] && bracketMatch[2]) {
    return `${bracketMatch[1]}(${bracketMatch[2].trim()})`;
  }
  const wholeMatch = /^0?(\d+)$/u.exec(trimmed);
  if (wholeMatch?.[1]) {
    return wholeMatch[1];
  }
  return trimmed.replace(/\s+/gu, " ");
}

function normalizeSubpartLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/^\((.*)\)$/u, "$1")
    .trim();
}

function isSubpartDisplayNumber(displayNumber: string): boolean {
  return SUBPART_DISPLAY_NUMBER_PATTERN.test(displayNumber.trim());
}

function parseOneLevelBracketDisplayNumber(
  displayNumber: string | undefined,
): { root: string; firstLevel: string } | null {
  if (!displayNumber) {
    return null;
  }
  const match = ONE_LEVEL_BRACKET_DISPLAY_NUMBER_PATTERN.exec(
    displayNumber.trim(),
  );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    root: match[1],
    firstLevel: normalizeSubpartLabel(match[2]),
  };
}

function parseDecimalSubpartDisplayNumber(
  displayNumber: string | undefined,
): { root: string; subpart: string } | null {
  if (!displayNumber) {
    return null;
  }
  const match = DECIMAL_SUBPART_DISPLAY_NUMBER_PATTERN.exec(
    displayNumber.trim(),
  );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return {
    root: match[1],
    subpart: match[2],
  };
}

function parseTwoLevelBracketDisplayNumber(
  displayNumber: string | undefined,
): { root: string; firstLevel: string; secondLevel: string } | null {
  if (!displayNumber) {
    return null;
  }
  const match = TWO_LEVEL_BRACKET_DISPLAY_NUMBER_PATTERN.exec(
    displayNumber.trim(),
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return {
    root: match[1],
    firstLevel: normalizeSubpartLabel(match[2]),
    secondLevel: normalizeSubpartLabel(match[3]),
  };
}

function badgeLabelLooksLikeFullSourceNumber(label: string): boolean {
  const trimmed = label.trim();
  const normalized = normalizeSubpartLabel(trimmed);
  return (
    /^0\d+$/u.test(normalized) ||
    DECIMAL_SUBPART_DISPLAY_NUMBER_PATTERN.test(trimmed) ||
    ONE_LEVEL_BRACKET_DISPLAY_NUMBER_PATTERN.test(trimmed) ||
    TWO_LEVEL_BRACKET_DISPLAY_NUMBER_PATTERN.test(trimmed)
  );
}

function parseQuestionSectionRoot(label: string): string | null {
  const match = /^Question\s+0?(\d+)\b/iu.exec(label.trim());
  return match?.[1] ?? null;
}

function collectSectionRootQuestionKeys(
  section: SparkGraderWorksheetContentSection,
): Set<string> {
  const roots = new Set<string>();
  for (const entry of section.questions ?? []) {
    const displayRoot = entry.displayNumber
      ? normalizeDisplayNumberRoot(entry.displayNumber)
      : null;
    if (displayRoot) {
      roots.add(displayRoot);
      continue;
    }
    if (entry.type === "group") {
      const idRoot = /^q(?:uestion)?[-_]?0?(\d+)$/iu.exec(entry.id)?.[1];
      if (idRoot) {
        roots.add(idRoot);
      }
    }
  }
  return roots;
}

function collectNamedReferences(text: string, pattern: RegExp): Set<string> {
  const references = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const label = match[1]?.trim().toLowerCase();
    if (label) {
      references.add(label);
    }
  }
  return references;
}

function formatFlexibleSourceDigitsPattern(value: string): string {
  return value
    .split("")
    .map((digit) => escapeRegExpLiteral(digit))
    .join(String.raw`\s*`);
}

function createExtractedSourceDisplayNumberPattern(
  displayNumber: string,
): RegExp | null {
  const decimal = /^(\d+)\.(\d+)$/u.exec(displayNumber);
  if (decimal?.[1] && decimal[2]) {
    return new RegExp(
      String.raw`\b0?\s*${formatFlexibleSourceDigitsPattern(decimal[1])}\s*\.\s*${formatFlexibleSourceDigitsPattern(decimal[2])}\b`,
      "iu",
    );
  }

  const bracket = /^(\d+)\(([^)]+)\)$/u.exec(displayNumber);
  if (bracket?.[1] && bracket[2]) {
    return new RegExp(
      String.raw`\b0?\s*${formatFlexibleSourceDigitsPattern(bracket[1])}\s*\(?\s*${escapeRegExpLiteral(bracket[2])}\s*\)?\b`,
      "iu",
    );
  }

  const root = /^(\d+)$/u.exec(displayNumber);
  if (root?.[1]) {
    return new RegExp(
      String.raw`\b0?\s*${formatFlexibleSourceDigitsPattern(root[1])}\b`,
      "iu",
    );
  }

  return null;
}

function collectReportDisplayNumbers(
  report: SparkGraderWorksheetReport,
): Set<string> {
  const displayNumbers = new Set<string>();
  const visitEntries = (
    entries: readonly PaperSheetQuestionEntry[] | undefined,
  ): void => {
    for (const entry of entries ?? []) {
      const normalized = normalizeDisplayNumberForComparison(
        entry.displayNumber,
      );
      if (normalized !== null) {
        displayNumbers.add(normalized);
      }
      if (entry.type === "group") {
        visitEntries(entry.questions);
      }
    }
  };

  for (const section of report.sheet.sections) {
    if (!("id" in section)) {
      continue;
    }
    visitEntries(section.questions);
  }

  return displayNumbers;
}

function collectSourceReferenceLabelsNearDisplayNumbers(
  sourceReferenceMarkdown: string,
  displayNumbers: ReadonlySet<string>,
  referencePattern: RegExp,
): Set<string> {
  const labels = new Set<string>();
  if (sourceReferenceMarkdown.trim().length === 0 || displayNumbers.size === 0) {
    return labels;
  }

  const displayPatterns = [...displayNumbers]
    .map((displayNumber) =>
      createExtractedSourceDisplayNumberPattern(displayNumber),
    )
    .filter((pattern): pattern is RegExp => pattern !== null);
  if (displayPatterns.length === 0) {
    return labels;
  }

  for (const match of sourceReferenceMarkdown.matchAll(referencePattern)) {
    const label = match[1]?.trim().toLowerCase();
    if (!label) {
      continue;
    }
    const index = match.index ?? 0;
    const nearby = sourceReferenceMarkdown.slice(
      Math.max(0, index - 1200),
      index + 1600,
    );
    if (displayPatterns.some((pattern) => pattern.test(nearby))) {
      labels.add(label);
    }
  }

  return labels;
}

function mergeNamedReferenceLabels(
  ...labelSets: readonly ReadonlySet<string>[]
): Set<string> {
  const labels = new Set<string>();
  for (const labelSet of labelSets) {
    for (const label of labelSet) {
      labels.add(label);
    }
  }
  return labels;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizeMetadataText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function stripQuestionPaperSuffix(value: string): string {
  return value.replace(/\s+questions?\s+paper\s*$/iu, "").trim();
}

function collectRegexIntegerMatches(text: string, pattern: RegExp): number[] {
  return Array.from(text.matchAll(pattern))
    .map((match) =>
      Number.parseInt(
        match.slice(1).find((value) => value !== undefined) ?? "",
        10,
      ),
    )
    .filter((value) => Number.isInteger(value));
}

function sumNumbers(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sheetPlanHasNamedVisualOmission(markdown: string): boolean {
  for (const line of markdown.split(/\r?\n/gu)) {
    const mentionsNamedVisual =
      /\b(?:Figure|Fig\.?|Diagram|Table)\s+\d+(?:\.\d+)*[A-Za-z]?\b/iu.test(
        line,
      );
    if (mentionsNamedVisual && SHEET_PLAN_VISUAL_OMISSION_PATTERN.test(line)) {
      return true;
    }
  }
  return false;
}

function collectSheetPlanConsistencyIssues(sheetPlanMarkdown: string): string[] {
  const markdown = sheetPlanMarkdown.trim();
  if (markdown.length === 0) {
    return [];
  }

  const issues: string[] = [];
  const totalMarks = Number.parseInt(
    SHEET_PLAN_TOTAL_MARKS_PATTERN.exec(markdown)?.[1] ?? "",
    10,
  );
  const totalLeaves = Number.parseInt(
    SHEET_PLAN_TOTAL_LEAVES_PATTERN.exec(markdown)?.[1] ?? "",
    10,
  );
  const sectionMarks = collectRegexIntegerMatches(
    markdown,
    SHEET_PLAN_SECTION_TOTAL_MARKS_PATTERN,
  );
  const leafMarks = collectRegexIntegerMatches(
    markdown,
    SHEET_PLAN_LEAF_MARKS_PATTERN,
  );
  const scoringBatchMarks = collectRegexIntegerMatches(
    markdown,
    SHEET_PLAN_SCORING_BATCH_MARKS_PATTERN,
  );
  const sectionMarksTotal = sumNumbers(sectionMarks);
  const leafMarksTotal = sumNumbers(leafMarks);
  const scoringBatchMarksTotal = sumNumbers(scoringBatchMarks);

  if (SHEET_PLAN_SELF_CHECK_FAILURE_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/sheet-plan.md records an arithmetic self-check failure or says the plan must be corrected before publication; rewrite the plan with resolved totals before bounded scoring or publish",
    );
  }

  if (
    Number.isInteger(totalMarks) &&
    sectionMarks.length > 0 &&
    totalMarks !== sectionMarksTotal
  ) {
    issues.push(
      `grader/output/sheet-plan.md says Total source marks is ${totalMarks.toString()}, but question section totals sum to ${sectionMarksTotal.toString()}; fix the plan before bounded scoring or publish`,
    );
  }
  if (
    Number.isInteger(totalMarks) &&
    leafMarks.length > 0 &&
    totalMarks !== leafMarksTotal
  ) {
    issues.push(
      `grader/output/sheet-plan.md says Total source marks is ${totalMarks.toString()}, but listed answer leaves sum to ${leafMarksTotal.toString()}; fix the plan before bounded scoring or publish`,
    );
  }
  if (
    sectionMarks.length > 0 &&
    leafMarks.length > 0 &&
    sectionMarksTotal !== leafMarksTotal
  ) {
    issues.push(
      `grader/output/sheet-plan.md question section totals sum to ${sectionMarksTotal.toString()}, but listed answer leaves sum to ${leafMarksTotal.toString()}; fix the plan before bounded scoring or publish`,
    );
  }
  if (
    Number.isInteger(totalLeaves) &&
    leafMarks.length > 0 &&
    totalLeaves !== leafMarks.length
  ) {
    issues.push(
      `grader/output/sheet-plan.md says Total answer-bearing leaves included is ${totalLeaves.toString()}, but lists ${leafMarks.length.toString()} answer leaves; fix the plan before bounded scoring or publish`,
    );
  }
  if (
    Number.isInteger(totalMarks) &&
    scoringBatchMarks.length > 0 &&
    totalMarks !== scoringBatchMarksTotal
  ) {
    issues.push(
      `grader/output/sheet-plan.md says Total source marks is ${totalMarks.toString()}, but planned scoring batches sum to ${scoringBatchMarksTotal.toString()}; fix scoring batches before bounded scoring or publish`,
    );
  }
  if (
    sectionMarks.length > 0 &&
    scoringBatchMarks.length > 0 &&
    sectionMarksTotal !== scoringBatchMarksTotal
  ) {
    issues.push(
      `grader/output/sheet-plan.md question section totals sum to ${sectionMarksTotal.toString()}, but planned scoring batches sum to ${scoringBatchMarksTotal.toString()}; fix scoring batches before bounded scoring or publish`,
    );
  }
  if (sheetPlanHasNamedVisualOmission(markdown)) {
    issues.push(
      "grader/output/sheet-plan.md names a figure/diagram/graph but plans to omit the visible crop because grading is possible without it; plan a guarded grader/output/assets/... crop for every included named source visual before bounded scoring or publish",
    );
  }

  return issues;
}

function collectSheetPlanDisplayNumbers(sheetPlanMarkdown: string): Set<string> {
  const displayNumbers = new Set<string>();
  for (const match of sheetPlanMarkdown.matchAll(/\b0?(\d{1,2})\.(\d{1,2})\b/gu)) {
    if (match[1] && match[2]) {
      displayNumbers.add(`${match[1]}.${match[2]}`);
    }
  }
  for (const match of sheetPlanMarkdown.matchAll(/\b0?(\d{1,2})\(([^)\s]+)\)/gu)) {
    if (match[1] && match[2]) {
      displayNumbers.add(`${match[1]}(${match[2]})`);
    }
  }
  return displayNumbers;
}

function sheetPlanHasRecordedArtifactAttempt(
  text: string,
  kind: "Figure" | "Table",
  label: string,
): boolean {
  const escapedLabel = escapeRegExpLiteral(label);
  const kindPattern =
    kind === "Figure" ? String.raw`(?:Figure|Fig\.?|Diagram)` : "Table";
  const labelPattern = new RegExp(
    `\\b${kindPattern}\\s+${escapedLabel}\\b`,
    "giu",
  );
  for (const match of text.matchAll(labelPattern)) {
    const index = match.index ?? 0;
    const nearby = text.slice(Math.max(0, index - 500), index + 1000);
    if (/grader\/output\/assets\/[^\s)`'"]+/iu.test(nearby)) {
      return true;
    }
    if (
      kind === "Table" &&
      (/\bmarkdown\b[^.\n]{0,80}\btable\b/iu.test(nearby) ||
        /\btable\b[^.\n]{0,80}\bmarkdown\b/iu.test(nearby) ||
        MARKDOWN_TABLE_PATTERN.test(nearby))
    ) {
      return true;
    }
    if (
      /\b(?:failed|failure|could\s+not|cannot|unavailable|blocked)\b[^.\n]{0,120}\b(?:crop|render|extract|table)\b/iu.test(
        nearby,
      ) ||
      /\b(?:crop|render|extract|table)\b[^.\n]{0,120}\b(?:failed|failure|could\s+not|cannot|unavailable|blocked)\b/iu.test(
        nearby,
      )
    ) {
      return true;
    }
  }
  return false;
}

function collectSheetPlanSourceReferenceIssues(options: {
  sheetPlanMarkdown: string;
  sourceReferenceMarkdown: string;
}): string[] {
  const sheetPlanMarkdown = options.sheetPlanMarkdown.trim();
  const sourceReferenceMarkdown = options.sourceReferenceMarkdown.trim();
  if (sheetPlanMarkdown.length === 0 || sourceReferenceMarkdown.length === 0) {
    return [];
  }

  const displayNumbers = collectSheetPlanDisplayNumbers(sheetPlanMarkdown);
  if (displayNumbers.size === 0) {
    return [];
  }

  const issues: string[] = [];
  const sourceFigureLabels = collectSourceReferenceLabelsNearDisplayNumbers(
    sourceReferenceMarkdown,
    displayNumbers,
    NAMED_FIGURE_REFERENCE_PATTERN,
  );
  for (const label of sourceFigureLabels) {
    if (!hasReferenceLabel(sheetPlanMarkdown, "Figure", label)) {
      issues.push(
        `grader/output/sheet-plan.md includes source leaves whose extracted source reference names Figure ${label}, but the plan omits Figure ${label}; add a visual placement with a guarded grader/output/assets/... crop path or a recorded failed render/crop attempt before bounded scoring`,
      );
      continue;
    }
    if (
      !sheetPlanHasRecordedArtifactAttempt(sheetPlanMarkdown, "Figure", label)
    ) {
      issues.push(
        `grader/output/sheet-plan.md mentions Figure ${label} but does not assign a guarded grader/output/assets/... crop path or a recorded failed render/crop attempt; do not defer or omit named source figures because grading is possible without them`,
      );
    }
  }

  const sourceTableLabels = collectSourceReferenceLabelsNearDisplayNumbers(
    sourceReferenceMarkdown,
    displayNumbers,
    NAMED_TABLE_REFERENCE_PATTERN,
  );
  for (const label of sourceTableLabels) {
    if (!hasReferenceLabel(sheetPlanMarkdown, "Table", label)) {
      issues.push(
        `grader/output/sheet-plan.md includes source leaves whose extracted source reference names Table ${label}, but the plan omits Table ${label}; add Markdown table handling or a recorded failed table/crop attempt before bounded scoring`,
      );
      continue;
    }
    if (!sheetPlanHasRecordedArtifactAttempt(sheetPlanMarkdown, "Table", label)) {
      issues.push(
        `grader/output/sheet-plan.md mentions Table ${label} but does not assign Markdown table handling, a guarded crop path, or a recorded failed table/crop attempt`,
      );
    }
  }

  return issues;
}

function collectSourceTranscriptionStemDriftIssues(options: {
  sourceTranscriptMarkdown: string;
  sourceReferenceMarkdown: string;
}): string[] {
  const issues: string[] = [];
  const sourceReferenceMarkdown = options.sourceReferenceMarkdown.trim();
  if (sourceReferenceMarkdown.length === 0) {
    return issues;
  }

  const inflatedExplainPattern =
    /\b0?(\d{1,2})\.(\d{1,2})\b[\s\S]{0,300}?\bdescribe\s+and\s+explain\b/giu;
  for (const match of options.sourceTranscriptMarkdown.matchAll(
    inflatedExplainPattern,
  )) {
    if (!match[1] || !match[2]) {
      continue;
    }
    const sourceLabel = `${match[1]}.${match[2]}`;
    const sourceLabelPattern = createExtractedSourceDisplayNumberPattern(
      sourceLabel,
    );
    if (sourceLabelPattern === null) {
      continue;
    }
    const sourceMatch = sourceLabelPattern.exec(sourceReferenceMarkdown);
    if (sourceMatch === null) {
      continue;
    }
    const sourceWindow = sourceReferenceMarkdown.slice(
      sourceMatch.index,
      sourceMatch.index + 1200,
    );
    if (
      /\bexplain\b/iu.test(sourceWindow) &&
      !/\bdescribe\s+and\s+explain\b/iu.test(sourceWindow)
    ) {
      issues.push(
        `grader/output/transcription.md rewrites source command words for ${sourceLabel} as "Describe and explain"; preserve the printed source stem verbatim instead of adding command words`,
      );
    }
  }

  return issues;
}

function collectSourceTranscriptionIntegrityIssues(
  sourceTranscriptMarkdown: string,
  sourceReferenceMarkdown = "",
): string[] {
  const markdown = sourceTranscriptMarkdown.trim();
  if (markdown.length === 0) {
    return [];
  }

  const issues: string[] = [];
  if (SOURCE_TRANSCRIPTION_INCOMPLETE_PLACEHOLDER_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/transcription.md contains an incomplete source-transcription placeholder; replace placeholders with the printed source wording, table labels, figure labels, and displayed formulas before source-fidelity audit or publish",
    );
  }
  if (SOURCE_TRANSCRIPTION_SUMMARY_ONLY_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/transcription.md describes the source problem statements as a compact audit/needed-for-grading/visible-answered-only summary; replace it with verbatim printed source wording, shared root context, options, instructions, table labels, figure labels, and displayed formulas before bounded scoring or publish",
    );
  }
  if (SOURCE_TRANSCRIPTION_VISUAL_SUMMARY_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/transcription.md summarizes diagram/visual options as labels only; replace it with source-faithful wording plus the named figure/diagram label and plan a visible crop for those options before bounded scoring or publish",
    );
  }
  if (SOURCE_TRANSCRIPTION_FORMULA_SUMMARY_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/transcription.md summarizes a displayed formula/equation as prose; replace it with the printed displayed formula in Markdown/LaTeX or plan a visible crop before bounded scoring or publish",
    );
  }
  if (SYNTHETIC_SOURCE_WORKFLOW_PHRASE_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/transcription.md contains workflow or source-summary wording such as planned crop paths or invented figure/table bridge text; replace it with only the printed source wording, labels, tables, formulas, and minimal layout notes",
    );
  }
  if (SYNTHETIC_WORKSHEET_BRIDGE_PHRASE_PATTERN.test(markdown)) {
    issues.push(
      "grader/output/transcription.md contains invented worksheet bridge wording such as items shown in the source paper; replace it with the printed source wording plus the named figure/table/formula label and a minimal layout note",
    );
  }
  issues.push(
    ...collectSourceTranscriptionStemDriftIssues({
      sourceTranscriptMarkdown: markdown,
      sourceReferenceMarkdown,
    }),
  );

  return issues;
}

function metadataTextContains(container: string, part: string): boolean {
  const normalizedContainer = normalizeMetadataText(container);
  const normalizedPart = normalizeMetadataText(part);
  return (
    normalizedPart.length >= 8 &&
    normalizedContainer.length > normalizedPart.length &&
    normalizedContainer.includes(normalizedPart)
  );
}

function collectGraderWorksheetEarlyAssemblyIssues(
  report: SparkGraderWorksheetReport,
): string[] {
  const issues: string[] = [];
  const readVisibleQuestionPromptText = (
    entry: PaperSheetQuestionEntry,
  ): string | undefined => {
    switch (entry.type) {
      case "group":
      case "fill":
      case "mcq":
      case "lines":
      case "calc":
      case "match":
      case "spelling":
      case "flow":
        return entry.prompt;
      case "cloze":
      case "answer_bank":
        return entry.segments.join(" ");
    }
  };
  const checkVisiblePromptText = (
    ownerLabel: string,
    text: string | undefined,
  ): void => {
    if (typeof text !== "string" || text.trim().length === 0) {
      return;
    }
    if (
      SYNTHETIC_SOURCE_WORKFLOW_PHRASE_PATTERN.test(text) ||
      SYNTHETIC_WORKSHEET_BRIDGE_PHRASE_PATTERN.test(text)
    ) {
      issues.push(
        `${ownerLabel} contains workflow or paraphrase wording such as source-paper placeholders, planned crop paths, or invented figure/table bridge text; copy the printed source wording and put the final crop/Markdown table directly at the source item`,
      );
    }
  };
  const visitQuestionEntries = (
    entries: readonly PaperSheetQuestionEntry[] | undefined,
    ancestorPromptText = "",
  ): void => {
    for (const entry of entries ?? []) {
      const promptText = readVisibleQuestionPromptText(entry);
      checkVisiblePromptText(`question "${entry.id}" prompt`, promptText);
      const promptContext = [ancestorPromptText, promptText]
        .filter((part): part is string => typeof part === "string")
        .join("\n\n");
      if (
        typeof promptText === "string" &&
        promptNeedsVisibleImage(promptContext)
      ) {
        issues.push(
          `question "${entry.id}" references a visual but does not link a visible worksheet crop in its prompt or an enclosing group prompt; create and link the planned grader/output/assets/... crop before writing run-summary.json`,
        );
      }
      if (
        typeof promptText === "string" &&
        promptNeedsVisibleTable(promptContext)
      ) {
        issues.push(
          `question "${entry.id}" references a source table but does not include a visible Markdown table or linked crop in its prompt or an enclosing group prompt; render the source table before writing run-summary.json`,
        );
      }
      if (
        entry.badgeLabel !== undefined &&
        badgeLabelLooksLikeFullSourceNumber(entry.badgeLabel)
      ) {
        issues.push(
          `question "${entry.id}" uses badgeLabel "${entry.badgeLabel}" as a full source label; set displayNumber to the full source label and badgeLabel to only the short visible circle text`,
        );
      }
      if (entry.type === "group") {
        visitQuestionEntries(entry.questions, promptContext);
      }
    }
  };

  for (const section of report.sheet.sections) {
    if (!("id" in section)) {
      checkVisiblePromptText("text section", section.text);
      continue;
    }
    for (const [fieldName, fieldValue] of [
      ["theory", section.theory],
      ["infoBox", section.infoBox?.text],
    ] as const) {
      checkVisiblePromptText(`section "${section.id}" ${fieldName}`, fieldValue);
      if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
        continue;
      }
      if (
        MARKDOWN_IMAGE_PATTERN.test(fieldValue) ||
        collectNamedReferences(fieldValue, NAMED_FIGURE_REFERENCE_PATTERN)
          .size > 0 ||
        collectNamedReferences(fieldValue, NAMED_TABLE_REFERENCE_PATTERN).size >
          0
      ) {
        issues.push(
          `section "${section.id}" ${fieldName} contains a named figure/table or linked crop; move the exact source wording plus crop/table into the relevant group or question prompt before writing run-summary.json`,
        );
      }
    }
    visitQuestionEntries(section.questions);
  }

  return issues;
}

function hasReferenceLabel(
  text: string,
  kind: "Figure" | "Table",
  label: string,
): boolean {
  const escapedLabel = escapeRegExpLiteral(label);
  const kindPattern =
    kind === "Figure" ? String.raw`(?:Figure|Fig\.?|Diagram)` : "Table";
  const pattern = new RegExp(`\\b${kindPattern}\\s+${escapedLabel}\\b`, "iu");
  return pattern.test(text);
}

function markdownImageReferencesLabel(
  altText: string,
  target: string,
  kind: "Figure" | "Table",
  label: string,
): boolean {
  const escapedLabel = escapeRegExpLiteral(label).replace(
    /\\\./gu,
    String.raw`[._\-\s]*`,
  );
  const kindPattern =
    kind === "Figure" ? String.raw`(?:figure|fig|diagram)` : "table";
  const explicitLabelPattern = new RegExp(
    `\\b${kindPattern}[._\\-\\s]*${escapedLabel}\\b`,
    "iu",
  );
  return explicitLabelPattern.test(altText) || explicitLabelPattern.test(target);
}

function hasNearbyMarkdownImage(
  text: string,
  kind: "Figure" | "Table",
  label: string,
): boolean {
  const escapedLabel = escapeRegExpLiteral(label);
  const kindPattern =
    kind === "Figure" ? String.raw`(?:Figure|Fig\.?|Diagram)` : "Table";
  const labelPattern = new RegExp(
    `\\b${kindPattern}\\s+${escapedLabel}\\b`,
    "giu",
  );
  for (const match of text.matchAll(labelPattern)) {
    const index = match.index ?? 0;
    const nearby = text.slice(Math.max(0, index - 250), index + 700);
    for (const imageMatch of nearby.matchAll(MARKDOWN_IMAGE_OCCURRENCE_PATTERN)) {
      const altText = imageMatch[1] ?? "";
      const target = imageMatch[2] ?? "";
      if (markdownImageReferencesLabel(altText, target, kind, label)) {
        return true;
      }
    }
  }
  return false;
}

function hasNearbySourcePdfVisualReference(
  text: string,
  kind: "Figure" | "Table",
  label: string,
): boolean {
  if (kind !== "Figure") {
    return false;
  }
  const escapedLabel = escapeRegExpLiteral(label);
  const labelPattern = new RegExp(
    `\\b(?:Figure|Fig\\.?|Diagram)\\s+${escapedLabel}\\b`,
    "giu",
  );
  for (const match of text.matchAll(labelPattern)) {
    const index = match.index ?? 0;
    const nearby = text.slice(Math.max(0, index - 250), index + 700);
    if (SOURCE_PDF_VISUAL_REFERENCE_PATTERN.test(nearby)) {
      return true;
    }
  }
  return false;
}

function hasNearbyMarkdownTable(text: string, label: string): boolean {
  const escapedLabel = escapeRegExpLiteral(label);
  const labelPattern = new RegExp(`\\bTable\\s+${escapedLabel}\\b`, "giu");
  for (const match of text.matchAll(labelPattern)) {
    const index = match.index ?? 0;
    const nearby = text.slice(index, index + 1600);
    if (MARKDOWN_TABLE_PATTERN.test(nearby)) {
      return true;
    }
  }
  return false;
}

function hasNearbyTableImageWithoutMarkdown(
  text: string,
  label: string,
): boolean {
  if (hasNearbyMarkdownTable(text, label)) {
    return false;
  }
  const escapedLabel = escapeRegExpLiteral(label);
  const labelPattern = new RegExp(`\\bTable\\s+${escapedLabel}\\b`, "giu");
  for (const match of text.matchAll(labelPattern)) {
    const index = match.index ?? 0;
    const imageNearby = text.slice(index, index + 700);
    if (!MARKDOWN_IMAGE_PATTERN.test(imageNearby)) {
      continue;
    }
    const tableNearby = text.slice(index, index + 1600);
    if (!MARKDOWN_TABLE_PATTERN.test(tableNearby)) {
      return true;
    }
  }
  return false;
}

function collectSpecificSourceReferenceOwners(
  sourceText: string,
  pattern: RegExp,
): Map<string, Set<string>> {
  const ownersByLabel = new Map<string, Set<string>>();
  const blocks = sourceText
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

  for (const block of blocks) {
    const ownerMatch =
      /(?:^|\n)\s*(?:[-*]\s*)?(?:\*\*)?`?(0?\d+(?:\.\d+|\([^)]+\)))`?(?:\*\*)?\b/u.exec(
        block,
      );
    const owner = normalizeDisplayNumberForComparison(ownerMatch?.[1]);
    if (!owner) {
      continue;
    }
    for (const match of block.matchAll(pattern)) {
      const label = match[1]?.trim().toLowerCase();
      if (!label) {
        continue;
      }
      const owners = ownersByLabel.get(label) ?? new Set<string>();
      owners.add(owner);
      ownersByLabel.set(label, owners);
    }
  }

  return ownersByLabel;
}

function questionDisplayNumberMatchesOwner(
  question: { displayNumber?: string },
  owner: string,
): boolean {
  return normalizeDisplayNumberForComparison(question.displayNumber) === owner;
}

function containsStandaloneOptionLabelList(promptText: string): boolean {
  let standaloneLabelLines = 0;
  for (const rawLine of promptText.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    if (STANDALONE_OPTION_LABEL_LINE_PATTERN.test(line)) {
      standaloneLabelLines += 1;
    }
  }
  return standaloneLabelLines >= 2;
}

function promptNeedsVisibleImage(promptText: string): boolean {
  if (!VISUAL_CONTEXT_PROMPT_PATTERN.test(promptText)) {
    return false;
  }
  if (ANCHORED_VISUAL_REFERENCE_PATTERN.test(promptText)) {
    return false;
  }
  return !MARKDOWN_IMAGE_PATTERN.test(promptText);
}

function promptHasVisibleSourceTable(promptText: string): boolean {
  return (
    MARKDOWN_TABLE_PATTERN.test(promptText) ||
    MARKDOWN_IMAGE_PATTERN.test(promptText)
  );
}

function promptNeedsVisibleTable(promptText: string): boolean {
  const referencesNamedTable =
    collectNamedReferences(promptText, NAMED_TABLE_REFERENCE_PATTERN).size > 0;
  if (
    !referencesNamedTable &&
    !TABLE_PROMPT_WITHOUT_TABLE_PATTERN.test(promptText)
  ) {
    return false;
  }
  if (ANCHORED_TABLE_REFERENCE_PATTERN.test(promptText)) {
    return false;
  }
  return !promptHasVisibleSourceTable(promptText);
}

function promptHasColumnOrStackedLayout(promptText: string): boolean {
  const hasRenderableLatexLayout =
    /\\\[[\s\S]*?(?:\\begin\{(?:array|aligned|matrix|pmatrix|bmatrix)\b|\\\\|\\hline)[\s\S]*?\\\]/iu.test(
      promptText,
    ) && !hasMalformedLatexLayoutRowBreak(promptText);
  return (
    MARKDOWN_IMAGE_PATTERN.test(promptText) ||
    hasRenderableLatexLayout ||
    /(?:^|\n)\s*[+−-]\s*[01](?:\s+[01]){3,}/u.test(promptText)
  );
}

function collectScoreFractionMismatchIssues(options: {
  fieldName: string;
  text: string | undefined;
  expectedGot: number;
  expectedTotal: number;
}): string[] {
  const text = options.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return [];
  }
  const issues: string[] = [];
  for (const match of text.matchAll(SCORE_FRACTION_PATTERN)) {
    const got = Number(match[1]);
    const total = Number(match[2]);
    if (!Number.isFinite(got) || !Number.isFinite(total)) {
      continue;
    }
    if (got === options.expectedGot && total === options.expectedTotal) {
      continue;
    }
    issues.push(
      `${options.fieldName} says ${got.toString()}/${total.toString()} but worksheet score is ${options.expectedGot.toString()}/${options.expectedTotal.toString()}; keep all visible score text synchronized with review.score`,
    );
  }
  return issues;
}

function hasMalformedLatexLayoutRowBreak(text: string): boolean {
  for (const match of text.matchAll(/\\\[[\s\S]*?\\\]/gu)) {
    const block = match[0];
    if (!LATEX_LAYOUT_ENVIRONMENT_PATTERN.test(block)) {
      continue;
    }
    for (const line of block.split(/\r?\n/u)) {
      const trimmed = line.trimEnd();
      if (trimmed.endsWith("\\") && !trimmed.endsWith("\\\\")) {
        return true;
      }
    }
  }
  return false;
}

function formatArtifactAnchorFragment(
  kind: "figure" | "table",
  label: string,
): string {
  const normalizedLabel = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return `#${kind}-${normalizedLabel}`;
}

function collectRepeatedCropImageIssues(markdown: string): string[] {
  const issues: string[] = [];
  const firstByTarget = new Map<string, string>();
  const firstByArtifactLabel = new Map<
    string,
    { target: string; label: string }
  >();
  const extractArtifactLabel = (
    text: string,
  ): {
    key: string;
    label: string;
    anchor: string;
  } | null => {
    const figure = Array.from(text.matchAll(NAMED_FIGURE_REFERENCE_PATTERN)).at(
      -1,
    )?.[1];
    if (figure) {
      return {
        key: `figure:${figure.toLowerCase()}`,
        label: `Figure ${figure}`,
        anchor: `[Figure ${figure}](${formatArtifactAnchorFragment("figure", figure)})`,
      };
    }
    const table = Array.from(text.matchAll(NAMED_TABLE_REFERENCE_PATTERN)).at(
      -1,
    )?.[1];
    if (table) {
      return {
        key: `table:${table.toLowerCase()}`,
        label: `Table ${table}`,
        anchor: `[Table ${table}](${formatArtifactAnchorFragment("table", table)})`,
      };
    }
    return null;
  };

  for (const match of markdown.matchAll(MARKDOWN_IMAGE_OCCURRENCE_PATTERN)) {
    const rawAlt = match[1]?.trim() ?? "";
    const target = match[2]?.trim();
    if (!target) {
      continue;
    }
    const normalizedTarget = target.replace(/\\/gu, "/").replace(/^\/+/u, "");
    if (!WORKSHEET_CROP_ASSET_PATH_PATTERN.test(normalizedTarget)) {
      continue;
    }
    const occurrenceIndex = match.index ?? 0;
    const contextBefore = markdown.slice(
      Math.max(0, occurrenceIndex - 220),
      occurrenceIndex,
    );
    const artifactLabel =
      extractArtifactLabel(rawAlt) ?? extractArtifactLabel(contextBefore);
    if (artifactLabel !== null) {
      const first = firstByArtifactLabel.get(artifactLabel.key);
      if (first === undefined) {
        firstByArtifactLabel.set(artifactLabel.key, {
          target: normalizedTarget,
          label: artifactLabel.label,
        });
      } else {
        issues.push(
          `worksheet links ${artifactLabel.label} more than once (${first.target} and ${normalizedTarget}); render each named figure/table crop once at the first source-faithful location and use ${artifactLabel.anchor} or "above" references later`,
        );
      }
    }
    const firstAlt = firstByTarget.get(normalizedTarget);
    if (firstAlt === undefined) {
      firstByTarget.set(normalizedTarget, rawAlt);
      continue;
    }
    const label = rawAlt || firstAlt || normalizedTarget;
    const anchorSuggestion = (() => {
      const figure =
        /\b(?:Figure|Fig\.?|Diagram)\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/iu.exec(
          label,
        )?.[1];
      if (figure) {
        return `[Figure ${figure}](${formatArtifactAnchorFragment("figure", figure)})`;
      }
      const table = /\bTable\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/iu.exec(label)?.[1];
      if (table) {
        return `[Table ${table}](${formatArtifactAnchorFragment("table", table)})`;
      }
      return "a Markdown link to the first figure/table anchor";
    })();
    issues.push(
      `worksheet repeats linked crop image "${normalizedTarget}" for "${label}"; render each figure/table image once at the first source-faithful location and use ${anchorSuggestion} or "above" references in later subquestions`,
    );
  }
  return issues;
}

function collectFigureImageOrderingIssues(promptText: string): string[] {
  const issues: string[] = [];
  for (const match of promptText.matchAll(NAMED_FIGURE_REFERENCE_PATTERN)) {
    const label = match[1]?.trim();
    if (!label) {
      continue;
    }
    const figureIndex = match.index ?? 0;
    const afterFigureLabel = promptText.slice(figureIndex);
    const imageMatch = MARKDOWN_IMAGE_PATTERN.exec(afterFigureLabel);
    if (!imageMatch) {
      continue;
    }
    const textBeforeImage = afterFigureLabel.slice(0, imageMatch.index ?? 0);
    const figureLabelsBeforeImage = Array.from(
      textBeforeImage.matchAll(NAMED_FIGURE_REFERENCE_PATTERN),
    ).filter((candidate) => candidate[1]?.trim() === label);
    const nearestFigureLabel = figureLabelsBeforeImage.at(-1);
    const textSinceNearestFigureLabel =
      nearestFigureLabel !== undefined
        ? textBeforeImage.slice(
            (nearestFigureLabel.index ?? 0) + nearestFigureLabel[0].length,
          )
        : textBeforeImage;
    const interveningTable = /\bTable\s+(\d+(?:\.\d+)*[A-Za-z]?)\b/iu.exec(
      textSinceNearestFigureLabel,
    );
    if (!interveningTable?.[1]) {
      continue;
    }
    issues.push(
      `Figure ${label} label/caption is separated from its image by Table ${interveningTable[1]}; keep each figure label/caption immediately adjacent to its crop, then place each table label immediately adjacent to its Markdown table`,
    );
  }
  return issues;
}

function sourceReferenceHasMarkdownTable(
  sourceText: string,
  label: string,
): boolean {
  const escapedLabel = escapeRegExpLiteral(label);
  const labelPattern = new RegExp(`\\bTable\\s+${escapedLabel}\\b`, "giu");
  for (const match of sourceText.matchAll(labelPattern)) {
    const index = match.index ?? 0;
    const nearby = sourceText.slice(index, index + 2000);
    if (MARKDOWN_TABLE_PATTERN.test(nearby)) {
      return true;
    }
  }
  return false;
}

function hasExplicitPositiveCropValidationRecord(record: string): boolean {
  const lines = record
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return (
    lines.some((line) =>
      CROP_VALIDATION_PASS_FAIL_PASS_FIELD_PATTERN.test(line),
    ) &&
    lines.some((line) =>
      CROP_VALIDATION_VISIBLE_CONTENT_YES_FIELD_PATTERN.test(line),
    ) &&
    CROP_VALIDATION_VISIBLE_TEXT_PATTERN.test(record)
  );
}

function hasPositiveCropValidationReport(markdown: string): boolean {
  const records = markdown
    .split(/\n\s*\n/gu)
    .map((record) => record.trim())
    .filter((record) => record.length > 0);
  return records.some(
    (record) =>
      CROP_VALIDATION_SUBAGENT_PATTERN.test(record) &&
      (hasExplicitPositiveCropValidationRecord(record) ||
        isBenignDuplicateOnlyFailedCropValidationRecord(record)),
  );
}

function hasPositiveSourceFidelityAudit(markdown: string): boolean {
  if (!SOURCE_FIDELITY_SUBAGENT_CHECK_PATTERN.test(markdown)) {
    return false;
  }
  if (!SOURCE_FIDELITY_PASS_PATTERN.test(markdown)) {
    return false;
  }
  if (SOURCE_FIDELITY_BLOCKING_PATTERN.test(markdown)) {
    return false;
  }
  const blockingIssuesMatches = Array.from(
    markdown.matchAll(SOURCE_FIDELITY_BLOCKING_ISSUES_FIELD_PATTERN),
  );
  if (blockingIssuesMatches.length === 0) {
    return false;
  }
  return blockingIssuesMatches.every((match) =>
    SOURCE_FIDELITY_NO_BLOCKING_ISSUES_PATTERN.test(match[1]?.trim() ?? ""),
  );
}

function isBenignDuplicateOnlyFailedCropValidationRecord(
  record: string,
): boolean {
  const lines = record
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!CROP_VALIDATION_ASSET_SUBAGENT_CHECK_PATTERN.test(record)) {
    return false;
  }
  if (!CROP_VALIDATION_VISIBLE_TEXT_PATTERN.test(record)) {
    return false;
  }
  if (
    !lines.some((line) =>
      CROP_VALIDATION_PASS_FAIL_FAIL_FIELD_PATTERN.test(line),
    )
  ) {
    return false;
  }
  if (
    !lines.some((line) =>
      CROP_VALIDATION_VISIBLE_CONTENT_YES_FIELD_PATTERN.test(line),
    )
  ) {
    return false;
  }
  if (
    !lines.some((line) =>
      CROP_VALIDATION_DUPLICATE_NOT_EXCLUDED_FIELD_PATTERN.test(line),
    )
  ) {
    return false;
  }

  for (const line of lines) {
    if (CROP_VALIDATION_PASS_FAIL_FAIL_FIELD_PATTERN.test(line)) {
      continue;
    }
    if (CROP_VALIDATION_VISIBLE_CONTENT_YES_FIELD_PATTERN.test(line)) {
      continue;
    }
    if (CROP_VALIDATION_DUPLICATE_NOT_EXCLUDED_FIELD_PATTERN.test(line)) {
      continue;
    }
    if (CROP_VALIDATION_HISTORY_FIELD_PATTERN.test(line)) {
      continue;
    }
    if (CROP_VALIDATION_NEGATED_RISK_FIELD_PATTERN.test(line)) {
      continue;
    }
    if (CROP_VALIDATION_POSITIVE_RISK_FIELD_PATTERN.test(line)) {
      return false;
    }
    if (CROP_VALIDATION_NEGATIVE_FIELD_PATTERN.test(line)) {
      return false;
    }
    if (
      CROP_VALIDATION_UNRESOLVED_PATTERN.test(line) &&
      !CROP_VALIDATION_RESOLVED_PATTERN.test(line)
    ) {
      return false;
    }
  }
  return true;
}

function exposesAnswerKeyReference(text: string): boolean {
  const withoutNegatedReferences = text
    .replace(
      /\b(?:no|not\s+an?|without)\s+(?:answer\s+key|official\s+solution|solution\s+baseline|solutions?)\b/giu,
      "no-answer-material",
    )
    .replace(
      /\b(?:answer\s+key|official\s+solution|solution\s+baseline|solutions?)\s+(?:is|are)\s+(?:not\s+)?(?:included|provided|available|uploaded)\b/giu,
      "no-answer-material",
    )
    .replace(
      /\b(?:do\s+not|don't)\s+(?:include|expose|show|build|provide)\s+(?:an?\s+)?(?:answer\s+key|official\s+solution|solution\s+baseline|solutions?)\b/giu,
      "no-answer-material",
    );
  return ANSWER_KEY_REFERENCE_PATTERN.test(withoutNegatedReferences);
}

function isSourcePaperOnlyNoStudentRequest(
  requestPayload: SparkGraderRequestPayload | null | undefined,
): boolean {
  if (!requestPayload) {
    return false;
  }
  if (
    requestPayload.sourcePaperOnlyNoStudent === true ||
    requestPayload.input.sourcePaperOnlyNoStudent === true
  ) {
    return true;
  }
  const requestText = [
    requestPayload.sourceText,
    requestPayload.input.title,
    requestPayload.input.notes,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return NO_STUDENT_ANSWERS_REQUEST_PATTERN.test(requestText);
}

function isCompactHandwrittenGradingRequest(
  requestPayload: SparkGraderRequestPayload | null | undefined,
): boolean {
  if (!requestPayload || isSourcePaperOnlyNoStudentRequest(requestPayload)) {
    return false;
  }
  const hasImageSubmission = requestPayload.attachments.some((attachment) =>
    attachment.contentType.toLowerCase().startsWith("image/"),
  );
  if (!hasImageSubmission) {
    return false;
  }
  const hasPdfContext = requestPayload.attachments.some(
    (attachment) => attachment.contentType.toLowerCase() === "application/pdf",
  );
  const requestText = [
    requestPayload.sourceText,
    requestPayload.input.title,
    requestPayload.input.notes,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return (
    hasPdfContext ||
    /\b(?:grade|mark|graded|scored|student\s+submission|handwritten|notebook|answer\s+booklet|uploaded\s+work|maintenance\s+rerun)\b/iu.test(
      requestText,
    )
  );
}

function requestRequiresProblemStatementTranscription(
  requestPayload: SparkGraderRequestPayload | null | undefined,
): boolean {
  if (!requestPayload) {
    return false;
  }
  const requestText = [
    requestPayload.sourceText,
    requestPayload.input.title,
    requestPayload.input.notes,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return QUESTION_STRUCTURE_REQUEST_PATTERN.test(requestText);
}

function isBlankWorksheetAnswer(
  answer: SparkGraderWorksheetReport["answers"][string] | undefined,
): boolean {
  if (answer === undefined) {
    return false;
  }
  if (typeof answer === "string") {
    return answer.trim().length === 0;
  }
  return Object.values(answer).every((value) => value.trim().length === 0);
}

function collectObjectiveOptionLabels(promptText: string): number {
  return (
    promptText.match(new RegExp(OBJECTIVE_OPTION_LABEL_PATTERN, "gu"))
      ?.length ?? 0
  );
}

function objectiveQuestionHasFakeBlankOption(question: {
  options: readonly { id: string; text: string; label?: string }[];
}): boolean {
  return question.options.some((option) => {
    return (
      FAKE_BLANK_OBJECTIVE_OPTION_PATTERN.test(option.id.trim()) ||
      FAKE_BLANK_OBJECTIVE_OPTION_PATTERN.test(option.label?.trim() ?? "") ||
      FAKE_BLANK_OBJECTIVE_OPTION_PATTERN.test(option.text.trim()) ||
      FAKE_OBJECTIVE_OPTION_TEXT_PATTERN.test(option.label?.trim() ?? "") ||
      FAKE_OBJECTIVE_OPTION_TEXT_PATTERN.test(option.text.trim())
    );
  });
}

function normalizeReviewFeedbackText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function reviewFeedbackRepeatsObjectiveOptionText(
  question: PaperSheetQuestion,
  reviewFeedbackText: string,
): boolean {
  if (question.type !== "mcq" && question.type !== "answer_bank") {
    return false;
  }
  const normalizedFeedback = normalizeReviewFeedbackText(reviewFeedbackText);
  if (normalizedFeedback.length === 0) {
    return false;
  }
  for (const option of question.options) {
    const normalizedOption = normalizeReviewFeedbackText(option.text);
    if (
      normalizedOption.length >= 8 &&
      normalizedFeedback.includes(normalizedOption)
    ) {
      return true;
    }
  }
  return false;
}

function mcqPromptRepeatsStructuredOptionText(
  question: PaperSheetQuestion,
): boolean {
  if (question.type !== "mcq" || question.displayMode === "labels_only") {
    return false;
  }
  const normalizedPrompt = normalizeReviewFeedbackText(
    question.prompt.replace(MARKDOWN_IMAGE_TARGET_PATTERN, " "),
  );
  if (normalizedPrompt.length === 0) {
    return false;
  }
  for (const option of question.options) {
    const normalizedOption = normalizeReviewFeedbackText(option.text);
    if (
      normalizedOption.length >= 8 &&
      normalizedPrompt.includes(normalizedOption)
    ) {
      return true;
    }
  }
  return false;
}

function isStubGroupPrompt(
  promptText: string,
  displayNumber: string | undefined,
): boolean {
  const withoutImages = promptText
    .replace(MARKDOWN_IMAGE_TARGET_PATTERN, "")
    .replace(/\|[^\n]*\|/gu, "")
    .replace(/[#*_`>~-]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (withoutImages.length === 0) {
    return true;
  }
  const displayRoot = displayNumber
    ? normalizeDisplayNumberRoot(displayNumber)
    : null;
  const genericQuestionPattern =
    displayRoot !== null
      ? new RegExp(
          `^(?:question|q)\\s*0?${escapeRegExpLiteral(displayRoot)}\\.?$`,
          "iu",
        )
      : /^(?:question|q)\s*\d+\.?$/iu;
  return (
    genericQuestionPattern.test(withoutImages) ||
    /^shared\s+(?:context|stem)$/iu.test(withoutImages) ||
    /^source\s+(?:context|stem)$/iu.test(withoutImages)
  );
}

function collectSheetMarkdown(report: SparkGraderWorksheetReport): string {
  const parts: string[] = [];

  for (const section of report.sheet.sections) {
    if (!("id" in section)) {
      parts.push(section.text);
      continue;
    }

    if (section.theory) {
      parts.push(section.theory);
    }
    if (section.infoBox) {
      parts.push(section.infoBox.text);
    }

    for (const entry of section.questions ?? []) {
      if (entry.type === "group") {
        parts.push(entry.prompt);
        for (const question of entry.questions) {
          switch (question.type) {
            case "fill":
              parts.push(question.prompt, question.after);
              if (question.conjunction) {
                parts.push(question.conjunction);
              }
              break;
            case "mcq":
            case "lines":
            case "spelling":
              parts.push(question.prompt);
              if (question.type === "mcq") {
                for (const option of question.options) {
                  parts.push(option.text);
                }
              } else if (question.type === "spelling") {
                for (const word of question.words) {
                  parts.push(word.wrong);
                }
              }
              break;
            case "calc":
              parts.push(question.prompt, question.inputLabel, question.unit);
              if (question.hint) {
                parts.push(question.hint);
              }
              break;
            case "match":
              parts.push(question.prompt);
              for (const pair of question.pairs) {
                parts.push(pair.term, pair.match);
              }
              break;
            case "cloze":
              parts.push(...question.segments);
              if (question.wordBank) {
                parts.push(...question.wordBank);
              }
              break;
            case "answer_bank":
              parts.push(...question.segments);
              for (const option of question.options) {
                parts.push(option.text);
              }
              break;
            case "flow":
              parts.push(question.prompt);
              for (const row of question.rows) {
                for (const item of row.items) {
                  if (item.type === "operation") {
                    parts.push(item.label);
                  }
                }
              }
              for (const connector of question.connectors ?? []) {
                parts.push(connector.label);
              }
              break;
          }
        }
        continue;
      }

      switch (entry.type) {
        case "fill":
          parts.push(entry.prompt, entry.after);
          if (entry.conjunction) {
            parts.push(entry.conjunction);
          }
          break;
        case "mcq":
        case "lines":
        case "spelling":
          parts.push(entry.prompt);
          if (entry.type === "mcq") {
            for (const option of entry.options) {
              parts.push(option.text);
            }
          } else if (entry.type === "spelling") {
            for (const word of entry.words) {
              parts.push(word.wrong);
            }
          }
          break;
        case "calc":
          parts.push(entry.prompt, entry.inputLabel, entry.unit);
          if (entry.hint) {
            parts.push(entry.hint);
          }
          break;
        case "match":
          parts.push(entry.prompt);
          for (const pair of entry.pairs) {
            parts.push(pair.term, pair.match);
          }
          break;
        case "cloze":
          parts.push(...entry.segments);
          if (entry.wordBank) {
            parts.push(...entry.wordBank);
          }
          break;
        case "answer_bank":
          parts.push(...entry.segments);
          for (const option of entry.options) {
            parts.push(option.text);
          }
          break;
        case "flow":
          parts.push(entry.prompt);
          for (const row of entry.rows) {
            for (const item of row.items) {
              if (item.type === "operation") {
                parts.push(item.label);
              }
            }
          }
          for (const connector of entry.connectors ?? []) {
            parts.push(connector.label);
          }
          break;
      }
    }
  }

  return parts.join("\n\n");
}

function collectMarkdownImageTargets(markdown: string): string[] {
  const paths = new Set<string>();
  for (const match of markdown.matchAll(MARKDOWN_IMAGE_TARGET_PATTERN)) {
    const target = match[1]?.trim();
    if (!target) {
      continue;
    }
    const normalized = target.replace(/\\/gu, "/").replace(/^\/+/u, "");
    paths.add(normalized);
  }
  return [...paths].sort();
}

function collectLinkedCropAssetPaths(markdown: string): string[] {
  return collectMarkdownImageTargets(markdown).filter((target) =>
    WORKSHEET_CROP_ASSET_PATH_PATTERN.test(target),
  );
}

function isJpegWorksheetAssetPath(assetPath: string): boolean {
  return /\.jpe?g$/iu.test(assetPath);
}

function resolveWorksheetJpegAssetPath(assetPath: string): string {
  return assetPath.replace(/\.[^/.]+$/u, ".jpg");
}

function resolveEquivalentCropReviewPaths(assetPath: string): string[] {
  const jpgPath = resolveWorksheetJpegAssetPath(assetPath);
  const extensionCandidates = [".jpg", ".jpeg", ".png", ".webp"];
  const basePath = jpgPath.replace(/\.jpg$/iu, "");
  return [
    ...new Set([
      assetPath,
      ...extensionCandidates.map((ext) => `${basePath}${ext}`),
    ]),
  ];
}

function replaceStringReferences(
  value: string,
  replacements: ReadonlyMap<string, string>,
): string {
  let next = value;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }
  return next;
}

function replaceJsonStringReferences(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") {
    return replaceStringReferences(value, replacements);
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      replaceJsonStringReferences(entry, replacements),
    );
  }
  if (value !== null && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      next[key] = replaceJsonStringReferences(entry, replacements);
    }
    return next;
  }
  return value;
}

function parseAgentLogImageEditEvents(agentLogMarkdown: string): Array<{
  timestampMs: number | null;
  toolName: "crop_image" | "trim_image" | "pad_image";
  sourcePath: string | null;
  outputPath: string;
}> {
  const events: Array<{
    timestampMs: number | null;
    toolName: "crop_image" | "trim_image" | "pad_image";
    sourcePath: string | null;
    outputPath: string;
  }> = [];
  let pending: {
    timestampMs: number | null;
    toolName: "crop_image" | "trim_image" | "pad_image";
  } | null = null;

  for (const rawLine of agentLogMarkdown.split(/\r?\n/gu)) {
    const startedMatch = AGENT_LOG_IMAGE_EDIT_STARTED_PATTERN.exec(rawLine);
    if (startedMatch?.groups) {
      const timestamp = Date.parse(startedMatch.groups.timestamp ?? "");
      const toolName = startedMatch.groups.tool;
      switch (toolName) {
        case "crop_image":
        case "trim_image":
        case "pad_image":
          pending = {
            timestampMs: Number.isFinite(timestamp) ? timestamp : null,
            toolName,
          };
          break;
      }
      continue;
    }

    const inputIndex = rawLine.indexOf(AGENT_LOG_TOOL_INPUT_PREFIX);
    if (inputIndex === -1 || pending === null) {
      continue;
    }
    const jsonText = rawLine
      .slice(inputIndex + AGENT_LOG_TOOL_INPUT_PREFIX.length)
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      pending = null;
      continue;
    }
    const outputPath =
      parsed !== null &&
      typeof parsed === "object" &&
      "outputPath" in parsed &&
      typeof parsed.outputPath === "string"
        ? parsed.outputPath.replace(/\\/gu, "/").replace(/^\/+/u, "")
        : null;
    if (outputPath) {
      const sourcePath =
        parsed !== null &&
        typeof parsed === "object" &&
        "sourcePath" in parsed &&
        typeof parsed.sourcePath === "string"
          ? parsed.sourcePath.replace(/\\/gu, "/").replace(/^\/+/u, "")
          : null;
      events.push({
        timestampMs: pending.timestampMs,
        toolName: pending.toolName,
        sourcePath,
        outputPath,
      });
    }
    pending = null;
  }

  return events;
}

async function readAgentToolCallLogMarkdown(rootDir: string): Promise<string> {
  const callsRoot = resolveWorkspacePath(rootDir, "logs/agent/llm_calls");
  const lines: string[] = [];

  async function visit(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile() || entry.name !== "tool_call.txt") {
        continue;
      }
      const stepDir = path.basename(path.dirname(path.dirname(entryPath)));
      const timestamp =
        /^(?<timestamp>\d{4}-\d{2}-\d{2}T.*Z)-\d+$/u.exec(stepDir)?.groups
          ?.timestamp ?? new Date(0).toISOString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(entryPath, { encoding: "utf8" }));
      } catch {
        continue;
      }
      const calls = Array.isArray(parsed) ? parsed : [];
      for (const call of calls) {
        if (
          call === null ||
          typeof call !== "object" ||
          !("name" in call) ||
          typeof call.name !== "string"
        ) {
          continue;
        }
        const args =
          "arguments" in call &&
          call.arguments !== null &&
          typeof call.arguments === "object"
            ? call.arguments
            : {};
        lines.push(
          `${timestamp} [agent:tool-log] tool_call_started: tool=${call.name}`,
        );
        lines.push(
          `${timestamp} [agent:tool-log] ${AGENT_LOG_TOOL_INPUT_PREFIX}${JSON.stringify(args)}`,
        );
      }
    }
  }

  await visit(callsRoot);
  return lines.join("\n");
}

function collectFreshCropReviewToolCallPaths(
  agentLogMarkdown: string,
): Set<string> {
  const paths = new Set<string>();
  let pendingFreshCropReview = false;

  for (const rawLine of agentLogMarkdown.split(/\r?\n/gu)) {
    if (FRESH_CROP_REVIEW_TOOL_PATTERN.test(rawLine)) {
      pendingFreshCropReview = true;
      continue;
    }

    const inputIndex = rawLine.indexOf(AGENT_LOG_TOOL_INPUT_PREFIX);
    if (inputIndex === -1) {
      continue;
    }
    if (!pendingFreshCropReview) {
      continue;
    }
    pendingFreshCropReview = false;

    const jsonText = rawLine
      .slice(inputIndex + AGENT_LOG_TOOL_INPUT_PREFIX.length)
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      continue;
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "cropPath" in parsed &&
      typeof parsed.cropPath === "string"
    ) {
      paths.add(parsed.cropPath.replace(/\\/gu, "/").replace(/^\/+/u, ""));
    }
  }

  return paths;
}

function collectCropValidationAssetIssues(options: {
  renderedSheetMarkdown: string;
  cropValidationMarkdown: string;
  agentLogMarkdown: string;
}): string[] {
  const issues: string[] = [];
  const assetPaths = collectLinkedCropAssetPaths(options.renderedSheetMarkdown);
  if (assetPaths.length === 0) {
    return issues;
  }
  const freshReviewPaths = collectFreshCropReviewToolCallPaths(
    options.agentLogMarkdown,
  );
  const imageEditEvents = parseAgentLogImageEditEvents(
    options.agentLogMarkdown,
  );

  const validationLines = options.cropValidationMarkdown
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const validationBlocks = options.cropValidationMarkdown
    .split(/\n\s*\n/gu)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  for (const assetPath of assetPaths) {
    const equivalentCropReviewPaths = new Set(
      resolveEquivalentCropReviewPaths(assetPath),
    );
    const paddedSourcePaths = imageEditEvents
      .filter((event) => {
        return (
          event.toolName === "pad_image" &&
          event.sourcePath !== null &&
          resolveEquivalentCropReviewPaths(event.outputPath).includes(assetPath)
        );
      })
      .map((event) => event.sourcePath)
      .filter((path): path is string => path !== null);
    for (const sourcePath of paddedSourcePaths) {
      for (const equivalentSourcePath of resolveEquivalentCropReviewPaths(
        sourcePath,
      )) {
        equivalentCropReviewPaths.add(equivalentSourcePath);
      }
    }
    const equivalentPaths = [...equivalentCropReviewPaths];
    if (!equivalentPaths.some((path) => freshReviewPaths.has(path))) {
      issues.push(
        `crop image "${assetPath}" is linked in the worksheet but the agent log has no validate_crop_with_fresh_agent call for that final crop path`,
      );
    }
    const matchingBlocks = validationBlocks.filter((block) =>
      equivalentPaths.some((path) => block.includes(path)),
    );
    const matchingLines = validationLines.filter((line) =>
      equivalentPaths.some((path) => line.includes(path)),
    );
    const matchingRecords =
      matchingBlocks.length > 0 ? matchingBlocks : matchingLines;
    if (matchingRecords.length === 0) {
      issues.push(
        `crop image "${assetPath}" is linked in the worksheet but missing from grader/output/crop-validation.md`,
      );
      continue;
    }
    if (
      !matchingRecords.some((record) =>
        CROP_VALIDATION_ASSET_SUBAGENT_CHECK_PATTERN.test(record),
      )
    ) {
      issues.push(
        `crop image "${assetPath}" is linked in the worksheet but crop-validation.md does not record a fresh-context subagent check for that final crop`,
      );
    }
    if (
      !matchingRecords.some((record) =>
        hasExplicitPositiveCropValidationRecord(record) ||
        isBenignDuplicateOnlyFailedCropValidationRecord(record),
      )
    ) {
      issues.push(
        `crop image "${assetPath}" is linked in the worksheet but crop-validation.md does not record explicit pass/fail: pass and all question-relevant content visible: yes fields for that final crop`,
      );
    }
    if (
      !matchingRecords.some((record) =>
        CROP_VALIDATION_VISIBLE_TEXT_PATTERN.test(record),
      )
    ) {
      issues.push(
        `crop image "${assetPath}" is linked in the worksheet but crop-validation.md does not record the reviewer-visible text transcribed from that final crop`,
      );
    }
    const unresolvedRecord = matchingRecords.find((record) => {
      if (isBenignDuplicateOnlyFailedCropValidationRecord(record)) {
        return false;
      }
      for (const rawLine of record.split(/\r?\n/gu)) {
        const line = rawLine.trim();
        if (CROP_VALIDATION_HISTORY_FIELD_PATTERN.test(line)) {
          continue;
        }
        if (CROP_VALIDATION_NEGATED_RISK_FIELD_PATTERN.test(line)) {
          continue;
        }
        if (CROP_VALIDATION_POSITIVE_RISK_FIELD_PATTERN.test(line)) {
          return true;
        }
        if (CROP_VALIDATION_NEGATIVE_FIELD_PATTERN.test(line)) {
          return true;
        }
        if (
          CROP_VALIDATION_UNRESOLVED_PATTERN.test(line) &&
          !CROP_VALIDATION_RESOLVED_PATTERN.test(line)
        ) {
          return true;
        }
      }
      return false;
    });
    if (unresolvedRecord !== undefined) {
      issues.push(
        `crop image "${assetPath}" is linked in the worksheet but crop-validation.md records an unresolved failed crop review for that final crop`,
      );
    }
    if (FULL_PAGE_CROP_ASSET_PATTERN.test(assetPath)) {
      issues.push(
        `crop image "${assetPath}" looks like a full-page fallback; crop the relevant figure/table/options block into a final worksheet asset instead of linking a page image`,
      );
    }
    if (
      OPTION_CROP_ASSET_PATTERN.test(assetPath) &&
      matchingRecords.some((record) =>
        record
          .split(/\r?\n/gu)
          .map((line) => line.trim())
          .some(
            (line) =>
              !CROP_VALIDATION_NEGATED_RISK_FIELD_PATTERN.test(line) &&
              PARTIAL_OPTION_CROP_VALIDATION_PATTERN.test(line),
          ),
      )
    ) {
      issues.push(
        `option crop image "${assetPath}" is recorded as a partial/split option crop; recrop one complete options block or separate complete option crops so every candidate label and diagram is fully visible in its own final crop`,
      );
    }
  }
  return issues;
}

async function collectStaleCropValidationIssues(options: {
  rootDir: string;
  renderedSheetMarkdown: string;
  cropValidationPath: string;
  agentLogMarkdown: string;
}): Promise<string[]> {
  const issues: string[] = [];
  const assetPaths = collectLinkedCropAssetPaths(options.renderedSheetMarkdown);
  if (assetPaths.length === 0) {
    return issues;
  }

  const validationStat = await stat(
    resolveWorkspacePath(options.rootDir, options.cropValidationPath),
  ).catch(() => null);
  if (!validationStat) {
    return issues;
  }

  const editEvents = parseAgentLogImageEditEvents(options.agentLogMarkdown);
  for (const assetPath of assetPaths) {
    const assetStat = await stat(
      resolveWorkspacePath(options.rootDir, assetPath),
    ).catch(() => null);
    if (!assetStat || assetStat.mtimeMs <= validationStat.mtimeMs + 1000) {
      continue;
    }

    const staleCropEdit = editEvents.find((event) => {
      return (
        event.outputPath === assetPath &&
        event.timestampMs !== null &&
        event.timestampMs > validationStat.mtimeMs + 1000 &&
        (event.toolName === "crop_image" || event.toolName === "trim_image")
      );
    });
    if (staleCropEdit) {
      issues.push(
        `crop image "${assetPath}" was changed with ${staleCropEdit.toolName} after grader/output/crop-validation.md was written; ask a fresh-context subagent to validate the final crop again and rewrite crop-validation.md before publishing`,
      );
      continue;
    }

    const postValidationEvents = editEvents.filter((event) => {
      return (
        event.outputPath === assetPath &&
        event.timestampMs !== null &&
        event.timestampMs > validationStat.mtimeMs + 1000
      );
    });
    if (
      postValidationEvents.length === 0 ||
      postValidationEvents.some((event) => event.toolName !== "pad_image")
    ) {
      issues.push(
        `crop image "${assetPath}" changed after grader/output/crop-validation.md; rewrite crop-validation.md after validating the final linked crop before publishing`,
      );
    }
  }

  return issues;
}

async function collectCropEdgeTouchIssues(options: {
  rootDir: string;
  renderedSheetMarkdown: string;
}): Promise<string[]> {
  const issues: string[] = [];
  const assetPaths = collectLinkedCropAssetPaths(options.renderedSheetMarkdown);
  if (assetPaths.length === 0) {
    return issues;
  }

  const sharp = getSharp();
  for (const assetPath of assetPaths) {
    const resolvedAssetPath = resolveWorkspacePath(options.rootDir, assetPath);
    const assetBytes = await readFile(resolvedAssetPath).catch((error) => {
      issues.push(
        `crop image "${assetPath}" could not be inspected before publish: ${errorAsString(error)}`,
      );
      return null;
    });
    if (!assetBytes) {
      continue;
    }
    const decoded = await sharp(assetBytes)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch((error) => {
        issues.push(
          `crop image "${assetPath}" could not be inspected before publish: ${errorAsString(error)}`,
        );
        return null;
      });
    if (!decoded) {
      continue;
    }
    const { data, info } = decoded;
    const width = info.width;
    const height = info.height;
    if (width <= 0 || height <= 0) {
      continue;
    }

    const edgeBand = Math.min(
      CROP_EDGE_BAND_PX,
      Math.floor(width / 2),
      Math.floor(height / 2),
    );
    if (edgeBand <= 0) {
      continue;
    }

    const countDarkPixels = (
      side: "top" | "right" | "bottom" | "left",
    ): {
      dark: number;
      total: number;
    } => {
      let dark = 0;
      let total = 0;
      const increment = (x: number, y: number): void => {
        total += 1;
        const pixel = data[y * width + x];
        if (pixel !== undefined && pixel < CROP_EDGE_DARK_PIXEL_THRESHOLD) {
          dark += 1;
        }
      };

      switch (side) {
        case "top":
          for (let y = 0; y < edgeBand; y += 1) {
            for (let x = 0; x < width; x += 1) {
              increment(x, y);
            }
          }
          break;
        case "right":
          for (let y = 0; y < height; y += 1) {
            for (let x = width - edgeBand; x < width; x += 1) {
              increment(x, y);
            }
          }
          break;
        case "bottom":
          for (let y = height - edgeBand; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              increment(x, y);
            }
          }
          break;
        case "left":
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < edgeBand; x += 1) {
              increment(x, y);
            }
          }
          break;
      }
      return { dark, total };
    };

    const touchingSides = (["top", "right", "bottom", "left"] as const).filter(
      (side) => {
        const counts = countDarkPixels(side);
        return (
          counts.total > 0 &&
          counts.dark / counts.total >= CROP_EDGE_TOUCH_RATIO_THRESHOLD
        );
      },
    );
    if (touchingSides.length > 0) {
      issues.push(
        `crop image "${assetPath}" has dark content touching the ${touchingSides.join(", ")} edge; if the crop is complete, call pad_image on that asset to add a clean white border; otherwise expand the crop outward from the high-resolution source image. Do not crop tighter, because important labels/lines may be clipped.`,
      );
    }
  }

  return issues;
}

async function normalizeGraderWorksheetImageAssets(options: {
  rootDir: string;
  sheetPath: string;
  sheetRaw: string;
  report: SparkGraderWorksheetReport;
  onWorkspaceFileChanged?: (filePath: string) => void;
}): Promise<{
  sheetRaw: string;
  report: SparkGraderWorksheetReport;
}> {
  const renderedSheetMarkdown = collectSheetMarkdown(options.report);
  const assetPaths = collectLinkedCropAssetPaths(renderedSheetMarkdown);
  if (assetPaths.length === 0) {
    return {
      sheetRaw: options.sheetRaw,
      report: options.report,
    };
  }

  const cropValidationPath = "grader/output/crop-validation.md";
  const cropValidationFullPath = resolveWorkspacePath(
    options.rootDir,
    cropValidationPath,
  );
  const cropValidationRaw = await readFile(cropValidationFullPath, {
    encoding: "utf8",
  }).catch(() => null);
  if (cropValidationRaw === null) {
    return {
      sheetRaw: options.sheetRaw,
      report: options.report,
    };
  }

  const replacements = new Map<string, string>();
  let wroteImageAsset = false;
  const sharp = getSharp();

  for (const assetPath of assetPaths) {
    const sourceAssetPath = resolveWorkspacePath(options.rootDir, assetPath);
    const assetBytes = await readFile(sourceAssetPath).catch((error) => {
      throw new Error(
        `Linked worksheet image "${assetPath}" could not be read before publish: ${errorAsString(error)}`,
      );
    });
    const metadata = await sharp(assetBytes)
      .metadata()
      .catch((error) => {
        throw new Error(
          `Linked worksheet image "${assetPath}" could not be decoded before publish: ${errorAsString(error)}`,
        );
      });
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width <= 0 || height <= 0) {
      throw new Error(
        `Linked worksheet image "${assetPath}" has invalid dimensions before publish.`,
      );
    }

    const jpegAssetPath = resolveWorksheetJpegAssetPath(assetPath);
    const alreadyPublishJpeg =
      isJpegWorksheetAssetPath(assetPath) &&
      metadata.format === "jpeg" &&
      Math.max(width, height) <= GRADER_WORKSHEET_ASSET_MAX_DIMENSION;
    if (alreadyPublishJpeg) {
      continue;
    }

    const jpegBytes = await sharp(assetBytes)
      .rotate()
      .extend({
        top: DEFAULT_CROP_IMAGE_MARGIN_PX,
        right: DEFAULT_CROP_IMAGE_MARGIN_PX,
        bottom: DEFAULT_CROP_IMAGE_MARGIN_PX,
        left: DEFAULT_CROP_IMAGE_MARGIN_PX,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .resize({
        width:
          GRADER_WORKSHEET_ASSET_MAX_DIMENSION -
          DEFAULT_CROP_IMAGE_MARGIN_PX * 2,
        height:
          GRADER_WORKSHEET_ASSET_MAX_DIMENSION -
          DEFAULT_CROP_IMAGE_MARGIN_PX * 2,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({
        quality: GRADER_WORKSHEET_ASSET_JPEG_QUALITY,
        mozjpeg: true,
      })
      .toBuffer();
    const outputPath = resolveWorkspacePath(options.rootDir, jpegAssetPath);
    await ensureDir(path.dirname(outputPath));
    await writeFile(outputPath, jpegBytes);
    options.onWorkspaceFileChanged?.(jpegAssetPath);
    wroteImageAsset = true;

    if (jpegAssetPath !== assetPath) {
      replacements.set(assetPath, jpegAssetPath);
    }
  }

  if (replacements.size > 0 || wroteImageAsset) {
    const nextCropValidationRaw = replaceStringReferences(
      cropValidationRaw,
      replacements,
    );
    await writeFile(cropValidationFullPath, nextCropValidationRaw, {
      encoding: "utf8",
    });
    options.onWorkspaceFileChanged?.(cropValidationPath);
  }

  if (replacements.size === 0) {
    return {
      sheetRaw: options.sheetRaw,
      report: options.report,
    };
  }

  const replacedReport = replaceJsonStringReferences(
    options.report,
    replacements,
  );
  const report = SparkGraderWorksheetReportSchema.parse(replacedReport);
  const sheetRaw = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(
    resolveWorkspacePath(options.rootDir, options.sheetPath),
    sheetRaw,
    {
      encoding: "utf8",
    },
  );
  options.onWorkspaceFileChanged?.(options.sheetPath);
  return { sheetRaw, report };
}

function collectGraderWorksheetPublishIssues(
  report: SparkGraderWorksheetReport,
  options?: {
    sourceTranscriptMarkdown?: string;
    sourceReferenceMarkdown?: string;
    sheetPlanMarkdown?: string;
    cropValidationMarkdown?: string;
    sourceFidelityAuditMarkdown?: string;
    agentLogMarkdown?: string;
    scoringBatchFileCount?: number;
    requestPayload?: SparkGraderRequestPayload | null;
    runSummary?: GraderRunSummary;
    requireSourceFidelityAudit?: boolean;
  },
): string[] {
  const issues: string[] = [];
  let scoredQuestionMarks = 0;
  let scoredQuestionTotals = 0;
  const renderedSheetMarkdown = collectSheetMarkdown(report);
  issues.push(...collectGraderWorksheetEarlyAssemblyIssues(report));
  const referenceMarkdown = [
    report.references?.problemMarkdown,
    report.references?.officialProblemMarkdown,
  ]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .join("\n\n");
  const sheetHasLinkedFigure = MARKDOWN_IMAGE_PATTERN.test(
    renderedSheetMarkdown,
  );
  const sheetHasMarkdownTable = MARKDOWN_TABLE_PATTERN.test(
    renderedSheetMarkdown,
  );
  const sourcePaperOnlyNoStudent = isSourcePaperOnlyNoStudentRequest(
    options?.requestPayload,
  );
  const compactHandwrittenGrading = isCompactHandwrittenGradingRequest(
    options?.requestPayload,
  );
  const needsProblemStatementTranscription =
    requestRequiresProblemStatementTranscription(options?.requestPayload);
  const sourceTranscriptMarkdown =
    options?.sourceTranscriptMarkdown?.trim() ?? "";
  const sourceReferenceMarkdown =
    options?.sourceReferenceMarkdown?.trim() ?? "";
  const needsSourceFidelityAudit =
    sourcePaperOnlyNoStudent ||
    compactHandwrittenGrading ||
    needsProblemStatementTranscription ||
    PROBLEM_STATEMENT_TRANSCRIPTION_HEADING_PATTERN.test(
      sourceTranscriptMarkdown,
    );
  const requireSourceFidelityAudit =
    options?.requireSourceFidelityAudit ?? true;
  const sourceFigureOwnersByLabel = collectSpecificSourceReferenceOwners(
    sourceTranscriptMarkdown,
    NAMED_FIGURE_REFERENCE_PATTERN,
  );
  const sourceTableOwnersByLabel = collectSpecificSourceReferenceOwners(
    sourceTranscriptMarkdown,
    NAMED_TABLE_REFERENCE_PATTERN,
  );
  const reportDisplayNumbers = collectReportDisplayNumbers(report);
  const contentSections = report.sheet.sections.filter(
    (section): section is SparkGraderWorksheetContentSection => "id" in section,
  );
  const answerLeafCount = contentSections.reduce(
    (total, section) => total + countPaperSheetQuestions(section.questions),
    0,
  );
  const runSummary = options?.runSummary;

  if (/\bquestions?\s+paper\s*$/iu.test(report.sheet.title)) {
    issues.push(
      `worksheet sheet.title "${report.sheet.title}" repeats the source type; remove suffixes like "question paper" from the title and put provenance/source type in subtitle or footer`,
    );
  }

  if (SCORE_ONLY_REVIEW_MESSAGE_PATTERN.test(report.review.message)) {
    issues.push(
      "worksheet review.message repeats only the numeric score; use it for a short learning summary because the UI already renders got/total separately",
    );
  }
  issues.push(
    ...collectScoreFractionMismatchIssues({
      fieldName: "worksheet review.message",
      text: report.review.message,
      expectedGot: report.review.score.got,
      expectedTotal: report.review.score.total,
    }),
  );
  issues.push(
    ...collectScoreFractionMismatchIssues({
      fieldName: "references.overallFeedbackMarkdown",
      text: report.references?.overallFeedbackMarkdown,
      expectedGot: report.review.score.got,
      expectedTotal: report.review.score.total,
    }),
  );
  issues.push(
    ...collectScoreFractionMismatchIssues({
      fieldName: "presentation.summaryMarkdown",
      text: runSummary?.presentation?.summaryMarkdown,
      expectedGot: report.review.score.got,
      expectedTotal: report.review.score.total,
    }),
  );

  const presentationFields = [
    ["title", runSummary?.presentation?.title],
    ["subtitle", runSummary?.presentation?.subtitle],
    ["summaryMarkdown", runSummary?.presentation?.summaryMarkdown],
    ["footer", runSummary?.presentation?.footer],
  ] as const;
  for (const [fieldName, fieldValue] of presentationFields) {
    if (
      typeof fieldValue === "string" &&
      USER_VISIBLE_PROCESS_METADATA_PATTERN.test(fieldValue)
    ) {
      issues.push(
        `presentation.${fieldName} contains process wording ("${fieldValue}"); use student-facing source identity/provenance such as exam board, tier, paper code, session, or upload source, not transcription/OCR/artifact labels`,
      );
    }
  }

  if (
    needsSourceFidelityAudit &&
    !PROBLEM_STATEMENT_TRANSCRIPTION_HEADING_PATTERN.test(
      sourceTranscriptMarkdown,
    )
  ) {
    issues.push(
      "grader/output/transcription.md does not include a source problem-statement transcription section; include the printed root stems, interstitial context, subquestions, table labels, and figure labels so worksheet structure can be audited",
    );
  }
  if (needsSourceFidelityAudit) {
    issues.push(
      ...collectSourceTranscriptionIntegrityIssues(
        sourceTranscriptMarkdown,
        sourceReferenceMarkdown,
      ),
    );
  }
  issues.push(
    ...collectSheetPlanConsistencyIssues(options?.sheetPlanMarkdown ?? ""),
  );

  if (
    compactHandwrittenGrading &&
    (answerLeafCount > 12 || report.review.score.total > 30)
  ) {
    if ((options?.scoringBatchFileCount ?? 0) === 0) {
      issues.push(
        "long handwritten-grading worksheet has more than 12 answer leaves or more than 30 marks but grader/output/scoring has no successful score_answers_with_fresh_agent result JSON; use the dedicated bounded scoring helper before final JSON/publish",
      );
    }
  }

  if (needsSourceFidelityAudit && requireSourceFidelityAudit) {
    const sourceFidelityAuditMarkdown =
      options?.sourceFidelityAuditMarkdown?.trim() ?? "";
    if (sourceFidelityAuditMarkdown.length === 0) {
      issues.push(
        "grader/output/source-fidelity-audit.md is missing; run validate_source_fidelity_with_fresh_agent before publishing and record the pass/fail result",
      );
    } else if (!hasPositiveSourceFidelityAudit(sourceFidelityAuditMarkdown)) {
      issues.push(
        "grader/output/source-fidelity-audit.md does not record a passing fresh-context source-fidelity audit",
      );
    }
    if (
      !SOURCE_FIDELITY_REVIEW_TOOL_SUCCESS_PATTERN.test(
        options?.agentLogMarkdown ?? "",
      )
    ) {
      issues.push(
        "agent log has no successful validate_source_fidelity_with_fresh_agent call; use the dedicated fresh-context source-fidelity audit before publish",
      );
    }
  }

  const presentationFooter = runSummary?.presentation?.footer?.trim();
  if (presentationFooter) {
    const repeatedFields = [
      runSummary?.presentation?.title,
      runSummary?.presentation?.subtitle,
      report.sheet.title,
      report.sheet.subtitle,
      report.sheet.level,
      report.sheet.subject,
    ]
      .filter((value): value is string => typeof value === "string")
      .filter((value) => {
        return (
          metadataTextContains(presentationFooter, value) ||
          metadataTextContains(
            presentationFooter,
            stripQuestionPaperSuffix(value),
          )
        );
      });
    if (repeatedFields.length > 0) {
      issues.push(
        `presentation.footer repeats visible sheet metadata (${repeatedFields[0]}); keep the footer to concise provenance that does not repeat the title, subject, level, or subtitle`,
      );
    }
  }

  if (sourcePaperOnlyNoStudent) {
    if (report.review.mode !== "awaiting_answers") {
      issues.push(
        "source-paper-only request has no student answers, but review.mode is not awaiting_answers",
      );
    }
    if (report.review.score.got !== 0) {
      issues.push(
        "source-paper-only request has no student answers, but worksheet awards marks; keep it as an unanswered worksheet",
      );
    }
    const answerKeyText = [
      renderedSheetMarkdown,
      report.references?.problemMarkdown,
      report.references?.officialProblemMarkdown,
      report.references?.officialSolutionMarkdown,
      report.references?.gradingMarkdown,
      report.references?.overallFeedbackMarkdown,
      ...Object.values(report.review.questions).flatMap((review) => [
        review.note,
        review.followUp,
        review.replyPlaceholder,
      ]),
    ]
      .filter((part): part is string => typeof part === "string")
      .join("\n\n");
    if (exposesAnswerKeyReference(answerKeyText)) {
      issues.push(
        "source-paper-only request has no student answers, but worksheet references expose answer-key or solution material",
      );
    }
    for (const [fieldName, fieldValue] of [
      ["officialSolutionMarkdown", report.references?.officialSolutionMarkdown],
      ["gradingMarkdown", report.references?.gradingMarkdown],
      ["overallFeedbackMarkdown", report.references?.overallFeedbackMarkdown],
    ] as const) {
      if (typeof fieldValue === "string" && fieldValue.trim().length > 0) {
        issues.push(
          `source-paper-only request has no student answers, but references.${fieldName} is non-empty; omit answer-bearing solution/grading fields for unanswered source worksheets`,
        );
      }
    }
  }

  if (ADMIN_BOILERPLATE_PATTERN.test(renderedSheetMarkdown)) {
    issues.push(
      "worksheet appears to render cover-page or administration boilerplate; keep non-question instructions/provenance in references instead",
    );
  }
  if (RAW_ESCAPED_NEWLINE_PATTERN.test(renderedSheetMarkdown)) {
    issues.push(
      "worksheet contains a literal escaped newline sequence (\\n) in visible prompt Markdown; use real line breaks, a Markdown table, or a crop for layout-critical source text",
    );
  }
  if (RAW_LAYOUT_LATEX_PATTERN.test(renderedSheetMarkdown)) {
    issues.push(
      "worksheet contains an unsupported raw LaTeX tabular environment in visible prompt Markdown; use a Markdown table, supported display math layout, or a clean crop for layout-critical source text",
    );
  }
  if (hasMalformedLatexLayoutRowBreak(renderedSheetMarkdown)) {
    issues.push(
      "worksheet contains malformed LaTeX layout row breaks in visible prompt Markdown; array/aligned rows must end with two backslash characters, not a single backslash before the newline",
    );
  }

  if (contentSections.length === 1) {
    const rootQuestions = collectSectionRootQuestionKeys(contentSections[0]);
    const hasGroupedRootQuestion = (contentSections[0].questions ?? []).some(
      (entry) => entry.type === "group",
    );
    if (
      rootQuestions.size >= 5 ||
      (hasGroupedRootQuestion && rootQuestions.size >= 3)
    ) {
      issues.push(
        `worksheet has one collapsible content section for ${rootQuestions.size.toString()} root questions; split long papers into source-faithful sections or contiguous question ranges`,
      );
    }
  }

  for (const section of report.sheet.sections) {
    if (!("id" in section)) {
      continue;
    }

    if (
      SYNTHETIC_QUESTION_SECTION_ID_PATTERN.test(section.id) &&
      SYNTHETIC_QUESTION_SECTION_LABEL_PATTERN.test(section.label)
    ) {
      issues.push(
        `section "${section.id}" / "${section.label}" looks like a synthetic per-question wrapper; use source-faithful sectioning instead`,
      );
    }
    for (const [fieldName, fieldValue] of [
      ["theory", section.theory],
      ["infoBox", section.infoBox?.text],
    ] as const) {
      if (typeof fieldValue !== "string" || fieldValue.trim().length === 0) {
        continue;
      }
      if (
        MARKDOWN_IMAGE_PATTERN.test(fieldValue) ||
        collectNamedReferences(fieldValue, NAMED_FIGURE_REFERENCE_PATTERN)
          .size > 0 ||
        collectNamedReferences(fieldValue, NAMED_TABLE_REFERENCE_PATTERN).size >
          0
      ) {
        issues.push(
          `section "${section.id}" ${fieldName} contains a named figure/table or linked crop; place source artifacts in the relevant group or question prompt so they render near the source question, not at the collapsible section top`,
        );
      }
    }

    const sectionQuestionRoot = parseQuestionSectionRoot(section.label);
    const sectionQuestionEntries = section.questions ?? [];
    const displayOwners = new Map<string, string>();
    const checkSectionDisplayNumber = (
      entryId: string,
      displayNumber: string | undefined,
    ): void => {
      if (displayNumber === undefined) {
        return;
      }
      const normalizedDisplayNumber =
        normalizeDisplayNumberForComparison(displayNumber);
      if (normalizedDisplayNumber === null) {
        return;
      }
      const existingOwner = displayOwners.get(normalizedDisplayNumber);
      if (existingOwner !== undefined && existingOwner !== entryId) {
        issues.push(
          `section "${section.id}" reuses displayNumber "${displayNumber}" for both "${existingOwner}" and "${entryId}"; every visible source label in a section must identify one worksheet item`,
        );
      } else {
        displayOwners.set(normalizedDisplayNumber, entryId);
      }
      if (sectionQuestionRoot === null) {
        return;
      }
      const displayRoot = normalizeDisplayNumberRoot(displayNumber);
      if (displayRoot !== null && displayRoot !== sectionQuestionRoot) {
        issues.push(
          `section "${section.id}" is labelled Question ${sectionQuestionRoot} but contains question "${entryId}" with displayNumber "${displayNumber}"; keep only that root's labels in the section or move the item to Question ${displayRoot}`,
        );
      }
    };
    const visitEntriesForDisplayNumbers = (
      entries: readonly PaperSheetQuestionEntry[] | undefined,
    ): void => {
      for (const entry of entries ?? []) {
        checkSectionDisplayNumber(entry.id, entry.displayNumber);
        if (entry.type === "group") {
          visitEntriesForDisplayNumbers(entry.questions);
        }
      }
    };
    visitEntriesForDisplayNumbers(sectionQuestionEntries);
    if (
      sectionQuestionRoot !== null &&
      sectionQuestionEntries.length === 1 &&
      sectionQuestionEntries[0]?.type === "group"
    ) {
      const onlyGroup = sectionQuestionEntries[0];
      const groupRoot = onlyGroup.displayNumber
        ? normalizeDisplayNumberRoot(onlyGroup.displayNumber)
        : null;
      const onlyChild = onlyGroup.questions[0];
      const childRoot = onlyChild?.displayNumber
        ? normalizeDisplayNumberRoot(onlyChild.displayNumber)
        : null;
      if (
        groupRoot === sectionQuestionRoot &&
        onlyGroup.questions.length === 1 &&
        childRoot === sectionQuestionRoot &&
        !isSubpartDisplayNumber(onlyChild?.displayNumber ?? "")
      ) {
        issues.push(
          `section "${section.id}" already represents Question ${sectionQuestionRoot}, but wraps the only answer-bearing question in a duplicate "${onlyGroup.displayNumber}" group and child; use one direct question entry instead of rendering a fake subsection`,
        );
      }
      if (
        groupRoot === sectionQuestionRoot &&
        onlyGroup.questions.length > 0 &&
        onlyGroup.questions.some(
          (question) =>
            parseDecimalSubpartDisplayNumber(question.displayNumber)?.root ===
            sectionQuestionRoot,
        )
      ) {
        issues.push(
          `section "${section.id}" already represents Question ${sectionQuestionRoot}, but renders a duplicate "${onlyGroup.displayNumber}" root group around decimal subparts; put plain root text in section.theory only when it has no named figures/tables/crops, otherwise put the shared source stem plus artifact in the first source-faithful prompt, then render subparts as direct questions with short badgeLabel values like "1" and "2"`,
        );
      }
    }

    const parentCounts = new Map<string, number>();
    const groupRoots = new Set<string>();
    const rootedParentEntries = new Set<string>();
    const multiPartGroups = (section.questions ?? []).filter((entry) => {
      return entry.type === "group" && entry.questions.length > 1;
    });
    if (
      !compactHandwrittenGrading &&
      QUESTIONS_RANGE_SECTION_LABEL_PATTERN.test(section.label) &&
      multiPartGroups.length > 1
    ) {
      issues.push(
        `section "${section.label}" groups ${multiPartGroups.length.toString()} multi-part root questions; use one collapsible section per root question when roots have subquestions, and reserve numeric ranges for many small standalone questions`,
      );
    }
    for (const entry of section.questions ?? []) {
      if (entry.type === "group") {
        const groupRoot = entry.displayNumber
          ? normalizeDisplayNumberRoot(entry.displayNumber)
          : null;
        const childRoots = new Set(
          entry.questions
            .map((question) =>
              question.displayNumber
                ? normalizeDisplayNumberRoot(question.displayNumber)
                : null,
            )
            .filter((root): root is string => root !== null),
        );
        if (
          entry.displayNumber === undefined &&
          entry.questions.length > 1 &&
          childRoots.size === 1
        ) {
          const childRoot = [...childRoots][0] ?? "unknown";
          issues.push(
            `group question "${entry.id}" has no displayNumber while its children use root question ${childRoot}; put the shared root stem in section.theory and render the children as direct subquestions, or keep a visible parent displayNumber so the layout grid does not collapse an unnumbered group`,
          );
        }
        if (
          entry.displayNumber !== undefined &&
          groupRoot === null &&
          childRoots.size === 1 &&
          entry.questions.length > 1
        ) {
          const childRoot = [...childRoots][0] ?? "unknown";
          issues.push(
            `group question "${entry.id}" uses displayNumber "${entry.displayNumber}" while its children use root question ${childRoot}; figure/table labels belong in prompt text, not displayNumber. Render those subquestions directly with displayNumber values such as "0${childRoot}.1" and short badgeLabel values, or use the root displayNumber only for a real source question group.`,
          );
        }
        const groupFigureLabels = collectNamedReferences(
          entry.prompt,
          NAMED_FIGURE_REFERENCE_PATTERN,
        );
        const groupTableLabels = collectNamedReferences(
          entry.prompt,
          NAMED_TABLE_REFERENCE_PATTERN,
        );
        const firstChild = entry.questions[0];
        const firstChildDisplayNumber =
          firstChild !== undefined
            ? normalizeDisplayNumberForComparison(firstChild.displayNumber)
            : null;
        const groupDisplayLabel = entry.displayNumber
          ? normalizeSubpartLabel(entry.displayNumber)
          : null;
        if (
          sectionQuestionRoot !== null &&
          groupDisplayLabel !== null &&
          /^[a-z]+$/iu.test(groupDisplayLabel) &&
          entry.questions.length === 1 &&
          firstChild !== undefined
        ) {
          const firstChildOneLevel = parseOneLevelBracketDisplayNumber(
            firstChild.displayNumber,
          );
          if (
            firstChildOneLevel?.root === sectionQuestionRoot &&
            firstChildOneLevel.firstLevel === groupDisplayLabel
          ) {
            issues.push(
              `group question "${entry.id}" repeats subpart "${groupDisplayLabel}" as both a parent group and its only child; use a direct "${firstChild.displayNumber ?? groupDisplayLabel}" question with badgeLabel "${groupDisplayLabel}" instead of rendering duplicate circles`,
            );
          }
        }
        if (!compactHandwrittenGrading) {
          for (const label of groupFigureLabels) {
            const sourceOwners = sourceFigureOwnersByLabel.get(label);
            if (!sourceOwners || sourceOwners.size === 0) {
              continue;
            }
            const ownedChildren = entry.questions.filter((question) => {
              const displayNumber = normalizeDisplayNumberForComparison(
                question.displayNumber,
              );
              return displayNumber !== null && sourceOwners.has(displayNumber);
            });
            const startsAtFirstChild =
              firstChildDisplayNumber !== null &&
              sourceOwners.has(firstChildDisplayNumber);
            if (ownedChildren.length > 0 && !startsAtFirstChild) {
              issues.push(
                `group question "${entry.id}" places Figure ${label} in the parent prompt, but the source transcript ties it to later child question "${ownedChildren[0]?.id ?? "unknown"}"; move that figure crop and label into the relevant child prompt so it renders near the source subquestion`,
              );
            }
          }
          for (const label of groupTableLabels) {
            const sourceOwners = sourceTableOwnersByLabel.get(label);
            if (!sourceOwners || sourceOwners.size === 0) {
              continue;
            }
            const ownedChildren = entry.questions.filter((question) => {
              const displayNumber = normalizeDisplayNumberForComparison(
                question.displayNumber,
              );
              return displayNumber !== null && sourceOwners.has(displayNumber);
            });
            const startsAtFirstChild =
              firstChildDisplayNumber !== null &&
              sourceOwners.has(firstChildDisplayNumber);
            if (ownedChildren.length > 0 && !startsAtFirstChild) {
              issues.push(
                `group question "${entry.id}" places Table ${label} in the parent prompt, but the source transcript ties it to later child question "${ownedChildren[0]?.id ?? "unknown"}"; move that table into the relevant child prompt so it renders near the source subquestion`,
              );
            }
          }
        }
        for (const child of entry.questions) {
          const childPrompt = (() => {
            switch (child.type) {
              case "fill":
              case "mcq":
              case "lines":
              case "calc":
              case "match":
              case "spelling":
              case "flow":
                return child.prompt;
              case "cloze":
              case "answer_bank":
                return child.segments.join(" ");
            }
          })();
          if (!compactHandwrittenGrading) {
            for (const label of groupFigureLabels) {
              if (hasReferenceLabel(childPrompt, "Figure", label)) {
                issues.push(
                  `group question "${entry.id}" places Figure ${label} in the parent prompt even though child question "${child.id}" references it; move the figure crop and label into that child prompt so it renders next to the source subquestion`,
                );
              }
            }
            for (const label of groupTableLabels) {
              if (hasReferenceLabel(childPrompt, "Table", label)) {
                issues.push(
                  `group question "${entry.id}" places Table ${label} in the parent prompt even though child question "${child.id}" references it; move the table into that child prompt so it renders next to the source subquestion`,
                );
              }
            }
          }
        }
        if (promptNeedsVisibleImage(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" references a visual but does not link a visible worksheet crop in group.prompt; keep question-critical figures visible near the source stem instead of hiding them in references`,
          );
        }
        if (groupRoot) {
          groupRoots.add(groupRoot);
        }
        const onlyChild = entry.questions[0];
        const onlyChildDisplayNumber =
          onlyChild !== undefined
            ? normalizeDisplayNumberForComparison(onlyChild.displayNumber)
            : null;
        const groupDisplayNumber = normalizeDisplayNumberForComparison(
          entry.displayNumber,
        );
        if (
          entry.questions.length === 1 &&
          groupDisplayNumber !== null &&
          onlyChildDisplayNumber === groupDisplayNumber &&
          !isSubpartDisplayNumber(onlyChild?.displayNumber ?? "")
        ) {
          issues.push(
            `group question "${entry.id}" wraps a single standalone question with the same displayNumber as child "${onlyChild?.id ?? "unknown"}"; merge the source prompt into one mark-bearing question instead of creating a synthetic subquestion`,
          );
        }
        const directlyFlattenedTwoLevelChildren = entry.questions.filter(
          (question) => {
            const parsed = parseTwoLevelBracketDisplayNumber(
              question.displayNumber,
            );
            return parsed !== null && parsed.root === groupRoot;
          },
        );
        if (directlyFlattenedTwoLevelChildren.length > 0) {
          const example =
            directlyFlattenedTwoLevelChildren[0]?.displayNumber ?? "unknown";
          issues.push(
            `group question "${entry.id}" flattens two-level source subparts such as "${example}" directly under the root question; use the section label for Question ${groupRoot}, first-level groups with circular labels like "a"/"b", and child badgeLabel values like "i"/"ii" so nested source labels render as separate circles`,
          );
        }
        const childHasMatchingSubpart = entry.questions.some((question) => {
          if (!question.displayNumber) {
            return false;
          }
          const childRoot = normalizeDisplayNumberRoot(question.displayNumber);
          return (
            childRoot !== null &&
            (groupRoot === null || childRoot === groupRoot) &&
            isSubpartDisplayNumber(question.displayNumber)
          );
        });
        if (
          childHasMatchingSubpart &&
          isStubGroupPrompt(entry.prompt, entry.displayNumber)
        ) {
          issues.push(
            `group question "${entry.id}" has subparts but its prompt is only a generic label; keep the real shared source stem/table/figure in group.prompt`,
          );
        }
        if (REPEATED_SOURCE_ARTIFACT_PATTERN.test(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" repeats a source figure/table in its prompt; render shared figures/tables once at the first source-faithful location, then refer to Figure/Table labels above in later subquestions`,
          );
        }
        if (RAW_ESCAPED_NEWLINE_PATTERN.test(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" contains a literal escaped newline sequence (\\n) in visible prompt Markdown; use real line breaks, a Markdown table, or a crop for layout-critical source text`,
          );
        }
        if (RAW_LAYOUT_LATEX_PATTERN.test(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" contains an unsupported raw LaTeX tabular environment in visible prompt Markdown; use a Markdown table, supported display math layout, or a clean crop for layout-critical source text instead`,
          );
        }
        if (hasMalformedLatexLayoutRowBreak(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" contains malformed LaTeX layout row breaks; array/aligned rows must end with two backslash characters, not a single backslash before the newline`,
          );
        }
        if (containsMathGridAsProse(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" describes a mathematical grid as row prose; use source-faithful display LaTeX arrays/matrices instead`,
          );
        }
        if (containsLongSignRowOutsideDisplayMath(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" leaves a long sign row inline; preserve source display layout with display LaTeX or an equivalent line block`,
          );
        }
        if (promptNeedsVisibleTable(entry.prompt)) {
          issues.push(
            `group question "${entry.id}" references a source table but group.prompt does not include a visible Markdown table or linked crop`,
          );
        }
        if (
          COLUMN_METHOD_PROMPT_WITHOUT_LAYOUT_PATTERN.test(entry.prompt) &&
          !promptHasColumnOrStackedLayout(entry.prompt)
        ) {
          issues.push(
            `group question "${entry.id}" references layout-critical working or column arithmetic but group.prompt does not preserve a visible stacked layout or linked crop`,
          );
        }
        for (const orderingIssue of collectFigureImageOrderingIssues(
          entry.prompt,
        )) {
          issues.push(`group question "${entry.id}" ${orderingIssue}`);
        }
        continue;
      }

      const parentRoot = entry.displayNumber
        ? normalizeDisplayNumberRoot(entry.displayNumber)
        : null;
      if (parentRoot) {
        parentCounts.set(parentRoot, (parentCounts.get(parentRoot) ?? 0) + 1);
        if (!isSubpartDisplayNumber(entry.displayNumber ?? "")) {
          rootedParentEntries.add(parentRoot);
        }
      }
    }

    for (const [parentRoot, count] of parentCounts) {
      if (
        groupRoots.has(parentRoot) ||
        rootedParentEntries.has(parentRoot) ||
        sectionQuestionRoot === parentRoot
      ) {
        continue;
      }
      issues.push(
        `section "${section.id}" has ${count.toString()} subparts under question ${parentRoot} but no explicit parent question/group entry`,
      );
    }

    visitPaperSheetQuestions(section.questions, (question, parentGroup) => {
      const promptText = (() => {
        switch (question.type) {
          case "fill":
          case "mcq":
          case "lines":
          case "calc":
          case "match":
          case "spelling":
          case "flow":
            return question.prompt;
          case "cloze":
          case "answer_bank":
            return question.segments.join(" ");
        }
      })();
      const promptContext = [parentGroup?.prompt, promptText]
        .filter((part): part is string => typeof part === "string")
        .join("\n\n");
      const review = report.review.questions[question.id];
      const score = review?.score;
      if (sourcePaperOnlyNoStudent) {
        const answer = report.answers[question.id];
        if (!isBlankWorksheetAnswer(answer)) {
          issues.push(
            `source-paper-only request has no student answers, but question "${question.id}" records a submitted answer`,
          );
        }
        if (score !== undefined) {
          issues.push(
            `source-paper-only request has no student answers, but question "${question.id}" includes a per-question score; omit scores instead of rendering a completed zero-score attempt`,
          );
        }
        if (review !== undefined && review.status !== "teacher-review") {
          issues.push(
            `source-paper-only request has no student answers, but question "${question.id}" is marked as completed feedback`,
          );
        }
        if (
          (question.type === "mcq" || question.type === "answer_bank") &&
          objectiveQuestionHasFakeBlankOption(question)
        ) {
          issues.push(
            `source-paper-only request has no student answers, but question "${question.id}" adds a fake blank/no-answer or placeholder option; keep source options unchanged and store the blank answer as an empty string`,
          );
        }
      }
      if (sourcePaperOnlyNoStudent) {
        // Awaiting-answer worksheets still carry question marks on the prompts,
        // but they should not contribute per-question awarded marks.
      } else if (!score) {
        issues.push(
          `question "${question.id}" is missing review.questions.${question.id}.score`,
        );
      } else {
        if (score.total !== question.marks) {
          issues.push(
            `question "${question.id}" review total ${score.total.toString()} does not match marks ${question.marks.toString()}`,
          );
        }
        if (score.got > score.total) {
          issues.push(
            `question "${question.id}" awarded marks ${score.got.toString()} exceed total ${score.total.toString()}`,
          );
        }
        scoredQuestionMarks += score.got;
        scoredQuestionTotals += score.total;
      }

      if (
        review !== undefined &&
        review.status !== "correct" &&
        !sourcePaperOnlyNoStudent &&
        review.note.trim().length === 0
      ) {
        issues.push(
          `question "${question.id}" unresolved review note is empty; give a student-facing cue or next step`,
        );
      }

      const reviewFeedbackText =
        review !== undefined
          ? [review.note, review.followUp, review.replyPlaceholder]
              .filter((part): part is string => typeof part === "string")
              .join(" ")
          : "";
      if (
        review !== undefined &&
        review.status !== "correct" &&
        (ANSWER_REVEAL_NOTE_PATTERN.test(reviewFeedbackText) ||
          reviewFeedbackRepeatsObjectiveOptionText(
            question,
            reviewFeedbackText,
          ))
      ) {
        issues.push(
          `question "${question.id}" review feedback gives away the answer before tutoring; start unresolved feedback with a cue or next step instead`,
        );
      }

      if (
        question.displayNumber === undefined &&
        LEADING_PROMPT_NUMBERING_PATTERN.test(promptText)
      ) {
        issues.push(
          `question "${question.id}" embeds source numbering in prompt instead of displayNumber`,
        );
      }

      const oneLevelDisplayNumber = parseOneLevelBracketDisplayNumber(
        question.displayNumber,
      );
      const decimalDisplayNumber = parseDecimalSubpartDisplayNumber(
        question.displayNumber,
      );
      if (
        question.badgeLabel !== undefined &&
        badgeLabelLooksLikeFullSourceNumber(question.badgeLabel)
      ) {
        issues.push(
          `question "${question.id}" uses badgeLabel "${question.badgeLabel}" as a full source label; set displayNumber to the full source label and badgeLabel to only the short visible circle text`,
        );
      }
      if (decimalDisplayNumber !== null) {
        const actualBadge =
          question.badgeLabel !== undefined
            ? normalizeSubpartLabel(question.badgeLabel)
            : null;
        if (actualBadge !== decimalDisplayNumber.subpart) {
          issues.push(
            `question "${question.id}" uses displayNumber "${question.displayNumber}" but does not set badgeLabel "${decimalDisplayNumber.subpart}"; set the short badge so the sheet renders subquestions as "${decimalDisplayNumber.subpart}" instead of the full decimal source label`,
          );
        }
      }

      if (oneLevelDisplayNumber !== null) {
        const actualBadge =
          question.badgeLabel !== undefined
            ? normalizeSubpartLabel(question.badgeLabel)
            : null;
        if (actualBadge !== oneLevelDisplayNumber.firstLevel) {
          issues.push(
            `question "${question.id}" uses displayNumber "${question.displayNumber}" but does not set badgeLabel "${oneLevelDisplayNumber.firstLevel}"; set the short badge to the printed subpart label so it renders as "${oneLevelDisplayNumber.firstLevel}" instead of the full root label`,
          );
        }
      }

      const twoLevelDisplayNumber = parseTwoLevelBracketDisplayNumber(
        question.displayNumber,
      );
      if (twoLevelDisplayNumber !== null) {
        const actualBadge =
          question.badgeLabel !== undefined
            ? normalizeSubpartLabel(question.badgeLabel)
            : null;
        if (actualBadge !== twoLevelDisplayNumber.secondLevel) {
          issues.push(
            `question "${question.id}" uses displayNumber "${question.displayNumber}" but does not set badgeLabel "${twoLevelDisplayNumber.secondLevel}"; nested source subparts should render with the short second-level circle label`,
          );
        }
      }

      if (
        question.type !== "mcq" &&
        question.type !== "answer_bank" &&
        (FLATTENED_OPTIONS_PATTERN.test(promptText) ||
          collectObjectiveOptionLabels(promptText) >= 2 ||
          OBJECTIVE_PROMPT_PATTERN.test(promptText))
      ) {
        issues.push(
          `question "${question.id}" looks like a flattened objective prompt instead of a structured mcq/answer_bank`,
        );
      }

      if (
        question.type === "mcq" &&
        containsStandaloneOptionLabelList(promptText)
      ) {
        issues.push(
          `question "${question.id}" repeats standalone option labels in the prompt while also defining structured MCQ options; remove redundant (A)/(B)/(C) lines from prompt text and keep choices in options[]`,
        );
      }
      if (mcqPromptRepeatsStructuredOptionText(question)) {
        issues.push(
          `question "${question.id}" duplicates structured MCQ option text in the prompt; keep option content in options[] unless using labels_only with a source diagram/table that carries the choices`,
        );
      }

      if (REPEATED_SOURCE_ARTIFACT_PATTERN.test(promptText)) {
        issues.push(
          `question "${question.id}" repeats a source figure/table in its prompt; render shared figures/tables once at the first source-faithful location, then refer to Figure/Table labels above in later subquestions`,
        );
      }

      if (RAW_ESCAPED_NEWLINE_PATTERN.test(promptText)) {
        issues.push(
          `question "${question.id}" contains a literal escaped newline sequence (\\n) in visible prompt Markdown; use real line breaks, a Markdown table, or a crop for layout-critical source text`,
        );
      }
      if (RAW_LAYOUT_LATEX_PATTERN.test(promptText)) {
        issues.push(
          `question "${question.id}" contains an unsupported raw LaTeX tabular environment in visible prompt Markdown; use a Markdown table, supported display math layout, or a clean crop for layout-critical source text instead`,
        );
      }
      if (hasMalformedLatexLayoutRowBreak(promptText)) {
        issues.push(
          `question "${question.id}" contains malformed LaTeX layout row breaks; array/aligned rows must end with two backslash characters, not a single backslash before the newline`,
        );
      }
      if (containsMathGridAsProse(promptText)) {
        issues.push(
          `question "${question.id}" describes a mathematical grid as row prose; use source-faithful display LaTeX arrays/matrices instead`,
        );
      }
      if (containsLongSignRowOutsideDisplayMath(promptText)) {
        issues.push(
          `question "${question.id}" leaves a long sign row inline; preserve source display layout with display LaTeX or an equivalent line block`,
        );
      }
      if (promptNeedsVisibleTable(promptContext)) {
        issues.push(
          `question "${question.id}" references a source table but its prompt or enclosing group prompt does not include a visible Markdown table or linked crop`,
        );
      }
      if (
        COLUMN_METHOD_PROMPT_WITHOUT_LAYOUT_PATTERN.test(promptText) &&
        !promptHasColumnOrStackedLayout(promptText)
      ) {
        issues.push(
          `question "${question.id}" references layout-critical working or column arithmetic but its prompt does not preserve a visible stacked layout or linked crop`,
        );
      }

      for (const orderingIssue of collectFigureImageOrderingIssues(
        promptText,
      )) {
        issues.push(`question "${question.id}" ${orderingIssue}`);
      }

      if (promptNeedsVisibleImage(promptContext)) {
        issues.push(
          `question "${question.id}" references a visual but does not link a visible worksheet crop in the prompt or enclosing group prompt; do not hide question-critical figures in source references or transcription`,
        );
      }
    });
  }

  if (
    !compactHandwrittenGrading &&
    referenceMarkdown.length > 0 &&
    FIGURE_REFERENCE_PATTERN.test(referenceMarkdown) &&
    !sheetHasLinkedFigure
  ) {
    issues.push(
      "reference markdown mentions a figure/diagram/photo/graph/chart but the worksheet contains no linked image asset",
    );
  }
  if (
    !compactHandwrittenGrading &&
    referenceMarkdown.length > 0 &&
    MARKDOWN_TABLE_PATTERN.test(referenceMarkdown) &&
    !sheetHasMarkdownTable
  ) {
    issues.push(
      "reference markdown preserves a source table but the worksheet contains no Markdown table",
    );
  }

  {
    const sourceFigureLabels = mergeNamedReferenceLabels(
      collectNamedReferences(
        options?.sheetPlanMarkdown ?? "",
        NAMED_FIGURE_REFERENCE_PATTERN,
      ),
      collectNamedReferences(
        sourceTranscriptMarkdown,
        NAMED_FIGURE_REFERENCE_PATTERN,
      ),
      collectSourceReferenceLabelsNearDisplayNumbers(
        sourceReferenceMarkdown,
        reportDisplayNumbers,
        NAMED_FIGURE_REFERENCE_PATTERN,
      ),
    );
    for (const label of sourceFigureLabels) {
      if (!hasReferenceLabel(renderedSheetMarkdown, "Figure", label)) {
        issues.push(
          `source references mention Figure ${label} near included worksheet questions but the worksheet omits that named figure`,
        );
        continue;
      }
      if (!hasNearbyMarkdownImage(renderedSheetMarkdown, "Figure", label)) {
        issues.push(
          `source references mention Figure ${label} near included worksheet questions but the worksheet does not link an image near that figure label`,
        );
      }
    }

    const sourceTableLabels = mergeNamedReferenceLabels(
      collectNamedReferences(
        options?.sheetPlanMarkdown ?? "",
        NAMED_TABLE_REFERENCE_PATTERN,
      ),
      collectNamedReferences(
        sourceTranscriptMarkdown,
        NAMED_TABLE_REFERENCE_PATTERN,
      ),
      collectSourceReferenceLabelsNearDisplayNumbers(
        sourceReferenceMarkdown,
        reportDisplayNumbers,
        NAMED_TABLE_REFERENCE_PATTERN,
      ),
    );
    for (const label of sourceTableLabels) {
      if (!hasReferenceLabel(renderedSheetMarkdown, "Table", label)) {
        issues.push(
          `source references mention Table ${label} near included worksheet questions but the worksheet omits that named table`,
        );
        continue;
      }
      if (hasNearbyTableImageWithoutMarkdown(renderedSheetMarkdown, label)) {
        issues.push(
          `source references mention Table ${label} near included worksheet questions but the worksheet renders that table as an image crop instead of a Markdown table`,
        );
        continue;
      }
      if (
        sourceReferenceHasMarkdownTable(sourceTranscriptMarkdown, label) &&
        !hasNearbyMarkdownTable(renderedSheetMarkdown, label)
      ) {
        issues.push(
          `source transcription preserves Table ${label} as text/numbers but the worksheet does not transcribe it as a Markdown table near that label`,
        );
      }
    }
  }

  if (sheetHasLinkedFigure) {
    issues.push(...collectRepeatedCropImageIssues(renderedSheetMarkdown));

    const imageTargets = collectMarkdownImageTargets(renderedSheetMarkdown);
    for (const target of imageTargets) {
      if (!WORKSHEET_CROP_ASSET_PATH_PATTERN.test(target)) {
        issues.push(
          `worksheet links image "${target}" outside grader/output/assets or sheet/output/assets; crop final worksheet figures into the guarded assets directory so validation and edge checks apply`,
        );
      }
    }
    const cropValidationMarkdown =
      options?.cropValidationMarkdown?.trim() ?? "";
    if (cropValidationMarkdown.length === 0) {
      issues.push(
        "worksheet contains linked crop image assets but is missing grader/output/crop-validation.md; ask a fresh-context subagent to validate final crops and record the result before publishing",
      );
    } else {
      if (!hasPositiveCropValidationReport(cropValidationMarkdown)) {
        issues.push(
          "grader/output/crop-validation.md must record a passing fresh-context subagent validation for linked figure/table/image crops",
        );
      }
      issues.push(
        ...collectCropValidationAssetIssues({
          renderedSheetMarkdown,
          cropValidationMarkdown,
          agentLogMarkdown: options?.agentLogMarkdown ?? "",
        }),
      );
    }

    const agentLogMarkdown = options?.agentLogMarkdown ?? "";
    if (
      !SPAWN_AGENT_TOOL_PATTERN.test(agentLogMarkdown) &&
      !FRESH_CROP_REVIEW_TOOL_PATTERN.test(agentLogMarkdown)
    ) {
      issues.push(
        "worksheet contains linked crop image assets but the agent log has no fresh crop-review agent call; validate important crops with a fresh-context visual agent before publishing",
      );
    }
  }

  if (
    !sourcePaperOnlyNoStudent &&
    scoredQuestionMarks !== report.review.score.got
  ) {
    issues.push(
      `review.score.got ${report.review.score.got.toString()} does not equal the sum of per-question awarded marks ${scoredQuestionMarks.toString()}`,
    );
  }
  if (
    !sourcePaperOnlyNoStudent &&
    scoredQuestionTotals !== report.review.score.total
  ) {
    issues.push(
      `review.score.total ${report.review.score.total.toString()} does not equal the sum of per-question totals ${scoredQuestionTotals.toString()}`,
    );
  }

  return issues;
}

async function validateGraderWorkspaceForPublish(options: {
  rootDir: string;
  summaryPath: string;
  sheetPath: string;
  requireSourceFidelityAudit?: boolean;
  onWorkspaceFileChanged?: (filePath: string) => void;
}): Promise<PublishedGraderSheetArtifacts> {
  const normalizeWorkspacePath = (value: string): string =>
    value.replace(/\\/gu, "/").trim();

  const resolvedSummaryPath = normalizeWorkspacePath(options.summaryPath);
  const resolvedSheetPath = normalizeWorkspacePath(options.sheetPath);

  let summaryRaw = await readFile(
    resolveWorkspacePath(options.rootDir, resolvedSummaryPath),
    {
      encoding: "utf8",
    },
  ).catch((error) => {
    throw new Error(
      `Missing required grader summary "${resolvedSummaryPath}": ${errorAsString(error)}`,
    );
  });
  let summaryJson: unknown;
  try {
    summaryJson = JSON.parse(summaryRaw);
  } catch (error) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is invalid JSON: ${errorAsString(error)}`,
    );
  }
  const normalizedSummaryMetadata =
    await normalizeRawGraderSummaryMetadataForPublish({
      rootDir: options.rootDir,
      summaryPath: resolvedSummaryPath,
      summaryJson,
      onWorkspaceFileChanged: options.onWorkspaceFileChanged,
    });
  summaryJson = normalizedSummaryMetadata.summaryJson;
  if (normalizedSummaryMetadata.summaryRaw !== null) {
    summaryRaw = normalizedSummaryMetadata.summaryRaw;
  }
  const parsedSummary = GraderRunSummarySchema.safeParse(summaryJson);
  if (!parsedSummary.success) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" failed schema validation: ${formatZodIssueSummary(parsedSummary.error)}`,
    );
  }
  let summary = parsedSummary.data;

  if (normalizeWorkspacePath(summary.sheet.filePath) !== resolvedSheetPath) {
    throw new Error(
      `Grader summary sheet.filePath must be "${resolvedSheetPath}" before publish.`,
    );
  }

  const presentationTitle = summary.presentation?.title?.trim();
  if (!presentationTitle) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is missing presentation.title.`,
    );
  }
  const presentationSubtitle = summary.presentation?.subtitle?.trim();
  if (!presentationSubtitle) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is missing presentation.subtitle.`,
    );
  }
  const presentationSummary = summary.presentation?.summaryMarkdown?.trim();
  if (!presentationSummary) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is missing presentation.summaryMarkdown.`,
    );
  }
  const presentationFooter = summary.presentation?.footer?.trim();
  if (!presentationFooter) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is missing presentation.footer.`,
    );
  }
  if (!summary.totals) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is missing totals.`,
    );
  }

  let sheetRaw = await readFile(
    resolveWorkspacePath(options.rootDir, resolvedSheetPath),
    {
      encoding: "utf8",
    },
  ).catch((error) => {
    throw new Error(
      `Missing required worksheet artifact "${resolvedSheetPath}": ${errorAsString(error)}`,
    );
  });
  let sheetJson: unknown;
  try {
    sheetJson = JSON.parse(sheetRaw);
  } catch (error) {
    throw new Error(
      `Worksheet artifact "${resolvedSheetPath}" is invalid JSON: ${errorAsString(error)}`,
    );
  }
  const normalizedSheetShape = normalizeRawPaperSheetShapeForPublish(sheetJson);
  if (normalizedSheetShape.changed) {
    sheetJson = normalizedSheetShape.value;
    sheetRaw = JSON.stringify(sheetJson, null, 2).concat("\n");
    await writeFile(
      resolveWorkspacePath(options.rootDir, resolvedSheetPath),
      sheetRaw,
      { encoding: "utf8" },
    );
    options.onWorkspaceFileChanged?.(resolvedSheetPath);
  }
  const coercedReport = coerceBareGraderWorksheetReportForPublish(sheetJson);
  if (coercedReport !== null) {
    sheetJson = coercedReport;
    sheetRaw = JSON.stringify(coercedReport, null, 2).concat("\n");
    await writeFile(
      resolveWorkspacePath(options.rootDir, resolvedSheetPath),
      sheetRaw,
      { encoding: "utf8" },
    );
    options.onWorkspaceFileChanged?.(resolvedSheetPath);
  }
  const normalizedQuestionReviews =
    await normalizeRawGraderQuestionReviewsForPublish({
      rootDir: options.rootDir,
      sheetPath: resolvedSheetPath,
      sheetJson,
      onWorkspaceFileChanged: options.onWorkspaceFileChanged,
    });
  sheetJson = normalizedQuestionReviews.sheetJson;
  if (normalizedQuestionReviews.sheetRaw !== null) {
    sheetRaw = normalizedQuestionReviews.sheetRaw;
  }
  const normalizedScores = await normalizeRawGraderAggregateScoresForPublish({
    rootDir: options.rootDir,
    summaryPath: resolvedSummaryPath,
    sheetPath: resolvedSheetPath,
    sheetJson,
    summary,
    onWorkspaceFileChanged: options.onWorkspaceFileChanged,
  });
  sheetJson = normalizedScores.sheetJson;
  if (normalizedScores.sheetRaw !== null) {
    sheetRaw = normalizedScores.sheetRaw;
  }
  if (normalizedScores.summaryRaw !== null) {
    summaryRaw = normalizedScores.summaryRaw;
  }
  summary = normalizedScores.summary;
  const rawWorksheetShapeIssues =
    collectRawGraderWorksheetShapeIssues(sheetJson);
  if (rawWorksheetShapeIssues.length > 0) {
    throw new Error(
      `Worksheet artifact "${resolvedSheetPath}" has invalid grader worksheet question shapes: ${rawWorksheetShapeIssues.join("; ")}`,
    );
  }
  const parsedSheet = SparkGraderWorksheetReportSchema.safeParse(sheetJson);
  if (!parsedSheet.success) {
    throw new Error(
      `Worksheet artifact "${resolvedSheetPath}" failed schema validation: ${formatZodIssueSummary(parsedSheet.error)}`,
    );
  }
  let report = parsedSheet.data;
  const normalizedTheme = normalizeSparkGraderWorksheetReportTheme(report);
  if (normalizedTheme.changed) {
    report = normalizedTheme.report;
    sheetJson = report;
    sheetRaw = JSON.stringify(report, null, 2).concat("\n");
    await writeFile(
      resolveWorkspacePath(options.rootDir, resolvedSheetPath),
      sheetRaw,
      {
        encoding: "utf8",
      },
    );
    options.onWorkspaceFileChanged?.(resolvedSheetPath);
  }
  const preNormalizationRawAgentLogMarkdown = await readFile(
    resolveWorkspacePath(options.rootDir, "logs/agent/agent.log"),
    { encoding: "utf8" },
  ).catch(() => "");
  const preNormalizationAgentToolCallLogMarkdown =
    await readAgentToolCallLogMarkdown(options.rootDir);
  const preNormalizationAgentLogMarkdown = [
    preNormalizationRawAgentLogMarkdown,
    preNormalizationAgentToolCallLogMarkdown,
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n");
  const staleCropIssuesBeforeNormalization =
    await collectStaleCropValidationIssues({
      rootDir: options.rootDir,
      renderedSheetMarkdown: collectSheetMarkdown(report),
      cropValidationPath: "grader/output/crop-validation.md",
      agentLogMarkdown: preNormalizationAgentLogMarkdown,
    });
  if (staleCropIssuesBeforeNormalization.length > 0) {
    throw new Error(
      `Worksheet artifact "${resolvedSheetPath}" failed publish guards: ${staleCropIssuesBeforeNormalization.slice(0, 10).join("; ")}`,
    );
  }
  const normalizedImages = await normalizeGraderWorksheetImageAssets({
    rootDir: options.rootDir,
    sheetPath: resolvedSheetPath,
    sheetRaw,
    report,
    onWorkspaceFileChanged: options.onWorkspaceFileChanged,
  });
  sheetRaw = normalizedImages.sheetRaw;
  report = normalizedImages.report;
  const normalizedSummaryTotals = summary.totals;
  if (!normalizedSummaryTotals) {
    throw new Error(
      `Grader summary "${resolvedSummaryPath}" is missing totals.`,
    );
  }
  if (normalizedSummaryTotals.awardedMarks !== report.review.score.got) {
    throw new Error(
      `Grader summary totals.awardedMarks (${normalizedSummaryTotals.awardedMarks.toString()}) must equal worksheet review.score.got (${report.review.score.got.toString()}).`,
    );
  }
  if (normalizedSummaryTotals.maxMarks !== report.review.score.total) {
    throw new Error(
      `Grader summary totals.maxMarks (${normalizedSummaryTotals.maxMarks.toString()}) must equal worksheet review.score.total (${report.review.score.total.toString()}).`,
    );
  }
  const sourceTranscriptMarkdown = await readFile(
    resolveWorkspacePath(options.rootDir, "grader/output/transcription.md"),
    { encoding: "utf8" },
  ).catch(() => "");
  const sourceReferenceMarkdown = (
    await Promise.all([
      readFile(resolveWorkspacePath(options.rootDir, "grader/output/qp-reference.md"), {
        encoding: "utf8",
      }).catch(() => ""),
      readFile(
        resolveWorkspacePath(
          options.rootDir,
          "grader/output/question-paper-reference.md",
        ),
        { encoding: "utf8" },
      ).catch(() => ""),
    ])
  )
    .filter((content) => content.trim().length > 0)
    .join("\n\n");
  const sheetPlanMarkdown = await readFile(
    resolveWorkspacePath(options.rootDir, "grader/output/sheet-plan.md"),
    { encoding: "utf8" },
  ).catch(() => "");
  const cropValidationMarkdown = await readFile(
    resolveWorkspacePath(options.rootDir, "grader/output/crop-validation.md"),
    { encoding: "utf8" },
  ).catch(() => "");
  const sourceFidelityAuditMarkdown = await readFile(
    resolveWorkspacePath(
      options.rootDir,
      "grader/output/source-fidelity-audit.md",
    ),
    { encoding: "utf8" },
  ).catch(() => "");
  const rawAgentLogMarkdown = await readFile(
    resolveWorkspacePath(options.rootDir, "logs/agent/agent.log"),
    { encoding: "utf8" },
  ).catch(() => "");
  const agentToolCallLogMarkdown = await readAgentToolCallLogMarkdown(
    options.rootDir,
  );
  const agentLogMarkdown = [rawAgentLogMarkdown, agentToolCallLogMarkdown]
    .filter((part) => part.trim().length > 0)
    .join("\n");
  const scoringBatchFileCount = await countWorkspaceJsonFiles(
    options.rootDir,
    "grader/output/scoring",
  );
  const requestPayload = await loadSparkGraderRequestPayloadFromWorkspace(
    options.rootDir,
  );
  const publishIssues = collectGraderWorksheetPublishIssues(report, {
    sourceTranscriptMarkdown,
    sourceReferenceMarkdown,
    sheetPlanMarkdown,
    cropValidationMarkdown,
    sourceFidelityAuditMarkdown,
    agentLogMarkdown,
    scoringBatchFileCount,
    requestPayload,
    runSummary: summary,
    requireSourceFidelityAudit: options.requireSourceFidelityAudit,
  });
  publishIssues.push(
    ...(await collectStaleCropValidationIssues({
      rootDir: options.rootDir,
      renderedSheetMarkdown: collectSheetMarkdown(report),
      cropValidationPath: "grader/output/crop-validation.md",
      agentLogMarkdown,
    })),
  );
  publishIssues.push(
    ...(await collectCropEdgeTouchIssues({
      rootDir: options.rootDir,
      renderedSheetMarkdown: collectSheetMarkdown(report),
    })),
  );
  if (publishIssues.length > 0) {
    throw new Error(
      `Worksheet artifact "${resolvedSheetPath}" failed publish guards: ${publishIssues.slice(0, 10).join("; ")}`,
    );
  }

  const paper: PublishedGraderSheetArtifacts["paper"] = {};
  if (summary.contextLabel) {
    paper.contextLabel = summary.contextLabel;
  }
  if (summary.year) {
    paper.year = summary.year;
  }
  if (summary.paperName) {
    paper.paperName = summary.paperName;
  }
  const paperUrl = summary.paperUrl ?? report.references?.paperUrl;
  if (paperUrl) {
    paper.paperUrl = paperUrl;
  }
  const paperStoragePath =
    summary.paperStoragePath ?? report.references?.paperStoragePath;
  if (paperStoragePath) {
    paper.paperStoragePath = paperStoragePath;
  }
  const markSchemeUrl =
    summary.markSchemeUrl ?? report.references?.markSchemeUrl;
  if (markSchemeUrl) {
    paper.markSchemeUrl = markSchemeUrl;
  }
  const markSchemeStoragePath =
    summary.markSchemeStoragePath ?? report.references?.markSchemeStoragePath;
  if (markSchemeStoragePath) {
    paper.markSchemeStoragePath = markSchemeStoragePath;
  }

  return {
    summaryPath: resolvedSummaryPath,
    sheetPath: resolvedSheetPath,
    summarySha256: createHash("sha256").update(summaryRaw).digest("hex"),
    sheetSha256: createHash("sha256").update(sheetRaw).digest("hex"),
    ...(Object.keys(paper).length > 0 ? { paper } : {}),
    presentation: {
      title: presentationTitle,
      subtitle: presentationSubtitle,
      summaryMarkdown: presentationSummary,
      footer: presentationFooter,
    },
    totals: summariseGraderTotals(summary),
    sheet: {
      filePath: resolvedSheetPath,
      title: summary.sheet.title?.trim() || report.sheet.title,
    },
    resultSummary: selectGraderResultSummary({
      runSummary: summary,
    }),
  };
}

async function validateSheetDraftWorkspaceForPublish(options: {
  rootDir: string;
  summaryPath: string;
  sheetPath: string;
  onWorkspaceFileChanged?: (filePath: string) => void;
}): Promise<PublishedSheetDraftArtifacts> {
  const normalizeWorkspacePath = (value: string): string =>
    value.replace(/\\/gu, "/").trim();

  const resolvedSummaryPath = normalizeWorkspacePath(options.summaryPath);
  const resolvedSheetPath = normalizeWorkspacePath(options.sheetPath);

  const summaryRaw = await readFile(
    resolveWorkspacePath(options.rootDir, resolvedSummaryPath),
    {
      encoding: "utf8",
    },
  ).catch((error) => {
    throw new Error(
      `Missing required worksheet draft summary "${resolvedSummaryPath}": ${errorAsString(error)}`,
    );
  });
  let summaryJson: unknown;
  try {
    summaryJson = JSON.parse(summaryRaw);
  } catch (error) {
    throw new Error(
      `Worksheet draft summary "${resolvedSummaryPath}" is invalid JSON: ${errorAsString(error)}`,
    );
  }
  const parsedSummary = GraderRunSummarySchema.safeParse(summaryJson);
  if (!parsedSummary.success) {
    throw new Error(
      `Worksheet draft summary "${resolvedSummaryPath}" failed schema validation: ${formatZodIssueSummary(parsedSummary.error)}`,
    );
  }
  const summary = parsedSummary.data;

  if (normalizeWorkspacePath(summary.sheet.filePath) !== resolvedSheetPath) {
    throw new Error(
      `Worksheet draft summary sheet.filePath must be "${resolvedSheetPath}" before publish.`,
    );
  }

  const presentationTitle = summary.presentation?.title?.trim();
  if (!presentationTitle) {
    throw new Error(
      `Worksheet draft summary "${resolvedSummaryPath}" is missing presentation.title.`,
    );
  }
  const presentationSubtitle = summary.presentation?.subtitle?.trim();
  if (!presentationSubtitle) {
    throw new Error(
      `Worksheet draft summary "${resolvedSummaryPath}" is missing presentation.subtitle.`,
    );
  }
  const presentationSummary = summary.presentation?.summaryMarkdown?.trim();
  if (!presentationSummary) {
    throw new Error(
      `Worksheet draft summary "${resolvedSummaryPath}" is missing presentation.summaryMarkdown.`,
    );
  }
  const presentationFooter = summary.presentation?.footer?.trim();
  if (!presentationFooter) {
    throw new Error(
      `Worksheet draft summary "${resolvedSummaryPath}" is missing presentation.footer.`,
    );
  }

  const sheetRaw = await readFile(
    resolveWorkspacePath(options.rootDir, resolvedSheetPath),
    {
      encoding: "utf8",
    },
  ).catch((error) => {
    throw new Error(
      `Missing required worksheet draft "${resolvedSheetPath}": ${errorAsString(error)}`,
    );
  });
  let sheetJson: unknown;
  try {
    sheetJson = JSON.parse(sheetRaw);
  } catch (error) {
    throw new Error(
      `Worksheet draft "${resolvedSheetPath}" is invalid JSON: ${errorAsString(error)}`,
    );
  }
  const parsedSheet = SparkSolveSheetDraftSchema.safeParse(sheetJson);
  let draft = parsedSheet.success
    ? parsedSheet.data
    : coerceSparkSolveSheetDraft(sheetJson);
  if (!draft) {
    const validationSummary = parsedSheet.success
      ? "Worksheet draft could not be normalized."
      : formatZodIssueSummary(parsedSheet.error);
    throw new Error(
      `Worksheet draft "${resolvedSheetPath}" failed schema validation: ${validationSummary}`,
    );
  }
  const normalizedTheme = normalizeSparkSolveSheetDraftTheme(draft);
  if (normalizedTheme.changed) {
    draft = normalizedTheme.draft;
  }
  const shouldRewriteDraft = !parsedSheet.success || normalizedTheme.changed;
  const normalizedSheetRaw = shouldRewriteDraft
    ? `${JSON.stringify(draft, null, 2)}\n`
    : sheetRaw;
  if (shouldRewriteDraft) {
    await writeFile(
      resolveWorkspacePath(options.rootDir, resolvedSheetPath),
      normalizedSheetRaw,
      {
        encoding: "utf8",
      },
    );
    options.onWorkspaceFileChanged?.(resolvedSheetPath);
  }

  let questionCount = 0;
  for (
    let sectionIndex = 0;
    sectionIndex < draft.sheet.sections.length;
    sectionIndex += 1
  ) {
    const section = draft.sheet.sections[sectionIndex];
    if (!("id" in section)) {
      continue;
    }
    const currentSectionQuestionCount = countPaperSheetQuestions(
      section.questions,
    );
    questionCount += currentSectionQuestionCount;
    const hasTheory =
      typeof section.theory === "string" && section.theory.trim().length > 0;
    const hasInfoBox = section.infoBox !== undefined;
    if (!hasTheory && !hasInfoBox && currentSectionQuestionCount === 0) {
      throw new Error(
        `Worksheet draft "${resolvedSheetPath}" has an empty content section "${section.id} ${section.label}". Preserve the source questions instead of publishing an empty section.`,
      );
    }
  }
  if (questionCount === 0) {
    throw new Error(
      `Worksheet draft "${resolvedSheetPath}" must include at least one question before publish.`,
    );
  }

  return {
    summaryPath: resolvedSummaryPath,
    sheetPath: resolvedSheetPath,
    summarySha256: createHash("sha256").update(summaryRaw).digest("hex"),
    sheetSha256: createHash("sha256").update(normalizedSheetRaw).digest("hex"),
    presentation: {
      title: presentationTitle,
      subtitle: presentationSubtitle,
      summaryMarkdown: presentationSummary,
      footer: presentationFooter,
    },
    sheet: {
      filePath: resolvedSheetPath,
      title: summary.sheet.title?.trim() || draft.sheet.title,
    },
  };
}

async function computeWorkspaceFileSha256(options: {
  rootDir: string;
  filePath: string;
}): Promise<string> {
  const raw = await readFile(
    resolveWorkspacePath(options.rootDir, options.filePath),
    {
      encoding: "utf8",
    },
  );
  return createHash("sha256").update(raw).digest("hex");
}

async function patchGraderRunStatus(options: {
  serviceAccountJson: string;
  userId: string;
  runId: string;
  updates: Record<string, unknown>;
}): Promise<void> {
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: `spark/${options.userId}/graderRuns/${options.runId}`,
    updates: options.updates,
  });
}

function resolveTutorSessionDocPath(userId: string, sessionId: string): string {
  return `spark/${userId}/tutorSessions/${sessionId}`;
}

async function readWorkspaceTextFileIfExists(options: {
  rootDir: string;
  filePath: string;
}): Promise<string | null> {
  try {
    return await readFile(
      resolveWorkspacePath(options.rootDir, options.filePath),
      {
        encoding: "utf8",
      },
    );
  } catch {
    return null;
  }
}

function buildTutorComposerState(
  overrides: Partial<SparkTutorComposerState> = {},
): SparkTutorComposerState {
  return SparkTutorComposerStateSchema.parse({
    placeholder: "Write your next thought here.",
    disabled: false,
    submitLabel: "Send",
    allowConfidence: true,
    confidenceLabel: "How sure are you?",
    hintButtons: [
      {
        id: "nudge",
        label: "Need a nudge",
        kind: "hint",
        hintLevel: "nudge",
      },
      {
        id: "pointer",
        label: "Need a pointer",
        kind: "hint",
        hintLevel: "pointer",
      },
    ],
    ...overrides,
  });
}

function parseTutorReviewStateFromWorkspace(
  raw: string | null,
): SparkTutorReviewState | null {
  if (!raw) {
    return null;
  }
  try {
    return SparkTutorReviewStateSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseWorksheetReportFromWorkspace(
  raw: string | null,
): SparkGraderWorksheetReport | null {
  if (!raw) {
    return null;
  }
  try {
    return SparkGraderWorksheetReportSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function listWorksheetQuestionIds(
  report: SparkGraderWorksheetReport,
): string[] {
  const ids: string[] = [];
  for (const section of report.sheet.sections) {
    if (!("id" in section)) {
      continue;
    }
    visitPaperSheetQuestions(section.questions, (question) => {
      ids.push(question.id);
    });
  }
  return ids;
}

function buildTutorQuestionTurnFilePath(options: {
  questionId: string;
  author: "assistant" | "student";
  now: Date;
}): string {
  const stamp = options.now.toISOString().replace(/[:.]/gu, "-");
  return `${TUTOR_FEEDBACK_ROOT_DIR}/${options.questionId}/turns/${stamp}-${options.author}.json`;
}

function summarizeTutorReviewThreads(
  reviewState: SparkTutorReviewState,
  questionIds: readonly string[],
): {
  totalThreads: number;
  resolvedThreads: number;
  respondingThreads: number;
  nextQuestionId: string | null;
  allResolved: boolean;
} {
  let resolvedThreads = 0;
  let respondingThreads = 0;
  let nextQuestionId: string | null = null;
  for (const questionId of questionIds) {
    const thread = reviewState.threads[questionId];
    if (!thread) {
      continue;
    }
    if (thread.status === "resolved") {
      resolvedThreads += 1;
      continue;
    }
    if (!nextQuestionId) {
      nextQuestionId = questionId;
    }
    if (thread.status === "responding") {
      respondingThreads += 1;
    }
  }
  const totalThreads = Object.keys(reviewState.threads).length;
  return {
    totalThreads,
    resolvedThreads,
    respondingThreads,
    nextQuestionId,
    allResolved: totalThreads === 0 || resolvedThreads === totalThreads,
  };
}

function buildTutorFocusLabelForQuestion(options: {
  report: SparkGraderWorksheetReport;
  questionId: string | null;
}): string | null {
  if (!options.questionId) {
    return null;
  }
  let counter = 1;
  for (const section of options.report.sheet.sections) {
    if (!("id" in section)) {
      continue;
    }
    let matchedLabel: string | null = null;
    visitPaperSheetQuestions(section.questions, (question) => {
      if (question.id === options.questionId) {
        matchedLabel = `Question ${counter.toString()}`;
        return;
      }
      counter += 1;
    });
    if (matchedLabel) {
      return matchedLabel;
    }
  }
  return null;
}

function buildTutorPreviewFromSummary(summary: {
  totalThreads: number;
  resolvedThreads: number;
  allResolved: boolean;
}): string {
  if (summary.totalThreads === 0) {
    return "No worksheet feedback threads are available.";
  }
  if (summary.allResolved) {
    return `All ${summary.totalThreads.toString()} worksheet feedback threads are resolved.`;
  }
  const remaining = summary.totalThreads - summary.resolvedThreads;
  if (remaining === 1) {
    return "1 worksheet question still needs revision.";
  }
  return `${remaining.toString()} worksheet questions still need revision.`;
}

function stringifyJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function firstNonEmptyLine(markdown: string): string | undefined {
  for (const line of markdown.split(/\r?\n/gu)) {
    const trimmed = line
      .replace(/^[#>*\-\d.\s]+/gu, "")
      .replace(/[*_`]/gu, "")
      .trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function formatTutorHistoryForPrompt(historyText: string | null): string {
  const trimmed = historyText?.trim();
  if (!trimmed) {
    return "No committed turns yet.";
  }
  const lines = trimmed.split(/\r?\n/gu);
  const rendered: string[] = [];
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const entry = SparkTutorHistoryEntrySchema.parse(JSON.parse(line));
      const label =
        entry.role === "assistant"
          ? "Tutor"
          : entry.kind === "hint_request"
            ? "Student hint request"
            : "Student";
      const metaParts: string[] = [];
      if (entry.confidence) {
        metaParts.push(`confidence=${entry.confidence}`);
      }
      if (entry.hintLevel) {
        metaParts.push(`hint=${entry.hintLevel}`);
      }
      const meta = metaParts.length > 0 ? ` (${metaParts.join(", ")})` : "";
      rendered.push(`${label}${meta}: ${entry.text}`);
    } catch {
      rendered.push(line);
    }
  }
  return rendered.join("\n");
}

async function writeTutorWorkspaceTextFile(options: {
  rootDir: string;
  workspaceSync: WorkspaceSync | undefined;
  filePath: string;
  content: string;
  flushNow?: boolean;
}): Promise<void> {
  const absolutePath = resolveWorkspacePath(options.rootDir, options.filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, options.content, { encoding: "utf8" });
  options.workspaceSync?.scheduleUpdate(options.filePath);
  if (options.flushNow) {
    await options.workspaceSync?.flushNow(options.filePath);
  }
}

async function appendTutorHistoryEntryFile(options: {
  rootDir: string;
  workspaceSync: WorkspaceSync | undefined;
  entry: unknown;
}): Promise<void> {
  const parsed = SparkTutorHistoryEntrySchema.parse(options.entry);
  const existing =
    (await readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_HISTORY_TURNS_PATH,
    })) ?? "";
  const trimmed = existing.trimEnd();
  const line = JSON.stringify(parsed);
  const next = trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
  await writeTutorWorkspaceTextFile({
    rootDir: options.rootDir,
    workspaceSync: options.workspaceSync,
    filePath: TUTOR_HISTORY_TURNS_PATH,
    content: next,
  });
}

type TutorWorkspaceSnapshot = {
  problem: string;
  officialSolution: string;
  transcript: string;
  grading: string;
  annotations: string;
  overallFeedback: string;
  tutorMarkdown: string;
  historyText: string;
};

async function readTutorWorkspaceSnapshot(options: {
  rootDir: string;
}): Promise<TutorWorkspaceSnapshot> {
  const [
    problem,
    officialSolution,
    transcript,
    grading,
    annotations,
    overallFeedback,
    tutorMarkdown,
    historyText,
  ] = await Promise.all([
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_PROBLEM_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_OFFICIAL_SOLUTION_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_STUDENT_TRANSCRIPT_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_GRADING_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_ANNOTATIONS_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_CONTEXT_OVERALL_FEEDBACK_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_UI_TOP_PANEL_PATH,
    }),
    readWorkspaceTextFileIfExists({
      rootDir: options.rootDir,
      filePath: TUTOR_HISTORY_TURNS_PATH,
    }),
  ]);
  return {
    problem: problem ?? "",
    officialSolution: officialSolution ?? "",
    transcript: transcript ?? "",
    grading: grading ?? "",
    annotations: annotations ?? "",
    overallFeedback: overallFeedback ?? "",
    tutorMarkdown: tutorMarkdown ?? "",
    historyText: historyText ?? "",
  };
}

function buildTutorTurnPrompt(options: {
  sessionTitle: string;
  action: "initial" | "reply" | "hint";
  sourceLabel: string;
  snapshot: TutorWorkspaceSnapshot;
  studentText?: string;
  studentConfidence?: string;
  hintLevel?: string;
}): string {
  const actionLines = (() => {
    if (options.action === "initial") {
      return [
        "This is the first tutor turn.",
        "Open by naming one thing the student did well and one critical gap to focus on.",
      ];
    }
    if (options.action === "hint") {
      return [
        `The student explicitly requested a hint (${options.hintLevel ?? "nudge"}).`,
        "Give only the requested level of help and keep the student doing the work.",
      ];
    }
    return [
      `Latest student reply: ${options.studentText ?? ""}`,
      options.studentConfidence
        ? `Student confidence: ${options.studentConfidence}`
        : "Student confidence: not provided",
    ];
  })();

  return [
    `Session: ${options.sessionTitle}`,
    `Source: ${options.sourceLabel}`,
    `Turn action: ${options.action}`,
    ...actionLines,
    "",
    "Current tutor panel:",
    options.snapshot.tutorMarkdown || "(empty)",
    "",
    "Problem:",
    options.snapshot.problem || "(missing)",
    "",
    "Official solution baseline:",
    options.snapshot.officialSolution || "(missing)",
    "",
    "Original student transcript:",
    options.snapshot.transcript || "(missing)",
    "",
    "Grading summary:",
    options.snapshot.grading || "(missing)",
    "",
    "Annotation and feedback:",
    options.snapshot.annotations || "(missing)",
    "",
    "Overall feedback:",
    options.snapshot.overallFeedback || "(missing)",
    "",
    "Committed session history:",
    formatTutorHistoryForPrompt(options.snapshot.historyText),
  ].join("\n");
}

function decodeHtmlToText(input: string): string {
  return input
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

async function readResponseBytesWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(
        `Response too large (${contentLength.toString()} bytes); limit is ${maxBytes.toString()} bytes.`,
      );
    }
  }

  const body = response.body;
  if (!body) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error(
        `Response exceeded ${maxBytes.toString()} bytes while downloading.`,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

function resolveFirestoreDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") {
    return undefined;
  }
  const resolved = (toDate as (this: unknown) => unknown).call(value);
  if (resolved instanceof Date) {
    return resolved;
  }
  return undefined;
}

function resolveContentType(filePath: string): string | undefined {
  return resolveWorkspacePathContentType(filePath);
}

function clampToUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function toCropPixelsFromNorm(options: {
  width: number;
  height: number;
  left: number;
  top: number;
  widthNorm: number;
  heightNorm: number;
}): { left: number; top: number; right: number; bottom: number } {
  const leftNorm = clampToUnit(options.left);
  const topNorm = clampToUnit(options.top);
  const rightNorm = clampToUnit(options.left + options.widthNorm);
  const bottomNorm = clampToUnit(options.top + options.heightNorm);
  const left = Math.max(
    0,
    Math.min(options.width - 1, Math.floor(leftNorm * options.width)),
  );
  const top = Math.max(
    0,
    Math.min(options.height - 1, Math.floor(topNorm * options.height)),
  );
  const right = Math.max(
    left + 1,
    Math.min(options.width, Math.ceil(rightNorm * options.width)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(options.height, Math.ceil(bottomNorm * options.height)),
  );
  return { left, top, right, bottom };
}

function toCropPixelsFrom1000(options: {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): { left: number; top: number; right: number; bottom: number } {
  const normalized = {
    left: clampToUnit(options.left / 1000),
    top: clampToUnit(options.top / 1000),
    right: clampToUnit(options.right / 1000),
    bottom: clampToUnit(options.bottom / 1000),
  };
  const left = Math.max(
    0,
    Math.min(options.width - 1, Math.floor(normalized.left * options.width)),
  );
  const top = Math.max(
    0,
    Math.min(options.height - 1, Math.floor(normalized.top * options.height)),
  );
  const right = Math.max(
    left + 1,
    Math.min(options.width, Math.ceil(normalized.right * options.width)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(options.height, Math.ceil(normalized.bottom * options.height)),
  );
  return { left, top, right, bottom };
}

function toCropPixelsFromPixels(options: {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): { left: number; top: number; right: number; bottom: number } {
  const left = Math.max(
    0,
    Math.min(options.width - 1, Math.floor(options.left)),
  );
  const top = Math.max(
    0,
    Math.min(options.height - 1, Math.floor(options.top)),
  );
  const right = Math.max(
    left + 1,
    Math.min(options.width, Math.ceil(options.right)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(options.height, Math.ceil(options.bottom)),
  );
  return { left, top, right, bottom };
}

function resolveImageMimeTypeFromSharpFormat(options: {
  format: string | undefined;
}): string | undefined {
  if (
    typeof options.format !== "string" ||
    options.format.trim().length === 0
  ) {
    return undefined;
  }
  const normalized = options.format.trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") {
    return "image/jpeg";
  }
  if (normalized === "png") {
    return "image/png";
  }
  if (normalized === "webp") {
    return "image/webp";
  }
  if (normalized === "gif") {
    return "image/gif";
  }
  if (normalized === "heic") {
    return "image/heic";
  }
  if (normalized === "heif") {
    return "image/heif";
  }
  return undefined;
}

function isSupportedCropImageMimeType(
  contentType: string | undefined,
): boolean {
  if (typeof contentType !== "string" || contentType.trim().length === 0) {
    return false;
  }
  const normalized = contentType.trim().toLowerCase();
  return SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPE_SET.has(normalized);
}

async function cropImageToPngBuffer(options: {
  source: Buffer;
  left: number;
  top: number;
  right: number;
  bottom: number;
  extend?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}): Promise<Buffer> {
  const cropWidth = Math.max(1, options.right - options.left);
  const cropHeight = Math.max(1, options.bottom - options.top);
  const sharp = getSharp();
  const image = sharp(options.source).extract({
    left: options.left,
    top: options.top,
    width: cropWidth,
    height: cropHeight,
  });
  const extend = options.extend;
  if (
    extend &&
    (extend.top > 0 || extend.right > 0 || extend.bottom > 0 || extend.left > 0)
  ) {
    return await image
      .extend({
        top: extend.top,
        right: extend.right,
        bottom: extend.bottom,
        left: extend.left,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
  }
  return await image.png().toBuffer();
}

type ImageRgbaColor = {
  r: number;
  g: number;
  b: number;
  alpha: number;
};

function clampImageChannel(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(255, Math.round(value)));
}

function readImageRawPixel(options: {
  data: Uint8Array;
  width: number;
  channels: number;
  x: number;
  y: number;
}): ImageRgbaColor {
  const offset = (options.y * options.width + options.x) * options.channels;
  return {
    r: options.data[offset] ?? 0,
    g: options.data[offset + 1] ?? 0,
    b: options.data[offset + 2] ?? 0,
    alpha: options.channels >= 4 ? (options.data[offset + 3] ?? 255) : 255,
  };
}

function averageImageColor(colors: readonly ImageRgbaColor[]): ImageRgbaColor {
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
    alpha += color.alpha;
  }
  const count = Math.max(1, colors.length);
  return {
    r: clampImageChannel(r / count),
    g: clampImageChannel(g / count),
    b: clampImageChannel(b / count),
    alpha: clampImageChannel(alpha / count),
  };
}

function detectImageForegroundBounds(options: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
  fuzzPercent: number;
}): {
  hasForeground: boolean;
  left: number;
  top: number;
  right: number;
  bottom: number;
  tolerance: number;
} {
  if (options.width <= 0 || options.height <= 0) {
    throw new Error("Image dimensions must be positive.");
  }
  if (options.channels < 3) {
    throw new Error(
      `Expected RGB(A) image, received ${options.channels.toString()} channel(s).`,
    );
  }

  const samplePoints = [
    { x: 0, y: 0 },
    { x: options.width - 1, y: 0 },
    { x: 0, y: options.height - 1 },
    { x: options.width - 1, y: options.height - 1 },
    { x: Math.floor(options.width / 2), y: 0 },
    { x: 0, y: Math.floor(options.height / 2) },
    { x: options.width - 1, y: Math.floor(options.height / 2) },
    { x: Math.floor(options.width / 2), y: options.height - 1 },
  ];

  const background = averageImageColor(
    samplePoints.map((point) =>
      readImageRawPixel({
        data: options.data,
        width: options.width,
        channels: options.channels,
        x: point.x,
        y: point.y,
      }),
    ),
  );
  const tolerance = Math.max(
    0,
    Math.min(255, Math.round((options.fuzzPercent / 100) * 255)),
  );

  let minX = options.width;
  let minY = options.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < options.height; y += 1) {
    for (let x = 0; x < options.width; x += 1) {
      const color = readImageRawPixel({
        data: options.data,
        width: options.width,
        channels: options.channels,
        x,
        y,
      });
      const delta = Math.max(
        Math.abs(color.r - background.r),
        Math.abs(color.g - background.g),
        Math.abs(color.b - background.b),
        Math.abs(color.alpha - background.alpha),
      );
      if (delta <= tolerance) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      hasForeground: false,
      left: 0,
      top: 0,
      right: options.width,
      bottom: options.height,
      tolerance,
    };
  }

  return {
    hasForeground: true,
    left: minX,
    top: minY,
    right: maxX + 1,
    bottom: maxY + 1,
    tolerance,
  };
}

function expandImageBounds(options: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  paddingPx: number;
  width: number;
  height: number;
}): { left: number; top: number; right: number; bottom: number } {
  const left = Math.max(0, options.left - options.paddingPx);
  const top = Math.max(0, options.top - options.paddingPx);
  const right = Math.min(options.width, options.right + options.paddingPx);
  const bottom = Math.min(options.height, options.bottom + options.paddingPx);
  if (right <= left || bottom <= top) {
    return {
      left: 0,
      top: 0,
      right: options.width,
      bottom: options.height,
    };
  }
  return { left, top, right, bottom };
}

function expandCropPixelsWithMargin(options: {
  pixels: { left: number; top: number; right: number; bottom: number };
  sourceWidth: number;
  sourceHeight: number;
  marginPx: number;
}): {
  pixels: { left: number; top: number; right: number; bottom: number };
  outputPadding: { top: number; right: number; bottom: number; left: number };
} {
  const marginPx = Math.max(0, Math.floor(options.marginPx));
  if (marginPx <= 0) {
    return {
      pixels: options.pixels,
      outputPadding: { top: 0, right: 0, bottom: 0, left: 0 },
    };
  }

  const requestedLeft = options.pixels.left - marginPx;
  const requestedTop = options.pixels.top - marginPx;
  const requestedRight = options.pixels.right + marginPx;
  const requestedBottom = options.pixels.bottom + marginPx;
  const left = Math.max(0, requestedLeft);
  const top = Math.max(0, requestedTop);
  const right = Math.min(options.sourceWidth, requestedRight);
  const bottom = Math.min(options.sourceHeight, requestedBottom);

  return {
    pixels: {
      left,
      top,
      right: Math.max(left + 1, right),
      bottom: Math.max(top + 1, bottom),
    },
    outputPadding: {
      top: Math.max(0, -requestedTop),
      right: Math.max(0, requestedRight - options.sourceWidth),
      bottom: Math.max(0, requestedBottom - options.sourceHeight),
      left: Math.max(0, -requestedLeft),
    },
  };
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

function capUtf8Text(value: string, maxBytes: number): string {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return "";
  }
  if (Buffer.byteLength(value, "utf8") <= maxBytes) {
    return value;
  }
  const marker = "\n\n[truncated]\n";
  const totalBytes = Buffer.byteLength(value, "utf8");
  const ratio = maxBytes / Math.max(1, totalBytes);
  let end = Math.max(0, Math.floor(value.length * ratio));
  let slice = value.slice(0, end);
  while (end > 0 && Buffer.byteLength(slice + marker, "utf8") > maxBytes) {
    end = Math.floor(end * 0.9);
    slice = value.slice(0, end);
  }
  return slice + marker;
}

type ExtractTextDebugInlineAttachment = {
  index: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  labelText: string | null;
  bytes: Buffer;
};

function resolveInlineDataExtension(mimeType: string): string {
  const normalized = (mimeType.split(";")[0] ?? "").trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg": {
      return "jpg";
    }
    case "image/png": {
      return "png";
    }
    case "image/webp": {
      return "webp";
    }
    case "image/gif": {
      return "gif";
    }
    case "image/heic": {
      return "heic";
    }
    case "image/heif": {
      return "heif";
    }
    case "application/pdf": {
      return "pdf";
    }
    case "text/plain": {
      return "txt";
    }
    case "text/markdown": {
      return "md";
    }
    case "application/json": {
      return "json";
    }
  }
  const slashIndex = normalized.indexOf("/");
  if (slashIndex >= 0) {
    const subtype = normalized.slice(slashIndex + 1).split("+")[0] ?? "";
    const cleaned = subtype.replace(/[^a-z0-9]+/gu, "");
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return "bin";
}

function renderExtractTextPromptWithInlineData(options: {
  parts: readonly LlmContentPart[];
}): {
  promptText: string;
  inlineAttachments: ExtractTextDebugInlineAttachment[];
} {
  const sections: string[] = [];
  const inlineAttachments: ExtractTextDebugInlineAttachment[] = [];
  let lastTextLabel: string | null = null;
  for (const part of options.parts) {
    if (part.type === "text") {
      sections.push(part.text);
      const trimmed = part.text.trim();
      if (trimmed.length > 0) {
        const lines = trimmed.split("\n");
        const lastLine = lines[lines.length - 1];
        lastTextLabel = typeof lastLine === "string" ? lastLine.trim() : null;
      } else {
        lastTextLabel = null;
      }
      continue;
    }
    if (part.type !== "inlineData") {
      const nextIndex = inlineAttachments.length + 1;
      const labelText =
        lastTextLabel ??
        `Attachment ${nextIndex.toString()} uses ${part.type} transport.`;
      sections.push(
        [
          "----------",
          labelText,
          `attachment_type=${part.type} debug_payload=omitted`,
          "----------",
        ].join("\n"),
      );
      lastTextLabel = null;
      continue;
    }
    const mimeType =
      typeof part.mimeType === "string" && part.mimeType.trim().length > 0
        ? part.mimeType.trim().toLowerCase()
        : "application/octet-stream";
    const bytes = Buffer.from(part.data, "base64");
    const nextIndex = inlineAttachments.length + 1;
    const filename = `inline-data-${nextIndex.toString()}.${resolveInlineDataExtension(mimeType)}`;
    const labelText =
      lastTextLabel ??
      `Inline data ${nextIndex.toString()} follows as inline data.`;
    sections.push(
      [
        "----------",
        labelText,
        `file=${filename} mime=${mimeType} size=${formatByteSize(bytes.length)}`,
        "----------",
      ].join("\n"),
    );
    inlineAttachments.push({
      index: nextIndex,
      filename,
      mimeType,
      sizeBytes: bytes.length,
      labelText: lastTextLabel,
      bytes,
    });
    lastTextLabel = null;
  }
  return {
    promptText: sections.join("\n\n"),
    inlineAttachments,
  };
}

async function persistExtractTextRequestDebugArtifacts(options: {
  debugRootDir: string;
  toolIdSegment: string;
  promptText: string;
  promptChars: number;
  modelId: string;
  outputPath: string;
  documentPaths: readonly string[];
  supportingPaths: readonly string[];
  instructions?: string;
  supportingInstructions?: string;
  inlineAttachments: readonly ExtractTextDebugInlineAttachment[];
}): Promise<void> {
  const maxBytes = 900_000;
  const baseDir = path.join(
    options.debugRootDir,
    "extract_text",
    options.toolIdSegment,
  );
  await ensureDir(baseDir);
  await writeFile(
    path.join(baseDir, "prompt.txt"),
    capUtf8Text(options.promptText, maxBytes),
    {
      encoding: "utf8",
    },
  );
  for (const attachment of options.inlineAttachments) {
    await writeFile(path.join(baseDir, attachment.filename), attachment.bytes);
  }
  const requestMetadata = {
    capturedAt: new Date().toISOString(),
    modelId: options.modelId,
    outputPath: options.outputPath,
    promptChars: options.promptChars,
    documentPaths: options.documentPaths,
    supportingPaths: options.supportingPaths,
    ...(typeof options.instructions === "string" &&
    options.instructions.trim().length > 0
      ? { instructions: options.instructions }
      : {}),
    ...(typeof options.supportingInstructions === "string" &&
    options.supportingInstructions.trim().length > 0
      ? { supportingInstructions: options.supportingInstructions }
      : {}),
    inlineDataFiles: options.inlineAttachments.map((attachment) => ({
      index: attachment.index,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      labelText: attachment.labelText,
    })),
  };
  await writeFile(
    path.join(baseDir, "request.metadata.json"),
    `${JSON.stringify(requestMetadata, null, 2)}\n`,
    {
      encoding: "utf8",
    },
  );
}

async function persistExtractTextResponseDebugArtifacts(options: {
  debugRootDir: string;
  toolIdSegment: string;
  responseText: string;
  thinkingText: string;
  modelId: string;
  modelVersion?: string;
  elapsedMs?: number;
  costUsd?: number | null;
  usageTokens: unknown;
  thinkingTokens: number | null;
  streamedResponseChars: number;
  streamedResponseBytes: number;
}): Promise<void> {
  const maxBytes = 900_000;
  const baseDir = path.join(
    options.debugRootDir,
    "extract_text",
    options.toolIdSegment,
  );
  await ensureDir(baseDir);
  await writeFile(
    path.join(baseDir, "response.txt"),
    capUtf8Text(options.responseText, maxBytes),
    {
      encoding: "utf8",
    },
  );
  await writeFile(
    path.join(baseDir, "thinking.txt"),
    capUtf8Text(options.thinkingText, maxBytes),
    {
      encoding: "utf8",
    },
  );
  const responseMetadata = {
    capturedAt: new Date().toISOString(),
    modelId: options.modelId,
    ...(typeof options.modelVersion === "string" &&
    options.modelVersion.trim().length > 0
      ? { modelVersion: options.modelVersion }
      : {}),
    ...(typeof options.elapsedMs === "number" &&
    Number.isFinite(options.elapsedMs)
      ? { elapsedMs: options.elapsedMs }
      : {}),
    ...(typeof options.costUsd === "number" && Number.isFinite(options.costUsd)
      ? { costUsd: options.costUsd }
      : {}),
    usageTokens: options.usageTokens,
    thinkingTokens: options.thinkingTokens,
    thinkingTextChars: options.thinkingText.length,
    responseTextChars: options.responseText.length,
    streamedResponseChars: options.streamedResponseChars,
    streamedResponseBytes: options.streamedResponseBytes,
  };
  await writeFile(
    path.join(baseDir, "response.metadata.json"),
    `${JSON.stringify(responseMetadata, null, 2)}\n`,
    {
      encoding: "utf8",
    },
  );
}

type SparkAgentPendingFilesystemMove = {
  fromAbsolutePath: string;
  fromPath: string;
  toAbsolutePath: string;
  toPath: string;
  destinationWritten: boolean;
};

export function resolveSparkAgentFilesystemToolNames(): readonly string[] {
  return Object.keys(createCodexFilesystemToolSet());
}

export function buildSparkAgentFilesystemToolConfig(options: {
  workspace: SparkAgentWorkspace;
  rootDir: string;
}): AgentFilesystemToolConfig {
  const rootDir = path.resolve(options.rootDir);
  const baseFilesystem = createNodeAgentFilesystem();
  const pendingMovesBySource = new Map<
    string,
    SparkAgentPendingFilesystemMove
  >();
  const pendingMovesByDestination = new Map<
    string,
    SparkAgentPendingFilesystemMove
  >();

  const clearPendingMove = (move: SparkAgentPendingFilesystemMove): void => {
    pendingMovesBySource.delete(move.fromAbsolutePath);
    pendingMovesByDestination.delete(move.toAbsolutePath);
  };

  const registerPendingMove = (
    context: AgentFilesystemToolAccessContext,
  ): void => {
    if (
      typeof context.fromPath !== "string" ||
      typeof context.toPath !== "string"
    ) {
      return;
    }
    const existingSource = pendingMovesBySource.get(context.fromPath);
    if (existingSource) {
      clearPendingMove(existingSource);
    }
    const existingDestination = pendingMovesByDestination.get(context.toPath);
    if (existingDestination) {
      clearPendingMove(existingDestination);
    }
    const pendingMove: SparkAgentPendingFilesystemMove = {
      fromAbsolutePath: context.fromPath,
      fromPath: resolveWorkspaceRelativePath(rootDir, context.fromPath),
      toAbsolutePath: context.toPath,
      toPath: resolveWorkspaceRelativePath(rootDir, context.toPath),
      destinationWritten: false,
    };
    pendingMovesBySource.set(pendingMove.fromAbsolutePath, pendingMove);
    pendingMovesByDestination.set(pendingMove.toAbsolutePath, pendingMove);
  };

  const filesystem: AgentFilesystem = {
    readTextFile: async (filePath) => {
      return await baseFilesystem.readTextFile(filePath);
    },
    writeTextFile: async (filePath, content) => {
      const pendingMove = pendingMovesByDestination.get(filePath);
      try {
        await baseFilesystem.writeTextFile(filePath, content);
      } catch (error) {
        if (pendingMove) {
          clearPendingMove(pendingMove);
        }
        throw error;
      }
      if (pendingMove) {
        pendingMove.destinationWritten = true;
        return;
      }
      options.workspace.scheduleUpdate(
        resolveWorkspaceRelativePath(rootDir, filePath),
      );
    },
    deleteFile: async (filePath) => {
      const pendingMove = pendingMovesBySource.get(filePath);
      try {
        await baseFilesystem.deleteFile(filePath);
      } catch (error) {
        if (pendingMove?.destinationWritten) {
          clearPendingMove(pendingMove);
          options.workspace.scheduleUpdate(pendingMove.toPath);
        }
        throw error;
      }
      if (pendingMove?.destinationWritten) {
        clearPendingMove(pendingMove);
        await options.workspace.moveFile(
          pendingMove.fromPath,
          pendingMove.toPath,
        );
        return;
      }
      if (pendingMove) {
        clearPendingMove(pendingMove);
      }
      await options.workspace.deleteFile(
        resolveWorkspaceRelativePath(rootDir, filePath),
      );
    },
    ensureDir: async (directoryPath) => {
      await baseFilesystem.ensureDir(directoryPath);
    },
    readDir: async (directoryPath) => {
      return await baseFilesystem.readDir(directoryPath);
    },
    stat: async (entryPath) => {
      return await baseFilesystem.stat(entryPath);
    },
  };

  const readBinaryFile = baseFilesystem.readBinaryFile;
  if (typeof readBinaryFile === "function") {
    filesystem.readBinaryFile = async (filePath) => {
      return await readBinaryFile.call(baseFilesystem, filePath);
    };
  }

  return {
    profile: SPARK_AGENT_FILESYSTEM_TOOL_PROFILE,
    options: {
      cwd: rootDir,
      fs: filesystem,
      allowOutsideCwd: false,
      checkAccess: (context) => {
        if (context.action === "move") {
          registerPendingMove(context);
        }
      },
    },
  };
}

class WorkspaceSync {
  private serviceAccountJson: string;
  private userId: string;
  private workspaceId: string;
  private bucketName: string;
  private rootDir: string;
  private fileMeta = new Map<string, WorkspaceFileMeta>();
  private discoveredLinkAttachments: ResolvedAttachmentInput[] = [];

  constructor(options: WorkspaceSyncOptions) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.bucketName = options.bucketName;
    this.rootDir = options.rootDir;
  }

  private filesCollectionPath(): string {
    return buildWorkspaceFilesCollectionPath({
      userId: this.userId,
      workspaceId: this.workspaceId,
    });
  }

  private fileDocPath(filePath: string): string {
    return buildWorkspaceFileDocPath({
      userId: this.userId,
      workspaceId: this.workspaceId,
      filePath,
    });
  }

  private ensureMeta(filePath: string): WorkspaceFileMeta {
    const existing = this.fileMeta.get(filePath);
    if (existing) {
      return existing;
    }
    const created = {
      lastWriteAt: 0,
      pending: false,
      disposed: false,
    };
    this.fileMeta.set(filePath, created);
    return created;
  }

  getDiscoveredLinkAttachments(): ResolvedAttachmentInput[] {
    return mergeAttachmentInputs({
      primary: this.discoveredLinkAttachments,
      secondary: [],
    });
  }

  private recordDiscoveredLinkAttachment(entry: ResolvedAttachmentInput): void {
    this.discoveredLinkAttachments = mergeAttachmentInputs({
      primary: this.discoveredLinkAttachments,
      secondary: [entry],
    });
  }

  private async materializeWorkspaceStorageLinkFile(options: {
    filePath: string;
    storagePath: string;
    contentType: string;
    sizeBytes?: number;
    createdAt?: Date;
    updatedAt?: Date;
  }): Promise<void> {
    const objectName = normalizeStorageObjectName(options.storagePath);
    if (objectName.length === 0) {
      return;
    }
    let downloaded:
      | {
          bytes: Uint8Array;
          contentType: string | null;
        }
      | undefined;
    try {
      downloaded = await downloadStorageObject({
        serviceAccountJson: this.serviceAccountJson,
        bucketName: this.bucketName,
        objectName,
      });
    } catch (error) {
      console.warn(
        `Failed to materialize workspace storage link "${options.storagePath}" for "${options.filePath}": ${errorAsString(error)}`,
      );
      return;
    }
    const resolvedPath = resolveWorkspacePath(this.rootDir, options.filePath);
    await ensureDir(path.dirname(resolvedPath));
    await writeFile(resolvedPath, Buffer.from(downloaded.bytes));
    const normalizedPath = options.filePath.replace(/\\/gu, "/");
    const filename = path.posix.basename(normalizedPath).trim();
    const attachmentSizeBytes =
      typeof options.sizeBytes === "number" &&
      Number.isFinite(options.sizeBytes) &&
      options.sizeBytes > 0
        ? Math.floor(options.sizeBytes)
        : downloaded.bytes.byteLength;
    this.recordDiscoveredLinkAttachment({
      id: normalizedPath,
      storagePath: options.storagePath,
      contentType: options.contentType,
      ...(filename.length > 0 ? { filename } : {}),
      sizeBytes: Math.max(1, attachmentSizeBytes),
    });
    const meta = this.ensureMeta(options.filePath);
    meta.createdAt = options.createdAt ?? meta.createdAt;
    meta.updatedAt = options.updatedAt ?? meta.updatedAt;
    meta.lastWriteAt =
      (options.updatedAt ?? options.createdAt)?.getTime() ?? meta.lastWriteAt;
  }

  async load(): Promise<void> {
    const docs = await listFirestoreDocuments({
      serviceAccountJson: this.serviceAccountJson,
      collectionPath: this.filesCollectionPath(),
      limit: 1000,
      orderBy: "path asc",
    });
    if (docs.length === 0) {
      return;
    }
    for (const doc of docs) {
      const data = doc.data ?? {};
      const rawPath = resolveWorkspaceFilePathFromFirestoreDocument({
        documentPath: doc.documentPath,
        storedPath: data.path,
      });
      if (!rawPath) {
        continue;
      }
      const content = typeof data.content === "string" ? data.content : "";
      const createdAt = resolveFirestoreDate(data.createdAt);
      const updatedAt = resolveFirestoreDate(data.updatedAt);
      const parsedWorkspaceFile = SparkAgentWorkspaceFileSchema.safeParse({
        ...data,
        path: rawPath,
      });
      if (
        parsedWorkspaceFile.success &&
        parsedWorkspaceFile.data.type === "storage_link"
      ) {
        await this.materializeWorkspaceStorageLinkFile({
          filePath: rawPath,
          storagePath: parsedWorkspaceFile.data.storagePath,
          contentType: parsedWorkspaceFile.data.contentType,
          sizeBytes: parsedWorkspaceFile.data.sizeBytes,
          createdAt,
          updatedAt,
        });
        continue;
      }
      const resolved = resolveWorkspacePath(this.rootDir, rawPath);
      await ensureDir(path.dirname(resolved));
      await writeFile(resolved, content, { encoding: "utf8" });
      const meta = this.ensureMeta(rawPath);
      meta.createdAt = createdAt ?? meta.createdAt;
      meta.updatedAt = updatedAt ?? meta.updatedAt;
      meta.lastWriteAt =
        updatedAt?.getTime() ?? createdAt?.getTime() ?? meta.lastWriteAt;
    }
  }

  scheduleUpdate(filePath: string): void {
    const meta = this.ensureMeta(filePath);
    if (meta.disposed) {
      return;
    }
    meta.pending = true;
    if (meta.inFlight) {
      return;
    }
    if (meta.timer) {
      return;
    }
    const now = Date.now();
    const elapsed = now - meta.lastWriteAt;
    if (elapsed >= WORKSPACE_UPDATE_THROTTLE_MS) {
      void this.startFlush(filePath, { force: false }).catch((error) => {
        console.warn(
          `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
        );
      });
      return;
    }
    const delay = Math.max(0, WORKSPACE_UPDATE_THROTTLE_MS - elapsed);
    meta.timer = setTimeout(() => {
      meta.timer = undefined;
      void this.startFlush(filePath, { force: false }).catch((error) => {
        console.warn(
          `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
        );
      });
    }, delay);
  }

  async flushNow(filePath: string): Promise<void> {
    const meta = this.ensureMeta(filePath);
    if (meta.disposed) {
      return;
    }
    meta.pending = true;
    if (meta.timer) {
      clearTimeout(meta.timer);
      meta.timer = undefined;
    }
    if (meta.inFlight) {
      await meta.inFlight.catch(() => undefined);
    }
    await this.startFlush(filePath, { force: true });
  }

  async deleteFile(filePath: string): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (meta) {
      meta.disposed = true;
      meta.pending = false;
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      await meta.inFlight?.catch(() => undefined);
    }
    this.fileMeta.delete(filePath);
    await deleteFirestoreDocument({
      serviceAccountJson: this.serviceAccountJson,
      documentPath: this.fileDocPath(filePath),
    }).catch(() => undefined);
  }

  async moveFile(fromPath: string, toPath: string): Promise<void> {
    const meta = this.fileMeta.get(fromPath);
    const fromCreatedAt = meta?.createdAt;
    if (meta) {
      meta.disposed = true;
      meta.pending = false;
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      await meta.inFlight?.catch(() => undefined);
    }
    this.fileMeta.delete(fromPath);
    await deleteFirestoreDocument({
      serviceAccountJson: this.serviceAccountJson,
      documentPath: this.fileDocPath(fromPath),
    }).catch(() => undefined);
    const toMeta = this.ensureMeta(toPath);
    if (fromCreatedAt && !toMeta.createdAt) {
      toMeta.createdAt = fromCreatedAt;
    }
    this.scheduleUpdate(toPath);
  }

  async flushAll(): Promise<void> {
    const entries = Array.from(this.fileMeta.entries());
    const tasks: Promise<void>[] = [];
    for (const [filePath, meta] of entries) {
      if (meta.disposed) {
        continue;
      }
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      const now = Date.now();
      const elapsed = now - meta.lastWriteAt;
      const delay = Math.max(0, WORKSPACE_UPDATE_THROTTLE_MS - elapsed);
      tasks.push(
        (async () => {
          if (meta.inFlight) {
            await meta.inFlight;
          }
          if (!meta.pending) {
            return;
          }
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          await this.startFlush(filePath, { force: true });
        })(),
      );
    }
    await Promise.all(tasks);
  }

  private async startFlush(
    filePath: string,
    { force }: { force: boolean },
  ): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (!meta || meta.disposed) {
      return;
    }
    if (!meta.pending && !force) {
      return;
    }
    if (meta.timer) {
      clearTimeout(meta.timer);
      meta.timer = undefined;
    }
    if (meta.inFlight) {
      await meta.inFlight;
      return;
    }

    // Reserve the write slot immediately so subsequent scheduleUpdate() calls
    // don't accidentally bypass the per-doc throttle while the write is in flight.
    meta.pending = false;
    meta.lastWriteAt = Date.now();
    const promise = this.flushPath(filePath)
      .catch((error) => {
        if (!meta.disposed) {
          meta.pending = true;
        }
        throw error;
      })
      .finally(() => {
        meta.inFlight = undefined;
        if (!meta.disposed && meta.pending) {
          this.scheduleUpdate(filePath);
        }
      });
    meta.inFlight = promise;
    await promise;
  }

  private async flushPath(filePath: string): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (!meta || meta.disposed) {
      return;
    }
    const resolved = resolveWorkspacePath(this.rootDir, filePath);
    try {
      const now = new Date();
      const createdAt = meta.createdAt ?? now;
      meta.createdAt = createdAt;
      meta.updatedAt = now;
      meta.lastWriteAt = Date.now();
      await persistWorkspaceFileFromLocalFs({
        serviceAccountJson: this.serviceAccountJson,
        userId: this.userId,
        workspaceId: this.workspaceId,
        filePath,
        absoluteFilePath: resolved,
        bucketName: this.bucketName,
        createdAt,
        updatedAt: now,
      });
    } catch (error) {
      throw new Error(
        `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
      );
    }
  }
}

function resolveUsageNumber(value: number | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return 0;
}

type CallTokenState = {
  promptTokens: number;
  cachedTokens: number;
  responseTokens: number;
  responseImageTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  toolUsePromptTokens: number;
};

function createEmptyCallTokenState(): CallTokenState {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    responseTokens: 0,
    responseImageTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    toolUsePromptTokens: 0,
  };
}

class AgentRunStatsTracker {
  private readonly primaryModelId: string;
  private modelCalls = 0;
  private readonly modelsUsed = new Set<string>();
  private readonly tokens: CallTokenState = createEmptyCallTokenState();
  private modelCostUsd = 0;
  private toolCalls = 0;
  private readonly toolCallsByName = new Map<string, number>();
  private toolCostUsd = 0;
  private readonly callInfo = new Map<
    ModelCallHandle,
    {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
      costBucket: "model" | "tool";
    }
  >();

  constructor(options?: { primaryModelId?: string }) {
    const raw = options?.primaryModelId?.trim() ?? "";
    this.primaryModelId = raw.length > 0 ? raw : "";
  }

  private resolveCostBucket(modelId: string): "model" | "tool" {
    const trimmed = modelId.trim();
    if (this.primaryModelId && trimmed === this.primaryModelId) {
      return "model";
    }
    // Fallback heuristic: tool-loop calls are "model cost", and calls made by
    // agent tools are tracked as "tool cost".
    if (trimmed.startsWith("chatgpt-")) {
      return "model";
    }
    return "tool";
  }

  startModelCall(details: {
    modelId: string;
    costBucket?: "model" | "tool";
  }): ModelCallHandle {
    const handle: ModelCallHandle = Symbol("agent-model-call");
    const costBucket =
      details.costBucket ?? this.resolveCostBucket(details.modelId);
    this.modelCalls += 1;
    this.modelsUsed.add(details.modelId);
    this.callInfo.set(handle, {
      modelId: details.modelId,
      tokens: createEmptyCallTokenState(),
      appliedCostUsd: 0,
      costBucket,
    });
    return handle;
  }

  recordModelUsage(handle: ModelCallHandle, chunk: LlmUsageChunk): void {
    const state = this.callInfo.get(handle);
    if (!state) {
      return;
    }
    if (chunk.modelVersion) {
      state.modelVersion = chunk.modelVersion;
      this.modelsUsed.add(chunk.modelVersion);
    }
    if (!chunk.tokens) {
      if (typeof chunk.costUsd === "number" && Number.isFinite(chunk.costUsd)) {
        this.applyCostUpdate(state, Math.max(0, chunk.costUsd));
      }
      return;
    }
    this.applyTokenUpdate(state, {
      tokens: chunk.tokens,
      ...(typeof chunk.costUsd === "number" ? { costUsd: chunk.costUsd } : {}),
    });
  }

  finishModelCall(handle: ModelCallHandle): void {
    this.callInfo.delete(handle);
  }

  recordCompletedModelCall(details: {
    modelId: string;
    modelVersion?: string;
    usage?: LlmUsageTokens;
    costUsd?: number;
    costBucket?: "model" | "tool";
  }): void {
    const handle = this.startModelCall({
      modelId: details.modelId,
      ...(details.costBucket ? { costBucket: details.costBucket } : {}),
    });
    if (
      details.modelVersion ||
      details.usage ||
      typeof details.costUsd === "number"
    ) {
      this.recordModelUsage(handle, {
        ...(details.modelVersion ? { modelVersion: details.modelVersion } : {}),
        ...(details.usage ? { tokens: details.usage } : {}),
        ...(typeof details.costUsd === "number"
          ? { costUsd: details.costUsd }
          : {}),
      });
    }
    this.finishModelCall(handle);
  }

  recordToolCall(toolName: string): void {
    this.toolCalls += 1;
    const next = (this.toolCallsByName.get(toolName) ?? 0) + 1;
    this.toolCallsByName.set(toolName, next);
  }

  recordToolCallsFromResult(toolLoopResult: LlmToolLoopResult): void {
    const resultToolCallsByName = new Map<string, number>();
    for (const step of toolLoopResult.steps) {
      for (const toolCall of step.toolCalls) {
        const next = (resultToolCallsByName.get(toolCall.toolName) ?? 0) + 1;
        resultToolCallsByName.set(toolCall.toolName, next);
      }
    }
    for (const [toolName, resultCount] of resultToolCallsByName.entries()) {
      const existingCount = this.toolCallsByName.get(toolName) ?? 0;
      const missingCount = Math.max(0, resultCount - existingCount);
      for (let index = 0; index < missingCount; index += 1) {
        this.recordToolCall(toolName);
      }
    }
  }

  snapshot(): AgentRunStatsSnapshot {
    const toolsByName: Record<string, number> = {};
    for (const [name, count] of this.toolCallsByName.entries()) {
      toolsByName[name] = count;
    }
    const modelCostUsd =
      typeof this.modelCostUsd === "number" &&
      Number.isFinite(this.modelCostUsd)
        ? this.modelCostUsd
        : 0;
    const toolCostUsd =
      typeof this.toolCostUsd === "number" && Number.isFinite(this.toolCostUsd)
        ? this.toolCostUsd
        : 0;
    return {
      modelCalls: this.modelCalls,
      modelsUsed: Array.from(this.modelsUsed).sort(),
      tokens: { ...this.tokens },
      modelCostUsd,
      toolCalls: this.toolCalls,
      toolCallsByName: toolsByName,
      toolCostUsd,
      totalCostUsd: modelCostUsd + toolCostUsd,
    };
  }

  reconcileModelCostFromToolLoopResult(details: {
    modelId: string;
    toolLoopResult: Pick<LlmToolLoopResult, "steps" | "totalCostUsd">;
  }): number {
    this.modelsUsed.add(details.modelId);
    for (const step of details.toolLoopResult.steps) {
      this.modelsUsed.add(step.modelVersion);
    }
    const expectedModelCostUsd = Number.isFinite(
      details.toolLoopResult.totalCostUsd,
    )
      ? Math.max(0, details.toolLoopResult.totalCostUsd)
      : 0;
    const costDeltaUsd = Math.max(0, expectedModelCostUsd - this.modelCostUsd);
    if (costDeltaUsd > 0) {
      this.modelCostUsd += costDeltaUsd;
    }
    return costDeltaUsd;
  }

  private applyTokenUpdate(
    state: {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
      costBucket: "model" | "tool";
    },
    update: {
      tokens: LlmUsageTokenUpdate;
      costUsd?: number;
    },
  ): void {
    const tokens = update.tokens;
    const previous = state.tokens;
    const next: CallTokenState = {
      promptTokens: resolveUsageNumber(tokens.promptTokens),
      cachedTokens: resolveUsageNumber(tokens.cachedTokens),
      responseTokens: resolveUsageNumber(tokens.responseTokens),
      responseImageTokens: resolveUsageNumber(tokens.responseImageTokens),
      thinkingTokens: resolveUsageNumber(tokens.thinkingTokens),
      totalTokens: resolveUsageNumber(
        tokens.totalTokens ??
          resolveUsageNumber(tokens.promptTokens) +
            resolveUsageNumber(tokens.responseTokens) +
            resolveUsageNumber(tokens.thinkingTokens) +
            resolveUsageNumber(tokens.toolUsePromptTokens),
      ),
      toolUsePromptTokens: resolveUsageNumber(tokens.toolUsePromptTokens),
    };

    const promptDelta = Math.max(0, next.promptTokens - previous.promptTokens);
    const cachedDelta = Math.max(0, next.cachedTokens - previous.cachedTokens);
    const responseDelta = Math.max(
      0,
      next.responseTokens - previous.responseTokens,
    );
    const responseImageDelta = Math.max(
      0,
      next.responseImageTokens - previous.responseImageTokens,
    );
    const thinkingDelta = Math.max(
      0,
      next.thinkingTokens - previous.thinkingTokens,
    );
    const totalDelta = Math.max(0, next.totalTokens - previous.totalTokens);
    const toolUseDelta = Math.max(
      0,
      next.toolUsePromptTokens - previous.toolUsePromptTokens,
    );

    this.tokens.promptTokens += promptDelta;
    this.tokens.cachedTokens += cachedDelta;
    this.tokens.responseTokens += responseDelta;
    this.tokens.responseImageTokens += responseImageDelta;
    this.tokens.thinkingTokens += thinkingDelta;
    this.tokens.totalTokens += totalDelta;
    this.tokens.toolUsePromptTokens += toolUseDelta;

    state.tokens = next;
    const estimatedCostUsd = estimateCallCostUsd({
      modelId: state.modelVersion ?? state.modelId,
      tokens,
      responseImages: 0,
    });
    const reportedCostUsd =
      typeof update.costUsd === "number" && Number.isFinite(update.costUsd)
        ? Math.max(0, update.costUsd)
        : undefined;
    const callCostUsd =
      reportedCostUsd !== undefined
        ? Math.max(estimatedCostUsd, reportedCostUsd)
        : estimatedCostUsd;
    this.applyCostUpdate(state, callCostUsd);
  }

  private applyCostUpdate(
    state: {
      modelId: string;
      modelVersion?: string;
      tokens: CallTokenState;
      appliedCostUsd: number;
      costBucket: "model" | "tool";
    },
    callCostUsd: number,
  ): void {
    const costDelta = Math.max(0, callCostUsd - state.appliedCostUsd);
    if (costDelta > 0) {
      if (state.costBucket === "tool") {
        this.toolCostUsd += costDelta;
      } else {
        this.modelCostUsd += costDelta;
      }
      state.appliedCostUsd = callCostUsd;
    }
  }
}

function createToolLoopStatsEventBridge(options: {
  tracker: AgentRunStatsTracker;
  modelId: string;
  flush: () => void;
  mirrorEvent?: (event: LlmStreamEvent) => void;
}): {
  onEvent(event: LlmStreamEvent): void;
  finish(): void;
} {
  let activeHandle: ModelCallHandle | null = null;

  const ensureActiveHandle = (): ModelCallHandle => {
    if (activeHandle) {
      return activeHandle;
    }
    activeHandle = options.tracker.startModelCall({
      modelId: options.modelId,
      costBucket: "model",
    });
    return activeHandle;
  };

  const finishActiveHandle = (): void => {
    if (!activeHandle) {
      return;
    }
    options.tracker.finishModelCall(activeHandle);
    activeHandle = null;
  };

  return {
    onEvent(event) {
      options.mirrorEvent?.(event);
      switch (event.type) {
        case "delta": {
          const handle = ensureActiveHandle();
          if (event.channel === "response") {
            options.tracker.recordModelUsage(handle, {
              response: { textCharsDelta: event.text.length },
            });
          } else {
            options.tracker.recordModelUsage(handle, {
              thinking: { textCharsDelta: event.text.length },
            });
          }
          options.flush();
          return;
        }
        case "model": {
          const handle = ensureActiveHandle();
          options.tracker.recordModelUsage(handle, {
            modelVersion: event.modelVersion,
          });
          options.flush();
          return;
        }
        case "usage": {
          const handle = ensureActiveHandle();
          options.tracker.recordModelUsage(handle, {
            modelVersion: event.modelVersion,
            tokens: event.usage,
            costUsd: event.costUsd,
          });
          options.flush();
          return;
        }
        case "blocked": {
          finishActiveHandle();
          options.flush();
          return;
        }
        case "tool_call": {
          if (event.phase === "started" && !activeHandle) {
            ensureActiveHandle();
          }
          finishActiveHandle();
          if (event.phase === "started") {
            options.tracker.recordToolCall(event.toolName);
          }
          options.flush();
          return;
        }
      }
    },
    finish() {
      finishActiveHandle();
      options.flush();
    },
  };
}

type AgentLogSyncOptions = {
  serviceAccountJson: string;
  userId: string;
  agentId: string;
  throttleMs: number;
  initialStats: AgentRunStatsSnapshot;
  mirrorToConsole?: boolean;
  consolePrefix?: string;
};

class AgentLogSync {
  private serviceAccountJson: string;
  private userId: string;
  private agentId: string;
  private throttleMs: number;
  private createdAt: Date;
  private createdAtWritten = false;
  private lastWriteAt = 0;
  private pendingLines = new Map<string, string>();
  private pendingStats: AgentRunStatsSnapshot | null = null;
  private pendingStream: {
    assistant: string;
    thoughts: string;
  } | null = null;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private disposed = false;
  private lastKeyMs = 0;
  private seq = 0;
  private mirrorToConsole: boolean;
  private consolePrefix: string;

  constructor(options: AgentLogSyncOptions) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.userId = options.userId;
    this.agentId = options.agentId;
    this.throttleMs = options.throttleMs;
    this.createdAt = new Date();
    this.pendingStats = options.initialStats;
    this.mirrorToConsole = options.mirrorToConsole ?? false;
    this.consolePrefix = options.consolePrefix ?? "";
    this.scheduleUpdate();
  }

  private documentPath(): string {
    return `users/${this.userId}/agents/${this.agentId}/logs/log`;
  }

  private agentDocumentPath(): string {
    return `users/${this.userId}/agents/${this.agentId}`;
  }

  append(line: string): void {
    if (this.disposed) {
      return;
    }
    if (this.mirrorToConsole) {
      console.log(`${this.consolePrefix}${line}`);
    }
    const key = this.nextLineKey();
    this.pendingLines.set(key, line);
    this.scheduleUpdate();
  }

  setStats(stats: AgentRunStatsSnapshot): void {
    if (this.disposed) {
      return;
    }
    this.pendingStats = stats;
    this.scheduleUpdate();
  }

  setStream(stream: { assistant?: string; thoughts?: string }): void {
    if (this.disposed) {
      return;
    }
    this.pendingStream = {
      assistant: stream.assistant ?? "",
      thoughts: stream.thoughts ?? "",
    };
    this.scheduleUpdate();
  }

  async flushAll(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) {
      await this.inFlight.catch(() => undefined);
    }
    if (
      this.pendingLines.size === 0 &&
      !this.pendingStats &&
      !this.pendingStream
    ) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastWriteAt;
    const delay = Math.max(0, this.throttleMs - elapsed);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    await this.startFlush({ force: true });
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private nextLineKey(): string {
    const nowMs = Date.now();
    if (nowMs === this.lastKeyMs) {
      this.seq += 1;
    } else {
      this.lastKeyMs = nowMs;
      this.seq = 0;
    }
    return `t${nowMs}_${String(this.seq).padStart(3, "0")}`;
  }

  private scheduleUpdate(): void {
    if (this.disposed) {
      return;
    }
    if (this.inFlight) {
      return;
    }
    if (this.timer) {
      return;
    }
    const now = Date.now();
    const elapsed = now - this.lastWriteAt;
    if (elapsed >= this.throttleMs) {
      void this.startFlush({ force: false }).catch((error) => {
        console.warn(
          `Failed to flush agent logs "${this.agentId}": ${errorAsString(error)}`,
        );
      });
      return;
    }
    const delay = Math.max(0, this.throttleMs - elapsed);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.startFlush({ force: false }).catch((error) => {
        console.warn(
          `Failed to flush agent logs "${this.agentId}": ${errorAsString(error)}`,
        );
      });
    }, delay);
  }

  private async startFlush({ force }: { force: boolean }): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (
      !force &&
      this.pendingLines.size === 0 &&
      !this.pendingStats &&
      !this.pendingStream
    ) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) {
      await this.inFlight;
      return;
    }

    this.lastWriteAt = Date.now();
    const promise = this.flush()
      .catch((error) => {
        throw error;
      })
      .finally(() => {
        this.inFlight = undefined;
        if (
          !this.disposed &&
          (this.pendingLines.size > 0 ||
            this.pendingStats ||
            this.pendingStream)
        ) {
          this.scheduleUpdate();
        }
      });
    this.inFlight = promise;
    await promise;
  }

  private async flush(): Promise<void> {
    if (this.disposed) {
      return;
    }
    const linesEntries = Array.from(this.pendingLines.entries());
    const stats = this.pendingStats;
    const stream = this.pendingStream;
    this.pendingLines.clear();
    this.pendingStats = null;
    this.pendingStream = null;

    if (linesEntries.length === 0 && !stats && !stream) {
      return;
    }

    const now = new Date();
    const linesPayload: Record<string, string> = {};
    for (const [key, value] of linesEntries) {
      linesPayload[key] = value;
    }

    const payload: Record<string, unknown> = {
      updatedAt: now,
    };
    if (!this.createdAtWritten) {
      payload.createdAt = this.createdAt;
    }
    if (linesEntries.length > 0) {
      for (const [key, value] of Object.entries(linesPayload)) {
        payload[`lines.${key}`] = value;
      }
    }
    if (stats) {
      payload.stats = stats;
    }
    if (stream) {
      payload["stream.updatedAt"] = now;
      payload["stream.assistant"] = stream.assistant;
      payload["stream.thoughts"] = stream.thoughts;
    }

    try {
      await Promise.all([
        patchFirestoreDocument({
          serviceAccountJson: this.serviceAccountJson,
          documentPath: this.documentPath(),
          updates: payload,
        }),
        patchFirestoreDocument({
          serviceAccountJson: this.serviceAccountJson,
          documentPath: this.agentDocumentPath(),
          updates: {
            updatedAt: now,
          },
        }),
      ]);
      this.createdAtWritten = true;
    } catch (error) {
      for (const [key, value] of linesEntries) {
        if (!this.pendingLines.has(key)) {
          this.pendingLines.set(key, value);
        }
      }
      if (!this.pendingStats && stats) {
        this.pendingStats = stats;
      }
      if (!this.pendingStream && stream) {
        this.pendingStream = stream;
      }
      throw error;
    }
  }
}

function stripDeprecatedPdfReadTools(tools: LlmToolSet): LlmToolSet {
  const nextTools: LlmToolSet = { ...tools };
  delete (nextTools as Record<string, unknown>).read_pdf;
  delete (nextTools as Record<string, unknown>).extract_pdf_text;
  return nextTools;
}

const GRADER_POST_ARTIFACT_ALLOWED_TOOLS = new Set([
  "apply_patch",
  "crop_image",
  "done",
  "draw_grid_overlay",
  "extract_pdf_diagrams",
  "extract_pdf_images",
  "grep_files",
  "grep_workspace_files",
  "list_dir",
  "list_workspace_dir",
  "pad_image",
  "pdf_to_images",
  "propose_crop_bbox_with_fresh_agent",
  "publish_sheet",
  "read_file",
  "read_workspace_file",
  "review_run_progress_with_fresh_agent",
  "trim_image",
  "validate_crop_with_fresh_agent",
  "validate_grader_artifacts",
  "validate_source_fidelity_with_fresh_agent",
  "view_image",
  "write_json_workspace_file",
  "write_workspace_file",
]);

const GRADER_PRE_PLAN_BLOCKED_TOOLS = new Set([
  "apply_patch",
  "crop_image",
  "pad_image",
  "publish_sheet",
  "score_answers_with_fresh_agent",
  "trim_image",
  "validate_crop_with_fresh_agent",
  "validate_grader_artifacts",
  "validate_source_fidelity_with_fresh_agent",
  "view_image",
  "write_json_workspace_file",
]);

const GRADER_PRE_SCORING_BLOCKED_TOOLS = new Set([
  "apply_patch",
  "crop_image",
  "extract_pdf_images",
  "grep_files",
  "grep_workspace_files",
  "list_dir",
  "list_workspace_dir",
  "pad_image",
  "pdf_to_images",
  "publish_sheet",
  "read_file",
  "read_workspace_file",
  "trim_image",
  "validate_crop_with_fresh_agent",
  "validate_grader_artifacts",
  "validate_source_fidelity_with_fresh_agent",
  "view_image",
  "write_json_workspace_file",
  "write_workspace_file",
]);

function safeToJsonSchema(
  schema: z.ZodType,
  name: string,
  modelId: string,
): Record<string, unknown> {
  return buildProviderToolJsonSchema({ schema, name, modelId });
}

function buildSparkAgentToolSchemaName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]+/g, "_");
}

function buildSparkAgentAvailableTool(options: {
  name: string;
  kind: SparkAgentAvailableTool["kind"];
  modelId: string;
  toolConfig: LlmExecutableTool<z.ZodType, unknown>;
}): SparkAgentAvailableTool | null {
  const description =
    typeof options.toolConfig.description === "string"
      ? options.toolConfig.description.trim()
      : "";
  if (description.length === 0) {
    return null;
  }

  if (options.toolConfig.type === "custom") {
    return SparkAgentAvailableToolSchema.parse({
      name: options.name,
      kind: options.kind,
      callKind: "custom",
      description,
      ...(options.toolConfig.format
        ? {
            inputContract: {
              kind: "custom_format",
              format: options.toolConfig.format,
            },
          }
        : {}),
      outputContract: {
        kind: "undeclared",
      },
    });
  }

  return SparkAgentAvailableToolSchema.parse({
    name: options.name,
    kind: options.kind,
    callKind: "function",
    description,
    inputContract: {
      kind: "json_schema",
      schema: safeToJsonSchema(
        options.toolConfig.inputSchema,
        `${buildSparkAgentToolSchemaName(options.name)}_input`,
        options.modelId,
      ),
    },
    outputContract: {
      kind: "undeclared",
    },
  });
}

function buildSparkAgentAvailableTools(
  tools: LlmToolSet,
  modelId: string,
): SparkAgentAvailableTool[] {
  const availableTools: SparkAgentAvailableTool[] = [];
  const filesystemToolNames = new Set(resolveSparkAgentFilesystemToolNames());

  const sortedFunctionTools = Object.entries(tools).sort(
    ([leftName], [rightName]) => leftName.localeCompare(rightName),
  );
  for (const [name, toolConfig] of sortedFunctionTools) {
    const availableTool = buildSparkAgentAvailableTool({
      name,
      kind: filesystemToolNames.has(name) ? "filesystem" : "function",
      modelId,
      toolConfig,
    });
    if (availableTool) {
      availableTools.push(availableTool);
    }
  }

  return availableTools;
}

export function buildSparkAgentSystemPrompt(options?: {
  includePdfTranscriptionSkill?: boolean;
  mode?: "default" | "grader";
}): string {
  let lines = [
    "You are Spark Agent, a tool-using assistant.",
    "",
    "General rules:",
    "- Work with workspace-relative paths only (no absolute paths, no .. segments).",
    "- Use list_workspace_dir/read_workspace_file/grep_workspace_files to inspect text files in the workspace before editing.",
    "- Use view_image for image files (read_workspace_file is text-only).",
    "- Use write_workspace_file for Markdown/text artifacts. Use write_json_workspace_file for JSON artifacts, especially grader/output/sheet.json and grader/output/run-summary.json.",
    "- Prefer fewer, larger patches over many tiny edits.",
    "- Use web_search when you need to look up facts or check details.",
    "- Use web_fetch to retrieve NON-PDF source pages/files from URLs discovered via web_search.",
    "- For PDF URLs discovered online, search `knowledge-base/index.md` or call `kb_search_pdfs` first. If a matching shared PDF exists, call `kb_download_pdf` and use the local workspace PDF. If no match exists, classify the official PDF and call `kb_cache_pdf_from_url`; use the returned shared `storagePath` in worksheet references such as `paperStoragePath` or `markSchemeStoragePath`.",
    "- Use extract_text to transcribe workspace document files (images/PDFs) into markdown with LaTeX formulas.",
    "- Use real Markdown line breaks in worksheet-visible text; never leave literal escaped newline text like `\\n`. For source maths layouts such as number grids, arranged arithmetic, matrices, and displayed formula blocks, prefer display LaTeX (`\\[...\\]`) using KaTeX-supported `array`/matrix/aligned environments when that is the source-faithful representation. Use Markdown tables for real tabular data, not for mathematical arrays that only look table-like.",
    "- When passing jsonText, it must be valid JSON before the tool can reserialize it. JSON-escape every backslash in string values or avoid raw LaTeX backslash syntax; a visible Markdown string containing `\\(` must appear in jsonText as `\\\\(`.",
    "- extract_text does not automatically know source filenames/paths; include identifying details inside instructions when needed.",
    "- For multi-page extraction tasks, you can request explicit page markers in the extracted markdown.",
    "- For PDF transcription, use extract_pdf_reference_text once as a navigation/transcription aid when available. For source PDFs with named figures/diagrams/photos, use extract_pdf_images only when the extracted object includes all printed labels/context; otherwise render exact pages with pdf_to_images, draw grids, and ask fresh bbox helpers in parallel where possible. Do not look up grade boundaries or examiner reports unless the user explicitly asked for those external references; a single component paper normally cannot be converted into a full qualification grade.",
    "- For grader runs with uploaded question paper and mark scheme files, derive model answers from those uploads. Do not download optional worked-example/examiner-report PDFs or enrichment references before the source-faithful sheet is complete unless explicitly requested.",
    "- Use extract_pdf_images as a cheap inventory when a PDF may contain embedded raster figures, maps, charts, or photos. Do not link grader/output/pdf-images/... files directly in a worksheet; if an extracted image object is the final visual, copy it into the planned final grader/output/assets/... path with crop_image fullImage=true. Do not create raw/candidate/draft/temp asset paths in grader/output/assets. extract_pdf_images does not locate vector diagrams, on-page coordinates, or labels drawn outside the image object, so use pdf_to_images plus grid/crop tools for named exam figures where labels/axes/group headings/captions matter.",
    "- Use extract_pdf_diagrams when you need Gemini-assisted coarse diagram bounding boxes from a PDF; treat them as proposals and validate/refine crops with rendered page images and view_image. If one manual crop-and-view correction for the same target is still clipped/noisy/uncertain, call propose_crop_bbox_with_fresh_agent or extract_pdf_diagrams for that source page and target label before spending more turns on hand-tuned crop boxes.",
    "- For figure crop refinement, do not do mask segmentation. Use a rectangular bbox workflow: inspect the selected base image and grid overlay with view_image, return or apply a single pixel bbox with origin top-left and right/bottom exclusive, prefer small safe margins over clipping, and reject surrounding question text, mark text, answer lines, page borders, next-question content, or standalone Figure/Table captions already rendered by the worksheet. Use propose_crop_bbox_with_fresh_agent when a fresh visual agent should choose the bbox, then apply the returned bbox with crop_image.",
    "- The workspace tools listed for this run are actually available. Never respond that you cannot read files, execute tool steps, access the PDF, or publish outputs when the relevant tool is present; call the tool instead.",
    "- If a workspace upload appears inaccessible, first inspect grader/uploads/index.json, list grader/uploads, run extract_text or pdf_to_images on the workspace-relative PDF path, and use view_image on rendered pages before declaring anything blocked.",
    "- Do NOT use web_fetch for PDFs.",
    "- When the task is complete, you MUST call done({summary}).",
    "",
    "Grader / worksheet publishing pipeline (CRITICAL):",
    "When the workspace contains grader/task.md or request.json describes a grader run, you are not finished after extracting text, inspecting images, or cropping figures.",
    "You MUST write grader/output/sheet.json and grader/output/run-summary.json, then call publish_sheet({}). Use validation errors as diagnostics, repair the artifacts coherently, and retry only while you are fixing a new class of issue rather than repeating the same failed branch.",
    "For grader/output/run-summary.json, include totals.awardedMarks, totals.maxMarks, presentation.title, presentation.subtitle, presentation.summaryMarkdown, presentation.footer, and sheet.filePath exactly equal to grader/output/sheet.json.",
    "For worksheet `sheet.color`, `sheet.accent`, `sheet.light`, and `sheet.border`, use Spark's stable Apple-style subject palette: Biology green; Mathematics blue; Chemistry purple; Physics indigo; Geography teal; Science mint; English pink; History or Religious Studies orange; Economics or Business yellow; Computer Science or General gray. The publish tools normalize mismatches, but choose the right palette before publishing.",
    "For `presentation.summaryMarkdown`, write the Sheets thumbnail body only: one compact sentence or two short fragments, specific, and not repeating title, subject, level, marks, percentage, created date, or footer. In graded runs prefer a known official grade/prize/medal/percentile outcome, common examiner mistake made/avoided, or the strongest concrete next learning target. Do not use generic lead-ins such as \"This sheet\", \"The worksheet\", \"Graded\", \"Checked\", or broad praise.",
    "When official source PDFs are discovered online, the visible sheet should link to Spark's cached shared storage path, not the third-party URL. Include `references.paperStoragePath` / `references.markSchemeStoragePath` in grader/output/sheet.json and `paperStoragePath` / `markSchemeStoragePath` in grader/output/run-summary.json whenever `kb_cache_pdf_from_url` or `kb_download_pdf` provides them. Keep the original URLs only as provenance fields.",
    "Do not copy request.json, brief.md, upload manifests, planning JSON, answer lists, or process summaries into grader/output/sheet.json or grader/output/run-summary.json. Those files must contain only the worksheet report schema and publish summary schema.",
    "For source-paper-only/no-student grader runs, do not solve the paper, derive correct options, list an answer key, or include worked solutions. Build an unanswered worksheet with blank answers and review.mode='awaiting_answers'.",
    "Do not use generate_json for grader/output/sheet.json or grader/output/run-summary.json; generate_json is a lesson-output helper and request.json/grader/task.md are not JSON schemas. Write grader JSON outputs with write_json_workspace_file and use publish_sheet for validation.",
    "Do not use generic spawn_agent for grader intake, upload inventory, workspace file reading, transcription, final grading synthesis, or worksheet assembly. Use view_image for source-page/photo fidelity checks and for rendered PDF pages when text or layout matters; use extract_text for primary student/photo transcription, propose_crop_bbox_with_fresh_agent for uncertain crop bbox planning, validate_crop_with_fresh_agent for final crop visual validation, and score_answers_with_fresh_agent for bounded root-question scoring on long handwritten papers. The main agent still assembles final artifacts and publishes.",
    "For handwritten-grading papers with more than 12 answer leaves or more than 30 marks, do not score the whole paper in one long reasoning pass. After sheet-plan and visual/table handling, call score_answers_with_fresh_agent in 2-4 contiguous root/range batches that cover all answer leaves, issuing all independent calls in one parallel tool turn whenever possible, then assemble sheet.json from the returned inline scoring and modelAnswer results. Do not reread every scoring file after the helper returns; read only a named file/question if a result is missing or a validation error points to it.",
    "Use pad_image only to add a clean white border around otherwise complete source visuals. If a crop already passed fresh visual validation, do not rerun validate_crop_with_fresh_agent just because pad_image wrote the final linked path; record the final padded path in crop-validation.md and note the passed source validation. If the only failure was required content touching the edge while all content was visible, pad once and validate only the padded asset.",
    "Source problem-statement transcription must be verbatim page-by-page source wording, not a compact audit or needed-for-grading summary. Include interstitial stems, answer instructions, options, table labels/cells, figure labels, displayed formulas, and layout-critical wording. Do not summarize displayed formulas/equations as prose such as `displayed formula shown for ...`; render the actual formula as Markdown/LaTeX or plan a visible crop.",
    "After source transcription, immediately write grader/output/sheet-plan.md with leaves, marks, visual/table placements, and scoring batches. Self-check that Total source marks equals section totals and listed leaf marks, and that Total answer-bearing leaves equals the listed leaves. For every included named figure/diagram/graph/visual option block, including shared root context that applies to later leaves, the plan must name a guarded grader/output/assets/... crop path or record a real failed render/crop attempt; never write that no crop is needed because grading is possible without the visual. Source problem-statement transcription must not be an only-visibly-answered list, and must not summarize diagram options as labels only, such as `Options: A, B, C, D shown as diagram choices` or `Options shown as diagram labels`; preserve shared source context, displayed formula setup lines, displayed formulas, and the source figure/diagram reference, then plan a visible crop when needed. Do not write `displayed formula shown for ...` as a substitute for a source formula. For long handwritten papers, call score_answers_with_fresh_agent in 2-4 contiguous root/range batches covering every answer leaf, and issue the calls in one parallel tool turn before crop validation/polishing, model-answer polishing, optional reference enrichment, or thumbnail-summary work. After required scoring helper calls return, create only missing planned final guarded image assets at their exact sheet-plan paths; do not create `-raw`, `-candidate`, `-draft`, or temp copies under grader/output/assets. Then write grader/output/sheet.json and grader/output/run-summary.json with write_json_workspace_file immediately from the returned inline results; do not first record crop-validation.md, reread scoring files, regrade, or enrich. Then run validate_grader_artifacts, fix named schema/crop/source-fidelity blockers, record crop-validation.md when linked crops exist, and publish. For requested model answers, use concise modelAnswer fields returned by the scoring helper; if they are missing, do not delay validation or publish for a separate derivation pass. Use fill only for simple one- or two-blank lines with prompt/blanks/after; use cloze for any segments/blanks question. Keep named figures/tables and image links out of section.theory; put them in the exact source question/group prompt. Do not invent bridge text such as `Figure 1 and Figure 2 are used in this question`, `planned as crop`, `shown in the source paper`, or `options shown as diagram labels`. Source problem-statement transcription must not contain placeholders such as not yet copied, TBD, or TODO.",
    "Every final linked figure/image crop must be validated by its own validate_crop_with_fresh_agent call, except for pad_image outputs derived from an already passing validation as described above. Pass expectedContent with the exact printed/visible visual labels/axes/options/table cells/annotations that must be visible, and duplicatedTextToExclude for surrounding prompt/caption/table text rendered separately; pass `none` only when no surrounding duplicated text needs exclusion. Do not ask the reviewer to require inferred answers, mark-scheme facts, or labels/headings absent from the source visual. The fresh reviewer uses view_image, transcribes all visible text in the crop, and then judges whether those required visual elements are present, major duplicated caption/question/table text is excluded, unrelated neighbouring content outside the official target visual is absent, and required content does not touch or clip at an edge. Treat missing/clipped/wrong target content as blocking; treat related subpanels inside the same official embedded figure/table image, small duplicate caption fragments, or safe whitespace as minor issues, not reasons for endless recropping.",
    "If a crop reviewer fails an otherwise complete source visual only because expectedContent named inferred or unprinted content, such as a group name, answer, placeholder, or heading absent from the figure, correct expectedContent and revalidate once instead of recropping.",
    "If you use crop_image or trim_image on a linked worksheet asset after writing grader/output/crop-validation.md, rerun the fresh-context crop check and rewrite crop-validation.md for the final asset before publishing. pad_image does not require another validation when it only adds a white border to an already passed crop.",
    "Do not publish known blocking crop failures. For uncertain crops or after validate_crop_with_fresh_agent reports clipped/missing/wrong content, a broad fallback, or confusing neighbouring content, stop hand-guessing coordinates and use the bad-crop/full-page/grid JSON workflow through propose_crop_bbox_with_fresh_agent. If the same validation problem recurs after a proposal-assisted retry, treat it as a wrong-path signal and call review_run_progress_with_fresh_agent before continuing crop polishing. If the remaining issue is only a small duplicated caption/prompt fragment and all expected content is visible, record it as minor and continue.",
    "If an image tool reports a repeated-crop or pre-publish image-edit budget error, stop guessing boxes for that output: call review_run_progress_with_fresh_agent, switch to propose_crop_bbox_with_fresh_agent / extract_pdf_images / extract_pdf_diagrams if appropriate, and do not relabel unresolved crop failures as passing or link full-page fallbacks.",
    "Only after publish_sheet succeeds may you call done({summary}). Never end the run with a normal assistant final response before publish_sheet; continue using tools instead.",
    "",
    "Lesson creation pipeline (CRITICAL):",
    "When you are asked to create a Spark lesson, follow the pipeline described in lesson/task.md.",
    "Key strategy (prompt-driven):",
    "1) Read brief.md + request.json + lesson/task.md first; write hard requirements + decisions into lesson/requirements.md.",
    "2) Draft content as Markdown (preferred):",
    "   - Session draft: lesson/drafts/session.md",
    "   - Quiz drafts: lesson/drafts/quiz/<planItemId>.md",
    "   - Code drafts: lesson/drafts/code/<planItemId>.md (only if coding is included)",
    "   - Use generate_text with the templates in lesson/prompts/ to draft/revise Markdown.",
    "   - IMPORTANT dependency: the quiz/code draft prompt templates inline lesson/drafts/session.md, so you MUST generate the session draft before running quiz-draft/code-draft generate_text calls.",
    "3) Grade drafts (do not skip):",
    "   - Session grade: lesson/feedback/session-grade.md (must have pass: true before publishing)",
    "   - Quiz grade: lesson/feedback/quiz/<planItemId>-grade.md (one per quiz plan item)",
    "   - Code grade: lesson/feedback/code/<planItemId>-grade.md (one per coding_problem plan item)",
    "4) Generate Firestore-ready JSON outputs under lesson/output/ from the Markdown drafts:",
    "   - Use generate_json({ sourcePath, schemaPath, outputPath }) for each JSON file.",
    "   - Then run validate_json({ schemaPath, inputPath }) and fix until ok=true.",
    "   - Fixes can be done by editing the source Markdown and re-running generate_json, or by patching the JSON directly.",
    "   - Required outputs:",
    "     - lesson/output/session.json (from lesson/drafts/session.md, schema lesson/schema/session.schema.json)",
    "     - lesson/output/quiz/<planItemId>.json (from lesson/drafts/quiz/<planItemId>.md, schema lesson/schema/quiz.schema.json)",
    "     - lesson/output/code/<planItemId>.json (from lesson/drafts/code/<planItemId>.md, schema lesson/schema/coding_problem.schema.json)",
    '     - lesson/output/media/<planItemId>.json (rare; only if kind="media" exists; schema lesson/schema/media.schema.json)',
    "5) Publish only after outputs exist and look consistent: call publish_lesson and fix errors until status='published'.",
    "Publish lessons into the user's sessions (not welcome templates).",
    "",
    "Schema / files:",
    "- lesson/schema/session.schema.json describes lesson/output/session.json.",
    "- lesson/schema/quiz.schema.json describes lesson/output/quiz/*.json.",
    "- lesson/schema/coding_problem.schema.json describes lesson/output/code/*.json.",
    "- lesson/schema/media.schema.json describes lesson/output/media/*.json (only if explicitly requested).",
    "",
    "generate_text notes:",
    "- Prompt templates may include {{path/to/file}} placeholders to inline workspace files.",
    "- Some prompt templates REQUIRE inputPaths. In particular, quiz/code grade and revise prompts MUST be called with inputPaths so the sub-model can see the candidate draft (and the grading report for revise).",
    "- outputPath is required for every generate_text call.",
    "- Lesson grading templates output `pass: true|false`. generate_text will return `gradePass: true|false` when it detects this line. Use that instead of reading the grade file back unless you need details to fix a failure.",
    "- Only revise drafts when pass=false. If pass=true, proceed even if the grader suggests optional improvements.",
    "",
    "Examples (multiple quizzes / coding problems):",
    "- Grade quiz q1:",
    '  generate_text({ promptPath: "lesson/prompts/quiz-grade.md", inputPaths: ["lesson/drafts/quiz/q1.md"], outputPath: "lesson/feedback/quiz/q1-grade.md" })',
    "- Revise quiz q1 using its grade report:",
    '  generate_text({ promptPath: "lesson/prompts/quiz-revise.md", inputPaths: ["lesson/drafts/quiz/q1.md", "lesson/feedback/quiz/q1-grade.md"], outputPath: "lesson/drafts/quiz/q1.md" })',
    "- Grade code problem p1:",
    '  generate_text({ promptPath: "lesson/prompts/code-grade.md", inputPaths: ["lesson/drafts/code/p1.md"], outputPath: "lesson/feedback/code/p1-grade.md" })',
    "- Revise code problem p1 using its grade report:",
    '  generate_text({ promptPath: "lesson/prompts/code-revise.md", inputPaths: ["lesson/drafts/code/p1.md", "lesson/feedback/code/p1-grade.md"], outputPath: "lesson/drafts/code/p1.md" })',
    "",
    "Step limit optimization (important for smoke tests):",
    "- You MAY call multiple tools in a single step when they are independent (they run in parallel).",
    "- In low-step-budget runs, you MUST batch JSON work: run generate_json for session + all quizzes/coding_problems/media in one step, then validate_json for all outputs in one step.",
    "- Similarly, once prerequisites exist (e.g. session draft), batch quiz/coding_problem draft and grade calls per plan item in the same step (one outputPath per plan item).",
    "- Good batching examples:",
    "  - Grade q1 and q2 in the same step (distinct outputPath per quiz).",
    "  - Generate JSON for session + all quizzes in one step, then validate them all in one step.",
    "- Do NOT batch dependent operations in the same step (e.g. don't grade before drafting, don't validate before generating).",
    "",
    "Python execution:",
    "- Use python_exec for calculations or verification (e.g. validate that a reference solution matches tests).",
    "- Provide stdinPath and capture stdout/stderr to workspace files so results are persisted.",
  ];
  if (options?.mode === "grader") {
    const lessonStart = lines.indexOf("Lesson creation pipeline (CRITICAL):");
    const pythonStart = lines.indexOf("Python execution:");
    if (lessonStart >= 0 && pythonStart > lessonStart) {
      lines = [...lines.slice(0, lessonStart), ...lines.slice(pythonStart)];
    }
  }
  if (options?.includePdfTranscriptionSkill) {
    lines.push(
      "",
      "Reusable worksheet skills:",
      "Read the workspace skill files named below before PDF/image transcription, crop planning, sheet conversion, answer capture, or grading work. The task file remains the source of run-specific paths and publishing requirements.",
      renderSparkAgentSkillReadList(SPARK_GRADER_SKILL_IDS),
    );
  }
  return lines.join("\n");
}

type ValidatedLessonPublishBundle = {
  readonly session: Session;
  readonly quizzes: QuizDefinition[];
  readonly problems: CodeProblem[];
  readonly media: SessionMediaDoc[];
};

async function validateLessonWorkspaceForPublish(options: {
  rootDir: string;
  sessionId: string;
  sessionPath: string;
  briefPath: string;
  createdAt: Date;
  titleFallback?: string;
  topicsFallback?: string[];
  includeStory?: boolean;
  includeCoding?: boolean;
  enforceLessonPipeline: boolean;
}): Promise<ValidatedLessonPublishBundle> {
  const {
    rootDir,
    sessionId,
    sessionPath,
    briefPath,
    createdAt,
    titleFallback,
    topicsFallback,
    includeStory,
    includeCoding,
    enforceLessonPipeline,
  } = options;

  const readWorkspaceJson = async (inputPath: string): Promise<unknown> => {
    const resolved = resolveWorkspacePath(rootDir, inputPath);
    let text = "";
    try {
      text = await readFile(resolved, { encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `Unable to read workspace file "${inputPath}": ${errorAsString(error)}`,
      );
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Invalid JSON in "${inputPath}": ${errorAsString(error)}`,
      );
    }
  };

  const ensurePlainRecord = (
    value: unknown,
    label: string,
  ): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`"${label}" must contain a JSON object.`);
    }
    return value as Record<string, unknown>;
  };

  const readWorkspaceTextOptional = async (
    inputPath: string,
  ): Promise<string | null> => {
    try {
      const resolved = resolveWorkspacePath(rootDir, inputPath);
      return await readFile(resolved, { encoding: "utf8" });
    } catch {
      return null;
    }
  };

  if (enforceLessonPipeline) {
    const sessionGradePath = "lesson/feedback/session-grade.md";
    const gradeText = await readWorkspaceTextOptional(sessionGradePath);
    if (!gradeText) {
      throw new Error(
        `Missing required session grading report (${sessionGradePath}). Run generate_text with promptPath='lesson/prompts/session-grade.md' and outputPath='${sessionGradePath}', then revise until pass: true.`,
      );
    }
    const passMatch = gradeText.match(/^\s*pass\s*:\s*(true|false)\s*$/gim);
    const passValue = passMatch?.[0]
      ? (() => {
          const parts = passMatch[0].split(":");
          const raw = parts[1] ? parts[1].trim().toLowerCase() : "";
          return raw === "true" ? true : raw === "false" ? false : null;
        })()
      : null;
    if (passValue !== true) {
      const detail =
        passValue === false
          ? "pass=false"
          : "missing required `pass: true|false` line";
      throw new Error(
        `Session grading report (${sessionGradePath}) ${detail}. Revise lesson/drafts/session.md and re-grade before publishing.`,
      );
    }
  }

  const lessonBrief = await readWorkspaceTextOptional(briefPath);

  const rawSessionJson = await readWorkspaceJson(sessionPath);
  const rawSessionRecord = ensurePlainRecord(rawSessionJson, sessionPath);

  const titleFromFile =
    typeof rawSessionRecord.title === "string"
      ? rawSessionRecord.title.trim()
      : "";
  const resolvedTitle =
    titleFromFile.length > 0 ? titleFromFile : titleFallback;

  const topicsFromFile = Array.isArray(rawSessionRecord.topics)
    ? rawSessionRecord.topics
        .map((topic) => (typeof topic === "string" ? topic.trim() : ""))
        .filter((topic) => topic.length > 0)
    : [];
  const resolvedTopics =
    topicsFromFile.length > 0
      ? topicsFromFile
      : topicsFallback && topicsFallback.length > 0
        ? topicsFallback
        : [];

  const sessionCandidate: Record<string, unknown> = {
    ...rawSessionRecord,
    id: sessionId,
    createdAt,
    status: "ready",
    nextLessonProposals: [],
  };
  if (resolvedTitle) {
    sessionCandidate.title = resolvedTitle;
  }
  if (resolvedTopics.length > 0) {
    sessionCandidate.topics = resolvedTopics;
  } else if (lessonBrief) {
    const deriveTopic = (brief: string): string => {
      const lines = brief.replace(/\r\n/g, "\n").split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]?.trim() ?? "";
        if (/^##\s*topic\s*$/iu.test(line)) {
          for (let j = i + 1; j < lines.length; j += 1) {
            const next = lines[j]?.trim() ?? "";
            if (next.length === 0) {
              continue;
            }
            return next.replace(/^#+\s*/u, "").trim();
          }
        }
        const match = line.match(
          /^\s*(?:topic|lesson topic|session topic|title)\s*:\s*(.+?)\s*$/iu,
        );
        if (match?.[1]) {
          return match[1].trim();
        }
      }
      const firstNonEmpty = lines.find((entry) => entry.trim().length > 0);
      return firstNonEmpty ? firstNonEmpty.replace(/^#+\s*/u, "").trim() : "";
    };
    const derivedTopic = deriveTopic(lessonBrief);
    if (derivedTopic) {
      sessionCandidate.topics = [derivedTopic];
    }
  }

  let sessionDoc: Session;
  try {
    sessionDoc = SessionSchema.parse(sessionCandidate);
  } catch (error) {
    throw new Error(
      `Invalid session JSON (${sessionPath}): ${errorAsString(error)}`,
    );
  }

  if (includeCoding === false) {
    const problemCount = sessionDoc.plan.filter(
      (item) => item.kind === "coding_problem",
    ).length;
    if (problemCount > 0) {
      throw new Error(
        "includeCoding=false but session.plan includes coding_problem items.",
      );
    }
  }

  if (includeStory === false) {
    const mediaCount = sessionDoc.plan.filter(
      (item) => item.kind === "media",
    ).length;
    if (mediaCount > 0) {
      throw new Error(
        "includeStory=false but session.plan includes media items.",
      );
    }
  }

  const seenPlanIds = new Set<string>();
  for (const item of sessionDoc.plan) {
    if (seenPlanIds.has(item.id)) {
      throw new Error(`Duplicate plan item id "${item.id}" in session.`);
    }
    seenPlanIds.add(item.id);
  }

  const baseDir = path.posix.dirname(sessionPath);
  const basePrefix = baseDir === "." ? "" : baseDir;
  const resolveBundlePath = (suffix: string): string => {
    if (!basePrefix) {
      return suffix;
    }
    return `${basePrefix}/${suffix}`;
  };

  const quizPlanItems = sessionDoc.plan.filter((item) => item.kind === "quiz");
  const problemPlanItems = sessionDoc.plan.filter(
    (item) => item.kind === "coding_problem",
  );
  const mediaPlanItems = sessionDoc.plan.filter(
    (item) => item.kind === "media",
  );

  const quizzes: QuizDefinition[] = await Promise.all(
    quizPlanItems.map(async (item) => {
      const quizPath = resolveBundlePath(`quiz/${item.id}.json`);
      const rawQuizJson = await readWorkspaceJson(quizPath);
      const rawQuizRecord = ensurePlainRecord(rawQuizJson, quizPath);
      const progressKeyRaw =
        typeof rawQuizRecord.progressKey === "string"
          ? rawQuizRecord.progressKey.trim()
          : "";
      const progressKey =
        progressKeyRaw.length > 0
          ? progressKeyRaw
          : `lesson:${sessionId}:${item.id}`;
      const quizCandidate: Record<string, unknown> = {
        ...rawQuizRecord,
        id: item.id,
        progressKey,
      };
      try {
        return QuizDefinitionSchema.parse(quizCandidate);
      } catch (error) {
        throw new Error(
          `Invalid quiz JSON (${quizPath}): ${errorAsString(error)}`,
        );
      }
    }),
  );

  const quizzesById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));

  const problems: CodeProblem[] = await Promise.all(
    problemPlanItems.map(async (item) => {
      const problemPath = resolveBundlePath(`code/${item.id}.json`);
      const rawProblemJson = await readWorkspaceJson(problemPath);
      const rawProblemRecord = ensurePlainRecord(rawProblemJson, problemPath);
      const problemCandidate: Record<string, unknown> = {
        ...rawProblemRecord,
        slug: item.id,
      };
      try {
        return CodeProblemSchema.parse(problemCandidate);
      } catch (error) {
        throw new Error(
          `Invalid code problem JSON (${problemPath}): ${errorAsString(error)}`,
        );
      }
    }),
  );

  const media: SessionMediaDoc[] = await Promise.all(
    mediaPlanItems.map(async (item) => {
      const mediaPath = resolveBundlePath(`media/${item.id}.json`);
      const rawMediaJson = await readWorkspaceJson(mediaPath);
      const rawMediaRecord = ensurePlainRecord(rawMediaJson, mediaPath);
      const mediaCandidate: Record<string, unknown> = {
        ...rawMediaRecord,
        id: item.id,
        planItemId: item.id,
        sessionId,
      };
      try {
        return SessionMediaDocSchema.parse(mediaCandidate);
      } catch (error) {
        throw new Error(
          `Invalid media JSON (${mediaPath}): ${errorAsString(error)}`,
        );
      }
    }),
  );

  const planWithProgress = sessionDoc.plan.map((item) => {
    if (item.kind !== "quiz") {
      return item;
    }
    const quiz = quizzesById.get(item.id);
    if (!quiz) {
      return item;
    }
    if (item.progressKey && item.progressKey.trim().length > 0) {
      return item;
    }
    return { ...item, progressKey: quiz.progressKey };
  });

  const validatedSession = SessionSchema.parse({
    ...sessionDoc,
    plan: planWithProgress,
    status: "ready",
    createdAt,
    nextLessonProposals: [],
  });

  return {
    session: validatedSession,
    quizzes,
    problems,
    media,
  };
}

function buildAgentTools(options: {
  workspace: SparkAgentWorkspace;
  rootDir: string;
  userId: string;
  serviceAccountJson: string;
  progress?: JobProgressReporter;
  onToolLlmCost?: (toolName: ToolLlmCostName, costUsd: number) => void;
  enforceLessonPipeline?: boolean;
  allowPythonExec?: boolean;
  graderPublish?: GraderPublishConfig;
  sheetDraftPublish?: SheetDraftPublishConfig;
  beforePublishSheet?: () => Promise<void>;
  onPublishSheet?: (
    publication: PublishedGraderSheetArtifacts,
  ) => Promise<void> | void;
  beforePublishSheetDraft?: () => Promise<void>;
  onPublishSheetDraft?: (
    publication: PublishedSheetDraftArtifacts,
  ) => Promise<void> | void;
  debug?: LlmDebugOptions;
  extractTextDebugRootDir?: string;
}): LlmToolSet {
  const {
    workspace,
    rootDir,
    userId,
    serviceAccountJson,
    progress,
    onToolLlmCost,
    enforceLessonPipeline,
    allowPythonExec,
    graderPublish,
    sheetDraftPublish,
    beforePublishSheet,
    onPublishSheet,
    beforePublishSheetDraft,
    onPublishSheetDraft,
    debug,
    extractTextDebugRootDir,
  } = options;
  const resolvedExtractTextDebugRootDir = (() => {
    const raw =
      typeof extractTextDebugRootDir === "string"
        ? extractTextDebugRootDir.trim()
        : "";
    if (raw.length === 0) {
      return path.join(rootDir, "debug");
    }
    if (path.isAbsolute(raw)) {
      return raw;
    }
    return path.join(rootDir, raw);
  })();

  const shouldEnforceLessonPipeline = enforceLessonPipeline === true;
  const shouldAllowPythonExec = allowPythonExec ?? true;
  const isGraderPublishingRun = graderPublish !== undefined;
  let graderPublishCompleted = false;
  let prePublishImageEditCount = 0;
  let prePublishGlobalImageEditBlockedReason: string | null = null;
  let prePublishDiagramExtractionCount = 0;
  let prePublishCropRecoveryCredits = 0;
  const prePublishCropAttemptsByOutputPath = new Map<string, number>();
  const workspaceViewImageTool = createCodexFilesystemToolSet(
    buildSparkAgentFilesystemToolConfig({ workspace, rootDir }).options,
  ).view_image;

  const workspaceFileExists = async (filePath: string): Promise<boolean> => {
    try {
      await stat(resolveWorkspacePath(rootDir, filePath));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  };
  const readWorkspaceFileIfExists = async (
    filePath: string,
  ): Promise<string> => {
    return readFile(resolveWorkspacePath(rootDir, filePath), {
      encoding: "utf8",
    }).catch(() => "");
  };
  const isWriteWorkspaceFileTarget = (
    input: unknown,
    filePath: string,
  ): boolean => {
    if (input === null || typeof input !== "object") {
      return false;
    }
    const rawFilePath = (input as { filePath?: unknown }).filePath;
    if (typeof rawFilePath !== "string") {
      return false;
    }
    return rawFilePath.replace(/\\/gu, "/").trim() === filePath;
  };
  const readWorkspaceStringInputField = (
    input: unknown,
    field: string,
  ): string | null => {
    if (input === null || typeof input !== "object") {
      return null;
    }
    const rawValue = (input as Record<string, unknown>)[field];
    if (typeof rawValue !== "string") {
      return null;
    }
    const normalizedValue = rawValue.replace(/\\/gu, "/").trim();
    return normalizedValue.length > 0 ? normalizedValue : null;
  };
  const isWorkspacePathUnder = (
    filePath: string | null,
    allowedPrefixes: readonly string[],
  ): boolean => {
    if (filePath === null) {
      return false;
    }
    return allowedPrefixes.some((prefix) => {
      return filePath === prefix || filePath.startsWith(`${prefix}/`);
    });
  };
  const readWorkspacePathInputField = (input: unknown): string | null => {
    return (
      readWorkspaceStringInputField(input, "filePath") ??
      readWorkspaceStringInputField(input, "file_path") ??
      readWorkspaceStringInputField(input, "path")
    );
  };
  const isPostScoringAssemblyRead = (
    toolName: string,
    input: unknown,
  ): boolean => {
    if (toolName !== "read_workspace_file" && toolName !== "read_file") {
      return false;
    }
    const filePath = readWorkspacePathInputField(input);
    if (filePath === null) {
      return false;
    }
    return (
      [
        "brief.md",
        "request.json",
        "grader/task.md",
        "grader/uploads/index.json",
        "grader/output/transcription.md",
        "grader/output/sheet-plan.md",
        "grader/output/sheet.json",
        "grader/output/run-summary.json",
        "grader/output/crop-validation.md",
        "grader/output/source-fidelity-audit.md",
      ].includes(filePath) ||
      isWorkspacePathUnder(filePath, [
        "skills",
        "grader/output/scoring",
        "grader/output/source-fidelity-audits",
      ])
    );
  };
  const isPostScoringAssemblyListing = (
    toolName: string,
    input: unknown,
  ): boolean => {
    if (toolName !== "list_workspace_dir" && toolName !== "list_dir") {
      return false;
    }
    const rawDirectoryPath =
      readWorkspaceStringInputField(input, "directoryPath") ??
      readWorkspaceStringInputField(input, "dir_path");
    const directoryPath = rawDirectoryPath ?? ".";
    return (
      directoryPath === "." ||
      [
        "grader",
        "grader/output",
        "grader/output/assets",
        "grader/output/scoring",
        "skills",
      ].includes(directoryPath)
    );
  };
  const readPositiveIntegerInputField = (
    input: unknown,
    field: string,
  ): number | null => {
    if (input === null || typeof input !== "object") {
      return null;
    }
    const rawValue = (input as Record<string, unknown>)[field];
    if (typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue > 0) {
      return rawValue;
    }
    if (typeof rawValue === "string" && rawValue.trim().length > 0) {
      const parsed = Number.parseInt(rawValue.trim(), 10);
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
  };
  const readPositiveIntegerArrayInputField = (
    input: unknown,
    field: string,
  ): number[] | null => {
    if (input === null || typeof input !== "object") {
      return null;
    }
    const rawValue = (input as Record<string, unknown>)[field];
    if (!Array.isArray(rawValue)) {
      return null;
    }
    const pageNumbers = rawValue
      .map((entry) => {
        if (typeof entry === "number" && Number.isInteger(entry) && entry > 0) {
          return entry;
        }
        if (typeof entry === "string" && entry.trim().length > 0) {
          const parsed = Number.parseInt(entry.trim(), 10);
          if (Number.isInteger(parsed) && parsed > 0) {
            return parsed;
          }
        }
        return null;
      })
      .filter((entry): entry is number => entry !== null);
    return pageNumbers.length > 0 ? pageNumbers : null;
  };
  const isBoundedPdfPageSelection = (input: unknown): boolean => {
    const explicitPages =
      readPositiveIntegerArrayInputField(input, "pageNumbers") ??
      readPositiveIntegerArrayInputField(input, "pages");
    if (explicitPages !== null) {
      return explicitPages.length <= PDF_PAGE_NUMBERS_PREFERRED_THRESHOLD;
    }
    if (readPositiveIntegerInputField(input, "page") !== null) {
      return true;
    }
    const firstPage = readPositiveIntegerInputField(input, "firstPage");
    const lastPage = readPositiveIntegerInputField(input, "lastPage");
    if (firstPage === null && lastPage === null) {
      return false;
    }
    const startPage = firstPage ?? lastPage;
    const endPage = lastPage ?? firstPage;
    if (startPage === null || endPage === null || endPage < startPage) {
      return false;
    }
    return endPage - startPage + 1 <= PDF_PAGE_NUMBERS_PREFERRED_THRESHOLD;
  };
  const isPostScoringSourceVisualPrep = (
    toolName: string,
    input: unknown,
  ): boolean => {
    const pdfPath = readWorkspaceStringInputField(input, "pdfPath");
    const outputDir = readWorkspaceStringInputField(input, "outputDir");
    if (!isWorkspacePathUnder(pdfPath, ["grader/uploads"])) {
      return false;
    }
    switch (toolName) {
      case "extract_pdf_images":
        return isWorkspacePathUnder(outputDir, [
          "grader/output/pdf-images",
          "grader/output/source-images",
        ]);
      case "pdf_to_images":
        return (
          isWorkspacePathUnder(outputDir, [
            "grader/output/rendered-pages",
            "grader/output/page-images",
            "grader/output/source-pages",
          ]) && isBoundedPdfPageSelection(input)
        );
      default:
        return false;
    }
  };
  const getLongHandwrittenGraderProgress = async (): Promise<{
    longHandwritten: boolean;
    transcriptionExists: boolean;
    sheetPlanExists: boolean;
    scoringHelperCalled: boolean;
    cropReviewCalled: boolean;
    cropValidationExists: boolean;
    sheetJsonExists: boolean;
    runSummaryJsonExists: boolean;
    sheetPlanIssues: string[];
    transcriptionIssues: string[];
  }> => {
    if (!isGraderPublishingRun || graderPublishCompleted) {
      return {
        longHandwritten: false,
        transcriptionExists: false,
        sheetPlanExists: false,
        scoringHelperCalled: false,
        cropReviewCalled: false,
        cropValidationExists: false,
        sheetJsonExists: false,
        runSummaryJsonExists: false,
        sheetPlanIssues: [],
        transcriptionIssues: [],
      };
    }

    const [
      transcriptionMarkdown,
      rawStudentTranscriptionMarkdown,
      rawStudentExtractMarkdown,
      studentExtractMarkdown,
      transcriptionRawMarkdown,
      studentTranscriptionRawMarkdown,
      studentTranscriptionMarkdown,
      studentWorkTranscriptionMarkdown,
      sheetPlanMarkdown,
    ] = await Promise.all([
      readWorkspaceFileIfExists("grader/output/transcription.md"),
      readWorkspaceFileIfExists("grader/output/raw-student-transcription.md"),
      readWorkspaceFileIfExists("grader/output/raw-student-extract.md"),
      readWorkspaceFileIfExists("grader/output/student-extract.md"),
      readWorkspaceFileIfExists("grader/output/transcription-raw.md"),
      readWorkspaceFileIfExists("grader/output/student-transcription-raw.md"),
      readWorkspaceFileIfExists("grader/output/student-transcription.md"),
      readWorkspaceFileIfExists("grader/output/student-work-transcription.md"),
      readWorkspaceFileIfExists("grader/output/sheet-plan.md"),
    ]);
    const progressMarkdown = [
      transcriptionMarkdown,
      rawStudentTranscriptionMarkdown,
      rawStudentExtractMarkdown,
      studentExtractMarkdown,
      transcriptionRawMarkdown,
      studentTranscriptionRawMarkdown,
      studentTranscriptionMarkdown,
      studentWorkTranscriptionMarkdown,
      sheetPlanMarkdown,
    ].join("\n");
    if (progressMarkdown.trim().length === 0) {
      return {
        longHandwritten: false,
        transcriptionExists: false,
        sheetPlanExists: false,
        scoringHelperCalled: false,
        cropReviewCalled: false,
        cropValidationExists: false,
        sheetJsonExists: false,
        runSummaryJsonExists: false,
        sheetPlanIssues: [],
        transcriptionIssues: [],
      };
    }

    const sourceLeafLabels = new Set<string>();
    for (const match of progressMarkdown.matchAll(
      /(?:^|[^\d.])0?\s*([1-9]\d?)\s*\.\s*([1-9]\d?)(?![\d.])/gu,
    )) {
      const root = match[1]?.replace(/\s+/gu, "");
      const leaf = match[2]?.replace(/\s+/gu, "");
      if (root && leaf) {
        sourceLeafLabels.add(`${root}.${leaf}`);
      }
    }
    const studentAnswerExtractMarkdown = [
      rawStudentTranscriptionMarkdown,
      rawStudentExtractMarkdown,
      studentExtractMarkdown,
      transcriptionRawMarkdown,
      studentTranscriptionRawMarkdown,
      studentTranscriptionMarkdown,
      studentWorkTranscriptionMarkdown,
    ].join("\n");
    const studentAnswerExtractHasManyLeaves =
      studentAnswerExtractMarkdown.trim().length > 0 && sourceLeafLabels.size > 12;
    const handwrittenMode =
      /\bmode\s*:\s*(?:[`*_]+)?handwritten-grading(?:[`*_]+)?\b/iu.test(
        progressMarkdown,
      ) ||
      /\bstudent\s+(?:answer|work|handwritten)\s+transcription\b/iu.test(
        progressMarkdown,
      ) ||
      /\bstudent\s+handwritten\s+answers?\b/iu.test(progressMarkdown) ||
      studentAnswerExtractHasManyLeaves;
    const longHandwritten =
      handwrittenMode &&
      (sourceLeafLabels.size > 12 ||
        /\b(?:overall\s+expected\s+total|total)\s*:\s*(?:3[1-9]|[4-9]\d|\d{3,})\s*marks?\b/iu.test(
          progressMarkdown,
        ) ||
        /\[(?:3[1-9]|[4-9]\d|\d{3,})\s*marks?\]/iu.test(progressMarkdown));

    if (!longHandwritten) {
      return {
        longHandwritten: false,
        transcriptionExists: false,
        sheetPlanExists: false,
        scoringHelperCalled: false,
        cropReviewCalled: false,
        cropValidationExists: false,
        sheetJsonExists: false,
        runSummaryJsonExists: false,
        sheetPlanIssues: [],
        transcriptionIssues: [],
      };
    }

    const [
      sheetPlanExists,
      scoringBatchFileCount,
      cropValidationExists,
      sheetJsonExists,
      runSummaryJsonExists,
      rawAgentLogMarkdown,
      agentToolCallLogMarkdown,
      questionPaperReferenceMarkdown,
      sourceReferenceMarkdown,
      sourceReferenceAltMarkdown,
    ] = await Promise.all([
      workspaceFileExists("grader/output/sheet-plan.md"),
      countWorkspaceJsonFiles(rootDir, "grader/output/scoring"),
      workspaceFileExists("grader/output/crop-validation.md"),
      workspaceFileExists("grader/output/sheet.json"),
      workspaceFileExists("grader/output/run-summary.json"),
      readWorkspaceFileIfExists("logs/agent/agent.log"),
      readAgentToolCallLogMarkdown(rootDir),
      readWorkspaceFileIfExists("grader/output/qp-reference.md"),
      readWorkspaceFileIfExists("grader/output/question-paper-reference.md"),
      readWorkspaceFileIfExists("grader/output/source-reference.md"),
    ]);
    const agentLogMarkdown = [
      rawAgentLogMarkdown,
      agentToolCallLogMarkdown,
    ].join("\n");
    const sourceReferenceMarkdownForSheetPlan = [
      questionPaperReferenceMarkdown,
      sourceReferenceMarkdown,
      sourceReferenceAltMarkdown,
    ].join("\n\n");

    return {
      longHandwritten: true,
      transcriptionExists: transcriptionMarkdown.trim().length > 0,
      sheetPlanExists,
      scoringHelperCalled: scoringBatchFileCount > 0,
      cropReviewCalled: FRESH_CROP_REVIEW_TOOL_PATTERN.test(agentLogMarkdown),
      cropValidationExists,
      sheetJsonExists,
      runSummaryJsonExists,
      sheetPlanIssues: [
        ...collectSheetPlanConsistencyIssues(sheetPlanMarkdown),
        ...collectSheetPlanSourceReferenceIssues({
          sheetPlanMarkdown,
          sourceReferenceMarkdown: sourceReferenceMarkdownForSheetPlan,
        }),
      ],
      transcriptionIssues:
        collectSourceTranscriptionIntegrityIssues(transcriptionMarkdown),
    };
  };
  const shouldRequireGraderPublishCriticalPath =
    async (): Promise<boolean> => {
      if (!isGraderPublishingRun || graderPublishCompleted) {
        return false;
      }
      const [summaryExists, sheetExists] = await Promise.all([
        workspaceFileExists("grader/output/run-summary.json"),
        workspaceFileExists("grader/output/sheet.json"),
      ]);
      return summaryExists && sheetExists;
    };
  const applyGraderPublishCriticalGate = (
    sourceTools: LlmToolSet,
  ): LlmToolSet => {
    if (!isGraderPublishingRun) {
      return sourceTools;
    }
    const nextTools: LlmToolSet = {};
    const runGraderPublishCriticalGate = async (
      toolName: string,
      input: unknown,
      executeTool: () => Promise<unknown> | unknown,
    ): Promise<unknown> => {
      const longHandwrittenProgress = await getLongHandwrittenGraderProgress();
      const isScoringHelperTool = toolName === "score_answers_with_fresh_agent";
      const isPostScoringAssemblyTarget =
        toolName === "write_json_workspace_file" &&
        (isWriteWorkspaceFileTarget(input, "grader/output/sheet.json") ||
          isWriteWorkspaceFileTarget(input, "grader/output/run-summary.json"));
      const isPostScoringGuardedAssetCreation =
        toolName === "crop_image" || toolName === "pad_image";
      const isPostScoringVisualPrep = isPostScoringSourceVisualPrep(
        toolName,
        input,
      );
      const isPostScoringWorkspaceRead = isPostScoringAssemblyRead(
        toolName,
        input,
      );
      const isPostScoringWorkspaceListing = isPostScoringAssemblyListing(
        toolName,
        input,
      );
      const isSheetPlanRewrite =
        toolName === "write_workspace_file" &&
        (isWriteWorkspaceFileTarget(input, "grader/output/sheet-plan.md") ||
          isWriteWorkspaceFileTarget(input, "grader/output/transcription.md"));
      if (
        longHandwrittenProgress.longHandwritten &&
        !longHandwrittenProgress.sheetPlanExists &&
        GRADER_PRE_PLAN_BLOCKED_TOOLS.has(toolName)
      ) {
        return {
          status: "blocked_sheet_plan_required",
          blockedTool: toolName,
          nextAction:
            "This is a long handwritten-grading paper. Finish grader/output/transcription.md if needed, then write grader/output/sheet-plan.md with included leaves, marks, visual/table placements, and scoring batches. Then call score_answers_with_fresh_agent before image inspection/crop polishing.",
        };
      }
      if (
        longHandwrittenProgress.longHandwritten &&
        !longHandwrittenProgress.transcriptionExists &&
        !isSheetPlanRewrite &&
        (isScoringHelperTool || GRADER_PRE_PLAN_BLOCKED_TOOLS.has(toolName))
      ) {
        return {
          status: "blocked_source_transcription_required",
          blockedTool: toolName,
          nextAction:
            "This is a long handwritten-grading paper. Write grader/output/transcription.md with page-by-page student evidence plus verbatim printed source wording, figures, tables, displayed formulas, and layout notes before bounded scoring or artifact assembly.",
        };
      }
      if (
        longHandwrittenProgress.longHandwritten &&
        longHandwrittenProgress.transcriptionIssues.length > 0 &&
        !isSheetPlanRewrite &&
        (isScoringHelperTool || GRADER_PRE_SCORING_BLOCKED_TOOLS.has(toolName))
      ) {
        return {
          status: "blocked_source_transcription_invalid",
          blockedTool: toolName,
          nextAction: `${longHandwrittenProgress.transcriptionIssues[0] ?? "grader/output/transcription.md is not source-faithful"}. Rewrite grader/output/transcription.md page-by-page from the printed source before bounded scoring or artifact assembly.`,
        };
      }
      if (
        longHandwrittenProgress.longHandwritten &&
        longHandwrittenProgress.sheetPlanIssues.length > 0 &&
        !isSheetPlanRewrite &&
        (isScoringHelperTool || GRADER_PRE_SCORING_BLOCKED_TOOLS.has(toolName))
      ) {
        return {
          status: "blocked_sheet_plan_invalid",
          blockedTool: toolName,
          nextAction: `${longHandwrittenProgress.sheetPlanIssues[0] ?? "grader/output/sheet-plan.md is internally inconsistent"}. Rewrite grader/output/sheet-plan.md with consistent leaf, section, and total marks before bounded scoring or artifact assembly.`,
        };
      }
      if (
        longHandwrittenProgress.longHandwritten &&
        longHandwrittenProgress.sheetPlanExists &&
        !longHandwrittenProgress.scoringHelperCalled &&
        GRADER_PRE_SCORING_BLOCKED_TOOLS.has(toolName) &&
        !isSheetPlanRewrite
      ) {
        return {
          status: "blocked_bounded_scoring_required",
          blockedTool: toolName,
          nextAction:
            "This is a long handwritten-grading paper and grader/output/sheet-plan.md already exists. Call score_answers_with_fresh_agent now in 2-4 contiguous root/range batches using the focused source, student-answer, and mark-scheme excerpts already in transcription.md/sheet-plan.md. If those excerpts are missing, rewrite transcription.md or sheet-plan.md; do not keep reading/searching before bounded scoring. Issue all planned scoring calls in one parallel tool turn and use the returned questions/modelAnswer fields directly.",
        };
      }
      if (
        longHandwrittenProgress.longHandwritten &&
        longHandwrittenProgress.scoringHelperCalled &&
        (!longHandwrittenProgress.sheetJsonExists ||
          !longHandwrittenProgress.runSummaryJsonExists) &&
        !isScoringHelperTool &&
        !isPostScoringAssemblyTarget &&
        !isPostScoringGuardedAssetCreation &&
        !isPostScoringVisualPrep &&
        !isPostScoringWorkspaceRead &&
        !isPostScoringWorkspaceListing &&
        !isSheetPlanRewrite
      ) {
        return {
          status: "blocked_artifact_assembly_required",
          blockedTool: toolName,
          nextAction:
            "Bounded scoring is complete for this long handwritten-grading paper. If planned final image asset files are missing and no source image inventory exists, run one bounded source-visual prep step: extract_pdf_images to grader/output/pdf-images or pdf_to_images for the exact needed pages under grader/output/rendered-pages. Then create only final guarded grader/output/assets/... files at their exact sheet-plan paths with crop_image/fullImage or pad_image; do not create `-raw`, `-candidate`, `-draft`, or temp asset copies. Batch all missing crop/pad calls in one parallel tool turn. Immediately write grader/output/sheet.json with write_json_workspace_file; a valid sheet write can derive grader/output/run-summary.json. Preserve returned scores and teacher-review statuses. Do not crop-validate, reread, regrade, search, or enrich before first-pass artifacts. Put each figure/table in the exact question/group prompt, not section.theory. After both JSON files exist, call validate_grader_artifacts.",
        };
      }
      if (await shouldRequireGraderPublishCriticalPath()) {
        if (GRADER_POST_ARTIFACT_ALLOWED_TOOLS.has(toolName)) {
          return executeTool();
        }
        return {
          status: "blocked_publish_required",
          blockedTool: toolName,
          nextAction:
            'grader/output/sheet.json and grader/output/run-summary.json already exist. Do not start new extraction, scoring, web lookup, or enrichment work. Call validate_grader_artifacts({"requireSourceFidelityAudit": false}), fix any reported artifact issues, run the required source-fidelity audit if needed, then call publish_sheet({}).',
        };
      }
      return executeTool();
    };
    for (const [toolName, toolConfig] of Object.entries(sourceTools)) {
      if (toolConfig.type === "custom") {
        nextTools[toolName] = {
          ...toolConfig,
          execute: async (input) =>
            runGraderPublishCriticalGate(toolName, input, () =>
              toolConfig.execute(input),
            ),
        };
        continue;
      }
      nextTools[toolName] = {
        ...toolConfig,
        execute: async (input) => {
          return runGraderPublishCriticalGate(toolName, input, () =>
            toolConfig.execute(input),
          );
        },
      };
    }
    return nextTools;
  };
  let sharedPdfKnowledgeBaseEntries:
    | readonly SharedPdfKnowledgeBaseEntry[]
    | null = null;
  const loadSharedPdfKnowledgeBaseEntries = async (): Promise<
    readonly SharedPdfKnowledgeBaseEntry[]
  > => {
    if (sharedPdfKnowledgeBaseEntries !== null) {
      return sharedPdfKnowledgeBaseEntries;
    }
    sharedPdfKnowledgeBaseEntries = await listSharedPdfKnowledgeBase({
      serviceAccountJson,
      limit: 100,
    });
    return sharedPdfKnowledgeBaseEntries;
  };

  const graderArtifactsExist = async (): Promise<boolean> => {
    if (!isGraderPublishingRun) {
      return true;
    }
    const [sheetExists, summaryExists] = await Promise.all([
      workspaceFileExists("grader/output/sheet.json"),
      workspaceFileExists("grader/output/run-summary.json"),
    ]);
    return sheetExists && summaryExists;
  };

  const normalizePrePublishCropAttemptKey = (outputPath: string): string => {
    const normalizedPath = outputPath.replace(/\\/gu, "/");
    const parsed = path.posix.parse(normalizedPath);
    const normalizedName = parsed.name.replace(
      /(?:-(?:(?:candidate|clean|corrected|crop|final|fixed|gemini|recrop|refined|retry|revised|tight)(?:-\d+)?|v\d+))+$/u,
      "",
    );
    return path.posix.join(parsed.dir, `${normalizedName}${parsed.ext}`);
  };

  type LoggedToolCall = {
    readonly name: string;
    readonly timestamp: string;
    readonly arguments?: Record<string, unknown>;
    readonly outputPath?: string;
  };

  const readLoggedToolCalls = async (): Promise<LoggedToolCall[]> => {
    const callsRoot = path.join(rootDir, "logs/agent/llm_calls");
    const toolCallFiles: string[] = [];
    const visit = async (directoryPath: string): Promise<void> => {
      let entries: Array<{
        name: string | Buffer;
        isDirectory: () => boolean;
        isFile: () => boolean;
      }>;
      try {
        entries = await readdir(directoryPath, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        const entryName = String(entry.name);
        const entryPath = path.join(directoryPath, entryName);
        if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.isFile() && entryName === "tool_call.txt") {
          toolCallFiles.push(entryPath);
        }
      }
    };
    await visit(callsRoot);
    const loggedCalls: LoggedToolCall[] = [];
    const toolCallSchema = z.array(
      z.object({
        name: z.string(),
        arguments: z
          .object({
            outputPath: z.string().optional(),
          })
          .passthrough()
          .optional(),
      }),
    );
    for (const toolCallFile of toolCallFiles) {
      const stepDir = path.basename(path.dirname(path.dirname(toolCallFile)));
      const timestamp =
        /^(?<timestamp>\d{4}-\d{2}-\d{2}T.*Z)-\d+$/u.exec(stepDir)?.groups
          ?.timestamp ?? new Date(0).toISOString();
      const parsed = toolCallSchema.safeParse(
        JSON.parse(await readFile(toolCallFile, "utf8")),
      );
      if (!parsed.success) {
        continue;
      }
      for (const call of parsed.data) {
        loggedCalls.push({
          name: call.name,
          timestamp,
          ...(call.arguments ? { arguments: call.arguments } : {}),
          outputPath: call.arguments?.outputPath,
        });
      }
    }
    return loggedCalls.sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp),
    );
  };

  const inferSingleUploadedPdfPath = async (): Promise<string | null> => {
    const manifestPath = "grader/uploads/index.json";
    if (!(await workspaceFileExists(manifestPath))) {
      return null;
    }
    const manifest = z
      .object({
        attachments: z.array(
          z.object({
            workspacePath: z.string().trim().min(1),
            contentType: z.string().trim().optional(),
          }),
        ),
      })
      .safeParse(
        JSON.parse(
          await readFile(resolveWorkspacePath(rootDir, manifestPath), "utf8"),
        ),
      );
    if (!manifest.success) {
      return null;
    }
    const pdfAttachments = manifest.data.attachments.filter((attachment) => {
      const contentType = attachment.contentType?.toLowerCase() ?? "";
      return (
        contentType === "application/pdf" ||
        attachment.workspacePath.toLowerCase().endsWith(".pdf")
      );
    });
    if (pdfAttachments.length !== 1) {
      return null;
    }
    return pdfAttachments[0].workspacePath;
  };

  const resolveDiagramExtractionPromptText = async (options: {
    prompt?: string;
    promptPath?: string;
  }): Promise<string> => {
    if (
      typeof options.prompt === "string" &&
      options.prompt.trim().length > 0
    ) {
      return options.prompt.trim();
    }
    if (
      typeof options.promptPath === "string" &&
      options.promptPath.trim().length > 0
    ) {
      return await resolvePdfPromptText({
        toolName: "extract_pdf_diagrams",
        promptPath: options.promptPath,
      });
    }
    const defaultPromptPath = "grader/output/diagram-prompt.md";
    if (await workspaceFileExists(defaultPromptPath)) {
      return await readFile(
        resolveWorkspacePath(rootDir, defaultPromptPath),
        "utf8",
      );
    }
    return DEFAULT_PDF_DIAGRAM_EXTRACTION_PROMPT;
  };

  const checkGraderPrePublishDiagramExtractionAllowed = async (): Promise<
    string | null
  > => {
    if (!isGraderPublishingRun || (await graderArtifactsExist())) {
      return null;
    }
    prePublishDiagramExtractionCount += 1;
    const loggedDiagramExtractionCount = (await readLoggedToolCalls()).filter(
      (call) => call.name === "extract_pdf_diagrams",
    ).length;
    const effectiveDiagramExtractionCount = Math.max(
      prePublishDiagramExtractionCount,
      loggedDiagramExtractionCount,
    );
    if (
      effectiveDiagramExtractionCount <=
      GRADER_PRE_PUBLISH_DIAGRAM_EXTRACTION_BUDGET
    ) {
      return null;
    }
    return "extract_pdf_diagrams pre-publish attempt budget exceeded. No diagram proposal was written. Stop requesting more coarse boxes before the worksheet exists: use the existing page images, grid overlays, and propose_crop_bbox_with_fresh_agent if available. Do not link full-page fallbacks or publish a crop-validation file that records unresolved failures.";
  };

  const checkGraderPrePublishImageEditAllowed = async (
    toolName: "crop_image" | "trim_image",
    outputPath?: string,
  ): Promise<string | null> => {
    if (!isGraderPublishingRun || (await graderArtifactsExist())) {
      return null;
    }
    if (prePublishGlobalImageEditBlockedReason !== null) {
      return prePublishGlobalImageEditBlockedReason;
    }
    prePublishImageEditCount += 1;
    const loggedToolCalls = await readLoggedToolCalls();
    const loggedImageEditCount = loggedToolCalls.filter(
      (call) => call.name === "crop_image" || call.name === "trim_image",
    ).length;
    if (toolName === "crop_image" && outputPath !== undefined) {
      const attemptKey = normalizePrePublishCropAttemptKey(outputPath);
      const attempts =
        (prePublishCropAttemptsByOutputPath.get(attemptKey) ?? 0) + 1;
      prePublishCropAttemptsByOutputPath.set(attemptKey, attempts);
      const loggedAttempts = loggedToolCalls.filter((call) => {
        return (
          call.name === "crop_image" &&
          call.outputPath !== undefined &&
          normalizePrePublishCropAttemptKey(call.outputPath) === attemptKey
        );
      }).length;
      const effectiveAttempts = Math.max(attempts, loggedAttempts);
      if (
        effectiveAttempts > GRADER_PRE_PUBLISH_CROP_ATTEMPTS_PER_OUTPUT_BUDGET
      ) {
        if (prePublishCropRecoveryCredits > 0) {
          prePublishCropRecoveryCredits -= 1;
        } else {
          return `${toolName} repeated pre-publish crop-attempt budget exceeded for "${attemptKey}" (latest output "${outputPath}"). No crop was written. Stop guessing crop boxes for this output. Use the full source page plus grid overlay, or call propose_crop_bbox_with_fresh_agent / extract_pdf_diagrams if available; after a fresh bbox proposal, retry exactly once with the returned bboxPixels. Do not link full-page fallbacks or publish a crop-validation file that records unresolved failures.`;
        }
      }
    }
    const effectiveImageEditCount = Math.max(
      prePublishImageEditCount,
      loggedImageEditCount,
    );
    if (effectiveImageEditCount <= GRADER_PRE_PUBLISH_IMAGE_EDIT_BUDGET) {
      return null;
    }
    prePublishGlobalImageEditBlockedReason = `${toolName} pre-publish image-edit budget exceeded for this grader run. No crop/trim was written. Stop crop polishing now and do not publish known blocking crop failures. Use existing validated crops only; if an important figure is still unresolved, leave it as an explicit unresolved crop failure rather than relabelling it as passing or linking a full-page fallback.`;
    return prePublishGlobalImageEditBlockedReason;
  };

  const runProgressReviewSchema = z
    .object({
      decision: z.enum(["continue", "switch_strategy", "stop_and_report"]),
      confidence: z.number().min(0).max(1).optional(),
      wrongPathSignals: z.array(z.string().trim().min(1)).max(8),
      recommendedNextAction: z.string().trim().min(1),
      rationale: z.string().trim().min(1),
    })
    .strict();

  const freshGradingQuestionReviewSchema = z
    .object({
      id: z.string().trim().min(1),
      status: z.enum(["correct", "incorrect", "teacher-review"]),
      score: z.object({
        got: z.number().min(0),
        total: z.number().min(0),
      }),
      note: z.string(),
      replyPlaceholder: z.string().optional(),
      modelAnswer: z.string().optional(),
      evidence: z.string().optional(),
    })
    .strip();

  const freshGradingBatchResultSchema = z
    .object({
      scope: z.string(),
      totals: z.object({
        got: z.number().min(0),
        total: z.number().min(0),
      }),
      questions: z.array(freshGradingQuestionReviewSchema),
      uncertainties: z.array(z.string()).default([]),
    })
    .strip();

  const readAgentLogTail = async (maxChars: number): Promise<string> => {
    const raw = await readFile(path.join(rootDir, "logs/agent/agent.log"), {
      encoding: "utf8",
    }).catch(() => "");
    if (raw.length <= maxChars) {
      return raw;
    }
    return `...\n${raw.slice(-maxChars)}`;
  };

  const buildRunProgressSnapshot = async (options: {
    maxRecentToolCalls: number;
  }): Promise<Record<string, unknown>> => {
    const loggedToolCalls = await readLoggedToolCalls();
    const toolCounts = new Map<string, number>();
    for (const call of loggedToolCalls) {
      toolCounts.set(call.name, (toolCounts.get(call.name) ?? 0) + 1);
    }

    const cropAttemptsByOutput = new Map<string, number>();
    for (const call of loggedToolCalls) {
      if (call.name !== "crop_image" || call.outputPath === undefined) {
        continue;
      }
      const key = normalizePrePublishCropAttemptKey(call.outputPath);
      cropAttemptsByOutput.set(key, (cropAttemptsByOutput.get(key) ?? 0) + 1);
    }
    const repeatedCropOutputs = Array.from(cropAttemptsByOutput.entries())
      .filter(([, count]) => count > 1)
      .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
      .slice(0, 12)
      .map(([outputPath, count]) => ({ outputPath, count }));

    const recentToolCalls = loggedToolCalls
      .slice(-options.maxRecentToolCalls)
      .map((call) => ({
        timestamp: call.timestamp,
        name: call.name,
        ...(call.outputPath ? { outputPath: call.outputPath } : {}),
        arguments: formatToolLogSnippet(
          sanitizeJsonLikeValue(call.arguments ?? {}),
        ),
      }));

    const agentLogTail = await readAgentLogTail(12_000);
    return {
      toolCallCount: loggedToolCalls.length,
      toolCounts: Object.fromEntries(
        Array.from(toolCounts.entries()).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
      repeatedCropOutputs,
      imageEditBudget: {
        prePublishImageEditCount,
        prePublishDiagramExtractionCount,
        cropAttemptsPerOutputBudget:
          GRADER_PRE_PUBLISH_CROP_ATTEMPTS_PER_OUTPUT_BUDGET,
        imageEditBudget: GRADER_PRE_PUBLISH_IMAGE_EDIT_BUDGET,
        diagramExtractionBudget: GRADER_PRE_PUBLISH_DIAGRAM_EXTRACTION_BUDGET,
        ...(prePublishGlobalImageEditBlockedReason
          ? { blockedReason: prePublishGlobalImageEditBlockedReason }
          : {}),
      },
      recentToolCalls,
      agentLogTail,
    };
  };

  const validate_json = tool({
    description: [
      "Validate a workspace JSON file against Spark's Zod schemas (the same ones used by publish_lesson).",
      "Provide schemaPath (for disambiguation) and inputPath (the JSON file to validate).",
      "",
      "This tool fills publisher-managed fields before validating:",
      "- session: id, createdAt, status, nextLessonProposals",
      "- quiz: id, progressKey",
      "- code: slug",
      "- media: id, planItemId, sessionId, createdAt, updatedAt",
      "",
      "Inputs:",
      "- schemaPath (required): One of lesson/schema/session.schema.json|quiz.schema.json|coding_problem.schema.json|media.schema.json (or an equivalent hint).",
      "- inputPath (required): JSON file to validate (usually under lesson/output/...).",
      "- sessionId (optional): Override session id for session validation; otherwise inferred from request.json if present.",
      "",
      "Batching:",
      "- If you need to validate multiple outputs, call validate_json once per file in the SAME step (they will run in parallel).",
    ].join("\n"),
    inputSchema: z
      .object({
        schemaPath: z.string().trim().min(1),
        inputPath: z.string().trim().min(1),
        sessionId: z.preprocess((value) => {
          if (value === null || value === undefined) {
            return undefined;
          }
          if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          }
          return value;
        }, z.string().trim().min(1).optional()),
      })
      .strict(),
    execute: async ({ schemaPath, inputPath, sessionId }) => {
      const normalize = (value: string): string =>
        value.replace(/\\/g, "/").trim();

      const resolvedSchemaPath = normalize(schemaPath);
      const resolvedInputPath = normalize(inputPath);

      const resolveKind = (
        value: string,
      ): "session" | "quiz" | "code" | "media" | null => {
        const lowered = value.toLowerCase();
        if (lowered.endsWith("session.schema.json")) {
          return "session";
        }
        if (lowered.endsWith("quiz.schema.json")) {
          return "quiz";
        }
        if (lowered.endsWith("coding_problem.schema.json")) {
          return "code";
        }
        if (lowered.endsWith("media.schema.json")) {
          return "media";
        }
        return null;
      };

      const kind =
        resolveKind(resolvedSchemaPath) ?? resolveKind(resolvedInputPath);

      const formatIssuePath = (segments: Array<string | number>): string => {
        if (segments.length === 0) {
          return "(root)";
        }
        let out = "";
        for (const segment of segments) {
          if (typeof segment === "number") {
            out += `[${segment.toString()}]`;
            continue;
          }
          const key = segment.trim();
          if (key.length === 0) {
            continue;
          }
          if (out.length === 0) {
            out = key;
          } else {
            out += `.${key}`;
          }
        }
        return out.length > 0 ? out : "(root)";
      };

      const buildZodIssues = (
        error: z.ZodError,
      ): Array<{ path: string; message: string }> =>
        error.issues.slice(0, 50).map((issue) => ({
          path: formatIssuePath(issue.path as Array<string | number>),
          message: issue.message,
        }));

      const fail = (
        message: string,
        issues?: Array<{ path: string; message: string }>,
      ) => ({
        ok: false as const,
        schemaPath: resolvedSchemaPath,
        inputPath: resolvedInputPath,
        kind: kind ?? "unknown",
        error: message,
        issues:
          issues && issues.length > 0 ? issues : [{ path: "(root)", message }],
      });

      const readJsonObject = async (): Promise<Record<string, unknown>> => {
        const resolved = resolveWorkspacePath(rootDir, resolvedInputPath);
        const text = await readFile(resolved, { encoding: "utf8" });
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          throw new Error(
            `Invalid JSON in "${resolvedInputPath}": ${errorAsString(error)}`,
          );
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error(`"${resolvedInputPath}" must contain a JSON object.`);
        }
        return parsed as Record<string, unknown>;
      };

      const resolveSessionId = async (): Promise<string> => {
        const provided = sessionId?.trim() ?? "";
        if (provided.length > 0) {
          return provided;
        }
        try {
          const raw = await readFile(
            resolveWorkspacePath(rootDir, "request.json"),
            {
              encoding: "utf8",
            },
          );
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          const fromRequest =
            typeof parsed.sessionId === "string" ? parsed.sessionId.trim() : "";
          if (fromRequest.length > 0) {
            return fromRequest;
          }
        } catch {
          // ignore
        }
        return "session";
      };

      const inferPlanItemIdFromPath = (options: {
        dir: string;
        fallbackField: "id" | "slug" | "planItemId";
        record: Record<string, unknown>;
      }): string | null => {
        const normalized = resolvedInputPath;
        const prefix = `${options.dir.replace(/\\/g, "/").replace(/\/+$/g, "")}/`;
        if (normalized.startsWith(prefix) && normalized.endsWith(".json")) {
          const rest = normalized.slice(prefix.length, -".json".length);
          const trimmed = rest.trim();
          if (trimmed.length > 0 && !trimmed.includes("/")) {
            return trimmed;
          }
        }
        const fallbackValue = options.record[options.fallbackField];
        if (typeof fallbackValue === "string") {
          const trimmed = fallbackValue.trim();
          return trimmed.length > 0 ? trimmed : null;
        }
        return null;
      };

      if (!kind) {
        return fail(
          'Unknown schema kind. schemaPath should end with "session.schema.json", "quiz.schema.json", "coding_problem.schema.json", or "media.schema.json".',
        );
      }

      try {
        const record = await readJsonObject();
        const nowIso = new Date().toISOString();

        switch (kind) {
          case "session": {
            const resolvedSessionId = await resolveSessionId();
            const candidate: Record<string, unknown> = {
              ...record,
              id: resolvedSessionId,
              createdAt: nowIso,
              status: "ready",
              nextLessonProposals: [],
            };
            const parsed = SessionSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Session validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              sessionId: parsed.data.id,
              planItems: parsed.data.plan.length,
            };
          }
          case "quiz": {
            const planItemId =
              inferPlanItemIdFromPath({
                dir: "lesson/output/quiz",
                fallbackField: "id",
                record,
              }) ??
              inferPlanItemIdFromPath({
                dir: "quiz",
                fallbackField: "id",
                record,
              });
            if (!planItemId) {
              return fail(
                'Unable to infer quiz id. Use inputPath like "lesson/output/quiz/<planItemId>.json" or include an id field.',
              );
            }
            const resolvedSessionId = await resolveSessionId();
            const progressKeyRaw =
              typeof record.progressKey === "string"
                ? record.progressKey.trim()
                : "";
            const progressKey =
              progressKeyRaw.length > 0
                ? progressKeyRaw
                : `lesson:${resolvedSessionId}:${planItemId}`;
            const candidate: Record<string, unknown> = {
              ...record,
              id: planItemId,
              progressKey,
            };
            const parsed = QuizDefinitionSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Quiz validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              id: parsed.data.id,
              questions: parsed.data.questions.length,
            };
          }
          case "code": {
            const planItemId =
              inferPlanItemIdFromPath({
                dir: "lesson/output/code",
                fallbackField: "slug",
                record,
              }) ??
              inferPlanItemIdFromPath({
                dir: "code",
                fallbackField: "slug",
                record,
              });
            if (!planItemId) {
              return fail(
                'Unable to infer code problem slug. Use inputPath like "lesson/output/code/<planItemId>.json" or include a slug field.',
              );
            }
            const candidate: Record<string, unknown> = {
              ...record,
              slug: planItemId,
            };
            const parsed = CodeProblemSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Code problem validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              slug: parsed.data.slug,
              tests: parsed.data.tests.length,
            };
          }
          case "media": {
            const planItemId =
              inferPlanItemIdFromPath({
                dir: "lesson/output/media",
                fallbackField: "planItemId",
                record,
              }) ??
              inferPlanItemIdFromPath({
                dir: "media",
                fallbackField: "planItemId",
                record,
              });
            if (!planItemId) {
              return fail(
                'Unable to infer media planItemId. Use inputPath like "lesson/output/media/<planItemId>.json" or include planItemId.',
              );
            }
            const resolvedSessionId = await resolveSessionId();
            const candidate: Record<string, unknown> = {
              ...record,
              id: planItemId,
              planItemId,
              sessionId: resolvedSessionId,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            const parsed = SessionMediaDocSchema.safeParse(candidate);
            if (!parsed.success) {
              return fail(
                "Media validation failed.",
                buildZodIssues(parsed.error),
              );
            }
            return {
              ok: true as const,
              schemaPath: resolvedSchemaPath,
              inputPath: resolvedInputPath,
              kind,
              id: parsed.data.id,
              narrationLines: parsed.data.narration.length,
              images: parsed.data.images.length,
            };
          }
        }
      } catch (error) {
        return fail(errorAsString(error));
      }
    },
  });

  const resolvePdfPromptText = async (options: {
    toolName:
      | "extract_text"
      | "extract_pdf_text"
      | "read_pdf"
      | "extract_pdf_diagrams";
    prompt?: string;
    promptPath?: string;
  }): Promise<string> => {
    if (
      typeof options.prompt === "string" &&
      options.prompt.trim().length > 0
    ) {
      return options.prompt.trim();
    }
    const resolvedPromptPath = options.promptPath?.trim() ?? "";
    if (resolvedPromptPath.length === 0) {
      throw new Error(
        `${options.toolName} requires either prompt or promptPath.`,
      );
    }
    const promptText = await readFile(
      resolveWorkspacePath(rootDir, resolvedPromptPath),
      { encoding: "utf8" },
    );
    const trimmedPrompt = promptText.trim();
    if (trimmedPrompt.length === 0) {
      throw new Error(
        `${options.toolName} prompt from "${resolvedPromptPath}" is empty.`,
      );
    }
    return trimmedPrompt;
  };

  const decodePdfBytesFromWorkspace = async (options: {
    toolName:
      | "extract_text"
      | "extract_pdf_text"
      | "read_pdf"
      | "extract_pdf_diagrams"
      | "extract_pdf_images";
    pdfPath: string;
  }): Promise<{ pdfBytes: Buffer; resolvedPdfPath: string }> => {
    const resolvedPdfPath = options.pdfPath.trim();
    const rawPdfFile = await readFile(
      resolveWorkspacePath(rootDir, resolvedPdfPath),
    );
    let pdfBytes = rawPdfFile;
    const isRawPdf = rawPdfFile.subarray(0, 5).toString("utf8") === "%PDF-";
    if (!isRawPdf) {
      const rawText = rawPdfFile.toString("utf8").trim();
      const withoutPrefix = rawText.replace(
        /^data:application\/pdf;base64,/iu,
        "",
      );
      const compact = withoutPrefix.replace(/\s+/gu, "");
      if (compact.length === 0) {
        throw new Error(
          `${options.toolName} could not decode "${resolvedPdfPath}" as PDF bytes.`,
        );
      }
      const normalizedBase64 = compact.replace(/-/gu, "+").replace(/_/gu, "/");
      if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(normalizedBase64)) {
        throw new Error(
          `${options.toolName} expected base64 data in "${resolvedPdfPath}".`,
        );
      }
      if (normalizedBase64.length % 4 !== 0) {
        throw new Error(
          `${options.toolName} expected padded base64 in "${resolvedPdfPath}".`,
        );
      }
      pdfBytes = Buffer.from(normalizedBase64, "base64");
    }
    return { pdfBytes, resolvedPdfPath };
  };

  const fetchPdfBytesFromUrl = async (options: {
    toolName: "read_pdf" | "extract_pdf_diagrams";
    url: string;
  }): Promise<{
    pdfBytes: Buffer;
    finalUrl: string;
    contentType: string;
    storagePath?: string;
  }> => {
    const rawUrl = options.url.trim();
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(
        `${options.toolName} supports only http/https URLs (got "${parsed.protocol}").`,
      );
    }

    const bucketName = `${parseGoogleServiceAccountJson(serviceAccountJson).projectId}.firebasestorage.app`;
    const existing = await findSharedPdfKnowledgeBaseByUrl({
      serviceAccountJson,
      url: parsed.toString(),
    });
    if (existing) {
      const downloaded = await downloadStorageObject({
        serviceAccountJson,
        bucketName,
        objectName: existing.storagePath,
      });
      const hasPdfHeader =
        Buffer.from(downloaded.bytes).subarray(0, 5).toString("utf8") ===
        "%PDF-";
      if (!hasPdfHeader) {
        throw new Error(
          `${options.toolName} expected PDF bytes from cached shared path "${existing.storagePath}".`,
        );
      }
      return {
        pdfBytes: Buffer.from(downloaded.bytes),
        finalUrl: existing.finalUrl ?? parsed.toString(),
        contentType: downloaded.contentType ?? existing.contentType,
        storagePath: existing.storagePath,
      };
    }

    const cached = await cacheSharedPdfFromUrl({
      serviceAccountJson,
      bucketName,
      url: parsed.toString(),
      descriptionMarkdown: [
        `uncategorized/pdf/${path.posix.basename(parsed.pathname) || "document.pdf"}`,
        "",
        `Cached automatically by ${options.toolName} from a PDF URL before extraction.`,
        "A future agent should replace this entry with a more specific exam-board/session/source classification when available.",
        "",
        `Source URL: ${parsed.toString()}`,
      ].join("\n"),
    });
    const refreshedKnowledgeBase = await writeKnowledgeBaseWorkspaceFiles({
      serviceAccountJson,
      rootDir,
      limit: 100,
    });
    workspace.scheduleUpdate("knowledge-base/index.md");
    for (const filePath of refreshedKnowledgeBase.files) {
      workspace.scheduleUpdate(filePath);
    }
    const cachedDownload = await downloadStorageObject({
      serviceAccountJson,
      bucketName,
      objectName: cached.entry.storagePath,
    });
    const cachedHasPdfHeader =
      Buffer.from(cachedDownload.bytes).subarray(0, 5).toString("utf8") ===
      "%PDF-";
    if (!cachedHasPdfHeader) {
      throw new Error(
        `${options.toolName} expected PDF bytes from cached shared path "${cached.entry.storagePath}".`,
      );
    }
    return {
      pdfBytes: Buffer.from(cachedDownload.bytes),
      finalUrl: cached.entry.finalUrl ?? parsed.toString(),
      contentType: cachedDownload.contentType ?? cached.entry.contentType,
      storagePath: cached.entry.storagePath,
    };
  };

  const resolveExtractTextPrimaryDocumentFromWorkspace = async (options: {
    documentPath: string;
  }): Promise<{
    documentBytes: Buffer;
    documentPath: string;
    documentKind: "pdf" | "image";
    documentMimeType: "application/pdf" | string;
  }> => {
    const resolvedDocumentPath = options.documentPath.trim();
    const documentBytes = await readFile(
      resolveWorkspacePath(rootDir, resolvedDocumentPath),
    );
    if (documentBytes.length === 0) {
      throw new Error(
        `extract_text received an empty document file "${resolvedDocumentPath}".`,
      );
    }
    const sourceLooksLikePdf =
      documentBytes.subarray(0, 5).toString("utf8") === "%PDF-";
    const sourceContentType = resolveContentType(resolvedDocumentPath);
    if (sourceLooksLikePdf || sourceContentType === "application/pdf") {
      const decoded = await decodePdfBytesFromWorkspace({
        toolName: "extract_text",
        pdfPath: resolvedDocumentPath,
      });
      if (decoded.pdfBytes.length === 0) {
        throw new Error(
          `extract_text received an empty PDF "${decoded.resolvedPdfPath}".`,
        );
      }
      if (decoded.pdfBytes.length > EXTRACT_TEXT_MAX_BYTES) {
        throw new Error(
          `extract_text PDF is too large (${decoded.pdfBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes).`,
        );
      }
      if (decoded.pdfBytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
        throw new Error(
          `extract_text expected PDF bytes in "${decoded.resolvedPdfPath}" (missing %PDF- header).`,
        );
      }
      return {
        documentBytes: decoded.pdfBytes,
        documentPath: decoded.resolvedPdfPath,
        documentKind: "pdf",
        documentMimeType: "application/pdf",
      };
    }

    const sourceMimeFromPath =
      typeof sourceContentType === "string" &&
      sourceContentType.startsWith("image/")
        ? sourceContentType
        : undefined;
    let sourceMimeType = sourceMimeFromPath;
    if (!sourceMimeType) {
      const sharp = getSharp();
      const metadata = await sharp(documentBytes)
        .metadata()
        .catch((error) => {
          throw new Error(
            `extract_text could not decode "${resolvedDocumentPath}" as an image: ${errorAsString(error)}`,
          );
        });
      sourceMimeType = resolveImageMimeTypeFromSharpFormat({
        format: metadata.format,
      });
    }

    if (!isSupportedCropImageMimeType(sourceMimeType)) {
      throw new Error(
        `extract_text supports PDF or image files (${SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES.join(", ")}). Received ${sourceMimeType ?? "unknown"} for "${resolvedDocumentPath}".`,
      );
    }
    if (typeof sourceMimeType !== "string") {
      throw new Error(
        `extract_text could not resolve image mime type for "${resolvedDocumentPath}".`,
      );
    }
    if (documentBytes.length > EXTRACT_TEXT_MAX_BYTES) {
      throw new Error(
        `extract_text image is too large (${documentBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes).`,
      );
    }
    return {
      documentBytes,
      documentPath: resolvedDocumentPath,
      documentKind: "image",
      documentMimeType: sourceMimeType,
    };
  };

  const resolveExtractTextContextPartFromWorkspace = async (options: {
    contextPath: string;
  }): Promise<{
    contextPath: string;
    contextKind: "pdf" | "image" | "text";
    bytes?: number;
    textChars?: number;
    part: LlmContentPart;
  }> => {
    const resolvedContextPath = options.contextPath.trim();
    const rawBytes = await readFile(
      resolveWorkspacePath(rootDir, resolvedContextPath),
    );
    if (rawBytes.length === 0) {
      throw new Error(
        `extract_text received an empty supporting file "${resolvedContextPath}".`,
      );
    }

    const contentType = resolveContentType(resolvedContextPath);
    const isTextContentType =
      typeof contentType === "string" &&
      (contentType.startsWith("text/") || contentType === "application/json");
    if (isTextContentType) {
      const decoded = rawBytes.toString("utf8").trim();
      const text = capUtf8Text(
        decoded,
        EXTRACT_TEXT_CONTEXT_TEXT_MAX_CHARS * 6,
      ).slice(0, EXTRACT_TEXT_CONTEXT_TEXT_MAX_CHARS);
      return {
        contextPath: resolvedContextPath,
        contextKind: "text",
        textChars: text.length,
        part: {
          type: "text",
          text: [
            "Supporting document text follows:",
            text.length > 0 ? text : "[empty]",
          ].join("\n"),
        },
      };
    }

    const looksLikePdf = rawBytes.subarray(0, 5).toString("utf8") === "%PDF-";
    if (looksLikePdf || contentType === "application/pdf") {
      const decoded = await decodePdfBytesFromWorkspace({
        toolName: "extract_text",
        pdfPath: resolvedContextPath,
      });
      if (decoded.pdfBytes.length > EXTRACT_TEXT_MAX_BYTES) {
        throw new Error(
          `extract_text supporting PDF is too large (${decoded.pdfBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes): "${decoded.resolvedPdfPath}".`,
        );
      }
      return {
        contextPath: decoded.resolvedPdfPath,
        contextKind: "pdf",
        bytes: decoded.pdfBytes.length,
        part: {
          type: "inlineData",
          data: decoded.pdfBytes.toString("base64"),
          mimeType: "application/pdf",
        },
      };
    }

    const sourceMimeFromPath =
      typeof contentType === "string" && contentType.startsWith("image/")
        ? contentType
        : undefined;
    let sourceMimeType = sourceMimeFromPath;
    if (!sourceMimeType) {
      const sharp = getSharp();
      const metadata = await sharp(rawBytes)
        .metadata()
        .catch((error) => {
          throw new Error(
            `extract_text could not decode supporting file "${resolvedContextPath}" as an image: ${errorAsString(error)}`,
          );
        });
      sourceMimeType = resolveImageMimeTypeFromSharpFormat({
        format: metadata.format,
      });
    }
    if (!isSupportedCropImageMimeType(sourceMimeType)) {
      throw new Error(
        `extract_text supporting files must be image/pdf/text. Received ${sourceMimeType ?? "unknown"} for "${resolvedContextPath}".`,
      );
    }
    if (typeof sourceMimeType !== "string") {
      throw new Error(
        `extract_text could not resolve image mime type for supporting file "${resolvedContextPath}".`,
      );
    }
    if (rawBytes.length > EXTRACT_TEXT_MAX_BYTES) {
      throw new Error(
        `extract_text supporting image is too large (${rawBytes.length.toString()} bytes, max ${EXTRACT_TEXT_MAX_BYTES.toString()} bytes): "${resolvedContextPath}".`,
      );
    }
    return {
      contextPath: resolvedContextPath,
      contextKind: "image",
      bytes: rawBytes.length,
      part: {
        type: "inlineData",
        data: rawBytes.toString("base64"),
        mimeType: sourceMimeType,
      },
    };
  };

  const extractTextToWorkspace = async (options: {
    documentPaths: readonly string[];
    outputPath: string;
    instructions?: string;
    supportingPaths?: readonly string[];
    supportingInstructions?: string;
  }): Promise<Record<string, unknown>> => {
    const resolvedOutputPath = options.outputPath.trim();
    if (resolvedOutputPath.endsWith(".json")) {
      throw new Error(
        `extract_text cannot write JSON ("${resolvedOutputPath}"). Write markdown (.md) instead.`,
      );
    }
    const normalizedDocumentPaths = Array.from(
      new Set(
        options.documentPaths
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      ),
    );
    if (normalizedDocumentPaths.length === 0) {
      throw new Error(
        [
          "extract_text requires documentPaths with at least one file path.",
          "Retry with payload shape:",
          '{"documentPaths":["source/<file>.png"],"outputPath":"output/<name>.md"}',
          "Do not retry unchanged arguments.",
        ].join(" "),
      );
    }
    if (normalizedDocumentPaths.length > EXTRACT_TEXT_MAX_DOCUMENT_FILES) {
      throw new Error(
        `extract_text supports at most ${EXTRACT_TEXT_MAX_DOCUMENT_FILES.toString()} documentPaths (got ${normalizedDocumentPaths.length.toString()}).`,
      );
    }
    const primaryDocuments = await Promise.all(
      normalizedDocumentPaths.map(
        async (documentPath) =>
          await resolveExtractTextPrimaryDocumentFromWorkspace({
            documentPath,
          }),
      ),
    );
    const primaryDocumentPathSet = new Set(
      primaryDocuments.map((item) => item.documentPath),
    );
    const supportingPaths = Array.from(
      new Set(
        (options.supportingPaths ?? [])
          .map((entry) => entry.trim())
          .filter(
            (entry) => entry.length > 0 && !primaryDocumentPathSet.has(entry),
          ),
      ),
    );
    if (supportingPaths.length > EXTRACT_TEXT_MAX_CONTEXT_FILES) {
      throw new Error(
        `extract_text supports at most ${EXTRACT_TEXT_MAX_CONTEXT_FILES.toString()} supportingPaths (got ${supportingPaths.length.toString()}).`,
      );
    }
    const supportingParts = await Promise.all(
      supportingPaths.map(
        async (contextPath) =>
          await resolveExtractTextContextPartFromWorkspace({ contextPath }),
      ),
    );

    const instructionText =
      typeof options.instructions === "string" &&
      options.instructions.trim().length > 0
        ? options.instructions.trim()
        : undefined;
    const supportingInstructionText =
      typeof options.supportingInstructions === "string" &&
      options.supportingInstructions.trim().length > 0
        ? options.supportingInstructions.trim()
        : undefined;
    const extractionPrompt = [
      "Transcribe the PRIMARY attached document files into markdown.",
      "You do not automatically know attachment filenames or paths unless they are written in text instructions.",
      "Do not summarize, solve, or rewrite content; preserve source wording and structure.",
      "Use markdown headings/lists where they match the document layout.",
      "For formulas/equations, use embedded LaTeX: inline '\\(...\\)', display '\\[...\\]'.",
      "Mark uncertain characters with short uncertainty markers (for example '[?]') instead of guessing.",
      "If the agent instructions request page markers for multi-page output, include them exactly as requested.",
      "Return markdown only.",
    ].join("\n");
    const primaryPrompt = [
      "Agent-supplied prompt (PRIMARY documents to transcribe):",
      instructionText ??
        "Transcribe all visible text from the primary documents.",
    ].join("\n");
    const supportingPrompt =
      supportingParts.length > 0
        ? [
            "Agent-supplied prompt (SUPPORTING documents for disambiguation only):",
            supportingInstructionText ?? EXTRACT_TEXT_DEFAULT_SUPPORTING_PROMPT,
          ].join("\n")
        : undefined;
    const extractionParts: LlmContentPart[] = [
      { type: "text", text: extractionPrompt },
      { type: "text", text: primaryPrompt },
      ...primaryDocuments.flatMap<LlmContentPart>((document, index) => {
        const label: LlmContentPart = {
          type: "text",
          text: `Primary document ${String(index + 1)} (${document.documentKind}) follows as inline data.`,
        };
        const payload: LlmContentPart = {
          type: "inlineData",
          data: document.documentBytes.toString("base64"),
          mimeType: document.documentMimeType,
        };
        return [label, payload];
      }),
      ...(supportingPrompt
        ? ([{ type: "text", text: supportingPrompt }] as LlmContentPart[])
        : []),
      ...supportingParts.flatMap<LlmContentPart>((item, index) => {
        const label =
          item.contextKind === "text"
            ? `Supporting document ${String(index + 1)} (text) follows.`
            : `Supporting document ${String(index + 1)} (${item.contextKind}) follows as inline data.`;
        return [{ type: "text", text: label } as LlmContentPart, item.part];
      }),
    ];
    const { promptText: renderedPromptWithInlineData, inlineAttachments } =
      renderExtractTextPromptWithInlineData({ parts: extractionParts });
    const primaryDocumentPathsForDebug = primaryDocuments.map(
      (item) => item.documentPath,
    );
    const supportingPathsForDebug = supportingParts.map(
      (item) => item.contextPath,
    );
    const extractionPromptText = [
      `documentPaths: ${JSON.stringify(primaryDocumentPathsForDebug)}`,
      ...(supportingPathsForDebug.length > 0
        ? [`supportingPaths: ${JSON.stringify(supportingPathsForDebug)}`]
        : []),
      "",
      renderedPromptWithInlineData,
    ].join("\n\n");
    const promptChars = extractionParts.reduce((sum, part) => {
      if (part.type !== "text") {
        return sum;
      }
      return sum + part.text.length;
    }, 0);

    const toolContext = getCurrentToolCallContext();
    const toolIdSegment = toolContext
      ? `turn${toolContext.turn}tool${toolContext.toolIndex}`
      : "turn0tool0";
    const extractTextLogPrefix = `[extract_text:${toolIdSegment}]`;
    const logExtractTextProgress = (message: string): void => {
      progress?.log(`${extractTextLogPrefix} ${message}`);
    };
    logExtractTextProgress(
      `start docs=${primaryDocuments.length.toString()} supporting=${supportingParts.length.toString()} promptChars=${promptChars.toString()} progress=${progress ? "yes" : "no"} debug=${debug ? "yes" : "no"}`,
    );
    const shouldPersistExtractTextDebugArtifacts =
      resolvedExtractTextDebugRootDir.trim().length > 0;
    if (shouldPersistExtractTextDebugArtifacts) {
      await persistExtractTextRequestDebugArtifacts({
        debugRootDir: resolvedExtractTextDebugRootDir,
        toolIdSegment,
        promptText: extractionPromptText,
        promptChars,
        modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        outputPath: resolvedOutputPath,
        documentPaths: primaryDocuments.map((item) => item.documentPath),
        supportingPaths: supportingParts.map((item) => item.contextPath),
        ...(typeof instructionText === "string" &&
        instructionText.trim().length > 0
          ? { instructions: instructionText }
          : {}),
        ...(typeof supportingInstructionText === "string" &&
        supportingInstructionText.trim().length > 0
          ? { supportingInstructions: supportingInstructionText }
          : {}),
        inlineAttachments,
      }).catch(() => undefined);
      logExtractTextProgress(
        `debug_request_written dir=${path.join("extract_text", toolIdSegment)}`,
      );
    }
    let streamedThinkingText = "";
    let lastThinkingTokensLogged: number | null = null;
    let llmResult: LlmTextResult | null = null;
    let extractedText = "";
    let modelCallElapsedMs: number | null = null;
    let finalExtractTextModelId: LlmTextModelId = DEFAULT_EXTRACT_TEXT_MODEL_ID;
    let finalCallStartedAt = Date.now();
    let extractTextTotalCostUsd = 0;
    const callStartedAt = Date.now();
    let callHeartbeatTimer: NodeJS.Timeout | undefined;
    try {
      callHeartbeatTimer = setInterval(() => {
        const elapsedMs = Date.now() - callStartedAt;
        logExtractTextProgress(
          `waiting_for_model elapsedMs=${elapsedMs.toString()}`,
        );
      }, 15_000);
      logExtractTextProgress("generate_text_call started");
      llmResult = await generateText({
        model: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        input: buildSingleUserInput(extractionParts),
      });
      recordLlmTextResult({
        progress,
        modelId: DEFAULT_EXTRACT_TEXT_MODEL_ID,
        result: llmResult,
      });
      extractTextTotalCostUsd += llmResult.costUsd;
      streamedThinkingText = llmResult.thoughts;
      extractedText = llmResult.text;
      finalExtractTextModelId = DEFAULT_EXTRACT_TEXT_MODEL_ID;
      finalCallStartedAt = callStartedAt;
      logExtractTextProgress(
        `generate_text_call completed elapsedMs=${(Date.now() - callStartedAt).toString()} extractedChars=${extractedText.length.toString()}`,
      );
      modelCallElapsedMs = Date.now() - callStartedAt;
    } finally {
      if (callHeartbeatTimer) {
        clearInterval(callHeartbeatTimer);
      }
    }

    let normalizedText = extractedText.trim();
    if (normalizedText.length === 0) {
      const fallbackModelId = DEFAULT_AGENT_MODEL_ID;
      const fallbackThinkingLevel =
        resolveSparkAgentThinkingLevel(fallbackModelId);
      const fallbackCallStartedAt = Date.now();
      logExtractTextProgress(
        `empty_response; retrying_with_model=${fallbackModelId}`,
      );
      const fallbackResult = await generateText({
        model: fallbackModelId,
        input: buildSingleUserInput([
          {
            type: "text",
            text: [
              "The first transcription attempt returned empty text.",
              "These inputs may be messy handwritten student work. Transcribe every legible student answer, number, diagram label, formula, and prompt fragment you can see.",
              "Use [illegible] for uncertain words or symbols. Do not return an empty response.",
            ].join("\n"),
          },
          ...extractionParts,
        ]),
        ...(fallbackThinkingLevel
          ? { thinkingLevel: fallbackThinkingLevel }
          : {}),
      });
      recordLlmTextResult({
        progress,
        modelId: fallbackModelId,
        result: fallbackResult,
      });
      extractTextTotalCostUsd += fallbackResult.costUsd;
      llmResult = fallbackResult;
      streamedThinkingText = fallbackResult.thoughts;
      extractedText = fallbackResult.text;
      normalizedText = extractedText.trim();
      finalExtractTextModelId = fallbackModelId;
      finalCallStartedAt = fallbackCallStartedAt;
      modelCallElapsedMs = Date.now() - fallbackCallStartedAt;
      logExtractTextProgress(
        `fallback_generate_text_call completed elapsedMs=${modelCallElapsedMs.toString()} extractedChars=${extractedText.length.toString()}`,
      );
    }

    const cappedText = capUtf8Text(
      normalizedText,
      EXTRACT_TEXT_DEFAULT_MAX_CHARS * 6,
    ).slice(0, EXTRACT_TEXT_DEFAULT_MAX_CHARS);
    const truncated = cappedText.length < normalizedText.length;
    const submodelSummary = llmResult
      ? createTrackedSubmodelCallSummary({
          modelId: finalExtractTextModelId,
          startedAt: finalCallStartedAt,
          result: llmResult,
        })
      : null;
    recordToolLlmCost(onToolLlmCost, "extract_text", extractTextTotalCostUsd);
    const finalThinkingTokensRaw = submodelSummary?.usageTokens?.thinkingTokens;
    const finalThinkingTokens =
      typeof finalThinkingTokensRaw === "number" &&
      Number.isFinite(finalThinkingTokensRaw)
        ? Math.max(0, Math.floor(finalThinkingTokensRaw))
        : null;
    if (
      typeof finalThinkingTokens === "number" &&
      finalThinkingTokens > 0 &&
      finalThinkingTokens !== lastThinkingTokensLogged
    ) {
      logExtractTextProgress(
        `thinking_tokens=${finalThinkingTokens.toString()}`,
      );
    }
    const responseElapsedMs =
      typeof submodelSummary?.elapsedMs === "number" &&
      Number.isFinite(submodelSummary.elapsedMs)
        ? submodelSummary.elapsedMs
        : (modelCallElapsedMs ?? undefined);
    if (shouldPersistExtractTextDebugArtifacts) {
      await persistExtractTextResponseDebugArtifacts({
        debugRootDir: resolvedExtractTextDebugRootDir,
        toolIdSegment,
        responseText: extractedText,
        thinkingText: streamedThinkingText,
        modelId: finalExtractTextModelId,
        ...(typeof submodelSummary?.modelVersion === "string" &&
        submodelSummary.modelVersion.trim().length > 0
          ? { modelVersion: submodelSummary.modelVersion }
          : {}),
        ...(typeof responseElapsedMs === "number" &&
        Number.isFinite(responseElapsedMs)
          ? { elapsedMs: responseElapsedMs }
          : {}),
        ...(typeof submodelSummary?.costUsd === "number" &&
        Number.isFinite(submodelSummary.costUsd)
          ? { costUsd: submodelSummary.costUsd }
          : {}),
        usageTokens: submodelSummary?.usageTokens ?? null,
        thinkingTokens: finalThinkingTokens,
        streamedResponseChars: extractedText.length,
        streamedResponseBytes: Buffer.byteLength(extractedText, "utf8"),
      }).catch(() => undefined);
      logExtractTextProgress(
        `debug_response_written dir=${path.join("extract_text", toolIdSegment)}`,
      );
    }
    if (normalizedText.length === 0) {
      logExtractTextProgress("empty_response");
      throw new Error(
        "extract_text returned an empty transcription after fallback. Do not repeat the same extraction call. Use review_run_progress_with_fresh_agent to decide whether to switch strategy, or use a dedicated fresh visual helper for localized image inspection; do not treat an empty output file as evidence.",
      );
    }

    const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
    await ensureDir(path.dirname(resolved));
    await writeFile(resolved, cappedText, { encoding: "utf8" });
    workspace.scheduleUpdate(resolvedOutputPath);
    if (truncated) {
      logExtractTextProgress(
        `response_truncated originalChars=${normalizedText.length.toString()} writtenChars=${cappedText.length.toString()}`,
      );
    }

    // Keep the agent-visible tool result minimal. The written markdown file is
    // the contract surface; internal model/cost/debug details stay in logs.
    return {
      status: "written",
    };
  };

  const PdfDiagramBoxSchema = z
    .object({
      left: z.number().min(0).max(1),
      top: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.left + value.width > 1.001) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxNorm.left + bboxNorm.width must be <= 1.",
          path: ["width"],
        });
      }
      if (value.top + value.height > 1.001) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxNorm.top + bboxNorm.height must be <= 1.",
          path: ["height"],
        });
      }
    });

  const PdfDiagramGridBoxSchema = z
    .object({
      left: z.number().int().min(0).max(1000),
      top: z.number().int().min(0).max(1000),
      right: z.number().int().min(0).max(1000),
      bottom: z.number().int().min(0).max(1000),
    })
    .strict()
    .superRefine((value, context) => {
      if (value.right <= value.left) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bbox1000.right must be greater than bbox1000.left.",
          path: ["right"],
        });
      }
      if (value.bottom <= value.top) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bbox1000.bottom must be greater than bbox1000.top.",
          path: ["bottom"],
        });
      }
    });

  const PdfDiagramItemSchema = z
    .object({
      id: z.string().trim().min(1),
      problemId: z.string().trim().min(1),
      page: z.number().int().min(1),
      bboxNorm: PdfDiagramBoxSchema,
      bbox1000: PdfDiagramGridBoxSchema.optional(),
      label: z.string().trim().min(1).optional(),
      description: z.string().trim().min(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
    .strict();

  const PdfDiagramManifestSchema = z
    .object({
      diagrams: z.array(PdfDiagramItemSchema).max(PDF_DIAGRAM_MAX_ITEMS),
      notes: z.string().trim().min(1).optional(),
    })
    .strict();

  const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  };

  const toFiniteInteger = (value: unknown): number | null => {
    const numeric = toFiniteNumber(value);
    if (numeric === null) {
      return null;
    }
    return Math.round(numeric);
  };

  const clamp1000 = (value: number): number => {
    return Math.max(0, Math.min(1000, value));
  };

  const toTrimmedString = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return trimmed;
  };

  const normalisePdfDiagramManifest = (
    raw: unknown,
    maxDiagrams: number,
  ): z.infer<typeof PdfDiagramManifestSchema> => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("extract_pdf_diagrams expected a JSON object.");
    }
    const rawRecord = raw as Record<string, unknown>;
    const rawDiagrams = rawRecord.diagrams;
    if (!Array.isArray(rawDiagrams)) {
      throw new Error(
        'extract_pdf_diagrams expected a "diagrams" array in model output.',
      );
    }
    const normalizedItems: z.infer<typeof PdfDiagramItemSchema>[] = [];
    for (const [index, rawEntry] of rawDiagrams.entries()) {
      if (
        !rawEntry ||
        typeof rawEntry !== "object" ||
        Array.isArray(rawEntry)
      ) {
        continue;
      }
      const entry = rawEntry as Record<string, unknown>;
      const bboxGridRaw =
        entry.bbox1000 &&
        typeof entry.bbox1000 === "object" &&
        !Array.isArray(entry.bbox1000)
          ? (entry.bbox1000 as Record<string, unknown>)
          : entry.bbox_int &&
              typeof entry.bbox_int === "object" &&
              !Array.isArray(entry.bbox_int)
            ? (entry.bbox_int as Record<string, unknown>)
            : null;
      const bboxRaw =
        entry.bboxNorm &&
        typeof entry.bboxNorm === "object" &&
        !Array.isArray(entry.bboxNorm)
          ? (entry.bboxNorm as Record<string, unknown>)
          : entry.bbox &&
              typeof entry.bbox === "object" &&
              !Array.isArray(entry.bbox)
            ? (entry.bbox as Record<string, unknown>)
            : null;
      if (!bboxRaw && !bboxGridRaw) {
        continue;
      }
      const left = bboxRaw ? toFiniteNumber(bboxRaw.left ?? bboxRaw.x) : null;
      const top = bboxRaw ? toFiniteNumber(bboxRaw.top ?? bboxRaw.y) : null;
      const width = bboxRaw ? toFiniteNumber(bboxRaw.width ?? bboxRaw.w) : null;
      const height = bboxRaw
        ? toFiniteNumber(bboxRaw.height ?? bboxRaw.h)
        : null;
      const page = toFiniteNumber(
        entry.page ?? entry.pageNumber ?? entry.page_number,
      );
      const problemId =
        toTrimmedString(entry.problemId ?? entry.problem ?? entry.problem_id) ??
        "unknown";
      const id =
        toTrimmedString(entry.id) ??
        `${problemId.toLowerCase()}-${(index + 1).toString()}`;
      if (page === null) {
        continue;
      }
      const label = toTrimmedString(entry.label);
      const description = toTrimmedString(entry.description);
      const confidence = toFiniteNumber(entry.confidence);
      let normalizedBbox: {
        left: number;
        top: number;
        width: number;
        height: number;
      } | null = null;
      let bbox1000:
        | {
            left: number;
            top: number;
            right: number;
            bottom: number;
          }
        | undefined;

      if (bboxGridRaw) {
        const leftGrid = toFiniteInteger(bboxGridRaw.left ?? bboxGridRaw.x0);
        const topGrid = toFiniteInteger(bboxGridRaw.top ?? bboxGridRaw.y0);
        const widthGrid = toFiniteInteger(bboxGridRaw.width ?? bboxGridRaw.w);
        const heightGrid = toFiniteInteger(bboxGridRaw.height ?? bboxGridRaw.h);
        const rightGrid =
          toFiniteInteger(bboxGridRaw.right ?? bboxGridRaw.x1) ??
          (leftGrid !== null && widthGrid !== null
            ? leftGrid + widthGrid
            : null);
        const bottomGrid =
          toFiniteInteger(bboxGridRaw.bottom ?? bboxGridRaw.y1) ??
          (topGrid !== null && heightGrid !== null
            ? topGrid + heightGrid
            : null);

        if (
          leftGrid !== null &&
          topGrid !== null &&
          rightGrid !== null &&
          bottomGrid !== null
        ) {
          const left1000 = clamp1000(leftGrid);
          const top1000 = clamp1000(topGrid);
          const right1000 = clamp1000(rightGrid);
          const bottom1000 = clamp1000(bottomGrid);
          if (right1000 > left1000 && bottom1000 > top1000) {
            bbox1000 = {
              left: left1000,
              top: top1000,
              right: right1000,
              bottom: bottom1000,
            };
            normalizedBbox = {
              left: left1000 / 1000,
              top: top1000 / 1000,
              width: (right1000 - left1000) / 1000,
              height: (bottom1000 - top1000) / 1000,
            };
          }
        }
      }

      if (normalizedBbox === null) {
        if (
          left === null ||
          top === null ||
          width === null ||
          height === null
        ) {
          continue;
        }
        normalizedBbox = {
          left,
          top,
          width,
          height,
        };
      }

      normalizedItems.push({
        id,
        problemId,
        page: Math.max(1, Math.round(page)),
        bboxNorm: normalizedBbox,
        ...(bbox1000 ? { bbox1000 } : {}),
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(confidence !== null
          ? { confidence: Math.max(0, Math.min(1, confidence)) }
          : {}),
      });
    }
    const notes = toTrimmedString(rawRecord.notes);
    const normalized: z.infer<typeof PdfDiagramManifestSchema> = {
      diagrams: normalizedItems.slice(0, Math.max(1, maxDiagrams)),
      ...(notes ? { notes } : {}),
    };
    const parsed = PdfDiagramManifestSchema.safeParse(normalized);
    if (!parsed.success) {
      const issueSummary = parsed.error.issues
        .slice(0, 10)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(
        `extract_pdf_diagrams returned invalid diagram manifest: ${issueSummary}`,
      );
    }
    return parsed.data;
  };

  const extractPdfTextToWorkspace = async (options: {
    toolName: "extract_pdf_text" | "read_pdf";
    pdfBytes: Uint8Array;
    outputPath: string;
    promptText: string;
    modelId?: string;
    maxChars?: number;
    sourceInfo: Record<string, unknown>;
  }): Promise<Record<string, unknown>> => {
    const resolvedOutputPath = options.outputPath.trim();
    if (resolvedOutputPath.endsWith(".json")) {
      throw new Error(
        `${options.toolName} cannot write JSON ("${resolvedOutputPath}").`,
      );
    }
    const pdfBytes = Buffer.from(options.pdfBytes);
    if (pdfBytes.length === 0) {
      throw new Error(`${options.toolName} received an empty PDF payload.`);
    }
    if (pdfBytes.length > PDF_EXTRACTION_MAX_BYTES) {
      throw new Error(
        `${options.toolName} PDF is too large (${pdfBytes.length.toString()} bytes, max ${PDF_EXTRACTION_MAX_BYTES.toString()} bytes).`,
      );
    }
    if (pdfBytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw new Error(
        `${options.toolName} expected PDF bytes (missing %PDF- header).`,
      );
    }

    const resolvedModelId = resolveTextModelId(
      options.modelId,
      DEFAULT_PDF_EXTRACTION_MODEL_ID,
    );
    const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);
    const extractionPrompt = [
      "Extract text from the attached PDF.",
      "Follow the user instructions exactly.",
      "Return plain text only.",
      "",
      "Instructions:",
      options.promptText,
    ].join("\n");
    const callStartedAt = Date.now();
    const llmResult = await generateText({
      model: resolvedModelId,
      input: buildSingleUserInput([
        { type: "text", text: extractionPrompt },
        {
          type: "inlineData",
          data: pdfBytes.toString("base64"),
          mimeType: "application/pdf",
        },
      ]),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
    recordLlmTextResult({
      progress,
      modelId: resolvedModelId,
      result: llmResult,
    });
    const extractedText = llmResult.text;

    const safeMaxChars = options.maxChars ?? PDF_EXTRACTION_DEFAULT_MAX_CHARS;
    const normalizedText = extractedText.trim();
    const cappedText = capUtf8Text(normalizedText, safeMaxChars * 6).slice(
      0,
      safeMaxChars,
    );
    const truncated = cappedText.length < normalizedText.length;
    const submodelSummary = createTrackedSubmodelCallSummary({
      modelId: resolvedModelId,
      startedAt: callStartedAt,
      result: llmResult,
    });
    recordToolLlmCost(onToolLlmCost, options.toolName, submodelSummary.costUsd);

    const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
    await ensureDir(path.dirname(resolved));
    await writeFile(resolved, cappedText, { encoding: "utf8" });
    workspace.scheduleUpdate(resolvedOutputPath);
    const outputBytes = Buffer.byteLength(cappedText, "utf8");

    return {
      status: "written",
      modelId: resolvedModelId,
      ...(submodelSummary?.modelVersion
        ? { modelVersion: submodelSummary.modelVersion }
        : {}),
      ...(submodelSummary?.elapsedMs !== undefined
        ? { elapsedMs: submodelSummary.elapsedMs }
        : {}),
      ...(typeof submodelSummary?.costUsd === "number"
        ? { costUsd: submodelSummary.costUsd }
        : {}),
      ...(submodelSummary?.usageTokens
        ? { usageTokens: submodelSummary.usageTokens }
        : {}),
      outputPath: resolvedOutputPath,
      promptChars: options.promptText.length,
      textChars: cappedText.length,
      outputBytes,
      pdfBytes: pdfBytes.length,
      ...(truncated ? { truncated: true } : {}),
      ...options.sourceInfo,
    };
  };

  const extractPdfDiagramManifestToWorkspace = async (options: {
    toolName: "extract_pdf_diagrams";
    pdfBytes: Uint8Array;
    outputPath: string;
    promptText: string;
    modelId?: string;
    maxDiagrams?: number;
    sourceInfo: Record<string, unknown>;
  }): Promise<Record<string, unknown>> => {
    const resolvedOutputPath = options.outputPath.trim();
    if (!resolvedOutputPath.endsWith(".json")) {
      throw new Error(
        `${options.toolName} outputPath must end with ".json" (got "${resolvedOutputPath}").`,
      );
    }
    const pdfBytes = Buffer.from(options.pdfBytes);
    if (pdfBytes.length === 0) {
      throw new Error(`${options.toolName} received an empty PDF payload.`);
    }
    if (pdfBytes.length > PDF_EXTRACTION_MAX_BYTES) {
      throw new Error(
        `${options.toolName} PDF is too large (${pdfBytes.length.toString()} bytes, max ${PDF_EXTRACTION_MAX_BYTES.toString()} bytes).`,
      );
    }
    if (pdfBytes.subarray(0, 5).toString("utf8") !== "%PDF-") {
      throw new Error(
        `${options.toolName} expected PDF bytes (missing %PDF- header).`,
      );
    }

    const safeMaxDiagrams = Math.max(
      1,
      Math.min(
        PDF_DIAGRAM_MAX_ITEMS,
        options.maxDiagrams ?? PDF_DIAGRAM_DEFAULT_MAX_ITEMS,
      ),
    );
    const resolvedModelId = resolveTextModelId(
      options.modelId,
      DEFAULT_PDF_EXTRACTION_MODEL_ID,
    );
    const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);
    const extractionPrompt = [
      "Extract diagram bounding boxes from the attached PDF.",
      "Return JSON only.",
      "",
      "Schema (exact keys):",
      "{",
      '  "diagrams": [',
      "    {",
      '      "id": "string",',
      '      "problemId": "string",',
      '      "page": 1,',
      '      "bbox1000": { "left": 0, "top": 0, "right": 1000, "bottom": 1000 },',
      '      "label": "string (optional)",',
      '      "description": "string (optional)",',
      '      "confidence": 0.0',
      "    }",
      "  ],",
      '  "notes": "string (optional)"',
      "}",
      "",
      "Rules:",
      "- page is 1-based page number.",
      "- bbox1000 uses integer coordinates on a 0..1000 grid per page axis.",
      "- left/top are top-left corner; right/bottom are bottom-right corner.",
      "- Use integers only for bbox1000 fields.",
      `- Return at most ${safeMaxDiagrams.toString()} diagram entries.`,
      "- Include only diagrams relevant to the user instructions.",
      "",
      "User instructions:",
      options.promptText,
    ].join("\n");

    const callStartedAt = Date.now();
    const llmResult = await generateText({
      model: resolvedModelId,
      input: buildSingleUserInput([
        { type: "text", text: extractionPrompt },
        {
          type: "inlineData",
          data: pdfBytes.toString("base64"),
          mimeType: "application/pdf",
        },
      ]),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      responseMimeType: "application/json",
    });
    recordLlmTextResult({
      progress,
      modelId: resolvedModelId,
      result: llmResult,
    });
    const rawText = llmResult.text;

    let parsedRaw: unknown;
    try {
      parsedRaw = parseJsonFromLlmText(rawText);
    } catch (error) {
      throw new Error(
        `extract_pdf_diagrams returned invalid JSON: ${errorAsString(error)}`,
      );
    }
    const manifest = normalisePdfDiagramManifest(parsedRaw, safeMaxDiagrams);
    const formatted = JSON.stringify(manifest, null, 2) + "\n";
    const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
    await ensureDir(path.dirname(resolved));
    await writeFile(resolved, formatted, { encoding: "utf8" });
    workspace.scheduleUpdate(resolvedOutputPath);
    const submodelSummary = createTrackedSubmodelCallSummary({
      modelId: resolvedModelId,
      startedAt: callStartedAt,
      result: llmResult,
    });
    recordToolLlmCost(
      onToolLlmCost,
      "extract_pdf_diagrams",
      submodelSummary.costUsd,
    );
    const outputBytes = Buffer.byteLength(formatted, "utf8");

    return {
      status: "written",
      modelId: resolvedModelId,
      ...(submodelSummary?.modelVersion
        ? { modelVersion: submodelSummary.modelVersion }
        : {}),
      ...(submodelSummary?.elapsedMs !== undefined
        ? { elapsedMs: submodelSummary.elapsedMs }
        : {}),
      ...(typeof submodelSummary?.costUsd === "number"
        ? { costUsd: submodelSummary.costUsd }
        : {}),
      ...(submodelSummary?.usageTokens
        ? { usageTokens: submodelSummary.usageTokens }
        : {}),
      outputPath: resolvedOutputPath,
      promptChars: options.promptText.length,
      outputBytes,
      pdfBytes: pdfBytes.length,
      diagramCount: manifest.diagrams.length,
      ...options.sourceInfo,
    };
  };

  const cropImageBboxPixelsSchema = z
    .object({
      left: z.number().int().min(0),
      top: z.number().int().min(0),
      right: z.number().int().min(0),
      bottom: z.number().int().min(0),
    })
    .superRefine((bbox, context) => {
      if (bbox.right <= bbox.left) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxPixels.right must be greater than left.",
          path: ["right"],
        });
      }
      if (bbox.bottom <= bbox.top) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bboxPixels.bottom must be greater than top.",
          path: ["bottom"],
        });
      }
    });
  const cropImageCommonSchema = {
    sourcePath: z.string().trim().min(1),
    outputPath: z.string().trim().min(1),
    paddingPx: z.preprocess((value) => {
      if (value === null || value === undefined) {
        return undefined;
      }
      return value;
    }, z.number().int().min(0).max(256).optional()),
  };
  const cropImageInputSchema = z
    .object({
      ...cropImageCommonSchema,
      bboxPixels: cropImageBboxPixelsSchema.optional(),
      fullImage: z.boolean().optional(),
    })
    .strict()
    .refine(
      (input) => input.bboxPixels !== undefined || input.fullImage === true,
      {
        message: "Provide bboxPixels or set fullImage=true.",
      },
    );
  const cropBboxProposalSchema = z
    .object({
      cropBase: z.enum(["badCrop", "fullPage"]),
      bbox: cropImageBboxPixelsSchema,
      reasoning: z.string().trim().min(1),
      risks: z.array(z.string().trim()).default([]),
    })
    .strict();

  const largeGeneratedFileOutlineReadCounts = new Map<string, number>();

  const tools: LlmToolSet = {
    ...(workspaceViewImageTool && !isGraderPublishingRun
      ? { view_image: workspaceViewImageTool }
      : {}),
    read_workspace_file: tool({
      description:
        'Read a UTF-8 text file from the Spark agent workspace using a workspace-relative path. Use this for brief.md, request.json, grader/task.md, transcription markdown, and JSON artifacts. Large generated output/reference files without startLine/lineCount return a compact line-numbered outline only on first unbounded read; repeated unbounded reads are blocked. Use grep_workspace_files first, then targeted startLine/lineCount reads for exact source-paper or mark-scheme sections without loading the whole reference into context. Example targeted call: {"filePath":"grader/output/qp-reference.md","startLine":68,"lineCount":80}.',
      inputSchema: z
        .object({
          filePath: z.string().trim().min(1),
          startLine: z.preprocess(
            parseOptionalPositiveInt,
            z.number().int().min(1).optional(),
          ),
          lineCount: z.preprocess(
            parseOptionalPositiveInt,
            z
              .number()
              .int()
              .min(1)
              .max(READ_WORKSPACE_FILE_MAX_RANGE_LINES)
              .optional(),
          ),
          maxChars: z.preprocess(
            parseOptionalPositiveInt,
            z
              .number()
              .int()
              .min(1)
              .max(READ_WORKSPACE_FILE_MAX_CHARS)
              .optional(),
          ),
        })
        .strict(),
      execute: async ({ filePath, startLine, lineCount, maxChars }) => {
        const pathHints = parseWorkspaceFileReadPathHints(filePath);
        const resolvedStartLine = startLine ?? pathHints.startLine;
        const resolvedLineCount = lineCount ?? pathHints.lineCount;
        const resolvedFilePath = pathHints.filePath;
        const content = await readFile(
          resolveWorkspacePath(rootDir, resolvedFilePath),
          {
            encoding: "utf8",
          },
        );
        const normalizedFilePath = resolvedFilePath.replace(/\\/gu, "/");
        const hasExplicitBounds =
          resolvedStartLine !== undefined ||
          resolvedLineCount !== undefined ||
          maxChars !== undefined;
        const isLargeGeneratedOutput =
          (normalizedFilePath.startsWith("grader/output/") ||
            normalizedFilePath.startsWith("sheet/output/")) &&
          content.length > READ_WORKSPACE_FILE_DEFAULT_MAX_CHARS;
        const largeOutlineReadCount =
          !hasExplicitBounds && isLargeGeneratedOutput
            ? (largeGeneratedFileOutlineReadCounts.get(normalizedFilePath) ??
                0) + 1
            : undefined;
        if (largeOutlineReadCount !== undefined) {
          largeGeneratedFileOutlineReadCounts.set(
            normalizedFilePath,
            largeOutlineReadCount,
          );
          if (largeOutlineReadCount > 1) {
            throw new Error(
              [
                `[read_workspace_file] repeated unbounded read blocked for ${resolvedFilePath}`,
                "This large generated output/reference file already returned a compact outline.",
                "Use grep_workspace_files with specific question/page labels, then call read_workspace_file with startLine/lineCount or read_file with offset/limit.",
                `Example: read_workspace_file({"filePath":"${resolvedFilePath}","startLine":68,"lineCount":80})`,
                `Fallback: read_file({"file_path":"${resolvedFilePath}","offset":68,"limit":80})`,
              ].join(" "),
            );
          }
        }
        return renderWorkspaceFileReadResult({
          filePath: resolvedFilePath,
          content,
          ...(resolvedStartLine !== undefined
            ? { startLine: resolvedStartLine }
            : {}),
          ...(resolvedLineCount !== undefined
            ? { lineCount: resolvedLineCount }
            : {}),
          ...(maxChars !== undefined ? { maxChars } : {}),
          ...(largeOutlineReadCount !== undefined
            ? { largeOutlineReadCount }
            : {}),
        });
      },
    }),
    write_workspace_file: tool({
      description:
        "Write a UTF-8 text file in the Spark agent workspace using a workspace-relative path. Use this for Markdown/text artifacts such as crop-validation.md and transcription cleanup files. For JSON artifacts, especially grader/output/sheet.json and grader/output/run-summary.json, use write_json_workspace_file instead so escaping stays valid.",
      inputSchema: z
        .object({
          filePath: z.string().trim().min(1),
          content: z.string(),
        })
        .strict(),
      execute: async ({ filePath, content }) => {
        const normalizedFilePath = filePath.replace(/\\/gu, "/").trim();
        if (
          isGraderPublishingRun &&
          (normalizedFilePath === "grader/output/source-fidelity-audit.md" ||
            normalizedFilePath.startsWith(
              "grader/output/source-fidelity-audits/",
            ))
        ) {
          return {
            status: "blocked_tool_owned_artifact",
            blockedTool: "write_workspace_file",
            filePath: normalizedFilePath,
            nextAction:
              "Do not write source-fidelity audit files manually. Call validate_source_fidelity_with_fresh_agent with sourcePaths; that tool writes grader/output/source-fidelity-audit.md and per-scope audit records after a real fresh-context review.",
          };
        }
        const resolvedPath = resolveWorkspacePath(rootDir, filePath);
        await ensureDir(path.dirname(resolvedPath));
        await writeFile(resolvedPath, content, { encoding: "utf8" });
        workspace.scheduleUpdate(filePath);
        const sourceReferenceMarkdownForSheetPlan =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/sheet-plan.md"
            ? [
                await readWorkspaceFileIfExists(
                  "grader/output/qp-reference.md",
                ),
                await readWorkspaceFileIfExists(
                  "grader/output/question-paper-reference.md",
                ),
                await readWorkspaceFileIfExists(
                  "grader/output/source-reference.md",
                ),
              ].join("\n\n")
            : "";
        const graderArtifactIssues =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/transcription.md"
            ? collectSourceTranscriptionIntegrityIssues(content)
            : isGraderPublishingRun &&
                normalizedFilePath === "grader/output/sheet-plan.md"
              ? [
                  ...collectSheetPlanConsistencyIssues(content),
                  ...collectSheetPlanSourceReferenceIssues({
                    sheetPlanMarkdown: content,
                    sourceReferenceMarkdown: sourceReferenceMarkdownForSheetPlan,
                  }),
                ]
              : [];
        const jsonWriteStatus = (() => {
          if (!normalizedFilePath.endsWith(".json")) {
            return null;
          }
          try {
            JSON.parse(content);
            return {
              status: "valid_json" as const,
            };
          } catch (error) {
            return {
              status: "invalid_json" as const,
              error: errorAsString(error),
              fix:
                normalizedFilePath === "grader/output/sheet.json" ||
                normalizedFilePath === "grader/output/run-summary.json"
                  ? "Repair this JSON before source-fidelity audit or publish; escaped LaTeX backslashes such as \\( must be written as \\\\( inside JSON strings, or use $...$ math delimiters."
                  : "Repair this JSON before using it as an artifact.",
            };
          }
        })();
        if (graderArtifactIssues.length > 0) {
          return {
            status:
              normalizedFilePath === "grader/output/transcription.md"
                ? "written_invalid_source_transcription"
                : "written_invalid_sheet_plan",
            filePath,
            bytes: Buffer.byteLength(content, "utf8"),
            issues: graderArtifactIssues,
            nextAction:
              normalizedFilePath === "grader/output/transcription.md"
                ? "Rewrite grader/output/transcription.md page-by-page from the printed source before bounded scoring or artifact assembly."
                : "Rewrite grader/output/sheet-plan.md with consistent marks and explicit visual/table handling before bounded scoring or artifact assembly.",
          };
        }
        const nextAction =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/transcription.md"
            ? "Immediately write grader/output/sheet-plan.md with source leaves, marks, visual/table placements, and 2-4 scoring batches. Do not inspect, crop, validate, search, or enrich before the plan."
            : isGraderPublishingRun &&
                normalizedFilePath === "grader/output/sheet-plan.md"
              ? "Immediately call score_answers_with_fresh_agent in 2-4 contiguous root/range batches in one parallel tool turn. Do not inspect images, crop, validate, search, or enrich before scoring."
              : null;
        return {
          status:
            jsonWriteStatus?.status === "invalid_json"
              ? "written_invalid_json"
              : "written",
          filePath,
          bytes: Buffer.byteLength(content, "utf8"),
          ...(jsonWriteStatus !== null ? { json: jsonWriteStatus } : {}),
          ...(nextAction !== null ? { nextAction } : {}),
        };
      },
    }),
    write_json_workspace_file: tool({
      description:
        "Write a JSON object to the Spark agent workspace using a workspace-relative .json path. Pass jsonText as the complete JSON text object; the tool parses and reserializes it so invalid JSON is rejected and valid LaTeX/backslashes are preserved. Prefer this over write_workspace_file for grader/output/sheet.json and grader/output/run-summary.json.",
      inputSchema: z
        .object({
          filePath: z.string().trim().min(1),
          jsonText: z.string().trim().min(2),
        })
        .strict(),
      execute: async ({ filePath, jsonText }) => {
        const normalizedFilePath = filePath.replace(/\\/gu, "/").trim();
        if (!normalizedFilePath.endsWith(".json")) {
          throw new Error(
            `write_json_workspace_file can only write .json files (got "${normalizedFilePath}").`,
          );
        }
        let json: unknown;
        let repairedCommonRawLatexBackslashes = false;
        const trimmedJsonText = jsonText.trim();
        try {
          json = JSON.parse(trimmedJsonText);
        } catch (error) {
          const repairedJsonText =
            repairCommonRawLatexJsonBackslashes(trimmedJsonText);
          if (repairedJsonText !== trimmedJsonText) {
            try {
              json = JSON.parse(repairedJsonText);
              repairedCommonRawLatexBackslashes = true;
            } catch (repairedError) {
              return {
                status: "invalid_json",
                filePath: normalizedFilePath,
                error: errorAsString(repairedError),
                originalError: errorAsString(error),
                fix:
                  "Pass jsonText as one complete valid JSON object. Do not pass an empty object, a partial object, markdown, comments, or surrounding code fences. Escape LaTeX backslashes in JSON strings, for example write \\\\( for visible \\(.",
              };
            }
          } else {
            return {
              status: "invalid_json",
              filePath: normalizedFilePath,
              error: errorAsString(error),
              fix:
                "Pass jsonText as one complete valid JSON object. Do not pass an empty object, a partial object, markdown, comments, or surrounding code fences. Escape LaTeX backslashes in JSON strings, for example write \\\\( for visible \\(.",
            };
          }
        }
        if (!isPlainRecord(json)) {
          return {
            status: "invalid_json",
            filePath: normalizedFilePath,
            error: "jsonText must parse to a JSON object.",
            fix: "Pass a complete top-level JSON object.",
          };
        }
        if (
          (normalizedFilePath === "grader/output/sheet.json" ||
            normalizedFilePath === "grader/output/run-summary.json") &&
          Object.keys(json).length === 0
        ) {
          return {
            status: "invalid_json",
            filePath: normalizedFilePath,
            error: `${normalizedFilePath} cannot be an empty object.`,
            fix:
              normalizedFilePath === "grader/output/sheet.json"
                ? "Pass the full graded worksheet report with schemaVersion, sheet, answers, review, and optional references."
                : "Pass the full run summary with presentation, totals, and sheet.filePath.",
          };
        }
        const resolvedPath = resolveWorkspacePath(rootDir, normalizedFilePath);
        await ensureDir(path.dirname(resolvedPath));
        let outputJson: Record<string, unknown> = json;
        const normalizedGraderSheetShape =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/sheet.json"
            ? normalizeRawPaperSheetShapeForPublish(json)
            : { value: json, changed: false };
        if (normalizedGraderSheetShape.changed) {
          outputJson = isPlainRecord(normalizedGraderSheetShape.value)
            ? normalizedGraderSheetShape.value
            : json;
        }
        const content = `${JSON.stringify(outputJson, null, 2)}\n`;
        await writeFile(resolvedPath, content, { encoding: "utf8" });
        workspace.scheduleUpdate(normalizedFilePath);
        const rawWorksheetShapeIssues =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/sheet.json"
            ? collectRawGraderWorksheetShapeIssues(outputJson)
            : [];
        if (rawWorksheetShapeIssues.length > 0) {
          return {
            status: "written_invalid_grader_schema",
            filePath: normalizedFilePath,
            bytes: Buffer.byteLength(content, "utf8"),
            topLevelKeys: Object.keys(outputJson),
            issues: rawWorksheetShapeIssues,
            nextAction:
              "Rewrite grader/output/sheet.json with supported question shapes, then call validate_grader_artifacts.",
          };
        }
        const parsedWrittenGraderReport =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/sheet.json"
            ? SparkGraderWorksheetReportSchema.safeParse(outputJson)
            : null;
        const earlyAssemblyIssues =
          parsedWrittenGraderReport?.success === true
            ? collectGraderWorksheetEarlyAssemblyIssues(
                parsedWrittenGraderReport.data,
              )
            : [];
        if (earlyAssemblyIssues.length > 0) {
          return {
            status: "written_needs_publish_repair",
            filePath: normalizedFilePath,
            bytes: Buffer.byteLength(content, "utf8"),
            topLevelKeys: Object.keys(outputJson),
            issues: earlyAssemblyIssues.slice(0, 10),
            nextAction:
              "Rewrite grader/output/sheet.json now. Create and link any planned grader/output/assets/... crops or Markdown tables before run-summary.json, move every named figure/table and image link out of section.theory/infoBox into the exact question or group prompt, remove workflow/source-paper placeholder phrases, keep badgeLabel short, then write run-summary.json and validate_grader_artifacts.",
          };
        }
        let derivedRunSummary: { path: string; bytes: number } | null = null;
        if (
          parsedWrittenGraderReport?.success === true &&
          !(await workspaceFileExists("grader/output/run-summary.json"))
        ) {
          const summary = buildDerivedGraderRunSummary({
            report: parsedWrittenGraderReport.data,
            sheetPath: "grader/output/sheet.json",
          });
          const summaryContent = `${JSON.stringify(summary, null, 2)}\n`;
          const summaryPath = resolveWorkspacePath(
            rootDir,
            "grader/output/run-summary.json",
          );
          await ensureDir(path.dirname(summaryPath));
          await writeFile(summaryPath, summaryContent, { encoding: "utf8" });
          workspace.scheduleUpdate("grader/output/run-summary.json");
          derivedRunSummary = {
            path: "grader/output/run-summary.json",
            bytes: Buffer.byteLength(summaryContent, "utf8"),
          };
        }
        const nextAction =
          isGraderPublishingRun &&
          normalizedFilePath === "grader/output/sheet.json"
            ? (derivedRunSummary !== null ||
              (await workspaceFileExists("grader/output/run-summary.json")))
              ? 'Immediately call validate_grader_artifacts({"requireSourceFidelityAudit": false}); do not enrich, reread, or inspect images before validation names the remaining fixes.'
              : "Immediately write grader/output/run-summary.json with totals matching review.score, then call validate_grader_artifacts. Do not enrich, reread, or inspect images before validation."
            : isGraderPublishingRun &&
                normalizedFilePath === "grader/output/run-summary.json"
              ? 'Immediately call validate_grader_artifacts({"requireSourceFidelityAudit": false}); do not enrich, reread, or inspect images before validation names the remaining fixes.'
              : null;
        return {
          status: "written",
          filePath: normalizedFilePath,
          bytes: Buffer.byteLength(content, "utf8"),
          topLevelKeys: Object.keys(outputJson),
          ...(normalizedGraderSheetShape.changed
            ? { normalizedGraderSheetShape: true }
            : {}),
          ...(repairedCommonRawLatexBackslashes
            ? { repairedCommonRawLatexBackslashes: true }
            : {}),
          ...(derivedRunSummary !== null ? { derivedRunSummary } : {}),
          ...(nextAction !== null ? { nextAction } : {}),
        };
      },
    }),
    list_workspace_dir: tool({
      description:
        "List a directory in the Spark agent workspace using a workspace-relative path.",
      inputSchema: z
        .object({
          directoryPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({ directoryPath }) => {
        const resolvedDirectory = directoryPath ?? ".";
        const entries = await readdir(
          resolveWorkspacePath(rootDir, resolvedDirectory),
          {
            withFileTypes: true,
          },
        );
        return entries
          .map((entry) => ({
            name: entry.name,
            path:
              resolvedDirectory === "."
                ? entry.name
                : `${resolvedDirectory.replace(/\/$/u, "")}/${entry.name}`,
            type: entry.isDirectory()
              ? "directory"
              : entry.isFile()
                ? "file"
                : "other",
          }))
          .sort((a, b) => a.path.localeCompare(b.path));
      },
    }),
    grep_workspace_files: tool({
      description:
        "Search UTF-8 workspace text files under a directory with a JavaScript regular expression pattern. Use this to find figure/table references or source labels in workspace artifacts. Binary uploads, replay scaffolding, seeded skills, and large non-text files are skipped when searching from the workspace root. Matches in generated output/reference files include short surrounding context by default so you can avoid whole-file reads.",
      inputSchema: z
        .object({
          directoryPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          pattern: z.string().trim().min(1),
          maxMatches: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().int().min(1).max(500).optional()),
          contextLines: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().int().min(0).max(20).optional()),
        })
        .strict(),
      execute: async ({ directoryPath, pattern, maxMatches, contextLines }) => {
        const baseDirectory = directoryPath ?? ".";
        const rootAbsolute = resolveWorkspacePath(rootDir, baseDirectory);
        let regex: RegExp;
        let patternMode: "regex" | "literal" = "regex";
        try {
          regex = new RegExp(pattern, "iu");
        } catch {
          try {
            regex = new RegExp(pattern, "i");
          } catch {
            regex = new RegExp(escapeRegExpLiteral(pattern), "iu");
            patternMode = "literal";
          }
        }
        const limit = maxMatches ?? 100;
        const searchableTextExtensions = new Set([
          ".css",
          ".csv",
          ".html",
          ".js",
          ".json",
          ".jsonl",
          ".log",
          ".md",
          ".mjs",
          ".svelte",
          ".toml",
          ".ts",
          ".tsx",
          ".txt",
          ".xml",
          ".yaml",
          ".yml",
        ]);
        const matches: Array<{
          filePath: string;
          line: number;
          text: string;
          context?: string[];
        }> = [];
        const visit = async (absoluteDirectory: string): Promise<void> => {
          if (matches.length >= limit) {
            return;
          }
          const entries = await readdir(absoluteDirectory, {
            withFileTypes: true,
          });
          const searchingWorkspaceRoot =
            path.resolve(rootAbsolute) === path.resolve(rootDir);
          for (const entry of entries) {
            if (matches.length >= limit) {
              return;
            }
            const absolutePath = path.join(absoluteDirectory, entry.name);
            const relativePath = resolveWorkspaceRelativePath(
              rootDir,
              absolutePath,
            );
            const normalizedRelativePath = relativePath.replace(/\\/gu, "/");
            if (entry.isDirectory()) {
              if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                (searchingWorkspaceRoot &&
                  (entry.name === ".spark-agent-replay" ||
                    entry.name === "logs" ||
                    entry.name === "skills")) ||
                entry.name === "llm_calls" ||
                entry.name === "tool_calls"
              ) {
                continue;
              }
              await visit(absolutePath);
              continue;
            }
            if (!entry.isFile()) {
              continue;
            }
            if (
              normalizedRelativePath.startsWith("grader/uploads/") ||
              normalizedRelativePath.startsWith("sheet/uploads/")
            ) {
              continue;
            }
            if (
              searchingWorkspaceRoot &&
              (normalizedRelativePath === "brief.md" ||
                normalizedRelativePath === "request.json" ||
                normalizedRelativePath === "grader/task.md" ||
                normalizedRelativePath === "grader/uploads/index.json" ||
                normalizedRelativePath === "sheet/task.md" ||
                normalizedRelativePath === "sheet/uploads/index.json")
            ) {
              continue;
            }
            const extension = path.extname(entry.name).toLowerCase();
            if (
              extension.length > 0 &&
              !searchableTextExtensions.has(extension)
            ) {
              continue;
            }
            const fileStats = await stat(absolutePath).catch(() => null);
            if (fileStats === null || fileStats.size > 2_000_000) {
              continue;
            }
            const content = await readFile(absolutePath, {
              encoding: "utf8",
            }).catch(() => null);
            if (content === null) {
              continue;
            }
            const lines = content.split(/\r?\n/u);
            for (const [index, line] of lines.entries()) {
              if (regex.test(line)) {
                const defaultContextLines =
                  normalizedRelativePath.startsWith("grader/output/") ||
                  normalizedRelativePath.startsWith("sheet/output/")
                    ? 2
                    : 0;
                const resolvedContextLines =
                  contextLines ?? defaultContextLines;
                const contextStartIndex = Math.max(
                  0,
                  index - resolvedContextLines,
                );
                const contextEndIndex = Math.min(
                  lines.length - 1,
                  index + resolvedContextLines,
                );
                const context =
                  resolvedContextLines > 0
                    ? lines
                        .slice(contextStartIndex, contextEndIndex + 1)
                        .map(
                          (contextLine, contextIndex) =>
                            `${(
                              contextStartIndex +
                              contextIndex +
                              1
                            ).toString()}: ${contextLine.slice(0, 500)}`,
                        )
                    : [];
                matches.push({
                  filePath: relativePath,
                  line: index + 1,
                  text: line.slice(0, 500),
                  ...(context.length > 0 ? { context } : {}),
                });
                if (matches.length >= limit) {
                  return;
                }
              }
            }
          }
        };
        await visit(rootAbsolute);
        return {
          matches,
          ...(patternMode === "literal"
            ? {
                patternMode,
                warning:
                  "Invalid regular expression was treated as a literal text search.",
              }
            : {}),
        };
      },
    }),
    publish_lesson: tool({
      description:
        "Publish a Spark lesson into the user's sessions (not welcome templates). Reads Firestore-ready JSON from the workspace and writes session + quiz/coding_problem documents to Firestore.",
      inputSchema: z
        .object({
          sessionId: z.string().trim().min(1),
          sessionPath: z.string().trim().min(1).optional(),
          briefPath: z.string().trim().min(1).optional(),
          includeStory: z.boolean().optional(),
          includeCoding: z.boolean().optional(),
        })
        .strict(),
      execute: async ({
        sessionId,
        sessionPath,
        briefPath,
        includeStory,
        includeCoding,
      }) => {
        const resolvedSessionPath = sessionPath ?? "lesson/output/session.json";
        const resolvedBriefPath = briefPath ?? "brief.md";

        const docPath = `spark/${userId}/sessions/${sessionId}`;
        const existing = await getFirestoreDocument({
          serviceAccountJson,
          documentPath: docPath,
        }).catch(() => ({ exists: false, data: null }));
        const existingSession =
          existing.exists && existing.data
            ? SessionSchema.safeParse({
                id: sessionId,
                ...existing.data,
              })
            : null;
        const createdAt =
          existingSession && existingSession.success
            ? existingSession.data.createdAt
            : new Date();
        const titleFallback =
          existingSession && existingSession.success
            ? existingSession.data.title
            : undefined;
        const topicsFallback =
          existingSession && existingSession.success
            ? existingSession.data.topics
            : undefined;

        try {
          const bundle = await validateLessonWorkspaceForPublish({
            rootDir,
            sessionId,
            sessionPath: resolvedSessionPath,
            briefPath: resolvedBriefPath,
            createdAt,
            titleFallback,
            topicsFallback,
            includeStory,
            includeCoding,
            enforceLessonPipeline: shouldEnforceLessonPipeline,
          });
          await setFirestoreDocument({
            serviceAccountJson,
            documentPath: docPath,
            data: bundle.session as unknown as Record<string, unknown>,
          });

          await Promise.all(
            bundle.quizzes.map(async (quiz) => {
              const validated = QuizDefinitionSchema.parse(quiz);
              await setFirestoreDocument({
                serviceAccountJson,
                documentPath: `${docPath}/quiz/${validated.id}`,
                data: validated as unknown as Record<string, unknown>,
              });
            }),
          );

          await Promise.all(
            bundle.problems.map(async (problem) => {
              const validated = CodeProblemSchema.parse(problem);
              await setFirestoreDocument({
                serviceAccountJson,
                documentPath: `${docPath}/code/${validated.slug}`,
                data: validated as unknown as Record<string, unknown>,
              });
            }),
          );

          await Promise.all(
            bundle.media.map(async (item) => {
              const validated = SessionMediaDocSchema.parse(item);
              await setFirestoreDocument({
                serviceAccountJson,
                documentPath: `${docPath}/media/${validated.id}`,
                data: validated as unknown as Record<string, unknown>,
              });
            }),
          );

          return {
            status: "published",
            sessionId,
            includeStory: includeStory ?? null,
            includeCoding: includeCoding ?? null,
            quizCount: bundle.quizzes.length,
            problemCount: bundle.problems.length,
            mediaCount: bundle.media.length,
            href: `/spark/lesson/${sessionId}`,
          };
        } catch (error) {
          await patchFirestoreDocument({
            serviceAccountJson,
            documentPath: docPath,
            updates: { status: "error" },
          }).catch(() => undefined);
          throw error;
        }
      },
    }),
    validate_json,
    validate_schema: validate_json,
    python_exec: tool({
      description:
        "Run a Python script via Pyodide. Reads scriptPath (required) from the workspace, optionally feeds stdin from stdinPath, and optionally writes stdout/stderr to stdoutPath/stderrPath (workspace paths).",
      inputSchema: z
        .object({
          scriptPath: z.string().trim().min(1),
          stdinPath: z.string().trim().min(1).optional(),
          stdoutPath: z.string().trim().min(1).optional(),
          stderrPath: z.string().trim().min(1).optional(),
          indexURL: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({
        scriptPath,
        stdinPath,
        stdoutPath,
        stderrPath,
        indexURL,
      }) => {
        const python = await ensurePythonRuntime(indexURL);
        const resolvedScriptPath = resolveWorkspacePath(rootDir, scriptPath);
        const scriptSource = await readFile(resolvedScriptPath, {
          encoding: "utf8",
        });
        const stdinText =
          stdinPath && stdinPath.trim().length > 0
            ? await readFile(resolveWorkspacePath(rootDir, stdinPath), {
                encoding: "utf8",
              })
            : "";

        const wrapper = [
          "import io",
          "import json",
          "import sys",
          "import traceback",
          `script_source = ${JSON.stringify(scriptSource)}`,
          `stdin_text = ${JSON.stringify(stdinText)}`,
          "stdout_buffer = io.StringIO()",
          "stderr_buffer = io.StringIO()",
          "original_stdin = sys.stdin",
          "original_stdout = sys.stdout",
          "original_stderr = sys.stderr",
          "ok = True",
          "try:",
          "    sys.stdin = io.StringIO(stdin_text)",
          "    sys.stdout = stdout_buffer",
          "    sys.stderr = stderr_buffer",
          "    env = {'__name__': '__main__'}",
          "    exec(script_source, env)",
          "except Exception:",
          "    ok = False",
          "    traceback.print_exc(file=stderr_buffer)",
          "finally:",
          "    sys.stdin = original_stdin",
          "    sys.stdout = original_stdout",
          "    sys.stderr = original_stderr",
          "json.dumps({'ok': ok, 'stdout': stdout_buffer.getvalue(), 'stderr': stderr_buffer.getvalue()})",
        ].join("\n");

        let raw: unknown;
        try {
          raw = await python.runPythonAsync(wrapper);
        } catch (error) {
          raw = JSON.stringify({
            ok: false,
            stdout: "",
            stderr: errorAsString(error),
          });
        }

        let parsed: { ok?: unknown; stdout?: unknown; stderr?: unknown } = {};
        if (typeof raw === "string") {
          try {
            parsed = JSON.parse(raw) as typeof parsed;
          } catch {
            parsed = { ok: false, stdout: "", stderr: String(raw) };
          }
        } else {
          parsed = { ok: false, stdout: "", stderr: String(raw) };
        }

        const ok = parsed.ok === true;
        const stdout = typeof parsed.stdout === "string" ? parsed.stdout : "";
        const stderr = typeof parsed.stderr === "string" ? parsed.stderr : "";

        const written: string[] = [];
        if (stdoutPath) {
          const resolved = resolveWorkspacePath(rootDir, stdoutPath);
          await writeFile(resolved, stdout, { encoding: "utf8" });
          workspace.scheduleUpdate(stdoutPath);
          written.push(stdoutPath);
        }
        if (stderrPath) {
          const resolved = resolveWorkspacePath(rootDir, stderrPath);
          await writeFile(resolved, stderr, { encoding: "utf8" });
          workspace.scheduleUpdate(stderrPath);
          written.push(stderrPath);
        }

        const truncate = (value: string): string => {
          const max = 8_000;
          if (value.length <= max) {
            return value;
          }
          return `${value.slice(0, max)}…`;
        };

        return {
          ok,
          stdout: stdoutPath ? undefined : truncate(stdout),
          stderr: stderrPath ? undefined : truncate(stderr),
          stdoutBytes: Buffer.byteLength(stdout, "utf8"),
          stderrBytes: Buffer.byteLength(stderr, "utf8"),
          written,
        };
      },
    }),
    generate_text: tool({
      description: [
        "Generate text (Markdown) using a sub-model.",
        "",
        "Reads promptPath from the workspace and expands {{relative/path}} placeholders by inlining referenced workspace files.",
        "",
        "Important:",
        graderPublish
          ? "- This tool is NOT for JSON outputs. For grader JSON, use write_workspace_file, then validate_grader_artifacts."
          : "- This tool is NOT for JSON outputs. Use generate_json + validate_json for JSON files.",
        "- outputPath must NOT end with .json (generate_text will reject it).",
        "",
        "If the generated text contains a line like `pass: true|false` (used by lesson grading prompts),",
        "the tool will include `gradePass: true|false` in its return value so you can decide whether to revise",
        "without reading the grading file back.",
        "",
        "Batching:",
        "- If you need to draft/grade multiple independent items (e.g. quizzes q1 and q2), call generate_text multiple times in the SAME step with distinct outputPath values (they will run in parallel).",
        "",
        "Inputs:",
        "- promptPath (required): Workspace path to a prompt template (usually under lesson/prompts/).",
        "- outputPath (required): Where to write the generated Markdown.",
        "- inputPaths (optional): Extra workspace files to attach under an 'Attached files' section.",
        "- outputMode (optional): overwrite|append (default overwrite).",
        "- tools (optional): web-search|code-execution.",
      ].join("\n"),
      inputSchema: (() => {
        const normalizeOptionalString = (
          value: unknown,
        ): string | undefined => {
          if (value === null || value === undefined) {
            return undefined;
          }
          if (typeof value === "string") {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : undefined;
          }
          return undefined;
        };

        const normalizeOptionalStringArray = (
          value: unknown,
        ): string[] | undefined => {
          if (value === null || value === undefined) {
            return undefined;
          }

          const rawItems = Array.isArray(value) ? value : [value];
          const items: string[] = [];
          for (const raw of rawItems) {
            if (typeof raw !== "string") {
              continue;
            }
            const trimmed = raw.trim();
            if (trimmed.length === 0) {
              continue;
            }
            items.push(trimmed);
          }

          return items.length > 0 ? items : undefined;
        };

        const toolTypes = ["web-search", "code-execution"] as const;
        type ToolType = (typeof toolTypes)[number];

        const normalizeToolTypes = (value: unknown): ToolType[] | undefined => {
          const entries = normalizeOptionalStringArray(value);
          if (!entries) {
            return undefined;
          }

          const filtered: ToolType[] = [];
          for (const entry of entries) {
            if (entry === "web-search" || entry === "code-execution") {
              filtered.push(entry);
            }
          }

          return filtered.length > 0 ? filtered : undefined;
        };

        const outputPathSchema = z.preprocess(
          (value) => normalizeOptionalString(value),
          z
            .string({ error: "outputPath is required" })
            .trim()
            .min(1, "outputPath is required"),
        );

        const schema = z
          .object({
            promptPath: z
              .string({ error: "promptPath is required" })
              .trim()
              .min(1, "promptPath is required"),
            inputPaths: z.preprocess(
              (value) => normalizeOptionalStringArray(value),
              z.array(z.string().trim().min(1)).optional(),
            ),
            tools: z.preprocess(
              (value) => normalizeToolTypes(value),
              z.array(z.enum(toolTypes)).optional(),
            ),
            outputPath: outputPathSchema,
            outputMode: z.preprocess(
              (value) => normalizeOptionalString(value),
              z.enum(["overwrite", "append"]).optional(),
            ),
          })
          .strict();

        return schema;
      })(),
      execute: async ({
        promptPath,
        inputPaths,
        tools,
        outputPath,
        outputMode,
      }) => {
        const resolvedModelId: LlmTextModelId = DEFAULT_GENERATE_TEXT_MODEL_ID;
        const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);

        const resolvedPromptPath = promptPath.trim();
        const resolvedOutputPath = outputPath.trim();

        if (resolvedOutputPath.endsWith(".json")) {
          throw new Error(
            `generate_text cannot write JSON ("${resolvedOutputPath}"). Use generate_json instead.`,
          );
        }

        const normalizeSlashes = (value: string): string =>
          value.replace(/\\/g, "/").trim();

        const normalizedPromptPath =
          normalizeSlashes(resolvedPromptPath).toLowerCase();
        const promptFileName = normalizedPromptPath.split("/").at(-1) ?? "";
        const normalizedOutputPath = normalizeSlashes(resolvedOutputPath);
        let effectiveInputPaths = (inputPaths ?? []).map((p) =>
          normalizeSlashes(p),
        );

        const dedupePaths = (paths: string[]): string[] => {
          const seen = new Set<string>();
          const result: string[] = [];
          for (const entry of paths) {
            const trimmed = entry.trim();
            if (trimmed.length === 0 || seen.has(trimmed)) {
              continue;
            }
            seen.add(trimmed);
            result.push(trimmed);
          }
          return result;
        };

        const hasAttachedPathWithPrefix = (prefix: string): boolean => {
          const normalizedPrefix = prefix.replace(/\\/g, "/");
          return effectiveInputPaths.some((p) =>
            p.startsWith(normalizedPrefix),
          );
        };

        const isLessonPrompt =
          normalizedPromptPath.startsWith("lesson/prompts/");

        if (isLessonPrompt) {
          const requireQuizDraft =
            promptFileName === "quiz-grade.md" ||
            promptFileName === "quiz-revise.md";
          const requireCodeDraft =
            promptFileName === "code-grade.md" ||
            promptFileName === "code-revise.md";
          const requireQuizGradeReport = promptFileName === "quiz-revise.md";
          const requireCodeGradeReport = promptFileName === "code-revise.md";

          // Best-effort auto-attachment based on naming conventions to keep the agent from
          // spinning when it forgets inputPaths.
          if (
            (promptFileName === "quiz-grade.md" ||
              promptFileName === "quiz-revise.md") &&
            !hasAttachedPathWithPrefix("lesson/drafts/quiz/")
          ) {
            const match =
              promptFileName === "quiz-grade.md"
                ? normalizedOutputPath.match(
                    /^lesson\/feedback\/quiz\/([^/]+)-grade\.md$/u,
                  )
                : normalizedOutputPath.match(
                    /^lesson\/drafts\/quiz\/([^/]+)\.md$/u,
                  );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/drafts/quiz/${planItemId}.md`,
              ]);
            }
          }
          if (
            (promptFileName === "code-grade.md" ||
              promptFileName === "code-revise.md") &&
            !hasAttachedPathWithPrefix("lesson/drafts/code/")
          ) {
            const match =
              promptFileName === "code-grade.md"
                ? normalizedOutputPath.match(
                    /^lesson\/feedback\/code\/([^/]+)-grade\.md$/u,
                  )
                : normalizedOutputPath.match(
                    /^lesson\/drafts\/code\/([^/]+)\.md$/u,
                  );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/drafts/code/${planItemId}.md`,
              ]);
            }
          }
          if (
            promptFileName === "quiz-revise.md" &&
            !hasAttachedPathWithPrefix("lesson/feedback/quiz/")
          ) {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/quiz\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/feedback/quiz/${planItemId}-grade.md`,
              ]);
            }
          }
          if (
            promptFileName === "code-revise.md" &&
            !hasAttachedPathWithPrefix("lesson/feedback/code/")
          ) {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/code\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              effectiveInputPaths = dedupePaths([
                ...effectiveInputPaths,
                `lesson/feedback/code/${planItemId}-grade.md`,
              ]);
            }
          }

          if (
            requireQuizDraft &&
            !hasAttachedPathWithPrefix("lesson/drafts/quiz/")
          ) {
            throw new Error(
              "lesson quiz grade/revise prompts require inputPaths that include the candidate quiz Markdown under lesson/drafts/quiz/ (e.g. lesson/drafts/quiz/q1.md).",
            );
          }
          if (
            requireCodeDraft &&
            !hasAttachedPathWithPrefix("lesson/drafts/code/")
          ) {
            throw new Error(
              "lesson code grade/revise prompts require inputPaths that include the candidate problem Markdown under lesson/drafts/code/ (e.g. lesson/drafts/code/p1.md).",
            );
          }
          if (
            requireQuizGradeReport &&
            !hasAttachedPathWithPrefix("lesson/feedback/quiz/")
          ) {
            throw new Error(
              "lesson quiz revise prompts require inputPaths that include the grading report under lesson/feedback/quiz/ (e.g. lesson/feedback/quiz/q1-grade.md).",
            );
          }
          if (
            requireCodeGradeReport &&
            !hasAttachedPathWithPrefix("lesson/feedback/code/")
          ) {
            throw new Error(
              "lesson code revise prompts require inputPaths that include the grading report under lesson/feedback/code/ (e.g. lesson/feedback/code/p1-grade.md).",
            );
          }
        }

        const promptTemplate = await readFile(
          resolveWorkspacePath(rootDir, resolvedPromptPath),
          { encoding: "utf8" },
        );
        const expanded = await expandPromptTemplate({
          template: promptTemplate,
          rootDir,
        });
        let promptText = expanded.text;

        if (isLessonPrompt) {
          if (promptFileName === "quiz-draft.md") {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/quiz\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              promptText = [
                "# Tool instruction",
                `Target plan item id: ${planItemId}`,
                `You MUST draft the quiz for planItemId="${planItemId}" and set the Quiz planItemId field exactly to "${planItemId}".`,
                "Match the content to the session plan section for this plan item id.",
                "",
                promptText,
              ].join("\n");
            }
          }
          if (promptFileName === "code-draft.md") {
            const match = normalizedOutputPath.match(
              /^lesson\/drafts\/code\/([^/]+)\.md$/u,
            );
            const planItemId = match?.[1]?.trim();
            if (planItemId) {
              promptText = [
                "# Tool instruction",
                `Target plan item id: ${planItemId}`,
                `You MUST draft the code problem for planItemId="${planItemId}" (even if the Markdown format does not include planItemId, the content must match this plan item).`,
                "Match the content to the session plan section for this plan item id.",
                "",
                promptText,
              ].join("\n");
            }
          }
        }
        if (effectiveInputPaths.length > 0) {
          const attachments = await Promise.all(
            effectiveInputPaths.map(async (inputPath) => {
              const resolved = resolveWorkspacePath(rootDir, inputPath);
              const content = await readFile(resolved, { encoding: "utf8" });
              return { path: inputPath, content };
            }),
          );
          promptText += "\n\n---\n\n# Attached files\n";
          for (const file of attachments) {
            promptText += `\n\n## ${file.path}\n\n${file.content.trimEnd()}\n`;
          }
        }

        const toolConfigs: LlmToolConfig[] = [];
        for (const toolType of tools ?? []) {
          if (toolType === "web-search") {
            toolConfigs.push({ type: "web-search", mode: "live" });
            continue;
          }
          toolConfigs.push({ type: toolType });
        }

        const callStartedAt = Date.now();
        const llmResult = await generateText({
          model: resolvedModelId,
          input: buildSingleUserInput([{ type: "text", text: promptText }]),
          ...(toolConfigs.length > 0 ? { tools: toolConfigs } : {}),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
        recordLlmTextResult({
          progress,
          modelId: resolvedModelId,
          result: llmResult,
        });
        const submodelSummary = createTrackedSubmodelCallSummary({
          modelId: resolvedModelId,
          startedAt: callStartedAt,
          result: llmResult,
        });
        recordToolLlmCost(
          onToolLlmCost,
          "generate_text",
          submodelSummary.costUsd,
        );

        const formatted = llmResult.text;
        const gradePass = (() => {
          const match = formatted.match(
            /(?:^|\n)\s*pass\s*:\s*(true|false)\s*(?:\n|$)/iu,
          );
          if (!match) {
            return undefined;
          }
          return match[1]?.toLowerCase() === "true";
        })();

        const mode = outputMode ?? "overwrite";
        const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
        await ensureDir(path.dirname(resolved));
        let outputBytes = 0;
        if (mode === "append") {
          const existing = await readFile(resolved, {
            encoding: "utf8",
          }).catch(() => "");
          const combined = existing + formatted;
          outputBytes = Buffer.byteLength(combined, "utf8");
          await writeFile(resolved, combined, {
            encoding: "utf8",
          });
        } else {
          outputBytes = Buffer.byteLength(formatted, "utf8");
          await writeFile(resolved, formatted, { encoding: "utf8" });
        }
        workspace.scheduleUpdate(resolvedOutputPath);
        return {
          status: "written",
          modelId: resolvedModelId,
          ...(submodelSummary?.modelVersion
            ? { modelVersion: submodelSummary.modelVersion }
            : {}),
          ...(submodelSummary?.elapsedMs !== undefined
            ? { elapsedMs: submodelSummary.elapsedMs }
            : {}),
          ...(typeof submodelSummary?.costUsd === "number"
            ? { costUsd: submodelSummary.costUsd }
            : {}),
          ...(submodelSummary?.usageTokens
            ? { usageTokens: submodelSummary.usageTokens }
            : {}),
          promptPath: resolvedPromptPath,
          inputPaths: effectiveInputPaths,
          outputPath: resolvedOutputPath,
          outputMode: mode,
          promptTemplateReplacements: expanded.replacements,
          textChars: formatted.length,
          outputBytes,
          ...(gradePass === undefined ? {} : { gradePass }),
        };
      },
    }),
    generate_json: tool({
      description: [
        "Generate JSON from a source workspace file using a sub-model.",
        "Reads sourcePath and schemaPath from the workspace and writes pretty-printed JSON to outputPath.",
        "",
        "Important:",
        "- This tool does NOT validate the JSON against the schema. After generation, call validate_json({ schemaPath, inputPath: outputPath }).",
        "- schemaPath is included as guidance only (no Structured Outputs enforcement).",
        "- outputPath must end with .json.",
        "",
        "Batching:",
        "- If you need to generate multiple JSON outputs (e.g. session + q1 + q2), call generate_json once per outputPath in the SAME step (they will run in parallel).",
        "",
        "Inputs:",
        "- sourcePath (required): The Markdown/text source file to convert into JSON.",
        "- schemaPath (required): JSON schema file to include as guidance for shape/fields.",
        "- outputPath (required): Where to write the generated JSON.",
      ].join("\n"),
      inputSchema: z
        .object({
          sourcePath: z.string().trim().min(1),
          schemaPath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
        })
        .strict(),
      execute: async ({ sourcePath, schemaPath, outputPath }) => {
        const resolvedModelId: LlmTextModelId = DEFAULT_GENERATE_TEXT_MODEL_ID;
        const thinkingLevel = resolveSparkAgentThinkingLevel(resolvedModelId);

        const resolvedSourcePath = sourcePath.trim();
        const resolvedSchemaPath = schemaPath.trim();
        const resolvedOutputPath = outputPath.trim();

        if (
          /^(?:grader\/output\/)?(?:sheet|run-summary)\.json$/u.test(
            resolvedOutputPath,
          )
        ) {
          throw new Error(
            "generate_json is not allowed for grader/output/sheet.json or grader/output/run-summary.json. Write those grader JSON files directly and call publish_sheet for validation; request.json and grader/task.md are not schemas.",
          );
        }

        if (!resolvedOutputPath.endsWith(".json")) {
          throw new Error(
            `generate_json outputPath must end with ".json" (got "${resolvedOutputPath}").`,
          );
        }

        const schemaText = await readFile(
          resolveWorkspacePath(rootDir, resolvedSchemaPath),
          { encoding: "utf8" },
        );
        const sourceText = await readFile(
          resolveWorkspacePath(rootDir, resolvedSourcePath),
          { encoding: "utf8" },
        );

        const promptText = [
          "You are converting a source document into Firestore-ready JSON.",
          "",
          "Return JSON only (start with `{` and end with `}`). Do not wrap in Markdown fences.",
          "Use the schema as guidance, but do not invent facts that are not supported by the source.",
          "",
          `Schema (${resolvedSchemaPath}):`,
          schemaText.trimEnd(),
          "",
          `Source (${resolvedSourcePath}):`,
          sourceText.trimEnd(),
        ].join("\n");

        const callStartedAt = Date.now();
        const llmResult = await generateText({
          model: resolvedModelId,
          input: buildSingleUserInput([{ type: "text", text: promptText }]),
          ...(thinkingLevel ? { thinkingLevel } : {}),
          responseMimeType: "application/json",
        });
        recordLlmTextResult({
          progress,
          modelId: resolvedModelId,
          result: llmResult,
        });
        const submodelSummary = createTrackedSubmodelCallSummary({
          modelId: resolvedModelId,
          startedAt: callStartedAt,
          result: llmResult,
        });
        recordToolLlmCost(
          onToolLlmCost,
          "generate_json",
          submodelSummary.costUsd,
        );

        let parsed: unknown;
        try {
          parsed = parseJsonFromLlmText(llmResult.text);
        } catch (error) {
          throw new Error(
            `generate_json returned invalid JSON: ${errorAsString(error)}`,
          );
        }

        const formatted = JSON.stringify(parsed, null, 2) + "\n";
        const resolved = resolveWorkspacePath(rootDir, resolvedOutputPath);
        await ensureDir(path.dirname(resolved));
        await writeFile(resolved, formatted, { encoding: "utf8" });
        workspace.scheduleUpdate(resolvedOutputPath);
        const outputBytes = Buffer.byteLength(formatted, "utf8");

        return {
          status: "written",
          modelId: resolvedModelId,
          ...(submodelSummary?.modelVersion
            ? { modelVersion: submodelSummary.modelVersion }
            : {}),
          ...(submodelSummary?.elapsedMs !== undefined
            ? { elapsedMs: submodelSummary.elapsedMs }
            : {}),
          ...(typeof submodelSummary?.costUsd === "number"
            ? { costUsd: submodelSummary.costUsd }
            : {}),
          ...(submodelSummary?.usageTokens
            ? { usageTokens: submodelSummary.usageTokens }
            : {}),
          schemaPath: resolvedSchemaPath,
          sourcePath: resolvedSourcePath,
          outputPath: resolvedOutputPath,
          textChars: formatted.length,
          outputBytes,
        };
      },
    }),
    web_fetch: tool({
      description: [
        "Fetch a NON-PDF URL and return extracted text or binary metadata.",
        "Use this to download HTML/text sources found via web_search.",
        "For HTML responses, this tool returns stripped plain text.",
        "For non-text responses (except PDFs), this tool returns metadata and optionally writes base64 to outputPath.",
        "Do not use this tool for PDFs; place PDFs in the workspace and use pdf_to_images.",
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.string().trim().min(1),
          outputPath: z.string().trim().min(1).optional(),
          maxChars: z.number().int().min(200).max(200_000).optional(),
        })
        .strict(),
      execute: async ({ url, outputPath, maxChars }) => {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error(
            `web_fetch supports only http/https URLs (got "${parsed.protocol}").`,
          );
        }
        if (parsed.pathname.toLowerCase().endsWith(".pdf")) {
          throw new Error(
            `web_fetch does not support PDF URLs ("${url}"). Place the PDF in workspace and use pdf_to_images.`,
          );
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
        }, WEB_FETCH_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(parsed.toString(), {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const bytes = await readResponseBytesWithLimit(
          response,
          WEB_FETCH_MAX_BYTES,
        );
        const contentTypeHeader = response.headers.get("content-type");
        const contentType = contentTypeHeader
          ? (contentTypeHeader.split(";")[0]?.trim().toLowerCase() ??
            "application/octet-stream")
          : "application/octet-stream";
        const finalUrl = response.url || parsed.toString();
        const safeMaxChars = maxChars ?? WEB_FETCH_DEFAULT_MAX_CHARS;
        if (contentType === "application/pdf") {
          throw new Error(
            `web_fetch received PDF content from "${finalUrl}". Place the PDF in workspace and use pdf_to_images.`,
          );
        }

        const asText = () => {
          const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
            bytes,
          );
          if (
            contentType === "text/html" ||
            contentType === "application/xhtml+xml"
          ) {
            return decodeHtmlToText(decoded);
          }
          return decoded.trim();
        };

        const isLikelyText =
          contentType.startsWith("text/") ||
          contentType.includes("json") ||
          contentType.includes("xml") ||
          contentType.includes("html");

        if (isLikelyText) {
          const text = capUtf8Text(asText(), safeMaxChars * 6).slice(
            0,
            safeMaxChars,
          );
          if (outputPath) {
            const resolved = resolveWorkspacePath(rootDir, outputPath);
            await ensureDir(path.dirname(resolved));
            await writeFile(resolved, text, { encoding: "utf8" });
            workspace.scheduleUpdate(outputPath);
          }
          return {
            status: response.status,
            ok: response.ok,
            url: parsed.toString(),
            finalUrl,
            contentType,
            bytes: bytes.byteLength,
            text,
            ...(outputPath ? { outputPath } : {}),
          };
        }

        const base64 = Buffer.from(bytes).toString("base64");
        if (outputPath) {
          const resolved = resolveWorkspacePath(rootDir, outputPath);
          await ensureDir(path.dirname(resolved));
          await writeFile(resolved, base64, { encoding: "utf8" });
          workspace.scheduleUpdate(outputPath);
        }
        return {
          status: response.status,
          ok: response.ok,
          url: parsed.toString(),
          finalUrl,
          contentType,
          bytes: bytes.byteLength,
          base64Chars: base64.length,
          ...(outputPath ? { outputPath } : {}),
        };
      },
    }),
    extract_text: tool({
      description: [
        "Extract text from one or more workspace image/PDF documents and write markdown output.",
        "Uses a fixed internal extraction model (cannot be overridden).",
        "Required fields: documentPaths and outputPath.",
        "Always include documentPaths with 1+ primary transcription target documents.",
        'Minimal payload example: {"documentPaths":["source/student-work.png"],"outputPath":"output/transcription.md"}',
        'On success, the tool returns only {"status":"written"}. Read outputPath to inspect the transcription.',
        "Do not repeat an identical call for the same documentPaths/outputPath; read the written markdown file and continue from it.",
        'Use instructions to narrow scope (for example: "problems H1 and H2 only").',
        "Use supportingPaths to add extra context files (images, PDFs, or text documents).",
        "Use supportingInstructions to explain how supporting documents should be used for disambiguation.",
        "The model does not know filenames unless you include identifying details in instructions text.",
        "For multi-page tasks, ask for explicit page markers in instructions when needed.",
        "For formulas/equations, output embedded LaTeX: inline '\\(...\\)', display '\\[...\\]'. Use display LaTeX when the source formula is displayed. For mathematical number grids, arranged arithmetic, matrices, and sign rows, prefer source-faithful display LaTeX arrays/matrices; reserve Markdown tables for true data tables. Use real line breaks, never literal escaped newline text like '\\n'.",
      ].join("\n"),
      inputSchema: z
        .object({
          documentPaths: z
            .array(z.string().trim().min(1))
            .min(1)
            .max(EXTRACT_TEXT_MAX_DOCUMENT_FILES),
          outputPath: z.string().trim().min(1),
          instructions: z.string().trim().min(1).optional().nullable(),
          supportingPaths: z
            .array(z.string().trim().min(1))
            .max(EXTRACT_TEXT_MAX_CONTEXT_FILES)
            .optional()
            .nullable(),
          supportingInstructions: z
            .string()
            .trim()
            .min(1)
            .optional()
            .nullable(),
        })
        .strict(),
      execute: async ({
        documentPaths,
        outputPath,
        instructions,
        supportingPaths,
        supportingInstructions,
      }) => {
        return await extractTextToWorkspace({
          documentPaths,
          outputPath,
          instructions:
            typeof instructions === "string" ? instructions : undefined,
          supportingPaths: supportingPaths ?? undefined,
          supportingInstructions:
            typeof supportingInstructions === "string"
              ? supportingInstructions
              : undefined,
        });
      },
    }),
    kb_search_pdfs: tool({
      description: [
        "Search Spark's shared PDF knowledge base before looking online for official papers, mark schemes, examiner reports, grade boundaries, or competition PDFs.",
        "Entries include semi-structured classification/description text and a shared storagePath. If you find a match, call kb_download_pdf with that storagePath instead of fetching the third-party URL.",
      ].join("\n"),
      inputSchema: z
        .object({
          query: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
      execute: async ({ query, limit }) => {
        const entries = await loadSharedPdfKnowledgeBaseEntries();
        const matches = searchSharedPdfKnowledgeBaseEntries({
          entries,
          query,
          limit,
        });
        return {
          status: "ok",
          query: query ?? "",
          count: matches.length,
          entries: matches.map((entry) => ({
            id: entry.id,
            filename: entry.filename,
            storagePath: entry.storagePath,
            descriptionMarkdown: entry.descriptionMarkdown,
            originalUrl: entry.originalUrl,
            finalUrl: entry.finalUrl,
            sizeBytes: entry.sizeBytes,
            updatedAt: entry.updatedAt,
          })),
          indexPath: "knowledge-base/index.md",
        };
      },
    }),
    kb_download_pdf: tool({
      description: [
        "Download a shared knowledge-base PDF from Spark storage into this agent workspace.",
        "Use this after kb_search_pdfs returns a matching storagePath. The outputPath must be workspace-relative, normally under knowledge-base/downloads/ or grader/references/.",
      ].join("\n"),
      inputSchema: z
        .object({
          storagePath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
        })
        .strict(),
      execute: async ({ storagePath, outputPath }) => {
        const bucketName = `${parseGoogleServiceAccountJson(serviceAccountJson).projectId}.firebasestorage.app`;
        const downloaded = await downloadSharedPdfToWorkspace({
          serviceAccountJson,
          bucketName,
          rootDir,
          storagePath,
          outputPath,
        });
        workspace.scheduleUpdate(outputPath);
        return downloaded;
      },
    }),
    kb_cache_pdf_from_url: tool({
      description: [
        "Cache a newly discovered official PDF in Spark's shared PDF knowledge base.",
        "Call this only after checking kb_search_pdfs first. Classify the PDF in descriptionMarkdown as semi-structured text, for example: `gcse/aqa/biology/2024/AQA-84611H-QP-JUN24.PDF` plus what it is and how it was identified.",
        "The tool stores the PDF at spark/shared/<uuid>.pdf, writes a Firestore knowledge-base entry, refreshes knowledge-base/ files, and can optionally download the cached PDF into the workspace.",
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.string().trim().min(1),
          descriptionMarkdown: z.string().trim().min(1),
          filename: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          outputPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({ url, descriptionMarkdown, filename, outputPath }) => {
        const bucketName = `${parseGoogleServiceAccountJson(serviceAccountJson).projectId}.firebasestorage.app`;
        const cached = await cacheSharedPdfFromUrl({
          serviceAccountJson,
          bucketName,
          url,
          descriptionMarkdown,
          filename,
        });
        sharedPdfKnowledgeBaseEntries = null;
        const refreshedKnowledgeBase = await writeKnowledgeBaseWorkspaceFiles({
          serviceAccountJson,
          rootDir,
          limit: 100,
        });
        workspace.scheduleUpdate("knowledge-base/index.md");
        for (const filePath of refreshedKnowledgeBase.files) {
          workspace.scheduleUpdate(filePath);
        }
        const entryFile = await writeSharedPdfKnowledgeBaseEntryFile({
          rootDir,
          entry: cached.entry,
        });
        workspace.scheduleUpdate(entryFile);
        const downloaded =
          typeof outputPath === "string" && outputPath.trim().length > 0
            ? await downloadSharedPdfToWorkspace({
                serviceAccountJson,
                bucketName,
                rootDir,
                storagePath: cached.entry.storagePath,
                outputPath: outputPath.trim(),
              })
            : undefined;
        if (downloaded) {
          workspace.scheduleUpdate(downloaded.outputPath);
        }
        return {
          status: cached.status,
          entry: {
            id: cached.entry.id,
            filename: cached.entry.filename,
            storagePath: cached.entry.storagePath,
            descriptionMarkdown: cached.entry.descriptionMarkdown,
            originalUrl: cached.entry.originalUrl,
            finalUrl: cached.entry.finalUrl,
            sizeBytes: cached.entry.sizeBytes,
            sha256: cached.entry.sha256,
          },
          ...(downloaded ? { downloaded } : {}),
          indexPath: "knowledge-base/index.md",
        };
      },
    }),
    read_pdf: tool({
      description: [
        "Read and transcribe a PDF using a multimodal model.",
        "Provide url (official PDF URL) or pdfPath (workspace file), plus prompt/promptPath and outputPath.",
        "If both url and pdfPath are supplied, the workspace pdfPath is used. If both prompt and promptPath are supplied, the inline prompt is used.",
        `By default this tool uses ${DEFAULT_PDF_EXTRACTION_MODEL_ID}; pass modelId to override.`,
        "This tool requires real PDF bytes and rejects HTML mirror pages.",
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          pdfPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          prompt: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          promptPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          outputPath: z.string().trim().min(1),
          modelId: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          maxChars: z
            .number()
            .int()
            .min(200)
            .max(PDF_EXTRACTION_DEFAULT_MAX_CHARS)
            .optional(),
        })
        .strict()
        .superRefine((value, context) => {
          const hasUrl =
            typeof value.url === "string" && value.url.trim().length > 0;
          const hasPdfPath =
            typeof value.pdfPath === "string" &&
            value.pdfPath.trim().length > 0;
          const hasPrompt =
            typeof value.prompt === "string" && value.prompt.trim().length > 0;
          const hasPromptPath =
            typeof value.promptPath === "string" &&
            value.promptPath.trim().length > 0;
          if (!hasUrl && !hasPdfPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "read_pdf requires either url or pdfPath.",
              path: ["url"],
            });
          }
          if (!hasPrompt && !hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "read_pdf requires either prompt or promptPath.",
              path: ["prompt"],
            });
          }
        }),
      execute: async ({
        url,
        pdfPath,
        prompt,
        promptPath,
        outputPath,
        maxChars,
        modelId,
      }) => {
        const promptText = await resolvePdfPromptText({
          toolName: "read_pdf",
          prompt,
          promptPath,
        });

        if (typeof pdfPath === "string" && pdfPath.trim().length > 0) {
          const decoded = await decodePdfBytesFromWorkspace({
            toolName: "read_pdf",
            pdfPath,
          });
          return await extractPdfTextToWorkspace({
            toolName: "read_pdf",
            pdfBytes: decoded.pdfBytes,
            outputPath,
            promptText,
            modelId,
            maxChars,
            sourceInfo: {
              pdfPath: decoded.resolvedPdfPath,
            },
          });
        }

        const rawUrl = url?.trim() ?? "";
        if (rawUrl.length === 0) {
          return {
            status: "blocked",
            reason: "missing_pdf_source",
            outputPath,
            message:
              "extract_pdf_diagrams could not infer a single workspace PDF and no url/pdfPath was provided. Write the worksheet from the existing transcription/page images, or call extract_pdf_diagrams with pdfPath and prompt/promptPath.",
          };
        }
        const fetched = await fetchPdfBytesFromUrl({
          toolName: "read_pdf",
          url: rawUrl,
        });

        return await extractPdfTextToWorkspace({
          toolName: "read_pdf",
          pdfBytes: fetched.pdfBytes,
          outputPath,
          promptText,
          modelId,
          maxChars,
          sourceInfo: {
            url: rawUrl,
            finalUrl: fetched.finalUrl,
            contentType: fetched.contentType,
            ...(fetched.storagePath
              ? { storagePath: fetched.storagePath }
              : {}),
          },
        });
      },
    }),
    extract_pdf_diagrams: tool({
      description: [
        "Extract diagram bounding boxes from a PDF using a multimodal model.",
        "Provide url (official PDF URL) or pdfPath (workspace file), plus prompt/promptPath and outputPath.",
        "If both url and pdfPath are supplied, the workspace pdfPath is used. If both prompt and promptPath are supplied, the inline prompt is used.",
        "Writes a JSON manifest with per-diagram problem id, page, normalized bounding box, and optional labels.",
        `By default this tool uses ${DEFAULT_PDF_EXTRACTION_MODEL_ID}; pass modelId to override.`,
      ].join("\n"),
      inputSchema: z
        .object({
          url: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          pdfPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          prompt: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          promptPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          outputPath: z.string().trim().min(1),
          modelId: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          maxDiagrams: z
            .number()
            .int()
            .min(1)
            .max(PDF_DIAGRAM_MAX_ITEMS)
            .optional(),
        })
        .strict(),
      execute: async ({
        url,
        pdfPath,
        prompt,
        promptPath,
        outputPath,
        modelId,
        maxDiagrams,
      }) => {
        const blockedReason =
          await checkGraderPrePublishDiagramExtractionAllowed();
        if (blockedReason !== null) {
          return {
            status: "blocked",
            reason: "pre_publish_diagram_extraction_budget_exceeded",
            outputPath,
            message: blockedReason,
          };
        }

        const promptText = await resolveDiagramExtractionPromptText({
          prompt,
          promptPath,
        });

        const inferredPdfPath = pdfPath ?? (await inferSingleUploadedPdfPath());
        if (
          typeof inferredPdfPath === "string" &&
          inferredPdfPath.trim().length > 0
        ) {
          const decoded = await decodePdfBytesFromWorkspace({
            toolName: "extract_pdf_diagrams",
            pdfPath: inferredPdfPath,
          });
          return await extractPdfDiagramManifestToWorkspace({
            toolName: "extract_pdf_diagrams",
            pdfBytes: decoded.pdfBytes,
            outputPath,
            promptText,
            modelId,
            maxDiagrams,
            sourceInfo: {
              pdfPath: decoded.resolvedPdfPath,
            },
          });
        }

        const rawUrl = url?.trim() ?? "";
        const fetched = await fetchPdfBytesFromUrl({
          toolName: "extract_pdf_diagrams",
          url: rawUrl,
        });
        return await extractPdfDiagramManifestToWorkspace({
          toolName: "extract_pdf_diagrams",
          pdfBytes: fetched.pdfBytes,
          outputPath,
          promptText,
          modelId,
          maxDiagrams,
          sourceInfo: {
            url: rawUrl,
            finalUrl: fetched.finalUrl,
            contentType: fetched.contentType,
            ...(fetched.storagePath
              ? { storagePath: fetched.storagePath }
              : {}),
          },
        });
      },
    }),
    extract_pdf_text: tool({
      description: [
        "Legacy text extraction helper for workspace PDFs.",
        "Prefer the pdf_to_images + view_image workflow for grading and diagram-sensitive transcription tasks.",
      ].join("\n"),
      inputSchema: z
        .object({
          pdfPath: z.string().trim().min(1),
          prompt: z.string().trim().min(1).optional(),
          promptPath: z.string().trim().min(1).optional(),
          outputPath: z.string().trim().min(1),
          maxChars: z
            .number()
            .int()
            .min(200)
            .max(PDF_EXTRACTION_DEFAULT_MAX_CHARS)
            .optional(),
        })
        .strict()
        .superRefine((value, context) => {
          const hasPrompt =
            typeof value.prompt === "string" && value.prompt.trim().length > 0;
          const hasPromptPath =
            typeof value.promptPath === "string" &&
            value.promptPath.trim().length > 0;
          if (hasPrompt && hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                "extract_pdf_text expects either prompt or promptPath, not both.",
              path: ["prompt"],
            });
          }
          if (!hasPrompt && !hasPromptPath) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "extract_pdf_text requires either prompt or promptPath.",
              path: ["prompt"],
            });
          }
        }),
      execute: async ({
        pdfPath,
        prompt,
        promptPath,
        outputPath,
        maxChars,
      }) => {
        const promptText = await resolvePdfPromptText({
          toolName: "extract_pdf_text",
          prompt,
          promptPath,
        });
        const decoded = await decodePdfBytesFromWorkspace({
          toolName: "extract_pdf_text",
          pdfPath,
        });
        return await extractPdfTextToWorkspace({
          toolName: "extract_pdf_text",
          pdfBytes: decoded.pdfBytes,
          outputPath,
          promptText,
          maxChars,
          sourceInfo: {
            pdfPath: decoded.resolvedPdfPath,
          },
        });
      },
    }),
    extract_pdf_images: tool({
      description: [
        "Deterministically list and optionally extract embedded raster images from a workspace PDF using local Poppler pdfimages.",
        "Use this as a cheap first pass before LLM-assisted figure cropping when the source PDF may contain embedded photos, maps, charts, apparatus images, or scanned figure bitmaps.",
        "This extracts PDF image objects only. It does not locate vector diagrams, text labels drawn outside the image object, or the on-page coordinates of the image; use pdf_to_images plus grid/crop tools for those cases.",
        "The tool writes a JSON manifest and extracted image files under outputDir. Filter tiny repeated strips/noise with minWidth/minHeight and validate useful outputs before linking them in a worksheet.",
      ].join("\n"),
      inputSchema: z
        .object({
          pdfPath: z.string().trim().min(1),
          outputDir: z.string().trim().min(1),
          firstPage: z.preprocess(
            parseOptionalNumber,
            z.number().int().min(1).optional(),
          ),
          lastPage: z.preprocess(
            parseOptionalNumber,
            z.number().int().min(1).optional(),
          ),
          minWidth: z.preprocess(
            parseOptionalNumber,
            z.number().int().min(1).optional(),
          ),
          minHeight: z.preprocess(
            parseOptionalNumber,
            z.number().int().min(1).optional(),
          ),
          maxImages: z.preprocess(
            parseOptionalNumber,
            z
              .number()
              .int()
              .min(1)
              .max(PDF_EMBEDDED_IMAGE_MAX_ITEMS)
              .optional(),
          ),
          includeMasks: z.boolean().optional(),
          extractFiles: z.boolean().optional(),
          filenamePrefix: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict()
        .superRefine((value, context) => {
          if (
            value.firstPage !== undefined &&
            value.lastPage !== undefined &&
            value.lastPage < value.firstPage
          ) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "lastPage must be greater than or equal to firstPage.",
              path: ["lastPage"],
            });
          }
        }),
      execute: async ({
        pdfPath,
        outputDir,
        firstPage,
        lastPage,
        minWidth,
        minHeight,
        maxImages,
        includeMasks,
        extractFiles,
        filenamePrefix,
      }) => {
        const decoded = await decodePdfBytesFromWorkspace({
          toolName: "extract_pdf_images",
          pdfPath,
        });
        const normalizedOutputDir = outputDir
          .replace(/\\/g, "/")
          .replace(/\/+$/u, "");
        if (normalizedOutputDir.length === 0) {
          throw new Error("extract_pdf_images outputDir must not be empty.");
        }
        const absoluteOutputDir = resolveWorkspacePath(
          rootDir,
          normalizedOutputDir,
        );
        await ensureDir(absoluteOutputDir);

        const sourceAbsolutePath = resolveWorkspacePath(
          rootDir,
          decoded.resolvedPdfPath,
        );
        const sourceBytes = await readFile(sourceAbsolutePath);
        const pdfImagesPdfPath =
          sourceBytes.subarray(0, 5).toString("utf8") === "%PDF-"
            ? sourceAbsolutePath
            : path.join(absoluteOutputDir, ".pdfimages-source.pdf");
        if (pdfImagesPdfPath !== sourceAbsolutePath) {
          await writeFile(pdfImagesPdfPath, decoded.pdfBytes);
        }

        const pageArgs: string[] = [];
        if (firstPage !== undefined) {
          pageArgs.push("-f", firstPage.toString());
        }
        if (lastPage !== undefined) {
          pageArgs.push("-l", lastPage.toString());
        }

        let listStdout = "";
        try {
          const result = await execFileAsync(
            "pdfimages",
            [...pageArgs, "-list", pdfImagesPdfPath],
            { maxBuffer: PDF_IMAGES_CLI_MAX_BUFFER },
          );
          listStdout = result.stdout;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              status: "unavailable",
              reason: "pdfimages_not_found",
              pdfPath: decoded.resolvedPdfPath,
              outputDir: normalizedOutputDir,
              message:
                "The local pdfimages binary is not installed. Use pdf_to_images and crop tools, or install poppler-utils in the task runtime.",
            };
          }
          throw new Error(
            `extract_pdf_images failed to list PDF images: ${errorAsString(error)}`,
          );
        }

        const allImages = parsePdfImagesListOutput(listStdout);
        const resolvedMinWidth = minWidth ?? 80;
        const resolvedMinHeight = minHeight ?? 80;
        const resolvedMaxImages =
          maxImages ?? PDF_EMBEDDED_IMAGE_DEFAULT_MAX_ITEMS;
        const selectedImages = allImages
          .filter((image) => {
            if (includeMasks !== true && image.type !== "image") {
              return false;
            }
            return (
              image.width >= resolvedMinWidth &&
              image.height >= resolvedMinHeight
            );
          })
          .slice(0, resolvedMaxImages);

        const uniquePrefix = `${sanitizePdfImageFilenamePrefix(filenamePrefix)}-${Date.now().toString(36)}`;
        let extractedFiles: Array<{
          path: string;
          width: number | null;
          height: number | null;
          bytes: number;
        }> = [];
        if (extractFiles !== false && selectedImages.length > 0) {
          const imageRoot = path.join(absoluteOutputDir, uniquePrefix);
          try {
            await execFileAsync(
              "pdfimages",
              ["-png", "-p", ...pageArgs, pdfImagesPdfPath, imageRoot],
              { maxBuffer: PDF_IMAGES_CLI_MAX_BUFFER },
            );
          } catch (error) {
            throw new Error(
              `extract_pdf_images failed to extract PDF images: ${errorAsString(error)}`,
            );
          }
          extractedFiles = await resolvePdfImagesExtractedFiles({
            outputDir: normalizedOutputDir,
            absoluteOutputDir,
            filenamePrefix: uniquePrefix,
          });
          for (const file of extractedFiles) {
            workspace.scheduleUpdate(file.path);
          }
        }

        const selectedWithPaths = attachExtractedPdfImagePaths({
          images: selectedImages,
          files: extractedFiles,
        });
        const selectedPathSet = new Set(
          selectedWithPaths.flatMap((image) => {
            return typeof image.path === "string" ? [image.path] : [];
          }),
        );
        if (selectedPathSet.size > 0) {
          const unusedFiles = extractedFiles.filter(
            (file) => !selectedPathSet.has(file.path),
          );
          for (const file of unusedFiles) {
            await rm(resolveWorkspacePath(rootDir, file.path), {
              force: true,
            }).catch(() => undefined);
          }
          extractedFiles = extractedFiles.filter((file) =>
            selectedPathSet.has(file.path),
          );
        }
        const manifest = {
          status: "written",
          extractionMode: "pdfimages",
          pdfPath: decoded.resolvedPdfPath,
          outputDir: normalizedOutputDir,
          manifestPath: `${normalizedOutputDir}/manifest.json`,
          ...(firstPage !== undefined ? { firstPage } : {}),
          ...(lastPage !== undefined ? { lastPage } : {}),
          minWidth: resolvedMinWidth,
          minHeight: resolvedMinHeight,
          includeMasks: includeMasks === true,
          extractFiles: extractFiles !== false,
          imageCount: allImages.length,
          selectedCount: selectedWithPaths.length,
          extractedFileCount: extractedFiles.length,
          images: selectedWithPaths,
          allImages: allImages.slice(0, Math.min(allImages.length, 200)),
          notes: [
            "pdfimages extracts embedded raster image objects; it does not return on-page crop coordinates.",
            "Vector diagrams, text drawn outside an image object, and layout-sensitive figures still require pdf_to_images plus grid/crop validation.",
            "Exam PDFs may contain repeated decorative strips or tiny artifacts; ignore outputs that fail the minimum size filter or visual validation.",
          ],
        };
        const manifestPath = resolveWorkspacePath(
          rootDir,
          manifest.manifestPath,
        );
        await writeFile(
          manifestPath,
          JSON.stringify(manifest, null, 2) + "\n",
          {
            encoding: "utf8",
          },
        );
        workspace.scheduleUpdate(manifest.manifestPath);
        return manifest;
      },
    }),
    pdf_to_images: tool({
      description: [
        "Render selected pages from a workspace PDF into PNG images in the workspace.",
        `Use this for agentic diagram extraction loops before calling crop_image. Always pass required 1-based pageNumbers for the exact pages needed, matching extracted reference headings such as ## Page 3. PDFs over ${PDF_PAGE_NUMBERS_REQUIRED_THRESHOLD.toString()} pages reject calls without pageNumbers.`,
        'For page selection use {"pageNumbers":[2,3,11]}. pageNumbers is a required top-level tool field, not part of outputDir. Legacy aliases pages/page/firstPage/lastPage are tolerated only when pageNumbers is also present.',
      ].join("\n"),
      inputSchema: z
        .object({
          pdfPath: z.string().trim().min(1),
          outputDir: z.string().trim().min(1),
          pageNumbers: z.preprocess(
            (value) => (value === null ? undefined : value),
            z
              .array(
                z.preprocess((entry) => {
                  if (typeof entry === "string" && entry.trim().length > 0) {
                    const parsed = Number.parseInt(entry.trim(), 10);
                    if (Number.isInteger(parsed)) {
                      return parsed;
                    }
                  }
                  return entry;
                }, z.number().int().min(1)),
              )
              .min(1)
              .max(200)
              .describe("Required 1-based PDF page numbers to render."),
          ),
          pages: z.preprocess(
            (value) => (value === null ? undefined : value),
            z
              .array(z.number().int().min(1))
              .max(200)
              .optional()
              .describe("Alias for pageNumbers."),
          ),
          page: z.preprocess(
            (value) => (value === null ? undefined : value),
            z
              .number()
              .int()
              .min(1)
              .optional()
              .describe("Single 1-based PDF page to render."),
          ),
          firstPage: z.preprocess(
            (value) => (value === null ? undefined : value),
            z
              .number()
              .int()
              .min(1)
              .optional()
              .describe("First 1-based page in an inclusive render range."),
          ),
          lastPage: z.preprocess(
            (value) => (value === null ? undefined : value),
            z
              .number()
              .int()
              .min(1)
              .optional()
              .describe("Last 1-based page in an inclusive render range."),
          ),
          scale: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().min(0.5).max(6).optional()),
          maxDimension: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().int().min(500).max(8000).optional()),
          filenamePrefix: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({
        pdfPath,
        outputDir,
        pageNumbers,
        pages,
        page,
        firstPage,
        lastPage,
        scale,
        maxDimension,
        filenamePrefix,
      }) => {
        const recoveredSelectionFromOutputDir = (() => {
          const match = outputDir.match(
            /[\\"]*,\s*[\\"]*(pageNumbers|pages)[\\"]*\s*:\s*\[([0-9,\s]+)\]/u,
          );
          if (!match || match.index === undefined) {
            return null;
          }
          const recoveredPages = match[2]
            .split(",")
            .map((entry) => Number.parseInt(entry.trim(), 10))
            .filter((entry) => Number.isInteger(entry) && entry > 0);
          if (recoveredPages.length === 0) {
            return null;
          }
          const recoveredOutputDir = outputDir
            .slice(0, match.index)
            .replace(/[\\"]+$/u, "")
            .trim();
          if (recoveredOutputDir.length === 0) {
            return null;
          }
          return {
            outputDir: recoveredOutputDir,
            pageNumbers: recoveredPages,
          };
        })();
        const effectiveOutputDir =
          recoveredSelectionFromOutputDir?.outputDir ?? outputDir;
        const decoded = await decodePdfBytesFromWorkspace({
          toolName: "read_pdf",
          pdfPath,
        });
        const pdfBytes = Uint8Array.from(decoded.pdfBytes);
        const pageCount = await getPdfPageCount({ pdfBytes });
        if (
          firstPage !== undefined &&
          lastPage !== undefined &&
          lastPage < firstPage
        ) {
          throw new Error(
            `pdf_to_images lastPage ${lastPage.toString()} must be greater than or equal to firstPage ${firstPage.toString()}.`,
          );
        }
        const resolvedPageNumbers = (() => {
          if (pageNumbers !== undefined && pageNumbers.length > 0) {
            return pageNumbers;
          }
          if (
            recoveredSelectionFromOutputDir !== null &&
            recoveredSelectionFromOutputDir.pageNumbers.length > 0
          ) {
            return recoveredSelectionFromOutputDir.pageNumbers;
          }
          if (pages !== undefined && pages.length > 0) {
            return pages;
          }
          if (page !== undefined) {
            return [page];
          }
          if (firstPage !== undefined || lastPage !== undefined) {
            const start = firstPage ?? lastPage ?? 1;
            const end = lastPage ?? firstPage ?? start;
            return Array.from(
              { length: end - start + 1 },
              (_, index) => start + index,
            );
          }
          return undefined;
        })();
        const missingPageNumbers =
          resolvedPageNumbers === undefined ||
          resolvedPageNumbers.length === 0;
        if (
          pageCount > PDF_PAGE_NUMBERS_REQUIRED_THRESHOLD &&
          missingPageNumbers
        ) {
          throw new Error(
            `pdf_to_images requires explicit 1-based pages for PDFs longer than ${PDF_PAGE_NUMBERS_REQUIRED_THRESHOLD.toString()} pages (pageCount=${pageCount.toString()}). Use extract_pdf_reference_text/grep first to choose exact pages, then retry with one of {"pageNumbers":[2,3,11]}, {"pages":[2,3,11]}, {"page":3}, or {"firstPage":2,"lastPage":4}.`,
          );
        }
        const requestedPages =
          !missingPageNumbers && resolvedPageNumbers
            ? [...new Set(resolvedPageNumbers)].sort((a, b) => a - b)
            : Array.from({ length: pageCount }, (_, index) => index + 1);
        if (requestedPages.length === 0) {
          throw new Error(
            "pdf_to_images requires at least one page to render.",
          );
        }
        for (const pageNumber of requestedPages) {
          if (pageNumber > pageCount) {
            throw new Error(
              `pdf_to_images page ${pageNumber.toString()} exceeds page count ${pageCount.toString()}.`,
            );
          }
        }
        const resolvedScale = scale ?? DEFAULT_PDF_PAGE_IMAGE_SCALE;
        const resolvedMaxDimension =
          maxDimension ?? DEFAULT_PDF_PAGE_IMAGE_MAX_DIMENSION;
        const renderBatchSize =
          requestedPages.length > PDF_PAGE_NUMBERS_PREFERRED_THRESHOLD
            ? 4
            : requestedPages.length;
        const normalizedEffectiveOutputDir = effectiveOutputDir
          .replace(/\\/g, "/")
          .replace(/\/+$/u, "");
        if (normalizedEffectiveOutputDir.length === 0) {
          throw new Error("outputDir must not be empty.");
        }
        const prefix = (filenamePrefix ?? "page").replace(
          /[^a-z0-9_-]+/giu,
          "-",
        );
        const written: Array<{
          page: number;
          path: string;
          width: number;
          height: number;
          bytes: number;
        }> = [];
        for (
          let pageIndex = 0;
          pageIndex < requestedPages.length;
          pageIndex += renderBatchSize
        ) {
          const pageBatch = requestedPages.slice(
            pageIndex,
            pageIndex + renderBatchSize,
          );
          const renderedByPage = await renderPdfPagesBgra({
            pdfBytes,
            pageNumbers: pageBatch,
            scale: resolvedScale,
          });
          for (const pageNumber of pageBatch) {
            const bitmap = renderedByPage.get(pageNumber);
            if (!bitmap) {
              continue;
            }
            const relativePath = `${normalizedEffectiveOutputDir}/${prefix}-${pageNumber
              .toString()
              .padStart(4, "0")}.png`;
            const resolvedPath = resolveWorkspacePath(rootDir, relativePath);
            await ensureDir(path.dirname(resolvedPath));
            let pngBytes: Uint8Array = Buffer.from(
              encodeBgraBitmapToPng(bitmap),
            );
            let outputWidth = bitmap.width;
            let outputHeight = bitmap.height;
            if (Math.max(outputWidth, outputHeight) > resolvedMaxDimension) {
              const sharp = getSharp();
              pngBytes = await sharp(pngBytes)
                .resize({
                  width:
                    outputWidth >= outputHeight
                      ? resolvedMaxDimension
                      : undefined,
                  height:
                    outputHeight > outputWidth
                      ? resolvedMaxDimension
                      : undefined,
                  fit: "inside",
                  withoutEnlargement: true,
                })
                .png()
                .toBuffer();
              const outputMetadata = await sharp(pngBytes).metadata();
              if (
                typeof outputMetadata.width === "number" &&
                outputMetadata.width > 0
              ) {
                outputWidth = outputMetadata.width;
              }
              if (
                typeof outputMetadata.height === "number" &&
                outputMetadata.height > 0
              ) {
                outputHeight = outputMetadata.height;
              }
            }
            await writeFile(resolvedPath, pngBytes);
            workspace.scheduleUpdate(relativePath);
            written.push({
              page: pageNumber,
              path: relativePath,
              width: outputWidth,
              height: outputHeight,
              bytes: pngBytes.byteLength,
            });
          }
        }
        return {
          status: "written",
          pdfPath: decoded.resolvedPdfPath,
          pageCount,
          outputDir: normalizedEffectiveOutputDir,
          ...(recoveredSelectionFromOutputDir !== null
            ? { recoveredPageSelectionFromOutputDir: true }
            : {}),
          pageSelection:
            missingPageNumbers ? "all-pages" : "explicit-pageNumbers",
          scale: resolvedScale,
          maxDimension: resolvedMaxDimension,
          renderBatchSize,
          pages: written,
        };
      },
    }),
    crop_image: tool({
      description: [
        "Crop a workspace image (JPG/PNG/WEBP/GIF/HEIC/HEIF) using a required bboxPixels rectangle.",
        "Use bboxPixels when you have coordinates from a rendered page/crop grid: left/top/right/bottom are pixel coordinates in the selected source image, origin top-left, right/bottom exclusive.",
        "The cropped output is written as PNG and follows the requested bbox exactly by default; when a final worksheet asset crop touches a source-image edge, the tool adds a clean white border unless you explicitly pass paddingPx.",
        "Do not call this tool without bboxPixels; do not pass null, zero, or tiny placeholder coordinates.",
        "Use paddingPx only when you intentionally want an additional source-image margin outside bboxPixels.",
        "Use this to iteratively refine diagram crops from page images; when content touches an edge, expand the bbox outward rather than tightening it.",
      ].join("\n"),
      inputSchema: cropImageInputSchema,
      execute: async (input: {
        sourcePath: string;
        outputPath: string;
        fullImage?: boolean;
        bbox1000?: { left: number; top: number; right: number; bottom: number };
        bboxNorm?: { left: number; top: number; width: number; height: number };
        bboxPixels?: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        };
        paddingPx?: number;
      }) => {
        const {
          sourcePath,
          outputPath,
          fullImage,
          bbox1000,
          bboxNorm,
          bboxPixels,
          paddingPx,
        } = input;
        const intermediateAssetMessage =
          getBlockedIntermediateWorksheetAssetMessage(outputPath);
        if (intermediateAssetMessage !== null) {
          return {
            status: "blocked",
            reason: "intermediate_worksheet_asset_path",
            sourcePath,
            outputPath,
            message: intermediateAssetMessage,
            nextAction:
              "Retry crop_image immediately with the exact planned final grader/output/assets/... or sheet/output/assets/... path, then use that exact path in the worksheet JSON. Do not spend another turn promoting or validating a raw/candidate asset before the first sheet.json.",
          };
        }
        const blockedReason = await checkGraderPrePublishImageEditAllowed(
          "crop_image",
          outputPath,
        );
        if (blockedReason !== null) {
          return {
            status: "blocked",
            reason: "pre_publish_image_edit_budget_exceeded",
            sourcePath,
            outputPath,
            message: blockedReason,
          };
        }
        const resolvedSourcePath = resolveWorkspacePath(rootDir, sourcePath);
        const sourceBytes = await readFile(resolvedSourcePath);
        const sharp = getSharp();
        const sourceMetadata = await sharp(sourceBytes)
          .metadata()
          .catch((error) => {
            throw new Error(
              `crop_image could not decode "${sourcePath}" as an image: ${errorAsString(error)}`,
            );
          });
        const sourceWidth = sourceMetadata.width;
        const sourceHeight = sourceMetadata.height;
        if (
          typeof sourceWidth !== "number" ||
          typeof sourceHeight !== "number" ||
          sourceWidth <= 0 ||
          sourceHeight <= 0
        ) {
          throw new Error(
            `crop_image could not read dimensions for "${sourcePath}".`,
          );
        }
        const sourceMime =
          resolveImageMimeTypeFromSharpFormat({
            format: sourceMetadata.format,
          }) ?? resolveContentType(sourcePath);
        if (!isSupportedCropImageMimeType(sourceMime)) {
          throw new Error(
            `crop_image supports ${SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES.join(", ")}. Received ${sourceMime ?? "unknown"} for "${sourcePath}".`,
          );
        }
        const pixels = (() => {
          if (bbox1000 !== undefined) {
            return toCropPixelsFrom1000({
              width: sourceWidth,
              height: sourceHeight,
              left: bbox1000.left,
              top: bbox1000.top,
              right: bbox1000.right,
              bottom: bbox1000.bottom,
            });
          }
          if (bboxNorm !== undefined) {
            return toCropPixelsFromNorm({
              width: sourceWidth,
              height: sourceHeight,
              left: bboxNorm.left,
              top: bboxNorm.top,
              widthNorm: bboxNorm.width,
              heightNorm: bboxNorm.height,
            });
          }
          if (bboxPixels !== undefined) {
            return toCropPixelsFromPixels({
              width: sourceWidth,
              height: sourceHeight,
              left: bboxPixels.left,
              top: bboxPixels.top,
              right: bboxPixels.right,
              bottom: bboxPixels.bottom,
            });
          }
          if (fullImage === true) {
            return {
              left: 0,
              top: 0,
              right: sourceWidth,
              bottom: sourceHeight,
            };
          }
          throw new Error(
            "crop_image received no crop bounds. Provide bboxPixels/bbox1000/bboxNorm or set fullImage=true.",
          );
        })();
        const requestedCropTouchesSourceEdge =
          pixels.left === 0 ||
          pixels.top === 0 ||
          pixels.right === sourceWidth ||
          pixels.bottom === sourceHeight;
        const marginPx =
          paddingPx ??
          ((fullImage === true ||
            (WORKSHEET_CROP_ASSET_PATH_PATTERN.test(outputPath) &&
              requestedCropTouchesSourceEdge))
            ? DEFAULT_CROP_IMAGE_MARGIN_PX
            : 0);
        const crop = expandCropPixelsWithMargin({
          pixels,
          sourceWidth,
          sourceHeight,
          marginPx,
        });
        const croppedBytes = await cropImageToPngBuffer({
          source: sourceBytes,
          left: crop.pixels.left,
          top: crop.pixels.top,
          right: crop.pixels.right,
          bottom: crop.pixels.bottom,
          extend: crop.outputPadding,
        });
        const resolvedOutputPath = resolveWorkspacePath(rootDir, outputPath);
        await ensureDir(path.dirname(resolvedOutputPath));
        await writeFile(resolvedOutputPath, croppedBytes);
        workspace.scheduleUpdate(outputPath);
        return {
          status: "written",
          sourcePath,
          outputPath,
          sourceWidth,
          sourceHeight,
          cropWidth:
            crop.pixels.right -
            crop.pixels.left +
            crop.outputPadding.left +
            crop.outputPadding.right,
          cropHeight:
            crop.pixels.bottom -
            crop.pixels.top +
            crop.outputPadding.top +
            crop.outputPadding.bottom,
          bboxPixels: crop.pixels,
          requestedBBoxPixels: pixels,
          paddingPx: marginPx,
          outputPadding: crop.outputPadding,
          fullImage: fullImage === true,
          outputBytes: croppedBytes.byteLength,
        };
      },
    }),
    trim_image: tool({
      description: [
        "Content-aware trim for workspace images (JPG/PNG/WEBP/GIF/HEIC/HEIF): removes near-background margins and keeps a small border.",
        "Use only after a complete crop is known; trim_image cannot recover labels, options, axes, or table cells that were already clipped by crop_image.",
        "After trimming, inspect with view_image. If required ink touches an edge, recrop from the original page or rerun trim_image with larger padding.",
      ].join("\n"),
      inputSchema: z
        .object({
          sourcePath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
          fuzzPercent: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().min(0).max(10).optional()),
          paddingPx: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().int().min(0).max(256).optional()),
        })
        .strict(),
      execute: async ({ sourcePath, outputPath, fuzzPercent, paddingPx }) => {
        const blockedReason = await checkGraderPrePublishImageEditAllowed(
          "trim_image",
          outputPath,
        );
        if (blockedReason !== null) {
          return {
            status: "blocked",
            reason: "pre_publish_image_edit_budget_exceeded",
            sourcePath,
            outputPath,
            message: blockedReason,
          };
        }
        const resolvedSourcePath = resolveWorkspacePath(rootDir, sourcePath);
        const sourceBytes = await readFile(resolvedSourcePath);
        const sharp = getSharp();
        const sourceMetadata = await sharp(sourceBytes)
          .metadata()
          .catch((error) => {
            throw new Error(
              `trim_image could not decode "${sourcePath}" as an image: ${errorAsString(error)}`,
            );
          });
        const sourceMime =
          resolveImageMimeTypeFromSharpFormat({
            format: sourceMetadata.format,
          }) ?? resolveContentType(sourcePath);
        if (!isSupportedCropImageMimeType(sourceMime)) {
          throw new Error(
            `trim_image supports ${SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES.join(", ")}. Received ${sourceMime ?? "unknown"} for "${sourcePath}".`,
          );
        }
        const decoded = await sharp(sourceBytes)
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const bounds = detectImageForegroundBounds({
          data: decoded.data,
          width: decoded.info.width,
          height: decoded.info.height,
          channels: decoded.info.channels,
          fuzzPercent: fuzzPercent ?? 1,
        });
        const padded = expandImageBounds({
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          paddingPx: paddingPx ?? DEFAULT_CROP_IMAGE_MARGIN_PX,
          width: decoded.info.width,
          height: decoded.info.height,
        });
        const trimmedBytes = await sharp(sourceBytes)
          .extract({
            left: padded.left,
            top: padded.top,
            width: padded.right - padded.left,
            height: padded.bottom - padded.top,
          })
          .png()
          .toBuffer();
        const resolvedOutputPath = resolveWorkspacePath(rootDir, outputPath);
        await ensureDir(path.dirname(resolvedOutputPath));
        await writeFile(resolvedOutputPath, trimmedBytes);
        workspace.scheduleUpdate(outputPath);
        return {
          status: "written",
          sourcePath,
          outputPath,
          sourceWidth: decoded.info.width,
          sourceHeight: decoded.info.height,
          trimWidth: padded.right - padded.left,
          trimHeight: padded.bottom - padded.top,
          bboxPixels: padded,
          detectedForeground: bounds.hasForeground,
          tolerance: bounds.tolerance,
          paddingPx: paddingPx ?? DEFAULT_CROP_IMAGE_MARGIN_PX,
          outputBytes: trimmedBytes.byteLength,
        };
      },
    }),
    pad_image: tool({
      description: [
        "Add a clean white border around a complete workspace image crop.",
        "Use this after view_image/fresh-review confirms the crop contains all required labels/options/axes/table cells but publish_sheet reports dark content touching an edge.",
        "This preserves the crop content and only adds whitespace; it is safer than repeatedly cropping tighter.",
      ].join("\n"),
      inputSchema: z
        .object({
          sourcePath: z.string().trim().min(1),
          outputPath: z.string().trim().min(1),
          paddingPx: z.preprocess((value) => {
            if (value === null || value === undefined) {
              return undefined;
            }
            return value;
          }, z.number().int().min(1).max(512).optional()),
        })
        .strict(),
      execute: async ({ sourcePath, outputPath, paddingPx }) => {
        const resolvedSourcePath = resolveWorkspacePath(rootDir, sourcePath);
        const sourceBytes = await readFile(resolvedSourcePath);
        const sharp = getSharp();
        const sourceMetadata = await sharp(sourceBytes)
          .metadata()
          .catch((error) => {
            throw new Error(
              `pad_image could not decode "${sourcePath}" as an image: ${errorAsString(error)}`,
            );
          });
        const sourceWidth = sourceMetadata.width;
        const sourceHeight = sourceMetadata.height;
        if (
          typeof sourceWidth !== "number" ||
          typeof sourceHeight !== "number" ||
          sourceWidth <= 0 ||
          sourceHeight <= 0
        ) {
          throw new Error(
            `pad_image could not read dimensions for "${sourcePath}".`,
          );
        }
        const sourceMime =
          resolveImageMimeTypeFromSharpFormat({
            format: sourceMetadata.format,
          }) ?? resolveContentType(sourcePath);
        if (!isSupportedCropImageMimeType(sourceMime)) {
          throw new Error(
            `pad_image supports ${SUPPORTED_CROP_IMAGE_INPUT_MIME_TYPES.join(", ")}. Received ${sourceMime ?? "unknown"} for "${sourcePath}".`,
          );
        }
        const border = paddingPx ?? DEFAULT_CROP_IMAGE_MARGIN_PX;
        const paddedBytes = await sharp(sourceBytes)
          .extend({
            top: border,
            right: border,
            bottom: border,
            left: border,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .png()
          .toBuffer();
        const resolvedOutputPath = resolveWorkspacePath(rootDir, outputPath);
        await ensureDir(path.dirname(resolvedOutputPath));
        await writeFile(resolvedOutputPath, paddedBytes);
        workspace.scheduleUpdate(outputPath);
        return {
          status: "written",
          sourcePath,
          outputPath,
          sourceWidth,
          sourceHeight,
          outputWidth: sourceWidth + border * 2,
          outputHeight: sourceHeight + border * 2,
          paddingPx: border,
          outputBytes: paddedBytes.byteLength,
        };
      },
    }),
    validate_grader_artifacts: tool({
      description: [
        "Validate grader/output/sheet.json and grader/output/run-summary.json before source-fidelity audit or publish.",
        "Use this immediately after writing both grader JSON artifacts. It catches invalid JSON, schema errors, score mismatches, missing crop validation, missing bounded scoring for long handwritten papers, and publish-guard issues without publishing.",
        "Call with requireSourceFidelityAudit=false before running validate_source_fidelity_with_fresh_agent; call publish_sheet for the final required publish validation.",
      ].join("\n"),
      inputSchema: z
        .object({
          summaryPath: z
            .string()
            .trim()
            .min(1)
            .default("grader/output/run-summary.json"),
          sheetPath: z
            .string()
            .trim()
            .min(1)
            .default("grader/output/sheet.json"),
          requireSourceFidelityAudit: z
            .boolean()
            .describe(
              "Use false before the source-fidelity audit exists; use true only when checking the final pre-publish state.",
            )
            .default(false),
        })
        .strict(),
      execute: async ({
        summaryPath,
        sheetPath,
        requireSourceFidelityAudit,
      }) => {
        const resolvedSummaryPath =
          summaryPath ?? "grader/output/run-summary.json";
        const resolvedSheetPath = sheetPath ?? "grader/output/sheet.json";
        const resolvedRequireSourceFidelityAudit =
          requireSourceFidelityAudit ?? false;
        try {
          const publication = await validateGraderWorkspaceForPublish({
            rootDir,
            summaryPath: resolvedSummaryPath,
            sheetPath: resolvedSheetPath,
            requireSourceFidelityAudit: resolvedRequireSourceFidelityAudit,
            onWorkspaceFileChanged: (filePath) => {
              workspace.scheduleUpdate(filePath);
            },
          });
          return {
            status: "ok",
            summaryPath: publication.summaryPath,
            sheetPath: publication.sheetPath,
            awardedMarks: publication.totals.awardedMarks,
            maxMarks: publication.totals.maxMarks,
            requireSourceFidelityAudit: resolvedRequireSourceFidelityAudit,
          };
        } catch (error) {
          const errorText = errorAsString(error);
          const nextAction =
            /section "[^"]+" (?:theory|infoBox) contains a named figure\/table or linked crop/iu.test(
              errorText,
            ) ||
            /workflow or paraphrase wording/iu.test(errorText)
              ? "Rewrite grader/output/sheet.json first. Move figures/tables/crop links out of section.theory/infoBox into the exact question or group prompt, remove source-paper/workflow placeholder phrases, then call validate_grader_artifacts again. Do not crop, crop-validate, or run source-fidelity audit until this sheet JSON placement issue is fixed."
              : "Fix the named artifact or guard issue, then call validate_grader_artifacts again before source-fidelity audit or publish.";
          return {
            status: "needs_fix",
            summaryPath: resolvedSummaryPath,
            sheetPath: resolvedSheetPath,
            requireSourceFidelityAudit: resolvedRequireSourceFidelityAudit,
            error: errorText,
            nextAction,
          };
        }
      },
    }),
    score_answers_with_fresh_agent: tool({
      description: [
        "Ask a fresh-context grading agent to score one bounded root question or short question range from already-extracted source/student/mark-scheme excerpts.",
        "Use this in handwritten-grading mode after transcription, source references, and sheet-plan exist, especially when a paper has many answer leaves or more than one root question.",
        "Call one instance per root question or small contiguous range. The fresh agent scores only the supplied excerpt and writes a compact JSON result; this tool also returns the per-question results inline so the main agent can assemble sheet.json without rereading every scoring file. The main agent still assembles sheet.json, run-summary.json, source-fidelity audit, and publish_sheet.",
      ].join("\n"),
      inputSchema: z
        .object({
          scope: z.string().trim().min(1),
          worksheetIds: z.array(z.string().trim().min(1)).min(1).max(30),
          sourceMarkdown: z.string().trim().min(1),
          markSchemeMarkdown: z.string().trim().min(1),
          studentAnswersMarkdown: z.string().trim().min(1),
          notes: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          outputPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({
        scope,
        worksheetIds,
        sourceMarkdown,
        markSchemeMarkdown,
        studentAnswersMarkdown,
        notes,
        outputPath,
      }) => {
        const resolvedOutputPath =
          outputPath ??
          `grader/output/scoring/${sanitizePdfImageFilenamePrefix(scope)}.json`;
        const sourceExcerptIssues =
          collectSourceTranscriptionIntegrityIssues(sourceMarkdown);
        if (sourceExcerptIssues.length > 0) {
          return {
            status: "blocked_source_excerpt_invalid",
            blockedTool: "score_answers_with_fresh_agent",
            scope,
            outputPath: resolvedOutputPath,
            nextAction: `${sourceExcerptIssues[0] ?? "The scoring source excerpt is not source-faithful"}. Rewrite grader/output/transcription.md and grader/output/sheet-plan.md from the printed source, then call score_answers_with_fresh_agent with the exact source excerpt, not a figure/table/options summary.`,
          };
        }
        const prompt = [
          "You are a bounded Spark grading subagent.",
          "Score only the supplied scope. Do not infer missing source text from memory, do not rewrite the worksheet, do not assemble sheet JSON, and do not grade items outside worksheetIds.",
          "Use the official mark scheme excerpt as the scoring authority. If evidence is ambiguous, set status to teacher-review and put the short uncertainty in note/evidence or the top-level uncertainties array. Do not add per-question fields beyond the exact shape.",
          "Accept mathematically equivalent forms and methods when the supplied work shows the same value or relationship, such as 1/2 for 0.5, equivalent rearrangements, or equivalent significant figures unless the mark scheme explicitly requires one form.",
          "Inline notes must be short gap-closing cues for the learner. Do not reveal a full model answer, full mark scheme, final corrected sentence, or complete method in the note.",
          "For incorrect or partial items, include modelAnswer as a concise answer or method from the supplied source and mark scheme. The main agent uses this field for requested model-answer/reference sections, so do not leave it to a later derivation pass.",
          "Use status correct only when got equals total. Use incorrect for partial, blank, or wrong answers.",
          "",
          `Scope: ${scope}`,
          `Worksheet ids to score: ${worksheetIds.join(", ")}`,
          notes ? ["Notes:", notes].join("\n") : "",
          "",
          "Source excerpt:",
          sourceMarkdown,
          "",
          "Student answer evidence:",
          studentAnswersMarkdown,
          "",
          "Official mark scheme excerpt:",
          markSchemeMarkdown,
          "",
          "Return JSON only with this exact shape:",
          "{",
          '  "scope": "same scope string",',
          '  "totals": { "got": 0, "total": 0 },',
          '  "questions": [',
          '    { "id": "worksheet id", "status": "correct|incorrect|teacher-review", "score": { "got": 0, "total": 0 }, "note": "short cue or empty", "replyPlaceholder": "optional focused repair prompt", "modelAnswer": "optional concise model answer for incorrect or partial items", "evidence": "short evidence basis" }',
          "  ],",
          '  "uncertainties": []',
          "}",
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n");

        progress?.log(`fresh grading batch: ${scope}`);
        const thinkingLevel = resolveSparkAgentThinkingLevel(
          DEFAULT_AGENT_MODEL_ID,
        );
        const result = await generateText({
          model: DEFAULT_AGENT_MODEL_ID,
          input: buildSingleUserInput([
            {
              type: "text",
              text: [
                "You are a bounded grading reviewer. Return one JSON object only. Do not call tools.",
                "",
                prompt,
              ].join("\n"),
            },
          ]),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
        recordLlmTextResult({
          progress,
          modelId: DEFAULT_AGENT_MODEL_ID,
          result,
        });
        onToolLlmCost?.("generate_text", result.costUsd);

        let parsedReview: z.infer<typeof freshGradingBatchResultSchema>;
        try {
          parsedReview = freshGradingBatchResultSchema.parse(
            parseJsonFromLlmText(result.text),
          );
        } catch (error) {
          throw new Error(
            `score_answers_with_fresh_agent returned invalid grading JSON: ${errorAsString(error)}`,
          );
        }

        const expectedIds = new Set(worksheetIds);
        const unexpectedIds = parsedReview.questions
          .map((question) => question.id)
          .filter((id) => !expectedIds.has(id));
        if (unexpectedIds.length > 0) {
          throw new Error(
            `score_answers_with_fresh_agent returned ids outside worksheetIds: ${unexpectedIds.join(", ")}`,
          );
        }
        const returnedIds = new Set(parsedReview.questions.map((question) => question.id));
        const missingIds = worksheetIds.filter((id) => !returnedIds.has(id));
        if (missingIds.length > 0) {
          throw new Error(
            `score_answers_with_fresh_agent omitted worksheetIds: ${missingIds.join(", ")}`,
          );
        }
        const duplicateIds = parsedReview.questions
          .map((question) => question.id)
          .filter((id, index, ids) => ids.indexOf(id) !== index);
        if (duplicateIds.length > 0) {
          throw new Error(
            `score_answers_with_fresh_agent returned duplicate worksheetIds: ${[...new Set(duplicateIds)].join(", ")}`,
          );
        }
        const questionTotals = parsedReview.questions.reduce(
          (totals, question) => ({
            got: totals.got + question.score.got,
            total: totals.total + question.score.total,
          }),
          { got: 0, total: 0 },
        );
        const normalizedTotalsFromQuestions =
          parsedReview.totals.got !== questionTotals.got ||
          parsedReview.totals.total !== questionTotals.total;

        const normalizedReview = {
          ...parsedReview,
          scope,
          totals: questionTotals,
        };
        const absoluteOutputPath = resolveWorkspacePath(
          rootDir,
          resolvedOutputPath,
        );
        await ensureDir(path.dirname(absoluteOutputPath));
        await writeFile(
          absoluteOutputPath,
          JSON.stringify(normalizedReview, null, 2).concat("\n"),
          { encoding: "utf8" },
        );
        workspace.scheduleUpdate(resolvedOutputPath);

        return {
          status: "written",
          scope,
          outputPath: resolvedOutputPath,
          questionCount: normalizedReview.questions.length,
          totals: normalizedReview.totals,
          questions: normalizedReview.questions,
          uncertainties: normalizedReview.uncertainties,
          ...(normalizedTotalsFromQuestions
            ? {
                normalizedTotalsFromQuestions: true,
                originalTotals: parsedReview.totals,
              }
            : {}),
          nextAction:
            "Use the returned questions array directly when assembling review.questions, and use any modelAnswer fields for requested model-answer/reference text. If sheet-plan names final visual asset paths that are not yet written, create only those exact guarded grader/output/assets/... paths now with crop_image/fullImage; do not create raw/candidate/draft/temp copies, and do not validate or inspect crops yet. Then write sheet.json and run-summary.json. Put every figure/table crop or Markdown table in the exact question/group prompt, never in section.theory.",
          modelId: DEFAULT_AGENT_MODEL_ID,
          costUsd: result.costUsd,
        };
      },
    }),
    review_run_progress_with_fresh_agent: tool({
      description: [
        "Ask a fresh-context introspection agent to review this run's completed tool trace and decide whether the current workflow is still productive.",
        "Use this when repeated crop/validation loops, repeated extraction attempts, recurring publish errors, budget warnings, or confusing source-document decisions suggest the run may be on the wrong path.",
        "This tool does not grade, transcribe, crop, or publish. It reads only sanitized completed-call logs and returns a continue/switch/stop recommendation with a concrete next action.",
      ].join("\n"),
      inputSchema: z
        .object({
          currentGoal: z.string().trim().min(1),
          currentStep: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          concern: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          maxRecentToolCalls: z.preprocess(
            parseOptionalNumber,
            z.number().int().min(10).max(80).optional(),
          ),
        })
        .strict(),
      execute: async ({
        currentGoal,
        currentStep,
        concern,
        maxRecentToolCalls,
      }) => {
        const snapshot = await buildRunProgressSnapshot({
          maxRecentToolCalls: maxRecentToolCalls ?? 40,
        });
        const reviewPrompt = [
          "You are a fresh-context Spark grader run introspection agent.",
          "Review the completed tool-call trace snapshot and decide if the main agent should continue, switch strategy, or stop and report a blocking workflow issue.",
          "",
          "Important boundaries:",
          "- Do not grade the student's work, transcribe files, assemble JSON, or decide final marks.",
          "- Do not impose a fixed wall-clock time limit. Base the decision on wrong-path signals in the trace.",
          "- Treat repeated same-output crop attempts, repeated crop-review failures, budget warnings, full-page fallback pressure, repeated extraction of the same source, and recurring publish errors as wrong-path signals.",
          "- For PDF visual extraction, prefer deterministic embedded-image extraction or rendered-page/grid workflows over endless manual coordinate guessing.",
          "- If the remaining issue is only minor duplicate caption text with complete expected visual content, recommend continuing instead of cosmetic recropping.",
          "",
          `Current goal: ${currentGoal}`,
          currentStep ? `Current step: ${currentStep}` : "",
          concern ? `Operator/agent concern: ${concern}` : "",
          "",
          "Trace snapshot JSON:",
          JSON.stringify(snapshot, null, 2),
          "",
          "Return JSON only with exactly these keys:",
          "{",
          '  "decision": "continue" | "switch_strategy" | "stop_and_report",',
          '  "confidence": 0.0,',
          '  "wrongPathSignals": ["short signal"],',
          '  "recommendedNextAction": "one concrete next action",',
          '  "rationale": "brief explanation"',
          "}",
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n");

        progress?.log("fresh run-progress review");
        const thinkingLevel = resolveSparkAgentThinkingLevel(
          DEFAULT_AGENT_MODEL_ID,
        );
        const result = await generateText({
          model: DEFAULT_AGENT_MODEL_ID,
          input: buildSingleUserInput([
            {
              type: "text",
              text: [
                "You are a bounded introspection reviewer. Return one JSON object only. Do not call tools.",
                "",
                reviewPrompt,
              ].join("\n"),
            },
          ]),
          ...(thinkingLevel ? { thinkingLevel } : {}),
        });
        recordLlmTextResult({
          progress,
          modelId: DEFAULT_AGENT_MODEL_ID,
          result,
        });
        onToolLlmCost?.("generate_text", result.costUsd);

        let parsedReview: z.infer<typeof runProgressReviewSchema> | null = null;
        try {
          parsedReview = runProgressReviewSchema.parse(
            parseJsonFromLlmText(result.text),
          );
        } catch {
          parsedReview = null;
        }

        return {
          status: parsedReview === null ? "reviewed_raw" : "reviewed",
          modelId: DEFAULT_AGENT_MODEL_ID,
          costUsd: result.costUsd,
          currentGoal,
          ...(currentStep ? { currentStep } : {}),
          ...(concern ? { concern } : {}),
          ...(parsedReview ? { review: parsedReview } : {}),
          rawText: result.text.trim(),
          snapshotSummary: {
            toolCallCount: snapshot.toolCallCount,
            toolCounts: snapshot.toolCounts,
            repeatedCropOutputs: snapshot.repeatedCropOutputs,
          },
        };
      },
    }),
    propose_crop_bbox_with_fresh_agent: tool({
      description: [
        "Ask a fresh-context visual agent to propose one rectangular crop bbox for one target exam figure.",
        "Use this when a figure crop is clipped, noisy, or coordinate selection is uncertain.",
        "The fresh agent follows the rectangular workflow: inspect the poor crop if provided, inspect the full source page and coordinate-grid overlays with view_image, choose badCrop only if it contains the whole figure, otherwise choose fullPage, and return JSON only.",
        "This tool does not write an image. Apply the returned bbox with crop_image using cropBasePath as sourcePath and bboxPixels as bboxPixels, then validate the final crop with validate_crop_with_fresh_agent.",
      ].join("\n"),
      inputSchema: z
        .object({
          targetLabel: z.string().trim().min(1),
          questionContext: z.string().trim().min(1),
          fullPagePath: z.string().trim().min(1),
          fullPageGridPath: z.string().trim().min(1),
          badCropPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          badCropGridPath: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
          constraints: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({
        targetLabel,
        questionContext,
        fullPagePath,
        fullPageGridPath,
        badCropPath,
        badCropGridPath,
        constraints,
      }) => {
        const readImageInfo = async (workspacePath: string) => {
          const resolved = resolveWorkspacePath(rootDir, workspacePath);
          await stat(resolved);
          const bytes = await readFile(resolved);
          const metadata = await getSharp()(bytes).metadata();
          if (
            typeof metadata.width !== "number" ||
            typeof metadata.height !== "number" ||
            metadata.width <= 0 ||
            metadata.height <= 0
          ) {
            throw new Error(
              `propose_crop_bbox_with_fresh_agent could not read image dimensions for "${workspacePath}".`,
            );
          }
          return {
            path: workspacePath,
            width: metadata.width,
            height: metadata.height,
          };
        };

        const fullPageInfo = await readImageInfo(fullPagePath.trim());
        await readImageInfo(fullPageGridPath.trim());
        const badCropInfo =
          badCropPath !== undefined ? await readImageInfo(badCropPath) : null;
        if (badCropGridPath !== undefined) {
          await readImageInfo(badCropGridPath);
        }

        const filesystemToolConfig = buildSparkAgentFilesystemToolConfig({
          workspace,
          rootDir,
        });
        const filesystemTools = createCodexFilesystemToolSet(
          filesystemToolConfig.options,
        );
        const viewImageTool = filesystemTools.view_image;
        if (
          !viewImageTool ||
          typeof viewImageTool !== "object" ||
          !("execute" in viewImageTool) ||
          typeof (viewImageTool as { execute?: unknown }).execute !== "function"
        ) {
          throw new Error(
            "propose_crop_bbox_with_fresh_agent requires view_image.",
          );
        }

        const badCropBlock =
          badCropInfo !== null
            ? [
                "Provided poor crop:",
                `- badCropPath: ${badCropInfo.path}`,
                `- badCrop dimensions: ${badCropInfo.width.toString()} x ${badCropInfo.height.toString()} px`,
                badCropGridPath
                  ? `- badCropGridPath: ${badCropGridPath}`
                  : "- badCropGridPath: not provided",
              ].join("\n")
            : "Provided poor crop: none. Use the full source page as cropBase.";

        const planningPrompt = [
          "You are isolating exam figures as rectangular image crops. Do not do mask segmentation. The goal is to produce one clean rectangular crop per target figure.",
          "",
          "General workflow:",
          "1. Start from the provided poorly cropped image if it contains the whole figure. Use the full source page only if the poor crop clips part of the figure.",
          "2. Inspect both the original image and the coordinate-grid overlay with view_image.",
          "3. Choose a pixel bounding box in the coordinate space of the selected crop base.",
          "4. Prefer a small safe white margin over any clipping.",
          "5. Reject crops that include surrounding question text, mark text, answer lines, page borders, next-question content, or standalone Figure/Table captions already rendered by the worksheet. Keep only captions that are embedded in the visual and cannot be removed without clipping required content.",
          "6. Return JSON only with:",
          '{ "cropBase": "badCrop" | "fullPage", "bbox": { "left": number, "top": number, "right": number, "bottom": number }, "reasoning": "brief edge-by-edge explanation", "risks": [] }',
          "",
          "Coordinate convention:",
          "- left, top, right, bottom are pixel coordinates.",
          "- Origin is top-left.",
          "- right and bottom are exclusive crop boundaries.",
          "",
          `Target figure: ${targetLabel}`,
          "",
          "Question context:",
          questionContext,
          "",
          constraints
            ? ["Additional crop constraints:", constraints].join("\n")
            : "",
          "",
          badCropBlock,
          "",
          "Full source page:",
          `- fullPagePath: ${fullPageInfo.path}`,
          `- fullPage dimensions: ${fullPageInfo.width.toString()} x ${fullPageInfo.height.toString()} px`,
          `- fullPageGridPath: ${fullPageGridPath}`,
          "",
          "You must call view_image on the full page and full-page grid. If a poor crop and poor-crop grid are provided, call view_image on those too before returning JSON.",
          "Return only the JSON object. Do not include Markdown, code fences, prose before/after JSON, or multiple alternatives.",
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n");

        progress?.log(`fresh crop bbox proposal: ${targetLabel}`);
        const result = await runAgentLoop({
          model: DEFAULT_AGENT_MODEL_ID,
          input: planningPrompt,
          instructions:
            "You propose exactly one rectangular bbox for one target crop. Always call view_image on the provided image/grid paths before returning the final JSON object.",
          tools: {
            view_image: viewImageTool,
          },
          maxSteps: 8,
          thinkingLevel: resolveSparkAgentThinkingLevel(DEFAULT_AGENT_MODEL_ID),
          subagents: false,
        });
        onToolLlmCost?.("generate_text", result.totalCostUsd);
        const usedViewImageCount = result.steps.reduce((count, step) => {
          return (
            count +
            step.toolCalls.filter((call) => call.toolName === "view_image")
              .length
          );
        }, 0);
        if (usedViewImageCount === 0) {
          throw new Error(
            "propose_crop_bbox_with_fresh_agent failed: the fresh crop-bbox agent returned without calling view_image.",
          );
        }

        let parsedRaw: unknown;
        try {
          parsedRaw = parseJsonFromLlmText(result.text);
        } catch (error) {
          throw new Error(
            `propose_crop_bbox_with_fresh_agent returned invalid JSON: ${errorAsString(error)}`,
          );
        }
        const proposal = cropBboxProposalSchema.parse(parsedRaw);
        if (proposal.cropBase === "badCrop" && badCropInfo === null) {
          throw new Error(
            "propose_crop_bbox_with_fresh_agent returned cropBase=badCrop but no badCropPath was provided.",
          );
        }
        const cropBasePath =
          proposal.cropBase === "badCrop" && badCropInfo !== null
            ? badCropInfo.path
            : fullPageInfo.path;
        const cropBaseInfo =
          proposal.cropBase === "badCrop" && badCropInfo !== null
            ? badCropInfo
            : fullPageInfo;
        if (
          proposal.bbox.right > cropBaseInfo.width ||
          proposal.bbox.bottom > cropBaseInfo.height
        ) {
          throw new Error(
            `propose_crop_bbox_with_fresh_agent returned bbox outside ${proposal.cropBase} dimensions ${cropBaseInfo.width.toString()}x${cropBaseInfo.height.toString()}.`,
          );
        }
        prePublishCropRecoveryCredits += 1;

        return {
          status: "proposed",
          targetLabel,
          cropBase: proposal.cropBase,
          cropBasePath,
          bboxPixels: proposal.bbox,
          reasoning: proposal.reasoning,
          risks: proposal.risks,
          usedViewImageCount,
          modelId: DEFAULT_AGENT_MODEL_ID,
          costUsd: result.totalCostUsd,
          rawJson: result.text.trim(),
        };
      },
    }),
    validate_crop_with_fresh_agent: tool({
      description: [
        "Validate one final worksheet figure/image crop with a fresh-context visual agent.",
        "Use this once per final linked crop before writing grader/output/crop-validation.md.",
        "Pass expectedContent with the exact printed/visible visual content that must be visible, and duplicatedTextToExclude for surrounding prompt/caption/table text rendered separately.",
        "The fresh agent must call view_image on the crop, transcribe visible text, and judge missing/clipped target content, edge contact, major duplicated text, and unrelated neighbouring content outside the official target visual.",
        "Do not use generic spawn_agent for grader intake or file summaries; use this dedicated tool only for final crop visual validation.",
      ].join("\n"),
      inputSchema: z
        .object({
          cropPath: z.string().trim().min(1),
          sourceLabel: z.string().trim().min(1),
          questionContext: z.string().trim().min(1),
          expectedContent: z.preprocess(
            (value) => parseOptionalString(value),
            z
              .string()
              .trim()
              .min(1)
              .describe(
                "Exact printed/visible visual labels, axes, option letters, table cells, annotations, or shapes that must be visible in this crop. Do not include inferred answers, mark-scheme facts, unprinted labels/headings, or prompt/caption/table text that is rendered elsewhere.",
              ),
          ),
          duplicatedTextToExclude: z.preprocess(
            (value) => parseOptionalString(value),
            z
              .string()
              .trim()
              .min(1)
              .describe(
                "Surrounding prompt, caption, table, question-number, or answer-line text that should be excluded from the crop because the worksheet renders it separately. Use `none` only when no surrounding duplicated text needs exclusion.",
              ),
          ),
        })
        .strict(),
      execute: async ({
        cropPath,
        sourceLabel,
        questionContext,
        expectedContent,
        duplicatedTextToExclude,
      }) => {
        const resolvedCropPath = cropPath.trim();
        await stat(resolveWorkspacePath(rootDir, resolvedCropPath));
        const filesystemToolConfig = buildSparkAgentFilesystemToolConfig({
          workspace,
          rootDir,
        });
        const filesystemTools = createCodexFilesystemToolSet(
          filesystemToolConfig.options,
        );
        const viewImageTool = filesystemTools.view_image;
        if (
          !viewImageTool ||
          typeof viewImageTool !== "object" ||
          !("execute" in viewImageTool) ||
          typeof (viewImageTool as { execute?: unknown }).execute !== "function"
        ) {
          throw new Error(
            "validate_crop_with_fresh_agent requires view_image.",
          );
        }

        const reviewPrompt = [
          "You are a fresh-context crop validation agent.",
          "Use the `view_image` tool on the crop path before judging it. Do not answer from text alone.",
          "Judge only source content that is actually printed or visible in the crop. Do not fail because an inferred answer, hidden context, mark-scheme fact, or unprinted label/heading is absent.",
          "If Expected visual content asks for unprinted placeholders, inferred group names, inferred answers, or labels/headings that are not visible in an otherwise complete official figure/table, do not treat that absence as missing crop content. Note the mismatch in issues and pass if the visible official target visual is complete.",
          "Be practical and judge against the explicit Expected visual content below. A pass is allowed when the official target visual is complete, has a safe margin, and contains no confusing neighbouring content outside that official figure/table/image.",
          "Fail only for blocking visual problems: missing required expected content, clipped/touching required content, wrong figure/table/option association, broken/blank image, broad page fallback, or neighbouring content outside the official target visual that would confuse the worksheet.",
          "Do not fail solely for small duplicate caption/prompt fragments, isolated Figure/Table labels, harmless scan artifacts, or extra whitespace when all Expected visual content is complete and readable. Record those as issues on a passing crop.",
          "If the crop is an extracted embedded image from an official PDF, treat related subpanels, labels, scale markings, apparatus side panels, and other content inside the same official figure/table image object as part of the target visual unless it contradicts Expected visual content.",
          "Do not fail merely because the target visual contains ink, graph gridlines, diagram outlines, arrows, labels, tick labels, option letters, or a Figure/Table label that is part of Expected visual content.",
          "Do not require broader prompt text, data tables, captions, method steps, answer lines, or mark text that are not listed under Expected visual content.",
          "Fail the crop if the target visual occupies only a small part of the frame because of large empty internal whitespace; crops should look like figures, not mostly blank placeholders.",
          "Fail the crop if any required line, shape, option, label, axis, legend, table cell, or annotation is cut off or touches the crop edge.",
          "Fail the crop if you see answer lines, page borders, separator rules, neighbouring-question text, or neighbouring visual fragments that are outside the official target visual and would confuse a learner.",
          "For text listed under Duplicated surrounding text to exclude, mark `duplicated caption/question/table text excluded: no` when it appears. Still use `pass/fail: pass` if that duplicated text is only a small caption/prompt fragment and the expected visual is complete.",
          "For diagram-option crops, every candidate label and every option diagram must be fully visible with margin; if any option outline is clipped by an edge, fail.",
          "Use `not_applicable` for duplicated text only when Duplicated surrounding text to exclude is `none` and there is no visible non-target caption/question/table text.",
          "",
          `Crop path: ${resolvedCropPath}`,
          `Source label: ${sourceLabel}`,
          "",
          "Question context:",
          questionContext,
          "",
          expectedContent
            ? ["Expected visual content:", expectedContent].join("\n")
            : "",
          duplicatedTextToExclude
            ? [
                "Duplicated surrounding text that should be excluded unless it is part of a visual label/axis/legend:",
                duplicatedTextToExclude,
              ].join("\n")
            : "",
          "",
          "Return concise Markdown with exactly these fields:",
          `- crop path: ${resolvedCropPath}`,
          `- source label: ${sourceLabel}`,
          "- fresh-context subagent checked: yes",
          "- reviewer-visible text: <transcribe all text visible in the crop, or `none`>",
          "- pass/fail: pass|fail",
          "- all question-relevant content visible: yes|no",
          "- duplicated caption/question/table text excluded: yes|no|not_applicable",
          "- unrelated neighbouring content present: yes|no",
          "- edge clipping or content touching edge present: yes|no",
          "- page border, separator line, answer line, or neighbouring-question fragment present: yes|no",
          "- issues: <none or concise list of clipping/wrong association/noisy text problems; if reviewer-visible text contains unexpected text, name it here>",
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n");

        progress?.log(
          `fresh crop review: ${sourceLabel} (${resolvedCropPath})`,
        );
        const result = await runAgentLoop({
          model: DEFAULT_AGENT_MODEL_ID,
          input: reviewPrompt,
          instructions:
            "You validate exactly one image crop. You have no broader worksheet context except the prompt. Always call view_image before giving the final validation.",
          tools: {
            view_image: viewImageTool,
          },
          maxSteps: 4,
          thinkingLevel: resolveSparkAgentThinkingLevel(DEFAULT_AGENT_MODEL_ID),
          subagents: false,
        });
        onToolLlmCost?.("generate_text", result.totalCostUsd);
        const usedViewImage = result.steps.some((step) =>
          step.toolCalls.some((call) => call.toolName === "view_image"),
        );
        if (!usedViewImage) {
          throw new Error(
            "validate_crop_with_fresh_agent failed: the fresh crop-review agent returned without calling view_image.",
          );
        }
        return {
          status: "reviewed",
          cropPath: resolvedCropPath,
          sourceLabel,
          usedViewImage,
          modelId: DEFAULT_AGENT_MODEL_ID,
          costUsd: result.totalCostUsd,
          reviewMarkdown: result.text.trim(),
        };
      },
    }),
    validate_source_fidelity_with_fresh_agent: tool({
      description: [
        "Validate source-to-sheet transfer with a fresh-context agent before publish.",
        "Use this after grader/output/transcription.md, grader/output/sheet-plan.md, and grader/output/sheet.json exist.",
        "Split long papers by source page or root question. The fresh agent checks only transfer fidelity: visible source items, verbatim wording, numbering/badges, figures/tables/layouts, and answer-evidence alignment.",
        "The tool writes a per-scope review under grader/output/source-fidelity-audits/ and refreshes grader/output/source-fidelity-audit.md before publish. If it fails, patch all blockers for that scope once and run at most one follow-up audit before escalating. Do not use this tool for grading, solving, or rewriting the worksheet.",
      ].join("\n"),
      inputSchema: z
        .object({
          sourceScope: z.string().trim().min(1),
          sourcePaths: z
            .array(z.string().trim().min(1))
            .min(
              1,
              "Pass relevant source reference markdown and/or rendered source page image paths.",
            ),
          transcriptionPath: z
            .string()
            .trim()
            .min(1)
            .default("grader/output/transcription.md"),
          sheetPlanPath: z
            .string()
            .trim()
            .min(1)
            .default("grader/output/sheet-plan.md"),
          sheetPath: z
            .string()
            .trim()
            .min(1)
            .default("grader/output/sheet.json"),
          outputPath: z
            .preprocess(
              (value) => parseOptionalString(value),
              z.string().trim().min(1).optional(),
            ),
          notes: z.preprocess(
            (value) => parseOptionalString(value),
            z.string().trim().min(1).optional(),
          ),
        })
        .strict(),
      execute: async ({
        sourceScope,
        sourcePaths,
        transcriptionPath,
        sheetPlanPath,
        sheetPath,
        outputPath,
        notes,
      }) => {
        const resolvedTranscriptionPath = transcriptionPath.trim();
        const resolvedSheetPlanPath = sheetPlanPath.trim();
        const resolvedSheetPath = sheetPath.trim();
        const aggregateOutputPath = "grader/output/source-fidelity-audit.md";
        const resolvedOutputPath =
          outputPath?.trim() ??
          `grader/output/source-fidelity-audits/${sanitizePdfImageFilenamePrefix(sourceScope)}.md`;
        await stat(resolveWorkspacePath(rootDir, resolvedTranscriptionPath));
        await stat(resolveWorkspacePath(rootDir, resolvedSheetPath));
        const sheetRaw = await readFile(
          resolveWorkspacePath(rootDir, resolvedSheetPath),
          { encoding: "utf8" },
        );
        try {
          JSON.parse(sheetRaw);
        } catch (error) {
          throw new Error(
            `Cannot run source-fidelity audit because "${resolvedSheetPath}" is invalid JSON: ${errorAsString(error)}. Call validate_grader_artifacts after fixing the JSON, then audit source fidelity.`,
          );
        }
        const sheetPlanExists =
          (await stat(
            resolveWorkspacePath(rootDir, resolvedSheetPlanPath),
          ).catch(() => null)) !== null;
        const resolvedSourcePaths = sourcePaths.map((sourcePath) =>
          sourcePath.trim(),
        );
        if (resolvedSourcePaths.length === 0) {
          throw new Error(
            "validate_source_fidelity_with_fresh_agent requires sourcePaths. Pass the relevant reference markdown, source photo, and/or rendered source page images for this scope so the fresh audit can catch omitted figures, tables, and wording.",
          );
        }
        for (const sourcePath of resolvedSourcePaths) {
          await stat(resolveWorkspacePath(rootDir, sourcePath));
        }

        const filesystemToolConfig = buildSparkAgentFilesystemToolConfig({
          workspace,
          rootDir,
        });
        const filesystemTools = createCodexFilesystemToolSet(
          filesystemToolConfig.options,
        );
        const auditTools: LlmToolSet = {};
        for (const toolName of [
          "read_file",
          "grep_files",
          "list_dir",
          "view_image",
        ] as const) {
          const candidate = filesystemTools[toolName];
          if (candidate !== undefined) {
            auditTools[toolName] = candidate;
          }
        }

        const imageSourcePaths = resolvedSourcePaths.filter((sourcePath) =>
          /\.(?:png|jpe?g|webp|gif)$/iu.test(sourcePath),
        );
        const reviewPrompt = [
          "You are a fresh-context source-fidelity validation agent.",
          "Do not grade, solve, improve, or redesign the worksheet. Only compare source material against the assembled worksheet for transfer fidelity.",
          "Read the worksheet JSON and transcription first. Read the sheet plan when present. Inspect source images with view_image when image paths are provided.",
          "For long source material, this prompt covers only the listed source scope; do not try to audit unrelated pages.",
          "",
          `Source scope: ${sourceScope}`,
          "",
          "Required files:",
          `- transcription: ${resolvedTranscriptionPath}`,
          sheetPlanExists
            ? `- sheet plan: ${resolvedSheetPlanPath}`
            : `- sheet plan: ${resolvedSheetPlanPath} (missing; record this if it affects audit confidence)`,
          `- worksheet: ${resolvedSheetPath}`,
          resolvedSourcePaths.length > 0
            ? ["Source paths:", ...resolvedSourcePaths.map((item) => `- ${item}`)].join(
                "\n",
              )
            : "Source paths: none supplied; use transcription/source audit text only.",
          imageSourcePaths.length > 0
            ? [
                "Image source paths to inspect with view_image:",
                ...imageSourcePaths.map((item) => `- ${item}`),
              ].join("\n")
            : "",
          notes ? ["Notes:", notes].join("\n") : "",
          "",
          "Audit rubric:",
          "- Every visible answered, partially answered, selected, or blank answer-bearing source item in scope is represented in sheet.json.",
          "- Source wording is verbatim apart from minimal OCR/layout cleanup; no paraphrased or invented prompt text.",
          "- Source numbering, subquestion hierarchy, badge labels, option labels, and marks match the source.",
          "- Named figures, tables, diagrams, graphs, grids, and column/stacked layouts are visible near the relevant prompt as Markdown tables, display math, or linked validated crops.",
          "- Student answer evidence is attached to the right worksheet item and not collapsed into vague placeholders.",
          "",
          "Return concise Markdown with exactly these fields:",
          "- source-fidelity audit: <short source scope>",
          "- fresh-context subagent checked: yes",
          "- pass/fail: pass|fail",
          "- visible source items represented: yes|no",
          "- verbatim wording preserved: yes|no",
          "- numbering and badges correct: yes|no",
          "- figures/tables/layouts preserved: yes|no|not_applicable",
          "- answer evidence aligned: yes|no",
          "- blocking issues: <none or concise bullets with question ids/source labels>",
        ]
          .filter((part) => part.trim().length > 0)
          .join("\n");

        progress?.log(`fresh source-fidelity audit: ${sourceScope}`);
        const result = await runAgentLoop({
          model: DEFAULT_AGENT_MODEL_ID,
          input: reviewPrompt,
          instructions:
            "You validate source-to-sheet transfer only. Read the requested files before judging. Use view_image for supplied image source paths. Do not grade or rewrite artifacts.",
          tools: auditTools,
          maxSteps: 8,
          thinkingLevel: resolveSparkAgentThinkingLevel(DEFAULT_AGENT_MODEL_ID),
          subagents: false,
        });
        onToolLlmCost?.("generate_text", result.totalCostUsd);
        const usedReadTool = result.steps.some((step) =>
          step.toolCalls.some(
            (call) =>
              call.toolName === "read_file" ||
              call.toolName === "grep_files" ||
              call.toolName === "view_image",
          ),
        );
        if (!usedReadTool) {
          throw new Error(
            "validate_source_fidelity_with_fresh_agent failed: the fresh audit agent returned without reading or viewing source/worksheet files.",
          );
        }
        const reviewMarkdown = result.text.trim();
        await ensureDir(
          path.dirname(resolveWorkspacePath(rootDir, resolvedOutputPath)),
        );
        await writeFile(
          resolveWorkspacePath(rootDir, resolvedOutputPath),
          reviewMarkdown.concat("\n"),
          { encoding: "utf8" },
        );
        workspace.scheduleUpdate(resolvedOutputPath);
        if (resolvedOutputPath !== aggregateOutputPath) {
          const auditDir = "grader/output/source-fidelity-audits";
          const absoluteAuditDir = resolveWorkspacePath(rootDir, auditDir);
          const auditEntries = await readdir(absoluteAuditDir, {
            withFileTypes: true,
          }).catch(() => []);
          const auditRecords: string[] = [];
          for (const entry of auditEntries) {
            if (!entry.isFile() || !/\.md$/iu.test(entry.name)) {
              continue;
            }
            const record = await readFile(
              path.join(absoluteAuditDir, entry.name),
              { encoding: "utf8" },
            );
            if (record.trim().length > 0) {
              auditRecords.push(record.trim());
            }
          }
          const aggregateMarkdown = [
            "# Source fidelity audits",
            "",
            ...auditRecords.map((record, index) => {
              if (index === 0) {
                return record;
              }
              return `---\n\n${record}`;
            }),
          ].join("\n\n");
          await writeFile(
            resolveWorkspacePath(rootDir, aggregateOutputPath),
            aggregateMarkdown.concat("\n"),
            { encoding: "utf8" },
          );
          workspace.scheduleUpdate(aggregateOutputPath);
        }
        const passed = hasPositiveSourceFidelityAudit(reviewMarkdown);
        const blockingIssues =
          SOURCE_FIDELITY_BLOCKING_ISSUES_FIELD_PATTERN.exec(reviewMarkdown)?.[1]
            ?.trim() ?? "";
        return {
          status: passed ? "passed" : "failed",
          sourceScope,
          usedReadTool,
          outputPath: resolvedOutputPath,
          modelId: DEFAULT_AGENT_MODEL_ID,
          costUsd: result.totalCostUsd,
          blockingIssues: blockingIssues.length > 0 ? blockingIssues : null,
          reviewMarkdown,
        };
      },
    }),
  };
  if (graderPublish) {
    const publish_sheet = tool({
      description:
        "Validate and publish the grader worksheet artifact for /spark/sheets. Requires a valid grader/output/run-summary.json plus grader/output/sheet.json. Fix validation errors coherently; if the same class of failure recurs after repair, stop and fix the workflow before rerunning.",
      terminal: true,
      inputSchema: z
        .object({
          summaryPath: z.string().trim().min(1).optional(),
          sheetPath: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ summaryPath, sheetPath }) => {
        const publication = await validateGraderWorkspaceForPublish({
          rootDir,
          summaryPath: summaryPath ?? "grader/output/run-summary.json",
          sheetPath: sheetPath ?? "grader/output/sheet.json",
          onWorkspaceFileChanged: (filePath) => {
            workspace.scheduleUpdate(filePath);
          },
        });
        await beforePublishSheet?.();

        const href = (() => {
          if (graderPublish.mode === "live") {
            return `/spark/sheets/${graderPublish.runId}`;
          }
          if (graderPublish.href) {
            return graderPublish.href;
          }
          if (graderPublish.runId) {
            return `/spark/sheets/${graderPublish.runId}`;
          }
          return "/spark/sheets";
        })();

        if (graderPublish.mode === "live") {
          await patchGraderRunStatus({
            serviceAccountJson,
            userId,
            runId: graderPublish.runId,
            updates: {
              updatedAt: new Date(),
              ...(publication.paper ? { paper: publication.paper } : {}),
              presentation: publication.presentation,
              totals: publication.totals,
              sheet: publication.sheet,
              summaryPath: publication.summaryPath,
              sheetPath: publication.sheetPath,
              ...(publication.resultSummary
                ? { resultSummary: publication.resultSummary }
                : {}),
            },
          });
        }

        await onPublishSheet?.(publication);
        graderPublishCompleted = true;

        return {
          status: "published" as const,
          mode: graderPublish.mode,
          href,
          presentationTitle: publication.presentation.title,
          awardedMarks: publication.totals.awardedMarks,
          maxMarks: publication.totals.maxMarks,
        };
      },
    });
    tools.publish_sheet = publish_sheet;
    delete (tools as Record<string, unknown>).generate_json;
    delete (tools as Record<string, unknown>).validate_json;
    delete (tools as Record<string, unknown>).validate_schema;
  } else {
    delete (tools as Record<string, unknown>).validate_grader_artifacts;
  }
  if (sheetDraftPublish) {
    const publish_sheet_draft = tool({
      description:
        "Validate and publish the worksheet draft artifact for /spark/sheets. Requires a valid sheet/output/run-summary.json plus sheet/output/draft.json. Fix validation errors coherently; if the same class of failure recurs after repair, stop and fix the workflow before rerunning.",
      terminal: true,
      inputSchema: z
        .object({
          summaryPath: z.string().trim().min(1).optional(),
          sheetPath: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ summaryPath, sheetPath }) => {
        const publication = await validateSheetDraftWorkspaceForPublish({
          rootDir,
          summaryPath: summaryPath ?? "sheet/output/run-summary.json",
          sheetPath: sheetPath ?? "sheet/output/draft.json",
          onWorkspaceFileChanged: (filePath) => {
            workspace.scheduleUpdate(filePath);
          },
        });
        await beforePublishSheetDraft?.();

        const href = (() => {
          if (sheetDraftPublish.mode === "live") {
            return `/spark/sheets/${sheetDraftPublish.runId}`;
          }
          if (sheetDraftPublish.href) {
            return sheetDraftPublish.href;
          }
          if (sheetDraftPublish.runId) {
            return `/spark/sheets/${sheetDraftPublish.runId}`;
          }
          return "/spark/sheets";
        })();

        if (sheetDraftPublish.mode === "live") {
          await patchGraderRunStatus({
            serviceAccountJson,
            userId,
            runId: sheetDraftPublish.runId,
            updates: {
              status: "done",
              sheetPhase: "solving",
              updatedAt: new Date(),
              presentation: publication.presentation,
              sheet: publication.sheet,
              summaryPath: publication.summaryPath,
              sheetPath: publication.sheetPath,
            },
          });
        }

        await onPublishSheetDraft?.(publication);

        return {
          status: "published" as const,
          mode: sheetDraftPublish.mode,
          href,
          presentationTitle: publication.presentation.title,
        };
      },
    });
    tools.publish_sheet_draft = publish_sheet_draft;
  }
  if (!shouldAllowPythonExec) {
    delete (tools as Record<string, unknown>).python_exec;
  }
  return applyGraderPublishCriticalGate(tools);
}

export function buildSparkAgentTools(options: {
  workspace: SparkAgentWorkspace;
  rootDir: string;
  userId: string;
  serviceAccountJson: string;
  progress?: JobProgressReporter;
  onToolLlmCost?: (toolName: ToolLlmCostName, costUsd: number) => void;
  enforceLessonPipeline?: boolean;
  allowPythonExec?: boolean;
  graderPublish?: GraderPublishConfig;
  sheetDraftPublish?: SheetDraftPublishConfig;
  beforePublishSheet?: () => Promise<void>;
  onPublishSheet?: (
    publication: PublishedGraderSheetArtifacts,
  ) => Promise<void> | void;
  beforePublishSheetDraft?: () => Promise<void>;
  onPublishSheetDraft?: (
    publication: PublishedSheetDraftArtifacts,
  ) => Promise<void> | void;
  debug?: LlmDebugOptions;
  extractTextDebugRootDir?: string;
}): LlmToolSet {
  return stripDeprecatedPdfReadTools(buildAgentTools(options));
}

export async function runSparkLessonAgentLocal(options: {
  rootDir: string;
  userId: string;
  prompt: string;
  modelId?: LlmTextModelId;
  maxSteps?: number;
  progress?: JobProgressReporter;
  debug?: LlmDebugOptions;
}): Promise<{
  readonly toolLoopResult: LlmToolLoopResult;
  readonly publishResult: {
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
  readonly doneSummary: string | null;
}> {
  const modelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const maxSteps = options.maxSteps ?? DEFAULT_LESSON_MAX_STEPS;
  const thinkingLevel = resolveSparkAgentThinkingLevel(modelId);
  const progress = options.progress;

  const workspace: SparkAgentWorkspace = {
    scheduleUpdate: () => {},
    deleteFile: async (inputPath) => {
      void inputPath;
    },
    moveFile: async (from, to) => {
      void from;
      void to;
    },
  };

  const baseTools = stripDeprecatedPdfReadTools(
    buildAgentTools({
      workspace,
      rootDir: options.rootDir,
      userId: options.userId,
      serviceAccountJson: "{}",
      progress,
      enforceLessonPipeline: true,
      debug: options.debug,
      extractTextDebugRootDir: resolveSparkAgentToolCallsDir(options.rootDir),
    }),
  );

  type PublishLessonToolInput = {
    sessionId: string;
    sessionPath?: string;
    briefPath?: string;
    includeStory?: boolean;
    includeCoding?: boolean;
  };

  type LocalPublishLessonResult = {
    status: "published";
    sessionId: string;
    includeStory: boolean | null;
    includeCoding: boolean | null;
    quizCount: number;
    problemCount: number;
    mediaCount: number;
    href: string;
    mode: "mock";
  };

  let publishResult: LocalPublishLessonResult | null = null;
  const publishLessonInputSchema: z.ZodType<PublishLessonToolInput> =
    "inputSchema" in baseTools.publish_lesson
      ? (baseTools.publish_lesson
          .inputSchema as z.ZodType<PublishLessonToolInput>)
      : z
          .object({
            sessionId: z.string().trim().min(1),
            sessionPath: z.string().trim().min(1).optional(),
            briefPath: z.string().trim().min(1).optional(),
            includeStory: z.boolean().optional(),
            includeCoding: z.boolean().optional(),
          })
          .strict();
  const publish_lesson = tool({
    description:
      "Mock publish_lesson for local runs. Validates workspace JSON and returns counts but does not write Firestore.",
    inputSchema: publishLessonInputSchema,
    execute: async (input: PublishLessonToolInput) => {
      const resolvedSessionPath =
        input.sessionPath ?? "lesson/output/session.json";
      const resolvedBriefPath = input.briefPath ?? "brief.md";
      const bundle = await validateLessonWorkspaceForPublish({
        rootDir: options.rootDir,
        sessionId: input.sessionId,
        sessionPath: resolvedSessionPath,
        briefPath: resolvedBriefPath,
        createdAt: new Date(),
        includeStory: input.includeStory,
        includeCoding: input.includeCoding,
        enforceLessonPipeline: true,
      });
      const result: LocalPublishLessonResult = {
        status: "published",
        sessionId: input.sessionId,
        includeStory: input.includeStory ?? null,
        includeCoding: input.includeCoding ?? null,
        quizCount: bundle.quizzes.length,
        problemCount: bundle.problems.length,
        mediaCount: bundle.media.length,
        href: `/spark/lesson/${input.sessionId}`,
        mode: "mock",
      };
      publishResult = result;
      return result;
    },
  });

  let doneSummary: string | null = null;
  let doneCalled = false;
  const done = tool({
    description:
      "Mark the local agent run as complete. Stores a short summary for the caller.",
    inputSchema: z
      .object({
        summary: z.string().trim().min(1).optional(),
      })
      .strict(),
    execute: ({ summary }) => {
      doneCalled = true;
      doneSummary = summary ?? null;
      return { status: "done", summary: summary ?? null };
    },
  });

  const toolLoopResult = await runAgentLoop({
    model: modelId,
    instructions: buildSparkAgentSystemPrompt(),
    input: options.prompt,
    filesystemTool: buildSparkAgentFilesystemToolConfig({
      workspace,
      rootDir: options.rootDir,
    }),
    tools: {
      ...baseTools,
      publish_lesson,
      done,
    },
    modelTools: [{ type: "web-search", mode: "live" }],
    maxSteps,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    logging: {
      workspaceDir: resolveSparkAgentLogsDir(options.rootDir),
      callLogsDir: "llm_calls",
      mirrorToConsole: false,
    },
  });

  if (!doneCalled) {
    throw new Error("Lesson agent completed without calling done().");
  }

  return {
    toolLoopResult,
    publishResult,
    doneSummary,
  };
}

async function updateAgentStatus(options: {
  serviceAccountJson: string;
  agentDocPath: string;
  status: AgentStatus;
  resultSummary?: string;
  error?: string;
}): Promise<void> {
  const now = new Date();
  const snapshot = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: options.agentDocPath,
  });
  const existingTimeline = z
    .array(SparkAgentStateTimelineSchema)
    .catch([])
    .parse(snapshot.data?.statesTimeline ?? []);
  const nextTimeline: SparkAgentStateTimeline[] = [
    ...existingTimeline,
    { state: options.status, timestamp: now },
  ];
  const payload: Record<string, unknown> = {
    status: options.status,
    updatedAt: now,
    statesTimeline: nextTimeline,
  };
  if (typeof options.resultSummary === "string") {
    payload.resultSummary = options.resultSummary;
  }
  if (typeof options.error === "string") {
    payload.error = options.error;
  }
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: options.agentDocPath,
    updates: payload,
  });
}

export async function runSparkAgentTask(
  options: AgentRunOptions,
): Promise<void> {
  loadAgentEnv();
  configureSparkLlmTelemetryFromEnv();
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!serviceAccountJson || serviceAccountJson.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
  const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;
  const agentDocPath = `users/${options.userId}/agents/${options.agentId}`;

  const toolLoopModelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const statsTracker = new AgentRunStatsTracker({
    primaryModelId: toolLoopModelId,
  });
  let generateTextCostUsd = 0;
  let generateJsonCostUsd = 0;
  let extractTextCostUsd = 0;
  let pdfToolCostUsd = 0;

  let prompt = "";
  let logSync: AgentLogSync | undefined;
  let workspaceRoot: string | undefined;
  let cleanupWorkspaceRoot = true;
  let workspaceSync: WorkspaceSync | undefined;
  let sheetRunId: string | null = null;
  let sheetDraftAnswersPath = "sheet/state/answers.json";
  let graderRunId: string | null = null;
  let graderSummaryPath = "grader/output/run-summary.json";
  let graderSheetPath = "grader/output/sheet.json";
  let tutorSessionId: string | null = null;
  let tutorAction: "initial" | "reply" | "hint" | null = null;
  let tutorQuestionId: string | null = null;
  let tutorTurnFilePath: string | null = null;
  let tutorStudentText: string | null = null;
  let tutorConfidence: string | null = null;
  let tutorHintLevel: string | null = null;
  let tutorSessionTitle = "Tutor session";
  let tutorSourceLabel = "graded problem";
  let tutorFocusLabel: string | null = null;
  let tutorSnapshot: TutorWorkspaceSnapshot | null = null;
  let publishedSheetDraft: PublishedSheetDraftArtifacts | null = null;
  let publishedGraderSheet: PublishedGraderSheetArtifacts | null = null;
  let disableAutoGapsFinder = false;
  let agentMetricType: SparkAgentMetricType = "chat";
  let agentMetricStatus: "ok" | "error" | "stopped" = "error";
  const monitoringJob = "spark-task-runner";
  const agentMetricTaskIdPrefix = `agent-${options.agentId}`;
  let processUsageMonitor: AgentProcessUsageMonitor | undefined;

  let stopRequested = false;
  let stopPollTimer: NodeJS.Timeout | undefined;
  let stopPollInFlight: Promise<void> | undefined;

  let doneCalled = false;
  let streamedAssistantText = "";
  let streamedThoughtsText = "";
  let recoverTutorQuestionAfterFailure:
    | ((input: {
        assistantReplyMarkdown: string;
        composerPlaceholder: string;
        sessionError?: string;
      }) => Promise<void>)
    | null = null;

  const stopStopPolling = async (): Promise<void> => {
    if (stopPollTimer) {
      clearInterval(stopPollTimer);
      stopPollTimer = undefined;
    }
    await stopPollInFlight?.catch(() => undefined);
  };

  try {
    const agentSnap = await getFirestoreDocument({
      serviceAccountJson,
      documentPath: agentDocPath,
    });
    if (!agentSnap.exists || !agentSnap.data) {
      console.warn(`[spark-agent:${options.agentId}] Agent not found`);
      return;
    }

    const agentData = agentSnap.data ?? {};
    disableAutoGapsFinder =
      agentData.disableAutoGapsFinder === true ||
      isTruthyEnv(process.env.SPARK_DISABLE_AUTO_GAPS_FINDER);
    agentMetricType = resolveSparkAgentMetricType(agentData);
    const rawSheetRunId =
      typeof agentData.sheetRunId === "string"
        ? agentData.sheetRunId.trim()
        : "";
    if (rawSheetRunId.length > 0) {
      sheetRunId = rawSheetRunId;
    }
    const rawSheetDraftAnswersPath =
      typeof agentData.sheetDraftAnswersPath === "string"
        ? agentData.sheetDraftAnswersPath.trim()
        : "";
    if (rawSheetDraftAnswersPath.length > 0) {
      sheetDraftAnswersPath = rawSheetDraftAnswersPath;
    }
    const rawGraderRunId =
      typeof agentData.graderRunId === "string"
        ? agentData.graderRunId.trim()
        : "";
    if (rawGraderRunId.length > 0) {
      graderRunId = rawGraderRunId;
    }
    const rawSummaryPath =
      typeof agentData.graderSummaryPath === "string"
        ? agentData.graderSummaryPath.trim()
        : "";
    if (rawSummaryPath.length > 0) {
      graderSummaryPath = rawSummaryPath;
    }
    const rawSheetPath =
      typeof agentData.graderSheetPath === "string"
        ? agentData.graderSheetPath.trim()
        : "";
    if (rawSheetPath.length > 0) {
      graderSheetPath = rawSheetPath;
    }
    const rawTutorSessionId =
      typeof agentData.tutorSessionId === "string"
        ? agentData.tutorSessionId.trim()
        : "";
    if (rawTutorSessionId.length > 0) {
      tutorSessionId = rawTutorSessionId;
    }
    const rawTutorAction =
      typeof agentData.tutorAction === "string"
        ? agentData.tutorAction.trim()
        : "";
    if (
      rawTutorAction === "initial" ||
      rawTutorAction === "reply" ||
      rawTutorAction === "hint"
    ) {
      tutorAction = rawTutorAction;
    }
    tutorQuestionId =
      typeof agentData.tutorQuestionId === "string" &&
      agentData.tutorQuestionId.trim().length > 0
        ? agentData.tutorQuestionId.trim()
        : null;
    tutorTurnFilePath =
      typeof agentData.tutorTurnFilePath === "string" &&
      agentData.tutorTurnFilePath.trim().length > 0
        ? agentData.tutorTurnFilePath.trim()
        : null;
    tutorStudentText =
      typeof agentData.tutorStudentText === "string" &&
      agentData.tutorStudentText.trim().length > 0
        ? agentData.tutorStudentText.trim()
        : null;
    tutorConfidence =
      typeof agentData.tutorConfidence === "string" &&
      agentData.tutorConfidence.trim().length > 0
        ? agentData.tutorConfidence.trim()
        : null;
    tutorHintLevel =
      typeof agentData.tutorHintLevel === "string" &&
      agentData.tutorHintLevel.trim().length > 0
        ? agentData.tutorHintLevel.trim()
        : null;
    const currentStatus =
      typeof agentData.status === "string" ? agentData.status.trim() : "";
    if (
      currentStatus === "done" ||
      currentStatus === "failed" ||
      currentStatus === "stopped"
    ) {
      console.log(
        `[spark-agent:${options.agentId}] skip run; status=${currentStatus}`,
      );
      return;
    }

    if (agentData.stop_requested === true) {
      console.log(`[spark-agent:${options.agentId}] stop_requested pre-run`);
      await updateAgentStatus({
        serviceAccountJson,
        agentDocPath,
        status: "stopped",
        resultSummary: "Stopped by user.",
      });
      if (sheetRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: sheetRunId,
          updates: {
            status: "stopped",
            updatedAt: new Date(),
            completedAt: new Date(),
            resultSummary: "Stopped by user before execution.",
          },
        }).catch(() => undefined);
      }
      if (graderRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: graderRunId,
          updates: {
            status: "stopped",
            updatedAt: new Date(),
            completedAt: new Date(),
            resultSummary: "Stopped by user before execution.",
          },
        }).catch(() => undefined);
      }
      return;
    }

    prompt =
      typeof agentData.prompt === "string" && agentData.prompt.trim().length > 0
        ? agentData.prompt.trim()
        : "";
    if (!prompt) {
      await updateAgentStatus({
        serviceAccountJson,
        agentDocPath,
        status: "failed",
        error: "Agent prompt is missing.",
      });
      if (sheetRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: sheetRunId,
          updates: {
            status: "failed",
            updatedAt: new Date(),
            completedAt: new Date(),
            error: "Agent prompt is missing.",
          },
        }).catch(() => undefined);
      }
      if (graderRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: graderRunId,
          updates: {
            status: "failed",
            updatedAt: new Date(),
            completedAt: new Date(),
            error: "Agent prompt is missing.",
          },
        }).catch(() => undefined);
      }
      return;
    }

    await updateAgentStatus({
      serviceAccountJson,
      agentDocPath,
      status: "executing",
    });
    if (sheetRunId) {
      await patchGraderRunStatus({
        serviceAccountJson,
        userId: options.userId,
        runId: sheetRunId,
        updates: {
          status: "executing",
          updatedAt: new Date(),
        },
      }).catch(() => undefined);
    }
    if (graderRunId) {
      await patchGraderRunStatus({
        serviceAccountJson,
        userId: options.userId,
        runId: graderRunId,
        updates: {
          status: "executing",
          updatedAt: new Date(),
        },
      }).catch(() => undefined);
    }
    if (tutorSessionId) {
      await patchFirestoreDocument({
        serviceAccountJson,
        documentPath: resolveTutorSessionDocPath(
          options.userId,
          tutorSessionId,
        ),
        updates: {
          status: "responding",
          activeTurnAgentId: options.agentId,
          ...(tutorQuestionId ? { activeTurnQuestionId: tutorQuestionId } : {}),
          updatedAt: new Date(),
        },
        deletes: ["error"],
      }).catch(() => undefined);
    }

    logSync = new AgentLogSync({
      serviceAccountJson,
      userId: options.userId,
      agentId: options.agentId,
      throttleMs: AGENT_LOG_THROTTLE_MS,
      initialStats: statsTracker.snapshot(),
      mirrorToConsole: true,
      consolePrefix: `[spark-agent:${options.agentId}] `,
    });
    logSync.append(
      `start: workspaceId=${options.workspaceId} modelId=${toolLoopModelId}`,
    );

    const workspaceRootConfig = resolveSparkAgentWorkspaceRoot({
      workspaceId: options.workspaceId,
      runStartedAt: new Date(),
    });
    workspaceRoot = workspaceRootConfig.rootDir;
    cleanupWorkspaceRoot = workspaceRootConfig.cleanupOnExit;
    await ensureDir(workspaceRoot);
    const workspaceLogLine = [
      `local_fs_dir=${workspaceRoot}`,
      `cleanup_on_exit=${cleanupWorkspaceRoot ? "true" : "false"}`,
    ].join(" ");
    logSync.append(workspaceLogLine);
    logSync.append(`workspace_root: ${workspaceRoot}`);
    workspaceSync = new WorkspaceSync({
      serviceAccountJson,
      userId: options.userId,
      workspaceId: options.workspaceId,
      bucketName,
      rootDir: workspaceRoot,
    });
    await workspaceSync.load();
    try {
      const sharedPdfKnowledgeBase = await writeKnowledgeBaseWorkspaceFiles({
        serviceAccountJson,
        rootDir: workspaceRoot,
        limit: 100,
      });
      logSync.append(
        `shared_pdf_knowledge_base: entries=${sharedPdfKnowledgeBase.entries.length.toString()} files=${sharedPdfKnowledgeBase.files.length.toString()}`,
      );
    } catch (error) {
      logSync.append(
        `shared_pdf_knowledge_base_error: ${errorAsString(error)}`,
      );
    }
    if (tutorSessionId) {
      const tutorSessionSnap = await getFirestoreDocument({
        serviceAccountJson,
        documentPath: resolveTutorSessionDocPath(
          options.userId,
          tutorSessionId,
        ),
      });
      const tutorSessionData = tutorSessionSnap.data ?? {};
      if (
        typeof tutorSessionData.title === "string" &&
        tutorSessionData.title.trim().length > 0
      ) {
        tutorSessionTitle = tutorSessionData.title.trim();
      }
      if (
        typeof tutorSessionData.focusLabel === "string" &&
        tutorSessionData.focusLabel.trim().length > 0
      ) {
        tutorFocusLabel = tutorSessionData.focusLabel.trim();
      }
      const source =
        tutorSessionData.source &&
        typeof tutorSessionData.source === "object" &&
        !Array.isArray(tutorSessionData.source)
          ? (tutorSessionData.source as Record<string, unknown>)
          : null;
      if (
        source &&
        source.kind === "sheet" &&
        typeof source.sheetTitle === "string"
      ) {
        tutorSourceLabel = source.sheetTitle;
      }
      if (
        source &&
        source.kind === "grader-problem" &&
        typeof source.problemIndex === "number" &&
        typeof source.problemTitle === "string"
      ) {
        tutorSourceLabel = `Problem ${source.problemIndex.toString()}: ${source.problemTitle}`;
      }
      tutorSnapshot = await readTutorWorkspaceSnapshot({
        rootDir: workspaceRoot,
      });
    }

    const pollStopRequested = async (): Promise<void> => {
      if (stopRequested || stopPollInFlight) {
        return;
      }
      stopPollInFlight = (async () => {
        const snap = await getFirestoreDocument({
          serviceAccountJson,
          documentPath: agentDocPath,
        });
        const data = snap.data ?? {};
        if (data.stop_requested === true) {
          stopRequested = true;
          logSync?.append("warn: stop_requested detected");
        }
      })();
      try {
        await stopPollInFlight;
      } catch (error) {
        logSync?.append(`warn: stop poll failed: ${errorAsString(error)}`);
      } finally {
        stopPollInFlight = undefined;
      }
    };

    const startStopPolling = (): void => {
      if (stopPollTimer) {
        return;
      }
      stopPollTimer = setInterval(() => {
        void pollStopRequested();
      }, STOP_POLL_INTERVAL_MS);
    };

    const throwIfStopRequested = (): void => {
      if (stopRequested) {
        throw new StopRequestedError();
      }
    };

    const modelId = toolLoopModelId;
    const isLessonRun = Boolean(
      typeof agentData.lessonSessionId === "string" &&
      agentData.lessonSessionId.trim().length > 0,
    );
    const rawAgentInputAttachments: unknown[] = [];
    if (Array.isArray(agentData.inputAttachments)) {
      rawAgentInputAttachments.push(...agentData.inputAttachments);
    }
    if (Array.isArray(agentData.graderInputAttachments)) {
      rawAgentInputAttachments.push(...agentData.graderInputAttachments);
    }
    const explicitInputAttachments = z
      .array(AgentAttachmentInputSchema)
      .catch([])
      .parse(rawAgentInputAttachments)
      .map((entry) => toResolvedAttachmentInput(entry));
    const workspaceLinkAttachments =
      workspaceSync.getDiscoveredLinkAttachments();
    const inlineInputAttachments = mergeAttachmentInputs({
      primary: explicitInputAttachments,
      secondary: workspaceLinkAttachments,
    }).slice(0, AGENT_INLINE_ATTACHMENTS_MAX_COUNT);
    if (inlineInputAttachments.length > 0) {
      logSync?.append(
        `input_attachments: using ${inlineInputAttachments.length.toString()} attachment(s)`,
      );
    }
    const maxSteps =
      options.maxSteps ??
      (isLessonRun ? DEFAULT_LESSON_MAX_STEPS : DEFAULT_MAX_STEPS);
    const thinkingLevel = resolveSparkAgentThinkingLevel(modelId);
    const progress: JobProgressReporter = {
      log: (message) => {
        throwIfStopRequested();
        logSync?.append(message);
        logSync?.setStats(statsTracker.snapshot());
      },
      startModelCall: (details) => {
        throwIfStopRequested();
        const handle = statsTracker.startModelCall({
          modelId: details.modelId,
          costBucket: "tool",
        });
        logSync?.setStats(statsTracker.snapshot());
        return handle;
      },
      recordModelUsage: (handle, chunk) => {
        throwIfStopRequested();
        statsTracker.recordModelUsage(handle, chunk);
        logSync?.setStats(statsTracker.snapshot());
      },
      finishModelCall: (handle) => {
        throwIfStopRequested();
        statsTracker.finishModelCall(handle);
        logSync?.setStats(statsTracker.snapshot());
      },
      startStage: (stageName: string): StageHandle => {
        throwIfStopRequested();
        void stageName;
        return Symbol("agent-stage");
      },
      finishStage: (handle: StageHandle) => {
        throwIfStopRequested();
        void handle;
      },
      setActiveStages: (stages) => {
        throwIfStopRequested();
        void stages;
      },
    };

    const llmDebug: LlmDebugOptions = {
      rootDir: path.join(workspaceRoot, ".llm-debug"),
      stage: "spark-agent",
    };

    const doneTool = tool({
      description:
        "Mark the agent run as complete. Flushes workspace updates and records a short summary.",
      terminal: true,
      inputSchema: z
        .object({
          summary: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ summary }) => {
        doneCalled = true;
        logSync?.append(
          summary ? `done: ${summary}` : "done: completed without summary",
        );
        logSync?.setStats(statsTracker.snapshot());
        await workspaceSync?.flushAll();
        await logSync?.flushAll();
        if (sheetRunId && !publishedSheetDraft) {
          throw new Error(
            "Worksheet draft is not published yet. Call publish_sheet_draft and fix any validation errors before done().",
          );
        }
        if (sheetRunId && workspaceRoot && publishedSheetDraft) {
          const [currentSummarySha256, currentSheetSha256] = await Promise.all([
            computeWorkspaceFileSha256({
              rootDir: workspaceRoot,
              filePath: publishedSheetDraft.summaryPath,
            }),
            computeWorkspaceFileSha256({
              rootDir: workspaceRoot,
              filePath: publishedSheetDraft.sheetPath,
            }),
          ]);
          if (
            currentSummarySha256 !== publishedSheetDraft.summarySha256 ||
            currentSheetSha256 !== publishedSheetDraft.sheetSha256
          ) {
            throw new Error(
              "Published worksheet draft artifacts changed after publish_sheet_draft. Call publish_sheet_draft again before done().",
            );
          }
        }
        if (graderRunId && !publishedGraderSheet) {
          throw new Error(
            "Grader sheet is not published yet. Call publish_sheet and fix any validation errors before done().",
          );
        }
        if (graderRunId && workspaceRoot && publishedGraderSheet) {
          const [currentSummarySha256, currentSheetSha256] = await Promise.all([
            computeWorkspaceFileSha256({
              rootDir: workspaceRoot,
              filePath: publishedGraderSheet.summaryPath,
            }),
            computeWorkspaceFileSha256({
              rootDir: workspaceRoot,
              filePath: publishedGraderSheet.sheetPath,
            }),
          ]);
          if (
            currentSummarySha256 !== publishedGraderSheet.summarySha256 ||
            currentSheetSha256 !== publishedGraderSheet.sheetSha256
          ) {
            throw new Error(
              "Published grader artifacts changed after publish_sheet. Call publish_sheet again before done().",
            );
          }
        }
        const runSummary =
          graderRunId && workspaceRoot && !publishedGraderSheet
            ? await readGraderRunSummaryFromWorkspace({
                rootDir: workspaceRoot,
                summaryPath: graderSummaryPath,
                log: (line) => {
                  logSync?.append(line);
                },
              })
            : null;
        const resultSummary =
          publishedGraderSheet?.resultSummary ??
          publishedSheetDraft?.presentation.summaryMarkdown ??
          selectGraderResultSummary({
            doneSummary: summary,
            runSummary,
          });
        await updateAgentStatus({
          serviceAccountJson,
          agentDocPath,
          status: "done",
          resultSummary,
        });
        if (graderRunId && workspaceRoot) {
          const now = new Date();
          const publication = publishedGraderSheet;
          if (!publication) {
            throw new Error(
              "Grader sheet publish metadata is missing at completion time.",
            );
          }
          let patchedGraderRun = false;
          try {
            await patchGraderRunStatus({
              serviceAccountJson,
              userId: options.userId,
              runId: graderRunId,
              updates: {
                status: "done",
                updatedAt: now,
                completedAt: now,
                ...(resultSummary ? { resultSummary } : {}),
                ...(publication.paper ? { paper: publication.paper } : {}),
                presentation: publication.presentation,
                totals: publication.totals,
                sheet: publication.sheet,
                summaryPath: publication.summaryPath,
                sheetPath: publication.sheetPath,
              },
            });
            patchedGraderRun = true;
          } catch (error) {
            logSync?.append(
              `warn: failed to patch grader run summary: ${errorAsString(error)}`,
            );
          }
          if (patchedGraderRun && !disableAutoGapsFinder) {
            await launchSparkGapsFinderForRun({
              serviceAccountJson,
              userId: options.userId,
              runId: graderRunId,
              completedAt: now,
            }).catch((error) => {
              logSync?.append(
                `warn: failed to launch gaps finder: ${errorAsString(error)}`,
              );
            });
          } else if (patchedGraderRun) {
            logSync?.append(
              "info: auto gap finder disabled for this grader run",
            );
          }
        }
        if (sheetRunId && workspaceRoot) {
          const now = new Date();
          const publication = publishedSheetDraft;
          if (!publication) {
            throw new Error(
              "Worksheet draft publish metadata is missing at completion time.",
            );
          }
          await patchGraderRunStatus({
            serviceAccountJson,
            userId: options.userId,
            runId: sheetRunId,
            updates: {
              status: "done",
              sheetPhase: "solving",
              updatedAt: now,
              completedAt: now,
              ...(resultSummary ? { resultSummary } : {}),
              presentation: publication.presentation,
              sheet: publication.sheet,
              summaryPath: publication.summaryPath,
              sheetPath: publication.sheetPath,
              draftAnswersPath: sheetDraftAnswersPath,
            },
          }).catch((error) => {
            logSync?.append(
              `warn: failed to patch worksheet draft summary: ${errorAsString(error)}`,
            );
          });
        }
        return { status: "done", summary: resultSummary };
      },
    });

    const loadTutorQuestionReviewContext = async (): Promise<{
      reviewState: SparkTutorReviewState;
      report: SparkGraderWorksheetReport;
      questionIds: string[];
    }> => {
      if (!tutorSessionId || !workspaceRoot || !tutorQuestionId) {
        throw new Error(
          "Tutor question context is missing for this sheet feedback turn.",
        );
      }
      const [reviewRaw, reportRaw] = await Promise.all([
        readWorkspaceTextFileIfExists({
          rootDir: workspaceRoot,
          filePath: TUTOR_STATE_REVIEW_PATH,
        }),
        readWorkspaceTextFileIfExists({
          rootDir: workspaceRoot,
          filePath: TUTOR_CONTEXT_REPORT_PATH,
        }),
      ]);
      const reviewState = parseTutorReviewStateFromWorkspace(reviewRaw);
      if (!reviewState) {
        throw new Error("Tutor review state is missing or invalid.");
      }
      const report = parseWorksheetReportFromWorkspace(reportRaw);
      if (!report) {
        throw new Error("Worksheet report is missing or invalid.");
      }
      return {
        reviewState,
        report,
        questionIds: listWorksheetQuestionIds(report),
      };
    };

    const commitTutorQuestionReply = async (input: {
      assistantReplyMarkdown: string;
      resolved: boolean;
      preview?: string;
    }): Promise<{
      sessionStatus: "awaiting_student" | "completed";
      preview: string;
    }> => {
      if (!tutorSessionId || !workspaceRoot || !tutorQuestionId) {
        throw new Error(
          "Tutor question context is missing for this sheet feedback turn.",
        );
      }
      const { reviewState, report, questionIds } =
        await loadTutorQuestionReviewContext();
      const currentThread = reviewState.threads[tutorQuestionId];
      if (!currentThread) {
        throw new Error(
          `Tutor review thread "${tutorQuestionId}" was not found.`,
        );
      }
      const assistantReplyMarkdown = normalizeTutorMarkdown(
        input.assistantReplyMarkdown,
      );
      const now = new Date();
      const nowIso = now.toISOString();
      const nextThread = {
        ...currentThread,
        status: input.resolved ? "resolved" : "open",
        messages: [
          ...currentThread.messages,
          {
            id: randomUUID(),
            author: "assistant",
            markdown: assistantReplyMarkdown,
            createdAt: nowIso,
          },
        ],
        ...(input.resolved
          ? { resolvedAt: nowIso }
          : { resolvedAt: undefined }),
      };
      const nextReviewState = SparkTutorReviewStateSchema.parse({
        ...reviewState,
        threads: {
          ...reviewState.threads,
          [tutorQuestionId]: nextThread,
        },
        updatedAt: nowIso,
      });
      const summary = summarizeTutorReviewThreads(nextReviewState, questionIds);
      const focusLabel = summary.allResolved
        ? "Resolved"
        : buildTutorFocusLabelForQuestion({
            report,
            questionId: summary.nextQuestionId,
          });
      const sessionStatus = summary.allResolved
        ? "completed"
        : "awaiting_student";
      const preview =
        parseOptionalString(input.preview) ??
        buildTutorPreviewFromSummary(summary);
      const screenState = SparkTutorScreenStateSchema.parse({
        status: sessionStatus,
        title: tutorSessionTitle,
        ...(focusLabel ? { focusLabel } : {}),
        updatedAt: nowIso,
      });
      const composerState = buildTutorComposerState({
        placeholder: summary.allResolved
          ? "All worksheet feedback is resolved."
          : "Reply inside any open feedback card.",
        disabled: summary.allResolved,
        allowConfidence: false,
        hintButtons: [],
      });
      const turnFilePath = buildTutorQuestionTurnFilePath({
        questionId: tutorQuestionId,
        author: "assistant",
        now,
      });
      streamedAssistantText = assistantReplyMarkdown;
      logSync?.setStream({
        assistant: streamedAssistantText,
        thoughts: streamedThoughtsText,
      });
      await Promise.all([
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: turnFilePath,
          content: stringifyJsonFile({
            author: "assistant",
            markdown: assistantReplyMarkdown,
            createdAt: nowIso,
            resolved: input.resolved,
          }),
          flushNow: true,
        }),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_REVIEW_PATH,
          content: stringifyJsonFile(nextReviewState),
          flushNow: true,
        }),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_SESSION_PATH,
          content: stringifyJsonFile(screenState),
          flushNow: true,
        }),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_COMPOSER_PATH,
          content: stringifyJsonFile(composerState),
          flushNow: true,
        }),
        patchFirestoreDocument({
          serviceAccountJson,
          documentPath: resolveTutorSessionDocPath(
            options.userId,
            tutorSessionId,
          ),
          updates: {
            status: sessionStatus,
            preview,
            updatedAt: now,
            ...(focusLabel ? { focusLabel } : {}),
            ...(summary.allResolved ? { completedAt: now } : {}),
          },
          deletes: ["error"],
        }),
      ]);
      tutorFocusLabel = focusLabel ?? null;
      return {
        sessionStatus,
        preview,
      };
    };

    recoverTutorQuestionAfterFailure = async (input: {
      assistantReplyMarkdown: string;
      composerPlaceholder: string;
      sessionError?: string;
    }): Promise<void> => {
      if (!tutorSessionId || !workspaceRoot || !tutorQuestionId) {
        return;
      }
      const { reviewState, report, questionIds } =
        await loadTutorQuestionReviewContext();
      const currentThread = reviewState.threads[tutorQuestionId];
      if (!currentThread || currentThread.status !== "responding") {
        await patchFirestoreDocument({
          serviceAccountJson,
          documentPath: resolveTutorSessionDocPath(
            options.userId,
            tutorSessionId,
          ),
          updates: {
            status: "awaiting_student",
            updatedAt: new Date(),
            ...(input.sessionError ? { error: input.sessionError } : {}),
          },
          deletes: ["activeTurnAgentId", "activeTurnQuestionId"],
        }).catch(() => undefined);
        return;
      }
      const now = new Date();
      const nowIso = now.toISOString();
      const assistantReplyMarkdown = normalizeTutorMarkdown(
        input.assistantReplyMarkdown,
      );
      const nextThread = SparkTutorReviewThreadSchema.parse({
        ...currentThread,
        status: "open",
        messages: [
          ...currentThread.messages,
          {
            id: randomUUID(),
            author: "assistant",
            markdown: assistantReplyMarkdown,
            createdAt: nowIso,
          },
        ],
        resolvedAt: undefined,
      });
      const nextReviewState = SparkTutorReviewStateSchema.parse({
        ...reviewState,
        threads: {
          ...reviewState.threads,
          [tutorQuestionId]: nextThread,
        },
        updatedAt: nowIso,
      });
      const summary = summarizeTutorReviewThreads(nextReviewState, questionIds);
      const focusLabel = summary.allResolved
        ? "Resolved"
        : buildTutorFocusLabelForQuestion({
            report,
            questionId: summary.nextQuestionId,
          });
      const preview = buildTutorPreviewFromSummary(summary);
      const screenState = SparkTutorScreenStateSchema.parse({
        status: "awaiting_student",
        title: tutorSessionTitle,
        ...(focusLabel ? { focusLabel } : {}),
        updatedAt: nowIso,
      });
      const composerState = buildTutorComposerState({
        placeholder: input.composerPlaceholder,
        disabled: false,
        allowConfidence: false,
        hintButtons: [],
      });
      const turnFilePath = buildTutorQuestionTurnFilePath({
        questionId: tutorQuestionId,
        author: "assistant",
        now,
      });
      await Promise.all([
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: turnFilePath,
          content: stringifyJsonFile({
            author: "assistant",
            markdown: assistantReplyMarkdown,
            createdAt: nowIso,
            resolved: false,
          }),
          flushNow: true,
        }),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_REVIEW_PATH,
          content: stringifyJsonFile(nextReviewState),
          flushNow: true,
        }),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_SESSION_PATH,
          content: stringifyJsonFile(screenState),
          flushNow: true,
        }),
        writeTutorWorkspaceTextFile({
          rootDir: workspaceRoot,
          workspaceSync,
          filePath: TUTOR_STATE_COMPOSER_PATH,
          content: stringifyJsonFile(composerState),
          flushNow: true,
        }),
        patchFirestoreDocument({
          serviceAccountJson,
          documentPath: resolveTutorSessionDocPath(
            options.userId,
            tutorSessionId,
          ),
          updates: {
            status: "awaiting_student",
            preview,
            updatedAt: now,
            ...(focusLabel ? { focusLabel } : {}),
            ...(input.sessionError ? { error: input.sessionError } : {}),
          },
          deletes: ["activeTurnAgentId", "activeTurnQuestionId"],
        }),
      ]);
      tutorFocusLabel = focusLabel ?? null;
    };

    const wait_for_student_input = tool({
      description:
        "Append an assistant reply to the selected worksheet question, leave the question open, and wait for the student's next revision. Call done() immediately after this tool.",
      inputSchema: z
        .object({
          assistantReplyMarkdown: z.string().trim().min(1),
          preview: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ assistantReplyMarkdown, preview }) => {
        const result = await commitTutorQuestionReply({
          assistantReplyMarkdown,
          resolved: false,
          preview,
        });
        return {
          status: result.sessionStatus,
          preview: result.preview,
        };
      },
    });

    const complete_tutor_session = tool({
      description:
        "Append an assistant reply to the selected worksheet question and resolve it. The overall sheet is marked complete only if no open questions remain. Call done() immediately after this tool.",
      inputSchema: z
        .object({
          assistantReplyMarkdown: z.string().trim().min(1),
          preview: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ assistantReplyMarkdown, preview }) => {
        const result = await commitTutorQuestionReply({
          assistantReplyMarkdown,
          resolved: true,
          preview,
        });
        return {
          status: result.sessionStatus,
          preview: result.preview,
        };
      },
    });

    const workspaceFilesystemToolConfig = tutorSessionId
      ? null
      : buildSparkAgentFilesystemToolConfig({
          workspace: workspaceSync,
          rootDir: workspaceRoot,
        });

    const tools: LlmToolSet = tutorSessionId
      ? {
          wait_for_student_input,
          complete_tutor_session,
          done: doneTool,
        }
      : (() => {
          const workspaceFilesystemTools: LlmToolSet =
            workspaceFilesystemToolConfig
              ? createCodexFilesystemToolSet(
                  workspaceFilesystemToolConfig.options,
                )
              : {};
          if (graderRunId !== null) {
            delete workspaceFilesystemTools.apply_patch;
          }
          const baseTools: LlmToolSet = {
            ...workspaceFilesystemTools,
            ...stripDeprecatedPdfReadTools(
              buildAgentTools({
                workspace: workspaceSync,
                rootDir: workspaceRoot,
                userId: options.userId,
                serviceAccountJson,
                progress,
                onToolLlmCost: (toolName, costUsd) => {
                  if (toolName === "generate_text") {
                    generateTextCostUsd += costUsd;
                    return;
                  }
                  if (toolName === "generate_json") {
                    generateJsonCostUsd += costUsd;
                    return;
                  }
                  if (toolName === "extract_text") {
                    extractTextCostUsd += costUsd;
                    return;
                  }
                  pdfToolCostUsd += costUsd;
                },
                enforceLessonPipeline: isLessonRun,
                allowPythonExec: graderRunId === null && sheetRunId === null,
                ...(sheetRunId
                  ? {
                      sheetDraftPublish: {
                        mode: "live" as const,
                        runId: sheetRunId,
                      },
                      beforePublishSheetDraft: async () => {
                        await workspaceSync?.flushAll();
                        await logSync?.flushAll();
                      },
                      onPublishSheetDraft: async (
                        publication: PublishedSheetDraftArtifacts,
                      ) => {
                        publishedSheetDraft = publication;
                      },
                    }
                  : {}),
                ...(graderRunId
                  ? {
                      graderPublish: {
                        mode: "live" as const,
                        runId: graderRunId,
                      },
                      beforePublishSheet: async () => {
                        await workspaceSync?.flushAll();
                        await logSync?.flushAll();
                      },
                      onPublishSheet: async (
                        publication: PublishedGraderSheetArtifacts,
                      ) => {
                        publishedGraderSheet = publication;
                        graderSummaryPath = publication.summaryPath;
                        graderSheetPath = publication.sheetPath;
                      },
                    }
                  : {}),
                debug: llmDebug,
                extractTextDebugRootDir:
                  resolveSparkAgentToolCallsDir(workspaceRoot),
              }),
            ),
            done: doneTool,
          };
          return graderRunId === null
            ? baseTools
            : applyPdfTranscriptionSkillTools({
                tools: baseTools,
                rootDir: workspaceRoot,
                includeReferenceTextTool: true,
                onFileWritten: (outputPath) => {
                  workspaceSync?.scheduleUpdate(outputPath);
                },
              });
        })();

    await patchFirestoreDocument({
      serviceAccountJson,
      documentPath: agentDocPath,
      updates: {
        availableTools: buildSparkAgentAvailableTools(tools, toolLoopModelId),
      },
    }).catch((error) => {
      logSync?.append(
        `warn: failed to persist available tool catalog: ${errorAsString(error)}`,
      );
    });

    progress.log(
      `exposed tools: ${Array.from(
        new Set(Object.keys(tools)),
      )
        .sort()
        .join(", ")}`,
    );

    await pollStopRequested();
    if (stopRequested) {
      throw new StopRequestedError();
    }
    startStopPolling();

    const agentSystemPrompt = tutorSessionId
      ? [
          "You are replying inside Spark's sheet feedback workflow.",
          "Focus only on the selected worksheet question and the current feedback thread.",
          "Keep the student doing the thinking. Do not give away a full solution unless it is necessary for correctness.",
          "Use wait_for_student_input when the question still needs another student revision.",
          "Use complete_tutor_session when your reply resolves the selected question. The tool will mark the whole sheet complete only if every question is resolved.",
          "After calling one of those tools, immediately call done with a short summary.",
          "Prefer concise markdown without headings.",
        ].join("\n")
      : buildSparkAgentSystemPrompt({
          includePdfTranscriptionSkill: graderRunId !== null,
          mode: graderRunId !== null ? "grader" : "default",
        });
    if (graderRunId && workspaceRoot) {
      try {
        await captureSparkAgentReplayState({
          rootDir: workspaceRoot,
          agentKind: "grader",
          prompt,
          systemPrompt: agentSystemPrompt,
          modelId,
          thinkingLevel,
          maxSteps,
          useSubagents: false,
          grader: {
            summaryPath: graderSummaryPath,
            sheetPath: graderSheetPath,
          },
        });
        logSync?.append(
          "replay: captured manifest + initial workspace snapshot",
        );
      } catch (error) {
        logSync?.append(
          `warn: failed to capture replay artifacts: ${errorAsString(error)}`,
        );
      }
    }
    let initialInput: LlmInputMessage[] | null = null;
    if (tutorSessionId && prompt.trim().length > 0) {
      initialInput = [
        {
          role: "system",
          content: [{ type: "text", text: agentSystemPrompt }],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ];
    } else if (tutorSessionId && tutorAction && tutorSnapshot) {
      initialInput = [
        {
          role: "system",
          content: [{ type: "text", text: agentSystemPrompt }],
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildTutorTurnPrompt({
                sessionTitle: tutorSessionTitle,
                action: tutorAction,
                sourceLabel: tutorSourceLabel,
                snapshot: tutorSnapshot,
                ...(tutorStudentText ? { studentText: tutorStudentText } : {}),
                ...(tutorConfidence
                  ? { studentConfidence: tutorConfidence }
                  : {}),
                ...(tutorHintLevel ? { hintLevel: tutorHintLevel } : {}),
              }),
            },
          ],
        },
      ];
    } else if (inlineInputAttachments.length > 0) {
      const loaded = await loadAttachmentParts({
        serviceAccountJson,
        bucketName,
        userId: options.userId,
        attachments: inlineInputAttachments,
        log: (line) => {
          logSync?.append(line);
        },
      });
      if (loaded.parts.length > 0 || loaded.notes.length > 0) {
        initialInput = buildInitialToolLoopInput({
          systemPrompt: agentSystemPrompt,
          prompt,
          inlineParts: loaded.parts,
          notes: loaded.notes,
        });
      }
    }

    processUsageMonitor = new AgentProcessUsageMonitor();
    processUsageMonitor.start();
    const toolLoopStartedAt = Date.now();
    const toolLoopEventBridge = createToolLoopStatsEventBridge({
      tracker: statsTracker,
      modelId,
      flush: () => {
        logSync?.setStats(statsTracker.snapshot());
      },
      mirrorEvent: (event) => {
        if (event.type !== "delta") {
          return;
        }
        if (event.channel === "response") {
          streamedAssistantText += event.text;
        } else {
          streamedThoughtsText += event.text;
        }
        logSync?.setStream({
          assistant: streamedAssistantText,
          thoughts: streamedThoughtsText,
        });
      },
    });
    const graderRequestPayload =
      graderRunId && workspaceRoot
        ? await loadSparkGraderRequestPayloadFromWorkspace(workspaceRoot)
        : null;
    const graderModelTools = resolveSparkGraderModelTools({
      input: graderRequestPayload?.input,
    });
    const toolLoopResult = await (async (): Promise<LlmToolLoopResult> => {
      try {
        return await runAgentLoop({
          model: modelId,
          input: initialInput ?? prompt,
          ...(initialInput ? {} : { instructions: agentSystemPrompt }),
          tools,
          ...(tutorSessionId
            ? {}
            : graderRunId === null
              ? { modelTools: [{ type: "web-search", mode: "live" }] }
              : graderModelTools
                ? { modelTools: graderModelTools }
                : {}),
          subagents: tutorSessionId
            ? false
            : resolveSparkAgentSubagentSelection(),
          maxSteps,
          ...(thinkingLevel ? { thinkingLevel } : {}),
          onEvent: (event) => {
            toolLoopEventBridge.onEvent(event);
          },
          telemetry: createSparkAgentRunTelemetryConfig({
            agentType: agentMetricType,
            job: monitoringJob,
            taskIdPrefix: agentMetricTaskIdPrefix,
          }),
          logging: {
            workspaceDir: resolveSparkAgentLogsDir(workspaceRoot),
            callLogsDir: "llm_calls",
            mirrorToConsole: false,
            sink: {
              append: (line: string) => {
                logSync?.append(line);
              },
              flush: async () => {
                await logSync?.flushAll();
              },
            },
          },
        });
      } finally {
        toolLoopEventBridge.finish();
      }
    })();
    const reconciledAgentCostUsd =
      statsTracker.reconcileModelCostFromToolLoopResult({
        modelId: toolLoopModelId,
        toolLoopResult,
      });
    statsTracker.recordToolCallsFromResult(toolLoopResult);
    logSync?.setStats(statsTracker.snapshot());
    await Promise.all(
      toolLoopResult.steps.map(async (step) => {
        if (!step.timing) {
          return;
        }
        await publishSparkToolLoopStepMetricsFromEnv({
          operation: "agent_run_tool_loop",
          model: toolLoopModelId,
          provider: resolveSparkMetricProviderLabel(toolLoopModelId),
          status: "ok",
          agentType: agentMetricType,
          timings: {
            totalMs: step.timing.totalMs,
            queueWaitMs: step.timing.queueWaitMs,
            connectionSetupMs: step.timing.connectionSetupMs,
            activeGenerationMs: step.timing.activeGenerationMs,
            toolExecutionMs: step.timing.toolExecutionMs,
            waitToolMs: step.timing.waitToolMs,
            schedulerDelayMs: step.timing.schedulerDelayMs,
            providerRetryDelayMs: step.timing.providerRetryDelayMs,
          },
          job: monitoringJob,
          taskId: `${agentMetricTaskIdPrefix}-step-${step.step.toString()}`,
          ...(step.timing.completedAt
            ? { timestamp: step.timing.completedAt }
            : {}),
        });
      }),
    );
    if (reconciledAgentCostUsd > 0) {
      logSync?.append(
        `reconciled_agent_llm_cost: +${reconciledAgentCostUsd.toFixed(6)} from toolLoopResult.totalCostUsd`,
      );
    }

    try {
      const traceSummary = await persistToolLoopTrace({
        serviceAccountJson,
        userId: options.userId,
        agentId: options.agentId,
        toolLoopResult,
        consolePrefix: `[spark-agent:${options.agentId}] `,
        toolCallsRootDir: resolveSparkAgentToolCallsDir(workspaceRoot),
      });
      logSync?.append(
        `trace_summary: steps=${traceSummary.stepCount} tool_calls=${traceSummary.toolCallCount}`,
      );
    } catch (error) {
      logSync?.append(
        `warn: failed to persist full tool trace: ${errorAsString(error)}`,
      );
    }

    if (!doneCalled) {
      const responseText = toolLoopResult.text.trim();
      const summary =
        responseText.length > 1000
          ? `${responseText.slice(0, 1000).trim()}…`
          : responseText;

      logSync?.append(
        "warn: model returned a final response without calling done; auto-completing run",
      );

      if (tutorSessionId && responseText.length > 0) {
        await wait_for_student_input.execute({
          assistantReplyMarkdown: responseText,
        });
      } else if (responseText.length > 0 && workspaceRoot) {
        const outputPath = "agent-output.md";
        try {
          await writeFile(path.join(workspaceRoot, outputPath), responseText, {
            encoding: "utf8",
          });
          workspaceSync?.scheduleUpdate(outputPath);
        } catch (error) {
          logSync?.append(
            `warn: failed to persist final response: ${errorAsString(error)}`,
          );
        }
      }

      await doneTool.execute({
        summary: summary.length > 0 ? summary : undefined,
      });
    }

    const totals = statsTracker.snapshot();
    progress.log(
      [
        "run_summary:",
        `agent_llm=${formatUsdTotal(totals.modelCostUsd)}`,
        `tool_llm=${formatUsdTotal(totals.toolCostUsd)}`,
        `generate_text=${formatUsdTotal(generateTextCostUsd)}`,
        `generate_json=${formatUsdTotal(generateJsonCostUsd)}`,
        `extract_text=${formatUsdTotal(extractTextCostUsd)}`,
        `pdf_tools=${formatUsdTotal(pdfToolCostUsd)}`,
        `wallclock=${formatMillis(Date.now() - toolLoopStartedAt)}`,
      ].join(" "),
    );

    await workspaceSync?.flushAll().catch(() => undefined);
    await logSync?.flushAll().catch(() => undefined);
    if (tutorSessionId) {
      await patchFirestoreDocument({
        serviceAccountJson,
        documentPath: resolveTutorSessionDocPath(
          options.userId,
          tutorSessionId,
        ),
        updates: {
          updatedAt: new Date(),
        },
        deletes: ["activeTurnAgentId", "activeTurnQuestionId"],
      }).catch((error) => {
        logSync?.append(
          `warn: failed to clear active tutor turn: ${errorAsString(error)}`,
        );
      });
    }
    agentMetricStatus = "ok";
  } catch (error) {
    if (error instanceof StopRequestedError) {
      agentMetricStatus = "stopped";
      logSync?.append("warn: agent stopped by user request");
      await workspaceSync?.flushAll().catch(() => undefined);
      await logSync?.flushAll().catch(() => undefined);
      await updateAgentStatus({
        serviceAccountJson,
        agentDocPath,
        status: "stopped",
        resultSummary: "Stopped by user.",
      }).catch(() => undefined);
      if (sheetRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: sheetRunId,
          updates: {
            status: "stopped",
            updatedAt: new Date(),
            completedAt: new Date(),
            resultSummary: "Stopped by user.",
          },
        }).catch(() => undefined);
      }
      if (graderRunId) {
        await patchGraderRunStatus({
          serviceAccountJson,
          userId: options.userId,
          runId: graderRunId,
          updates: {
            status: "stopped",
            updatedAt: new Date(),
            completedAt: new Date(),
            resultSummary: "Stopped by user.",
          },
        }).catch(() => undefined);
      }
      if (tutorSessionId && workspaceRoot) {
        await recoverTutorQuestionAfterFailure?.({
          assistantReplyMarkdown:
            "This review turn stopped before I could finish. Send your reply again and I will pick it up from there.",
          composerPlaceholder:
            "This tutor turn was stopped. You can try again.",
          sessionError: "Stopped by user.",
        }).catch((recoverError: unknown) => {
          logSync?.append(
            `warn: failed to recover stopped tutor turn: ${errorAsString(recoverError)}`,
          );
        });
      }
      return;
    }

    const message = errorAsString(error);
    console.error(`[spark-agent:${options.agentId}] failed: ${message}`);
    logSync?.append(`error: ${message}`);
    await workspaceSync?.flushAll().catch(() => undefined);
    await logSync?.flushAll().catch(() => undefined);
    const statusUpdated = await updateAgentStatus({
      serviceAccountJson,
      agentDocPath,
      status: "failed",
      error: message,
    })
      .then(() => true)
      .catch((statusError) => {
        console.error(
          `[spark-agent:${options.agentId}] failed to update status: ${errorAsString(statusError)}`,
        );
        return false;
      });
    if (!statusUpdated) {
      throw error;
    }
    if (sheetRunId) {
      await patchGraderRunStatus({
        serviceAccountJson,
        userId: options.userId,
        runId: sheetRunId,
        updates: {
          status: "failed",
          updatedAt: new Date(),
          completedAt: new Date(),
          error: message,
        },
      }).catch(() => undefined);
    }
    if (graderRunId) {
      await patchGraderRunStatus({
        serviceAccountJson,
        userId: options.userId,
        runId: graderRunId,
        updates: {
          status: "failed",
          updatedAt: new Date(),
          completedAt: new Date(),
          error: message,
        },
      }).catch(() => undefined);
    }
    if (tutorSessionId && workspaceRoot) {
      await recoverTutorQuestionAfterFailure?.({
        assistantReplyMarkdown:
          "I lost that review turn before I could finish. Send the same reply again and I will continue from this question.",
        composerPlaceholder:
          "That tutor turn failed. You can try sending again.",
        sessionError: message,
      }).catch((recoverError: unknown) => {
        logSync?.append(
          `warn: failed to recover errored tutor turn: ${errorAsString(recoverError)}`,
        );
      });
    }
    return;
  } finally {
    await stopStopPolling();
    const processUsage = processUsageMonitor?.stop();
    if (processUsage) {
      await publishSparkAgentProcessMetricsFromEnv({
        agentType: agentMetricType,
        status: agentMetricStatus,
        cpuUtilization: processUsage.cpuUtilization,
        cpuTimeMs: processUsage.cpuTimeMs,
        rssPeakBytes: processUsage.rssPeakBytes,
        job: monitoringJob,
        taskId: `${agentMetricTaskIdPrefix}-process`,
      });
    }
    logSync?.dispose();
    if (workspaceRoot && cleanupWorkspaceRoot) {
      await rm(workspaceRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}
