import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { SparkAgentStateSchema, SparkAgentWorkspaceFileSchema, type SparkAgentState, type SparkAgentWorkspaceFile } from "@spark/schemas";
import {
  buildWorkspaceFilesCollectionPath,
  isAllowedWorkspaceStoragePath,
  normalizeStorageObjectName,
  resolveWorkspaceFilePathFromFirestoreDocument,
} from "@spark/llm/agent/workspaceFileStore";
import { downloadStorageObject } from "@spark/llm/utils/gcp/storageRest";
import { parseGoogleServiceAccountJson } from "@spark/llm/utils/gcp/googleAccessToken";
import { getFirebaseAdminFirestore, getFirebaseAdminFirestoreModule } from "@spark/llm/utils/firebaseAdmin";
import { z } from "zod";

import { createCliCommand } from "../utils/cli";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";

type CliOptions = {
  userId?: string;
  agentId?: string;
  outDir: string;
};

type AgentToolTraceCall = {
  step: number;
  toolIndex: number;
  toolName: string;
  callId?: string;
  error?: string;
  input: string;
  output: string;
};

type AgentToolTraceStep = {
  step: number;
  modelId: string;
  text: string;
  toolCallCount: number;
  toolCalls: AgentToolTraceCall[];
};

type ExportRunResult = {
  userId: string;
  agentId: string;
  workspaceId: string;
  status: string;
  workspaceFileCount: number;
  toolTraceStepCount: number;
};

type ExportFailure = {
  agentId: string;
  message: string;
};

type AdminFirestore = Awaited<ReturnType<typeof getFirebaseAdminFirestore>>;

type AgentLookupDoc = {
  id: string;
  ref: {
    path: string;
    parent: {
      parent?: {
        id: string;
      } | null;
    };
  };
};

const cliOptionsSchema = z.object({
  userId: z.string().trim().min(1, "userId is required").optional(),
  agentId: z.string().trim().min(1, "agentId is required").optional(),
  outDir: z.string().trim().min(1, "outDir is required"),
}).refine((value) => value.userId !== undefined || value.agentId !== undefined, {
  message: "Provide --user-id or --agent-id",
});

const textEncoder = new TextEncoder();

function parseCliOptions(argv: readonly string[]): CliOptions {
  const command = createCliCommand(
    "tools:export-agent-runs",
    "Download Spark agent runs for a user or a specific agent into a local directory",
  );
  command
    .option("--user-id <userId>", "Spark user id")
    .option("--agent-id <agentId>", "single Spark agent id")
    .requiredOption(
      "--out-dir <path>",
      "output directory, relative to repo root unless absolute",
    );
  command.parse(argv, { from: "node" });

  const options = command.opts<{
    userId?: string;
    agentId?: string;
    outDir?: string;
  }>();

  return cliOptionsSchema.parse({
    userId: options.userId,
    agentId: options.agentId,
    outDir: options.outDir,
  });
}

function requireServiceAccountJson(): string {
  const value = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (value.trim().length === 0) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing");
  }
  return value;
}

function resolveOutputDir(rawPath: string): string {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }
  return path.resolve(WORKSPACE_PATHS.repoRoot, rawPath);
}

function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function parseLogTimestamp(key: string): { ms: number; seq: number } | null {
  const match = /^t(\d{13})_(\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  const ms = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isFinite(ms)) {
    return null;
  }
  const seq = Number.parseInt(match[2] ?? "", 10);
  return { ms, seq: Number.isFinite(seq) ? seq : 0 };
}

function parseStreamTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (
    value &&
    typeof value === "object" &&
    "toDate" in (value as Record<string, unknown>) &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const secondsRaw =
    typeof record.seconds === "number"
      ? record.seconds
      : typeof record._seconds === "number"
        ? record._seconds
        : null;
  const nanosRaw =
    typeof record.nanoseconds === "number"
      ? record.nanoseconds
      : typeof record.nanos === "number"
        ? record.nanos
        : typeof record._nanoseconds === "number"
          ? record._nanoseconds
          : 0;
  if (secondsRaw === null) {
    return null;
  }
  const millis = secondsRaw * 1000 + Math.floor(nanosRaw / 1_000_000);
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatAgentLogText(data: Record<string, unknown> | null): string {
  if (!data) {
    return "";
  }

  const rawLines = data.lines && typeof data.lines === "object" ? data.lines : null;
  const entries: Array<{ ms: number; seq: number; line: string }> = [];
  if (rawLines && !Array.isArray(rawLines)) {
    for (const [key, value] of Object.entries(rawLines as Record<string, unknown>)) {
      if (typeof value !== "string") {
        continue;
      }
      const parsedTimestamp = parseLogTimestamp(key);
      if (!parsedTimestamp) {
        continue;
      }
      entries.push({
        ms: parsedTimestamp.ms,
        seq: parsedTimestamp.seq,
        line: value,
      });
    }
  }

  entries.sort((a, b) => {
    const diff = a.ms - b.ms;
    if (diff !== 0) {
      return diff;
    }
    return a.seq - b.seq;
  });

  const lines = entries.map((entry) => `${new Date(entry.ms).toISOString()} ${entry.line}`);
  const stream = data.stream && typeof data.stream === "object" ? data.stream : null;
  if (stream && !Array.isArray(stream)) {
    const streamRecord = stream as Record<string, unknown>;
    const thoughts =
      typeof streamRecord.thoughts === "string"
        ? streamRecord.thoughts.trimEnd()
        : "";
    const assistant =
      typeof streamRecord.assistant === "string"
        ? streamRecord.assistant.trimEnd()
        : "";
    const streamUpdatedAt = parseStreamTimestamp(streamRecord.updatedAt);
    if (thoughts.length > 0 || assistant.length > 0) {
      lines.push("");
      lines.push("--- stream snapshot ---");
      if (streamUpdatedAt) {
        lines.push(`updatedAt: ${streamUpdatedAt.toISOString()}`);
      }
      if (thoughts.length > 0) {
        lines.push("");
        lines.push("[thoughts]");
        lines.push(thoughts);
      }
      if (assistant.length > 0) {
        lines.push("");
        lines.push("[assistant]");
        lines.push(assistant);
      }
    }
  }

  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n").concat("\n");
}

function formatAgentToolTraceText(steps: readonly AgentToolTraceStep[]): string {
  if (steps.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("--- tool trace ---");
  for (const step of steps) {
    lines.push(
      `step=${step.step.toString()} model=${step.modelId} toolCalls=${step.toolCallCount.toString()}`,
    );
    if (step.text.trim().length > 0) {
      lines.push("[step_text]");
      lines.push(step.text);
    }
    for (const call of step.toolCalls) {
      lines.push(
        [
          `tool_call step=${call.step.toString()} index=${call.toolIndex.toString()} tool=${call.toolName}`,
          call.callId ? `callId=${call.callId}` : null,
          call.error ? `error=${call.error}` : null,
        ]
          .filter((entry): entry is string => Boolean(entry))
          .join(" "),
      );
      lines.push("[input]");
      lines.push(call.input);
      lines.push("[output]");
      lines.push(call.output);
    }
  }

  return lines.join("\n").concat("\n");
}

function toSafeWorkspaceDiskPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/u, "");
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  if (parts.some((part) => part === "..")) {
    return null;
  }
  return parts.join("/");
}

async function writeBytes(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await writeBytes(filePath, encodeUtf8(`${JSON.stringify(value, null, 2)}\n`));
}

