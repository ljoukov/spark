// Script: generateTestAudio.ts
// Purpose: Produce mock audio transcripts (intro/outro) for the DP test session
// Output: Generates audio files and prints slides with narration timelines.

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  MediaSegment,
  generateSessionAudio,
  type AudioGenerationProgress,
  generateAudioFromSegments,
} from "@spark/llm";
import {
  ensureEvalEnvLoaded,
  WORKSPACE_PATHS,
} from "../../utils/paths";

const SMALL_MODE_FLAG = "--small";
const KEEP_OUTPUT_FLAG = "--keepOutput";
const TTS_ONLY_FLAG = "--ttsOnly";

function buildIntro(): MediaSegment[] {
  const segments: MediaSegment[] = [
    {
      slide: "# Dynamic Programming\nBreak · Store · Reuse",
      narration: [
        {
          speaker: "m",
          text:
            "Welcome. Today’s session builds practical intuition for dynamic programming: breaking problems into smaller pieces, storing answers, and reusing them to avoid repeated work.",
        },
        {
          speaker: "f",
          text:
            "Think of it like LEGO: once you’ve built a sturdy mini‑module, you don’t rebuild it—you snap it in again whenever you need that shape.",
        },
      ],
    },
    {
      slide: "### A short story\nRichard Bellman, 1950s",
      narration: [
        {
          speaker: "m",
          text:
            "The term ‘dynamic programming’ dates to the 1950s. Richard Bellman used ‘programming’ in the classical sense of planning, and ‘dynamic’ to emphasize decisions unfolding over stages.",
        },
        {
          speaker: "f",
          text:
            "The big idea stuck because it solves real problems—from routing and scheduling to bioinformatics. Reusing partial answers beats starting from scratch.",
        },
      ],
    },
    {
      slide: "### Core intuition\nOverlapping subproblems",
      narration: [
        {
          speaker: "m",
          text:
            "DP pays off when the same small question appears repeatedly. We capture a clear ‘state’, define base cases, and ensure each state is solved once.",
        },
        {
          speaker: "f",
          text:
            "It’s like hiking with cairns. Mark each tricky fork once, then every traveler benefits from that marker without re‑exploring the whole trail.",
        },
      ],
    },
    {
      slide: "### Two friendly styles\nMemoization vs. Tabulation",
      narration: [
        {
          speaker: "m",
          text:
            "Top‑down memoization caches answers to recursive calls. Bottom‑up tabulation fills a small table from simple to harder cases. Both reuse results; only the direction differs.",
        },
        {
          speaker: "f",
          text:
            "Memoization feels like asking a friend, ‘Have we seen this exact puzzle?’ Tabulation is packing your bag in order—socks before shoes—so each step is ready for the next.",
        },
      ],
    },
    {
      slide: "### Today’s path\nWarm‑up → Ideas → Practice",
      narration: [
        {
          speaker: "m",
          text:
            "We’ll start with a warm‑up quiz, review two idea cards, then practice with Coin Change (combinations) and Decode Ways (string DP). A final review locks it in.",
        },
        {
          speaker: "f",
          text:
            "You’ll see the same rhythm: define the state, set tiny base cases, and write a transition that reuses what you already know.",
        },
      ],
    },
    {
      slide: "### Two examples\nCoin Change · Decode Ways",
      narration: [
        {
          speaker: "m",
          text:
            "In Coin Change, we count combinations by iterating coins on the outside so order doesn’t inflate the count. In Decode Ways, we step through a string and combine 1‑ and 2‑digit choices while handling zeros carefully.",
        },
        {
          speaker: "f",
          text:
            "If Coin Change is arranging bills to reach a total, Decode Ways is reading a secret note where characters can pair up. The table keeps both stories consistent.",
        },
      ],
    },
  ];

  return segments;
}

function buildOutro(): MediaSegment[] {
  const segments: MediaSegment[] = [
    {
      slide: "## Wrap‑up\nDP in one breath",
      narration: [
        {
          speaker: "m",
          text:
            "DP is about naming the state, anchoring with base cases, and reusing computed answers via a memo or table. Today you applied that to Coin Change and Decode Ways.",
        },
        {
          speaker: "f",
          text:
            "Keep the mental checklist: What’s the state? What’s the tiniest known answer? How do small answers compose into the next one?",
        },
      ],
    },
    {
      slide: "### What sticks\nHabits, not formulas",
      narration: [
        {
          speaker: "m",
          text:
            "Spot overlapping subproblems early. Prefer clear states and minimal memory. Choose memoization or tabulation for clarity—both are valid.",
        },
        {
          speaker: "f",
          text:
            "Like organizing tools in a small box: only keep what you reach for. The structure makes the next fix faster.",
        },
      ],
    },
    {
      slide: "### Next steps\nPractice and explore",
      narration: [
        {
          speaker: "m",
          text:
            "When you’re ready, try more DP patterns—stairs and grids, LIS, or knapsack. Short, focused reps will cement the skill.",
        },
        {
          speaker: "f",
          text:
            "One more small session now beats a long one later. See you in the next lesson.",
        },
      ],
    },
  ];

  return segments;
}

