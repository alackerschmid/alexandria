// Deterministic placeholder helpers for book covers without an image.
// Ported from the library mockups: a stable tint + initials per title.

const TINTS = [
  "#3a352f",
  "#2c3640",
  "#3d2f37",
  "#2f3a33",
  "#3a3a2c",
  "#332f3c",
  "#3c322b",
  "#2a3640",
  "#383036",
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = (h * 31 + (str.codePointAt(i) ?? 0)) >>> 0;
  return h;
}

/** Stable tint colour for a placeholder cover, keyed off the title. */
export function tintFor(title: string): string {
  return TINTS[hash(title) % TINTS.length];
}

/**
 * First letters of the first two words, uppercased (e.g. "The Road" → "TR"), or "?" for a title
 * with no letters or digits at all.
 *
 * Keeps letters and digits in **any** script (`\p{L}`/`\p{N}`) rather than the ASCII range: an
 * ASCII-only filter dropped the first letter of every umlauted German title ("Ärger" → "R") and
 * emptied a non-Latin one to "?", which is most of what this library holds after the Latin
 * alphabet. Punctuation still goes, so "Don't Panic" is "DP" and "Anti-Oedipus" is one word.
 * Indexed by code point, so an astral first character isn't halved into a lone surrogate.
 */
export function initials(title: string): string {
  const words = title
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter(Boolean);
  const first = words[0] ? [...words[0]][0] : "?";
  const second = words[1] ? [...words[1]][0] : "";
  return (first + second).toUpperCase();
}
