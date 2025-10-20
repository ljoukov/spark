# Agents Guide

- Source of truth: `docs/SPEC.md`. Follow it for requirements, interfaces, APIs, and conventions.
- Scope: This AGENTS.md applies to the entire repository subtree.
- Precedence: Direct system/developer/user instructions take precedence over this file.
- UI/UX flows should be reflected in `docs/SPEC.md` and kept up to date alongside code-level docs.
- SvelteKit has had many recent updates (eg ropes), docs are in `web/docs/sveltekit-docs.md`
- /app and /admin UIs are built shadcn-svelte, docs are in `web/docs/shadcn-svelte.md`

## Repository Setup

- After cloning, sync submodule URLs with `git submodule sync --recursive`.
- Initialize and update all submodules with `git submodule update --init --recursive`.
- Re-run the update command if new submodules are added or refs change.
- All secrets belong in environment variables. During local dev load them from `.env.local` via `loadLocalEnv()`; in deployed or hosted environments rely on OS-provided env vars (no `.env.local`).
- For non-interactive Git workflows (rebase, squash, etc.), export `GIT_EDITOR=true` and `GIT_SEQUENCE_EDITOR=true` so Git does not spawn an interactive editor.
- Run every interactive command inside tmux — this is mandatory for long-lived processes like `git rebase`, dev servers (`npm run dev`, `npm --prefix web run dev`), database shells, etc. Start sessions with `tmux new-session -s <name>` (install via `brew install tmux` if missing) and attach with `tmux attach -t <name>` so the process stays healthy if the terminal disconnects.

## spark-data Submodule

- Install Git LFS once (`brew install git-lfs && git lfs install`). The `spark-data/quiz/eval-output/` directory is packaged into `eval-output.tar.gz` and tracked via LFS to keep the repository responsive.
- To align your workspace with `origin/main`, run `scripts/git-sync-spark-data.sh`. It fast-forwards the submodule checkout to the commit referenced by `origin/main` and restores `spark-data/quiz/eval-output/` from the tarball when available.
- When you change files inside `spark-data/`, keep generated artifacts under `spark-data/quiz/eval-output/`, then run `scripts/git-publish-spark-data.sh "spark-data commit message" "[optional super repo commit message]"`. The script repackages `eval-output/`, commits and pushes the submodule, and updates the super-repo pointer (default commit message `[chore] update spark-data to <sha>`).
- Both scripts abort if the working trees are dirty; commit or stash unrelated changes first.
- The legacy helper scripts (`spark-data/output-pack.sh`, `spark-data/output-unpack.sh`, and `spark-data/AGENTS.md`) were removed in favour of the repo-level tooling above; do not recreate them.

For details, read `docs/SPEC.md`.

IMPORTANT: maintain (i.e. make changes if contradicting changes are made or critical details are missing):

- `docs/SPEC.md` general technical stack
- Update `docs/SPEC.md` for changes to UI/UX of the app (iOS or web; this does NOT apply to /admin)

## Quiz LLM Eval

- Prepare input: `eval/src/quiz/prepare-input.ts` (`npm --prefix eval run prepare-input`). Reads raw assets from `spark-data/quiz/downloads/**`, classifies them, and writes curated bundles to `spark-data/quiz/eval-input/**`.
- Generate quizzes: `eval/src/quiz/run-eval.ts` (`npm --prefix eval run eval`). Consumes `spark-data/quiz/eval-input/**` and writes quiz JSON (including indexes) to `spark-data/quiz/eval-output/**`.
- Runner flags: pass via `npm --prefix eval run eval -- --seed=<int>`; `--seed=<int>` reproducibly shuffles input ordering, `--maxPrefix=<int>` filters page buckets by their numeric prefix (e.g. `--maxPrefix=20` keeps `01_page`–`20-to-49_pages`), and `--limit=<n>` caps the remaining queue after filters.
- Audit summaries: `eval/src/quiz/audit-eval.ts` (`npm --prefix eval run audit`). Consumes `spark-data/quiz/eval-output/**` and emits stats plus Markdown reports under `spark-data/quiz/eval-audit/**`.
- Env: requires `GOOGLE_SERVICE_ACCOUNT_JSON` (in environment or `.env.local` at repo root) with access to Gemini (Vertex AI) and Text-to-Speech APIs. Optional proxy vars `HTTPS_PROXY`/`HTTP_PROXY` respected.
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
- Prefer compile-time exhaustiveness checks for discriminated unions and enums. NEVER paper over missing cases with runtime fallbacks like `throw new Error("Unsupported ...")`; instead structure logic (e.g. local IIFE pattern) so the type system forces every variant to compile.
- When writing `switch`es over union types, list every variant explicitly and avoid unreachable `const x: never = value` guard blocks — missing cases should remain TypeScript errors without relying on runtime throws.
- Avoid unnecessary wrappers or indirection. Prefer the simplest structure that keeps types safe (e.g. drop redundant async lambdas once exhaustiveness is enforced).

## Validation

- Zod: ALWAYS use `zod` for runtime validation and parsing of external inputs (API request bodies, query params, headers, environment/config, webhook payloads, third‑party responses). Avoid ad‑hoc `typeof` checks.
  - Normalize with `transform()` to return a clean, typed shape for downstream logic.
  - On validation errors, return a clear 4xx with an error summary (do not throw raw exceptions).
- Prefer trusting TypeScript’s static analysis: check for `undefined`/`null` instead of using `typeof` to re-discover declared types. Only add runtime type guards when the type truly is ambiguous (rare).
- Avoid `Array.prototype.forEach` for control-flow heavy logic; use `for..of` so `break`, `continue`, and early returns remain obvious.
- Prefer `for..of` when iterating sequentially; use index-based loops only when the index is required (parallel arrays, slicing, etc.).
- Favor `.map()` (or `.flatMap`) when the loop purpose is to transform into a new array without side effects.
- Do not use `Array.isArray` (or similar runtime shape checks) when the type already guarantees an array; prefer `value !== undefined` / `value !== null` checks unless the type is genuinely ambiguous.
