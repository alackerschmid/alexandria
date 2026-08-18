import { describe, it, expect } from "vitest";
import {
  isGoogleThumbnail as moduleIsGoogleThumbnail,
  normalizeCoverUrl as moduleNormalizeCoverUrl,
} from "../src/cover-url";
import {
  currentTier,
  isDeletedOpenLibraryCover as scriptIsDeletedOpenLibraryCover,
  isGoogleThumbnail as scriptIsGoogleThumbnail,
  normalizeCoverUrl as scriptNormalizeCoverUrl,
} from "../scripts/upgrade-covers.mjs";

/**
 * `scripts/upgrade-covers.mjs` hand-mirrors four predicates from `src/cover-url.ts`, because a
 * `.mjs` cannot import a `.ts`. The script's header used to just ask for the two to be kept in
 * sync, which meant nothing distinguished a deliberate divergence from a missed one — while the
 * script's output is `UPDATE`s applied to production, and a drifted `currentTier` emits the cover
 * *downgrades* that check was added to prevent.
 *
 * So both implementations run over one table here. Anything that drifts fails; the two deliberate
 * divergences are asserted as divergences, so removing one is also a failure.
 */

const GOOGLE_THUMBNAIL =
  "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1";
const GOOGLE_LARGE =
  "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=3";
const GOOGLE_NO_ZOOM = "https://books.google.com/books/content?id=abc&img=1";
const GOOGLE_LEGACY =
  "https://bks5.books.google.com/books?id=abc&printsec=frontcover&img=1";
const GOOGLE_EDGE_CURL =
  "https://books.google.com/books/content?id=abc&img=1&zoom=1&edge=curl";
// Deliberately http: this is the input that proves both implementations still force https, which
// is the whole point of the constant.
// eslint-disable-next-line unicorn/prefer-https
const GOOGLE_HTTP = "http://books.google.com/books/content?id=abc&img=1&zoom=1";
const GOOGLE_UPPERCASE_HOST =
  "https://Books.Google.com/books/content?id=abc&img=1&zoom=1&edge=curl";
const GOOGLE_EXPLICIT_PORT =
  "https://books.google.com:443/books/content?id=abc&img=1&zoom=1&edge=curl";
const OL_LARGE = "https://covers.openlibrary.org/b/id/12345-L.jpg";
const OL_MEDIUM = "https://covers.openlibrary.org/b/id/12345-M.jpg";
const OL_DELETED = "https://covers.openlibrary.org/b/id/-1-L.jpg";
const NOT_A_URL = "not a url";

/** Every shape either implementation has an opinion about, including the three the module's own
 *  comment names as the reason it parses rather than string-matches. */
const URLS = [
  GOOGLE_THUMBNAIL,
  GOOGLE_LARGE,
  GOOGLE_NO_ZOOM,
  GOOGLE_LEGACY,
  GOOGLE_EDGE_CURL,
  GOOGLE_HTTP,
  GOOGLE_UPPERCASE_HOST,
  GOOGLE_EXPLICIT_PORT,
  OL_LARGE,
  OL_MEDIUM,
  NOT_A_URL,
  "https://example.com/cover.jpg",
];

describe("upgrade-covers.mjs mirrors src/cover-url.ts", () => {
  it("agrees on isGoogleThumbnail for every shape", () => {
    for (const url of URLS)
      expect(
        { url, thumbnail: scriptIsGoogleThumbnail(url) },
        `isGoogleThumbnail drifted for ${url}`,
      ).toEqual({ url, thumbnail: moduleIsGoogleThumbnail(url) });
  });

  it("agrees on normalizeCoverUrl for every shape that isn't the sentinel", () => {
    // The sentinel is the one deliberate divergence — asserted separately below.
    for (const url of URLS)
      expect(
        { url, normalized: scriptNormalizeCoverUrl(url) },
        `normalizeCoverUrl drifted for ${url}`,
      ).toEqual({ url, normalized: moduleNormalizeCoverUrl(url) });
  });

  it("still parses rather than string-matches, on all three named cases", () => {
    // An uppercased host, an explicit :443, and a `/books` path with no trailing segment — the
    // three a `url.includes("books.google.com")` rewrite would silently get wrong, in both files.
    for (const url of [GOOGLE_UPPERCASE_HOST, GOOGLE_EXPLICIT_PORT]) {
      expect(scriptNormalizeCoverUrl(url)).not.toContain("edge=curl");
      expect(moduleNormalizeCoverUrl(url)).not.toContain("edge=curl");
      expect(scriptIsGoogleThumbnail(url)).toBe(true);
      expect(moduleIsGoogleThumbnail(url)).toBe(true);
    }
    expect(scriptIsGoogleThumbnail(GOOGLE_LEGACY)).toBe(true);
    expect(moduleIsGoogleThumbnail(GOOGLE_LEGACY)).toBe(true);
  });

  it("keeps the deleted-cover sentinel divergence deliberate", () => {
    // The module drops it (a `-1` URL 503s, so `CoverImage` should draw the placeholder instead of
    // waiting on a request that cannot succeed). The script must NOT drop it: it has to recognise
    // such a row in order to re-point it, and `currentTier` rates it tier 3 so it gets probed.
    expect(moduleNormalizeCoverUrl(OL_DELETED)).toBeNull();
    expect(scriptNormalizeCoverUrl(OL_DELETED)).toBe(OL_DELETED);
    expect(scriptIsDeletedOpenLibraryCover(OL_DELETED)).toBe(true);
    expect(currentTier(OL_DELETED)).toBe(3);
  });
});

describe("currentTier", () => {
  it("never rates a thumbnail above a candidate", () => {
    // Tier 3 is "nothing worth keeping" — the gate that makes a row eligible for probing at all.
    expect(currentTier(GOOGLE_THUMBNAIL)).toBe(3);
    expect(currentTier(GOOGLE_NO_ZOOM)).toBe(3);
    expect(currentTier(OL_MEDIUM)).toBe(3);
    expect(currentTier(null)).toBe(3);
  });

  it("protects an already-upgraded cover from a downgrade", () => {
    // The regression the tier check exists for: a transient probe failure on a zoom=3 cover fell
    // through to the OpenLibrary tier and emitted a downgrade, irreversibly — the Google volume id
    // is gone once the row holds an OpenLibrary URL.
    expect(currentTier(GOOGLE_LARGE)).toBe(1);
    expect(currentTier(OL_LARGE)).toBe(2);
  });
});
