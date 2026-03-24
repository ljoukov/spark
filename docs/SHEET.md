# Sheet Components

This document is the durable planning taxonomy for paper-sheet UI capabilities that should be added beyond the current contract.

It is informed by these analyzed source papers:

- `exam.pdf`
- `AQA-87002-QP-NOV24.PDF`
- `AQA-8464P1H-QP-JUN18.PDF`
- `AQA-80351-MS-NOV21.PDF`
- `AQA-80351-QP-NOV21.PDF`
- `2024-j270-02-qp.pdf`

`docs/SPEC.md` and `packages/schemas/src/paperSheet.ts` remain the source of truth for what is implemented today. This file defines the canonical names and scope for what should be added next.

## Baseline Today

The current shared sheet question contract supports:

- `fill`
- `mcq`
- `lines`
- `calc`
- `match`
- `spelling`

Current practical limits that matter across the analyzed papers:

- `mcq` is single-select only.
- `fill` supports only 1 or 2 blanks.
- `lines` is one free-response field, not a structured multi-part or paged exam surface.
- `calc` captures one compact final answer, not workings plus final answer.
- Stimulus content is mostly carried by section `theory` and `infoBox`, not by question-level source/figure primitives.
- Section routing like `answer Question 4 or Question 5` is not first-class.

## Evaluation Rules

When judging a paper against the sheet UI, keep these rules explicit:

- Distinguish `perfect fit` from `acceptable fallback`.
- Separate answer-entry fidelity from stimulus/layout fidelity.
- Do not treat `use more lines` as a full solution when the paper needs a structured question layout.
- Prefer extending an existing type when the interaction model is still the same.
- Add a new primitive only when the interaction or layout cannot be reduced to the current widgets.

## Canonical Taxonomy

### Extensions Of Existing Types

#### `mcq.multiSelect`

Extend `mcq` with:

- `selectionMode: 'single' | 'multiple'`
- cardinality rules: `exact`, `min`, `max`
- answer shape as selected option ids, not one string
- support for lettered statement lists and exam-style checkbox/tick presentation

Use this for:

- choose exactly `N` true statements
- choose up to `N` statements
- tick two boxes

This canonicalizes:

- `mcq-multi`
- multi-select statements
- exact-cardinality letter choices

#### `lines.extendedWriting`

Extend `lines` with booklet-style long-answer rendering:

- fixed ruled blocks
- non-resizable answer surface
- continuation pages
- optional extra-space pages
- multi-page writing flow under one question id

Use this for:

- long essay/booklet questions that are semantically already `lines`
- writing questions where the main gap is page structure, not answer type

This canonicalizes:

- `paged-lines`
- `extended-writing`
- booklet-style continuation pages

#### `fill.slotList`

Extend `fill` into a structured short-answer list:

- exact `N` slots
- stacked or numbered layout
- optional labels per slot
- optional multiline slots

Use this for:

- `state two`, `state three`, `state four`
- numbered `1` / `2` short responses
- stacked labeled fields like `Latin word` / `Translation`

This canonicalizes:

- `shortList`
- numbered multipart short answers
- exact-`N` response slots

#### `fill.answerSet`

Extend `fill.slotList` with order-insensitive evaluation:

- treat slots as a set, not an ordered tuple
- enforce exact answer count when needed
- allow repeated-slot layout without implying answer order

Use this for:

- `give any two`
- unordered paired/short-set answers

This canonicalizes:

- unordered multi-answer set
- order-insensitive paired answers

#### `question.markingMeta`

Add per-question metadata that changes question chrome, not answer capture:

- structured mark breakdowns
- badges/callouts like SPaG
- question-specific assessment notes

Use this for:

- `24 + 16` mark splits
- `+3 SPaG`

This canonicalizes:

- structured mark split
- SPaG mark metadata

### New Stimulus And Presentation Primitives

#### `stimulusBlock`

First-class question-level source/stimulus container.

Supported variants should include:

- `passage`
- `glossary`
- `text`
- `figure`
- `table`
- `chart`
- `circuit`
- `mixed`
- `redacted`

Core behaviors:

