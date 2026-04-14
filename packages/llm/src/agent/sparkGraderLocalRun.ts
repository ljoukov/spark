import path from "node:path";
import { copyFile, mkdir, writeFile } from "node:fs/promises";

import type { LlmTextModelId } from "@ljoukov/llm";

import type { SparkGraderLaunchPlan } from "./sparkChatShared";
import { runSparkGraderLocal } from "./sparkAgentReplay";
import { captureSparkAgentReplayState } from "./sparkAgentReplayArtifacts";
import {
  buildSparkAgentSystemPrompt,
  resolveSparkAgentThinkingLevel,
  resolveSparkAgentWorkspaceRoot,
} from "./sparkAgentRunner";

const DEFAULT_LOCAL_GRADER_MODEL_ID = "chatgpt-gpt-5.4-fast" as const;
const DEFAULT_LOCAL_GRADER_MAX_STEPS = 200;

export type SparkLocalGraderRunHandle = {
  runId: string;
  agentId: string;
  workspaceId: string;
  workspaceRoot: string;
  prompt: string;
  systemPrompt: string;
  modelId: LlmTextModelId;
  resultPromise: ReturnType<typeof runSparkGraderLocal>;
};

async function materializeSparkLocalGraderWorkspace(options: {
  rootDir: string;
  plan: SparkGraderLaunchPlan;
}): Promise<void> {
  await mkdir(path.join(options.rootDir, "grader", "uploads"), {
    recursive: true,
  });
  await writeFile(path.join(options.rootDir, "brief.md"), options.plan.brief, {
    encoding: "utf8",
  });
  await writeFile(
    path.join(options.rootDir, "request.json"),
    JSON.stringify(options.plan.requestPayload, null, 2).concat("\n"),
    { encoding: "utf8" },
  );
  await writeFile(
    path.join(options.rootDir, "grader", "task.md"),
    options.plan.graderTask,
    {
      encoding: "utf8",
    },
  );
  await writeFile(
    path.join(options.rootDir, "grader", "uploads", "index.json"),
    JSON.stringify(
      {
        attachments: options.plan.runWorkspaceAttachments.map((attachment) => ({
          workspacePath: attachment.workspacePath,
          contentType: attachment.contentType,
          filename: attachment.filename,
        })),
      },
      null,
      2,
    ).concat("\n"),
    { encoding: "utf8" },
  );
  for (const attachment of options.plan.runWorkspaceAttachments) {
    if (!attachment.localPath) {
      throw new Error(
        `Local grader attachment ${attachment.id} is missing localPath.`,
      );
    }
    await mkdir(path.dirname(path.join(options.rootDir, attachment.workspacePath)), {
      recursive: true,
    });
    await copyFile(
      attachment.localPath,
      path.join(options.rootDir, attachment.workspacePath),
    );
  }
}

export async function launchSparkLocalGraderRun(options: {
  plan: SparkGraderLaunchPlan;
  modelId?: LlmTextModelId;
  maxSteps?: number;
  useSubagents?: boolean;
  userId?: string;
}): Promise<SparkLocalGraderRunHandle> {
  const modelId = options.modelId ?? DEFAULT_LOCAL_GRADER_MODEL_ID;
  const workspace = resolveSparkAgentWorkspaceRoot({
    workspaceId: options.plan.workspaceId,
    runStartedAt: options.plan.createdAt,
  });
  const systemPrompt = buildSparkAgentSystemPrompt({
    includePdfTranscriptionSkill: true,
  });
  await materializeSparkLocalGraderWorkspace({
    rootDir: workspace.rootDir,
    plan: options.plan,
  });
  await captureSparkAgentReplayState({
    rootDir: workspace.rootDir,
    agentKind: "grader",
    prompt: options.plan.prompt,
    systemPrompt,
    modelId,
    thinkingLevel: resolveSparkAgentThinkingLevel(modelId),
    maxSteps: options.maxSteps ?? DEFAULT_LOCAL_GRADER_MAX_STEPS,
    useSubagents: options.useSubagents ?? false,
    grader: {
      summaryPath: options.plan.summaryPath,
      sheetPath: options.plan.sheetPath,
    },
  });
  const resultPromise = runSparkGraderLocal({
    workspaceDir: workspace.rootDir,
    prompt: options.plan.prompt,
    systemPrompt,
    modelId,
    maxSteps: options.maxSteps ?? DEFAULT_LOCAL_GRADER_MAX_STEPS,
    useSubagents: options.useSubagents ?? false,
    userId: options.userId ?? "local-cli-grader",
  });
  return {
    runId: options.plan.runId,
    agentId: options.plan.agentId,
    workspaceId: options.plan.workspaceId,
    workspaceRoot: workspace.rootDir,
    prompt: options.plan.prompt,
    systemPrompt,
    modelId,
    resultPromise,
  };
}
