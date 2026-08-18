// Cover helpers: where a cover's bytes come from, plus the deterministic placeholder for a book
// without one (a stable tint + initials per title, ported from the library mockups).

/** Same read as `useApi`'s: the worker's origin in production, same-origin via the proxy in dev. */
const API_BASE = import.meta.env.VITE_API_URL || "";

/**
 * The URL to actually put in an `<img>`.
 *
 * Prefers the cover stored on our own origin, because the alternative — pointing the `<img>` at
 * `books.google.com` — makes the **reader's** browser issue that request: their IP, their
 * User-Agent, the referring origin and the volume ids (which are the books they own) go to Google
 * as one correlated burst per page load, with their Google cookies attached, since
 * `books.google.com` is a `google.com` subdomain. `utils/markdown.ts` drops images from reviews for
 * exactly this reason and the fonts are self-hosted for it; covers were the one exception.
 *
 * Falls back to the upstream URL for a book the sweeper has not stored yet (and for one it never
 * can), so the library never loses a cover to this — it just stops being private for that book.
 * The server suppresses the key when the user has overridden the cover, so no check is needed here.
 */
export function coverSrc(
  coverUrl: string | null | undefined,
  objectKey?: string | null,
  base: string = API_BASE,
): string | null {
  if (isCoverKey(objectKey)) return `${base}/api/covers/${objectKey}`;
  return coverUrl ?? null;
}

/**
 * `<isbn>/<8 hex>.<ext>` — the key shape the worker's `covers.ts` writes, mirrored here.
 *
 * The client needs its own copy because a key can reach it from a route that does *not* suppress
 * the `'-'` unavailable sentinel: `buildScanSelect` filters it out, but `GET /api/books/lookup`,
 * `/guest-lookup` and `POST /api/books/refresh` all return the raw `books` row. `'-'` is truthy,
 * so a presence check would build `/api/covers/-` and 404 a book whose `cover_url` still works.
 */
const COVER_KEY = /^[\dA-Za-z-]{1,32}\/[\da-f]{8}\.(?:jpg|png|gif|webp)$/;

export function isCoverKey(key: string | null | undefined): key is string {
  return typeof key === "string" && COVER_KEY.test(key);
}

/**
 * A cover URL and the stored-object key that belongs to **it**, chosen together.
 *
 * The two must be picked as a pair or the `<img>` draws a different book's artwork: a shelf entry
 * falls back from the owned book's cover to an unowned series entry's, and a key carried across
 * that fall-through still points at the owned book's object. Taking the key only when the owned
 * book is also what supplied the URL is the whole rule — see `ShelfEntry` in `shelf-packing.ts`.
 */
export function pickCoverPair(
  owned: { cover_url: string | null; cover_object_key?: string | null } | undefined,
  fallbackUrl: string | null | undefined,
): { cover_url: string | null; cover_object_key: string | null } {
  if (owned?.cover_url)
    return {
      cover_url: owned.cover_url,
      cover_object_key: owned.cover_object_key ?? null,
    };
  return { cover_url: fallbackUrl ?? null, cover_object_key: null };
}

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
