import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { z } from "zod";

import {
  createCliCommand,
  createIntegerParser,
  splitCommaSeparated,
} from "../utils/cli";
import { WORKSPACE_PATHS, ensureEvalEnvLoaded } from "../utils/paths";

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

interface DownloadedProblem extends ProblemSummary {
  readonly slug: string;
  readonly fetchedAt: string;
  readonly link: string;
}

ensureEvalEnvLoaded();

// Save into the shared spark-data workspace for code downloads
const OUTPUT_DIR = path.join(WORKSPACE_PATHS.codeDownloadsDir, "leetcode");
const DEFAULT_LIMIT = 5;
const USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "download-leetcode",
    "Download LeetCode problems into spark-data/code/downloads",
  );

  program
    .option(
      "--limit <number>",
      "Number of problems to download when slugs are not specified",
      createIntegerParser({ name: "limit", min: 1 }),
      DEFAULT_LIMIT,
    )
    .option(
      "--slug <slug>",
      "Download a specific problem slug (repeatable)",
      collectSlug,
      [] as string[],
    )
    .option(
      "--slugs <list>",
      "Comma separated list of slugs to download",
      collectSlugList,
      [] as string[],
    )
    .option("--force", "Re-download problems that already exist");

  const parsed = program.parse(argv, { from: "user" }).opts<{
    limit: number;
    slug: string[];
    slugs: string[];
    force?: boolean;
  }>();

  const combinedSlugs = [...(parsed.slug ?? []), ...(parsed.slugs ?? [])]
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
  const uniqueSlugs =
    combinedSlugs.length > 0 ? Array.from(new Set(combinedSlugs)) : undefined;

  return {
    limit: parsed.limit ?? DEFAULT_LIMIT,
    slugs: uniqueSlugs,
    skipExisting: parsed.force !== true,
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
      `Failed to fetch problem list: ${response.status} ${response.statusText}`,
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
      `Failed to fetch problem ${slug}: ${response.status} ${response.statusText}`,
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
  const options = parseCliOptions(process.argv);
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
        `Saved ${slug} to ${path.relative(process.cwd(), outputPath)}`,
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
