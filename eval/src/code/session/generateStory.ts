import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { Type, type Schema } from "@google/genai";
import { z } from "zod";

import {
  generateImages,
  generateText,
  generateJson,
  type LlmContentPart,
  type LlmImageData,
  type LlmDebugOptions,
} from "../../utils/llm";
import type {
  JobProgressReporter,
  LlmUsageChunk,
} from "../../utils/concurrency";
import { getFirebaseAdminStorage, getFirebaseAdminFirestore } from "@spark/llm";
import type { MediaSegment } from "@spark/llm";
import sharp from "sharp";

import {
  createConsoleProgress,
  synthesizeAndPublishNarration,
} from "./narration";
import { generateStoryFrames } from "./generateFrames";

export const TEXT_MODEL_ID = "gemini-2.5-pro" as const;
export const IMAGE_MODEL_ID = "gemini-2.5-flash-image" as const;

const STORY_FRAME_CATASTROPHIC_DESCRIPTION = [
  "- Wrong medium (e.g. photographic instead of illustrated, monochrome sketches, or heavy text-on-canvas posters).",
  "- Missing the named protagonist when the prompt or narration centres them; environmental cutaways are fine when explicitly requested.",
  "- Obvious content collapse: distorted limbs/faces, unreadable scene, blank or abstract output.",
  "- Layout that breaks requirements: multi-panel compositions, tall/vertical aspect look, or very thick heavy borders.",
  "- Catastrophic continuity break with provided style references.",
].join("\n");

// Legacy constant name preserved; prompt now emphasises a cinematic storyboard illustration style.
export const ART_STYLE_VINTAGE_CARTOON: readonly string[] = [
  "A cinematic, high-quality illustrated storyboard frame with modern graphic-novel energy.",
  "Use expressive lighting, cohesive colour palettes, and period-aware details across the sequence.",
  "Balance the protagonist with supporting context when the narrative calls for it while keeping the key action obvious.",
  "Avoid photorealism, collage looks, thick borders, or multi-panel layouts.",
  "Single scene per image.",
];

export type StoryProgress = JobProgressReporter | undefined;

function useProgress(progress: StoryProgress): JobProgressReporter {
  return {
    log(message: string) {
      if (progress) {
        progress.log(message);
      } else {
        console.log(message);
      }
    },
    startModelCall(details: { modelId: string; uploadBytes: number }) {
      if (progress) {
        return progress.startModelCall(details);
      }
      return Symbol("model-call");
    },
    recordModelUsage(handle: symbol, chunk: LlmUsageChunk) {
      if (progress) {
        progress.recordModelUsage(handle, chunk);
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
  posterPrompt: z.string().trim().min(1),
  // Increase to exactly 10 segments (content-only; style is applied at generation time)
  segments: z.array(StorySegmentSchema).min(10).max(10),
  endingPrompt: z.string().trim().min(1),
});

export type StorySegmentation = z.infer<typeof StorySegmentationSchema>;

export type SegmentationPromptCorrection = {
  promptIndex: number;
  updatedPrompt: string;
  critique: string;
};

const SegmentationCorrectorResponseSchema = z
  .object({
    issuesSummary: z.string().trim().optional(),
    corrections: z
      .array(
        z.object({
          prompt_index: z.number().int().min(0).max(11),
          critique: z.string().trim().min(1),
          updatedPrompt: z.string().trim().min(1),
        }),
      )
      .default([]),
  })
  .transform((data) => ({
    issuesSummary: data.issuesSummary ?? "",
    corrections: data.corrections.map((entry) => ({
      promptIndex: entry.prompt_index,
      critique: entry.critique,
      updatedPrompt: entry.updatedPrompt,
    })),
  }));

type SegmentationCorrectorResponse = z.infer<
  typeof SegmentationCorrectorResponseSchema
>;

const SEGMENTATION_CORRECTOR_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["corrections"],
  propertyOrdering: ["issuesSummary", "corrections"],
  properties: {
    issuesSummary: { type: Type.STRING },
    corrections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["prompt_index", "critique", "updatedPrompt"],
        propertyOrdering: ["prompt_index", "critique", "updatedPrompt"],
        properties: {
          prompt_index: { type: Type.NUMBER, minimum: 0, maximum: 11 },
          critique: { type: Type.STRING, minLength: "1" },
          updatedPrompt: { type: Type.STRING, minLength: "1" },
        },
      },
    },
  },
};

