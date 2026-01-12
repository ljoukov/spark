#!/usr/bin/env tsx

import { join, resolve, extname, relative, dirname } from "node:path";
import { existsSync } from "node:fs";
import process from "node:process";
import {
  readFile,
  readdir,
  stat,
  mkdir,
  copyFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import { type Part } from "@google/genai";
import { z } from "zod";

import { GeminiModelId } from "@spark/llm/utils/gemini";
import {
  runJobsWithConcurrency,
  type JobProgressReporter,
} from "@spark/llm/utils/concurrency";
import { WORKSPACE_PATHS, ensureEvalEnvLoaded } from "../../utils/paths";
import { detectMimeType } from "../../utils/mime";
import {
  convertGooglePartsToLlmParts,
  generateJson,
} from "@spark/llm/utils/llm";
import { createCliCommand, createIntegerParser } from "../../utils/cli";

ensureEvalEnvLoaded();

const { quizDownloadsDir: DEFAULT_SRC_DIR, quizEvalInputDir: DEFAULT_DST_DIR } =
  WORKSPACE_PATHS;

const GEMINI_MODEL_ID: GeminiModelId = "gemini-flash-lite-latest";
const MAX_CONCURRENCY = 16;
const CACHE_FILE_NAME = "classification-cache.json";
const ERROR_LOG_FILE_NAME = "classification-errors.log";
// Gemini (see SPEC) only accepts PDFs and raster images, keep the allowlist tight.
const SUPPORTED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const GRADE_BUCKETS = [
  "foundation",
  "intermediate",
  "higher",
  "mixed",
] as const;

const PAGE_BUCKETS = [
  "01_page",
  "02-to-04_pages",
  "05-to-09_pages",
  "10-to-19_pages",
  "20-to-49_pages",
  "50plus_pages",
] as const;

const EXAM_BOARDS = [
  "AQA",
  "OCR",
  "Edexcel",
  "Pearson",
  "Cambridge",
  "WJEC",
  "Eduqas",
  "CCEA",
  "general",
] as const;

const MATERIAL_TYPES = ["study", "revision", "test", "other"] as const;

const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
const DEFAULT_CONFIDENCE: (typeof CONFIDENCE_LEVELS)[number] = "medium";

const CONFIDENCE_SYNONYMS: Partial<
  Record<string, (typeof CONFIDENCE_LEVELS)[number]>
> = {
  high: "high",
  "highly confident": "high",
  "very high": "high",
  strong: "high",
  certain: "high",
  confident: "high",
  assured: "high",
  medium: "medium",
  moderate: "medium",
  average: "medium",
  balanced: "medium",
  steady: "medium",
  low: "low",
  "fairly low": "low",
  weak: "low",
  uncertain: "low",
  unsure: "low",
  doubtful: "low",
  unknown: "low",
  limited: "low",
  minimal: "low",
};

function normaliseConfidenceInput(value: unknown): unknown {
  if (value === undefined || value === null) {
    return DEFAULT_CONFIDENCE;
  }
  if (typeof value !== "string") {
    return DEFAULT_CONFIDENCE;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_CONFIDENCE;
  }
  const canonicalWhitespace = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  const lower = canonicalWhitespace.toLowerCase();
  const stripped = lower
    .replace(/\bconfidence(?:\s+level)?\b/g, "")
    .replace(/\blevel\b/g, "")
    .replace(/\bscore\b/g, "")
    .replace(/:+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const direct = CONFIDENCE_SYNONYMS[stripped];
  if (direct) {
    return direct;
  }
  const tokens = stripped.split(" ").filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const solo = tokens[i];
    const duo = tokens[i + 1] ? `${solo} ${tokens[i + 1]}` : undefined;
    if (duo) {
      const duoMatch = CONFIDENCE_SYNONYMS[duo];
      if (duoMatch) {
        return duoMatch;
      }
    }
    const tokenMatch = CONFIDENCE_SYNONYMS[solo];
    if (tokenMatch) {
      return tokenMatch;
    }
  }
  if (
    stripped &&
    CONFIDENCE_LEVELS.includes(stripped as (typeof CONFIDENCE_LEVELS)[number])
  ) {
    return stripped;
  }
  return DEFAULT_CONFIDENCE;
}

const ConfidenceSchema = z.preprocess(
  normaliseConfidenceInput,
  z.enum(CONFIDENCE_LEVELS),
);

const RawClassificationSchema = z.object({
  numberOfPages: z.number().int().positive().optional(),
  examBoard: z.enum(EXAM_BOARDS),
  gradeBucket: z.enum(GRADE_BUCKETS),
  materialType: z.enum(MATERIAL_TYPES),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  confidence: ConfidenceSchema,
  tags: z.array(z.string().min(1)).optional(),
  shortName: z
    .string()
    .min(3)
    .transform((value) => value.trim().toLowerCase())
    .refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value), {
      message:
        "shortName must be lowercase slug with letters/numbers separated by hyphens",
    }),
});

