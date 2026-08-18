/**
 * Cover-image URL shaping — the one place a cover is asked for at a usable size before it reaches
 * `books.cover_url`. Both metadata sources name the image *size* in the URL, and both default to
 * one far below what the library renders at.
 *
 * Measured against the live APIs, because it is what decides which source wins the cover field:
 *
 * - Google Books' `imageLinks.thumbnail` is always `zoom=1`, i.e. **128 px wide** (`volumes/{id}`
 *   returns no `small`/`medium`/`large` links for these volumes either — checked). Raising it to
 *   `zoom=2`/`zoom=3` (300 / 575 px) yields a real cover for only ~a third of volumes; the rest
 *   answer **HTTP 200 with Google's grey "cover not available" graphic**, byte-identical across
 *   volumes, or a 575x92 sliver for library scans. So the zoom is never raised blind: the response
 *   is a successful one, so `CoverImage`'s `@error` → `PlaceholderCover` fallback never fires and
 *   the user just sees a grey rectangle where the cover was.
 * - OpenLibrary's cover endpoint takes an `-S`/`-M`/`-L` suffix — 38 / 180 / ~330 px wide — and on
 *   a 50-book sample of the production catalogue served an `-L` for 41 of them.
 *
 * The library paints 8 covers per row at `xl`, ~170 CSS px each, so 128 px is upscaled before
 * device pixel ratio is even considered and `-L` is not. That is the whole reason OpenLibrary wins
 * the cover field here while Google still wins every other one.
 *
 * OpenLibrary's other quirk is handled here too: an edition whose cover has been *deleted* still
 * gets a full `cover` object, pointing at id `-1`, which 503s. See `isDeletedOpenLibraryCover`.
 *
 * Taking Google's 575 px version where it genuinely exists needs an actual image probe, which does
 * not belong on a path a user is waiting on; `worker/scripts/upgrade-covers.mjs` does that as a
 * batch. A `.mjs` cannot import this file, so it mirrors the predicates below — keep them in sync.
 */

export type OpenLibraryCoverSize = "S" | "M" | "L";

/** Largest size OpenLibrary serves (~330 px wide, against 180 for `-M` and 38 for `-S`). */
export const OPENLIBRARY_COVER_SIZE: OpenLibraryCoverSize = "L";

/** `/b/id/<id>-<size>.jpg`, the cover-id form of OpenLibrary's cover endpoint. */
const OPENLIBRARY_COVER_ID_PATH = /^\/b\/id\/(-?\d+)-[SML]\.jpg$/;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isGoogleCoverUrl(url: URL): boolean {
  if (!(url.hostname === "google.com" || url.hostname.endsWith(".google.com")))
    return false;
  // Both shapes Google hands out: `/books/content?id=…` from `imageLinks`, and the older
  // `/books?id=…&printsec=frontcover` (usually on a `bks<n>.books.google.com` host). Requiring
  // `/books/` missed the second, and missing it costs twice over — `edge=curl` stays on, *and*
  // `isGoogleThumbnail` reads a 128 px thumbnail as a probe-verified large image, which is the
  // one thing `pickCoverUrl` exists to prevent.
  return url.pathname === "/books" || url.pathname.startsWith("/books/");
}

/**
 * OpenLibrary's deleted-cover sentinel. An edition whose cover has been removed keeps a full
 * `cover` object in the `/api/books` response and a `covers: [-1]` array in the editions listing;
 * both name cover id `-1`, whose URL redirects into the Internet Archive shard and answers **503**
 * (verified live for ISBN 9780060883287, and visible in this repo's captured browser console logs).
 *
 * `-1` is truthy, so a presence check lets it through — `work_edition_isbns` holds **74** such rows
 * in production (counted 2026-08-18; an earlier note here said 18, which was already stale).
 * Treating it as "no cover" is right: `CoverImage` then draws `PlaceholderCover` instead of waiting
 * on a request that cannot succeed. Note `books.cover_url` holds **none** — the sentinel only ever
 * reached the candidate table, which is why the sweeper never trips over one.
 */
function isDeletedOpenLibraryCover(url: URL): boolean {
  if (url.hostname !== "covers.openlibrary.org") return false;
  const id = OPENLIBRARY_COVER_ID_PATH.exec(url.pathname)?.[1];
  return id !== undefined && Number(id) <= 0;
}

/**
 * A cover URL as we want to store it: `https` (Google hands out `http` links, which a page served
 * over TLS refuses to load) and without `edge=curl`, the fake page-curl Google draws over the
 * artwork on some volumes — 144 of the catalogue's 909 Google covers carried it.
 *
 * Returns null for a cover we know is not there: an absent one, and OpenLibrary's deleted-cover
 * sentinel. An *unparseable* URL is passed through untouched rather than dropped — it is no worse
 * than what we would otherwise have stored, and `CoverImage` already falls back when an `<img>`
 * fails; the sentinel is different in that we know for certain the request will fail.
 */
export function normalizeCoverUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const parsed = parseUrl(url);
  if (!parsed) return url;
  if (isDeletedOpenLibraryCover(parsed)) return null;
  if (parsed.protocol === "http:") parsed.protocol = "https:";
  if (isGoogleCoverUrl(parsed)) parsed.searchParams.delete("edge");
  return parsed.toString();
}

/**
 * True for Google's 128 px thumbnail — `zoom=1`, or no zoom at all, which is all `imageLinks`
 * ever hands out. A Google URL at a higher zoom has been probe-verified by the upgrade script and
 * must not be thrown away for a smaller OpenLibrary image.
 */
export function isGoogleThumbnail(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed || !isGoogleCoverUrl(parsed)) return false;
  const zoom = parsed.searchParams.get("zoom");
  return zoom === null || zoom === "1";
}

/**
 * OpenLibrary's cover for a cover id, at `size` — null when there is no usable id.
 *
 * The id is checked rather than merely present: `-1` is the deleted-cover sentinel and is truthy,
 * so `covers?.[0] ? … : null` at the call site built a URL that 503s. `Number(null)` is 0 and
 * `Number(undefined)` is NaN, so an absent id falls out of the same test.
 */
export function openLibraryCoverUrlById(
  coverId: number | string | null | undefined,
  size: OpenLibraryCoverSize = OPENLIBRARY_COVER_SIZE,
): string | null {
  const id = Number(coverId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return `https://covers.openlibrary.org/b/id/${id}-${size}.jpg`;
}

/**
 * Which source's cover to keep when both answered. OpenLibrary's `-L` beats Google's 128 px
 * thumbnail on pixels by ~2.5x linear, so it wins — but only against a *thumbnail*: anything else
 * from Google is a verified larger image and stays.
 *
 * This is deliberately the only field where `fetchBookMetadata` overrides Google-wins-the-merge.
 */
export function pickCoverUrl(
  google: string | null,
  openLibrary: string | null,
): string | null {
  if (!openLibrary) return google;
  if (!google) return openLibrary;
  return isGoogleThumbnail(google) ? openLibrary : google;
}
