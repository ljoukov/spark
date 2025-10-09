import { runGeminiCall } from "@spark/llm";

import { ensureEvalEnvLoaded } from "../utils/paths";

ensureEvalEnvLoaded();

async function main(): Promise<void> {
  await runGeminiCall(async (client) => {
    const stream = await client.models.generateContentStream({
      model: "gemini-flash-latest",
      contents: [
        {
          role: "user",
          parts: [{ text: "hello" }],
        },
      ],
      config: {
        responseMimeType: "text/plain",
      },
    });

    let emitted = false;
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        process.stdout.write(text);
        emitted = true;
      }
    }

    if (emitted) {
      process.stdout.write("\n");
    }
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