export type StoryProseResult = {
  text: string;
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

export type StoryImageSet = {
  imageSetLabel: "set_a" | "set_b";
  images: GeneratedStoryImage[];
};

export const SerialisedStoryImageSchema = z.object({
  index: z.number().int().min(1),
  mimeType: z.string().trim().min(1),
  data: z.string().trim().min(1),
});

export const SerialisedStoryImageSetSchema = z.object({
  imageSetLabel: z.enum(["set_a", "set_b"]),
  images: z.array(SerialisedStoryImageSchema).min(1),
});

export type SerialisedStoryImage = z.infer<typeof SerialisedStoryImageSchema>;
export type SerialisedStoryImageSet = z.infer<
  typeof SerialisedStoryImageSetSchema
>;

export function serialiseStoryImageSets(
  imageSets: readonly StoryImageSet[],
): SerialisedStoryImageSet[] {
  return imageSets.map((set) => ({
    imageSetLabel: set.imageSetLabel,
    images: set.images.map((image) => ({
      index: image.index,
      mimeType: image.mimeType,
      data: image.data.toString("base64"),
    })),
  }));
}

export function deserialiseStoryImageSets(
  serialised: readonly SerialisedStoryImageSet[],
): StoryImageSet[] {
  return serialised.map((set) => ({
    imageSetLabel: set.imageSetLabel,
    images: set.images.map((image) => ({
      index: image.index,
      mimeType: image.mimeType,
      data: Buffer.from(image.data, "base64"),
    })),
  }));
}

const StoryProseCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

type StoryProseCheckpoint = z.infer<typeof StoryProseCheckpointSchema>;

const StoryImagesCheckpointSchema = z.object({
  prompt: z.string(),
  modelVersion: z.string().trim().min(1),
  captions: z.string().optional(),
  images: z.array(SerialisedStoryImageSchema).min(1),
});

type StoryImagesCheckpoint = z.infer<typeof StoryImagesCheckpointSchema>;

const StoryNarrationCheckpointSchema = z.object({
  storagePaths: z.array(z.string().trim().min(1)).min(1),
  publishResult: z.object({
    storagePath: z.string().trim().min(1),
    documentPath: z.string().trim().min(1),
    durationSec: z.number().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
});

type StoryNarrationCheckpoint = z.infer<typeof StoryNarrationCheckpointSchema>;

export class SegmentationCorrectionError extends Error {
  constructor(
    message: string,
    readonly segmentation: StorySegmentation,
  ) {
    super(message);
    this.name = "SegmentationCorrectionError";
  }
}

const STORY_SEGMENTATION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["title", "posterPrompt", "segments", "endingPrompt"],
  propertyOrdering: ["title", "posterPrompt", "segments", "endingPrompt"],
  properties: {
    title: { type: Type.STRING, minLength: "1" },
    posterPrompt: { type: Type.STRING, minLength: "1" },
    segments: {
      type: Type.ARRAY,
      minItems: "10",
      maxItems: "10",
      items: {
        type: Type.OBJECT,
        required: ["imagePrompt", "narration"],
        propertyOrdering: ["imagePrompt", "narration"],
        properties: {
          imagePrompt: { type: Type.STRING, minLength: "1" },
          narration: {
            type: Type.ARRAY,
            minItems: "1",
            items: {
              type: Type.OBJECT,
              required: ["voice", "text"],
              propertyOrdering: ["voice", "text"],
              properties: {
                voice: { type: Type.STRING, enum: ["M", "F"] },
                text: { type: Type.STRING, minLength: "1" },
              },
            },
          },
        },
      },
    },
    endingPrompt: { type: Type.STRING, minLength: "1" },
  },
};

export function buildStoryPrompt(topic: string): string {
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

export function buildSegmentationPrompt(storyText: string): string {
  // Style requirements are intentionally excluded here. Style gets applied later during image generation.
  return [
    "Convert the provided historical story into a structured narration and illustration plan.",
    "",
    "Requirements:",
    "1. Provide `title`, `posterPrompt`, ten chronological `segments`, and `endingPrompt`.",
    "   This yields 12 total illustration prompts: poster + 10 story beats + ending card.",
    "2. `posterPrompt` introduces the entire story in a single dynamic scene suitable for a cover/poster. It must be stunning, captivating, interesting, and intriguing; and it should mention the name of the protagonist (an important historical figure). If the name is long, prefer a concise form (e.g., first+last name or well-known moniker). Include a bold 2-4 word title and, when it elevates the concept, one short supporting detail such as a date, location, or rallying phrase (each supporting text element under six words).",
    '3. `endingPrompt` is a graceful "The End" card with a minimal motif from the story.',
    "4. For each of the ten `segments`:",
    "   • Provide `narration`, an ordered array of narration slices. Each slice contains `voice` and `text`.",
    "   • Alternate between the `M` and `F` voices whenever the flow allows. Let `M` handle formal or structural beats; let `F` handle emotional or explanatory beats. Avoid repeating the same voice twice in a row unless it preserves clarity. Remove citation markers or reference-style callouts.",
    "   • Provide `imagePrompt`, a clear visual prompt that captures the same moment as the narration slice(s). Focus on subject, action, setting, and lighting cues. Do not include stylistic descriptors (lighting adjectives are fine, but no references to media franchises or rendering engines).",
    "5. Keep each `imagePrompt` drawable as a cinematic single-scene illustration with modern storyboard energy: emphasise the key action, allow supporting characters or environment to share focus when the narration does, and call out expressive lighting. Ground any abstract effects or information (like streams of code or glowing calculations) in a physical source within the scene, and avoid split screens, mirrored halves, perfectly aligned geometry, or overly precise camera directions.",
    '6. Any visible text should stay purposeful: headlines stay within four words, auxiliary elements (dates, mottos, signage) within six words, all period-appropriate. Describing surfaces as "covered in diagrams" or "filled with formulas" is acceptable so long as you do not spell out the actual symbols or equations. Never request dense paragraphs or precise formula strings.',
    "7. Do not expect the characters to hold paper or writing and that text to be legible. Writing on whiteboard, posters on the wall, labels etc is fine. For posters stylized text also works.",
    "8. No formulas or diagrams or tables are requested",
    "9. Ensure the named protagonist appears whenever the narration centres on them; otherwise spotlight the setting, consequences, or supporting cast to keep the beat clear.",
    "",
    "================ Story to segment ================",
    storyText,
    "==================================================",
    "",
    "segmentation prompt:",
    "------------------",
    "Convert the story into alternating-voice narration segments with illustration prompts plus poster and ending prompts, following all rules above.",
  ].join("\n");
}

export async function generateProseStory(
  topic: string,
  progress?: StoryProgress,
  options?: { debugRootDir?: string },
): Promise<StoryProseResult> {
  const adapter = useProgress(progress);
  adapter.log(
    `[story] generating prose with web-search-enabled ${TEXT_MODEL_ID}`,
  );
  const prompt = buildStoryPrompt(topic);
  adapter.log("[story/prose] prompt prepared");
  const text = await generateText({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    tools: [{ type: "web-search" }],
    debug: options?.debugRootDir
      ? { rootDir: options.debugRootDir, stage: "prose" }
      : undefined,
  });

  return { text };
}

const SEGMENTATION_CORRECTION_ATTEMPTS = 3;

function buildSegmentationCorrectorPrompt(
  segmentation: StorySegmentation,
  generationPrompt: string,
): string {
  const lines: string[] = [
    "You are the image prompt corrector for illustrated historical stories.",
    "Assess whether the illustration prompts comply with the brief and rewrite only the prompts that violate the rules.",
    "",
    "Only include entries under `corrections` for prompts that must be updated.",
    "",
    "Check for:",
    "- Each prompt grounds the scene in time and place (decade, location, or workplace details).",
    "- One clear action with focal characters or environment cues, and abstract elements (code, diagrams, light) emerge from a physical source instead of floating freely.",
    '- Poster prompts include a bold 2-4 word title and, when present, supporting text (dates, mottos, locations) under six words, all period-appropriate.',
    '- Other optional writing stays concise and never spells out specific equations; generic phrases like "chalkboard filled with formulas" are acceptable.',
    "- Characters are not expected to hold a paper, book or poster",
    "- No formulas or diagrams or tables are requested",
    "- Ensure the protagonist is present when the narration or prompt centres on them; environmental cutaways are fine when explicitly described.",
    "",
    "===== Segmentation generation brief =====",
    generationPrompt,
    "===== End brief =====",
    "",
    'Indexed prompts (0-9 story panels, 10 = ending card labelled "the end", 11 = poster):',
  ];

  segmentation.segments.forEach((segment, idx) => {
    const promptIndex = idx;
    lines.push(
      `Prompt ${promptIndex} (story panel ${idx + 1}) image prompt: ${segment.imagePrompt}`,
    );
    const narrationSummary = segment.narration
      .map((line) => `${line.voice}: ${line.text}`)
      .join(" | ");
    if (narrationSummary) {
      lines.push(`Prompt ${promptIndex} narration: ${narrationSummary}`);
    }
  });

  const endingIndex = segmentation.segments.length;
  lines.push(
    `Prompt ${endingIndex} ("the end" card) image prompt: ${segmentation.endingPrompt}`,
  );

  const posterIndex = segmentation.segments.length + 1;
  lines.push(
    `Prompt ${posterIndex} (poster) image prompt: ${segmentation.posterPrompt}`,
  );

  return lines.join("\n");
}

function applySegmentationCorrections(
  segmentation: StorySegmentation,
  corrections: readonly SegmentationPromptCorrection[],
): StorySegmentation {
  if (!corrections.length) {
    return segmentation;
  }

  const draft = JSON.parse(JSON.stringify(segmentation)) as StorySegmentation;
  const totalSegments = draft.segments.length;
  const endingIndex = totalSegments;
  const posterIndex = totalSegments + 1;

  corrections.forEach((correction) => {
    const targetIndex = correction.promptIndex;
    const updatedPrompt = correction.updatedPrompt.trim();
    if (!updatedPrompt) {
      throw new Error("Segmentation corrector provided an empty prompt.");
    }
    if (targetIndex >= 0 && targetIndex < totalSegments) {
      draft.segments[targetIndex].imagePrompt = updatedPrompt;
      return;
    }
    if (targetIndex === endingIndex) {
      draft.endingPrompt = updatedPrompt;
      return;
    }
    if (targetIndex === posterIndex) {
      draft.posterPrompt = updatedPrompt;
      return;
    }
    throw new Error(
      `Segmentation corrector returned invalid prompt index ${targetIndex}`,
    );
  });

  return StorySegmentationSchema.parse(draft);
}

export async function generateStorySegmentation(
  storyText: string,
  progress?: StoryProgress,
  options?: {
    debugRootDir?: string;
  },
): Promise<StorySegmentation> {
  const adapter = useProgress(progress);
  adapter.log(`[story] generating narration segments with ${TEXT_MODEL_ID}`);
  const prompt = buildSegmentationPrompt(storyText);
  const segmentation = await generateJson<StorySegmentation>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    responseSchema: STORY_SEGMENTATION_RESPONSE_SCHEMA,
    schema: StorySegmentationSchema,
    debug: options?.debugRootDir
      ? { rootDir: options.debugRootDir, stage: "segmentation" }
      : undefined,
  });
  adapter.log("[story/segments] parsed successfully");
  return segmentation;
}

export async function correctStorySegmentation(
  storyText: string,
  initialSegmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: {
    debugRootDir?: string;
  },
): Promise<StorySegmentation> {
  const adapter = useProgress(progress);
  const generationPrompt = buildSegmentationPrompt(storyText);
  let workingSegmentation = initialSegmentation;
  adapter.log(`[story] reviewing segmentation prompts with ${TEXT_MODEL_ID}`);

  for (
    let attempt = 1;
    attempt <= SEGMENTATION_CORRECTION_ATTEMPTS;
    attempt += 1
  ) {
    const reviewPrompt = buildSegmentationCorrectorPrompt(
      workingSegmentation,
      generationPrompt,
    );
    try {
      const response = await generateJson<SegmentationCorrectorResponse>({
        progress: adapter,
        modelId: TEXT_MODEL_ID,
        contents: [
          {
            role: "user",
            parts: [{ type: "text", text: reviewPrompt }],
          },
        ],
        responseSchema: SEGMENTATION_CORRECTOR_RESPONSE_SCHEMA,
        schema: SegmentationCorrectorResponseSchema,
        debug: options?.debugRootDir
          ? {
              rootDir: options.debugRootDir,
              stage: `segmentation_correction/${String(attempt).padStart(3, "0")}-of-${String(SEGMENTATION_CORRECTION_ATTEMPTS).padStart(3, "0")}`,
            }
          : undefined,
      });

      if (response.issuesSummary) {
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} issues summary: ${response.issuesSummary}`,
        );
      }

      if (response.corrections.length === 0) {
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} returned no corrections`,
        );
        return workingSegmentation;
      }

      try {
        workingSegmentation = applySegmentationCorrections(
          workingSegmentation,
          response.corrections,
        );
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} applied ${response.corrections.length} correction(s)`,
        );
        return workingSegmentation;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} failed to apply corrections (${message}); retrying...`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      adapter.log(
        `[story/segmentation_correction] attempt ${attempt} failed (${message}); retrying...`,
      );
    }
  }

  throw new SegmentationCorrectionError(
    `Segmentation correction failed after ${SEGMENTATION_CORRECTION_ATTEMPTS} attempt(s).`,
    workingSegmentation,
  );
}

