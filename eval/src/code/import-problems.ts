import { Buffer } from "node:buffer";
import { access, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnvFile } from "dotenv";
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
} from "../quiz/concurrency";

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
  readonly summary: string;
  readonly summaryBullets: readonly string[];
  readonly difficulty: CodeProblemExtraction["difficulty"];
  readonly primaryTopic: string;
  readonly topics: readonly string[];
  readonly tags: readonly string[];
  readonly tasks: readonly string[];
  readonly constraints: readonly string[];
  readonly edgeCases: readonly string[];
  readonly hints: readonly string[];
  readonly followUpIdeas: readonly string[];
  readonly examples: CodeProblemExtraction["examples"];
  readonly solution: {
    readonly optimal: CodeProblemExtraction["optimalApproach"];
    readonly alternatives: CodeProblemExtraction["alternativeApproaches"];
  };
  readonly source: {
    readonly path: string;
    readonly markdown: string;
  };
  readonly metadataVersion: number;
}

const cliOptionsSchema = z.object({
  dryRun: z.boolean(),
  slugs: z.array(z.string().min(1)).default([]),
  concurrency: z.number().int().min(1).max(16).default(4),
  statusMode: z.enum(["interactive", "plain", "off"]).default("interactive"),
});

const METADATA_VERSION = 1;

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

function parseStatusMode(value: string): StatusMode {
  switch (value) {
    case "interactive":
    case "plain":
    case "off":
      return value;
    default:
      throw new Error(
        `Unsupported --status value "${value}" (expected interactive|plain|off)`,
      );
  }
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const slugs: string[] = [];
  let dryRun = false;
  let concurrency: number | undefined;
  let statusMode: StatusMode | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--slug") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--slug flag requires a value");
      }
      slugs.push(
        ...value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      );
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--concurrency flag requires a value");
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid concurrency value: ${value}`);
      }
      concurrency = parsed;
      index += 1;
      continue;
    }
    if (arg === "--status") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--status flag requires a value");
      }
      statusMode = parseStatusMode(value.trim().toLowerCase());
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    slugs.push(arg.trim());
  }

  const parsed = cliOptionsSchema.parse({
    dryRun,
    slugs,
    concurrency,
    statusMode,
  });
  return {
    dryRun: parsed.dryRun,
    slugs: parsed.slugs,
    concurrency: parsed.concurrency,
    statusMode: parsed.statusMode,
  };
}

function resolveRepoRoot(): string {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptPath);
  return path.resolve(scriptDir, "../../..");
}

async function discoverProblemFiles(root: string): Promise<ProblemFile[]> {
  const syntheticDir = path.join(root, "spark-data", "code", "synthetic");
  const entries = await fsReaddirSafe(syntheticDir);
  const problems: ProblemFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const slug = entry.name;
    const problemPath = path.join(syntheticDir, slug, "problem.md");
    const exists = await fileExists(problemPath);
    if (!exists) {
      continue;
    }
    const relativePath = path.relative(root, problemPath);
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

function ensureEnvLoaded(repoRoot: string): void {
  const envPaths = [
    path.join(repoRoot, ".env.local"),
    path.join(repoRoot, "eval", ".env.local"),
  ];
  for (const envPath of envPaths) {
    loadEnvFile({ path: envPath, override: false });
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
  readonly relativePath: string;
  readonly markdown: string;
  readonly extracted: CodeProblemExtraction;
}): FirestorePayload {
  const { slug, relativePath, markdown, extracted } = options;
  return {
    slug,
    title: extracted.title,
    summary: extracted.summary,
    summaryBullets: extracted.summaryBullets ?? [],
    difficulty: extracted.difficulty,
    primaryTopic: extracted.primaryTopic,
    topics: extracted.topics,
    tags: extracted.tags ?? [],
    tasks: extracted.tasks ?? [],
    constraints: extracted.constraints ?? [],
    edgeCases: extracted.edgeCases ?? [],
    hints: extracted.hints ?? [],
    followUpIdeas: extracted.followUpIdeas ?? [],
    examples: extracted.examples ?? [],
    solution: {
      optimal: extracted.optimalApproach,
      alternatives: extracted.alternativeApproaches ?? [],
    },
    source: {
      path: relativePath,
      markdown,
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
    relativePath: problemFile.relativePath,
    markdown,
    extracted,
  });

  progress.log(`Title: ${payload.title}`);
  progress.log(
    `Difficulty: ${payload.difficulty} | Primary topic: ${payload.primaryTopic}`,
  );
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
  const cliOptions = parseCliArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  ensureEnvLoaded(repoRoot);

  const problems = await discoverProblemFiles(repoRoot);
  const selected =
    cliOptions.slugs.length > 0
      ? problems.filter((problem) => cliOptions.slugs.includes(problem.slug))
      : problems;

  if (cliOptions.slugs.length > 0) {
    const available = new Set(problems.map((problem) => problem.slug));
    const missing = cliOptions.slugs.filter((slug) => !available.has(slug));
    if (missing.length > 0) {
      console.warn(
        `No markdown files found for slugs: ${missing.join(", ")}`,
      );
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
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
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
