import os from "node:os";
import path from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { z } from "zod";

import { errorAsString } from "../utils/error";
import {
  getFirebaseAdminFirestore,
  getFirebaseAdminFirestoreModule,
} from "../utils/firebaseAdmin";
import { loadEnvFromFile, loadLocalEnv } from "../utils/env";
import {
  runToolLoop,
  tool,
  type LlmTextModelId,
  type LlmToolSet,
} from "../utils/llm";
import type { OpenAiReasoningEffort } from "../utils/openai-llm";
import type { JobProgressReporter } from "../utils/concurrency";

const DEFAULT_AGENT_MODEL_ID: LlmTextModelId = "chatgpt-gpt-5.2-codex";
const DEFAULT_MAX_STEPS = 200;
const WORKSPACE_UPDATE_THROTTLE_MS = 10_000;

const AgentStatusSchema = z.enum(["created", "executing", "failed", "done"]);
type AgentStatus = z.infer<typeof AgentStatusSchema>;

type WorkspaceFileMeta = {
  createdAt?: Date;
  updatedAt?: Date;
  lastWriteAt: number;
  pending: boolean;
  timer?: NodeJS.Timeout;
  inFlight?: Promise<void>;
  disposed?: boolean;
};

type WorkspaceSyncOptions = {
  firestore: FirebaseFirestore.Firestore;
  userId: string;
  workspaceId: string;
  rootDir: string;
};

type AgentRunOptions = {
  userId: string;
  agentId: string;
  workspaceId: string;
  modelId?: LlmTextModelId;
  maxSteps?: number;
};

function loadAgentEnv(): void {
  loadLocalEnv();
  const repoRoot = path.resolve(process.cwd());
  loadEnvFromFile(path.join(repoRoot, ".env.local"), { override: false });
}

function resolveOpenAiReasoningEffort(
  modelId: LlmTextModelId,
): OpenAiReasoningEffort | undefined {
  if (modelId.includes("gpt-5.2")) {
    return "medium";
  }
  return undefined;
}

function resolveWorkspacePath(workspaceDir: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    throw new Error(`Absolute paths are not allowed: "${targetPath}".`);
  }
  const rawParts = targetPath.split(/[/\\]+/);
  if (rawParts.some((part) => part === "..")) {
    throw new Error(`Path traversal ("..") is not allowed: "${targetPath}".`);
  }
  const resolved = path.resolve(workspaceDir, targetPath);
  const relative = path.relative(workspaceDir, resolved);
  const parts = relative.split(path.sep).filter((part) => part.length > 0);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  for (const part of parts) {
    if (part === "..") {
      throw new Error(`Path "${targetPath}" is outside workspace.`);
    }
  }
  if (relative.length === 0) {
    return resolved;
  }
  if (parts.length === 0) {
    throw new Error(`Path "${targetPath}" is outside workspace.`);
  }
  return resolved;
}

function encodeFileId(filePath: string): string {
  return encodeURIComponent(filePath);
}

function decodeFileId(fileId: string): string {
  try {
    return decodeURIComponent(fileId);
  } catch {
    return fileId;
  }
}

function resolveContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return "text/markdown";
  }
  if (ext === ".json") {
    return "application/json";
  }
  if (ext === ".txt") {
    return "text/plain";
  }
  return undefined;
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function listFilesRecursive(options: {
  rootDir: string;
  maxDepth: number;
  subDir?: string;
}): Promise<string[]> {
  const { rootDir, maxDepth, subDir = "" } = options;
  if (maxDepth < 0) {
    return [];
  }
  const baseDir = path.join(rootDir, subDir);
  const entries = await readdir(baseDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relative = path.join(subDir, entry.name);
    if (entry.isDirectory()) {
      results.push(`${relative}/`);
      const nested = await listFilesRecursive({
        rootDir,
        maxDepth: maxDepth - 1,
        subDir: relative,
      });
      results.push(...nested);
    } else {
      results.push(relative);
    }
  }
  return results;
}

class WorkspaceSync {
  private firestore: FirebaseFirestore.Firestore;
  private userId: string;
  private workspaceId: string;
  private rootDir: string;
  private fileMeta = new Map<string, WorkspaceFileMeta>();

