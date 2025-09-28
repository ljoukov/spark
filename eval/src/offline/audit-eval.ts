import { Buffer } from "node:buffer";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { runGeminiCall } from "@spark/llm/utils/gemini";
import { QUIZ_EVAL_MODEL_ID } from "@spark/llm/judge";
import { runJobsWithConcurrency } from "./concurrency";
import type { JobProgressReporter } from "./concurrency";
import {
  JudgeAuditFilePayloadSchema,
  JudgeFilePayloadSchema,
  type JudgeAuditFilePayload,
  type JudgeFilePayload,
} from "./payload";
import { OFFLINE_PATHS } from "./env";

const {
  repoRoot: REPO_ROOT,
  evalOutputDir: EVAL_OUTPUT_DIR,
  auditReportDir: REPORT_DIR,
} = OFFLINE_PATHS;
const STATS_OUTPUT_PATH = path.join(REPORT_DIR, "stats.txt");
const FULL_SCORE_EPSILON = 1e-6;

const StageSchema = z.enum(["stats", "reports"]);
type Stage = z.infer<typeof StageSchema>;
const ALL_STAGES: readonly Stage[] = ["stats", "reports"];

type LoadedEvaluation = {
  readonly judgement: JudgeFilePayload;
  readonly audit?: JudgeAuditFilePayload;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly evaluationType: "quiz" | "extension";
};

type LoadResult = {
  readonly evaluations: LoadedEvaluation[];
  readonly warnings: string[];
};

type StatsLogger = {
  readonly log: (message: string) => void;
};

type ScoreDistributionEntry = {
  readonly bucket: string;
  readonly count: number;
  readonly percentage: number;
};

type EvaluationType = "quiz" | "extension";

type FailureCase = {
  readonly id: string;
  readonly evaluationType: EvaluationType;
  readonly jobName: string;
  readonly sourceDisplayName: string;
  readonly judgeExplanation: string;
  readonly judgeFindingJustification: string;
  readonly score: number;
  readonly auditExplanation: string;
  readonly auditConfidence: string;
};

type CriterionJob = {
  readonly criterion: string;
  readonly cases: FailureCase[];
};

function parseStages(argv: readonly string[]): Stage[] {
  const stageFlagIndex = argv.findIndex(
    (arg) => arg === "--stage" || arg.startsWith("--stage="),
  );
  if (stageFlagIndex === -1) {
    return [...ALL_STAGES];
  }
  let rawValue: string | undefined;
  const flag = argv[stageFlagIndex];
  if (flag === "--stage") {
    rawValue = argv[stageFlagIndex + 1];
  } else {
    rawValue = flag.slice("--stage=".length);
  }
  if (!rawValue) {
    throw new Error(
      '[audit-eval] Missing value for --stage. Expected comma-separated list or "all".',
    );
  }
  const normalised = rawValue.trim().toLowerCase();
  if (normalised === "all") {
    return [...ALL_STAGES];
  }
  const parts = normalised
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error("[audit-eval] --stage requires at least one entry.");
  }
  const stages = parts.map((part) => {
    try {
      return StageSchema.parse(part);
    } catch {
      throw new Error(
        '[audit-eval] Invalid stage value. Use "stats", "reports", or "all".',
      );
    }
  });
  return Array.from(new Set(stages));
}

function isFullScore(score: number): boolean {
  return Math.abs(score - 1) <= FULL_SCORE_EPSILON;
}

