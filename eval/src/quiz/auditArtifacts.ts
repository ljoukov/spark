import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { JudgeAuditSchema } from "@spark/llm/quiz/schemas";

import {
  JudgeAuditFilePayloadSchema,
  JudgeFilePayloadSchema,
  type JudgeAudit,
  type JudgeAuditFilePayload,
  type JudgeFilePayload,
} from "./payload";
import { WORKSPACE_PATHS, ensureEvalEnvLoaded } from "../utils/paths";

ensureEvalEnvLoaded();

const { quizEvalOutputDir: EVAL_OUTPUT_DIR, quizAuditDir: AUDIT_REPORT_DIR } =
  WORKSPACE_PATHS;

const EvaluationTypeSchema = z.enum(["quiz", "extension"]);
export type EvaluationType = z.infer<typeof EvaluationTypeSchema>;

export type LoadedEvaluation = {
  readonly judgement: JudgeFilePayload;
  readonly audit?: JudgeAuditFilePayload;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly evaluationType: EvaluationType;
};

export type LoadAuditEvaluationsResult = {
  readonly evaluations: LoadedEvaluation[];
  readonly warnings: string[];
};

async function parseJsonWithSchema<T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

function toRelativePath(filePath: string): string {
  return path.relative(EVAL_OUTPUT_DIR, filePath).split(path.sep).join("/");
}

export async function loadAuditEvaluations(): Promise<LoadAuditEvaluationsResult> {
  const evaluations: LoadedEvaluation[] = [];
  const warnings: string[] = [];

  if (!existsSync(EVAL_OUTPUT_DIR)) {
    warnings.push(`output directory not found at ${EVAL_OUTPUT_DIR}`);
    return { evaluations, warnings };
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
        const judgement = await parseJsonWithSchema(
          filePath,
          JudgeFilePayloadSchema,
        );
        const evaluationType: EvaluationType = fileEntry.name.includes(
          "extension",
        )
          ? "extension"
          : "quiz";
        const auditFilePath = filePath.replace(/\.json$/u, "-audit.json");
        let auditPayload: JudgeAuditFilePayload | undefined;
        if (existsSync(auditFilePath)) {
          auditPayload = await parseJsonWithSchema(
            auditFilePath,
            JudgeAuditFilePayloadSchema,
          );
        } else if (judgement.audit?.auditedAt) {
          auditPayload = {
            id: judgement.id,
            evaluationType,
            evaluatedAt: judgement.evaluatedAt,
            auditedAt: judgement.audit.auditedAt,
            source: judgement.source,
            job: judgement.job,
            judge: judgement.judge,
            audit: {
              model: judgement.audit.model,
              result: judgement.audit.result,
            },
          };
        }

        evaluations.push({
          judgement,
          audit: auditPayload,
          absolutePath: filePath,
          relativePath: toRelativePath(filePath),
          evaluationType,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`unable to read ${filePath}: ${message}`);
      }
    }
  }

  return { evaluations, warnings };
}

type NonAgreeVerdict = Exclude<JudgeAudit["verdictAgreement"], "agree">;

const AuditFailureReasonSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("judge-verdict"),
    evaluationType: EvaluationTypeSchema,
    verdict: z.literal("revise"),
    explanation: z.string().min(1),
  }),
  z.object({
    kind: z.literal("audit-verdict"),
    evaluationType: EvaluationTypeSchema,
    verdictAgreement: z.enum(["needs_review", "disagree"]),
    explanation: z.string().min(1),
    confidence: JudgeAuditSchema.shape.confidence,
  }),
]);

export type AuditFailureReason = z.infer<typeof AuditFailureReasonSchema>;

const AuditCheckpointEntrySchema = z.object({
  jobId: z.string().min(1),
  jobDisplayName: z.string().min(1),
  reasons: z.array(AuditFailureReasonSchema).min(1),
});

export type AuditCheckpointEntry = z.infer<typeof AuditCheckpointEntrySchema>;

export const AUDIT_CHECKPOINT_VERSION = 1;
export const AUDIT_CHECKPOINT_PATH = path.join(
  AUDIT_REPORT_DIR,
  "checkpoint.json",
);

