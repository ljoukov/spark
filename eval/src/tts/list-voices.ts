import { GoogleTextToSpeechClient } from "@spark/llm/utils/googleTTS";
import { z } from "zod";

import { createCliCommand } from "../utils/cli";
import { ensureEvalEnvLoaded } from "../utils/paths";

type CliOptions = {
  locale: string;
  json: boolean;
  filter?: string;
};

const CliOptionsSchema = z.object({
  locale: z
    .string()
    .trim()
    .min(2, "Locale must be a valid BCP-47 language code")
    .default("en-GB"),
  json: z.boolean().default(false),
  filter: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : undefined))
    .default("Chirp3-HD"),
});

function parseCliOptions(argv: readonly string[]): CliOptions {
  const program = createCliCommand(
    "tts:list-voices",
    "List available Google Cloud Text-to-Speech voices",
  );

  program
    .option(
      "-l, --locale <locale>",
      "BCP-47 language code used to filter voices",
      "en-GB",
    )
    .option("--filter <text>", "Substring filter applied to voice names", "Chirp3-HD")
    .option("--json", "Output the raw response as JSON");

  const parsed = program.parse(argv, { from: "node" }).opts<{
    locale?: string;
    json?: boolean;
    filter?: string;
  }>();

  const { locale, json, filter } = CliOptionsSchema.parse({
    locale: parsed.locale,
    json: parsed.json,
    filter: parsed.filter,
  });

  return { locale, json, filter };
}

async function main(argv: readonly string[]): Promise<void> {
  ensureEvalEnvLoaded();
  const options = parseCliOptions(argv);
  const client = new GoogleTextToSpeechClient();

  const voices = await client.listVoices({
    languageCode: options.locale,
  });

  const filteredVoices =
    options.filter === undefined
      ? voices
      : voices.filter((voice) =>
          voice.name.toLowerCase().includes(options.filter!.toLowerCase()),
        );

  const genderGroups = new Map<string, string[]>();
  for (const voice of filteredVoices) {
    const gender = (voice.ssmlGender ?? "UNSPECIFIED").toUpperCase();
    const voicesForGender = genderGroups.get(gender) ?? [];
    voicesForGender.push(voice.name);
    genderGroups.set(gender, voicesForGender);
  }

  for (const voicesForGender of genderGroups.values()) {
    voicesForGender.sort((a, b) => a.localeCompare(b));
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          locale: options.locale,
          voices: filteredVoices,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (filteredVoices.length === 0) {
    console.log(
      `No voices available for locale ${options.locale}${
        options.filter ? ` matching "${options.filter}"` : ""
      }`,
    );
    return;
  }

  const headerParts = [
    `Voices for ${options.locale}`,
    options.filter ? `filter "${options.filter}"` : null,
    `(${filteredVoices.length} found)`,
  ]
    .filter((value): value is string => value !== null)
    .join(" ");
  console.log(headerParts);

  const genders = Array.from(genderGroups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  for (const [gender, voicesForGender] of genders) {
    console.log(`${gender} (${voicesForGender.length})`);
    for (const voiceName of voicesForGender) {
      console.log(`  ${voiceName}`);
    }
  }
}

void main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
