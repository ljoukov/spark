# @spark/llm Agent Notes

- Scope: applies to `packages/llm/**`.
- Follow repository-wide rules from the root `AGENTS.md` and `docs/SPEC.md`.

## File Dependency Refresh (required)

`@spark/llm` is consumed as a Bun workspace dependency by:

- `web/package.json` (`"@spark/llm": "workspace:*"`)
- `eval/package.json` (`"@spark/llm": "workspace:*"`)

After changing `packages/llm/src/**` (especially exports, tool behavior, or runtime logic), validate the consumers directly. Only rerun `bun install` when package manifests or the lockfile changed, and do that from the repo root only.

1. `bun --cwd=packages/llm run typecheck`
2. `bun --cwd=web run typecheck`
3. `bun --cwd=eval run typecheck` (or a narrower eval check relevant to your change)

Why: the workspace dependency now stays live through Bun's isolated workspace layout, so source edits should be visible without per-package reinstalls. If manifests changed, a root `bun install` refreshes the workspace graph for every consumer in one step.

If a dev server or worker is already running, restart it after source or manifest changes so in-memory modules pick up the refreshed dependency graph.
