import { Buffer } from "node:buffer";
import path from "node:path";

import type { Part } from "@google/genai";
import { z, type ZodIssue } from "zod";

import { runGeminiCall, type GeminiModelId } from "@spark/llm/utils/gemini";
import { estimateUploadBytes, sanitisePartForLogging } from "../../utils/llm";
import { formatInteger, formatMillis } from "../../utils/format";
import type { JobProgressReporter } from "../../utils/concurrency";
import { getFirebaseAdminStorage } from "@spark/llm";
import type { MediaSegment } from "@spark/llm";
import sharp from "sharp";

import {
  createConsoleProgress,
  synthesizeAndPublishNarration,
} from "./narration";

export const DEFAULT_TOPIC = "xor bitwise operations" as const;
export const TEXT_MODEL_ID = "gemini-2.5-pro" as const;
export const IMAGE_MODEL_ID = "gemini-2.5-flash-image" as const;

// Artwork style (extracted from segmentation and applied at image-generation time)
// NOTE: We keep this as an array to make it easy to render as top-of-prompt lines.
export const ART_STYLE_VINTAGE_CARTOON: readonly string[] = [
  "Craft prompts to evoke a vintage, mid-century cartoon illustration style. Describe the style through its core components:",
  "",
  "*   **Characters:** Design appealing, stylized characters with simple, expressive features reminiscent of classic 1950s comics. Faces should be defined by clean lines and communicate emotion clearly without complex detail.",
  "*   **Line Art:** All elements should be defined by clear, black ink outlines. The line weight should be consistent but with subtle imperfections, giving it a warm, hand-drawn feel rather than a perfect vector look.",
  "*   **Color & Shading:** Use a muted, retro color palette with earthy tones like ochre, beige, and desaturated blues and greens. Shading should be simple, using flat color washes or subtle cross-hatching textures, avoiding smooth digital gradients.",
  "*   **Texture:** The final image should have a subtle, overlying paper or canvas texture. This gives the illustration a tangible, printed quality, as if it came from a vintage book or magazine.",
  "",
];

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
    recordModelUsage(
      handle: symbol,
      delta: {
        promptTokensDelta: number;
        inferenceTokensDelta: number;
        cachedTokensDelta?: number;
        timestamp: number;
      }
    ) {
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
  posterPrompt: z.string().trim().min(1),
  // Increase to exactly 10 segments (content-only; style is applied at generation time)
  segments: z.array(StorySegmentSchema).min(10).max(10),
  endingPrompt: z.string().trim().min(1),
});

export type StorySegmentation = z.infer<typeof StorySegmentationSchema>;

export type SegmentationAttemptFailure = {
  attempt: number;
  rawText: string;
  modelVersion: string;
  errorMessage: string;
  zodIssues?: readonly ZodIssue[];
  thoughts?: string[];
  elapsedMs?: number;
  charCount?: number;
};

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
        })
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

export type SegmentationAttemptPhase = "generation" | "correction";

export type SegmentationAttemptSnapshot = {
  phase: SegmentationAttemptPhase;
  attempt: number;
  prompt: string;
  response: string;
  modelVersion: string;
  thoughts?: string[];
  charCount: number;
};

export type SegmentationAttemptSnapshotSaver = (
  snapshot: SegmentationAttemptSnapshot
) => Promise<void> | void;

export type SegmentationCorrectorAttempt = {
  attempt: number;
  prompt: string;
  rawResponse: string;
  modelVersion: string;
  response?: SegmentationCorrectorResponse;
  thoughts?: string[];
  parseError?: string;
  charCount?: number;
};

export class SegmentationValidationError extends Error {
  constructor(
    message: string,
    readonly prompt: string,
    readonly attempts: SegmentationAttemptFailure[]
  ) {
    super(message);
    this.name = "SegmentationValidationError";
  }
}

export class SegmentationCorrectionError extends Error {
  constructor(
    message: string,
    readonly generationPrompt: string,
    readonly attempts: SegmentationCorrectorAttempt[],
    readonly segmentation: StorySegmentation
  ) {
    super(message);
    this.name = "SegmentationCorrectionError";
  }
}

type GeminiTextCallResult = {
  text: string;
  modelVersion: string;
  thoughts?: string[];
  elapsedMs: number;
  charCount: number;
};

