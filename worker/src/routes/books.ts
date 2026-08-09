import { Hono } from "hono";
import type { Env, BookRow } from "../types";
import { authMiddleware } from "../auth";
import type { Context } from "hono";
import {
  resolveEdition,
  fetchBookMetadata,
  linkWork,
  searchTitleCached,
  searchCacheKeyString,
  SEARCH_CACHE_TTL_SECONDS,
  UpstreamSearchError,
  UpstreamLookupError,
  fillMetadataStatement,
  type TitleQuery,
} from "../editions";
import { enrichWorkDetached } from "../enrichment";
import {
  attachCustomFields,
  buildScanSelect,
  fetchCustomFields,
  getScannedBookByIsbn,
  parseIntOr,
  parseTagArray,
  type OverrideField,
} from "../library-query";
import { validateOverrides } from "../override-validation";
import { normalizeIsbn, isValidIsbn } from "../isbn";
import { rateLimitOrReject, clientIp } from "../rate-limit";
import { readJsonBody, INVALID_JSON_BODY } from "../json-body";

const books = new Hono<Env>();

// /refresh forces a fresh Google Books/OpenLibrary fetch plus a forced Wikidata SPARQL
// re-run (enrichWork force=true) — the most expensive call path in the app — so it gets a
// tighter per-user cap than routine per-scan traffic.
const REFRESH_RATE_LIMIT = 10;

function searchCacheKey(query: TitleQuery): Request {
  return new Request(
    `https://bookscan-cache/search?${searchCacheKeyString(query)}`,
  );
}

// Shared by /search and /guest-search — same query, same answer, same cache entry.
//
// The Workers edge cache (colo-local, fastest, no DB round-trip at all) sits in front of
// `searchTitleCached`, which owns the rest of the chain: our own catalog, then the D1-backed
// `search_cache` table (global — a search made from one datacenter is a hit from every other,
// unlike the edge cache alone), then Google Books itself. Anything but a local hit re-warms the
// edge cache, so the next request from this colo skips the DB round-trip too.
//
// Trade-off: a book added to the local catalog while an identical query is still edge-cached
// (up to 6h) won't be surfaced as a local hit until that cache entry expires — same staleness
// window the cache already accepts for Google results, just extended to the local check too.
async function handleTitleSearch(c: Context<Env>): Promise<Response> {
  const title = c.req.query("title")?.trim();
  const author = c.req.query("author")?.trim() || undefined;
  const publisher = c.req.query("publisher")?.trim() || undefined;
  if (!title) return c.json({ error: "Title required" }, 400);
  const query = { title, author, publisher };

  const cache = caches.default;
  const cacheKey = searchCacheKey(query);
  const cached = await cache.match(cacheKey);
  // Re-wrap: cache.match responses have immutable headers, and the CORS middleware
  // mutates response headers after the handler returns.
  if (cached) return new Response(cached.body, cached);

  try {
    const { results, fromLocalCatalog } = await searchTitleCached(
      c.env.DB,
      c.env.GOOGLE_BOOKS_API_KEY,
      query,
      (p) => c.executionCtx.waitUntil(p),
      c.get("usage"),
    );
    if (fromLocalCatalog) return c.json(results);

    const res = Response.json(results);
    res.headers.set("Cache-Control", `public, max-age=${SEARCH_CACHE_TTL_SECONDS}`);
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (e) {
    if (!(e instanceof UpstreamSearchError)) throw e;
    // Never cached: a quota/rate-limit rejection says nothing about the query.
    console.error(`[title search] upstream failed, status=${e.status}`);
    const res = c.json({ error: "search_unavailable" }, 503);
    if (e.retryAfterSeconds) {
      res.headers.set("Retry-After", String(e.retryAfterSeconds));
    }
    return res;
  }
}

/**
 * Both ISBN-lookup routes' answer when the metadata sources couldn't be reached. Deliberately a
 * 503 rather than the 404 they used to give: a failed request is not evidence that the book does
 * not exist, and telling the user it doesn't is both wrong and unactionable. Mirrors the
 * `search_unavailable` 503 that title search already returns for the same reason.
 */
function lookupUnavailable(c: Context<Env>) {
  console.error("[isbn lookup] upstream unavailable");
  return c.json({ error: "lookup_unavailable" }, 503);
}

// ── Public routes (no auth) ───────────────────────────────────────────────────

// Public guest lookup — no auth. Enrichment is intentionally NOT triggered here to avoid
// anonymous traffic driving Wikidata load; the work gets enriched when an authenticated
// user looks it up or scans it.
books.get("/guest-lookup", async (c) => {
  const ip = clientIp(c);
  const blocked = await rateLimitOrReject(
    c,
    `guest-lookup:${ip}`,
    20,
    1,
    "Too many requests — please slow down",
  );
  if (blocked) return blocked;

  const rawIsbn = c.req.query("isbn");
  if (!rawIsbn) return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(rawIsbn);
  if (!isValidIsbn(isbn)) return c.json({ error: "Invalid ISBN" }, 400);

  let book: BookRow | null;
  try {
    book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY, {
      skipLinkWork: true,
      usage: c.get("usage"),
    });
  } catch (e) {
    if (e instanceof UpstreamLookupError) return lookupUnavailable(c);
    throw e;
  }
  if (!book) return c.json({ notFound: true }, 404);
  return c.json(book);
});

