import { Type, type Schema } from "@google/genai";
import { z } from "zod";
import { getSharp } from "../utils/sharp";

import {
  generateImages,
  generateJson,
  toGeminiJsonSchema,
  type LlmContentPart,
  type LlmDebugOptions,
  type LlmImageData,
  type LlmImageModelId,
  type LlmImageSize,
  type LlmTextModelId,
} from "../utils/llm";
import type { JobProgressReporter } from "../utils/concurrency";
import { STORY_IMAGE_GRADING_PROMPT } from "./imageGradingPrompt";

const IMAGE_GENERATION_MAX_ATTEMPTS = 4;
const BATCH_GENERATE_MAX_ATTEMPTS = 3;
const PROMPT_REVISION_MIN_ATTEMPT_FOR_REDO_BATCH = 1;
const PROMPT_REVISION_MAX_PER_BATCH = 1;
const PROMPT_REVISION_MAX_EVIDENCE_FRAMES = 5;
const PROMPT_REVISION_THUMBNAIL_WIDTH = 480;

type CatastrophicFinding = {
  frameIndex: number;
  reason: string;
};

type BatchGradeOutcome = {
  outcome: "accept" | "redo_batch" | "redo_frames";
  findings: CatastrophicFinding[];
  summary: string;
  batchReason?: string;
};

type BatchGradeItem = {
  frameIndex: number;
  prompt: string;
  image: LlmImageData;
};

type FrameComparisonCandidate = {
  candidateIndex: number;
  image: LlmImageData;
};

type FrameComparisonResult = {
  winnerCandidateIndex: number;
  reasoning: string;
  catastrophicCandidates: {
    candidateIndex: number;
    reason: string;
  }[];
};

const FrameComparisonSchema = z
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
    catastrophicCandidates: raw.catastrophic_candidates.map((entry) => ({
      candidateIndex: entry.index,
      reason: entry.reason,
    })),
  }));

type FrameComparisonResponse = z.infer<typeof FrameComparisonSchema>;

const FRAME_COMPARISON_RESPONSE_SCHEMA: Schema = {
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

const BatchGradeResponseSchema = z
  .object({
    outcome: z.enum(["accept", "redo_batch", "redo_frames"]),
    catastrophic_batch_reason: z.string().trim().optional(),
    frames_to_redo: z
      .array(
        z.object({
          frame_index: z.number().int().min(1),
          reason: z.string().trim().min(1),
        }),
      )
      .default([]),
    summary: z.string().trim().optional(),
  })
  .transform((raw) => ({
    outcome: raw.outcome,
    batchReason: raw.catastrophic_batch_reason ?? "",
    findings: raw.frames_to_redo.map((item) => ({
      frameIndex: item.frame_index,
      reason: item.reason,
    })),
    summary: raw.summary ?? "",
  }));

type BatchGradeResponse = z.infer<typeof BatchGradeResponseSchema>;

const BATCH_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["outcome", "frames_to_redo"],
  propertyOrdering: [
    "outcome",
    "summary",
    "catastrophic_batch_reason",
    "frames_to_redo",
  ],
  properties: {
    outcome: {
      type: Type.STRING,
      enum: ["accept", "redo_batch", "redo_frames"],
    },
    catastrophic_batch_reason: { type: Type.STRING },
    summary: { type: Type.STRING },
    frames_to_redo: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["frame_index", "reason"],
        propertyOrdering: ["frame_index", "reason"],
        properties: {
          frame_index: { type: Type.NUMBER, minimum: 1 },
          reason: { type: Type.STRING, minLength: "1" },
        },
      },
    },
  },
};

const FramePromptRevisionResponseSchema = z
  .object({
    summary: z.string().trim().optional(),
    replacements: z
      .array(
        z.object({
          frame_index: z.number().int().min(1),
          rationale: z.string().trim().min(1),
          updated_prompt: z.string().trim().min(1),
        }),
      )
      .min(1),
  })
  .transform((raw) => ({
    summary: raw.summary ?? "",
    replacements: raw.replacements.map((entry) => ({
      frameIndex: entry.frame_index,
      rationale: entry.rationale,
      updatedPrompt: entry.updated_prompt,
    })),
  }));

type FramePromptRevisionResponse = z.infer<
  typeof FramePromptRevisionResponseSchema
>;

const FRAME_PROMPT_REVISION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["replacements"],
  propertyOrdering: ["summary", "replacements"],
  properties: {
    summary: { type: Type.STRING },
    replacements: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["frame_index", "updated_prompt", "rationale"],
        propertyOrdering: ["frame_index", "updated_prompt", "rationale"],
        properties: {
          frame_index: { type: Type.NUMBER, minimum: 1 },
          updated_prompt: { type: Type.STRING, minLength: "1" },
          rationale: { type: Type.STRING, minLength: "1" },
        },
      },
    },
  },
};

type FrameSemanticScores = {
  promptAlignment: number;
  narrationAlignment: number;
  subjectPresence: number;
  compositionRisk: number;
  textArtifactRisk: number;
};

type FrameSemanticAssessment = {
  caption: string;
  issues: string[];
  scores: FrameSemanticScores;
};

const FrameSemanticAssessmentSchema = z
  .object({
    caption: z.string().trim().min(1),
    issues: z.array(z.string().trim().min(1)).default([]),
    scores: z.object({
      prompt_alignment: z.number().min(0).max(1),
      narration_alignment: z.number().min(0).max(1),
      subject_presence: z.number().min(0).max(1),
      composition_risk: z.number().min(0).max(1),
      text_artifact_risk: z.number().min(0).max(1),
    }),
  })
  .transform((raw) => ({
    caption: raw.caption,
    issues: raw.issues,
    scores: {
      promptAlignment: raw.scores.prompt_alignment,
      narrationAlignment: raw.scores.narration_alignment,
      subjectPresence: raw.scores.subject_presence,
      compositionRisk: raw.scores.composition_risk,
      textArtifactRisk: raw.scores.text_artifact_risk,
    },
  }));

type FrameSemanticAssessmentResponse = z.infer<
  typeof FrameSemanticAssessmentSchema
>;

