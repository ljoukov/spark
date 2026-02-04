import { z } from "zod";

import { GEMINI_MODEL_IDS } from "@spark/llm/utils/gemini";
import type { JobProgressReporter } from "@spark/llm/utils/concurrency";
import { runToolLoop, tool, type LlmTextModelId } from "@spark/llm/utils/llm";
import { OPENAI_MODEL_VARIANT_IDS } from "@spark/llm/utils/openai-llm";

import { ensureEvalEnvLoaded } from "../utils/paths";

ensureEvalEnvLoaded();

const tools = {
  noop: tool({
    description: "No-op tool (should not be needed).",
    inputSchema: z.object({}),
    execute: () => ({ ok: true }),
  }),
};

function createCollectingProgress(label: string): {
  reporter: JobProgressReporter;
  getLogs: () => readonly string[];
} {
  const logs: string[] = [];
  return {
    reporter: {
      log: (message) => {
        logs.push(message);
        console.log(`[${label}] ${message}`);
      },
      startModelCall: () => Symbol("model-call"),
      recordModelUsage: () => {},
      finishModelCall: () => {},
      startStage: () => Symbol("stage"),
      finishStage: () => {},
      setActiveStages: () => {},
    },
    getLogs: () => logs,
  };
}

async function runWebSearchCheck(modelId: LlmTextModelId): Promise<void> {
  const { reporter, getLogs } = createCollectingProgress(
    `llm-web-search:${modelId}`,
  );
  const result = await runToolLoop({
    modelId,
    systemPrompt:
      'You have access to the "web_search" tool. Use it and include a source URL.',
    prompt: "search online who is the mayor of London",
    tools,
    modelTools: [{ type: "web-search", mode: "live" }],
    maxSteps: 6,
    progress: reporter,
  });
  const webSearchLogs = getLogs().filter((line) => line.includes("web_search"));
  if (webSearchLogs.length === 0) {
    throw new Error(`No web_search logs observed for ${modelId}`);
  }
  process.stdout.write(`[${modelId}] ${result.text}\n`);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.success) {
    console.error(
      options.error.issues.map((issue) => issue.message).join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  for (const modelId of options.data.modelIds) {
    await runWebSearchCheck(modelId);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function parseCliOptions(args: readonly string[]):
  | {
      success: true;
      data: { modelIds: LlmTextModelId[] };
    }
  | {
      success: false;
      error: z.ZodError;
    } {
  const MODEL_IDS = [
    ...OPENAI_MODEL_VARIANT_IDS,
    ...GEMINI_MODEL_IDS,
  ] as const satisfies readonly [LlmTextModelId, ...LlmTextModelId[]];
  const schema = z
    .object({
      model: z.enum(MODEL_IDS).optional(),
    })
    .transform(({ model }) => ({
      modelIds: [model ?? "chatgpt-gpt-5.2-codex"],
    }));

  const raw: { model?: string } = {};
  for (const arg of args) {
    if (arg.startsWith("--model=")) {
      raw.model = arg.slice("--model=".length);
    }
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
