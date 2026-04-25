import { createHash, randomUUID } from "node:crypto";

import {
  PaperSheetQuestionSchema,
  SparkGapsFinderPendingRunSchema,
  SparkGraderRunSchema,
  SparkGraderWorksheetReportSchema,
  SparkLearningGapPresentationsSchema,
  SparkLearningGapSchema,
  visitPaperSheetQuestions,
  type PaperSheetQuestion,
  type PaperSheetQuestionGroup,
  type SparkGapsFinderPendingRun,
  type SparkGraderRun,
  type SparkGraderWorksheetReport,
  type SparkLearningGap,
  type SparkLearningGapGuidedPresentation,
  type SparkLearningGapStep,
} from "@spark/schemas";
import { z } from "zod";

import {
  buildWorkspaceFileDocPath,
  upsertWorkspaceTextFileDoc,
} from "./workspaceFileStore";
import {
  renderSparkAgentSkillContentSection,
  resolveSparkAgentSkillFiles,
  SPARK_GAPS_FINDER_SKILL_IDS,
} from "./sparkAgentSkills";
import { errorAsString } from "../utils/error";
import {
  commitFirestoreWrites,
  deleteFirestoreDocument,
  getFirestoreDocument,
  listFirestoreDocuments,
  patchFirestoreDocument,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import {
  generateText,
  parseJsonFromLlmText,
} from "../utils/llm";
import { createTask } from "../utils/tasks";

const GAPS_FINDER_SCHEMA_VERSION = 1;
const GAPS_FINDER_BATCH_SIZE = 4;
const GAPS_FINDER_MAX_CANDIDATES = 12;
const GAPS_FINDER_STALE_LOCK_MS = 30 * 60 * 1000;
const GAPS_FINDER_MODEL_ID = "chatgpt-gpt-5.5-fast";

type QueueGapsFinderRunOptions = {
  serviceAccountJson: string;
  userId: string;
  runId: string;
  completedAt?: Date;
};

type LaunchGapsFinderOptions = QueueGapsFinderRunOptions & {
  enqueue?: boolean;
};

type RunGapsFinderOptions = {
  serviceAccountJson: string;
  userId: string;
  scanBacklog?: boolean;
  forceUiData?: boolean;
};

type PendingRunDoc = SparkGapsFinderPendingRun & {
  docId: string;
  documentPath: string;
};

type WeakQuestionCandidate = {
  id: string;
  runId: string;
  runVersion: string;
  questionId: string;
  questionLabel: string;
  questionPrompt: string;
  questionType: PaperSheetQuestion["type"];
  parentPrompt?: string;
  studentAnswer: string;
  gradingNote: string;
  awardedMarks: number;
  maxMarks: number;
  scoreRatio: number;
  subjectKey: string;
  subjectLabel: string;
  sheetTitle: string;
  paperLabel: string;
};

type LoadedQueuedRun = {
  pending: PendingRunDoc;
  run: SparkGraderRun;
  report: SparkGraderWorksheetReport;
  reportRaw: string;
  candidates: WeakQuestionCandidate[];
};

const generatedGapTypeSchema = z.enum([
  "knowledge_gap",
  "misconception",
  "oversight",
]);

const generatedGapStepSchema = z.object({
  kind: z.enum([
    "free_text",
    "multiple_choice",
    "model_answer",
    "memory_chain",
  ]),
  label: z.string().trim().min(1).optional(),
  prompt: z.string().trim().min(1),
  expectedAnswer: z.string().trim().min(1).optional(),
  modelAnswer: z.string().trim().min(1).optional(),
  markScheme: z.string().trim().min(1).optional(),
  gradingPrompt: z.string().trim().min(1).optional(),
  maxMarks: z.number().int().min(1).max(4).optional(),
  placeholder: z.string().trim().min(1).optional(),
  options: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        label: z.string().trim().min(1),
        text: z.string().trim().min(1),
      }),
    )
    .min(2)
    .max(5)
    .optional(),
  correctOptionId: z.string().trim().min(1).optional(),
  explanation: z.string().trim().min(1).optional(),
  body: z.string().trim().min(1).optional(),
});

const generatedGapSchema = z.object({
  sourceCandidateId: z.string().trim().min(1),
  type: generatedGapTypeSchema,
  title: z.string().trim().min(1),
  cardQuestion: z.string().trim().min(1),
  shortRationale: z.string().trim().min(1).optional(),
  dedupeKey: z.string().trim().min(1),
  severity: z.number().int().min(1).max(5),
  steps: z.array(generatedGapStepSchema).min(3).max(12),
  presentations: z.unknown().optional(),
});

const generatedGapResponseSchema = z.object({
  gaps: z.array(generatedGapSchema).max(24),
});

type GeneratedGap = z.infer<typeof generatedGapSchema>;
type CompleteLearningGapPresentations = {
  v17: SparkLearningGapGuidedPresentation;
};

function normalizeDocumentId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : randomUUID();
}

function shortHash(value: string, length = 16): string {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

function docIdFromPath(documentPath: string): string {
  const parts = documentPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? documentPath;
}

function sparkUserDocPath(userId: string): string {
  return `spark/${userId}`;
}

function gapsFinderStateDocPath(userId: string): string {
  return `${sparkUserDocPath(userId)}/gapsFinder/state`;
}

function pendingRunsCollectionPath(userId: string): string {
  return `${gapsFinderStateDocPath(userId)}/pendingRuns`;
}

function pendingRunDocPath(userId: string, runVersion: string): string {
  return `${pendingRunsCollectionPath(userId)}/${runVersion}`;
}

function processedRunsCollectionPath(userId: string): string {
  return `${gapsFinderStateDocPath(userId)}/processedRuns`;
}

function processedRunDocPath(userId: string, runVersion: string): string {
  return `${processedRunsCollectionPath(userId)}/${runVersion}`;
}

function gapsCollectionPath(userId: string): string {
  return `${sparkUserDocPath(userId)}/gaps`;
}

function gapDocPath(userId: string, gapId: string): string {
  return `${gapsCollectionPath(userId)}/${gapId}`;
}

function graderRunDocPath(userId: string, runId: string): string {
  return `${sparkUserDocPath(userId)}/graderRuns/${runId}`;
}

function buildRunVersion(runId: string, completedAt?: Date): string {
  const completedAtKey = completedAt?.toISOString() ?? "unknown";
  const hash = shortHash(`${runId}:${completedAtKey}`, 12);
  return `${normalizeDocumentId(runId).slice(0, 48)}-${hash}`;
}

function isDoneGradedRun(run: SparkGraderRun): boolean {
  if (run.status !== "done") {
    return false;
  }
  if (run.sheetPhase === "graded") {
    return true;
  }
  return run.sheet !== undefined || run.totals !== undefined;
}

function normalizeSubjectKey(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (slug.length === 0) {
    return "general";
  }
  if (slug.includes("biology") || slug === "bio") {
    return "biology";
  }
  if (slug.includes("chemistry") || slug === "chem") {
    return "chemistry";
  }
  if (slug.includes("physics") || slug === "phys") {
    return "physics";
  }
  if (slug.includes("math") || slug.includes("maths")) {
    return "mathematics";
  }
  if (slug.includes("english")) {
    return "english";
  }
  if (slug.includes("history")) {
    return "history";
  }
  if (slug.includes("geography")) {
    return "geography";
  }
  if (slug.includes("science")) {
    return "science";
  }
  return slug;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeGuidedFieldText(value: string): string {
  const normalized = normalizeWhitespace(value)
    .replace(/\\times\b/gu, "×")
    .replace(/\\(?:rightarrow|to)\b/gu, "→")
    .replace(/\\leq\b/gu, "≤")
    .replace(/\\geq\b/gu, "≥")
    .replace(/\\Delta\b/gu, "Δ")
    .replace(/\\%/gu, "%")
    .replace(/\\text\{([^{}]*)\}/gu, "$1")
    .replace(/\\\(|\\\)|\\\[|\\\]/gu, "")
    .replace(/\${1,2}/gu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/`([^`]+)`/gu, "$1");
  return normalizeWhitespace(normalized);
}

function hasGuidedFieldFormatting(value: string): boolean {
  return /(?:\r|\n|\${1,2}|\\\(|\\\[|`|\*\*|__|^\s{0,3}#{1,6}\s|^\s*[-*+]\s+)/mu.test(
    value,
  );
}