function buildSmallIntro(): MediaSegment[] {
  return [
    {
      slide: "## Quick Peek\nDynamic Programming",
      narration: [
        { speaker: "m", text: "Quick hello—this is the fast DP preview." },
        { speaker: "f", text: "We’ll hit two beats so you hear the rhythm." },
        {
          speaker: "m",
          text: "Remember: break problems, store answers, reuse them.",
        },
      ],
    },
    {
      slide: "### Two beats\nPlan → payoff",
      narration: [
        {
          speaker: "f",
          text: "Think of a sticky note you reuse instead of rewriting steps.",
        },
        {
          speaker: "m",
          text: "After this clip, jump into the drills and keep that energy.",
        },
      ],
    },
  ];
}

function buildSmallOutro(): MediaSegment[] {
  return [
    {
      slide: "## Quick Wrap\nDP recap",
      narration: [
        { speaker: "m", text: "Nice work on the quick tour—you heard the DP heartbeat." },
        { speaker: "f", text: "Break, store, reuse. Keep that tripod in mind." },
        {
          speaker: "m",
          text: "Take a breath and lock in one takeaway before you leave.",
        },
      ],
    },
    {
      slide: "### Next Up\nKeep rolling",
      narration: [
        {
          speaker: "f",
          text: "Try one short quiz while the story is still warm.",
        },
        {
          speaker: "m",
          text: "See you back for the full session when you have a moment.",
        },
      ],
    },
  ];
}

function getIntroSegments(isSmall: boolean): MediaSegment[] {
  return isSmall ? buildSmallIntro() : buildIntro();
}

