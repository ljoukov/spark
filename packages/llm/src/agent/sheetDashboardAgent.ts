import { randomUUID } from "node:crypto";

import {
  SparkGraderRunSchema,
  SparkGraderWorksheetReportSchema,
  SparkSheetDashboardStateSchema,
} from "@spark/schemas";

import {
  getFirestoreDocument,
  listFirestoreDocuments,
  setFirestoreDocument,
} from "../utils/gcp/firestoreRest";
import { createTask } from "../utils/tasks";
import {
  buildWorkspaceFileDocPath,
  upsertWorkspaceTextFileDoc,
} from "./workspaceFileStore";

export const SPARK_SHEET_DASHBOARD_OUTPUT_PATH =
  "dashboard/output/dashboard.json" as const;

type DashboardRefreshStatus =
  | {
      status: "empty";
      href: "/spark/sheets";
    }
  | {
      status: "started";
      agentId: string;
      workspaceId: string;
      gradedSheetCount: number;
      href: "/spark/sheets";
    };

type DashboardGradedSheetInput = {
  runId: string;
  title: string;
  summaryMarkdown: string | null;
  percentage: number | null;
  updatedAt: string;
  reportPath: string;
  subject: string;
};

function docIdFromPath(documentPath: string): string {
  const parts = documentPath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? documentPath;
}

export function resolveSheetDashboardDocPath(userId: string): string {
  return `spark/${userId}/sheetDashboard/current`;
}

function resolveWorkspaceReportPath(runId: string): string {
  return `dashboard/input/reports/${runId}.json`;
}

async function getWorkspaceTextFile(options: {
  serviceAccountJson: string;
  userId: string;
  workspaceId: string;
  filePath: string;
}): Promise<string | null> {
  const snapshot = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: buildWorkspaceFileDocPath({
      userId: options.userId,
      workspaceId: options.workspaceId,
      filePath: options.filePath,
    }),
  });
  if (!snapshot.exists || !snapshot.data) {
    return null;
  }
  const content = snapshot.data.content;
  return typeof content === "string" ? content : null;
}

async function listGraderRuns(options: {
  serviceAccountJson: string;
  userId: string;
  limit: number;
}): Promise<Array<ReturnType<typeof SparkGraderRunSchema.parse>>> {
  const docs = await listFirestoreDocuments({
    serviceAccountJson: options.serviceAccountJson,
    collectionPath: `spark/${options.userId}/graderRuns`,
    limit: options.limit,
    orderBy: "createdAt desc",
  });
  const runs: Array<ReturnType<typeof SparkGraderRunSchema.parse>> = [];
  for (const doc of docs) {
    const parsed = SparkGraderRunSchema.safeParse({
      id: docIdFromPath(doc.documentPath),
      ...doc.data,
    });
    if (!parsed.success) {
      console.warn("[sheet-dashboard] skipping invalid grader run", {
        documentPath: doc.documentPath,
        issues: parsed.error.issues,
      });
      continue;
    }
    runs.push(parsed.data);
  }
  return runs;
}

function buildDashboardBrief(options: {
  focusNote?: string;
  generatedFromRunId?: string;
  gradedSheetCount: number;
  previousDashboardExists: boolean;
}): string {
  const lines = [
    "# Sheet dashboard refresh request",
    "",
    `- Graded sheet count available: ${options.gradedSheetCount.toString()}.`,
    `- Previous dashboard present: ${options.previousDashboardExists ? "yes" : "no"}.`,
  ];
  if (options.generatedFromRunId) {
    lines.push(`- Newly graded source run: ${options.generatedFromRunId}.`);
  }
  if (options.focusNote) {
    lines.push(`- Requested focus: ${options.focusNote.trim()}.`);
  }
  lines.push(
    "",
    "## Objectives",
    "- Tag each graded sheet with stable subject labels that /spark/sheets can filter on quickly.",
    "- Capture both strong spots and weak spots from the student's graded work.",
    "- Keep the dashboard concise, evidence-backed, and student-facing.",
    "- Reuse prior dashboard state when it still matches the evidence, but update it when the new sheet changes the picture.",
  );
  return lines.join("\n").trim().concat("\n");
}