type RawClassification = z.infer<typeof RawClassificationSchema>;

const ClassificationSchema = RawClassificationSchema.extend({
  pageBucket: z.enum(PAGE_BUCKETS),
});

type Classification = z.infer<typeof ClassificationSchema>;

type PlacementMode = "link" | "copy" | "move";

type CliOptions = {
  src: string;
  dst: string;
  mode: PlacementMode;
  dryRun: boolean;
  concurrency: number;
  retryFailed: boolean;
};

const PlacementModeSchema = z.enum(["link", "copy", "move"]);

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "prepare-input",
    "Classify raw study materials into spark-data/quiz/eval-input",
  );

  program
    .option("--src <path>", "Source downloads directory", DEFAULT_SRC_DIR)
    .option("--dst <path>", "Destination eval-input directory", DEFAULT_DST_DIR)
    .option(
      "--mode <mode>",
      "Placement mode: link | copy | move",
      (value: string) => PlacementModeSchema.parse(value) as PlacementMode,
      "link",
    )
    .option("--dry-run", "Preview actions without writing to disk")
    .option("--retry-failed", "Retry files that failed classification")
    .option(
      "--concurrency <number>",
      "Maximum concurrent Gemini jobs",
      createIntegerParser({ name: "concurrency", min: 1 }),
      MAX_CONCURRENCY,
    );

  const parsed = program.parse(argv, { from: "user" }).opts<{
    src?: string;
    dst?: string;
    mode: PlacementMode;
    dryRun?: boolean;
    retryFailed?: boolean;
    concurrency: number;
  }>();

  const src = parsed.src ? resolve(parsed.src) : DEFAULT_SRC_DIR;
  const dst = parsed.dst ? resolve(parsed.dst) : DEFAULT_DST_DIR;
  const concurrency = Math.min(
    MAX_CONCURRENCY,
    Math.max(1, parsed.concurrency),
  );

  return {
    src,
    dst,
    mode: parsed.mode,
    dryRun: parsed.dryRun ?? false,
    concurrency,
    retryFailed: parsed.retryFailed ?? false,
  } satisfies CliOptions;
}

type SampleFile = {
  sourcePath: string;
  relativePath: string;
  name: string;
  ext: string;
  sizeBytes: number;
};

type ClassifiedSample = {
  file: SampleFile;
  classification: Classification;
};

type CacheEntry = {
  classification: Classification;
  modelVersion?: string;
  updatedAt?: string;
};

type CacheData = Partial<Record<string, CacheEntry>>;

type JobResult = {
  file: SampleFile;
  classification?: Classification;
  modelVersion?: string;
  error?: unknown;
};

const CacheEntrySchema = z.object({
  classification: ClassificationSchema,
  modelVersion: z.string().optional(),
  updatedAt: z.string().optional(),
});

const CacheSchema = z.record(z.string(), CacheEntrySchema);