function compactText(value: string, maxLength: number): string {
  const compact = normalizeWhitespace(value);
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function renderQuestionPrompt(
  question: PaperSheetQuestion,
  parentGroup: PaperSheetQuestionGroup | null,
): string {
  const prefix = parentGroup?.prompt ? `Group context: ${parentGroup.prompt}\n` : "";
  const prompt = (() => {
    switch (question.type) {
      case "fill":
        return `${question.prompt} [blank] ${question.after}`;
      case "mcq":
        return [
          question.prompt,
          ...question.options.map((option) =>
            `${option.label ?? option.id}. ${option.text}`.trim(),
          ),
        ].join("\n");
      case "lines":
      case "calc":
      case "match":
      case "spelling":
      case "flow":
        return question.prompt;
      case "cloze":
        return question.segments.join(" [blank] ");
      case "answer_bank":
        return [
          question.segments.join(" [blank] "),
          `Options: ${question.options
            .map((option) => `${option.label ?? option.id}. ${option.text}`)
            .join("; ")}`,
        ].join("\n");
    }
  })();
  return compactText(`${prefix}${prompt}`, 1400);
}

function renderStudentAnswer(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "(blank)";
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => {
        const answer = typeof entry === "string" ? entry.trim() : String(entry);
        return `${key}: ${answer.length > 0 ? answer : "(blank)"}`;
      },
    );
    return entries.length > 0 ? entries.join("; ") : "(blank)";
  }
  return "(blank)";
}

function buildPaperLabel(run: SparkGraderRun, report: SparkGraderWorksheetReport): string {
  const parts = [
    run.paper?.contextLabel,
    run.paper?.year,
    run.paper?.paperName,
    report.sheet.title,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part && part.length > 0));
  return parts.length > 0 ? parts.join(" · ") : "Worksheet";
}

function shouldCreateCandidate(options: {
  awardedMarks: number;
  maxMarks: number;
  status: string;
}): boolean {
  const { awardedMarks, maxMarks, status } = options;
  if (maxMarks <= 0) {
    return false;
  }
  if (awardedMarks >= maxMarks) {
    return false;
  }
  if (maxMarks === 3 && awardedMarks >= 2) {
    return false;
  }
  if (maxMarks >= 4 && awardedMarks <= 1) {
    return true;
  }
  if (awardedMarks / maxMarks <= 0.5) {
    return true;
  }
  return status === "incorrect";
}

function extractWeakQuestionCandidates(options: {
  pending: PendingRunDoc;
  run: SparkGraderRun;
  report: SparkGraderWorksheetReport;
}): WeakQuestionCandidate[] {
  const { pending, run, report } = options;
  const subjectLabel = report.sheet.subject.trim();
  const subjectKey = normalizeSubjectKey(subjectLabel);
  const sheetTitle = report.sheet.title;
  const paperLabel = buildPaperLabel(run, report);
  const candidates: WeakQuestionCandidate[] = [];

  for (const section of report.sheet.sections) {
    if (!("id" in section)) {
      continue;
    }
    visitPaperSheetQuestions(section.questions, (question, parentGroup) => {
      const review = report.review.questions[question.id];
      const score = review?.score;
      if (!review || !score) {
        return;
      }
      if (
        !shouldCreateCandidate({
          awardedMarks: score.got,
          maxMarks: score.total,
          status: review.status,
        })
      ) {
        return;
      }

      const questionPrompt = renderQuestionPrompt(question, parentGroup);
      const questionLabel =
        question.displayNumber ??
        question.badgeLabel ??
        parentGroup?.displayNumber ??
        parentGroup?.badgeLabel ??
        question.id;
      candidates.push({
        id: `${pending.runVersion}:${question.id}`,
        runId: run.id,
        runVersion: pending.runVersion,
        questionId: question.id,
        questionLabel,
        questionPrompt,
        questionType: question.type,
        ...(parentGroup?.prompt ? { parentPrompt: compactText(parentGroup.prompt, 500) } : {}),
        studentAnswer: compactText(renderStudentAnswer(report.answers[question.id]), 1000),
        gradingNote: compactText(review.note, 1000),
        awardedMarks: score.got,
        maxMarks: score.total,
        scoreRatio: score.total > 0 ? score.got / score.total : 0,
        subjectKey,
        subjectLabel: titleCase(subjectKey) === subjectKey ? subjectLabel : titleCase(subjectKey),
        sheetTitle,
        paperLabel,
      });
    });
  }

  return candidates.sort((left, right) => {
    const leftSeverity = (left.maxMarks - left.awardedMarks) + (left.maxMarks >= 4 ? 1 : 0);
    const rightSeverity =
      (right.maxMarks - right.awardedMarks) + (right.maxMarks >= 4 ? 1 : 0);
    return rightSeverity - leftSeverity;
  });
}

async function readWorkspaceTextFile(options: {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  filePath: string;
}): Promise<string | null> {
  const snap = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: buildWorkspaceFileDocPath({
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: options.filePath,
    }),
  });
  if (!snap.exists || !snap.data) {
    return null;
  }
  const content = snap.data.content;
  return typeof content === "string" ? content : null;
}

async function loadGraderRun(options: {
  serviceAccountJson: string;
  userId: string;
  runId: string;
}): Promise<SparkGraderRun | null> {
  const snap = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: graderRunDocPath(options.userId, options.runId),
  });
  if (!snap.exists || !snap.data) {
    return null;
  }
  const parsed = SparkGraderRunSchema.safeParse({
    id: options.runId,
    ...snap.data,
  });
  if (!parsed.success) {
    console.warn("[gaps-finder] invalid grader run", {
      runId: options.runId,
      issues: parsed.error.issues,
    });
    return null;
  }
  return parsed.data;
}

async function listPendingRuns(options: {
  serviceAccountJson: string;
  userId: string;
  limit?: number;
}): Promise<PendingRunDoc[]> {
  const docs = await listFirestoreDocuments({
    serviceAccountJson: options.serviceAccountJson,
    collectionPath: pendingRunsCollectionPath(options.userId),
    orderBy: "queuedAt asc",
    limit: options.limit ?? GAPS_FINDER_BATCH_SIZE,
  });
  const pending: PendingRunDoc[] = [];
  for (const doc of docs) {
    const parsed = SparkGapsFinderPendingRunSchema.safeParse({
      runVersion: docIdFromPath(doc.documentPath),
      ...doc.data,
    });
    if (!parsed.success) {
      console.warn("[gaps-finder] invalid pending run", {
        documentPath: doc.documentPath,
        issues: parsed.error.issues,
      });
      continue;
    }
    pending.push({
      ...parsed.data,
      docId: docIdFromPath(doc.documentPath),
      documentPath: doc.documentPath,
    });
  }
  return pending;
}

async function listDocIds(options: {
  serviceAccountJson: string;
  collectionPath: string;
  limit?: number;
}): Promise<Set<string>> {
  const docs = await listFirestoreDocuments({
    serviceAccountJson: options.serviceAccountJson,
    collectionPath: options.collectionPath,
    limit: options.limit ?? 500,
  });
  return new Set(docs.map((doc) => docIdFromPath(doc.documentPath)));
}

async function listExistingGaps(options: {
  serviceAccountJson: string;
  userId: string;
}): Promise<SparkLearningGap[]> {
  const docs = await listFirestoreDocuments({
    serviceAccountJson: options.serviceAccountJson,
    collectionPath: gapsCollectionPath(options.userId),
    orderBy: "createdAt desc",
    limit: 500,
  });
  const gaps: SparkLearningGap[] = [];
  for (const doc of docs) {
    const parsed = SparkLearningGapSchema.safeParse({
      id: docIdFromPath(doc.documentPath),
      ...doc.data,
    });
    if (!parsed.success) {
      console.warn("[gaps-finder] invalid gap document", {
        documentPath: doc.documentPath,
        issues: parsed.error.issues,
      });
      continue;
    }
    if (parsed.data.status === "active") {
      gaps.push(parsed.data);
    }
  }
  return gaps;
}