- stable caption/label rendering
- question-level placement, not only section-level
- optional line numbering for passages
- optional grouped glossary lists like `Names` and `Words`
- optional attribution/link state for redacted or external sources

Use this for:

- Latin passages and glossaries
- science figures, tables, graphs, and circuits
- geography figures, photos, and diagrams
- citizenship extracts, source notices, and mixed source panels

This canonicalizes:

- `question-stimulus`
- `sourceBlock`
- passage/glossary block
- figure/table/circuit block

#### `stimulusSet`

Ordered grouping of multiple stimulus blocks for one question or question group.

Core behaviors:

- multiple named/numbered sources in one question
- shared stimulus reused across several subquestions
- ordered comparative source layout

Use this for:

- multi-source citizenship questions
- geography questions depending on two figures at once
- grouped source sets that should not be flattened into one markdown blob

This canonicalizes:

- `sourceSet`
- multi-source ordered panel
- multi-figure gallery

#### `mapStimulus`

Specialized `stimulusBlock` variant for map-heavy papers.

Additional behaviors:

- legend/key rendering
- grid references
- highlight overlays
- scale-aware layout

Use this when a generic image block is not enough to preserve map semantics.

#### `promptCallout`

Presentation primitive for quoted/viewpoint/exam-callout panels.

Use this for:

- boxed viewpoint prompts
- quoted statements
- source-reference callouts

This canonicalizes:

- quoted panel
- viewpoint panel
- source-reference callout

#### `assessmentCallout`

Presentation primitive for lightweight assessment chrome.

Use this for:

- SPaG badges
- marks-related side callouts

### New Composite Question Layouts

#### `translationSequence`

Composite question layout for one marked translation question with repeated ordered blocks.

It should support:

- one question id
- one marks total
- one logical answer
- repeated sequence of `stimulusBlock -> answer surface -> continuation`

Use this for:

- Latin-style translation questions with `passage`, `Names`, `Words`, lined response, then another passage/glossary block under the same marks total

This is a structural gap, not just a longer `lines` question.

#### `workedAnswer`

Composite question for questions that require visible method plus final answer fields.

It should support:

- workings area
- final labeled answer slot or slots
- optional fixed unit
- optional tied stimulus block

Use this for:

- science calculations where the paper expects method lines plus `Time = ...`, `Year = ...`, `Power = ... W`

This canonicalizes:

- `worked-calc`
- `worked-answer`
- `calcWithWorking`

#### `selectThenExplain`

Composite question layout for an objective choice followed by written justification.

Use this for:

- one question that begins with a tick-box or choice and then requires a written explanation in the same question surface

This canonicalizes:

- hybrid `mcq + lines`

#### `diagramLabel`

Distinct interaction model for hotspot-based labeling.

It should support:

- anchored hotspots
- reusable word bank
- distractor labels
- spatial placement fidelity

Use this for:

- label parts of a diagram with a provided word bank

#### `graphEdit`

Distinct interaction model for graph/chart editing.

It should support:

- completing missing bars
- drawing curves on supplied axes
- editing chart state on a provided background

Use this for:

- bar-chart completion
- sketch the curve on the supplied graph

This canonicalizes:

- `graph-completion`
- `graphSketch`
- `graph-edit`

#### `sectionChoiceBranch`

First-class section routing for papers where one branch must be answered and another omitted.

Use this for:

- `answer Question 4 or Question 5`

### Optional Lower-Priority Fidelity Improvements

These are useful, but not the first items needed for cross-paper parity:

- `planningArea`
  - planning box tied to extended-writing questions
- `slotList.visualStyle`
  - further polish for stacked labeled field layouts once `fill.slotList` exists
- `bookletChrome`
  - page headers/footers and paper-like pagination polish
- `sourceReferencePins`
  - finer-grained inline pointers beyond `promptCallout`

## Alias Dictionary

Use these canonical names in future docs and implementation plans:

