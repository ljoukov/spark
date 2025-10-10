import { Buffer } from "node:buffer";
import path from "node:path";

import { Type, type Schema } from "@google/genai";
import { z, type ZodIssue } from "zod";

import {
  runLlmImageCall,
  runLlmJsonCall,
  runLlmTextCall,
  type LlmContentPart,
  sanitisePartForLogging,
  LlmJsonCallError,
} from "../../utils/llm";
import type {
  JobProgressReporter,
  LlmUsageChunk,
} from "../../utils/concurrency";
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

export type StoryProseResult = {
  text: string;
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

// JSON schema string included in the segmentation prompt (mirrors origin/main)
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

// (no image batch JSON schema; set comparison uses ImageSetJudgeResponseSchema below)

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

// Build a single 4-image batch prompt: style first, then the numbered image prompts
// (batch prompt builder removed; using full-set prompt below)

export async function generateProseStory(
  topic: string,
  progress?: StoryProgress,
  options?: { debugRootDir?: string }
): Promise<StoryProseResult> {
  const adapter = useProgress(progress);
  adapter.log(
    "[story] generating prose with web-search-enabled Gemini 2.5 Pro"
  );
  const prompt = buildStoryPrompt(topic);
  const parts: LlmContentPart[] = [{ type: "text", text: prompt }];
  adapter.log("[story/prose] prompt prepared");
  const text = await runLlmTextCall({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    parts,
    tools: [{ type: "web-search" }],
    debug: options?.debugRootDir
      ? { rootDir: options.debugRootDir, stage: "prose" }
      : undefined,
  });

  return { text };
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
    'Indexed prompts (0-9 story panels, 10 = ending card labelled "the end", 11 = poster):',
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
  snapshotSaver?: SegmentationAttemptSnapshotSaver,
  debugRootDir?: string
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
    const parts: LlmContentPart[] = [{ type: "text", text: reviewPrompt }];
    adapter.log(`[story/segments/corrector] attempt ${attempt} prompt prepared`);
    const sanitisedRequest = parts.map((part) => sanitisePartForLogging(part));
    adapter.log(
      `[story/segments/corrector] request prepared with ${sanitisedRequest.length} part(s)`
    );

    const responseText = await runLlmTextCall({
      progress: adapter,
      modelId: TEXT_MODEL_ID,
      parts,
      debug: debugRootDir
        ? { rootDir: debugRootDir, stage: "segmentation", subStage: "corrector", attempt }
        : undefined,
    });

    await snapshotSaver?.({
      phase: "correction",
      attempt,
      prompt: reviewPrompt,
      response: responseText,
      modelVersion: TEXT_MODEL_ID,
      thoughts: undefined,
      charCount: responseText.length,
    });

    let response: SegmentationCorrectorResponse | undefined;
    let parseError: string | undefined;
    try {
      const parsedJson = extractJsonObject(responseText);
      response = SegmentationCorrectorResponseSchema.parse(parsedJson);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    attempts.push({
      attempt,
      prompt: reviewPrompt,
      rawResponse: responseText,
      modelVersion: TEXT_MODEL_ID,
      response,
      thoughts: undefined,
      parseError,
      charCount: responseText.length,
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
      return { segmentation: workingSegmentation, attempts };
    }

    adapter.log(
      `[story/segments/corrector] attempt ${attempt} applying corrections for indices ${response.corrections
        .map((c) => c.promptIndex)
        .join(", ")}`
    );

    try {
      workingSegmentation = applySegmentationCorrections(
        workingSegmentation,
        response.corrections
      );
    } catch (error) {
      throw new SegmentationCorrectionError(
        `Segmentation corrector corrections could not be applied: ${error instanceof Error ? error.message : String(error)}`,
        generationPrompt,
        attempts,
        workingSegmentation
      );
    }
  }

  return { segmentation: workingSegmentation, attempts };
}

export async function generateStorySegmentation(
  storyText: string,
  progress?: StoryProgress,
  options?: {
    maxCorrectionAttempts?: number;
    onAttemptSnapshot?: SegmentationAttemptSnapshotSaver;
    debugRootDir?: string;
  }
): Promise<StorySegmentationResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating narration segments with Gemini 2.5 Pro");
  const prompt = buildSegmentationPrompt(storyText);
  const parts: LlmContentPart[] = [{ type: "text", text: prompt }];
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
    segmentation: StorySegmentation;
  }> => {
    try {
      const segmentation = await runLlmJsonCall<StorySegmentation>({
        progress: adapter,
        modelId: TEXT_MODEL_ID,
        parts,
        responseMimeType: "application/json",
        responseSchema: STORY_SEGMENTATION_RESPONSE_SCHEMA,
        schema: StorySegmentationSchema,
        process: extractJsonObject,
        maxAttempts: 1,
        debug: options?.debugRootDir
          ? { rootDir: options.debugRootDir, stage: "segmentation" }
          : undefined,
      });
      const serialised = JSON.stringify(segmentation, null, 2);
      await options?.onAttemptSnapshot?.({
        phase: "generation",
        attempt,
        prompt,
        response: serialised,
        modelVersion: TEXT_MODEL_ID,
        thoughts: undefined,
        charCount: serialised.length,
      });
      return { rawText: serialised, segmentation };
    } catch (error) {
      if (error instanceof LlmJsonCallError) {
        const last = error.attempts.at(-1);
        if (last) {
          failures.push({
            attempt,
            rawText: last.rawText,
            modelVersion: TEXT_MODEL_ID,
            errorMessage: last.error instanceof Error ? last.error.message : String(last.error),
            zodIssues:
              last.error instanceof z.ZodError ? last.error.issues : undefined,
            thoughts: undefined,
            charCount: last.rawText.length,
          });
          await options?.onAttemptSnapshot?.({
            phase: "generation",
            attempt,
            prompt,
            response: last.rawText,
            modelVersion: TEXT_MODEL_ID,
            thoughts: undefined,
            charCount: last.rawText.length,
          });
        }
      } else {
        failures.push({
          attempt,
          rawText: "",
          modelVersion: TEXT_MODEL_ID,
          errorMessage: error instanceof Error ? error.message : String(error),
          thoughts: undefined,
        });
      }
      throw error;
    }
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const attemptResult = await runAttempt(attempt);
      const parsedSegmentation = attemptResult.segmentation;
      adapter.log(`[story/segments] attempt ${attempt} parsed successfully`);

      const rawCorrectionAttempts =
        options?.maxCorrectionAttempts ?? DEFAULT_SEGMENTATION_CORRECTOR_ATTEMPTS;
      const maxCorrectionAttempts =
        Number.isFinite(rawCorrectionAttempts) && rawCorrectionAttempts >= 0
          ? Math.floor(rawCorrectionAttempts)
          : DEFAULT_SEGMENTATION_CORRECTOR_ATTEMPTS;
      let correctionAttempts: SegmentationCorrectorAttempt[] | undefined;
      let segmentation = parsedSegmentation;
      if (maxCorrectionAttempts > 0) {
        const reviewResult = await runSegmentationCorrector(
          segmentation,
          prompt,
          adapter,
          maxCorrectionAttempts,
          options?.onAttemptSnapshot,
          options?.debugRootDir
        );
        segmentation = reviewResult.segmentation;
        if (reviewResult.attempts.length > 0) {
          correctionAttempts = reviewResult.attempts;
        }
      }

      return {
        segmentation,
        prompt,
        modelVersion: TEXT_MODEL_ID,
        attempt,
        correctionAttempts,
      };
    } catch (error) {
      if (error instanceof SegmentationCorrectionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts) {
        throw new SegmentationValidationError(
          `Gemini segmentation did not produce valid JSON after ${maxAttempts} attempts`,
          prompt,
          failures
        );
      }
      adapter.log(
        `[story/segments] attempt ${attempt} invalid response (${message}); retrying...`
      );
    }
  }

  throw new Error("Segmentation attempts exhausted unexpectedly");
}

