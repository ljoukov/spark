import { Buffer } from "node:buffer";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
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

async function writeDebugText(
  baseDir: string | undefined,
  relativePath: string,
  content: string,
  { append = false }: { append?: boolean } = {}
): Promise<void> {
  if (!baseDir) {
    return;
  }
  try {
    const filePath = path.join(baseDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (append) {
      await appendFile(filePath, content, { encoding: "utf8" });
    } else {
      await writeFile(filePath, content, { encoding: "utf8" });
    }
  } catch {
    // Debug output is best-effort.
  }
}

async function writeDebugBinary(
  baseDir: string | undefined,
  relativePath: string,
  data: Buffer
): Promise<void> {
  if (!baseDir) {
    return;
  }
  try {
    const filePath = path.join(baseDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  } catch {
    // Debug output is best-effort.
  }
}

function formatPartsForDebug(parts: readonly Part[]): string {
  return parts
    .map((part) => {
      if (typeof part.text === "string") {
        return part.text;
      }
      if (part.inlineData) {
        const mime = part.inlineData.mimeType ?? "binary";
        return `[inline data ${mime} omitted]`;
      }
      if (part.fileData?.fileUri) {
        return `[file ${part.fileData.fileUri}]`;
      }
      return "[unsupported part]";
    })
    .join("\n");
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

export type SegmentationJudgeSuggestion = {
  index: number;
  updatedPrompt: string;
  notes?: string;
};

const SegmentationJudgeResponseSchema = z.object({
  pass: z.boolean(),
  issuesSummary: z.string().trim().optional(),
  suggestions: z
    .array(
      z.object({
        index: z.number().int().min(0),
        updatedPrompt: z.string().trim().min(1),
        notes: z.string().trim().optional(),
      })
    )
    .optional(),
});

type SegmentationJudgeResponse = z.infer<typeof SegmentationJudgeResponseSchema>;

export type SegmentationAttemptPhase = "generation" | "judge";

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

export type SegmentationReviewAttempt = {
  attempt: number;
  prompt: string;
  rawResponse: string;
  modelVersion: string;
  response?: SegmentationJudgeResponse;
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

export class SegmentationReviewError extends Error {
  constructor(
    message: string,
    readonly generationPrompt: string,
    readonly attempts: SegmentationReviewAttempt[],
    readonly segmentation: StorySegmentation
  ) {
    super(message);
    this.name = "SegmentationReviewError";
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
  reviewAttempts?: SegmentationReviewAttempt[];
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
    "3. `posterPrompt` introduces the entire story in a single dynamic scene suitable for a cover/poster.",
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
function buildFourImageBatchPrompt(
  styleLines: readonly string[],
  pairs: Array<{ index: number; prompt: string }>
): Part[] {
  const parts: Part[] = [];
  const headerLines: string[] = [
    "You are generating vintage cartoon-style illustrations for a historical story.",
    "Follow the style requirements exactly, then create four separate illustrations.",
    "Do not output captions or commentary; only return the images.",
    "",
    "Style Requirements:",
    ...styleLines,
    "",
    "Now generate the following illustrations:",
  ];
  parts.push({ text: headerLines.join("\n") });
  for (const { index, prompt } of pairs) {
    parts.push({ text: `Image ${index}: ${prompt}` });
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
          const thinkingTokensNow = usage.thoughtsTokenCount ?? 0;
          const inferenceTokensNow = usage.candidatesTokenCount ?? 0;
          const promptDelta = Math.max(0, promptTokensNow - lastPromptTokens);
          const cachedDelta = Math.max(0, cachedTokensNow - lastCachedTokens);
          const thinkingDelta = Math.max(
            0,
            thinkingTokensNow - lastThinkingTokens
          );
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

const DEFAULT_SEGMENTATION_REVIEW_ATTEMPTS = 2;

function buildSegmentationReviewPrompt(
  segmentation: StorySegmentation,
  generationPrompt: string
): string {
  const lines: string[] = [
    "You are the segmentation quality judge for illustrated historical stories.",
    "Assess whether the illustration prompts comply with the brief and rewrite only the prompts that violate the rules.",
    "",
    "Return strict JSON: { pass: boolean, issuesSummary?: string, suggestions?: Array<{ index: number, updatedPrompt: string, notes?: string }> }.",
    "If pass is false, provide rewritten prompts under `updatedPrompt` and explain the fix in `notes` when helpful.",
    "",
    "Check for:",
    "- Each prompt grounds the scene in time and place (decade, location, or workplace details).",
    '- Every prompt includes consistent style anchors such as "Vintage cartoon style", "muted colors", and "clear composition".',
    "- One clear action, at most two characters, and abstract elements (code, diagrams, light) emerge from a physical source instead of floating freely.",
    '- Optional writing stays within four words and never spells out specific equations; generic phrases like "chalkboard filled with formulas" are acceptable.',
    "",
    "===== Segmentation generation brief =====",
    generationPrompt,
    "===== End brief =====",
    "",
    "Indexed prompts (poster = 0, segments 1-10, ending = 11):",
  ];

  lines.push(`Prompt 0 (poster) image prompt: ${segmentation.posterPrompt}`);

  segmentation.segments.forEach((segment, idx) => {
    const promptIndex = idx + 1;
    lines.push(
      `Prompt ${promptIndex} (segment ${idx + 1}) image prompt: ${segment.imagePrompt}`
    );
    const narrationSummary = segment.narration
      .map((line) => `${line.voice}: ${line.text}`)
      .join(" | ");
    if (narrationSummary) {
      lines.push(`Prompt ${promptIndex} narration: ${narrationSummary}`);
    }
  });

  const endingIndex = segmentation.segments.length + 1;
  lines.push(
    `Prompt ${endingIndex} (ending) image prompt: ${segmentation.endingPrompt}`
  );
  lines.push("");
  lines.push("Return JSON only.");

  return lines.join("\n");
}

function applySegmentationSuggestions(
  segmentation: StorySegmentation,
  suggestions: readonly SegmentationJudgeSuggestion[]
): StorySegmentation {
  if (!suggestions.length) {
    return segmentation;
  }

  const draft = JSON.parse(JSON.stringify(segmentation)) as StorySegmentation;
  const totalSegments = draft.segments.length;
  const endingIndex = totalSegments + 1;

  for (const suggestion of suggestions) {
    const targetIndex = suggestion.index;
    const updatedPrompt = suggestion.updatedPrompt.trim();
    if (targetIndex === 0) {
      draft.posterPrompt = updatedPrompt;
      continue;
    }
    if (targetIndex >= 1 && targetIndex <= totalSegments) {
      draft.segments[targetIndex - 1].imagePrompt = updatedPrompt;
      continue;
    }
    if (targetIndex === endingIndex) {
      draft.endingPrompt = updatedPrompt;
      continue;
    }
    throw new Error(
      `Segmentation judge returned invalid prompt index ${targetIndex}`
    );
  }

  return StorySegmentationSchema.parse(draft);
}

async function reviewSegmentationPrompts(
  initialSegmentation: StorySegmentation,
  generationPrompt: string,
  adapter: ReturnType<typeof useProgress>,
  maxAttempts: number,
  snapshotSaver?: SegmentationAttemptSnapshotSaver
): Promise<{
  segmentation: StorySegmentation;
  attempts: SegmentationReviewAttempt[];
}> {
  if (maxAttempts <= 0) {
    return { segmentation: initialSegmentation, attempts: [] };
  }

  let workingSegmentation = initialSegmentation;
  const attempts: SegmentationReviewAttempt[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const reviewPrompt = buildSegmentationReviewPrompt(
      workingSegmentation,
      generationPrompt
    );
    const parts: Part[] = [{ text: reviewPrompt }];
    adapter.log(`[story/segments/judge] attempt ${attempt} prompt prepared`);
    const sanitisedRequest = parts.map((part) => sanitisePartForLogging(part));
    adapter.log(
      `[story/segments/judge] request prepared with ${sanitisedRequest.length} part(s)`
    );

    const { text, modelVersion, thoughts, elapsedMs, charCount } =
      await runTextModelCall({
        adapter,
        parts,
        thinkingBudget: 16_384,
      });
    const elapsed = formatMillis(elapsedMs);
    adapter.log(
      `[story/segments/judge] attempt ${attempt} model ${modelVersion} finished in ${elapsed} (${charCount} chars)`
    );
    if (thoughts && thoughts.length > 0) {
      adapter.log(
        `[story/segments/judge] attempt ${attempt} thoughts captured (${thoughts.length})`
      );
    }

    await snapshotSaver?.({
      phase: "judge",
      attempt,
      prompt: reviewPrompt,
      response: text,
      modelVersion,
      thoughts,
      charCount,
    });

    let response: SegmentationJudgeResponse | undefined;
    let parseError: string | undefined;
    try {
      const parsedJson = extractJsonObject(text);
      response = SegmentationJudgeResponseSchema.parse(parsedJson);
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
      throw new SegmentationReviewError(
        "Segmentation judge did not return valid JSON.",
        generationPrompt,
        attempts,
        workingSegmentation
      );
    }

    if (response.pass) {
      adapter.log(
        `[story/segments/judge] attempt ${attempt} approved the segmentation prompts`
      );
      return {
        segmentation: workingSegmentation,
        attempts,
      };
    }

    const suggestions = response.suggestions ?? [];
    if (suggestions.length === 0) {
      throw new SegmentationReviewError(
        "Segmentation judge rejected prompts but did not provide suggestions.",
        generationPrompt,
        attempts,
        workingSegmentation
      );
    }

    if (attempt >= maxAttempts) {
      break;
    }

    adapter.log(
      `[story/segments/judge] attempt ${attempt} applying ${suggestions
        .map((s) => s.index)
        .join(", ")}`
    );

    try {
      workingSegmentation = applySegmentationSuggestions(
        workingSegmentation,
        suggestions
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SegmentationReviewError(
        `Segmentation judge suggestions could not be applied: ${message}`,
        generationPrompt,
        attempts,
        workingSegmentation
      );
    }
  }

  throw new SegmentationReviewError(
    `Segmentation judge rejected prompts after ${maxAttempts} attempt(s).`,
    generationPrompt,
    attempts,
    workingSegmentation
  );
}

export async function generateStorySegmentation(
  storyText: string,
  progress?: StoryProgress,
  options?: {
    maxRevisionAttempts?: number;
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

      const rawReviewAttempts =
        options?.maxRevisionAttempts ?? DEFAULT_SEGMENTATION_REVIEW_ATTEMPTS;
      const maxReviewAttempts =
        Number.isFinite(rawReviewAttempts) && rawReviewAttempts >= 0
          ? Math.floor(rawReviewAttempts)
          : DEFAULT_SEGMENTATION_REVIEW_ATTEMPTS;
      let reviewAttempts: SegmentationReviewAttempt[] | undefined;
      if (maxReviewAttempts > 0) {
        const reviewResult = await reviewSegmentationPrompts(
          segmentation,
          prompt,
          adapter,
          maxReviewAttempts,
          options?.onAttemptSnapshot
        );
        segmentation = reviewResult.segmentation;
        if (reviewResult.attempts.length > 0) {
          reviewAttempts = reviewResult.attempts;
        }
      }

      return {
        segmentation,
        prompt,
        modelVersion,
        attempt,
        reviewAttempts,
      };
    } catch (error) {
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

// =====================
// Image judging helpers
// =====================

const JudgeResponseSchema = z.object({
  pass: z.boolean(),
  issuesSummary: z.string().trim().optional(),
  suggestions: z
    .array(
      z.object({
        index: z.number().int().min(1),
        updatedPrompt: z.string().trim().min(1),
        notes: z.string().trim().optional(),
      })
    )
    .optional(),
});
type JudgeResponse = z.infer<typeof JudgeResponseSchema>;

function buildJudgePromptParts(
  allImages: readonly GeneratedStoryImage[],
  focusIndices: readonly number[],
  promptsByIndex: Map<number, string>
): Part[] {
  const parts: Part[] = [];
  const sorted = [...allImages].sort((a, b) => a.index - b.index);
  for (const img of sorted) {
    parts.push({ text: `Image ${img.index}` });
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data.toString("base64"),
      },
    });
  }
  const header: string[] = [
    "You are the image quality judge. Review the images ABOVE first.",
    "After considering them, evaluate ONLY the last four images listed below.",
    "Assess adherence to these basics: subject accuracy, single clear action, grounded historical setting, readable composition, vintage cartoon style fidelity (line art, muted palette, subtle paper texture).",
    'If any writing appears (signage, title card, diagrams), ensure it is spelled correctly, limited to four words or fewer, and period-appropriate; flag long academic titles, paragraphs, or explicit equation-style notation that spells out symbols or formulas. Generic descriptions such as "chalkboard filled with formulas" are acceptable.',
    "Return strict JSON: { pass: boolean, issuesSummary?: string, suggestions?: Array<{ index, updatedPrompt, notes? }> }.",
    "For each suggestion, provide an improved prompt (keep content faithful; adjust composition, lighting, and clarity; do not introduce modern elements).",
    "",
    "Focus on these images and their prompts:",
  ];
  parts.push({ text: header.join("\n") });
  const focus = [...focusIndices].sort((a, b) => a - b);
  for (const idx of focus) {
    const p = promptsByIndex.get(idx) ?? "";
    parts.push({ text: `Image ${idx} prompt: ${p}` });
  }
  parts.push({ text: "Return JSON only." });
  return parts;
}

async function judgeBatch(
  allImages: readonly GeneratedStoryImage[],
  focusIndices: readonly number[],
  promptsByIndex: Map<number, string>,
  adapter: ReturnType<typeof useProgress>
): Promise<{
  response: JudgeResponse;
  rawText: string;
  modelVersion: string;
  requestParts: Part[];
  thoughts?: string[];
}> {
  const judgeParts = buildJudgePromptParts(
    allImages,
    focusIndices,
    promptsByIndex
  );
  const sanitisedRequest = judgeParts.map((part) =>
    sanitisePartForLogging(part)
  );
  adapter.log(
    `[images/judge] request prepared with ${sanitisedRequest.length} part(s)`
  );
  const uploadBytes = estimateUploadBytes(judgeParts);
  const callHandle = adapter.startModelCall({
    modelId: TEXT_MODEL_ID as GeminiModelId,
    uploadBytes,
  });
  const start = Date.now();
  let aggregated = "";
  let modelVersion: string = TEXT_MODEL_ID;
  const thoughts: string[] = [];
  try {
    await runGeminiCall(async (client) => {
      const stream = await client.models.generateContentStream({
        model: TEXT_MODEL_ID,
        contents: [{ role: "user", parts: judgeParts }],
        config: {
          thinkingConfig: { includeThoughts: true, thinkingBudget: 32_768 },
        },
      });
      for await (const chunk of stream) {
        if (chunk.modelVersion) {
          modelVersion = chunk.modelVersion;
        }
        const candidates = chunk.candidates ?? [];
        for (const c of candidates) {
          const ps = c.content?.parts ?? [];
          for (const p of ps) {
            const content = p.text;
            if (!content) {
              continue;
            }
            if (p.thought) {
              thoughts.push(content);
              continue;
            }
            aggregated += content;
          }
        }
      }
    });
  } finally {
    adapter.finishModelCall(callHandle);
  }
  const elapsed = formatMillis(Date.now() - start);
  adapter.log(`[images/judge] model ${modelVersion} finished in ${elapsed}`);
  const json = extractJsonObject(aggregated);
  adapter.log(`[images/judge] raw response text: ${aggregated}`);
  const response = JudgeResponseSchema.parse(json);
  adapter.log(`[images/judge] parsed response: ${JSON.stringify(response)}`);
  if (thoughts.length > 0) {
    adapter.log(`[images/judge] thoughts: ${thoughts.join(" | ")}`);
  }
  return {
    response,
    rawText: aggregated,
    modelVersion,
    requestParts: judgeParts,
    thoughts: thoughts.length > 0 ? [...thoughts] : undefined,
  };
}

// ==============================
// Batched image generation (4x3)
// ==============================

export type ImageBatchArtifact = {
  batchIndex: number;
  promptParts: Part[];
  judge: Array<{
    attempt: number;
    requestPartsCount: number;
    requestPartsSanitised: unknown[];
    responseText: string;
    responseJson: JudgeResponse;
    modelVersion: string;
    thoughts?: string[];
  }>;
};

export type StoryImagesArtifacts = {
  style: readonly string[];
  batches: ImageBatchArtifact[];
};

export async function generateStoryImages(
  segmentation: StorySegmentation,
  progress?: StoryProgress
): Promise<StoryImagesResult & { artifacts?: StoryImagesArtifacts }> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating 12 images in 3 batches of 4");

  // Build 12 prompts: 1 cover, 10 interior (from segmentation), 1 ending
  const coverPrompt = segmentation.posterPrompt.trim();
  const endingPrompt = segmentation.endingPrompt.trim();
  if (!coverPrompt) {
    throw new Error("Segmentation did not include a posterPrompt");
  }
  if (!endingPrompt) {
    throw new Error("Segmentation did not include an endingPrompt");
  }

  const allPrompts: string[] = [];
  allPrompts.push(coverPrompt); // Image 1
  for (let i = 0; i < segmentation.segments.length; i++) {
    const segmentPrompt = segmentation.segments[i]!.imagePrompt.trim();
    if (!segmentPrompt) {
      throw new Error(
        `Segmentation segment ${i + 1} is missing an imagePrompt`
      );
    }
    allPrompts.push(segmentPrompt); // Images 2..11
  }
  allPrompts.push(endingPrompt); // Image 12

  const images: GeneratedStoryImage[] = [];
  const promptsByIndex = new Map<number, string>();
  for (let i = 0; i < allPrompts.length; i++) {
    promptsByIndex.set(i + 1, allPrompts[i]!);
  }

  const artifacts: StoryImagesArtifacts = {
    style: ART_STYLE_VINTAGE_CARTOON,
    batches: [],
  };
  const styleLines = ART_STYLE_VINTAGE_CARTOON;

  let finalModelVersion: string = IMAGE_MODEL_ID;
  let captionsText = "";

  // helper to run a single 4-image call
  const runBatch = async (
    batchIndex: number,
    targetIndices: number[],
    frozenPrefixParts: Part[] | undefined
  ): Promise<{
    promptParts: Part[];
    images: GeneratedStoryImage[];
    modelVersion: string;
    aggregatedText: string;
  }> => {
    const promptPairs = targetIndices.map((idx) => ({
      index: idx,
      prompt: promptsByIndex.get(idx)!,
    }));
    const parts = frozenPrefixParts
      ? [
          ...frozenPrefixParts,
          ...promptPairs.map((p) => ({
            text: `Image ${p.index}: ${p.prompt}`,
          })),
        ]
      : buildFourImageBatchPrompt(styleLines, promptPairs);

    const promptSummary =
      promptPairs.map((p) => `Image ${p.index}: ${p.prompt}`).join(" || ") ||
      "(no additional prompts)";
    adapter.log(
      `[story/images] batch ${batchIndex} prompt summary: ${promptSummary}`
    );
    if (frozenPrefixParts) {
      adapter.log(
        `[story/images] batch ${batchIndex} reusing prefix parts (${frozenPrefixParts.length})`
      );
    }
    const sanitisedRequest = parts.map((part) => sanitisePartForLogging(part));
    adapter.log(
      `[story/images] batch ${batchIndex} request prepared with ${sanitisedRequest.length} part(s)`
    );

    const uploadBytes = estimateUploadBytes(parts);
    const callHandle = adapter.startModelCall({
      modelId: IMAGE_MODEL_ID as GeminiModelId,
      uploadBytes,
    });
    const start = Date.now();

    const batchImages: GeneratedStoryImage[] = [];
    let modelVersion: string = IMAGE_MODEL_ID;
    let aggregatedText = "";

    try {
      await runGeminiCall(async (client) => {
        const stream = await client.models.generateContentStream({
          model: IMAGE_MODEL_ID,
          contents: [{ role: "user", parts }],
          config: {
            responseModalities: ["IMAGE", "TEXT"],
            imageConfig: { aspectRatio: "16:9" },
          },
        });
        let lastPromptTokens = 0;
        let lastCachedTokens = 0;
        let lastThinkingTokens = 0;
        let lastInferenceTokens = 0;

        // We will assign images in the order they arrive to the respective target indices
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
                const ext = extensionFromMime(inlineData.mimeType);
                const mappedIndex =
                  targetIndices[assignCursor] ??
                  targetIndices[targetIndices.length - 1]!;
                const buffer = Buffer.from(inlineData.data, "base64");
                batchImages.push({
                  index: mappedIndex,
                  mimeType: inlineData.mimeType ?? `image/${ext}`,
                  data: buffer,
                });
                adapter.log(
                  `[story/images] batch ${batchIndex} received image ${mappedIndex} (${buffer.length} bytes)`
                );
                assignCursor += 1;
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
              thinkingTokensNow - lastThinkingTokens
            );
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
            lastThinkingTokens = thinkingTokensNow;
            lastInferenceTokens = inferenceTokensNow;
          }
        }
      });
    } finally {
      adapter.finishModelCall(callHandle);
    }

    const elapsed = formatMillis(Date.now() - start);
    adapter.log(
      `[story/images] batch ${batchIndex} model ${modelVersion} generated ${formatInteger(batchImages.length)} illustrations in ${elapsed}`
    );
    if (aggregatedText.trim()) {
      adapter.log(
        `[story/images] batch ${batchIndex} text response: ${aggregatedText.trim()}`
      );
    }
    return {
      promptParts: parts,
      images: batchImages,
      modelVersion,
      aggregatedText,
    };
  };

  // Batch 1: images 1-4
  const b1 = await runBatch(1, [1, 2, 3, 4], undefined);
  finalModelVersion = b1.modelVersion;
  captionsText += b1.aggregatedText;
  // Judge batch 1 (focus on 1-4)
  artifacts.batches.push({
    batchIndex: 1,
    promptParts: b1.promptParts,
    judge: [],
  });
  {
    let pass = false;
    let attempt = 0;
    const maxAttempts = 3;
    while (!pass && attempt < maxAttempts) {
      attempt += 1;
      const j = await judgeBatch(
        [...images, ...b1.images],
        [1, 2, 3, 4],
        promptsByIndex,
        adapter
      );
      artifacts.batches[0]!.judge.push({
        attempt,
        requestPartsCount: j.requestParts.length,
        requestPartsSanitised: j.requestParts.map((p) =>
          sanitisePartForLogging(p)
        ),
        responseText: j.rawText,
        responseJson: j.response,
        modelVersion: j.modelVersion,
        thoughts: j.thoughts,
      });
      adapter.log(
        `[images/judge] batch 1 attempt ${attempt} evaluation: ${JSON.stringify(j.response)}`
      );
      if (j.thoughts && j.thoughts.length > 0) {
        adapter.log(
          `[images/judge] batch 1 attempt ${attempt} thoughts: ${j.thoughts.join(" | ")}`
        );
      }
      pass = j.response.pass;
      if (!pass) {
        const suggestions = j.response.suggestions ?? [];
        for (const s of suggestions) {
          if ([1, 2, 3, 4].includes(s.index)) {
            promptsByIndex.set(s.index, s.updatedPrompt);
          }
        }
        // regenerate the four images with updated prompts (overwrite)
        const retry = await runBatch(
          1,
          [1, 2, 3, 4],
          buildFourImageBatchPrompt(styleLines, [])
        );
        // Clear any images from indices 1..4 and replace
        for (const idx of [1, 2, 3, 4]) {
          const pos = images.findIndex((im) => im.index === idx);
          if (pos >= 0) {
            images.splice(pos, 1);
          }
        }
        for (const im of retry.images) {
          images.push(im);
        }
        captionsText += retry.aggregatedText;
        finalModelVersion = retry.modelVersion;
      }
    }
    // On success or max attempts, accept batch 1 images
    for (const im of b1.images) {
      // If overwritten above due to retry, the last write wins in images[]
      const existing = images.find((x) => x.index === im.index);
      if (!existing) {
        images.push(im);
      }
    }
  }

  // Batch 2: images 5-8. Prepend the exact text parts used previously to enable caching.
  const frozenPrefix = b1.promptParts;
  const b2 = await runBatch(2, [5, 6, 7, 8], frozenPrefix);
  finalModelVersion = b2.modelVersion;
  captionsText += b2.aggregatedText;
  artifacts.batches.push({
    batchIndex: 2,
    promptParts: b2.promptParts,
    judge: [],
  });
  {
    let pass = false;
    let attempt = 0;
    const maxAttempts = 3;
    while (!pass && attempt < maxAttempts) {
      attempt += 1;
      const j = await judgeBatch(
        [...images, ...b1.images, ...b2.images],
        [5, 6, 7, 8],
        promptsByIndex,
        adapter
      );
      artifacts.batches[1]!.judge.push({
        attempt,
        requestPartsCount: j.requestParts.length,
        requestPartsSanitised: j.requestParts.map((p) =>
          sanitisePartForLogging(p)
        ),
        responseText: j.rawText,
        responseJson: j.response,
        modelVersion: j.modelVersion,
        thoughts: j.thoughts,
      });
      adapter.log(
        `[images/judge] batch 2 attempt ${attempt} evaluation: ${JSON.stringify(j.response)}`
      );
      if (j.thoughts && j.thoughts.length > 0) {
        adapter.log(
          `[images/judge] batch 2 attempt ${attempt} thoughts: ${j.thoughts.join(" | ")}`
        );
      }
      pass = j.response.pass;
      if (!pass) {
        const suggestions = j.response.suggestions ?? [];
        for (const s of suggestions) {
          if ([5, 6, 7, 8].includes(s.index)) {
            promptsByIndex.set(s.index, s.updatedPrompt);
          }
        }
        const retry = await runBatch(2, [5, 6, 7, 8], frozenPrefix);
        // Overwrite indices 5..8
        for (const idx of [5, 6, 7, 8]) {
          const pos = images.findIndex((im) => im.index === idx);
          if (pos >= 0) {
            images.splice(pos, 1);
          }
        }
        for (const im of retry.images) {
          images.push(im);
        }
        captionsText += retry.aggregatedText;
        finalModelVersion = retry.modelVersion;
      }
    }
    for (const im of b2.images) {
      const existing = images.find((x) => x.index === im.index);
      if (!existing) {
        images.push(im);
      }
    }
  }

  // Batch 3: images 9-12
  const b3 = await runBatch(3, [9, 10, 11, 12], frozenPrefix);
  finalModelVersion = b3.modelVersion;
  captionsText += b3.aggregatedText;
  artifacts.batches.push({
    batchIndex: 3,
    promptParts: b3.promptParts,
    judge: [],
  });
  {
    let pass = false;
    let attempt = 0;
    const maxAttempts = 3;
    while (!pass && attempt < maxAttempts) {
      attempt += 1;
      const j = await judgeBatch(
        [...images, ...b1.images, ...b2.images, ...b3.images],
        [9, 10, 11, 12],
        promptsByIndex,
        adapter
      );
      artifacts.batches[2]!.judge.push({
        attempt,
        requestPartsCount: j.requestParts.length,
        requestPartsSanitised: j.requestParts.map((p) =>
          sanitisePartForLogging(p)
        ),
        responseText: j.rawText,
        responseJson: j.response,
        modelVersion: j.modelVersion,
        thoughts: j.thoughts,
      });
      adapter.log(
        `[images/judge] batch 3 attempt ${attempt} evaluation: ${JSON.stringify(j.response)}`
      );
      if (j.thoughts && j.thoughts.length > 0) {
        adapter.log(
          `[images/judge] batch 3 attempt ${attempt} thoughts: ${j.thoughts.join(" | ")}`
        );
      }
      pass = j.response.pass;
      if (!pass) {
        const suggestions = j.response.suggestions ?? [];
        for (const s of suggestions) {
          if ([9, 10, 11, 12].includes(s.index)) {
            promptsByIndex.set(s.index, s.updatedPrompt);
          }
        }
        const retry = await runBatch(3, [9, 10, 11, 12], frozenPrefix);
        // Overwrite indices 9..12
        for (const idx of [9, 10, 11, 12]) {
          const pos = images.findIndex((im) => im.index === idx);
          if (pos >= 0) {
            images.splice(pos, 1);
          }
        }
        for (const im of retry.images) {
          images.push(im);
        }
        captionsText += retry.aggregatedText;
        finalModelVersion = retry.modelVersion;
      }
    }
    for (const im of b3.images) {
      const existing = images.find((x) => x.index === im.index);
      if (!existing) {
        images.push(im);
      }
    }
  }

  // Build a single human-readable prompt snapshot: style + Image 1..12 lines
  const snapshotLines: string[] = ["Style Requirements:", ...styleLines, ""];
  for (let i = 1; i <= allPrompts.length; i++) {
    snapshotLines.push(`Image ${i}: ${promptsByIndex.get(i)}`);
  }

  return {
    images: images.sort((a, b) => a.index - b.index),
    prompt: snapshotLines.join("\n"),
    modelVersion: finalModelVersion,
    captions: captionsText.trim() || undefined,
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
  // We now generate 12 images total: 1 cover, 10 interior panels, 1 ending.
  // For media segments we only use the 10 interior images (indices 2..11).
  const interior = images.images.filter(
    (im) => im.index >= 2 && im.index <= 11
  );
  if (interior.length !== segmentation.segmentation.segments.length) {
    throw new Error(
      `Expected ${segmentation.segmentation.segments.length} interior images (2..11), received ${interior.length}`
    );
  }

  const storage = getFirebaseAdminStorage(undefined, {
    storageBucket: options.storageBucket,
  });
  const bucket = storage.bucket(options.storageBucket);

  const storagePaths: string[] = [];
  for (let i = 0; i < interior.length; i++) {
    const image = interior[i]!;
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
