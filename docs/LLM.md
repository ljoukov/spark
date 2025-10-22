# LLM Utilities (packages/llm/src/utils/llm.ts)

This module provides thin wrappers around Gemini streaming to make it easy to:
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
  - Attempts to produce one image per entry in `imagePrompts`, defaulting to four attempts and re-prompting with the remaining prompts plus the expected output format when needed.
- `generateJson<T>(options): Promise<T>`
  - Like `generateText` but parses and validates the final text as JSON via a Zod schema. Retries up to `maxAttempts`.

### Shared options

All calls accept:
- `modelId`: text model (Gemini) or image model (`gemini-2.5-flash-image`).
- `contents`: ordered array of `{ role: 'user' | 'model' | 'system' | 'tool'; parts: LlmContentPart[] }` representing the conversation you want to send to Gemini. Each part can be:
  - `{ type: 'text', text: string, thought?: boolean }`
  - `{ type: 'inlineData', data: string, mimeType?: string }` (base64 preferred)
- `progress?`: `JobProgressReporter` (see below). If omitted, a concise fallback logger is used.
- `debug?`: `{ rootDir: string; stage?: string; subStage?: string; attempt?: number|string; enabled?: boolean }`
- Optional generation controls:
  - `responseMimeType?`, `responseSchema?` (text/JSON)
  - `responseModalities?` (e.g. `["IMAGE","TEXT"]`); images default to `["IMAGE","TEXT"]`
  - `imageAspectRatio?`
  - `tools?`: an array of `{ type: 'web-search' }` (mapped to Google Search)

### JSON convenience

`generateJson` adds:
- `schema`: `z.ZodSchema<T>`
- `responseSchema`: Google `Schema` definition applied at request time (required)
- `maxAttempts?`: default `2` (will re-prompt using the same options)
- Responses are automatically requested as `application/json` and parsed before validation.

Avoid adding manual instructions such as “Return strict JSON …” in prompts. Passing the `schema` and `responseSchema` is sufficient for Gemini to emit structured output. If a field needs extra guidance, add a `description` on the schema property instead, and use `propertyOrdering` so any thinking/reasoning fields come before the final answer fields.

When you need to explain the expected shape inside a prompt, describe it in clear prose (sections, fields, and intent) rather than pasting raw JSON schemas or example skeletons. The schema definitions live in code; prompts should only outline the requirements at a conceptual level.

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
- Thinking tokens are included in `chars` and `speed` metrics. Visible response text still determines the returned value from `generateText`.
- Per-model periodic "progress …" logs are intentionally suppressed to avoid console spam; only the aggregate display updates continuously, plus a final per-call completion line.

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
- `response.txt`: Summary header followed by:
  - “===== Response =====” with concatenated text (for image calls this may be empty or include accompanying text)
  - “===== Content =====” with a structured dump of the final parts when available. Inline image entries now include a short six-character SHA in the header so you can match parts with filenames.
- Prompt inline images are converted to JPEG when possible and stored once under `{rootDir}/media/{sha256}.jpg`. For convenience, a symlink named `prompt-image-001.jpg` (incrementing per prompt) is placed inside each debug directory pointing back to the shared media file, and the short label recorded in `prompt.txt` (e.g. `prompt-image-001-abc123`) still shows the hash fragment.
- For image calls, output images follow the same flow: each converted buffer is written to `{rootDir}/media/{sha256}.jpg` with per-directory symlinks like `image-001.jpg`. The short label recorded in `response.txt` (e.g. `image-001-def456`) references the same hash for cross-checking.
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
  gemini-2.5-flash-image/
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
  responseSchema,
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
  modelId: "gemini-2.5-flash-image",
  contents,
  imageAspectRatio: "16:9",
  debug: { rootDir: "/tmp/llm-debug", stage: "poster" },
});

`generateImages` composes its own request prompt. Supply:
- `stylePrompt`: ordered list of strings describing the shared art direction.
- `imagePrompts`: ordered list of per-image descriptions; the function returns one image per entry, in order.
- `maxAttempts?`: defaults to `4`. Each prompt can be attempted up to this many times before we give up on it.
- `batchSize?`: defaults to `4`. Prompts are submitted in batches of this size; omitted images are retried in the next batch before new prompts are added.
- `referenceImages?`: ordered list of `{ mimeType?: string; data: Buffer }` used as style references. When present, the prompt includes them immediately after the style text with the header:

  ```
  ------
  Please consistently follow the characters from earlier frames:
  <styleImage1>
  ...
  <styleImageN>
  ------
  ```
- When retrying a batch, any images that have already been generated are reattached using the same header to preserve character consistency, and the prompt re-lists every image description while pointing out the indices that still need work.

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