const ImageSetJudgeResponseSchema = z.object({
  reasoning: z.string().trim().min(1),
  verdict: z.enum(["set_a", "set_b"]),
});
type ImageSetJudgeResponse = z.infer<typeof ImageSetJudgeResponseSchema>;

const IMAGE_SET_JUDGE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["reasoning", "verdict"],
  propertyOrdering: ["reasoning", "verdict"],
  properties: {
    reasoning: { type: Type.STRING, minLength: "1" },
    verdict: { type: Type.STRING, enum: ["set_a", "set_b"] },
  },
};

type SegmentationImageEntry = {
  index: number;
  prompt: string;
};

type SegmentationImageContext = {
  entries: SegmentationImageEntry[];
  promptsByIndex: Map<number, string>;
  endingIndex: number;
  posterIndex: number;
};

function collectSegmentationImageContext(
  segmentation: StorySegmentation,
): SegmentationImageContext {
  const posterPrompt = segmentation.posterPrompt.trim();
  const endingPrompt = segmentation.endingPrompt.trim();
  if (!posterPrompt) {
    throw new Error("Segmentation did not include a posterPrompt");
  }
  if (!endingPrompt) {
    throw new Error("Segmentation did not include an endingPrompt");
  }

  const entries: SegmentationImageEntry[] = [];
  const promptsByIndex = new Map<number, string>();

  for (let i = 0; i < segmentation.segments.length; i++) {
    const segment = segmentation.segments[i];
    if (!segment) {
      throw new Error(`Segmentation segment ${i + 1} is missing data`);
    }
    const segmentPrompt = segment.imagePrompt.trim();
    if (!segmentPrompt) {
      throw new Error(
        `Segmentation segment ${i + 1} is missing an imagePrompt`,
      );
    }
    const index = i + 1;
    entries.push({ index, prompt: segmentPrompt });
    promptsByIndex.set(index, segmentPrompt);
  }

  const endingIndex = segmentation.segments.length + 1;
  entries.push({ index: endingIndex, prompt: endingPrompt });
  promptsByIndex.set(endingIndex, endingPrompt);

  const posterIndex = segmentation.segments.length + 2;
  entries.push({ index: posterIndex, prompt: posterPrompt });
  promptsByIndex.set(posterIndex, posterPrompt);

  return {
    entries,
    promptsByIndex,
    endingIndex,
    posterIndex,
  };
}

