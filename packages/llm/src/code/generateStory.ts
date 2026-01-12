import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  generateImages,
  generateText,
  generateJson,
  type LlmContentPart,
  type LlmImageData,
  type LlmDebugOptions,
  type LlmImageSize,
  type LlmTextModelId,
} from "../utils/llm";
import type { JobProgressReporter, LlmUsageChunk } from "../utils/concurrency";
import { errorAsString } from "../utils/error";
import { isGeminiModelId } from "../utils/gemini";
import {
  getFirebaseAdminStorage,
  getFirebaseAdminFirestore,
  getFirebaseStorageBucketName,
} from "../utils/firebaseAdmin";
import type { MediaSegment } from "./schemas";
import { getSharp } from "../utils/sharp";
import { isOpenAiModelId } from "../utils/openai-llm";

import {
  createConsoleProgress,
  synthesizeAndPublishNarration,
} from "./generateNarration";
import { generateStoryFrames } from "./generateFrames";
import { STORY_IMAGE_GRADING_PROMPT } from "./imageGradingPrompt";

function getPracticeLabel(includeCoding: boolean): string {
  return includeCoding ? "programming challenges" : "practice problems";
}

function getChallengeLabel(includeCoding: boolean): string {
  return includeCoding ? "Coding challenges" : "Lesson problems";
}

const DEFAULT_TEXT_MODEL_ID: LlmTextModelId = "gpt-5.2";

const ENV_TEXT_MODEL_ID = process.env.SPARK_LLM_TEXT_MODEL_ID?.trim();

export const TEXT_MODEL_ID: LlmTextModelId =
  ENV_TEXT_MODEL_ID &&
  (isGeminiModelId(ENV_TEXT_MODEL_ID) || isOpenAiModelId(ENV_TEXT_MODEL_ID))
    ? ENV_TEXT_MODEL_ID
    : DEFAULT_TEXT_MODEL_ID;
export const IMAGE_MODEL_ID = "gemini-3-pro-image-preview" as const;

const STORY_FRAME_CATASTROPHIC_DESCRIPTION = [
  "- Wrong medium (e.g. photographic instead of illustrated, monochrome sketches, or heavy text-on-canvas posters).",
  "- Missing the named protagonist when the prompt or narration centres them; environmental cutaways are fine when explicitly requested.",
  "- Obvious content collapse: distorted limbs/faces, unreadable scene, blank or abstract output.",
  "- Layout that breaks requirements: multi-panel compositions, tall/vertical aspect look, or very thick heavy borders.",
  "- Catastrophic continuity break with provided style references.",
  "- Surreal overlays or abstract visualizations: neon/glowing text or symbols floating in the air, holographic UI, HUD elements, or attempts to depict abstract entities as hovering graphics rather than as physical artifacts.",
  "- Meta or listener depiction: images that portray the listener or a second-person stand‑in (e.g. 'you', 'student', 'apprentice', 'listener', 'audience'). If a modern‑world tie‑in is needed, show objects or settings only—never the listener figure.",
].join("\n");

export const ART_STYLE: readonly string[] = [
  "A feature, high-quality illustrated storyboard frame with modern graphic-novel energy.",
  "Assume 16:9 screen",
  "Use expressive lighting, cohesive colour palettes, and period-aware details across the sequence.",
  "Balance the protagonist with supporting context when the narrative calls for it while keeping the key action obvious.",
  "Avoid photorealism, collage looks, thick borders, or multi-panel layouts.",
  "Single scene per image.",
  "Historically grounded cartoon look: physical objects only. No neon or holographic overlays, no glowing symbols or HUD-style UI, no text floating in the air, and no attempts to visualize abstract entities as hovering graphics.",
  "If any writing appears, it must be on physical surfaces (paper, chalkboard, signage) and period-appropriate. Keep it minimal and never depict equations or dense text.",
];

const IMAGE_SET_GENERATE_MAX_ATTEMPTS = 3;
const DEFAULT_STORY_SEGMENT_COUNT = 10;
const STORY_SEGMENT_COUNT_RANGE = { min: 1, max: 10 };
const StorySegmentCountSchema = z
  .number()
  .int()
  .min(STORY_SEGMENT_COUNT_RANGE.min)
  .max(STORY_SEGMENT_COUNT_RANGE.max)
  .default(DEFAULT_STORY_SEGMENT_COUNT);

function resolveStorySegmentCount(value: number | undefined): number {
  return StorySegmentCountSchema.parse(value);
}

export type StoryProgress = JobProgressReporter | undefined;

type StoryDebugOptions = {
  debugRootDir?: string;
  debugSubStage?: string;
};

type StoryProseOptions = StoryDebugOptions & {
  includeCoding?: boolean;
};

function useProgress(progress: StoryProgress): JobProgressReporter {
  return {
    log(message: string) {
      if (progress) {
        progress.log(message);
      } else {
        console.log(message);
      }
    },
    startModelCall(details: {
      modelId: string;
      uploadBytes: number;
      imageSize?: string;
    }) {
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
    startStage(stageName: string) {
      if (progress && progress.startStage) {
        return progress.startStage(stageName);
      }
      return Symbol("stage");
    },
    finishStage(handle: symbol) {
      if (progress && progress.finishStage) {
        progress.finishStage(handle);
      }
    },
    setActiveStages(stages: Iterable<string>) {
      if (progress && progress.setActiveStages) {
        progress.setActiveStages(stages);
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

function buildStorySegmentationSchema(segmentCount: number) {
  return z.object({
    title: z.string().trim().min(1),
    posterPrompt: z.string().trim().min(1),
    segments: z.array(StorySegmentSchema).length(segmentCount),
    endingPrompt: z.string().trim().min(1),
  });
}

export const StorySegmentationSchema = buildStorySegmentationSchema(
  DEFAULT_STORY_SEGMENT_COUNT,
);

export type StorySegmentation = z.infer<typeof StorySegmentationSchema>;

export type SegmentationPromptCorrection = {
  promptIndex: number;
  updatedPrompt: string;
  critique: string;
};

function buildSegmentationCorrectorResponseSchema(maxPromptIndex: number) {
  return z
    .object({
      issuesSummary: z.string().trim().optional(),
      corrections: z
        .array(
          z.object({
            prompt_index: z.number().int().min(0).max(maxPromptIndex),
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
}

type SegmentationCorrectorResponse = {
  issuesSummary: string;
  corrections: SegmentationPromptCorrection[];
};

export type StoryProseRevisionCriterion = {
  score: number;
  justification: string;
};

export type StoryProseRevisionAnalysis = {
  metaphoricalIntegrity: StoryProseRevisionCriterion;
  narrativeMomentum: StoryProseRevisionCriterion;
  conceptualClarity: StoryProseRevisionCriterion;
  audienceResonance: StoryProseRevisionCriterion;
  motivationalPower: StoryProseRevisionCriterion;
};

const STORY_IDEA_CANDIDATE_IDS = [
  "candidate_a",
  "candidate_b",
  "candidate_c",
] as const;

const StoryIdeaFunctionalAnalogySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
});

const StoryIdeaTerminologySchema = z.object({
  term: z.string().trim().min(1),
  definition: z.string().trim().min(1),
});

const StoryIdeaHistoricalAnchorSchema = z.object({
  figure: z.string().trim().min(1),
  canonicalEvent: z.string().trim().min(1),
  highStakesProblem: z.string().trim().min(1),
});

const StoryIdeaNarrativeElementsSchema = z.object({
  functionalAnalogies: z
    .array(StoryIdeaFunctionalAnalogySchema)
    .min(1, "Provide at least one functional analogy"),
  contrastingFoil: z.string().trim().min(1),
  invisibleArchitecturePivot: z.string().trim().min(1),
});

const optionalIdeaString = z
  .string()
  .trim()
  .min(1)
  .nullish()
  .transform((value) =>
    value === null || value === undefined ? undefined : value,
  );

const StoryIdeaResearchSnapshotSchema = z.object({
  conceptualEssence: z.string().trim().min(1),
  historicalAnchor: StoryIdeaHistoricalAnchorSchema,
  narrativeElements: StoryIdeaNarrativeElementsSchema,
  keyTerminologyGloss: z
    .array(StoryIdeaTerminologySchema)
    .optional()
    .default([]),
  keyTermToNameInStory: z.string().trim().min(1),
  namingNote: optionalIdeaString,
  historicalNuance: optionalIdeaString,
  analogyClarifierSeed: z.string().trim().min(1),
  closingInvitationSeed: z.string().trim().min(1),
});

const StoryIdeaCandidateSchema = z.object({
  id: z.enum(STORY_IDEA_CANDIDATE_IDS),
  angle: z.string().trim().min(1),
  anchorEvent: z.string().trim().min(1),
  analogy: z.string().trim().min(1),
  endingPivot: optionalIdeaString,
  lessonTeaser: z.string().trim().min(1),
  namingNote: optionalIdeaString,
});

const StoryIdeaRecommendationSchema = z.object({
  selectedCandidateId: z.enum(STORY_IDEA_CANDIDATE_IDS),
  rationale: z.string().trim().min(1),
});

const StoryIdeaSourceSchema = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
  summary: z.string().trim().min(1),
});

const StoryIdeaDataSchemaBase = z.object({
  researchSnapshot: StoryIdeaResearchSnapshotSchema,
  candidates: z
    .array(StoryIdeaCandidateSchema)
    .min(1, "Provide at least one narrative candidate"),
  recommendation: StoryIdeaRecommendationSchema,
  sources: z.array(StoryIdeaSourceSchema).min(1, "List at least one source"),
});

const StoryIdeaDataSchema = StoryIdeaDataSchemaBase.superRefine(
  (value, ctx) => {
    const ids = value.candidates.map((candidate) => candidate.id);
    const expectedIds = new Set(STORY_IDEA_CANDIDATE_IDS);
    if (ids.length !== expectedIds.size) {
      ctx.addIssue({
        code: "custom",
        message: `Expected exactly ${expectedIds.size} candidates (one per identifier).`,
        path: ["candidates"],
      });
      return;
    }
    for (const expectedId of expectedIds) {
      if (!ids.includes(expectedId)) {
        ctx.addIssue({
          code: "custom",
          message: `Missing candidate with id '${expectedId}'.`,
          path: ["candidates"],
        });
      }
    }
  },
);

export type StoryIdeaData = z.infer<typeof StoryIdeaDataSchema>;

export type StoryIdeaResult = {
  brief: string;
  data?: StoryIdeaData;
};

const StoryOriginsCapsuleSchema = z.object({
  text: z.string().trim().min(1, "Origins capsule must include text"),
});

export type StoryOriginsCapsule = z.infer<typeof StoryOriginsCapsuleSchema>;

const StoryValidationBooleanFlagSchema = z.boolean();
const StoryValidationDateFlagSchema = z.preprocess(
  (val) => (val === true ? "hedged" : val),
  z.union([
    z.literal("hedged"),
    z.literal("recommend-hedge"),
    z.literal(false),
  ]),
);

const STORY_VALIDATION_TAGS = [
  "namingAttribution",
  "exclusivityClaim",
  "modernTieInOverclaim",
  "datePrecision",
  "wrongEntity",
  "other",
] as const;

const StoryValidationBlockersSchema = z.object({
  namingAttribution: StoryValidationBooleanFlagSchema.optional(),
  exclusivityClaim: StoryValidationBooleanFlagSchema.optional(),
  modernTieInOverclaim: StoryValidationBooleanFlagSchema.optional(),
  datePrecision: StoryValidationDateFlagSchema.optional(),
  wrongEntity: StoryValidationBooleanFlagSchema.optional(),
});

const StoryFixChecklistSchema = z.object({
  namingAttribution: StoryValidationBooleanFlagSchema,
  exclusivityClaim: StoryValidationBooleanFlagSchema,
  modernTieInOverclaim: StoryValidationBooleanFlagSchema,
  datePrecision: StoryValidationDateFlagSchema,
  wrongEntity: StoryValidationBooleanFlagSchema,
});

export type StoryValidationBlockers = z.infer<
  typeof StoryValidationBlockersSchema
>;

export type StoryFixChecklist = z.infer<typeof StoryFixChecklistSchema>;

export type StoryValidationTag = (typeof STORY_VALIDATION_TAGS)[number];

const OriginsCapsuleValidationIssueSchema = z.object({
  summary: z.string().trim().min(1),
  recommendation: z.string().trim().min(1),
});

const OriginsCapsuleValidationResponseSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(OriginsCapsuleValidationIssueSchema).default([]),
});

type OriginsCapsuleValidationResponse = z.infer<
  typeof OriginsCapsuleValidationResponseSchema
>;

export type StoryProseVariantLabel = "variant_a" | "variant_b";

export const STORY_PROSE_VARIANT_LABELS: readonly StoryProseVariantLabel[] = [
  "variant_a",
  "variant_b",
] as const;

export type StoryProseVariantsJudgeSummary = {
  verdict: StoryProseVariantLabel;
  reasoning: string;
};

export type StoryProseVariantMetadata = {
  label: StoryProseVariantLabel;
  ideaBrief: string;
  draftText: string;
  originsCapsule: string;
  text: string;
  analysis: StoryProseRevisionAnalysis;
  improvementSummary: string;
  fixChecklist: StoryFixChecklist;
  validation?: StoryProseValidationResult;
};

export type StoryProseResult = {
  text: string;
  metadata?: {
    ideaBrief: string;
    draftText: string;
    originsCapsule?: string;
    analysis: StoryProseRevisionAnalysis;
    improvementSummary: string;
    fixChecklist?: StoryFixChecklist;
    validation?: StoryProseValidationResult;
    variantLabel?: StoryProseVariantLabel;
    variants?: StoryProseVariantMetadata[];
    judge?: StoryProseVariantsJudgeSummary;
  };
};

export type StoryProseDraftResult = StoryProseResult;

export type StoryProseDraftVariant = {
  label: StoryProseVariantLabel;
  idea: StoryIdeaResult;
  originsCapsule: StoryOriginsCapsule;
  draft: StoryProseDraftResult;
};

export type StoryProseVariantCandidate = StoryProseDraftVariant & {
  revision: StoryProseRevisionResult;
};

export type StoryProseValidationIssue = {
  tag?: StoryValidationTag;
  summary: string;
  category:
    | "factual"
    | "naming"
    | "terminology"
    | "structure"
    | "tone"
    | "requirement"
    | "other";
  severity: "critical" | "major" | "minor";
  evidence: string;
  recommendation: string;
};

export type StoryProseValidationResult = {
  verdict: "pass" | "fail";
  issues: StoryProseValidationIssue[];
  blockers?: StoryValidationBlockers;
};

export type StoryProseRevisionResult = StoryProseResult & {
  analysis: StoryProseRevisionAnalysis;
  improvementSummary: string;
  fixChecklist: StoryFixChecklist;
  validation?: StoryProseValidationResult;
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

const StoryIdeaCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  brief: z.string().trim().min(1),
  data: StoryIdeaDataSchema.optional(),
});

type StoryIdeaCheckpoint = z.infer<typeof StoryIdeaCheckpointSchema>;

const StoryOriginsCapsuleCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  capsule: z.string().trim().min(1),
});

type StoryOriginsCapsuleCheckpoint = z.infer<
  typeof StoryOriginsCapsuleCheckpointSchema
>;

const StoryProseCheckpointVariantSchema = z.object({
  label: z.enum(["variant_a", "variant_b"]),
  ideaBrief: z.string().trim().min(1),
  draftText: z.string().trim().min(1),
  originsCapsule: z.string().trim().min(1),
});

const StoryProseCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  variants: z.array(StoryProseCheckpointVariantSchema).min(1),
});

type StoryProseCheckpoint = z.infer<typeof StoryProseCheckpointSchema>;

const StoryProseRevisionCriterionSchema = z.object({
  score: z.number().int().min(1).max(5),
  justification: z.string().trim().min(1),
});

const StoryProseRevisionAnalysisSchema = z.object({
  metaphoricalIntegrity: StoryProseRevisionCriterionSchema,
  narrativeMomentum: StoryProseRevisionCriterionSchema,
  conceptualClarity: StoryProseRevisionCriterionSchema,
  audienceResonance: StoryProseRevisionCriterionSchema,
  motivationalPower: StoryProseRevisionCriterionSchema,
});

const StoryProseValidationIssueSchema = z.object({
  tag: z.enum(STORY_VALIDATION_TAGS).optional(),
  summary: z.string().trim().min(1),
  category: z.enum([
    "factual",
    "naming",
    "terminology",
    "structure",
    "tone",
    "requirement",
    "other",
  ]),
  severity: z.enum(["critical", "major", "minor"]),
  evidence: z.string().trim().min(1),
  recommendation: z.string().trim().min(1),
});

const StoryProseValidationResultSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  issues: z.array(StoryProseValidationIssueSchema),
  blockers: StoryValidationBlockersSchema.optional(),
});

const StoryProseVariantsJudgeSchema = z.object({
  verdict: z.enum(["variant_a", "variant_b"]),
  reasoning: z.string().trim().min(1),
});