async function runTextModelCall({
  adapter,
  parts,
  thinkingBudget,
}: {
  adapter: ReturnType<typeof useProgress>;
  parts: Part[];
  thinkingBudget: number;
}): Promise<GeminiTextCallResult> {
  const uploadBytes = estimateUploadBytes(parts);
  const callHandle = adapter.startModelCall({
    modelId: TEXT_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  const startTime = Date.now();
  let aggregated = "";
  let modelVersion: string = TEXT_MODEL_ID;
  const thoughts: string[] = [];
  let charCount = 0;

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
            thinkingBudget,
          },
        },
      });

      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          modelVersion = chunk.modelVersion;
        }
        const candidates = chunk.candidates ?? [];
        for (const candidate of candidates) {
          const contentParts = candidate.content?.parts ?? [];
          for (const part of contentParts) {
            const content = part.text;
            if (!content) {
              continue;
            }
            if (part.thought) {
              thoughts.push(content);
              continue;
            }
            aggregated += content;
            charCount += content.length;
            adapter.reportChars(content.length);
          }
        }
      }
    });
  } finally {
    adapter.finishModelCall(callHandle);
  }

  const elapsedMs = Date.now() - startTime;
  const trimmed = aggregated.trim();
  if (!trimmed) {
    throw new Error("Gemini response did not contain any text output");
  }

  return {
    text: trimmed,
    modelVersion,
    thoughts: thoughts.length > 0 ? [...thoughts] : undefined,
    elapsedMs,
    charCount,
  };
}

export type StoryProseResult = {
  text: string;
  prompt: string;
  modelVersion: string;
  thoughts?: string[];
};

