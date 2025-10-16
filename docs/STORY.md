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
  F --> G["generateImageSets"]
  G --> SA1
  G --> SB1

  subgraph SA["set_a pipeline"]
    SA1["generateStoryFrames (set_a)"] --> SA2["Poster candidates (4x)"]
    SA2 --> SA3["grade & select poster"]
    SA3 --> SA4["Generate ending card"]
  end

  subgraph SB["set_b pipeline"]
    SB1["generateStoryFrames (set_b)"] --> SB2["Poster candidates (4x)"]
    SB2 --> SB3["grade & select poster"]
    SB3 --> SB4["Generate ending card"]
  end

  SA4 --> J["judgeImageSets"]
  SB4 --> J
  J --> K["generateNarration (winner)"]
  K --> L["Persist winner\nimages + narration"]
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
2. `posterPrompt` … Include a bold 2-4 word title and, when it elevates the concept, one short supporting detail (date, location, motto) under six words.
…
4. For each of the ten `segments`:
   • Provide `narration` … Alternate between the `M` and `F` voices whenever the flow allows.
   • Provide `imagePrompt` … Focus on subject, action, setting, and lighting cues.
5. Keep each `imagePrompt` drawable as a cinematic single-scene illustration with modern storyboard energy; avoid multi-panel layouts, mirrored halves, or overly technical camera jargon.
6. Any visible text stays purposeful: headlines <=4 words, supporting elements <=6, all period appropriate.
…
9. Ensure the protagonist appears whenever the narration centres on them; environmental cutaways are fine when explicitly described.
```

### Prompt Correction Loop

The segmentation is checked up to three times by a correction prompt that only rewrites offending images. It lists every panel with narration context and reminds the grader about catastrophic issues (missing protagonist, floating abstractions, etc.). If corrections are returned they are applied immediately; otherwise the segmentation is accepted.

## Frame Generation Workflow

Poster, story panels, and ending card are produced twice (Set A and Set B). Each set shares the same style prompt (currently `ART_STYLE_VINTAGE_CARTOON`) which now pushes for cinematic, modern graphic-novel energy while still banning photorealism, collage artefacts, heavy borders, or multi-panel layouts.

### Batch Grading Loop

`generateStoryFrames` drives the panel production with a batch-oriented retry loop:

```mermaid
flowchart TD
  S["generateStoryFrames(options)"] --> B["for each batch"]
  B --> C["collect style refs (base + overlap)"]
  C --> A{"attempt <= maxBatchAttempts?"}
  A -->|No| X["throw FrameGenerationError"]
  A -->|Yes| G["generateImages(prompts, context)"]
  G --> V{"gradeBatch outcome"}
  V -->|accept| U["append batch to results"]
  U --> B
  V -->|redo_batch| R["increment attempt and retry"]
  R --> A
  V -->|redo_frames| F["regenerate flagged frames\n(check-new-only grading)"]
  F --> T["grade flagged frames"]
  T --> V
```

Key concepts:

- **Style propagation:** Each batch carries forward a sliding window of prior frames (`overlapSize`) so characters remain consistent; accepted images join the reference pool for partial redos.
- **Catastrophic grading:** The grader schema enforces explicit outcomes (`accept`, `redo_frames`, `redo_batch`) and collects frame indices plus reasons to keep failures explainable.
- **Targeted redos:** When only specific frames fail, they are regenerated individually—each with up to four image attempts—before being re-graded in isolation. Batch retries are capped by `BATCH_GENERATE_MAX_ATTEMPTS`.
- **Deterministic failure:** Exhausting batch retries or frame redo attempts throws immediately, surfacing fatal quality issues to the caller.

### Poster Selection and Ending

After the ten interior frames are locked:

- **Poster candidates:** Each image set spins four concurrent poster renders against the same style prompt and leading frame references. A text-grade pass evaluates all candidates, flags catastrophic artefacts, and selects the most stunning acceptable poster.
- **Poster typography:** The selector enforces the bold 2-4 word title plus optional <=6 word supporting detail when the prompt calls for text.
- **Ending card:** The last few interior frames seed the style references for a single ending-card render, generated through the same single-image helper that trims prompts and handles retries.

## Dual-Set Comparison

Each run produces two full sets (`set_a`, `set_b`). A Gemini text judge receives every image inline alongside its prompt and returns:

```json
{
  "reasoning": "…",
  "verdict": "set_a"
}
```

Only the winning set is kept for downstream storage. The judge weighs prompt fidelity, cinematic single-scene composition, typography limits, and whether the protagonist appears whenever the narration centres on them (environmental cutaways are fine when prompted).

## Media Packaging

- **Filtering:** Frames 1–10 (indices 1..10) feed the session’s media timeline; poster and ending are excluded from narration assembly.
- **JPEG normalisation:** Images are re-encoded (quality 92, 4:4:4) prior to upload.
- **Narration synthesis (post-judging):** The alternating `M` / `F` segments from the winning set are passed to the narration pipeline, keeping the same order as the frames.

The result bundle contains the story text, accepted segmentation, storage paths for the ten canonical frames, and narration metadata. No runtime command knowledge is required to reason about these steps; the process hinges on prompt engineering, iterative grading, and consistent style handoff between model calls.
