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

const IMAGE_GENERATION_MAX_ATTEMPTS = 4;
const BATCH_GENERATE_MAX_ATTEMPTS = 3;
const STORYBOARD_REDO_MAX_CYCLES = 4;

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

type StoryboardGradeOutcome = {
  framesToRedo: CatastrophicFinding[];
  summary: string;
};

type BatchGradeItem = {
  frameIndex: number;
  prompt: string;
  image: LlmImageData;
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
        })
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
  suffix: string
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
    ].join("\n")
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
    ].join("\n")
  );
  return [
    {
      role: "user" as const,
      parts,
    },
  ];
}

type StoryboardGradeItem = {
  frameIndex: number;
  prompt: string;
  image: LlmImageData;
};

function buildStoryboardGradeContents(params: {
  summaryInstructions: string;
  stylePrompt: string;
  styleImages: readonly LlmImageData[];
  reviewFrames: readonly StoryboardGradeItem[];
  lockedFrames: readonly StoryboardGradeItem[];
}): { role: "user"; parts: LlmContentPart[] }[] {
  const {
    summaryInstructions,
    stylePrompt,
    styleImages,
    reviewFrames,
    lockedFrames,
  } = params;
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
    addTextPart(parts, "\nBaseline style references:");
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
  if (lockedFrames.length > 0) {
    addTextPart(
      parts,
      [
        "",
        "Context-only frames (already accepted, do NOT request redo for these):",
      ].join("\n")
    );
    for (const frame of lockedFrames) {
      addTextPart(
        parts,
        `\nLocked frame ${frame.frameIndex} (for context only): ${frame.prompt}`
      );
      parts.push(toInlinePart(frame.image));
    }
  }
  if (reviewFrames.length > 0) {
    addTextPart(
      parts,
      [
        "",
        "Updated frames (changed since your last review). Only list catastrophic failures under `frames_to_redo`.",
      ].join("\n")
    );
    for (const frame of reviewFrames) {
      addTextPart(parts, `\nFrame ${frame.frameIndex}: ${frame.prompt}`);
      parts.push(toInlinePart(frame.image));
    }
  } else {
    addTextPart(
      parts,
      [
        "",
        "No frames have changed since your last review; respond with an empty `frames_to_redo` array.",
      ].join("\n")
    );
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
    responseSchema: BATCH_GRADE_RESPONSE_SCHEMA,
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

async function gradeStoryboard(params: {
  options: GenerateStoryFramesOptions;
  frames: readonly LlmImageData[];
  attempt: number;
  reviewTargets: readonly number[];
  lockedTargets: readonly number[];
}): Promise<StoryboardGradeOutcome> {
  const { options, frames, attempt, reviewTargets, lockedTargets } = params;
  const toStoryboardItems = (
    targets: readonly number[]
  ): StoryboardGradeItem[] =>
    targets.map((targetIndex) => {
      const image = frames[targetIndex];
      const prompt = options.imagePrompts[targetIndex];
      if (!image) {
        throw new Error(
          `Missing frame data for storyboard index ${targetIndex + 1}`
        );
      }
      if (!prompt) {
        throw new Error(
          `Missing prompt for storyboard index ${targetIndex + 1}`
        );
      }
      return {
        frameIndex: targetIndex + 1,
        prompt,
        image,
      };
    });
  const payload: StoryboardGradeResponse = await generateJson({
    modelId: options.gradingModelId,
    progress: options.progress,
    schema: StoryboardGradeResponseSchema,
    responseSchema: STORYBOARD_GRADE_RESPONSE_SCHEMA,
    debug: extendDebug(options.debug, `storyboard/grade-${padNumber(attempt)}`),
    contents: buildStoryboardGradeContents({
      summaryInstructions: options.storyboardReviewDescription,
      stylePrompt: options.stylePrompt,
      styleImages: options.styleImages ?? [],
      reviewFrames: toStoryboardItems(reviewTargets),
      lockedFrames: toStoryboardItems(lockedTargets),
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
  return [...baseStyleImages, ...generatedSoFar.slice(overlapStart)];
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
          maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
          imageAspectRatio,
          debug: extendDebug(
            debug,
            `batch-${padNumber(batchIndex + 1)}/generate-${padNumber(attempt)}`
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

        const batchItems: BatchGradeItem[] = generatedImages.map(
          (image, index) => ({
            frameIndex: batch.globalIndices[index] + 1,
            prompt: batch.prompts[index],
            image,
          })
        );
        const frameIndexToLocal = new Map<number, number>();
        for (let index = 0; index < batchItems.length; index += 1) {
          frameIndexToLocal.set(batchItems[index].frameIndex, index);
        }

        const logGradeSummary = (grade: BatchGradeOutcome) => {
          if (grade.summary) {
            progress.log(
              `[story/frames] Batch ${batchIndex + 1} grade summary: ${
                grade.summary
              }`
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
            `[story/frames] Batch ${batchIndex + 1} frames flagged: ${details}`
          );
        };

        let grade: BatchGradeOutcome;
        try {
          grade = await gradeBatch({
            options,
            styleImages: batch.styleImages,
            items: batchItems,
            checkNewOnly: batchIndex > 0,
            debugSuffix: `batch-${padNumber(
              batchIndex + 1
            )}/grade-${padNumber(attempt)}`,
          });
          logGradeSummary(grade);
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
          progress.log(
            "[story/frames] Retrying batch generation after grade failure"
          );
          continue;
        }

        let rejectBatch = false;
        let partialIteration = 0;

        if (grade.outcome === "redo_batch") {
          lastError = new Error(
            grade.batchReason
              ? `Batch ${batchIndex + 1} rejected: ${grade.batchReason}`
              : `Batch ${batchIndex + 1} rejected by grader`
          );
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

        if (grade.outcome === "redo_frames") {
          logFrameFindings(grade);
        }

        const computeAcceptedStyleImages = (
          findings: readonly CatastrophicFinding[]
        ): LlmImageData[] => {
          if (findings.length === 0) {
            return batchItems.map((item) => item.image);
          }
          const flaggedSet = new Set(
            findings.map((finding) => finding.frameIndex)
          );
          return batchItems
            .filter((item) => !flaggedSet.has(item.frameIndex))
            .map((item) => item.image);
        };

        while (grade.outcome === "redo_frames") {
          partialIteration += 1;
          if (partialIteration > BATCH_GENERATE_MAX_ATTEMPTS) {
            throw new Error(
              `Batch ${batchIndex + 1} frame redo exceeded ${BATCH_GENERATE_MAX_ATTEMPTS} attempts`
            );
          }
          if (grade.findings.length === 0) {
            rejectBatch = true;
            lastError = new Error(
              `Batch ${batchIndex + 1} requested frame redo without targets`
            );
            break;
          }

          const acceptedImages = computeAcceptedStyleImages(grade.findings);
          const styleImagesForRedo = [...batch.styleImages, ...acceptedImages];

          for (const finding of grade.findings) {
            const localIndex = frameIndexToLocal.get(finding.frameIndex);
            if (localIndex === undefined) {
              throw new Error(
                `Batch grader referenced unknown frame ${finding.frameIndex}`
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
                }, redo ${partialIteration}, attempt ${frameAttempt})`
              );
              const regen = await generateImages({
                progress,
                modelId: imageModelId,
                stylePrompt,
                styleImages: styleImagesForRedo,
                imagePrompts: [batch.prompts[localIndex]],
                maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
                imageAspectRatio,
                debug: extendDebug(
                  debug,
                  `batch-${padNumber(
                    batchIndex + 1
                  )}/redo-${padNumber(partialIteration)}/frame-${padNumber(
                    finding.frameIndex
                  )}/generate-${padNumber(frameAttempt)}`
                ),
              });
              if (regen.length === 0) {
                if (frameAttempt === BATCH_GENERATE_MAX_ATTEMPTS) {
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
                  `Batch grader referenced unknown frame ${finding.frameIndex}`
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
                batchIndex + 1
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
                error instanceof Error ? error.message : error
              )}`
            );
            if (attempt === BATCH_GENERATE_MAX_ATTEMPTS) {
              throw error instanceof Error ? error : new Error(String(error));
            }
            rejectBatch = true;
            break;
          }

          if (grade.outcome === "redo_batch") {
            rejectBatch = true;
            lastError = new Error(
              grade.batchReason
                ? `Batch ${batchIndex + 1} rejected: ${grade.batchReason}`
                : `Batch ${batchIndex + 1} rejected by grader`
            );
            break;
          }
        }

        if (rejectBatch) {
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
      `Storyboard generation produced ${generated.length} frames, expected ${imagePrompts.length}`
    );
  }

  const storyboardAccepted = new Array<boolean>(imagePrompts.length).fill(
    false
  );

  let redoCycles = 0;
  while (true) {
    const reviewTargets: number[] = [];
    const lockedTargets: number[] = [];
    for (let index = 0; index < generated.length; index += 1) {
      const frame = generated[index];
      if (!frame) {
        throw new Error(
          `Storyboard frame ${index + 1} is missing after generation`
        );
      }
      if (storyboardAccepted[index]) {
        lockedTargets.push(index);
      } else {
        reviewTargets.push(index);
      }
    }

    if (reviewTargets.length === 0) {
      break;
    }

    const attemptNumber = redoCycles + 1;
    const review = await gradeStoryboard({
      options,
      frames: generated,
      attempt: attemptNumber,
      reviewTargets,
      lockedTargets,
    });
    if (review.summary) {
      progress.log(
        `[story/frames] Storyboard review ${attemptNumber}: ${review.summary}`
      );
    }

    const redoFrameIndices = new Set(
      review.framesToRedo.map((finding) => finding.frameIndex)
    );
    const validReviewFrameIndices = new Set(
      reviewTargets.map((index) => index + 1)
    );
    for (const frameIndex of redoFrameIndices) {
      if (!validReviewFrameIndices.has(frameIndex)) {
        throw new Error(
          `Storyboard grader referenced frame ${frameIndex} that was not part of the review batch`
        );
      }
    }
    for (const reviewIndex of reviewTargets) {
      const frameNumber = reviewIndex + 1;
      if (redoFrameIndices.has(frameNumber)) {
        storyboardAccepted[reviewIndex] = false;
      } else {
        storyboardAccepted[reviewIndex] = true;
      }
    }

    if (redoFrameIndices.size === 0) {
      break;
    }
    if (redoCycles >= STORYBOARD_REDO_MAX_CYCLES) {
      const reasons = review.framesToRedo
        .map((finding) => `frame ${finding.frameIndex}: ${finding.reason}`)
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
      storyboardAccepted[targetIndex] = false;
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
          maxAttempts: IMAGE_GENERATION_MAX_ATTEMPTS,
          imageAspectRatio,
          debug: extendDebug(
            debug,
            `redo-cycle-${padNumber(redoCycles)}/frame-${padNumber(
              finding.frameIndex
            )}/try-${padNumber(attempt)}-of-${padNumber(BATCH_GENERATE_MAX_ATTEMPTS)}`
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