// Public guest title search — no auth. Mirrors /search for unauthenticated users.
books.get("/guest-search", async (c) => {
  const ip = clientIp(c);
  const blocked = await rateLimitOrReject(
    c,
    `guest-search:${ip}`,
    15,
    1,
    "Too many requests — please slow down",
  );
  if (blocked) return blocked;

  return handleTitleSearch(c);
});

// Public sample of hand-picked catalogued books — powers the marketing preview. No auth.
// Only books with is_featured = 1 (set manually, e.g. via wrangler d1 execute) are eligible.
// Cached in the Workers edge cache (keyed by limit) so anonymous/bot traffic doesn't
// re-run the query on every hit. A 10-min-stale sample is fine for a marketing preview.
books.get("/sample", async (c) => {
  const limit = Math.min(Math.max(parseIntOr(c.req.query("limit"), 3), 1), 12);
  const db = c.env.DB;

  const cache = caches.default;
  const cacheKey = new Request(`https://bookscan-cache/sample?limit=${limit}`);
  const cached = await cache.match(cacheKey);
  // Re-wrap: cache.match responses have immutable headers, and the CORS middleware
  // mutates response headers after the handler returns.
  if (cached) return new Response(cached.body, cached);

  const [{ results }, total] = await Promise.all([
    db
      .prepare(
        "SELECT title, author, cover_url FROM books WHERE is_featured = 1 AND title IS NOT NULL AND cover_url IS NOT NULL ORDER BY RANDOM() LIMIT ?",
      )
      .bind(limit)
      .all<{
        title: string;
        author: string | null;
        cover_url: string | null;
      }>(),
    db
      .prepare("SELECT COUNT(*) AS n FROM books WHERE is_featured = 1 AND title IS NOT NULL")
      .first<{ n: number }>(),
  ]);

  const res = c.json({ books: results, total: total?.n ?? results.length });
  res.headers.set("Cache-Control", "public, max-age=600");
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});

// ── Protected routes ──────────────────────────────────────────────────────────

books.use("*", authMiddleware);

// Title search — returns candidate editions from Google Books. No DB writes; the
// books row is created only when the user selects an edition and it flows through lookup/scan.
books.get("/search", (c) => handleTitleSearch(c));

// Book metadata lookup — checks DB cache first, then Google Books, then OpenLibrary.
books.get("/lookup", async (c) => {
  const rawIsbn = c.req.query("isbn");
  if (!rawIsbn) return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(rawIsbn);
  if (!isValidIsbn(isbn)) return c.json({ error: "Invalid ISBN" }, 400);

  let book: BookRow | null;
  try {
    book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY, {
      usage: c.get("usage"),
    });
  } catch (e) {
    if (e instanceof UpstreamLookupError) return lookupUnavailable(c);
    throw e;
  }
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.work_id)
    c.executionCtx.waitUntil(
      enrichWorkDetached(
        c.env.DB,
        book.work_id,
        false,
        c.env.GOOGLE_BOOKS_API_KEY,
        "lookup",
      ),
    );
  return c.json(book);
});

// The fields /refresh's COALESCE update can fill — same list as the UPDATE's SET clause, minus
// number_of_pages_median (checked separately below since a 0 there also counts as missing).
const REFRESHABLE_TEXT_FIELDS = [
  "title",
  "author",
  "cover_url",
  "language",
  "publish_date",
  "description",
  "publisher",
  "physical_format",
  "edition_name",
  "physical_dimensions",
  "categories",
] as const satisfies readonly (keyof BookRow)[];

function hasMissingMetadata(book: BookRow): boolean {
  if (REFRESHABLE_TEXT_FIELDS.some((field) => book[field] == null)) return true;
  return !book.number_of_pages_median || book.number_of_pages_median <= 0;
}

