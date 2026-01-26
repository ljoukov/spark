import { ensureEvalEnvLoaded } from "../utils/paths";
import { runToolLoop, tool, type LlmTextModelId } from "@spark/llm/utils/llm";
import { OPENAI_MODEL_VARIANT_IDS } from "@spark/llm/utils/openai-llm";
import { GEMINI_MODEL_IDS } from "@spark/llm/utils/gemini";
import { z } from "zod";

ensureEvalEnvLoaded();

const tools = {
  weather: tool({
    description: "Get the weather in Fahrenheit",
    inputSchema: z.object({
      location: z.string().describe("Location to fetch weather for"),
    }),
    execute: ({ location }) => ({
      location,
      temperatureF: 68,
    }),
  }),
  convertFahrenheitToCelsius: tool({
    description: "Convert Fahrenheit to Celsius",
    inputSchema: z.object({
      temperatureF: z.number().describe("Temperature in Fahrenheit"),
    }),
    execute: ({ temperatureF }) => ({
      celsius: Math.round((temperatureF - 32) * (5 / 9)),
    }),
  }),
};

async function runToolCheck(modelId: LlmTextModelId): Promise<void> {
  const result = await runToolLoop({
    modelId,
    prompt:
      "Use the tools to answer. Get the weather in San Francisco in celsius. " +
      "Call weather first, then convertFahrenheitToCelsius with temperatureF.",
    tools,
    maxSteps: 6,
  });
  let hasToolCalls = false;
  for (const step of result.steps) {
    if (step.toolCalls.length > 0) {
      hasToolCalls = true;
      break;
    }
  }
  if (!hasToolCalls) {
    throw new Error(`No tool calls observed for ${modelId}`);
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
    await runToolCheck(modelId);
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
      modelIds: [model ?? "gpt-5.2"],
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
