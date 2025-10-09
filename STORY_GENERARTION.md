Spark Story Generation — Flow, Prompts, and Artifacts

Overview

- Purpose: describe the end-to-end story pipeline (prose → segmentation → prompt correction → images → narration) and the prompt templates used.
- Code: primary implementation lives in `eval/src/code/session/generateStory.ts` and the test harness in `eval/src/code/session/generateTestStory.ts`.
- Models: text = `gemini-2.5-pro`, images = `gemini-2.5-flash-image`.

High-Level Flow

1) Prose generation
- Builds a research-aware prompt for the topic and generates the narrated story text.
- Entry: `generateProseStory(topic)`.
 

2) Segmentation (title + 10 panels + ending/poster prompts)
- Creates a schema-constrained JSON segmentation: title, poster prompt, 10 content segments (each: `imagePrompt`, `narration[ {voice,text} ]`), and the ending prompt.
- Entry: `generateStorySegmentation(storyText, ...)` using `StorySegmentationSchema`.
 

3) Image prompt correction (not “judge”)
- Purpose: review the initial 12 prompts and return targeted corrections only.
- Entry: `runSegmentationCorrector(...)` (invoked internally by `generateStorySegmentation`).
- Indexing used by the corrector input/output:
  - 0–9 → story images (10 panels)
  - 10 → "the end" image
  - 11 → poster image
- Response schema (strict JSON):
  - `issuesSummary: string`
  - `corrections: Array<{ prompt_index: number, critique: string, updatedPrompt: string }>`

4) Image generation (12 images, two parallel sets, judged selection)
- Builds 12 prompts in this order:
  - Images 1–10 → story panels (from the corrected segmentation)
  - Image 11 → "the end" card
  - Image 12 → poster
- Runs two full-set generations in parallel (Set A and Set B) using the same prompts and style.
- A text judge compares the two complete sets and returns a JSON verdict with reasoning; the winner set is used downstream.
- Entry: `generateStoryImages(segmentation, ...)` → calls `judgeImageSets(setA, setB, ...)`.
 

5) Narration synthesis + media packaging
- Converts the 10 story panels’ narration to audio and emits a media manifest consumed by the app.
- Only panels 1..10 are used for the media plan (poster/ending are excluded from narration).
- Entry: `synthesizeAndPublishNarration(...)` via `generateStory(...)`.
 

Prompt Templates

Segmentation (excerpt)

- Validates against `StorySegmentationSchema` (`title`, `posterPrompt`, `segments[10] { imagePrompt, narration[] }`, `endingPrompt`).
- Encourages period-appropriate, grounded scenes and clear single actions. Style anchors are not baked into segment prompts (style is added at image time).
- Poster prompt: should read like a high-impact cover — stunning, captivating, interesting, and intriguing — and it should explicitly mention the protagonist by name (important historical figure). If the name is long, prefer a concise form (e.g., first+last name or moniker). Keep any visible text within four words.

Image Prompt Corrector

- System: “You are the image prompt corrector for illustrated historical stories.”
- Output (JSON only): `{ issuesSummary: string, corrections: Array<{ prompt_index, critique, updatedPrompt }> }`.
- Indexing: 0–9 story, 10 the-end, 11 poster.

Image Generation (full-set header)

The 12-image request is prefixed with the following instruction block, then enumerates `Image 1..12` lines:

```
Please make a total of 12 images:
- 1-10 story images
- "the end" image (should be a memorable hint at the core idea, morale, or legacy)
- the "movie poster" image for the whole story (hook)
Make high quality, high positivity cartoon style.

Follow the style:
<ART_STYLE_VINTAGE_CARTOON lines>

Image descriptions:
Image 1: <story panel 1>
...
Image 10: <story panel 10>
Image 11 (the end): <ending>
Image 12 (poster): <poster>
```

Image-Set Judge (selection prompt)

- Role: compare Set A vs Set B (each includes all 12 images + prompts inline) and decide which better satisfies prompt fidelity, composition, grounded setting, and vintage style.
- Output (JSON only): `{ reasoning: string, verdict: "set_a" | "set_b" }`.

Indexing Summary

- Corrector JSON: 0..9 story, 10 the-end, 11 poster.
- Image generation indices: 1..10 story, 11 the-end, 12 poster.
- Media narration uses only images 1..10.


Running Locally (test story)

- `npm --prefix eval run session:story` — generates a full test story under `spark-data/code/synthetic/stories/test-story`.
- Environment: see `docs/SPEC.md` for Firebase + model credentials; eval tools read `.env.local` in repo root.

Notes & Guardrails

- All external outputs are validated with Zod; segmentation corrections are applied atomically and re-validated before continuing.
- Style is centralized (`ART_STYLE_VINTAGE_CARTOON`) and injected into the image stage; individual segment prompts stay content-focused.
