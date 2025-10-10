import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command, Option } from "commander";
import { z } from "zod";

import {
  DEFAULT_TOPIC,
  generateProseStory,
  correctStorySegmentation,
  generateStoryImages,
  generateStorySegmentation,
  SegmentationValidationError,
  SegmentationCorrectionError,
  type StorySegmentation,
  StorySegmentationSchema,
} from "./generateStory";
import { type MediaSegment } from "@spark/llm";
import { runJobsWithConcurrency } from "../../utils/concurrency";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";

ensureEvalEnvLoaded();

const StageEnum = z.enum([
  "prose",
  "segmentation",
  "segmentation_correction",
  "audio",
  "images",
]);
type StageName = z.infer<typeof StageEnum>;
const STAGE_ORDER = StageEnum.options;

const optionsSchema = z.object({
  prose: z.boolean(),
  images: z.boolean(),
  topic: z.string().trim().min(1, "topic cannot be empty"),
  output: z.string().trim().min(1, "output path cannot be empty").optional(),
  stages: z.array(StageEnum).default([]),
});

type CliOptions = z.infer<typeof optionsSchema>;

function resolveOutputDir(rawOptions: CliOptions): string {
  const provided = rawOptions.output;
  if (provided) {
    const absolute = path.isAbsolute(provided)
      ? provided
      : path.join(WORKSPACE_PATHS.codeSyntheticDir, provided);
    return absolute;
  }
  return path.join(
    WORKSPACE_PATHS.codeSyntheticDir,
    "stories",
    "test-story"
  );
}

function resolveCheckpointsDir(outDir: string): string {
  return path.join(outDir, "checkpoints");
}

async function writeCheckpoint(
  outDir: string,
  stage: StageName,
  payload: unknown,
): Promise<string> {
  const checkpointsDir = resolveCheckpointsDir(outDir);
  const filePath = path.join(checkpointsDir, `${stage}.json`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), { encoding: "utf8" });
  return filePath;
}

function resolveStageSequence(options: CliOptions): StageName[] {
  const requested = new Set<StageName>(options.stages);

  if (options.prose) {
    requested.add("prose");
    requested.add("segmentation");
    requested.add("segmentation_correction");
    requested.add("audio");
  }

  if (options.images) {
    requested.add("images");
    requested.add("segmentation");
    requested.add("segmentation_correction");
    requested.add("audio");
  }

  if (requested.size === 0) {
    return [...STAGE_ORDER];
  }

  return STAGE_ORDER.filter((stage) => requested.has(stage));
}

