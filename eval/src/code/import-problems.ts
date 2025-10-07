import { Buffer } from "node:buffer";
import { access, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import {
  cert,
  getApps,
  initializeApp,
  type ServiceAccount,
} from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { z } from "zod";

import {
  buildCodeProblemExtractionRequest,
  parseCodeProblemExtractionResponse,
  CODE_PROBLEM_EXTRACTION_MODEL_ID,
  CODE_PROBLEM_RESPONSE_SCHEMA,
  type CodeProblemExtraction,
  type CodeProblemExtractionRequest,
} from "@spark/llm/code";
import { runGeminiCall } from "@spark/llm/utils/gemini";
import {
  runJobsWithConcurrency,
  type JobProgressReporter,
  type StatusMode,
} from "../utils/concurrency";
import {
  createCliCommand,
  createIntegerParser,
  parseStatusModeOption,
  splitCommaSeparated,
} from "../utils/cli";
import { WORKSPACE_PATHS, ensureEvalEnvLoaded } from "../utils/paths";

interface ProblemFile {
  readonly slug: string;
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface CliOptions {
  readonly dryRun: boolean;
  readonly slugs: readonly string[];
  readonly concurrency: number;
  readonly statusMode: StatusMode;
}

interface FirestorePayload {
  readonly slug: string;
  readonly title: string;
  readonly difficulty: CodeProblemExtraction["difficulty"];
  readonly topics: readonly string[];
  readonly description: string;
  readonly inputFormat: string;
  readonly constraints: readonly string[];
  readonly examples: CodeProblemExtraction["examples"];
  readonly tests: CodeProblemExtraction["tests"];
  readonly hints: CodeProblemExtraction["hints"];
  readonly solution: {
    readonly language: "python";
    readonly code: string;
  };
  readonly metadataVersion: number;
}

const cliOptionsSchema = z.object({
  dryRun: z.boolean(),
  slugs: z.array(z.string().min(1)).default([]),
  concurrency: z.number().int().min(1).max(16).default(4),
  statusMode: z.enum(["interactive", "plain", "off"]).default("interactive"),
});

const METADATA_VERSION = 2;

ensureEvalEnvLoaded();

const REPO_ROOT = WORKSPACE_PATHS.repoRoot;
const SYNTHETIC_DIR = WORKSPACE_PATHS.codeSyntheticDir;

const serviceAccountSchema = z
  .object({
    project_id: z.string().min(1),
    client_email: z.string().email(),
    private_key: z.string().min(1),
  })
  .transform(({ project_id, client_email, private_key }) => ({
    projectId: project_id,
    clientEmail: client_email,
    privateKey: private_key.replace(/\\n/g, "\n"),
  }));

function parseCliArgs(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "import-problems",
    "Extract synthetic code problems and publish them to Firestore",
  );

  program
    .option("--dry-run", "Skip Firestore writes; print progress only")
    .option(
      "--slug <slug>",
      "Import a specific problem slug (repeatable)",
      collectSlug,
      [] as string[],
    )
    .option(
      "--slugs <list>",
      "Comma separated list of slugs to import",
      collectSlugList,
      [] as string[],
    )
    .option(
      "--concurrency <number>",
      "Maximum parallel jobs (1-16)",
      createIntegerParser({ name: "concurrency", min: 1, max: 16 }),
    )
    .option(
      "--status <mode>",
      "Progress display mode: interactive | plain | off",
      parseStatusModeOption,
    );

  const parsed = program.parse(argv, { from: "user" }).opts<{
    dryRun?: boolean;
    slug: string[];
    slugs: string[];
    concurrency?: number;
    status?: StatusMode;
  }>();

  const combinedSlugs = [...(parsed.slug ?? []), ...(parsed.slugs ?? [])]
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  const uniqueSlugs = Array.from(new Set(combinedSlugs));

  const result = cliOptionsSchema.parse({
    dryRun: parsed.dryRun ?? false,
    slugs: uniqueSlugs,
    concurrency: parsed.concurrency,
    statusMode: parsed.status,
  });

  return {
    dryRun: result.dryRun,
    slugs: result.slugs,
    concurrency: result.concurrency,
    statusMode: result.statusMode,
  } satisfies CliOptions;
}

function collectSlug(value: string, previous: string[]): string[] {
  const existing = previous ?? [];
  existing.push(value);
  return existing;
}

function collectSlugList(value: string, previous: string[]): string[] {
  const existing = previous ?? [];
  existing.push(...splitCommaSeparated(value));
  return existing;
}

async function discoverProblemFiles(): Promise<ProblemFile[]> {
  const entries = await fsReaddirSafe(SYNTHETIC_DIR);
  const problems: ProblemFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const slug = entry.name;
    const problemPath = path.join(SYNTHETIC_DIR, slug, "problem.md");
    const exists = await fileExists(problemPath);
    if (!exists) {
      continue;
    }
    const relativePath = path.relative(REPO_ROOT, problemPath);
    problems.push({
      slug,
      absolutePath: problemPath,
      relativePath,
    });
  }
  problems.sort((a, b) => a.slug.localeCompare(b.slug));
  return problems;
}

