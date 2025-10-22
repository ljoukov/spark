import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { Command, Option } from "commander";
import { z } from "zod";

import {
  generateImageSets,
  judgeImageSets,
  serialiseStoryImageSets,
  deserialiseStoryImageSets,
  SerialisedStoryImageSetSchema,
  type SerialisedStoryImageSet,
  type StoryImageSet,
  type StorySegmentation,
  StoryGenerationPipeline,
} from "@spark/llm/code/generateStory";
import {
  generateSessionAudio,
  getGoogleServiceAccount,
  getTestUserId,
  type MediaSegment,
} from "@spark/llm";
import { runJobsWithConcurrency } from "@spark/llm/utils/concurrency";
import { formatByteSize, formatDurationSeconds } from "@spark/llm/utils/format";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";
import { createConsoleProgress } from "@spark/llm/code/generateNarration";
import { STORY_PLAN_ITEM_ID, STORY_TOPIC, TEST_SESSION_ID } from "./constants";

ensureEvalEnvLoaded();

const StageEnum = z.enum([
  "prose",
  "segmentation",
  "segmentation_correction",
  "images",
  "audio",
  "image-sets",
  "images-judge",
  "publish",
]);
type StageName = z.infer<typeof StageEnum>;
const STAGE_ORDER: StageName[] = StageEnum.options;

const optionsSchema = z.object({
  topic: z.string().trim().min(1, "topic cannot be empty"),
  stages: z.array(StageEnum).default([]),
});

type CliOptions = z.infer<typeof optionsSchema>;

function resolveOutputDir(): string {
  return path.join(WORKSPACE_PATHS.codeSyntheticDir, "stories", "test-story");
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
  await writeFile(filePath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
  });
  return filePath;
}

function resolveStageSequence(options: CliOptions): StageName[] {
  const requested = new Set<StageName>(options.stages);

  if (requested.size === 0) {
    return STAGE_ORDER.filter((stage) => stage !== "publish");
  }

  return STAGE_ORDER.filter((stage) => requested.has(stage));
}

const ImageSetsCheckpointSchema = z.object({
  imageSets: z.array(SerialisedStoryImageSetSchema).min(1),
});

type ImageSetsCheckpoint = z.infer<typeof ImageSetsCheckpointSchema>;

const ImageJudgeCheckpointSchema = z.object({
  selectedSet: z.enum(["set_a", "set_b"]),
});

type ImageJudgeCheckpoint = z.infer<typeof ImageJudgeCheckpointSchema>;

const AudioNarrationLineSchema = z.object({
  speaker: z.union([z.literal("m"), z.literal("f")]),
  text: z.string().trim().min(1),
});

const AudioSegmentSchema = z.object({
  image: z.string().trim().min(1),
  narration: z.array(AudioNarrationLineSchema).min(1),
});

const AudioCheckpointSchema = z.object({
  inputSegments: z.array(AudioSegmentSchema).min(1),
  output: z.object({
    file: z.string().trim().min(1),
    durationSec: z.number().positive(),
    totalBytes: z.number().int().nonnegative(),
    mimeType: z.string().trim().min(1),
    sampleRate: z.number().int().positive(),
    channels: z.union([z.literal(1), z.literal(2)]),
    slideOffsets: z.array(z.number()),
    slideDurations: z.array(z.number()),
    lineOffsets: z.array(z.number()),
    lineDurations: z.array(z.number()),
  }),
  segmentFiles: z.array(z.string().trim().min(1)).default([]),
});

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT",
  );
}

function segmentationToMediaSegments(
  segmentation: StorySegmentation,
  imagePaths?: readonly string[],
): MediaSegment[] {
  return segmentation.segments.map((segment, index) => ({
    image:
      imagePaths?.[index] ??
      `/story/local/${String(index + 1).padStart(3, "0")}`,
    narration: segment.narration.map((line) => ({
      speaker: line.voice === "F" ? "f" : "m",
      text: line.text.trim(),
    })),
  }));
}

