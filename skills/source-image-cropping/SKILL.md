---
name: source-image-cropping
description: Use when a worksheet or grader run needs a visible crop of a source figure, diagram, graph, table, photo, or diagram-option block.
---

# Source Image Cropping

Use this skill to turn source-page visuals into worksheet-visible image assets.

For handwritten grading, use this skill only for visuals that genuinely need to be visible in the scored feedback. If the uploaded/source PDF is available and a compact prompt can say `Use Figure N in the linked original PDF.`, prefer that path instead of producing many source-paper crops.

## Inputs

- Source page image path or an existing bad crop.
- Target question, figure/table/diagram label, and why the visual matters.
- Output asset path under the guarded worksheet asset directory:
  - `grader/output/assets/...` for grader runs,
  - `sheet/output/assets/...` for draft-sheet runs.

## Workflow

For each target visual, keep an explicit `image-cutting-step N/8` note in the crop plan or crop-validation draft. Do not run more than 8 image-cutting steps for one target visual without calling `review_run_progress_with_fresh_agent` and switching strategy or reporting the blocker.

1. If the source is a PDF and `extract_pdf_images` is available, run it once for the relevant page range before manual cropping. Use it as a deterministic first pass for embedded raster figures, maps, charts, photos, or apparatus images; ignore tiny repeated strips/noise and validate useful outputs before linking them.
2. Render PDF pages to high-resolution page images before cropping. Use the highest useful `pdf_to_images` output and crop from that page image, not from thumbnails or screenshots. Use this path for vector diagrams, layout-sensitive figures, or extracted images that lack needed labels/context.
3. For ambiguous source-page bounds, create a labelled coordinate grid with `draw_grid_overlay` and call `propose_crop_bbox_with_fresh_agent` instead of repeatedly inspecting page images in the main agent context.
4. Do not rely on direct main-context `view_image` during grader-publish runs; it is intentionally unavailable there. Use extraction tools plus fresh-context visual helpers for proposals and validation so image inspection does not pollute the grading context.
5. Choose one rectangular pixel bbox in the selected base image coordinate space.
6. Crop with `crop_image` using `bboxPixels`.
7. Inspect the crop with `validate_crop_with_fresh_agent` when available, or another fresh-context visual helper in local/debug flows.
8. Use `trim_image` only after the crop is complete and only to remove safe whitespace.
9. Validate the final linked crop with `validate_crop_with_fresh_agent` when that tool is available. Always pass:
   - `expectedContent`: the exact visual content that must be visible in the crop,
   - `duplicatedTextToExclude`: prompt/caption/table text that is rendered separately and should not be required inside the crop; use `none` only when no surrounding duplicated text needs exclusion.
10. Validate one final crop per validation call; do not batch several high-risk crops into one review.
11. Record final validation in the caller's crop-validation file before publishing.
12. Link the final crop from the visible worksheet prompt with the exact workspace-relative path returned by the last successful image tool. Preserve its extension exactly, including `.png` outputs from `pad_image` or `trim_image`.

## Fresh-Context Visual Review

Use a fresh-context visual helper whenever a crop is high-risk: ambiguous figure bounds, dense labels/axes/table cells, option-diagram MCQs, or any target that is still uncertain after one manual correction pass.

The helper may propose or review candidate rectangles, but the published asset must still be one validated rectangular crop.

Use `review_run_progress_with_fresh_agent` whenever the crop loop has repeated the same failure, hit an image-edit budget warning, or reached the 8-step cap for one target visual. The reviewer is for process diagnosis only; it must not grade, assemble worksheet JSON, or replace final crop validation.

## Bounding Box Rules

- Use a clean rectangle for the final asset. Segmentation-style localization may only be used as a proposal; do not publish mask or non-rectangular crops.
- Prefer a small safe white margin over clipping.
- Reject crops that include surrounding question text, mark text, answer lines, page borders, next-question content, or standalone `Figure N` / `Table N` captions that the worksheet already renders as text.
- If a previous bad crop still contains the whole target visual, refine from that bad crop. If it clips any target content, recrop from the full source page.
- Coordinate convention: origin is top-left; `left` and `top` are inclusive; `right` and `bottom` are exclusive.
- Document uncertain crop decisions as:

```json
{
  "cropBase": "badCrop",
  "bbox": { "left": 0, "top": 0, "right": 100, "bottom": 100 },
  "reasoning": "brief edge-by-edge explanation",
  "risks": []
}
```

## Quality Rules

