import path from "node:path";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { z } from "zod";
import type { LlmThinkingLevel } from "@ljoukov/llm";

export const SPARK_AGENT_REPLAY_DIR = ".spark-agent-replay" as const;
export const SPARK_AGENT_REPLAY_MANIFEST_PATH =
  `${SPARK_AGENT_REPLAY_DIR}/manifest.json` as const;
export const SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR =
  `${SPARK_AGENT_REPLAY_DIR}/initial-workspace` as const;

const SparkAgentReplayManifestSchema = z
  .object({
    version: z.literal(1),
    agentKind: z.enum(["grader"]),
    capturedAt: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    systemPrompt: z.string().trim().min(1),
    modelId: z.string().trim().min(1),
    thinkingLevel: z.enum(["low", "medium", "high"]).nullable(),
    maxSteps: z.number().int().min(1),
    useSubagents: z.boolean(),
    grader: z
      .object({
        summaryPath: z.string().trim().min(1),
        sheetPath: z.string().trim().min(1),
      })
      .optional(),
  })
  .strict();

export type SparkAgentReplayManifest = z.infer<
  typeof SparkAgentReplayManifestSchema
>;

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

async function copyWorkspaceEntries(options: {
  sourceDir: string;
  targetDir: string;
  excludeTopLevelNames?: Set<string>;
}): Promise<void> {
  await mkdir(options.targetDir, { recursive: true });
  const entries = await readdir(options.sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (options.excludeTopLevelNames?.has(entry.name)) {
      continue;
    }
    await copyPath(
      path.join(options.sourceDir, entry.name),
      path.join(options.targetDir, entry.name),
    );
  }
}

export async function captureSparkAgentReplayState(options: {
  rootDir: string;
  agentKind: "grader";
  prompt: string;
  systemPrompt: string;
  modelId: string;
  thinkingLevel?: LlmThinkingLevel;
  maxSteps: number;
  useSubagents: boolean;
  grader?: {
    summaryPath: string;
    sheetPath: string;
  };
}): Promise<void> {
  const replayRootDir = path.join(options.rootDir, SPARK_AGENT_REPLAY_DIR);
  const snapshotDir = path.join(
    options.rootDir,
    SPARK_AGENT_REPLAY_INITIAL_WORKSPACE_DIR,
  );
  await rm(replayRootDir, { recursive: true, force: true });
  await mkdir(snapshotDir, { recursive: true });
  await copyWorkspaceEntries({
    sourceDir: options.rootDir,
    targetDir: snapshotDir,
    excludeTopLevelNames: new Set([
      SPARK_AGENT_REPLAY_DIR,
      "logs",
      ".llm-debug",
    ]),
  });

  const manifest: SparkAgentReplayManifest =
    SparkAgentReplayManifestSchema.parse({
      version: 1,
      agentKind: options.agentKind,
      capturedAt: new Date().toISOString(),
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel ?? null,
      maxSteps: options.maxSteps,
      useSubagents: options.useSubagents,
      ...(options.grader ? { grader: options.grader } : {}),
    });
  await writeFile(
    path.join(options.rootDir, SPARK_AGENT_REPLAY_MANIFEST_PATH),
    JSON.stringify(manifest, null, 2).concat("\n"),
    { encoding: "utf8" },
  );
}

export async function readSparkAgentReplayManifest(
  rootDir: string,
): Promise<SparkAgentReplayManifest | null> {
  const manifestPath = path.join(rootDir, SPARK_AGENT_REPLAY_MANIFEST_PATH);
  if (!(await pathExists(manifestPath))) {
    return null;
  }
  const raw = await readFile(manifestPath, { encoding: "utf8" });
  return SparkAgentReplayManifestSchema.parse(JSON.parse(raw));
}
