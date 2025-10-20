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

export type StoryProgress = JobProgressReporter | undefined;

type StoryDebugOptions = {
  debugRootDir?: string;
  debugSubStage?: string;
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
    value === null || value === undefined ? undefined : value
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
        code: z.ZodIssueCode.custom,
        message: `Expected exactly ${expectedIds.size} candidates (one per identifier).`,
        path: ["candidates"],
      });
      return;
    }
    for (const expectedId of expectedIds) {
      if (!ids.includes(expectedId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing candidate with id '${expectedId}'.`,
          path: ["candidates"],
        });
      }
    }
  }
);

export type StoryIdeaData = z.infer<typeof StoryIdeaDataSchema>;

const STORY_IDEA_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["researchSnapshot", "candidates", "recommendation", "sources"],
  propertyOrdering: [
    "researchSnapshot",
    "candidates",
    "recommendation",
    "sources",
  ],
  properties: {
    researchSnapshot: {
      type: Type.OBJECT,
      description:
        "Factual research summary that grounds the chosen story direction.",
      required: [
        "conceptualEssence",
        "historicalAnchor",
        "narrativeElements",
        "keyTermToNameInStory",
        "analogyClarifierSeed",
        "closingInvitationSeed",
      ],
      propertyOrdering: [
        "conceptualEssence",
        "historicalAnchor",
        "narrativeElements",
        "keyTerminologyGloss",
        "keyTermToNameInStory",
        "namingNote",
        "historicalNuance",
        "analogyClarifierSeed",
        "closingInvitationSeed",
      ],
      properties: {
        conceptualEssence: {
          type: Type.STRING,
          minLength: "1",
          description:
            "One-sentence explanation of the core behaviour or insight behind the concept.",
        },
        historicalAnchor: {
          type: Type.OBJECT,
          description:
            "Primary historical figure and decisive moment that anchor the narrative.",
          required: ["figure", "canonicalEvent", "highStakesProblem"],
          propertyOrdering: ["figure", "canonicalEvent", "highStakesProblem"],
          properties: {
            figure: {
              type: Type.STRING,
              minLength: "1",
              description:
                "Full name and role of the person whose story we will tell.",
            },
            canonicalEvent: {
              type: Type.STRING,
              minLength: "1",
              description:
                "Specific paper, project, or milestone (with year/location) where the concept proved decisive.",
            },
            highStakesProblem: {
              type: Type.STRING,
              minLength: "1",
              description:
                "Why the problem mattered at that moment and what was at risk.",
            },
          },
        },
        narrativeElements: {
          type: Type.OBJECT,
          description:
            "Analogy and foil information that shape how the story will be told.",
          required: [
            "functionalAnalogies",
            "contrastingFoil",
            "invisibleArchitecturePivot",
          ],
          propertyOrdering: [
            "functionalAnalogies",
            "contrastingFoil",
            "invisibleArchitecturePivot",
          ],
          properties: {
            functionalAnalogies: {
              type: Type.ARRAY,
              minItems: "1",
              description:
                "Candidate analogies (2–3) that can map the concept to familiar systems.",
              items: {
                type: Type.OBJECT,
                required: ["name", "description"],
                propertyOrdering: ["name", "description"],
                properties: {
                  name: {
                    type: Type.STRING,
                    minLength: "1",
                    description: "Short title for the analogy (2–4 words).",
                  },
                  description: {
                    type: Type.STRING,
                    minLength: "1",
                    description:
                      "One-sentence description mapping the analogy behaviour to the concept.",
                  },
                },
              },
            },
            contrastingFoil: {
              type: Type.STRING,
              minLength: "1",
              description:
                "Alternate approach that fails for this historical problem (one sentence).",
            },
            invisibleArchitecturePivot: {
              type: Type.STRING,
              minLength: "1",
              description:
                "Modern-day system or experience powered by the concept; used only in the ending.",
            },
          },
        },
        keyTerminologyGloss: {
          type: Type.ARRAY,
          description:
            "Optional glossary entries; omit when no glossary terms are required.",
          items: {
            type: Type.OBJECT,
            required: ["term", "definition"],
            propertyOrdering: ["term", "definition"],
            properties: {
              term: {
                type: Type.STRING,
                minLength: "1",
                description: "Term that must appear in the final story.",
              },
              definition: {
                type: Type.STRING,
                minLength: "1",
                description:
                  "Learner-friendly definition (no formulas) to guide writers.",
              },
            },
          },
        },
        keyTermToNameInStory: {
          type: Type.STRING,
          minLength: "1",
          description:
            "Exact concept name that must appear early in the story.",
        },
        namingNote: {
          type: Type.STRING,
          minLength: "1",
          description:
            "Optional sentence clarifying how or why the concept received its name.",
        },
        historicalNuance: {
          type: Type.STRING,
          minLength: "1",
          description:
            "Optional note about proof status, independent rediscoveries, or caveats.",
        },
        analogyClarifierSeed: {
          type: Type.STRING,
          minLength: "1",
          description:
            "Sentence the writer can reuse to explain why the analogy guarantees the desired behaviour.",
        },
        closingInvitationSeed: {
          type: Type.STRING,
          minLength: "1",
          description:
            "Cliffhanger sentence promising learners they will practice the trick in this lesson.",
        },
      },
    },
    candidates: {
      type: Type.ARRAY,
      minItems: "1",
      description:
        "Exactly three narrative directions (candidate_a/b/c) for the writer to choose from.",
      items: {
        type: Type.OBJECT,
        required: ["id", "angle", "anchorEvent", "analogy", "lessonTeaser"],
        propertyOrdering: [
          "id",
          "angle",
          "anchorEvent",
          "analogy",
          "endingPivot",
          "lessonTeaser",
          "namingNote",
        ],
        properties: {
          id: {
            type: Type.STRING,
            enum: [...STORY_IDEA_CANDIDATE_IDS],
            description:
              "Stable identifier (candidate_a, candidate_b, candidate_c).",
          },
          angle: {
            type: Type.STRING,
            minLength: "1",
            description:
              "One-sentence framing of the narrative focus for this candidate.",
          },
          anchorEvent: {
            type: Type.STRING,
            minLength: "1",
            description:
              "Specific event used to open the story for this candidate (include year/place if applicable).",
          },
          analogy: {
            type: Type.STRING,
            minLength: "1",
            description:
              "Analogy sentence tailored to this candidate (no numbered steps).",
          },
          endingPivot: {
            type: Type.STRING,
            minLength: "1",
            description:
              "Optional sentence describing how the story ends with a modern tie-in; omit if none.",
          },
          lessonTeaser: {
            type: Type.STRING,
            minLength: "1",
            description:
              "Sentence promising learners the trick will be revealed and practised in the lesson.",
          },
          namingNote: {
            type: Type.STRING,
            minLength: "1",
            description: "Optional naming trivia unique to this candidate.",
          },
        },
      },
    },
    recommendation: {
      type: Type.OBJECT,
      description:
        "Recommendation of which candidate to ship, with supporting rationale.",
      required: ["selectedCandidateId", "rationale"],
      propertyOrdering: ["rationale", "selectedCandidateId"],
      properties: {
        selectedCandidateId: {
          type: Type.STRING,
          enum: [...STORY_IDEA_CANDIDATE_IDS],
          description:
            "Identifier of the winning candidate (must match one entry in candidates).",
        },
        rationale: {
          type: Type.STRING,
          minLength: "1",
          description:
            "Concise argument (2–3 sentences) explaining why this candidate delivers the best story.",
        },
      },
    },
    sources: {
      type: Type.ARRAY,
      minItems: "1",
      description:
        "Merged bibliography covering every citation used in the snapshot and candidates.",
      items: {
        type: Type.OBJECT,
        required: ["title", "url", "summary"],
        propertyOrdering: ["title", "url", "summary"],
        properties: {
          title: {
            type: Type.STRING,
            minLength: "1",
            description:
              "Human-readable source title (site + article/book name).",
          },
          url: {
            type: Type.STRING,
            minLength: "1",
            description: "Direct URL to the supporting evidence.",
          },
          summary: {
            type: Type.STRING,
            minLength: "1",
            description:
              "One-sentence recap of what this source confirms (dates, quotes, context, etc.).",
          },
        },
      },
    },
  },
};

export type StoryIdeaResult = {
  brief: string;
  data?: StoryIdeaData;
};

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
  text: string;
  analysis: StoryProseRevisionAnalysis;
  improvementSummary: string;
  validation?: StoryProseValidationResult;
};

export type StoryProseResult = {
  text: string;
  metadata?: {
    ideaBrief: string;
    draftText: string;
    analysis: StoryProseRevisionAnalysis;
    improvementSummary: string;
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
  draft: StoryProseDraftResult;
};

export type StoryProseVariantCandidate = StoryProseDraftVariant & {
  revision: StoryProseRevisionResult;
};

export type StoryProseValidationIssue = {
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
};

export type StoryProseRevisionResult = StoryProseResult & {
  analysis: StoryProseRevisionAnalysis;
  improvementSummary: string;
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
  imageSets: readonly StoryImageSet[]
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
  serialised: readonly SerialisedStoryImageSet[]
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

const StoryProseCheckpointVariantSchema = z.object({
  label: z.enum(["variant_a", "variant_b"]),
  ideaBrief: z.string().trim().min(1),
  draftText: z.string().trim().min(1),
});

type StoryProseCheckpointVariant = z.infer<
  typeof StoryProseCheckpointVariantSchema
>;

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
  validation: StoryProseValidationResultSchema.optional(),
  variantLabel: z.enum(["variant_a", "variant_b"]).optional(),
  variants: z
    .array(
      z.object({
        label: z.enum(["variant_a", "variant_b"]),
        ideaBrief: z.string().trim().min(1),
        draftText: z.string().trim().min(1),
        text: z.string().trim().min(1),
        analysis: StoryProseRevisionAnalysisSchema,
        improvementSummary: z.string().trim().min(1),
        validation: StoryProseValidationResultSchema.optional(),
      })
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

const PROSE_VARIANT_JUDGE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["reasoning", "verdict"],
  propertyOrdering: ["reasoning", "verdict"],
  properties: {
    reasoning: { type: Type.STRING, minLength: "1" },
    verdict: { type: Type.STRING, enum: ["variant_a", "variant_b"] },
  },
};

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
    readonly segmentation: StorySegmentation
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

const STORY_PROSE_REVISION_CRITERION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["justification", "score"],
  propertyOrdering: ["justification", "score"],
  properties: {
    justification: { type: Type.STRING, minLength: "1" },
    score: { type: Type.NUMBER, minimum: 1, maximum: 5 },
  },
};

const STORY_PROSE_REVISION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["analysis", "revisedStory", "improvementSummary"],
  propertyOrdering: ["analysis", "revisedStory", "improvementSummary"],
  properties: {
    analysis: {
      type: Type.OBJECT,
      required: [
        "metaphoricalIntegrity",
        "narrativeMomentum",
        "conceptualClarity",
        "audienceResonance",
        "motivationalPower",
      ],
      propertyOrdering: [
        "metaphoricalIntegrity",
        "narrativeMomentum",
        "conceptualClarity",
        "audienceResonance",
        "motivationalPower",
      ],
      properties: {
        metaphoricalIntegrity: STORY_PROSE_REVISION_CRITERION_RESPONSE_SCHEMA,
        narrativeMomentum: STORY_PROSE_REVISION_CRITERION_RESPONSE_SCHEMA,
        conceptualClarity: STORY_PROSE_REVISION_CRITERION_RESPONSE_SCHEMA,
        audienceResonance: STORY_PROSE_REVISION_CRITERION_RESPONSE_SCHEMA,
        motivationalPower: STORY_PROSE_REVISION_CRITERION_RESPONSE_SCHEMA,
      },
    },
    revisedStory: {
      type: Type.OBJECT,
      required: ["title", "paragraphs"],
      propertyOrdering: ["title", "paragraphs"],
      properties: {
        title: { type: Type.STRING, minLength: "1" },
        paragraphs: {
          type: Type.ARRAY,
          minItems: "1",
          items: { type: Type.STRING, minLength: "1" },
        },
      },
    },
    improvementSummary: { type: Type.STRING, minLength: "1" },
  },
};

const STORY_PROSE_VALIDATION_ISSUE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["summary", "category", "severity", "evidence", "recommendation"],
  propertyOrdering: [
    "summary",
    "category",
    "severity",
    "evidence",
    "recommendation",
  ],
  properties: {
    summary: { type: Type.STRING, minLength: "1" },
    category: {
      type: Type.STRING,
      enum: [
        "factual",
        "naming",
        "terminology",
        "structure",
        "tone",
        "requirement",
        "other",
      ],
    },
    severity: {
      type: Type.STRING,
      enum: ["critical", "major", "minor"],
    },
    evidence: { type: Type.STRING, minLength: "1" },
    recommendation: { type: Type.STRING, minLength: "1" },
  },
};

const STORY_PROSE_VALIDATION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  required: ["verdict", "issues"],
  propertyOrdering: ["verdict", "issues"],
  properties: {
    verdict: { type: Type.STRING, enum: ["pass", "fail"] },
    issues: {
      type: Type.ARRAY,
      items: STORY_PROSE_VALIDATION_ISSUE_RESPONSE_SCHEMA,
    },
  },
};

export function buildStoryIdeaPrompt(topic: string): string {
  return `### **Prompt 1: The Story Architect's Brief**

**(Objective: To perform deep research and strategic planning. The output of this prompt is a structured brief, not a full story.)**

**Your Role:** You are a historical researcher and a concept strategist for an educational media company. Your task is to analyze a technical concept and create a "Story Brief" for our narrative writers. This brief must identify the perfect historical anchor and a powerful narrative angle to make the concept unforgettable for advanced 12-16 year olds. Always run web-search queries to confirm every historical detail before you commit to the brief.

Important constraints:
- Avoid outlining algorithms, procedures, or step-by-step computations. It's fine to mention a few numbers in passing, but do not walk through calculations or variable notation.
- You may introduce 1–2 terms by name if they help intrigue the listener, but do not provide precise formal definitions.
- Every factual statement (dates, locations, publications, people, proof status, terminology origins) must include an inline citation in parentheses with the source title and URL (e.g., "(Source: Bell Labs Archive — https://example.org/...)"). Collect all citations at the end under a "Sources" heading with one bullet per source and a short 1-line summary.
- The final story must explicitly name the concept "${topic}". Include brief naming history when genuinely interesting (e.g., why an approach has a surprising name), otherwise skip it—but capture the note in the brief if relevant so the writer can decide.
- Make clear that the core trick will be revealed within this very lesson; hint that brief in-lesson exercises will let the audience try it immediately (no explicit call-to-action wording).
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
  briefMarkdown: string
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
  storyBrief: string
): string {
  return `### **Prompt 2: The Narrative Weaver**

**(Objective: To take the structured brief from Prompt 1 and craft a compelling, audio-friendly story.)**

**Your Role:** You are a master storyteller for a popular educational podcast. You have just received a "Story Brief" from our research department. Your task is to transform this brief into a captivating, audio-friendly narrative (250–450 words) for an advanced teen audience. It's acceptable to go modestly longer (≈1.2–1.5×) when adding directly relevant historical color; do not shorten by default if doing so removes helpful context.

Guardrails:
- Do not explain algorithms or walk through step-by-step calculations. It's okay to mention a few numbers, but avoid variable notation and sequences like "do X, then Y".
- You may introduce at most 1–2 terms by name if they elevate intrigue; do not give precise formal definitions.
- Optionally include a short naming-history aside only if it adds charm and momentum.
- Make clear this lesson will reveal the trick. Gently hint that short in-lesson exercises will let the listener try it—do not write explicit call-to-action wording.
- Historical accuracy: only reference famous anecdotes/quotes when they are associated with the same concept/result; otherwise omit them or, if helpful, reframe as foreshadowing of a later milestone without attributing it to the current concept.
 - Fact-checking: if any historical detail (names, dates, places, artifacts) is uncertain, use web search to verify before relying on it. Do not include citations in the story; correct the prose instead.
- Keep vocabulary accessible to curious 12–16 year olds. Prefer everyday words like "lawyer" or "judge" instead of specialist titles such as "magistrate" or "jurist" unless you briefly define them.

Hard requirements for this concept:
- Explicitly name the concept "${topic}" in the first 3–4 sentences. Do not postpone the term to the ending.
- Include a one-sentence naming note for the concept if the name contains a notable qualifier (e.g., "Little", "Last", "Fast"). Keep it plain (why it’s called that) and historically accurate.
- Include an "insight hint" expressed in one or two sentences: begin with an abstract sentence that states the core pattern and optionally add a short clarifying contrast about what predictably happens when the condition holds versus what breaks when it doesn’t. Avoid equations, symbols, or procedural steps.
- End with an upbeat invitation that hints the student will "learn the details" and "master it in programming challenges" in this very lesson. Keep the tone motivating, not salesy.

**Input:**
================ Story Brief ================
${storyBrief}
============================================

**Guiding Ethos:**
* **Reveal, Don't Just Tell:** Let the listener feel they are being entrusted with a strategic secret.
* **Transform the Concept into a Superpower:** Frame the knowledge as a powerful tool the listener is about to wield.
* **Excitement Through Motivation:** Create momentum from real historical stakes and human intent—not from exaggerated adjectives.

**Your Mission:**
Weave the provided elements into a seamless story that makes the concept feel like a powerful secret the listener is about to inherit. If multiple candidate briefs are present, use the "Recommendation" section; otherwise, choose the strongest angle. The story must flow from a historical problem to a modern-day superpower without teaching the algorithm. Keep any modern connection (if truly relevant) for the ending only; avoid modern references earlier.

**The Narrative Arc to Follow:**

1. **The Quest:** Open with the historical figure and the urgent, concrete problem they faced. Ground the listener in the time, place, and stakes from the brief.
2. **The Insight:** Describe the "aha!" moment. Introduce the chosen functional analogy as the key to solving the problem. Use the analogy's name and its internal logic at a high level—no equations or step sequences.
3. **The Teaser + Analogy Map:** Offer an evocative glimpse of the idea in action—without steps, symbols, or variable notation. Keep any numbers minimal and illustrative. Then add a concise "Analogy Map" sentence that links 2–3 correspondences between the analogy and the concept (nouns and plain language only). You may optionally follow with one short "insight clarifier" sentence that contrasts what predictably happens when the condition holds versus what breaks when it doesn’t. The entire hint must be expressed in one or two sentences—never more.
4. **The Ending Pivot (optional):** If a strong, natural link exists to the modern world, reveal it briefly here at the very end—and only here. If not, end without it.
5. **The Call to Adventure:** Finish with a concise, powerful invitation. The final sentence must complete the central analogy and hand the listener an active role—place the metaphorical tool (pen, key, compass, etc.) in their hands—and explicitly promise that they will learn the details and practice the idea in programming challenges next.

**Stylistic Requirements:**
* **Audio-First:** Use clear, concise sentences. Read it aloud in your "mind's ear" to ensure it flows well.
* **Vivid but Restrained:** Use strong verbs and concrete nouns.
* **Plain, Natural Language:** Avoid grandiose or emotionally charged adjectives (e.g., colossal, gigantic, revolutionary). Use such adjectives at most 1–2 times across the entire story, and never more than one in a single sentence.
* **Measured Claims:** Prefer neutral, specific phrasing over sweeping statements. Replace extreme claims (e.g., "could take a lifetime") with grounded context or simple statements of difficulty.
* **Tone:** Intelligent, intriguing, and respectful of the audience's curiosity.
* **Vocabulary:** Use CEFR B2-or-simpler word choices; if a precise historical role demands a rarer word, define it in the same sentence.
* **Title:** Provide a 2-4 word title for the story.

Respond with the title on its own line followed by the story paragraphs.
`;
}

export function buildStoryRevisionPrompt(
  topic: string,
  storyDraft: string,
  feedback?: string
): string {
  const feedbackSection =
    feedback && feedback.trim().length > 0
      ? `\n**Additional Editorial Feedback (blocking issues to address):**\n${feedback.trim()}\n`
      : "";
  return `### **Prompt 3: The Narrative Editor's Cut**

**(Objective: To critically evaluate the story from Prompt 2 against a quality rubric and then perform a final revision to elevate it.)**

**Your Role:** You are the lead editor for our educational content studio. You are responsible for ensuring every story is not just accurate, but exceptionally engaging and effective.

Non-negotiables for this pass:
- Remove or rewrite any step-by-step math, equations, variable notation, or algorithmic walkthroughs. Mentions of a few numbers are okay if they are evocative and not procedural.
- Keep, at most, 1–2 named terms without formal definitions.
- Make clear that this lesson reveals the trick. If helpful, include a light-touch hint that short in-lesson exercises will follow; do not craft explicit call-to-action wording.
- Preserve historical grounding and momentum; include naming-history only if it helps.
- Correct any historical misattributions: use famous anecdotes or quotations only when linked to the same concept/result and time period. If a well-known story belongs elsewhere, remove it or recast it as foreshadowing of a later milestone, without attributing it to the current concept.
- Fact-checking: double-check any uncertain dates, names, places, or attributions via web search before revising. Do not add citations to the JSON; revise the prose to be correct and concise.
- Hyperbole audit: remove charged adjectives and sweeping claims. Allow at most 1–2 emotionally strong adjectives across the entire story, never more than one in a single sentence. Prefer plain, measured language.
 - Modern-connection placement: ensure any tie-in to the modern world appears only in the ending. Remove or relocate earlier references that make the story feel artificial.
 - Insight brevity: the description of the insight must be an "insight hint" delivered in one or two sentences—begin with an abstract statement of the core pattern, and optionally add a brief clarifying contrast about when it holds vs. breaks. No equations, symbols, or procedural steps.
 - Length policy: do not shorten by default. Preserve or modestly extend length when adding directly relevant historical detail and clarity (≈1.2–1.5× is acceptable). Trim only tangents or redundancy.

 Quality gates (must pass all):
- Explicitly name the concept "${topic}" in the first 3–4 sentences. If missing, insert it naturally without breaking flow.
- If the concept’s name includes a notable qualifier (e.g., "Little", "Last", "Stable"), add a one-sentence naming note explaining the origin/meaning (e.g., contrasted with a different theorem). Keep it neutral and accurate.
- Ensure the "insight hint" is delivered in one or two sentences: start with an abstract sentence of the core pattern and optionally add a short clarifier contrasting what predictably happens when the condition holds vs. what breaks when it doesn’t. No equations, symbols, or procedural steps.
- The final 1–2 sentences must invite the listener to "learn the details" and to "master it in programming challenges" next, framed as part of this lesson’s journey.
- Historical nuance: when relevant, avoid claiming the originator created a full test or modern method; frame it as a property or insight. If the originator shared a result without a proof, note that it was presented as a challenge or confident claim without proof.
- Vocabulary accessibility: keep language suitable for curious 12–16 year olds (CEFR B2 or simpler). Prefer familiar words like "lawyer" or "judge" instead of "magistrate" unless you explain the term immediately.

**Input:**
================ Story Draft ================
${storyDraft}
============================================
${feedbackSection}

**Your Two-Part Task:**

**Part A: The Critical Analysis**
Grade the draft story against our five-point quality rubric. For each point, provide a score (1-5, with 5 being excellent) and a brief justification for your rating. Be honest and critical.

* **1. Metaphorical Power:** How effective is the functional analogy? Is it a complete system that makes the concept intuitive, memorable, and consistently applied?
* **2. Narrative Momentum:** Does the story build from a compelling problem to a satisfying revelation? Is the pacing tight and engaging?
* **3. Conceptual Revelation:** Does the story make the listener feel clever—as if a secret has been revealed rather than a lesson delivered?
* **4. "Invisible Architecture" Impact:** Does the pivot create a true "wow" moment by exposing how the concept already powers the listener's hidden technological world?
* **5. Empowering Conclusion:** Does the ending avoid cliché? Does it actively empower the student by completing the central analogy and handing them a role in the story?

**Part B: The Final Polish**
Based on your analysis, produce the final, revised version. Focus your edits on two mission-critical areas:
1. **Clarify Without Calculus:** Make the analogy intuitive while removing step sequences, equations, or symbol-heavy wording. Keep any numbers minimal and illustrative. If missing, add a concise "Analogy Map" sentence that links 2–3 elements of the analogy to the underlying concept (nouns and plain language only), and optionally add one short clarifier sentence. The entire "insight hint" must fit within one or two sentences—no more.
2. **Sharpen the Ending:** Rewrite the final one or two sentences to be active, concise, and explicitly tied to the analogy so the listener receives a powerful call to adventure. Place any modern connection here (and only here). If natural, add a gentle promise that the trick is revealed in this lesson and that brief exercises follow—without explicit call-to-action wording.

Respond strictly in JSON matching the provided schema. Omit all commentary outside the JSON object.

JSON schema:
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
    "paragraphs": array of strings (each 1+ sentences, no blank strings)
  },
  "improvementSummary": string (single sentence describing the biggest improvement)
}

Ensure every score is an integer between 1 and 5 inclusive.
`;
}

export function buildStoryValidationPrompt(
  topic: string,
  storyText: string
): string {
  return `### **Prompt 4: The Fact-Check Gate**

**Objective:** Audit the revised story for factual accuracy, compliance with required beats, and age-appropriate language before it can advance.

**Your Role:** You are the senior fact-checker and standards editor. You must block publication if any critical or major issues remain.

**Material to Audit:**
================ Story (Final Draft) ================
${storyText}
====================================================

**Checklist (all must pass):**
1. **Historical accuracy:** Verify every concrete claim (dates, names, proof status). For Fermat, remember that Fermat's Little Theorem was shared without proof in 1640, and Fermat's Last Theorem was proved by Andrew Wiles (with Richard Taylor) in 1994–1995—flag any suggestion it remains unsolved.
2. **Concept naming:** Confirm the story explicitly names "${topic}" within the first four sentences and that any naming note about qualifiers (e.g., "Little") is accurate.
3. **Insight hint:** Confirm the hint is expressed in one or two sentences—start with an abstract sentence stating the core pattern and optionally add a short clarifier contrasting what predictably happens when the condition holds vs. what breaks when it doesn’t. No equations, symbols, or procedural steps; flag if it exceeds two sentences or reads like instructions.
4. **Modern connection placement:** Any modern tie-in (e.g., cryptography) must appear only in the ending paragraph.
5. **Ending invitation:** The final 1–2 sentences must promise the listener will learn the details and master the idea in programming challenges.
6. **Language accessibility:** Vocabulary should suit curious 12–16 year olds (CEFR B2 or below). Flag niche words such as "magistrate" or "jurist" unless they are immediately defined. Prefer simpler alternatives (e.g., "lawyer," "judge").
7. **Tone and claims:** Watch for exaggeration or implying that Fermat invented a full primality test. Frame it correctly as a property/challenge.
8. **Length and focus:** Do not penalize modestly longer stories (≈1.2–1.5×) when added details are directly relevant and improve clarity. Flag only if the narrative drifts into tangents or drops required clarifications.

**Verdict Rules:**
- Return "pass" only if **all** checklist items are satisfied and no critical/major issues remain.
- Otherwise return "fail" and list every blocking issue with clear evidence and an actionable recommendation.

**Output JSON Schema:**
{
  "verdict": "pass" | "fail",
  "issues": [
    {
      "summary": string,
      "category": "factual" | "naming" | "terminology" | "structure" | "tone" | "requirement" | "other",
      "severity": "critical" | "major" | "minor",
      "evidence": string,
      "recommendation": string
    }
  ]
}

If there are no issues, respond with an empty array.
`;
}

export function buildStoryFactualValidationPrompt(
  topic: string,
  storyText: string
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
   * Return **"pass"** only if every claim is supported by your searches.
   * Return **"fail"** when any claim is missing support, contradicts reliable sources, or remains ambiguous after reasonable searching. Record one issue per problematic claim, set 'category' to 'factual', and explain the concern in plain language.
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
  factualReport: string
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
  topic?: string
): string {
  // Style requirements are intentionally excluded here. Style gets applied later during image generation.
  return [
    "Convert the provided historical story into a structured narration and illustration plan.",
    "",
    "Requirements:",
    "1. Provide `title`, `posterPrompt`, ten chronological `segments`, and `endingPrompt`.",
    "   This yields 12 total illustration prompts: poster + 10 story beats + ending card.",
    "2. `posterPrompt` introduces the entire story in a single dynamic scene suitable for a cover/poster. It must be stunning, captivating, and intriguing; and it should mention the name of the protagonist (an important historical figure). If the name is long, prefer a concise form (e.g., first+last name or well-known moniker). As visible text on the poster, include: (a) a bold 2–4 word title, (b) the protagonist’s name, and (c) a single 4-digit year relevant to the story. Keep each supporting element under six words.",
    '3. `endingPrompt` is a graceful "The End" card with a minimal motif from the story.',
    "4. For each of the ten `segments`:",
    "   • Provide `narration`, an ordered array of narration slices. Each slice contains `voice` and `text`.",
    "   • Alternate between the `M` and `F` voices whenever the flow allows. Let `M` handle formal or structural beats; let `F` handle emotional or explanatory beats. Avoid repeating the same voice twice in a row unless it preserves clarity. Remove citation markers or reference-style callouts.",
    "   • Provide `imagePrompt`, a short, plain description (ideally one sentence) that captures the same moment as the narration slice(s). Focus on who, what, and where. Avoid camera jargon (e.g., close-up, overhead, depth of field) and avoid intricate staging.",
    "5. Keep each `imagePrompt` drawable as a simple single-scene illustration with cartoon-style clarity: emphasise the key action and allow supporting characters or environment to share focus only when the narration calls for it. Prefer everyday settings. Do not invent elaborate props or contrived arrangements.",
    '6. Avoid specificity that causes collapse: do not include exact dates, numeric lists, or spelled-out equations/symbols. Phrases like "a chalkboard filled with formulas" are fine, but never write the actual symbols or digits. Exception: on the poster only, include a single 4-digit year along with the title and protagonist’s name. Keep visible text minimal and period-appropriate (headlines ≤ 4 words; signage/mottos ≤ 6 words). All writing must appear on physical surfaces (paper, chalkboard, signage), never floating in the air.',
    "7. Avoid surreal or magical visualizations (e.g., glowing symbols forming from pens); stay grounded in plausible, physical scenes. No neon or holographic overlays, no floating captions/labels, and no attempts to visualize abstract entities as hovering graphics.",
    "8. Characters should not be expected to display legible paper text. Posters on walls, labels, or whiteboards are fine; for posters, stylized text works.",
    "9. Do not request formulas, diagrams, or tables.",
    "10. Ensure the named protagonist appears whenever the narration centres on them; otherwise spotlight the setting, consequences, or supporting cast to keep the beat clear.",
    "11. Keep each `imagePrompt` concise: roughly 12–30 words.",
    "12. Narration tone: plain and natural. Avoid hyperbole or overly dramatic adjectives; keep language straightforward and conversational.",
    "13. Historical focus only in the ten segments: do not include modern devices or references in the segments. If a modern connection is relevant, reserve it for the `endingPrompt` only and keep it brief.",
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
    "Preserve the wording of the story.",
  ].join("\n");
}

export async function generateStoryIdea(
  topic: string,
  progress?: StoryProgress,
  options?: StoryDebugOptions
): Promise<StoryIdeaResult> {
  const adapter = useProgress(progress);
  const prompt = buildStoryIdeaPrompt(topic);
  for (let attempt = 1; attempt <= IDEA_GENERATION_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(IDEA_GENERATION_MAX_ATTEMPTS).padStart(2, "0")}`;
    const subStage = combineDebugSegments(options?.debugSubStage, attemptLabel);
    adapter.log(
      `[story/ideas] generation attempt ${attempt} of ${IDEA_GENERATION_MAX_ATTEMPTS} with web-search-enabled ${TEXT_MODEL_ID}`
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
        responseSchema: STORY_IDEA_RESPONSE_SCHEMA,
        schema: StoryIdeaDataSchema,
        debug: parseDebugOptions,
      });
      const brief = formatIdeaBrief(data);
      adapter.log("[story/ideas-parse] structured brief parsed");
      return { brief, data };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      if (attempt === IDEA_GENERATION_MAX_ATTEMPTS) {
        adapter.log(
          `[story/ideas] generation attempt ${attempt} failed (${message}); no retries left`
        );
        throw new Error(
          `Story idea generation failed after ${IDEA_GENERATION_MAX_ATTEMPTS} attempt(s): ${message}`
        );
      }
      adapter.log(
        `[story/ideas] generation attempt ${attempt} failed (${message}); retrying...`
      );
    }
  }
  throw new Error("Story idea generation failed; no idea was produced.");
}

export async function generateStoryProseDraft(
  topic: string,
  idea: StoryIdeaResult,
  progress?: StoryProgress,
  options?: StoryDebugOptions
): Promise<StoryProseDraftResult> {
  const adapter = useProgress(progress);
  adapter.log(`[story] generating prose draft with ${TEXT_MODEL_ID}`);
  const prompt = buildStoryDraftPrompt(topic, idea.brief);
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
  progress?: StoryProgress,
  options?: StoryDebugOptions,
  feedback?: string
): Promise<StoryProseRevisionResult> {
  const adapter = useProgress(progress);
  adapter.log(`[story] revising prose with ${TEXT_MODEL_ID}`);
  const prompt = buildStoryRevisionPrompt(topic, draft.text, feedback);
  const response = await generateJson<StoryProseRevisionResponse>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    responseSchema: STORY_PROSE_REVISION_RESPONSE_SCHEMA,
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
  };
}

export async function validateStoryProse(
  topic: string,
  revision: StoryProseRevisionResult,
  progress?: StoryProgress,
  options?: StoryDebugOptions
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
    `[story] validating prose – factual analysis with ${TEXT_MODEL_ID}`
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
    responseSchema: STORY_PROSE_VALIDATION_RESPONSE_SCHEMA,
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
    `[story/prose-validation] factual verdict: ${factualResponse.verdict}${factualResponse.issues.length ? ` (${factualResponse.issues.length} issue(s))` : ""}`
  );
  if (factualResponse.verdict === "fail") {
    return factualResponse;
  }

  adapter.log(
    `[story] validating prose – structural pass with ${TEXT_MODEL_ID}`
  );
  const structuralPrompt = buildStoryValidationPrompt(topic, revision.text);
  const structuralResponse = await generateJson<StoryProseValidationResult>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [
      { role: "user", parts: [{ type: "text", text: structuralPrompt }] },
    ],
    responseSchema: STORY_PROSE_VALIDATION_RESPONSE_SCHEMA,
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
    `[story/prose-validation] verdict: ${structuralResponse.verdict}${structuralResponse.issues.length ? ` (${structuralResponse.issues.length} issue(s))` : ""}`
  );
  return structuralResponse;
}

function summariseValidationIssues(
  issues: readonly StoryProseValidationIssue[]
): string {
  if (issues.length === 0) {
    return "no detailed issues provided";
  }
  return issues
    .map((issue, index) => {
      const label = `${index + 1}. [${issue.severity.toUpperCase()} - ${issue.category}]`;
      return `${label} ${issue.summary}`;
    })
    .join("; ");
}

function buildValidationFeedback(
  issues: readonly StoryProseValidationIssue[]
): string {
  if (issues.length === 0) {
    return "The fact-checker flagged the story but did not list issues. Recheck every checklist item (facts, naming, insight hint, modern placement, ending invitation, vocabulary) and correct any violations.";
  }
  return [
    "Address each blocking issue identified by the fact-checker:",
    ...issues.map((issue, index) => {
      const lines = [
        `${index + 1}. (${issue.severity.toUpperCase()} – ${issue.category}) ${issue.summary}`,
        `   Evidence: ${issue.evidence}`,
        `   Recommendation: ${issue.recommendation}`,
      ];
      return lines.join("\n");
    }),
  ].join("\n");
}

const IDEA_GENERATION_MAX_ATTEMPTS = 3;
const PROSE_DRAFT_MAX_ATTEMPTS = 3;
const PROSE_REVISION_MAX_ATTEMPTS = 3;

function combineDebugSegments(
  ...segments: (string | undefined)[]
): string | undefined {
  const cleaned = segments.flatMap((segment) =>
    typeof segment === "string"
      ? segment
          .split("/")
          .map((part) => part.trim())
          .filter((part) => part.length > 0)
      : []
  );
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.join("/");
}

function formatIdeaBrief(data: StoryIdeaData): string {
  const { researchSnapshot, candidates, recommendation } = data;
  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === recommendation.selectedCandidateId
  );
  if (!selectedCandidate) {
    throw new Error(
      `Story idea recommendation referenced missing candidate ${recommendation.selectedCandidateId}`
    );
  }

  const lines: string[] = [];
  lines.push("### Research Snapshot");
  lines.push("");
  lines.push(`- Conceptual Essence: ${researchSnapshot.conceptualEssence}`);
  lines.push(
    `- Historical Anchor: ${researchSnapshot.historicalAnchor.figure}`
  );
  lines.push(
    `- Canonical Event: ${researchSnapshot.historicalAnchor.canonicalEvent}`
  );
  lines.push(
    `- High-Stakes Problem: ${researchSnapshot.historicalAnchor.highStakesProblem}`
  );
  const functionalAnalogies =
    researchSnapshot.narrativeElements.functionalAnalogies
      .map((analogy) => `${analogy.name}: ${analogy.description}`)
      .join("; ");
  lines.push(`- Functional Analogies: ${functionalAnalogies}`);
  lines.push(
    `- Contrasting Foil: ${researchSnapshot.narrativeElements.contrastingFoil}`
  );
  lines.push(
    `- Invisible Architecture Pivot: ${researchSnapshot.narrativeElements.invisibleArchitecturePivot}`
  );
  const terminology = researchSnapshot.keyTerminologyGloss ?? [];
  if (terminology.length > 0) {
    lines.push("- Key Terminology & Gloss:");
    for (const entry of terminology) {
      lines.push(`  * ${entry.term}: ${entry.definition}`);
    }
  }
  lines.push(
    `- Key Term to Name in Story: ${researchSnapshot.keyTermToNameInStory}`
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
      ...extraSegments
    ),
  };
}

async function prepareProseVariantDraft(
  topic: string,
  label: StoryProseVariantLabel,
  idea: StoryIdeaResult,
  progress?: StoryProgress,
  baseDebug?: StoryDebugOptions
): Promise<StoryProseDraftVariant> {
  const adapter = useProgress(progress);
  for (let attempt = 1; attempt <= PROSE_DRAFT_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `attempt-${String(attempt).padStart(2, "0")}-of-${String(PROSE_DRAFT_MAX_ATTEMPTS).padStart(2, "0")}`;
    adapter.log(
      `[story/prose/${label}] draft attempt ${attempt} of ${PROSE_DRAFT_MAX_ATTEMPTS}`
    );
    const draftOptions = buildVariantDebugOptions(
      baseDebug,
      label,
      attemptLabel
    );
    try {
      const draft = await generateStoryProseDraft(
        topic,
        idea,
        progress,
        draftOptions
      );
      return { label, idea, draft };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      if (attempt === PROSE_DRAFT_MAX_ATTEMPTS) {
        adapter.log(
          `[story/prose/${label}] draft attempt ${attempt} failed (${message}); no retries left`
        );
        throw new Error(
          `Story prose draft generation failed for ${label} after ${PROSE_DRAFT_MAX_ATTEMPTS} attempt(s): ${message}`
        );
      }
      adapter.log(
        `[story/prose/${label}] draft attempt ${attempt} failed (${message}); retrying...`
      );
    }
  }
  throw new Error(
    `Story prose draft generation failed for ${label}; no draft was produced.`
  );
}

async function reviseProseVariant(
  topic: string,
  variant: StoryProseDraftVariant,
  progress?: StoryProgress,
  baseDebug?: StoryDebugOptions
): Promise<StoryProseVariantCandidate> {
  const adapter = useProgress(progress);
  let feedback: string | undefined;
  let revision: StoryProseRevisionResult | undefined;
  for (let attempt = 1; attempt <= PROSE_REVISION_MAX_ATTEMPTS; attempt += 1) {
    const attemptLabel = `revisions/attempt-${String(attempt).padStart(2, "0")}-of-${String(PROSE_REVISION_MAX_ATTEMPTS).padStart(2, "0")}`;
    adapter.log(
      `[story/prose/${variant.label}] revision attempt ${attempt} of ${PROSE_REVISION_MAX_ATTEMPTS}`
    );
    const revisionOptions = buildVariantDebugOptions(
      baseDebug,
      variant.label,
      attemptLabel,
      "revision"
    );
    const validationOptions = buildVariantDebugOptions(
      baseDebug,
      variant.label,
      attemptLabel,
      "validation"
    );
    const candidate = await generateStoryProseRevision(
      topic,
      variant.draft,
      progress,
      revisionOptions,
      feedback
    );
    const validation = await validateStoryProse(
      topic,
      candidate,
      progress,
      validationOptions
    );
    if (validation.verdict === "pass") {
      revision = { ...candidate, validation };
      break;
    }
    const summary = validation.issues.length
      ? summariseValidationIssues(validation.issues)
      : "Validation failed without reported issues.";
    adapter.log(
      `[story/prose-validation/${variant.label}] attempt ${attempt} failed: ${summary}`
    );
    if (attempt === PROSE_REVISION_MAX_ATTEMPTS) {
      throw new Error(
        `Story prose validation failed for ${variant.label} after ${PROSE_REVISION_MAX_ATTEMPTS} attempt(s): ${summary}`
      );
    }
    feedback = buildValidationFeedback(validation.issues);
  }
  if (!revision) {
    throw new Error(
      `Story prose revision did not produce a validated result for ${variant.label}`
    );
  }
  return {
    label: variant.label,
    idea: variant.idea,
    draft: variant.draft,
    revision,
  };
}

function buildProseVariantsJudgePrompt(
  topic: string,
  variants: readonly StoryProseVariantCandidate[]
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
      ].join("\n")
    );
    const validation = variant.revision.validation;
    if (validation) {
      lines.push(
        `Validation Verdict: ${validation.verdict.toUpperCase()}${validation.issues.length ? ` (previously flagged ${validation.issues.length} issue(s))` : ""}`
      );
    }
    lines.push("Story:");
    lines.push(variant.revision.text);
    lines.push("");
  }
  lines.push(
    'Respond in JSON with keys `reasoning` (short paragraph explaining your choice) and `verdict` (`"variant_a"` or `"variant_b"`).'
  );
  return lines.join("\n");
}

async function judgeProseVariants(
  topic: string,
  variants: readonly StoryProseVariantCandidate[],
  progress?: StoryProgress,
  baseDebug?: StoryDebugOptions
): Promise<StoryProseVariantsJudgeSummary> {
  if (variants.length !== STORY_PROSE_VARIANT_LABELS.length) {
    throw new Error(
      `Expected ${STORY_PROSE_VARIANT_LABELS.length} variants for judging, received ${variants.length}`
    );
  }
  const adapter = useProgress(progress);
  adapter.log("[story/prose-variants-judge] evaluating variant_a vs variant_b");
  const prompt = buildProseVariantsJudgePrompt(topic, variants);
  const response = await generateJson<ProseVariantJudgeResponse>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    responseSchema: PROSE_VARIANT_JUDGE_RESPONSE_SCHEMA,
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
    `[story/prose-variants-judge] verdict ${response.verdict} – ${response.reasoning}`
  );
  return {
    verdict: response.verdict,
    reasoning: response.reasoning.trim(),
  };
}

export async function generateProseStory(
  topic: string,
  progress?: StoryProgress,
  options?: StoryDebugOptions
): Promise<StoryProseResult> {
  const idea = await generateStoryIdea(topic, progress, options);
  const variantDrafts = await Promise.all(
    STORY_PROSE_VARIANT_LABELS.map((label) =>
      prepareProseVariantDraft(topic, label, idea, progress, options)
    )
  );
  const variantResults = await Promise.all(
    variantDrafts.map((variant) =>
      reviseProseVariant(topic, variant, progress, options)
    )
  );
  const judge = await judgeProseVariants(
    topic,
    variantResults,
    progress,
    options
  );
  const winning = variantResults.find(
    (variant) => variant.label === judge.verdict
  );
  if (!winning) {
    throw new Error(
      `Variant judge returned verdict ${judge.verdict}, but no matching variant was produced`
    );
  }
  return {
    text: winning.revision.text,
    metadata: {
      ideaBrief: winning.idea.brief,
      draftText: winning.draft.text,
      analysis: winning.revision.analysis,
      improvementSummary: winning.revision.improvementSummary,
      validation: winning.revision.validation,
      variantLabel: judge.verdict,
      variants: variantResults.map((variant) => ({
        label: variant.label,
        ideaBrief: variant.idea.brief,
        draftText: variant.draft.text,
        text: variant.revision.text,
        analysis: variant.revision.analysis,
        improvementSummary: variant.revision.improvementSummary,
        validation: variant.revision.validation,
      })),
      judge,
    },
  };
}

const SEGMENTATION_CORRECTION_ATTEMPTS = 3;

function buildSegmentationCorrectorPrompt(
  segmentation: StorySegmentation,
  generationPrompt: string
): string {
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
    "- No modern-world references in story panels 1–10; if a modern connection exists, it must appear only in the ending card text and remain brief.",
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

export async function generateStorySegmentation(
  storyText: string,
  topic: string,
  progress?: StoryProgress,
  options?: StoryDebugOptions
): Promise<StorySegmentation> {
  const adapter = useProgress(progress);
  adapter.log(`[story] generating narration segments with ${TEXT_MODEL_ID}`);
  const prompt = buildSegmentationPrompt(storyText, topic);
  const segmentation = await generateJson<StorySegmentation>({
    progress: adapter,
    modelId: TEXT_MODEL_ID,
    contents: [{ role: "user", parts: [{ type: "text", text: prompt }] }],
    responseSchema: STORY_SEGMENTATION_RESPONSE_SCHEMA,
    schema: StorySegmentationSchema,
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
  options?: StoryDebugOptions
): Promise<StorySegmentation> {
  const adapter = useProgress(progress);
  const generationPrompt = buildSegmentationPrompt(storyText, topic);
  let workingSegmentation = initialSegmentation;
  adapter.log(`[story] reviewing segmentation prompts with ${TEXT_MODEL_ID}`);

  for (
    let attempt = 1;
    attempt <= SEGMENTATION_CORRECTION_ATTEMPTS;
    attempt += 1
  ) {
    const reviewPrompt = buildSegmentationCorrectorPrompt(
      workingSegmentation,
      generationPrompt
    );
    const attemptLabel = `corrections/attempt-${String(attempt).padStart(3, "0")}-of-${String(SEGMENTATION_CORRECTION_ATTEMPTS).padStart(3, "0")}`;
    const stageLabel =
      [options?.debugSubStage, attemptLabel]
        .filter(
          (segment): segment is string =>
            typeof segment === "string" && segment.length > 0
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
        responseSchema: SEGMENTATION_CORRECTOR_RESPONSE_SCHEMA,
        schema: SegmentationCorrectorResponseSchema,
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
          `[story/segmentation_correction] attempt ${attempt} issues summary: ${response.issuesSummary}`
        );
      }

      if (response.corrections.length === 0) {
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} returned no corrections`
        );
        return workingSegmentation;
      }

      try {
        workingSegmentation = applySegmentationCorrections(
          workingSegmentation,
          response.corrections
        );
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} applied ${response.corrections.length} correction(s)`
        );
        return workingSegmentation;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        adapter.log(
          `[story/segmentation_correction] attempt ${attempt} failed to apply corrections (${message}); retrying...`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      adapter.log(
        `[story/segmentation_correction] attempt ${attempt} failed (${message}); retrying...`
      );
    }
  }

  throw new SegmentationCorrectionError(
    `Segmentation correction failed after ${SEGMENTATION_CORRECTION_ATTEMPTS} attempt(s).`,
    workingSegmentation
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
  segmentation: StorySegmentation
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
        `Segmentation segment ${i + 1} is missing an imagePrompt`
      );
    }
    const index = i + 1;
    const narrationLines = segment.narration.map(
      (line) => `${line.voice}: ${line.text}`
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
  progress: JobProgressReporter;
  modelId: typeof IMAGE_MODEL_ID;
  debug?: LlmDebugOptions;
};

async function generateSingleImage(
  options: SingleImageGenerationOptions
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
        })
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
    responseSchema: POSTER_SELECTION_RESPONSE_SCHEMA,
    debug: options.debug,
  });

  return response;
}

export async function generateImageSets(
  segmentation: StorySegmentation,
  progress?: StoryProgress,
  options?: StoryDebugOptions
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
      `Segmentation image context is missing the poster entry (index ${posterIndex})`
    );
  }
  if (!endingEntry) {
    throw new Error(
      `Segmentation image context is missing the ending entry (index ${endingIndex})`
    );
  }
  const panelEntries = entries
    .filter(
      (entry) => entry.index !== posterIndex && entry.index !== endingIndex
    )
    .sort((a, b) => a.index - b.index);

  const runImageSet = async (
    imageSetLabel: "set_a" | "set_b"
  ): Promise<StoryImageSet> => {
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
        IMAGE_SET_GENERATE_MAX_ATTEMPTS
      ).padStart(2, "0")}`;
      const attemptLogPrefix = `[story/image-sets/${imageSetLabel}] [${attemptLabel}]`;
      const logWithAttempt = (message: string) => {
        adapter.log(`${attemptLogPrefix} ${message}`);
      };
      const attemptDebug = (subStage: string): LlmDebugOptions | undefined =>
        buildDebug(`${imageSetLabel}/${attemptLabel}/${subStage}`);

      try {
        logWithAttempt(
          `generating main frames (${panelEntries.length} prompts)`
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
            `received image ${entry.index} (${part.data.length} bytes)`
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
              maxAttempts: 4,
              imageAspectRatio: "16:9",
              debug: attemptDebug(`poster/candidate_${candidateIndex}`),
            });
            logWithAttempt(
              `poster candidate ${candidateIndex} (${image.data.length} bytes)`
            );
            return { candidateIndex, image };
          }
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
            candidate.candidateIndex === posterSelection.winnerCandidateIndex
        );
        if (!winningPoster) {
          throw new Error(
            `Poster selection returned candidate ${posterSelection.winnerCandidateIndex}, but no matching image was generated`
          );
        }
        imagesByIndex.set(posterIndex, {
          index: posterIndex,
          mimeType: winningPoster.image.mimeType ?? "image/png",
          data: winningPoster.image.data,
        });
        logWithAttempt(
          `selected poster candidate ${posterSelection.winnerCandidateIndex} – ${posterSelection.reasoning}`
        );
        for (const finding of posterSelection.catastrophicFindings) {
          logWithAttempt(
            `poster candidate ${finding.candidateIndex} flagged as catastrophic: ${finding.reason}`
          );
        }

        const endingReferences = mainImageParts.slice(
          Math.max(mainImageParts.length - 4, 0)
        );
        logWithAttempt("generating end card");
        const endingPart = await generateSingleImage({
          progress: adapter,
          modelId: IMAGE_MODEL_ID,
          stylePrompt,
          styleImages: endingReferences,
          prompt: endingEntry.prompt,
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
          `received ending image ${endingIndex} (${endingPart.data.length} bytes)`
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
        const message = error instanceof Error ? error.message : String(error);
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
            lastError ? `: ${String(lastError)}` : ""
          }`
        );
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
  options?: StoryDebugOptions
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
    contents: [{ role: "user", parts }],
    responseSchema: IMAGE_SET_JUDGE_RESPONSE_SCHEMA,
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
  options?: StoryDebugOptions
): Promise<StoryImagesResult> {
  const adapter = useProgress(progress);
  adapter.log("[story] generating 12 images via dual-set comparison workflow");

  const { entries, promptsByIndex } =
    collectSegmentationImageContext(segmentation);
  const styleLines = ART_STYLE;

  const imageSets = await generateImageSets(segmentation, adapter, options);
  const judge = await judgeImageSets(imageSets, segmentation, adapter, options);
  const winner = imageSets.find(
    (set) => set.imageSetLabel === judge.winningImageSetLabel
  );
  if (!winner) {
    throw new Error(
      `Winning image set ${judge.winningImageSetLabel} not found in generated sets`
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
  prefix?: string
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
  prefix?: string
): string {
  const folder = prefix
    ? path.join(prefix, userId, "sessions", sessionId, planItemId)
    : path.join("spark", userId, "sessions", sessionId, planItemId);
  const fileName = kind === "poster" ? "poster.jpg" : "ending.jpg";
  return path.join(folder, fileName).replace(/\\/g, "/");
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

export type StoryGenerationStageName =
  | "idea"
  | "prose"
  | "prose-revision"
  | "segmentation"
  | "segmentation_correction"
  | "images"
  | "narration";

const STORY_STAGE_ORDER: readonly StoryGenerationStageName[] = [
  "idea",
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
      (error as { code?: string }).code === "ENOENT"
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
    proseDraft?: StageCacheEntry<StoryProseDraftVariant[]>;
    prose?: StageCacheEntry<StoryProseRevisionResult>;
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

  private async readIdeaCheckpoint(): Promise<
    StageReadResult<StoryIdeaResult> | undefined
  > {
    const filePath = this.stageFile("idea");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const checkpoint = StoryIdeaCheckpointSchema.parse(parsed);
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'idea' checkpoint at ${filePath} (topic mismatch)`
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
            `[story/checkpoint] ignored 'idea' checkpoint data at ${filePath} (schema mismatch)`
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
    value: StoryIdeaResult
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

  private async readProseCheckpoint(): Promise<
    StageReadResult<StoryProseDraftVariant[]> | undefined
  > {
    const filePath = this.stageFile("prose");
    if (!filePath) {
      return undefined;
    }
    try {
      const raw = await readFile(filePath, { encoding: "utf8" });
      const parsed = JSON.parse(raw);
      const checkpointResult = StoryProseCheckpointSchema.safeParse(parsed);
      if (!checkpointResult.success) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose' checkpoint at ${filePath} (schema mismatch)`
        );
        return undefined;
      }
      const checkpoint = checkpointResult.data;
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose' checkpoint at ${filePath} (topic mismatch)`
        );
        return undefined;
      }
      const variants = checkpoint.variants.map<StoryProseDraftVariant>(
        (variant) => ({
          label: variant.label,
          idea: { brief: variant.ideaBrief },
          draft: { text: variant.draftText },
        })
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
    value: readonly StoryProseDraftVariant[]
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
      const parsed = JSON.parse(raw);
      const checkpointResult =
        StoryProseRevisionCheckpointSchema.safeParse(parsed);
      if (!checkpointResult.success) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (schema mismatch)`
        );
        return undefined;
      }
      const checkpoint = checkpointResult.data;
      if (checkpoint.topic !== this.options.topic) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (topic mismatch)`
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
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (missing variant metadata)`
        );
        return undefined;
      }
      const variantsMetadata =
        checkpoint.variants.map<StoryProseVariantMetadata>((variant) => ({
          label: variant.label,
          ideaBrief: variant.ideaBrief,
          draftText: variant.draftText,
          text: variant.text,
          analysis: variant.analysis,
          improvementSummary: variant.improvementSummary,
          validation: variant.validation,
        }));
      const winningMetadata = variantsMetadata.find(
        (variant) => variant.label === checkpoint.variantLabel
      );
      if (!winningMetadata) {
        this.logger.log(
          `[story/checkpoint] ignoring 'prose-revision' checkpoint at ${filePath} (winning variant not found)`
        );
        return undefined;
      }
      return {
        value: {
          text: checkpoint.text,
          analysis: checkpoint.analysis,
          improvementSummary: checkpoint.improvementSummary,
          validation: checkpoint.validation,
          metadata: {
            ideaBrief: winningMetadata.ideaBrief,
            draftText: winningMetadata.draftText,
            analysis: checkpoint.analysis,
            improvementSummary: checkpoint.improvementSummary,
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
      validation: winning.revision.validation,
      variantLabel: winning.label,
      variants: variants.map((variant) => ({
        label: variant.label,
        ideaBrief: variant.idea.brief,
        draftText: variant.draft.text,
        text: variant.revision.text,
        analysis: variant.revision.analysis,
        improvementSummary: variant.revision.improvementSummary,
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
    value: StorySegmentation
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
    value: StorySegmentation
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
    value: StoryImagesResult
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
      const posterImage = checkpoint.posterImage
        ? {
            storagePath: normaliseStoragePath(
              checkpoint.posterImage.storagePath
            ),
          }
        : undefined;
      const endingImage = checkpoint.endingImage
        ? {
            storagePath: normaliseStoragePath(
              checkpoint.endingImage.storagePath
            ),
          }
        : undefined;
      const value: NarrationStageValue = {
        storagePaths: checkpoint.storagePaths.map((storagePath) =>
          normaliseStoragePath(storagePath)
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
    value: NarrationStageValue
  ): Promise<string | undefined> {
    const filePath = this.stageFile("narration");
    if (!filePath || !this.checkpointDir) {
      return undefined;
    }
    await mkdir(this.checkpointDir, { recursive: true });
    const payload: StoryNarrationCheckpoint = {
      storagePaths: value.storagePaths.map((storagePath) =>
        normaliseStoragePath(storagePath)
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
    stage: StoryGenerationStageName
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
        const exhaustiveCheck: never = stage;
        throw new Error(`Unknown stage: ${exhaustiveCheck}`);
      }
    }
  }

  private requireContext(
    key: "userId" | "sessionId" | "planItemId" | "storageBucket"
  ): string {
    const value = this.options[key];
    if (!value) {
      throw new Error(
        `Story generation stage '${key}' requires ${key} to be provided.`
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
        `[story/checkpoint] restored 'idea' from ${checkpoint.filePath}`
      );
      return entry;
    }
    await this.invalidateAfter("idea");
    const idea = await generateStoryIdea(
      this.options.topic,
      this.options.progress,
      {
        debugRootDir: this.options.debugRootDir,
      }
    );
    const checkpointPath = await this.writeIdeaCheckpoint(idea);
    const entry: StageCacheEntry<StoryIdeaResult> = {
      value: idea,
      source: "generated",
      checkpointPath,
    };
    this.caches.idea = entry;
    if (checkpointPath) {
      this.logger.log(`[story/checkpoint] wrote 'idea' to ${checkpointPath}`);
    }
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
        `[story/checkpoint] restored 'prose' from ${checkpoint.filePath}`
      );
      return entry;
    }
    await this.invalidateAfter("prose");
    const { value: idea } = await this.ensureIdea();
    const baseDebug: StoryDebugOptions | undefined = this.options.debugRootDir
      ? { debugRootDir: this.options.debugRootDir }
      : undefined;
    const drafts = await Promise.all(
      STORY_PROSE_VARIANT_LABELS.map((label) =>
        prepareProseVariantDraft(
          this.options.topic,
          label,
          idea,
          this.options.progress,
          baseDebug
        )
      )
    );
    const checkpointPath = await this.writeProseCheckpoint(drafts);
    const entry: StageCacheEntry<StoryProseDraftVariant[]> = {
      value: drafts,
      source: "generated",
      checkpointPath,
    };
    this.caches.proseDraft = entry;
    if (checkpointPath) {
      this.logger.log(`[story/checkpoint] wrote 'prose' to ${checkpointPath}`);
    }
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
        `[story/checkpoint] restored 'prose-revision' from ${checkpoint.filePath}`
      );
      return entry;
    }
    await this.invalidateAfter("prose-revision");
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
          baseDebug
        )
      )
    );
    const judge = await judgeProseVariants(
      this.options.topic,
      variantResults,
      this.options.progress,
      baseDebug
    );
    const winning = variantResults.find(
      (variant) => variant.label === judge.verdict
    );
    if (!winning) {
      throw new Error(
        `Variant judge returned verdict ${judge.verdict}, but no matching variant was produced`
      );
    }
    const metadata: StoryProseResult["metadata"] = {
      ideaBrief: winning.idea.brief,
      draftText: winning.draft.text,
      analysis: winning.revision.analysis,
      improvementSummary: winning.revision.improvementSummary,
      validation: winning.revision.validation,
      variantLabel: judge.verdict,
      variants: variantResults.map((variant) => ({
        label: variant.label,
        ideaBrief: variant.idea.brief,
        draftText: variant.draft.text,
        text: variant.revision.text,
        analysis: variant.revision.analysis,
        improvementSummary: variant.revision.improvementSummary,
        validation: variant.revision.validation,
      })),
      judge,
    };
    const value: StoryProseRevisionResult = {
      text: winning.revision.text,
      analysis: winning.revision.analysis,
      improvementSummary: winning.revision.improvementSummary,
      validation: winning.revision.validation,
      metadata,
    };
    const checkpointPath = await this.writeProseRevisionCheckpoint({
      winning,
      variants: variantResults,
      judge,
    });
    const entry: StageCacheEntry<StoryProseRevisionResult> = {
      value,
      source: "generated",
      checkpointPath,
    };
    this.caches.prose = entry;
    if (checkpointPath) {
      this.logger.log(
        `[story/checkpoint] wrote 'prose-revision' to ${checkpointPath}`
      );
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
        `[story/checkpoint] restored 'segmentation' from ${checkpoint.filePath}`
      );
      return entry;
    }
    await this.invalidateAfter("segmentation");
    const { value: prose } = await this.ensureProse();
    const segmentation = await generateStorySegmentation(
      prose.text,
      this.options.topic,
      this.options.progress,
      {
        debugRootDir: this.options.debugRootDir,
      }
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
        `[story/checkpoint] wrote 'segmentation' to ${checkpointPath}`
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
        `[story/checkpoint] restored 'segmentation_correction' from ${checkpoint.filePath}`
      );
      return entry;
    }
    await this.invalidateAfter("segmentation_correction");
    const { value: prose } = await this.ensureProse();
    const { value: draft } = await this.ensureSegmentation();
    const corrected = await correctStorySegmentation(
      prose.text,
      this.options.topic,
      draft,
      this.options.progress,
      {
        debugRootDir: this.options.debugRootDir,
      }
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
        `[story/checkpoint] wrote 'segmentation_correction' to ${checkpointPath}`
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
        `[story/checkpoint] restored 'images' from ${checkpoint.filePath}`
      );
      return entry;
    }
    await this.invalidateAfter("images");
    const { value: segmentation } = await this.ensureSegmentationCorrection();
    const images = await generateStoryImages(
      segmentation,
      this.options.progress,
      { debugRootDir: this.options.debugRootDir }
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
        `[story/checkpoint] restored 'narration' from ${checkpoint.filePath}`
      );
      const cachedPath =
        checkpoint.value.publishResult?.documentPath ?? "unknown";
      this.logger.log(
        `[story/narration] republishing using cached media references at ${cachedPath}`
      );
    }

    const { value: segmentation } = await this.ensureSegmentationCorrection();
    const { value: images } = await this.ensureImages();
    const userId = this.requireContext("userId");
    const sessionId = this.requireContext("sessionId");
    const planItemId = this.requireContext("planItemId");
    const storageBucket = this.requireContext("storageBucket");

    const totalSegments = segmentation.segments.length;
    const interiorImages = images.images
      .filter((image) => image.index >= 1)
      .filter((image) => image.index <= totalSegments)
      .sort((a, b) => a.index - b.index);

    if (interiorImages.length !== totalSegments) {
      throw new Error(
        `Expected ${totalSegments} interior images, found ${interiorImages.length}`
      );
    }

    const endingImageIndex = totalSegments + 1;
    const posterImageIndex = totalSegments + 2;
    const endingImage = images.images.find(
      (image) => image.index === endingImageIndex
    );
    if (!endingImage) {
      throw new Error(
        `Expected ending image at index ${endingImageIndex}, but none was provided`
      );
    }
    const posterImage = images.images.find(
      (image) => image.index === posterImageIndex
    );
    if (!posterImage) {
      throw new Error(
        `Expected poster image at index ${posterImageIndex}, but none was provided`
      );
    }

    const storage = getFirebaseAdminStorage(undefined, {
      storageBucket,
    });
    const bucket = storage.bucket(storageBucket);

    const totalImages = interiorImages.length;
    const uploadConcurrency = Math.min(8, totalImages);
    this.logger.log(
      `[story/images] uploading ${totalImages} images with concurrency ${uploadConcurrency}`
    );
    const storagePaths: string[] = new Array(totalImages);

    let nextImageIndex = 0;
    const uploadWorker = async (workerId: number): Promise<void> => {
      // Sequentially claim the next image index; JavaScript's single-threaded model keeps this safe.
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
          this.options.storagePrefix
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
          `[story/images] worker ${workerId + 1}/${uploadConcurrency} saved image ${currentIndex + 1}/${totalImages} to /${storagePath}`
        );
      }
    };

    await Promise.all(
      Array.from({ length: uploadConcurrency }, (_, workerId) =>
        uploadWorker(workerId)
      )
    );

    const uploadSupplementaryImage = async (
      image: GeneratedStoryImage,
      kind: "poster" | "ending"
    ): Promise<StorySupplementaryImage> => {
      const jpegBuffer = await sharp(image.data)
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
        this.options.storagePrefix
      );
      const file = bucket.file(storagePath);
      await file.save(jpegBuffer, {
        resumable: false,
        metadata: {
          contentType: "image/jpeg",
          cacheControl: "public, max-age=0",
        },
      });
      this.logger.log(`[story/images] saved ${kind} image to /${storagePath}`);
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
          `[story/narration] reusing existing narration audio at ${cachedPublishResult.storagePath}; skipping synthesis`
        );
        const stageValue: NarrationStageValue = {
          publishResult: cachedPublishResult,
          storagePaths,
          posterImage: posterReference,
          endingImage: endingReference,
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
            `[story/checkpoint] wrote 'narration' to ${checkpointPath}`
          );
        }
        return entry;
      }
      this.logger.log(
        `[story/narration] cached media document ${cachedPublishResult.documentPath} missing; regenerating audio`
      );
    }

    this.logger.log(
      `[story/narration] publishing ${segments.length} segments to storage bucket ${storageBucket}`
    );
    const publishResult = await synthesizeAndPublishNarration({
      userId,
      sessionId,
      planItemId,
      segments,
      storageBucket,
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
    const entry: StageCacheEntry<NarrationStageValue> = {
      value: stageValue,
      source: restoredCheckpointPath ? "checkpoint" : "generated",
      checkpointPath,
    };
    this.caches.narration = entry;
    if (checkpointPath) {
      this.logger.log(
        `[story/checkpoint] wrote 'narration' to ${checkpointPath}`
      );
    }
    this.logger.log(
      `[story/narration] ensured media doc ${stageValue.publishResult.documentPath}`
    );
    return entry;
  }
}

export async function generateStory(
  options: GenerateStoryOptions
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
      posterImage: narration.posterImage,
      endingImage: narration.endingImage,
    },
    narration: narration.publishResult,
  };
}
