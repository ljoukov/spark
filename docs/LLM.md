# LLM Utilities (packages/llm/src/utils/llm.ts)

This module provides thin wrappers around Gemini + OpenAI Responses streaming to make it easy to:
- Send prompts as structured parts (text, inline data)
- Stream responses (text, image) while reporting progress
- Validate JSON responses with Zod
- Capture debug snapshots of prompts and responses

It is used across eval tools and session generators.

## Public API

- `generateText(options): Promise<string>`
  - Streams a text response and returns the final concatenated text.
- `runLlmImageCall(options): Promise<Array<{ mimeType?: string; data: Buffer }>>`
  - Streams images (and optional text) and returns image buffers.
- `generateImages(options): Promise<Array<{ mimeType?: string; data: Buffer }>>`
  - Attempts to produce one image per entry in `imagePrompts`, retrying remaining prompts up to four attempts and grading each candidate with `gemini-flash-latest` (JSON pass/fail) using the supplied `imageGradingPrompt`.
- `generateJson<T>(options): Promise<T>`
  - Like `generateText` but parses and validates the final text as JSON via a Zod schema. Retries up to `maxAttempts`.
- `tool(options): LlmExecutableTool`
  - Defines a callable tool with a Zod input schema and async execution handler.
- `runToolLoop(options): Promise<LlmToolLoopResult>`
  - Runs an agentic loop that lets the model call tools, validates inputs with Zod, executes tools in TS, and feeds results back until a final text answer is produced.

### Shared options

All calls accept:
- `modelId`: text model (Gemini or OpenAI) or image model (`gemini-3-pro-image-preview`).
- `contents`: ordered array of `{ role: 'user' | 'model' | 'system' | 'tool'; parts: LlmContentPart[] }` representing the conversation you want to send to Gemini. Each part can be:
  - `{ type: 'text', text: string, thought?: boolean }`
  - `{ type: 'inlineData', data: string, mimeType?: string }` (base64 preferred)
- `progress?`: `JobProgressReporter` (see below). If omitted, a concise fallback logger is used.
- `debug?`: `{ rootDir: string; stage?: string; subStage?: string; attempt?: number|string; enabled?: boolean }`
- Optional generation controls:
  - `responseMimeType?`, `responseJsonSchema?` (text/JSON)
  - `responseModalities?` (e.g. `["IMAGE","TEXT"]`); images default to `["IMAGE","TEXT"]`
  - `imageAspectRatio?`
  - `tools?`: `{ type: 'web-search' }` and `{ type: 'code-execution' }` (mapped to Google Search / OpenAI web search + code interpreter)

OpenAI model routing:
- `gpt-5.2`, `gpt-5.2-codex` → OpenAI API.
- `chatgpt-gpt-5.2`, `chatgpt-gpt-5.2-codex` → ChatGPT Codex backend (OAuth).

### JSON convenience

`generateJson` adds:
- `schema`: `z.ZodSchema<T>`
- `responseJsonSchema`: JSON Schema definition applied at request time (required). Use `toGeminiJsonSchema()` to convert existing Google `Schema` definitions.
- `maxAttempts?`: default `2` (will re-prompt using the same options)
- Responses are automatically requested as `application/json` and parsed before validation.

When `modelId` is an OpenAI model, `generateJson` enables Structured Outputs by sending
`text.format` with a JSON Schema derived from `responseJsonSchema` (normalized to require all fields and `additionalProperties: false` for OpenAI compliance).
The response text is still parsed and validated with the supplied Zod schema.

Avoid adding manual instructions such as “Return strict JSON …” in prompts. Passing the `schema` and `responseJsonSchema` is sufficient for Gemini to emit structured output. If a field needs extra guidance, add a `description` on the schema property instead, and use `propertyOrdering` so any thinking/reasoning fields come before the final answer fields.

When you need to explain the expected shape inside a prompt, describe it in clear prose (sections, fields, and intent) rather than pasting raw JSON schemas or example skeletons. The schema definitions live in code; prompts should only outline the requirements at a conceptual level.

## Tool Loop (Custom Function Calling)

`runToolLoop` accepts either a `prompt` string (plus optional `systemPrompt`) or explicit `contents`. Tools are defined via `tool({ inputSchema, execute })`. Tool calls are validated with Zod, and any errors are returned to the model as `{ error, issues? }` so it can repair the call.

Defaults:
- `maxSteps`: 8 (override if a longer chain is expected)

OpenAI function tools are sent with `strict: true` and a normalized JSON schema. Gemini uses `FunctionCallingConfigMode.VALIDATED` with JSON schema + `propertyOrdering`.
ChatGPT Codex routing (`chatgpt-` model IDs) supports the same function tools, but built-in `tools: [{ type: "web-search" | "code-execution" }]` are only supported via the OpenAI API provider.

Example:

