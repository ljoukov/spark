# Agents Guide

- Source of truth: `docs/SPEC.md`. Follow it for requirements, interfaces, APIs, and conventions.
- Scope: This AGENTS.md applies to the entire repository subtree.
- Precedence: Direct system/developer/user instructions take precedence over this file.

For details, read `docs/SPEC.md`.

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