async function decodeWorkspaceFileContent(options: {
  file: SparkAgentWorkspaceFile;
  serviceAccountJson: string;
  bucketName: string;
  userId: string;
}): Promise<Uint8Array> {
  const { file } = options;
  if (file.type === "storage_link") {
    const objectName = normalizeStorageObjectName(file.storagePath);
    if (
      objectName.length === 0 ||
      !isAllowedWorkspaceStoragePath(options.userId, objectName)
    ) {
      return encodeUtf8(
        `${JSON.stringify(
          {
            type: "storage_link",
            path: file.path,
            storagePath: file.storagePath,
            contentType: file.contentType,
          },
          null,
          2,
        )}\n`,
      );
    }
    try {
      const downloaded = await downloadStorageObject({
        serviceAccountJson: options.serviceAccountJson,
        bucketName: options.bucketName,
        objectName,
      });
      return downloaded.bytes;
    } catch {
      return encodeUtf8(
        `${JSON.stringify(
          {
            type: "storage_link",
            path: file.path,
            storagePath: file.storagePath,
            contentType: file.contentType,
          },
          null,
          2,
        )}\n`,
      );
    }
  }

  return encodeUtf8(file.content);
}

async function loadAgentToolTrace(options: {
  firestore: AdminFirestore;
  logDocPath: string;
}): Promise<AgentToolTraceStep[]> {
  const stepSnapshot = await options.firestore
    .collection(`${options.logDocPath}/toolTraceSteps`)
    .get();

  const steps: AgentToolTraceStep[] = [];
  for (const stepDoc of stepSnapshot.docs) {
    const data = stepDoc.data() as Record<string, unknown>;
    const step = typeof data.step === "number" ? data.step : Number.NaN;
    if (!Number.isFinite(step)) {
      continue;
    }
    const modelId = typeof data.modelId === "string" ? data.modelId : "";
    const text = typeof data.text === "string" ? data.text : "";
    const toolCallCount =
      typeof data.toolCallCount === "number" && Number.isFinite(data.toolCallCount)
        ? data.toolCallCount
        : 0;

    const callSnapshot = await stepDoc.ref.collection("toolCalls").get();
    const toolCalls: AgentToolTraceCall[] = [];
    for (const callDoc of callSnapshot.docs) {
      const callData = callDoc.data() as Record<string, unknown>;
      const toolIndex =
        typeof callData.toolIndex === "number" && Number.isFinite(callData.toolIndex)
          ? callData.toolIndex
          : 0;
      const toolName =
        typeof callData.toolName === "string" && callData.toolName.trim().length > 0
          ? callData.toolName
          : "unknown";
      const callId =
        typeof callData.callId === "string" && callData.callId.trim().length > 0
          ? callData.callId
          : undefined;
      const error =
        typeof callData.error === "string" && callData.error.trim().length > 0
          ? callData.error
          : undefined;
      const input = typeof callData.input === "string" ? callData.input : "";
      const output = typeof callData.output === "string" ? callData.output : "";
      toolCalls.push({
        step,
        toolIndex,
        toolName,
        ...(callId ? { callId } : {}),
        ...(error ? { error } : {}),
        input,
        output,
      });
    }

    toolCalls.sort((a, b) => a.toolIndex - b.toolIndex);
    steps.push({
      step,
      modelId,
      text,
      toolCallCount,
      toolCalls,
    });
  }

  steps.sort((a, b) => a.step - b.step);
  return steps;
}