async function fsReaddirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Failed to read directory: ${dir}`, { cause: error });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function initialiseFirestore(): Firestore {
  const rawServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawServiceAccount) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON must be set to import problems",
    );
  }
  const parsedServiceAccount = serviceAccountSchema.parse(
    JSON.parse(rawServiceAccount),
  );
  const credential: ServiceAccount = {
    projectId: parsedServiceAccount.projectId,
    clientEmail: parsedServiceAccount.clientEmail,
    privateKey: parsedServiceAccount.privateKey,
  };
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(credential),
      projectId: credential.projectId,
    });
  }
  return getFirestore();
}

function buildFirestorePayload(options: {
  readonly slug: string;
  readonly extracted: CodeProblemExtraction;
}): FirestorePayload {
  const { slug, extracted } = options;
  return {
    slug,
    title: extracted.title,
    difficulty: extracted.difficulty,
    topics: extracted.topics,
    description: extracted.description,
    inputFormat: extracted.inputFormat,
    constraints: extracted.constraints,
    examples: extracted.examples,
    tests: extracted.tests,
    hints: extracted.hints,
    solution: {
      language: "python",
      code: extracted.solutionCode,
    },
    metadataVersion: METADATA_VERSION,
  };
}

async function callExtractionModel(
  request: CodeProblemExtractionRequest,
  progress: JobProgressReporter,
): Promise<string> {
  const uploadBytes = Buffer.byteLength(request.prompt, "utf8");
  const handle = progress.startModelCall({
    modelId: request.modelId,
    uploadBytes,
  });
  try {
    const response = await runGeminiCall((client) =>
      client.models.generateContent({
        model: request.modelId,
        contents: [
          {
            role: "user",
            parts: request.parts,
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: CODE_PROBLEM_RESPONSE_SCHEMA,
        },
      }),
    );
    const usage = response.usageMetadata;
    if (usage) {
      const promptTokens = usage.promptTokenCount ?? 0;
      const cachedTokens = usage.cachedContentTokenCount ?? 0;
      const inferenceTokens =
        (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
      if (promptTokens > 0 || cachedTokens > 0 || inferenceTokens > 0) {
        progress.recordModelUsage(handle, {
          promptTokensDelta: promptTokens,
          cachedTokensDelta: cachedTokens,
          inferenceTokensDelta: inferenceTokens,
          timestamp: Date.now(),
        });
      }
    }
    const text = response.text ?? "";
    progress.reportChars(text.length);
    if (!text.trim()) {
      throw new Error("Gemini returned an empty response");
    }
    return text;
  } finally {
    progress.finishModelCall(handle);
  }
}

async function importProblem(
  firestore: Firestore | null,
  problemFile: ProblemFile,
  options: CliOptions,
  progress: JobProgressReporter,
): Promise<FirestorePayload> {
  progress.log("Reading markdown source");
  const markdown = await readFile(problemFile.absolutePath, "utf8");

  progress.log("Building Gemini request");
  const request = buildCodeProblemExtractionRequest({
    slug: problemFile.slug,
    markdown,
    modelId: CODE_PROBLEM_EXTRACTION_MODEL_ID,
  });

  progress.log("Prompting Gemini for structured metadata");
  const responseText = await callExtractionModel(request, progress);

  progress.log("Parsing Gemini JSON payload");
  const extracted = parseCodeProblemExtractionResponse(responseText);

  const payload = buildFirestorePayload({
    slug: problemFile.slug,
    extracted,
  });

  progress.log(`Title: ${payload.title}`);
  const headlineTopic = payload.topics[0] ?? "Unknown topic";
  progress.log(`Difficulty: ${payload.difficulty} | Lead topic: ${headlineTopic}`);
  if (payload.topics.length > 0) {
    progress.log(`Topics: ${payload.topics.join(", ")}`);
  }

  if (options.dryRun || !firestore) {
    progress.log("Dry run enabled — skipping Firestore write");
    return payload;
  }

  progress.log("Writing document to Firestore");
  const docRef = firestore.collection("code").doc(problemFile.slug);
  const snapshot = await docRef.get();

  const timestamp = FieldValue.serverTimestamp();
  const data = {
    ...payload,
    updatedAt: timestamp,
    importedAt: timestamp,
    ...(snapshot.exists ? {} : { createdAt: timestamp }),
  };

  await docRef.set(data, { merge: true });
  progress.log(`Saved to code/${problemFile.slug}`);
  return payload;
}

async function main(): Promise<void> {
  const cliOptions = parseCliArgs(process.argv);

  const problems = await discoverProblemFiles();
  const selected =
    cliOptions.slugs.length > 0
      ? problems.filter((problem) => cliOptions.slugs.includes(problem.slug))
      : problems;

  if (cliOptions.slugs.length > 0) {
    const available = new Set(problems.map((problem) => problem.slug));
    const missing = cliOptions.slugs.filter((slug) => !available.has(slug));
    if (missing.length > 0) {
      console.warn(`No markdown files found for slugs: ${missing.join(", ")}`);
    }
  }

  if (selected.length === 0) {
    console.log("[code] No problems matched the requested filters");
    return;
  }

  console.log(
    `[code] Importing ${selected.length} problem${
      selected.length === 1 ? "" : "s"
    } (dryRun=${cliOptions.dryRun ? "yes" : "no"}, concurrency=${cliOptions.concurrency})`,
  );

  const firestore = cliOptions.dryRun ? null : initialiseFirestore();

  const results = await runJobsWithConcurrency<ProblemFile, FirestorePayload>({
    items: selected,
    concurrency: cliOptions.concurrency,
    getId: (item) => item.slug,
    label: "[code]",
    statusMode: cliOptions.statusMode,
    handler: async (problem, { progress }) => {
      try {
        return await importProblem(firestore, problem, cliOptions, progress);
      } catch (error) {
        const message = formatUnknownError(error);
        progress.log(`ERROR Failed to import ${problem.slug}: ${message}`);
        throw error;
      }
    },
  });

  console.log(
    `[code] Import complete (${results.length} processed, dryRun=${cliOptions.dryRun ? "yes" : "no"})`,
  );
}

void main().catch((error) => {
  console.error("Unhandled error during problem import", error);
  process.exitCode = 1;
});

function formatUnknownError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "unknown error";
  }
}
