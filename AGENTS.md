# Agents Guide

- Source of truth: `docs/SPEC.md`. Follow it for requirements, interfaces, APIs, and conventions.
- Scope: This AGENTS.md applies to the entire repository subtree.
- Precedence: Direct system/developer/user instructions take precedence over this file.
- Use this file as the durable Spark-specific memory across checkouts/worktrees: keep portable repo conventions, runbooks, and debugging notes here when they should survive branch switches.
- Do not add machine-specific or developer-specific state here (absolute paths, usernames, local-only env values, hostnames, ad-hoc checkout state, current dependency pins from one worktree).
- UI/UX flows should be reflected in `docs/SPEC.md` and kept up to date alongside code-level docs.
- SvelteKit has had many recent updates (eg ropes), docs are in `web/docs/sveltekit-docs.md`
- /app and /admin UIs are built shadcn-svelte, docs are in `web/docs/shadcn-svelte.md`

## Repository Setup

- This repo has no required submodules.
- Eval assets and generated artifacts belong under the gitignored `data/` workspace.
- All secrets belong in environment variables. During local dev load them from `.env.local` via `loadLocalEnv()`; in deployed or hosted environments rely on OS-provided env vars (no `.env.local`).
- Use `scripts/create-worktree.sh` to create Spark worktrees. Pass `--bootstrap-only` when the worktree already exists but still needs env-file copies and the root Bun install. The bootstrap copies `.env.local`, `eval/.env.local`, and `web/.env.local` from `SPARK_ENV_SOURCE` (default `$HOME/projects/spark`) when present.
- For non-interactive Git workflows (rebase, squash, etc.), export `GIT_EDITOR=true` and `GIT_SEQUENCE_EDITOR=true` so Git does not spawn an interactive editor.
- Push semantics: if a user asks to "push" without naming a remote/branch, treat it as push to `origin/main`. Only push to another branch when the user explicitly names that branch.
- Long-lived processes should run in the background (e.g. `nohup … &`) with logs redirected to a file. tmux is optional and not required.

## Local Data Workspace

- Keep large local inputs/outputs under `data/` (for example `data/quiz/downloads`, `data/quiz/eval-input`, `data/quiz/eval-output`, `data/code/synthetic`).
- `data/` is intentionally ignored by git. Do not commit licensed or generated datasets into the repository.

## Durable Repo Knowledge

- Spark-specific architecture, workflows, prompts, validation order, and operational runbooks belong here or in repo docs, not in global Codex memory.
- When current Spark behavior matters, inspect the checked-out code, `docs/SPEC.md`, and lockfiles instead of relying on memory from another checkout or prior run.
- Spark uses Bun workspaces with `workspace:*` links and isolated installs. Run `bun install` only at the repo root when manifests or the lockfile change; do not run workspace-level installs such as `bun --cwd=web install`.
- Cloud Run deploys should use immutable image refs (for example `${BUILD_ID}` tags or digests). Reusing a static Artifact Registry tag can leave Cloud Run pinned to a stale digest even when Cloud Build reports success.
- When using Apple’s `container` CLI on macOS for local image tests, interrupted `container build` / `container run` / `container create` commands can leave `container-core-images`, the builder, or other container services consuming CPU after the app process is gone. Before assuming Spark is busy-looping, clean up the local container runtime: kill stray `container ...` CLI processes first if needed, then run `container builder stop` and `container system stop`.
- Treat Spark and `@ljoukov/llm` as jointly evolved: breaking `@ljoukov/llm` API changes are acceptable when Spark is updated in the same rollout and dependent docs/tests stay in sync.
- For grader/reference-material handling, preserve official statements verbatim except for minimal OCR/layout cleanup, and keep task templates, prompt builders, and `docs/SPEC.md` aligned when that contract changes.

## Spark Agent Workspaces

- Durable Spark-specific agent/workspace conventions belong here in `AGENTS.md`, not in global Codex memory.
- In local dev, Spark background agents and chat log workspaces should use the standard Spark workspace root under `data/spark-agent/<timestamp>/<workspaceId>` via `SPARK_AGENT_LOCAL_WORKSPACE=1` and `SPARK_AGENT_LOCAL_WORKSPACE_BASE_DIR`.
- Spark creates the workspace root and most top-level workspace files/directories (`brief.md`, `request.json`, `grader/**`, `lesson/**`, tutor `context/**`/`ui/**`/`state/**`, and `.spark-agent-replay/**` when enabled).
- `@ljoukov/llm` is responsible for nested logging artifacts only after Spark passes `logging.workspaceDir`: expect `<workspace>/logs/agent/agent.log` and `<workspace>/logs/agent/llm_calls/**`.
- Spark-owned tool debug artifacts should continue to live under `<workspace>/logs/agent/tool_calls/**`.
- The direct chat route uses the same workspace-root helper with a synthetic workspace id like `chat-<conversationId>-<messageId>`; in local dev its logs should still land under the standard `data/spark-agent/...` tree.
- Tutor draft inline-feedback generation currently updates the tutor workspace in Firestore but does not configure local `runAgentLoop` file logging; do not assume it writes `logs/agent/**`.

For details, read `docs/SPEC.md`.

IMPORTANT: maintain (i.e. make changes if contradicting changes are made or critical details are missing):

- `docs/SPEC.md` general technical stack
- Update `docs/SPEC.md` for changes to UI/UX of the app (iOS or web; this does NOT apply to /admin)

## Schemas: Browser vs Server

- `packages/schemas/` is for browser-safe, shared Zod schemas and TS types consumed by the web app and other browser contexts. These must be importable in client code (no server-only concerns, credentials, or privileged shapes).
- Server-only schemas (e.g., internal background tasks, admin-only payloads) must live in server packages, e.g. `@spark/llm` under an appropriate folder (`packages/llm/src/**`). Import these from server code only (SvelteKit server routes, hooks, or Node utilities).

## Quiz LLM Eval

- Prepare input: `eval/src/quiz/eval/prepare-input.ts` (`bun --cwd=eval run quiz:prepare-input`). Reads raw assets from `data/quiz/downloads/**`, classifies them, and writes curated bundles to `data/quiz/eval-input/**`.
- Generate a quiz JSON from a single PDF: `eval/src/quiz/generateQuiz.ts` (`bun --cwd=eval run quiz:generate -- --input-file <path>`). Prints the quiz definition to stdout.
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
- Do not mention co-author trailers in user-facing commit summaries (report the commit hash/message only).

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
