---
name: source-image-cropping
description: Use when a worksheet or grader run needs a visible crop of a source figure, diagram, graph, table, photo, or diagram-option block.
---

# Source Image Cropping

Use this skill to turn source-page visuals into worksheet-visible image assets.

For handwritten grading, use this skill for every included source item whose wording names, points to, or depends on a source figure, diagram, graph, table, photo, or option block. A linked original/source PDF instruction is not a valid first-pass substitute for an uploaded/source PDF visual; artifact validation rejects ordinary named figures/tables that are only referenced as "linked original PDF" when source pixels or table text are available. Use that fallback only for genuinely unavailable source pixels, such as a missing external insert, and only after the failed render/crop/table attempt is recorded in the plan and source-fidelity audit. Use explicit 1-based `pageNumbers` for every `pdf_to_images` call; `pageNumbers` is required and must be a top-level tool field, not part of `outputDir`.

Do not generate or publish SVG. Use Markdown/LaTeX only for simple horizontal/vertical grids, boxed arrays, and text/number layouts. For angles, geometry diagrams, 3D shapes, graphs, charts, maps, photos, apparatus, option diagrams, or anything complex, use real source pixels.

## Inputs

- Source page image path or an existing bad crop.
- Target question, figure/table/diagram label, and why the visual matters.
- Output asset path under the guarded worksheet asset directory:
  - `grader/output/assets/...` for grader runs,
  - `sheet/output/assets/...` for draft-sheet runs.
- For PDF source material, also create a full rendered source-page JPEG no larger than 1500px on either side under `grader/output/source-pages/...` or `sheet/output/source-pages/...` so clicking the displayed crop opens the whole page.
- For uploaded photo/scan source material, reuse one JPEG source image no larger than 1500px on either side and show localized regions with `#spark-bbox=left,top,right,bottom` fragments instead of cutting multiple copies. Measure bbox coordinates on the exact EXIF-oriented JPEG resized to fit within 1500px on each side; do not use raw camera-pixel coordinates unless the fragment also includes `&spark-source-size=rawWidth,rawHeight`.
- Use the final linked asset path directly. Do not create `-raw`, `-candidate`, `-draft`, `tmp`, or `temp` files under those guarded asset directories that require a later promotion step.

## Workflow

For each target visual, keep an explicit `image-cutting-step N/4` note in the crop plan or crop-validation draft. Do not run more than 4 image-cutting steps for one target visual without calling `review_run_progress_with_fresh_agent` and switching strategy or reporting the blocker.

