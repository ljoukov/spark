import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";
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
  runJobsWithConcurrency,
  type JobProgressReporter,
} from "../../utils/concurrency";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../../utils/paths";

ensureEvalEnvLoaded();

const optionsSchema = z.object({
  prose: z.boolean(),
  images: z.boolean(),
  topic: z.string().trim().min(1, "topic cannot be empty"),
  output: z.string().trim().min(1, "output path cannot be empty").optional(),
});

type CliOptions = z.infer<typeof optionsSchema>;

function timestampSlug(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

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
    `story-${timestampSlug()}`
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

async function loadSegmentationFromDisk(
  outDir: string
): Promise<StorySegmentation | undefined> {
  const jsonPath = path.join(outDir, "segments.json");
  try {
    const raw = await readFile(jsonPath, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    return StorySegmentationSchema.parse(parsed);
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
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
    );

  program.parse(process.argv);
  const rawOptions = program.opts<{
    prose?: boolean;
    images?: boolean;
    topic?: string;
    output?: string;
  }>();

  const parsed = optionsSchema.parse({
    prose: Boolean(rawOptions.prose),
    images: Boolean(rawOptions.images),
    topic: rawOptions.topic ?? DEFAULT_TOPIC,
    output: rawOptions.output,
  });

  const shouldGenerateProse = parsed.prose || (!parsed.prose && !parsed.images);
  const shouldGenerateImages =
    parsed.images || (!parsed.prose && !parsed.images);

  if (!shouldGenerateProse && !shouldGenerateImages) {
    console.log("[story] nothing to do (no generation flags set)");
    return;
  }

  const outDir = resolveOutputDir(parsed);
  console.log(`[story] output directory: ${outDir}`);

  await runJobsWithConcurrency({
    items: [parsed],
    concurrency: 1,
    getId: () => "story",
    label: "[story]",
    handler: async (options, { progress }) => {
      let storyResult: StoryProseResult | undefined;
      let segmentationResult: StorySegmentationResult | undefined;

      if (shouldGenerateProse) {
        storyResult = await generateProseStory(options.topic, progress);
        await saveStoryArtifacts(storyResult, options.topic, outDir, progress);

        segmentationResult = await generateStorySegmentation(
          storyResult.text,
          progress
        );
        await saveSegmentationArtifacts(
          segmentationResult,
          outDir,
          progress
        );
      }

      if (shouldGenerateImages) {
        let segmentation = segmentationResult?.segmentation;
        if (!segmentation) {
          segmentation = await loadSegmentationFromDisk(outDir);
          if (segmentation) {
            progress.log(
              "[story] loaded existing segmentation from segments.json"
            );
          }
        }

        if (!segmentation) {
          throw new Error(
            "Cannot generate images without segmentation. Run with --prose first to create segments."
          );
        }

        const imagesResult = await generateStoryImages(segmentation, progress);
        await saveImageArtifacts(imagesResult, outDir, progress);
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