const StoryProseRevisionCheckpointSchema = z.object({
  topic: z.string().trim().min(1),
  text: z.string().trim().min(1),
  analysis: StoryProseRevisionAnalysisSchema,
  improvementSummary: z.string().trim().min(1),
  fixChecklist: StoryFixChecklistSchema,
  validation: StoryProseValidationResultSchema.optional(),
  variantLabel: z.enum(["variant_a", "variant_b"]).optional(),
  originsCapsule: z.string().trim().min(1).optional(),
  variants: z
    .array(
      z.object({
        label: z.enum(["variant_a", "variant_b"]),
        ideaBrief: z.string().trim().min(1),
        draftText: z.string().trim().min(1),
        originsCapsule: z.string().trim().min(1),
        text: z.string().trim().min(1),
        analysis: StoryProseRevisionAnalysisSchema,
        improvementSummary: z.string().trim().min(1),
        fixChecklist: StoryFixChecklistSchema,
        validation: StoryProseValidationResultSchema.optional(),
      }),
    )
    .optional(),
  judge: StoryProseVariantsJudgeSchema.optional(),
});

type StoryProseRevisionCheckpoint = z.infer<
  typeof StoryProseRevisionCheckpointSchema
>;

const StoryProseRevisionRevisedStorySchema = z.object({
  title: z.string().trim().min(1),
  paragraphs: z.array(z.string().trim().min(1)).min(1),
});

const StoryProseRevisionResponseSchema = z.object({
  analysis: StoryProseRevisionAnalysisSchema,
  revisedStory: StoryProseRevisionRevisedStorySchema,
  improvementSummary: z.string().trim().min(1),
  fixChecklist: StoryFixChecklistSchema,
});

type StoryProseRevisionResponse = z.infer<
  typeof StoryProseRevisionResponseSchema
>;

const ProseVariantJudgeResponseSchema = z.object({
  reasoning: z.string().trim().min(1),
  verdict: z.enum(["variant_a", "variant_b"]),
});

type ProseVariantJudgeResponse = z.infer<
  typeof ProseVariantJudgeResponseSchema
>;

const StoryImagesCheckpointSchema = z.object({
  prompt: z.string(),
  modelVersion: z.string().trim().min(1),
  captions: z.string().optional(),
  images: z.array(SerialisedStoryImageSchema).min(1),
});

type StoryImagesCheckpoint = z.infer<typeof StoryImagesCheckpointSchema>;

const StorySupplementaryImageSchema = z.object({
  storagePath: z.string().trim().min(1),
});

export type StorySupplementaryImage = z.infer<
  typeof StorySupplementaryImageSchema
>;

