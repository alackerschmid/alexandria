---
paths:
  - "src/utils/appearance.ts"
  - "src/styles/tailwind.css"
  - "src/stores/accent.ts"
  - "src/stores/paper.ts"
  - "src/stores/typeface.ts"
  - "src/stores/theme.ts"
  - "src/App.vue"
  - "vite.config.mts"
---

# Appearance presets and theming

## How presets are applied

Three token groups are user-overridable at runtime from Settings → Appearance, and `App.vue`
applies them by writing the variables **inline on `<html>`**, which outranks both the `@theme`
defaults and the `[data-theme="dark"]` block in `tailwind.css`:

- accent (`--color-orange-neon` + Vuetify `primary`), from `accent.ts`
- paper — the surface/border family (`--color-charcoal`, `-light`, `-border`,
  `--color-control-border`, `--color-search-bg`, `--color-search-border`,
  `--color-menu-surface`) plus Vuetify `background`/`surface`/`border`, from `paper.ts`
- typeface (`--font-heading`, `--font-body` **and `--font-mono`** — the mono face is
  customized too, because it styles every uppercase letter-spaced micro-label, a large share
  of the visible text; holding it fixed made a typeface switch look like it had barely
  applied), from `typeface.ts`

`paper.ts` and `typeface.ts` store a preset **key** from `src/utils/appearance.ts`, not raw
values.

## Scrollbars

**Scrollbars are restyled globally** in `tailwind.css` — thin, square, no stepper arrows,
thumb in `--color-control-border`. Every scroll container in the app gets it for free; don't
hand-roll per-component scrollbar CSS. Both the standard (`scrollbar-width`/`scrollbar-color`)
and `::-webkit-scrollbar-*` forms are declared because Chromium 121+ honours the former and
ignores the latter, while Safari and older Chromium do the opposite.

## `.force-dark`

**`.force-dark`** (`tailwind.css`) is the way to render an **always-dark subtree** inside a
themed page — the scanner's camera chrome and the sheets that overlay a live video feed use
it, since theme tokens there would paint a near-white panel on top of the camera in light
mode.

It re-declares the same tokens as `[data-theme="dark"]`, which works on any element because
both are unanchored selectors and a custom property declared on an element beats the one it
would inherit. That same fact is why it can't simply reuse the dark literals: `App.vue`
applies the user's paper preset as inline vars on `<html>`, which reach descendants only by
inheritance, so a nested scope would silently drop the preset. Hence `App.vue` also publishes
the preset's dark half as `--dark-color-*`, and `.force-dark` remaps from those (with the old
literals as pre-hydration fallbacks). Only the eight `PaperVars` are preset-sourced; the rest
of the block stays literal.

**Vuetify-derived tokens don't follow the scope** (`text-error`, `border-success`,
`AppButton variant="primary"`, `RatingStars`' color all resolve through `--v-theme-*` at the
`<v-app>` root), and `AppToast` teleports out of the subtree entirely — both are accepted.

## Adding or editing a paper preset

Editing the defaults in `tailwind.css` alone is **not enough** — the `warm` paper preset in
`src/utils/appearance.ts` mirrors them and must be kept in sync.

No paper preset touches the text tokens, and the rule that keeps contrast safe differs by
mode: **light** presets hold lightness roughly constant and differentiate through hue/chroma
(`--color-text-secondary` only clears ~4.2:1 on the default paper, so a darker light surface
pushes marginal small text further down), while **dark** presets may vary lightness as well —
at near-black, chroma is imperceptible, so a hue-only dark palette would render as three
identical blacks. The header docblock in `appearance.ts` states the binding constraint for
each; keep it accurate when adding a preset.

## Adding a typeface preset

**Fonts are entirely self-hosted** via `unplugin-fonts` + fontsource, configured in
`vite.config.mts` — there is no Google Fonts CDN link, deliberately (same-origin loading, and
no visitor IP transferred to a third party). Adding a typeface preset therefore means
installing the matching `@fontsource/*` package and registering its weights/styles in
`vite.config.mts`, not editing `index.html`.

**The UI tops out at weight 700** (headings are `font-bold`, not `font-black`) so the presets
stay weight-matched — Lora and Space Mono have no 900, so a heavier heading would let the
others outrun them. Don't reintroduce `font-black` without checking every preset's family has
a 900.

Register `styles: ['normal', 'italic']` only for families that actually ship italics (Space
Grotesk and Oswald don't — the browser synthesizes there); listing a style fontsource doesn't
have breaks the build.

## The bar for a new preset

A preset only earns its place if it's **recognizably** different from the others in a
screenshot — the setting is pointless if two read as the same page. Neutral grotesques (Inter,
Work Sans) are a trap here: next to the default Roboto body they're near-invisible as a
change.