type SingleImageGenerationOptions = {
  prompt: string;
  stylePrompt: string;
  styleImages?: readonly LlmImageData[];
  maxAttempts?: number;
  imageAspectRatio?: string;
  progress: JobProgressReporter;
  modelId: typeof IMAGE_MODEL_ID;
  debug?: LlmDebugOptions;
};

async function generateSingleImage(
  options: SingleImageGenerationOptions,
): Promise<LlmImageData> {
  const trimmedPrompt = options.prompt.trim();
  if (!trimmedPrompt) {
    throw new Error("Single image prompt must be a non-empty string");
  }
  const parts = await generateImages({
    progress: options.progress,
    modelId: options.modelId,
    stylePrompt: options.stylePrompt,
    styleImages: options.styleImages,
    imagePrompts: [trimmedPrompt],
    maxAttempts: options.maxAttempts ?? 4,
    imageAspectRatio: options.imageAspectRatio,
    debug: options.debug,
  });
  const image = parts[0];
  if (!image) {
    throw new Error("Single image generation returned no image data");
  }
  return image;
}

type PosterCandidate = {
  candidateIndex: number;
  image: LlmImageData;
};

type PosterCatastrophicFinding = {
  candidateIndex: number;
  reason: string;
};

type PosterSelection = {
  winnerCandidateIndex: number;
  reasoning: string;
  catastrophicFindings: PosterCatastrophicFinding[];
};

const PosterSelectionSchema = z
  .object({
    winner_index: z.number().int().min(1),
    reasoning: z.string().trim().min(1),
    catastrophic_candidates: z
      .array(
        z.object({
          index: z.number().int().min(1),
          reason: z.string().trim().min(1),
        }),
      )
      .default([]),
  })
  .transform((raw) => ({
    winnerCandidateIndex: raw.winner_index,
    reasoning: raw.reasoning,
    catastrophicFindings: raw.catastrophic_candidates.map((entry) => ({
      candidateIndex: entry.index,
      reason: entry.reason,
    })),
  }));

type PosterSelectionResponse = z.infer<typeof PosterSelectionSchema>;

const POSTER_SELECTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["reasoning", "winner_index"],
  propertyOrdering: ["reasoning", "catastrophic_candidates", "winner_index"],
  properties: {
    reasoning: { type: Type.STRING, minLength: "1" },
    catastrophic_candidates: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["index", "reason"],
        propertyOrdering: ["index", "reason"],
        properties: {
          index: { type: Type.NUMBER, minimum: 1 },
          reason: { type: Type.STRING, minLength: "1" },
        },
      },
    },
    winner_index: { type: Type.NUMBER, minimum: 1 },
  },
};

async function selectPosterCandidate(options: {
  prompt: string;
  stylePrompt: string;
  styleReferences: readonly LlmImageData[];
  candidates: readonly PosterCandidate[];
  catastrophicDescription: string;
  progress: JobProgressReporter;
  gradingModelId: typeof TEXT_MODEL_ID;
  debug?: LlmDebugOptions;
}): Promise<PosterSelection> {
  if (options.candidates.length === 0) {
    throw new Error("Poster selection requires at least one candidate image");
  }

  const headerLines: string[] = [
    "You are selecting the best poster illustration candidate for a cinematic illustrated historical story.",
    "The winning candidate must be the most stunning, engaging, and attractive option that faithfully follows the protagonist references.",
    "Respect the prompt's typography guidance: a bold 2-4 word title and, when present, one concise supporting detail such as a date or location (each supporting element under six words).",
    "Disqualify any candidate with catastrophic failures such as extra limbs, missing faces, severe distortions, or the wrong medium.",
    "",
    `Original poster prompt:\n${options.prompt}`,
    "",
    "Style guidance:",
    options.stylePrompt,
    "",
    "Catastrophic checklist:",
    options.catastrophicDescription,
  ];

  const parts: LlmContentPart[] = [
    { type: "text", text: headerLines.join("\n") },
  ];

  if (options.styleReferences.length > 0) {
    parts.push({
      type: "text",
      text: "\nStyle reference images (ensure protagonist continuity and palette):",
    });
    for (const reference of options.styleReferences) {
      parts.push({
        type: "inlineData",
        data: reference.data.toString("base64"),
        mimeType: reference.mimeType ?? "image/png",
      });
    }
  }

  for (const candidate of options.candidates) {
    parts.push({
      type: "text",
      text: `\nCandidate ${candidate.candidateIndex} for prompt: ${options.prompt}`,
    });
    parts.push({
      type: "inlineData",
      data: candidate.image.data.toString("base64"),
      mimeType: candidate.image.mimeType ?? "image/png",
    });
  }

  parts.push({
    type: "text",
    text: [
      "",
      "Evaluate every candidate. If a candidate is catastrophic, list it under `catastrophic_candidates` with a short reason.",
      "Pick the most stunning acceptable candidate. If every option is flawed, choose the least harmful image but clearly explain all issues.",
      "Respond in JSON following the provided schema with `winner_index`, `reasoning`, and optional `catastrophic_candidates`.",
    ].join("\n"),
  });

  const response = await generateJson<PosterSelectionResponse>({
    progress: options.progress,
    modelId: options.gradingModelId,
    contents: [{ role: "user", parts }],
    schema: PosterSelectionSchema,
    responseSchema: POSTER_SELECTION_RESPONSE_SCHEMA,
    debug: options.debug,
  });

  return response;
}

