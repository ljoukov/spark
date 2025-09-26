# Agents Guide

- Source of truth: `docs/SPEC.md`. Follow it for requirements, interfaces, APIs, and conventions.
- Scope: This AGENTS.md applies to the entire repository subtree.
- Precedence: Direct system/developer/user instructions take precedence over this file.
- Detailed UI flows is defined and maintained in `docs/FLOW.md` file.
- SvelteKit has had many recent updates (eg ropes), docs are in `web/docs/sveltekit-docs.md`
- /app and /admin UIs are built shadcn-svelte, docs are in `web/docs/shadcn-svelte.md`

## Repository Setup

- After cloning, sync submodule URLs with `git submodule sync --recursive`.
- Initialize and update all submodules with `git submodule update --init --recursive`.
- Re-run the update command if new submodules are added or refs change.

For details, read `docs/SPEC.md`.

IMPORTANT: maintain (i.e. make changes if contradicting changes are made or critical details are missing):

- `docs/SPEC.md` general technical stack
- `docs/FLOW.md` for changes to UI/UX of the app (iOS or web, this does NOT apply to /admin)

## Offline LLM Eval

- Script: `web/src/lib/server/llm/eval/offline/run-eval.ts`
- NPM script: from repo root run `npm --prefix web run eval:offline` (or `cd web && npm run eval:offline`).
- Stages: pass `--stage=all` (default), `--stage=generate` (LLM calls + JSON), or `--stage=render` (re-render markdown reports only).
- Inputs: reads sample files in `data/samples/**` (grouped by category directories).
- Outputs: JSON under `web/static/admin/sample-quizzes/**` and markdown reports under `docs/reports/sample-quizzes/**`.
- Env: requires `GEMINI_API_KEY` (in environment or `.env.local` at repo root). Optional proxy vars `HTTPS_PROXY`/`HTTP_PROXY` respected.
- Behavior: uses the same fixed question counts as production (base=10, extension=10) for consistency; not configurable via env.
- Purpose: generates sample quizzes using production prompt builders, judges them, and writes artifacts used by the Admin UI and reports.

# Commit Message Guidelines

- Format: `[type[/scope]] short summary (why if not obvious)`
- Types: `feat`, `fix`, `config`, `docs`, `refactor`, `chore`, `ci`
- Keep it short (≈ 50–72 chars), imperative mood, no filler.
- Say exactly what changed; add a short why if it’s not obvious.

Scope (optional)

- Use a narrow area when helpful: `ios`, `android`, `api`, `ui`, `build`.
  - You can also use top-level app scopes when helpful: `web`, `mobile`, `server`.

Body: empty

Good examples

- `[config/ios] set ITSAppUsesNonExemptEncryption=false (export compliance)`
- `[feat] add deep-link handler for shared URLs`
- `[fix/api] debounce search to reduce request load`
- `[refactor/ui] extract LinkCard component to simplify render`
- `[docs] add README section on env setup`
- `[chore] bump expo to 51.0.6`

Avoid

- Vague: `update`, `misc`, `wip`, `minor fixes`, `more tweaks`.
- Empty why when the change isn’t self-explanatory.

Notes

- Prefer small, cohesive commits; split unrelated changes.
- Use `config` for build/release/app settings; `ci` for pipelines.

## Code Style

- Braces: ALWAYS use `{}` for all control statements (`if/else`, `for`, `while`, `do`, `try/catch`), even when there is a single statement; do not write one‑liners without braces.

## Validation

- Zod: ALWAYS use `zod` for runtime validation and parsing of external inputs (API request bodies, query params, headers, environment/config, webhook payloads, third‑party responses). Avoid ad‑hoc `typeof` checks.
  - Normalize with `transform()` to return a clean, typed shape for downstream logic.
  - On validation errors, return a clear 4xx with an error summary (do not throw raw exceptions).