1. For named figures in official/printed exam PDFs, first decide whether any required labels, axes, group headings, option letters, captions, or side panels may be drawn on the page outside the embedded image object. When labels/context matter, render the exact source pages with `pdf_to_images` and crop from the rendered page instead of spending validation turns on extracted image objects that may omit page-drawn text. Keep or create a 1500px-or-smaller JPEG copy of the full rendered page for the image link target.
2. If the source is a PDF and `extract_pdf_images` is available, run it once as an inventory for simple embedded raster figures, maps, charts, photos, or apparatus images that clearly include all visible labels/context inside the image object. Ignore tiny repeated strips/noise. Do not link `grader/output/pdf-images/...` inventory files directly; if an extracted object is the whole final visual, call `crop_image` with `fullImage: true` and the exact final `outputPath` from the artifact plan under `grader/output/assets/...`. `crop_image` adds a clean white border for final worksheet assets that touch a source-image edge; use `pad_image` only if validation/publish still reports edge contact. When an embedded official figure image includes related subpanels, apparatus side panels, or scale labels inside the same figure object, keep and validate the whole figure instead of repeatedly cropping away useful context.
3. Render PDF pages to high-resolution page images before cropping when embedded images are insufficient, the visual is vector/layout-sensitive, or you need page context for a crop/table. Use the highest useful `pdf_to_images` output and crop from that page image, not from thumbnails or screenshots. Pass 1-based `pageNumbers` from the extracted reference headings or grep context, for example `pageNumbers: [2, 3, 11]`; do not render a medium/long PDF all at once. For click-through, write a JPEG full-page copy with `crop_image({ fullImage: true, paddingPx: 0, outputPath: "grader/output/source-pages/page-0003.jpg" })` after rendering the page.
4. For ambiguous source-page bounds in PDFs, create a labelled coordinate grid with `draw_grid_overlay` and call `propose_crop_bbox_with_fresh_agent` instead of repeatedly inspecting page images in the main agent context. When several figures need proposal from rendered pages, issue the proposal calls in parallel after the page renders/grid overlays are ready.
5. For uploaded photos/scans, do not run the PDF-style refinement loop. Use at most two simple `view_image` passes: first inspect the full 1500px-normalized photo, then inspect a rough localized view/crop if needed to choose the bbox. Link the same source JPEG with a `#spark-bbox=left,top,right,bottom` fragment measured on that normalized photo instead of writing separate crop images.
6. Use direct main-context `view_image` only for bounded source-page/photo fidelity checks; use extraction tools plus fresh-context visual helpers for PDF crop proposals and final PDF-crop validation so image inspection does not pollute the grading context.
7. Choose one rectangular pixel bbox in the selected base image coordinate space.
8. For PDF sources, crop with `crop_image` using `bboxPixels` into the guarded assets directory. For photo sources, do not crop final assets; keep the source JPEG and put the bbox in the Markdown image fragment.
9. Inspect PDF crops with `validate_crop_with_fresh_agent` when available, or another fresh-context visual helper in local/debug flows. In capped grader first-pass assembly, defer this validation until after `sheet.json` and `run-summary.json` exist and `validate_grader_artifacts` reports no schema/placement blocker.
10. Use `trim_image` only after a PDF crop is complete and only to remove safe whitespace.
11. Validate the final linked PDF crop with `validate_crop_with_fresh_agent` when that tool is available. In capped grader runs this is a post-JSON pre-publish step, not a blocker before the first `sheet.json`. Always pass:

- `expectedContent`: the exact printed/visible source content that must be visible in the crop,
- `duplicatedTextToExclude`: prompt/caption/table text that is rendered separately and should not be required inside the crop; use `none` only when no surrounding duplicated text needs exclusion.

12. Validate one final PDF crop per validation call; do not batch several high-risk crops into one review.
13. Record final PDF-crop validation in the caller's crop-validation file before publishing. For photo-source viewport images, record the chosen bbox and the two-pass `view_image` check in the sheet plan/source-fidelity notes instead of crop-validation.
14. Link PDF crops from the visible worksheet prompt with clickable Markdown whose image target is the crop and whose link target is the full source-page JPEG, for example `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/source-pages/page-0003.jpg)`. Link photo viewports with the full source image plus bbox fragment as the image target and the same source image without the fragment as the link target, for example `[![Figure 1](grader/uploads/photo.jpg#spark-bbox=120,240,960,700)](grader/uploads/photo.jpg)`. The bbox example is in the normalized displayed-photo coordinate system, not raw camera pixels.

## Fresh-Context Visual Review

Use a fresh-context visual helper whenever a crop is high-risk: ambiguous figure bounds, dense labels/axes/table cells, option-diagram MCQs, or any target that is still uncertain after one manual correction pass.

The helper may propose or review candidate rectangles, but the published asset must still be one validated rectangular crop.

Use `review_run_progress_with_fresh_agent` whenever the crop loop has repeated the same failure, hit an image-edit budget warning, or reached the 4-step cap for one target visual. The reviewer is for process diagnosis only; it must not grade, assemble worksheet JSON, or replace final crop validation.

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