function getOutroSegments(isSmall: boolean): MediaSegment[] {
  return isSmall ? buildSmallOutro() : buildOutro();
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  if (unitIndex === -1) {
    return `${Math.round(value)} B`;
  }
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatTimestamp(seconds: number): string {
  const totalMilliseconds = Math.round(seconds * 1000);
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const millis = totalMilliseconds % 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}.${Math.floor(millis / 10)
    .toString()
    .padStart(2, "0")}`;
}

async function ensureOutputDir(): Promise<string> {
  const dir = WORKSPACE_PATHS.codeAudioDir;
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function createConsoleProgress(label: string): AudioGenerationProgress {
  const startTime = Date.now();
  return {
    onStart({ totalSegments }) {
      console.log(
        `[${label}] Starting audio generation for ${totalSegments} segments (parallel launch)`,
      );
    },
    onSegmentStart({ index, totalSegments, speaker, activeCount, textPreview }) {
      const preview = textPreview.length > 60 ? `${textPreview.slice(0, 57)}…` : textPreview;
      console.log(
        `[${label}] ▶ Segment ${index + 1}/${totalSegments} (${speaker}) started • active ${activeCount}`,
      );
      if (preview.length > 0) {
        console.log(`[${label}]    text preview: ${preview}`);
      }
    },
    onSegmentChunk({ index, chunkBytes, totalBytes, activeCount, totalSegments }) {
      console.log(
        `[${label}]    segment ${index + 1}/${totalSegments} +${formatBytes(chunkBytes)} (cum ${formatBytes(totalBytes)}) • active ${activeCount}`,
      );
    },
    onSegmentComplete({ index, totalSegments, durationSec, totalBytes, activeCount }) {
      console.log(
        `[${label}] ✔ Segment ${index + 1}/${totalSegments} finished ${formatTimestamp(durationSec)} (${formatBytes(totalBytes)}) • active now ${activeCount}`,
      );
    },
    onComplete({ totalSegments, totalBytes, totalDurationSec }) {
      const wallSeconds = (Date.now() - startTime) / 1000;
      console.log(
        `[${label}] ✅ Completed ${totalSegments} segments • audio ${formatTimestamp(totalDurationSec)} • size ${formatBytes(totalBytes)} • wall ${formatTimestamp(wallSeconds)}`,
      );
    },
  } satisfies AudioGenerationProgress;
}

function printTimeline(
  label: string,
  segments: MediaSegment[],
  result: Awaited<ReturnType<typeof generateSessionAudio>>,
): void {
  console.log(
    `\n=== ${label.toUpperCase()} (${segments.length} slides • ${formatTimestamp(result.totalDurationSec)} • ${formatBytes(result.totalBytes)}) ===`,
  );
  const lineStarts: number[] = [];
  let totalLines = 0;
  for (const segment of segments) {
    lineStarts.push(totalLines);
    totalLines += segment.narration.length;
  }
  for (let i = 0; i < segments.length; i++) {
    const slide = segments[i];
    const start = result.slideOffsets[i] ?? 0;
    const duration = result.slideDurations[i] ?? 0;
    const end = start + duration;
    console.log(`\nSlide ${i + 1}: ${formatTimestamp(start)} → ${formatTimestamp(end)}`);
    console.log("Slide markdown:");
    console.log(slide.slide);
    console.log("Narration:");
    for (const [lineIndex, line] of slide.narration.entries()) {
      const speaker = line.speaker === "m" ? "M" : "F";
      const globalIndex = (lineStarts[i] ?? 0) + lineIndex;
      const lineOffset = result.lineOffsets[globalIndex] ?? 0;
      const lineDuration = result.lineDurations[globalIndex] ?? 0;
      const text = line.text;
      console.log(
        `- ${speaker} @ ${formatTimestamp(lineOffset)} (+${formatTimestamp(lineDuration)}): ${text}`,
      );
    }
  }

  console.log(`\nAudio saved to: ${result.outputFilePath}`);
  console.log(`${label} JSON:`);
  console.log(JSON.stringify(segments, null, 2));
  console.log(`${label} timeline:`);
  console.log(
    JSON.stringify(
      {
        slideOffsets: result.slideOffsets,
        slideDurations: result.slideDurations,
        lineOffsets: result.lineOffsets,
        lineDurations: result.lineDurations,
      },
      null,
      2,
    ),
  );
  console.log(`${label} audio size (approx): ${formatBytes(result.totalBytes)}`);
}

async function main(): Promise<void> {
  ensureEvalEnvLoaded();
  const args = process.argv.slice(2);
  const isSmall = args.includes(SMALL_MODE_FLAG);
  const keepOutput = args.includes(KEEP_OUTPUT_FLAG);
  const ttsOnly = args.includes(TTS_ONLY_FLAG);

  if (isSmall) {
    console.log("Running in --small mode: 2 slides with 3 + 2 short narration lines.");
  }
  if (keepOutput) {
    console.log("--keepOutput enabled: segment audio files will be kept for review.");
  }
  if (ttsOnly) {
    console.log("--ttsOnly enabled: generating a single 'hello world' clip.");
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GEMINI_API_KEY is not set. Please provide it before generating audio.");
  }
  const outputDir = await ensureOutputDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const segmentsRoot = keepOutput
    ? path.join(outputDir, `segments-${isSmall ? "small" : "full"}-${timestamp}`)
    : undefined;

  if (ttsOnly) {
    await runTtsOnly({ outputDir, timestamp, keepOutput, segmentsRoot });
    return;
  }

  const intro = getIntroSegments(isSmall);
  const outro = getOutroSegments(isSmall);

  const introResult = await generateSessionAudio({
    segments: intro,
    outputFilePath: path.join(
      outputDir,
      isSmall ? "test-session-intro-small.mp3" : "test-session-intro.mp3",
    ),
    progress: createConsoleProgress("Intro"),
    persistSegmentsDir: segmentsRoot ? path.join(segmentsRoot, "intro") : undefined,
  });

  printTimeline("Intro", intro, introResult);
  if (keepOutput && introResult.segmentFiles.length > 0) {
    console.log("Intro segment files kept at:");
    for (const filePath of introResult.segmentFiles) {
      console.log(`  ${filePath}`);
    }
  }

  const outroResult = await generateSessionAudio({
    segments: outro,
    outputFilePath: path.join(
      outputDir,
      isSmall ? "test-session-outro-small.mp3" : "test-session-outro.mp3",
    ),
    progress: createConsoleProgress("Outro"),
    persistSegmentsDir: segmentsRoot ? path.join(segmentsRoot, "outro") : undefined,
  });

  printTimeline("Outro", outro, outroResult);
  if (keepOutput && outroResult.segmentFiles.length > 0) {
    console.log("Outro segment files kept at:");
    for (const filePath of outroResult.segmentFiles) {
      console.log(`  ${filePath}`);
    }
  }
}

async function runTtsOnly({
  outputDir,
  timestamp,
  keepOutput,
  segmentsRoot,
}: {
  outputDir: string;
  timestamp: string;
  keepOutput: boolean;
  segmentsRoot?: string;
}): Promise<void> {
  const fileName = `tts-hello-world-${timestamp}.mp3`;
  const outputFilePath = path.join(outputDir, fileName);
  const persistDir = keepOutput
    ? path.join(segmentsRoot ?? path.join(outputDir, `segments-tts-${timestamp}`), "tts")
    : undefined;

  const result = await generateAudioFromSegments({
    segments: [{ speaker: "m", text: "hello world" }],
    outputFilePath,
    progress: createConsoleProgress("TTS"),
    persistSegmentsDir: persistDir,
  });

  console.log(`TTS audio saved to: ${result.outputFilePath}`);
  console.log(`Duration: ${formatTimestamp(result.totalDurationSec)} | Size: ${formatBytes(result.totalBytes)}`);
  if (keepOutput && result.segmentFiles.length > 0) {
    console.log("TTS segment file kept at:");
    for (const filePath of result.segmentFiles) {
      console.log(`  ${filePath}`);
    }
  }
}

main().catch((error) => {
  console.error("Failed to generate test audio", error);
  process.exit(1);
});
