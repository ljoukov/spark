import path from "node:path";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { z } from "zod";
import {
  runAgentLoop,
  tool,
  type LlmContentPart,
  type LlmInputMessage,
  type LlmTextModelId,
  type LlmThinkingLevel,
  type LlmToolLoopResult,
} from "@ljoukov/llm";

import {
  SPARK_GRADER_PROBLEMS_DIR,
  SPARK_GRADER_SUMMARY_PATH,
  SPARK_GRADER_UPLOADS_MANIFEST_PATH,
  buildSparkGraderAgentPrompt,
} from "./graderAgentPrompt";
import {
  SPARK_AGENT_REPLAY_DIR,
  SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
  readSparkAgentReplayManifest,
  type SparkAgentReplayManifest,
} from "./sparkAgentReplayArtifacts";
import {
  buildSparkAgentSystemPrompt,
  buildSparkAgentTools,
  resolveSparkAgentLogsDir,
  resolveSparkAgentThinkingLevel,
  resolveSparkAgentToolCallsDir,
  type SparkAgentWorkspace,
} from "./sparkAgentRunner";
import { applyPdfTranscriptionSkillTools } from "./skills/pdfTranscription";

const DEFAULT_GRADER_MAX_STEPS = 200;
const LOCAL_REPLAY_ATTACHMENT_MAX_COUNT = 24;
const LOCAL_REPLAY_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;
const GRADER_REPLAY_SEED_PATHS = [
  "brief.md",
  "request.json",
  "grader/task.md",
  "grader/uploads",
] as const;

const LocalReplayAttachmentSchema = z
  .object({
    workspacePath: z.string().trim().min(1),
    contentType: z.string().trim().min(1),
    filename: z.string().trim().min(1).optional(),
  })
  .passthrough();

const LocalReplayUploadsManifestSchema = z
  .object({
    attachments: z.array(LocalReplayAttachmentSchema).default([]),
  })
  .strict();

function resolveLocalReplayWorkspacePath(
  workspaceDir: string,
  targetPath: string,
): string {
  if (path.isAbsolute(targetPath)) {
    throw new Error(`Absolute paths are not allowed: "${targetPath}".`);
  }
  const rawParts = targetPath.split(/[/\\]+/u);
  if (rawParts.some((part) => part === "..")) {
    throw new Error(`Path traversal is not allowed: "${targetPath}".`);
  }
  return path.resolve(workspaceDir, targetPath);
}

async function pathExists(inputPath: string): Promise<boolean> {
  return stat(inputPath)
    .then(() => true)
    .catch(() => false);
}

async function copyPath(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStat = await stat(sourcePath);
  if (sourceStat.isDirectory()) {
    await cp(sourcePath, targetPath, { recursive: true, force: true });
    return;
  }
  await cp(sourcePath, targetPath, { force: true });
}