async function loadEvaluations(): Promise<LoadResult> {
  const results: LoadedEvaluation[] = [];
  const warnings: string[] = [];
  if (!existsSync(EVAL_OUTPUT_DIR)) {
    warnings.push(`output directory not found at ${EVAL_OUTPUT_DIR}`);
    return { evaluations: results, warnings };
  }
  const entries = await readdir(EVAL_OUTPUT_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sampleDir = path.join(EVAL_OUTPUT_DIR, entry.name);
    const sampleEntries = await readdir(sampleDir, { withFileTypes: true });
    for (const fileEntry of sampleEntries) {
      if (!fileEntry.isFile()) {
        continue;
      }
      if (!fileEntry.name.endsWith("-judgement.json")) {
        continue;
      }
      const filePath = path.join(sampleDir, fileEntry.name);
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JudgeFilePayloadSchema.parse(JSON.parse(raw));
        const evaluationType: EvaluationType = fileEntry.name.includes(
          "extension",
        )
          ? "extension"
          : "quiz";
        const auditFilePath = filePath.replace(/\.json$/u, "-audit.json");
        let auditPayload: JudgeAuditFilePayload | undefined;
        if (existsSync(auditFilePath)) {
          const auditRaw = await readFile(auditFilePath, "utf8");
          auditPayload = JudgeAuditFilePayloadSchema.parse(
            JSON.parse(auditRaw),
          );
        } else if (parsed.audit?.auditedAt) {
          auditPayload = {
            id: parsed.id,
            evaluationType,
            evaluatedAt: parsed.evaluatedAt,
            auditedAt: parsed.audit.auditedAt,
            source: parsed.source,
            job: parsed.job,
            judge: parsed.judge,
            audit: {
              model: parsed.audit.model,
              result: parsed.audit.result,
            },
          };
        }
        results.push({
          judgement: parsed,
          audit: auditPayload,
          absolutePath: filePath,
          relativePath: path
            .relative(EVAL_OUTPUT_DIR, filePath)
            .split(path.sep)
            .join("/"),
          evaluationType,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`unable to read ${filePath}: ${message}`);
      }
    }
  }
  return { evaluations: results, warnings };
}

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function summariseEvaluations(
  evaluations: LoadedEvaluation[],
  logger: StatsLogger,
): void {
  if (evaluations.length === 0) {
    logger.log("[analysis] No judgement files found.");
    return;
  }

  logger.log(
    `[analysis] Processed ${evaluations.length} judgement file${evaluations.length === 1 ? "" : "s"}.`,
  );

  const evaluationsWithAudit = evaluations.filter((evaluation) =>
    Boolean(evaluation.audit),
  );
  const missingAuditCount = evaluations.length - evaluationsWithAudit.length;
  if (evaluationsWithAudit.length === 0) {
    logger.log(
      "[analysis] No audit data available; skipping combined metrics.",
    );
    return;
  }
  if (missingAuditCount > 0) {
    logger.log(
      `[analysis] Missing audit files for ${missingAuditCount} judgement${missingAuditCount === 1 ? "" : "s"}.`,
    );
  }

  const perfectEvaluations = evaluationsWithAudit.filter((evaluation) => {
    const audit = evaluation.audit;
    if (!audit) {
      return false;
    }
    return (
      evaluation.judgement.judge.verdict.verdict === "approve" &&
      audit.audit.result.verdictAgreement === "agree" &&
      audit.audit.result.confidence === "high"
    );
  });
  const perfectPercentage =
    evaluationsWithAudit.length === 0
      ? 0
      : (perfectEvaluations.length / evaluationsWithAudit.length) * 100;
  logger.log(
    `[analysis] Perfect (approve + agree + high confidence): ${perfectEvaluations.length}/${evaluationsWithAudit.length} (${formatPercentage(perfectPercentage)}).`,
  );

  const agreedEvaluations = evaluationsWithAudit.filter(
    (evaluation) => evaluation.audit?.audit.result.verdictAgreement === "agree",
  );
  const flaggedEvaluations = evaluationsWithAudit.filter(
    (evaluation) => evaluation.audit?.audit.result.verdictAgreement !== "agree",
  );
  const highConfidenceAgreed = evaluationsWithAudit.filter(
    (evaluation) =>
      evaluation.audit?.audit.result.verdictAgreement === "agree" &&
      evaluation.audit?.audit.result.confidence === "high",
  );

  printJudgementMetrics("Auditor agreed", agreedEvaluations, logger);
  printJudgementMetrics(
    "Auditor flagged follow-up",
    flaggedEvaluations,
    logger,
  );
  printHighConfidenceBreakdown(highConfidenceAgreed, logger);
}

function printJudgementMetrics(
  label: string,
  evaluations: LoadedEvaluation[],
  logger: StatsLogger,
): void {
  const total = evaluations.length;
  logger.log(
    `[analysis] ${label}: ${total} evaluation${total === 1 ? "" : "s"}.`,
  );
  if (total === 0) {
    logger.log("  - None");
    return;
  }

  let issueCount = 0;
  let nonFullScoreCount = 0;
  const nonFullScoreBuckets = new Map<string, number>();

  for (const evaluation of evaluations) {
    const verdict = evaluation.judgement.judge.verdict.verdict;
    if (verdict !== "approve") {
      issueCount += 1;
    }
    for (const finding of evaluation.judgement.judge.verdict.rubricFindings) {
      if (isFullScore(finding.score)) {
        continue;
      }
      nonFullScoreCount += 1;
      const roundedScore = Math.floor(finding.score * 10) / 10;
      const bucket = roundedScore.toFixed(1);
      nonFullScoreBuckets.set(
        bucket,
        (nonFullScoreBuckets.get(bucket) ?? 0) + 1,
      );
    }
  }

  const issuePercentage = total === 0 ? 0 : (issueCount / total) * 100;
  logger.log(
    `  - Quizzes with judge issues: ${issueCount} (${formatPercentage(issuePercentage)}).`,
  );

  if (nonFullScoreCount === 0) {
    logger.log("  - Non-1.0 rubric scores: none");
    return;
  }
  logger.log("  - Non-1.0 rubric scores (rounded to 0.1 increments):");
  const distribution: ScoreDistributionEntry[] = Array.from(
    nonFullScoreBuckets.entries(),
  )
    .map(([bucket, count]) => ({
      bucket,
      count,
      percentage: (count / nonFullScoreCount) * 100,
    }))
    .sort((a, b) => Number.parseFloat(b.bucket) - Number.parseFloat(a.bucket));

  for (const entry of distribution) {
    logger.log(
      `    - ${entry.bucket}: ${formatPercentage(entry.percentage)} (${entry.count}/${nonFullScoreCount})`,
    );
  }
}

