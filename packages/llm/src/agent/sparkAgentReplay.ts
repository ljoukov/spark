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

import { SPARK_GRADER_UPLOADS_MANIFEST_PATH } from "./graderAgentPrompt";
import {
  SparkGraderRequestPayloadSchema,
  resolveSparkGraderModelTools,
} from "./sparkChatShared";
import {
  resolveSparkAgentSkillFiles,
  SPARK_GRADER_SKILL_IDS,
} from "./sparkAgentSkills";
import { writeKnowledgeBaseWorkspaceFiles } from "./sharedPdfKnowledgeBase";
import {
  SPARK_AGENT_REPLAY_DIR,
  SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
  readSparkAgentReplayManifest,
  type SparkAgentReplayManifest,
} from "./sparkAgentReplayArtifacts";
import {
  buildSparkAgentSystemPrompt,
  resolveSparkAgentSubagentSelection,
  buildSparkAgentTools,
  resolveSparkAgentLogsDir,
  resolveSparkAgentThinkingLevel,
  resolveSparkAgentToolCallsDir,
  type SparkAgentWorkspace,
} from "./sparkAgentRunner";
import { applyPdfTranscriptionSkillTools } from "./skills/pdfTranscription";
import {
  configureSparkLlmTelemetryFromEnv,
  createSparkAgentRunTelemetryConfig,
} from "../utils/gcp/monitoring";

const DEFAULT_GRADER_MAX_STEPS = 200;
const LOCAL_REPLAY_ATTACHMENT_MAX_COUNT = 24;
const LOCAL_REPLAY_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024;