const FRAME_SEMANTIC_ASSESSMENT_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["caption", "scores"],
  propertyOrdering: ["caption", "issues", "scores"],
  properties: {
    caption: { type: Type.STRING, minLength: "1" },
    issues: {
      type: Type.ARRAY,
      items: { type: Type.STRING, minLength: "1" },
    },
    scores: {
      type: Type.OBJECT,
      required: [
        "prompt_alignment",
        "narration_alignment",
        "subject_presence",
        "composition_risk",
        "text_artifact_risk",
      ],
      propertyOrdering: [
        "prompt_alignment",
        "narration_alignment",
        "subject_presence",
        "composition_risk",
        "text_artifact_risk",
      ],
      properties: {
        prompt_alignment: { type: Type.NUMBER, minimum: 0, maximum: 1 },
        narration_alignment: { type: Type.NUMBER, minimum: 0, maximum: 1 },
        subject_presence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
        composition_risk: { type: Type.NUMBER, minimum: 0, maximum: 1 },
        text_artifact_risk: { type: Type.NUMBER, minimum: 0, maximum: 1 },
      },
    },
  },
};

type FramePromptRevisionEvidence = {
  frameIndex: number;
  graderFinding?: string;
  semantic?: FrameSemanticAssessment;
  thumbnail?: LlmImageData;
};

type GenerateStoryFramesOptions = {
  imageModelId: LlmImageModelId;
  gradingModelId: LlmTextModelId;
  stylePrompt: string;
  imagePrompts: readonly string[];
  batchSize: number;
  overlapSize: number;
  gradeCatastrophicDescription: string;
  styleImages?: readonly LlmImageData[];
  progress: JobProgressReporter;
  debug?: LlmDebugOptions;
  imageAspectRatio?: string;
  imageSize?: LlmImageSize;
  frameNarrationByIndex?: ReadonlyMap<number, readonly string[]>;
};

type GenerateBatchParams = {
  batchIndex: number;
  globalIndices: readonly number[];
  prompts: string[];
  styleImages: readonly LlmImageData[];
};

function extendDebug(
  debug: LlmDebugOptions | undefined,
  suffix: string,
): LlmDebugOptions | undefined {
  if (!debug) {
    return undefined;
  }
  const cleanedSuffix = suffix
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join("/");
  const nextSubStage = debug.subStage
    ? `${debug.subStage}/${cleanedSuffix}`
    : cleanedSuffix;
  return {
    ...debug,
    subStage: nextSubStage,
  };
}

function toInlinePart(image: LlmImageData): LlmContentPart {
  return {
    type: "inlineData",
    data: image.data.toString("base64"),
    mimeType: image.mimeType ?? "image/png",
  };
}

function addTextPart(parts: LlmContentPart[], text: string): void {
  if (parts.length === 0) {
    parts.push({ type: "text", text });
    return;
  }
  const last = parts[parts.length - 1];
  if (last.type === "text") {
    last.text = `${last.text}\n${text}`;
    return;
  }
  parts.push({ type: "text", text });
}

function padNumber(value: number): string {
  return value.toString().padStart(2, "0");
}

function buildCatastrophicChecklist(description: string): string {
  const lines: string[] = [
    "Catastrophic failure means the frame cannot be used without a regeneration.",
    description,
    "",
    "If none of the catastrophic failures are present, accept the batch.",
  ];
  return lines.join("\n");
}

function buildBatchGradeContents(params: {
  catDescription: string;
  stylePrompt: string;
  styleImages: readonly LlmImageData[];
  items: readonly BatchGradeItem[];
  checkNewOnly: boolean;
}): { role: "user"; parts: LlmContentPart[] }[] {
  const { catDescription, stylePrompt, styleImages, items, checkNewOnly } =
    params;
  const parts: LlmContentPart[] = [];
  addTextPart(
    parts,
    [
      "You are the catastrophic failure catcher for storyboard panels.",
      buildCatastrophicChecklist(catDescription),
      "",
      `Style prompt (for reference):\n${stylePrompt}`,
    ].join("\n"),
  );
  if (styleImages.length > 0) {
    addTextPart(
      parts,
      "\nStyle reference images (follow their palette, rendering style, and character appearance):",
    );
    for (const image of styleImages) {
      parts.push(toInlinePart(image));
    }
  }
  addTextPart(
    parts,
    [
      "",
      checkNewOnly
        ? "Evaluate ONLY the resubmitted frames below. Ignore the style references except to confirm they remain consistent."
        : "Evaluate each frame in this batch for catastrophic failures or consistency issues.",
      "",
      "Possible outcomes:",
      '- `"accept"` if everything is usable.',
      '- `"redo_frames"` when only specific frames must be regenerated. List them under `frames_to_redo`.',
      '- `"redo_batch"` if the entire batch must be regenerated from scratch. Provide a short `catastrophic_batch_reason`.',
      "",
      "For every frame include:",
      "- Frame number (1-based index across the storyboard).",
      "- Illustration prompt.",
      "- The rendered image (inline).",
    ].join("\n"),
  );
  for (const entry of items) {
    addTextPart(parts, `\nFrame ${entry.frameIndex}: ${entry.prompt}`);
    parts.push(toInlinePart(entry.image));
  }
  addTextPart(
    parts,
    [
      "",
      "Respond in JSON using the provided schema.",
      'If only some frames fail, set `"outcome":"redo_frames"` and list the frames to redo.',
      'If the entire batch collapses (for example split panels, hard borders, inconsistent characters), return `"outcome":"redo_batch"` and explain briefly.',
      'Otherwise set `"outcome":"accept"`.',
    ].join("\n"),
  );
  return [
    {
      role: "user" as const,
      parts,
    },
  ];
}

async function gradeBatch(params: {
  options: GenerateStoryFramesOptions;
  styleImages: readonly LlmImageData[];
  items: readonly BatchGradeItem[];
  checkNewOnly: boolean;
  debugSuffix: string;
}): Promise<BatchGradeOutcome> {
  const { options, styleImages, items, checkNewOnly, debugSuffix } = params;
  const payload: BatchGradeResponse = await generateJson({
    modelId: options.gradingModelId,
    progress: options.progress,
    schema: BatchGradeResponseSchema,
    responseJsonSchema: toGeminiJsonSchema(BATCH_GRADE_RESPONSE_SCHEMA),
    debug: extendDebug(options.debug, debugSuffix),
    contents: buildBatchGradeContents({
      catDescription: options.gradeCatastrophicDescription,
      stylePrompt: options.stylePrompt,
      styleImages,
      items,
      checkNewOnly,
    }),
  });
  return {
    outcome: payload.outcome,
    findings: payload.findings,
    summary: payload.summary,
    batchReason: payload.batchReason || undefined,
  };
}