async function loadWorkspaceFiles(options: {
  firestore: AdminFirestore;
  userId: string;
  workspaceId: string;
}): Promise<SparkAgentWorkspaceFile[]> {
  const snapshot = await options.firestore
    .collection(
      buildWorkspaceFilesCollectionPath({
        userId: options.userId,
        workspaceId: options.workspaceId,
      }),
    )
    .get();

  const files: SparkAgentWorkspaceFile[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    const payload = {
      ...data,
      path: resolveWorkspaceFilePathFromFirestoreDocument({
        documentPath: doc.ref.path,
        storedPath: data.path,
      }),
    };
    const parsed = SparkAgentWorkspaceFileSchema.safeParse(payload);
    if (!parsed.success) {
      continue;
    }
    files.push(parsed.data);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function exportAgentRun(options: {
  firestore: AdminFirestore;
  serviceAccountJson: string;
  bucketName: string;
  userId: string;
  outDir: string;
  agent: SparkAgentState;
}): Promise<ExportRunResult> {
  const { firestore, serviceAccountJson, bucketName, userId, outDir, agent } = options;
  const agentDocPath = `users/${userId}/agents/${agent.id}`;
  const logDocPath = `${agentDocPath}/logs/log`;
  const runDir = path.join(outDir, agent.id);

  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  const [workspaceFiles, logSnapshot, traceSteps] = await Promise.all([
    loadWorkspaceFiles({
      firestore,
      userId,
      workspaceId: agent.workspaceId,
    }),
    firestore.doc(logDocPath).get(),
    loadAgentToolTrace({
      firestore,
      logDocPath,
    }).catch(() => []),
  ]);

  const logData = logSnapshot.exists
    ? (logSnapshot.data() as Record<string, unknown>)
    : null;
  const agentLogText = `${formatAgentLogText(logData)}${formatAgentToolTraceText(traceSteps)}`;
  await writeBytes(path.join(runDir, "agent.log"), encodeUtf8(agentLogText));

  if (traceSteps.length > 0) {
    await writeJsonFile(path.join(runDir, "tool-trace.json"), traceSteps);
  }

  let exportedFileCount = 0;
  for (const file of workspaceFiles) {
    const safePath = toSafeWorkspaceDiskPath(file.path);
    if (!safePath) {
      continue;
    }
    const content = await decodeWorkspaceFileContent({
      file,
      serviceAccountJson,
      bucketName,
      userId,
    });
    await writeBytes(path.join(runDir, "workspace", safePath), content);
    exportedFileCount += 1;
  }

  return {
    userId,
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    status: agent.status,
    workspaceFileCount: exportedFileCount,
    toolTraceStepCount: traceSteps.length,
  };
}

type AgentExportTarget = {
  userId: string;
  agent: SparkAgentState;
};

async function loadAgentFromDocument(options: {
  firestore: AdminFirestore;
  documentPath: string;
}): Promise<AgentExportTarget | null> {
  const firestore = options.firestore;
  const snapshot = await firestore.doc(options.documentPath).get();
  if (!snapshot.exists) {
    return null;
  }
  const userId = snapshot.ref.parent.parent?.id;
  if (!userId) {
    throw new Error(`Could not resolve userId from ${options.documentPath}`);
  }
  const parsed = SparkAgentStateSchema.safeParse({
    id: snapshot.id,
    ...(snapshot.data() as Record<string, unknown>),
  });
  if (!parsed.success) {
    throw new Error(
      `Agent ${snapshot.id} exists but could not be parsed: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
  return {
    userId,
    agent: parsed.data,
  };
}

async function resolveAgentTargets(options: {
  firestore: AdminFirestore;
  userId?: string;
  agentId?: string;
}): Promise<{
  targetDescription: string;
  targets: AgentExportTarget[];
  invalidAgents: Array<{ agentId: string; issues: string[] }>;
}> {
  if (options.agentId && options.userId) {
    const target = await loadAgentFromDocument({
      firestore: options.firestore,
      documentPath: `users/${options.userId}/agents/${options.agentId}`,
    });
    if (!target) {
      throw new Error(
        `Agent ${options.agentId} was not found under user ${options.userId}`,
      );
    }
    return {
      targetDescription: `agent ${options.agentId} for user ${options.userId}`,
      targets: [target],
      invalidAgents: [],
    };
  }

  if (options.agentId) {
    const firebaseFirestoreModule = await getFirebaseAdminFirestoreModule();
    let docs: AgentLookupDoc[] = [];
    try {
      const directSnapshot = await options.firestore
        .collectionGroup("agents")
        .where(firebaseFirestoreModule.FieldPath.documentId(), "==", options.agentId)
        .get();
      docs = directSnapshot.docs;
    } catch {
      docs = [];
    }

    if (docs.length === 0) {
      const fallbackSnapshot = await options.firestore.collectionGroup("agents").get();
      docs = fallbackSnapshot.docs.filter((doc) => doc.id === options.agentId);
    }

    if (docs.length === 0) {
      throw new Error(`Agent ${options.agentId} was not found`);
    }
    if (docs.length > 1) {
      const matchingUsers = docs
        .map((doc) => doc.ref.parent.parent?.id)
        .filter((value): value is string => typeof value === "string");
      throw new Error(
        `Agent ${options.agentId} matched multiple users: ${matchingUsers.join(", ")}`,
      );
    }

    const doc = docs[0];
    if (!doc) {
      throw new Error(`Agent ${options.agentId} was not found`);
    }
    const target = await loadAgentFromDocument({
      firestore: options.firestore,
      documentPath: doc.ref.path,
    });
    if (!target) {
      throw new Error(`Agent ${options.agentId} disappeared before export`);
    }
    return {
      targetDescription: `agent ${options.agentId}`,
      targets: [target],
      invalidAgents: [],
    };
  }

  const userId = options.userId;
  if (!userId) {
    throw new Error("Provide --user-id or --agent-id");
  }

  const agentSnapshot = await options.firestore.collection(`users/${userId}/agents`).get();
  const targets: AgentExportTarget[] = [];
  const invalidAgents: Array<{ agentId: string; issues: string[] }> = [];
  for (const doc of agentSnapshot.docs) {
    const parsed = SparkAgentStateSchema.safeParse({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    });
    if (!parsed.success) {
      invalidAgents.push({
        agentId: doc.id,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
      continue;
    }
    targets.push({
      userId,
      agent: parsed.data,
    });
  }

  targets.sort((a, b) => b.agent.updatedAt.getTime() - a.agent.updatedAt.getTime());
  return {
    targetDescription: `all agent runs for user ${userId}`,
    targets,
    invalidAgents,
  };
}

async function main(argv: readonly string[]): Promise<void> {
  ensureEvalEnvLoaded();

  const options = parseCliOptions(argv);
  const serviceAccountJson = requireServiceAccountJson();
  const serviceAccount = parseGoogleServiceAccountJson(serviceAccountJson);
  const firestore = await getFirebaseAdminFirestore({ serviceAccountJson });
  const outDir = resolveOutputDir(options.outDir);
  const bucketName = `${serviceAccount.projectId}.firebasestorage.app`;

  await mkdir(outDir, { recursive: true });
  await rm(path.join(outDir, "export-summary.json"), { force: true });

  const resolution = await resolveAgentTargets({
    firestore,
    userId: options.userId,
    agentId: options.agentId,
  });
  const targets = resolution.targets;
  const invalidAgents = resolution.invalidAgents;

  console.log(
    `Resolved ${targets.length.toString()} run target(s) for ${resolution.targetDescription}; exporting to ${outDir}`,
  );
  if (invalidAgents.length > 0) {
    console.log(
      `Skipping ${invalidAgents.length.toString()} invalid agent docs`,
    );
  }

  const exportedRuns: ExportRunResult[] = [];
  const failures: ExportFailure[] = [];
  for (const [index, target] of targets.entries()) {
    const prefix = `[${(index + 1).toString()}/${targets.length.toString()}]`;
    console.log(`${prefix} Exporting ${target.agent.id} for user ${target.userId}`);
    try {
      const result = await exportAgentRun({
        firestore,
        serviceAccountJson,
        bucketName,
        userId: target.userId,
        outDir,
        agent: target.agent,
      });
      exportedRuns.push(result);
      console.log(
        `${prefix} Finished ${target.agent.id} (${result.workspaceFileCount.toString()} workspace files)`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ agentId: target.agent.id, message });
      console.error(`${prefix} Failed ${target.agent.id}: ${message}`);
    }
  }

  console.log(
    `Exported ${exportedRuns.length.toString()} agent runs to ${outDir}`,
  );
  if (exportedRuns.length > 0) {
    const totalWorkspaceFiles = exportedRuns.reduce((sum, run) => {
      return sum + run.workspaceFileCount;
    }, 0);
    console.log(
      `Workspace files written: ${totalWorkspaceFiles.toString()}; failures: ${failures.length.toString()}; invalid agent docs: ${invalidAgents.length.toString()}`,
    );
  }
  if (failures.length > 0 || invalidAgents.length > 0) {
    process.exitCode = 1;
  }
}

void main(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