const LocalReplayAttachmentSchema = z
  .object({
    workspacePath: z.string().trim().min(1),
    contentType: z.string().trim().min(1),
    filename: z.string().trim().min(1).optional(),
  })
  .loose();

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
    if (!attachment.contentType.startsWith("image/")) {
      notes.push(
        `${label} is available at workspace path ${attachment.workspacePath}; inspect it with extract_text, pdf_to_images, or file tools instead of relying on inline model attachment input.`,
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

async function loadLocalGraderRequestPayload(options: {
  workspaceDir: string;
}) {
  const requestPath = path.join(options.workspaceDir, "request.json");
  if (!(await pathExists(requestPath))) {
    return null;
  }
  const raw = await readFile(requestPath, { encoding: "utf8" });
  return SparkGraderRequestPayloadSchema.parse(JSON.parse(raw));
}

async function ensureLocalGraderSkillFiles(options: {
  workspaceDir: string;
}): Promise<void> {
  for (const skillFile of resolveSparkAgentSkillFiles(SPARK_GRADER_SKILL_IDS)) {
    const resolvedPath = resolveLocalReplayWorkspacePath(
      options.workspaceDir,
      skillFile.path,
    );
    if (await pathExists(resolvedPath)) {
      continue;
    }
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, skillFile.content, { encoding: "utf8" });
  }
}

export type PreparedSparkGraderReplayWorkspace = {
  sourceMode: "captured-snapshot";
  workspaceDir: string;
  manifest: SparkAgentReplayManifest;
  prompt: string;
  systemPrompt: string;
  sourceModelId: string;
  sourceThinkingLevel: LlmThinkingLevel | null;
  sourceMaxSteps: number;
  sourceUseSubagents: boolean;
};

export async function prepareSparkGraderReplayWorkspace(options: {
  sourceRunDir: string;
  targetWorkspaceDir: string;
}): Promise<PreparedSparkGraderReplayWorkspace> {
  const manifest = await readSparkAgentReplayManifest(options.sourceRunDir);
  const capturedSnapshotDir = path.join(
    options.sourceRunDir,
    SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
  );
  if (manifest === null || !(await pathExists(capturedSnapshotDir))) {
    throw new Error(
      [
        `Run directory does not contain captured replay artifacts: ${options.sourceRunDir}`,
        `Expected ${SPARK_AGENT_REPLAY_DIR}/manifest.json and ${SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR}/.`,
        "Legacy grader fallback replays are no longer supported.",
      ].join("\n"),
    );
  }
  await rm(options.targetWorkspaceDir, { recursive: true, force: true });
  await mkdir(options.targetWorkspaceDir, { recursive: true });
  await copyDirectoryContents({
    sourceDir: capturedSnapshotDir,
    targetDir: options.targetWorkspaceDir,
  });

  return {
    sourceMode: "captured-snapshot",
    workspaceDir: options.targetWorkspaceDir,
    manifest,
    prompt: manifest.prompt,
    systemPrompt: manifest.systemPrompt,
    sourceModelId: manifest.modelId,
    sourceThinkingLevel: manifest.thinkingLevel,
    sourceMaxSteps: manifest.maxSteps,
    sourceUseSubagents: manifest.useSubagents,
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
  disableExtractTextTool: boolean;
  usedInlineAttachmentPaths: string[];
  agentLogPath: string;
  llmLogsDir: string;
};

export async function runSparkGraderLocal(options: {
  workspaceDir: string;
  prompt: string;
  systemPrompt?: string;
  modelId: LlmTextModelId;
  thinkingLevel?: LlmThinkingLevel;
  maxSteps?: number;
  useSubagents?: boolean;
  disableExtractTextTool?: boolean;
  userId?: string;
  serviceAccountJson?: string;
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
  const useSubagents = options.useSubagents ?? false;
  const disableExtractTextTool = options.disableExtractTextTool ?? false;
  await ensureLocalGraderSkillFiles({ workspaceDir: options.workspaceDir });
  const serviceAccountJson =
    options.serviceAccountJson ??
    (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
      ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON
      : "{}");
  if (serviceAccountJson !== "{}") {
    try {
      await writeKnowledgeBaseWorkspaceFiles({
        serviceAccountJson,
        rootDir: options.workspaceDir,
        limit: 100,
      });
    } catch (error) {
      console.warn(
        `Unable to materialize shared PDF knowledge base for local grader replay: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

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

  let publishedSheet = false;

  const fullBaseTools = buildSparkAgentTools({
    workspace,
    rootDir: options.workspaceDir,
    userId: options.userId ?? "local-grader-replay",
    serviceAccountJson,
    allowPythonExec: false,
    graderPublish: {
      mode: "mock",
      runId: "replay-sheet",
      href: "/spark/sheets/replay-sheet",
    },
    onPublishSheet: () => {
      publishedSheet = true;
    },
    extractTextDebugRootDir: resolveSparkAgentToolCallsDir(
      options.workspaceDir,
    ),
  });
  const { extract_text, ...baseToolsWithoutExtractText } = fullBaseTools;
  void extract_text;
  const baseTools = disableExtractTextTool
    ? baseToolsWithoutExtractText
    : fullBaseTools;

  let doneSummary: string | null = null;
  let doneCalled = false;
  const done = tool({
    description:
      "Mark the local grader replay as complete. Stores a short summary for the caller.",
    terminal: true,
    inputSchema: z
      .object({
        summary: z.string().trim().min(1).optional(),
      })
      .strict(),
    execute: ({ summary }) => {
      if (!publishedSheet) {
        throw new Error(
          "Grader sheet is not published yet. Call publish_sheet before done().",
        );
      }
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
    includeReferenceTextTool: true,
    onFileWritten: () => {},
  });

  const attachments = await loadLocalGraderAttachmentParts({
    workspaceDir: options.workspaceDir,
  });
  const requestPayload = await loadLocalGraderRequestPayload({
    workspaceDir: options.workspaceDir,
  });
  configureSparkLlmTelemetryFromEnv();
  const modelTools = resolveSparkGraderModelTools({
    input: requestPayload?.input,
  });
  const prompt = disableExtractTextTool
    ? [
        options.prompt.trim(),
        "",
        "Run constraint:",
        "- The `extract_text` tool is unavailable in this replay.",
        "- Do not call `extract_text`.",
        "- Use the remaining workspace tools, including `view_image`, to inspect the uploaded documents.",
      ].join("\n")
    : options.prompt;
  const initialInput =
    attachments.parts.length > 0 || attachments.notes.length > 0
      ? buildReplayInitialInput({
          systemPrompt,
          prompt,
          inlineParts: attachments.parts,
          notes: attachments.notes,
        })
      : null;

  const toolLoopResult = await runAgentLoop({
    model: options.modelId,
    input: initialInput ?? prompt,
    ...(initialInput ? {} : { instructions: systemPrompt }),
    tools,
    ...(modelTools ? { modelTools } : {}),
    ...(useSubagents
      ? { subagents: resolveSparkAgentSubagentSelection() }
      : {}),
    maxSteps,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    telemetry: createSparkAgentRunTelemetryConfig({
      agentType: "grader",
      job: "spark-agent-replay",
      taskIdPrefix: "spark-agent-replay",
    }),
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
    prompt,
    systemPrompt,
    modelId: options.modelId,
    thinkingLevel,
    maxSteps,
    useSubagents,
    disableExtractTextTool,
    usedInlineAttachmentPaths: attachments.usedPaths,
    agentLogPath: path.join(logsDir, "agent.log"),
    llmLogsDir: path.join(logsDir, "llm_calls"),
  };
}

export async function runSparkGraderReplayLocal(options: {
  workspaceDir: string;
  prompt: string;
  systemPrompt?: string;
  modelId: LlmTextModelId;
  thinkingLevel?: LlmThinkingLevel;
  maxSteps?: number;
  useSubagents?: boolean;
  disableExtractTextTool?: boolean;
  userId?: string;
}): Promise<SparkGraderReplayRunResult> {
  return await runSparkGraderLocal(options);
}