const StoryNarrationCheckpointSchema = z.object({
  storagePaths: z.array(z.string().trim().min(1)).min(1),
  publishResult: z.object({
    storagePath: z.string().trim().min(1),
    documentPath: z.string().trim().min(1),
    durationSec: z.number().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  posterImage: StorySupplementaryImageSchema.optional(),
  endingImage: StorySupplementaryImageSchema.optional(),
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

export function buildStoryIdeaPrompt(
  topic: string,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): string {
  const contextLines: string[] = [];
  if (lessonContext) {
    contextLines.push("**Lesson Context (align hints to these):**");
    contextLines.push(
      `- Session topic seed: "${lessonContext.planTopic}". Story topic: "${topic}".`,
    );
    if (lessonContext.promisedSkills.length > 0) {
      contextLines.push(
        `- Promised skills to reinforce: ${lessonContext.promisedSkills.join(", ")}.`,
      );
    }
    if (lessonContext.techniques && lessonContext.techniques.length > 0) {
      contextLines.push(
        "- Problem-solving techniques to nod to (no step-by-step teaching, just narrative foreshadowing):",
      );
      for (const technique of lessonContext.techniques) {
        contextLines.push(
          `  • ${technique.id}: ${technique.title} — ${technique.summary}`,
        );
      }
    }
    if (lessonContext.problems && lessonContext.problems.length > 0) {
      contextLines.push(
        `- ${getChallengeLabel(includeCoding)} learners will tackle:`,
      );
      for (const problem of lessonContext.problems) {
        const details = [problem.title];
        if (problem.story_callback) {
          details.push(`story hook: ${problem.story_callback}`);
        }
        if (problem.summary) {
          details.push(`summary: ${problem.summary}`);
        }
        contextLines.push(`  • ${problem.id}: ${details.join(" | ")}`);
      }
    }
    contextLines.push(
      "- The story should foreshadow the key trick(s) and end with a line that tees up the warm-up quiz to explore them next.",
      "- Do not introduce advanced concepts beyond these techniques/skills/assumptions.",
    );
    if (lessonContext.storyHook) {
      const hook = lessonContext.storyHook;
      contextLines.push("**Historical Hook (must stay anchored):**");
      contextLines.push(
        "- Do not change the protagonist or setting; keep the story grounded in this hook.",
      );
      if (hook.protagonist) {
        contextLines.push(`- Protagonist: ${hook.protagonist}`);
      }
      if (hook.anchor_event || hook.anchor_year || hook.anchor_place) {
        const anchorParts = [
          hook.anchor_event,
          hook.anchor_year,
          hook.anchor_place,
        ].filter(Boolean);
        if (anchorParts.length > 0) {
          contextLines.push(`- Anchor event: ${anchorParts.join(" — ")}`);
        }
      }
      if (hook.stakes) {
        contextLines.push(`- Stakes: ${hook.stakes}`);
      }
      if (hook.analogy_seed) {
        contextLines.push(`- Analogy seed: ${hook.analogy_seed}`);
      }
      if (hook.visual_scene) {
        const props = hook.visual_scene.props.join(", ");
        contextLines.push(
          `- Visual scene: setting="${hook.visual_scene.setting}", focal_object="${hook.visual_scene.focal_object}", props=[${props}]`,
        );
      } else if (hook.visual_motif) {
        contextLines.push(`- Visual motif: ${hook.visual_motif}`);
      }
      if (hook.modern_tie_in) {
        contextLines.push(`- Modern tie-in domain: ${hook.modern_tie_in}`);
      }
      if (hook.naming_note) {
        contextLines.push(`- Naming note: ${hook.naming_note}`);
      }
    }
  }
  const practiceLabel = getPracticeLabel(includeCoding);
  return `### **Prompt 1: The Story Architect's Brief**

**(Objective: To perform deep research and strategic planning. The output of this prompt is a structured brief, not a full story.)**

**Your Role:** You are a historical researcher and a concept strategist for an educational media company. Your task is to analyze a technical concept and create a "Story Brief" for our narrative writers. This brief must identify the perfect historical anchor and a powerful narrative angle to make the concept unforgettable for advanced 12-16 year olds. Always run web-search queries to confirm every historical detail before you commit to the brief.

Important constraints:
- Avoid outlining algorithms, procedures, or step-by-step computations. It's fine to mention a few numbers in passing, but do not walk through calculations or variable notation.
- You may introduce 1–2 terms by name if they help intrigue the listener, but do not provide precise formal definitions.
- Every factual statement (dates, locations, publications, people, proof status, terminology origins) must include an inline citation in parentheses with the source title and URL (e.g., "(Source: Bell Labs Archive — https://example.org/...)"). Collect all citations at the end under a "Sources" heading with one bullet per source and a short 1-line summary.
- The final story must explicitly name the concept "${topic}". Include brief naming history when genuinely interesting (e.g., why an approach has a surprising name), otherwise skip it—but capture the note in the brief if relevant so the writer can decide.
- Make clear that the core trick will be revealed within this very lesson; hint that brief in-lesson exercises will let the audience try it immediately (no explicit call-to-action wording).
- Ensure any narrative seeds align with the lesson context so the story hints at the techniques learners will practice in the warm-up quiz and ${practiceLabel}.
${contextLines.length > 0 ? `\n${contextLines.join("\n")}\n` : ""}
- Historical fidelity for anecdotes: only include famous quotes/stories when tied to the same concept/result and time period. Do not misattribute well-known anecdotes; if relevant contextually, frame as foreshadowing of a later milestone rather than attributing it to the current concept.
- Fact-checking: when any date, name, or claim is uncertain, run a quick web search to verify before including it. Prefer authoritative sources. Do not guess.
- Tone: neutral and factual in the brief; avoid charged adjectives and hyperbole.

**The Concept to Analyze:** **${topic}**

**Your Process:**

1. **Core Discovery:**
   * Using your knowledge and web search, identify a key originator and a single, documented "canonical event" where the concept was introduced or decisively used (a specific paper, memo, project, or crisis).
   * Establish the time, place, and the high-stakes problem being addressed. What made this problem urgent and important *at that moment*?
   * Apply the **Character Relevance Test:** Could the story be told with another figure without significant changes? If so, you have the wrong anchor. Find someone whose personal context is intrinsically linked to the discovery.

2. **Conceptual Distillation:**
   * **Essence:** Go beyond the textbook definition. In one sentence, what is the fundamental *idea* or *behavior* of this concept?
   * **Contrasting Foil:** In one line, name a common alternative approach and state why it was unsuitable for the specific historical problem you've identified.

3. **Narrative Angle Ideation (Explore 3 ideas):** Generate three distinct narrative directions. For each candidate, include:
   * **The Human Element:** Based on the discoverer's profession and context, what was their worldview?
   * **Functional Analogy:** One functional analogy—an active system with internal rules that mirrors the concept's core logic—described briefly and without numbers or step sequences.
   * **Ending Pivot (modern connection, optional):** If a strong, natural link exists to the modern world, describe it concisely as an ending-only move. Otherwise, state "none".
   * **Lesson Teaser:** A one-sentence hint that this very lesson will reveal the trick and include short exercises to try it immediately (no explicit call-to-action wording).
   * (Optional) A short note on naming history if genuinely interesting.

- **Output Format:** Return Markdown with these exact headings and subsection titles:
  * \`### Research Snapshot\`
  * \`### Candidates\`
    * Include three subsections named \`#### candidate_a\`, \`#### candidate_b\`, and \`#### candidate_c\`.
  * \`### Recommendation\`
  * \`### Sources\`
- Under each heading, use bullet lists or short paragraphs to supply the required details:
  * **Research Snapshot:** Include the conceptual essence (one sentence), historical anchor (figure, canonical event, high-stakes problem), narrative elements (2–3 functional analogies with names+descriptions, contrasting foil, invisible architecture pivot), optional glossary terms, the exact concept name, optional naming/historical nuance notes, and the analogy clarifier and closing invitation seeds.
  * **Candidates:** For each subsection, provide an angle sentence, anchor event, tailored analogy sentence, optional ending pivot, lesson teaser, and optional naming note. Do not create extra candidates.
  * **Recommendation:** Write a two-to-three sentence rationale referencing audience impact, then state the chosen candidate ID.
  * **Sources:** List every unique source referenced anywhere in the brief. For each, include the source title, direct URL, and a one-sentence summary of what it confirms.
- Keep inline citations inside the text so each factual statement references its supporting source entry.
- Do not output JSON, code fences, or commentary outside the Markdown headings above.
`;
}

export function buildStoryIdeaParsePrompt(
  topic: string,
  briefMarkdown: string,
): string {
  return [
    "You are a structured-data specialist.",
    "",
    `Task: Convert the following Markdown story brief for the concept "${topic}" into JSON that matches STORY_IDEA_RESPONSE_SCHEMA.`,
    "",
    "Rules:",
    "- Preserve every inline citation exactly as written.",
    "- Do not invent new data. If a field is missing in the brief, omit it from the output rather than guessing.",
    "- Keep candidate identifiers aligned with their headings (candidate_a, candidate_b, candidate_c).",
    "- Ensure the selected candidate in the recommendation exists in the candidates list.",
    "",
    "Output structure:",
    "- Emit a single JSON object with the keys `researchSnapshot`, `candidates`, `recommendation`, and `sources`.",
    "- `researchSnapshot` must include: `conceptualEssence`; `historicalAnchor` with `figure`, `canonicalEvent`, and `highStakesProblem`; `narrativeElements` with `functionalAnalogies` (array of objects containing `name` and `description`), `contrastingFoil`, and `invisibleArchitecturePivot`; optional `keyTerminologyGloss` (array), `namingNote`, and `historicalNuance`; plus `keyTermToNameInStory`, `analogyClarifierSeed`, and `closingInvitationSeed`.",
    "- `candidates` must be an array with exactly three objects, each containing `id`, `angle`, `anchorEvent`, `analogy`, `endingPivot` (omit when absent), `lessonTeaser`, and `namingNote` (omit when absent). Use each id (`candidate_a`, `candidate_b`, `candidate_c`) exactly once.",
    "- `recommendation` must contain `selectedCandidateId` (one of the candidate IDs) and a `rationale` string.",
    "- `sources` must be an array of objects with `title`, `url`, and `summary`.",
    "- Do not add commentary outside the JSON payload.",
    "",
    "Markdown brief to parse:",
    "<<<STORY_IDEA_BRIEF_START>>>",
    briefMarkdown,
    "<<<STORY_IDEA_BRIEF_END>>>",
    "",
    "Return JSON only.",
  ].join("\n");
}

export function buildStoryDraftPrompt(
  topic: string,
  storyBrief: string,
  originsCapsule: string,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): string {
  const contextLines: string[] = [];
  if (lessonContext) {
    contextLines.push(
      "**Lesson Context (keep the narrative tethered to these):**",
    );
    contextLines.push(
      `- Session topic seed: "${lessonContext.planTopic}". Story topic: "${topic}".`,
    );
    if (lessonContext.promisedSkills.length > 0) {
      contextLines.push(
        `- Promised skills to reinforce: ${lessonContext.promisedSkills.join(", ")}.`,
      );
    }
    if (lessonContext.techniques && lessonContext.techniques.length > 0) {
      contextLines.push(
        "- Techniques learners will practice (hint at them narratively; do not teach steps):",
      );
      for (const technique of lessonContext.techniques) {
        contextLines.push(
          `  • ${technique.id}: ${technique.title} — ${technique.summary}`,
        );
      }
    }
    if (lessonContext.problems && lessonContext.problems.length > 0) {
      contextLines.push(
        `- ${getChallengeLabel(includeCoding)} this story tees up:`,
      );
      for (const problem of lessonContext.problems) {
        const parts = [problem.title];
        if (problem.story_callback) {
          parts.push(`story hook: ${problem.story_callback}`);
        }
        if (problem.summary) {
          parts.push(`summary: ${problem.summary}`);
        }
        contextLines.push(`  • ${problem.id}: ${parts.join(" | ")}`);
      }
    }
    contextLines.push(
      "- Close with a line that hands off to the warm-up quiz to explore the hinted trick(s).",
      "- Do not introduce new advanced concepts beyond these skills/techniques/assumptions.",
    );
    if (lessonContext.storyHook) {
      const hook = lessonContext.storyHook;
      contextLines.push("**Historical Hook (do not drift):**");
      contextLines.push(
        "- Keep the same protagonist and setting described here; do not swap them.",
      );
      if (hook.protagonist) {
        contextLines.push(`- Protagonist: ${hook.protagonist}`);
      }
      if (hook.anchor_event || hook.anchor_year || hook.anchor_place) {
        const anchorParts = [
          hook.anchor_event,
          hook.anchor_year,
          hook.anchor_place,
        ].filter(Boolean);
        if (anchorParts.length > 0) {
          contextLines.push(`- Anchor event: ${anchorParts.join(" — ")}`);
        }
      }
      if (hook.stakes) {
        contextLines.push(`- Stakes: ${hook.stakes}`);
      }
      if (hook.analogy_seed) {
        contextLines.push(`- Analogy seed: ${hook.analogy_seed}`);
      }
      if (hook.visual_scene) {
        const props = hook.visual_scene.props.join(", ");
        contextLines.push(
          `- Visual scene: setting="${hook.visual_scene.setting}", focal_object="${hook.visual_scene.focal_object}", props=[${props}]`,
        );
      } else if (hook.visual_motif) {
        contextLines.push(`- Visual motif: ${hook.visual_motif}`);
      }
      if (hook.modern_tie_in) {
        contextLines.push(`- Modern tie-in domain: ${hook.modern_tie_in}`);
      }
      if (hook.naming_note) {
        contextLines.push(`- Naming note: ${hook.naming_note}`);
      }
    }
  }
  const practiceLabel = getPracticeLabel(includeCoding);
  return `### **Prompt 2: The Narrative Weaver**

**Objective:** Transform the strategic brief and Origins Capsule into a 250–450 word audio-first story for curious 12–16 year olds. You may extend modestly (≈1.2–1.5×) when the added detail sharpens clarity; never pad with tangents.

**Your Role:** You are the narrative lead for our educational podcast. Your draft must honour the locked Origins Capsule while keeping the narrative lively and memorable.

**Origins Capsule (locked facts — keep semantics intact, allow gentle paraphrasing only):**
================ Origins Capsule ================
${originsCapsule}
===============================================

**Story Brief Reference (follow the Recommendation when multiple candidates appear):**
================ Story Brief ================
${storyBrief}
============================================

  **Guardrails You Must Obey:**
  - Place the Origins Capsule in the first half of the story. Preserve every name, title, and timing nuance exactly—even if you lightly rephrase the sentences.
  - Use neutral naming language such as "now known as", "often called", or "widely referred to as". Never claim anyone "coined", "named", "invented", or held sole credit unless the capsule already asserts it.
  - Avoid exclusivity language. Swap "first" or "sole inventor" claims for hedged phrasing like "credited among early contributors", "independently developed", or "... and others".
  - Do not claim historical figures used formal binary search/halving algorithms unless mainstream consensus supports it. For artillery/bracketing analogies, describe them as later teaching comparisons, not documented tactics.
  - Limit the narrative to one named figure or institution. When others matter, acknowledge them with neutral hedges instead of listing names.
  - The required concept name must appear in the title and again within the first four sentences of the prose, verbatim. Keep the title aligned with the same entity/concept described in the story.
  - Spell out lesser-known acronyms on first mention (e.g., "Jet Propulsion Laboratory (JPL)"); leave widely known ones like NASA as-is.
- Introduce the concept "${topic}" within the first four sentences. Include a naming note only when the qualifier is well established and high-confidence.
- Deliver the insight hint in exactly one or two sentences using plain nouns: start with the core pattern, then optionally contrast what happens when the condition holds versus when it breaks. Absolutely no equations, variables, or step-by-step instructions.
- Maintain historical fidelity. When uncertain, hedge or omit rather than invent detail. Keep modern references out of the story until the closing paragraph.
${contextLines.length > 0 ? `\n${contextLines.join("\n")}\n` : ""}

**Modern Tie-in (ending paragraph only):** use a hedged bridge—either pick one of these endings or write a short analogy that states both the resemblance and the historical difference. Then promise learners they will learn and practice the idea next.
1. "You’ll see echoes of this idea in modern {application domain}; today’s tools adapt it with costs or heuristics rather than copying the original scene. We’ll unpack the core move and you’ll try it in short challenges."
2. "The story invites comparisons to {application domain}, even though the historical problem differed. We’ll map the resemblance and the gap, then you’ll practice the algorithm in ${practiceLabel}."
3. "Modern systems borrow its shape—grids, layers, or scoring loops—while adding data and code constraints. You’ll learn the clean version here and apply it in the challenges that follow."

**Narrative Flow:**
1. **Set the Stakes:** Anchor the listener in the historical scene, pressing problem, and protagonist from the brief. Thread in the Origins Capsule here.
2. **Reveal the Insight:** Show the "aha" moment and introduce the functional analogy in motion—no procedural walkthroughs.
3. **Analogy Map + Hint:** Provide the succinct analogy map (2–3 concrete correspondences) and, if helpful, one short clarifier contrasting success vs. failure conditions.
4. **Parallel Voices (hedged):** Maintain momentum without adding new named figures; use phrases like "others later refined the idea" when nuance is required.
5. **Modern Pivot + Invitation:** In the final paragraph, use a hedged modern bridge or contrastive analogy (template or custom) and close with an empowering promise that this lesson reveals the details and lets the listener master them in ${practiceLabel}.

**Style Expectations:**
- Audio-first cadence with clear, varied sentences.
- Strong verbs and concrete nouns; hedges over absolutes when evidence is uncertain.
- At most one or two vivid adjectives across the entire story, never more than one per sentence.
- Vocabulary at or below CEFR B2; define any specialised term immediately.
- Provide a 2–4 word title on its own line followed by the story paragraphs.

Return only the title and paragraphs—no commentary, bullet lists, or template explanations.
`;
}

export function buildStoryRevisionPrompt(
  topic: string,
  storyDraft: string,
  originsCapsule: string,
  feedback?: string,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): string {
  const feedbackSection =
    feedback && feedback.trim().length > 0
      ? `\n**Additional Editorial Feedback (blocking issues to address):**\n${feedback.trim()}\n`
      : "";
  const contextLines: string[] = [];
  if (lessonContext) {
    contextLines.push("**Lesson Context (must remain aligned):**");
    contextLines.push(
      `- Session topic seed: "${lessonContext.planTopic}". Story topic: "${topic}".`,
    );
    if (lessonContext.promisedSkills.length > 0) {
      contextLines.push(
        `- Promised skills: ${lessonContext.promisedSkills.join(", ")}.`,
      );
    }
    if (lessonContext.techniques && lessonContext.techniques.length > 0) {
      contextLines.push("- Techniques to hint at (no new ones):");
      for (const technique of lessonContext.techniques) {
        contextLines.push(
          `  • ${technique.id}: ${technique.title} — ${technique.summary}`,
        );
      }
    }
    if (lessonContext.problems && lessonContext.problems.length > 0) {
      contextLines.push(
        `- ${getChallengeLabel(includeCoding)} this story should gently foreshadow (no spoilers):`,
      );
      for (const problem of lessonContext.problems) {
        const parts = [problem.title];
        if (problem.story_callback) {
          parts.push(`story hook: ${problem.story_callback}`);
        }
        if (problem.summary) {
          parts.push(`summary: ${problem.summary}`);
        }
        contextLines.push(`  • ${problem.id}: ${parts.join(" | ")}`);
      }
    }
    contextLines.push(
      "- Maintain a final line that hands off to the warm-up quiz to explore the hinted trick(s).",
    );
    if (lessonContext.storyHook) {
      const hook = lessonContext.storyHook;
      contextLines.push("**Historical Hook (must be preserved):**");
      contextLines.push(
        "- Keep the protagonist and setting fixed; do not invent new anchors.",
      );
      if (hook.protagonist) {
        contextLines.push(`- Protagonist: ${hook.protagonist}`);
      }
      if (hook.anchor_event || hook.anchor_year || hook.anchor_place) {
        const anchorParts = [
          hook.anchor_event,
          hook.anchor_year,
          hook.anchor_place,
        ].filter(Boolean);
        if (anchorParts.length > 0) {
          contextLines.push(`- Anchor event: ${anchorParts.join(" — ")}`);
        }
      }
      if (hook.stakes) {
        contextLines.push(`- Stakes: ${hook.stakes}`);
      }
      if (hook.analogy_seed) {
        contextLines.push(`- Analogy seed: ${hook.analogy_seed}`);
      }
      if (hook.visual_scene) {
        const props = hook.visual_scene.props.join(", ");
        contextLines.push(
          `- Visual scene: setting="${hook.visual_scene.setting}", focal_object="${hook.visual_scene.focal_object}", props=[${props}]`,
        );
      } else if (hook.visual_motif) {
        contextLines.push(`- Visual motif: ${hook.visual_motif}`);
      }
      if (hook.modern_tie_in) {
        contextLines.push(`- Modern tie-in domain: ${hook.modern_tie_in}`);
      }
      if (hook.naming_note) {
        contextLines.push(`- Naming note: ${hook.naming_note}`);
      }
    }
  }
  const practiceLabel = getPracticeLabel(includeCoding);
  return `### **Prompt 3: The Narrative Editor's Cut**

**Objective:** Audit the Narrative Weaver draft against all guardrails, protect the Origins Capsule facts, and deliver the final polished story.

**Origins Capsule (unaltered facts — keep semantics intact):**
================ Origins Capsule ================
${originsCapsule}
===============================================

**Draft Under Review:**
================ Story Draft ================
${storyDraft}
============================================
${feedbackSection}

**Non-negotiables for this pass:**
- Preserve the Origins Capsule details verbatim in meaning. You may smooth language, but the names, titles, and timing must remain unchanged.
- Enforce neutral naming. Replace any "coined", "named", "invented", or sole-credit claims with hedged phrases like "now known as", "credited among", or "... and others".
- Remove exclusivity claims. The story should never assert "first" or "sole" originators unless the capsule already does so explicitly.
- Limit the narrative to one named figure or institution; other contributors should appear only as hedged acknowledgements.
- Keep modern references out of the body. The final paragraph must be a hedged modern bridge: either pick one approved ending below or write a short analogy that calls out both the resemblance and the historical differences, then promise learners they will "learn the details" and "master it in ${practiceLabel}" next.
- Do not invent causal links from the historical anecdote to modern computing (e.g., implying algorithms were formalised from field repairs or cutting telegraph lines). When the connection is loose, keep it as an explicit "this reminds us of..." contrast instead of a lineage claim.
- Expand lesser-known acronyms on first use (e.g., "Jet Propulsion Laboratory (JPL)"); leave well-known ones like NASA unchanged.
- Maintain the insight hint in one or two sentences, using plain nouns—no equations, symbols, or step-by-step language.
- Keep the voice energetic and specific: one or two vivid concrete details are fine; vary hedging language so endings do not all sound alike.
- Run web searches when historical details are uncertain, but fix the prose rather than adding citations. Hedge when evidence is ambiguous.
- Tone check: at most one or two vivid adjectives across the entire story; vocabulary stays at or below CEFR B2, with any specialised term defined immediately.
${contextLines.length > 0 ? `\n${contextLines.join("\n")}\n` : ""}

**Approved Modern Tie-in Templates (ending paragraph only):**
1. "You’ll see echoes of this idea in modern {application domain}; today’s tools adapt it with costs or heuristics rather than copying the original scene. We’ll unpack the core move and you’ll try it in short challenges."
2. "The story invites comparisons to {application domain}, even though the historical problem differed. We’ll map the resemblance and the gap, then you’ll practice the algorithm in ${practiceLabel}."
3. "Modern systems borrow its shape—grids, layers, or scoring loops—while adding data and code constraints. You’ll learn the clean version here and apply it in the challenges that follow."

**Fix Checklist expectation:** After revising, you must populate a \\"fixChecklist\\" object confirming which blockers are resolved. Use these keys: \\"namingAttribution\\", \\"exclusivityClaim\\", \\"modernTieInOverclaim\\", \\"datePrecision\\", \\"wrongEntity\\". Set each boolean key to true only when the revised story clearly addresses it; leave false when unresolved. For \\"datePrecision\\", use \\"hedged\\" (string) when you softened or approximated timing, \\"recommend-hedge\\" (string) if you still urge additional hedging, or false (boolean) when no adjustment was required. Do not use true.

**Your Two-Part Task:**

**Part A: Critical Analysis**
Score the draft against our five-point rubric (1–5, integers only) with concise justifications. Be direct.

* **1. Metaphorical Power**
* **2. Narrative Momentum**
* **3. Conceptual Clarity**
* **4. Audience Resonance**
* **5. Motivational Power**

**Part B: Final Revision**
Rewrite the story so it satisfies every guardrail above, protects the Origins Capsule semantics, integrates exactly one modern template in the ending, and keeps the insight hint brief. Ensure the final sentences hand the learner the metaphorical tool and promise lesson mastery plus ${practiceLabel}.

Respond strictly in JSON with this structure:
{
  "analysis": {
    "metaphoricalIntegrity": { "score": 1-5 integer, "justification": string },
    "narrativeMomentum": { "score": 1-5 integer, "justification": string },
    "conceptualClarity": { "score": 1-5 integer, "justification": string },
    "audienceResonance": { "score": 1-5 integer, "justification": string },
    "motivationalPower": { "score": 1-5 integer, "justification": string }
  },
  "revisedStory": {
    "title": string (2-4 words),
    "paragraphs": array of non-empty strings (each 1+ sentences)
  },
  "improvementSummary": string (single sentence describing the biggest improvement),
  "fixChecklist": {
    "namingAttribution": boolean,
    "exclusivityClaim": boolean,
    "modernTieInOverclaim": boolean,
    "datePrecision": "hedged" | "recommend-hedge" | false,
    "wrongEntity": boolean
  }
}

Do not include commentary outside the JSON object. Every score must be an integer from 1 to 5 inclusive.
`;
}

export function buildStoryValidationPrompt(
  topic: string,
  storyText: string,
  includeCoding: boolean = true,
): string {
  const practiceLabel = getPracticeLabel(includeCoding);
  return `### **Prompt 4: The Fact-Check Gate**

**Objective:** Safeguard young learners by catching catastrophic factual or naming errors while respecting neutral hedges and the locked Origins Capsule facts.

**Policy Notes:**
- Stick with classical, widely taught anchors. Neutral hedges such as "... and others" or "credited among" are acceptable; do **not** fail a story simply for omitting extra contributor names when it avoids exclusivity.
- Hedged analogies are welcome: it is fine to say a scene "looks like" or "echoes" a modern approach when you immediately spell out the differences. Only treat it as overclaiming when it implies a real lineage or certainty.
- Block only catastrophic issues: wrong or conflicting names/titles/dates, misattributed naming, exclusive origin claims, un-hedged modern tie-ins, incorrect entities, or dates that need hedging.

**Material to Audit:**
================ Story (Final Draft) ================
${storyText}
====================================================

**Checklist (all must hold):**
1. Concept naming: "${topic}" appears within the first four sentences, and any naming note with qualifiers is accurate and neutral.
2. Historical anchor: the narrative keeps the Origins Capsule semantics—neutral verbs like "described" or "published", no sole-credit claims, and names/timing that match mainstream consensus.
3. Insight hint: exactly one or two sentences, purely conceptual, no equations, symbols, or step sequences.
4. Naming & exclusivity guardrails: no "coined", "invented", "first", or "sole" assertions unless universally accepted and stated in the capsule; hedged wording is encouraged.
5. Modern tie-in: confined to the final paragraph and uses a hedged bridge—either one approved template or a custom analogy that names both the similarity and the historical difference. No causal lineage claims.
6. Ending invitation: final sentences promise learners they will learn the details and master the idea in ${practiceLabel}.
7. Vocabulary and tone: CEFR B2 or simpler; define any specialist title immediately; keep charged adjectives to a minimum.

**Approved Modern Tie-in Templates (compare with the final paragraph):**
1. "You’ll see echoes of this idea in modern {application domain}; today’s tools adapt it with costs or heuristics rather than copying the original scene. We’ll unpack the core move and you’ll try it in short challenges."
2. "The story invites comparisons to {application domain}, even though the historical problem differed. We’ll map the resemblance and the gap, then you’ll practice the algorithm in ${practiceLabel}."
3. "Modern systems borrow its shape—grids, layers, or scoring loops—while adding data and code constraints. You’ll learn the clean version here and apply it in the challenges that follow."

**Reporting Instructions:**
- Return "pass" if there are no Critical or Major issues. Minor issues alone should result in a "pass" verdict (but still list them in 'issues' for feedback).
- For each issue, start the summary with "Tag: <taxonomy> – ..." where taxonomy ∈ { namingAttribution, exclusivityClaim, modernTieInOverclaim, datePrecision, wrongEntity, other }.
- Record the same taxonomy in the JSON field "tag". Provide severity, evidence (with citations when referencing sources), and a concrete recommendation. Recommendations should include a concise, livelier alternative phrasing (e.g., a hedged analogy or a clearer contrast) instead of only saying "remove".
- When the modern tie-in is hedged with an explicit contrast, treat it as pass or at most minor. Mark modernTieInOverclaim only when the ending asserts a lineage, omits any hedge, or ignores the approved patterns entirely.
- Populate the "blockers" object: set boolean keys to true when the story violates the guardrail, false when resolved. For "datePrecision", use "hedged" if the prose already uses approximate timing, "recommend-hedge" if it still needs softening, or false when precise dating is acceptable.
- Treat an un-hedged, causally claimed, or off-pattern modern ending as modernTieInOverclaim; a clearly marked analogy with differences is acceptable.

**Output JSON Schema:**
{
  "verdict": "pass" | "fail",
  "issues": [
    {
      "tag": "namingAttribution" | "exclusivityClaim" | "modernTieInOverclaim" | "datePrecision" | "wrongEntity" | "other",
      "summary": string,
      "category": "factual" | "naming" | "terminology" | "structure" | "tone" | "requirement" | "other",
      "severity": "critical" | "major" | "minor",
      "evidence": string,
      "recommendation": string
    }
  ],
  "blockers": {
    "namingAttribution": boolean,
    "exclusivityClaim": boolean,
    "modernTieInOverclaim": boolean,
    "datePrecision": "hedged" | "recommend-hedge" | false,
    "wrongEntity": boolean
  }
}

If there are no issues, return an empty array for \\"issues\\" but still include the \\"blockers\\" object with truthful values.
`;
}

export function buildStoryFactualValidationPrompt(
  topic: string,
  storyText: string,
): string {
  return `### **Prompt 4A: Historical Fact Check**

**Objective:** Extract every concrete historical or biographical claim in the story and verify it using quick web searches. Flag any claim that cannot be supported by reliable sources.

**Your Role:** You are the factual accuracy lead. Work claim-by-claim: identify people, places, dates, titles, and proof status statements. Run a focused Google search for each claim you cannot confirm from memory. When a search fails, try alternative keywords before concluding that the claim is unsupported.

**Material to Audit:**
================ Story (Final Draft) ================
${storyText}
====================================================

**Checklist:**
1. Enumerate the distinct historical claims. Treat each date, location, relationship, proof status, and attribution as a separate claim.
2. For every claim, run at least one web search. Note the key evidence you found, and record explicit citations with the source name and URL (e.g., "Bell Labs oral history – https://example.org/..."). If results conflict or are absent, treat the claim as unsupported.
3. Verdict rules:
   * Return **"pass"** if there are no Critical or Major factual errors. Minor precision issues should result in a "pass" (but list them).
   * Return **"fail"** only when there are Critical or Major unsupported claims or contradictions. Record one issue per problematic claim, set 'category' to 'factual', and explain the concern in plain language.
4. Ignore stylistic or structural issues here; only comment on historical accuracy. The next reviewer will enforce writing-quality requirements.

**Reporting Format:**
- Begin with a single line \`Verdict: pass\` or \`Verdict: fail\`.
- Follow with an \`Issues:\` heading. When the verdict is \`fail\`, list each blocking issue as a numbered list item in the form:
  1. (Category – Severity) Summary sentence
     Evidence: ...
     Recommendation: ...
- When there are no issues, write \`Issues: none\`.
- Include inline citations inside every evidence line so the supporting source is clear.
- Return plain text or Markdown following the structure above. Do **not** output JSON.
`;
}

export function buildStoryFactualValidationParsePrompt(
  factualReport: string,
): string {
  return [
    "You are converting a fact-check report into structured JSON.",
    "",
    "Instructions:",
    "- Read the analyst's report below and extract the verdict and issues.",
    "- Preserve severity, categories, recommendations, and evidence exactly (including citations).",
    "- If the report says there are no issues, return an empty array for issues.",
    "- Do not fabricate data; faithfully mirror the report.",
    "",
    "Output structure:",
    '- Return a JSON object with `verdict` ("pass" or "fail") and `issues` (array).',
    "- Each issue must include `summary`, `category`, `severity`, `evidence`, and `recommendation`.",
    "- When no issues are reported, set `issues` to an empty array.",
    "- Do not include commentary outside the JSON payload.",
    "",
    "Report to convert:",
    "<<<FACTUAL_REPORT_START>>>",
    factualReport,
    "<<<FACTUAL_REPORT_END>>>",
    "",
    "Return JSON only.",
  ].join("\n");
}

export function buildSegmentationPrompt(
  storyText: string,
  topic?: string,
  segmentCount?: number,
): string {
  // Style requirements are intentionally excluded here. Style gets applied later during image generation.
  const topicLines =
    topic && topic.trim().length > 0
      ? [
          `Story topic: ${topic.trim()}. Keep narration aligned to this theme.`,
          "",
        ]
      : [];
  const resolvedSegmentCount = resolveStorySegmentCount(segmentCount);
  const segmentLabel = resolvedSegmentCount === 1 ? "segment" : "segments";
  const storyBeatLabel =
    resolvedSegmentCount === 1 ? "story beat" : "story beats";
  const totalPrompts = resolvedSegmentCount + 2;
  return [
    "Convert the provided historical story into a structured narration and illustration plan.",
    "",
    ...topicLines,
    "Requirements:",
    `1. Provide \`title\`, \`posterPrompt\`, ${resolvedSegmentCount} chronological \`${segmentLabel}\`, and \`endingPrompt\`.`,
    `   This yields ${totalPrompts} total illustration prompts: poster + ${resolvedSegmentCount} ${storyBeatLabel} + ending card.`,
    "2. `posterPrompt` introduces the entire story in a single dynamic scene suitable for a cover/poster. It must be stunning, captivating, and intriguing; and it should mention the name of the protagonist (an important historical figure). If the name is long, prefer a concise form (e.g., first+last name or well-known moniker). As visible text on the poster, include: (a) a bold 2–4 word title, (b) the protagonist’s name, and (c) a single 4-digit year relevant to the story. Keep each supporting element under six words.",
    '3. `endingPrompt` is a graceful "The End" card with a minimal motif from the story.',
    `4. For each of the ${resolvedSegmentCount} \`${segmentLabel}\`:`,
    "   • Provide `narration`, an ordered array of narration slices. Each slice contains `voice` and `text`.",
    "   • Alternate between the `M` and `F` voices whenever the flow allows. Let `M` handle formal or structural beats; let `F` handle emotional or explanatory beats. Avoid repeating the same voice twice in a row unless it preserves clarity. Remove citation markers or reference-style callouts.",
    "   • Copy narration text verbatim from the story. Do not paraphrase, summarize, or invent new sentences. Do not drop any sentence; keep the original wording in order. If splitting a sentence across slices, duplicate the exact text with no additions, removals, or ellipses.",
    "   • Provide `imagePrompt`, a short, plain description (ideally one sentence) that captures the same moment as the narration slice(s). Focus on who, what, and where. Avoid camera jargon (e.g., close-up, overhead, depth of field) and avoid intricate staging.",
    "5. Keep each `imagePrompt` drawable as a simple single-scene illustration with cartoon-style clarity: emphasise the key action and allow supporting characters or environment to share focus only when the narration calls for it. Prefer everyday settings. Do not invent elaborate props or contrived arrangements.",
    '6. Avoid specificity that causes collapse: do not include exact dates, numeric lists, or spelled-out equations/symbols. Phrases like "a chalkboard filled with formulas" are fine, but never write the actual symbols or digits. Exception: on the poster only, include a single 4-digit year along with the title and protagonist’s name. Keep visible text minimal and period-appropriate (headlines ≤ 4 words; signage/mottos ≤ 6 words). All writing must appear on physical surfaces (paper, chalkboard, signage), never floating in the air.',
    "7. Avoid surreal or magical visualizations (e.g., glowing symbols forming from pens); stay grounded in plausible, physical scenes. No neon or holographic overlays, no floating captions/labels, and no attempts to visualize abstract entities as hovering graphics.",
    "8. Characters should not be expected to display legible paper text. Posters on walls, labels, or whiteboards are fine; for posters, stylized text works.",
    "9. Do not request formulas, diagrams, or tables.",
    "10. Ensure the named protagonist appears whenever the narration centres on them; otherwise spotlight the setting, consequences, or supporting cast to keep the beat clear.",
    "11. Keep each `imagePrompt` concise: roughly 12–30 words.",
    "12. Narration tone: plain and natural. Avoid hyperbole or overly dramatic adjectives; keep language straightforward and conversational.",
    `13. Historical focus only in the ${resolvedSegmentCount} ${segmentLabel}: do not include modern devices or references in the ${segmentLabel}. If a modern connection is relevant, reserve it for the \`endingPrompt\` only and keep it brief.`,
    "14. Never depict the listener or any second‑person stand‑in. Do not use 'you', 'student', 'apprentice', 'listener', or 'audience' as subjects in any illustration prompt. If the ending includes a modern connection, express it through objects, settings, or artifacts—not by showing the listener.",
    "15. Physically meaningful visuals only: depict real spaces, people, and objects. Do not request glowing glyphs, neon writing, holographic UI, floating captions, or abstract concepts drawn in mid‑air.",
    "16. Match the narration’s meaning, not isolated keywords. Interpret metaphors, idioms, or symbolic phrases sensibly and depict the actual historical situation being described. Never turn figurative language (e.g., “cornerstone”) into literal objects unless the story explicitly establishes them.",
    "17. Each segment must present a distinct scene or setting that moves the story forward. Do not request minor variations of a prior panel (e.g., slightly different poses or gestures); change the environment, composition, or moment meaningfully while staying consistent with the characters and timeline.",
    "",
    "================ Story to segment ================",
    storyText,
    "==================================================",
    "",
    "segmentation prompt:",
    "------------------",
    "Convert the story into alternating-voice narration segments with illustration prompts plus poster and ending prompts, following all rules above.",
    "Preserve the wording of the story exactly. Do not rewrite, shorten, or add text.",
  ].join("\n");
}

export async function generateStoryIdea(
  topic: string,
  lessonContext?: StoryLessonContext,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  includeCoding: boolean = true,
): Promise<StoryIdeaResult> {
  const adapter = useProgress(progress);
  const prompt = buildStoryIdeaPrompt(topic, lessonContext, includeCoding);
  for (let attempt = 1; attempt <= IDEA_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(IDEA_GENERATION_MAX_ATTEMPTS).padStart(2, "0")}`;
    const subStage = combineDebugSegments(options?.debugSubStage, attemptLabel);
    adapter.log(
      `[story/ideas] generation attempt ${attempt} of ${IDEA_GENERATION_MAX_ATTEMPTS} with web-search-enabled ${TEXT_MODEL_ID}`,
    );
    const ideaDebugOptions = options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: "ideas",
          subStage,
        }
      : undefined;
    const parseDebugOptions = options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: "ideas-parse",
          subStage,
        }
      : undefined;
    try {
      const ideaMarkdown = await generateText({
        progress: adapter,
        modelId: TEXT_MODEL_ID,
        contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
        tools: [{ type: "web-search" }],
        debug: ideaDebugOptions,
      });
      adapter.log("[story/ideas] textual brief prepared");
      const parsePrompt = buildStoryIdeaParsePrompt(topic, ideaMarkdown);
      const data = await generateJson<StoryIdeaData>({
        progress: adapter,
        modelId: TEXT_MODEL_ID,
        contents: [
          { role: "user", parts: [{ type: "text", text: parsePrompt }] },
        ],
        schema: StoryIdeaDataSchema,
        debug: parseDebugOptions,
      });
      const brief = formatIdeaBrief(data);
      adapter.log("[story/ideas-parse] structured brief parsed");
      return { brief, data };
    } catch (error) {
      const message = errorAsString(error);
      if (attempt === IDEA_GENERATION_MAX_ATTEMPTS) {
        adapter.log(
          `[story/ideas] generation attempt ${attempt} failed (${message}); no retries left`,
        );
        throw new Error(
          `Story idea generation failed after ${IDEA_GENERATION_MAX_ATTEMPTS} attempt(s): ${message}`,
        );
      }
      adapter.log(
        `[story/ideas] generation attempt ${attempt} failed (${message}); retrying...`,
      );
    }
  }
  throw new Error("Story idea generation failed; no idea was produced.");
}

function buildOriginsCapsuleResearchContext(idea: StoryIdeaResult): string {
  const data = idea.data;
  if (!data) {
    return idea.brief;
  }
  const { researchSnapshot, recommendation, candidates } = data;
  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === recommendation.selectedCandidateId,
  );
  const lines: string[] = [];
  lines.push(`Conceptual Essence: ${researchSnapshot.conceptualEssence}`);
  lines.push(`Primary Figure: ${researchSnapshot.historicalAnchor.figure}`);
  lines.push(
    `Canonical Event: ${researchSnapshot.historicalAnchor.canonicalEvent}`,
  );
  lines.push(
    `High-Stakes Problem: ${researchSnapshot.historicalAnchor.highStakesProblem}`,
  );
  if (researchSnapshot.namingNote) {
    lines.push(`Naming Note: ${researchSnapshot.namingNote}`);
  }
  if (researchSnapshot.historicalNuance) {
    lines.push(`Historical Nuance: ${researchSnapshot.historicalNuance}`);
  }
  if (selectedCandidate) {
    lines.push(`Selected Angle: ${selectedCandidate.angle}`);
    lines.push(`Anchor Event Detail: ${selectedCandidate.anchorEvent}`);
    if (selectedCandidate.namingNote) {
      lines.push(`Candidate Naming Detail: ${selectedCandidate.namingNote}`);
    }
  }
  return lines.map((line) => `- ${line}`).join("\n");
}

function buildOriginsCapsulePrompt(
  topic: string,
  researchContext: string,
  additionalGuidance?: string,
): string {
  const guidance =
    additionalGuidance && additionalGuidance.trim().length > 0
      ? `\n**Adjustments from fact-check feedback:**\n${additionalGuidance.trim()}\n`
      : "";
  return [
    "### Origins Capsule Forge",
    "",
    `**Role:** Craft a concise Origins Capsule (2-3 sentences) for the concept "${topic}" using the validated research below.`,
    "**Audience:** 12–16 year olds who need a reliable, memorable anchor.",
    "",
    "**Mission Parameters:**",
    "1. Output two or three sentences (max 70 words total) in a single paragraph—no bullet lists, no numbering, no extra commentary.",
    '2. Sentence 1: Introduce the classical anchor using a neutral verb ("described", "published", "popularized") with approximate timing and include the phrasing "now known as" before the concept name.',
    '3. Sentence 2: Add nuance acknowledging parallel work or later developments using hedged language such as "independently developed", "... and others", or "later published".',
    "3a. Optional sentence 3: Smooth the handoff by clarifying why the idea mattered or hinting at its later impact. Do not add new named figures.",
    "3b. After you finish the final sentence, STOP. Do not add extra sentences, examples, parentheticals, or clauses separated by a semicolon.",
    "4. Prefer widely taught, mainstream attributions. When confidence is low, hedge or omit the name instead of asserting it.",
    "4a. Use established names from the research (e.g., Reed–Solomon codes); do not invent new titles, aliases, or brand-like labels.",
    '4b. Do not reuse the story title or any fictional/metaphorical label (e.g., "Interstellar Archivist"); keep names strictly factual.',
    '5. Avoid exclusivity claims ("first", "sole inventor", "coined") unless universally accepted.',
    "6. No citations, quotation marks, or parenthetical lists. Keep to plain prose suitable for narration.",
    '7. Limit to one named individual or institution; mention others only through hedged phrases ("... and others").',
    guidance,
    "**Validated Research Extract:**",
    researchContext,
    "",
    "Return only the 2-3 sentence capsule with standard punctuation.",
  ]
    .filter((segment) => segment !== "")
    .join("\n");
}

function buildOriginsCapsuleValidationPrompt(
  topic: string,
  capsule: string,
  researchContext: string,
): string {
  return [
    "### Origins Capsule Fact-Check",
    "",
    "You are verifying a short Origins Capsule (2-3 sentences, max 70 words) before it is locked for downstream prompts.",
    "",
    "**Capsule Under Review:**",
    capsule,
    "",
    "**Reference Research:**",
    researchContext,
    "",
    "**Validation Checklist:**",
    "1. Names, titles, institutions, and dates must align with mainstream historical accounts referenced in the research extract.",
    '2. Ensure the capsule keeps the neutral "now known as" framing without implying exclusive naming or invention.',
    '3. Confirm hedged nuance is honest—allow "... and others" when additional contributors exist. Do not demand exhaustive lists.',
    "4. Block the capsule only for catastrophic issues: wrong entities, wrong dates, exclusive origin claims, or unverifiable attributions.",
    "",
    "**Instructions:**",
    "- Run web searches as needed to confirm uncertain claims.",
    '- If everything checks out, set verdict to "pass" and leave issues empty.',
    '- If problems remain, set verdict to "fail" and record each blocker with a short summary and a concrete recommendation (e.g., hedge a date, drop a contested name).',
    "",
    "Respond in JSON following the schema with fields 'verdict' and 'issues'.",
  ].join("\n");
}

async function validateOriginsCapsule(
  topic: string,
  capsule: string,
  researchContext: string,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  attemptLabel?: string,
): Promise<OriginsCapsuleValidationResponse> {
  const adapter = useProgress(progress);
  const prompt = buildOriginsCapsuleValidationPrompt(
    topic,
    capsule,
    researchContext,
  );
  const promptWithSchema = [
    prompt,
    "",
    "Return strict JSON matching this schema:",
    '{"verdict":"pass"|"fail","issues":[{"summary":"string","recommendation":"string"}]}',
    "Do not wrap in Markdown or commentary.",
  ].join("\n");
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= ORIGINS_CAPSULE_VALIDATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const validationAttemptLabel = `validation-${String(attempt).padStart(2, "0")}-of-${String(ORIGINS_CAPSULE_VALIDATION_MAX_ATTEMPTS).padStart(2, "0")}`;
    const debug = options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage:
            combineDebugSegments(
              options.debugSubStage ?? "origins",
              attemptLabel,
              validationAttemptLabel,
            ) ??
            `origins/${attemptLabel ?? "validation"}/${validationAttemptLabel}`,
        }
      : undefined;
    try {
      const raw = await generateText({
        progress: adapter,
        modelId: TEXT_MODEL_ID,
        contents: [
          { role: "user", parts: [{ type: "text", text: promptWithSchema }] },
        ],
        tools: [{ type: "web-search" }],
        debug,
      });
      let text = raw.trim();
      const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
      if (fenced?.[1]) {
        text = fenced[1].trim();
      }
      if (!text.startsWith("{") && text.includes("{")) {
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (lastBrace > firstBrace) {
          text = text.slice(firstBrace, lastBrace + 1).trim();
        }
      }
      const parsed: unknown = JSON.parse(text);
      return OriginsCapsuleValidationResponseSchema.parse(parsed);
    } catch (error) {
      lastError = error;
      adapter.log(
        `[story/origins-validation] attempt ${attempt} of ${ORIGINS_CAPSULE_VALIDATION_MAX_ATTEMPTS} failed (${errorAsString(error)})`,
      );
    }
  }
  throw new Error(
    `Origins capsule validation failed after ${ORIGINS_CAPSULE_VALIDATION_MAX_ATTEMPTS} attempts${lastError ? `: ${errorAsString(lastError)}` : ""}`,
  );
}

export async function generateOriginsCapsule(
  topic: string,
  idea: StoryIdeaResult,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
): Promise<StoryOriginsCapsule> {
  const adapter = useProgress(progress);
  const researchContext = buildOriginsCapsuleResearchContext(idea);
  let additionalGuidance: string | undefined;
  for (let attempt = 1; attempt <= ORIGINS_CAPSULE_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(ORIGINS_CAPSULE_MAX_ATTEMPTS).padStart(2, "0")}`;
    adapter.log(`[story/origins] capsule generation ${attemptLabel}`);
    const debug = options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage:
            combineDebugSegments(
              options?.debugSubStage ?? "origins",
              attemptLabel,
              "draft",
            ) ?? `origins/${attemptLabel}/draft`,
        }
      : undefined;
    const prompt = buildOriginsCapsulePrompt(
      topic,
      researchContext,
      additionalGuidance,
    );
    const raw = await generateText({
      progress: adapter,
      modelId: TEXT_MODEL_ID,
      contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
      debug,
    });
    const candidate = raw.replace(/\s+/gu, " ").trim();
    const structuralIssues: string[] = [];
    const sentences = candidate
      .split(/(?<=[.!?])\s+/u)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
    let adjustedCandidate = candidate;
    const sentenceCount = sentences.length;
    if (sentenceCount > 3) {
      adjustedCandidate = sentences.slice(0, 3).join(" ");
      adapter.log(
        `[story/origins] trimmed capsule to first three sentences to satisfy structure (original count: ${sentenceCount})`,
      );
    } else if (sentenceCount < 2) {
      structuralIssues.push(
        `Produce two or three sentences separated by a single space (you returned ${sentenceCount}).`,
      );
    }
    const wordCount = adjustedCandidate.length
      ? adjustedCandidate.split(/\s+/u).filter((word) => word.length > 0).length
      : 0;
    if (wordCount === 0) {
      structuralIssues.push("The capsule was empty.");
    }
    if (wordCount > 70) {
      structuralIssues.push(
        `Reduce the word count to 70 or fewer (current count: ${wordCount}).`,
      );
    }
    if (structuralIssues.length > 0) {
      additionalGuidance = [
        "Fix the structural issues before retrying:",
        ...structuralIssues.map((issue) => `- ${issue}`),
      ].join("\n");
      adapter.log(
        `[story/origins] structural check failed: ${structuralIssues.join(", ")}`,
      );
      continue;
    }

    const validation = await validateOriginsCapsule(
      topic,
      adjustedCandidate,
      researchContext,
      progress,
      options,
      attemptLabel,
    );
    if (validation.verdict === "pass") {
      adapter.log("[story/origins] capsule validated");
      return StoryOriginsCapsuleSchema.parse({ text: candidate });
    }

    const blockers = validation.issues.length
      ? validation.issues
      : [
          {
            summary:
              "Fact-checker flagged unresolved concerns without specific details.",
            recommendation:
              "Increase hedging or remove uncertain names before retrying.",
          },
        ];
    additionalGuidance = [
      "Revise the capsule to address the fact-check feedback:",
      ...blockers.map(
        (issue, index) =>
          `${index + 1}. ${issue.summary} — ${issue.recommendation}`,
      ),
      "Default to hedged phrasing or drop disputed claims if certainty is low.",
    ].join("\n");
    adapter.log(
      `[story/origins] fact-check failed: ${blockers
        .map((issue) => issue.summary)
        .join("; ")}`,
    );
  }

  throw new Error(
    `Origins capsule generation failed after ${ORIGINS_CAPSULE_MAX_ATTEMPTS} attempt(s).`,
  );
}

export async function generateStoryProseDraft(
  topic: string,
  idea: StoryIdeaResult,
  originsCapsule: StoryOriginsCapsule,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): Promise<StoryProseDraftResult> {
  const adapter = useProgress(progress);
  adapter.log(`[story] generating prose draft with ${TEXT_MODEL_ID}`);
  const prompt = buildStoryDraftPrompt(
    topic,
    idea.brief,
    originsCapsule.text,
    lessonContext,
    includeCoding,
  );
  const text = await generateText({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: "prose",
          subStage: (() => {
            const parts: string[] = [];
            if (options.debugSubStage) {
              parts.push(options.debugSubStage);
            }
            parts.push("draft");
            return parts.join("/");
          })(),
        }
      : undefined,
  });
  adapter.log("[story/prose] draft produced");
  return { text };
}

export async function generateStoryProseRevision(
  topic: string,
  draft: StoryProseDraftResult,
  originsCapsule: StoryOriginsCapsule,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  feedback?: string,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): Promise<StoryProseRevisionResult> {
  const adapter = useProgress(progress);
  adapter.log(`[story] revising prose with ${TEXT_MODEL_ID}`);
  const prompt = buildStoryRevisionPrompt(
    topic,
    draft.text,
    originsCapsule.text,
    feedback,
    lessonContext,
    includeCoding,
  );
  const response = await generateJson<StoryProseRevisionResponse>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: StoryProseRevisionResponseSchema,
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: ["prose", options.debugSubStage ?? "revision"]
            .filter((segment): segment is string => !!segment)
            .join("/"),
        }
      : undefined,
  });
  adapter.log("[story/prose-revision] analysis and revision complete");
  const title = response.revisedStory.title.trim();
  const paragraphs = response.revisedStory.paragraphs
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (!title) {
    throw new Error("Story revision did not include a title");
  }
  if (paragraphs.length === 0) {
    throw new Error("Story revision did not include any paragraphs");
  }
  const text = [title, "", ...paragraphs].join("\n");
  return {
    text,
    analysis: response.analysis,
    improvementSummary: response.improvementSummary.trim(),
    fixChecklist: response.fixChecklist,
  };
}