async function collectSampleFiles(root: string): Promise<SampleFile[]> {
  const entries: SampleFile[] = [];
  async function walk(current: string): Promise<void> {
    const dirEntries = await readdir(current, { withFileTypes: true });
    for (const entry of dirEntries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      const stats = await stat(fullPath);
      if (!stats.isFile()) {
        continue;
      }
      const rel = fullPath.substring(root.length + 1);
      const ext = extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        console.warn(
          `[collect] Skipping unsupported extension ${ext || "(none)"}: ${rel}`,
        );
        continue;
      }
      entries.push({
        sourcePath: fullPath,
        relativePath: rel,
        name: entry.name,
        ext,
        sizeBytes: stats.size,
      });
    }
  }
  await walk(root);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function buildPrompt(): string {
  const lines = [
    "You are cataloguing Spark's GCSE science study materials for evaluation coverage.",
    "Review the metadata below plus the attached file, then classify the resource using the schema.",
    "",
    "Detected page count: unknown — inspect the attached file and estimate when needed.",
    "Exam board options: AQA | OCR | Edexcel | Pearson | Cambridge | WJEC | Eduqas | CCEA | general",
    'Grade bucket options (choose one, no "unknown"): foundation | intermediate | higher | mixed',
    "Material type options: study | revision | test | other",
    "",
    "Guidance:",
    "- study: textbooks, detailed notes, teaching guides, handbooks, resource packs, practical instructions.",
    "- revision: condensed summaries, knowledge organisers, checklists, flashcards.",
    "- test: exam papers, specimen assessments, question banks, mark schemes, worksheet question sets.",
    "- other: admin sheets, timetables, templates, lists, or anything unsuitable for quiz generation.",
    "- Prefer specific boards when evidence exists; otherwise use general.",
    "- Estimate the page count by inspecting the attachment so you can choose the correct bucket.",
    "- Provide a concise summary (1-2 sentences) focusing on subject coverage.",
    "- Explain your reasoning in the rationale field.",
    "- Always return your best-guess gradeBucket even if evidence is sparse—choose the closest match.",
    '- Produce shortName as a lowercase slug that begins with the subject and then key topic words (e.g., "physics-electricity-circuits"). Use hyphens only, no spaces or file extensions.',
    "",
    "The original document is attached to this prompt. Inspect it directly when deciding the board, grade intensity, and naming.",
    "Return JSON that matches the schema exactly.",
  ];
  return lines.join("\n");
}

function buildFilePart(file: SampleFile, buffer: Buffer): Part {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType: detectMimeType(file.ext),
    },
  };
}

async function callGeminiJson({
  parts,
  progress,
}: {
  parts: Part[];
  label: string;
  progress: JobProgressReporter;
}): Promise<RawClassification> {
  const llmParts = convertGooglePartsToLlmParts(parts);
  return generateJson<RawClassification>({
    progress,
    modelId: GEMINI_MODEL_ID,
    contents: [
      {
        role: "user",
        parts: llmParts,
      },
    ],
    schema: RawClassificationSchema,
    maxAttempts: 1,
  });
}

async function loadCache(cachePath: string): Promise<CacheData> {
  try {
    const raw = await readFile(cachePath, "utf8");
    if (!raw.trim()) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    const validated = CacheSchema.parse(parsed);
    const result: CacheData = {};
    for (const [rel, entry] of Object.entries(validated)) {
      result[rel] = {
        classification: normaliseClassification(entry.classification),
        modelVersion: entry.modelVersion,
        updatedAt: entry.updatedAt,
      };
    }
    return result;
  } catch (error: unknown) {
    const code = readErrorCode(error);
    if (code === "ENOENT") {
      return {};
    }
    console.warn(`[cache] Failed to load ${cachePath}:`, error);
    return {};
  }
}

async function writeCache(cachePath: string, data: CacheData): Promise<void> {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(cachePath, payload, "utf8");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const { code } = error as Partial<NodeJS.ErrnoException>;
  return typeof code === "string" ? code : undefined;
}