// =====================
// Image judging helpers (set comparison)
// =====================

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
  promptParts: LlmContentPart[];
  modelVersion: string;
  aggregatedText: string;
  imageCount: number;
};

type ImageSetRunResult = {
  label: "set_a" | "set_b";
  promptParts: LlmContentPart[];
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
  adapter: ReturnType<typeof useProgress>,
  debugRootDir?: string
): Promise<{
  response: ImageSetJudgeResponse;
  rawText: string;
  modelVersion: string;
  requestParts: LlmContentPart[];
  thoughts?: string[];
}> {
  const headerLines: string[] = [
    "You are the image quality judge for illustrated historical stories.",
    "Two complete illustration sets are provided: Set A and Set B. Each contains 12 images covering story panels 1-10, a \"the end\" card, and a poster.",
    "Evaluate which set better satisfies the prompts and style requirements.",
    "Criteria: prompt fidelity, clear single action, grounded historical setting, readable composition, and accurate vintage cartoon style (ink outlines, muted palette, subtle paper texture).",
    "If any writing appears, ensure it is four words or fewer, spelled correctly, and period-appropriate.",
  ];

  const parts: LlmContentPart[] = [{ type: "text", text: headerLines.join("\n") }];
  const addSet = (set: ImageSetRunResult) => {
    const name = set.label === "set_a" ? "Set A" : "Set B";
    parts.push({ type: "text", text: `${name} illustrations follow.` });
    const sorted = [...set.images].sort((a, b) => a.index - b.index);
    for (const image of sorted) {
      const prompt = promptsByIndex.get(image.index) ?? "";
      parts.push({ type: "text", text: `${name} – Image ${image.index} prompt: ${prompt}` });
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
    text: 'Compare Set A and Set B. Return strict JSON: { reasoning: string, verdict: "set_a" | "set_b" }. Provide the reasoning first, then the verdict. Respond with JSON only.',
  });

  const sanitisedRequest = parts.map((p) => sanitisePartForLogging(p));
  adapter.log(
    `[images/judge] set comparison request prepared with ${sanitisedRequest.length} part(s)`
  );

  const response = await runLlmJsonCall<ImageSetJudgeResponse>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    parts,
    responseMimeType: "application/json",
    schema: ImageSetJudgeResponseSchema,
    process: extractJsonObject,
    maxAttempts: 1,
    debug: debugRootDir
      ? { rootDir: debugRootDir, stage: "images", subStage: "judge" }
      : undefined,
  });
  const serialised = JSON.stringify(response, null, 2);
  adapter.log(`[images/judge] parsed response: ${serialised}`);
  return {
    response,
    rawText: serialised,
    modelVersion: TEXT_MODEL_ID,
    requestParts: parts,
    thoughts: undefined,
  };
}

