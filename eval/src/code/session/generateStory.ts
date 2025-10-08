import { Buffer } from "node:buffer";
import path from "node:path";

import type { Part } from "@google/genai";
import { z } from "zod";

import { runGeminiCall, type GeminiModelId } from "@spark/llm/utils/gemini";
import {
  estimateUploadBytes,
} from "../../utils/llm";
import { formatInteger, formatMillis } from "../../utils/format";
import type { JobProgressReporter } from "../../utils/concurrency";
import {
  getFirebaseAdminStorage,
} from "@spark/llm";
import type { MediaSegment } from "@spark/llm";

import { createConsoleProgress, synthesizeAndPublishNarration } from "./narration";

export const DEFAULT_TOPIC = "xor bitwise operations" as const;
export const TEXT_MODEL_ID = "gemini-2.5-pro" as const;
export const IMAGE_MODEL_ID = "gemini-2.5-flash-image" as const;

export type StoryProgress = JobProgressReporter | undefined;

function useProgress(progress: StoryProgress) {
  return {
    log(message: string) {
      if (progress) {
        progress.log(message);
      } else {
        console.log(message);
      }
    },
    reportChars(delta: number) {
      if (progress) {
        progress.reportChars(delta);
      }
    },
    startModelCall(details: { modelId: GeminiModelId; uploadBytes: number }) {
      if (progress) {
        return progress.startModelCall(details);
      }
      return Symbol("model-call");
    },
    recordModelUsage(handle: symbol, delta: {
      promptTokensDelta: number;
      inferenceTokensDelta: number;
      cachedTokensDelta?: number;
      timestamp: number;
    }) {
      if (progress) {
        progress.recordModelUsage(handle, delta);
      }
    },
    finishModelCall(handle: symbol) {
      if (progress) {
        progress.finishModelCall(handle);
      }
    },
  };
}

const StorySegmentNarrationSchema = z.object({
  voice: z.enum(["M", "F"]),
  text: z.string().trim().min(1),
});

const StorySegmentSchema = z.object({
  imagePrompt: z.string().trim().min(1),
  narration: z.array(StorySegmentNarrationSchema).min(1),
});

export const StorySegmentationSchema = z.object({
  title: z.string().trim().min(1),
  segments: z.array(StorySegmentSchema).min(5).max(6),
});

export type StorySegmentation = z.infer<typeof StorySegmentationSchema>;

export type StoryProseResult = {
  text: string;
  prompt: string;
  modelVersion: string;
};

export type StorySegmentationResult = {
  segmentation: StorySegmentation;
  prompt: string;
  modelVersion: string;
};

export type GeneratedStoryImage = {
  index: number;
  mimeType: string;
  data: Buffer;
};

export type StoryImagesResult = {
  images: GeneratedStoryImage[];
  prompt: string;
  modelVersion: string;
  captions?: string;
};

const SEGMENTATION_JSON_SCHEMA = `{
  "type": "object",
  "required": ["title", "segments"],
  "properties": {
    "title": { "type": "string", "minLength": 1 },
    "segments": {
      "type": "array",
      "minItems": 5,
      "maxItems": 6,
      "items": {
        "type": "object",
        "required": ["imagePrompt", "narration"],
        "properties": {
          "imagePrompt": { "type": "string", "minLength": 1 },
          "narration": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["voice", "text"],
              "properties": {
                "voice": { "type": "string", "enum": ["M", "F"] },
                "text": { "type": "string", "minLength": 1 }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}`;

function buildStoryPrompt(topic: string): string {
  const audienceDesc = "advanced maths school students";
  const dialect = "UK";
  const length = "2-3 minutes";
  return `\
Please carefully ideate on critical parts.
Use web search tool to double check if anything requires verification.

Goal: Canonical Origin Story (audio-friendly).

**Task**
Write a single-voice, audio-friendly historical story that introduces **${topic}** to **${audienceDesc}** in **${dialect}**. It must be factual, vivid, and memorable.

**Internal workflow**

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
* Length: **${length}**.

**Output format**

* 2-4 word title
* Story paragraphs

**Safeguards (hard rules)**

* **Discoverer-first** and **classical-anchor** required.
* **No adopter-stories**, no fiction, no relocation.
* **Term-glossing is compulsory.**
* **Character relevance test:** if swapping the figure for another would barely change the story, choose a better anchor.
`;
}