export async function validateStoryProse(
  topic: string,
  revision: StoryProseRevisionResult,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  includeCoding: boolean = true,
): Promise<StoryProseValidationResult> {
  const adapter = useProgress(progress);
  const buildStagePath = (leaf: string): string | undefined => {
    if (!options?.debugRootDir) {
      return undefined;
    }
    const segments = [
      "prose",
      options.debugSubStage,
      "validation",
      leaf,
    ].filter((segment): segment is string => !!segment && segment.length > 0);
    return segments.join("/");
  };

  adapter.log(
    `[story] validating prose – factual analysis with ${TEXT_MODEL_ID}`,
  );
  const factualPrompt = buildStoryFactualValidationPrompt(topic, revision.text);
  const factualReport = await generateText({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [
      { role: "user", parts: [{ type: "text", text: factualPrompt }] },
    ],
    tools: [{ type: "web-search" }],
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: buildStagePath("factual") ?? "prose/validation/factual",
        }
      : undefined,
  });
  const factualParsePrompt =
    buildStoryFactualValidationParsePrompt(factualReport);
  const factualResponse = await generateJson<StoryProseValidationResult>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [
      { role: "user", parts: [{ type: "text", text: factualParsePrompt }] },
    ],
    schema: StoryProseValidationResultSchema,
    maxAttempts: 3,
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage:
            buildStagePath("factual-parse") ?? "prose/validation/factual-parse",
        }
      : undefined,
  });
  adapter.log(
    `[story/prose-validation] factual verdict: ${factualResponse.verdict}${factualResponse.issues.length ? ` (${factualResponse.issues.length} issue(s))` : ""}`,
  );
  if (factualResponse.verdict === "fail") {
    return factualResponse;
  }

  adapter.log(
    `[story] validating prose – structural pass with ${TEXT_MODEL_ID}`,
  );
  const structuralPrompt = buildStoryValidationPrompt(
    topic,
    revision.text,
    includeCoding,
  );
  const structuralResponse = await generateJson<StoryProseValidationResult>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [
      { role: "user", parts: [{ type: "text", text: structuralPrompt }] },
    ],
    schema: StoryProseValidationResultSchema,
    maxAttempts: 2,
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: buildStagePath("quality") ?? "prose/validation/quality",
        }
      : undefined,
  });
  adapter.log(
    `[story/prose-validation] verdict: ${structuralResponse.verdict}${structuralResponse.issues.length ? ` (${structuralResponse.issues.length} issue(s))` : ""}`,
  );
  if (!structuralResponse.blockers) {
    throw new Error(
      "Story validation response omitted the blockers object; retrying",
    );
  }
  return structuralResponse;
}