  constructor(options: WorkspaceSyncOptions) {
    this.firestore = options.firestore;
    this.userId = options.userId;
    this.workspaceId = options.workspaceId;
    this.rootDir = options.rootDir;
  }

  private filesCollection(): FirebaseFirestore.CollectionReference {
    return this.firestore
      .collection("users")
      .doc(this.userId)
      .collection("workspace")
      .doc(this.workspaceId)
      .collection("files");
  }

  private fileDoc(filePath: string): FirebaseFirestore.DocumentReference {
    return this.filesCollection().doc(encodeFileId(filePath));
  }

  private ensureMeta(filePath: string): WorkspaceFileMeta {
    const existing = this.fileMeta.get(filePath);
    if (existing) {
      return existing;
    }
    const created = {
      lastWriteAt: 0,
      pending: false,
      disposed: false,
    };
    this.fileMeta.set(filePath, created);
    return created;
  }

  async load(): Promise<void> {
    const snapshot = await this.filesCollection().get();
    if (snapshot.empty) {
      return;
    }
    for (const doc of snapshot.docs) {
      const data = doc.data() ?? {};
      const rawPath =
        typeof data.path === "string" && data.path.trim().length > 0
          ? data.path.trim()
          : decodeFileId(doc.id);
      if (!rawPath) {
        continue;
      }
      const content = typeof data.content === "string" ? data.content : "";
      const createdAt =
        data.createdAt instanceof Date
          ? data.createdAt
          : data.createdAt?.toDate?.() ?? undefined;
      const updatedAt =
        data.updatedAt instanceof Date
          ? data.updatedAt
          : data.updatedAt?.toDate?.() ?? undefined;
      const resolved = resolveWorkspacePath(this.rootDir, rawPath);
      await ensureDir(path.dirname(resolved));
      await writeFile(resolved, content, { encoding: "utf8" });
      const meta = this.ensureMeta(rawPath);
      meta.createdAt = createdAt ?? meta.createdAt;
      meta.updatedAt = updatedAt ?? meta.updatedAt;
      meta.lastWriteAt =
        updatedAt?.getTime() ?? createdAt?.getTime() ?? meta.lastWriteAt;
    }
  }