export type StorySegmentationResult = {
  segmentation: StorySegmentation;
  prompt: string;
  modelVersion: string;
  attempt: number;
  correctionAttempts?: SegmentationCorrectorAttempt[];
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
  "required": ["title", "posterPrompt", "segments", "endingPrompt"],
  "properties": {
    "title": { "type": "string", "minLength": 1 },
    "posterPrompt": { "type": "string", "minLength": 1 },
    "segments": {
      "type": "array",
      "minItems": 10,
      "maxItems": 10,
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
    },
    "endingPrompt": { "type": "string", "minLength": 1 }
  },
  "additionalProperties": false
}`;

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
    "1. Produce concise JSON that conforms exactly to the schema below. Do not include commentary or code fences.",
    "2. Provide `title`, `posterPrompt`, ten chronological `segments`, and `endingPrompt`.",
    "   This yields 12 total illustration prompts: poster + 10 story beats + ending card.",
    "3. `posterPrompt` introduces the entire story in a single dynamic scene suitable for a cover/poster. It must be stunning, captivating, interesting, and intriguing; and it should mention the name of the protagonist (an important historical figure). If the name is long, prefer a concise form (e.g., first+last name or well-known moniker). Keep any visible text within four words.",
    '4. `endingPrompt` is a graceful "The End" card with a minimal motif from the story.',
    "5. For each of the ten `segments`:",
    "   • Provide `narration`, an ordered array of narration slices. Each slice contains `voice` and `text`.",
    "   • Alternate between the `M` and `F` voices whenever the flow allows. Let `M` handle formal or structural beats; let `F` handle emotional or explanatory beats. Avoid repeating the same voice twice in a row unless it preserves clarity. Remove citation markers or reference-style callouts.",
    "   • Provide `imagePrompt`, a clear visual prompt that captures the same moment as the narration slice(s). Focus on subject, action, setting, and lighting cues. Do not include stylistic descriptors (lighting adjectives are fine, but no references to media franchises or rendering engines).",
    "6. Keep each `imagePrompt` drawable as a single vintage cartoon panel: emphasise one main action, at most two characters, simple props, and broad composition notes. Ground any abstract effects or information (like streams of code or glowing calculations) in a physical source within the scene, and avoid split screens, mirrored halves, perfectly aligned geometry, or overly precise camera directions.",
    '7. Explicitly anchor every prompt in time and place (decade, setting, or specific workspace details) and include consistent style cues such as "Vintage cartoon style", "muted colors", and "clear composition" so the aesthetic remains uniform.',
    '8. Writing inside any `imagePrompt` should be optional and minimal. If text must appear in the scene, keep it to four words or fewer and prefer period-appropriate signage. Describing surfaces as "covered in diagrams" or "filled with formulas" is acceptable so long as you do not spell out the actual symbols or equations. Never request dense paragraphs or precise formula strings.',
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
    "Convert the story into alternating-voice narration segments with illustration prompts plus poster and ending prompts, following all rules above.",
  ].join("\n");
}

// Build the prompt parts for the full 12-image set generation.
function buildFullImageSetPrompt(
  styleLines: readonly string[],
  entries: Array<{ index: number; prompt: string }>,
  options: { endingIndex: number; posterIndex: number }
): Part[] {
  const parts: Part[] = [];
  const headerLines: string[] = [
    "Please make a total of 12 images:",
    "- 1-10 story images",
    '- "the end" image (should be a memorable hint at the core idea, morale, or legacy)',
    '- the "movie poster" image for the whole story (hook)',
    "Make high quality, high positivity cartoon style.",
    "",
    "Follow the style:",
    ...styleLines,
    "",
    "Image descriptions:",
  ];
  parts.push({ text: headerLines.join("\n") });
  for (const { index, prompt } of entries) {
    let label = `Image ${index}`;
    if (index === options.endingIndex) {
      label = `Image ${index} (the end)`;
    } else if (index === options.posterIndex) {
      label = `Image ${index} (poster)`;
    }
    parts.push({ text: `${label}: ${prompt}` });
  }
  return parts;
}

export async function generateProseStory(
  topic: string,
  progress?: StoryProgress
): Promise<StoryProseResult> {
  const adapter = useProgress(progress);
  adapter.log(
    "[story] generating prose with web-search-enabled Gemini 2.5 Pro"
  );
  const prompt = buildStoryPrompt(topic);
  const parts: Part[] = [{ text: prompt }];
  adapter.log("[story/prose] prompt prepared");
  const uploadBytes = estimateUploadBytes(parts);
  const callHandle = adapter.startModelCall({
    modelId: TEXT_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  const startTime = Date.now();

  let aggregated = "";
  let resolvedModelVersion: string = TEXT_MODEL_ID;
  const thoughts: string[] = [];

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
            if (!content) {
              continue;
            }
            if (part.thought) {
              thoughts.push(content);
              continue;
            }
            aggregated += content;
            adapter.reportChars(content.length);
          }
        }
        const usage = chunk.usageMetadata;
        if (usage) {
          const promptTokensNow = usage.promptTokenCount ?? 0;
          const cachedTokensNow = usage.cachedContentTokenCount ?? 0;
          const inferenceTokensNow = usage.candidatesTokenCount ?? 0;
          const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
          const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
          const inferenceDelta = Math.max(
            0,
            inferenceTokensNow - lastInferenceTokens
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
    adapter.log(
      `[story/prose] model ${result.modelVersion} finished in ${elapsed}`
    );

    return {
      text: result.text,
      prompt,
      modelVersion: result.modelVersion,
      thoughts: thoughts.length > 0 ? [...thoughts] : undefined,
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

const DEFAULT_SEGMENTATION_CORRECTOR_ATTEMPTS = 1;

function buildSegmentationCorrectorPrompt(
  segmentation: StorySegmentation,
  generationPrompt: string
): string {
  const lines: string[] = [
    "You are the image prompt corrector for illustrated historical stories.",
    "Assess whether the illustration prompts comply with the brief and rewrite only the prompts that violate the rules.",
    "",
    "Return strict JSON: { issuesSummary: string, corrections: Array<{ prompt_index: number, critique: string, updatedPrompt: string }> }.",
    "Only include entries under `corrections` for prompts that must be updated.",
    "",
    "Check for:",
    "- Each prompt grounds the scene in time and place (decade, location, or workplace details).",
    '- Every prompt includes consistent style anchors such as "Vintage cartoon style", "muted colors", and "clear composition".',
    "- One clear action, at most two characters, and abstract elements (code, diagrams, light) emerge from a physical source instead of floating freely.",
    '- Optional writing stays within four words and never spells out specific equations; generic phrases like "chalkboard filled with formulas" are acceptable.',
    "- Poster (index 11) reads like a high-impact cover: stunning, captivating, interesting, and intriguing. It explicitly mentions the protagonist by name (or a concise moniker) while keeping any visible text within four words.",
    "",
    "===== Segmentation generation brief =====",
    generationPrompt,
    "===== End brief =====",
    "",
    'Indexed prompts (0-9 story panels, 10 = ending card labelled "the end", 11 = poster/cover):',
  ];

  segmentation.segments.forEach((segment, idx) => {
    const promptIndex = idx;
    lines.push(
      `Prompt ${promptIndex} (story panel ${idx + 1}) image prompt: ${segment.imagePrompt}`
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
    `Prompt ${endingIndex} ("the end" card) image prompt: ${segmentation.endingPrompt}`
  );

  const posterIndex = segmentation.segments.length + 1;
  lines.push(
    `Prompt ${posterIndex} (poster) image prompt: ${segmentation.posterPrompt}`
  );
  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

function applySegmentationCorrections(
  segmentation: StorySegmentation,
  corrections: readonly SegmentationPromptCorrection[]
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
      `Segmentation corrector returned invalid prompt index ${targetIndex}`
    );
  });

  return StorySegmentationSchema.parse(draft);
}

async function runSegmentationCorrector(
  initialSegmentation: StorySegmentation,
  generationPrompt: string,
  adapter: ReturnType<typeof useProgress>,
  maxAttempts: number,
  snapshotSaver?: SegmentationAttemptSnapshotSaver
): Promise<{
  segmentation: StorySegmentation;
  attempts: SegmentationCorrectorAttempt[];
}> {
  if (maxAttempts <= 0) {
    return { segmentation: initialSegmentation, attempts: [] };
  }

  let workingSegmentation = initialSegmentation;
  const attempts: SegmentationCorrectorAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const reviewPrompt = buildSegmentationCorrectorPrompt(
      workingSegmentation,
      generationPrompt
    );
    const parts: Part[] = [{ text: reviewPrompt }];
    adapter.log(
      `[story/segments/corrector] attempt ${attempt} prompt prepared`
    );
    const sanitisedRequest = parts.map((part) => sanitisePartForLogging(part));
    adapter.log(
      `[story/segments/corrector] request prepared with ${sanitisedRequest.length} part(s)`
    );

    const { text, modelVersion, thoughts, elapsedMs, charCount } =
      await runTextModelCall({
        adapter,
        parts,
        thinkingBudget: 16_384,
      });
    const elapsed = formatMillis(elapsedMs);
    adapter.log(
      `[story/segments/corrector] attempt ${attempt} model ${modelVersion} finished in ${elapsed} (${charCount} chars)`
    );
    if (thoughts && thoughts.length > 0) {
      adapter.log(
        `[story/segments/corrector] attempt ${attempt} thoughts captured (${thoughts.length})`
      );
    }

    await snapshotSaver?.({
      phase: "correction",
      attempt,
      prompt: reviewPrompt,
      response: text,
      modelVersion,
      thoughts,
      charCount,
    });

    let response: SegmentationCorrectorResponse | undefined;
    let parseError: string | undefined;
    try {
      const parsedJson = extractJsonObject(text);
      response = SegmentationCorrectorResponseSchema.parse(parsedJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseError = message;
    }

    attempts.push({
      attempt,
      prompt: reviewPrompt,
      rawResponse: text,
      modelVersion,
      response,
      thoughts,
      parseError,
      charCount,
    });

    if (!response) {
      throw new SegmentationCorrectionError(
        "Segmentation corrector did not return valid JSON.",
        generationPrompt,
        attempts,
        workingSegmentation
      );
    }

    if (response.issuesSummary) {
      adapter.log(
        `[story/segments/corrector] attempt ${attempt} issues summary: ${response.issuesSummary}`
      );
    }

    if (response.corrections.length === 0) {
      adapter.log(
        `[story/segments/corrector] attempt ${attempt} returned no corrections`
      );
      return {
        segmentation: workingSegmentation,
        attempts,
      };
    }

    adapter.log(
      `[story/segments/corrector] attempt ${attempt} applying corrections for indices ${response.corrections
        .map((c) => c.promptIndex)
        .join(", ")}`
    );
    response.corrections.forEach((correction) => {
      adapter.log(
        `[story/segments/corrector] prompt ${correction.promptIndex} critique: ${correction.critique}`
      );
    });

    try {
      workingSegmentation = applySegmentationCorrections(
        workingSegmentation,
        response.corrections
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SegmentationCorrectionError(
        `Segmentation corrector corrections could not be applied: ${message}`,
        generationPrompt,
        attempts,
        workingSegmentation
      );
    }

    if (attempt === maxAttempts) {
      adapter.log(
        `[story/segments/corrector] attempt ${attempt} reached max attempts after applying corrections`
      );
      return {
        segmentation: workingSegmentation,
        attempts,
      };
    }
  }

  return {
    segmentation: workingSegmentation,
    attempts,
  };
}

export async function generateStorySegmentation(
  storyText: string,
  progress?: StoryProgress,
  options?: {
    maxCorrectionAttempts?: number;
    onAttemptSnapshot?: SegmentationAttemptSnapshotSaver;
  }
): Promise<StorySegmentationResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating narration segments with Gemini 2.5 Pro");
  const prompt = buildSegmentationPrompt(storyText);
  const parts: Part[] = [{ text: prompt }];
  adapter.log("[story/segments] prompt prepared");
  const sanitisedRequest = parts.map((part) => sanitisePartForLogging(part));
  adapter.log(
    `[story/segments] request prepared with ${sanitisedRequest.length} part(s)`
  );
  const maxAttempts = 3;
  const failures: SegmentationAttemptFailure[] = [];

  const runAttempt = async (
    attempt: number
  ): Promise<{
    rawText: string;
    modelVersion: string;
    thoughts?: string[];
    elapsedMs: number;
    charCount: number;
  }> => {
    const { text, modelVersion, thoughts, elapsedMs, charCount } =
      await runTextModelCall({
        adapter,
        parts,
        thinkingBudget: 32_768,
      });
    const elapsed = formatMillis(elapsedMs);
    adapter.log(
      `[story/segments] attempt ${attempt} model ${modelVersion} finished in ${elapsed} (${charCount} chars)`
    );
    if (thoughts && thoughts.length > 0) {
      adapter.log(
        `[story/segments] attempt ${attempt} thoughts captured (${thoughts.length})`
      );
    }
    return {
      rawText: text,
      modelVersion,
      thoughts,
      elapsedMs,
      charCount,
    };
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const {
      rawText,
      modelVersion,
      thoughts: attemptThoughts,
      elapsedMs,
      charCount,
    } = await runAttempt(attempt);
    await options?.onAttemptSnapshot?.({
      phase: "generation",
      attempt,
      prompt,
      response: rawText,
      modelVersion,
      thoughts: attemptThoughts,
      charCount,
    });
    try {
      const parsedJson = extractJsonObject(rawText);
      let segmentation = StorySegmentationSchema.parse(parsedJson);
      adapter.log(`[story/segments] attempt ${attempt} parsed successfully`);

      const rawCorrectionAttempts =
        options?.maxCorrectionAttempts ?? DEFAULT_SEGMENTATION_CORRECTOR_ATTEMPTS;
      const maxCorrectionAttempts =
        Number.isFinite(rawCorrectionAttempts) && rawCorrectionAttempts >= 0
          ? Math.floor(rawCorrectionAttempts)
          : DEFAULT_SEGMENTATION_CORRECTOR_ATTEMPTS;
      let correctionAttempts: SegmentationCorrectorAttempt[] | undefined;
      if (maxCorrectionAttempts > 0) {
        const reviewResult = await runSegmentationCorrector(
          segmentation,
          prompt,
          adapter,
          maxCorrectionAttempts,
          options?.onAttemptSnapshot
        );
        segmentation = reviewResult.segmentation;
        if (reviewResult.attempts.length > 0) {
          correctionAttempts = reviewResult.attempts;
        }
      }

      return {
        segmentation,
        prompt,
        modelVersion,
        attempt,
        correctionAttempts,
      };
    } catch (error) {
      if (error instanceof SegmentationCorrectionError) {
        throw error;
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const zodIssues = error instanceof z.ZodError ? error.issues : undefined;
      failures.push({
        attempt,
        rawText,
        modelVersion,
        errorMessage,
        zodIssues,
        thoughts: attemptThoughts,
        elapsedMs,
        charCount,
      });
      if (attempt >= maxAttempts) {
        throw new SegmentationValidationError(
          `Gemini segmentation did not produce valid JSON after ${maxAttempts} attempts`,
          prompt,
          failures
        );
      }
      adapter.log(
        `[story/segments] attempt ${attempt} invalid response (${errorMessage}); retrying...`
      );
    }
  }

  throw new Error("Segmentation attempts exhausted unexpectedly");
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

// ===============================
// Image set comparison and assets
// ===============================

const ImageSetJudgeResponseSchema = z.object({
  reasoning: z.string().trim().min(1),
  verdict: z.enum(["set_a", "set_b"]),
});

type ImageSetJudgeResponse = z.infer<typeof ImageSetJudgeResponseSchema>;

type ImageSetArtifact = {
  label: "set_a" | "set_b";
  promptParts: Part[];
  modelVersion: string;
  aggregatedText: string;
  imageCount: number;
};

type ImageSetRunResult = {
  label: "set_a" | "set_b";
  promptParts: Part[];
  modelVersion: string;
  aggregatedText: string;
  images: GeneratedStoryImage[];
};

export type StoryImagesArtifacts = {
  style: readonly string[];
  sets: ImageSetArtifact[];
  judge?: {
    requestPartsCount: number;
    requestPartsSanitised: unknown[];
    responseText: string;
    responseJson: ImageSetJudgeResponse;
    modelVersion: string;
    thoughts?: string[];
  };
  selectedSet: "set_a" | "set_b";
};

async function judgeImageSets(
  setA: ImageSetRunResult,
  setB: ImageSetRunResult,
  promptsByIndex: Map<number, string>,
  adapter: ReturnType<typeof useProgress>
): Promise<{
  response: ImageSetJudgeResponse;
  rawText: string;
  modelVersion: string;
  requestParts: Part[];
  thoughts?: string[];
}> {
  const headerLines: string[] = [
    "You are the image quality judge for illustrated historical stories.",
    "Two complete illustration sets are provided: Set A and Set B. Each contains 12 images covering story panels 1-10, a \"the end\" card, and a poster.",
    "Evaluate which set better satisfies the prompts and style requirements.",
    "Criteria: prompt fidelity, clear single action, grounded historical setting, readable composition, and accurate vintage cartoon style (ink outlines, muted palette, subtle paper texture).",
    "If any writing appears, ensure it is four words or fewer, spelled correctly, and period-appropriate.",
  ];

  const parts: Part[] = [{ text: headerLines.join("\n") }];
  const addSet = (set: ImageSetRunResult) => {
    const name = set.label === "set_a" ? "Set A" : "Set B";
    parts.push({ text: `${name} illustrations follow.` });
    const sorted = [...set.images].sort((a, b) => a.index - b.index);
    for (const image of sorted) {
      const prompt = promptsByIndex.get(image.index) ?? "";
      parts.push({ text: `${name} – Image ${image.index} prompt: ${prompt}` });
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data.toString("base64"),
        },
      });
    }
  };
  addSet(setA);
  addSet(setB);
  parts.push({
    text: 'Compare Set A and Set B. Return strict JSON: { reasoning: string, verdict: "set_a" | "set_b" }. Provide the reasoning first, then the verdict. Respond with JSON only.',
  });

  const sanitisedRequest = parts.map((part) => sanitisePartForLogging(part));
  adapter.log(
    `[images/judge] set comparison request prepared with ${sanitisedRequest.length} part(s)`
  );

  const uploadBytes = estimateUploadBytes(parts);
  const callHandle = adapter.startModelCall({
    modelId: TEXT_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  let aggregated = "";
  let modelVersion: string = TEXT_MODEL_ID;
  const thoughts: string[] = [];
  try {
    await runGeminiCall(async (client) => {
      const stream = await client.models.generateContentStream({
        model: TEXT_MODEL_ID,
        contents: [{ role: "user", parts }],
        config: {
          thinkingConfig: { includeThoughts: true, thinkingBudget: 32_768 },
        },
      });
      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          modelVersion = chunk.modelVersion;
        }
        const candidates = chunk.candidates ?? [];
        for (const candidate of candidates) {
          const contentParts = candidate.content?.parts ?? [];
          for (const part of contentParts) {
            const text = part.text;
            if (!text) {
              continue;
            }
            if (part.thought) {
              thoughts.push(text);
              continue;
            }
            aggregated += text;
          }
        }
      }
    });
  } finally {
    adapter.finishModelCall(callHandle);
  }
  adapter.log(`[images/judge] raw response text: ${aggregated}`);
  const json = extractJsonObject(aggregated);
  const response = ImageSetJudgeResponseSchema.parse(json);
  adapter.log(
    `[images/judge] parsed response: ${JSON.stringify(response)}`
  );
  if (thoughts.length > 0) {
    adapter.log(`[images/judge] thoughts: ${thoughts.join(" | ")}`);
  }
  return {
    response,
    rawText: aggregated,
    modelVersion,
    requestParts: parts,
    thoughts: thoughts.length > 0 ? [...thoughts] : undefined,
  };
}

export async function generateStoryImages(
  segmentation: StorySegmentation,
  progress?: StoryProgress
): Promise<StoryImagesResult & { artifacts?: StoryImagesArtifacts }> {
  const adapter = useProgress(progress);
  adapter.log(
    "[story] generating 12 images via dual-set comparison workflow"
  );

  const posterPrompt = segmentation.posterPrompt.trim();
  const endingPrompt = segmentation.endingPrompt.trim();
  if (!posterPrompt) {
    throw new Error("Segmentation did not include a posterPrompt");
  }
  if (!endingPrompt) {
    throw new Error("Segmentation did not include an endingPrompt");
  }

  const entries: Array<{ index: number; prompt: string }> = [];
  const promptsByIndex = new Map<number, string>();

  for (let i = 0; i < segmentation.segments.length; i++) {
    const segment = segmentation.segments[i];
    if (!segment) {
      throw new Error(`Segmentation segment ${i + 1} is missing data`);
    }
    const segmentPrompt = segment.imagePrompt.trim();
    if (!segmentPrompt) {
      throw new Error(
        `Segmentation segment ${i + 1} is missing an imagePrompt`
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

  const styleLines = ART_STYLE_VINTAGE_CARTOON;

  const runImageSet = async (
    label: "set_a" | "set_b"
  ): Promise<ImageSetRunResult> => {
    const promptParts = buildFullImageSetPrompt(styleLines, entries, {
      endingIndex,
      posterIndex,
    });
    const sanitisedRequest = promptParts.map((part) =>
      sanitisePartForLogging(part)
    );
    adapter.log(
      `[story/images/${label}] request prepared with ${sanitisedRequest.length} part(s)`
    );

    const uploadBytes = estimateUploadBytes(promptParts);
    const callHandle = adapter.startModelCall({
      modelId: IMAGE_MODEL_ID as GeminiModelId,
      uploadBytes,
    });
    const start = Date.now();

    const setImages: GeneratedStoryImage[] = [];
    let modelVersion: string = IMAGE_MODEL_ID;
    let aggregatedText = "";

    try {
      await runGeminiCall(async (client) => {
        const stream = await client.models.generateContentStream({
          model: IMAGE_MODEL_ID,
          contents: [{ role: "user", parts: promptParts }],
          config: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: { aspectRatio: "16:9" },
          },
        });

        let lastPromptTokens = 0;
        let lastCachedTokens = 0;
        let lastInferenceTokens = 0;
        const assignmentOrder = [...entries].sort((a, b) => a.index - b.index);
        let assignCursor = 0;

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
                const target = assignmentOrder[assignCursor];
                if (target) {
                  const buffer = Buffer.from(inlineData.data, "base64");
                  const ext = extensionFromMime(inlineData.mimeType);
                  setImages.push({
                    index: target.index,
                    mimeType: inlineData.mimeType ?? `image/${ext}`,
                    data: buffer,
                  });
                  adapter.log(
                    `[story/images/${label}] received image ${target.index} (${buffer.length} bytes)`
                  );
                  assignCursor += 1;
                  continue;
                }
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
            const inferenceTokensNow = usage.candidatesTokenCount ?? 0;
            const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
            const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
            const inferenceDelta = Math.max(
              0,
              inferenceTokensNow - lastInferenceTokens
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
            lastInferenceTokens = inferenceTokensNow;
          }
        }
      });
    } finally {
      adapter.finishModelCall(callHandle);
    }

    const elapsed = formatMillis(Date.now() - start);
    adapter.log(
      `[story/images/${label}] model ${modelVersion} generated ${formatInteger(setImages.length)} illustrations in ${elapsed}`
    );
    if (aggregatedText.trim()) {
      adapter.log(
        `[story/images/${label}] text response: ${aggregatedText.trim()}`
      );
    }

    if (setImages.length !== entries.length) {
      throw new Error(
        `Image generation for ${label} returned ${setImages.length} image(s); expected ${entries.length}`
      );
    }

    return {
      label,
      promptParts,
      modelVersion,
      aggregatedText,
      images: setImages,
    };
  };

  const [setA, setB] = await Promise.all([
    runImageSet("set_a"),
    runImageSet("set_b"),
  ]);

  let selectedSet: ImageSetRunResult = setA;
  const artifacts: StoryImagesArtifacts = {
    style: styleLines,
    sets: [
      {
        label: "set_a",
        promptParts: setA.promptParts,
        modelVersion: setA.modelVersion,
        aggregatedText: setA.aggregatedText,
        imageCount: setA.images.length,
      },
      {
        label: "set_b",
        promptParts: setB.promptParts,
        modelVersion: setB.modelVersion,
        aggregatedText: setB.aggregatedText,
        imageCount: setB.images.length,
      },
    ],
    selectedSet: "set_a",
  };

  try {
    const judge = await judgeImageSets(setA, setB, promptsByIndex, adapter);
    artifacts.judge = {
      requestPartsCount: judge.requestParts.length,
      requestPartsSanitised: judge.requestParts.map((part) =>
        sanitisePartForLogging(part)
      ),
      responseText: judge.rawText,
      responseJson: judge.response,
      modelVersion: judge.modelVersion,
      thoughts: judge.thoughts,
    };
    selectedSet = judge.response.verdict === "set_b" ? setB : setA;
    artifacts.selectedSet = judge.response.verdict;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    adapter.log(
      `[images/judge] failed to compare sets (${message}); defaulting to Set A`
    );
  }

  const orderedEntries = [...entries].sort((a, b) => a.index - b.index);
  const snapshotLines: string[] = ["Style Requirements:", ...styleLines, ""];
  for (const entry of orderedEntries) {
    snapshotLines.push(`Image ${entry.index}: ${entry.prompt}`);
  }

  const captionsText = selectedSet.aggregatedText.trim();

  return {
    images: [...selectedSet.images].sort((a, b) => a.index - b.index),
    prompt: snapshotLines.join("\n"),
    modelVersion: selectedSet.modelVersion,
    captions: captionsText || undefined,
    artifacts,
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
  prefix?: string
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
  imagePaths: readonly string[]
): MediaSegment[] {
  if (segmentation.segments.length !== imagePaths.length) {
    throw new Error(
      `Image count ${imagePaths.length} does not match segmentation segments ${segmentation.segments.length}`
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
  options: GenerateStoryOptions
): Promise<GenerateStoryResult> {
  const story = await generateProseStory(options.topic, options.progress);
  const segmentation = await generateStorySegmentation(
    story.text,
    options.progress
  );
  const images = await generateStoryImages(
    segmentation.segmentation,
    options.progress
  );
  // We now generate 12 images total: 10 story panels, 1 ending card, 1 poster.
  // For media segments we only use the 10 interior images (indices 1..10).
  const interior = images.images.filter((im) => im.index >= 1 && im.index <= 10);
  if (interior.length !== segmentation.segmentation.segments.length) {
    throw new Error(
      `Expected ${segmentation.segmentation.segments.length} interior images (1..10), received ${interior.length}`
    );
  }

  const storage = getFirebaseAdminStorage(undefined, {
    storageBucket: options.storageBucket,
  });
  const bucket = storage.bucket(options.storageBucket);

  const storagePaths: string[] = [];
  for (const [i, image] of interior.entries()) {
    const seqIndex = i + 1; // 1..10 for media segments
    const jpegBuffer = await sharp(image.data)
      .jpeg({
        quality: 92,
        progressive: true,
        chromaSubsampling: "4:4:4",
      })
      .toBuffer();
    const extension = "jpg";
    const storagePath = buildImageStoragePath(
      options.userId,
      options.sessionId,
      options.planItemId,
      seqIndex,
      extension,
      options.storagePrefix
    );
    const file = bucket.file(storagePath);
    await file.save(jpegBuffer, {
      resumable: false,
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=0",
      },
    });
    const normalised = `/${storagePath.replace(/^\/?/, "")}`;
    storagePaths.push(normalised);
  }

  const segments: MediaSegment[] = toMediaSegments(
    segmentation.segmentation,
    storagePaths
  );

  const narration = await synthesizeAndPublishNarration({
    userId: options.userId,
    sessionId: options.sessionId,
    planItemId: options.planItemId,
    segments,
    storageBucket: options.storageBucket,
    progress: createConsoleProgress(
      options.audioProgressLabel ?? options.planItemId
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