export async function generateImageSets(
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: { debugRootDir?: string },
): Promise<StoryImageSet[]> {
  const adapter = useProgress(progress);
  const { entries, endingIndex, posterIndex } =
    collectSegmentationImageContext(segmentation);
  const styleLines = ART_STYLE_VINTAGE_CARTOON;
  const stylePrompt = styleLines.join("\n");
  const baseDebug: LlmDebugOptions | undefined = options?.debugRootDir
    ? { rootDir: options.debugRootDir, stage: "image-sets" }
    : undefined;
  const buildDebug = (subStage: string): LlmDebugOptions | undefined => {
    if (!baseDebug) {
      return undefined;
    }
    const cleaned = subStage
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .join("/");
    return {
      ...baseDebug,
      subStage: cleaned,
    };
  };
  const posterEntry = entries.find((entry) => entry.index === posterIndex);
  const endingEntry = entries.find((entry) => entry.index === endingIndex);
  if (!posterEntry) {
    throw new Error(
      `Segmentation image context is missing the poster entry (index ${posterIndex})`,
    );
  }
  if (!endingEntry) {
    throw new Error(
      `Segmentation image context is missing the ending entry (index ${endingIndex})`,
    );
  }
  const panelEntries = entries
    .filter(
      (entry) => entry.index !== posterIndex && entry.index !== endingIndex,
    )
    .sort((a, b) => a.index - b.index);

  const runImageSet = async (
    imageSetLabel: "set_a" | "set_b",
  ): Promise<StoryImageSet> => {
    adapter.log(
      `[story/image-sets/${imageSetLabel}] generating main frames (${panelEntries.length} prompts)`,
    );
    const mainImageParts = await generateStoryFrames({
      progress: adapter,
      imageModelId: IMAGE_MODEL_ID,
      gradingModelId: TEXT_MODEL_ID,
      stylePrompt,
      imagePrompts: panelEntries.map((entry) => entry.prompt),
      batchSize: 5,
      overlapSize: 3,
      gradeCatastrophicDescription: STORY_FRAME_CATASTROPHIC_DESCRIPTION,
      imageAspectRatio: "16:9",
      debug: buildDebug(`${imageSetLabel}/main`),
    });

    const imagesByIndex = new Map<number, GeneratedStoryImage>();
    for (let index = 0; index < panelEntries.length; index += 1) {
      const entry = panelEntries[index];
      const part = mainImageParts[index];
      if (!part) {
        continue;
      }
      imagesByIndex.set(entry.index, {
        index: entry.index,
        mimeType: part.mimeType ?? "image/png",
        data: part.data,
      });
      adapter.log(
        `[story/image-sets/${imageSetLabel}] received image ${entry.index} (${part.data.length} bytes)`,
      );
    }

    const posterReferences = mainImageParts.slice(0, 4);
    adapter.log(
      `[story/image-sets/${imageSetLabel}] generating poster candidates (4 variants)`,
    );
    const posterCandidatePromises = Array.from({ length: 4 }).map(
      async (_, offset) => {
        const candidateIndex = offset + 1;
        const image = await generateSingleImage({
          progress: adapter,
          modelId: IMAGE_MODEL_ID,
          stylePrompt,
          styleImages: posterReferences,
          prompt: posterEntry.prompt,
          maxAttempts: 4,
          imageAspectRatio: "16:9",
          debug: buildDebug(
            `${imageSetLabel}/poster/candidate_${candidateIndex}`,
          ),
        });
        adapter.log(
          `[story/image-sets/${imageSetLabel}] poster candidate ${candidateIndex} (${image.data.length} bytes)`,
        );
        return { candidateIndex, image };
      },
    );
    const posterCandidates = await Promise.all(posterCandidatePromises);
    const posterSelection = await selectPosterCandidate({
      prompt: posterEntry.prompt,
      stylePrompt,
      styleReferences: posterReferences,
      candidates: posterCandidates,
      catastrophicDescription: STORY_FRAME_CATASTROPHIC_DESCRIPTION,
      progress: adapter,
      gradingModelId: TEXT_MODEL_ID,
      debug: buildDebug(`${imageSetLabel}/poster/select`),
    });
    const winningPoster = posterCandidates.find(
      (candidate) =>
        candidate.candidateIndex === posterSelection.winnerCandidateIndex,
    );
    if (!winningPoster) {
      throw new Error(
        `Poster selection returned candidate ${posterSelection.winnerCandidateIndex}, but no matching image was generated`,
      );
    }
    imagesByIndex.set(posterIndex, {
      index: posterIndex,
      mimeType: winningPoster.image.mimeType ?? "image/png",
      data: winningPoster.image.data,
    });
    adapter.log(
      `[story/image-sets/${imageSetLabel}] selected poster candidate ${posterSelection.winnerCandidateIndex} – ${posterSelection.reasoning}`,
    );
    for (const finding of posterSelection.catastrophicFindings) {
      adapter.log(
        `[story/image-sets/${imageSetLabel}] poster candidate ${finding.candidateIndex} flagged as catastrophic: ${finding.reason}`,
      );
    }

    const endingReferences = mainImageParts.slice(
      Math.max(mainImageParts.length - 4, 0),
    );
    adapter.log(`[story/image-sets/${imageSetLabel}] generating end card`);
    const endingPart = await generateSingleImage({
      progress: adapter,
      modelId: IMAGE_MODEL_ID,
      stylePrompt,
      styleImages: endingReferences,
      prompt: endingEntry.prompt,
      maxAttempts: 4,
      imageAspectRatio: "16:9",
      debug: buildDebug(`${imageSetLabel}/ending`),
    });
    imagesByIndex.set(endingIndex, {
      index: endingIndex,
      mimeType: endingPart.mimeType ?? "image/png",
      data: endingPart.data,
    });
    adapter.log(
      `[story/image-sets/${imageSetLabel}] received ending image ${endingIndex} (${endingPart.data.length} bytes)`,
    );

    const orderedImages: GeneratedStoryImage[] = [];
    const appendImageIfPresent = (targetIndex: number) => {
      const image = imagesByIndex.get(targetIndex);
      if (image) {
        orderedImages.push(image);
      }
    };

    appendImageIfPresent(posterIndex);
    for (const entry of panelEntries) {
      appendImageIfPresent(entry.index);
    }
    appendImageIfPresent(endingIndex);

    return {
      imageSetLabel,
      images: orderedImages,
    };
  };

  const setA = await runImageSet("set_a");
  const setB = await runImageSet("set_b");
  return [setA, setB];
  // TODO: restore parallel generation: return Promise.all([runImageSet("set_a"), runImageSet("set_b")]);
}