const AuditCheckpointSchema = z.object({
  version: z.number().int().min(1),
  updatedAt: z.string().min(1),
  failures: z.array(AuditCheckpointEntrySchema),
});

export type AuditCheckpoint = z.infer<typeof AuditCheckpointSchema>;

export function deriveAuditFailures(
  evaluations: readonly LoadedEvaluation[],
): AuditCheckpointEntry[] {
  const byJob = new Map<
    string,
    {
      jobDisplayName: string;
      reasons: AuditFailureReason[];
    }
  >();

  for (const evaluation of evaluations) {
    const jobId = evaluation.judgement.job.id;
    const jobDisplayName = evaluation.judgement.job.displayName;
    const reasons: AuditFailureReason[] = [];

    if (evaluation.judgement.judge.verdict.verdict === "revise") {
      reasons.push({
        kind: "judge-verdict",
        evaluationType: evaluation.evaluationType,
        verdict: "revise",
        explanation: evaluation.judgement.judge.verdict.explanation,
      });
    }

    const auditResult = evaluation.audit?.audit.result;
    if (auditResult && auditResult.verdictAgreement !== "agree") {
      reasons.push({
        kind: "audit-verdict",
        evaluationType: evaluation.evaluationType,
        verdictAgreement: auditResult.verdictAgreement as NonAgreeVerdict,
        explanation: auditResult.explanation,
        confidence: auditResult.confidence,
      });
    }

    if (reasons.length === 0) {
      continue;
    }

    const existing = byJob.get(jobId);
    if (!existing) {
      byJob.set(jobId, {
        jobDisplayName,
        reasons: [...reasons],
      });
      continue;
    }

    for (const reason of reasons) {
      const alreadyPresent = existing.reasons.some((candidate) => {
        if (candidate.kind !== reason.kind) {
          return false;
        }
        if (candidate.evaluationType !== reason.evaluationType) {
          return false;
        }
        if (
          candidate.kind === "judge-verdict" &&
          reason.kind === "judge-verdict"
        ) {
          return true;
        }
        if (
          candidate.kind === "audit-verdict" &&
          reason.kind === "audit-verdict"
        ) {
          return candidate.verdictAgreement === reason.verdictAgreement;
        }
        return false;
      });
      if (!alreadyPresent) {
        existing.reasons.push(reason);
      }
    }
  }

  return Array.from(byJob.entries())
    .map(([jobId, { jobDisplayName, reasons }]) => ({
      jobId,
      jobDisplayName,
      reasons: [...reasons].sort((a, b) => {
        if (a.evaluationType !== b.evaluationType) {
          return a.evaluationType.localeCompare(b.evaluationType);
        }
        if (a.kind !== b.kind) {
          return a.kind.localeCompare(b.kind);
        }
        if (a.kind === "audit-verdict" && b.kind === "audit-verdict") {
          return a.verdictAgreement.localeCompare(b.verdictAgreement);
        }
        return 0;
      }),
    }))
    .sort((a, b) => a.jobId.localeCompare(b.jobId));
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function writeAuditCheckpoint(
  failures: readonly AuditCheckpointEntry[],
): Promise<AuditCheckpoint> {
  const payload: AuditCheckpoint = {
    version: AUDIT_CHECKPOINT_VERSION,
    updatedAt: new Date().toISOString(),
    failures: failures.map((entry) => ({
      jobId: entry.jobId,
      jobDisplayName: entry.jobDisplayName,
      reasons: entry.reasons,
    })),
  };

  await mkdir(AUDIT_REPORT_DIR, { recursive: true });
  await writeJsonFile(AUDIT_CHECKPOINT_PATH, payload);
  return payload;
}

export async function readAuditCheckpoint(): Promise<
  AuditCheckpoint | undefined
> {
  if (!existsSync(AUDIT_CHECKPOINT_PATH)) {
    return undefined;
  }
  const raw = await readFile(AUDIT_CHECKPOINT_PATH, "utf8");
  const parsed = JSON.parse(raw);
  return AuditCheckpointSchema.parse(parsed);
}

export function getFailedJobIdSet(checkpoint: AuditCheckpoint): Set<string> {
  const set = new Set<string>();
  for (const entry of checkpoint.failures) {
    if (entry.reasons.length > 0) {
      set.add(entry.jobId);
    }
  }
  return set;
}
