import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
import { z } from "zod";

import type { Part } from "@google/genai";
import { runGeminiCall } from "@spark/llm/utils/gemini";

import { estimateUploadBytes } from "../../utils/llm";
import {
  createGeminiStreamingStats,
  formatInteger,
  logGeminiStreamingSummary,
  type GeminiStreamingSummary,
} from "../../utils/geminiStreaming";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";

ensureEvalEnvLoaded();

const DEFAULT_TOPIC = "xor bitwise operations" as const;
const TEXT_MODEL_ID = "gemini-2.5-pro" as const;
const IMAGE_MODEL_ID = "gemini-2.5-flash-image" as const;

const optionsSchema = z.object({
  prose: z.boolean(),
  images: z.boolean(),
  topic: z.string().trim().min(1, "topic cannot be empty"),
  output: z.string().trim().min(1, "output path cannot be empty").optional(),
});

type CliOptions = z.infer<typeof optionsSchema>;

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

function buildStoryPrompt(topic: string): string {
  const audienceDesc = "advanced maths school students";
  const dialect = "UK";
  const wordCountRange = "2-3 minutes";
  return `\
Please carefully ideate on critical parts.
Use web search tool to double check if anything requires verification.

Goal: Canonical Origin Story (audio-friendly).

**Task**
Write a single-voice, audio-friendly historical story that introduces **${topic}** to **${audienceDesc}** in **${dialect}**. It must be factual, vivid, and memorable.

**Internal workflow (do not reveal unless I say “show planning”)**

**Part A — Choose the discoverer and the canonical event**

* Select **one documented originator** of **${topic}** (or its defining method) and **one specific, sourced event** where the idea was introduced (talk, memo, paper, demo, funding review, crisis, competition).
* Give **time, place, and stakes** for that moment (why the room cared that day).
* Prefer a **classical origin episode** recognised by insiders but likely new to the audience.
* **Hard rules:** do not relocate the event; do not centre a later adopter; no invented scenes or quotes.
* Include a one-line **terminology/naming clarification** if the term is confusing or politically shaped.

**Part A.1 — Introduce the figure (why this person, why now)**

* In **one to two sentences**, establish **who the person is in relation to this exact problem**, their **authority or constraint** (role, remit, pressure), and **why they are the right lens** for this concept **today**.
* Keep the colour **brief and professional**; avoid casual descriptors. The intro should make the audience think: *this person is exactly where this idea had to be born.*

**Part B — Frame the problem so listeners “see it” immediately**

* Open with **one concrete, urgent, easy-to-picture question** from the real domain of the event. Use **material nouns/verbs**; avoid abstractions. Make the **constraint** obvious on first hearing (time, fuel, memory, risk, cost).
* State the **essence of the concept in one plain sentence**.
* Provide **one precise, historically plausible mental model or analogy** rooted in the same domain.
* **Do not** give a step-by-step algorithm. If numbers are unavoidable, use **at most one** tiny calculation with **distinct values** and **no chained arithmetic**.

**Terminology for learners (mandatory)**

* **Expand acronyms on first use.**
* **Briefly gloss any term likely unfamiliar to ${audienceDesc}** at first mention (about 3-10 words), in-line and concrete.
* If a term's meaning has shifted over time, give the **period-correct meaning** in one line.

**Story constraints**

* **Historical fidelity:** real setting, roles, pressures; no localisation to the audience's city or era.
* **Contrast (one line):** name a common alternative and why it fails under the stated constraint.
* **Close:** end with a **memorable, single-line takeaway** that captures the “direction of thought”; then one factual line on **what happened next** (publication, adoption, impact).

**Style & length**

* Single narrator; **paragraphs only** (no bullets, dialogue, or footnotes).
* Short-to-medium sentences; TED-style momentum; vivid but restrained.
* Prefer **spelled-out years** for listening.
* Length: **${wordCountRange}** words.

**Output format**

* 2-4 word title
* Story should be told in two voices: M and F. Each saying 1-2 sentences at a time.
* Voice M should be a little more formal, F should be more explanatory emotional.

**Safeguards (hard rules)**

* **Discoverer-first** and **classical-anchor** required.
* **No adopter-stories**, no fiction, no relocation.
* **Term-glossing is compulsory.**
* **Character relevance test:** if swapping the figure for another would barely change the story, choose a better anchor.
`;
}

