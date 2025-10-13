import { Type, type Schema } from "@google/genai";
import { z } from "zod";

import {
  generateImages,
  generateJson,
  type LlmContentPart,
  type LlmDebugOptions,
  type LlmImageData,
  type LlmImageModelId,
  type LlmTextModelId,
} from "../../utils/llm";
import type { JobProgressReporter } from "../../utils/concurrency";

const BATCH_GENERATE_MAX_ATTEMPTS = 3;
const STORYBOARD_REDO_MAX_CYCLES = 2;

type CatastrophicFinding = {
  frameIndex: number;
  reason: string;
};

type BatchGradeOutcome = {
  outcome: "accept" | "redo";
  findings: CatastrophicFinding[];
  summary: string;
};

type StoryboardGradeOutcome = {
  framesToRedo: CatastrophicFinding[];
  summary: string;
};

const BatchGradeResponseSchema = z
  .object({
    outcome: z.enum(["accept", "redo"]),
    catastrophic_findings: z
      .array(
        z.object({
          frame_index: z.number().int().min(1),
          reason: z.string().trim().min(1),
        })
      )
      .default([]),
    summary: z.string().trim().optional(),
  })
  .transform((raw) => ({
    outcome: raw.outcome,
    findings: raw.catastrophic_findings.map((item) => ({
      frameIndex: item.frame_index,
      reason: item.reason,
    })),
    summary: raw.summary ?? "",
  }));

type BatchGradeResponse = z.infer<typeof BatchGradeResponseSchema>;