async function classifyBatch({
  files,
  options,
  cacheData,
  scheduleCacheWrite,
}: {
  files: SampleFile[];
  options: CliOptions;
  cacheData: CacheData;
  scheduleCacheWrite: () => void;
}): Promise<JobResult[]> {
  if (files.length === 0) {
    return [];
  }
  return runJobsWithConcurrency<SampleFile, JobResult>({
    items: files,
    concurrency: Math.min(options.concurrency, MAX_CONCURRENCY),
    getId: (item) => item.relativePath,
    handler: async (file, context) => {
      const prompt = buildPrompt();
      try {
        const buffer = await readFile(file.sourcePath);
        const parts: Part[] = [buildFilePart(file, buffer), { text: prompt }];
        const classificationData = await callGeminiJson({
          parts,
          label: file.relativePath,
          progress: context.progress,
        });
        const classification = normaliseClassification(classificationData);
        if (!options.dryRun) {
          cacheData[file.relativePath] = {
            classification,
            modelVersion: GEMINI_MODEL_ID,
            updatedAt: new Date().toISOString(),
          };
          scheduleCacheWrite();
        }
        return {
          file,
          classification,
          modelVersion: GEMINI_MODEL_ID,
        } satisfies JobResult;
      } catch (error: unknown) {
        const message = formatError(error);
        context.progress.log(`Failed ${file.relativePath}: ${message}`);
        return { file, error };
      }
    },
    label: "Classify",
    updateIntervalMs: 750,
  });
}

function derivePageBucket(
  numberOfPages?: number,
): (typeof PAGE_BUCKETS)[number] {
  if (typeof numberOfPages !== "number" || !Number.isFinite(numberOfPages)) {
    return "50plus_pages";
  }
  const value = Math.max(1, Math.floor(numberOfPages));
  if (value <= 1) {
    return "01_page";
  }
  if (value <= 4) {
    return "02-to-04_pages";
  }
  if (value <= 9) {
    return "05-to-09_pages";
  }
  if (value <= 19) {
    return "10-to-19_pages";
  }
  if (value <= 49) {
    return "20-to-49_pages";
  }
  return "50plus_pages";
}

function normaliseClassification(value: RawClassification): Classification {
  const pageBucket = derivePageBucket(value.numberOfPages);
  return {
    ...value,
    numberOfPages: value.numberOfPages,
    examBoard: value.examBoard,
    gradeBucket: value.gradeBucket,
    materialType: value.materialType,
    shortName: value.shortName,
    pageBucket,
  };
}

function bucketToPath(bucket: Classification["pageBucket"]): string {
  return bucket;
}

function boardToPath(board: Classification["examBoard"]): string {
  return board;
}

function gradeToPath(grade: Classification["gradeBucket"]): string {
  return grade;
}

function typeToPath(materialType: Classification["materialType"]): string {
  return materialType;
}

function buildTargetFileName(shortName: string, ext: string): string {
  const extension = ext && ext.startsWith(".") ? ext : ext ? `.${ext}` : "";
  return `${shortName}${extension}`;
}

async function placeFile({
  file,
  classification,
  options,
}: {
  file: SampleFile;
  classification: Classification;
  options: CliOptions;
}): Promise<{ placedPath: string } | undefined> {
  const bucketDir = bucketToPath(classification.pageBucket);
  const boardDir = boardToPath(classification.examBoard);
  const gradeDir = gradeToPath(classification.gradeBucket);
  const typeDir = typeToPath(classification.materialType);
  const targetDir = join(options.dst, bucketDir, boardDir, gradeDir, typeDir);
  const desiredName = buildTargetFileName(classification.shortName, file.ext);
  const destination = await ensureUniquePath(
    targetDir,
    desiredName,
    file.relativePath,
    !options.dryRun,
  );
  if (options.dryRun) {
    return { placedPath: destination };
  }
  await mkdir(targetDir, { recursive: true });
  await rmIfExists(destination);
  switch (options.mode) {
    case "link": {
      const relPath = relative(dirname(destination), file.sourcePath);
      await symlink(relPath, destination);
      break;
    }
    case "copy": {
      await copyFile(file.sourcePath, destination);
      break;
    }
    case "move": {
      await copyFile(file.sourcePath, destination);
      await rm(file.sourcePath);
      break;
    }
  }
  return { placedPath: destination };
}

async function rmIfExists(target: string): Promise<void> {
  try {
    await rm(target, { force: true });
  } catch (error: unknown) {
    const code = readErrorCode(error);
    if (code !== "ENOENT") {
      throw error;
    }
  }
}