async function queuePendingRun(options: QueueGapsFinderRunOptions): Promise<boolean> {
  const runVersion = buildRunVersion(options.runId, options.completedAt);
  const now = new Date();
  try {
    await commitFirestoreWrites({
      serviceAccountJson: options.serviceAccountJson,
      writes: [
        {
          type: "set",
          documentPath: pendingRunDocPath(options.userId, runVersion),
          precondition: { exists: false },
          data: {
            schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
            runId: options.runId,
            runVersion,
            ...(options.completedAt ? { completedAt: options.completedAt } : {}),
            queuedAt: now,
            status: "pending",
          },
        },
      ],
    });
    return true;
  } catch (error) {
    const message = errorAsString(error);
    if (message.includes("ALREADY_EXISTS") || message.includes("exists")) {
      return false;
    }
    throw error;
  }
}

async function enqueueGapsFinderTask(options: {
  serviceAccountJson: string;
  userId: string;
  forceUiData?: boolean;
}): Promise<void> {
  await createTask(
    {
      type: "findGaps",
      findGaps: {
        userId: options.userId,
        ...(options.forceUiData ? { forceUiData: true } : {}),
      },
    },
    {
      serviceAccountJson: options.serviceAccountJson,
    },
  );
}

export async function launchSparkGapsFinderForRun(
  options: LaunchGapsFinderOptions,
): Promise<{ queued: boolean; enqueued: boolean }> {
  const queued = await queuePendingRun(options);
  if (options.enqueue === false) {
    return { queued, enqueued: false };
  }
  await enqueueGapsFinderTask({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
  });
  return { queued, enqueued: true };
}

async function queueUnprocessedBacklog(options: {
  serviceAccountJson: string;
  userId: string;
  limit?: number;
}): Promise<number> {
  const [pendingIds, processedIds, runDocs] = await Promise.all([
    listDocIds({
      serviceAccountJson: options.serviceAccountJson,
      collectionPath: pendingRunsCollectionPath(options.userId),
    }),
    listDocIds({
      serviceAccountJson: options.serviceAccountJson,
      collectionPath: processedRunsCollectionPath(options.userId),
    }),
    listFirestoreDocuments({
      serviceAccountJson: options.serviceAccountJson,
      collectionPath: `${sparkUserDocPath(options.userId)}/graderRuns`,
      orderBy: "createdAt desc",
      limit: options.limit ?? 120,
    }),
  ]);

  let queued = 0;
  for (const doc of runDocs) {
    const runId = docIdFromPath(doc.documentPath);
    const parsed = SparkGraderRunSchema.safeParse({
      id: runId,
      ...doc.data,
    });
    if (!parsed.success) {
      continue;
    }
    const run = parsed.data;
    if (!isDoneGradedRun(run)) {
      continue;
    }
    const completedAt = run.completedAt ?? run.updatedAt;
    const runVersion = buildRunVersion(run.id, completedAt);
    if (pendingIds.has(runVersion) || processedIds.has(runVersion)) {
      continue;
    }
    const didQueue = await queuePendingRun({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      runId: run.id,
      completedAt,
    });
    if (didQueue) {
      queued += 1;
      pendingIds.add(runVersion);
    }
  }
  return queued;
}

async function acquireLease(options: {
  serviceAccountJson: string;
  userId: string;
}): Promise<string | null> {
  const statePath = gapsFinderStateDocPath(options.userId);
  const snap = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: statePath,
  });
  const state = snap.data ?? {};
  const status = typeof state.status === "string" ? state.status : "idle";
  const startedAt =
    typeof state.startedAt === "string" || state.startedAt instanceof Date
      ? new Date(state.startedAt)
      : null;
  const lockFresh =
    status === "running" &&
    startedAt !== null &&
    !Number.isNaN(startedAt.getTime()) &&
    Date.now() - startedAt.getTime() < GAPS_FINDER_STALE_LOCK_MS;
  if (lockFresh) {
    return null;
  }

  const leaseId = randomUUID();
  const now = new Date();
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: statePath,
    updates: {
      schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
      status: "running",
      leaseId,
      startedAt: now,
      updatedAt: now,
    },
    deletes: ["lastError"],
  });

  const verify = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: statePath,
  });
  return verify.data?.leaseId === leaseId ? leaseId : null;
}

async function updateLeaseState(options: {
  serviceAccountJson: string;
  userId: string;
  leaseId: string;
  status: "idle" | "failed";
  updates?: Record<string, unknown>;
  deletes?: string[];
}): Promise<void> {
  const statePath = gapsFinderStateDocPath(options.userId);
  const snap = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: statePath,
  });
  if (snap.data?.leaseId !== options.leaseId) {
    return;
  }
  await patchFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: statePath,
    updates: {
      schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
      status: options.status,
      leaseId: null,
      updatedAt: new Date(),
      ...options.updates,
    },
    deletes: ["startedAt", ...(options.deletes ?? [])],
  });
}

function existingGapDedupeSet(gaps: SparkLearningGap[]): Set<string> {
  const keys = new Set<string>();
  for (const gap of gaps) {
    keys.add(gap.dedupeKey);
    keys.add(normalizeDedupeKey(`${gap.subjectKey}:${gap.type}:${gap.cardQuestion}`));
  }
  return keys;
}

function normalizeDedupeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
}

function buildGapId(gap: GeneratedGap, source: WeakQuestionCandidate): string {
  return buildShortGapId({
    subjectKey: source.subjectKey,
    seed: `${source.id}:${gap.type}:${gap.dedupeKey || gap.cardQuestion}`,
  });
}

function buildExistingGapId(gap: SparkLearningGap): string {
  return buildShortGapId({
    subjectKey: gap.subjectKey,
    seed: `${gap.source.runVersion}:${gap.source.questionId}:${gap.type}:${gap.dedupeKey}:${gap.cardQuestion}`,
  });
}

function buildShortGapId(options: { subjectKey: string; seed: string }): string {
  const subject = normalizeDocumentId(options.subjectKey).slice(0, 24) || "gap";
  return `${subject}-${shortHash(options.seed, 10)}`;
}

function normalizeSteps(steps: GeneratedGap["steps"]): SparkLearningGapStep[] {
  const normalized: SparkLearningGapStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step) {
      continue;
    }
    const id = `step-${(index + 1).toString()}`;
    if (step.kind === "free_text") {
      const expectedAnswer = step.expectedAnswer ?? step.modelAnswer ?? step.body;
      const modelAnswer = step.modelAnswer ?? step.expectedAnswer ?? step.body;
      if (!expectedAnswer || !modelAnswer) {
        continue;
      }
      normalized.push({
        id,
        kind: "free_text",
        ...(step.label ? { label: step.label } : {}),
        prompt: step.prompt,
        expectedAnswer,
        modelAnswer,
        markScheme:
          step.markScheme ??
          `Award the mark for this idea: ${expectedAnswer}`,
        gradingPrompt:
          step.gradingPrompt ??
          "Grade this short practice answer for the specific concept being practised. Award credit for the expected idea, not for wording.",
        maxMarks: step.maxMarks ?? 1,
        ...(step.placeholder ? { placeholder: step.placeholder } : {}),
      });
      continue;
    }
    if (step.kind === "multiple_choice") {
      if (!step.options || !step.correctOptionId || !step.explanation) {
        continue;
      }
      normalized.push({
        id,
        kind: "multiple_choice",
        ...(step.label ? { label: step.label } : {}),
        prompt: step.prompt,
        options: step.options,
        correctOptionId: step.correctOptionId,
        explanation: step.explanation,
      });
      continue;
    }
    const body = step.body ?? step.modelAnswer ?? step.expectedAnswer;
    if (!body) {
      continue;
    }
    normalized.push({
      id,
      kind: step.kind,
      ...(step.label ? { label: step.label } : {}),
      prompt: step.prompt,
      body,
    });
  }
  return normalized;
}

