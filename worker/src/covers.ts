import type { Bindings } from "./types";
import { fetchWithTimeout } from "./editions";
import type { UsageRecorder } from "./usage";

/**
 * Storing covers in R2 so the reader's browser stops fetching them from Google and OpenLibrary.
 *
 * Hot-linking a cover means the *reader* makes that request — their IP, their User-Agent, the
 * referring origin and the volume ids (which are the books) reach Google as one correlated burst per
 * page load, with their Google cookies attached, since `books.google.com` is a `google.com`
 * subdomain. The app already holds the opposite line everywhere else: `utils/markdown.ts` drops
 * images from reviews because a remote `<img>` there would leak the reader's IP, and the fonts are
 * self-hosted for the same reason. Covers were the one exception, and the highest-volume one.
 *
 * This module owns the *write* half — picking books that still need a cover, fetching it once, and
 * putting it in the bucket. `routes/covers.ts` serves what it stores.
 */

/** Enough of the digest to make a key collision-proof in practice for a per-book namespace. */
const HASH_LENGTH = 8;

/**
 * Written to `cover_object_key` when the upstream cover is permanently gone — a 404/410, or a 200
 * that wasn't an image. It is not a key, so `isCoverKey` rejects it and the read path falls back to
 * `cover_url` exactly as it does for a book that has not been localized yet.
 *
 * Without it, a dead cover URL is re-fetched every two minutes forever: the due predicate is
 * `cover_object_key IS NULL`, nothing else records the attempt, and the tick's subrequest budget is
 * shared with enrichment. A *transient* failure (5xx, network, timeout) deliberately writes nothing
 * and is retried — the distinction is the whole reason this is written at the failure site rather
 * than by a blanket catch.
 */
export const COVER_UNAVAILABLE = "-";

/** Only image types we are willing to store, mapped to the extension the key carries. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * Ceiling on a stored cover. Google's `zoom=3` covers run to ~240 KB and OpenLibrary's `-L` to
 * ~75 KB, so this is ~8x the largest thing we expect: it exists to bound a mislabelled download,
 * not to second-guess the source ranking in `cover-url.ts`.
 */
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** Long enough that the tick is never held up by one slow host; covers are not urgent. */
const COVER_FETCH_TIMEOUT_MS = 5000;

/**
 * `<isbn>/<8 hex>.<ext>`. Both segments are constrained so the serve route can rebuild a key from
 * its path params with no chance of reaching an object the caller invented: neither `.` nor `/` can
 * appear in the first segment, which is what keeps a path parameter from becoming a traversal.
 *
 * The ISBN half is a *charset* rule rather than an ISBN shape check on purpose. A row whose `isbn`
 * is unusual (a dashed or short legacy value) must still be storable — failing the key check here
 * writes the permanent `COVER_UNAVAILABLE` sentinel, so a strict shape rule would quietly decide
 * such a book has no cover rather than store the one it has.
 */
const COVER_KEY = /^[\dA-Za-z-]{1,32}\/[\da-f]{8}\.(?:jpg|png|gif|webp)$/;

export function isCoverKey(key: string | null | undefined): key is string {
  return typeof key === "string" && COVER_KEY.test(key);
}

/** First `HASH_LENGTH` hex chars of the content's SHA-256 — the cache-busting half of a key. */
export async function coverHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest, 0, HASH_LENGTH / 2)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The key an ISBN's cover is stored under, or null when we should not store this response at all.
 *
 * Keyed by **content**, not by ISBN alone: the serve route answers `immutable`, so replacing a
 * book's cover with a better one has to produce a new URL. It does, because the hash changes.
 */
export function coverKeyFor(
  isbn: string,
  contentType: string | null,
  hash: string,
): string | null {
  const extension = EXTENSIONS[(contentType ?? "").split(";")[0].trim()];
  if (!extension) return null;
  const key = `${isbn}/${hash}.${extension}`;
  return isCoverKey(key) ? key : null;
}