function buildSegmentationPrompt(storyText: string): string {
  return [
    "Convert the provided historical story into a structured narration and illustration plan.",
    "",
    "Requirements:",
    "1. Produce concise JSON that conforms exactly to the schema below. Do not include commentary or code fences.",
    "2. Extract the `title` for the story.",
    "3. Split the story into 5-6 chronological `segments`. Each segment represents a single focused beat of the story.",
    "4. For every segment:",
    "   • Provide `narration`, an ordered array of narration slices. Each slice contains `voice` and `text`.",
    "   • Alternate between the `M` and `F` voices whenever the flow allows. Let `M` handle formal or structural beats; let `F` handle emotional or explanatory beats. Avoid repeating the same voice twice in a row unless it preserves clarity. Remove citation markers or reference-style callouts.",
    "   • Provide `imagePrompt`, a detailed visual prompt that captures the same moment as the narration slice(s).",
    "",
    "Illustration guidance:",
    "• Follow the master brief in <IMAGE_PROMPTS_REQUIREMENTS>. Every prompt must focus on the protagonist, specify the environment, lighting, and emotional cues, and call for a single clear action.",
    "• Keep prompts grounded in the authentic historical setting and tone of the story.",
    "",
    "JSON schema:",
    SEGMENTATION_JSON_SCHEMA,
    "",
    "Respond with JSON only. No markdown fences.",
    "",
    "================ Story to segment ================",
    "<STORY>",
    storyText,
    "</STORY>",
    "==================================================",
    "",
    "segmentation prompt:",
    "------------------",
    "Convert the story into alternating-voice narration segments with illustration prompts and a title, following all rules above.",
    "<IMAGE_PROMPTS_REQUIREMENTS>",
    "### **Master Prompt: The Historical Storyteller's Visual Guide**",
    "",
    "**Your Role:** You are a master storyteller and concept artist. Your talent lies in translating written narratives about history's great thinkers into powerful, emotionally resonant visual scenes. You understand how to tell a story through images, focusing on character, mood, and clarity.",
    "",
    "**Your Mission:** I will provide a story about a historical figure and their discovery. Your task is to generate a series of 5-6 illustration prompts based on the key moments of this story. Each prompt must be a self-contained, cinematic scene that captures a critical point in the narrative and could serve as a keyframe in a feature animated film.",
    "",
    "---",
    "",
    "### **Core Principles for Every Prompt:**",
    "",
    '1.  **The Character is the Heart:** Every scene must revolve around the protagonist. Focus on their actions, their emotional state, and their perspective. What are they thinking? What are they feeling? Use descriptive language for their facial expressions (e.g., "a furrowed brow of intense concentration," "a sudden, wide-eyed look of revelation," "a quiet smile of satisfaction").',
    "",
    "2.  **Make the Abstract Concrete:** Scientific and intellectual concepts are invisible. Your job is to make them visible and interactive. Brainstorm a clear, simple visual metaphor for the core concept. Instead of showing an abstract formula, show the character physically manipulating objects that represent the idea, or drawing a diagram that magically clarifies itself from a tangled mess. The hero must be *doing something* that represents their thought process.",
    "",
    "3.  **Cinematic and Grounded Scenes:** Each prompt should describe a complete, believable scene. Define the environment, the quality of light, and the overall atmosphere. Ensure the scene is grounded in a logical reality to avoid surreal or nonsensical outputs from the image generator. **Crucially, describe one single, clear, and focused action per image.**",
    "",
    "---",
    "",
    "### **Signature Art Style to Embody:**",
    "",
    'You must craft your prompts to evoke a specific high-end 3D animation style. Do not use words like "Pixar" or "DreamWorks." Instead, describe the style through its core components:',
    "",
    "*   **Characters:** Design appealing, stylized characters with expressive faces and believable emotions. They should feel like hand-sculpted clay models brought to life, not hyper-realistic humans.",
    '*   **Lighting:** Describe warm, cinematic lighting. Use terms like "soft volumetric light streaming through a window," "a warm glow from a single desk lamp in a dark room," or "dramatic backlighting that creates a strong silhouette." Light should be used to direct the eye and create mood.',
    "*   **Textures & Surfaces:** The world should feel tangible. Prompts should imply rich, detailed textures. Wood should have grain, metal should have a soft sheen, and paper should feel fibrous.",
    "*   **Color:** The scenes should be built on a vibrant and harmonious color palette that enhances the emotional tone of the story.",
    "",
    "---",
    "",
    "### **Final Instructions:**",
    "",
    "*   Analyze the provided story for its most pivotal narrative and emotional beats.",
    "*   Generate a numbered list of 5-6 illustration prompts.",
    "*   Each prompt must have a short, evocative title.",
    "*   Ensure your prompts are clear, concise, and focused, giving the image generator a direct and unambiguous task to execute beautifully.",
    "</IMAGE_PROMPTS_REQUIREMENTS>",
    "--------------",
  ].join("\n");
}