function splitSentenceLikeText(value: string, maxItems: number): string[] {
  const sentences = value
    .split(/(?<=[.!?])\s+/u)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0);
  if (sentences.length > 0) {
    return sentences.slice(0, maxItems);
  }
  const arrowParts = value
    .split(/\s*(?:->|→|;|\|)\s*/u)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0);
  return arrowParts.slice(0, maxItems);
}

function freeTextSteps(
  steps: SparkLearningGapStep[],
): Extract<SparkLearningGapStep, { kind: "free_text" }>[] {
  return steps.filter(
    (step): step is Extract<SparkLearningGapStep, { kind: "free_text" }> =>
      step.kind === "free_text",
  );
}

function modelAnswerStep(
  steps: SparkLearningGapStep[],
): Extract<SparkLearningGapStep, { kind: "model_answer" }> | undefined {
  return steps.find(
    (step): step is Extract<SparkLearningGapStep, { kind: "model_answer" }> =>
      step.kind === "model_answer",
  );
}

function memoryChainStep(
  steps: SparkLearningGapStep[],
): Extract<SparkLearningGapStep, { kind: "memory_chain" }> | undefined {
  return steps.find(
    (step): step is Extract<SparkLearningGapStep, { kind: "memory_chain" }> =>
      step.kind === "memory_chain",
  );
}

function fallbackFinalAnswer(gap: {
  cardQuestion: string;
  steps: SparkLearningGapStep[];
}): string {
  const model = modelAnswerStep(gap.steps)?.body;
  if (model) {
    return model;
  }
  const freeTextModels = freeTextSteps(gap.steps).map((step) => step.modelAnswer);
  if (freeTextModels.length > 0) {
    return freeTextModels.join(" ");
  }
  return gap.cardQuestion;
}

function fallbackIdeaChain(steps: SparkLearningGapStep[], finalAnswer: string): string[] {
  const memory = memoryChainStep(steps)?.body;
  const memoryParts = memory
    ? memory
        .split(/\s*(?:->|→|;|\|)\s*/u)
        .map((part) => normalizeWhitespace(part))
        .filter((part) => part.length > 0)
        .slice(0, 6)
    : [];
  if (memoryParts.length >= 2) {
    return memoryParts;
  }
  const labels = steps
    .map((step) => step.label ?? "")
    .filter((label) => label.trim().length > 0)
    .slice(0, 6);
  if (labels.length >= 2) {
    return labels;
  }
  const sentences = splitSentenceLikeText(finalAnswer, 6);
  return sentences.length >= 2 ? sentences : [finalAnswer, "GCSE answer"];
}

function fallbackGuidedQuestions(options: {
  cardQuestion: string;
  steps: SparkLearningGapStep[];
  finalAnswer: string;
}): SparkLearningGapGuidedPresentation["questions"] {
  const questions = freeTextSteps(options.steps)
    .slice(0, 8)
    .map((step, index) => ({
      id: `guided-${step.id || (index + 1).toString()}`,
      question: step.prompt,
      expectedAnswer: step.expectedAnswer,
      hint:
        index === 0
          ? "What fact from the question starts the chain?"
          : "Which change follows from the previous answer?",
      maxMarks: step.maxMarks,
    }));
  if (questions.length >= 2) {
    return questions;
  }
  return [
    {
      id: "guided-1",
      question: options.cardQuestion,
      expectedAnswer: options.finalAnswer,
      hint: "What key idea should the answer include?",
      maxMarks: 1,
    },
    {
      id: "guided-2",
      question: "How should that idea be linked into a complete answer?",
      expectedAnswer: options.finalAnswer,
      hint: "What cause-and-effect wording makes the answer clear?",
      maxMarks: 1,
    },
  ];
}

function fallbackPresentations(options: {
  cardQuestion: string;
  steps: SparkLearningGapStep[];
}): CompleteLearningGapPresentations {
  const finalAnswer = fallbackFinalAnswer({
    cardQuestion: options.cardQuestion,
    steps: options.steps,
  });
  const guidedQuestions = fallbackGuidedQuestions({
    cardQuestion: options.cardQuestion,
    steps: options.steps,
    finalAnswer,
  });
  const memoryChain =
    memoryChainStep(options.steps)?.body ??
    fallbackIdeaChain(options.steps, finalAnswer).join(" -> ");
  return {
    v17: {
      question: options.cardQuestion,
      instructions: "Answer each guiding question in a short phrase.",
      questions: guidedQuestions,
      memoryChain,
      answerPrompt: "Now combine those ideas into a GCSE model answer.",
      modelAnswer: finalAnswer,
      maxMarks: Math.min(
        8,
        Math.max(
          1,
          guidedQuestions.reduce(
            (total, question) => total + (question.maxMarks ?? 1),
            0,
          ),
        ),
      ),
    },
  };
}

function normalizePresentations(options: {
  generated?: Pick<GeneratedGap, "cardQuestion" | "presentations">;
  cardQuestion: string;
  steps: SparkLearningGapStep[];
}): CompleteLearningGapPresentations {
  const fallback = fallbackPresentations({
    cardQuestion: options.cardQuestion,
    steps: options.steps,
  });
  const rawPresentations = asRecord(options.generated?.presentations)
    ? normalizeGeneratedPresentations({
        presentations: options.generated?.presentations,
      })
    : undefined;
  const parsed = SparkLearningGapPresentationsSchema.safeParse(
    mergePresentations(rawPresentations, fallback),
  );
  if (parsed.success && parsed.data.v17) {
    return { v17: parsed.data.v17 };
  }
  return fallback;
}

function mergePresentations(
  candidate: Record<string, unknown> | undefined,
  fallback: CompleteLearningGapPresentations,
): CompleteLearningGapPresentations {
  const v17 = asRecord(candidate?.v17);
  const guidedQuestions = normalizeGeneratedGuidedQuestions(v17?.questions);
  return {
    v17: {
      question: firstString(v17 ?? {}, ["question"]) ?? fallback.v17.question,
      instructions:
        firstString(v17 ?? {}, ["instructions"]) ?? fallback.v17.instructions,
      questions:
        guidedQuestions.length > 0 ? guidedQuestions : fallback.v17.questions,
      memoryChain:
        firstString(v17 ?? {}, ["memoryChain", "chain"]) ??
        fallback.v17.memoryChain,
      answerPrompt:
        firstString(v17 ?? {}, ["answerPrompt", "composePrompt"]) ??
        fallback.v17.answerPrompt,
      modelAnswer:
        firstString(v17 ?? {}, ["modelAnswer", "finalAnswer", "answer"]) ??
        fallback.v17.modelAnswer,
      markScheme:
        firstString(v17 ?? {}, ["markScheme", "rubric"]) ??
        fallback.v17.markScheme,
      maxMarks:
        typeof v17?.maxMarks === "number" ? v17.maxMarks : fallback.v17.maxMarks,
    },
  };
}

