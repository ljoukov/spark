import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { Command } from "commander";
import type { LlmContentPart, LlmInputMessage } from "@ljoukov/llm";
import {
  createSparkChatCreateGraderTool,
  launchSparkLocalGraderRun,
  resolveSparkAgentLogsDir,
  resolveSparkAgentWorkspaceRoot,
  runSparkChatAgentLoop,
  type SparkChatAttachmentInput,
  type SparkGraderLaunchPlan,
  type SparkLocalGraderRunHandle,
} from "@spark/llm";
import { z } from "zod";

import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";

ensureEvalEnvLoaded();

const systemPromptPath = path.join(
  WORKSPACE_PATHS.webRoot,
  "src/lib/server/agent/spark-chat-system-prompt.md",
);
const graderTaskTemplatePath = path.join(
  WORKSPACE_PATHS.webRoot,
  "src/lib/server/graderAgent/task-template.md",
);

const cliArgsSchema = z.object({
  text: z.string().trim().min(1),
  attachments: z.array(z.string().trim().min(1)).min(1),
});

type CliArgs = z.infer<typeof cliArgsSchema>;

function parseCliArgs(args: readonly string[]): CliArgs {
  const command = new Command("tools:spark-chat-grader-local")
    .description(
      "Run the Spark chat agent locally, capture the structured create_grader payload, and launch the grader in-process.",
    )
    .requiredOption("--text <text>", "chat message to send")
    .requiredOption(
      "--attachment <path>",
      "attachment file path (repeat for multiple files)",
      collectStringArg,
      [],
    );
  command.parse(args, { from: "user" });

  const options = command.opts<{
    text?: string;
    attachment?: string[];
  }>();

  return cliArgsSchema.parse({
    text: options.text,
    attachments: options.attachment ?? [],
  });
}

function collectStringArg(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function resolveAttachmentContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    case ".pdf":
      return "application/pdf";
  }
  throw new Error(`Unsupported attachment type for ${filePath}.`);
}

async function loadAttachments(
  attachmentPaths: readonly string[],
): Promise<{
  attachments: SparkChatAttachmentInput[];
  inlineParts: LlmContentPart[];
}> {
  const attachments: SparkChatAttachmentInput[] = [];
  const inlineParts: LlmContentPart[] = [];
  for (const attachmentPath of attachmentPaths) {
    const resolvedPath = path.resolve(process.cwd(), attachmentPath);
    const bytes = await readFile(resolvedPath);
    const contentType = resolveAttachmentContentType(resolvedPath);
    const attachmentId = createHash("md5").update(bytes).digest("hex");
    attachments.push({
      id: attachmentId,
      localPath: resolvedPath,
      contentType,
      filename: path.basename(resolvedPath),
      sizeBytes: bytes.length,
    });
    inlineParts.push({
      type: "inlineData",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: contentType,
    });
  }
  return { attachments, inlineParts };
}

async function readSharedTextFile(filePath: string): Promise<string> {
  const raw = await readFile(filePath, { encoding: "utf8" });
  return raw.trim();
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2).concat("\n"), {
    encoding: "utf8",
  });
}

function requirePlan(
  value: SparkGraderLaunchPlan | null,
): SparkGraderLaunchPlan {
  if (value === null) {
    throw new Error("Chat run completed without calling create_grader.");
  }
  return value;
}

function requireGraderHandle(
  value: SparkLocalGraderRunHandle | null,
): SparkLocalGraderRunHandle {
  if (value === null) {
    throw new Error(
      "create_grader returned without launching a local grader run.",
    );
  }
  return value;
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const chatWorkspace = resolveSparkAgentWorkspaceRoot({
    workspaceId: `chat-${conversationId}-${messageId}`,
    runStartedAt: new Date(),
  });
  const logsDir = resolveSparkAgentLogsDir(chatWorkspace.rootDir);
  const toolCallDir = path.join(logsDir, "tool_calls", "create_grader");
  const systemPrompt = await readSharedTextFile(systemPromptPath);
  const graderTaskTemplate = await readSharedTextFile(graderTaskTemplatePath);
  const { attachments, inlineParts } = await loadAttachments(cli.attachments);

  let structuredPlan: SparkGraderLaunchPlan | null = null;
  let graderHandle: SparkLocalGraderRunHandle | null = null;

  const tools = {
    create_grader: createSparkChatCreateGraderTool({
      sourceText: cli.text,
      conversationId,
      attachmentsForMessage: attachments,
      graderTaskTemplate,
      onStructuredCall: async ({ input, plan }) => {
        structuredPlan = plan;
        await writeJsonArtifact(path.join(toolCallDir, "tool_call.json"), {
          input,
          plan,
        });
      },
      launch: async ({ plan }) => {
        graderHandle = await launchSparkLocalGraderRun({
          plan,
        });
        await writeJsonArtifact(path.join(toolCallDir, "tool_call_response.json"), {
          status: "started",
          runId: graderHandle.runId,
          agentId: graderHandle.agentId,
          workspaceId: graderHandle.workspaceId,
          workspaceRoot: graderHandle.workspaceRoot,
        });
        return {
          status: "started" as const,
        };
      },
    }),
  };

  const input: LlmInputMessage[] = [
    {
      role: "user",
      content: [
        ...inlineParts,
        {
          type: "text",
          text: cli.text,
        },
      ],
    },
  ];

  const chatResult = await runSparkChatAgentLoop({
    input,
    instructions: systemPrompt,
    tools,
    logging: {
      workspaceDir: logsDir,
      callLogsDir: "llm_calls",
      mirrorToConsole: false,
    },
  });

  const resolvedPlan = requirePlan(structuredPlan);
  const resolvedGraderHandle = requireGraderHandle(graderHandle);
  const graderResult = await resolvedGraderHandle.resultPromise;
  const output = {
    conversationId,
    messageId,
    chatWorkspacePath: chatWorkspace.rootDir,
    chatLogsDir: logsDir,
    chatResponseText: chatResult.text,
    createGraderToolCallPath: path.join(toolCallDir, "tool_call.json"),
    createGraderToolResponsePath: path.join(
      toolCallDir,
      "tool_call_response.json",
    ),
    graderRun: {
      id: resolvedGraderHandle.runId,
      agentId: resolvedGraderHandle.agentId,
      workspaceId: resolvedGraderHandle.workspaceId,
      workspacePath: resolvedGraderHandle.workspaceRoot,
      summaryPath: resolvedPlan.summaryPath,
      agentLogPath: graderResult.agentLogPath,
      llmLogsDir: graderResult.llmLogsDir,
      doneSummary: graderResult.doneSummary,
    },
  };

  process.stdout.write(JSON.stringify(output, null, 2).concat("\n"));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