/** What one book's localization attempt concluded. `skip` writes nothing and is retried. */
type FetchOutcome =
  | { kind: "stored"; key: string }
  | { kind: "unavailable" }
  | { kind: "skip" };

/**
 * Fetches one cover and puts it in the bucket. Distinguishing *permanently* gone (404/410, or a
 * body that isn't a storable image) from *transiently* failing is the point of the return type —
 * see `COVER_UNAVAILABLE`.
 */
async function storeCover(
  env: Bindings,
  isbn: string,
  url: string,
  usage: UsageRecorder,
): Promise<FetchOutcome> {
  let fetched: { bytes: ArrayBuffer; contentType: string | null } | null;
  try {
    fetched = await fetchWithTimeout(
      url,
      usage,
      async (res) => {
        // 404/410 is the source saying the image is gone; anything else non-OK might not be.
        if (res.status === 404 || res.status === 410) return null;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return {
          bytes: await res.arrayBuffer(),
          contentType: res.headers.get("content-type"),
        };
      },
      {},
      COVER_FETCH_TIMEOUT_MS,
    );
  } catch {
    // Transient by assumption: a 5xx, a network error or the timeout. Retried next tick.
    return { kind: "skip" };
  }

  if (!fetched) return { kind: "unavailable" };
  if (fetched.bytes.byteLength === 0 || fetched.bytes.byteLength > MAX_COVER_BYTES)
    return { kind: "unavailable" };

  const key = coverKeyFor(
    isbn,
    fetched.contentType,
    await coverHash(fetched.bytes),
  );
  // A 200 that isn't an image we store — an HTML error page, an SVG, a type we don't serve. The
  // request succeeded, so retrying it changes nothing.
  if (!key) return { kind: "unavailable" };

  await env.COVERS.put(key, fetched.bytes, {
    httpMetadata: { contentType: fetched.contentType ?? "image/jpeg" },
  });
  return { kind: "stored", key };
}

/**
 * Stores covers for up to `limit` books that have a `cover_url` but no object yet, and returns how
 * many external requests it spent — the caller's budget is shared with enrichment, and a cover
 * costs exactly one fetch, so the count is exact rather than a worst case.
 *
 * `ORDER BY RANDOM()` for the same reason `linkWork`'s pick uses it: nothing marks a book that
 * fails *transiently* and forever, so a fixed order would let a handful of such rows occupy every
 * slot of every tick and starve the rest of the backlog. Sampling bounds the damage to their share
 * of it. The scan this costs is over the partial index's rows only, and that set drains to empty.
 */
export async function localizeCovers(
  env: Bindings,
  usage: UsageRecorder,
  limit: number,
): Promise<number> {
  if (limit <= 0) return 0;

  const { results } = await env.DB.prepare(
    `SELECT id, isbn, cover_url FROM books
     WHERE cover_object_key IS NULL AND cover_url IS NOT NULL
     ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(limit)
    .all<{ id: number; isbn: string; cover_url: string }>();

  let spent = 0;
  for (const book of results) {
    let outcome: FetchOutcome;
    try {
      outcome = await storeCover(env, book.isbn, book.cover_url, usage);
    } catch (e) {
      // Per-book isolation, as everywhere else in the tick: an R2 write that throws must not take
      // the remaining books (or the prune/enrichment phases around it) down with it.
      console.error(`[covers] failed for book ${book.id}:`, e);
      outcome = { kind: "skip" };
    }
    spent++;
    if (outcome.kind === "skip") continue;

    // `AND cover_object_key IS NULL` so a concurrent tick that already stored one wins rather than
    // being overwritten by a second, equally valid object — and so the sentinel never replaces a
    // real key.
    await env.DB.prepare(
      "UPDATE books SET cover_object_key = ? WHERE id = ? AND cover_object_key IS NULL",
    )
      .bind(
        outcome.kind === "stored" ? outcome.key : COVER_UNAVAILABLE,
        book.id,
      )
      .run();
  }
  return spent;
}