async function ensureUniquePath(
  dir: string,
  baseName: string,
  rel: string,
  createDirs: boolean,
): Promise<string> {
  if (createDirs) {
    await mkdir(dir, { recursive: true });
  }
  let candidate = join(dir, baseName);
  if (!(await pathExists(candidate))) {
    return candidate;
  }
  const { name, ext } = splitName(baseName);
  const hash = makeHash(rel).slice(0, 8);
  candidate = join(dir, `${name}-${hash}${ext}`);
  return candidate;
}

function splitName(fileName: string): { name: string; ext: string } {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0) {
    return { name: fileName, ext: "" };
  }
  return { name: fileName.slice(0, idx), ext: fileName.slice(idx) };
}

function makeHash(input: string): string {
  return Buffer.from(input)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 16);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeIndex(
  classified: ClassifiedSample[],
  outputDir: string,
): Promise<void> {
  const header = [
    "original",
    "rel",
    "pageBucket",
    "examBoard",
    "gradeBucket",
    "materialType",
    "summary",
    "confidence",
    "numberOfPages",
    "shortName",
  ];
  const rows = classified.map((entry) => {
    const { file, classification } = entry;
    return [
      csvEscape(file.sourcePath),
      csvEscape(file.relativePath),
      csvEscape(classification.pageBucket),
      csvEscape(classification.examBoard),
      csvEscape(classification.gradeBucket),
      csvEscape(classification.materialType),
      csvEscape(classification.summary),
      csvEscape(classification.confidence),
      csvEscape(
        classification.numberOfPages !== undefined
          ? String(classification.numberOfPages)
          : "",
      ),
      csvEscape(classification.shortName),
    ].join(",");
  });
  const content = `${header.join(",")}\n${rows.join("\n")}\n`;
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "_index.csv"), content, "utf8");
}

