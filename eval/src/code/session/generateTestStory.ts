import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command, Option } from "commander";
import { z } from "zod";

import {
  DEFAULT_TOPIC,
  generateProseStory,
  generateStoryImages,
  generateStorySegmentation,
  SegmentationValidationError,
  SegmentationCorrectionError,
  buildSegmentationPrompt,
  buildStoryPrompt,
  ART_STYLE_VINTAGE_CARTOON,
  type StoryImagesResult,
  type StoryProseResult,
  type StorySegmentation,
  type StorySegmentationResult,
  type SegmentationAttemptSnapshot,
  type SegmentationCorrectorAttempt,
  type StoryImagesArtifacts,
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
  thoughts: z.array(z.string()).optional(),
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

function formatAttemptLabel(attempt: number): string {
  return `attempt-${String(attempt).padStart(2, "0")}`;
}

async function removeArtifacts(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (target) => {
      await rm(target, { recursive: true, force: true });
    })
  );
}

async function writeTextSnapshot(targetPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents, { encoding: "utf8" });
}

async function writeJsonSnapshot(targetPath: string, payload: unknown): Promise<void> {
  await writeTextSnapshot(targetPath, JSON.stringify(payload, null, 2));
}

function buildImagesPromptSnapshot(segmentation: StorySegmentation): string {
  const lines: string[] = [
    "Please make a total of 12 images:",
    "- 1-10 story images",
    '- "the end" image (should be a memorable hint at the core idea, morale, or legacy)',
    '- the "movie poster" image for the whole story (hook)',
    "Make high quality, high positivity cartoon style.",
    "",
    "Follow the style:",
    ...ART_STYLE_VINTAGE_CARTOON,
    "",
    "Image descriptions:",
  ];
  segmentation.segments.forEach((segment, index) => {
    const prompt = segment.imagePrompt.trim();
    lines.push(`Image ${index + 1}: ${prompt}`);
  });
  const endingIndex = segmentation.segments.length + 1;
  lines.push(
    `Image ${endingIndex} (the end): ${segmentation.endingPrompt.trim()}`
  );
  const posterIndex = segmentation.segments.length + 2;
  lines.push(`Image ${posterIndex} (poster): ${segmentation.posterPrompt.trim()}`);
  return lines.join("\n");
}

async function cleanProseStage(outDir: string): Promise<void> {
  await removeArtifacts([
    path.join(outDir, "story.txt"),
    path.join(outDir, "story.json"),
    path.join(outDir, "story-thoughts.txt"),
    path.join(outDir, "prompt.txt"),
    path.join(outDir, "prompts"),
  ]);
}

async function prepareProsePrompt(topic: string, outDir: string): Promise<string> {
  const promptText = buildStoryPrompt(topic);
  const latestPath = path.join(outDir, "prompt.txt");
  await writeTextSnapshot(latestPath, promptText);
  const attemptDir = path.join(outDir, "prompts", formatAttemptLabel(1));
  await writeTextSnapshot(
    path.join(attemptDir, `prompt-${formatAttemptLabel(1)}.txt`),
    promptText,
  );
  return promptText;
}

async function cleanSegmentationStage(outDir: string): Promise<void> {
  const attemptPromptPaths: string[] = [];
  try {
    const entries = await readdir(outDir);
    for (const entry of entries) {
      if (
        entry.startsWith("segmentation-prompt-attempt-") &&
        entry.endsWith(".txt")
      ) {
        attemptPromptPaths.push(path.join(outDir, entry));
      }
    }
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }

  await removeArtifacts([
    path.join(outDir, "segments.json"),
    path.join(outDir, "segmentation-prompt.txt"),
    path.join(outDir, "segmentation-attempts"),
    path.join(outDir, "segmentation"),
    ...attemptPromptPaths,
  ]);
}

async function prepareSegmentationPrompt(
  storyText: string,
  outDir: string,
): Promise<string> {
  const promptText = buildSegmentationPrompt(storyText);
  const latestPath = path.join(outDir, "segmentation-prompt.txt");
  await writeTextSnapshot(latestPath, promptText);
  const attemptPath = path.join(
    outDir,
    `segmentation-prompt-${formatAttemptLabel(1)}.txt`
  );
  await writeTextSnapshot(attemptPath, promptText);
  return promptText;
}

async function cleanAudioStage(outDir: string): Promise<void> {
  await removeArtifacts([path.join(outDir, "audio")]);
}