function resolveOutputDir(rawOptions: CliOptions): string {
  const provided = rawOptions.output;
  if (provided) {
    const absolute = path.isAbsolute(provided)
      ? provided
      : path.join(WORKSPACE_PATHS.codeSyntheticDir, provided);
    return absolute;
  }
  return path.join(
    WORKSPACE_PATHS.codeSyntheticDir,
    "stories",
    `story-${timestampSlug()}`
  );
}

async function generateProseStory(
  topic: string,
  outDir: string
): Promise<void> {
  console.log(
    "[story] generating prose with web-search-enabled Gemini 2.5 Pro"
  );
  const prompt = buildStoryPrompt(topic);
  const parts: Part[] = [{ text: prompt }];
  const uploadBytes = estimateUploadBytes(parts);
  const stats = createGeminiStreamingStats(
    "story/prose",
    TEXT_MODEL_ID,
    uploadBytes
  );
  let streamingSummary: GeminiStreamingSummary | undefined;
  let finalStoryLength = 0;
  const { text, modelVersion } = await runGeminiCall(async (client) => {
    const stream = await client.models.generateContentStream({
      model: TEXT_MODEL_ID,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      config: {
        thinkingConfig: {
          thinkingBudget: 32_768,
        },
        tools: [
          {
            googleSearch: {},
          },
        ],
      },
    });

    let aggregated = "";
    let resolvedModelVersion: string = TEXT_MODEL_ID;

    for await (const chunk of stream) {
      stats.observeChunk(chunk);
      if (chunk.modelVersion) {
        resolvedModelVersion = chunk.modelVersion;
      }
      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        const contentParts = candidate.content?.parts ?? [];
        for (const part of contentParts) {
          const content = part.text;
          if (content) {
            stats.recordTextChars(content.length);
            aggregated += content;
          }
        }
      }
    }

    streamingSummary = stats.summary();
    const trimmed = aggregated.trim();
    finalStoryLength = trimmed.length;
    return {
      text: aggregated.trim(),
      modelVersion: resolvedModelVersion,
    };
  });

  if (!text) {
    throw new Error("Gemini response did not include prose output");
  }

  if (streamingSummary) {
    logGeminiStreamingSummary(streamingSummary, {
      modelVersion,
      notes: `text ${formatInteger(finalStoryLength)} chars`,
    });
  }

  await mkdir(outDir, { recursive: true });
  const storyPath = path.join(outDir, "story.txt");
  const header = `modelVersion: ${modelVersion}\ntopic: ${topic}\n\n`;
  await writeFile(storyPath, header + text, { encoding: "utf8" });
  console.log(`[story] saved prose to ${storyPath}`);

  const promptPath = path.join(outDir, "prompt.txt");
  await writeFile(promptPath, prompt, { encoding: "utf8" });
  console.log(`[story] saved prompt snapshot to ${promptPath}`);
}

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

async function saveBinaryFile(
  filePath: string,
  content: Buffer
): Promise<void> {
  await writeFile(filePath, content);
  console.log(`[story] saved asset ${filePath}`);
}

function buildImagePrompt(topic: string): string {
  return [
    `Generate 4 cohesive illustration panels that visualise the canonical origin story of ${topic}.`,
    "- Each panel should align with the accompanying narration generated by the prose story.",
    "- Use a 16:9 aspect ratio for each image.",
    "- Provide short, descriptive captions (one per panel) that mention the key historical details.",
    "- Keep visuals grounded in the correct time period and setting.",
  ].join("\n");
}