function buildGenerationPrompt(options: {
  candidates: WeakQuestionCandidate[];
  existingGaps: SparkLearningGap[];
}): string {
  const existing = options.existingGaps.map((gap) => ({
    type: gap.type,
    subjectKey: gap.subjectKey,
    dedupeKey: gap.dedupeKey,
    cardQuestion: gap.cardQuestion,
  }));
  return [
    "You are Spark's gaps-finder agent for GCSE worksheet feedback.",
    "",
    renderSparkAgentSkillContentSection({
      heading: "Gap Finder Skill",
      skillIds: SPARK_GAPS_FINDER_SKILL_IDS,
    }),
    "",
    "Example shape:",
    JSON.stringify(
      {
        gaps: [
          {
            sourceCandidateId: "run-version:q1",
            type: "knowledge_gap",
            title: "Guard cells and osmosis",
            cardQuestion:
              "Explain how extra glucose in guard cells makes a stoma open.",
            shortRationale: "The answer missed the water-potential chain.",
            dedupeKey: "biology-guard-cells-osmosis-stoma-opening",
            severity: 4,
            steps: [
              {
                kind: "free_text",
                label: "Glucose concentration",
                prompt: "What happens to glucose concentration in guard cells during the day?",
                expectedAnswer: "It increases.",
                modelAnswer: "Glucose concentration increases in the guard cells.",
                markScheme: "Award 1 mark for glucose concentration increasing.",
                maxMarks: 1,
              },
              {
                kind: "model_answer",
                label: "GCSE answer",
                prompt: "Now combine those answers into a GCSE model answer.",
                body:
                  "An increase in glucose concentration lowers the water potential of the guard cells, so water enters by osmosis. The guard cells become turgid and bend apart, opening the stoma.",
              },
              {
                kind: "memory_chain",
                label: "Memory chain",
                prompt: "Very short memory chain",
                body:
                  "glucose up → water potential down → water in by osmosis → turgid → bend apart → stoma opens",
              },
            ],
            presentations: {
              v17: {
                question:
                  "Explain how extra glucose in guard cells makes a stoma open.",
                instructions:
                  "Answer each guiding question in a short phrase, then combine the ideas.",
                questions: [
                  {
                    id: "made",
                    question: "What is made in the guard cells during the day?",
                    expectedAnswer: "Glucose is made.",
                    hint: "Which product of photosynthesis starts this chain?",
                    maxMarks: 1,
                  },
                  {
                    id: "concentration",
                    question:
                      "So what happens to the glucose concentration in the guard cells?",
                    expectedAnswer: "It increases.",
                    hint: "Does the amount dissolved inside go up or down?",
                    maxMarks: 1,
                  },
                  {
                    id: "water-potential",
                    question:
                      "If a cell has more dissolved glucose inside it, what happens to its water potential?",
                    expectedAnswer: "Its water potential becomes lower.",
                    hint: "What happens to water potential when solute concentration rises?",
                    maxMarks: 1,
                  },
                  {
                    id: "osmosis",
                    question:
                      "What happens when guard cells have a lower water potential than nearby cells?",
                    expectedAnswer: "Water moves into the guard cells by osmosis.",
                    hint: "Which way does water move across the partially permeable membrane?",
                    maxMarks: 1,
                  },
                ],
                memoryChain:
                  "glucose up → water potential down → water in by osmosis → guard cells turgid → bend apart → stoma opens",
                answerPrompt:
                  "Now combine those ideas into a GCSE model answer.",
                modelAnswer:
                  "Extra glucose lowers the water potential inside guard cells, so water enters by osmosis. The guard cells become turgid and bend apart, opening the stoma.",
                markScheme:
                  "Award marks for glucose increasing, water potential falling, water entering by osmosis, guard cells becoming turgid, and the stoma opening.",
                maxMarks: 5,
              },
            },
          },
        ],
      },
      null,
      2,
    ),
    "",
    "For every generated gap, include only `presentations.v17` guided-question answer-builder data. Do not generate `presentations.v11`, `presentations.v16`, or any other presentation variants.",
    "`presentations.v17.question` is displayed as normal Markdown with LaTeX support, so use Markdown and LaTeX for formulas, equations, calculations, units, and structured source details when that makes the problem clearer. In JSON output, prefer `$...$` and `$$...$$` math delimiters; avoid backslash math delimiters because unescaped backslashes make invalid JSON.",
    "The v17 questions must form a cause-and-effect path to the same model answer. Each `v17.questions[].question` is shown beside a short answer field, so keep it single-line plain text with no LaTeX, no display math, and no multiline formatting; use Unicode symbols such as `×`, `→`, `≤`, or `Δ` when helpful. Each `expectedAnswer` must be short, single-line plain text with no Markdown, no LaTeX, and no formatting. Each `hint` must be a single-line plain-text non-revealing guiding question that ends in `?`, does not repeat the question text, and does not contain or paraphrase the answer. Include a very short `memoryChain`, a polished `modelAnswer`, and a usable `markScheme` for grading the learner's final written answer.",
    "",
    "Existing active gaps to dedupe against:",
    JSON.stringify(existing, null, 2),
    "",
    "New weak-question candidates:",
    JSON.stringify(options.candidates, null, 2),
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function normalizeGeneratedGuidedQuestions(
  value: unknown,
): SparkLearningGapGuidedPresentation["questions"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const questions: SparkLearningGapGuidedPresentation["questions"] = [];
  for (let index = 0; index < value.length; index += 1) {
    const record = asRecord(value[index]);
    if (!record) {
      continue;
    }
    const question = firstString(record, ["question", "prompt"]);
    const expectedAnswer = firstString(record, [
      "expectedAnswer",
      "answer",
      "modelAnswer",
    ]);
    if (!question || !expectedAnswer) {
      continue;
    }
    const normalizedQuestion = normalizeGuidedFieldText(question);
    const normalizedExpectedAnswer = normalizeGuidedFieldText(expectedAnswer);
    const hint = normalizeGuidedHint({
      hint: firstString(record, ["hint", "guidance", "placeholder"]),
      question: normalizedQuestion,
      expectedAnswer: normalizedExpectedAnswer,
      index,
    });
    questions.push({
      id:
        firstString(record, ["id", "questionId", "key"]) ??
        `guided-${(index + 1).toString()}`,
      question: normalizedQuestion,
      expectedAnswer: normalizedExpectedAnswer,
      ...(hint ? { hint } : {}),
      ...(typeof record.maxMarks === "number" ? { maxMarks: record.maxMarks } : {}),
    });
  }
  return questions;
}

function normalizeGuidedHint(input: {
  hint: string | undefined;
  question: string;
  expectedAnswer: string;
  index: number;
}): string {
  const fallback = fallbackGuidedHint(input);
  if (!input.hint) {
    return fallback;
  }
  const hint = normalizeWhitespace(input.hint);
  if (
    !hint.endsWith("?") ||
    hasGuidedFieldFormatting(input.hint) ||
    tooSimilarForGuidedHint(hint, input.question) ||
    revealsGuidedExpectedAnswer(hint, input.expectedAnswer)
  ) {
    return fallback;
  }
  return hint;
}

function fallbackGuidedHint(input: {
  question: string;
  index: number;
}): string {
  const question = normalizeWhitespace(input.question).toLowerCase();
  if (question.includes("%") || question.includes("percent")) {
    return "How do you convert the percentage before using it?";
  }
  if (question.includes("calculation") || question.includes("calculate")) {
    return "Which values need to be combined for this step?";
  }
  if (question.includes("mean rate") || question.includes("rate")) {
    return "Which change and time interval are needed here?";
  }
  if (
    question.includes("higher") ||
    question.includes("lower") ||
    question.includes("compare") ||
    question.includes("which source")
  ) {
    return "Which option matches the clue in the original question?";
  }
  if (question.includes("gain") || question.includes("lose")) {
    return "Which electron change happens at this electrode?";
  }
  if (question.startsWith("where") || question.includes(" where ")) {
    return "Which location does the model place it in?";
  }
  if (question.includes("called") || question.includes("term")) {
    return "Which technical term names this idea?";
  }
  if (question.includes("problem") || question.includes("cause")) {
    return "What problem does the previous idea create?";
  }
  return input.index === 0
    ? "Which first fact or calculation starts the answer chain?"
    : "Which next link connects to your previous answer?";
}

function tooSimilarForGuidedHint(hint: string, question: string): boolean {
  const hintTerms = meaningfulTerms(hint);
  const questionTerms = meaningfulTerms(question);
  if (hintTerms.length === 0 || questionTerms.length === 0) {
    return false;
  }
  const questionSet = new Set(questionTerms);
  const overlap = hintTerms.filter((term) => questionSet.has(term)).length;
  return overlap / Math.max(1, Math.min(hintTerms.length, questionTerms.length)) > 0.7;
}

function revealsGuidedExpectedAnswer(hint: string, expectedAnswer: string): boolean {
  const hintTerms = new Set(meaningfulTerms(hint));
  const answerTerms = meaningfulTerms(expectedAnswer);
  if (answerTerms.length === 0) {
    return false;
  }
  const answerOverlap = answerTerms.filter((term) => hintTerms.has(term)).length;
  return answerOverlap / answerTerms.length >= 0.5;
}

function meaningfulTerms(value: string): string[] {
  const stopWords = new Set([
    "about",
    "after",
    "answer",
    "because",
    "before",
    "does",
    "from",
    "happen",
    "happens",
    "have",
    "into",
    "that",
    "them",
    "then",
    "there",
    "these",
    "this",
    "what",
    "when",
    "where",
    "which",
    "with",
  ]);
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .split(/[\s-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 4 && !stopWords.has(term));
}

function normalizeGeneratedPresentations(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const direct = asRecord(record.presentations);
  const container = direct ?? record;
  const v17Raw =
    asRecord(container.v17) ??
    asRecord(container.guided) ??
    asRecord(container.guidedQuestions) ??
    asRecord(container.guidedPresentation) ??
    asRecord(container.questionGuide);
  if (!v17Raw) {
    return direct ?? undefined;
  }
  const presentations: Record<string, unknown> = {};
  presentations.v17 = {
    question: firstString(v17Raw, ["question", "prompt", "title", "gapQuestion"]),
    instructions: firstString(v17Raw, ["instructions", "instruction", "objective"]),
    questions: normalizeGeneratedGuidedQuestions(v17Raw.questions),
    memoryChain: firstString(v17Raw, ["memoryChain", "chain"]),
    answerPrompt: firstString(v17Raw, ["answerPrompt", "composePrompt"]),
    modelAnswer: firstString(v17Raw, ["modelAnswer", "finalAnswer", "answer"]),
    markScheme: firstString(v17Raw, ["markScheme", "rubric"]),
    maxMarks: typeof v17Raw.maxMarks === "number" ? v17Raw.maxMarks : undefined,
  };
  return presentations;
}

function normalizeGapType(value: unknown): GeneratedGap["type"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "knowledge_gap" || normalized === "knowledge") {
    return "knowledge_gap";
  }
  if (normalized === "misconception") {
    return "misconception";
  }
  if (
    normalized === "oversight" ||
    normalized === "exam_technique" ||
    normalized === "technique"
  ) {
    return "oversight";
  }
  return undefined;
}

function normalizeStepKind(value: unknown): GeneratedGap["steps"][number]["kind"] {
  if (typeof value !== "string") {
    return "free_text";
  }
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "multiple_choice" || normalized === "mcq") {
    return "multiple_choice";
  }
  if (normalized === "model_answer" || normalized === "gcse_model_answer") {
    return "model_answer";
  }
  if (normalized === "memory_chain" || normalized === "chain") {
    return "memory_chain";
  }
  return "free_text";
}

function normalizeGeneratedStep(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const kind = normalizeStepKind(record.kind ?? record.type ?? record.stepType);
  const prompt =
    firstString(record, ["prompt", "question", "title"]) ??
    (kind === "memory_chain" ? "Very short memory chain" : undefined);
  if (!prompt) {
    return null;
  }
  const label = firstString(record, [
    "label",
    "eyebrow",
    "skillLabel",
    "topicLabel",
    "microTitle",
  ]);
  const body = firstString(record, [
    "body",
    "answer",
    "modelAnswer",
    "memoryChain",
    "content",
    "explanation",
  ]);
  if (kind === "model_answer" || kind === "memory_chain") {
    return {
      kind,
      ...(label ? { label } : {}),
      prompt,
      ...(body ? { body } : {}),
    };
  }
  if (kind === "multiple_choice") {
    return {
      kind,
      ...(label ? { label } : {}),
      prompt,
      options: record.options,
      correctOptionId: firstString(record, ["correctOptionId", "correctOption", "answerId"]),
      explanation: firstString(record, ["explanation", "body", "answer"]),
    };
  }
  const expectedAnswer = firstString(record, [
    "expectedAnswer",
    "answer",
    "shortAnswer",
    "modelAnswer",
  ]);
  const modelAnswer = firstString(record, ["modelAnswer", "answer", "expectedAnswer"]);
  return {
    kind: "free_text",
    ...(label ? { label } : {}),
    prompt,
    ...(expectedAnswer ? { expectedAnswer } : {}),
    ...(modelAnswer ? { modelAnswer } : {}),
    markScheme:
      firstString(record, ["markScheme", "markingPoints"]) ??
      (expectedAnswer ? `Award the mark for: ${expectedAnswer}` : undefined),
    gradingPrompt: firstString(record, ["gradingPrompt"]),
    maxMarks: typeof record.maxMarks === "number" ? record.maxMarks : 1,
    placeholder: firstString(record, ["placeholder"]),
  };
}

function normalizeGeneratedResponse(value: unknown): unknown {
  const root = Array.isArray(value) ? { gaps: value } : value;
  const rootRecord = asRecord(root);
  if (!rootRecord) {
    return value;
  }
  const rawGaps = Array.isArray(rootRecord.gaps)
    ? rootRecord.gaps
    : Array.isArray(rootRecord.items)
      ? rootRecord.items
      : [];
  return {
    gaps: rawGaps
      .map((entry) => {
        const record = asRecord(entry);
        if (!record) {
          return null;
        }
        const type = normalizeGapType(record.type ?? record.gapType ?? record.category);
        const sourceCandidateId = firstString(record, [
          "sourceCandidateId",
          "candidateId",
          "sourceId",
        ]);
        const cardQuestion = firstString(record, [
          "cardQuestion",
          "question",
          "problem",
          "prompt",
        ]);
        const title = firstString(record, ["title", "cardTitle", "name"]) ?? cardQuestion;
        const rawSteps = Array.isArray(record.steps)
          ? record.steps
          : Array.isArray(record.slides)
            ? record.slides
            : Array.isArray(record.learningSteps)
              ? record.learningSteps
              : Array.isArray(record.questions)
                ? record.questions
                : [];
        return {
          sourceCandidateId,
          type,
          title,
          cardQuestion,
          shortRationale: firstString(record, ["shortRationale", "rationale", "reason"]),
          dedupeKey:
            firstString(record, ["dedupeKey", "key"]) ??
            normalizeDedupeKey(`${type ?? "gap"}:${title ?? cardQuestion ?? ""}`),
          severity: typeof record.severity === "number" ? record.severity : 3,
          steps: rawSteps
            .map((step) => normalizeGeneratedStep(step))
            .filter((step): step is Record<string, unknown> => step !== null),
          presentations: normalizeGeneratedPresentations(record),
        };
      })
      .filter((gap) => gap !== null),
  };
}

async function generateGaps(options: {
  candidates: WeakQuestionCandidate[];
  existingGaps: SparkLearningGap[];
}): Promise<GeneratedGap[]> {
  if (options.candidates.length === 0) {
    return [];
  }
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rawText = await generateText({
        modelId: GAPS_FINDER_MODEL_ID,
        responseMimeType: "application/json",
        contents: [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: buildGenerationPrompt(options),
              },
            ],
          },
        ],
      });
      const parsedJson = parseJsonFromLlmText(rawText);
      const response = generatedGapResponseSchema.parse(
        normalizeGeneratedResponse(parsedJson),
      );
      return response.gaps;
    } catch (error) {
      lastError = error;
      console.warn("[gaps-finder] generation attempt failed", {
        attempt,
        error: errorAsString(error),
      });
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(
    lastError === null
      ? "Gaps finder generation failed"
      : errorAsString(lastError),
  );
}