- `mcq-multi` -> `mcq.multiSelect`
- multi-select statements -> `mcq.multiSelect`
- exact-cardinality letter choices -> `mcq.multiSelect`
- paged-lines -> `lines.extendedWriting`
- extended-writing -> `lines.extendedWriting`
- booklet continuation pages -> `lines.extendedWriting`
- `shortList` -> `fill.slotList`
- numbered multipart short answers -> `fill.slotList`
- unordered multi-answer set -> `fill.answerSet`
- order-insensitive paired answers -> `fill.answerSet`
- structured mark split -> `question.markingMeta`
- `question-stimulus` -> `stimulusBlock`
- `sourceBlock` -> `stimulusBlock`
- passage block -> `stimulusBlock`
- `sourceSet` -> `stimulusSet`
- multi-figure gallery -> `stimulusSet`
- map-specific figure panel -> `mapStimulus`
- quoted panel -> `promptCallout`
- viewpoint panel -> `promptCallout`
- SPaG badge -> `assessmentCallout`
- composite translation blocks -> `translationSequence`
- passage-anchored constrained answers -> `translationSequence` plus `stimulusBlock`
- workings plus final answer slots -> `workedAnswer`
- hybrid `mcq + lines` -> `selectThenExplain`
- either/or section routing -> `sectionChoiceBranch`

## Coverage Matrix

### `exam.pdf`

Primary gaps surfaced:

- `mcq.multiSelect`
- `translationSequence`
- `stimulusBlock`
- `fill.answerSet`
- `sectionChoiceBranch`
- lower-priority `fill.slotList` styling for stacked labeled fields

### `AQA-87002-QP-NOV24.PDF`

Primary gaps surfaced:

- `mcq.multiSelect`
- `lines.extendedWriting`
- `question.markingMeta`
- optional `planningArea`
- optional `promptCallout`

### `AQA-8464P1H-QP-JUN18.PDF`

Primary gaps surfaced:

- `stimulusBlock`
- `diagramLabel`
- `graphEdit`
- `mcq.multiSelect`
- `workedAnswer`

### `AQA-80351-MS-NOV21.PDF` and `AQA-80351-QP-NOV21.PDF`

Primary gaps surfaced:

- `stimulusBlock`
- `mapStimulus`
- `stimulusSet`
- `selectThenExplain`
- `fill.slotList`
- `assessmentCallout`

### `2024-j270-02-qp.pdf`

Primary gaps surfaced:

- `fill.slotList`
- `stimulusBlock`
- `stimulusSet`
- `promptCallout`

## Priority Roadmap

### P0: Core Cross-Paper Parity

- `mcq.multiSelect`
- `lines.extendedWriting`
- `fill.slotList`
- `stimulusBlock`
- `stimulusSet`
- `workedAnswer`

### P1: High-Fidelity Exam Interactions

- `diagramLabel`
- `graphEdit`
- `mapStimulus`
- `translationSequence`
- `selectThenExplain`
- `question.markingMeta`
- `sectionChoiceBranch`

### P2: Polish And Lower-Frequency Fidelity

- `fill.answerSet`
- `promptCallout`
- `assessmentCallout`
- `planningArea`
- `slotList.visualStyle`
- `bookletChrome`
- `sourceReferencePins`

## Minimal Shape Notes

These are not final schemas. They are scope notes for future schema design.

### `mcq.multiSelect`

- keep existing `mcq` prompt/options shape
- add selection mode and cardinality metadata
- store selected option ids as an array when in multiple mode

### `lines.extendedWriting`

- keep existing long-form answer semantics
- add exam-surface metadata for ruled blocks, continuation, and booklet flow
- pair cleanly with `question.markingMeta` and optional `planningArea`

### `fill.slotList`

- support `slots: number`
- support numbered and labeled visual modes
- allow single-line or multiline per slot

### `stimulusBlock`

- make stimulus a first-class question child, not prompt markdown only
- support text, figures, tables, charts, circuits, passages, mixed media, and redacted placeholders

### `workedAnswer`

- one composite question with method area plus final answer fields
- do not split one exam question into multiple artificial sheet questions when the paper treats it as one

## Short Take

Across all analyzed papers, the main missing capability is not one more answer widget. It is a better separation between:

- answer entry
- question-level stimuli
- composite exam layouts
- assessment metadata

If we only add more free-text fields, the sheet UI will keep being semantically usable but structurally low-fidelity. The additions above are the minimum durable taxonomy that covers all currently analyzed papers without inventing a new one-off component for each exam.