export async function generateStoryImages(
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: { debugRootDir?: string }
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
    const index = i + 1; // 1..10 for story panels
    entries.push({ index, prompt: segmentPrompt });
    promptsByIndex.set(index, segmentPrompt);
  }

  const endingIndex = segmentation.segments.length + 1; // 11
  entries.push({ index: endingIndex, prompt: endingPrompt });
  promptsByIndex.set(endingIndex, endingPrompt);

  const posterIndex = segmentation.segments.length + 2; // 12
  entries.push({ index: posterIndex, prompt: posterPrompt });
  promptsByIndex.set(posterIndex, posterPrompt);

  const styleLines = ART_STYLE_VINTAGE_CARTOON;

  const buildSetPrompt = (): LlmContentPart[] => {
    const parts: LlmContentPart[] = [];
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
    parts.push({ type: "text", text: headerLines.join("\n") });
    for (const { index, prompt } of entries) {
      let label = `Image ${index}`;
      if (index === endingIndex) {
        label = `Image ${index} (the end)`;
      } else if (index === posterIndex) {
        label = `Image ${index} (poster)`;
      }
      parts.push({ type: "text", text: `${label}: ${prompt}` });
    }
    return parts;
  };

  const runImageSet = async (
    label: "set_a" | "set_b"
  ): Promise<ImageSetRunResult> => {
    const promptParts = buildSetPrompt();
    const sanitisedRequest = promptParts.map((part) => sanitisePartForLogging(part));
    adapter.log(
      `[story/images/${label}] request prepared with ${sanitisedRequest.length} part(s)`
    );

    const images: GeneratedStoryImage[] = [];
    const imageParts = await runLlmImageCall({
      progress: adapter,
      modelId: IMAGE_MODEL_ID,
      parts: promptParts,
      imageAspectRatio: "16:9",
      debug: options?.debugRootDir
        ? { rootDir: options.debugRootDir, stage: "images", subStage: label }
        : undefined,
    });

    const assignmentOrder = [...entries].sort((a, b) => a.index - b.index);
    let assignCursor = 0;
    for (const inlineImage of imageParts) {
      const target = assignmentOrder[assignCursor] ?? assignmentOrder.at(-1);
      if (target) {
        images.push({
          index: target.index,
          mimeType: inlineImage.mimeType ?? "image/png",
          data: inlineImage.data,
        });
        adapter.log(
          `[story/images/${label}] received image ${target.index} (${inlineImage.data.length} bytes)`
        );
        assignCursor += 1;
      }
    }

    return {
      label,
      promptParts,
      modelVersion: IMAGE_MODEL_ID,
      aggregatedText: "",
      images,
    };
  };

  const [setA, setB] = await Promise.all([
    runImageSet("set_a"),
    runImageSet("set_b"),
  ]);

  const judge = await judgeImageSets(
    setA,
    setB,
    promptsByIndex,
    adapter,
    options?.debugRootDir
  );
  const selected = judge.response.verdict;
  const winner = selected === "set_a" ? setA : setB;

  const snapshotLines: string[] = ["Style Requirements:", ...styleLines, ""];
  const maxIndex = Math.max(...entries.map((e) => e.index));
  for (let i = 1; i <= maxIndex; i++) {
    snapshotLines.push(`Image ${i}: ${promptsByIndex.get(i)}`);
  }

  const artifacts: StoryImagesArtifacts = {
    style: styleLines,
    sets: [
      {
        label: setA.label,
        promptParts: setA.promptParts,
        modelVersion: setA.modelVersion,
        aggregatedText: setA.aggregatedText,
        imageCount: setA.images.length,
      },
      {
        label: setB.label,
        promptParts: setB.promptParts,
        modelVersion: setB.modelVersion,
        aggregatedText: setB.aggregatedText,
        imageCount: setB.images.length,
      },
    ],
    judge: {
      requestPartsCount: judge.requestParts.length,
      requestPartsSanitised: judge.requestParts.map((p) => sanitisePartForLogging(p)),
      responseText: judge.rawText,
      responseJson: judge.response,
      modelVersion: judge.modelVersion,
      thoughts: judge.thoughts,
    },
    selectedSet: selected,
  };

  return {
    images: winner.images.sort((a, b) => a.index - b.index),
    prompt: snapshotLines.join("\n"),
    modelVersion: winner.modelVersion,
    captions: undefined,
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
  for (let i = 0; i < interior.length; i++) {
    const image = interior[i];
    if (!image) {
      throw new Error(`Missing interior image for segment ${i + 1}`);
    }
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