export async function judgeImageSets(
  imageSets: readonly StoryImageSet[],
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: { debugRootDir?: string },
): Promise<{
  winningImageSetLabel: "set_a" | "set_b";
}> {
  const adapter = useProgress(progress);
  const { promptsByIndex } = collectSegmentationImageContext(segmentation);
  const setA = imageSets.find((set) => set.imageSetLabel === "set_a");
  const setB = imageSets.find((set) => set.imageSetLabel === "set_b");
  if (!setA || !setB) {
    throw new Error("Both set_a and set_b must be provided for judging");
  }

  const headerLines: string[] = [
    "You are the image quality judge for illustrated historical stories.",
    'Two complete illustration sets are provided: Set A and Set B. Each contains 12 images covering story panels 1-10, a "the end" card, and a poster.',
    "Evaluate which set better satisfies the prompts and style requirements.",
    "Criteria: prompt fidelity, cinematic single-scene composition, grounded historical setting, expressive yet cohesive style, and strong character continuity.",
    "Typography check: poster titles stay bold (2-4 words) with optional supporting detail (dates, locations, mottos) under six words; any other visible text remains concise, spelled correctly, and period-appropriate.",
    "Make sure that the images do not carry wrong meaning, e.g. the poster should NOT say 'The End' and similar obviously wrong artefacts.",
    "Confirm the protagonist appears whenever the narration centres on them; environmental or consequence-focused frames are acceptable when explicitly prompted.",
  ];

  const parts: LlmContentPart[] = [
    { type: "text", text: headerLines.join("\n") },
  ];
  const addSet = (set: StoryImageSet) => {
    const name = set.imageSetLabel === "set_a" ? "Set A" : "Set B";
    parts.push({ type: "text", text: `${name} illustrations follow.` });
    const sorted = [...set.images].sort((a, b) => a.index - b.index);
    for (const image of sorted) {
      const prompt = promptsByIndex.get(image.index) ?? "";
      parts.push({
        type: "text",
        text: `${name} – Image ${image.index} prompt: ${prompt}`,
      });
      parts.push({
        type: "inlineData",
        mimeType: image.mimeType,
        data: image.data.toString("base64"),
      });
    }
  };
  addSet(setA);
  addSet(setB);
  parts.push({
    type: "text",
    text: "Compare Set A and Set B. Provide the reasoning first, then the verdict.",
  });

  adapter.log(`[story/images-judge] set comparison request prepared`);

  const response = await generateJson<ImageSetJudgeResponse>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts }],
    responseSchema: IMAGE_SET_JUDGE_RESPONSE_SCHEMA,
    schema: ImageSetJudgeResponseSchema,
    debug: options?.debugRootDir
      ? { rootDir: options.debugRootDir, stage: "images-judge" }
      : undefined,
  });
  const serialised = JSON.stringify(response, null, 2);
  adapter.log(`[story/images-judge] parsed response: ${serialised}`);
  return {
    winningImageSetLabel: response.verdict,
  };
}

export async function generateStoryImages(
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: { debugRootDir?: string },
): Promise<StoryImagesResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating 12 images via dual-set comparison workflow");

  const { entries, promptsByIndex } =
    collectSegmentationImageContext(segmentation);
  const styleLines = ART_STYLE_VINTAGE_CARTOON;

  const imageSets = await generateImageSets(segmentation, adapter, options);
  const judge = await judgeImageSets(imageSets, segmentation, adapter, options);
  const winner = imageSets.find(
    (set) => set.imageSetLabel === judge.winningImageSetLabel,
  );
  if (!winner) {
    throw new Error(
      `Winning image set ${judge.winningImageSetLabel} not found in generated sets`,
    );
  }

  const snapshotLines: string[] = ["Style Requirements:", ...styleLines, ""];
  const maxIndex = Math.max(...entries.map((e) => e.index));
  for (let i = 1; i <= maxIndex; i++) {
    snapshotLines.push(`Image ${i}: ${promptsByIndex.get(i)}`);
  }

  return {
    images: winner.images.sort((a, b) => a.index - b.index),
    prompt: snapshotLines.join("\n"),
    modelVersion: IMAGE_MODEL_ID,
    captions: undefined,
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
  debugRootDir?: string;
  checkpointDir?: string;
};

