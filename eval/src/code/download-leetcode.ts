import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

interface CliOptions {
  readonly limit: number;
  readonly slugs?: string[];
  readonly skipExisting: boolean;
}

// Shape used by our saved JSON artifacts
interface ProblemSummary {
  readonly questionFrontendId: string;
  readonly title: string;
  readonly content: string;
  readonly difficulty: string;
  readonly topicTags: readonly string[];
}

// Shape returned by LeetCode GraphQL API for a question
interface GraphQuestion {
  readonly questionFrontendId: string;
  readonly title: string;
  readonly content: string;
  readonly difficulty: string;
  readonly topicTags: readonly { name: string }[];
}

interface DownloadedProblem extends ProblemSummary {
  readonly slug: string;
  readonly fetchedAt: string;
  readonly link: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Save into the shared spark-data workspace for code downloads
const OUTPUT_DIR = path.resolve(
  __dirname,
  "../../../spark-data/code/dowloads/leetcode"
);
const DEFAULT_LIMIT = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function parseArgs(argv: readonly string[]): CliOptions {
  let limit = DEFAULT_LIMIT;
  let slugs: string[] | undefined;
  let skipExisting = true;

  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.split("=", 2)[1] ?? "", 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = value;
      continue;
    }

    if (arg.startsWith("--slug=") || arg.startsWith("--slugs=")) {
      const value = arg.split("=", 2)[1];
      if (!value) {
        throw new Error(`Missing slug values in ${arg}`);
      }
      slugs = value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (slugs.length === 0) {
        throw new Error(`No valid slug values found in ${arg}`);
      }
      continue;
    }

    if (arg === "--force") {
      skipExisting = false;
      continue;
    }

    if (arg === "--help") {
      printHelpAndExit();
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { limit, slugs, skipExisting } satisfies CliOptions;
}

function printHelpAndExit(): never {
  console.log(
    `Usage: tsx src/code/download-leetcode.ts [options]\n\n` +
      `Options:\n` +
      `  --limit=<n>       Number of problems to download when slugs are not specified (default: ${DEFAULT_LIMIT}).\n` +
      `  --slugs=a,b,c     Comma separated list of problem slugs to download. Overrides --limit.\n` +
      `  --force           Re-download problems even if the output file already exists.\n` +
      `  --help            Show this help message and exit.`
  );
  process.exit(0);
}

const AllProblemsSchema = z.object({
  stat_status_pairs: z
    .array(z.object({ stat: z.object({ question__title_slug: z.string() }) }))
    .default([]),
});

async function fetchProblemSlugs(limit: number): Promise<string[]> {
  const response = await fetch("https://leetcode.com/api/problems/all/", {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://leetcode.com/problemset/all/",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch problem list: ${response.status} ${response.statusText}`
    );
  }

  const data = AllProblemsSchema.parse(await response.json());

  const slugs = data.stat_status_pairs
    .map((entry) => entry.stat.question__title_slug)
    .filter((slug) => typeof slug === "string" && slug.length > 0);

  return slugs.slice(0, limit);
}

const GraphQuestionSchema = z.object({
  questionFrontendId: z.string(),
  title: z.string(),
  content: z.string().catch(""),
  difficulty: z.string(),
  topicTags: z.array(z.object({ name: z.string() })),
});

const GraphQLResponseSchema = z.object({
  data: z
    .object({
      question: GraphQuestionSchema.nullish(),
    })
    .nullish(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});

async function fetchProblem(slug: string): Promise<DownloadedProblem> {
  const query = `
    query questionContent($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionFrontendId
        title
        content
        difficulty
        topicTags { name }
      }
    }
  `;

  const response = await fetch("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Referer: `https://leetcode.com/problems/${slug}/`,
    },
    body: JSON.stringify({
      query,
      variables: { titleSlug: slug },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch problem ${slug}: ${response.status} ${response.statusText}`
    );
  }

  const payload = GraphQLResponseSchema.parse(await response.json());

  if (payload.errors?.length) {
    const message = payload.errors
      .map((error) => error.message ?? "Unknown error")
      .join(", ");
    throw new Error(`LeetCode GraphQL error for ${slug}: ${message}`);
  }

  const question = payload.data?.question;
  if (!question) {
    throw new Error(`Question not found for slug: ${slug}`);
  }

  return {
    slug,
    questionFrontendId: question.questionFrontendId,
    title: question.title,
    content: question.content,
    difficulty: question.difficulty,
    topicTags: question.topicTags.map((tag) => tag.name),
    fetchedAt: new Date().toISOString(),
    link: `https://leetcode.com/problems/${slug}/`,
  } satisfies DownloadedProblem;
}

async function ensureOutputDir(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await ensureOutputDir();

  const slugs = options.slugs ?? (await fetchProblemSlugs(options.limit));
  if (slugs.length === 0) {
    console.warn("No slugs to download. Exiting.");
    return;
  }

  for (const slug of slugs) {
    const outputPath = path.join(OUTPUT_DIR, `${slug}.json`);

    if (options.skipExisting && (await fileExists(outputPath))) {
      console.log(`Skipping ${slug}, file already exists.`);
      continue;
    }

    try {
      console.log(`Downloading ${slug}...`);
      const problem = await fetchProblem(slug);
      const serialized = JSON.stringify(problem, null, 2);
      await writeFile(outputPath, serialized, { encoding: "utf8" });
      console.log(
        `Saved ${slug} to ${path.relative(process.cwd(), outputPath)}`
      );
    } catch (error) {
      console.error(`Failed to download ${slug}:`, error);
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