- The final crop must include every label, axis, legend, option label, table cell, annotation, and visible mark needed by the question.
- Clipped required information is worse than slight extra whitespace.
- Slight extra whitespace or a small duplicated caption/prompt fragment is better than clipping required labels, axes, option diagrams, or table cells.
- Avoid broad page fallbacks and crops with large empty internal whitespace. The target visual should occupy most of the crop while preserving a clean margin.
- If a figure area contains a transcribable text or numeric table, transcribe the table as Markdown in the worksheet even when a crop is also useful.
- For option-diagram questions, crop one complete options block or separate complete option crops. Every candidate label and every option diagram must be fully visible.
- Never validate option-diagram crops as top/bottom portions, used-together fragments, or partial crops.
- When validating a crop, do not make the fresh reviewer infer required content from a broad question summary. Tell it exactly which axes, labels, option letters, diagrams, table cells, or visual annotations must be present, and which surrounding prompt/table/caption text is intentionally excluded because it is transcribed elsewhere.
- If `validate_crop_with_fresh_agent` reports clipped content, missing labels, wrong association, broad full-page fallback, recognizable neighbouring content outside the target visual, or any medium/high severity issue, fix the crop and validate again before publishing.
- If validation reports only a small duplicated caption/prompt fragment or harmless extra whitespace while all expected visual content is complete and readable, record it as a minor issue and keep the crop. Do not spend repeated turns chasing a cosmetic crop when the figure is usable.
- If `crop_image` or `trim_image` changes a linked worksheet asset after crop validation, validation is stale. Rerun the fresh validation and rewrite the crop-validation record.
- Use `pad_image` only after a crop has already passed fresh validation and only to add a clean white border. Never use padding to fix missing content, clipping, unrelated text, or a failed crop review.
- If `pad_image`, `trim_image`, or a recrop creates a new output file, the worksheet image link, crop-validation record, and any subsequent fresh validation call must all use that exact new path. Do not change `.png` paths to `.jpg`, do not invent parallel filenames, and do not link a file path that was not produced by a tool.
- If one manual crop-and-view correction for the same target is still clipped, noisy, or uncertain, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` before spending more turns on hand-tuned crop boxes.
- When the same visual target fails for the same reason after a manual correction, treat that as a wrong-path signal. Switch strategy: call `propose_crop_bbox_with_fresh_agent`, `extract_pdf_images`, or `extract_pdf_diagrams` for the source page and target label instead of continuing hand-tuned crop boxes. If you already tried the relevant alternatives, call `review_run_progress_with_fresh_agent`.
- Do not work around image budgets or blocking crop review by linking a full page fallback, publishing known-failed blocking validation, or relabelling a noisy crop as passing. Minor duplicated caption fragments may pass when all expected visual content is complete.
- If an image tool reports that the pre-publish image-edit budget was exceeded, stop guessing crop boxes for that output and call `review_run_progress_with_fresh_agent`. Use existing validated crops only; do not publish failed, noisy, or full-page fallback crops.
- If direct image viewing is unavailable for a workspace image or rendered PDF page, do not ignore the image. Use `crop_image` to create a local PNG overview or relevant crop under the output assets directory, then inspect that generated image through a fresh-context visual helper before publishing.

## Worksheet Placement

- Source references and transcription files are audit trails only. If a prompt mentions an answer-critical diagram, graph, chart, map, table, network, photo, or other visual, the visible worksheet prompt must include the crop near that text or explicitly point to that exact figure in the linked original/source PDF when the visual should remain in the source document.
- Do not avoid image obligations by rewriting a figure question as text-only, omitting the `Figure N` reference, or saying the figure was not needed because the student left it blank. Source-faithful sheets must preserve the source visual reference for every source subquestion where the original paper uses that visual to answer the question.
- Prefer crops for ordinary source visuals that are actually present in the uploaded/source PDF and feasible to crop. Use a linked original/source PDF reference as a fallback for visuals that are not available as pixels in the working source, are supplied only through a source link, or cannot be cropped without making a broken/fake visual.
- For compact handwritten grading reports, linked original/source PDF instructions are acceptable and usually preferred for source-paper visuals. Do not start a crop-and-validation loop for every figure in a long source paper unless those crops are needed for the grading feedback itself.
- Do not treat public-PDF figure omissions, source-insert omissions, or source notices as blockers. Spark is making a private student study UI that can link to the original/source PDF. When the visual should remain in that linked PDF instead of becoming a worksheet crop, keep the question and write a visible instruction such as `Use Figure N in the linked original PDF.` Do not exclude a source question, remove its marks, or call it ungradable solely because a public PDF omits a figure/map/photo or because an insert is missing.
- Only report a blocking issue when the question cannot be understood or graded from the uploaded/official source material and no useful source-PDF reference is available.
- Put the crop at the nearest source-faithful level:
  - parent `group.prompt` when the visual is before the first subpart or shared by all subparts,
  - child prompt when the visual is introduced inside one subquestion.
- Put `Figure N` caption text adjacent to the `Figure N` crop, and `Table N` caption text adjacent to the `Table N` table.
- Render a reused visual once at the first source-faithful location, then refer to it later with an anchor link or with `Figure N above` / `Table N above`.
- Use clickable image Markdown with a real workspace-relative target, for example `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)` or `[![Figure 1](grader/output/assets/q1-figure-1-border.png)](grader/output/assets/q1-figure-1-border.png)` when the final tool output is PNG.
- Do not publish empty image frames, placeholder ovals, broken links, or broad blank crops. If the crop asset cannot be produced and validated, use an explicit linked original/source PDF reference instead of a fake crop when that gives the student access to the real visual.
- Before publishing, compare worksheet Markdown against source/transcription references: every visible `Figure N` that matters must have a nearby image link or visible linked-source-PDF instruction, and every visible `Table N` that is text/numeric must have a nearby Markdown table.

## Validation Record

For each final linked crop, write a validation note with:

- crop path,
- source question and figure/table label,
- `fresh-context subagent checked: yes`,
- reviewer-visible text transcribed from the crop,
- exact `pass/fail: pass|fail`,
- whether all question-relevant content is visible,
- whether duplicated caption/question/table text was excluded unless part of a visual label, axis, or legend,
- whether unrelated neighbouring content outside the target visual is present,
- whether required content touches or is clipped by an edge,
- whether page borders, separator lines, answer lines, or neighbouring-question fragments are present.

Use the `reviewMarkdown` returned by `validate_crop_with_fresh_agent` as the basis for these records. If the reviewer returned `pass/fail: pass`, keep that as the authoritative result and record small duplicated caption/prompt fragments or harmless extra context as minor notes, not unresolved failures. Do not publish linked crop assets without this per-image validation record.
