import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { QUIZ_EVAL_MODEL_ID } from "@spark/llm/quiz/legacy/judge";
import {
  DEFAULT_EXTENSION_QUESTION_COUNT,
  DEFAULT_GENERATION_QUESTION_COUNT,
} from "@spark/llm/quiz/legacy/generator";
import {
  buildExtensionPrompt,
  buildGenerationPrompt,
} from "@spark/llm/quiz/legacy/prompts";
import { runJobsWithConcurrency } from "../../utils/concurrency";
import type { JobProgressReporter } from "../../utils/concurrency";
import { generateText } from "../../utils/llm";
import { createCliCommand, splitCommaSeparated } from "../../utils/cli";
import {
  AUDIT_CHECKPOINT_PATH,
  deriveAuditFailures,
  loadAuditEvaluations,
  writeAuditCheckpoint,
  type EvaluationType,
  type LoadAuditEvaluationsResult,
  type LoadedEvaluation,
} from "./auditArtifacts";
import { WORKSPACE_PATHS, ensureEvalEnvLoaded } from "../../utils/paths";

ensureEvalEnvLoaded();

const {
  repoRoot: REPO_ROOT,
  quizAuditDir: REPORT_DIR,
  quizTasksDir: TASKS_DIR,
} = WORKSPACE_PATHS;
const STATS_OUTPUT_PATH = path.join(REPORT_DIR, "stats.txt");
const IMPROVEMENT_TASK_OUTPUT_PATH = path.join(
  TASKS_DIR,
  "improvement-task.md",
);
const FULL_SCORE_EPSILON = 1e-6;

const StageSchema = z.enum(["stats", "reports", "improvement-task"]);
type Stage = z.infer<typeof StageSchema>;
const ALL_STAGES: readonly Stage[] = ["stats", "reports", "improvement-task"];

function parseCliStages(argv: readonly string[]): Stage[] {
  const program = createCliCommand(
    "audit-eval",
    "Generate audit summaries for quiz evaluations",
  );
  program.option(
    "--stage <list>",
    'Comma separated list of stages to run ("stats", "reports", "improvement-task", or "all")',
    "all",
  );
  const parsed = program.parse(argv, { from: "user" }).opts<{
    stage: string;
  }>();
  return parseStagesValue(parsed.stage);
}

const AUDIT_SUMMARY_FILES = [
  "answer-precision.md",
  "coverage-and-balance.md",
  "difficulty-alignment.md",
  "question-quality.md",
  "safety-tone.md",
] as const;

type ImprovementStatsSummary = {
  readonly totalJudgements: number;
  readonly withAuditCount: number;
  readonly perfectCount: number;
  readonly perfectPercentage: number;
  readonly auditorAgreedCount: number;
  readonly auditorAgreedReviseCount: number;
  readonly auditorFlaggedCount: number;
  readonly auditorFlaggedReviseCount: number;
  readonly highConfidenceCount: number;
  readonly highConfidenceFindingTotal: number;
  readonly highConfidenceFindingCounts: Map<string, number>;
};

type StatsLogger = {
  readonly log: (message: string) => void;
};

type ScoreDistributionEntry = {
  readonly bucket: string;
  readonly count: number;
  readonly percentage: number;
};

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

function parseStagesValue(rawValue: string | undefined): Stage[] {
  if (!rawValue) {
    return [...ALL_STAGES];
  }
  const normalised = rawValue.trim().toLowerCase();
  if (normalised.length === 0 || normalised === "all") {
    return [...ALL_STAGES];
  }
  const parts = splitCommaSeparated(normalised);
  if (parts.length === 0) {
    throw new Error("[audit-eval] --stage requires at least one entry.");
  }
  const stages = parts.map((part) => {
    try {
      return StageSchema.parse(part);
    } catch {
      throw new Error(
        '[audit-eval] Invalid stage value. Use "stats", "reports", "improvement-task", or "all".',
      );
    }
  });
  return Array.from(new Set(stages));
}

function isFullScore(score: number): boolean {
  return Math.abs(score - 1) <= FULL_SCORE_EPSILON;
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
    "<style>Do not include address blocks, email headers, or salutation lines (e.g. no To/From/Date/Subject). Start directly with section headings.</style>",
    "<cases>",
    sections,
    "</cases>",
  ].join("\n\n");
}