```ts
import { runToolLoop, tool } from "./llm";
import { z } from "zod";

const tools = {
  weather: tool({
    description: "Get the weather in Fahrenheit",
    inputSchema: z.object({
      location: z.string().describe("Location to fetch weather for"),
    }),
    execute: async ({ location }) => ({
      location,
      temperatureF: 68,
    }),
  }),
  convertFahrenheitToCelsius: tool({
    description: "Convert Fahrenheit to Celsius",
    inputSchema: z.object({
      temperatureF: z.number(),
    }),
    execute: ({ temperatureF }) => ({
      celsius: Math.round((temperatureF - 32) * (5 / 9)),
    }),
  }),
};

const result = await runToolLoop({
  modelId: "gpt-5.2",
  prompt:
    "Use the tools to get the San Francisco weather in celsius. " +
    "Call weather first, then convertFahrenheitToCelsius.",
  tools,
  maxSteps: 6,
});

console.log(result.text);
console.log(result.steps);
```

## Progress and Metrics

The wrappers report per-call usage to a `JobProgressReporter`:
- `startModelCall({ modelId, uploadBytes, imageSize? })` begins a call
- `recordModelUsage(handle, { prompt?, response?, thinking?, tokens?, modelVersion? })` records streaming deltas and final usage metadata
- `finishModelCall(handle)` ends a call

`recordModelUsage` accepts:
- `prompt`: `{ textChars?, imageCount?, imageBytes? }`
- `response`: `{ textCharsDelta?, imageCountDelta?, imageBytesDelta? }`
- `thinking`: `{ textCharsDelta? }`
- `tokens`: `{ promptTokens?, cachedTokens?, responseTokens?, responseImageTokens?, thinkingTokens?, totalTokens?, toolUsePromptTokens? }`
- `modelVersion?`: the resolved Gemini model version for the call

The default reporter aggregates across all calls and renders a single line that lists active stages plus any non-zero totals (prompt/res/thinking stats, images and bytes, tokens, cost, and the unique models seen). Example:

`[label] stages: narration, frames | prompt: 8,400 chars, 6 imgs (1.2MB), 9,200 tok | thinking: 2,500 chars, 2,700 tok | response: 7,100 chars, 10 imgs (3.5MB), 6,800 tok | cost: $0.34 | models: gemini-3-pro-preview, gemini-3-pro-image-preview`

Notes:
- Thinking tokens are reported separately (text and tokens) and are included in the final cost calculation. Visible response text still determines the returned value from `generateText`.
- OpenAI reasoning tokens are reported as `thinking` in logs/metrics.
- Zero-value stats are omitted from the status line to keep it readable.

## ChatGPT Codex Provider (OAuth)

When `modelId` starts with `chatgpt-`, OpenAI model calls are routed through the ChatGPT Codex backend using OAuth credentials stored as:

```
~/.spark/chatgpt-auth.json
```

The stored payload includes `{ access, refresh, expires, accountId }` and may also include `id_token` when available from the OAuth exchange.

Run the helper to complete the browser-based OAuth flow and write the auth file:

```
npm --prefix eval run auth:chatgpt
```

## Debug Snapshots (Prompts and Responses)

If `debug.rootDir` is provided, each call writes snapshots under:

```
{rootDir}/{stage}/{subStage?}/{attempt?}/
```

- `stage` defaults to the `modelId` unless explicitly set via `debug.stage`.
- `attempt` is appended if provided; for `generateJson`, the attempt number (1-based) is automatically passed to the underlying stream.
- The target directory is cleared (recursively) before writing new snapshots so stale files from earlier runs never linger.

Generated files:
- `request.txt`: A metadata snapshot of the outbound request (model ID, attempt counters, estimated upload bytes, and the Gemini config JSON).
- `prompt.txt`: A human-readable listing of request parts (text content and inline-data byte counts).
- `response.txt`: Summary header (model + elapsed + token counts + input/output media stats + estimated cost) followed by:
  - “===== Response =====” with concatenated text (for image calls this may be empty or include accompanying text)
  - “===== Content =====” with a structured dump of the final parts when available. Inline image entries now include a short six-character SHA in the header so you can match parts with filenames.
- Prompt inline images are converted to JPEG when possible and stored once under `{rootDir}/media/{sha256}.jpg`. For convenience, a symlink named `prompt-image-001.jpg` (incrementing per prompt) is placed inside each debug directory pointing back to the shared media file, and the short label recorded in `prompt.txt` (e.g. `prompt-image-001-abc123`) still shows the hash fragment.
- For image calls, output images follow the same flow: each converted buffer is written to `{rootDir}/media/{sha256}.jpg` with per-directory symlinks like `image-001.jpg`. The short label recorded in `response.txt` (e.g. `image-001-def456`) references the same hash for cross-checking.
- `response.txt` is streamed to disk while receiving the model output (buffered in ~200 character chunks and flushed again when the stream ends) so you can inspect partial responses if a call fails mid-way.
- `conversation.html`: A lightweight viewer showing the prompt and response sequence (roles, text, and `<img>` tags that point to the saved image files in the same directory).
- `exception.txt`: Written only when a call throws. Includes the error message, stack trace, timestamp, attempt counters, and model ID for the failed request.
- When debugging is enabled, an immutable copy of the prompt, response, and any image files is also written to `{rootDir}/log/{iso-timestamp}/` (the timestamp is generated when the call starts).

