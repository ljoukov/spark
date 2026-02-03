import { spawn } from "node:child_process";
import { z } from "zod";

type RunProcessResult = {
  stdout: string;
  stderr: string;
};

async function runProcess(
  command: string,
  args: string[],
): Promise<RunProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const suffix = stderr ? `\n${stderr.trim()}` : "";
      reject(
        new Error(
          `Command failed (${command} ${args.join(" ")}): exit ${code}${suffix}`,
        ),
      );
    });
  });
}

export async function createSilentAudio({
  durationSec,
  sampleRate,
  channels,
  fileName,
}: {
  durationSec: number;
  sampleRate: number;
  channels: 1 | 2;
  fileName: string;
}) {
  const channelLayout: "mono" | "stereo" = (() => {
    switch (channels) {
      case 1:
        return "mono";
      case 2:
        return "stereo";
    }
  })();
  await runProcess("ffmpeg", [
    "-f",
    "lavfi",
    "-i",
    `anullsrc=channel_layout=${channelLayout}:sample_rate=${sampleRate}`,
    "-t",
    durationSec.toFixed(4),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    fileName,
  ]);
}

export type AudioDetails = {
  totalSamples: number;
  sampleRate: number;
  channels: 1 | 2;
  durationSec: number;
};

export async function getAudioDetails(filePath: string): Promise<AudioDetails> {
  const [metadata, totalSamples] = await Promise.all([
    getStreamMetadata(filePath),
    getTotalSamples(filePath),
  ]);
  const durationSec = totalSamples / metadata.sampleRate;
  return {
    ...metadata,
    totalSamples,
    durationSec,
  };
}

export const streamMetadataSchema = z.object({
  sampleRate: z.number().int().positive(),
  channels: z.union([z.literal(1), z.literal(2)]),
  bitRate: z.number().int().positive(),
});

async function getStreamMetadata(filePath: string) {
  const { stdout } = await runProcess("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,channels,bit_rate",
    "-of",
    "default=noprint_wrappers=1",
    filePath,
  ]);

  const metadata: Record<string, string> = {};
  stdout.split("\n").forEach((line) => {
    const [key, value] = line.split("=");
    if (key && value) {
      metadata[key] = value;
    }
  });

  return streamMetadataSchema.parse({
    sampleRate: parseInt(metadata.sample_rate),
    channels: parseInt(metadata.channels),
    bitRate: parseInt(metadata.bit_rate),
  });
}

async function getTotalSamples(filePath: string): Promise<number> {
  const { stdout } = await runProcess("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_frames",
    "-show_entries",
    "frame=nb_samples",
    "-of",
    "default=noprint_wrappers=1",
    filePath,
  ]);

  let totalSamples = 0;
  stdout.split("\n").forEach((line) => {
    const [key, value] = line.split("=");
    if (key === "nb_samples" && value) {
      totalSamples += parseInt(value, 10);
    }
  });

  return totalSamples;
}

export async function concatAudio({
  listFileName,
  sampleRate,
  channels,
  outputFileName,
}: {
  listFileName: string;
  sampleRate: number;
  channels: 1 | 2;
  outputFileName: string;
}) {
  await runProcess("ffmpeg", [
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listFileName,
    "-ar",
    sampleRate.toString(),
    "-ac",
    channels.toString(),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "192k",
    outputFileName,
  ]);
}
