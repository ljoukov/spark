import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command, Option } from "commander";
import { z } from "zod";

import {
  DEFAULT_TOPIC,
  generateProseStory,
  generateStoryImages,
  generateStorySegmentation,
  type StoryImagesResult,
  type StoryProseResult,
  type StorySegmentation,
  type StorySegmentationResult,
  StorySegmentationSchema,
} from "./generateStory";
import {
  generateSessionAudio,
  type MediaSegment,
} from "@spark/llm";
import {
  runJobsWithConcurrency,
  type JobProgressReporter,
} from "../../utils/concurrency";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";
import {
  formatByteSize,
  formatDurationSeconds,
} from "../../utils/format";
import { createConsoleProgress } from "./narration";

ensureEvalEnvLoaded();

const StageEnum = z.enum(["prose", "segmentation", "audio", "images"]);
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

function resolveStageSequence(options: CliOptions): StageName[] {
  const requested = new Set<StageName>(options.stages);

  if (options.prose) {
    requested.add("prose");
    requested.add("segmentation");
    requested.add("audio");
  }

  if (options.images) {
    requested.add("images");
    requested.add("audio");
  }

  if (requested.size === 0) {
    return [...STAGE_ORDER];
  }

  return STAGE_ORDER.filter((stage) => requested.has(stage));
}

const StoryJsonSchema = z.object({
  modelVersion: z.string().trim().min(1),
  topic: z.string().trim().min(1),
  text: z.string().trim().min(1),
  prompt: z.string().trim().optional(),
});

type StoredStory = z.infer<typeof StoryJsonSchema>;

function isFileNotFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

async function saveStoryArtifacts(
  result: StoryProseResult,
  topic: string,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const storyPath = path.join(outDir, "story.txt");
  const header = `modelVersion: ${result.modelVersion}\ntopic: ${topic}\n\n`;
  await writeFile(storyPath, header + result.text, { encoding: "utf8" });
  progress.log(`[story] saved prose to ${storyPath}`);

  const storyJsonPath = path.join(outDir, "story.json");
  const storyPayload = {
    modelVersion: result.modelVersion,
    topic,
    text: result.text,
    prompt: result.prompt,
  };
  await writeFile(storyJsonPath, JSON.stringify(storyPayload, null, 2), {
    encoding: "utf8",
  });
  progress.log(`[story] saved prose JSON to ${storyJsonPath}`);

  const promptPath = path.join(outDir, "prompt.txt");
  await writeFile(promptPath, result.prompt, { encoding: "utf8" });
  progress.log(`[story] saved prompt snapshot to ${promptPath}`);
}

async function saveSegmentationArtifacts(
  result: StorySegmentationResult,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  await mkdir(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "segments.json");
  const payload = {
    modelVersion: result.modelVersion,
    ...result.segmentation,
  };
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
  });
  progress.log(`[story] saved segmentation JSON to ${jsonPath}`);

  const promptPath = path.join(outDir, "segmentation-prompt.txt");
  await writeFile(promptPath, result.prompt, { encoding: "utf8" });
  progress.log(`[story] saved segmentation prompt snapshot to ${promptPath}`);
}

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

async function saveAudioArtifacts(
  segmentation: StorySegmentation,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  const audioDir = path.join(outDir, "audio");
  await mkdir(audioDir, { recursive: true });
  const audioPath = path.join(audioDir, "story.mp3");

  const segments = segmentationToMediaSegments(segmentation);
  const audioResult = await generateSessionAudio({
    segments,
    outputFilePath: audioPath,
    progress: createConsoleProgress("Story audio"),
  });

  const metadataPath = path.join(audioDir, "story.json");
  const metadata = {
    mimeType: audioResult.outputMimeType,
    durationSec: audioResult.totalDurationSec,
    totalBytes: audioResult.totalBytes,
    slideOffsets: audioResult.slideOffsets,
    slideDurations: audioResult.slideDurations,
    lineOffsets: audioResult.lineOffsets,
    lineDurations: audioResult.lineDurations,
  };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2), {
    encoding: "utf8",
  });

  progress.log(
    `[story] saved audio to ${audioPath} (${formatDurationSeconds(audioResult.totalDurationSec)} • ${formatByteSize(audioResult.totalBytes)})`,
  );
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

async function saveImageArtifacts(
  result: StoryImagesResult,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  const assetsDir = path.join(outDir, "images");
  await mkdir(assetsDir, { recursive: true });

  const promptPath = path.join(assetsDir, "prompt.txt");
  await writeFile(promptPath, result.prompt, { encoding: "utf8" });
  progress.log(`[story] saved image prompt to ${promptPath}`);

  for (const image of result.images) {
    const ext = extensionFromMime(image.mimeType);
    const padded = String(image.index).padStart(3, "0");
    const filePath = path.join(assetsDir, `image_${padded}.${ext}`);
    await writeFile(filePath, image.data);
    progress.log(`[story] saved asset ${filePath}`);
  }

  if (result.captions) {
    const captionsPath = path.join(assetsDir, "captions.txt");
    const header = `modelVersion: ${result.modelVersion}\nimages: ${result.images.length}\n\n`;
    await writeFile(captionsPath, header + result.captions, {
      encoding: "utf8",
    });
    progress.log(`[story] saved image captions to ${captionsPath}`);
  }
}

async function loadStoryFromDisk(outDir: string): Promise<StoredStory> {
  const jsonPath = path.join(outDir, "story.json");
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
  const jsonPath = path.join(outDir, "segments.json");
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
      let segmentationResult: StorySegmentationResult | undefined;
      let segmentation: StorySegmentation | undefined;
      let segmentationLoadedFromDisk = false;

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

      const ensureSegmentation = async (): Promise<StorySegmentation> => {
        if (segmentation) {
          return segmentation;
        }
        const loaded = await loadSegmentationFromDisk(outDir);
        if (!loaded) {
          throw new Error(
            "Cannot continue without segmentation. Run stage 'segmentation' first."
          );
        }
        if (!segmentationLoadedFromDisk) {
          progress.log("[story] loaded existing segmentation from segments.json");
          segmentationLoadedFromDisk = true;
        }
        segmentation = loaded;
        return segmentation;
      };

      for (const stage of stages) {
        progress.log(`[story] stage: ${stage}`);
        switch (stage) {
          case "prose": {
            const storyResult = await generateProseStory(options.topic, progress);
            currentStory = {
              text: storyResult.text,
              prompt: storyResult.prompt,
              modelVersion: storyResult.modelVersion,
              topic: options.topic,
            };
            segmentationResult = undefined;
            segmentation = undefined;
            segmentationLoadedFromDisk = false;
            await saveStoryArtifacts(storyResult, options.topic, outDir, progress);
            break;
          }
          case "segmentation": {
            const story = await ensureStory();
            segmentationResult = await generateStorySegmentation(
              story.text,
              progress
            );
            segmentation = segmentationResult.segmentation;
            await saveSegmentationArtifacts(
              segmentationResult,
              outDir,
              progress
            );
            break;
          }
          case "audio": {
            const segments =
              segmentationResult?.segmentation ?? (await ensureSegmentation());
            segmentation = segments;
            await saveAudioArtifacts(segments, outDir, progress);
            break;
          }
          case "images": {
            const segments =
              segmentationResult?.segmentation ?? (await ensureSegmentation());
            segmentation = segments;
            const imagesResult = await generateStoryImages(segments, progress);
            await saveImageArtifacts(imagesResult, outDir, progress);
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
