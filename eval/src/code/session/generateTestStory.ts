import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

import { Command, Option } from "commander";
import { z } from "zod";
import sharp from "sharp";

import {
  generateProseStory,
  correctStorySegmentation,
  generateStorySegmentation,
  generateImageSets,
  judgeImageSets,
  serialiseStoryImageSets,
  deserialiseStoryImageSets,
  SerialisedStoryImageSetSchema,
  type SerialisedStoryImageSet,
  type StoryImageSet,
  type StorySegmentation,
  StorySegmentationSchema,
} from "./generateStory";
import {
  generateSessionAudio,
  getFirebaseAdminStorage,
  getGoogleServiceAccount,
  getTestUserId,
  publishSessionMediaClip,
  type MediaSegment,
  type SessionAudioResult,
} from "@spark/llm";
import { runJobsWithConcurrency } from "../../utils/concurrency";
import { formatByteSize, formatDurationSeconds } from "../../utils/format";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";
import { createConsoleProgress } from "./narration";
import { STORY_PLAN_ITEM_ID, STORY_TOPIC, TEST_SESSION_ID } from "./constants";

ensureEvalEnvLoaded();

const StageEnum = z.enum([
  "prose",
  "segmentation",
  "segmentation_correction",
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
  payload: unknown
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

type AudioCheckpoint = z.infer<typeof AudioCheckpointSchema>;

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
  );
}