async function prepareAudioInputs(
  segmentation: StorySegmentation,
  outDir: string,
): Promise<void> {
  const mediaSegments = segmentationToMediaSegments(segmentation);
  const audioDir = path.join(outDir, "audio");
  await writeJsonSnapshot(path.join(audioDir, "input.json"), mediaSegments);
  const attemptDir = path.join(audioDir, "attempts", formatAttemptLabel(1));
  await writeJsonSnapshot(
    path.join(attemptDir, `input-${formatAttemptLabel(1)}.json`),
    mediaSegments,
  );
}

async function cleanImagesStage(outDir: string): Promise<void> {
  await removeArtifacts([path.join(outDir, "images")]);
}

async function prepareImagesPrompt(
  segmentation: StorySegmentation,
  outDir: string,
): Promise<string> {
  const snapshot = buildImagesPromptSnapshot(segmentation);
  const latestPath = path.join(outDir, "images", "prompt.txt");
  await writeTextSnapshot(latestPath, snapshot);
  const attemptDir = path.join(outDir, "images", "prompts", formatAttemptLabel(1));
  await writeTextSnapshot(
    path.join(attemptDir, `prompt-${formatAttemptLabel(1)}.txt`),
    snapshot,
  );
  return snapshot;
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
    thoughts: result.thoughts,
  };
  await writeFile(storyJsonPath, JSON.stringify(storyPayload, null, 2), {
    encoding: "utf8",
  });
  progress.log(`[story] saved prose JSON to ${storyJsonPath}`);

  const promptPath = path.join(outDir, "prompt.txt");
  await writeFile(promptPath, result.prompt, { encoding: "utf8" });
  progress.log(`[story] saved prompt snapshot to ${promptPath}`);

  if (result.thoughts && result.thoughts.length > 0) {
    const thoughtsPath = path.join(outDir, "story-thoughts.txt");
    const thoughtHeader = `modelVersion: ${result.modelVersion}\nthoughtCount: ${result.thoughts.length}\n\n`;
    await writeFile(
      thoughtsPath,
      thoughtHeader + result.thoughts.join("\n---\n"),
      { encoding: "utf8" }
    );
    progress.log(`[story] saved model thoughts to ${thoughtsPath}`);
  }
}

async function saveSegmentationSnapshotArtifacts(
  snapshot: SegmentationAttemptSnapshot,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  const attemptLabel = formatAttemptLabel(snapshot.attempt);
  const prefix =
    snapshot.phase === "correction"
      ? "segmentation-corrector"
      : "segmentation";
  const promptPath = path.join(
    outDir,
    `${prefix}-prompt-${attemptLabel}.txt`
  );
  const responsePath = path.join(
    outDir,
    `${prefix}-response-${attemptLabel}.txt`
  );

  await writeTextSnapshot(promptPath, snapshot.prompt);
  await writeTextSnapshot(responsePath, snapshot.response);

  if (snapshot.thoughts && snapshot.thoughts.length > 0) {
    const thoughtsPath = path.join(
      outDir,
      `${prefix}-thoughts-${attemptLabel}.txt`
    );
    await writeTextSnapshot(thoughtsPath, snapshot.thoughts.join("\n---\n"));
  }

  progress.log(
    `[story] saved ${snapshot.phase} attempt ${snapshot.attempt} response to ${responsePath}`
  );
}

async function saveSegmentationCorrectorArtifacts(
  attempts: readonly SegmentationCorrectorAttempt[] | undefined,
  baseDir: string
): Promise<void> {
  if (!attempts || attempts.length === 0) {
    return;
  }

  await mkdir(baseDir, { recursive: true });

  for (const attempt of attempts) {
    const attemptLabel = formatAttemptLabel(attempt.attempt);
    const attemptDir = path.join(baseDir, attemptLabel);
    await mkdir(attemptDir, { recursive: true });
    await writeTextSnapshot(
      path.join(attemptDir, `prompt-${attemptLabel}.txt`),
      attempt.prompt
    );
    await writeTextSnapshot(
      path.join(attemptDir, `response-${attemptLabel}.txt`),
      attempt.rawResponse
    );
    if (attempt.response) {
      await writeJsonSnapshot(
        path.join(attemptDir, `parsed-${attemptLabel}.json`),
        attempt.response
      );
    }
    const metaPayload = {
      attempt: attempt.attempt,
      modelVersion: attempt.modelVersion,
      charCount: attempt.charCount ?? undefined,
      parseError: attempt.parseError ?? undefined,
    };
    await writeJsonSnapshot(
      path.join(attemptDir, `meta-${attemptLabel}.json`),
      metaPayload
    );
    if (attempt.parseError) {
      await writeTextSnapshot(
        path.join(attemptDir, `parse-error-${attemptLabel}.txt`),
        attempt.parseError
      );
    }
    if (attempt.thoughts && attempt.thoughts.length > 0) {
      await writeTextSnapshot(
        path.join(attemptDir, `thoughts-${attemptLabel}.txt`),
        attempt.thoughts.join("\n---\n")
      );
    }
  }
}

