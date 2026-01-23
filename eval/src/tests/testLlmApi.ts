import { ensureEvalEnvLoaded } from "../utils/paths";
import { runToolLoop, tool, type LlmTextModelId } from "@spark/llm/utils/llm";
import { OPENAI_MODEL_VARIANT_IDS } from "@spark/llm/utils/openai-llm";
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

async function runToolCheck(
  modelId: LlmTextModelId,
): Promise<void> {
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
  const schema = z
    .object({
      model: z.enum(["openai", "gemini", "all"]).optional(),
      openaiModel: z.enum(OPENAI_MODEL_VARIANT_IDS).optional(),
    })
    .transform(({ model, openaiModel }) => {
      const selection = model ?? "all";
      const resolvedOpenAiModel = openaiModel ?? "gpt-5.2";
      const modelIds: LlmTextModelId[] = [];
      if (selection === "openai" || selection === "all") {
        modelIds.push(resolvedOpenAiModel);
      }
      if (selection === "gemini" || selection === "all") {
        modelIds.push("gemini-2.5-pro");
      }
      return { modelIds };
    });

  const raw: { model?: string; openaiModel?: string } = {};
  for (const arg of args) {
    if (arg.startsWith("--model=")) {
      raw.model = arg.slice("--model=".length);
    }
    if (arg.startsWith("--openai-model=")) {
      raw.openaiModel = arg.slice("--openai-model=".length);
    }
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
