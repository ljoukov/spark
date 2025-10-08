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
      slide: "# Toggle Truth\nBell Labs Origins",
      narration: [
        {
          speaker: "m",
          text:
            "Bell Labs, summer 1947. Richard Hamming is a young mathematician whose programs keep dying on the relay computer every weekend. The card reader flags “bad data,” then quits. Days of work are lost. He wants the machine not just to complain, but to rescue the result.",
        },
        {
          speaker: "f",
          text:
            "Picture a long line of light switches, one for each binary digit. A one flips its switch, a zero leaves it alone. At the end you peek: is the final lamp on or off? That on-ness is called parity. It’s the odd-or-even mood of the bits.",
        },
      ],
    },
    {
      slide: "## XOR Intuition\nFlip Once, Notice Twice",
      narration: [
        {
          speaker: "m",
          text:
            "He leans on XOR—exclusive OR, a bitwise rule that compares two bits and outputs one when they differ and zero when they match. Bitwise means it works one digit at a time. XOR is perfect for parity because flipping twice cancels and order doesn’t matter.",
        },
        {
          speaker: "f",
          text:
            "Tiny example. Data is one, zero, one, one. Flip, don’t, flip, flip. Three flips end with the lamp on, so we attach one extra bit that makes the total flips even. Send the data and that helper bit together.",
        },
      ],
    },
    {
      slide: "## Weekend Constraints\nNo Second Chances",
      narration: [
        {
          speaker: "m",
          text:
            "The constraint was brutal: reruns cost days, machines were scarce, and operators wouldn’t babysit errors. Naïve fixes like sending everything twice waste time and still miss some faults.",
        },
        {
          speaker: "f",
          text:
            "The mini recipe is simple. First, compute the parity with XOR as you stream the bits. Second, ship the data plus that parity bit. Third, on the other end, recompute and compare; if the mood doesn’t match, you caught a slip.",
        },
      ],
    },
  ];

  return segments;
}

function buildOutro(): MediaSegment[] {
  const segments: MediaSegment[] = [
    {
      slide: "## Why It Works\nParity Invariant",
      narration: [
        {
          speaker: "m",
          text:
            "The why is an invariant in plain words: flipping the same switch twice undoes itself. Therefore any single-bit slip always shows up as the wrong mood at the end.",
        },
        {
          speaker: "f",
          text:
            "Contrast time. OR only turns lamps on and can’t notice a lost one. Regular addition drags in carries and order; the odd-even mood gets muddied.",
        },
      ],
    },
    {
      slide: "## Legacy\nFrom Hamming Codes Onward",
      narration: [
        {
          speaker: "m",
          text:
            "Hamming pushed further to codes that could locate and fix the bad bit. In 1950 he published them, and they spread to memory chips, disks, and deep-space links.",
        },
        {
          speaker: "f",
          text:
            "Memorable line? Flip twice, get back. Outcome? Hamming turned weekend failures into reliable computing, and XOR became the quiet hero behind it.",
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
