import { Hono } from "hono";
import type { Env, BookRow } from "../types";
import { authMiddleware } from "../auth";
import type { Context } from "hono";
import {
  resolveEdition,
  fetchBookMetadata,
  linkWork,
  searchBooksByTitle,
  searchLocalBooks,
  normalizeStr,
  UpstreamSearchError,
} from "../editions";
import { enrichWork } from "../enrichment";
import {
  getBookByIsbn,
  OVERRIDE_FIELDS,
  parseIntOr,
  parseTagArray,
  type OverrideField,
} from "../library-query";
import { normalizeIsbn, isValidIsbn } from "../isbn";
import { rateLimitOrReject } from "../rate-limit";

const books = new Hono<Env>();

// /refresh forces a fresh Google Books/OpenLibrary fetch plus a forced Wikidata SPARQL
// re-run (enrichWork force=true) — the most expensive call path in the app — so it gets a
// tighter per-user cap than routine per-scan traffic.
const REFRESH_RATE_LIMIT = 10;

// Title search results are stable and identical for every user, and the Google Books project has a
// hard daily query quota — so successful searches go in the Workers edge cache. Repeating a search
// (retyping in the scanner, an import re-checking the same title across rows) then costs nothing.
const SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60;

// Normalized so trivially different spellings share an entry. Deliberately not keyed by user:
// the response depends only on the query. Note this caches zero-result searches too — with
// `searchBooksByTitle` now throwing on upstream failure, an empty array is a real answer.
function searchCacheKeyString(
  title: string,
  author?: string,
  publisher?: string,
): string {
  const params = new URLSearchParams({ title: normalizeStr(title) });
  if (author) params.set("author", normalizeStr(author));
  if (publisher) params.set("publisher", normalizeStr(publisher));
  return params.toString();
}

function searchCacheKey(
  title: string,
  author?: string,
  publisher?: string,
): Request {
  return new Request(
    `https://bookscan-cache/search?${searchCacheKeyString(title, author, publisher)}`,
  );
}

// Shared by /search and /guest-search — same query, same answer, same cache entry.
//
// Checked in order: the Workers edge cache (colo-local, fastest, no DB round-trip at all), then
// our own catalog (free of Google quota, but an unindexed `LIKE '%...%'` substring scan of
// `books` — SQLite can't use an index for a leading wildcard, so this is a full table scan and
// worth skipping on a cache hit), then a D1-backed `search_cache` table (global — a search made
// from one datacenter is a hit from every other, unlike the edge cache alone), then Google Books
// itself. A D1 cache hit re-warms the edge cache so the next request from this colo skips the DB
// round-trip too.
//
// Trade-off: a book added to the local catalog while an identical query is still edge-cached
// (up to 6h) won't be surfaced as a local hit until that cache entry expires — same staleness
// window the cache already accepts for Google results, just extended to the local check too.
async function handleTitleSearch(c: Context<Env>): Promise<Response> {
  const title = c.req.query("title")?.trim();
  const author = c.req.query("author")?.trim() || undefined;
  const publisher = c.req.query("publisher")?.trim() || undefined;
  if (!title) return c.json({ error: "Title required" }, 400);

  const cache = caches.default;
  const cacheKey = searchCacheKey(title, author, publisher);
  const cached = await cache.match(cacheKey);
  // Re-wrap: cache.match responses have immutable headers, and the CORS middleware
  // mutates response headers after the handler returns.
  if (cached) return new Response(cached.body, cached);

  // A local hit is returned outright — no upstream call, and nothing to cache since the
  // catalog itself already is the up-to-date source. An empty result (new title, or a miss from
  // not normalizing diacritics) falls through to the cached/live search below exactly as before.
  const localResults = await searchLocalBooks(c.env.DB, title, author, publisher);
  if (localResults.length > 0) return c.json(localResults);

  const queryKey = searchCacheKeyString(title, author, publisher);
  const dbCached = await c.env.DB.prepare(
    "SELECT response FROM search_cache WHERE query_key = ? AND expires_at > ?",
  )
    .bind(queryKey, Date.now())
    .first<{ response: string }>();
  if (dbCached) {
    const res = new Response(dbCached.response, {
      headers: { "Content-Type": "application/json" },
    });
    res.headers.set("Cache-Control", `public, max-age=${SEARCH_CACHE_TTL_SECONDS}`);
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  }

  try {
    const results = await searchBooksByTitle(
      title,
      author,
      c.env.GOOGLE_BOOKS_API_KEY,
      20,
      publisher,
    );
    const body = JSON.stringify(results);
    const res = new Response(body, {
      headers: { "Content-Type": "application/json" },
    });
    res.headers.set("Cache-Control", `public, max-age=${SEARCH_CACHE_TTL_SECONDS}`);
    c.executionCtx.waitUntil(
      Promise.all([
        cache.put(cacheKey, res.clone()),
        c.env.DB.prepare(
          `INSERT INTO search_cache (query_key, response, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(query_key) DO UPDATE SET response = excluded.response, expires_at = excluded.expires_at`,
        )
          .bind(queryKey, body, Date.now() + SEARCH_CACHE_TTL_SECONDS * 1000)
          .run(),
      ]),
    );
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

// ── Public routes (no auth) ───────────────────────────────────────────────────

// Public guest lookup — no auth. Enrichment is intentionally NOT triggered here to avoid
// anonymous traffic driving Wikidata load; the work gets enriched when an authenticated
// user looks it up or scans it.
books.get("/guest-lookup", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
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

  const book = await resolveEdition(
    c.env.DB,
    isbn,
    c.env.GOOGLE_BOOKS_API_KEY,
    false,
    true,
  );
  if (!book) return c.json({ notFound: true }, 404);
  return c.json(book);
});

// Public guest title search — no auth. Mirrors /search for unauthenticated users.
books.get("/guest-search", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
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

  const book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY);
  if (!book) return c.json({ error: "Book not found" }, 404);
  if (book.work_id)
    c.executionCtx.waitUntil(
      enrichWork(
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
  if (hasMissingMetadata(existing)) {
    const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY);
    if (!bookData) return c.json({ error: "Book not found in any source" }, 404);

    await c.env.DB.prepare(
      `
        UPDATE books SET
          title = COALESCE(title, ?),
          author = COALESCE(author, ?),
          cover_url = COALESCE(cover_url, ?),
          language = COALESCE(language, ?),
          publish_date = COALESCE(publish_date, ?),
          number_of_pages_median = COALESCE(NULLIF(number_of_pages_median, 0), ?),
          description = COALESCE(description, ?),
          publisher = COALESCE(publisher, ?),
          physical_format = COALESCE(physical_format, ?),
          edition_name = COALESCE(edition_name, ?),
          physical_dimensions = COALESCE(physical_dimensions, ?),
          categories = COALESCE(categories, ?)
        WHERE isbn = ?
      `,
    )
      .bind(
        bookData.title,
        bookData.author,
        bookData.cover_url,
        bookData.language,
        bookData.publish_date,
        bookData.number_of_pages_median,
        bookData.description,
        bookData.publisher,
        bookData.physical_format,
        bookData.edition_name,
        bookData.physical_dimensions,
        bookData.categories,
        isbn,
      )
      .run();
  }

  // Re-select only when the UPDATE above could have changed something — otherwise `existing`
  // is already current.
  const book = hasMissingMetadata(existing)
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
      enrichWork(
        c.env.DB,
        book.work_id,
        true,
        c.env.GOOGLE_BOOKS_API_KEY,
        "refresh",
      ),
    );
  return c.json(book);
});