// Refresh book metadata — tries Google Books then OpenLibrary, fills NULL fields only
// (a 0 page count also counts as missing — Google returns 0 when the count is unknown). Skips
// the external fetch entirely once every refreshable field is already populated.
books.post("/refresh", async (c) => {
  const rawIsbn = c.req.query("isbn");
  if (!rawIsbn) return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(rawIsbn);
  if (!isValidIsbn(isbn)) return c.json({ error: "Invalid ISBN" }, 400);

  const userId = c.get("userId");
  const blocked = await rateLimitOrReject(
    c,
    `refresh:${userId}`,
    REFRESH_RATE_LIMIT,
    1,
    "Too many refresh requests — please slow down",
  );
  if (blocked) return blocked;

  // The UPDATE below only ever fills existing NULL columns, so a refresh on an isbn with no
  // `books` row yet is a guaranteed no-op — check first and skip the external fetch entirely
  // rather than spending Google Books/OpenLibrary quota on a request that can't do anything.
  const existing = await c.env.DB.prepare("SELECT * FROM books WHERE isbn = ?")
    .bind(isbn)
    .first<BookRow>();
  if (!existing) return c.json({ error: "Book not found" }, 404);

  // Likewise, if every refreshable field is already populated there's nothing for a fetch to
  // fill — the COALESCE update would be a no-op. Skip straight to the enrichment refresh below.
  //
  // A metadata *miss* is not the end of the request either. Refresh is the documented manual
  // force-retry path for Wikidata enrichment, and the books that need it most — Goodreads-import
  // fallback rows whose ISBN neither Google nor OpenLibrary knows — miss here on every attempt by
  // construction. 404ing on the miss therefore meant the Refresh button could *never* re-trigger
  // enrichment for exactly those books, even though the work is often resolvable by title/author.
  // So the miss only skips the UPDATE; the response reports it as `metadata_refreshed: false`.
  const wasMissingMetadata = hasMissingMetadata(existing);
  let metadataUpdated = false;
  if (wasMissingMetadata) {
    const fetched = await fetchBookMetadata(
      isbn,
      c.env.GOOGLE_BOOKS_API_KEY,
      c.get("usage"),
    );
    // `unavailable` is reported the same way a miss is (`metadata_refreshed: false`) rather than
    // failing the request: refresh's other half is the manual force-retry for Wikidata enrichment,
    // and that should still run when the metadata sources happen to be down.
    if (fetched.kind === "found") {
      await fillMetadataStatement(c.env.DB, existing.id, fetched.meta).run();
      metadataUpdated = true;
    }
  }

  // Re-select only when the UPDATE above actually ran — otherwise `existing` is already current.
  const book = metadataUpdated
    ? await c.env.DB.prepare("SELECT * FROM books WHERE isbn = ?")
        .bind(isbn)
        .first<BookRow>()
    : existing;

  if (!book) return c.json({ error: "Book not found" }, 404);
  if (!book.work_id) await linkWork(c.env.DB, book);
  // force=true resets enrichment_status to 'pending' so enrichment re-runs even if already done.
  // Unlike the cron sweeper (which only picks up works that aren't 'done'), this forces any work.
  if (book.work_id)
    c.executionCtx.waitUntil(
      enrichWorkDetached(
        c.env.DB,
        book.work_id,
        true,
        c.env.GOOGLE_BOOKS_API_KEY,
        "refresh",
      ),
    );
  // `metadata_refreshed` distinguishes "nothing was missing" / "filled some gaps" from "both
  // sources still don't know this ISBN" — the last of which used to be the 404. Enrichment was
  // scheduled regardless, so it is not an error, just a fact about the metadata half.
  return c.json({ ...book, metadata_refreshed: !wasMissingMetadata || metadataUpdated });
});

books.patch("/override", async (c) => {
  const userId = c.get("userId");
  const body = await readJsonBody<{
    isbn: string;
    changes: Partial<Record<OverrideField, string | number | null>>;
  }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const { isbn: rawIsbn, changes } = body;

  if (typeof rawIsbn !== "string" || !rawIsbn)
    return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(rawIsbn);

  // `validateOverrides` uses `field in input`, and `in` throws a TypeError on a primitive — so a
  // body carrying `"changes": "x"` (or a number, or a boolean) was an unhandled 500 rather than a
  // 400, reachable by any authenticated caller since this runs ahead of the ownership check.
  if (changes != null && typeof changes !== "object")
    return c.json({ error: "changes must be an object" }, 400);

  const { values: validated, errors } = validateOverrides(changes);
  if (Object.keys(errors).length)
    return c.json({ error: "validation_failed", fields: errors }, 400);

  // No scan, no override: the 404 is the catalogue-miss answer on purpose — "we don't have that
  // book" and "you don't have that book" are the same answer to a caller who has neither.
  const book = await getScannedBookByIsbn(c.env.DB, userId, isbn);
  if (!book) return c.json({ error: "Book not found" }, 404);
  const locale = c.req.query("locale") ?? "en";

  // Nothing recognised in the payload — still answer with the row, so every success on this route
  // has one shape for the client to apply.
  const validFields = Object.keys(validated) as OverrideField[];
  if (!validFields.length)
    return c.json(await mergedScanRow(c.env.DB, userId, book.id, locale));

  const values = validFields.map((f) => validated[f] ?? null);
  const cols = validFields.join(", ");
  const placeholders = validFields.map(() => "?").join(", ");
  const setClauses = validFields.map((f) => `${f} = excluded.${f}`).join(", ");

  await c.env.DB.prepare(
    `
      INSERT INTO book_overrides (user_id, book_id, ${cols})
      VALUES (?, ?, ${placeholders})
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        ${setClauses},
        updated_at = datetime('now')
    `,
  )
    .bind(userId, book.id, ...values)
    .run();

  return c.json(await mergedScanRow(c.env.DB, userId, book.id, locale));
});