const StoryJsonSchema = z.object({
  topic: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

type StoredStory = z.infer<typeof StoryJsonSchema>;

const SegmentationCheckpointSchema = z
  .union([
    StorySegmentationSchema,
    z.object({
      modelVersion: z.string().trim().min(1),
      segmentation: StorySegmentationSchema,
    }),
  ])
  .transform((value) => {
    if ("segments" in value) {
      return value;
    }
    return value.segmentation;
  });

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

// Prose stage in test mode does not write legacy artifacts; checkpoints only.

// Segmentation stage in test mode does not write legacy artifacts; checkpoints only.

// Audio stage in test mode does not write audio files; checkpoints only.

// Images stage in test mode does not write assets; checkpoints only.

// no-op legacy writers removed.

function segmentationToMediaSegments(
  segmentation: StorySegmentation
): MediaSegment[] {
  return segmentation.segments.map((segment, index) => ({
    image: `/story/local/${String(index + 1).padStart(3, "0")}`,
    narration: segment.narration.map((line) => ({
      speaker: line.voice === "F" ? "f" : "m",
      text: line.text.trim(),
    })),
  }));
}

async function loadStoryFromDisk(outDir: string): Promise<StoredStory> {
  const jsonPath = path.join(resolveCheckpointsDir(outDir), "prose.json");
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    return StoryJsonSchema.parse(parsed);
  } catch (error) {
    if (isFileNotFound(error)) {
      throw new Error(
        `[story] missing story JSON at ${jsonPath}. Run stage 'prose' first.`
      );
    }
    throw error;
  }
}

async function loadSegmentationFromDisk(
  outDir: string
): Promise<StorySegmentation | undefined> {
  const jsonPath = path.join(resolveCheckpointsDir(outDir), "segmentation.json");
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    return SegmentationCheckpointSchema.parse(parsed);
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function loadCorrectedSegmentationFromDisk(
  outDir: string
): Promise<StorySegmentation | undefined> {
  const jsonPath = path.join(
    resolveCheckpointsDir(outDir),
    "segmentation_correction.json"
  );
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    return StorySegmentationSchema.parse(parsed);
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--prose", "Generate the narrated story", false)
    .option("--images", "Generate companion illustration panels", false)
    .option("--topic <topic>", "Topic for the story", DEFAULT_TOPIC)
    .option(
      "--output <dir>",
      "Output directory (absolute or relative to spark-data/code/synthetic)"
    )
    .addOption(
      new Option(
        "--stage <stage...>",
        "Stages to run (prose, segmentation, audio, images)"
      ).choices(STAGE_ORDER)
    );

  program.parse(process.argv);
  const rawOptions = program.opts<{
    prose?: boolean;
    images?: boolean;
    topic?: string;
    output?: string;
    stage?: string[];
  }>();

  const parsed = optionsSchema.parse({
    prose: Boolean(rawOptions.prose),
    images: Boolean(rawOptions.images),
    topic: rawOptions.topic ?? DEFAULT_TOPIC,
    output: rawOptions.output,
    stages: (rawOptions.stage ?? []).map((value) => value.toLowerCase()),
  });

  const outDir = resolveOutputDir(parsed);
  console.log(`[story] output directory: ${outDir}`);

  await runJobsWithConcurrency({
    items: [parsed],
    concurrency: 1,
    getId: () => "story",
    label: "[story]",
    handler: async (options, { progress }) => {
      const stages = resolveStageSequence(options);
      if (stages.length === 0) {
        progress.log("[story] nothing to do (no stages resolved)");
        return;
      }

      let currentStory: StoredStory | undefined;
      let storyLoadedFromDisk = false;
      let segmentationDraft: StorySegmentation | undefined;
      let segmentationDraftLoadedFromDisk = false;
      let correctedSegmentation: StorySegmentation | undefined;
      let correctedSegmentationLoadedFromDisk = false;

      const ensureStory = async (): Promise<StoredStory> => {
        if (currentStory) {
          return currentStory;
        }
        const loaded = await loadStoryFromDisk(outDir);
        if (!storyLoadedFromDisk) {
          progress.log("[story] loaded existing prose from disk");
          storyLoadedFromDisk = true;
        }
        currentStory = loaded;
        return currentStory;
      };

      const ensureDraftSegmentation = async (): Promise<StorySegmentation> => {
        if (segmentationDraft) {
          return segmentationDraft;
        }
        const loaded = await loadSegmentationFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without segmentation. Run stage 'segmentation' first."
          );
        }
        if (!segmentationDraftLoadedFromDisk) {
          progress.log(
            "[story] loaded existing segmentation from checkpoints/segmentation.json"
          );
          segmentationDraftLoadedFromDisk = true;
        }
        segmentationDraft = loaded;
        return segmentationDraft;
      };

      const ensureCorrectedSegmentation = async (): Promise<StorySegmentation> => {
        if (correctedSegmentation) {
          return correctedSegmentation;
        }
        const loaded = await loadCorrectedSegmentationFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without corrected segmentation. Run stage 'segmentation_correction' first."
          );
        }
        if (!correctedSegmentationLoadedFromDisk) {
          progress.log(
            "[story] loaded existing corrected segmentation from checkpoints/segmentation_correction.json"
          );
          correctedSegmentationLoadedFromDisk = true;
        }
        correctedSegmentation = loaded;
        return correctedSegmentation;
      };

      const debugRootDir = path.join(outDir, "debug");
      for (const stage of stages) {
        progress.log(`[story] stage: ${stage}`);
        switch (stage) {
          case "prose": {
            const storyResult = await generateProseStory(options.topic, progress, { debugRootDir });
            currentStory = {
              topic: options.topic,
              text: storyResult.text,
            };
            segmentationDraft = undefined;
            segmentationDraftLoadedFromDisk = false;
            correctedSegmentation = undefined;
            correctedSegmentationLoadedFromDisk = false;
            const proseCheckpoint = currentStory;
            const saved = await writeCheckpoint(outDir, "prose", proseCheckpoint);
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          case "segmentation": {
            const story = await ensureStory();
            try {
              segmentationDraft = await generateStorySegmentation(
                story.text,
                progress,
                { debugRootDir }
              );
              segmentationDraftLoadedFromDisk = false;
              correctedSegmentation = undefined;
              correctedSegmentationLoadedFromDisk = false;
              const segCheckpoint = segmentationDraft;
              const saved = await writeCheckpoint(outDir, "segmentation", segCheckpoint);
              progress.log(`[story] wrote checkpoint ${saved}`);
            } catch (error) {
              if (error instanceof SegmentationValidationError) {
                // Keep failure visible in console for test mode; no artifact writes.
              }
              throw error;
            }
            break;
          }
          case "segmentation_correction": {
            const story = await ensureStory();
            const draftSegmentation =
              segmentationDraft ?? (await ensureDraftSegmentation());
            try {
              correctedSegmentation = await correctStorySegmentation(
                story.text,
                draftSegmentation,
                progress,
                { debugRootDir }
              );
              correctedSegmentationLoadedFromDisk = false;
              const saved = await writeCheckpoint(
                outDir,
                "segmentation_correction",
                correctedSegmentation
              );
              progress.log(`[story] wrote checkpoint ${saved}`);
            } catch (error) {
              if (error instanceof SegmentationCorrectionError) {
                // Keep failure visible in console for test mode; no artifact writes.
              }
              throw error;
            }
            break;
          }
          case "audio": {
            const segments =
              correctedSegmentation ?? (await ensureCorrectedSegmentation());
            const mediaSegments = segmentationToMediaSegments(segments);
            const audioCheckpoint = { inputSegments: mediaSegments };
            const saved = await writeCheckpoint(outDir, "audio", audioCheckpoint);
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          case "images": {
            const segments =
              correctedSegmentation ?? (await ensureCorrectedSegmentation());
            const imagesResult = await generateStoryImages(segments, progress, {
              debugRootDir,
            });
            const imagesCheckpoint = {
              modelVersion: imagesResult.modelVersion,
              imagesCount: imagesResult.images.length,
            };
            const saved = await writeCheckpoint(outDir, "images", imagesCheckpoint);
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          default:
            {
              const exhaustiveCheck: never = stage;
              throw new Error(`Unknown stage encountered: ${exhaustiveCheck}`);
            }
        }
      }

      progress.log("[story] generation finished");
    },
  });

  console.log("[story] artifacts ready in", outDir);
}

void main().catch((error) => {
  console.error("[story] generation failed:", error);
  process.exitCode = 1;
});