function buildPresentationBackfillPrompt(gap: SparkLearningGap): string {
  const finalAnswer = fallbackFinalAnswer({
    cardQuestion: gap.cardQuestion,
    steps: gap.steps,
  });
  return [
    "You are Spark's gaps-finder agent preparing UI presentation data for one existing GCSE practice gap.",
    "Return JSON only with exactly one top-level key: `presentations`.",
    "",
    "Create only `presentations.v17` guided-question answer-builder data. Do not create `v11`, `v16`, or any other presentation variant.",
    "`v17` must include `question`, optional `instructions`, 3 to 8 `questions`, `memoryChain`, optional `answerPrompt`, `modelAnswer`, `markScheme`, and `maxMarks`. `v17.question` is rendered as normal Markdown with LaTeX support, so use Markdown and math delimiters for formulas, calculations, units, and structured source detail when useful. In JSON output, prefer `$...$` and `$$...$$` math delimiters; avoid backslash math delimiters because unescaped backslashes make invalid JSON. Each guided question needs `id`, `question`, `expectedAnswer`, and a non-revealing `hint`. Each guided `question` is shown beside a short answer field, so keep it single-line plain text with no LaTeX, no display math, and no multiline formatting; Unicode symbols are allowed when helpful. The questions should lead step by step to the same GCSE model answer. Every `expectedAnswer` and `hint` must be short single-line plain text with no Markdown, no LaTeX, and no formatting. Every hint must be a guiding question ending in `?`, must not repeat the displayed question, and must not contain or paraphrase the answer.",
    "",
    "The guided presentation must agree with the existing quiz steps and must not add unrelated facts.",
    "",
    "Existing gap:",
    JSON.stringify(
      {
        title: gap.title,
        subjectLabel: gap.subjectLabel,
        type: gap.type,
        cardQuestion: gap.cardQuestion,
        shortRationale: gap.shortRationale,
        sourceQuestion: gap.source.questionPrompt,
        existingFinalAnswer: finalAnswer,
        steps: gap.steps.map((step) => {
          if (step.kind === "free_text") {
            return {
              kind: step.kind,
              label: step.label,
              prompt: step.prompt,
              expectedAnswer: step.expectedAnswer,
              modelAnswer: step.modelAnswer,
              markScheme: step.markScheme,
            };
          }
          if (step.kind === "multiple_choice") {
            return {
              kind: step.kind,
              label: step.label,
              prompt: step.prompt,
              explanation: step.explanation,
            };
          }
          return {
            kind: step.kind,
            label: step.label,
            prompt: step.prompt,
            body: step.body,
          };
        }),
      },
      null,
      2,
    ),
  ].join("\n");
}

