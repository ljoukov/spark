# Web Color System

This document defines how we manage colors across the Spark web experience.

## Theme primitives

Global color tokens live in `web/src/app.css`. They mirror the shadcn-svelte preset variables and
are expressed as OKLCH values so we can tune lightness and chroma without guessing hex codes.

Important variables:

- `--background`, `--foreground`, `--card`, `--popover`, `--muted`, etc. — foundations for shadcn
  components.
- `--text-primary`, `--text-secondary`, `--surface-color`, `--surface-border` — convenience aliases
  we use inside custom screens.
- `--sound-toggle-*` and similar — overrides for bespoke UI elements.

We expose two sources of truth for dark mode:

- `[data-theme='dark']` on the `<html>` element (set via the UI theme toggle).
- The OS preference (`prefers-color-scheme: dark`) when the data attribute is not pinned to light.

Any time you add new CSS variables, provide defaults in light mode and override them inside both
selectors so the experience works for all combinations of system and manual themes.

## Local surface tokens

Large bespoke layouts (e.g. `/app` onboarding, auth backdrop) define their own scoped tokens so we
can dial in gradients and glass morphism without fighting the rest of the theme.

Example from `web/src/routes/app/+page.svelte`:

```svelte
<div class="app-page">
  <!-- ... -->
</div>

<style>
  .app-page {
    background:
      radial-gradient(120% 120% at 50% -10%, var(--app-halo) 0%, transparent 70%),
      var(--app-surface);
    --app-surface: hsl(38 82% 97%);
    --app-halo: hsla(45 87% 90% / 0.65);
    --app-content-bg: rgba(255, 255, 255, 0.9);
    --app-content-border: rgba(15, 23, 42, 0.08);
  }

  :global([data-theme='dark'] .app-page) {
    --app-surface: linear-gradient(175deg, rgba(2, 6, 23, 0.98), rgba(6, 11, 25, 0.94));
    --app-content-bg: rgba(6, 11, 25, 0.78);
  }
</style>
```

The light-mode block sets high-contrast defaults, while the dark-mode override adjusts the same
variables. Re-use `--app-content-*` (and similar) inside child elements instead of hard-coded rgba
values.

## Auth dialog & overlays

`web/src/routes/app/+layout.svelte` manages the authenticated experience. The auth overlay and guest
mode confirmation dialog run outside the `/app` DOM tree, so they cannot inherit scoped variables by
default. To keep parity between the overlay and the dialog we:

1. Declare `--auth-dialog-*` defaults on `:root` and re-export them on `.auth-backdrop`.
2. Override the variables inside `[data-theme='dark']` and the `prefers-color-scheme` fallback.
3. Apply the variables directly on `.auth-card` and the portal-based `.anon-dialog`.

If you introduce a new portal or overlay, follow the same approach: define tokens, set light
defaults, override in dark selectors, and consume the variables inside the component.

## Authoring guidelines

- **Prefer tokens to literals.** Reach for `var(--foreground)` or `var(--app-subtitle-color)` before
  introducing another hex string. When you must create a new color, express it as a variable and set
  light/dark values together.
- **Keep opacity high enough for legibility.** Light surfaces should keep alpha ≥ 0.85 if content is
  dark-on-light. For dark mode, keep alpha between 0.75–0.85 and rely on box shadows instead of
  reducing opacity further.
- **Shadows and borders.** Use `--auth-dialog-shadow` / `--app-content-shadow-*` so that surfaces get
  adequate separation on both themes.
- **shadcn components.** They already consume the global `--background`/`--foreground` tokens. When
  extending or wrapping shadcn components, you rarely need additional overrides — most custom color
  work should happen at the container level instead.

## Light mode checklist

When adding new UI, sanity-check the following in light mode:

1. Text is at least 4.5:1 contrast against its background (use the OKLCH values to reason about
   lightness; keep `L` ≥ 0.7 for backgrounds when text is dark).
2. Glass surfaces (`backdrop-filter` + opacity) are ≥ 0.85 alpha so the content reads clearly.
3. Secondary text still uses a dark-enough color (we use `rgba(15, 23, 42, 0.75)` for subtitles).
4. Portaled dialogs inherit the correct variables — test the guest dialog after toggling themes.

Document any new tokens in this file so future contributors know where to hook in.
