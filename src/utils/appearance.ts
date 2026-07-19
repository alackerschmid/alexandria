/**
 * Curated appearance presets — "paper" (the background/surface palette) and
 * typeface pairings. Both are deliberately preset-only: there is no free-form
 * picker, because the editorial look depends on surfaces, borders and text
 * staying in tune with each other.
 *
 * `--color-text-primary` is global — near-black/near-white, it clears every
 * surface with room to spare. `--color-text-secondary` is the tightest pairing
 * in the app and is therefore **per preset**: a paper that moves its background
 * far must bring its own secondary along, which is what allows a preset to be
 * dark without going illegible.
 *
 * Dark presets vary lightness as well as hue, and must: at near-black, chroma is
 * imperceptible, so a hue-only dark palette renders as three identical blacks.
 * The binding surface there is `charcoal-light`, the lightest one small text
 * sits on.
 *
 * Measured (WCAG AA for normal text = 4.5):
 *
 *   light page               warm 4.15 · neutral 4.16 · cool 4.89
 *   light charcoal-light     warm 4.55 · neutral 4.66 · cool 5.48
 *   dark  charcoal-light     warm 4.46 · neutral 4.51 · cool 4.51
 *
 * `warm` and `neutral` sit just under 4.5 on the page and lower still on the
 * recessed `search-bg` (~3.8). That is inherited from the shipped default
 * palette, not introduced here, and it is why those two must not get darker
 * without also darkening their secondary — which is exactly what `cool` does,
 * and why `cool` is both the darkest light paper and the most legible one.
 * Raising `warm` to match is a worthwhile separate change; it alters the
 * default look, so it is not folded in here.
 */

export type PaperPreset = "warm" | "neutral" | "cool";
export type TypefacePreset =
  | "editorial"
  | "sans"
  | "serif"
  | "typewriter"
  | "condensed";

export const DEFAULT_PAPER: PaperPreset = "warm";
export const DEFAULT_TYPEFACE: TypefacePreset = "editorial";

/**
 * The Tailwind custom properties a paper preset owns (see
 * `src/styles/tailwind.css` for what each one is used for). `row-card-surface`
 * is intentionally absent — it derives from these.
 */
export interface PaperVars {
  charcoal: string;
  "charcoal-light": string;
  "charcoal-border": string;
  "control-border": string;
  "search-bg": string;
  "search-border": string;
  "menu-surface": string;
  /**
   * Secondary text. A preset only needs its own when it moves the background
   * far enough that the shared value stops working — `cool` light does, because
   * it is deliberately the darkest light paper. `--color-text-primary` stays
   * global: it is near-black/near-white and clears every surface with room.
   */
  "text-secondary": string;
}

/** Vuetify theme colors kept in sync with the Tailwind vars above. */
export interface PaperVuetifyColors {
  background: string;
  surface: string;
  border: string;
}

export interface PaperMode {
  vars: PaperVars;
  vuetify: PaperVuetifyColors;
}

export interface PaperDefinition {
  light: PaperMode;
  dark: PaperMode;
}

export interface TypefaceDefinition {
  heading: string;
  body: string;
  mono: string;
}

export const PAPER_PRESET_KEYS = ["warm", "neutral", "cool"] as const;
export const TYPEFACE_PRESET_KEYS = [
  "editorial",
  "sans",
  "serif",
  "typewriter",
  "condensed",
] as const;

