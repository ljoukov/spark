import { ensureEvalEnvLoaded } from "../utils/paths";
import {
  generateJson,
  generateText,
  LlmJsonCallError,
  toGeminiJsonSchema,
  type LlmTextModelId,
} from "@spark/llm/utils/llm";
import {
  DEFAULT_OPENAI_MODEL_ID,
  OPENAI_MODEL_IDS,
  type OpenAiModelId,
} from "@spark/llm/utils/openai-llm";
import { z } from "zod";
import { Type, type Schema } from "@google/genai";

ensureEvalEnvLoaded();

const GREETING_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["greeting"],
  properties: {
    greeting: { type: Type.STRING },
  },
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (!options.success) {
    console.error(
      options.error.issues.map((issue) => issue.message).join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const { modelId, jsonModelId, debugDir } = options.data;
  const debug =
    typeof debugDir === "string" && debugDir.length > 0
      ? { rootDir: debugDir, stage: "openai-test" }
      : undefined;

  const text = await generateText({
    modelId,
    debug,
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

  const toolText = await generateText({
    modelId,
    debug,
    tools: [{ type: "code-execution" }],
    contents: [
      {
        role: "user",
        parts: [
          {
            type: "text",
            text: [
              "Use the code interpreter to compute 19 * 23.",
              "Reply with `RESULT: <number>` and nothing else.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  const resultMatch = /RESULT:\s*([0-9]+(?:\\.[0-9]+)?)/u.exec(toolText);
  if (!resultMatch) {
    throw new Error(
      `Code interpreter test failed to return RESULT prefix. Raw: ${toolText}`,
    );
  }

  const numericResult = Number.parseFloat(resultMatch[1]);
  if (!Number.isFinite(numericResult) || numericResult !== 437) {
    throw new Error(
      `Code interpreter result mismatch. Expected 437, got ${resultMatch[1]}`,
    );
  }

  try {
    const jsonPayload = await generateJson({
      modelId: jsonModelId,
      schema: z.object({
        greeting: z.string(),
      }),
      responseJsonSchema: toGeminiJsonSchema(GREETING_RESPONSE_SCHEMA),
      debug,
      contents: [
        {
          role: "user",
          parts: [
            {
              type: "text",
              text: "Return JSON with { greeting: string } that says hello.",
            },
          ],
        },
      ],
      openAiSchemaName: "openai_greeting",
    });

    process.stdout.write(JSON.stringify(jsonPayload, null, 2));
    process.stdout.write("\n");
    if (!jsonPayload.greeting.trim()) {
      throw new Error("JSON test returned an empty greeting.");
    }
  } catch (error) {
    if (error instanceof LlmJsonCallError) {
      for (const attempt of error.attempts) {
        const label = `Attempt ${String(attempt.attempt)}`;
        const rawText = attempt.rawText || "(empty response)";
        process.stderr.write(`${label} raw text:\n${rawText}\n`);
      }
    }
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function parseCliOptions(args: readonly string[]):
  | {
      success: true;
      data: {
        modelId: OpenAiModelId;
        jsonModelId: LlmTextModelId;
        debugDir?: string;
      };
    }
  | { success: false; error: z.ZodError } {
  const schema = z
    .object({
      model: z.enum(OPENAI_MODEL_IDS).optional(),
      jsonModel: z.enum(OPENAI_MODEL_IDS).optional(),
      debugDir: z.string().optional(),
    })
    .transform(({ model, jsonModel, debugDir }) => {
      const modelId: OpenAiModelId = model ?? DEFAULT_OPENAI_MODEL_ID;
      const jsonModelId: LlmTextModelId = jsonModel ?? modelId;
      return { modelId, jsonModelId, debugDir };
    });

  const raw: { model?: string; jsonModel?: string; debugDir?: string } = {};
  for (const arg of args) {
    if (arg.startsWith("--model=")) {
      raw.model = arg.slice("--model=".length);
    }
    if (arg.startsWith("--json-model=")) {
      raw.jsonModel = arg.slice("--json-model=".length);
    }
    if (arg.startsWith("--debug-dir=")) {
      raw.debugDir = arg.slice("--debug-dir=".length);
    }
  }
  const result = schema.safeParse(raw);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}