function segmentationToMediaSegments(
  segmentation: StorySegmentation,
  imagePaths?: readonly string[]
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
  const jsonPath = path.join(
    resolveCheckpointsDir(outDir),
    "segmentation.json"
  );
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

async function loadImageSetsFromDisk(
  outDir: string
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

async function loadImageJudgeSelectionFromDisk(
  outDir: string
): Promise<ImageJudgeCheckpoint | undefined> {
  const jsonPath = path.join(
    resolveCheckpointsDir(outDir),
    "images-judge.json"
  );
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    return ImageJudgeCheckpointSchema.parse(parsed);
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

async function loadAudioCheckpointFromDisk(
  outDir: string
): Promise<AudioCheckpoint | undefined> {
  const jsonPath = path.join(resolveCheckpointsDir(outDir), "audio.json");
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    return AudioCheckpointSchema.parse(parsed);
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
      { cause: error instanceof Error ? error : undefined }
    );
  }
}

function buildImageStoragePath(
  userId: string,
  sessionId: string,
  planItemId: string,
  index: number
): string {
  return path
    .join(
      "spark",
      userId,
      "sessions",
      sessionId,
      planItemId,
      `image_${String(index).padStart(3, "0")}.jpg`
    )
    .replace(/\\/g, "/");
}

async function main(): Promise<void> {
  ensureEvalEnvLoaded();
  const program = new Command();
  program
    .option("--topic <topic>", "Topic for the story", STORY_TOPIC)
    .addOption(
      new Option("--stage <stage...>", "Stages to run").choices(STAGE_ORDER)
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

      let currentStory: StoredStory | undefined;
      let storyLoadedFromDisk = false;
      let segmentationDraft: StorySegmentation | undefined;
      let segmentationDraftLoadedFromDisk = false;
      let correctedSegmentation: StorySegmentation | undefined;
      let correctedSegmentationLoadedFromDisk = false;
      let imageSetsSerialised: SerialisedStoryImageSet[] | undefined;
      let imageSetsLoadedFromDisk = false;
      let imageJudgeSelection: ImageJudgeCheckpoint | undefined;
      let imageJudgeSelectionLoadedFromDisk = false;
      let audioCheckpointData: AudioCheckpoint | undefined;
      let audioCheckpointLoadedFromDisk = false;

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

      const ensureCorrectedSegmentation =
        async (): Promise<StorySegmentation> => {
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

      const ensureImageSets = async (): Promise<SerialisedStoryImageSet[]> => {
        if (imageSetsSerialised) {
          return imageSetsSerialised;
        }
        const loaded = await loadImageSetsFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without image sets. Run stage 'image-sets' first."
          );
        }
        if (!imageSetsLoadedFromDisk) {
          progress.log(
            "[story] loaded existing image sets from checkpoints/image-sets.json"
          );
          imageSetsLoadedFromDisk = true;
        }
        imageSetsSerialised = loaded;
        return imageSetsSerialised;
      };

      const ensureImageJudge = async (): Promise<ImageJudgeCheckpoint> => {
        if (imageJudgeSelection) {
          return imageJudgeSelection;
        }
        const loaded = await loadImageJudgeSelectionFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without image judgement. Run stage 'images-judge' first."
          );
        }
        if (!imageJudgeSelectionLoadedFromDisk) {
          progress.log(
            "[story] loaded existing image judgement from checkpoints/images-judge.json"
          );
          imageJudgeSelectionLoadedFromDisk = true;
        }
        imageJudgeSelection = loaded;
        return imageJudgeSelection;
      };

      const ensureAudioCheckpoint = async (): Promise<AudioCheckpoint> => {
        if (audioCheckpointData) {
          return audioCheckpointData;
        }
        const loaded = await loadAudioCheckpointFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without audio checkpoint. Run stage 'audio' first."
          );
        }
        if (!audioCheckpointLoadedFromDisk) {
          progress.log(
            "[story] loaded existing audio checkpoint from checkpoints/audio.json"
          );
          audioCheckpointLoadedFromDisk = true;
        }
        audioCheckpointData = loaded;
        return audioCheckpointData;
      };

      const debugRootDir = path.join(outDir, "debug");
      for (const stage of stages) {
        progress.log(`[story] stage: ${stage}`);
        switch (stage) {
          case "prose": {
            const storyResult = await generateProseStory(
              options.topic,
              progress,
              { debugRootDir }
            );
            currentStory = {
              topic: options.topic,
              text: storyResult.text,
            };
            segmentationDraft = undefined;
            segmentationDraftLoadedFromDisk = false;
            correctedSegmentation = undefined;
            correctedSegmentationLoadedFromDisk = false;
            imageSetsSerialised = undefined;
            imageSetsLoadedFromDisk = false;
            const proseCheckpoint = currentStory;
            const saved = await writeCheckpoint(
              outDir,
              "prose",
              proseCheckpoint
            );
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
              imageSetsSerialised = undefined;
              imageSetsLoadedFromDisk = false;
              const segCheckpoint = segmentationDraft;
              const saved = await writeCheckpoint(
                outDir,
                "segmentation",
                segCheckpoint
              );
              progress.log(`[story] wrote checkpoint ${saved}`);
            } catch (error) {
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
              imageSetsSerialised = undefined;
              imageSetsLoadedFromDisk = false;
              const saved = await writeCheckpoint(
                outDir,
                "segmentation_correction",
                correctedSegmentation
              );
              progress.log(`[story] wrote checkpoint ${saved}`);
            } catch (error) {
              throw error;
            }
            break;
          }
          case "audio": {
            const segments =
              correctedSegmentation ?? (await ensureCorrectedSegmentation());
            const mediaSegments = segmentationToMediaSegments(segments);
            if (mediaSegments.length === 0) {
              throw new Error(
                "Cannot generate narration audio without at least one segment."
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

            const saved = await writeCheckpoint(
              outDir,
              "audio",
              audioCheckpoint
            );
            const durationLabel = formatDurationSeconds(
              audioResult.totalDurationSec
            );
            const sizeLabel = formatByteSize(audioResult.totalBytes);
            progress.log(
              `[story] audio ready at ${audioRelativePath} (${durationLabel}, ${sizeLabel})`
            );
            progress.log(`[story] wrote checkpoint ${saved}`);
            audioCheckpointData = AudioCheckpointSchema.parse(audioCheckpoint);
            audioCheckpointLoadedFromDisk = false;
            break;
          }
          case "image-sets": {
            const segments =
              correctedSegmentation ?? (await ensureCorrectedSegmentation());
            const imageSets = await generateImageSets(segments, progress, {
              debugRootDir,
            });
            imageSetsSerialised = serialiseStoryImageSets(imageSets);
            imageSetsLoadedFromDisk = false;
            imageJudgeSelection = undefined;
            imageJudgeSelectionLoadedFromDisk = false;
            const imageSetsCheckpoint: ImageSetsCheckpoint = {
              imageSets: imageSetsSerialised,
            };
            ImageSetsCheckpointSchema.parse(imageSetsCheckpoint);
            const saved = await writeCheckpoint(
              outDir,
              "image-sets",
              imageSetsCheckpoint
            );
            progress.log(`[story] wrote checkpoint ${saved}`);
            break;
          }
          case "images-judge": {
            const segments =
              correctedSegmentation ?? (await ensureCorrectedSegmentation());
            const serialisedSets = await ensureImageSets();
            const imageSets: StoryImageSet[] =
              deserialiseStoryImageSets(serialisedSets);
            const judgement = await judgeImageSets(
              imageSets,
              segments,
              progress,
              {
                debugRootDir,
              }
            );
            const judgeCheckpoint: ImageJudgeCheckpoint = {
              selectedSet: judgement.winningImageSetLabel,
            };
            ImageJudgeCheckpointSchema.parse(judgeCheckpoint);
            const saved = await writeCheckpoint(
              outDir,
              "images-judge",
              judgeCheckpoint
            );
            progress.log(`[story] wrote checkpoint ${saved}`);
            imageJudgeSelection = judgeCheckpoint;
            imageJudgeSelectionLoadedFromDisk = false;
            break;
          }
          case "publish": {
            const userId = getTestUserId();
            const sessionId = TEST_SESSION_ID;
            const planItemId = STORY_PLAN_ITEM_ID;
            const storageBucket = resolveStorageBucket();
            progress.log(
              `[story] publishing for user ${userId} session ${sessionId} (bucket ${storageBucket})`
            );

            const segmentation =
              correctedSegmentation ?? (await ensureCorrectedSegmentation());
            const serialisedSets = await ensureImageSets();
            const judgement = await ensureImageJudge();

            const allSets = deserialiseStoryImageSets(serialisedSets);
            const winningSet = allSets.find(
              (set) => set.imageSetLabel === judgement.selectedSet
            );
            if (!winningSet) {
              throw new Error(
                `Winning image set ${judgement.selectedSet} not found in checkpoints/image-sets.json`
              );
            }

            const interiorImages = winningSet.images
              .filter((image) => image.index >= 1)
              .filter((image) => image.index <= segmentation.segments.length)
              .sort((a, b) => a.index - b.index);

            if (interiorImages.length !== segmentation.segments.length) {
              throw new Error(
                `Winning image set must include ${segmentation.segments.length} interior images, found ${interiorImages.length}`
              );
            }

            const storage = getFirebaseAdminStorage(undefined, {
              storageBucket,
            });
            const bucket = storage.bucket(storageBucket);

            const storagePaths: string[] = [];
            for (let index = 0; index < interiorImages.length; index += 1) {
              const image = interiorImages[index];
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
                index + 1
              );
              const file = bucket.file(storagePath);
              await file.save(jpegBuffer, {
                resumable: false,
                metadata: {
                  contentType: "image/jpeg",
                  cacheControl: "public, max-age=0",
                },
              });
              storagePaths.push(`/${storagePath}`);
            }
            progress.log(
              `[story] uploaded ${storagePaths.length} story images to gs://${storageBucket}`
            );

            const audioCheckpoint = await ensureAudioCheckpoint();
            const segmentsForPublish: MediaSegment[] =
              audioCheckpoint.inputSegments.map((segment, index) => {
                const imagePath = storagePaths[index];
                if (!imagePath) {
                  throw new Error(
                    `Missing uploaded image path for segment ${index + 1}`
                  );
                }
                return {
                  image: imagePath,
                  narration: segment.narration.map((line) => ({
                    speaker: line.speaker === "f" ? "f" : "m",
                    text: line.text.trim(),
                  })),
                };
              });

            if (segmentsForPublish.length !== segmentation.segments.length) {
              throw new Error(
                `Audio checkpoint includes ${segmentsForPublish.length} segments but corrected segmentation has ${segmentation.segments.length}`
              );
            }

            const audioFilePath = path.isAbsolute(audioCheckpoint.output.file)
              ? audioCheckpoint.output.file
              : path.join(outDir, audioCheckpoint.output.file);
            const audioResult: SessionAudioResult = {
              outputFilePath: audioFilePath,
              outputMimeType: audioCheckpoint.output.mimeType,
              totalDurationSec: audioCheckpoint.output.durationSec,
              segmentOffsets: audioCheckpoint.output.lineOffsets,
              segmentDurations: audioCheckpoint.output.lineDurations,
              sampleRate: audioCheckpoint.output.sampleRate,
              channels: audioCheckpoint.output.channels === 2 ? 2 : 1,
              totalBytes: audioCheckpoint.output.totalBytes,
              segmentFiles: audioCheckpoint.segmentFiles.map((filePath) =>
                path.isAbsolute(filePath)
                  ? filePath
                  : path.join(outDir, filePath)
              ),
              slideOffsets: audioCheckpoint.output.slideOffsets,
              slideDurations: audioCheckpoint.output.slideDurations,
              lineOffsets: audioCheckpoint.output.lineOffsets,
              lineDurations: audioCheckpoint.output.lineDurations,
            };

            const publishResult = await publishSessionMediaClip({
              userId,
              sessionId,
              planItemId,
              segments: segmentsForPublish,
              audio: audioResult,
              storageBucket,
            });

            progress.log(
              `[story] published media to ${publishResult.storagePath} (doc ${publishResult.documentPath})`
            );
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
