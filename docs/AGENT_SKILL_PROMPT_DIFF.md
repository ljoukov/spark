# Agent Skill Prompt Diff

This report compares the reusable skill files against the grader workflow text that was hard-coded in `origin/main`.

## Structural Change

- Before: `renderSparkGraderTask()` appended a large prompt block directly into every grader task. That block embedded the handwriting transcription workflow, paper modeling rules, crop workflow, grading rules, summary rules, and run-mode constraints.
- Now: grader and sheet prompts reference workspace skill files under `skills/<name>/SKILL.md`; Spark materializes those files into the agent workspace before launch.
- Run-specific path and publication constraints remain in the task/prompt because they are not reusable skills: output paths, `publish_sheet({})`, `publish_sheet_draft({})`, summary JSON shape, and the rule that generic `spawn_agent` is bounded to sidecar lookup/visual-proposal work in grader runs.
- Build inclusion is generated: `packages/llm/scripts/generate-agent-skills.ts` reads repo-root `skills/*/SKILL.md` and emits `src/agent/generated/sparkAgentSkills.generated.ts`, so package builds no longer depend on bundler-only `?raw` imports or runtime filesystem reads.

## Moved Into Skills

- `paper-to-sheet` now owns source-vs-notes mode selection, source-faithful worksheet modeling, supported question-type selection, marks-on-question requirements, section grouping, source numbering, table handling, and visible figure/table placement.
- `source-image-cropping` now owns high-resolution page rendering, grid-first rectangular cropping, crop validation, guarded asset paths, final Markdown image-link syntax, and no-placeholder/no-full-page-fallback rules.
- `handwritten-answers-to-sheet` now owns student-answer capture, mixed prompt/answer separation, objective answer selection rules, source-paper-only unanswered mode, existing-draft grading, answer-state shapes, and per-question scoring requirements.
- `gap-finder` now owns weak-question selection, gap type definitions, dedupe judgement, card wording, learning-flow construction, allowed step shapes, and the final JSON quality gate for generated practice gaps.

## Differences That Were Intentional

- The agent prompt and task prompt no longer inline all reusable workflow prose. They list the skill paths and ask the agent to read them.
- The old grader-only crop instructions are split so draft-sheet creation can also reuse `paper-to-sheet` and `source-image-cropping`.
- Metadata now comes from each skill's YAML header and generated TypeScript, instead of duplicated TypeScript strings.
- The grader task keeps a short "grader-specific skill constraints" section for runtime limits such as keeping final grading on the main agent and using `validate_crop_with_fresh_agent` for final crop review.
- The gaps-finder code remains a deterministic batch runner rather than a full tool-loop agent. It writes `skills/gap-finder/SKILL.md` into the workspace for auditability, and the direct `generateText` prompt includes the bundled skill content because that model call cannot read workspace files itself.

## Regressions Found In The First Skill Extraction

The first extraction was too compressed. Compared with `origin/main`, it omitted or weakened several operational rules:

- Exact final image-link syntax was missing: `[![Figure 1](grader/output/assets/q1-figure-1.jpg)](grader/output/assets/q1-figure-1.jpg)`.
- The allowed guarded asset directories were not explicit: `grader/output/assets/...` and `sheet/output/assets/...`.
- The old prompt's "references/transcription are audit trails only" rule was too weak, so an agent could leave a visual in references instead of the visible worksheet.
- The old prompt required every named figure/table reference to be cross-checked before publishing; the first skills version only said visuals should be linked generally.
- The old prompt strongly rejected empty placeholders, broad full-page fallbacks, noisy crops, and missing labels/options/axes; the first skills version did not call out visible placeholder/empty-frame failures directly.
- The old prompt required one fresh crop validation per final linked crop and a detailed `grader/output/crop-validation.md`; the first skills version summarized that contract.
- The old prompt included the `view_image` failure fallback through a generated local crop; the first skills version did not.
- The old prompt made per-question review scores mandatory when student answers are present, with `score.total` equal to question `marks`; the first skills version did not state the all-or-none scoring rule clearly enough.
- The old prompt had stricter source-paper-only rules: omit solution/rationale fields and do not write placeholder "no solution" text. The first skills version only said not to expose an answer key.
- Official-source lookup did not yet require examiner reports, grade boundaries, prize thresholds, or medal cutoffs, so real exam/competition outcome reporting was easy to omit.

## Current Delta After This Iteration

- The missing image-link, guarded-asset, no-placeholder, named-reference cross-check, validation-record, and `view_image` fallback rules are now in `source-image-cropping` and `paper-to-sheet`.
- The missing per-question scoring, all-or-none scoring, blank-answer, answer-state, and source-paper-only omission rules are now in `handwritten-answers-to-sheet`.
- After syncing with `origin/main`, the new hard-coded gaps-finder workflow text was moved into `skills/gap-finder/SKILL.md`. Code still keeps the output example, Zod schema, normalizers, queue handling, Firestore writes, and parse/retry behavior because those are deterministic harness responsibilities.
- `handwritten-answers-to-sheet` now requires a solid official-source lookup effort when allowed, including mark schemes, official solutions, examiner reports, grade boundaries, prize thresholds, and medal cutoffs when relevant. It also requires real-world outcome reporting when an official boundary/threshold source supports it.
- Grader runs can now use bounded generic subagents for official-reference lookup/verification or visual localization proposals, while the main agent still owns upload inventory, transcription, scoring, and sheet assembly. Final crop validation remains the dedicated `validate_crop_with_fresh_agent` path.
- The skills are still shorter than the old monolithic prompt, but the high-risk operational gates that affected marks display and missing images have been restored.

## Remaining Prompt Locations By Design

- `graderAgentPrompt.ts`: global grader publication, workspace file reading rules, model-tool limits, and worksheet-output requirements.
- `sheetDraftAgentPrompt.ts`: global draft-sheet publication and run-summary requirements.
- `sparkChatShared.ts`: launch-plan construction and short skill-path resolver sections.
- `web/src/lib/server/*/task-template.md`: JSON contract examples, exact output paths, and run deliverables.