function printHighConfidenceBreakdown(
  evaluations: LoadedEvaluation[],
  logger: StatsLogger,
): void {
  logger.log(
    `[analysis] High-confidence agreements: ${evaluations.length} evaluation${evaluations.length === 1 ? "" : "s"}.`,
  );
  if (evaluations.length === 0) {
    logger.log("  - None");
    return;
  }
  const breakdown = new Map<
    string,
    {
      total: number;
      buckets: Map<string, number>;
    }
  >();
  for (const evaluation of evaluations) {
    for (const finding of evaluation.judgement.judge.verdict.rubricFindings) {
      if (isFullScore(finding.score)) {
        continue;
      }
      const entry = breakdown.get(finding.criterion) ?? {
        total: 0,
        buckets: new Map<string, number>(),
      };
      entry.total += 1;
      const bucketValue = Math.floor(finding.score * 10) / 10;
      const bucket = bucketValue.toFixed(1);
      entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1);
      breakdown.set(finding.criterion, entry);
    }
  }
  const criteria = Array.from(breakdown.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  if (criteria.length === 0) {
    logger.log("  - All rubric scores are 1.0");
    return;
  }
  for (const [criterion, data] of criteria) {
    logger.log(`  - ${criterion}:`);
    const buckets = Array.from(data.buckets.entries()).sort(
      (a, b) => Number.parseFloat(b[0]) - Number.parseFloat(a[0]),
    );
    for (const [bucket, count] of buckets) {
      const percentage = data.total === 0 ? 0 : (count / data.total) * 100;
      logger.log(
        `    - ${bucket}: ${formatPercentage(percentage)} (${count}/${data.total})`,
      );
    }
  }
}

