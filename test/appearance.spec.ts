import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAPER_PRESETS, type PaperVars } from "@/utils/appearance";

// The `appearance` rule states that editing the defaults in `tailwind.css` alone is not enough:
// the `warm` paper preset mirrors them and must be kept in sync, so that selecting `warm`
// reproduces the shipped look byte for byte. Nothing enforced that — `vue-tsc` and ESLint don't
// read a stylesheet, so a stylesheet-only edit had no check at all. This is that check.
//
// It deliberately parses the css as text rather than importing it. The point is to catch a
// hand-edit to the literals in `tailwind.css`, which is exactly what a resolved/compiled value
// would hide.
const CSS = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "src/styles/tailwind.css",
  ),
  "utf8",
);

/** The eight custom properties a paper preset owns, in `PaperVars` key order. */
const PAPER_VAR_NAMES = Object.keys(
  PAPER_PRESETS.warm.light.vars,
) as (keyof PaperVars)[];

/** Body of the first block whose selector line matches, `{` … matching `}` excluded. */
function block(startPattern: RegExp): string {
  const start = CSS.search(startPattern);
  if (start === -1) throw new Error(`no block matching ${startPattern}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("\n}", open);
  if (open === -1 || close === -1) throw new Error(`unterminated ${startPattern}`);
  return CSS.slice(open + 1, close);
}

const LIGHT = block(/^@theme\s*\{/m);
const DARK = block(/^\[data-theme="dark"\],/m);

/** `--color-x: #hex;` — the light defaults are plain literals. */
function lightValue(name: string): string | null {
  return (
    new RegExp(String.raw`--color-${name}:\s*(#[0-9a-f]{3,8})\s*;`, "i").exec(LIGHT)?.[1] ?? null
  );
}

/**
 * `--color-x: var(--dark-color-x, #hex);` — the dark block reads through the vars `App.vue`
 * publishes for the active preset, and the literal is the pre-hydration fallback. That
 * fallback is the `warm` dark value, so it is what has to stay in sync.
 */
function darkFallback(name: string): string | null {
  return (
    new RegExp(
      String.raw`--color-${name}:\s*var\(\s*--dark-color-${name}\s*,\s*(#[0-9a-f]{3,8})\s*\)\s*;`,
      "i",
    ).exec(DARK)?.[1] ?? null
  );
}

const collect = (read: (name: string) => string | null) =>
  Object.fromEntries(PAPER_VAR_NAMES.map((name) => [name, read(name)]));

describe("tailwind.css ↔ appearance.ts", () => {
  it("declares all eight paper vars in the light defaults", () => {
    const missing = PAPER_VAR_NAMES.filter((name) => lightValue(name) === null);
    expect(missing).toEqual([]);
  });

  it("declares all eight paper vars in the dark block", () => {
    const missing = PAPER_VAR_NAMES.filter((name) => darkFallback(name) === null);
    expect(missing).toEqual([]);
  });

  // One assertion per mode rather than per var: a whole-object compare names every drifted
  // token at once, which is what you want when a palette edit moved several together.
  it("matches the warm preset's light values", () => {
    expect(collect(lightValue)).toEqual(PAPER_PRESETS.warm.light.vars);
  });

  it("matches the warm preset's dark fallbacks", () => {
    expect(collect(darkFallback)).toEqual(PAPER_PRESETS.warm.dark.vars);
  });

  // `.force-dark` renders an always-dark subtree and re-declares the same tokens. If it stops
  // sharing a selector list with `[data-theme="dark"]`, the two palettes can drift apart
  // silently — a nested dark scope would then paint different surfaces than the dark theme.
  it("keeps .force-dark on the same rule as [data-theme='dark']", () => {
    expect(CSS).toMatch(/^\[data-theme="dark"\],\s*\n\.force-dark\s*\{/m);
  });
});
