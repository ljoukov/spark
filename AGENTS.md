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

## spark-data Submodule

- Install Git LFS once (`brew install git-lfs && git lfs install`). The `spark-data/eval-output/` directory is packaged into `eval-output.tar.gz` and tracked via LFS to keep the repository responsive.
- To align your workspace with `origin/main`, run `scripts/git-sync-spark-data.sh`. It fast-forwards the submodule checkout to the commit referenced by `origin/main` and restores `spark-data/eval-output/` from the tarball when available.
- When you change files inside `spark-data/`, keep generated artifacts under `spark-data/eval-output/`, then run `scripts/git-publish-spark-data.sh "spark-data commit message" "[optional super repo commit message]"`. The script repackages `eval-output/`, commits and pushes the submodule, and updates the super-repo pointer (default commit message `[chore] update spark-data to <sha>`).
- Both scripts abort if the working trees are dirty; commit or stash unrelated changes first.
- The legacy helper scripts (`spark-data/output-pack.sh`, `spark-data/output-unpack.sh`, and `spark-data/AGENTS.md`) were removed in favour of the repo-level tooling above; do not recreate them.

For details, read `docs/SPEC.md`.

IMPORTANT: maintain (i.e. make changes if contradicting changes are made or critical details are missing):

- `docs/SPEC.md` general technical stack
- `docs/FLOW.md` for changes to UI/UX of the app (iOS or web, this does NOT apply to /admin)

## Offline LLM Eval

- Prepare input: `eval/src/offline/prepare-input.ts` (`npm --prefix eval run prepare-input`). Reads raw assets from `spark-data/downloads/**`, classifies them, and writes curated bundles to `spark-data/eval-input/**`.
- Generate quizzes: `eval/src/offline/run-eval.ts` (`npm --prefix eval run run`). Consumes `spark-data/eval-input/**` and writes quiz JSON (including indexes) to `spark-data/eval-output/**`.
- `eval:run` flags: `--seed=<int>` reproducibly shuffles input ordering, `--maxPrefix=<int>` filters page buckets by their numeric prefix (e.g. `--maxPrefix=20` keeps `01_page`–`20-to-49_pages`), and `--limit=<n>` caps the remaining queue after filters.
- Audit summaries: `eval/src/offline/audit-eval.ts` (`npm --prefix eval run audit`). Consumes `spark-data/eval-output/**` and emits stats plus Markdown reports under `spark-data/eval-audit/**`.
- Env: requires `GEMINI_API_KEY` (in environment or `.env.local` at repo root). Optional proxy vars `HTTPS_PROXY`/`HTTP_PROXY` respected.
- Behavior: uses the same fixed question counts as production (base=10, extension=10) for consistency; not configurable via env.
- Purpose: generates sample quizzes using production prompt builders, judges them, and writes artifacts consumed by the Admin UI.

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