books.patch("/custom-fields", async (c) => {
  const userId = c.get("userId");
  const body = await readJsonBody<{
    isbn: string;
    values: Array<{ field_def_id: number; value: string }>;
  }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  if (typeof body.isbn !== "string" || !body.isbn)
    return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(body.isbn);
  // Same reason as `/override`'s `changes` guard: without this, `"values": "x"` is a
  // `.flatMap is not a function` 500 and `"values": [null]` a null-property read, both from an
  // ordinary authenticated request. Entry shapes are checked in the flatMap below.
  if (body.values != null && !Array.isArray(body.values))
    return c.json({ error: "values must be an array" }, 400);

  const [book, { results: ownedDefs }] = await Promise.all([
    // Same scan requirement as `/override` above, and the same 404 for a book this user hasn't
    // scanned — a custom-field value is per-user data hanging off a book they must actually hold.
    getScannedBookByIsbn(c.env.DB, userId, isbn),
    c.env.DB.prepare(
      "SELECT id, field_type, field_options FROM user_field_definitions WHERE user_id = ?",
    )
      .bind(userId)
      .all<{ id: number; field_type: string; field_options: string | null }>(),
  ]);
  if (!book) return c.json({ error: "Book not found" }, 404);

  const defsById = new Map(ownedDefs.map((d) => [d.id, d]));
  // A select field's value must be one of its own options (a stale client whose option was
  // renamed/removed since the form loaded), and an integer field's must actually be an
  // integer (the UI sanitizes keystrokes, but a direct API call bypasses that) — either way
  // an invalid value is silently cleared rather than stored, same as an orphaned select value.
  // Collected into a Map keyed by field_def_id, so a body naming the same field twice resolves to
  // one INSERT (last entry wins) instead of two. `book_custom_fields` is UNIQUE on
  // (user_id, book_id, field_def_id), so the duplicate used to fail the whole batch and surface as
  // an opaque 500 on an otherwise ordinary authenticated request.
  const values = new Map<number, string | null>();
  for (const v of body.values ?? []) {
    if (!v || typeof v !== "object") continue;
    const def = defsById.get(v.field_def_id);
    if (!def) continue;
    const trimmed = (v.value ?? "").trim();
    const isValid =
      !trimmed ||
      (def.field_type === "select"
        ? parseTagArray(def.field_options).includes(trimmed)
        : def.field_type === "integer"
          ? /^-?\d+$/.test(trimmed)
          : true);
    values.set(v.field_def_id, isValid ? trimmed || null : null);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?",
    ).bind(userId, book.id),
    ...[...values].map(([fieldDefId, value]) =>
      c.env.DB.prepare(
        "INSERT INTO book_custom_fields (user_id, book_id, field_def_id, field_value) VALUES (?, ?, ?, ?)",
      ).bind(userId, book.id, fieldDefId, value),
    ),
  ]);

  return c.json(
    await mergedScanRow(c.env.DB, userId, book.id, c.req.query("locale") ?? "en"),
  );
});

/**
 * The user's scan row for a book as `GET /api/scans` would report it, after a write.
 *
 * Both edit endpoints answer with this rather than `{ ok: true }`, because the effect of a save is
 * only knowable server-side: the `*_overridden` flags, and — when an override is *cleared* — the
 * catalogue value (or a sibling edition's description) that surfaces underneath it. The client used
 * to recompute the flags itself and optimistically show `null` for a cleared field, which is a
 * value the next page load would never agree with.
 */
async function mergedScanRow(
  db: D1Database,
  userId: number,
  bookId: number,
  locale: string,
) {
  const row = await db
    .prepare(`${buildScanSelect(locale)} WHERE s.user_id = ? AND s.book_id = ?`)
    .bind(userId, bookId)
    .first<any>();
  if (!row) return {};
  const { defs, valuesByBook } = await fetchCustomFields(db, userId, [
    row.book_id,
  ]);
  return attachCustomFields(row, defs, valuesByBook);
}

export default books;