- The final crop must include every label, axis, legend, option label, table cell, annotation, and visible mark actually printed in the target source visual.
- Do not include inferred answers, hidden context, mark-scheme facts, or unprinted labels in `expectedContent`. If the question asks the learner to infer a group, option, value, or relationship from a figure, validate the crop against the visible figure only and leave the inference to the question text and mark scheme.
- Clipped required information is worse than slight extra whitespace.
- Slight extra whitespace or a small duplicated caption/prompt fragment is better than clipping required labels, axes, option diagrams, or table cells.
- Avoid broad page fallbacks and crops with large empty internal whitespace. The target visual should occupy most of the crop while preserving a clean margin.
- If a figure area contains a transcribable text or numeric table, transcribe the table as Markdown in the worksheet even when a crop is also useful.
- For option-diagram questions, crop one complete options block or separate complete option crops. Every candidate label and every option diagram must be fully visible.
- Never validate option-diagram crops as top/bottom portions, used-together fragments, or partial crops.
- When validating a crop, do not make the fresh reviewer infer required content from a broad question summary. Tell it exactly which visible axes, labels, option letters, diagrams, table cells, or visual annotations must be present, and which surrounding prompt/table/caption text is intentionally excluded because it is transcribed elsewhere.
- If `validate_crop_with_fresh_agent` reports clipped content, missing labels, wrong association, broad full-page fallback, recognizable neighbouring content outside the official target visual, or any medium/high severity issue, fix the crop and validate again before publishing. Treat related subpanels inside the same official embedded figure/table image as target context, not neighbouring-question noise, when all expected content is visible.
- If repeated validation failures are caused by content that is not actually printed in the source visual, correct `expectedContent` and continue instead of recropping.
- If validation reports only a small duplicated caption/prompt fragment or harmless extra whitespace while all expected visual content is complete and readable, record it as a minor issue and keep the crop. Do not spend repeated turns chasing a cosmetic crop when the figure is usable.
- If a text/numeric table or formula can be rendered faithfully as Markdown or LaTeX from extracted source text, render it that way instead of repeated crop refinement.
- If validation fails only because `expectedContent` asked for inferred or unprinted content, such as a group name, answer, placeholder, or heading that is not visible in the source figure, fix `expectedContent` and rerun validation once. Do not recrop an otherwise complete visual to chase pixels that the source never printed.
- If `crop_image` or `trim_image` changes a linked worksheet asset after crop validation, validation is stale. Rerun the fresh validation and rewrite the crop-validation record.
- Use `pad_image` only to add a clean white border around otherwise complete source visuals. If a crop already passed fresh validation, do not rerun validation just because padding wrote the final linked path; record the final padded path in `crop-validation.md` and note the passed source validation. If the only failure was required content touching the edge while all content was visible, pad once and validate only that padded asset.
- If `pad_image`, `trim_image`, or a PDF recrop creates a new output file, the worksheet image link, crop-validation record, and any subsequent fresh validation call must all use that exact new path. Choose the intended final extension before writing; prefer `.jpg` for source-backed worksheet visuals that do not need transparency. Do not invent parallel filenames, and do not link a file path that was not produced by a tool.
- If one manual crop-and-view correction for the same target is still clipped, noisy, or uncertain, call `propose_crop_bbox_with_fresh_agent` or `extract_pdf_diagrams` before spending more turns on hand-tuned crop boxes.
- When the same visual target fails for the same reason after a manual correction, treat that as a wrong-path signal. Switch strategy: call `propose_crop_bbox_with_fresh_agent`, `extract_pdf_images`, or `extract_pdf_diagrams` for the source page and target label instead of continuing hand-tuned crop boxes. If you already tried the relevant alternatives, call `review_run_progress_with_fresh_agent`.
- Do not work around image budgets or blocking crop review by linking a full page fallback, publishing known-failed blocking validation, or relabelling a noisy crop as passing. Minor duplicated caption fragments may pass when all expected visual content is complete.
- If an image tool reports that the pre-publish image-edit budget was exceeded, stop guessing crop boxes for that output and call `review_run_progress_with_fresh_agent`. Use existing validated crops only; do not publish failed, noisy, or full-page fallback crops.
- If direct image viewing is unavailable for a workspace image or rendered PDF page, do not ignore the image. For PDF sources, use `crop_image` to create a local overview or relevant crop under the output assets directory, then inspect that generated image through a fresh-context visual helper before publishing. For uploaded photos/scans, inspect the full JPEG and, if needed, one rough localized view before choosing the `#spark-bbox` rectangle.