function buildDashboardTask(): string {
  return [
    "# Task",
    "",
    "Create an updated worksheet dashboard from the provided graded sheet reports.",
    "",
    "## Read first",
    "- brief.md",
    "- request.json",
    "- dashboard/task.md",
    "- dashboard/input/sheets.json",
    "- dashboard/input/previous-dashboard.json if it exists",
    "- dashboard/input/source-run.json if it exists",
    "",
    "## Requirements",
    "- Use only the provided worksheet evidence; do not search online.",
    "- Subject tags must be broad worksheet-filter labels such as Biology, Chemistry, Physics, Mathematics, English, Science, History, or Geography.",
    "- Prefer one primary subject tag per sheet, with at most 4 tags total when a sheet genuinely spans multiple subjects.",
    "- Strong spots and weak spots must describe learning patterns, not raw mark totals alone.",
    "- Capture strengths as well as weak spots.",
    "- Keep every title and summary user-facing and free of file paths, IDs, and process narration.",
    "- `summaryMarkdown` may use short bullets, but keep it concise.",
    "",
    "## Output",
    `Write ${SPARK_SHEET_DASHBOARD_OUTPUT_PATH} as JSON with this shape:`,
    "",
    "{",
    '  "schemaVersion": 1,',
    '  "mode": "sheet_dashboard",',
    '  "headline": "string",',
    '  "summaryMarkdown": "optional markdown summary",',
    '  "focusNote": "optional string",',
    '  "generatedFromRunId": "optional run id",',
    '  "strengths": [{ "id": "string", "title": "string", "summary": "string", "evidenceRunIds": ["run-id"], "subjectKeys": ["biology"] }],',
    '  "weakSpots": [{ "id": "string", "title": "string", "summary": "string", "evidenceRunIds": ["run-id"], "subjectKeys": ["biology"] }],',
    '  "subjects": [{ "key": "biology", "label": "Biology", "summary": "string", "runIds": ["run-id"], "averagePercentage": 72, "strongSpots": ["string"], "weakSpots": ["string"] }],',
    '  "runAnalyses": [{ "runId": "run-id", "subjectTags": [{ "key": "biology", "label": "Biology" }], "primarySubjectKey": "biology", "summary": "string", "strongSpots": ["string"], "weakSpots": ["string"] }]',
    "}",
    "",
    "## Completion",
    `1. Write ${SPARK_SHEET_DASHBOARD_OUTPUT_PATH}.`,
    "2. Call publish_sheet_dashboard({}).",
    "3. If publish_sheet_dashboard fails, fix the JSON and retry.",
    "4. Call done with a short summary after publish_sheet_dashboard succeeds.",
  ]
    .join("\n")
    .trim()
    .concat("\n");
}

export function buildSparkSheetDashboardAgentPrompt(options?: {
  outputPath?: string;
}): string {
  const outputPath =
    options?.outputPath ?? SPARK_SHEET_DASHBOARD_OUTPUT_PATH;
  return [
    "Refresh the student's /spark/sheets dashboard from graded worksheet reports.",
    "",
    "Read and follow these files first:",
    "- brief.md",
    "- request.json",
    "- dashboard/task.md",
    "- dashboard/input/sheets.json",
    "- dashboard/input/previous-dashboard.json if present",
    "- dashboard/input/source-run.json if present",
    "",
    "Rules:",
    "- Work only from the provided worksheet evidence and prior dashboard snapshot.",
    "- Keep subject tags stable and broad enough for quick filtering on /spark/sheets.",
    "- Surface both strong spots and weak spots.",
    "- Keep the dashboard concise, user-facing, and evidence-backed.",
    "",
    "Deliverables:",
    `1) Write ${outputPath}`,
    "2) Call publish_sheet_dashboard({})",
    "3) Call done with a short summary after publish_sheet_dashboard succeeds",
  ].join("\n");
}