async function generatePresentationsForGap(
  gap: SparkLearningGap,
): Promise<CompleteLearningGapPresentations> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const rawText = await generateText({
        modelId: GAPS_FINDER_MODEL_ID,
        responseMimeType: "application/json",
        contents: [
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: buildPresentationBackfillPrompt(gap),
              },
            ],
          },
        ],
      });
      const parsedJson = parseJsonFromLlmText(rawText);
      const rootRecord = asRecord(parsedJson);
      const fallback = fallbackPresentations({
        cardQuestion: gap.cardQuestion,
        steps: gap.steps,
      });
      const normalized =
        rootRecord !== null ? normalizeGeneratedPresentations(rootRecord) : undefined;
      const parsed = SparkLearningGapPresentationsSchema.safeParse(
        mergePresentations(normalized, fallback),
      );
      if (parsed.success && parsed.data.v17) {
        return { v17: parsed.data.v17 };
      }
      throw new Error(
        parsed.success
          ? "Invalid generated gap presentations: missing presentations.v17"
          : `Invalid generated gap presentations: ${parsed.error.message}`,
      );
    } catch (error) {
      lastError = error;
      console.warn("[gaps-finder] presentation generation attempt failed", {
        gapId: gap.id,
        attempt,
        error: errorAsString(error),
      });
    }
  }
  console.warn("[gaps-finder] using fallback presentation data", {
    gapId: gap.id,
    error: errorAsString(lastError),
  });
  return fallbackPresentations({
    cardQuestion: gap.cardQuestion,
    steps: gap.steps,
  });
}