async function saveSegmentationArtifacts(
  result: StorySegmentationResult,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  const payload = {
    modelVersion: result.modelVersion,
    ...result.segmentation,
  };

  const jsonPath = path.join(outDir, "segments.json");
  await writeJsonSnapshot(jsonPath, payload);
  progress.log(`[story] saved segmentation JSON to ${jsonPath} (attempt ${result.attempt})`);

  const attemptLabel = formatAttemptLabel(result.attempt);
  const responseDir = path.join(outDir, "segmentation", "responses", attemptLabel);
  await writeJsonSnapshot(path.join(responseDir, `segments-${attemptLabel}.json`), payload);

  const promptPath = path.join(outDir, "segmentation-prompt.txt");
  await writeTextSnapshot(promptPath, result.prompt);
  const promptAttemptPath = path.join(outDir, `segmentation-prompt-${attemptLabel}.txt`);
  await writeTextSnapshot(promptAttemptPath, result.prompt);
  progress.log(`[story] saved segmentation prompt snapshot to ${promptPath} (attempt ${result.attempt})`);

  const correctorDir = path.join(outDir, "segmentation", "corrector");
  await saveSegmentationCorrectorArtifacts(
    result.correctionAttempts,
    correctorDir
  );
  if (result.correctionAttempts && result.correctionAttempts.length > 0) {
    progress.log(
      `[story] saved segmentation corrector artifacts to ${correctorDir}`
    );
  }
}