function slugifyCriterion(criterion: string): string {
  return (
    criterion
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "criterion"
  );
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function buildPrompt(criterion: string, cases: FailureCase[]): string {
  const sections = cases
    .map((failure) => {
      return [
        "<case>",
        `<id>${failure.id}</id>`,
        `<type>${failure.evaluationType}</type>`,
        `<job>${failure.jobName}</job>`,
        `<source>${failure.sourceDisplayName}</source>`,
        `<score>${formatScore(failure.score)}</score>`,
        `<judge_explanation>${failure.judgeExplanation}</judge_explanation>`,
        `<rubric_finding>${failure.judgeFindingJustification}</rubric_finding>`,
        `<audit_explanation>${failure.auditExplanation}</audit_explanation>`,
        `<audit_confidence>${failure.auditConfidence}</audit_confidence>`,
        "</case>",
      ].join("\n");
    })
    .join("\n");
  return [
    `<task>You are Spark's curriculum QA lead. Analyse the failing cases for the rubric "${criterion}". Produce a concise Markdown report that summarises recurring issues, highlights specific examples, and recommends concrete fixes for quiz authors.</task>`,
    "<output_format>Return Markdown with sections for summary, illustrative examples, and recommended improvements that map back to the rubric dimension.</output_format>",
    "<cases>",
    sections,
    "</cases>",
  ].join("\n\n");
}

async function callModel(
  prompt: string,
  progress: JobProgressReporter,
): Promise<string> {
  const uploadBytes = Buffer.byteLength(prompt, "utf8");
  const handle = progress.startModelCall({
    modelId: QUIZ_EVAL_MODEL_ID,
    uploadBytes,
  });
  try {
    const response = await runGeminiCall((client) =>
      client.models.generateContent({
        model: QUIZ_EVAL_MODEL_ID,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: {
          responseMimeType: "text/plain",
          temperature: 0.35,
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
    return text;
  } finally {
    progress.finishModelCall(handle);
  }
}

function collectFailureCases(
  evaluations: readonly LoadedEvaluation[],
): Map<string, FailureCase[]> {
  const map = new Map<string, FailureCase[]>();
  for (const evaluation of evaluations) {
    const audit = evaluation.audit;
    if (!audit) {
      continue;
    }
    if (evaluation.judgement.judge.verdict.verdict !== "revise") {
      continue;
    }
    const auditResult = audit.audit.result;
    if (auditResult.verdictAgreement !== "agree") {
      continue;
    }
    for (const finding of evaluation.judgement.judge.verdict.rubricFindings) {
      if (isFullScore(finding.score)) {
        continue;
      }
      const failure: FailureCase = {
        id: evaluation.judgement.id,
        evaluationType: evaluation.evaluationType,
        jobName: evaluation.judgement.job.displayName,
        sourceDisplayName: evaluation.judgement.source.displayName,
        judgeExplanation: evaluation.judgement.judge.verdict.explanation,
        judgeFindingJustification: finding.justification,
        score: finding.score,
        auditExplanation: auditResult.explanation,
        auditConfidence: auditResult.confidence,
      };
      const list = map.get(finding.criterion) ?? [];
      list.push(failure);
      map.set(finding.criterion, list);
    }
  }
  return map;
}

async function generateReports(jobs: CriterionJob[]): Promise<string[]> {
  if (jobs.length === 0) {
    console.log(
      "[audit] No failure cases where the auditor agreed with the judge.",
    );
    return [];
  }
  await mkdir(REPORT_DIR, { recursive: true });
  const concurrency = Math.min(8, Math.max(1, jobs.length));
  const results = await runJobsWithConcurrency<CriterionJob, string>({
    items: jobs,
    concurrency,
    getId: (item) => slugifyCriterion(item.criterion),
    label: "[audit]",
    handler: async (job, { progress }) => {
      progress.log(
        `[audit] Generating summary for ${job.criterion} (${job.cases.length} case${job.cases.length === 1 ? "" : "s"}).`,
      );
      const prompt = buildPrompt(job.criterion, job.cases);
      const text = await callModel(prompt, progress);
      if (!text.trim()) {
        throw new Error(`Empty response for criterion ${job.criterion}`);
      }
      const slug = slugifyCriterion(job.criterion);
      const filePath = path.join(REPORT_DIR, `${slug}.md`);
      const header = `# ${job.criterion}\n\n`;
      await writeFile(filePath, `${header}${text.trim()}\n`, "utf8");
      progress.log(`[audit] Wrote ${path.relative(REPO_ROOT, filePath)}`);
      return filePath;
    },
  });
  return results;
}

async function runStats(loadResult: LoadResult): Promise<void> {
  const lines: string[] = [];
  const logLine = (message: string): void => {
    lines.push(message);
    console.log(message);
  };
  const warnLine = (message: string): void => {
    lines.push(message);
    console.warn(message);
  };
  const errorLine = (message: string): void => {
    lines.push(message);
    console.error(message);
  };

  for (const warning of loadResult.warnings) {
    warnLine(`[analysis] WARN ${warning}`);
  }

  let summariseError: unknown;
  try {
    summariseEvaluations(loadResult.evaluations, { log: logLine });
  } catch (error) {
    summariseError = error;
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    errorLine(`[analysis] ERROR ${message}`);
  }

  try {
    await mkdir(path.dirname(STATS_OUTPUT_PATH), { recursive: true });
    const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    await writeFile(STATS_OUTPUT_PATH, content, "utf8");
  } catch (writeError) {
    const message =
      writeError instanceof Error ? writeError.message : String(writeError);
    errorLine(
      `[analysis] ERROR failed to write stats to ${STATS_OUTPUT_PATH}: ${message}`,
    );
    if (!summariseError) {
      summariseError = writeError;
    }
  }

  if (summariseError) {
    throw summariseError;
  }
}

async function runReports(
  evaluations: readonly LoadedEvaluation[],
): Promise<void> {
  const failures = collectFailureCases(evaluations);
  const jobs: CriterionJob[] = Array.from(failures.entries())
    .map(([criterion, cases]) => ({ criterion, cases }))
    .sort((a, b) => a.criterion.localeCompare(b.criterion));
  const files = await generateReports(jobs);
  if (files.length > 0) {
    console.log("[audit] Completed summaries:");
    for (const file of files) {
      console.log(`  - ${path.relative(REPO_ROOT, file)}`);
    }
  }
}

async function main(): Promise<void> {
  const stages = parseStages(process.argv.slice(2));
  if (stages.length === 0) {
    throw new Error("[audit-eval] No stages selected.");
  }
  const includeStats = stages.includes("stats");
  const includeReports = stages.includes("reports");
  const loadResult = await loadEvaluations();
  if (includeStats) {
    await runStats(loadResult);
  } else if (loadResult.warnings.length > 0) {
    for (const warning of loadResult.warnings) {
      console.warn(`[audit-eval] WARN ${warning}`);
    }
  }
  if (includeReports) {
    await runReports(loadResult.evaluations);
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`[audit-eval] ERROR ${message}`);
  process.exitCode = 1;
});