async function selectBestRedoFrameCandidate(params: {
  progress: JobProgressReporter;
  gradingModelId: LlmTextModelId;
  stylePrompt: string;
  styleImages: readonly LlmImageData[];
  catastrophicDescription: string;
  prompt: string;
  frameIndex: number;
  candidates: readonly FrameComparisonCandidate[];
  debug?: LlmDebugOptions;
}): Promise<FrameComparisonResult> {
  const {
    progress,
    gradingModelId,
    stylePrompt,
    styleImages,
    catastrophicDescription,
    prompt,
    frameIndex,
    candidates,
    debug,
  } = params;
  if (candidates.length < 2) {
    throw new Error(
      `Frame ${frameIndex} comparison requires at least two candidates`,
    );
  }

  const parts: LlmContentPart[] = [];
  addTextPart(
    parts,
    [
      "You are adjudicating a storyboard frame after a redo attempt still showed issues.",
      `Frame ${frameIndex} prompt:\n${prompt}`,
      "",
      "Compare the candidates and pick the image we should keep.",
      "Candidate 1 is the previous frame image; Candidate 2 is the latest redo attempt.",
      "Prioritise the one that best fits the prompt, preserves character continuity, and avoids catastrophic failures.",
      "If both are flawed, choose the least harmful option and explain the trade-off.",
      "",
      "Catastrophic checklist:",
      catastrophicDescription,
      "",
      `Style prompt reference:\n${stylePrompt}`,
    ].join("\n"),
  );

  if (styleImages.length > 0) {
    addTextPart(
      parts,
      "\nStyle references (ensure palette, medium, and protagonist consistency):",
    );
    for (const image of styleImages) {
      parts.push(toInlinePart(image));
    }
  }

  for (const candidate of candidates) {
    addTextPart(
      parts,
      `\nCandidate ${candidate.candidateIndex}: consider whether this image should be kept.`,
    );
    parts.push(toInlinePart(candidate.image));
  }

  addTextPart(
    parts,
    [
      "",
      "Respond in JSON using the provided schema.",
      'Set `"winner_index"` to the winning candidate number (1-based).',
      'Explain your decision in `"reasoning"` with a short paragraph.',
      'List any disqualified candidates under `"catastrophic_candidates"`.',
    ].join("\n"),
  );

  const response = await generateJson<FrameComparisonResponse>({
    progress,
    modelId: gradingModelId,
    contents: [{ role: "user", parts }],
    schema: FrameComparisonSchema,
    responseJsonSchema: toGeminiJsonSchema(FRAME_COMPARISON_RESPONSE_SCHEMA),
    debug,
  });

  return response;
}

function collectBatchStyleImages(params: {
  baseStyleImages: readonly LlmImageData[];
  generatedSoFar: readonly LlmImageData[];
  overlapSize: number;
}): readonly LlmImageData[] {
  const { baseStyleImages, generatedSoFar, overlapSize } = params;
  if (overlapSize <= 0 || generatedSoFar.length === 0) {
    return baseStyleImages;
  }
  const overlapStart = Math.max(generatedSoFar.length - overlapSize, 0);
  return [...baseStyleImages, ...generatedSoFar.slice(overlapStart)];
}

function buildFrameSemanticAssessmentContents(params: {
  prompt: string;
  narrationLines: readonly string[];
  image: LlmImageData;
}): { role: "user"; parts: LlmContentPart[] }[] {
  const { prompt, narrationLines, image } = params;
  const parts: LlmContentPart[] = [];
  addTextPart(
    parts,
    [
      "You are the captioner and alignment rater for storyboard illustration attempts.",
      "Describe exactly what is visible, then evaluate how well it matches the intended prompt and narration.",
      "",
      "Return JSON only, following the provided schema.",
    ].join("\n"),
  );
  addTextPart(parts, ["", "Original illustration prompt:", prompt].join("\n"));
  if (narrationLines.length > 0) {
    addTextPart(
      parts,
      [
        "",
        "Narration context (what must remain true):",
        ...narrationLines.map((line) => `- ${line}`),
      ].join("\n"),
    );
  }
  addTextPart(parts, "\nRendered image under review:");
  parts.push(toInlinePart(image));
  addTextPart(
    parts,
    [
      "",
      "Scoring guidance:",
      "- `prompt_alignment`, `narration_alignment`, and `subject_presence` range from 0 (missing) to 1 (perfect).",
      "- `composition_risk` and `text_artifact_risk` also range 0-1, where higher means more risk.",
      "- Keep `caption` neutral and factual. Do not speculate.",
      "- Add short `issues` when any score falls below 0.7; each issue must be a concise fragment.",
      "- Flag as issues any neon/glowing overlays, text or symbols floating in the air, holographic UI/HUD elements, or attempts to visualize abstract entities instead of physical artifacts. Such cases increase `composition_risk`.",
      "",
      "Respond strictly in JSON with `caption`, `scores`, and optional `issues`.",
    ].join("\n"),
  );
  return [{ role: "user" as const, parts }];
}

async function assessFrameSemantic(params: {
  progress: JobProgressReporter;
  gradingModelId: LlmTextModelId;
  prompt: string;
  narrationLines: readonly string[];
  image: LlmImageData;
  debug: LlmDebugOptions | undefined;
}): Promise<FrameSemanticAssessment> {
  const { progress, gradingModelId, prompt, narrationLines, image, debug } =
    params;
  const contents = buildFrameSemanticAssessmentContents({
    prompt,
    narrationLines,
    image,
  });
  const response = await generateJson<FrameSemanticAssessmentResponse>({
    progress,
    modelId: gradingModelId,
    contents,
    schema: FrameSemanticAssessmentSchema,
    responseJsonSchema: toGeminiJsonSchema(
      FRAME_SEMANTIC_ASSESSMENT_RESPONSE_SCHEMA,
    ),
    debug,
  });
  return response;
}

async function makePromptRevisionThumbnail(
  image: LlmImageData,
): Promise<LlmImageData | undefined> {
  try {
    const sharp = getSharp();
    const buffer = await sharp(image.data)
      .resize({
        width: PROMPT_REVISION_THUMBNAIL_WIDTH,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 75 })
      .toBuffer();
    return {
      data: buffer,
      mimeType: "image/jpeg",
    };
  } catch {
    return undefined;
  }
}