Example layout:

```
/tmp/llm-debug/
  media/
    5f4dcc3b5aa765d61d8327deb882cf99c6e0e5f2fdc1c84064d8f6f1a2b3c4d.jpg
    19b1a5f42d6f98f4c3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0.jpg
    41e2f3c4d5b6a7980f1e2d3c4b5a6978e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4.jpg
  gemini-2.5-pro/attempt-01/
    prompt.txt
    response.txt
    conversation.html
    prompt-image-001.jpg -> ../media/5f4dcc3b5aa765d61d8327deb882cf99c6e0e5f2fdc1c84064d8f6f1a2b3c4d.jpg
  gemini-3-pro-image-preview/
    prompt.txt
    response.txt
    conversation.html
    image-001.jpg -> ../media/19b1a5f42d6f98f4c3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0.jpg
    image-002.jpg -> ../media/41e2f3c4d5b6a7980f1e2d3c4b5a6978e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4.jpg
  log/2025-10-14T12-34-56-789Z/
    prompt.txt
    response.txt
    conversation.html
    image-001.jpg -> ../../media/19b1a5f42d6f98f4c3e2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0.jpg
```

## Usage Examples

Text call:

```ts
import { generateText, type LlmContent } from "./llm";

const contents: LlmContent[] = [
  { role: "user", parts: [{ type: "text", text: "Explain XOR briefly." }] },
];

const text = await generateText({
  modelId: "gemini-2.5-pro",
  contents,
  tools: [{ type: "web-search" }],
  debug: { rootDir: "/tmp/llm-debug", stage: "xor" },
});
```

JSON call with Zod validation:

```ts
import { Type } from "@google/genai";
import { toGeminiJsonSchema } from "./llm";

const schema = z.object({ title: z.string(), items: z.array(z.string()) });
const responseSchema = {
  type: Type.OBJECT,
  required: ["title", "items"],
  properties: {
    title: { type: Type.STRING },
    items: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
} as const;
const data = await generateJson({
  modelId: "gemini-2.5-pro",
  contents: [
    {
      role: "user",
      parts: [{ type: "text", text: "Return JSON: {title, items[]}" }],
    },
  ],
  responseJsonSchema: toGeminiJsonSchema(responseSchema),
  schema,
  debug: { rootDir: "/tmp/llm-debug", stage: "json-task" },
});
```

Image call:

```ts
const contents = [
  {
    role: "user",
    parts: [{ type: "text", text: "Draw a vintage cartoon poster of XOR." }],
  },
];

const images = await runLlmImageCall({
  modelId: "gemini-3-pro-image-preview",
  contents,
  imageAspectRatio: "16:9",
  debug: { rootDir: "/tmp/llm-debug", stage: "poster" },
});

`generateImages` composes its own request prompt and grades each returned image before returning it. Supply:
- `stylePrompt`: string describing the shared art direction (multi-line strings are fine).
- `imagePrompts`: ordered list of per-image descriptions; the function returns one image per entry, in order.
- `imageGradingPrompt`: concise rubric for the pass/fail grader run on `gemini-flash-latest`.
- `styleImages?`: ordered list of `{ mimeType?: string; data: Buffer }` used as style references.
- `maxAttempts?`: defaults to `4`. Remaining prompts (including any that failed grading) are retried up to this many times.
- `imageAspectRatio?`, `imageSize?`, `progress?`, `debug?`.

Use `generateImageInBatches` when you need overlapping style references across a long list of prompts.

```ts
const reliableImages = await generateImages({
  modelId: "gemini-3-pro-image-preview",
  stylePrompt: [
    "Bold, colourful flat design avatars with clear lighting and clean shapes.",
    "Keep poses dynamic but readable; maintain consistent proportions across characters.",
  ].join("\n"),
  styleImages: referenceImages, // optional style references
  imagePrompts: [
    "A cheerful robotics engineer adjusting a small drone on a workbench.",
    "A confident data scientist presenting charts on a holographic display.",
    "An adventurous explorer holding a compass at the edge of a jungle.",
    "A friendly teacher welcoming students into a bright classroom.",
  ],
  imageGradingPrompt:
    "Pass if the image is a single scene matching the prompt subjects/actions and required props; otherwise fail.",
  maxAttempts: 4,
  imageAspectRatio: "16:9",
  debug: { rootDir: "/tmp/llm-debug", stage: "avatars" },
});
```

## Sanitised Logging

When printing request summaries to logs, use `sanitisePartForLogging(part)` to avoid dumping large or sensitive blobs; inline data is shown as `[omitted:<bytes>b]` with MIME type.

## Notes

- This doc complements `docs/SPEC.md` (source of truth). Prefer updating SPEC for cross-cutting changes; use this file for implementation details of `eval` LLM utilities.
- Image calls request both `IMAGE` and `TEXT` modalities by default.
- Only the Google Search tool is currently supported via `tools: [{ type: 'web-search' }]`.