function buildImageGenerationPrompt(segmentation: StorySegmentation): string {
  const segments = segmentation.segments;
  const count = segments.length;
  const lines: string[] = [
    `Please follow each of the ${count} image prompts to make illustrations for the story.`,
    "",
  ];

  segments.forEach((segment, index) => {
    lines.push(`Illustration ${index + 1}:`);
    lines.push(segment.imagePrompt);
    if (index < segments.length - 1) {
      lines.push("");
    }
  });

  return lines.join("\n");
}

export async function generateProseStory(
  topic: string,
  progress?: StoryProgress,
): Promise<StoryProseResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating prose with web-search-enabled Gemini 2.5 Pro");
  const prompt = buildStoryPrompt(topic);
  const parts: Part[] = [{ text: prompt }];
  const uploadBytes = estimateUploadBytes(parts);
  const callHandle = adapter.startModelCall({
    modelId: TEXT_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  const startTime = Date.now();

  let aggregated = "";
  let resolvedModelVersion: string = TEXT_MODEL_ID;

  try {
    const result = await runGeminiCall(async (client) => {
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
            includeThoughts: true,
            thinkingBudget: 32_768,
          },
          tools: [
            {
              googleSearch: {},
            },
          ],
        },
      });

      let lastPromptTokens = 0;
      let lastCachedTokens = 0;
      let lastThinkingTokens = 0;
      let lastInferenceTokens = 0;

      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          resolvedModelVersion = chunk.modelVersion;
        }
        const candidates = chunk.candidates ?? [];
        for (const candidate of candidates) {
          const contentParts = candidate.content?.parts ?? [];
          for (const part of contentParts) {
            const content = part.text;
            if (content) {
              aggregated += content;
              adapter.reportChars(content.length);
            }
          }
        }
        const usage = chunk.usageMetadata;
        if (usage) {
          const promptTokensNow = usage.promptTokenCount ?? 0;
          const cachedTokensNow = usage.cachedContentTokenCount ?? 0;
          const thinkingTokensNow = usage.thoughtsTokenCount ?? 0;
          const inferenceTokensNow = usage.candidatesTokenCount ?? 0;
          const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
          const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
          const thinkingDelta = Math.max(
            0,
            thinkingTokensNow - lastThinkingTokens,
          );
          const inferenceDelta = Math.max(
            0,
            inferenceTokensNow - lastInferenceTokens,
          );
          if (promptDelta > 0 || cachedDelta > 0 || inferenceDelta > 0) {
            adapter.recordModelUsage(callHandle, {
              promptTokensDelta: promptDelta,
              cachedTokensDelta: cachedDelta > 0 ? cachedDelta : undefined,
              inferenceTokensDelta: inferenceDelta,
              timestamp: Date.now(),
            });
          }
          lastPromptTokens = promptTokensNow;
          lastCachedTokens = cachedTokensNow;
          lastThinkingTokens = thinkingTokensNow;
          lastInferenceTokens = inferenceTokensNow;
        }
      }

      const trimmed = aggregated.trim();
      if (!trimmed) {
        throw new Error("Gemini response did not include prose output");
      }

      return {
        text: trimmed,
        modelVersion: resolvedModelVersion,
      };
    });

    const elapsed = formatMillis(Date.now() - startTime);
    adapter.log(`[story/prose] model ${result.modelVersion} finished in ${elapsed}`);

    return {
      text: result.text,
      prompt,
      modelVersion: result.modelVersion,
    };
  } finally {
    adapter.finishModelCall(callHandle);
  }
}

function extractJsonObject(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Gemini segmentation response was empty");
  }

  const unwrapped = (() => {
    if (!trimmed.startsWith("```")) {
      return trimmed;
    }
    const firstLineBreak = trimmed.indexOf("\n");
    if (firstLineBreak === -1) {
      return trimmed;
    }
    const withoutFence = trimmed.slice(firstLineBreak + 1);
    const closingFenceIndex = withoutFence.lastIndexOf("```");
    if (closingFenceIndex === -1) {
      return withoutFence.trim();
    }
    return withoutFence.slice(0, closingFenceIndex).trim();
  })();

  const start = unwrapped.indexOf("{");
  const end = unwrapped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Unable to locate JSON object in segmentation response");
  }
  const candidate = unwrapped.slice(start, end + 1);
  return JSON.parse(candidate);
}

