# @spark/llm Agent Notes

- Scope: applies to `packages/llm/**`.
- Follow repository-wide rules from the root `AGENTS.md` and `docs/SPEC.md`.

## File Dependency Refresh (required)

`@spark/llm` is consumed as a local `file:` dependency by:

- `web/package.json` (`"@spark/llm": "file:../packages/llm"`)
- `eval/package.json` (`"@spark/llm": "file:../packages/llm"`)

After changing `packages/llm/src/**` (especially exports, tool behavior, or runtime logic), you must refresh consumer installs before trusting runtime behavior:

1. `bun --cwd=packages/llm run typecheck`
2. `bun --cwd=web install`
3. `bun --cwd=eval install`
4. `bun --cwd=web run typecheck`
5. `bun --cwd=eval run typecheck` (or a narrower eval check relevant to your change)

Why: without reinstalling consumers, `web/node_modules/@spark/llm` and `eval/node_modules/@spark/llm` can keep stale snapshots and run old code even when `packages/llm/src` is updated.

If a dev server or worker is already running, restart it after the install step so in-memory modules pick up the refreshed dependency.
