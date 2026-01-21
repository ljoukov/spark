import { Command } from "commander";

import {
  runSessionAgentSmokeTest,
  runSessionGenerationAgent,
} from "@spark/llm/code/sessionGenerationAgent";
import type { LlmTextModelId } from "@spark/llm/utils/llm";
import { ensureEvalEnvLoaded } from "../utils/paths";

ensureEvalEnvLoaded();

type CliOptions = {
  workingDirectory: string;
  briefFile?: string;
  topic?: string;
  userId: string;
  sessionId?: string;
  storyPlanItemId?: string;
  storySegmentCount?: number;
  modelId?: string;
  maxSteps?: number;
  story: boolean;
  coding: boolean;
  smokeTest: boolean;
};

function parseCliOptions(): CliOptions {
  const program = new Command();
  program
    .requiredOption("--working-directory <path>")
    .option("--brief-file <path>")
    .option("--topic <topic>")
    .option("--user-id <id>", "session user id", "session-agent")
    .option("--session-id <id>")
    .option("--story-plan-item-id <id>")
    .option("--story-segment-count <count>")
    .option("--model-id <id>")
    .option("--max-steps <count>")
    .option("--no-story")
    .option("--no-coding")
    .option("--smoke-test");

  program.parse(process.argv);
  const opts = program.opts();
  const storySegmentCount = opts.storySegmentCount
    ? Number.parseInt(String(opts.storySegmentCount), 10)
    : undefined;
  const maxSteps = opts.maxSteps
    ? Number.parseInt(String(opts.maxSteps), 10)
    : undefined;

  if (
    opts.briefFile === undefined &&
    opts.topic === undefined &&
    !opts.smokeTest
  ) {
    throw new Error("Provide --brief-file or --topic (or use --smoke-test)");
  }

  return {
    workingDirectory: String(opts.workingDirectory),
    briefFile: opts.briefFile ? String(opts.briefFile) : undefined,
    topic: opts.topic ? String(opts.topic) : undefined,
    userId: String(opts.userId ?? "session-agent"),
    sessionId: opts.sessionId ? String(opts.sessionId) : undefined,
    storyPlanItemId: opts.storyPlanItemId
      ? String(opts.storyPlanItemId)
      : undefined,
    storySegmentCount,
    modelId: opts.modelId ? String(opts.modelId) : undefined,
    maxSteps,
    story: Boolean(opts.story),
    coding: Boolean(opts.coding),
    smokeTest: Boolean(opts.smokeTest),
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  if (options.smokeTest) {
    await runSessionAgentSmokeTest({
      workingDirectory: options.workingDirectory,
      modelId: options.modelId as unknown as LlmTextModelId,
    });
    process.stdout.write("Smoke test succeeded.\n");
    return;
  }

  const result = await runSessionGenerationAgent({
    workingDirectory: options.workingDirectory,
    briefFile: options.briefFile,
    topic: options.topic,
    userId: options.userId,
    sessionId: options.sessionId,
    includeStory: options.story,
    includeCoding: options.coding,
    storyPlanItemId: options.storyPlanItemId,
    storySegmentCount: options.storySegmentCount,
    modelId: options.modelId as unknown as LlmTextModelId,
    maxSteps: options.maxSteps,
  });

  process.stdout.write(
    `Session generated: ${result.sessionId} (${result.session.title})\n`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