async function backfillGapPresentations(options: {
  serviceAccountJson: string;
  userId: string;
  force: boolean;
}): Promise<number> {
  const gaps = await listExistingGaps({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
  });
  let updated = 0;
  for (const gap of gaps) {
    const nextGapId = buildExistingGapId(gap);
    if (!options.force && gap.presentations?.v17 && gap.id === nextGapId) {
      continue;
    }
    const presentations = await generatePresentationsForGap(gap);
    if (nextGapId === gap.id) {
      await patchFirestoreDocument({
        serviceAccountJson: options.serviceAccountJson,
        documentPath: gapDocPath(options.userId, gap.id),
        updates: {
          presentations,
          updatedAt: new Date(),
        },
      });
    } else {
      await setFirestoreDocument({
        serviceAccountJson: options.serviceAccountJson,
        documentPath: gapDocPath(options.userId, nextGapId),
        data: {
          ...gap,
          id: nextGapId,
          presentations,
          updatedAt: new Date(),
        } as unknown as Record<string, unknown>,
      });
      await deleteFirestoreDocument({
        serviceAccountJson: options.serviceAccountJson,
        documentPath: gapDocPath(options.userId, gap.id),
      });
    }
    updated += 1;
  }
  return updated;
}
async function writeGapFinderWorkspace(options: {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  loadedRuns: LoadedQueuedRun[];
  candidates: WeakQuestionCandidate[];
  existingGaps: SparkLearningGap[];
}): Promise<void> {
  const now = new Date();
  const newRuns = options.loadedRuns.map(({ pending, run, candidates }) => ({
    runId: run.id,
    runVersion: pending.runVersion,
    completedAt: pending.completedAt?.toISOString() ?? null,
    title: run.presentation?.title ?? run.sheet?.title ?? run.resultSummary ?? "Graded sheet",
    candidateCount: candidates.length,
  }));

  await upsertWorkspaceTextFileDoc({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
    workspaceId: options.workspaceId,
    filePath: "brief.md",
    content: [
      "# Gaps finder",
      "",
      "Read and follow `skills/gap-finder/SKILL.md`.",
      "",
      "Analyze the newly graded sheets in `gaps/input/new-runs.json` and the staged worksheet reports under `gaps/input/reports/`.",
      "Create concise, deduplicated learning gaps only for the most useful low-score questions.",
    ].join("\n"),
    contentType: "text/markdown",
    createdAt: now,
    updatedAt: now,
  });
  for (const skillFile of resolveSparkAgentSkillFiles(SPARK_GAPS_FINDER_SKILL_IDS)) {
    await upsertWorkspaceTextFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: skillFile.path,
      content: skillFile.content,
      contentType: skillFile.contentType,
      createdAt: now,
      updatedAt: now,
    });
  }
  await upsertWorkspaceTextFileDoc({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
    workspaceId: options.workspaceId,
    filePath: "request.json",
    content: JSON.stringify(
      {
        schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
        kind: "gaps-finder",
        userId: options.userId,
        newRunCount: newRuns.length,
      },
      null,
      2,
    ),
    contentType: "application/json",
    createdAt: now,
    updatedAt: now,
  });
  await upsertWorkspaceTextFileDoc({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
    workspaceId: options.workspaceId,
    filePath: "gaps/input/new-runs.json",
    content: JSON.stringify(
      {
        schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
        runs: newRuns,
        candidates: options.candidates,
      },
      null,
      2,
    ),
    contentType: "application/json",
    createdAt: now,
    updatedAt: now,
  });
  await upsertWorkspaceTextFileDoc({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
    workspaceId: options.workspaceId,
    filePath: "gaps/input/existing-gaps.json",
    content: JSON.stringify(
      options.existingGaps.map((gap) => ({
        id: gap.id,
        type: gap.type,
        subjectKey: gap.subjectKey,
        dedupeKey: gap.dedupeKey,
        cardQuestion: gap.cardQuestion,
      })),
      null,
      2,
    ),
    contentType: "application/json",
    createdAt: now,
    updatedAt: now,
  });
  for (const loaded of options.loadedRuns) {
    await upsertWorkspaceTextFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: `gaps/input/reports/${loaded.pending.runVersion}.json`,
      content: loaded.reportRaw,
      contentType: "application/json",
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function loadQueuedRuns(options: {
  serviceAccountJson: string;
  userId: string;
  pendingRuns: PendingRunDoc[];
}): Promise<LoadedQueuedRun[]> {
  const loadedRuns: LoadedQueuedRun[] = [];
  for (const pending of options.pendingRuns) {
    const run = await loadGraderRun({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      runId: pending.runId,
    });
    if (!run || !isDoneGradedRun(run)) {
      continue;
    }
    const reportPath = run.sheet?.filePath ?? run.sheetPath;
    const reportRaw = await readWorkspaceTextFile({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId: run.workspaceId,
      filePath: reportPath,
    });
    if (!reportRaw) {
      continue;
    }
    let parsedReportJson: unknown;
    try {
      parsedReportJson = JSON.parse(reportRaw);
    } catch (error) {
      console.warn("[gaps-finder] worksheet report is not JSON", {
        runId: run.id,
        error: errorAsString(error),
      });
      continue;
    }
    const report = SparkGraderWorksheetReportSchema.safeParse(parsedReportJson);
    if (!report.success) {
      console.warn("[gaps-finder] invalid worksheet report", {
        runId: run.id,
        issues: report.error.issues,
      });
      continue;
    }
    const candidates = extractWeakQuestionCandidates({
      pending,
      run,
      report: report.data,
    });
    loadedRuns.push({
      pending,
      run,
      report: report.data,
      reportRaw,
      candidates,
    });
  }
  return loadedRuns;
}

async function persistGeneratedGaps(options: {
  serviceAccountJson: string;
  userId: string;
  generatedGaps: GeneratedGap[];
  candidates: WeakQuestionCandidate[];
  existingGaps: SparkLearningGap[];
}): Promise<SparkLearningGap[]> {
  const candidateById = new Map(
    options.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const seen = existingGapDedupeSet(options.existingGaps);
  const persisted: SparkLearningGap[] = [];
  const now = new Date();

  for (const generated of options.generatedGaps) {
    const source = candidateById.get(generated.sourceCandidateId);
    if (!source) {
      continue;
    }
    const dedupeKey = normalizeDedupeKey(
      `${source.subjectKey}:${generated.type}:${generated.dedupeKey}`,
    );
    const cardKey = normalizeDedupeKey(
      `${source.subjectKey}:${generated.type}:${generated.cardQuestion}`,
    );
    if (seen.has(dedupeKey) || seen.has(cardKey)) {
      continue;
    }
    seen.add(dedupeKey);
    seen.add(cardKey);
    const gapId = buildGapId(generated, source);
    const steps = normalizeSteps(generated.steps);
    const parsedGap = SparkLearningGapSchema.safeParse({
      id: gapId,
      schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
      status: "active",
      type: generated.type,
      title: generated.title,
      cardQuestion: generated.cardQuestion,
      ...(generated.shortRationale ? { shortRationale: generated.shortRationale } : {}),
      subjectKey: source.subjectKey,
      subjectLabel: source.subjectLabel,
      dedupeKey,
      severity: generated.severity,
      source: {
        runId: source.runId,
        runVersion: source.runVersion,
        questionId: source.questionId,
        questionLabel: source.questionLabel,
        questionPrompt: source.questionPrompt,
        sheetTitle: source.sheetTitle,
        paperLabel: source.paperLabel,
        awardedMarks: source.awardedMarks,
        maxMarks: source.maxMarks,
      },
      steps,
      presentations: normalizePresentations({
        generated,
        cardQuestion: generated.cardQuestion,
        steps,
      }),
      createdAt: now,
      updatedAt: now,
    });
    if (!parsedGap.success) {
      console.warn("[gaps-finder] skipping invalid generated gap", {
        sourceCandidateId: generated.sourceCandidateId,
        issues: parsedGap.error.issues,
      });
      continue;
    }
    const gap = parsedGap.data;
    await setFirestoreDocument({
      serviceAccountJson: options.serviceAccountJson,
      documentPath: gapDocPath(options.userId, gap.id),
      data: gap as unknown as Record<string, unknown>,
    });
    persisted.push(gap);
  }
  return persisted;
}

async function markRunsProcessed(options: {
  serviceAccountJson: string;
  userId: string;
  pendingRuns: PendingRunDoc[];
  loadedRuns: LoadedQueuedRun[];
  persistedGaps: SparkLearningGap[];
  workspaceId: string;
}): Promise<void> {
  const loadedByVersion = new Map(
    options.loadedRuns.map((loaded) => [loaded.pending.runVersion, loaded]),
  );
  for (const pending of options.pendingRuns) {
    const loaded = loadedByVersion.get(pending.runVersion);
    const gapCount = options.persistedGaps.filter(
      (gap) => gap.source.runVersion === pending.runVersion,
    ).length;
    await setFirestoreDocument({
      serviceAccountJson: options.serviceAccountJson,
      documentPath: processedRunDocPath(options.userId, pending.runVersion),
      data: {
        schemaVersion: GAPS_FINDER_SCHEMA_VERSION,
        runId: pending.runId,
        runVersion: pending.runVersion,
        ...(pending.completedAt ? { completedAt: pending.completedAt } : {}),
        processedAt: new Date(),
        gapCount,
        candidateCount: loaded?.candidates.length ?? 0,
        workspaceId: options.workspaceId,
      },
    });
    await deleteFirestoreDocument({
      serviceAccountJson: options.serviceAccountJson,
      documentPath: pending.documentPath,
    });
  }
}

export async function runSparkGapsFinder(
  options: RunGapsFinderOptions,
): Promise<{
  status: "completed" | "already_running";
  processedRunCount?: number;
  createdGapCount?: number;
  updatedGapPresentationCount?: number;
  workspaceId?: string;
}> {
  if (options.scanBacklog) {
    await queueUnprocessedBacklog({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
    });
  }

  const leaseId = await acquireLease({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
  });
  if (!leaseId) {
    return { status: "already_running" };
  }

  const workspaceId = `gaps-finder-${Date.now().toString()}-${shortHash(randomUUID(), 8)}`;
  try {
    const pendingRuns = await listPendingRuns({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      limit: GAPS_FINDER_BATCH_SIZE,
    });
    if (pendingRuns.length === 0) {
      const updatedGapPresentationCount = options.forceUiData
        ? await backfillGapPresentations({
            serviceAccountJson: options.serviceAccountJson,
            userId: options.userId,
            force: true,
          })
        : 0;
      await updateLeaseState({
        serviceAccountJson: options.serviceAccountJson,
        userId: options.userId,
        leaseId,
        status: "idle",
        updates: {
          lastCompletedAt: new Date(),
        },
      });
      return {
        status: "completed",
        processedRunCount: 0,
        createdGapCount: 0,
        updatedGapPresentationCount,
      };
    }

    const loadedRuns = await loadQueuedRuns({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      pendingRuns,
    });
    const allCandidates = loadedRuns
      .flatMap((loaded) => loaded.candidates)
      .slice(0, GAPS_FINDER_MAX_CANDIDATES);
    const existingGaps = await listExistingGaps({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
    });

    await writeGapFinderWorkspace({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId,
      loadedRuns,
      candidates: allCandidates,
      existingGaps,
    });

    const generatedGaps = await generateGaps({
      candidates: allCandidates,
      existingGaps,
    });
    const persistedGaps = await persistGeneratedGaps({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      generatedGaps,
      candidates: allCandidates,
      existingGaps,
    });

    await markRunsProcessed({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      pendingRuns,
      loadedRuns,
      persistedGaps,
      workspaceId,
    });

    const remainingPending = await listPendingRuns({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      limit: 1,
    });
    const updatedGapPresentationCount =
      options.forceUiData && remainingPending.length === 0
        ? await backfillGapPresentations({
            serviceAccountJson: options.serviceAccountJson,
            userId: options.userId,
            force: true,
          })
        : 0;

    await updateLeaseState({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      leaseId,
      status: "idle",
      updates: {
        lastCompletedAt: new Date(),
        lastWorkspaceId: workspaceId,
      },
    });

    if (remainingPending.length > 0) {
      await enqueueGapsFinderTask({
        serviceAccountJson: options.serviceAccountJson,
        userId: options.userId,
        forceUiData: options.forceUiData,
      });
    }

    return {
      status: "completed",
      processedRunCount: pendingRuns.length,
      createdGapCount: persistedGaps.length,
      updatedGapPresentationCount,
      workspaceId,
    };
  } catch (error) {
    await updateLeaseState({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      leaseId,
      status: "failed",
      updates: {
        lastError: compactText(errorAsString(error), 1000),
      },
    });
    throw error;
  }
}

export const __gapsFinderInternalsForTests = {
  buildRunVersion,
  extractWeakQuestionCandidates,
  normalizeDedupeKey,
  normalizeDocumentId,
  renderQuestionPrompt,
  shouldCreateCandidate,
  PaperSheetQuestionSchema,
};