## Worksheet Placement

- Source references and transcription files are audit trails only. If a prompt names or points to a diagram, figure, graph, chart, map, table, network, photo, or other visual, the visible worksheet prompt must include the PDF crop or photo viewport near that text whenever the source pixels are available.
- Do not avoid image obligations by rewriting a figure question as text-only, omitting the `Figure N` reference, or saying the figure was not needed because the student left it blank. Source-faithful sheets must preserve the source visual reference for every source subquestion where the original paper uses that visual to answer the question.
- Prefer crops for ordinary source visuals that are actually present in the uploaded/source PDF and feasible to crop. For uploaded photos/scans, prefer one source JPEG plus localized `#spark-bbox` viewports over repeated crop files. Do not use a linked original/source PDF reference for ordinary PDF visuals in the first-pass worksheet; validation will reject the artifact. Only use a source-PDF reference when the visual pixels are genuinely unavailable in the working source or would require a fake/broken crop after a recorded bounded attempt.
- For compact handwritten grading reports, do not recreate irrelevant exam layout, but do crop every named figure/table/diagram block used by an included source item; do not omit it because the mark scheme makes the answer inferable.
- Do not treat public-PDF figure omissions, source-insert omissions, or source notices as blockers. Spark is making a private student study UI that can link to the original/source PDF only when the actual visual is missing from the working source. When a required visual truly cannot be embedded after a real render/crop/table attempt, keep the question and write a visible instruction such as `Use Figure N in the linked original PDF.` Do not exclude a source question, remove its marks, or call it ungradable solely because a public PDF omits a figure/map/photo or because an insert is missing.
- Only report a blocking issue when the question cannot be understood or graded from the uploaded/official source material and no useful source-PDF reference is available.
- Put the crop at the nearest source-faithful level:
  - parent `group.prompt` when the visual is before the first subpart or shared by all subparts,
  - child prompt when the visual is introduced inside one subquestion.
- Put `Figure N` caption text adjacent to the `Figure N` crop, and `Table N` caption text adjacent to the `Table N` table.
- Render a reused visual once at the first source-faithful location, then refer to it later with an anchor link or with `Figure N above` / `Table N above`.
- For PDF sources, use clickable image Markdown where the image target is the guarded crop and the link target is the full rendered source-page JPEG, for example `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/source-pages/page-0003.jpg)`. For uploaded photos/scans, use the full source JPEG plus `#spark-bbox=left,top,right,bottom` as the image target and the same JPEG without the fragment as the link target; measure the bbox on the EXIF-oriented, 1500px-normalized displayed image. Never link scratch extraction inventory files such as `grader/output/pdf-images/...`; first copy/crop the final visual into `grader/output/assets/...`.
- Do not publish empty image frames, placeholder ovals, broken links, or broad blank crops. If an uploaded/source PDF visual exists, keep working with a bounded render/crop/table path or report the blocker; do not replace it with a linked-original shortcut. If the visual is genuinely unavailable after a recorded attempt, use an explicit linked original/source PDF reference instead of a fake crop when that gives the student access to the real visual.
- Before publishing, compare worksheet Markdown against source/transcription references: every included `Figure N` must have a nearby image link unless the validation record explains why embedding was impossible, and every visible `Table N` that is text/numeric must have a nearby Markdown table.

## Validation Record

For each final linked PDF crop, write a validation note with:

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

Use the `reviewMarkdown` returned by `validate_crop_with_fresh_agent` as the basis for these records. If the reviewer returned `pass/fail: pass`, keep that as the authoritative result and record small duplicated caption/prompt fragments or harmless extra context as minor notes, not unresolved failures. Do not publish linked PDF crop assets without this per-image validation record. For uploaded-photo viewport links, record the chosen source JPEG, bbox, and two-pass `view_image` check in `sheet-plan.md` or the source-fidelity notes instead of `crop-validation.md`.
