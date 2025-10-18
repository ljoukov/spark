# Story Reliable Generation Ideas

## Pipeline Touchpoints Worth Stress-Testing

- **Batch generation** (`generateImages`): currently requests 5 frames at a time with a shared prompt block; catastrophic shuffles tend to appear when the model collapses to protagonist-centric “default” imagery.
- **Grader** (`gradeBatch`): enforces catastrophic failure checks but only after the model produces mismatched frames; its reasoning can be used to steer adaptive fallbacks.
- **Prompt revision stage** (`requestFramePromptRevisions`): only triggers after the second failed attempt; wording updates may come too late when the initial prompts demand precise staging.
- **Style context & overlap** (`collectBatchStyleImages`): reuses recent frames as style references; if those frames are already off-target they can reinforce the collapse.

## Reliability Strategies (Options)

### 1. Adaptive Batch Sizing & Ordering When Systemic Failures Are Detected

- **Idea**: When the grader returns a systemic message (“content is unrelated to prompts”, “duplicate frames”), automatically fall back to single-frame generation or smaller batches with isolated prompts to avoid cross-talk.
- **Implementation sketch**: inspect `grade.batchReason` inside the batch loop; on keywords like “systemic”, rerun with `batchSize = 1`, disable overlap images, and reset the conversation history passed to `generateImages`.
- **Trade-offs**: Slower throughput, but isolates prompts so mis-ordered outputs cannot cascade. Useful as a last-resort mode once the grader has proven the current batch collapsed.

### 2. Semantic Grader Upgrades Before Accepting Frames

- **Idea**: Add an embedding-based or caption-based grader that checks each image against its prompt before the LLM grader is asked for a verdict.
- **Implementation sketch**:
  - Run a lightweight vision-caption (Gemini flash text mode) per image to produce a neutral caption, then score the caption against the original prompt (e.g. cosine similarity via embeddings or rule-based keyword checks).
  - Flag frames whose score drops below a threshold and resubmit them before reaching the batch grader.
- **Trade-offs**: Extra latency and API calls, but catches obvious prompt swaps early and reduces the number of catastrophic grader rejections.

### 3. Introduce an Editor-Based Repair Stage

- **Idea**: When specific frames fail (`redo_frames` list), request an “editor” (image-to-image) pass instead of regenerating from scratch. Provide the failing image plus a corrective instruction derived from the grader’s reason.
- **Implementation sketch**:
  - Capture the grader reason (e.g. “needs parchment close-up”) and feed it into a `generateImageEdit` helper that keeps style references but nudges composition.
  - Use the editor result as Candidate 2 in `selectBestRedoFrameCandidate`, keeping the original as Candidate 1.
- **Trade-offs**: Editor APIs often preserve layout better, leading to faster convergence; however, they can introduce artefacts if over-constrained. Guard with the grader before acceptance.

### 4. Strengthen Prompt Revision Loop

- **Idea**: Trigger `requestFramePromptRevisions` as soon as the first `redo_batch` arrives (rather than waiting for attempt ≥ 2) and feed it richer telemetry.
- **Implementation sketch**:
  - Pass grader findings, semantic grader scores, and thumbnails of the failing outputs into the revision request so the LLM rewrites with concrete failure evidence.
  - Allow the revision helper to switch camera angle / focal subject explicitly (“focus entirely on the parchment; exclude Fermat”) to break protagonist bias.
- **Trade-offs**: Earlier prompt adjustments increase variance but help escape repeated collapses; ensure revised prompts remain aligned with narration (`frameNarrationByIndex` guard).

### 5. Retry Budget & Style Context Tuning

- **Idea**: Increase `IMAGE_GENERATION_MAX_ATTEMPTS` (current 4) and `BATCH_GENERATE_MAX_ATTEMPTS` (current 3) selectively when the grader reports near-miss issues, while purging contaminated style images.
- **Implementation sketch**:
  - On rejection, rebuild `styleImagesForBatch` using only the authoritative segmentation references or previously accepted frames, skipping the current batch’s flawed outputs.
  - Allow optional cooldown (sleep/backoff) between attempts; anecdotal evidence suggests spacing Gemini calls reduces mode collapse.
- **Trade-offs**: More retries imply higher cost; limiting style carry-over prevents feedback loops but may reduce continuity, so reserve for catastrophic cases.

### 6. Observability & Guardrails

- **Idea**: Record per-frame hashes of prompts and resulting captions, plus thumbnails of each attempt, so we can surface collapse frequency and correlate with prompt patterns.
- **Implementation sketch**:
  - Extend debug snapshots to include prompt fingerprints (e.g. `hash(prompt + frameIndex)`) and store them alongside generated images in the existing debug directory structure.
  - Build a small grader dashboard (could reuse `eval/src/quiz/audit-eval.ts` reporting patterns) to flag templates whose failure rate crosses a threshold.
- **Trade-offs**: Requires storage and reporting plumbing but gives faster feedback loops and surfaces templates that need manual prompt adjustments.

### 7. Template-Level Prompt Simplification

- **Idea**: Pre-process welcome templates with a “prompt editor” pass that simplifies complex frames before generation, especially for numerically dense scenes (e.g. chalkboard primes).
- **Implementation sketch**: Run a one-time or scheduled script leveraging `requestFramePromptRevisions` to produce an alternate set of “stable” prompts per template; store them alongside the originals, toggleable via config.
- **Trade-offs**: Reduces narrative flourish but improves render reliability; maintain dual prompts so authors can revert if fidelity drops too far.