export type GenerateStoryResult = {
  title: string;
  story: StoryProseResult;
  segmentation: StorySegmentation;
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
  return path
    .join(folder, `image_${String(index).padStart(3, "0")}.${extension}`)
    .replace(/\\/g, "/");
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

export type StoryGenerationStageName =
  | "prose"
  | "segmentation"
  | "segmentation_correction"
  | "images"
  | "narration";

const STORY_STAGE_ORDER: readonly StoryGenerationStageName[] = [
  "prose",
  "segmentation",
  "segmentation_correction",
  "images",
  "narration",
];

type StoryGenerationPipelineOptions = {
  topic: string;
  userId?: string;
  sessionId?: string;
  planItemId?: string;
  storageBucket?: string;
  storagePrefix?: string;
  progress?: StoryProgress;
  audioProgressLabel?: string;
  debugRootDir?: string;
  checkpointDir?: string;
};

type StageCacheEntry<TValue> = {
  value: TValue;
  source: "checkpoint" | "generated";
  checkpointPath?: string;
};

type NarrationStageValue = {
  publishResult: Awaited<ReturnType<typeof synthesizeAndPublishNarration>>;
  storagePaths: string[];
};

type StageReadResult<TValue> = {
  value: TValue;
  filePath: string;
};

function isEnoent(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}

function normaliseStoragePath(raw: string): string {
  const withForwardSlashes = raw.replace(/\\/g, "/");
  const trimmed = withForwardSlashes.replace(/^\/+/u, "");
  return `/${trimmed}`;
}

export class StoryGenerationPipeline {
  private readonly caches: {
    prose?: StageCacheEntry<StoryProseResult>;
    segmentation?: StageCacheEntry<StorySegmentation>;
    segmentationCorrection?: StageCacheEntry<StorySegmentation>;
    images?: StageCacheEntry<StoryImagesResult>;
    narration?: StageCacheEntry<NarrationStageValue>;
  } = {};

  private readonly logger: JobProgressReporter;

  constructor(private readonly options: StoryGenerationPipelineOptions) {
    this.logger = useProgress(options.progress);
  }

  private get checkpointDir(): string | undefined {
    return this.options.checkpointDir;
  }

  private stageFile(stage: StoryGenerationStageName): string | undefined {
    if (!this.checkpointDir) {
      return undefined;
    }
    return path.join(this.checkpointDir, `${stage}.json`);
  }

  private async readProseCheckpoint(): Promise<
    StageReadResult<StoryProseResult> | undefined
  > {
    const filePath = this.stageFile("prose");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const checkpoint = StoryProseCheckpointSchema.parse(parsed);
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      return { value: { text: checkpoint.text }, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProseCheckpoint(
    value: StoryProseResult,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("prose");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryProseCheckpoint = {
      topic: this.options.topic,
      text: value.text,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readSegmentationCheckpoint(): Promise<
    StageReadResult<StorySegmentation> | undefined
  > {
    const filePath = this.stageFile("segmentation");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const segmentation = StorySegmentationSchema.parse(parsed);
      return { value: segmentation, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeSegmentationCheckpoint(
    value: StorySegmentation,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("segmentation");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(value, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readCorrectedSegmentationCheckpoint(): Promise<
    StageReadResult<StorySegmentation> | undefined
  > {
    const filePath = this.stageFile("segmentation_correction");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const segmentation = StorySegmentationSchema.parse(parsed);
      return { value: segmentation, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeCorrectedSegmentationCheckpoint(
    value: StorySegmentation,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("segmentation_correction");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(value, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readImagesCheckpoint(): Promise<
    StageReadResult<StoryImagesResult> | undefined
  > {
    const filePath = this.stageFile("images");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const checkpoint = StoryImagesCheckpointSchema.parse(parsed);
      const deserialised: StoryImagesResult = {
        prompt: checkpoint.prompt,
        modelVersion: checkpoint.modelVersion,
        captions: checkpoint.captions,
        images: checkpoint.images.map((image) => ({
          index: image.index,
          mimeType: image.mimeType,
          data: Buffer.from(image.data, "base64"),
        })),
      };
      return { value: deserialised, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeImagesCheckpoint(
    value: StoryImagesResult,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("images");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryImagesCheckpoint = {
      prompt: value.prompt,
      modelVersion: value.modelVersion,
      captions: value.captions,
      images: value.images.map((image) => ({
        index: image.index,
        mimeType: image.mimeType,
        data: image.data.toString("base64"),
      })),
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readNarrationCheckpoint(): Promise<
    StageReadResult<NarrationStageValue> | undefined
  > {
    const filePath = this.stageFile("narration");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const checkpoint = StoryNarrationCheckpointSchema.parse(parsed);
      const value: NarrationStageValue = {
        storagePaths: checkpoint.storagePaths.map((storagePath) =>
          normaliseStoragePath(storagePath),
        ),
        publishResult: checkpoint.publishResult,
      };
      return { value, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeNarrationCheckpoint(
    value: NarrationStageValue,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("narration");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryNarrationCheckpoint = {
      storagePaths: value.storagePaths.map((storagePath) =>
        normaliseStoragePath(storagePath),
      ),
      publishResult: value.publishResult,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async invalidateAfter(
    stage: StoryGenerationStageName,
  ): Promise<void> {
    const stageIndex = STORY_STAGE_ORDER.indexOf(stage);
    if (stageIndex === -1) {
      return;
    }
    const downstreamStages = STORY_STAGE_ORDER.slice(stageIndex + 1);
    if (downstreamStages.length === 0) {
      return;
    }
    for (const downstream of downstreamStages) {
      this.clearStageCache(downstream);
      const filePath = this.stageFile(downstream);
      if (filePath) {
        await rm(filePath, { force: true });
      }
    }
  }

  private clearStageCache(stage: StoryGenerationStageName): void {
    switch (stage) {
      case "prose": {
        this.caches.prose = undefined;
        break;
      }
      case "segmentation": {
        this.caches.segmentation = undefined;
        break;
      }
      case "segmentation_correction": {
        this.caches.segmentationCorrection = undefined;
        break;
      }
      case "images": {
        this.caches.images = undefined;
        break;
      }
      case "narration": {
        this.caches.narration = undefined;
        break;
      }
      default: {
        const exhaustiveCheck: never = stage;
        throw new Error(`Unknown stage: ${exhaustiveCheck}`);
      }
    }
  }

  private requireContext(
    key: "userId" | "sessionId" | "planItemId" | "storageBucket",
  ): string {
    const value = this.options[key];
    if (!value) {
      throw new Error(
        `Story generation stage '${key}' requires ${key} to be provided.`,
      );
    }
    return value;
  }

  async ensureProse(): Promise<StageCacheEntry<StoryProseResult>> {
    if (this.caches.prose) {
      return this.caches.prose;
    }
    const checkpoint = await this.readProseCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StoryProseResult> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.prose = entry;
      this.logger.log(
        `[story/checkpoint] restored 'prose' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("prose");
    const story = await generateProseStory(
      this.options.topic,
      this.options.progress,
      {
        debugRootDir: this.options.debugRootDir,
      },
    );
    const checkpointPath = await this.writeProseCheckpoint(story);
    const entry: StageCacheEntry<StoryProseResult> = {
      value: story,
      source: "generated",
      checkpointPath,
    };
    this.caches.prose = entry;
    if (checkpointPath) {
      this.logger.log(`[story/checkpoint] wrote 'prose' to ${checkpointPath}`);
    }
    return entry;
  }

  async ensureSegmentation(): Promise<StageCacheEntry<StorySegmentation>> {
    if (this.caches.segmentation) {
      return this.caches.segmentation;
    }
    const checkpoint = await this.readSegmentationCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StorySegmentation> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.segmentation = entry;
      this.logger.log(
        `[story/checkpoint] restored 'segmentation' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("segmentation");
    const { value: prose } = await this.ensureProse();
    const segmentation = await generateStorySegmentation(
      prose.text,
      this.options.progress,
      {
        debugRootDir: this.options.debugRootDir,
      },
    );
    const checkpointPath = await this.writeSegmentationCheckpoint(segmentation);
    const entry: StageCacheEntry<StorySegmentation> = {
      value: segmentation,
      source: "generated",
      checkpointPath,
    };
    this.caches.segmentation = entry;
    if (checkpointPath) {
      this.logger.log(
        `[story/checkpoint] wrote 'segmentation' to ${checkpointPath}`,
      );
    }
    return entry;
  }

  async ensureSegmentationCorrection(): Promise<
    StageCacheEntry<StorySegmentation>
  > {
    if (this.caches.segmentationCorrection) {
      return this.caches.segmentationCorrection;
    }
    const checkpoint = await this.readCorrectedSegmentationCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StorySegmentation> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.segmentationCorrection = entry;
      this.logger.log(
        `[story/checkpoint] restored 'segmentation_correction' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("segmentation_correction");
    const { value: prose } = await this.ensureProse();
    const { value: draft } = await this.ensureSegmentation();
    const corrected = await correctStorySegmentation(
      prose.text,
      draft,
      this.options.progress,
      {
        debugRootDir: this.options.debugRootDir,
      },
    );
    const checkpointPath =
      await this.writeCorrectedSegmentationCheckpoint(corrected);
    const entry: StageCacheEntry<StorySegmentation> = {
      value: corrected,
      source: "generated",
      checkpointPath,
    };
    this.caches.segmentationCorrection = entry;
    if (checkpointPath) {
      this.logger.log(
        `[story/checkpoint] wrote 'segmentation_correction' to ${checkpointPath}`,
      );
    }
    return entry;
  }

  async ensureImages(): Promise<StageCacheEntry<StoryImagesResult>> {
    if (this.caches.images) {
      return this.caches.images;
    }
    const checkpoint = await this.readImagesCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StoryImagesResult> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.images = entry;
      this.logger.log(
        `[story/checkpoint] restored 'images' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("images");
    const { value: segmentation } = await this.ensureSegmentationCorrection();
    const images = await generateStoryImages(
      segmentation,
      this.options.progress,
      { debugRootDir: this.options.debugRootDir },
    );
    const checkpointPath = await this.writeImagesCheckpoint(images);
    const entry: StageCacheEntry<StoryImagesResult> = {
      value: images,
      source: "generated",
      checkpointPath,
    };
    this.caches.images = entry;
    if (checkpointPath) {
      this.logger.log(`[story/checkpoint] wrote 'images' to ${checkpointPath}`);
    }
    return entry;
  }

  async ensureNarration(): Promise<StageCacheEntry<NarrationStageValue>> {
    if (this.caches.narration) {
      return this.caches.narration;
    }
    const checkpoint = await this.readNarrationCheckpoint();
    let restoredCheckpointPath: string | undefined;
    if (checkpoint) {
      restoredCheckpointPath = checkpoint.filePath;
      this.logger.log(
        `[story/checkpoint] restored 'narration' from ${checkpoint.filePath}`,
      );
      const cachedPath =
        checkpoint.value.publishResult?.documentPath ?? "unknown";
      this.logger.log(
        `[story/narration] republishing using cached media references at ${cachedPath}`,
      );
    }

    const { value: segmentation } = await this.ensureSegmentationCorrection();
    const { value: images } = await this.ensureImages();
    const userId = this.requireContext("userId");
    const sessionId = this.requireContext("sessionId");
    const planItemId = this.requireContext("planItemId");
    const storageBucket = this.requireContext("storageBucket");

    const interiorImages = images.images
      .filter((image) => image.index >= 1)
      .filter((image) => image.index <= segmentation.segments.length)
      .sort((a, b) => a.index - b.index);

    if (interiorImages.length !== segmentation.segments.length) {
      throw new Error(
        `Expected ${segmentation.segments.length} interior images, found ${interiorImages.length}`,
      );
    }

    const storage = getFirebaseAdminStorage(undefined, {
      storageBucket,
    });
    const bucket = storage.bucket(storageBucket);

    const totalImages = interiorImages.length;
    const uploadConcurrency = Math.min(8, totalImages);
    this.logger.log(
      `[story/images] uploading ${totalImages} images with concurrency ${uploadConcurrency}`,
    );
    const storagePaths: string[] = new Array(totalImages);

    let nextImageIndex = 0;
    const uploadWorker = async (workerId: number): Promise<void> => {
      // Sequentially claim the next image index; JavaScript's single-threaded model keeps this safe.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const currentIndex = nextImageIndex;
        nextImageIndex += 1;
        if (currentIndex >= totalImages) {
          return;
        }
        const image = interiorImages[currentIndex];
        const jpegBuffer = await sharp(image.data)
          .jpeg({
            quality: 92,
            progressive: true,
            chromaSubsampling: "4:4:4",
          })
          .toBuffer();
        const storagePath = buildImageStoragePath(
          userId,
          sessionId,
          planItemId,
          currentIndex + 1,
          "jpg",
          this.options.storagePrefix,
        );
        const file = bucket.file(storagePath);
        await file.save(jpegBuffer, {
          resumable: false,
          metadata: {
            contentType: "image/jpeg",
            cacheControl: "public, max-age=0",
          },
        });
        storagePaths[currentIndex] = normaliseStoragePath(storagePath);
        this.logger.log(
          `[story/images] worker ${workerId + 1}/${uploadConcurrency} saved image ${currentIndex + 1}/${totalImages} to /${storagePath}`,
        );
      }
    };

    await Promise.all(
      Array.from({ length: uploadConcurrency }, (_, workerId) =>
        uploadWorker(workerId),
      ),
    );

    const segments = toMediaSegments(segmentation, storagePaths);
    const narrationProgressLabel =
      this.options.audioProgressLabel ?? planItemId;
    const cachedPublishResult = checkpoint?.value.publishResult;

    if (cachedPublishResult) {
      const firestore = getFirebaseAdminFirestore();
      const docRef = firestore.doc(cachedPublishResult.documentPath);
      const docSnapshot = await docRef.get();
      if (docSnapshot.exists) {
        this.logger.log(
          `[story/narration] reusing existing narration audio at ${cachedPublishResult.storagePath}; skipping synthesis`,
        );
        const stageValue: NarrationStageValue = {
          publishResult: cachedPublishResult,
          storagePaths,
        };
        const checkpointPath = await this.writeNarrationCheckpoint(stageValue);
        const entry: StageCacheEntry<NarrationStageValue> = {
          value: stageValue,
          source: "checkpoint",
          checkpointPath,
        };
        this.caches.narration = entry;
        if (checkpointPath) {
          this.logger.log(
            `[story/checkpoint] wrote 'narration' to ${checkpointPath}`,
          );
        }
        return entry;
      }
      this.logger.log(
        `[story/narration] cached media document ${cachedPublishResult.documentPath} missing; regenerating audio`,
      );
    }

    this.logger.log(
      `[story/narration] publishing ${segments.length} segments to storage bucket ${storageBucket}`,
    );
    const publishResult = await synthesizeAndPublishNarration({
      userId,
      sessionId,
      planItemId,
      segments,
      storageBucket,
      progress: createConsoleProgress(narrationProgressLabel),
    });

    const stageValue: NarrationStageValue = {
      publishResult,
      storagePaths,
    };
    const checkpointPath = await this.writeNarrationCheckpoint(stageValue);
    const entry: StageCacheEntry<NarrationStageValue> = {
      value: stageValue,
      source: restoredCheckpointPath ? "checkpoint" : "generated",
      checkpointPath,
    };
    this.caches.narration = entry;
    if (checkpointPath) {
      this.logger.log(
        `[story/checkpoint] wrote 'narration' to ${checkpointPath}`,
      );
    }
    this.logger.log(
      `[story/narration] ensured media doc ${stageValue.publishResult.documentPath}`,
    );
    return entry;
  }
}

export async function generateStory(
  options: GenerateStoryOptions,
): Promise<GenerateStoryResult> {
  const pipeline = new StoryGenerationPipeline({
    topic: options.topic,
    userId: options.userId,
    sessionId: options.sessionId,
    planItemId: options.planItemId,
    storageBucket: options.storageBucket,
    storagePrefix: options.storagePrefix,
    progress: options.progress,
    audioProgressLabel: options.audioProgressLabel,
    debugRootDir: options.debugRootDir,
    checkpointDir: options.checkpointDir,
  });

  const { value: story } = await pipeline.ensureProse();
  await pipeline.ensureSegmentation();
  const { value: segmentation } = await pipeline.ensureSegmentationCorrection();
  const { value: images } = await pipeline.ensureImages();
  const { value: narration } = await pipeline.ensureNarration();

  return {
    title: segmentation.title,
    story,
    segmentation,
    images: {
      storagePaths: narration.storagePaths,
      modelVersion: images.modelVersion,
    },
    narration: narration.publishResult,
  };
}