function csvEscape(value: string): string {
  const safe = value.replace(/"/g, '""');
  return `"${safe}"`;
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function formatCountEntries(
  map: Map<string, number>,
  { sortByKey = false }: { sortByKey?: boolean } = {},
): [string, number][] {
  const entries = Array.from(map.entries());
  if (sortByKey) {
    return entries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return entries.sort((a, b) => {
    const diff = b[1] - a[1];
    return diff !== 0 ? diff : a[0].localeCompare(b[0]);
  });
}

function printCountSection({
  label,
  map,
  sortByKey = false,
}: {
  label: string;
  map: Map<string, number>;
  sortByKey?: boolean;
}): void {
  if (map.size === 0) {
    console.log(`  - ${label}: none`);
    return;
  }
  console.log(`  - ${label}:`);
  const total = Array.from(map.values()).reduce((sum, value) => sum + value, 0);
  for (const [key, count] of formatCountEntries(map, { sortByKey })) {
    const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
    console.log(`    ${key}: ${count.toString()} (${percentage.toString()}%)`);
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv);
  if (!existsSync(options.src)) {
    throw new Error(`Source directory not found: ${options.src}`);
  }
  await mkdir(options.dst, { recursive: true });
  const files = await collectSampleFiles(options.src);
  if (files.length === 0) {
    console.log("No files found to classify.");
    return;
  }
  const cachePath = join(options.src, CACHE_FILE_NAME);
  const errorLogPath = join(options.src, ERROR_LOG_FILE_NAME);
  const cacheData = await loadCache(cachePath);
  const alreadyClassified: ClassifiedSample[] = [];
  const pending: SampleFile[] = [];

  for (const file of files) {
    const cached = cacheData[file.relativePath];
    if (!cached) {
      pending.push(file);
      continue;
    }
    try {
      const classification = normaliseClassification(cached.classification);
      alreadyClassified.push({ file, classification });
    } catch (error: unknown) {
      console.warn(
        `[cache] Discarding invalid cache entry for ${file.relativePath}:`,
        error,
      );
      cacheData[file.relativePath] = undefined;
      pending.push(file);
    }
  }

  let cacheWriteChain: Promise<void> = Promise.resolve();
  const scheduleCacheWrite = (): void => {
    const snapshot = JSON.parse(JSON.stringify(cacheData)) as CacheData;
    cacheWriteChain = cacheWriteChain
      .then(() => writeCache(cachePath, snapshot))
      .catch((error: unknown) => {
        console.error(`[cache] Failed to write ${cachePath}:`, error);
      });
  };

  const newlyClassified: ClassifiedSample[] = [];
  const failures: JobResult[] = [];
  const accumulate = (results: JobResult[]): void => {
    for (const result of results) {
      if (result.classification) {
        newlyClassified.push({
          file: result.file,
          classification: result.classification,
        });
      }
      if (result.error) {
        failures.push(result);
      }
    }
  };

  const initialResults = await classifyBatch({
    files: pending,
    options,
    cacheData,
    scheduleCacheWrite,
  });
  accumulate(initialResults);

  let retriedCount = 0;
  let retrySuccessCount = 0;
  if (options.retryFailed && failures.length > 0) {
    const retryTargets = failures.map((result) => result.file);
    retriedCount = retryTargets.length;
    console.log(
      `Retrying ${retriedCount.toString()} failed file${retriedCount === 1 ? "" : "s"}...`,
    );
    failures.length = 0;
    const retryResults = await classifyBatch({
      files: retryTargets,
      options,
      cacheData,
      scheduleCacheWrite,
    });
    retrySuccessCount = retryResults.filter(
      (result) => result.classification,
    ).length;
    accumulate(retryResults);
  }

  if (!options.dryRun) {
    await cacheWriteChain;
  }

  const allClassified = [...alreadyClassified, ...newlyClassified];

  const boardCounts = new Map<string, number>();
  const gradeCounts = new Map<string, number>();
  const materialCounts = new Map<string, number>();
  const pageBucketCounts = new Map<string, number>();

  for (const entry of allClassified) {
    const { classification } = entry;
    incrementCount(boardCounts, boardToPath(classification.examBoard));
    incrementCount(gradeCounts, gradeToPath(classification.gradeBucket));
    incrementCount(materialCounts, typeToPath(classification.materialType));
    incrementCount(pageBucketCounts, bucketToPath(classification.pageBucket));
  }

  const placed: ClassifiedSample[] = [];
  for (const entry of allClassified) {
    const placement = await placeFile({
      file: entry.file,
      classification: entry.classification,
      options,
    });
    if (placement) {
      placed.push(entry);
    }
  }

  if (!options.dryRun) {
    await cacheWriteChain;
  }
  await writeIndex(placed, options.dst);

  const cachedCount = alreadyClassified.length;
  const newCount = newlyClassified.length;
  const processedCount = placed.length;
  console.log(
    `\nProcessed ${processedCount.toString()} files (cached ${cachedCount.toString()}, new ${newCount.toString()}). Output directory: ${options.dst}`,
  );
  if (!options.dryRun && (cachedCount > 0 || newCount > 0)) {
    console.log(`Cache file: ${cachePath}`);
  }
  if (options.dryRun) {
    console.log(
      "Dry run mode: no filesystem changes were made and cache was not updated.",
    );
  }
  if (allClassified.length > 0) {
    console.log(
      `Category breakdown (${allClassified.length.toString()} classified files):`,
    );
    printCountSection({ label: "Boards", map: boardCounts });
    printCountSection({ label: "Grade buckets", map: gradeCounts });
    printCountSection({ label: "Material types", map: materialCounts });
    printCountSection({
      label: "Page buckets",
      map: pageBucketCounts,
      sortByKey: true,
    });
  }
  if (retriedCount > 0) {
    console.log(
      `Retry completed: ${retriedCount.toString()} attempted, ${retrySuccessCount.toString()} succeeded on retry.`,
    );
  }
  if (failures.length > 0) {
    let errorLogWritten = false;
    const logLines = failures
      .map(
        (failure) =>
          `[${new Date().toISOString()}] ${failure.file.relativePath}: ${formatError(
            failure.error,
          )}`,
      )
      .join("\n");
    if (!options.dryRun) {
      await writeFile(errorLogPath, `${logLines}\n`, "utf8");
      errorLogWritten = true;
    }
    const destinationNote = errorLogWritten
      ? `Details written to ${errorLogPath}.`
      : `Details would be written to ${errorLogPath} (dry run).`;
    console.warn(
      `Skipped ${failures.length.toString()} files due to classification errors. ${destinationNote}`,
    );
  }
}

void main().catch((error: unknown) => {
  console.error("Classification failed:", error);
  process.exit(1);
});
