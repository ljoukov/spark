import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GoogleTextToSpeechClient,
  type SynthesizeAudioEncoding,
} from "@spark/llm/utils/googleTextToSpeechClient";
import { z } from "zod";

import { createCliCommand } from "../utils/cli";
import { ensureEvalEnvLoaded, WORKSPACE_PATHS } from "../utils/paths";

type CliOptions = {
  voice: string;
  locale: string;
  encoding: SynthesizeAudioEncoding;
  text: string;
};

const EncodingSchema = z.enum(["MP3", "OGG_OPUS", "LINEAR16"]);

const CliOptionsSchema = z.object({
  voice: z.string().min(1, "Voice is required"),
  locale: z.string().trim().min(2, "Locale must be a valid BCP-47 code"),
  encoding: EncodingSchema,
  text: z.string().min(1, "Text to synthesize is required"),
});

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "tts:say",
    "Synthesize text to speech and save it under spark-data/tts/synthetic",
  );

  program
    .requiredOption("-v, --voice <name>", "Voice name (e.g. en-GB-Chirp3-HD-Achernar)")
    .option("-l, --locale <code>", "Voice locale/language code", "en-GB")
    .option(
      "-e, --encoding <encoding>",
      "Audio encoding (MP3 | OGG_OPUS | LINEAR16)",
      "MP3",
    )
    .argument("<text...>", "Text to synthesize");

  const parsed = program.parse(argv, { from: "node" });
  const opts = parsed.opts<{
    voice: string;
    locale: string;
    encoding: string;
  }>();
  const textParts = parsed.args as string[];
  const text = textParts.join(" ").trim();

  return CliOptionsSchema.parse({
    voice: opts.voice,
    locale: opts.locale,
    encoding: opts.encoding,
    text,
  });
}

function buildOutputPath({
  encoding,
  voice,
  text,
  now = new Date(),
}: {
  encoding: SynthesizeAudioEncoding;
  voice: string;
  text: string;
  now?: Date;
}): { absolutePath: string; relativePath: string } {
  const extension = (() => {
    switch (encoding) {
      case "MP3":
        return "mp3";
      case "OGG_OPUS":
        return "ogg";
      case "LINEAR16":
        return "wav";
    }
  })();
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  const normalisedVoice = voice
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const timestamp = now.toISOString().replaceAll(":", "").replaceAll("-", "").replaceAll(".", "");
  const outputDir = path.join(WORKSPACE_PATHS.sparkDataRoot, "tts", "synthetic");
  const fileName = `${normalisedVoice}-${hash}-${timestamp}.${extension}`;
  const absolutePath = path.join(outputDir, fileName);
  const relativePath = path.relative(process.cwd(), absolutePath);
  return { absolutePath, relativePath };
}

async function main(argv: readonly string[]): Promise<void> {
  ensureEvalEnvLoaded();
  const options = parseCliOptions(argv);
  const client = new GoogleTextToSpeechClient();

  const { absolutePath, relativePath } = buildOutputPath({
    encoding: options.encoding,
    voice: options.voice,
    text: options.text,
  });
  await mkdir(path.dirname(absolutePath), { recursive: true });

  const { audio, audioConfig } = await client.synthesize({
    text: options.text,
    voice: {
      languageCode: options.locale,
      name: options.voice,
    },
    audioConfig: {
      audioEncoding: options.encoding,
    },
  });

  await writeFile(absolutePath, audio);

  const metadata: Record<string, unknown> = {
    bytesWritten: audio.byteLength,
    encoding: audioConfig?.audioEncoding ?? options.encoding,
    sampleRateHertz: audioConfig?.sampleRateHertz ?? null,
    speakingRate: audioConfig?.speakingRate ?? null,
    pitch: audioConfig?.pitch ?? null,
  };

  console.log(
    JSON.stringify(
      {
        output: relativePath,
        voice: options.voice,
        locale: options.locale,
        metadata,
      },
      null,
      2,
    ),
  );
}

void main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