function summariseValidationIssues(
  issues: readonly StoryProseValidationIssue[],
): string {
  if (issues.length === 0) {
    return "no detailed issues provided";
  }
  return issues
    .map((issue, index) => {
      const tagSegment = issue.tag ? ` - ${issue.tag}` : "";
      const label = `${index + 1}. [${issue.severity.toUpperCase()} - ${issue.category}${tagSegment}]`;
      return `${label} ${issue.summary}`;
    })
    .join("; ");
}

function buildBlockerMessages(
  blockers: StoryValidationBlockers | undefined,
): string[] {
  if (!blockers) {
    return [];
  }
  const messages: string[] = [];
  if (blockers.namingAttribution === true) {
    messages.push(
      "Replace ‘coined/named/formalized by’ with neutral ‘now known as’ / ‘widely called’ phrasing.",
    );
  }
  if (blockers.exclusivityClaim === true) {
    messages.push(
      "Remove exclusive ‘first/sole’ origin claims; swap them for hedged language like ‘credited among early contributors’.",
    );
  }
  if (blockers.modernTieInOverclaim === true) {
    messages.push(
      "Rework the ending into a hedged modern bridge (approved template or a short analogy that states both the resemblance and the difference) while keeping the promise to learn and practice.",
    );
    messages.push(
      "Remove any speculative lineage between historical troubleshooting and modern computing; keep parallels as explicit comparisons, not origin claims.",
    );
  }
  const datePrecision = blockers.datePrecision;
  if (
    datePrecision === "recommend-hedge" ||
    (typeof datePrecision === "boolean" && datePrecision)
  ) {
    messages.push(
      "Use an approximate era (e.g., ‘late 19xx’) instead of a precise date unless high confidence.",
    );
  }
  if (blockers.wrongEntity === true) {
    messages.push(
      "Correct names, titles, or institutions to the mainstream textbook versions.",
    );
  }
  return messages;
}

function buildFixChecklistMismatches(
  blockers: StoryValidationBlockers | undefined,
  checklist: StoryFixChecklist | undefined,
): string[] {
  if (!blockers || !checklist) {
    return [];
  }
  const messages: string[] = [];
  if (blockers.namingAttribution === true && checklist.namingAttribution) {
    messages.push(
      "Set fixChecklist.namingAttribution to false until the prose uses neutral naming (‘now known as’ / ‘widely called’).",
    );
  }
  if (blockers.exclusivityClaim === true && checklist.exclusivityClaim) {
    messages.push(
      "Set fixChecklist.exclusivityClaim to false until exclusive ‘first/sole’ phrasing is removed.",
    );
  }
  if (
    blockers.modernTieInOverclaim === true &&
    checklist.modernTieInOverclaim
  ) {
    messages.push(
      "Set fixChecklist.modernTieInOverclaim to false until the ending uses an approved hedged bridge or an explicit analogy that names both similarity and difference.",
    );
  }
  if (blockers.wrongEntity === true && checklist.wrongEntity) {
    messages.push(
      "Set fixChecklist.wrongEntity to false until all names and titles match mainstream accounts.",
    );
  }
  const datePrecision = blockers.datePrecision;
  if (
    (datePrecision === "recommend-hedge" ||
      (typeof datePrecision === "boolean" && datePrecision)) &&
    checklist.datePrecision !== "recommend-hedge"
  ) {
    messages.push(
      'Set fixChecklist.datePrecision to "recommend-hedge" until the timeline uses approximate phrasing.',
    );
  }
  return messages;
}

function buildValidationFeedback(
  issues: readonly StoryProseValidationIssue[],
  blockers: StoryValidationBlockers | undefined,
): string {
  const sections: string[] = [];
  const blockerMessages = buildBlockerMessages(blockers);
  if (blockerMessages.length > 0) {
    sections.push(
      "Resolve the guardrail blockers:",
      ...blockerMessages.map((message, index) => `${index + 1}. ${message}`),
    );
  }

  if (issues.length > 0) {
    const detailed = issues.map((issue, index) => {
      const tagSegment = issue.tag ? ` – ${issue.tag}` : "";
      const lines = [
        `${index + 1}. (${issue.severity.toUpperCase()} – ${issue.category}${tagSegment}) ${issue.summary}`,
        `   Evidence: ${issue.evidence}`,
        `   Recommendation: ${issue.recommendation}`,
      ];
      return lines.join("\n");
    });
    sections.push("Detailed fact-check notes:", ...detailed);
  }
  const hasModernOverclaim = issues.some(
    (issue) => issue.tag === "modernTieInOverclaim",
  );
  if (hasModernOverclaim) {
    sections.push(
      "Modern tie-in guardrail: swap any invented lineage for a hedged analogy that names the similarity and the mismatch. Use an approved ending or a short contrastive bridge, and still invite the learner to explore the real algorithm next.",
    );
  }

  if (sections.length === 0) {
    return "The fact-checker flagged the story but did not supply actionable feedback. Recheck every guardrail (naming, exclusivity, modern tie-in, date precision, wrong entities) before attempting another revision.";
  }

  return sections.join("\n");
}

const ORIGINS_CAPSULE_MAX_ATTEMPTS = 5;
const ORIGINS_CAPSULE_VALIDATION_MAX_ATTEMPTS = 3;
const IDEA_GENERATION_MAX_ATTEMPTS = 3;
const PROSE_DRAFT_MAX_ATTEMPTS = 3;
const PROSE_REVISION_MAX_ATTEMPTS = 5;

function combineDebugSegments(
  ...segments: (string | undefined)[]
): string | undefined {
  const cleaned = segments.flatMap((segment) =>
    typeof segment === "string"
      ? segment
          .split("/")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : [],
  );
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.join("/");
}

function formatIdeaBrief(data: StoryIdeaData): string {
  const { researchSnapshot, candidates, recommendation } = data;
  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === recommendation.selectedCandidateId,
  );
  if (!selectedCandidate) {
    throw new Error(
      `Story idea recommendation referenced missing candidate ${recommendation.selectedCandidateId}`,
    );
  }

  const lines: string[] = [];
  lines.push("### Research Snapshot");
  lines.push("");
  lines.push(`- Conceptual Essence: ${researchSnapshot.conceptualEssence}`);
  lines.push(
    `- Historical Anchor: ${researchSnapshot.historicalAnchor.figure}`,
  );
  lines.push(
    `- Canonical Event: ${researchSnapshot.historicalAnchor.canonicalEvent}`,
  );
  lines.push(
    `- High-Stakes Problem: ${researchSnapshot.historicalAnchor.highStakesProblem}`,
  );
  const functionalAnalogies =
    researchSnapshot.narrativeElements.functionalAnalogies
      .map((analogy) => `${analogy.name}: ${analogy.description}`)
      .join("; ");
  lines.push(`- Functional Analogies: ${functionalAnalogies}`);
  lines.push(
    `- Contrasting Foil: ${researchSnapshot.narrativeElements.contrastingFoil}`,
  );
  lines.push(
    `- Invisible Architecture Pivot: ${researchSnapshot.narrativeElements.invisibleArchitecturePivot}`,
  );
  const terminology = researchSnapshot.keyTerminologyGloss ?? [];
  if (terminology.length > 0) {
    lines.push("- Key Terminology & Gloss:");
    for (const entry of terminology) {
      lines.push(`  * ${entry.term}: ${entry.definition}`);
    }
  }
  lines.push(
    `- Key Term to Name in Story: ${researchSnapshot.keyTermToNameInStory}`,
  );
  if (researchSnapshot.namingNote) {
    lines.push(`- Naming Note: ${researchSnapshot.namingNote}`);
  }
  if (researchSnapshot.historicalNuance) {
    lines.push(`- Historical Nuance: ${researchSnapshot.historicalNuance}`);
  }

  lines.push("");
  lines.push("### Selected Narrative Direction");
  lines.push(`- Angle: ${selectedCandidate.angle}`);
  lines.push(`- Anchor Event: ${selectedCandidate.anchorEvent}`);
  lines.push(`- Analogy: ${selectedCandidate.analogy}`);
  if (selectedCandidate.endingPivot) {
    lines.push(`- Ending Pivot: ${selectedCandidate.endingPivot}`);
  }
  lines.push(`- Lesson Teaser: ${selectedCandidate.lessonTeaser}`);
  if (selectedCandidate.namingNote) {
    lines.push(`- Candidate Naming Note: ${selectedCandidate.namingNote}`);
  }
  lines.push(`- Recommendation Rationale: ${recommendation.rationale}`);

  lines.push("");
  lines.push("### Lesson Seeds");
  lines.push(`- Analogy Clarifier: ${researchSnapshot.analogyClarifierSeed}`);
  lines.push(`- Closing Invitation: ${researchSnapshot.closingInvitationSeed}`);

  return lines.join("\n");
}

function buildVariantDebugOptions(
  base: StoryDebugOptions | undefined,
  variantLabel: StoryProseVariantLabel,
  ...extraSegments: string[]
): StoryDebugOptions | undefined {
  if (!base?.debugRootDir) {
    return undefined;
  }
  return {
    debugRootDir: base.debugRootDir,
    debugSubStage: combineDebugSegments(
      base.debugSubStage,
      variantLabel,
      ...extraSegments,
    ),
  };
}

