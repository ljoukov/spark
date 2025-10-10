# LLM Utilities (eval/src/utils/llm.ts)

This module provides thin wrappers around Gemini streaming to make it easy to:
- Send prompts as structured parts (text, inline data)
- Stream responses (text, image) while reporting progress
- Validate JSON responses with Zod
- Capture debug snapshots of prompts and responses

It is used across eval tools and session generators.

## Public API

- `runLlmTextCall(options): Promise<string>`
  - Streams a text response and returns the final concatenated text.
- `runLlmImageCall(options): Promise<Array<{ mimeType?: string; data: Buffer }>>`
  - Streams images (and optional text) and returns image buffers.
- `generateImages(options): Promise<Array<{ mimeType?: string; data: Buffer }>>`
  - Attempts to produce one image per entry in `imagePrompts`, defaulting to four attempts and re-prompting with the remaining prompts plus the expected output format when needed.
- `runLlmJsonCall<T>(options): Promise<T>`
  - Like `runLlmTextCall` but parses and validates the final text as JSON via a Zod schema. Retries up to `maxAttempts`.

### Shared options

All calls accept:
- `modelId`: text model (Gemini) or image model (`gemini-2.5-flash-image`).
- `parts`: array of content parts (used by `runLlmTextCall` and `runLlmImageCall`):
  - `{ type: 'text', text: string }`
  - `{ type: 'inlineData', data: string, mimeType?: string }` (base64 preferred)
- `contents?`: advanced override to send a multi-turn Gemini `Content[]` conversation (each entry `{ role, parts }`). When provided, `parts` may be omitted.
- `progress?`: `JobProgressReporter` (see below). If omitted, a concise fallback logger is used.
- `debug?`: `{ rootDir: string; stage?: string; subStage?: string; attempt?: number|string; enabled?: boolean }`
- Optional generation controls:
  - `responseMimeType?`, `responseSchema?` (text/JSON)
  - `responseModalities?` (e.g. `["IMAGE","TEXT"]`); images default to `["IMAGE","TEXT"]`
  - `imageAspectRatio?`
  - `tools?`: an array of `{ type: 'web-search' }` (mapped to Google Search)

### JSON convenience

`runLlmJsonCall` adds:
- `schema`: `z.ZodSchema<T>`
- `responseSchema`: Google `Schema` definition applied at request time (required)
- `maxAttempts?`: default `2` (will re-prompt using the same options)
- Responses are automatically requested as `application/json` and parsed before validation.

Avoid adding manual instructions such as “Return strict JSON …” in prompts. Passing the `schema` and `responseSchema` is sufficient for Gemini to emit structured output. If a field needs extra guidance, add a `description` on the schema property instead, and use `propertyOrdering` so any thinking/reasoning fields come before the final answer fields.

## Progress and Metrics

The wrappers report per-call usage to a `JobProgressReporter`:
- `startModelCall({ modelId, uploadBytes })` begins a call
- `recordModelUsage(handle, { outputCharsDelta?, outputBytesDelta? })` records streaming deltas
- `finishModelCall(handle)` ends a call

The default reporter used by our concurrency display aggregates across all calls and renders a single line like:

```
[label] 42% | 3 / 7 | 1 waiting | chars 12,345 | up 3.1 KB | down 5.6 KB | speed 950 chars/s ↓ 1.2 KB/s | models: 2.5-pro: chars 12,345 up 3.1 KB down 5.6 KB
```

Notes:
- Thinking tokens are included in `chars` and `speed` metrics. Visible response text still determines the returned value from `runLlmTextCall`.
- Per-model periodic "progress …" logs are intentionally suppressed to avoid console spam; only the aggregate display updates continuously, plus a final per-call completion line.

## Debug Snapshots (Prompts and Responses)

If `debug.rootDir` is provided, each call writes snapshots under:

```
{rootDir}/{stage}/{subStage?}/{attempt?}/
```

- `stage` defaults to the `modelId` unless explicitly set via `debug.stage`.
- `attempt` is appended if provided; for `runLlmJsonCall`, the attempt number (1-based) is automatically passed to the underlying stream.
- The target directory is cleared (recursively) before writing new snapshots so stale files from earlier runs never linger.

Generated files:
- `prompt.txt`: A human-readable listing of request parts (text content and inline-data byte counts).
- `response.txt`: Summary header followed by:
  - “===== Thoughts =====” with streamed thinking (if any)
  - “===== Response =====” with concatenated text (for image calls this may be empty or include accompanying text)
  - “===== Chunks =====” with lines like `chunk 3: +512 chars, +0 bytes`
- For image calls, one file per image: `image-01.<ext>`, `image-02.<ext>`, …

Example layout:

```
/tmp/llm-debug/gemini-2.5-pro/attempt-01/
  prompt.txt
  response.txt
/tmp/llm-debug/gemini-2.5-flash-image/
  prompt.txt
  response.txt
  image-01.png
  image-02.png
```

## Usage Examples

Text call:

```ts
import { runLlmTextCall, type LlmContentPart } from "./llm";

const parts: LlmContentPart[] = [{ type: "text", text: "Explain XOR briefly." }];
const text = await runLlmTextCall({
  modelId: "gemini-2.5-pro",
  parts,
  tools: [{ type: "web-search" }],
  debug: { rootDir: "/tmp/llm-debug", stage: "xor" },
});
```

JSON call with Zod validation:

```ts
import { Type } from "@google/genai";

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
const data = await runLlmJsonCall({
  modelId: "gemini-2.5-pro",
  parts: [{ type: "text", text: "Return JSON: {title, items[]}" }],
  responseSchema,
  schema,
  debug: { rootDir: "/tmp/llm-debug", stage: "json-task" },
});
```

Image call:

```ts
const images = await runLlmImageCall({
  modelId: "gemini-2.5-flash-image",
  parts: [
    { type: "text", text: "Draw a vintage cartoon poster of XOR." },
  ],
  imageAspectRatio: "16:9",
  debug: { rootDir: "/tmp/llm-debug", stage: "poster" },
});

`generateImages` composes its own request prompt. Supply:
- `stylePrompt`: ordered list of strings describing the shared art direction.
- `imagePrompts`: ordered list of per-image descriptions; the function expects to return one image per entry, in order.
- `maxAttempts?`: defaults to `4`. Retries remind the model of the remaining indices, prompts, and the required output format.

const reliableImages = await generateImages({
  modelId: "gemini-2.5-flash-image",
  stylePrompt: [
    "Bold, colourful flat design avatars with clear lighting and clean shapes.",
    "Keep poses dynamic but readable; maintain consistent proportions across characters.",
  ],
  imagePrompts: [
    "A cheerful robotics engineer adjusting a small drone on a workbench.",
    "A confident data scientist presenting charts on a holographic display.",
    "An adventurous explorer holding a compass at the edge of a jungle.",
    "A friendly teacher welcoming students into a bright classroom.",
  ],
  maxAttempts: 4,
  debug: { rootDir: "/tmp/llm-debug", stage: "avatars" },
});
```

## Sanitised Logging

When printing request summaries to logs, use `sanitisePartForLogging(part)` to avoid dumping large or sensitive blobs; inline data is shown as `[omitted:<bytes>b]` with MIME type.

## Notes

- This doc complements `docs/SPEC.md` (source of truth). Prefer updating SPEC for cross-cutting changes; use this file for implementation details of `eval` LLM utilities.
- Image calls request both `IMAGE` and `TEXT` modalities by default.
- Only the Google Search tool is currently supported via `tools: [{ type: 'web-search' }]`.