books.patch("/override", async (c) => {
  const userId = c.get("userId");
  const { isbn: rawIsbn, changes } = await c.req.json<{
    isbn: string;
    changes: Partial<Record<OverrideField, string | number | null>>;
  }>();

  if (!rawIsbn) return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(rawIsbn);

  const validFields = Object.keys(changes ?? {}).filter((f) =>
    (OVERRIDE_FIELDS as readonly string[]).includes(f),
  ) as OverrideField[];
  if (!validFields.length) return c.json({ ok: true });

  const book = await getBookByIsbn(c.env.DB, isbn);
  if (!book) return c.json({ error: "Book not found" }, 404);

  const values = validFields.map((f) => changes[f] ?? null);
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

  return c.json({ ok: true });
});

books.patch("/custom-fields", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    isbn: string;
    values: Array<{ field_def_id: number; value: string }>;
  }>();
  if (!body.isbn) return c.json({ error: "ISBN required" }, 400);
  const isbn = normalizeIsbn(body.isbn);

  const [book, { results: ownedDefs }] = await Promise.all([
    getBookByIsbn(c.env.DB, isbn),
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
  const values = (body.values ?? []).flatMap((v) => {
    const def = defsById.get(v.field_def_id);
    if (!def) return [];
    const trimmed = (v.value ?? "").trim();
    const isValid =
      !trimmed ||
      (def.field_type === "select"
        ? parseTagArray(def.field_options).includes(trimmed)
        : def.field_type === "integer"
          ? /^-?\d+$/.test(trimmed)
          : true);
    return [{ field_def_id: v.field_def_id, value: isValid ? trimmed || null : null }];
  });

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?",
    ).bind(userId, book.id),
    ...values.map((v) =>
      c.env.DB.prepare(
        "INSERT INTO book_custom_fields (user_id, book_id, field_def_id, field_value) VALUES (?, ?, ?, ?)",
      ).bind(userId, book.id, v.field_def_id, v.value),
    ),
  ]);

  return c.json({ ok: true });
});

export default books;