async function loadImageSetsFromDisk(
  outDir: string,
): Promise<SerialisedStoryImageSet[] | undefined> {
  const jsonPath = path.join(resolveCheckpointsDir(outDir), "image-sets.json");
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    const checkpoint = ImageSetsCheckpointSchema.parse(parsed);
    return checkpoint.imageSets;
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function normalizeBucketName(raw: string | undefined): string {
  if (!raw) {
    return "";
  }
  return raw
    .trim()
    .replace(/^gs:\/\//i, "")
    .replace(/^https:\/\/storage\.googleapis\.com\//i, "")
    .replace(/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//i, "")
    .replace(/\/.*$/, "");
}

function resolveStorageBucket(): string {
  const sources = [
    process.env.FIREBASE_STORAGE_BUCKET,
    process.env.STORAGE_BUCKET,
    process.env.GCLOUD_STORAGE_BUCKET,
  ];
  const bucketFromEnv = sources
    .map((candidate) => normalizeBucketName(candidate))
    .find((value) => value.length > 0);
  if (bucketFromEnv) {
    return bucketFromEnv;
  }

  try {
    const serviceAccount = getGoogleServiceAccount();
    return `${serviceAccount.projectId}.firebasestorage.app`;
  } catch (error) {
    throw new Error(
      "FIREBASE_STORAGE_BUCKET (or STORAGE_BUCKET) must be provided to publish media assets.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}

async function main(): Promise<void> {
  ensureEvalEnvLoaded();
  const program = new Command();
  program
    .option("--topic <topic>", "Topic for the story", STORY_TOPIC)
    .addOption(
      new Option("--stage <stage...>", "Stages to run").choices(STAGE_ORDER),
    );

  program.parse(process.argv);
  const rawOptions = program.opts<{
    topic?: string;
    stage?: string[];
  }>();

  const parsed = optionsSchema.parse({
    topic: rawOptions.topic ?? STORY_TOPIC,
    stages: (rawOptions.stage ?? []).map((value) => value.toLowerCase()),
  });

  const outDir = resolveOutputDir();
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

      const userId = getTestUserId();
      const sessionId = TEST_SESSION_ID;
      const planItemId = STORY_PLAN_ITEM_ID;
      const storageBucket = resolveStorageBucket();
      const debugRootDir = path.join(outDir, "debug");
      const checkpointDir = resolveCheckpointsDir(outDir);

      const pipeline = new StoryGenerationPipeline({
        topic: options.topic,
        userId,
        sessionId,
        planItemId,
        storageBucket,
        progress,
        audioProgressLabel: "story/audio",
        debugRootDir,
        checkpointDir,
      });

      let imageSetsSerialised: SerialisedStoryImageSet[] | undefined;

      const ensureImageSets = async (): Promise<SerialisedStoryImageSet[]> => {
        if (imageSetsSerialised) {
          return imageSetsSerialised;
        }
        const loaded = await loadImageSetsFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without image sets. Run stage 'image-sets' first.",
          );
        }
        progress.log(
          "[story] loaded existing image sets from checkpoints/image-sets.json",
        );
        imageSetsSerialised = loaded;
        return imageSetsSerialised;
      };

      for (const stage of stages) {
        progress.log(`[story] stage: ${stage}`);
        switch (stage) {
          case "prose": {
            const result = await pipeline.ensureProse();
            progress.log(
              `[story] prose ready (${result.value.text.length} chars, source ${result.source})`,
            );
            imageSetsSerialised = undefined;
            break;
          }
          case "segmentation": {
            const result = await pipeline.ensureSegmentation();
            progress.log(
              `[story] segmentation ready (${result.value.segments.length} segments, source ${result.source})`,
            );
            imageSetsSerialised = undefined;
            break;
          }
          case "segmentation_correction": {
            const result = await pipeline.ensureSegmentationCorrection();
            progress.log(
              `[story] corrected segmentation ready (${result.value.segments.length} segments, source ${result.source})`,
            );
            imageSetsSerialised = undefined;
            break;
          }
          case "images": {
            const result = await pipeline.ensureImages();
            progress.log(
              `[story] selected image set with ${result.value.images.length} images (source ${result.source})`,
            );
            break;
          }
          case "publish": {
            const result = await pipeline.ensureNarration();
            progress.log(
              `[story] published narration to ${result.value.publishResult.storagePath} (doc ${result.value.publishResult.documentPath}, source ${result.source})`,
            );
            break;
          }
          case "audio": {
            const { value: segmentation } =
              await pipeline.ensureSegmentationCorrection();
            const mediaSegments = segmentationToMediaSegments(segmentation);
            if (mediaSegments.length === 0) {
              throw new Error(
                "Cannot generate narration audio without at least one segment.",
              );
            }

            const audioOutputDir = path.join(outDir, "audio");
            await mkdir(audioOutputDir, { recursive: true });

            const persistSegmentsDir = path.join(audioOutputDir, "segments");
            await rm(persistSegmentsDir, { recursive: true, force: true });

            const audioRelativePath = path
              .join("audio", "story.mp3")
              .replace(/\\/g, "/");
            const audioOutputPath = path.join(outDir, audioRelativePath);

            const audioResult = await generateSessionAudio({
              segments: mediaSegments,
              outputFilePath: audioOutputPath,
              persistSegmentsDir,
              progress: createConsoleProgress("story/audio"),
            });

            const toRelative = (filePath: string): string => {
              const relative = path.relative(outDir, filePath);
              if (
                !relative ||
                relative.startsWith("..") ||
                path.isAbsolute(relative)
              ) {
                return filePath.replace(/\\/g, "/");
              }
              return relative.replace(/\\/g, "/");
            };

            const audioCheckpoint = {
              inputSegments: mediaSegments,
              output: {
                file: audioRelativePath,
                durationSec: audioResult.totalDurationSec,
                totalBytes: audioResult.totalBytes,
                mimeType: audioResult.outputMimeType,
                sampleRate: audioResult.sampleRate,
                channels: audioResult.channels,
                slideOffsets: audioResult.slideOffsets,
                slideDurations: audioResult.slideDurations,
                lineOffsets: audioResult.lineOffsets,
                lineDurations: audioResult.lineDurations,
              },
              segmentFiles: audioResult.segmentFiles.map(toRelative),
            };

            AudioCheckpointSchema.parse(audioCheckpoint);
            const saved = await writeCheckpoint(
              outDir,
              "audio",
              audioCheckpoint,
            );
            const durationLabel = formatDurationSeconds(
              audioResult.totalDurationSec,
            );
            const sizeLabel = formatByteSize(audioResult.totalBytes);
            progress.log(
              `[story] audio ready at ${audioRelativePath} (${durationLabel}, ${sizeLabel})`,
            );
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          case "image-sets": {
            const { value: segmentation } =
              await pipeline.ensureSegmentationCorrection();
            const imageSets = await generateImageSets(segmentation, progress, {
              debugRootDir,
            });
            imageSetsSerialised = serialiseStoryImageSets(imageSets);
            const imageSetsCheckpoint: ImageSetsCheckpoint = {
              imageSets: imageSetsSerialised,
            };
            const saved = await writeCheckpoint(
              outDir,
              "image-sets",
              imageSetsCheckpoint,
            );
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          case "images-judge": {
            const { value: segmentation } =
              await pipeline.ensureSegmentationCorrection();
            const serialisedSets = await ensureImageSets();
            const imageSets: StoryImageSet[] =
              deserialiseStoryImageSets(serialisedSets);
            const judgement = await judgeImageSets(
              imageSets,
              segmentation,
              progress,
              {
                debugRootDir,
              },
            );
            const judgeCheckpoint: ImageJudgeCheckpoint = {
              selectedSet: judgement.winningImageSetLabel,
            };
            ImageJudgeCheckpointSchema.parse(judgeCheckpoint);
            const saved = await writeCheckpoint(
              outDir,
              "images-judge",
              judgeCheckpoint,
            );
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          default: {
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