async function saveSegmentationFailureArtifacts(
  failure: SegmentationValidationError | SegmentationCorrectionError,
  outDir: string,
  progress: JobProgressReporter
): Promise<void> {
  if (failure instanceof SegmentationCorrectionError) {
    const correctorDir = path.join(outDir, "segmentation", "corrector");
    await saveSegmentationCorrectorArtifacts(failure.attempts, correctorDir);
    await mkdir(correctorDir, { recursive: true });
    const summaryPath = path.join(correctorDir, "failure-summary.json");
    const summaryPayload = {
      message: failure.message,
      attemptCount: failure.attempts.length,
    };
    await writeJsonSnapshot(summaryPath, summaryPayload);
    const rejectedPath = path.join(
      correctorDir,
      "rejected-segmentation.json"
    );
    await writeJsonSnapshot(rejectedPath, failure.segmentation);
    progress.log(
      `[story] saved segmentation corrector failure artifacts to ${correctorDir}`
    );
    return;
  }

  const attemptsDir = path.join(outDir, "segmentation-attempts");
  await mkdir(attemptsDir, { recursive: true });

  for (const attempt of failure.attempts) {
    const attemptLabel = formatAttemptLabel(attempt.attempt);
    const attemptDir = path.join(attemptsDir, attemptLabel);
    await mkdir(attemptDir, { recursive: true });
    await writeTextSnapshot(path.join(attemptDir, `prompt-${attemptLabel}.txt`), failure.prompt);
    await writeTextSnapshot(path.join(attemptDir, `response-${attemptLabel}.txt`), attempt.rawText);
    const payload = {
      attempt: attempt.attempt,
      modelVersion: attempt.modelVersion,
      errorMessage: attempt.errorMessage,
      zodIssues: attempt.zodIssues ?? undefined,
      thoughts: attempt.thoughts ?? undefined,
      elapsedMs: attempt.elapsedMs ?? undefined,
      charCount: attempt.charCount ?? undefined,
    };
    await writeJsonSnapshot(path.join(attemptDir, `meta-${attemptLabel}.json`), payload);
    if (attempt.thoughts && attempt.thoughts.length > 0) {
      await writeTextSnapshot(
        path.join(attemptDir, `thoughts-${attemptLabel}.txt`),
        attempt.thoughts.join("\n---\n"),
      );
    }
  }

  progress.log(`[story] saved invalid segmentation attempts to ${attemptsDir}`);
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
  result: StoryImagesResult & { artifacts?: StoryImagesArtifacts },
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

  // Extra artifacts: prompt snapshots per set and judge outcome
  if (result.artifacts) {
    const artifactsDir = path.join(assetsDir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });

    await writeFile(
      path.join(artifactsDir, "style.txt"),
      result.artifacts.style.join("\n"),
      { encoding: "utf8" }
    );
    await writeJsonSnapshot(
      path.join(artifactsDir, "selection.json"),
      { selectedSet: result.artifacts.selectedSet }
    );

    const setsDir = path.join(artifactsDir, "sets");
    await mkdir(setsDir, { recursive: true });
    for (const set of result.artifacts.sets) {
      const setDir = path.join(setsDir, set.label);
      await mkdir(setDir, { recursive: true });
      const promptText = (set.promptParts as Array<{ text?: string }>)
        .map((p) => p?.text ?? "")
        .filter(Boolean)
        .join("\n");
      if (promptText) {
        await writeTextSnapshot(path.join(setDir, "prompt.txt"), promptText);
      }
      if (set.aggregatedText.trim()) {
        await writeTextSnapshot(
          path.join(setDir, "text-response.txt"),
          set.aggregatedText.trim()
        );
      }
      await writeJsonSnapshot(
        path.join(setDir, "meta.json"),
        {
          modelVersion: set.modelVersion,
          imageCount: set.imageCount,
        }
      );
    }

    if (result.artifacts.judge) {
      const judgeDir = path.join(artifactsDir, "judge");
      await mkdir(judgeDir, { recursive: true });
      await writeTextSnapshot(
        path.join(judgeDir, "response.txt"),
        result.artifacts.judge.responseText
      );
      await writeJsonSnapshot(
        path.join(judgeDir, "response.json"),
        result.artifacts.judge.responseJson
      );
      await writeJsonSnapshot(
        path.join(judgeDir, "request.json"),
        {
          count: result.artifacts.judge.requestPartsCount,
          parts: result.artifacts.judge.requestPartsSanitised,
          modelVersion: result.artifacts.judge.modelVersion,
        }
      );
      if (
        result.artifacts.judge.thoughts &&
        result.artifacts.judge.thoughts.length > 0
      ) {
        await writeTextSnapshot(
          path.join(judgeDir, "thoughts.txt"),
          result.artifacts.judge.thoughts.join("\n---\n")
        );
      }
    }

    progress.log(`[story] saved image artifacts under ${artifactsDir}`);
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
            await cleanProseStage(outDir);
            await prepareProsePrompt(options.topic, outDir);
            progress.log("[story] prepared prose prompt snapshot");
            const storyResult = await generateProseStory(options.topic, progress);
            currentStory = {
              text: storyResult.text,
              prompt: storyResult.prompt,
              modelVersion: storyResult.modelVersion,
              topic: options.topic,
              thoughts: storyResult.thoughts,
            };
            segmentationResult = undefined;
            segmentation = undefined;
            segmentationLoadedFromDisk = false;
            await saveStoryArtifacts(storyResult, options.topic, outDir, progress);
            break;
          }
          case "segmentation": {
            const story = await ensureStory();
            await cleanSegmentationStage(outDir);
            await prepareSegmentationPrompt(story.text, outDir);
            progress.log("[story] prepared segmentation prompt snapshot");
            const snapshotSaver = async (
              snapshot: SegmentationAttemptSnapshot
            ): Promise<void> => {
              await saveSegmentationSnapshotArtifacts(
                snapshot,
                outDir,
                progress
              );
            };
            try {
              segmentationResult = await generateStorySegmentation(
                story.text,
                progress,
                {
                  onAttemptSnapshot: snapshotSaver,
                }
              );
              segmentation = segmentationResult.segmentation;
              await saveSegmentationArtifacts(
                segmentationResult,
                outDir,
                progress
              );
            } catch (error) {
              if (
                error instanceof SegmentationValidationError ||
                error instanceof SegmentationCorrectionError
              ) {
                await saveSegmentationFailureArtifacts(
                  error,
                  outDir,
                  progress
                );
              }
              throw error;
            }
            break;
          }
          case "audio": {
            const segments =
              segmentationResult?.segmentation ?? (await ensureSegmentation());
            segmentation = segments;
            await cleanAudioStage(outDir);
            await prepareAudioInputs(segments, outDir);
            progress.log("[story] prepared audio input snapshot");
            await saveAudioArtifacts(segments, outDir, progress);
            break;
          }
          case "images": {
            const segments =
              segmentationResult?.segmentation ?? (await ensureSegmentation());
            segmentation = segments;
            await cleanImagesStage(outDir);
            await prepareImagesPrompt(segments, outDir);
            progress.log("[story] prepared image prompt snapshot");
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
