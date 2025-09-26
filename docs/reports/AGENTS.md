# Reports Guide

- This directory contains generated reports. The `sample-quizzes` folder is produced by the offline eval tool and should not be edited by hand.

## Source of Truth

- Generator script: `web/src/lib/server/llm/eval/offline/run-eval.ts`
- NPM script: run from repo root with `npm --prefix web run eval:offline`
- Stages:
  - `--stage=all` (default): regenerate JSON + markdown
  - `--stage=generate`: run LLM calls and write JSON only
  - `--stage=render`: re-render markdown reports from existing JSON

## Inputs and Outputs

- Inputs: `data/samples/**`
- Outputs:
  - JSON: `web/static/admin/sample-quizzes/**`
  - Reports (markdown): `docs/reports/sample-quizzes/**`

## Do Not Edit Manually

- Files under `docs/reports/sample-quizzes/**` are generated. Do not hand-edit these files and do not attempt to line-merge them.
- If you see merge/rebase conflicts in these reports, resolve by choosing one side entirely:
  - Keep your current branch’s generated files: “Accept Yours/Current”.
  - Take the incoming generated files: “Accept Theirs/Incoming”.
  - Never mix both sides. The outputs must come from a single generation run to stay consistent with the JSON in `web/static/admin/sample-quizzes/**`.
- If the best resolution isn’t obvious, prefer re-running the generator to produce a clean, consistent set.

## Regeneration Notes

- Regenerating the full set typically takes about 30 minutes (depends on model and quota).
- Environment:
  - Requires `GEMINI_API_KEY` (env var or `.env.local` at repo root)
- Example commands:
  - From repo root: `npm --prefix web run eval:offline -- --stage=all`
  - Re-render reports only: `npm --prefix web run eval:offline -- --stage=render`

## Consistency with Production

- The offline generator uses the same fixed question counts as production (currently 10 for base and 10 for extension). This is intentional to keep reports comparable and stable. There is no env override.

## Rationale

- Generated content is non-deterministic across runs. Keeping an atomic, single-source generated snapshot avoids noisy diffs and broken cross-links between JSON and markdown.
