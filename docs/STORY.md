# Story Generation Narrative

This document captures the conceptual flow that powers the historical story pipeline. It is language-agnostic and focuses on the orchestration steps, model prompts, and quality gates rather than runtime commands.

## End-to-End Orchestration

```mermaid
flowchart TD
  A["generateStory(options)"] --> B["generateProseStory"]
  B --> C["generateStorySegmentation"]
  C --> D{Corrections needed?}
  D -->|Yes| E["correctStorySegmentation"]
  E --> C
  D -->|No| F["generateStoryImages"]
  F --> G["generateImageSets (set_a/set_b)"]
  G --> H["generateStoryFrames"]
  H --> I["Poster & ending generation"]
  I --> J["judgeImageSets"]
  J --> K["Persist winner\nimages + narration"]
```

### Prose Ideation

The story text is produced by prompting a web-enabled Gemini 2.5 Pro model. The prompt enforces historical fidelity, single-narrator pacing, and an origin-story anchor:

```text
Write a single-voice, audio-friendly historical story that introduces **${topic}** …
Hard rules: do not relocate the event; do not centre a later adopter; no invented scenes or quotes.
Terminology for learners (mandatory) … Term-glossing is compulsory.
Close: end with a memorable, single-line takeaway … then one factual line on what happened next.
```

### Segmentation Blueprint

Segmentation restructures the prose into narration slices and illustration prompts. It solicits alternating voices, poster/ending cards, and strict scene composition rules:

```text
Requirements:
1. Provide `title`, `posterPrompt`, ten chronological `segments`, and `endingPrompt`.
…
4. For each of the ten `segments`:
   • Provide `narration` … Alternate between the `M` and `F` voices whenever the flow allows.
   • Provide `imagePrompt` … Focus on subject, action, setting, and lighting cues.
5. Keep each `imagePrompt` drawable as a single vintage cartoon panel …
```

### Prompt Correction Loop

The segmentation is checked up to three times by a correction prompt that only rewrites offending images. It lists every panel with narration context and reminds the grader about catastrophic issues (missing protagonist, floating abstractions, etc.). If corrections are returned they are applied immediately; otherwise the segmentation is accepted.

## Frame Generation Workflow

Poster, story panels, and ending card are produced twice (Set A and Set B). Each set shares the same style prompt derived from `ART_STYLE_VINTAGE_CARTOON`.

```text
A beautiful and engaging high quality classic cartoon illustration.
Use a high-positivity tone … Do NOT add borders. Do NOT produce multi-panel images.
Single scene per image.
```

### Batch + Grader Loop

`generateStoryFrames` drives the complex frame pipeline:

```mermaid
flowchart TD
  S["generateStoryFrames(options)"] --> P["buildBatches(prompts, batchSize, overlapSize)"]
  P --> B{"More batches remaining?"}
  B -->|No| H["prepareStoryboardReview(generated)"]
  H --> R{"Any frames pending review?"}
  R -->|No| BU["Return storyboard frames"]
  R -->|Yes| GS["gradeStoryboard(reviewFrames, lockedFrames)"]
  GS --> GV{frames_to_redo empty?}
  GV -->|Yes| BU
  GV -->|No & cycles < storyboardMax| RJ["Regenerate requested frames\n(update style context)"]
  RJ --> H
  GV -->|No & cycles == storyboardMax| BX["Throw FrameGenerationError"]
  B -->|Yes| BC["Assemble batch style context\n(sliding window + accepted frames)"]
  BC --> ATT["attempt = 1"]
  ATT --> GI["generateImages(batchPrompts, context)"]
  GI --> GS2{All frames succeeded?}
  GS2 -->|No & attempt < maxFrameAttempts| NA["attempt++"]
  NA --> GI
  GS2 -->|No & attempt == maxFrameAttempts| BX
  GS2 -->|Yes| GB["gradeBatch(resultFrames)"]
  GB --> GD{grader verdict}
  GD -->|redo_batch| RB["Reset batch state\nincrement batchRetry"]
  RB --> RC{batchRetry <= maxBatchRetries?}
  RC -->|No| BX
  RC -->|Yes| ATT
  GD -->|redo_frames| RF["Regenerate flagged frames\n(keep accepted subset)"]
  RF --> SC["Update style context with\naccepted frames"]
  SC --> ATT
  GD -->|accept| AC["Append frames to acceptedFrames"]
  AC --> B
```

Key concepts:

- **Style propagation:** Each batch carries forward a sliding window of prior frames (`overlapSize`) so characters remain consistent. Accepted images augment the style reference set for any partial redos.
- **Catastrophic grading:** The grader schema enforces explicit outcomes (`accept`, `redo_frames`, `redo_batch`) and collects frame indices plus short reasons. This prevents silent drift.
- **Storyboard audit:** After batches pass, a whole-board review can request targeted regenerations, capped at four cycles to avoid infinite loops.
- **Locked storyboard frames:** Once a frame clears review it becomes a context-only reference during future audits, so the grader cannot re-flag panels that have not changed.

### Poster and Ending

Once the ten interior frames exist, the poster uses the first few frames as references while the ending card uses the last few. Both reuse the same style prompt to avoid palette drift.

## Dual-Set Comparison

Each run produces two full sets (`set_a`, `set_b`). A Gemini text judge receives every image inline alongside its prompt and returns:

```json
{
  "reasoning": "…",
  "verdict": "set_a"
}
```

Only the winning set is kept for downstream storage.

## Media Packaging

- **Filtering:** Frames 1–10 (indices 1..10) feed the session’s media timeline; poster and ending are excluded from narration assembly.
- **JPEG normalisation:** Images are re-encoded (quality 92, 4:4:4) prior to upload.
- **Narration synthesis:** The alternating `M` / `F` segments are passed to the narration pipeline, keeping the same order as the frames.

The result bundle contains the story text, accepted segmentation, storage paths for the ten canonical frames, and narration metadata. No runtime command knowledge is required to reason about these steps; the process hinges on prompt engineering, iterative grading, and consistent style handoff between model calls.