  scheduleUpdate(filePath: string): void {
    const meta = this.ensureMeta(filePath);
    if (meta.disposed) {
      return;
    }
    meta.pending = true;
    if (meta.inFlight) {
      return;
    }
    if (meta.timer) {
      return;
    }
    const now = Date.now();
    const elapsed = now - meta.lastWriteAt;
    if (elapsed >= WORKSPACE_UPDATE_THROTTLE_MS) {
      void this.startFlush(filePath, { force: false }).catch((error) => {
        console.warn(
          `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
        );
      });
      return;
    }
    const delay = Math.max(0, WORKSPACE_UPDATE_THROTTLE_MS - elapsed);
    meta.timer = setTimeout(() => {
      meta.timer = undefined;
      void this.startFlush(filePath, { force: false }).catch((error) => {
        console.warn(
          `Failed to flush workspace file "${filePath}": ${errorAsString(error)}`,
        );
      });
    }, delay);
  }

  async deleteFile(filePath: string): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (meta) {
      meta.disposed = true;
      meta.pending = false;
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      await meta.inFlight?.catch(() => undefined);
    }
    this.fileMeta.delete(filePath);
    await this.fileDoc(filePath).delete().catch(() => undefined);
  }

  async moveFile(fromPath: string, toPath: string): Promise<void> {
    const meta = this.fileMeta.get(fromPath);
    const fromCreatedAt = meta?.createdAt;
    if (meta) {
      meta.disposed = true;
      meta.pending = false;
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      await meta.inFlight?.catch(() => undefined);
    }
    this.fileMeta.delete(fromPath);
    await this.fileDoc(fromPath).delete().catch(() => undefined);
    const toMeta = this.ensureMeta(toPath);
    if (fromCreatedAt && !toMeta.createdAt) {
      toMeta.createdAt = fromCreatedAt;
    }
    this.scheduleUpdate(toPath);
  }

  async flushAll(): Promise<void> {
    const entries = Array.from(this.fileMeta.entries());
    const tasks: Promise<void>[] = [];
    for (const [filePath, meta] of entries) {
      if (meta.disposed) {
        continue;
      }
      if (meta.timer) {
        clearTimeout(meta.timer);
        meta.timer = undefined;
      }
      const now = Date.now();
      const elapsed = now - meta.lastWriteAt;
      const delay = Math.max(0, WORKSPACE_UPDATE_THROTTLE_MS - elapsed);
      tasks.push(
        (async () => {
          if (meta.inFlight) {
            await meta.inFlight;
          }
          if (!meta.pending) {
            return;
          }
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          await this.startFlush(filePath, { force: true });
        })(),
      );
    }
    await Promise.all(tasks);
  }

  private async startFlush(
    filePath: string,
    { force }: { force: boolean },
  ): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (!meta || meta.disposed) {
      return;
    }
    if (!meta.pending && !force) {
      return;
    }
    if (meta.timer) {
      clearTimeout(meta.timer);
      meta.timer = undefined;
    }
    if (meta.inFlight) {
      await meta.inFlight;
      return;
    }

    // Reserve the write slot immediately so subsequent scheduleUpdate() calls
    // don't accidentally bypass the per-doc throttle while the write is in flight.
    meta.pending = false;
    meta.lastWriteAt = Date.now();
    const promise = this.flushPath(filePath)
      .catch((error) => {
        if (!meta.disposed) {
          meta.pending = true;
        }
        throw error;
      })
      .finally(() => {
        meta.inFlight = undefined;
        if (!meta.disposed && meta.pending) {
          this.scheduleUpdate(filePath);
        }
      });
    meta.inFlight = promise;
    await promise;
  }

  private async flushPath(filePath: string): Promise<void> {
    const meta = this.fileMeta.get(filePath);
    if (!meta || meta.disposed) {
      return;
    }
    const resolved = resolveWorkspacePath(this.rootDir, filePath);
    let content = "";
    try {
      content = await readFile(resolved, { encoding: "utf8" });
    } catch (error) {
      throw new Error(
        `Failed to read workspace file "${filePath}": ${errorAsString(error)}`,
      );
    }
    const now = new Date();
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const createdAt = meta.createdAt ?? now;
    meta.createdAt = createdAt;
    meta.updatedAt = now;
    meta.lastWriteAt = Date.now();
    const payload: Record<string, unknown> = {
      path: filePath,
      content,
      createdAt,
      updatedAt: now,
      sizeBytes,
    };
    const contentType = resolveContentType(filePath);
    if (contentType) {
      payload.contentType = contentType;
    }
    await this.fileDoc(filePath).set(payload, { merge: true });
  }
}

function buildAgentSystemPrompt(): string {
  return [
    "You are Spark Agent, a tool-using assistant.",
    "Use the provided tools to read and write files in the workspace.",
    "When the task is complete, call the done tool with a short summary.",
    "After calling done, respond with a brief confirmation and stop.",
  ].join("\n");
}

function buildAgentTools(options: {
  workspace: WorkspaceSync;
  rootDir: string;
}): LlmToolSet {
  const { workspace, rootDir } = options;
  return {
    list_files: tool({
      description: "Recursively list files under a workspace path.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        maxDepth: z.number().int().min(0).max(20).optional(),
      }),
      execute: async ({ path: inputPath, maxDepth }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        const entries = await listFilesRecursive({
          rootDir: resolved,
          maxDepth: maxDepth ?? 4,
        });
        const results: Array<{
          path: string;
          type: "file" | "dir";
          sizeBytes?: number;
        }> = [];
        for (const entry of entries) {
          const normalized = entry.endsWith("/") ? entry.slice(0, -1) : entry;
          if (!normalized) {
            continue;
          }
          const fullPath = path.join(resolved, normalized);
          const stats = await stat(fullPath).catch(() => undefined);
          if (!stats) {
            continue;
          }
          results.push({
            path: normalized + (stats.isDirectory() ? "/" : ""),
            type: stats.isDirectory() ? "dir" : "file",
            ...(stats.isFile() ? { sizeBytes: stats.size } : {}),
          });
        }
        return { path: inputPath, entries: results };
      },
    }),
    read_file: tool({
      description: "Read a text file from the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        const content = await readFile(resolved, { encoding: "utf8" });
        const bytes = Buffer.byteLength(content, "utf8");
        return { path: inputPath, content, bytes };
      },
    }),
    read_files: tool({
      description: "Read multiple text files from the workspace.",
      inputSchema: z.object({
        paths: z.array(z.string().trim().min(1)).min(1),
      }),
      execute: async ({ paths }) => {
        const files = await Promise.all(
          paths.map(async (entry) => {
            const resolved = resolveWorkspacePath(rootDir, entry);
            const content = await readFile(resolved, { encoding: "utf8" });
            const bytes = Buffer.byteLength(content, "utf8");
            return { path: entry, content, bytes };
          }),
        );
        return { files };
      },
    }),
    write_file: tool({
      description: "Create or overwrite a text file in the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
        content: z.string(),
      }),
      execute: async ({ path: inputPath, content }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        await ensureDir(path.dirname(resolved));
        await writeFile(resolved, content, { encoding: "utf8" });
        workspace.scheduleUpdate(inputPath);
        return { path: inputPath, status: "written" };
      },
    }),
    delete_file: tool({
      description: "Delete a file from the workspace.",
      inputSchema: z.object({
        path: z.string().trim().min(1),
      }),
      execute: async ({ path: inputPath }) => {
        const resolved = resolveWorkspacePath(rootDir, inputPath);
        await rm(resolved);
        await workspace.deleteFile(inputPath);
        return { path: inputPath, status: "deleted" };
      },
    }),
    move_file: tool({
      description: "Move or rename a file inside the workspace.",
      inputSchema: z.object({
        from: z.string().trim().min(1),
        to: z.string().trim().min(1),
      }),
      execute: async ({ from, to }) => {
        const resolvedFrom = resolveWorkspacePath(rootDir, from);
        const resolvedTo = resolveWorkspacePath(rootDir, to);
        await ensureDir(path.dirname(resolvedTo));
        await rename(resolvedFrom, resolvedTo);
        await workspace.moveFile(from, to);
        return { from, to, status: "moved" };
      },
    }),
    apply_patch: tool({
      description:
        "Apply patch operations to existing files (update only). Use unified diffs or full file contents.",
      inputSchema: z.object({
        operations: z
          .array(
            z.object({
              type: z.enum(["create_file", "update_file", "delete_file"]),
              path: z.string().trim().min(1),
              diff: z.string().optional(),
            }),
          )
          .min(1),
      }),
      execute: async ({ operations }) => {
        const results: Array<{
          path: string;
          status: "completed" | "failed";
          error?: string;
        }> = [];
        for (const operation of operations) {
          try {
            const resolved = resolveWorkspacePath(rootDir, operation.path);
            if (operation.type !== "update_file") {
              throw new Error(
                `Use write_file/move_file/delete_file instead of apply_patch for ${operation.type}`,
              );
            }
            if (!operation.diff) {
              throw new Error("diff is required for update_file");
            }
            const original = await readFile(resolved, { encoding: "utf8" });
            const nextContent = applyDiff(original, operation.diff);
            await ensureDir(path.dirname(resolved));
            await writeFile(resolved, nextContent, { encoding: "utf8" });
            workspace.scheduleUpdate(operation.path);
            results.push({ path: operation.path, status: "completed" });
          } catch (error) {
            results.push({
              path: operation.path,
              status: "failed",
              error: errorAsString(error),
            });
          }
        }
        return { results };
      },
    }),
  };
}

function splitLines(text: string): string[] {
  return text.split("\n");
}

function parseHunkHeader(line: string): {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
} {
  const match = line.match(
    /^@@\s*-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s*@@/,
  );
  if (!match) {
    throw new Error(`Invalid hunk header: ${line}`);
  }
  const oldStart = Number.parseInt(match[1], 10);
  const oldLines = match[2] ? Number.parseInt(match[2], 10) : 1;
  const newStart = Number.parseInt(match[3], 10);
  const newLines = match[4] ? Number.parseInt(match[4], 10) : 1;
  return { oldStart, oldLines, newStart, newLines };
}

function applyUnifiedDiff(original: string, diff: string): string {
  const originalLines = splitLines(original);
  const diffLines = splitLines(diff);
  const output: string[] = [];
  let originalIndex = 0;
  let diffIndex = 0;
  while (diffIndex < diffLines.length) {
    const line = diffLines[diffIndex];
    if (line.startsWith("---") || line.startsWith("+++")) {
      diffIndex += 1;
      continue;
    }
    if (!line.startsWith("@@")) {
      throw new Error(`Invalid diff hunk header: ${line}`);
    }
    const header = parseHunkHeader(line);
    const expectedIndex = header.oldStart - 1;
    if (expectedIndex < originalIndex) {
      throw new Error("Diff hunk overlaps previous hunk");
    }
    output.push(...originalLines.slice(originalIndex, expectedIndex));
    originalIndex = expectedIndex;
    diffIndex += 1;
    let hunkLineCount = 0;
    while (diffIndex < diffLines.length) {
      const hunkLine = diffLines[diffIndex];
      if (hunkLine.startsWith("@@")) {
        break;
      }
      if (hunkLine.startsWith(" ")) {
        output.push(hunkLine.slice(1));
        originalIndex += 1;
        hunkLineCount += 1;
      } else if (hunkLine.startsWith("-")) {
        const expected = hunkLine.slice(1);
        const actual = originalLines[originalIndex];
        if (actual !== expected) {
          throw new Error(
            `Patch removal mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        originalIndex += 1;
        hunkLineCount += 1;
      } else if (hunkLine.startsWith("+")) {
        output.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith("\\ No newline")) {
        // ignore
      } else {
        throw new Error(`Unsupported diff line: ${hunkLine}`);
      }
      diffIndex += 1;
    }
    if (hunkLineCount !== header.oldLines) {
      throw new Error(
        `Diff hunk length mismatch: expected ${header.oldLines} got ${hunkLineCount}`,
      );
    }
  }
  output.push(...originalLines.slice(originalIndex));
  return output.join("\n");
}

function applyV4Patch(original: string, diff: string): string {
  const originalLines = splitLines(original);
  const diffLines = splitLines(diff);
  let originalIndex = 0;
  let diffIndex = 0;
  const output: string[] = [];
  while (diffIndex < diffLines.length) {
    const line = diffLines[diffIndex];
    if (line.startsWith("*** Begin Patch")) {
      diffIndex += 1;
      continue;
    }
    if (line.startsWith("*** End Patch")) {
      break;
    }
    if (!line.startsWith("@@")) {
      diffIndex += 1;
      continue;
    }
    const header = parseHunkHeader(line);
    const expectedIndex = header.oldStart - 1;
    output.push(...originalLines.slice(originalIndex, expectedIndex));
    originalIndex = expectedIndex;
    diffIndex += 1;
    while (diffIndex < diffLines.length) {
      const hunkLine = diffLines[diffIndex];
      if (hunkLine.startsWith("@@") || hunkLine.startsWith("*** End Patch")) {
        break;
      }
      if (hunkLine.startsWith(" ")) {
        output.push(hunkLine.slice(1));
        originalIndex += 1;
      } else if (hunkLine.startsWith("-")) {
        const expected = hunkLine.slice(1);
        const actual = originalLines[originalIndex];
        if (actual !== expected) {
          throw new Error(
            `Patch removal mismatch: expected "${expected}" got "${actual}"`,
          );
        }
        originalIndex += 1;
      } else if (hunkLine.startsWith("+")) {
        output.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith("\\ No newline")) {
        // ignore
      } else {
        throw new Error(`Unsupported diff line: ${hunkLine}`);
      }
      diffIndex += 1;
    }
  }
  output.push(...originalLines.slice(originalIndex));
  return output.join("\n");
}

function applyDiff(original: string, diff: string): string {
  if (diff.trim().length === 0) {
    return original;
  }
  if (diff.includes("*** Begin Patch")) {
    return applyV4Patch(original, diff);
  }
  if (diff.includes("@@")) {
    const hasRangeHeader = diff
      .split("\n")
      .some(
        (line) =>
          line.startsWith("@@") && line.includes("-") && line.includes("+"),
      );
    if (!hasRangeHeader) {
      return applyV4Patch(original, diff);
    }
    return applyUnifiedDiff(original, diff);
  }

  const lines = splitLines(diff);
  const hasMarkers = lines.some(
    (line) =>
      line.startsWith("+") || line.startsWith("-") || line.startsWith(" "),
  );
  if (!hasMarkers) {
    return diff;
  }
  const allPlus = lines.every((line) => line === "" || line.startsWith("+"));
  if (allPlus) {
    return lines
      .map((line) => (line.startsWith("+") ? line.slice(1) : line))
      .join("\n");
  }
  const allSpaceOrPlus = lines.every(
    (line) => line === "" || line.startsWith("+") || line.startsWith(" "),
  );
  if (allSpaceOrPlus) {
    return lines
      .map((line) => {
        if (line.startsWith("+")) {
          return line.slice(1);
        }
        if (line.startsWith(" ")) {
          return line.slice(1);
        }
        return line;
      })
      .join("\n");
  }

  return applyUnifiedDiff(original, diff);
}

async function updateAgentStatus(options: {
  agentRef: FirebaseFirestore.DocumentReference;
  status: AgentStatus;
  resultSummary?: string;
  error?: string;
}): Promise<void> {
  const { FieldValue } = getFirebaseAdminFirestoreModule();
  const now = new Date();
  const payload: Record<string, unknown> = {
    status: options.status,
    updatedAt: now,
    statesTimeline: FieldValue.arrayUnion({
      state: options.status,
      timestamp: now,
    }),
  };
  if (typeof options.resultSummary === "string") {
    payload.resultSummary = options.resultSummary;
  }
  if (typeof options.error === "string") {
    payload.error = options.error;
  }
  await options.agentRef.set(payload, { merge: true });
}

export async function runSparkAgentTask(
  options: AgentRunOptions,
): Promise<void> {
  loadAgentEnv();
  const firestore = getFirebaseAdminFirestore();
  const agentRef = firestore
    .collection("users")
    .doc(options.userId)
    .collection("agents")
    .doc(options.agentId);

  const agentSnap = await agentRef.get();
  if (!agentSnap.exists) {
    throw new Error(`Agent not found: ${options.agentId}`);
  }
  const agentData = agentSnap.data() ?? {};
  const prompt =
    typeof agentData.prompt === "string" && agentData.prompt.trim().length > 0
      ? agentData.prompt.trim()
      : "";
  if (!prompt) {
    throw new Error("Agent prompt is missing.");
  }

  await updateAgentStatus({ agentRef, status: "executing" });

  const workspaceRoot = path.join(
    os.tmpdir(),
    "spark-agent-workspaces",
    options.workspaceId,
  );
  await ensureDir(workspaceRoot);
  const workspaceSync = new WorkspaceSync({
    firestore,
    userId: options.userId,
    workspaceId: options.workspaceId,
    rootDir: workspaceRoot,
  });
  await workspaceSync.load();

  let doneCalled = false;
  let doneSummary: string | undefined;

  const tools: LlmToolSet = {
    ...buildAgentTools({ workspace: workspaceSync, rootDir: workspaceRoot }),
    done: tool({
      description:
        "Mark the agent run as complete. Flushes workspace updates and records a short summary.",
      inputSchema: z
        .object({
          summary: z.string().trim().min(1).optional(),
        })
        .strict(),
      execute: async ({ summary }) => {
        doneCalled = true;
        doneSummary = summary;
        await workspaceSync.flushAll();
        await updateAgentStatus({
          agentRef,
          status: "done",
          resultSummary: summary,
        });
        return { status: "done", summary };
      },
    }),
  };

  const modelId = options.modelId ?? DEFAULT_AGENT_MODEL_ID;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const openAiReasoningEffort = resolveOpenAiReasoningEffort(modelId);
  const progress: JobProgressReporter = {
    log: (message) => {
      console.log(`[spark-agent:${options.agentId}] ${message}`);
    },
    startModelCall: () => Symbol("agent-model-call"),
    recordModelUsage: () => {},
    finishModelCall: () => {},
    startStage: () => Symbol("agent-stage"),
    finishStage: () => {},
    setActiveStages: () => {},
  };
  try {
    await runToolLoop({
      modelId,
      systemPrompt: buildAgentSystemPrompt(),
      prompt,
      tools,
      maxSteps,
      progress,
      openAiReasoningEffort,
    });
  } catch (error) {
    const message = errorAsString(error);
    await workspaceSync.flushAll().catch(() => undefined);
    await updateAgentStatus({ agentRef, status: "failed", error: message });
    throw error;
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }

  if (!doneCalled) {
    const message = "Agent completed without calling done.";
    await updateAgentStatus({ agentRef, status: "failed", error: message });
    throw new Error(message);
  }
}