async function prepareProseVariantDraft(
  topic: string,
  label: StoryProseVariantLabel,
  idea: StoryIdeaResult,
  originsCapsule: StoryOriginsCapsule,
  progress?: StoryProgress,
  baseDebug?: StoryDebugOptions,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): Promise<StoryProseDraftVariant> {
  const adapter = useProgress(progress);
  for (let attempt = 1; attempt <= PROSE_DRAFT_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(PROSE_DRAFT_MAX_ATTEMPTS).padStart(2, "0")}`;
    adapter.log(
      `[story/prose/${label}] draft attempt ${attempt} of ${PROSE_DRAFT_MAX_ATTEMPTS}`,
    );
    const draftOptions = buildVariantDebugOptions(
      baseDebug,
      label,
      attemptLabel,
    );
    try {
      const draft = await generateStoryProseDraft(
        topic,
        idea,
        originsCapsule,
        progress,
        draftOptions,
        lessonContext,
        includeCoding,
      );
      return { label, idea, originsCapsule, draft };
    } catch (error) {
      const message = errorAsString(error);
      if (attempt === PROSE_DRAFT_MAX_ATTEMPTS) {
        adapter.log(
          `[story/prose/${label}] draft attempt ${attempt} failed (${message}); no retries left`,
        );
        throw new Error(
          `Story prose draft generation failed for ${label} after ${PROSE_DRAFT_MAX_ATTEMPTS} attempt(s): ${message}`,
        );
      }
      adapter.log(
        `[story/prose/${label}] draft attempt ${attempt} failed (${message}); retrying...`,
      );
    }
  }
  throw new Error(
    `Story prose draft generation failed for ${label}; no draft was produced.`,
  );
}

async function reviseProseVariant(
  topic: string,
  variant: StoryProseDraftVariant,
  progress?: StoryProgress,
  baseDebug?: StoryDebugOptions,
  lessonContext?: StoryLessonContext,
  includeCoding: boolean = true,
): Promise<StoryProseVariantCandidate> {
  const adapter = useProgress(progress);
  let draftForRevision: StoryProseDraftResult = variant.draft;
  let feedback: string | undefined;
  let revision: StoryProseRevisionResult | undefined;
  for (let attempt = 1; attempt <= PROSE_REVISION_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `revisions/attempt-${String(attempt).padStart(2, "0")}-of-${String(PROSE_REVISION_MAX_ATTEMPTS).padStart(2, "0")}`;
    adapter.log(
      `[story/prose/${variant.label}] revision attempt ${attempt} of ${PROSE_REVISION_MAX_ATTEMPTS}`,
    );
    const revisionOptions = buildVariantDebugOptions(
      baseDebug,
      variant.label,
      attemptLabel,
      "revision",
    );
    const validationOptions = buildVariantDebugOptions(
      baseDebug,
      variant.label,
      attemptLabel,
      "validation",
    );
    const candidate = await generateStoryProseRevision(
      topic,
      draftForRevision,
      variant.originsCapsule,
      progress,
      revisionOptions,
      feedback,
      lessonContext,
      includeCoding,
    );
    const validation = await validateStoryProse(
      topic,
      candidate,
      progress,
      validationOptions,
      includeCoding,
    );
    if (validation.verdict === "pass") {
      const lingeringBlockers = buildBlockerMessages(validation.blockers);
      if (lingeringBlockers.length > 0) {
        throw new Error(
          `Story validation reported 'pass' but blockers remain: ${lingeringBlockers.join("; ")}`,
        );
      }
      revision = { ...candidate, validation };
      break;
    }
    const summary = validation.issues.length
      ? summariseValidationIssues(validation.issues)
      : "Validation failed without reported issues.";
    adapter.log(
      `[story/prose-validation/${variant.label}] attempt ${attempt} failed: ${summary}`,
    );
    if (attempt === PROSE_REVISION_MAX_ATTEMPTS) {
      throw new Error(
        `Story prose validation failed for ${variant.label} after ${PROSE_REVISION_MAX_ATTEMPTS} attempt(s): ${summary}`,
      );
    }
    const checklistMismatches = buildFixChecklistMismatches(
      validation.blockers,
      candidate.fixChecklist,
    );
    const validationFeedback = buildValidationFeedback(
      validation.issues,
      validation.blockers,
    );
    let nextFeedback = validationFeedback;
    if (checklistMismatches.length > 0) {
      nextFeedback = [
        "Update the fixChecklist so it reflects unresolved blockers:",
        ...checklistMismatches,
        "",
        validationFeedback,
      ].join("\n");
    }
    feedback = feedback
      ? `${feedback}\n\nDo not lose prior fixes. Also address:\n${nextFeedback}`
      : nextFeedback;
    draftForRevision = candidate;
  }
  if (!revision) {
    throw new Error(
      `Story prose revision did not produce a validated result for ${variant.label}`,
    );
  }
  return {
    label: variant.label,
    idea: variant.idea,
    draft: variant.draft,
    originsCapsule: variant.originsCapsule,
    revision,
  };
}

function buildProseVariantsJudgePrompt(
  topic: string,
  variants: readonly StoryProseVariantCandidate[],
): string {
  const lines: string[] = [
    "### Prompt 5: Story Variant Judge",
    "",
    `Topic: ${topic}`,
    "",
    "You are evaluating two fully revised story drafts (Variant A and Variant B) of the same narrative. Choose the version that best fulfils the mission:",
    "- Delivers a vivid, cinematic explanation that keeps the protagonist central and memorable.",
    "- Preserves historical accuracy, required beats (concept naming, insight hint, modern tie-in in the ending), and age-appropriate language.",
    "- Maintains narrative momentum with a crisp reveal and empowering ending tied to the analogy.",
    "- Uses the strongest imagery, emotional resonance, and clarity while avoiding collapse or confusing detours.",
    "",
    "Consider the idea brief, model revision analysis, improvement summary, and the final story text. Prefer the variant that you would ship to learners without further edits.",
    "",
  ];
  const sorted = [...variants].sort((a, b) => a.label.localeCompare(b.label));
  for (const variant of sorted) {
    const variantName =
      variant.label === "variant_a" ? "Variant A" : "Variant B";
    lines.push(`===== ${variantName} =====`);
    lines.push(`Idea Brief:\n${variant.idea.brief}`);
    lines.push(`Improvement Summary:\n${variant.revision.improvementSummary}`);
    const analysis = variant.revision.analysis;
    lines.push("Analysis Scores:");
    lines.push(
      [
        `- Metaphorical Power: ${analysis.metaphoricalIntegrity.score}/5 – ${analysis.metaphoricalIntegrity.justification}`,
        `- Narrative Momentum: ${analysis.narrativeMomentum.score}/5 – ${analysis.narrativeMomentum.justification}`,
        `- Conceptual Clarity: ${analysis.conceptualClarity.score}/5 – ${analysis.conceptualClarity.justification}`,
        `- Audience Resonance: ${analysis.audienceResonance.score}/5 – ${analysis.audienceResonance.justification}`,
        `- Motivational Power: ${analysis.motivationalPower.score}/5 – ${analysis.motivationalPower.justification}`,
      ].join("\n"),
    );
    const validation = variant.revision.validation;
    if (validation) {
      lines.push(
        `Validation Verdict: ${validation.verdict.toUpperCase()}${validation.issues.length ? ` (previously flagged ${validation.issues.length} issue(s))` : ""}`,
      );
    }
    lines.push("Story:");
    lines.push(variant.revision.text);
    lines.push("");
  }
  lines.push(
    'Respond in JSON with keys `reasoning` (short paragraph explaining your choice) and `verdict` (`"variant_a"` or `"variant_b"`).',
  );
  return lines.join("\n");
}

async function judgeProseVariants(
  topic: string,
  variants: readonly StoryProseVariantCandidate[],
  progress?: StoryProgress,
  baseDebug?: StoryDebugOptions,
): Promise<StoryProseVariantsJudgeSummary> {
  if (variants.length !== STORY_PROSE_VARIANT_LABELS.length) {
    throw new Error(
      `Expected ${STORY_PROSE_VARIANT_LABELS.length} variants for judging, received ${variants.length}`,
    );
  }
  const adapter = useProgress(progress);
  adapter.log("[story/prose-variants-judge] evaluating variant_a vs variant_b");
  const prompt = buildProseVariantsJudgePrompt(topic, variants);
  const response = await generateJson<ProseVariantJudgeResponse>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: ProseVariantJudgeResponseSchema,
    debug: baseDebug?.debugRootDir
      ? {
          rootDir: baseDebug.debugRootDir,
          stage: "prose/variants-judge",
          subStage: baseDebug.debugSubStage,
        }
      : undefined,
  });
  adapter.log(
    `[story/prose-variants-judge] verdict ${response.verdict} – ${response.reasoning}`,
  );
  return {
    verdict: response.verdict,
    reasoning: response.reasoning.trim(),
  };
}

export async function generateProseStory(
  topic: string,
  lessonContext?: StoryLessonContext,
  progress?: StoryProgress,
  options?: StoryProseOptions,
): Promise<StoryProseResult> {
  const includeCoding = options?.includeCoding ?? true;
  const idea = await generateStoryIdea(
    topic,
    lessonContext,
    progress,
    options,
    includeCoding,
  );
  const originsCapsule = await generateOriginsCapsule(
    topic,
    idea,
    progress,
    options,
  );
  const variantDrafts = await Promise.all(
    STORY_PROSE_VARIANT_LABELS.map((label) =>
      prepareProseVariantDraft(
        topic,
        label,
        idea,
        originsCapsule,
        progress,
        options,
        lessonContext,
        includeCoding,
      ),
    ),
  );
  const variantResults = await Promise.all(
    variantDrafts.map((variant) =>
      reviseProseVariant(
        topic,
        variant,
        progress,
        options,
        lessonContext,
        includeCoding,
      ),
    ),
  );
  const judge = await judgeProseVariants(
    topic,
    variantResults,
    progress,
    options,
  );
  const winning = variantResults.find(
    (variant) => variant.label === judge.verdict,
  );
  if (!winning) {
    throw new Error(
      `Variant judge returned verdict ${judge.verdict}, but no matching variant was produced`,
    );
  }
  return {
    text: winning.revision.text,
    metadata: {
      ideaBrief: winning.idea.brief,
      draftText: winning.draft.text,
      originsCapsule: winning.originsCapsule.text,
      analysis: winning.revision.analysis,
      improvementSummary: winning.revision.improvementSummary,
      fixChecklist: winning.revision.fixChecklist,
      validation: winning.revision.validation,
      variantLabel: judge.verdict,
      variants: variantResults.map((variant) => ({
        label: variant.label,
        ideaBrief: variant.idea.brief,
        draftText: variant.draft.text,
        originsCapsule: variant.originsCapsule.text,
        text: variant.revision.text,
        analysis: variant.revision.analysis,
        improvementSummary: variant.revision.improvementSummary,
        fixChecklist: variant.revision.fixChecklist,
        validation: variant.revision.validation,
      })),
      judge,
    },
  };
}

const SEGMENTATION_CORRECTION_ATTEMPTS = 3;

function buildSegmentationCorrectorPrompt(
  segmentation: StorySegmentation,
  generationPrompt: string,
): string {
  const segmentCount = segmentation.segments.length;
  const panelRangeLabel =
    segmentCount === 1 ? "story panel 1" : `story panels 1-${segmentCount}`;
  const promptRangeLabel =
    segmentCount === 1
      ? "0 = story panel 1"
      : `0-${segmentCount - 1} = story panels 1-${segmentCount}`;
  const lines: string[] = [
    "You are the image prompt corrector for illustrated historical stories.",
    "Assess whether the illustration prompts comply with the brief and rewrite only the prompts that violate the rules.",
    "",
    "Only include entries under `corrections` for prompts that must be updated.",
    "",
    "Check for:",
    "- Prompts are short and plain: one sentence, roughly 12–30 words.",
    "- Ground the scene loosely in era and place (e.g., '17th‑century study', 'university office'), avoiding exact dates, numbers, or quotations (poster may include a single 4-digit year).",
    "- One clear action with focal characters or environment cues; avoid camera jargon and contrived staging (no mirrored/split scenes, no elaborate apparatus).",
    "- Stay grounded: no surreal or ethereal effects (no floating/glowing symbols).",
    "- No neon or holographic overlays. Any writing must be on physical surfaces (paper, chalkboard, signage), not floating in the air.",
    "- Do not attempt to visualize abstract entities as hovering graphics; depict physical artifacts instead (e.g., a ledger, a letter, a map, a machine).",
    "- Follow the historical beat described; do not invent new artifacts beyond everyday period items.",
    "- Poster prompts must include a bold 2–4 word title, the historical figure’s name, and a single 4-digit year as visible text (each supporting element under six words).",
    `- No modern-world references in ${panelRangeLabel}; if a modern connection exists, it must appear only in the ending card text and remain brief.`,
    "- Never depict the listener or a second-person stand‑in. Remove 'you', 'student', 'apprentice', 'listener', or 'audience' as subjects; rewrite to focus on historical figures, settings, or artifacts instead.",
    "- Prompts must match the narration’s intended meaning. Do not literalize idioms or latch onto keywords that change the beat’s context.",
    "- Consecutive frames must feel like distinct scenes. Reject prompts that only introduce small pose tweaks or superficial changes instead of new settings or moments.",
    '- Any visible writing is minimal and never spells out equations; digits are allowed only for the single 4-digit year on the poster. Generic phrases like "chalkboard filled with formulas" are acceptable.',
    "- Characters are not expected to hold a paper, book or poster.",
    "- No formulas, diagrams, or tables are requested.",
    "- Ensure the protagonist is present when the narration or prompt centres on them; environmental cutaways are fine when explicitly described.",
    "",
    "===== Segmentation generation brief =====",
    generationPrompt,
    "===== End brief =====",
    "",
    `Indexed prompts (${promptRangeLabel}, ${segmentCount} = ending card labelled "the end", ${segmentCount + 1} = poster):`,
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

  return buildStorySegmentationSchema(totalSegments).parse(draft);
}

export async function generateStorySegmentation(
  storyText: string,
  topic: string,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  segmentCount?: number,
): Promise<StorySegmentation> {
  const adapter = useProgress(progress);
  adapter.log(`[story] generating narration segments with ${TEXT_MODEL_ID}`);
  const resolvedSegmentCount = resolveStorySegmentCount(segmentCount);
  const prompt = buildSegmentationPrompt(
    storyText,
    topic,
    resolvedSegmentCount,
  );
  const segmentationSchema = buildStorySegmentationSchema(resolvedSegmentCount);
  const segmentation = await generateJson<StorySegmentation>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    schema: segmentationSchema,
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: "segmentation",
          subStage: options.debugSubStage,
        }
      : undefined,
  });
  adapter.log("[story/segments] parsed successfully");
  return segmentation;
}

export async function correctStorySegmentation(
  storyText: string,
  topic: string,
  initialSegmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  segmentCount?: number,
): Promise<StorySegmentation> {
  const adapter = useProgress(progress);
  const resolvedSegmentCount = resolveStorySegmentCount(segmentCount);
  const generationPrompt = buildSegmentationPrompt(
    storyText,
    topic,
    resolvedSegmentCount,
  );
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
    const maxPromptIndex = resolvedSegmentCount + 1;
    const parseSchema =
      buildSegmentationCorrectorResponseSchema(maxPromptIndex);
    const attemptLabel = `corrections/attempt-${String(attempt).padStart(3, "0")}-of-${String(SEGMENTATION_CORRECTION_ATTEMPTS).padStart(3, "0")}`;
    const stageLabel =
      [options?.debugSubStage, attemptLabel]
        .filter(
          (segment): segment is string =>
            typeof segment === "string" && segment.length > 0,
        )
        .join("/") || attemptLabel;
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
        schema: parseSchema,
        debug: options?.debugRootDir
          ? {
              rootDir: options.debugRootDir,
              stage: stageLabel,
              subStage: "review",
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
        const message = errorAsString(error);
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} failed to apply corrections (${message}); retrying...`,
        );
      }
    } catch (error) {
      const message = errorAsString(error);
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

type SegmentationImageEntry = {
  index: number;
  prompt: string;
  narration: readonly string[];
};

type SegmentationImageContext = {
  entries: SegmentationImageEntry[];
  promptsByIndex: Map<number, string>;
  narrationsByIndex: Map<number, readonly string[]>;
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
  const narrationsByIndex = new Map<number, readonly string[]>();

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
    const narrationLines = segment.narration.map(
      (line) => `${line.voice}: ${line.text}`,
    );
    entries.push({ index, prompt: segmentPrompt, narration: narrationLines });
    promptsByIndex.set(index, segmentPrompt);
    narrationsByIndex.set(index, narrationLines);
  }

  const endingIndex = segmentation.segments.length + 1;
  entries.push({ index: endingIndex, prompt: endingPrompt, narration: [] });
  promptsByIndex.set(endingIndex, endingPrompt);
  narrationsByIndex.set(endingIndex, []);

  const posterIndex = segmentation.segments.length + 2;
  entries.push({ index: posterIndex, prompt: posterPrompt, narration: [] });
  promptsByIndex.set(posterIndex, posterPrompt);
  narrationsByIndex.set(posterIndex, []);

  return {
    entries,
    promptsByIndex,
    narrationsByIndex,
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
  imageSize?: LlmImageSize;
  progress: JobProgressReporter;
  modelId: typeof IMAGE_MODEL_ID;
  debug?: LlmDebugOptions;
  imageGradingPrompt: string;
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
    imageGradingPrompt: options.imageGradingPrompt,
    maxAttempts: options.maxAttempts ?? 4,
    imageAspectRatio: options.imageAspectRatio,
    imageSize: options.imageSize,
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
    "Ensure the poster clearly displays: (a) a bold 2–4 word title, (b) the historical figure’s name, and (c) a single 4-digit year relevant to the story — all as visible text and period-appropriate.",
    "Respect the prompt's typography guidance and prefer candidates where this text is readable and well-composed (each supporting element under six words). The text must be integrated as physical typography (printed/painted on a surface), not neon or holographic overlays, and not floating in the air.",
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
    debug: options.debug,
  });

  return response;
}