export async function generateStorySegmentation(
  storyText: string,
  progress?: StoryProgress,
): Promise<StorySegmentationResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating narration segments with Gemini 2.5 Pro");
  const prompt = buildSegmentationPrompt(storyText);
  const parts: Part[] = [{ text: prompt }];
  const uploadBytes = estimateUploadBytes(parts);
  const callHandle = adapter.startModelCall({
    modelId: TEXT_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  const startTime = Date.now();

  let aggregated = "";
  let modelVersion: string = TEXT_MODEL_ID;

  try {
    await runGeminiCall(async (client) => {
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
            includeThoughts: true,
            thinkingBudget: 8_192,
          },
        },
      });

      let lastPromptTokens = 0;
      let lastCachedTokens = 0;
      let lastThinkingTokens = 0;
      let lastInferenceTokens = 0;

      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          modelVersion = chunk.modelVersion;
        }
        const candidates = chunk.candidates ?? [];
        for (const candidate of candidates) {
          const contentParts = candidate.content?.parts ?? [];
          for (const part of contentParts) {
            if (part.thought) {
              continue;
            }
            if (part.text) {
              aggregated += part.text;
              adapter.reportChars(part.text.length);
            }
          }
        }
        const usage = chunk.usageMetadata;
        if (usage) {
          const promptTokensNow = usage.promptTokenCount ?? 0;
          const cachedTokensNow = usage.cachedContentTokenCount ?? 0;
          const thinkingTokensNow = usage.thoughtsTokenCount ?? 0;
          const inferenceTokensNow = usage.candidatesTokenCount ?? 0;
          const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
          const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
          const thinkingDelta = Math.max(
            0,
            thinkingTokensNow - lastThinkingTokens,
          );
          const inferenceDelta = Math.max(
            0,
            inferenceTokensNow - lastInferenceTokens,
          );
          if (promptDelta > 0 || cachedDelta > 0 || inferenceDelta > 0) {
            adapter.recordModelUsage(callHandle, {
              promptTokensDelta: promptDelta,
              cachedTokensDelta: cachedDelta > 0 ? cachedDelta : undefined,
              inferenceTokensDelta: inferenceDelta,
              timestamp: Date.now(),
            });
          }
          lastPromptTokens = promptTokensNow;
          lastCachedTokens = cachedTokensNow;
          lastThinkingTokens = thinkingTokensNow;
          lastInferenceTokens = inferenceTokensNow;
        }
      }
    });
  } finally {
    adapter.finishModelCall(callHandle);
  }

  const parsedJson = extractJsonObject(aggregated);
  const segmentation = StorySegmentationSchema.parse(parsedJson);

  const elapsed = formatMillis(Date.now() - startTime);
  adapter.log(`[story/segments] model ${modelVersion} finished in ${elapsed}`);

  return {
    segmentation,
    prompt,
    modelVersion,
  };
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

export async function generateStoryImages(
  segmentation: StorySegmentation,
  progress?: StoryProgress,
): Promise<StoryImagesResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating companion images with Gemini 2.5 Flash Image");

  const prompt = buildImageGenerationPrompt(segmentation);
  const requestParts: Part[] = [{ text: prompt }];
  const uploadBytes = estimateUploadBytes(requestParts);
  const callHandle = adapter.startModelCall({
    modelId: IMAGE_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  const startTime = Date.now();

  const images: GeneratedStoryImage[] = [];
  let aggregatedText = "";
  let modelVersion: string = IMAGE_MODEL_ID;

  try {
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

      let lastPromptTokens = 0;
      let lastCachedTokens = 0;
      let lastThinkingTokens = 0;
      let lastInferenceTokens = 0;

      for await (const chunk of stream) {
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
              const imageIndex = images.length + 1;
              const buffer = Buffer.from(inlineData.data, "base64");
              images.push({
                index: imageIndex,
                mimeType: inlineData.mimeType ?? `image/${ext}`,
                data: buffer,
              });
              continue;
            }
            if (!part.thought && part.text) {
              aggregatedText += part.text;
              adapter.reportChars(part.text.length);
            }
          }
        }

        const usage = chunk.usageMetadata;
        if (usage) {
          const promptTokensNow = usage.promptTokenCount ?? 0;
          const cachedTokensNow = usage.cachedContentTokenCount ?? 0;
          const thinkingTokensNow = usage.thoughtsTokenCount ?? 0;
          const inferenceTokensNow = usage.candidatesTokenCount ?? 0;
          const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
          const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
          const thinkingDelta = Math.max(
            0,
            thinkingTokensNow - lastThinkingTokens,
          );
          const inferenceDelta = Math.max(
            0,
            inferenceTokensNow - lastInferenceTokens,
          );
          if (promptDelta > 0 || cachedDelta > 0 || inferenceDelta > 0) {
            adapter.recordModelUsage(callHandle, {
              promptTokensDelta: promptDelta,
              cachedTokensDelta: cachedDelta > 0 ? cachedDelta : undefined,
              inferenceTokensDelta: inferenceDelta,
              timestamp: Date.now(),
            });
          }
          lastPromptTokens = promptTokensNow;
          lastCachedTokens = cachedTokensNow;
          lastThinkingTokens = thinkingTokensNow;
          lastInferenceTokens = inferenceTokensNow;
        }
      }
    });
  } finally {
    adapter.finishModelCall(callHandle);
  }

  const elapsed = formatMillis(Date.now() - startTime);
  adapter.log(
    `[story/images] model ${modelVersion} generated ${formatInteger(images.length)} illustrations in ${elapsed}`,
  );

  return {
    images,
    prompt,
    modelVersion,
    captions: aggregatedText.trim() || undefined,
  };
}

