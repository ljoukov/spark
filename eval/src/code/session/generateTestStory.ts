import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { runGeminiCall } from "@spark/llm/utils/gemini";

import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";

ensureEvalEnvLoaded();

const MODEL_ID = "gemini-2.5-flash-image" as const;

function extensionFromMime(mimeType?: string): string {
  if (!mimeType) {
    return "png";
  }
  const lower = mimeType.toLowerCase();
  if (lower === "image/jpeg" || lower === "image/jpg") {
    return "jpg";
  }
  if (lower === "image/png") {
    return "png";
  }
  if (lower === "image/webp") {
    return "webp";
  }
  if (lower === "image/gif") {
    return "gif";
  }
  return "png";
}

async function saveBinaryFile(filePath: string, content: Buffer): Promise<void> {
  await writeFile(filePath, content);
  console.log(`Saved: ${filePath}`);
}

function timestampSlug(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

async function main(): Promise<void> {
  const outRoot = path.join(
    WORKSPACE_PATHS.codeSyntheticDir,
    "illustrations",
    `cat-story-${timestampSlug()}`,
  );
  await mkdir(outRoot, { recursive: true });
  console.log(`Output dir: ${outRoot}`);

  const prompt = [
    "Generate 4 images for a story about a cat.",
    "- Use a 16:9 aspect ratio for each image.",
    "- Also produce short narrative captions (one per image).",
  ].join("\n");

  let imageIndex = 0;
  let aggregatedText = "";
  let modelVersion: string = MODEL_ID;

  await runGeminiCall(async (client) => {
    const stream = await client.models.generateContentStream({
      model: MODEL_ID,
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
        imageConfig: {
          aspectRatio: "16:9",
        },
      },
    });

    for await (const chunk of stream) {
      if (chunk.modelVersion) {
        modelVersion = chunk.modelVersion;
      }

      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        const parts = candidate.content?.parts ?? [];
        for (const part of parts) {
          const inlineData = part.inlineData;
          if (inlineData) {
            const ext = extensionFromMime(inlineData.mimeType);
            const filePath = path.join(outRoot, `cat_story_${imageIndex}.${ext}`);
            imageIndex += 1;
            const data = inlineData.data ?? "";
            const buffer = Buffer.from(data, "base64");
            await saveBinaryFile(filePath, buffer);
            continue;
          }

          if (!part.thought && part.text) {
            aggregatedText += part.text;
          }
        }
      }
    }
  });

  const textOut = path.join(outRoot, "story.txt");
  const header = `modelVersion: ${modelVersion}\nimages: ${imageIndex}\n\n`;
  await writeFile(textOut, header + aggregatedText, { encoding: "utf8" });
  console.log(`Saved: ${textOut}`);
  console.log("Done.");
}

void main().catch((err) => {
  console.error("Failed to generate illustrations:", err);
  process.exitCode = 1;
});