export async function generateImageSets(
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
): Promise<StoryImageSet[]> {
  const adapter = useProgress(progress);
  const { entries, endingIndex, posterIndex, narrationsByIndex } =
    collectSegmentationImageContext(segmentation);
  const styleLines = ART_STYLE;
  const stylePrompt = styleLines.join("\n");
  const baseDebug: LlmDebugOptions | undefined = options?.debugRootDir
    ? { rootDir: options.debugRootDir, stage: "image-sets" }
    : undefined;
  const baseSubStage = options?.debugSubStage;
  const normaliseDebugPathSegment = (value: string): string => {
    const cleaned = value
      .trim()
      .replace(/[^a-z0-9\-_/]+/gi, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-_/]+|[-_/]+$/g, "");
    return cleaned.length > 0 ? cleaned : "segment";
  };
  const resolveImageSetDebugRoot = (
    imageSetLabel: "set_a" | "set_b",
  ): string | undefined => {
    if (!baseDebug?.rootDir) {
      return undefined;
    }
    const segments = [baseSubStage, imageSetLabel]
      .filter((segment): segment is string => typeof segment === "string")
      .flatMap((segment) => segment.split("/"))
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0)
      .map((segment) => normaliseDebugPathSegment(segment));
    return path.join(baseDebug.rootDir, "stages", "image-sets", ...segments);
  };
  const buildDebug = (subStage: string): LlmDebugOptions | undefined => {
    if (!baseDebug) {
      return undefined;
    }
    const segments = [baseSubStage, subStage]
      .filter((segment): segment is string => typeof segment === "string")
      .flatMap((segment) => segment.split("/"))
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    const cleaned = segments.join("/");
    return {
      ...baseDebug,
      subStage: cleaned.length > 0 ? cleaned : undefined,
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
    const stageHandle = adapter.startStage
      ? adapter.startStage(`images/${imageSetLabel}`)
      : Symbol("stage");
    try {
      const imageSetDebugRoot = resolveImageSetDebugRoot(imageSetLabel);
      if (imageSetDebugRoot) {
        try {
          await rm(imageSetDebugRoot, { recursive: true, force: true });
        } catch (error) {
          adapter.log(
            `[story/image-sets/${imageSetLabel}] failed to clear debug directory: ${errorAsString(
              error,
            )}`,
          );
        }
      }
      const frameNarrationByIndex = new Map<number, readonly string[]>();
      for (const entry of panelEntries) {
        const narrationLines =
          narrationsByIndex.get(entry.index) ?? entry.narration ?? [];
        frameNarrationByIndex.set(entry.index, narrationLines);
      }
      let lastError: unknown;

      for (
        let attempt = 1;
        attempt <= IMAGE_SET_GENERATE_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(
          IMAGE_SET_GENERATE_MAX_ATTEMPTS,
        ).padStart(2, "0")}`;
        const attemptLogPrefix = `[story/image-sets/${imageSetLabel}] [${attemptLabel}]`;
        const logWithAttempt = (message: string) => {
          adapter.log(`${attemptLogPrefix} ${message}`);
        };
        const attemptDebug = (subStage: string): LlmDebugOptions | undefined =>
          buildDebug(`${imageSetLabel}/${attemptLabel}/${subStage}`);

        try {
          logWithAttempt(
            `generating main frames (${panelEntries.length} prompts)`,
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
            frameNarrationByIndex,
            debug: attemptDebug("main"),
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
            logWithAttempt(
              `received image ${entry.index} (${part.data.length} bytes)`,
            );
          }

          const posterReferences = mainImageParts.slice(0, 4);
          logWithAttempt("generating poster candidates (4 variants)");
          const posterCandidatePromises = Array.from({ length: 4 }).map(
            async (_, offset) => {
              const candidateIndex = offset + 1;
              const image = await generateSingleImage({
                progress: adapter,
                modelId: IMAGE_MODEL_ID,
                stylePrompt,
                styleImages: posterReferences,
                prompt: posterEntry.prompt,
                imageGradingPrompt: STORY_IMAGE_GRADING_PROMPT,
                maxAttempts: 4,
                imageAspectRatio: "16:9",
                debug: attemptDebug(`poster/candidate_${candidateIndex}`),
              });
              logWithAttempt(
                `poster candidate ${candidateIndex} (${image.data.length} bytes)`,
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
            debug: attemptDebug("poster/select"),
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
          logWithAttempt(
            `selected poster candidate ${posterSelection.winnerCandidateIndex} – ${posterSelection.reasoning}`,
          );
          for (const finding of posterSelection.catastrophicFindings) {
            logWithAttempt(
              `poster candidate ${finding.candidateIndex} flagged as catastrophic: ${finding.reason}`,
            );
          }

          const endingReferences = mainImageParts.slice(
            Math.max(mainImageParts.length - 4, 0),
          );
          logWithAttempt("generating end card");
          const endingPart = await generateSingleImage({
            progress: adapter,
            modelId: IMAGE_MODEL_ID,
            stylePrompt,
            styleImages: endingReferences,
            prompt: endingEntry.prompt,
            imageGradingPrompt: STORY_IMAGE_GRADING_PROMPT,
            maxAttempts: 4,
            imageAspectRatio: "16:9",
            debug: attemptDebug("ending"),
          });
          imagesByIndex.set(endingIndex, {
            index: endingIndex,
            mimeType: endingPart.mimeType ?? "image/png",
            data: endingPart.data,
          });
          logWithAttempt(
            `received ending image ${endingIndex} (${endingPart.data.length} bytes)`,
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

          logWithAttempt("completed image set generation");
          return {
            imageSetLabel,
            images: orderedImages,
          };
        } catch (error) {
          lastError = error;
          const message = errorAsString(error);
          logWithAttempt(`failed: ${message}`);
          if (attempt === IMAGE_SET_GENERATE_MAX_ATTEMPTS) {
            throw error instanceof Error ? error : new Error(message);
          }
          logWithAttempt("retrying after failure");
          continue;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(
            `Image set generation failed for ${imageSetLabel}${
              lastError ? `: ${errorAsString(lastError)}` : ""
            }`,
          );
    } finally {
      if (adapter.finishStage) {
        adapter.finishStage(stageHandle);
      }
    }
  };

  // Generate both image sets in parallel to reduce wall-clock time.
  const [setA, setB] = await Promise.all([
    runImageSet("set_a"),
    runImageSet("set_b"),
  ]);
  return [setA, setB];
}

export async function judgeImageSets(
  imageSets: readonly StoryImageSet[],
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: StoryDebugOptions,
): Promise<{
  winningImageSetLabel: "set_a" | "set_b";
}> {
  const adapter = useProgress(progress);
  const { promptsByIndex } = collectSegmentationImageContext(segmentation);
  const segmentCount = segmentation.segments.length;
  const totalImages = segmentCount + 2;
  const panelRangeLabel =
    segmentCount === 1 ? "story panel 1" : `story panels 1-${segmentCount}`;
  const setA = imageSets.find((set) => set.imageSetLabel === "set_a");
  const setB = imageSets.find((set) => set.imageSetLabel === "set_b");
  if (!setA || !setB) {
    throw new Error("Both set_a and set_b must be provided for judging");
  }

  const headerLines: string[] = [
    "You are the image quality judge for illustrated historical stories.",
    `Two complete illustration sets are provided: Set A and Set B. Each contains ${totalImages} images covering ${panelRangeLabel}, a "the end" card, and a poster.`,
    "Evaluate which set better satisfies the prompts and style requirements.",
    "Criteria: prompt fidelity, cinematic single-scene composition, grounded historical setting, expressive yet cohesive style, and strong character continuity.",
    "Typography check: the poster must clearly display (as visible text) a bold 2–4 word title, the historical figure’s name, and a single 4-digit year; other text stays concise, spelled correctly, and period-appropriate.",
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
    maxAttempts: 5,
    contents: [{ role: "user", parts }],
    schema: ImageSetJudgeResponseSchema,
    debug: options?.debugRootDir
      ? {
          rootDir: options.debugRootDir,
          stage: "images-judge",
          subStage: options.debugSubStage,
        }
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
  options?: StoryDebugOptions,
): Promise<StoryImagesResult> {
  const adapter = useProgress(progress);
  const totalImages = segmentation.segments.length + 2;
  adapter.log(
    `[story] generating ${totalImages} images via dual-set comparison workflow`,
  );

  const { entries, promptsByIndex } =
    collectSegmentationImageContext(segmentation);
  const styleLines = ART_STYLE;

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
  storagePrefix?: string;
  progress?: StoryProgress;
  audioProgressLabel?: string;
  debugRootDir?: string;
  checkpointDir?: string;
  lessonContext?: StoryLessonContext;
  storySegmentCount?: number;
  includeCoding?: boolean;
};

export type GenerateStoryResult = {
  title: string;
  story: StoryProseResult;
  segmentation: StorySegmentation;
  images: {
    storagePaths: string[];
    modelVersion: string;
    posterImage?: StorySupplementaryImage;
    endingImage?: StorySupplementaryImage;
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

function buildSupplementaryImageStoragePath(
  userId: string,
  sessionId: string,
  planItemId: string,
  kind: "poster" | "ending",
  prefix?: string,
): string {
  const folder = prefix
    ? path.join(prefix, userId, "sessions", sessionId, planItemId)
    : path.join("spark", userId, "sessions", sessionId, planItemId);
  const fileName = kind === "poster" ? "poster.jpg" : "ending.jpg";
  return path.join(folder, fileName).replace(/\\/g, "/");
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
  | "idea"
  | "origins_capsule"
  | "prose"
  | "prose-revision"
  | "segmentation"
  | "segmentation_correction"
  | "images"
  | "narration";

const STORY_STAGE_ORDER: readonly StoryGenerationStageName[] = [
  "idea",
  "origins_capsule",
  "prose",
  "prose-revision",
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
  storagePrefix?: string;
  progress?: StoryProgress;
  audioProgressLabel?: string;
  debugRootDir?: string;
  checkpointDir?: string;
  lessonContext?: StoryLessonContext;
  storySegmentCount?: number;
  includeCoding?: boolean;
};

type StageCacheEntry<TValue> = {
  value: TValue;
  source: "checkpoint" | "generated";
  checkpointPath?: string;
};

type StoryLessonContext = {
  planTopic: string;
  promisedSkills: readonly string[];
  techniques?: readonly {
    id: string;
    title: string;
    summary: string;
    applies_to: readonly string[];
    tags: readonly string[];
  }[];
  problems?: readonly {
    id: string;
    title: string;
    story_callback?: string;
    summary?: string;
  }[];
  storyHook?: {
    storyTopic: string;
    protagonist?: string;
    anchor_event?: string;
    anchor_year?: string;
    anchor_place?: string;
    stakes?: string;
    analogy_seed?: string;
    modern_tie_in?: string;
    visual_scene?: {
      setting: string;
      focal_object: string;
      props: string[];
    };
    visual_motif?: string;
    naming_note?: string;
  };
};

type NarrationStageValue = {
  publishResult: Awaited<ReturnType<typeof synthesizeAndPublishNarration>>;
  storagePaths: string[];
  posterImage?: StorySupplementaryImage;
  endingImage?: StorySupplementaryImage;
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
    idea?: StageCacheEntry<StoryIdeaResult>;
    originsCapsule?: StageCacheEntry<StoryOriginsCapsule>;
    proseDraft?: StageCacheEntry<StoryProseDraftVariant[]>;
    prose?: StageCacheEntry<StoryProseRevisionResult>;
    segmentation?: StageCacheEntry<StorySegmentation>;
    segmentationCorrection?: StageCacheEntry<StorySegmentation>;
    images?: StageCacheEntry<StoryImagesResult>;
    narration?: StageCacheEntry<NarrationStageValue>;
  } = {};

  private readonly logger: JobProgressReporter;
  private readonly segmentCount: number;

  constructor(private readonly options: StoryGenerationPipelineOptions) {
    this.logger = useProgress(options.progress);
    this.segmentCount = resolveStorySegmentCount(options.storySegmentCount);
  }

  private get checkpointDir(): string | undefined {
    return this.options.checkpointDir;
  }

  private async withStage<T>(
    stage: StoryGenerationStageName,
    action: () => Promise<T>,
  ): Promise<T> {
    const handle = this.logger.startStage(stage);
    try {
      return await action();
    } finally {
      this.logger.finishStage(handle);
    }
  }

  private stageFile(stage: StoryGenerationStageName): string | undefined {
    if (!this.checkpointDir) {
      return undefined;
    }
    return path.join(this.checkpointDir, `${stage}.json`);
  }

  private imageCheckpointMatchesSegmentCount(
    images: StoryImagesResult,
  ): boolean {
    const expectedTotal = this.segmentCount + 2;
    if (images.images.length !== expectedTotal) {
      return false;
    }
    const indices = new Set<number>();
    for (const image of images.images) {
      indices.add(image.index);
    }
    if (indices.size !== expectedTotal) {
      return false;
    }
    for (let index = 1; index <= expectedTotal; index += 1) {
      if (!indices.has(index)) {
        return false;
      }
    }
    return true;
  }

  private async readIdeaCheckpoint(): Promise<
    StageReadResult<StoryIdeaResult> | undefined
  > {
    const filePath = this.stageFile("idea");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed: unknown = JSON.parse(raw);
      const checkpoint = StoryIdeaCheckpointSchema.parse(parsed);
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'idea' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      let data: StoryIdeaData | undefined;
      if (checkpoint.data) {
        const parseResult = StoryIdeaDataSchema.safeParse(checkpoint.data);
        if (parseResult.success) {
          data = parseResult.data;
        } else {
          this.logger.log(
            `[story/checkpoint] ignored 'idea' checkpoint data at ${filePath} (schema mismatch)`,
          );
        }
      }
      return { value: { brief: checkpoint.brief, data }, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeIdeaCheckpoint(
    value: StoryIdeaResult,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("idea");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryIdeaCheckpoint = {
      topic: this.options.topic,
      brief: value.brief,
      data: value.data,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readOriginsCapsuleCheckpoint(): Promise<
    StageReadResult<StoryOriginsCapsule> | undefined
  > {
    const filePath = this.stageFile("origins_capsule");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed: unknown = JSON.parse(raw);
      const checkpoint = StoryOriginsCapsuleCheckpointSchema.parse(parsed);
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'origins_capsule' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      const value = StoryOriginsCapsuleSchema.safeParse({
        text: checkpoint.capsule,
      });
      if (!value.success) {
        this.logger.log(
          `[story/checkpoint] ignored 'origins_capsule' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return {
        value: value.data,
        filePath,
      };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeOriginsCapsuleCheckpoint(
    value: StoryOriginsCapsule,
  ): Promise<string | undefined> {
    const filePath = this.stageFile("origins_capsule");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryOriginsCapsuleCheckpoint = {
      topic: this.options.topic,
      capsule: value.text,
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readProseCheckpoint(): Promise<
    StageReadResult<StoryProseDraftVariant[]> | undefined
  > {
    const filePath = this.stageFile("prose");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed: unknown = JSON.parse(raw);
      const checkpointResult = StoryProseCheckpointSchema.safeParse(parsed);
      if (!checkpointResult.success) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      const checkpoint = checkpointResult.data;
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      const variants = checkpoint.variants.map<StoryProseDraftVariant>(
        (variant) => ({
          label: variant.label,
          idea: { brief: variant.ideaBrief },
          originsCapsule: StoryOriginsCapsuleSchema.parse({
            text: variant.originsCapsule,
          }),
          draft: { text: variant.draftText },
        }),
      );
      return { value: variants, filePath };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProseCheckpoint(
    value: readonly StoryProseDraftVariant[],
  ): Promise<string | undefined> {
    const filePath = this.stageFile("prose");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryProseCheckpoint = {
      topic: this.options.topic,
      variants: value.map((variant) => ({
        label: variant.label,
        ideaBrief: variant.idea.brief,
        draftText: variant.draft.text,
        originsCapsule: variant.originsCapsule.text,
      })),
    };
    await writeFile(filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
    });
    return filePath;
  }

  private async readProseRevisionCheckpoint(): Promise<
    StageReadResult<StoryProseRevisionResult> | undefined
  > {
    const filePath = this.stageFile("prose-revision");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed: unknown = JSON.parse(raw);
      const checkpointResult =
        StoryProseRevisionCheckpointSchema.safeParse(parsed);
      if (!checkpointResult.success) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      const checkpoint = checkpointResult.data;
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (topic mismatch)`,
        );
        return undefined;
      }
      if (
        !checkpoint.variantLabel ||
        !checkpoint.variants ||
        checkpoint.variants.length === 0 ||
        !checkpoint.judge
      ) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (missing variant metadata)`,
        );
        return undefined;
      }
      const variantsMetadata =
        checkpoint.variants.map<StoryProseVariantMetadata>((variant) => ({
          label: variant.label,
          ideaBrief: variant.ideaBrief,
          draftText: variant.draftText,
          originsCapsule: variant.originsCapsule,
          text: variant.text,
          analysis: variant.analysis,
          improvementSummary: variant.improvementSummary,
          fixChecklist: variant.fixChecklist,
          validation: variant.validation,
        }));
      const winningMetadata = variantsMetadata.find(
        (variant) => variant.label === checkpoint.variantLabel,
      );
      if (!winningMetadata) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (winning variant not found)`,
        );
        return undefined;
      }
      return {
        value: {
          text: checkpoint.text,
          analysis: checkpoint.analysis,
          improvementSummary: checkpoint.improvementSummary,
          fixChecklist: checkpoint.fixChecklist,
          validation: checkpoint.validation,
          metadata: {
            ideaBrief: winningMetadata.ideaBrief,
            draftText: winningMetadata.draftText,
            originsCapsule: checkpoint.originsCapsule,
            analysis: checkpoint.analysis,
            improvementSummary: checkpoint.improvementSummary,
            fixChecklist: checkpoint.fixChecklist,
            validation: checkpoint.validation,
            variantLabel: checkpoint.variantLabel,
            variants: variantsMetadata,
            judge: {
              verdict: checkpoint.judge.verdict,
              reasoning: checkpoint.judge.reasoning,
            },
          },
        },
        filePath,
      };
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async writeProseRevisionCheckpoint(params: {
    winning: StoryProseVariantCandidate;
    variants: readonly StoryProseVariantCandidate[];
    judge: StoryProseVariantsJudgeSummary;
  }): Promise<string | undefined> {
    const { winning, variants, judge } = params;
    const filePath = this.stageFile("prose-revision");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryProseRevisionCheckpoint = {
      topic: this.options.topic,
      text: winning.revision.text,
      analysis: winning.revision.analysis,
      improvementSummary: winning.revision.improvementSummary,
      fixChecklist: winning.revision.fixChecklist,
      validation: winning.revision.validation,
      variantLabel: winning.label,
      originsCapsule: winning.originsCapsule.text,
      variants: variants.map((variant) => ({
        label: variant.label,
        ideaBrief: variant.idea.brief,
        draftText: variant.draft.text,
        originsCapsule: variant.originsCapsule.text,
        text: variant.revision.text,
        analysis: variant.revision.analysis,
        improvementSummary: variant.revision.improvementSummary,
        fixChecklist: variant.revision.fixChecklist,
        validation: variant.revision.validation,
      })),
      judge,
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
      const parsed: unknown = JSON.parse(raw);
      const parseResult = buildStorySegmentationSchema(
        this.segmentCount,
      ).safeParse(parsed);
      if (!parseResult.success) {
        this.logger.log(
          `[story/checkpoint] ignored 'segmentation' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: parseResult.data, filePath };
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
      const parsed: unknown = JSON.parse(raw);
      const parseResult = buildStorySegmentationSchema(
        this.segmentCount,
      ).safeParse(parsed);
      if (!parseResult.success) {
        this.logger.log(
          `[story/checkpoint] ignored 'segmentation_correction' checkpoint at ${filePath} (schema mismatch)`,
        );
        return undefined;
      }
      return { value: parseResult.data, filePath };
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
      const parsed: unknown = JSON.parse(raw);
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
      const parsed: unknown = JSON.parse(raw);
      const checkpoint = StoryNarrationCheckpointSchema.parse(parsed);
      const posterImage = checkpoint.posterImage
        ? {
            storagePath: normaliseStoragePath(
              checkpoint.posterImage.storagePath,
            ),
          }
        : undefined;
      const endingImage = checkpoint.endingImage
        ? {
            storagePath: normaliseStoragePath(
              checkpoint.endingImage.storagePath,
            ),
          }
        : undefined;
      const value: NarrationStageValue = {
        storagePaths: checkpoint.storagePaths.map((storagePath) =>
          normaliseStoragePath(storagePath),
        ),
        publishResult: checkpoint.publishResult,
        posterImage,
        endingImage,
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
      posterImage: value.posterImage,
      endingImage: value.endingImage,
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
      case "idea": {
        this.caches.idea = undefined;
        break;
      }
      case "origins_capsule": {
        this.caches.originsCapsule = undefined;
        break;
      }
      case "prose": {
        this.caches.proseDraft = undefined;
        break;
      }
      case "prose-revision": {
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
        throw new Error("Unknown stage");
      }
    }
  }

  private requireContext(key: "userId" | "sessionId" | "planItemId"): string {
    const value = this.options[key];
    if (!value) {
      throw new Error(
        `Story generation stage '${key}' requires ${key} to be provided.`,
      );
    }
    return value;
  }

  private async ensureIdea(): Promise<StageCacheEntry<StoryIdeaResult>> {
    if (this.caches.idea) {
      return this.caches.idea;
    }
    const checkpoint = await this.readIdeaCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StoryIdeaResult> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.idea = entry;
      this.logger.log(
        `[story/checkpoint] restored 'idea' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("idea");
    const entry = await this.withStage("idea", async () => {
      const idea = await generateStoryIdea(
        this.options.topic,
        this.options.lessonContext,
        this.options.progress,
        {
          debugRootDir: this.options.debugRootDir,
        },
        this.options.includeCoding ?? true,
      );
      const checkpointPath = await this.writeIdeaCheckpoint(idea);
      const stageEntry: StageCacheEntry<StoryIdeaResult> = {
        value: idea,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(`[story/checkpoint] wrote 'idea' to ${checkpointPath}`);
      }
      return stageEntry;
    });
    this.caches.idea = entry;
    return entry;
  }

  private async ensureOriginsCapsule(): Promise<
    StageCacheEntry<StoryOriginsCapsule>
  > {
    if (this.caches.originsCapsule) {
      return this.caches.originsCapsule;
    }
    const checkpoint = await this.readOriginsCapsuleCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StoryOriginsCapsule> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.originsCapsule = entry;
      this.logger.log(
        `[story/checkpoint] restored 'origins_capsule' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("origins_capsule");
    const { value: idea } = await this.ensureIdea();
    const baseDebug: StoryDebugOptions | undefined = this.options.debugRootDir
      ? { debugRootDir: this.options.debugRootDir, debugSubStage: "origins" }
      : undefined;
    const entry = await this.withStage("origins_capsule", async () => {
      const capsule = await generateOriginsCapsule(
        this.options.topic,
        idea,
        this.options.progress,
        baseDebug,
      );
      const checkpointPath = await this.writeOriginsCapsuleCheckpoint(capsule);
      const stageEntry: StageCacheEntry<StoryOriginsCapsule> = {
        value: capsule,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'origins_capsule' to ${checkpointPath}`,
        );
      }
      return stageEntry;
    });
    this.caches.originsCapsule = entry;
    return entry;
  }

  private async ensureProseDraft(): Promise<
    StageCacheEntry<StoryProseDraftVariant[]>
  > {
    if (this.caches.proseDraft) {
      return this.caches.proseDraft;
    }
    const checkpoint = await this.readProseCheckpoint();
    if (checkpoint) {
      const entry: StageCacheEntry<StoryProseDraftVariant[]> = {
        value: checkpoint.value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.proseDraft = entry;
      this.logger.log(
        `[story/checkpoint] restored 'prose' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("prose");
    const { value: idea } = await this.ensureIdea();
    const { value: originsCapsule } = await this.ensureOriginsCapsule();
    const baseDebug: StoryDebugOptions | undefined = this.options.debugRootDir
      ? { debugRootDir: this.options.debugRootDir }
      : undefined;
    const entry = await this.withStage("prose", async () => {
      const drafts = await Promise.all(
        STORY_PROSE_VARIANT_LABELS.map((label) =>
          prepareProseVariantDraft(
            this.options.topic,
            label,
            idea,
            originsCapsule,
            this.options.progress,
            baseDebug,
            this.options.lessonContext,
            this.options.includeCoding ?? true,
          ),
        ),
      );
      const checkpointPath = await this.writeProseCheckpoint(drafts);
      const stageEntry: StageCacheEntry<StoryProseDraftVariant[]> = {
        value: drafts,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'prose' to ${checkpointPath}`,
        );
      }
      return stageEntry;
    });
    this.caches.proseDraft = entry;
    return entry;
  }

  async ensureProse(): Promise<StageCacheEntry<StoryProseRevisionResult>> {
    if (this.caches.prose) {
      return this.caches.prose;
    }
    const checkpoint = await this.readProseRevisionCheckpoint();
    if (checkpoint) {
      const value = checkpoint.value;
      const entry: StageCacheEntry<StoryProseRevisionResult> = {
        value,
        source: "checkpoint",
        checkpointPath: checkpoint.filePath,
      };
      this.caches.prose = entry;
      this.logger.log(
        `[story/checkpoint] restored 'prose-revision' from ${checkpoint.filePath}`,
      );
      return entry;
    }
    await this.invalidateAfter("prose-revision");
    const entry = await this.withStage("prose-revision", async () => {
      const draftEntry = await this.ensureProseDraft();
      const baseDebug: StoryDebugOptions | undefined = this.options.debugRootDir
        ? { debugRootDir: this.options.debugRootDir }
        : undefined;
      const variantResults = await Promise.all(
        draftEntry.value.map((variant) =>
          reviseProseVariant(
            this.options.topic,
            variant,
            this.options.progress,
            baseDebug,
            this.options.lessonContext,
            this.options.includeCoding ?? true,
          ),
        ),
      );
      const judge = await judgeProseVariants(
        this.options.topic,
        variantResults,
        this.options.progress,
        baseDebug,
      );
      const winning = variantResults.find(
        (variant) => variant.label === judge.verdict,
      );
      if (!winning) {
        throw new Error(
          `Variant judge returned verdict ${judge.verdict}, but no matching variant was produced`,
        );
      }
      const metadata: StoryProseResult["metadata"] = {
        ideaBrief: winning.idea.brief,
        draftText: winning.draft.text,
        originsCapsule: winning.originsCapsule.text,
        analysis: winning.revision.analysis,
        improvementSummary: winning.revision.improvementSummary,
        fixChecklist: winning.revision.fixChecklist,
        validation: winning.revision.validation,
        variantLabel: judge.verdict,
        variants: variantResults.map((variant) => ({
          label: variant.label,
          ideaBrief: variant.idea.brief,
          draftText: variant.draft.text,
          originsCapsule: variant.originsCapsule.text,
          text: variant.revision.text,
          analysis: variant.revision.analysis,
          improvementSummary: variant.revision.improvementSummary,
          fixChecklist: variant.revision.fixChecklist,
          validation: variant.revision.validation,
        })),
        judge,
      };
      const value: StoryProseRevisionResult = {
        text: winning.revision.text,
        analysis: winning.revision.analysis,
        improvementSummary: winning.revision.improvementSummary,
        fixChecklist: winning.revision.fixChecklist,
        validation: winning.revision.validation,
        metadata,
      };
      const checkpointPath = await this.writeProseRevisionCheckpoint({
        winning,
        variants: variantResults,
        judge,
      });
      const stageEntry: StageCacheEntry<StoryProseRevisionResult> = {
        value,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'prose-revision' to ${checkpointPath}`,
        );
      }
      return stageEntry;
    });
    this.caches.prose = entry;
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
    const entry = await this.withStage("segmentation", async () => {
      const segmentation = await generateStorySegmentation(
        prose.text,
        this.options.topic,
        this.options.progress,
        {
          debugRootDir: this.options.debugRootDir,
        },
        this.segmentCount,
      );
      const checkpointPath =
        await this.writeSegmentationCheckpoint(segmentation);
      const stageEntry: StageCacheEntry<StorySegmentation> = {
        value: segmentation,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'segmentation' to ${checkpointPath}`,
        );
      }
      return stageEntry;
    });
    this.caches.segmentation = entry;
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
    const entry = await this.withStage("segmentation_correction", async () => {
      const corrected = await correctStorySegmentation(
        prose.text,
        this.options.topic,
        draft,
        this.options.progress,
        {
          debugRootDir: this.options.debugRootDir,
        },
        this.segmentCount,
      );
      const checkpointPath =
        await this.writeCorrectedSegmentationCheckpoint(corrected);
      const stageEntry: StageCacheEntry<StorySegmentation> = {
        value: corrected,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'segmentation_correction' to ${checkpointPath}`,
        );
      }
      return stageEntry;
    });
    this.caches.segmentationCorrection = entry;
    return entry;
  }

  async ensureImages(): Promise<StageCacheEntry<StoryImagesResult>> {
    if (this.caches.images) {
      return this.caches.images;
    }
    const checkpoint = await this.readImagesCheckpoint();
    if (checkpoint) {
      if (!this.imageCheckpointMatchesSegmentCount(checkpoint.value)) {
        this.logger.log(
          `[story/checkpoint] ignored 'images' checkpoint at ${checkpoint.filePath} (segment count mismatch)`,
        );
      } else {
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
    }
    await this.invalidateAfter("images");
    const { value: segmentation } = await this.ensureSegmentationCorrection();
    const entry = await this.withStage("images", async () => {
      const images = await generateStoryImages(
        segmentation,
        this.options.progress,
        { debugRootDir: this.options.debugRootDir },
      );
      const checkpointPath = await this.writeImagesCheckpoint(images);
      const stageEntry: StageCacheEntry<StoryImagesResult> = {
        value: images,
        source: "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'images' to ${checkpointPath}`,
        );
      }
      return stageEntry;
    });
    this.caches.images = entry;
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

    const entry = await this.withStage("narration", async () => {
      const { value: segmentation } = await this.ensureSegmentationCorrection();
      const { value: images } = await this.ensureImages();
      const userId = this.requireContext("userId");
      const sessionId = this.requireContext("sessionId");
      const planItemId = this.requireContext("planItemId");
      const storageBucket = getFirebaseStorageBucketName();

      const totalSegments = segmentation.segments.length;
      const interiorImages = images.images
        .filter((image) => image.index >= 1)
        .filter((image) => image.index <= totalSegments)
        .sort((a, b) => a.index - b.index);

      if (interiorImages.length !== totalSegments) {
        throw new Error(
          `Expected ${totalSegments} interior images, found ${interiorImages.length}`,
        );
      }

      const endingImageIndex = totalSegments + 1;
      const posterImageIndex = totalSegments + 2;
      const endingImage = images.images.find(
        (image) => image.index === endingImageIndex,
      );
      if (!endingImage) {
        throw new Error(
          `Expected ending image at index ${endingImageIndex}, but none was provided`,
        );
      }
      const posterImage = images.images.find(
        (image) => image.index === posterImageIndex,
      );
      if (!posterImage) {
        throw new Error(
          `Expected poster image at index ${posterImageIndex}, but none was provided`,
        );
      }

      const storage = getFirebaseAdminStorage();
      const bucket = storage.bucket(storageBucket);

      const sharpModule = getSharp();
      const totalImages = interiorImages.length;
      const uploadConcurrency = Math.min(8, totalImages);
      this.logger.log(
        `[story/images] uploading ${totalImages} images with concurrency ${uploadConcurrency}`,
      );
      const storagePaths = new Array<string>(totalImages);

      let nextImageIndex = 0;
      const uploadWorker = async (workerId: number): Promise<void> => {
        while (true) {
          const currentIndex = nextImageIndex;
          nextImageIndex += 1;
          if (currentIndex >= totalImages) {
            return;
          }
          const image = interiorImages[currentIndex];
          const jpegBuffer = await sharpModule(image.data)
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

      const uploadSupplementaryImage = async (
        image: GeneratedStoryImage,
        kind: "poster" | "ending",
      ): Promise<StorySupplementaryImage> => {
        const jpegBuffer = await sharpModule(image.data)
          .jpeg({
            quality: 92,
            progressive: true,
            chromaSubsampling: "4:4:4",
          })
          .toBuffer();
        const storagePath = buildSupplementaryImageStoragePath(
          userId,
          sessionId,
          planItemId,
          kind,
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
        this.logger.log(
          `[story/images] saved ${kind} image to /${storagePath}`,
        );
        return {
          storagePath: normaliseStoragePath(storagePath),
        };
      };

      const [posterReference, endingReference] = await Promise.all([
        uploadSupplementaryImage(posterImage, "poster"),
        uploadSupplementaryImage(endingImage, "ending"),
      ]);

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
            posterImage: posterReference,
            endingImage: endingReference,
          };
          const checkpointPath =
            await this.writeNarrationCheckpoint(stageValue);
          const stageEntry: StageCacheEntry<NarrationStageValue> = {
            value: stageValue,
            source: "checkpoint",
            checkpointPath,
          };
          if (checkpointPath) {
            this.logger.log(
              `[story/checkpoint] wrote 'narration' to ${checkpointPath}`,
            );
          }
          return stageEntry;
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
        posterImage: posterReference,
        endingImage: endingReference,
        progress: createConsoleProgress(narrationProgressLabel),
      });

      const stageValue: NarrationStageValue = {
        publishResult,
        storagePaths,
        posterImage: posterReference,
        endingImage: endingReference,
      };
      const checkpointPath = await this.writeNarrationCheckpoint(stageValue);
      const stageEntry: StageCacheEntry<NarrationStageValue> = {
        value: stageValue,
        source: restoredCheckpointPath ? "checkpoint" : "generated",
        checkpointPath,
      };
      if (checkpointPath) {
        this.logger.log(
          `[story/checkpoint] wrote 'narration' to ${checkpointPath}`,
        );
      }
      this.logger.log(
        `[story/narration] ensured media doc ${stageValue.publishResult.documentPath}`,
      );
      return stageEntry;
    });
    this.caches.narration = entry;
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
    storagePrefix: options.storagePrefix,
    progress: options.progress,
    audioProgressLabel: options.audioProgressLabel,
    debugRootDir: options.debugRootDir,
    checkpointDir: options.checkpointDir,
    lessonContext: options.lessonContext,
    storySegmentCount: options.storySegmentCount,
    includeCoding: options.includeCoding,
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
      posterImage: narration.posterImage,
      endingImage: narration.endingImage,
    },
    narration: narration.publishResult,
  };
}