async function generateStoryImages(
  topic: string,
  outDir: string
): Promise<void> {
  console.log(
    "[story] generating companion images with Gemini 2.5 Flash Image"
  );

  const prompt = buildImagePrompt(topic);
  const requestParts: Part[] = [{ text: prompt }];
  const uploadBytes = estimateUploadBytes(requestParts);
  const stats = createGeminiStreamingStats(
    "story/images",
    IMAGE_MODEL_ID,
    uploadBytes
  );
  const assetsDir = path.join(outDir, "images");
  await mkdir(assetsDir, { recursive: true });

  let nextIndex = 0;
  let aggregatedText = "";
  let modelVersion: string = IMAGE_MODEL_ID;
  let streamingSummary: GeminiStreamingSummary | undefined;
  let captionsLength = 0;

  await runGeminiCall(async (client) => {
    const stream = await client.models.generateContentStream({
      model: IMAGE_MODEL_ID,
      contents: [
        {
          role: "user",
          parts: requestParts,
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
      stats.observeChunk(chunk);
      if (chunk.modelVersion) {
        modelVersion = chunk.modelVersion;
      }

      const candidates = chunk.candidates ?? [];
      for (const candidate of candidates) {
        const contentParts = candidate.content?.parts ?? [];
        for (const part of contentParts) {
          const inlineData = part.inlineData;
          if (inlineData?.data) {
            const ext = extensionFromMime(inlineData.mimeType);
            const filePath = path.join(assetsDir, `panel-${nextIndex}.${ext}`);
            nextIndex += 1;
            const buffer = Buffer.from(inlineData.data, "base64");
            stats.recordInlineBytes(buffer.byteLength);
            await saveBinaryFile(filePath, buffer);
            continue;
          }
          if (!part.thought && part.text) {
            stats.recordTextChars(part.text.length);
            aggregatedText += part.text;
          }
        }
      }
    }

    streamingSummary = stats.summary();
    captionsLength = aggregatedText.trim().length;
  });

  if (aggregatedText.trim()) {
    const captionsPath = path.join(assetsDir, "captions.txt");
    const header = `modelVersion: ${modelVersion}\nimages: ${nextIndex}\n\n`;
    await writeFile(captionsPath, header + aggregatedText.trim(), {
      encoding: "utf8",
    });
    console.log(`[story] saved image captions to ${captionsPath}`);
  }

  if (streamingSummary) {
    const notes = [
      `panels ${formatInteger(nextIndex)}`,
      `captions ${formatInteger(captionsLength)} chars`,
    ].join(" | ");
    logGeminiStreamingSummary(streamingSummary, {
      modelVersion,
      notes,
    });
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--prose", "Generate the narrated story", false)
    .option("--images", "Generate companion illustration panels", false)
    .option("--topic <topic>", "Topic for the story", DEFAULT_TOPIC)
    .option(
      "--output <dir>",
      "Output directory (absolute or relative to spark-data/code/synthetic)"
    );

  program.parse(process.argv);
  const rawOptions = program.opts<{
    prose?: boolean;
    images?: boolean;
    topic?: string;
    output?: string;
  }>();

  const parsed = optionsSchema.parse({
    prose: Boolean(rawOptions.prose),
    images: Boolean(rawOptions.images),
    topic: rawOptions.topic ?? DEFAULT_TOPIC,
    output: rawOptions.output,
  });

  const shouldGenerateProse = parsed.prose || (!parsed.prose && !parsed.images);
  const shouldGenerateImages = parsed.images;

  if (!shouldGenerateProse && !shouldGenerateImages) {
    console.log("[story] nothing to do (no generation flags set)");
    return;
  }

  const outDir = resolveOutputDir(parsed);
  console.log(`[story] output directory: ${outDir}`);

  if (shouldGenerateProse) {
    await generateProseStory(parsed.topic, outDir);
  }

  if (shouldGenerateImages) {
    await generateStoryImages(parsed.topic, outDir);
  }

  console.log("[story] generation finished");
}

void main().catch((error) => {
  console.error("[story] generation failed:", error);
  process.exitCode = 1;
});
