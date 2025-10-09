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
- `runLlmJsonCall<T>(options): Promise<T>`
  - Like `runLlmTextCall` but parses and validates the final text as JSON via a Zod schema. Retries up to `maxAttempts`.

### Shared options

All calls accept:
- `modelId`: text model (Gemini) or image model (`gemini-2.5-flash-image`).
- `parts`: array of content parts:
  - `{ type: 'text', text: string }`
  - `{ type: 'inlineData', data: string, mimeType?: string }` (base64 preferred)
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
- `process?`: `(raw: string) => unknown` to pre-extract JSON (e.g. un-fence code blocks)
- `maxAttempts?`: default `2` (will re-prompt using the same options)

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

JSON call with Zod validation and fenced JSON extraction:

```ts
const schema = z.object({ title: z.string(), items: z.array(z.string()) });
const data = await runLlmJsonCall({
  modelId: "gemini-2.5-pro",
  parts: [{ type: "text", text: "Return JSON: {title, items[]}" }],
  schema,
  process: (raw) => JSON.parse(raw.slice(raw.indexOf("{")).slice(0, raw.lastIndexOf("}") - raw.indexOf("{") + 1)),
  maxAttempts: 2,
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
```

## Sanitised Logging

When printing request summaries to logs, use `sanitisePartForLogging(part)` to avoid dumping large or sensitive blobs; inline data is shown as `[omitted:<bytes>b]` with MIME type.

## Notes

- This doc complements `docs/SPEC.md` (source of truth). Prefer updating SPEC for cross-cutting changes; use this file for implementation details of `eval` LLM utilities.
- Image calls request both `IMAGE` and `TEXT` modalities by default.
- Only the Google Search tool is currently supported via `tools: [{ type: 'web-search' }]`.