async function callModel(
  prompt: string,
  progress: JobProgressReporter,
): Promise<string> {
  const text = await generateText({
    progress,
    modelId: QUIZ_EVAL_MODEL_ID,
    contents: [
      {
        role: "user",
        parts: [{ type: "text", text: prompt }],
      },
    ],
    responseMimeType: "text/plain",
  });
  return text;
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

function computeImprovementStats(
  evaluations: readonly LoadedEvaluation[],
): ImprovementStatsSummary {
  let withAuditCount = 0;
  let perfectCount = 0;
  let auditorAgreedCount = 0;
  let auditorAgreedReviseCount = 0;
  let auditorFlaggedCount = 0;
  let auditorFlaggedReviseCount = 0;
  let highConfidenceCount = 0;
  let highConfidenceFindingTotal = 0;
  const highConfidenceFindingCounts = new Map<string, number>();

  for (const evaluation of evaluations) {
    const audit = evaluation.audit;
    if (!audit) {
      continue;
    }
    withAuditCount += 1;
    const judgeVerdict = evaluation.judgement.judge.verdict.verdict;
    const auditResult = audit.audit.result;
    const isPerfect =
      judgeVerdict === "approve" &&
      auditResult.verdictAgreement === "agree" &&
      auditResult.confidence === "high";
    if (isPerfect) {
      perfectCount += 1;
    }
    if (auditResult.verdictAgreement === "agree") {
      auditorAgreedCount += 1;
      if (judgeVerdict !== "approve") {
        auditorAgreedReviseCount += 1;
      }
      if (auditResult.confidence === "high") {
        highConfidenceCount += 1;
        for (const finding of evaluation.judgement.judge.verdict
          .rubricFindings) {
          if (isFullScore(finding.score)) {
            continue;
          }
          highConfidenceFindingTotal += 1;
          const current =
            highConfidenceFindingCounts.get(finding.criterion) ?? 0;
          highConfidenceFindingCounts.set(finding.criterion, current + 1);
        }
      }
    } else {
      auditorFlaggedCount += 1;
      if (judgeVerdict !== "approve") {
        auditorFlaggedReviseCount += 1;
      }
    }
  }

  const perfectPercentage =
    withAuditCount === 0 ? 0 : (perfectCount / withAuditCount) * 100;

  return {
    totalJudgements: evaluations.length,
    withAuditCount,
    perfectCount,
    perfectPercentage,
    auditorAgreedCount,
    auditorAgreedReviseCount,
    auditorFlaggedCount,
    auditorFlaggedReviseCount,
    highConfidenceCount,
    highConfidenceFindingTotal,
    highConfidenceFindingCounts,
  };
}

async function loadAuditSummaries(): Promise<
  readonly { filename: string; content: string }[]
> {
  const entries: { filename: string; content: string }[] = [];
  for (const filename of AUDIT_SUMMARY_FILES) {
    const filePath = path.join(REPORT_DIR, filename);
    try {
      const content = await readFile(filePath, "utf8");
      entries.push({ filename, content });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[improvement] Failed to read audit summary ${filePath}: ${message}`,
      );
    }
  }
  return entries;
}

async function loadStatsContent(
  loadResult: LoadAuditEvaluationsResult,
): Promise<{ raw: string; source: "file" | "computed" }> {
  if (existsSync(STATS_OUTPUT_PATH)) {
    try {
      const raw = await readFile(STATS_OUTPUT_PATH, "utf8");
      if (raw.trim().length > 0) {
        return { raw: raw.trimEnd(), source: "file" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[improvement] WARN Unable to read stats file ${STATS_OUTPUT_PATH}: ${message}`,
      );
    }
  }
  const lines: string[] = [];
  for (const warning of loadResult.warnings) {
    lines.push(`[analysis] WARN ${warning}`);
  }
  try {
    summariseEvaluations(loadResult.evaluations, {
      log: (message) => {
        lines.push(message);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[improvement] Unable to summarise evaluations for stats: ${message}`,
    );
  }
  return { raw: lines.join("\n"), source: "computed" };
}

function formatTopCriteria(
  map: Map<string, number>,
  total: number,
): string | undefined {
  if (total === 0 || map.size === 0) {
    return undefined;
  }
  const parts = Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([criterion, count]) => {
      const share = total === 0 ? 0 : (count / total) * 100;
      return `${criterion} (${count}/${total}, ${formatPercentage(share)})`;
    });
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(", ");
}

function buildInsightsFromSummary(
  summary: ImprovementStatsSummary,
  warnings: readonly string[],
): string[] {
  const insights: string[] = [];
  if (warnings.length > 0) {
    insights.push(
      `Encountered ${warnings.length} warning${warnings.length === 1 ? "" : "s"} while loading evaluation artefacts. See the raw stats block for details.`,
    );
  }
  if (summary.withAuditCount > 0) {
    insights.push(
      `Analysed ${summary.totalJudgements} judgement files with auditor coverage on ${summary.withAuditCount}. Only ${summary.perfectCount}/${summary.withAuditCount} (${formatPercentage(summary.perfectPercentage)}) achieved the approve + agree + high confidence bar.`,
    );
  } else {
    insights.push(
      `Analysed ${summary.totalJudgements} judgement files, but no audit data was available to assess perfect approvals.`,
    );
  }

  if (summary.auditorAgreedCount > 0) {
    const revisePercentage =
      (summary.auditorAgreedReviseCount / summary.auditorAgreedCount) * 100;
    insights.push(
      `Auditors agreed with the judge on ${summary.auditorAgreedCount} evaluation${summary.auditorAgreedCount === 1 ? "" : "s"}, yet ${summary.auditorAgreedReviseCount} still required judge revisions (${formatPercentage(revisePercentage)}).`,
    );
  }

  if (summary.auditorFlaggedCount > 0) {
    const revisePercentage =
      (summary.auditorFlaggedReviseCount / summary.auditorFlaggedCount) * 100;
    insights.push(
      `Auditors flagged follow-up on ${summary.auditorFlaggedCount} evaluation${summary.auditorFlaggedCount === 1 ? "" : "s"}; judges marked all of them for revision (${formatPercentage(revisePercentage)}).`,
    );
  }

  if (summary.highConfidenceCount > 0) {
    const topCriteria = formatTopCriteria(
      summary.highConfidenceFindingCounts,
      summary.highConfidenceFindingTotal,
    );
    if (summary.highConfidenceFindingTotal === 0) {
      insights.push(
        `High-confidence agreements (${summary.highConfidenceCount}) still show opportunities to improve, but all rubric findings there scored 1.0.`,
      );
    } else if (topCriteria) {
      insights.push(
        `Within ${summary.highConfidenceCount} high-confidence agreements, auditors still logged ${summary.highConfidenceFindingTotal} sub-1.0 rubric findings concentrated in ${topCriteria}.`,
      );
    }
  }

  return insights;
}

function buildInsightsFromStatsText(
  raw: string,
  warnings: readonly string[],
): string[] {
  const insights: string[] = [];
  if (warnings.length > 0) {
    insights.push(
      `Encountered ${warnings.length} warning${warnings.length === 1 ? "" : "s"} while loading evaluation artefacts. See the raw stats block for details.`,
    );
  }

  const lines = raw
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const processedMatch = lines.find((line) =>
    line.startsWith("[analysis] Processed "),
  );
  const perfectMatch = lines.find((line) =>
    line.startsWith("[analysis] Perfect "),
  );
  if (processedMatch && perfectMatch) {
    const processedCount = processedMatch.match(
      /Processed (\d+) judgement files/u,
    );
    const perfectCounts = perfectMatch.match(/: (\d+)\/(\d+) \(([0-9.]+)%\)/u);
    if (processedCount && perfectCounts) {
      const total = Number(processedCount[1]);
      const perfect = Number(perfectCounts[1]);
      const denominator = Number(perfectCounts[2]);
      const percentage = perfectCounts[3];
      insights.push(
        `Stats snapshot covers ${total} judgement file${total === 1 ? "" : "s"}; ${perfect}/${denominator} (${percentage}%) met the approve + agree + high confidence bar.`,
      );
    }
  }

  const auditorAgreedIndex = lines.findIndex((line) =>
    line.startsWith("[analysis] Auditor agreed:"),
  );
  if (auditorAgreedIndex !== -1) {
    const agreedLine = lines[auditorAgreedIndex];
    const agreedMatch = agreedLine.match(/Auditor agreed: (\d+) evaluation/u);
    const issuesLine = lines[auditorAgreedIndex + 1];
    const issuesMatch = issuesLine?.match(
      /Quizzes with judge issues: (\d+) \(([0-9.]+)%\)\./u,
    );
    if (agreedMatch && issuesMatch) {
      const agreed = Number(agreedMatch[1]);
      const issues = Number(issuesMatch[1]);
      const percentage = issuesMatch[2];
      insights.push(
        `Auditors agreed with the judge on ${agreed} evaluation${agreed === 1 ? "" : "s"}, yet ${issues} still required judge revisions (${percentage}%).`,
      );
    }
  }

  const flaggedIndex = lines.findIndex((line) =>
    line.startsWith("[analysis] Auditor flagged follow-up:"),
  );
  if (flaggedIndex !== -1) {
    const flaggedLine = lines[flaggedIndex];
    const flaggedMatch = flaggedLine.match(/follow-up: (\d+) evaluation/u);
    const flaggedIssuesLine = lines[flaggedIndex + 1];
    const flaggedIssuesMatch = flaggedIssuesLine?.match(
      /Quizzes with judge issues: (\d+) \(([0-9.]+)%\)\./u,
    );
    if (flaggedMatch && flaggedIssuesMatch) {
      const flagged = Number(flaggedMatch[1]);
      const flaggedIssues = Number(flaggedIssuesMatch[1]);
      const percentage = flaggedIssuesMatch[2];
      insights.push(
        `Auditors escalated ${flagged} evaluation${flagged === 1 ? "" : "s"}; every one already had judge issues (${flaggedIssues}/${flagged}, ${percentage}%).`,
      );
    }
  }

  let inHighConfidenceBlock = false;
  let highConfidenceCount: number | undefined;
  const criterionTotals: { criterion: string; total: number }[] = [];
  let currentCriterion: { name: string; total?: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("[analysis] High-confidence agreements:")) {
      const match = line.match(/agreements: (\d+) evaluation/u);
      if (match) {
        highConfidenceCount = Number(match[1]);
      }
      inHighConfidenceBlock = true;
      currentCriterion = undefined;
      continue;
    }
    if (inHighConfidenceBlock && line.startsWith("[analysis] ")) {
      // Encountered the next analysis block; stop collecting high-confidence data.
      inHighConfidenceBlock = false;
      if (currentCriterion && typeof currentCriterion.total === "number") {
        criterionTotals.push({
          criterion: currentCriterion.name,
          total: currentCriterion.total,
        });
      }
      currentCriterion = undefined;
    }
    if (!inHighConfidenceBlock) {
      continue;
    }
    const trimmed = line;
    const criterionMatch = trimmed.match(/^- ([^:]+):$/u);
    if (criterionMatch) {
      if (currentCriterion && typeof currentCriterion.total === "number") {
        criterionTotals.push({
          criterion: currentCriterion.name,
          total: currentCriterion.total,
        });
      }
      currentCriterion = { name: criterionMatch[1] };
      continue;
    }
    if (currentCriterion) {
      const bucketMatch = trimmed.match(/\((\d+)\/(\d+)\)$/u);
      if (bucketMatch) {
        const total = Number(bucketMatch[2]);
        if (!Number.isNaN(total)) {
          currentCriterion.total = total;
        }
      }
    }
  }
  if (
    inHighConfidenceBlock &&
    currentCriterion &&
    typeof currentCriterion.total === "number"
  ) {
    criterionTotals.push({
      criterion: currentCriterion.name,
      total: currentCriterion.total,
    });
  }

  if (highConfidenceCount && criterionTotals.length > 0) {
    const top = criterionTotals
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map(({ criterion, total }) => `${criterion} (${total})`)
      .join(", ");
    insights.push(
      `High-confidence agreements (${highConfidenceCount}) still surface rubric deductions, concentrated in ${top}.`,
    );
  }

  return insights;
}
async function runImprovementTask(
  loadResult: LoadAuditEvaluationsResult,
): Promise<void> {
  const [{ raw: statsRaw, source: statsSource }, auditSummaries] =
    await Promise.all([loadStatsContent(loadResult), loadAuditSummaries()]);
  const insights =
    statsSource === "file" && statsRaw.trim().length > 0
      ? buildInsightsFromStatsText(statsRaw, loadResult.warnings)
      : buildInsightsFromSummary(
          computeImprovementStats(loadResult.evaluations),
          loadResult.warnings,
        );

  const generationPrompt = buildGenerationPrompt({
    questionCount: DEFAULT_GENERATION_QUESTION_COUNT,
    sourceFiles: [],
  });
  const extensionPrompt = buildExtensionPrompt({
    additionalQuestionCount: DEFAULT_EXTENSION_QUESTION_COUNT,
  });

  const lines: string[] = [];
  lines.push("# Improvement Task: Quiz Prompt Refinement");
  lines.push(
    "We need to evolve the production prompts that drive Spark's quiz generator. The current system produces quizzes and extensions using the prompts below. Offline audits surfaced recurring issues—use the stats and verbatim feedback to draft prompt updates that resolve these failure patterns.",
  );
  lines.push("");
  lines.push("## Production Prompts");
  lines.push("### Initial Quiz Prompt");
  lines.push("```text");
  lines.push(generationPrompt.trimEnd());
  lines.push("```");
  lines.push("");
  lines.push("### Extension Prompt");
  lines.push("```text");
  lines.push(extensionPrompt.trimEnd());
  lines.push("```");
  lines.push("");
  lines.push("## Evaluation Insights");
  lines.push("### Current Performance Stats");
  if (insights.length === 0) {
    lines.push("- No evaluation stats available.");
  } else {
    for (const insight of insights) {
      lines.push(`- ${insight}`);
    }
  }

  const statsSourceNote =
    statsSource === "file"
      ? "_Stats source: spark-data/quiz/eval-audit/stats.txt._"
      : "_Stats source: recomputed from current evaluation data; spark-data/quiz/eval-audit/stats.txt was unavailable._";
  lines.push("");
  lines.push(statsSourceNote);
  if (statsRaw.trim().length > 0) {
    lines.push("");
    lines.push("```text");
    lines.push(statsRaw.trimEnd());
    lines.push("```");
  }

  lines.push("");
  lines.push("### Auditor Reports");
  for (const entry of auditSummaries) {
    lines.push(`#### ${entry.filename}`);
    lines.push("");
    lines.push(entry.content.trim());
    lines.push("");
  }

  const content = `${lines.join("\n").trimEnd()}\n`;
  await mkdir(path.dirname(IMPROVEMENT_TASK_OUTPUT_PATH), { recursive: true });
  await writeFile(IMPROVEMENT_TASK_OUTPUT_PATH, content, "utf8");
  console.log(
    `[improvement] Wrote ${path.relative(
      REPO_ROOT,
      IMPROVEMENT_TASK_OUTPUT_PATH,
    )}`,
  );
}

async function runStats(loadResult: LoadAuditEvaluationsResult): Promise<void> {
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
  const stages = parseCliStages(process.argv);
  if (stages.length === 0) {
    throw new Error("[audit-eval] No stages selected.");
  }
  const includeStats = stages.includes("stats");
  const includeReports = stages.includes("reports");
  const includeImprovementTask = stages.includes("improvement-task");
  const loadResult = await loadAuditEvaluations();
  const failures = deriveAuditFailures(loadResult.evaluations);
  const checkpoint = await writeAuditCheckpoint(failures);
  const checkpointRelativePath = path.relative(
    REPO_ROOT,
    AUDIT_CHECKPOINT_PATH,
  );
  console.log(
    `[audit] Wrote checkpoint to ${checkpointRelativePath} with ${checkpoint.failures.length} failing job${checkpoint.failures.length === 1 ? "" : "s"}.`,
  );
  if (includeStats) {
    await runStats(loadResult);
  } else if (loadResult.warnings.length > 0) {
    for (const warning of loadResult.warnings) {
      console.warn(`[audit-eval] WARN ${warning}`);
    }
  }
  if (includeImprovementTask) {
    await runImprovementTask(loadResult);
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