type GenerateStoryOptions = {
  topic: string;
  userId: string;
  sessionId: string;
  planItemId: string;
  storageBucket: string;
  storagePrefix?: string;
  progress?: StoryProgress;
  audioProgressLabel?: string;
};

export type GenerateStoryResult = {
  title: string;
  story: StoryProseResult;
  segmentation: StorySegmentationResult;
  images: {
    storagePaths: string[];
    modelVersion: string;
  };
  narration: Awaited<ReturnType<typeof synthesizeAndPublishNarration>>;
};

function buildImageStoragePath(
  userId: string,
  sessionId: string,
  planItemId: string,
  index: number,
  extension: string,
  prefix?: string,
): string {
  const folder = prefix
    ? path.join(prefix, userId, "sessions", sessionId, planItemId)
    : path.join("spark", userId, "sessions", sessionId, planItemId);
  return path.join(folder, `image_${String(index).padStart(3, "0")}.${extension}`).replace(/\\/g, "/");
}

function toMediaSegments(
  segmentation: StorySegmentation,
  imagePaths: readonly string[],
): MediaSegment[] {
  if (segmentation.segments.length !== imagePaths.length) {
    throw new Error(
      `Image count ${imagePaths.length} does not match segmentation segments ${segmentation.segments.length}`,
    );
  }

  return segmentation.segments.map((segment, index) => ({
    image: imagePaths[index] ?? "",
    narration: segment.narration.map((line) => ({
      speaker: line.voice.toLowerCase() === "f" ? "f" : "m",
      text: line.text,
    })),
  }));
}

export async function generateStory(
  options: GenerateStoryOptions,
): Promise<GenerateStoryResult> {
  const story = await generateProseStory(options.topic, options.progress);
  const segmentation = await generateStorySegmentation(
    story.text,
    options.progress,
  );
  const images = await generateStoryImages(
    segmentation.segmentation,
    options.progress,
  );

  if (images.images.length !== segmentation.segmentation.segments.length) {
    throw new Error(
      `Expected ${segmentation.segmentation.segments.length} images, received ${images.images.length}`,
    );
  }

  const storage = getFirebaseAdminStorage(undefined, {
    storageBucket: options.storageBucket,
  });
  const bucket = storage.bucket(options.storageBucket);

  const storagePaths: string[] = [];
  for (const image of images.images) {
    const extension = extensionFromMime(image.mimeType);
    const storagePath = buildImageStoragePath(
      options.userId,
      options.sessionId,
      options.planItemId,
      image.index,
      extension,
      options.storagePrefix,
    );
    const file = bucket.file(storagePath);
    await file.save(image.data, {
      resumable: false,
      metadata: {
        contentType: image.mimeType,
        cacheControl: "public, max-age=0",
      },
    });
    const normalised = `/${storagePath.replace(/^\/?/, "")}`;
    storagePaths.push(normalised);
  }

  const segments: MediaSegment[] = toMediaSegments(
    segmentation.segmentation,
    storagePaths,
  );

  const narration = await synthesizeAndPublishNarration({
    userId: options.userId,
    sessionId: options.sessionId,
    planItemId: options.planItemId,
    segments,
    storageBucket: options.storageBucket,
    progress: createConsoleProgress(
      options.audioProgressLabel ?? options.planItemId,
    ),
  });

  return {
    title: segmentation.segmentation.title,
    story,
    segmentation,
    images: {
      storagePaths,
      modelVersion: images.modelVersion,
    },
    narration,
  };
}