export async function launchSparkSheetDashboardRefresh(options: {
  serviceAccountJson: string;
  userId: string;
  focusNote?: string;
  generatedFromRunId?: string;
  limit?: number;
}): Promise<DashboardRefreshStatus> {
  const now = new Date();
  const runs = await listGraderRuns({
    serviceAccountJson: options.serviceAccountJson,
    userId: options.userId,
    limit: options.limit ?? 100,
  });
  const gradedRuns = runs.filter(
    (run) =>
      Boolean(run.totals) &&
      (run.sheetPhase === "graded" ||
        (run.status === "done" &&
          typeof run.sheet?.filePath === "string" &&
          run.sheet.filePath.trim().length > 0)),
  );

  const gradedSheets: Array<DashboardGradedSheetInput & { rawReport: string }> = [];
  for (const run of gradedRuns) {
    const reportPath = run.sheet?.filePath ?? run.sheetPath;
    const reportRaw = await getWorkspaceTextFile({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId: run.workspaceId,
      filePath: reportPath,
    });
    if (!reportRaw) {
      continue;
    }
    let reportJson: unknown;
    try {
      reportJson = JSON.parse(reportRaw);
    } catch (error) {
      console.warn("[sheet-dashboard] skipping invalid worksheet JSON", {
        runId: run.id,
        reportPath,
        error,
      });
      continue;
    }
    const parsedReport = SparkGraderWorksheetReportSchema.safeParse(reportJson);
    if (!parsedReport.success) {
      console.warn("[sheet-dashboard] skipping invalid worksheet report", {
        runId: run.id,
        reportPath,
        issues: parsedReport.error.issues,
      });
      continue;
    }
    const report = parsedReport.data;
    gradedSheets.push({
      runId: run.id,
      title:
        run.presentation?.title?.trim() ||
        run.sheet?.title?.trim() ||
        report.sheet.title,
      summaryMarkdown: run.presentation?.summaryMarkdown?.trim() ?? null,
      percentage:
        typeof run.totals?.percentage === "number"
          ? run.totals.percentage
          : report.review.score.total > 0
            ? (report.review.score.got / report.review.score.total) * 100
            : null,
      updatedAt: run.updatedAt.toISOString(),
      reportPath: resolveWorkspaceReportPath(run.id),
      subject: report.sheet.subject,
      rawReport: reportRaw,
    });
  }

  if (gradedSheets.length === 0) {
    return {
      status: "empty",
      href: "/spark/sheets",
    };
  }

  const dashboardDoc = await getFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: resolveSheetDashboardDocPath(options.userId),
  });
  const previousDashboard = dashboardDoc.exists && dashboardDoc.data
    ? SparkSheetDashboardStateSchema.safeParse(dashboardDoc.data)
    : null;

  const workspaceId = randomUUID();
  const agentId = randomUUID();
  const requestPayload = {
    createdAt: now.toISOString(),
    focusNote: options.focusNote?.trim() || null,
    generatedFromRunId: options.generatedFromRunId ?? null,
    gradedSheetCount: gradedSheets.length,
    dashboardPath: SPARK_SHEET_DASHBOARD_OUTPUT_PATH,
  };

  await setFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: `users/${options.userId}/workspace/${workspaceId}`,
    data: {
      id: workspaceId,
      agentId,
      createdAt: now,
      updatedAt: now,
    },
  });

  await Promise.all([
    upsertWorkspaceTextFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId,
      filePath: "brief.md",
      content: buildDashboardBrief({
        focusNote: options.focusNote,
        generatedFromRunId: options.generatedFromRunId,
        gradedSheetCount: gradedSheets.length,
        previousDashboardExists: previousDashboard?.success ?? false,
      }),
      contentType: "text/markdown",
      createdAt: now,
      updatedAt: now,
    }),
    upsertWorkspaceTextFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId,
      filePath: "request.json",
      content: `${JSON.stringify(requestPayload, null, 2)}\n`,
      contentType: "application/json",
      createdAt: now,
      updatedAt: now,
    }),
    upsertWorkspaceTextFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId,
      filePath: "dashboard/task.md",
      content: buildDashboardTask(),
      contentType: "text/markdown",
      createdAt: now,
      updatedAt: now,
    }),
    upsertWorkspaceTextFileDoc({
      serviceAccountJson: options.serviceAccountJson,
      userId: options.userId,
      workspaceId,
      filePath: "dashboard/input/sheets.json",
      content: `${JSON.stringify(
        {
          sheets: gradedSheets.map((sheet) => ({
            runId: sheet.runId,
            title: sheet.title,
            summaryMarkdown: sheet.summaryMarkdown,
            percentage: sheet.percentage,
            updatedAt: sheet.updatedAt,
            reportPath: sheet.reportPath,
            subject: sheet.subject,
          })),
        },
        null,
        2,
      )}\n`,
      contentType: "application/json",
      createdAt: now,
      updatedAt: now,
    }),
    ...(previousDashboard?.success
      ? [
          upsertWorkspaceTextFileDoc({
            serviceAccountJson: options.serviceAccountJson,
            userId: options.userId,
            workspaceId,
            filePath: "dashboard/input/previous-dashboard.json",
            content: `${JSON.stringify(
              {
                ...previousDashboard.data,
                updatedAt: previousDashboard.data.updatedAt.toISOString(),
              },
              null,
              2,
            )}\n`,
            contentType: "application/json",
            createdAt: now,
            updatedAt: now,
          }),
        ]
      : []),
    ...gradedSheets.map((sheet) =>
      upsertWorkspaceTextFileDoc({
        serviceAccountJson: options.serviceAccountJson,
        userId: options.userId,
        workspaceId,
        filePath: sheet.reportPath,
        content: sheet.rawReport.endsWith("\n")
          ? sheet.rawReport
          : `${sheet.rawReport}\n`,
        contentType: "application/json",
        createdAt: now,
        updatedAt: now,
      }),
    ),
    ...(options.generatedFromRunId
      ? [
          upsertWorkspaceTextFileDoc({
            serviceAccountJson: options.serviceAccountJson,
            userId: options.userId,
            workspaceId,
            filePath: "dashboard/input/source-run.json",
            content: `${JSON.stringify(
              {
                generatedFromRunId: options.generatedFromRunId,
              },
              null,
              2,
            )}\n`,
            contentType: "application/json",
            createdAt: now,
            updatedAt: now,
          }),
        ]
      : []),
  ]);

  await setFirestoreDocument({
    serviceAccountJson: options.serviceAccountJson,
    documentPath: `users/${options.userId}/agents/${agentId}`,
    data: {
      id: agentId,
      prompt: buildSparkSheetDashboardAgentPrompt(),
      status: "created",
      workspaceId,
      sheetDashboardPath: SPARK_SHEET_DASHBOARD_OUTPUT_PATH,
      createdAt: now,
      updatedAt: now,
      statesTimeline: [{ state: "created", timestamp: now }],
    },
  });

  await createTask(
    {
      type: "runAgent",
      runAgent: { userId: options.userId, agentId, workspaceId },
    },
    {
      serviceAccountJson: options.serviceAccountJson,
    },
  );

  return {
    status: "started",
    agentId,
    workspaceId,
    gradedSheetCount: gradedSheets.length,
    href: "/spark/sheets",
  };
}
