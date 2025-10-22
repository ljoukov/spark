import { ensureEvalEnvLoaded } from "../utils/paths";
import { generateText, type LlmTextModelId } from "@spark/llm/utils/llm";
import { z } from "zod";

ensureEvalEnvLoaded();

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.success) {
    console.error(
      options.error.issues.map((issue) => issue.message).join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  const { modelId } = options.data;
  const text = await generateText({
    modelId,
    contents: [
      {
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ],
  });

  if (text.length > 0) {
    process.stdout.write(text);
    if (!text.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

function parseCliOptions(args: readonly string[]):
  | { success: true; data: { modelId: LlmTextModelId } }
  | {
      success: false;
      error: z.ZodError;
    } {
  const schema = z
    .object({
      model: z
        .enum([
          "gemini-flash-latest",
          "gemini-flash-lite-latest",
          "gemini-2.5-pro",
        ])
        .optional(),
    })
    .transform(({ model }) => {
      const modelId: LlmTextModelId = model ?? "gemini-flash-latest";
      return { modelId };
    });

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