export const PAPER_PRESETS: Record<PaperPreset, PaperDefinition> = {
  // The shipped default — these values mirror src/styles/tailwind.css exactly,
  // so selecting `warm` reproduces the original look byte for byte.
  warm: {
    light: {
      vars: {
        charcoal: "#f7f1e8",
        "charcoal-light": "#fffcf6",
        "charcoal-border": "#e6dccb",
        "control-border": "#a89a89",
        "search-bg": "#efe7d8",
        "search-border": "#e6dccb",
        "menu-surface": "#f2e9d9",
        "text-secondary": "#7a736e",
      },
      vuetify: {
        background: "#fafaf8",
        surface: "#ffffff",
        border: "#e2ddd8",
      },
    },
    dark: {
      vars: {
        charcoal: "#0a0a09",
        "charcoal-light": "#1c1b19",
        "charcoal-border": "#2e2b28",
        "control-border": "#4a453f",
        "search-bg": "#16150f",
        "search-border": "#232220",
        "menu-surface": "#1c1b19",
        "text-secondary": "#8a8078",
      },
      vuetify: {
        background: "#0a0a09",
        surface: "#1c1b19",
        border: "#2e2b28",
      },
    },
  },

  // True grey — no hue at all, so it reads as a deliberate contrast to `warm`
  // rather than as a slightly-off cream.
  neutral: {
    light: {
      vars: {
        charcoal: "#f2f2f2",
        "charcoal-light": "#ffffff",
        "charcoal-border": "#dedede",
        "control-border": "#9b9b9b",
        "search-bg": "#e8e8e8",
        "search-border": "#dedede",
        "menu-surface": "#ededed",
        "text-secondary": "#7a736e",
      },
      vuetify: {
        background: "#f7f7f7",
        surface: "#ffffff",
        border: "#dedede",
      },
    },
    dark: {
      vars: {
        charcoal: "#121212",
        "charcoal-light": "#1a1a1a",
        "charcoal-border": "#2f2f2f",
        "control-border": "#4b4b4b",
        "search-bg": "#0c0c0c",
        "search-border": "#242424",
        "menu-surface": "#1a1a1a",
        "text-secondary": "#8a8078",
      },
      vuetify: {
        background: "#121212",
        surface: "#1a1a1a",
        border: "#2f2f2f",
      },
    },
  },

  // A cool grey, not a blue one: the light half sits ~8 points of channel spread
  // off neutral, enough to read as a different paper without tinting the page.
  // It carries its weight through *lightness* instead — it is the darkest light
  // preset by a clear margin, which is what separates it from `neutral`.
  cool: {
    light: {
      vars: {
        charcoal: "#e0e4e8",
        "charcoal-light": "#eef0f3",
        "charcoal-border": "#cbd0d6",
        "control-border": "#868d96",
        "search-bg": "#d7dbe0",
        "search-border": "#cbd0d6",
        "menu-surface": "#e6e9ed",
        // Darker than the shared token to pay for the darker paper. This is what
        // lets `cool` be the deepest light preset while still reading better than
        // the default: 4.89:1 on its page vs the shared token's 4.15:1 on `warm`.
        "text-secondary": "#5b6169",
      },
      vuetify: {
        background: "#e5e8eb",
        surface: "#eef0f3",
        border: "#cbd0d6",
      },
    },
    dark: {
      vars: {
        charcoal: "#0e131c",
        "charcoal-light": "#151a24",
        "charcoal-border": "#2b3444",
        "control-border": "#475264",
        "search-bg": "#0a0e15",
        "search-border": "#222b39",
        "menu-surface": "#151a24",
        "text-secondary": "#8a8078",
      },
      vuetify: {
        background: "#0e131c",
        surface: "#151a24",
        border: "#2b3444",
      },
    },
  },
};

/**
 * Each preset sets a mono face as well as heading and body. `--font-mono` is not
 * just for code here — it styles every uppercase letter-spaced micro-label (nav,
 * field labels, buttons, badges), which is a large share of the visible text, so
 * holding it fixed made a typeface switch look like it had barely applied. Every
 * mono here is genuinely monospaced, keeping those labels on an even rhythm.
 *
 * Families listed here are self-hosted — register them in `vite.config.mts`
 * (fontsource), not via a CDN link.
 *
 * The UI tops out at weight 700 (headings are `font-bold`) so that the presets
 * stay weight-matched: Lora and Space Mono have no 900, so a heavier heading
 * would let the others outrun them.
 *
 * Presets are meant to be *recognizably* different from one another — the point
 * of the setting is lost if two of them read as the same page. `sans`
 * deliberately does not use a neutral grotesque (Inter, Work Sans, and the like)
 * because next to the default Roboto body the switch was near-invisible.
 */
export const TYPEFACE_PRESETS: Record<TypefacePreset, TypefaceDefinition> = {
  editorial: {
    heading: '"Playfair Display", Georgia, serif',
    body: '"Roboto", system-ui, sans-serif',
    mono: '"Roboto Mono", monospace',
  },
  // Space Grotesk's quirks (single-storey g, splayed M, tight apertures) are
  // what make this read as a different page rather than as Roboto with a haircut.
  sans: {
    heading: '"Space Grotesk", system-ui, sans-serif',
    body: '"Space Grotesk", system-ui, sans-serif',
    mono: '"IBM Plex Mono", monospace',
  },
  serif: {
    heading: '"Lora", Georgia, serif',
    body: '"Lora", Georgia, serif',
    mono: '"Courier Prime", monospace',
  },
  // Monospaced throughout — an index-card / card-catalogue look, which suits a
  // library app. The most extreme preset by some margin: even running text sits
  // on the mono grid, so long descriptions read slower than in the others.
  typewriter: {
    heading: '"Space Mono", monospace',
    body: '"Space Mono", monospace',
    mono: '"Space Mono", monospace',
  },
  // Oswald's tall narrow caps change the *silhouette* of every heading, not just
  // its texture, which is what sets this apart from the other sans presets.
  // Barlow keeps running text at a normal width — condensed body copy at this
  // UI's sizes would be a legibility problem, not a style. Overpass Mono (not
  // IBM Plex, which `sans` already uses) shares Oswald's highway-signage DNA.
  condensed: {
    heading: '"Oswald", "Arial Narrow", sans-serif',
    body: '"Barlow", system-ui, sans-serif',
    mono: '"Overpass Mono", monospace',
  },
};