async function copyRelativePath(options: {
  sourceDir: string;
  targetDir: string;
  relativePath: string;
}): Promise<void> {
  const sourcePath = path.join(options.sourceDir, options.relativePath);
  if (!(await pathExists(sourcePath))) {
    return;
  }
  const targetPath = path.join(options.targetDir, options.relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyPath(sourcePath, targetPath);
}

async function copyDirectoryContents(options: {
  sourceDir: string;
  targetDir: string;
}): Promise<void> {
  await mkdir(options.targetDir, { recursive: true });
  const sourceEntries = await readdir(options.sourceDir, {
    withFileTypes: true,
  });
  for (const entry of sourceEntries) {
    await copyPath(
      path.join(options.sourceDir, entry.name),
      path.join(options.targetDir, entry.name),
    );
  }
}

async function isGraderReplayWorkspace(rootDir: string): Promise<boolean> {
  for (const relativePath of [
    "brief.md",
    "request.json",
    "grader/task.md",
  ] as const) {
    if (!(await pathExists(path.join(rootDir, relativePath)))) {
      return false;
    }
  }
  return true;
}

function buildReplayInitialInput(options: {
  systemPrompt: string;
  prompt: string;
  inlineParts: LlmContentPart[];
  notes: string[];
}): LlmInputMessage[] {
  const userParts: LlmContentPart[] = [{ type: "text", text: options.prompt }];
  if (options.notes.length > 0) {
    userParts.push({
      type: "text",
      text: [
        "",
        "Attachment ingestion notes:",
        ...options.notes.map((entry) => `- ${entry}`),
      ].join("\n"),
    });
  }
  for (const part of options.inlineParts) {
    userParts.push(part);
  }
  return [
    {
      role: "system",
      content: [{ type: "text", text: options.systemPrompt }],
    },
    {
      role: "user",
      content: userParts,
    },
  ];
}

async function loadLocalGraderAttachmentParts(options: {
  workspaceDir: string;
}): Promise<{
  parts: LlmContentPart[];
  notes: string[];
  usedPaths: string[];
}> {
  const manifestPath = path.join(
    options.workspaceDir,
    SPARK_GRADER_UPLOADS_MANIFEST_PATH,
  );
  if (!(await pathExists(manifestPath))) {
    return { parts: [], notes: [], usedPaths: [] };
  }
  const raw = await readFile(manifestPath, { encoding: "utf8" });
  const parsed = LocalReplayUploadsManifestSchema.parse(JSON.parse(raw));
  const parts: LlmContentPart[] = [];
  const notes: string[] = [];
  const usedPaths: string[] = [];
  for (const [index, attachment] of parsed.attachments.entries()) {
    if (index >= LOCAL_REPLAY_ATTACHMENT_MAX_COUNT) {
      notes.push(
        `skipped remaining attachments after ${LOCAL_REPLAY_ATTACHMENT_MAX_COUNT.toString()} files`,
      );
      break;
    }
    const resolvedPath = resolveLocalReplayWorkspacePath(
      options.workspaceDir,
      attachment.workspacePath,
    );
    const label = attachment.filename ?? attachment.workspacePath;
    if (!(await pathExists(resolvedPath))) {
      notes.push(`skipped ${label}: file missing in workspace`);
      continue;
    }
    const bytes = await readFile(resolvedPath);
    if (bytes.length <= 0) {
      notes.push(`skipped ${label}: file is empty`);
      continue;
    }
    if (bytes.length > LOCAL_REPLAY_ATTACHMENT_MAX_BYTES) {
      notes.push(
        `skipped ${label}: file too large (${bytes.length.toString()} bytes)`,
      );
      continue;
    }
    parts.push({
      type: "inlineData",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: attachment.contentType,
    });
    usedPaths.push(attachment.workspacePath);
  }
  return { parts, notes, usedPaths };
}

function resolveReplayPrompt(options: {
  manifest: SparkAgentReplayManifest | null;
}): string {
  const prompt = options.manifest?.prompt?.trim();
  if (prompt && prompt.length > 0) {
    return prompt;
  }
  return buildSparkGraderAgentPrompt({
    summaryPath:
      options.manifest?.grader?.summaryPath ?? SPARK_GRADER_SUMMARY_PATH,
    problemsDir:
      options.manifest?.grader?.problemsDir ?? SPARK_GRADER_PROBLEMS_DIR,
  });
}

function resolveReplaySystemPrompt(options: {
  manifest: SparkAgentReplayManifest | null;
}): string {
  const systemPrompt = options.manifest?.systemPrompt?.trim();
  if (systemPrompt && systemPrompt.length > 0) {
    return systemPrompt;
  }
  return buildSparkAgentSystemPrompt({
    includePdfTranscriptionSkill: true,
  });
}

export type PreparedSparkGraderReplayWorkspace = {
  sourceMode: "captured-snapshot" | "grader-fallback";
  workspaceDir: string;
  manifest: SparkAgentReplayManifest | null;
  prompt: string;
  systemPrompt: string;
  sourceModelId: string | null;
  sourceThinkingLevel: LlmThinkingLevel | null;
  sourceMaxSteps: number | null;
  sourceUseSubagents: boolean | null;
};

export async function prepareSparkGraderReplayWorkspace(options: {
  sourceRunDir: string;
  targetWorkspaceDir: string;
}): Promise<PreparedSparkGraderReplayWorkspace> {
  const manifest = await readSparkAgentReplayManifest(options.sourceRunDir);
  await rm(options.targetWorkspaceDir, { recursive: true, force: true });
  await mkdir(options.targetWorkspaceDir, { recursive: true });

  const capturedSnapshotDir = path.join(
    options.sourceRunDir,
    SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
  );
  let sourceMode: PreparedSparkGraderReplayWorkspace["sourceMode"];
  if (
    manifest?.agentKind === "grader" &&
    (await pathExists(capturedSnapshotDir))
  ) {
    await copyDirectoryContents({
      sourceDir: capturedSnapshotDir,
      targetDir: options.targetWorkspaceDir,
    });
    sourceMode = "captured-snapshot";
  } else {
    if (!(await isGraderReplayWorkspace(options.sourceRunDir))) {
      throw new Error(
        [
          `Run directory does not contain a replay snapshot or a recognizable grader workspace: ${options.sourceRunDir}`,
          `Expected ${SPARK_AGENT_REPLAY_DIR}/ or grader seed files such as brief.md, request.json, and grader/task.md.`,
        ].join("\n"),
      );
    }
    for (const relativePath of GRADER_REPLAY_SEED_PATHS) {
      await copyRelativePath({
        sourceDir: options.sourceRunDir,
        targetDir: options.targetWorkspaceDir,
        relativePath,
      });
    }
    sourceMode = "grader-fallback";
  }

  return {
    sourceMode,
    workspaceDir: options.targetWorkspaceDir,
    manifest,
    prompt: resolveReplayPrompt({ manifest }),
    systemPrompt: resolveReplaySystemPrompt({ manifest }),
    sourceModelId: manifest?.modelId ?? null,
    sourceThinkingLevel: manifest?.thinkingLevel ?? null,
    sourceMaxSteps: manifest?.maxSteps ?? null,
    sourceUseSubagents: manifest?.useSubagents ?? null,
  };
}

export type SparkGraderReplayRunResult = {
  toolLoopResult: LlmToolLoopResult;
  doneSummary: string | null;
  prompt: string;
  systemPrompt: string;
  modelId: LlmTextModelId;
  thinkingLevel: LlmThinkingLevel | null;
  maxSteps: number;
  useSubagents: boolean;
  usedInlineAttachmentPaths: string[];
  agentLogPath: string;
  llmLogsDir: string;
};

export async function runSparkGraderReplayLocal(options: {
  workspaceDir: string;
  prompt: string;
  systemPrompt?: string;
  modelId: LlmTextModelId;
  thinkingLevel?: LlmThinkingLevel;
  maxSteps?: number;
  useSubagents?: boolean;
  userId?: string;
}): Promise<SparkGraderReplayRunResult> {
  const systemPrompt =
    options.systemPrompt?.trim() && options.systemPrompt.trim().length > 0
      ? options.systemPrompt.trim()
      : buildSparkAgentSystemPrompt({ includePdfTranscriptionSkill: true });
  const maxSteps = options.maxSteps ?? DEFAULT_GRADER_MAX_STEPS;
  const thinkingLevel =
    options.thinkingLevel ??
    resolveSparkAgentThinkingLevel(options.modelId) ??
    null;
  const useSubagents = options.useSubagents ?? true;

  const workspace: SparkAgentWorkspace = {
    scheduleUpdate: () => {},
    deleteFile: async (inputPath) => {
      const resolved = resolveLocalReplayWorkspacePath(
        options.workspaceDir,
        inputPath,
      );
      await rm(resolved, { recursive: true, force: true });
    },
    moveFile: async (from, to) => {
      const resolvedFrom = resolveLocalReplayWorkspacePath(
        options.workspaceDir,
        from,
      );
      const resolvedTo = resolveLocalReplayWorkspacePath(
        options.workspaceDir,
        to,
      );
      await mkdir(path.dirname(resolvedTo), { recursive: true });
      await rename(resolvedFrom, resolvedTo);
    },
  };

  const baseTools = buildSparkAgentTools({
    workspace,
    rootDir: options.workspaceDir,
    userId: options.userId ?? "local-grader-replay",
    serviceAccountJson: "{}",
    allowPythonExec: false,
    extractTextDebugRootDir: resolveSparkAgentToolCallsDir(
      options.workspaceDir,
    ),
  });

  let doneSummary: string | null = null;
  let doneCalled = false;
  const done = tool({
    description:
      "Mark the local grader replay as complete. Stores a short summary for the caller.",
    inputSchema: z
      .object({
        summary: z.string().trim().min(1).optional(),
      })
      .strict(),
    execute: ({ summary }) => {
      doneCalled = true;
      doneSummary = summary ?? null;
      return { status: "done", summary: summary ?? null };
    },
  });

  const tools = applyPdfTranscriptionSkillTools({
    tools: {
      ...baseTools,
      done,
    },
    rootDir: options.workspaceDir,
    includeReferenceTextTool: false,
    onFileWritten: () => {},
  });

  const attachments = await loadLocalGraderAttachmentParts({
    workspaceDir: options.workspaceDir,
  });
  const initialInput =
    attachments.parts.length > 0 || attachments.notes.length > 0
      ? buildReplayInitialInput({
          systemPrompt,
          prompt: options.prompt,
          inlineParts: attachments.parts,
          notes: attachments.notes,
        })
      : null;

  const toolLoopResult = await runAgentLoop({
    model: options.modelId,
    input: initialInput ?? options.prompt,
    ...(initialInput ? {} : { instructions: systemPrompt }),
    tools,
    modelTools: [{ type: "web-search", mode: "live" }],
    ...(useSubagents ? { subagents: { promptPattern: "codex" as const } } : {}),
    maxSteps,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    logging: {
      workspaceDir: resolveSparkAgentLogsDir(options.workspaceDir),
      callLogsDir: "llm_calls",
      mirrorToConsole: false,
    },
  });

  if (!doneCalled) {
    const responseText = toolLoopResult.text.trim();
    if (responseText.length > 0) {
      const outputPath = resolveLocalReplayWorkspacePath(
        options.workspaceDir,
        "agent-output.md",
      );
      await writeFile(outputPath, responseText.concat("\n"), {
        encoding: "utf8",
      });
      doneSummary =
        responseText.length > 1000
          ? `${responseText.slice(0, 1000).trim()}...`
          : responseText;
    }
  }

  const logsDir = resolveSparkAgentLogsDir(options.workspaceDir);
  return {
    toolLoopResult,
    doneSummary,
    prompt: options.prompt,
    systemPrompt,
    modelId: options.modelId,
    thinkingLevel,
    maxSteps,
    useSubagents,
    usedInlineAttachmentPaths: attachments.usedPaths,
    agentLogPath: path.join(logsDir, "agent.log"),
    llmLogsDir: path.join(logsDir, "llm_calls"),
  };
}
