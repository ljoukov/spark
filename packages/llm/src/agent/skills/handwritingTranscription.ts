export const HANDWRITING_TRANSCRIPTION_SKILL_TEXT = `\
---
name: handwriting-transcription
description: Trigger this skill when the task is to transcribe handwritten work from images and resolve ambiguities with additional context images (problem statement and official solutions).
---

# Handwriting Transcription Workflow

Use this workflow for high-fidelity transcription from handwritten image snippets.

## Core Principles

- When 'extract_text' is available, start with extraction first and use visual checks only for one verification pass.
- Transcribe exactly what is written; do not solve, rewrite, or normalize content beyond what the task asks.
- Prefer source-fidelity over mathematical correctness: keep the student’s original symbol sequence even if it is wrong.
- Preserve structure, line breaks, crossings-out, and uncertain symbols with short inline notes.
- When context images are provided (problem statement, reference solutions, etc.), use them only to resolve ambiguity in the handwriting.
- Focus on the student's solution content; avoid transcribing unrelated page clutter/scribbles unless the task explicitly asks for them.
- Mark unresolved ambiguity explicitly instead of guessing.

## Stage Handling

- If the task defines staged outputs, complete stages in the exact order requested.
- Treat each stage as a transcription pass, not a rewrite from first principles.
- Carry forward prior text and only change lines where ambiguity was resolved.

## Extraction-First Workflow (When 'extract_text' Is Available)

- Start each stage with exactly one 'extract_text' call using 'documentPaths' for the primary handwriting file(s).
- Provide context files via 'supportingPaths' and use 'supportingInstructions' to say they are disambiguation context only (not transcription targets).
- In 'instructions', explicitly say the target is student handwriting/solution content; extract_text does not inherently know filenames/roles unless you describe them in text.
- For multi-page document sets, request explicit page markers in 'instructions' when needed.
- Do not repeat an identical 'extract_text' call for the same stage/output path; read the extracted markdown with 'read_file' and continue cleanup from that file.
- Do not run additional 'extract_text' calls on ad-hoc crops/snippets unless explicitly required by the task prompt.

## Single Verification Pass

- After the extraction call, do one verification pass only:
  - 'view_image' on the handwriting source once,
  - 'view_image' on the problem/context image once (if provided),
  - 'read_file' on the extracted markdown once.
- Perform one cleanup edit pass to fix obvious OCR mistakes and ambiguity markers.
- Avoid repeated inspect/crop loops. Prefer marking uncertain characters with '[?]' over iterative re-reading.

## Tool Restraint

- Do not use 'draw_grid_overlay', 'crop_image', or 'trim_image' in normal transcription flow.
- Use those tools only if the task explicitly requires coordinate-level inspection.

## Literal Fidelity Rules

- Keep operators and symbol order exactly as written ("+", "-", "=", "×", "/", superscripts, brackets).
- Do not collapse or normalize equations into an equivalent form.
- Preserve short tokens exactly: times, one-letter variables, coefficients, and units.
- If only one character is uncertain, keep the rest literal and mark uncertainty on that character only (for example "1[?]:48").
`;