async function collectPromptRevisionEvidence(params: {
  batchItems: readonly BatchGradeItem[];
  grade: BatchGradeOutcome;
  batch: GenerateBatchParams;
  batchAttempt: number;
  frameNarrationByIndex: ReadonlyMap<number, readonly string[]>;
  progress: JobProgressReporter;
  gradingModelId: LlmTextModelId;
  debug: LlmDebugOptions | undefined;
}): Promise<FramePromptRevisionEvidence[]> {
  const {
    batchItems,
    grade,
    batch,
    batchAttempt,
    frameNarrationByIndex,
    progress,
    gradingModelId,
    debug,
  } = params;
  const evidence: FramePromptRevisionEvidence[] = [];
  const findingsByFrame = new Map<number, string>();
  for (const finding of grade.findings) {
    if (!findingsByFrame.has(finding.frameIndex)) {
      findingsByFrame.set(finding.frameIndex, finding.reason);
    }
  }
  const frameIndices = batchItems.map((item) => item.frameIndex);
  const targetSet = new Set<number>();
  for (const finding of grade.findings) {
    if (
      targetSet.size >= PROMPT_REVISION_MAX_EVIDENCE_FRAMES ||
      !frameIndices.includes(finding.frameIndex)
    ) {
      continue;
    }
    targetSet.add(finding.frameIndex);
  }
  if (
    targetSet.size <
    Math.min(frameIndices.length, PROMPT_REVISION_MAX_EVIDENCE_FRAMES)
  ) {
    for (const frameIndex of frameIndices) {
      if (targetSet.size >= PROMPT_REVISION_MAX_EVIDENCE_FRAMES) {
        break;
      }
      targetSet.add(frameIndex);
    }
  }
  const selectedFrameIndices = frameIndices.filter((index) =>
    targetSet.has(index),
  );
  for (const frameIndex of selectedFrameIndices) {
    const item = batchItems.find((entry) => entry.frameIndex === frameIndex);
    if (!item) {
      continue;
    }
    const entry: FramePromptRevisionEvidence = {
      frameIndex,
    };
    const finding = findingsByFrame.get(frameIndex);
    if (finding) {
      entry.graderFinding = finding;
    }
    try {
      const thumbnail = await makePromptRevisionThumbnail(item.image);
      if (thumbnail) {
        entry.thumbnail = thumbnail;
      }
    } catch {
      progress.log(
        `[story/frames] Failed to generate thumbnail for frame ${frameIndex}`,
      );
    }
    try {
      const debugForFrame = extendDebug(
        debug,
        `semantic-frame-${padNumber(frameIndex)}`,
      );
      const narrationLines = frameNarrationByIndex.get(frameIndex) ?? [];
      const semantic = await assessFrameSemantic({
        progress,
        gradingModelId,
        prompt: item.prompt,
        narrationLines,
        image: item.image,
        debug: debugForFrame,
      });
      entry.semantic = semantic;
      const issuesSuffix =
        semantic.issues.length > 0
          ? ` issues: ${semantic.issues.join("; ")}`
          : "";
      const { scores } = semantic;
      progress.log(
        `[story/frames] Batch ${batch.batchIndex + 1} attempt ${batchAttempt} semantic frame ${frameIndex} pa=${scores.promptAlignment.toFixed(2)} na=${scores.narrationAlignment.toFixed(2)} sp=${scores.subjectPresence.toFixed(2)} comp=${scores.compositionRisk.toFixed(2)} text=${scores.textArtifactRisk.toFixed(2)}${issuesSuffix ? ` (${issuesSuffix})` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      progress.log(
        `[story/frames] Semantic scoring failed for frame ${frameIndex}: ${message}`,
      );
    }
    evidence.push(entry);
  }
  return evidence;
}

function buildFramePromptRevisionContents(params: {
  stylePrompt: string;
  catastrophicDescription: string;
  failureSummaries: readonly string[];
  frameIndices: readonly number[];
  prompts: readonly string[];
  frameNarrationByIndex: ReadonlyMap<number, readonly string[]>;
  evidenceByFrame: ReadonlyMap<number, FramePromptRevisionEvidence>;
}): { role: "user"; parts: LlmContentPart[] }[] {
  const {
    stylePrompt,
    catastrophicDescription,
    failureSummaries,
    frameIndices,
    prompts,
    frameNarrationByIndex,
    evidenceByFrame,
  } = params;
  const parts: LlmContentPart[] = [];
  addTextPart(
    parts,
    [
      "You are revising storyboard illustration prompts after the image renderer collapsed on multiple attempts.",
      "The goal is to keep the same narrative beats while rewriting each prompt so the image model can produce a grounded, distinct scene.",
      "Rules:",
      "- Keep the spirit of the narration, but adjust the staging or focus to something recognisable and easy to depict.",
      "- Prefer simpler, specific actions or settings drawn from everyday environments.",
      "- Never depict the listener or a second-person stand‑in. Do not use 'you', 'student', 'apprentice', 'listener', or 'audience' as subjects; if a modern tie‑in is needed, express it via objects or settings, not by showing the listener.",
      "- Keep visuals physically meaningful and period-aware: do not request neon or holographic overlays, floating text/labels, glowing symbols, HUD-style UI, or abstract entities drawn in mid‑air. If writing is implied, place it on physical surfaces only.",
      "- Describe one focal action, avoid mirrored/split scenes, and limit supporting details to what the narration requires.",
      "- Align with the narration’s intent instead of cherry-picking keywords. Treat metaphors or idioms figuratively unless the story states otherwise.",
      "- Ensure each replacement creates a noticeably different scene from adjacent panels—do not suggest small pose tweaks or near-duplicate settings.",
      "- Use fresh phrasing so the renderer does not default to the prior collapsed composition.",
      "",
      "Camera & focus flexibility:",
      "- Change the camera angle or focal subject when it helps break repeated protagonist close-ups.",
      "- Highlight props or documents when narration allows it (for example: parchment, instruments, chalkboard workings).",
      "- Exclude the protagonist entirely if the narration still makes sense; be explicit when doing so.",
      "- Keep single-scene compositions; avoid multi-panel layouts, mirrored staging, or heavy borders.",
      "",
      "Catastrophic checklist to avoid:",
      catastrophicDescription,
      "",
      "Style reference (do not repeat verbatim, but keep consistency in mind):",
      stylePrompt,
    ].join("\n"),
  );
  if (failureSummaries.length > 0) {
    addTextPart(parts, "\nJudge feedback from failed attempts:");
    failureSummaries.forEach((summary, index) => {
      const label = `Attempt ${index + 1}`;
      addTextPart(parts, `${label}: ${summary}`);
    });
  }
  addTextPart(
    parts,
    [
      "",
      "Rewrite every frame prompt listed below.",
      "For each frame provide an updated prompt that keeps the narration intact but changes the scene, simplifies staging, or grounds the action so the renderer avoids collapsing.",
      "Return JSON using the provided schema with `replacements`. Each entry must include:",
      "- `frame_index` — 1-based index matching the frame number below.",
      "- `updated_prompt` — the new illustration prompt.",
      "- `rationale` — brief explanation of how the change prevents collapse.",
    ].join("\n"),
  );
  frameIndices.forEach((frameIndex, idx) => {
    const prompt = prompts[idx] ?? "";
    const narrationLines = frameNarrationByIndex.get(frameIndex) ?? [];
    addTextPart(
      parts,
      [
        "",
        `Frame ${frameIndex}`,
        narrationLines.length > 0
          ? `Narration context:\n${narrationLines
              .map((line) => `- ${line}`)
              .join("\n")}`
          : "Narration context: (not provided)",
        `Previous illustration prompt:\n${prompt}`,
      ].join("\n"),
    );
    const evidence = evidenceByFrame.get(frameIndex);
    if (evidence?.thumbnail) {
      addTextPart(parts, "\nRendered attempt thumbnail (for reference):");
      parts.push(toInlinePart(evidence.thumbnail));
    }
    if (evidence?.graderFinding) {
      addTextPart(parts, `\nGrader finding: ${evidence.graderFinding}`);
    }
    if (evidence?.semantic) {
      const { caption, scores, issues } = evidence.semantic;
      const scoreLine = [
        `prompt_alignment=${scores.promptAlignment.toFixed(2)}`,
        `narration_alignment=${scores.narrationAlignment.toFixed(2)}`,
        `subject_presence=${scores.subjectPresence.toFixed(2)}`,
        `composition_risk=${scores.compositionRisk.toFixed(2)}`,
        `text_artifact_risk=${scores.textArtifactRisk.toFixed(2)}`,
      ].join(", ");
      const issueLines =
        issues.length > 0
          ? `- Semantic issues: ${issues.join("; ")}`
          : undefined;
      addTextPart(
        parts,
        [
          "",
          "Semantic check:",
          `- Caption: ${caption}`,
          `- Scores (0-1): ${scoreLine}`,
          ...(issueLines ? [issueLines] : []),
        ].join("\n"),
      );
    }
  });
  addTextPart(
    parts,
    [
      "",
      "Respond only with JSON conforming to the schema. Include a concise `summary` when the replacements share a theme.",
    ].join("\n"),
  );
  return [{ role: "user" as const, parts }];
}

async function requestFramePromptRevisions(params: {
  gradingModelId: LlmTextModelId;
  progress: JobProgressReporter;
  debug: LlmDebugOptions | undefined;
  stylePrompt: string;
  catastrophicDescription: string;
  batch: GenerateBatchParams;
  failureSummaries: readonly string[];
  frameNarrationByIndex: ReadonlyMap<number, readonly string[]>;
  evidence: readonly FramePromptRevisionEvidence[];
}): Promise<FramePromptRevisionResponse> {
  const frameIndices = params.batch.globalIndices.map((index) => index + 1);
  const evidenceByFrame = new Map<number, FramePromptRevisionEvidence>();
  for (const entry of params.evidence) {
    if (!evidenceByFrame.has(entry.frameIndex)) {
      evidenceByFrame.set(entry.frameIndex, entry);
    }
  }
  const contents = buildFramePromptRevisionContents({
    stylePrompt: params.stylePrompt,
    catastrophicDescription: params.catastrophicDescription,
    failureSummaries: params.failureSummaries,
    frameIndices,
    prompts: params.batch.prompts,
    frameNarrationByIndex: params.frameNarrationByIndex,
    evidenceByFrame,
  });
  return generateJson<FramePromptRevisionResponse>({
    modelId: params.gradingModelId,
    progress: params.progress,
    contents,
    schema: FramePromptRevisionResponseSchema,
    responseJsonSchema: toGeminiJsonSchema(
      FRAME_PROMPT_REVISION_RESPONSE_SCHEMA,
    ),
    debug: params.debug,
  });
}

export async function generateStoryFrames(
  options: GenerateStoryFramesOptions,
): Promise<LlmImageData[]> {
  const {
    imagePrompts,
    batchSize,
    overlapSize,
    progress,
    imageModelId,
    stylePrompt,
    styleImages,
    debug,
    imageAspectRatio,
    imageSize,
    frameNarrationByIndex,
  } = options;

  if (batchSize <= 0) {
    throw new Error("batchSize must be greater than zero");
  }
  if (imagePrompts.length === 0) {
    return [];
  }

  const narrationLookup =
    frameNarrationByIndex ?? new Map<number, readonly string[]>();
  const workingImagePrompts = [...imagePrompts];

  const baseStyleImages = styleImages ? [...styleImages] : [];
  const generated: LlmImageData[] = [];
  const totalBatches = Math.ceil(imagePrompts.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const startIndex = batchIndex * batchSize;
    const endIndex = Math.min(startIndex + batchSize, imagePrompts.length);
    const batchLength = endIndex - startIndex;
    const globalIndices = Array.from(
      { length: batchLength },
      (_, offset) => startIndex + offset,
    );
    const prompts = globalIndices.map((globalIndex) => {
      const prompt = workingImagePrompts[globalIndex];
      if (prompt === undefined) {
        throw new Error(
          `Storyboard prompt ${globalIndex + 1} is undefined for batch ${
            batchIndex + 1
          }`,
        );
      }
      return prompt;
    });
    const styleImagesForBatch = collectBatchStyleImages({
      baseStyleImages,
      generatedSoFar: generated,
      overlapSize,
    });
    const batch: GenerateBatchParams = {
      batchIndex,
      globalIndices,
      prompts: [...prompts],
      styleImages: styleImagesForBatch,
    };
    const batchFeedbackLog: string[] = [];
    let promptRevisionRequests = 0;

    // Adaptive fallback flags per STORY_RELIABLE_GENERATION_IDEAS.md
    // - Switch to single-frame generation when a batch collapses systemically
    // - Purge style overlap for the batch after a redo_batch to avoid reinforcing failures
    let forceSingleFrameMode = false;
    let purgeStyleReferences = false;

    let batchSuccess = false;
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= BATCH_GENERATE_MAX_ATTEMPTS;
      attempt += 1
    ) {
      progress.log(
        `[story/frames] Generating batch ${batchIndex + 1}/${totalBatches} (attempt ${attempt})`,
      );

      try {
        // Decide style context for this attempt
        const attemptStyleImages = purgeStyleReferences
          ? [...baseStyleImages]
          : batch.styleImages;

        // Generate images either in batch-mode or single-frame mode
        let generatedImages: LlmImageData[] = [];
        const generateDebugSuffix = `batch-${padNumber(
          batchIndex + 1,
        )}/generate-${padNumber(attempt)}${forceSingleFrameMode ? "-single" : ""}`;

        if (!forceSingleFrameMode) {
          generatedImages = await generateImages({
            progress,
            modelId: imageModelId,
            stylePrompt,
            styleImages: attemptStyleImages,
            imagePrompts: batch.prompts,
            imageGradingPrompt: STORY_IMAGE_GRADING_PROMPT,
            maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
            imageAspectRatio,
            imageSize,
            debug: extendDebug(debug, generateDebugSuffix),
          });
        } else {
          const singles: LlmImageData[] = [];
          for (let i = 0; i < batch.prompts.length; i += 1) {
            const single = await generateImages({
              progress,
              modelId: imageModelId,
              stylePrompt,
              styleImages: attemptStyleImages,
              imagePrompts: [batch.prompts[i]],
              imageGradingPrompt: STORY_IMAGE_GRADING_PROMPT,
              maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
              imageAspectRatio,
              imageSize,
              debug: extendDebug(
                debug,
                `${generateDebugSuffix}/frame-${padNumber(
                  batch.globalIndices[i] + 1,
                )}`,
              ),
            });
            if (single.length > 0) {
              singles.push(single[0]);
            }
          }
          generatedImages = singles;
        }

        if (generatedImages.length < batch.prompts.length) {
          // On final attempt, try filling the remainder one-by-one to avoid aborting.
          if (
            attempt === BATCH_GENERATE_MAX_ATTEMPTS &&
            !forceSingleFrameMode
          ) {
            progress.log(
              `[story/frames] Incomplete batch ${batchIndex + 1}, filling remaining frames individually`,
            );
            const remainingStart = generatedImages.length;
            for (let i = remainingStart; i < batch.prompts.length; i += 1) {
              const single = await generateImages({
                progress,
                modelId: imageModelId,
                stylePrompt,
                styleImages: attemptStyleImages,
                imagePrompts: [batch.prompts[i]],
                imageGradingPrompt: STORY_IMAGE_GRADING_PROMPT,
                maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                imageAspectRatio,
                imageSize,
                debug: extendDebug(
                  debug,
                  `${generateDebugSuffix}/fill-frame-${padNumber(
                    batch.globalIndices[i] + 1,
                  )}`,
                ),
              });
              if (single.length > 0) {
                generatedImages.push(single[0]);
              }
            }
          }

          if (generatedImages.length < batch.prompts.length) {
            lastError = new Error(
              `Batch ${batchIndex + 1} returned ${generatedImages.length} images, expected ${batch.prompts.length}`,
            );
            progress.log(
              `[story/frames] Incomplete batch ${batchIndex + 1}, retrying`,
            );
            if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
              throw lastError;
            }
            continue;
          }
        }

        const batchItems: BatchGradeItem[] = generatedImages.map(
          (image, index) => ({
            frameIndex: batch.globalIndices[index] + 1,
            prompt: batch.prompts[index],
            image,
          }),
        );
        const frameIndexToLocal = new Map<number, number>();
        for (let index = 0; index < batchItems.length; index += 1) {
          frameIndexToLocal.set(batchItems[index].frameIndex, index);
        }
        const frameCandidateHistories = new Map<number, LlmImageData[]>();
        for (const item of batchItems) {
          frameCandidateHistories.set(item.frameIndex, [item.image]);
        }

        const logGradeSummary = (grade: BatchGradeOutcome) => {
          if (grade.summary) {
            progress.log(
              `[story/frames] Batch ${batchIndex + 1} grade summary: ${
                grade.summary
              }`,
            );
          }
        };

        const logFrameFindings = (grade: BatchGradeOutcome) => {
          if (grade.findings.length === 0) {
            return;
          }
          const details = grade.findings
            .map((finding) => `frame ${finding.frameIndex}: ${finding.reason}`)
            .join("; ");
          progress.log(
            `[story/frames] Batch ${batchIndex + 1} frames flagged: ${details}`,
          );
        };

        let grade: BatchGradeOutcome | undefined;
        try {
          grade = await gradeBatch({
            options,
            styleImages: batch.styleImages,
            items: batchItems,
            checkNewOnly: batchIndex > 0,
            debugSuffix: `batch-${padNumber(
              batchIndex + 1,
            )}/grade-${padNumber(attempt)}`,
          });
          logGradeSummary(grade);
        } catch (error) {
          lastError = error;
          progress.log(
            `[story/frames] Batch ${batchIndex + 1} grading failed: ${String(
              error instanceof Error ? error.message : error,
            )}`,
          );
          if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
            throw error instanceof Error ? error : new Error(String(error));
          }
          progress.log(
            "[story/frames] Retrying batch generation after grade failure",
          );
          continue;
        }
        if (!grade) {
          throw new Error(
            `Batch ${batchIndex + 1} grading did not return an outcome`,
          );
        }

        let rejectBatch = false;
        let partialIteration = 0;

        if (grade.outcome === "redo_batch") {
          const reasonParts: string[] = [];
          if (grade.batchReason) {
            reasonParts.push(grade.batchReason);
          }
          if (grade.summary) {
            reasonParts.push(grade.summary);
          }
          if (grade.findings.length > 0) {
            reasonParts.push(
              grade.findings
                .map(
                  (finding) => `frame ${finding.frameIndex}: ${finding.reason}`,
                )
                .join("; "),
            );
          }
          batchFeedbackLog.push(
            reasonParts.length > 0
              ? `Attempt ${attempt}: ${reasonParts.join(" | ")}`
              : `Attempt ${attempt}: grader requested redo_batch without additional explanation.`,
          );
          lastError = new Error(
            grade.batchReason
              ? `Batch ${batchIndex + 1} rejected: ${grade.batchReason}`
              : `Batch ${batchIndex + 1} rejected by grader`,
          );
          rejectBatch = true;
          // Adaptive fallback for next attempt: switch to single-frame mode and
          // purge overlap style references to break systemic collapse.
          forceSingleFrameMode = true;
          purgeStyleReferences = true;
        } else if (grade.outcome === "redo_frames") {
          logFrameFindings(grade);
        }

        const computeAcceptedStyleImages = (
          findings: readonly CatastrophicFinding[],
        ): LlmImageData[] => {
          if (findings.length === 0) {
            return batchItems.map((item) => item.image);
          }
          const flaggedSet = new Set(
            findings.map((finding) => finding.frameIndex),
          );
          return batchItems
            .filter((item) => !flaggedSet.has(item.frameIndex))
            .map((item) => item.image);
        };

        while (grade.outcome === "redo_frames") {
          partialIteration += 1;
          if (partialIteration > BATCH_GENERATE_MAX_ATTEMPTS) {
            throw new Error(
              `Batch ${batchIndex + 1} frame redo exceeded ${BATCH_GENERATE_MAX_ATTEMPTS} attempts`,
            );
          }
          if (grade.findings.length === 0) {
            rejectBatch = true;
            lastError = new Error(
              `Batch ${batchIndex + 1} requested frame redo without targets`,
            );
            break;
          }

          const acceptedImages = computeAcceptedStyleImages(grade.findings);
          const styleImagesForRedo = [...batch.styleImages, ...acceptedImages];

          if (partialIteration >= 2) {
            const comparisonSummaries: string[] = [];
            for (const finding of grade.findings) {
              const localIndex = frameIndexToLocal.get(finding.frameIndex);
              if (localIndex === undefined) {
                throw new Error(
                  `Batch grader referenced unknown frame ${finding.frameIndex}`,
                );
              }
              const history = frameCandidateHistories.get(finding.frameIndex);
              if (!history || history.length < 2) {
                throw new Error(
                  `Frame ${finding.frameIndex} redo fallback is missing candidate history`,
                );
              }
              const recentCandidates = history.slice(-2);
              const candidatePayload: FrameComparisonCandidate[] =
                recentCandidates.map((image, offset) => ({
                  candidateIndex: offset + 1,
                  image,
                }));
              const comparison = await selectBestRedoFrameCandidate({
                progress,
                gradingModelId: options.gradingModelId,
                stylePrompt,
                styleImages: styleImagesForRedo,
                catastrophicDescription: options.gradeCatastrophicDescription,
                prompt: batch.prompts[localIndex],
                frameIndex: finding.frameIndex,
                candidates: candidatePayload,
                debug: extendDebug(
                  debug,
                  `batch-${padNumber(
                    batchIndex + 1,
                  )}/redo-${padNumber(partialIteration)}/compare-frame-${padNumber(
                    finding.frameIndex,
                  )}`,
                ),
              });
              const winner =
                candidatePayload[comparison.winnerCandidateIndex - 1];
              if (!winner) {
                throw new Error(
                  `Frame ${finding.frameIndex} comparison selected invalid candidate ${comparison.winnerCandidateIndex}`,
                );
              }
              batchItems[localIndex] = {
                ...batchItems[localIndex],
                image: winner.image,
              };
              frameCandidateHistories.set(finding.frameIndex, [winner.image]);
              const details: string[] = [
                `winner candidate ${comparison.winnerCandidateIndex}: ${comparison.reasoning}`,
              ];
              if (comparison.catastrophicCandidates.length > 0) {
                const catastrophic = comparison.catastrophicCandidates
                  .map(
                    (entry) =>
                      `candidate ${entry.candidateIndex}: ${entry.reason}`,
                  )
                  .join(", ");
                details.push(`catastrophic: ${catastrophic}`);
              }
              comparisonSummaries.push(
                `frame ${finding.frameIndex} – ${details.join("; ")}`,
              );
            }
            if (comparisonSummaries.length > 0) {
              progress.log(
                `[story/frames] Batch ${batchIndex + 1} fallback comparison accepted redo frames (${comparisonSummaries.join(
                  "; ",
                )})`,
              );
            }
            grade = {
              outcome: "accept",
              findings: [],
              summary: "Accepted after fallback comparison",
            };
            break;
          }

          for (const finding of grade.findings) {
            const localIndex = frameIndexToLocal.get(finding.frameIndex);
            if (localIndex === undefined) {
              throw new Error(
                `Batch grader referenced unknown frame ${finding.frameIndex}`,
              );
            }
            let replacement: LlmImageData | undefined;
            for (
              let frameAttempt = 1;
              frameAttempt <= BATCH_GENERATE_MAX_ATTEMPTS;
              frameAttempt += 1
            ) {
              progress.log(
                `[story/frames] Regenerating frame ${finding.frameIndex} (batch ${
                  batchIndex + 1
                }, redo ${partialIteration}, attempt ${frameAttempt})`,
              );
              const regen = await generateImages({
                progress,
                modelId: imageModelId,
                stylePrompt,
                styleImages: styleImagesForRedo,
                imagePrompts: [batch.prompts[localIndex]],
                imageGradingPrompt: STORY_IMAGE_GRADING_PROMPT,
                maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                imageAspectRatio,
                imageSize,
                debug: extendDebug(
                  debug,
                  `batch-${padNumber(
                    batchIndex + 1,
                  )}/redo-${padNumber(partialIteration)}/frame-${padNumber(
                    finding.frameIndex,
                  )}/generate-${padNumber(frameAttempt)}`,
                ),
              });
              if (regen.length === 0) {
                if (frameAttempt === BATCH_GENERATE_MAX_ATTEMPTS) {
                  throw new Error(
                    `Failed to regenerate frame ${finding.frameIndex}: model returned no image`,
                  );
                }
                continue;
              }
              replacement = regen[0];
              break;
            }
            if (!replacement) {
              throw new Error(
                `Failed to regenerate frame ${finding.frameIndex} after ${BATCH_GENERATE_MAX_ATTEMPTS} attempts`,
              );
            }
            const previousImage = batchItems[localIndex].image;
            let history = frameCandidateHistories.get(finding.frameIndex);
            if (!history || history.length === 0) {
              history = [previousImage];
              frameCandidateHistories.set(finding.frameIndex, history);
            } else if (history[history.length - 1] !== previousImage) {
              history.push(previousImage);
            }
            history.push(replacement);
            batchItems[localIndex] = {
              ...batchItems[localIndex],
              image: replacement,
            };
          }

          try {
            const redoItems = grade.findings.map((finding) => {
              const localIndex = frameIndexToLocal.get(finding.frameIndex);
              if (localIndex === undefined) {
                throw new Error(
                  `Batch grader referenced unknown frame ${finding.frameIndex}`,
                );
              }
              return batchItems[localIndex];
            });
            grade = await gradeBatch({
              options,
              styleImages: styleImagesForRedo,
              items: redoItems,
              checkNewOnly: true,
              debugSuffix: `batch-${padNumber(
                batchIndex + 1,
              )}/redo-${padNumber(partialIteration)}/grade`,
            });
            logGradeSummary(grade);
            if (grade.outcome === "redo_frames") {
              logFrameFindings(grade);
            }
          } catch (error) {
            lastError = error;
            progress.log(
              `[story/frames] Batch ${batchIndex + 1} redo grading failed: ${String(
                error instanceof Error ? error.message : error,
              )}`,
            );
            if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
              throw error instanceof Error ? error : new Error(String(error));
            }
            rejectBatch = true;
            break;
          }

          if (grade.outcome === "redo_batch") {
            const redoReasonParts: string[] = [];
            if (grade.batchReason) {
              redoReasonParts.push(grade.batchReason);
            }
            if (grade.summary) {
              redoReasonParts.push(grade.summary);
            }
            if (grade.findings.length > 0) {
              redoReasonParts.push(
                grade.findings
                  .map(
                    (finding) =>
                      `frame ${finding.frameIndex}: ${finding.reason}`,
                  )
                  .join("; "),
              );
            }
            batchFeedbackLog.push(
              redoReasonParts.length > 0
                ? `Attempt ${attempt} redo ${partialIteration}: ${redoReasonParts.join(" | ")}`
                : `Attempt ${attempt} redo ${partialIteration}: grader escalated to redo_batch without explanation.`,
            );
            rejectBatch = true;
            lastError = new Error(
              grade.batchReason
                ? `Batch ${batchIndex + 1} rejected: ${grade.batchReason}`
                : `Batch ${batchIndex + 1} rejected by grader`,
            );
            break;
          }
        }

        if (rejectBatch) {
          if (
            promptRevisionRequests < PROMPT_REVISION_MAX_PER_BATCH &&
            grade.outcome === "redo_batch" &&
            attempt >= PROMPT_REVISION_MIN_ATTEMPT_FOR_REDO_BATCH
          ) {
            const promptFeedbackDebug = extendDebug(
              debug,
              `batch-${padNumber(batchIndex + 1)}/prompt-feedback-${padNumber(attempt)}`,
            );
            let evidence: FramePromptRevisionEvidence[] = [];
            try {
              evidence = await collectPromptRevisionEvidence({
                batchItems,
                grade,
                batch,
                batchAttempt: attempt,
                frameNarrationByIndex: narrationLookup,
                progress,
                gradingModelId: options.gradingModelId,
                debug: promptFeedbackDebug,
              });
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              progress.log(
                `[story/frames] Batch ${batchIndex + 1} evidence collection failed: ${message}`,
              );
            }
            promptRevisionRequests += 1;
            try {
              const revision = await requestFramePromptRevisions({
                gradingModelId: options.gradingModelId,
                progress,
                debug: promptFeedbackDebug,
                stylePrompt,
                catastrophicDescription: options.gradeCatastrophicDescription,
                batch,
                failureSummaries: [...batchFeedbackLog],
                frameNarrationByIndex: narrationLookup,
                evidence,
              });
              const updatedFrameNumbers: number[] = [];
              for (const replacement of revision.replacements) {
                const zeroBasedIndex = replacement.frameIndex - 1;
                const localIndex = batch.globalIndices.findIndex(
                  (value) => value === zeroBasedIndex,
                );
                if (localIndex === -1) {
                  progress.log(
                    `[story/frames] Prompt feedback returned frame ${replacement.frameIndex} which is outside batch ${batchIndex + 1}; ignoring`,
                  );
                  continue;
                }
                workingImagePrompts[zeroBasedIndex] = replacement.updatedPrompt;
                batch.prompts[localIndex] = replacement.updatedPrompt;
                updatedFrameNumbers.push(replacement.frameIndex);
              }
              if (updatedFrameNumbers.length > 0) {
                const summarySuffix =
                  revision.summary.trim().length > 0
                    ? ` (${revision.summary})`
                    : "";
                progress.log(
                  `[story/frames] Batch ${batchIndex + 1} prompt feedback updated frames ${updatedFrameNumbers.join(", ")}${summarySuffix}`,
                );
              } else {
                progress.log(
                  `[story/frames] Batch ${batchIndex + 1} prompt feedback returned no applicable replacements`,
                );
              }
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              progress.log(
                `[story/frames] Batch ${batchIndex + 1} prompt feedback failed: ${message}`,
              );
            }
          }
          progress.log(
            `[story/frames] Batch ${batchIndex + 1} rejected by grader, retrying`,
          );
          if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
            throw lastError instanceof Error
              ? lastError
              : new Error(String(lastError));
          }
          continue;
        }

        generated.push(...batchItems.map((item) => item.image));
        batchSuccess = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      }
    }

    if (!batchSuccess) {
      const failure = lastError instanceof Error ? lastError : undefined;
      throw failure ?? new Error(`Batch ${batchIndex + 1} failed`);
    }
  }

  if (generated.length !== imagePrompts.length) {
    throw new Error(
      `Storyboard generation produced ${generated.length} frames, expected ${imagePrompts.length}`,
    );
  }

  return generated;
}