const BATCH_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["outcome", "catastrophic_findings"],
  propertyOrdering: ["outcome", "summary", "catastrophic_findings"],
  properties: {
    outcome: {
      type: Type.STRING,
      enum: ["accept", "redo"],
    },
    summary: { type: Type.STRING },
    catastrophic_findings: {
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

const StoryboardGradeResponseSchema = z
  .object({
    frames_to_redo: z
      .array(
        z.object({
          frame_index: z.number().int().min(1),
          reason: z.string().trim().min(1),
        })
      )
      .default([]),
    summary: z.string().trim().optional(),
  })
  .transform((raw) => ({
    framesToRedo: raw.frames_to_redo.map((item) => ({
      frameIndex: item.frame_index,
      reason: item.reason,
    })),
    summary: raw.summary ?? "",
  }));

type StoryboardGradeResponse = z.infer<typeof StoryboardGradeResponseSchema>;

const STORYBOARD_GRADE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["frames_to_redo"],
  propertyOrdering: ["summary", "frames_to_redo"],
  properties: {
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

type GenerateStoryFramesOptions = {
  imageModelId: LlmImageModelId;
  gradingModelId: LlmTextModelId;
  stylePrompt: string;
  imagePrompts: readonly string[];
  batchSize: number;
  overlapSize: number;
  gradeCatastrophicDescription: string;
  storyboardReviewDescription: string;
  styleImages?: readonly LlmImageData[];
  progress: JobProgressReporter;
  debug?: LlmDebugOptions;
  imageAspectRatio?: string;
};

type GenerateBatchParams = {
  batchIndex: number;
  globalIndices: readonly number[];
  prompts: readonly string[];
  styleImages: readonly LlmImageData[];
};

function extendDebug(
  debug: LlmDebugOptions | undefined,
  suffix: string,
  attempt?: number
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
    attempt,
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
  generatedImages: readonly {
    frameIndex: number;
    prompt: string;
    image: LlmImageData;
  }[];
  checkNewOnly: boolean;
}): { role: "user"; parts: LlmContentPart[] }[] {
  const { catDescription, stylePrompt, styleImages, generatedImages, checkNewOnly } =
    params;
  const parts: LlmContentPart[] = [];
  addTextPart(
    parts,
    [
      "You are the catastrophic failure catcher for storyboard panels.",
      buildCatastrophicChecklist(catDescription),
      "",
      `Style prompt (for reference):\n${stylePrompt}`,
    ].join("\n")
  );
  if (styleImages.length > 0) {
    addTextPart(
      parts,
      "\nStyle reference images (follow their palette, rendering style, and character appearance):"
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
        ? "Evaluate ONLY the new frames below. Ignore the style references except to check consistency."
        : "Evaluate each frame below for catastrophic failures.",
      "",
      "For every frame include:",
      "- Frame number (1-based index across the storyboard).",
      "- Illustration prompt.",
      "- The rendered image (inline).",
    ].join("\n")
  );
  for (const entry of generatedImages) {
    addTextPart(
      parts,
      `\nFrame ${entry.frameIndex}: ${entry.prompt}`
    );
    parts.push(toInlinePart(entry.image));
  }
  addTextPart(
    parts,
    [
      "",
      "Respond in JSON using the provided schema.",
      'Set `"outcome":"redo"` only when a catastrophic failure is present.',
      "Otherwise set `\"outcome\":\"accept\"`.",
      "If you red-flag a frame include it in `catastrophic_findings` with a short reason.",
    ].join("\n")
  );
  return [
    {
      role: "user" as const,
      parts,
    },
  ];
}

function buildStoryboardGradeContents(params: {
  summaryInstructions: string;
  stylePrompt: string;
  styleImages: readonly LlmImageData[];
  frames: readonly {
    frameIndex: number;
    prompt: string;
    image: LlmImageData;
  }[];
}): { role: "user"; parts: LlmContentPart[] }[] {
  const { summaryInstructions, stylePrompt, styleImages, frames } = params;
  const parts: LlmContentPart[] = [];
  addTextPart(
    parts,
    [
      "You are auditing the full storyboard for catastrophic or continuity-breaking failures.",
      summaryInstructions,
      "",
      `Style prompt (for reference):\n${stylePrompt}`,
    ].join("\n")
  );
  if (styleImages.length > 0) {
    addTextPart(
      parts,
      "\nBaseline style references:"
    );
    for (const image of styleImages) {
      parts.push(toInlinePart(image));
    }
  }
  addTextPart(
    parts,
    [
      "",
      "Storyboard frames follow. For each frame, consider whether it must be regenerated.",
      "Only flag frames that clearly fail the catastrophic checklist; otherwise leave them untouched.",
    ].join("\n")
  );
  for (const frame of frames) {
    addTextPart(
      parts,
      `\nFrame ${frame.frameIndex}: ${frame.prompt}`
    );
    parts.push(toInlinePart(frame.image));
  }
  addTextPart(
    parts,
    [
      "",
      "Respond in JSON. List only the frames that require redo under `frames_to_redo` with reasons.",
      "If everything looks usable, return an empty list.",
    ].join("\n")
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
  batch: GenerateBatchParams;
  generated: readonly LlmImageData[];
  attempt: number;
  checkNewOnly: boolean;
}): Promise<BatchGradeOutcome> {
  const { options, batch, generated, attempt, checkNewOnly } = params;
  const payload: BatchGradeResponse = await generateJson({
    modelId: options.gradingModelId,
    progress: options.progress,
    schema: BatchGradeResponseSchema,
    responseSchema: BATCH_GRADE_RESPONSE_SCHEMA,
    debug: extendDebug(
      options.debug,
      `batch-${padNumber(batch.batchIndex + 1)}/grade-${padNumber(attempt)}`,
      attempt
    ),
    contents: buildBatchGradeContents({
      catDescription: options.gradeCatastrophicDescription,
      stylePrompt: options.stylePrompt,
      styleImages: batch.styleImages,
      generatedImages: generated.map((image, index) => ({
        frameIndex: batch.globalIndices[index] + 1,
        prompt: batch.prompts[index],
        image,
      })),
      checkNewOnly,
    }),
  });
  return {
    outcome: payload.outcome,
    findings: payload.findings,
    summary: payload.summary,
  };
}

async function gradeStoryboard(params: {
  options: GenerateStoryFramesOptions;
  frames: readonly LlmImageData[];
  attempt: number;
}): Promise<StoryboardGradeOutcome> {
  const { options, frames, attempt } = params;
  const payload: StoryboardGradeResponse = await generateJson({
    modelId: options.gradingModelId,
    progress: options.progress,
    schema: StoryboardGradeResponseSchema,
    responseSchema: STORYBOARD_GRADE_RESPONSE_SCHEMA,
    debug: extendDebug(
      options.debug,
      `storyboard/grade-${padNumber(attempt)}`,
      attempt
    ),
    contents: buildStoryboardGradeContents({
      summaryInstructions: options.storyboardReviewDescription,
      stylePrompt: options.stylePrompt,
      styleImages: options.styleImages ?? [],
      frames: frames.map((image, index) => ({
        frameIndex: index + 1,
        prompt: options.imagePrompts[index],
        image,
      })),
    }),
  });
  return {
    framesToRedo: payload.framesToRedo,
    summary: payload.summary,
  };
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
  return [
    ...baseStyleImages,
    ...generatedSoFar.slice(overlapStart),
  ];
}

function collectFrameStyleImages(params: {
  baseStyleImages: readonly LlmImageData[];
  generatedFrames: readonly LlmImageData[];
  targetIndex: number;
  overlapSize: number;
}): readonly LlmImageData[] {
  const { baseStyleImages, generatedFrames, targetIndex, overlapSize } = params;
  const styleImages: LlmImageData[] = [...baseStyleImages];
  if (overlapSize > 0) {
    const start = Math.max(targetIndex - overlapSize, 0);
    for (let index = start; index < targetIndex; index += 1) {
      const frame = generatedFrames[index];
      if (frame) {
        styleImages.push(frame);
      }
    }
  }
  return styleImages;
}

export async function generateStoryFrames(
  options: GenerateStoryFramesOptions
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
  } = options;

  if (batchSize <= 0) {
    throw new Error("batchSize must be greater than zero");
  }
  if (imagePrompts.length === 0) {
    return [];
  }

  const baseStyleImages = styleImages ? [...styleImages] : [];
  const generated: LlmImageData[] = [];
  const totalBatches = Math.ceil(imagePrompts.length / batchSize);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const startIndex = batchIndex * batchSize;
    const endIndex = Math.min(startIndex + batchSize, imagePrompts.length);
    const prompts = imagePrompts.slice(startIndex, endIndex);
    const globalIndices = Array.from(
      { length: prompts.length },
      (_, offset) => startIndex + offset
    );
    const styleImagesForBatch = collectBatchStyleImages({
      baseStyleImages,
      generatedSoFar: generated,
      overlapSize,
    });
    const batch: GenerateBatchParams = {
      batchIndex,
      globalIndices,
      prompts,
      styleImages: styleImagesForBatch,
    };

    let batchSuccess = false;
    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= BATCH_GENERATE_MAX_ATTEMPTS;
      attempt += 1
    ) {
      progress.log(
        `[story/frames] Generating batch ${batchIndex + 1}/${totalBatches} (attempt ${attempt})`
      );

      try {
        const generatedImages = await generateImages({
          progress,
          modelId: imageModelId,
          stylePrompt,
          styleImages: batch.styleImages,
          imagePrompts: batch.prompts,
          maxAttempts: 1,
          imageAspectRatio,
          debug: extendDebug(
            debug,
            `batch-${padNumber(batchIndex + 1)}/generate-${padNumber(attempt)}`,
            attempt
          ),
        });

        if (generatedImages.length < batch.prompts.length) {
          lastError = new Error(
            `Batch ${batchIndex + 1} returned ${generatedImages.length} images, expected ${batch.prompts.length}`
          );
          progress.log(
            `[story/frames] Incomplete batch ${batchIndex + 1}, retrying`
          );
          if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
            throw lastError;
          }
          continue;
        }

        let grade: BatchGradeOutcome;
        try {
          grade = await gradeBatch({
            options,
            batch,
            generated: generatedImages,
            attempt,
            checkNewOnly: batchIndex > 0,
          });
        } catch (error) {
          lastError = error;
          progress.log(
            `[story/frames] Batch ${batchIndex + 1} grading failed: ${String(
              error instanceof Error ? error.message : error
            )}`
          );
          if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
            throw error instanceof Error ? error : new Error(String(error));
          }
          progress.log("[story/frames] Retrying batch generation after grade failure");
          continue;
        }

        if (grade.outcome === "redo") {
          lastError =
            grade.findings.length > 0
              ? new Error(
                  `Batch ${batchIndex + 1} rejected: ${grade.findings
                    .map(
                      (finding) =>
                        `frame ${finding.frameIndex}: ${finding.reason}`
                    )
                    .join("; ")}`
                )
              : new Error(`Batch ${batchIndex + 1} rejected by grader`);
          progress.log(
            `[story/frames] Batch ${batchIndex + 1} rejected by grader, retrying`
          );
          if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
            throw lastError instanceof Error
              ? lastError
              : new Error(String(lastError));
          }
          continue;
        }

        if (grade.summary) {
          progress.log(
            `[story/frames] Batch ${batchIndex + 1} grade summary: ${grade.summary}`
          );
        }

        generated.push(...generatedImages.slice(0, batch.prompts.length));
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

  let redoCycles = 0;
  while (true) {
    const attemptNumber = redoCycles + 1;
    const review = await gradeStoryboard({
      options,
      frames: generated,
      attempt: attemptNumber,
    });
    if (review.summary) {
      progress.log(
        `[story/frames] Storyboard review ${attemptNumber}: ${review.summary}`
      );
    }
    if (review.framesToRedo.length === 0) {
      break;
    }
    if (redoCycles >= STORYBOARD_REDO_MAX_CYCLES) {
      const reasons = review.framesToRedo
        .map(
          (finding) =>
            `frame ${finding.frameIndex}: ${finding.reason}`
        )
        .join("; ");
      throw new Error(
        `Storyboard review failed after ${STORYBOARD_REDO_MAX_CYCLES} redo cycles: ${reasons}`
      );
    }

    redoCycles += 1;
    progress.log(
      `[story/frames] Redo cycle ${redoCycles}: regenerating frames ${review.framesToRedo
        .map((item) => item.frameIndex)
        .join(", ")}`
    );

    for (const finding of review.framesToRedo) {
      const targetIndex = finding.frameIndex - 1;
      if (targetIndex < 0 || targetIndex >= generated.length) {
        throw new Error(
          `Storyboard grader requested invalid frame index ${finding.frameIndex}`
        );
      }
      let replacement: LlmImageData | undefined;
      for (
        let attempt = 1;
        attempt <= BATCH_GENERATE_MAX_ATTEMPTS;
        attempt += 1
      ) {
        progress.log(
          `[story/frames] Regenerating frame ${finding.frameIndex} (cycle ${redoCycles}, attempt ${attempt})`
        );
        const styleForFrame = collectFrameStyleImages({
          baseStyleImages,
          generatedFrames: generated,
          targetIndex,
          overlapSize,
        });
        const regen = await generateImages({
          progress,
          modelId: imageModelId,
          stylePrompt,
          styleImages: styleForFrame,
          imagePrompts: [imagePrompts[targetIndex]],
          maxAttempts: 1,
          imageAspectRatio,
          debug: extendDebug(
            debug,
            `redo-cycle-${padNumber(redoCycles)}/frame-${padNumber(
              finding.frameIndex
            )}`,
            attempt
          ),
        });
        if (regen.length === 0) {
          if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
            throw new Error(
              `Failed to regenerate frame ${finding.frameIndex}: model returned no image`
            );
          }
          continue;
        }
        replacement = regen[0];
        break;
      }
      if (!replacement) {
        throw new Error(
          `Failed to regenerate frame ${finding.frameIndex} after ${BATCH_GENERATE_MAX_ATTEMPTS} attempts`
        );
      }
      generated[targetIndex] = replacement;
    }
  }

  return generated;
}
