import type { BookRow, BookMetadata } from "./types";
import {
  normalizeCoverUrl,
  openLibraryCoverUrlById,
  pickCoverUrl,
} from "./cover-url";
import { alternateIsbnForm, isbnForms, normalizeIsbn } from "./isbn";
import { dedupeTrimmed } from "./library-query";
import { outcomeForStatus } from "./usage";
import type { UsageOperation, UsageOutcome, UsageRecorder } from "./usage";

/**
 * Every outbound HTTP call in this module goes through here, so this is where they are counted
 * against the invocation's subrequest budget — see `UsageRecorder.countFetch`. Counting here rather
 * than at the call sites is what makes the count exact: a new call site cannot forget, and calls
 * whose *telemetry* is skipped (the OpenLibrary work-description read) are still metered.
 */
async function fetchWithTimeout<T>(
  url: string,
  usage: UsageRecorder | null | undefined,
  /**
   * Everything the caller needs from the response — status checks, header reads and the body
   * parse alike — because this runs *inside* the timeout.
   *
   * `fetch()` in Workers resolves as soon as the response **headers** arrive, so a helper that
   * returned the `Response` and cleared its timer had already stopped guarding by the time the
   * caller read the body. An upstream that answered 200 and then stalled mid-stream — a realistic
   * mode for OpenLibrary and for the 25s SPARQL endpoint under load — left `res.json()` hanging
   * with nothing to abort it, until the platform's own limits killed the invocation. For the cron
   * that also stranded the tick's `usage.flush()`, losing every counter it had accumulated.
   * Aborting the controller aborts the body stream too, so keeping the callback inside restores
   * the intended end-to-end bound at no extra cost.
   */
  consume: (res: Response) => Promise<T>,
  opts: RequestInit = {},
  timeoutMs = 4000,
): Promise<T> {
  usage?.countFetch();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await consume(await fetch(url, { ...opts, signal: ctrl.signal }));
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Thrown when Google Books couldn't be reached or refused the request (429/5xx/network). */
export class UpstreamSearchError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Google Books upstream failed with status ${status}`);
    this.name = "UpstreamSearchError";
  }
}

// A cap on Retry-After: on a *daily* quota 429 Google may ask for hours, and a Worker can't wait
// that long. Backing off a second and failing cleanly beats hanging the request.
const MAX_RETRY_AFTER_MS = 2000;

const MAX_ATTEMPTS_5XX = 4;
// 429 covers both per-minute rate limiting (worth one retry) and the daily quota (retrying is
// pure waste — it can only fail). One extra attempt splits the difference.
const MAX_ATTEMPTS_429 = 2;

interface GoogleBooksResult {
  data: any;
  status: number;
  /** false = the request failed; `data` is meaningless. Distinguishes failure from "0 results". */
  ok: boolean;
  retryAfterSeconds?: number;
}

interface GoogleBooksOptions {
  /**
   * Whether transient failures (429 rate-limit, 5xx) are worth retrying at all. True only for
   * callers with no fallback (title search). The ISBN lookup falls back to OpenLibrary, so it
   * should fail fast on any transient error instead of spending seconds backing off — that
   * reasoning applies to a 5xx blip just as much as a 429.
   */
  retryTransient: boolean;
  /** Which counter the call is charged to in `api_usage`. Narrowed from `UsageOperation` so a
   *  label the counters don't recognise is a compile error rather than a phantom row. */
  operation: Extract<UsageOperation, "isbn_lookup" | "title_search">;
  /** Omitted only where no recorder is available (unit tests); then nothing is recorded. */
  usage?: UsageRecorder | null;
}

// Google Books' backend intermittently returns 5xx ("Service temporarily unavailable") for
// otherwise-valid queries, sometimes on consecutive requests — retry a few times with
// increasing backoff before giving up.
//
// Callers must check `ok`: a 429/5xx response body is `{error: {...}}` with no `items`, which is
// otherwise indistinguishable from a legitimate zero-result search.
async function fetchGoogleBooksJson(
  url: string,
  { retryTransient, operation, usage }: GoogleBooksOptions,
): Promise<GoogleBooksResult> {
  let status = 0;
  let retryAfterSeconds: number | undefined;
  // Counted per HTTP attempt rather than per logical call: a retry spends daily quota just like
  // the first try did, so attempts are the honest number to hold against the cap.
  const record = (outcome: UsageOutcome) =>
    usage?.record("google_books", operation, outcome);

  for (let attempt = 0; attempt < MAX_ATTEMPTS_5XX; attempt++) {
    // Guards against an attempt being counted twice when the response arrives but parsing it
    // throws — that's one call to Google, whatever went wrong afterwards.
    let recorded = false;
    try {
      // Response inspection and the body parse both happen inside `consume`; only the retry
      // decision (which may sleep, and must not hold the request open) is made out here.
      const outcome = await fetchWithTimeout(
        url,
        usage,
        async (
          res,
        ): Promise<
          | { kind: "transient"; hinted: number }
          | { kind: "failed" }
          | { kind: "ok"; data: any }
        > => {
          status = res.status;
          record(outcomeForStatus(status));
          recorded = true;
          if (status === 429 || status >= 500)
            return {
              kind: "transient",
              hinted: Number(res.headers.get("Retry-After")),
            };
          if (!res.ok) return { kind: "failed" };
          return { kind: "ok", data: await res.json() };
        },
      );

      if (outcome.kind === "ok")
        return { data: outcome.data, status, ok: true };
      if (outcome.kind === "failed")
        return { data: undefined, status, ok: false };

      if (Number.isFinite(outcome.hinted) && outcome.hinted > 0)
        retryAfterSeconds = outcome.hinted;
      const retryable =
        retryTransient &&
        (status >= 500 || (status === 429 && attempt < MAX_ATTEMPTS_429 - 1));
      if (retryable && attempt < MAX_ATTEMPTS_5XX - 1) {
        const backoff = 300 * (attempt + 1);
        const hintedMs = retryAfterSeconds ? retryAfterSeconds * 1000 : 0;
        await sleep(Math.min(Math.max(backoff, hintedMs), MAX_RETRY_AFTER_MS));
        continue;
      }
      return { data: undefined, status, ok: false, retryAfterSeconds };
    } catch {
      if (!recorded) record("error");
      // `retryTransient` gates this arm too. A thrown failure — the 4s abort, a network error, a
      // non-JSON body — is exactly the transient case the flag exists to fail fast on, and the
      // slowest of them: leaving it ungated meant the ISBN path, which passes `retryTransient:
      // false` precisely to avoid backoff, still spent 4 attempts x 4s on a stalled Google.
      // `recorded` means the response arrived and parsing it threw; re-fetching would spend
      // another quota unit on a body that will not parse the second time either.
      if (retryTransient && !recorded && attempt < MAX_ATTEMPTS_5XX - 1) continue;
      return { data: undefined, status, ok: false };
    }
  }
  return { data: undefined, status, ok: false };
}

/**
 * One source's answer about one ISBN. The middle case is the whole point: "I asked and it doesn't
 * have this book" and "I couldn't ask" are different facts, and collapsing them is what let an
 * outage be recorded as *this ISBN does not exist* — permanently, in a catalogue shared by every
 * user. `missing` is a conclusion; `unavailable` is the absence of one.
 */
type SourceResult =
  | { kind: "found"; meta: BookMetadata }
  | { kind: "missing" }
  | { kind: "unavailable" };

async function fetchFromGoogleBooks(
  isbn: string,
  apiKey: string,
  usage?: UsageRecorder | null,
): Promise<SourceResult> {
  // retryTransient: false — fetchBookMetadata runs OpenLibrary in parallel and merges, so a
  // quota-rejected or 5xx-failing Google call should give up immediately rather than delay the
  // whole row waiting on backoff.
  const { data, ok } = await fetchGoogleBooksJson(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&key=${apiKey}`,
    { retryTransient: false, operation: "isbn_lookup", usage },
  );
  // `ok` is what `fetchGoogleBooksJson`'s contract tells callers to check, and this call site used
  // to destructure only `data`: a 429 or 5xx body has no `items`, so every upstream failure read
  // as "Google doesn't have this ISBN".
  if (!ok) return { kind: "unavailable" };
  const info = data?.items?.[0]?.volumeInfo;
  if (!info) return { kind: "missing" };
  // Google's categories are often BISAC-style ("Fiction / Fantasy / General") — split on the
  // separator and dedupe so they're usable as flat genre tags when Wikidata has no P136 genres.
  const rawCategories: string[] = info.categories ?? [];
  const cleanedCategories = dedupeTrimmed(
    rawCategories.flatMap((c) => c.split(" / ")),
  );
  return {
    kind: "found",
    meta: {
      title: info.title ?? null,
      author: info.authors?.join(", ") ?? null,
      cover_url: normalizeCoverUrl(info.imageLinks?.thumbnail),
      language: info.language ?? null,
      publish_date: info.publishedDate ?? null,
      number_of_pages_median: info.pageCount > 0 ? info.pageCount : null,
      description: info.description ?? null,
      publisher: info.publisher ?? null,
      physical_format: null,
      edition_name: null,
      physical_dimensions: null,
      categories: cleanedCategories.length
        ? JSON.stringify(cleanedCategories)
        : null,
    },
  };
}

// OpenLibrary edition records frequently have no description of their own — it lives on the
// work record instead. Best-effort: failures/timeouts just leave the description null.
async function fetchOpenLibraryWorkDescription(
  workKey: string,
  usage?: UsageRecorder | null,
): Promise<string | null> {
  try {
    const work: any = await fetchWithTimeout(
      `https://openlibrary.org${workKey}.json`,
      usage,
      (res) => res.json() as Promise<any>,
    );
    return typeof work.description === "string"
      ? work.description
      : (work.description?.value ?? null);
  } catch {
    return null;
  }
}

// Fetches data (existing fields) and details (physical_dimensions, edition_name, work link) in
// parallel. The details fetch is best-effort; failures leave those fields null.
//
// Counted once per logical lookup rather than per inner fetch — OpenLibrary has no quota, so what's
// worth watching is how often the lookup as a whole works. A bibkey miss still counts as a success:
// the call answered, the answer was "not here".
async function fetchOpenLibraryBibkey(
  base: string,
  usage?: UsageRecorder | null,
): Promise<[any, any]> {
  try {
    // `res.ok` is carried out of the timed scope, as `fetchEditionsForWorkKey` does, rather than
    // parsing whatever came back: OpenLibrary answers a 429 or 503 with a JSON body, so a bare
    // `r.json()` resolves and the outage is then indistinguishable from "this ISBN isn't here" —
    // an empty bibkey map, i.e. `missing`. That conflation is what makes `/api/books/lookup`
    // answer 404 during an outage instead of 503, and what lets a scan settle an all-NULL row.
    const pair = await Promise.all([
      fetchWithTimeout(base + "&jscmd=data", usage, async (r) => {
        if (!r.ok) throw new Error(`OpenLibrary bibkey HTTP ${r.status}`);
        return (await r.json()) as any;
      }),
      // The details half stays best-effort either way — it only fills physical_dimensions and
      // edition_name, and a miss there is not an outage.
      fetchWithTimeout(base + "&jscmd=details", usage, async (r) =>
        r.ok ? ((await r.json()) as any) : {},
      ).catch(() => ({})),
    ]);
    usage?.record("openlibrary", "isbn_lookup", "success");
    return pair;
  } catch (e) {
    usage?.record("openlibrary", "isbn_lookup", "error");
    throw e;
  }
}

// The bibkey payload → BookMetadata mapping, split out from the fetch so the latter is just the
// request and its three outcomes. OpenLibrary's shapes are irregular enough (description as a
// string *or* a {value} object, dimensions likewise, covers under two size keys) that the
// nullish-coalescing alone carries most of this function's branching.
async function openLibraryMeta(
  book: any,
  details: any,
  usage?: UsageRecorder | null,
): Promise<BookMetadata> {
  const pdRaw = details?.physical_dimensions;
  let description =
    typeof book.description === "string"
      ? book.description
      : (book.description?.value ?? null);
  const workKey = details?.works?.[0]?.key;
  if (!description && workKey)
    description = await fetchOpenLibraryWorkDescription(workKey, usage);

  return {
    title: book.title ?? null,
    author: book.authors?.[0]?.name ?? null,
    cover_url: normalizeCoverUrl(book.cover?.large ?? book.cover?.medium),
    language: null,
    publish_date: book.publish_date ?? null,
    number_of_pages_median:
      book.number_of_pages > 0 ? book.number_of_pages : null,
    description,
    publisher: book.publishers?.[0]?.name ?? null,
    physical_format: book.physical_format ?? null,
    edition_name: details?.edition_name ?? null,
    physical_dimensions:
      typeof pdRaw === "string" ? pdRaw : (pdRaw?.value ?? null),
    categories: null, // OpenLibrary's API doesn't expose BISAC-style categories
  };
}

async function fetchFromOpenLibrary(
  isbn: string,
  usage?: UsageRecorder | null,
): Promise<SourceResult> {
  const bibkey = `ISBN:${isbn}`;
  const base = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibkey)}&format=json`;

  // A throw here is the request failing (a non-2xx status, timeout, network, a body that won't
  // parse); an empty bibkey map is OpenLibrary answering that it has nothing — the unknown-ISBN
  // answer is a 200 carrying `{}`, not a 404. Caught here rather than by the
  // caller so the two stay distinguishable — `fetchBookMetadata` used to wrap this whole call in
  // `.catch(() => null)`, which made them identical.
  let dataJson: any, detailsJson: any;
  try {
    [dataJson, detailsJson] = await fetchOpenLibraryBibkey(base, usage);
  } catch {
    return { kind: "unavailable" };
  }

  const book = dataJson[bibkey];
  if (!book) return { kind: "missing" };
  const details: any = detailsJson[bibkey]?.details ?? null;
  return { kind: "found", meta: await openLibraryMeta(book, details, usage) };
}

// Fill any null field in `primary` from `fallback` (primary's non-null values always win).
export function mergeMetadata(
  primary: BookMetadata,
  fallback: BookMetadata,
): BookMetadata {
  const out = { ...primary };
  for (const key of Object.keys(out) as (keyof BookMetadata)[]) {
    if (out[key] == null)
      (out[key] as BookMetadata[typeof key]) = fallback[key];
  }
  return out;
}

/** What a metadata lookup concluded. See `SourceResult` for why `missing` and `unavailable` differ. */
export type MetadataResult =
  | { kind: "found"; meta: BookMetadata }
  | { kind: "missing" }
  | { kind: "unavailable" };

/**
 * Tries Google Books, then fills gaps from OpenLibrary. Google often omits page counts and never
 * returns physical_format/edition_name/physical_dimensions, so we consult OpenLibrary even when
 * Google has the book.
 *
 * `missing` requires **both** sources to have answered and neither to know the ISBN — anything
 * less is `unavailable`. A partial answer (one source down, the other has the book) is still
 * `found`, just thinner than usual; `POST /api/books/refresh` fills the gaps later.
 *
 * No API key counts as `unavailable` rather than `missing`: we didn't ask, so nothing was
 * established. That is the sweeper's over-budget path, where withholding the key is deliberate and
 * a total miss is meant to leave no row so a later run retries — exactly what `unavailable` gives.
 */
export async function fetchBookMetadata(
  isbn: string,
  googleApiKey?: string,
  usage?: UsageRecorder | null,
): Promise<MetadataResult> {
  const unavailable = { kind: "unavailable" } as const;
  const [google, openlib] = await Promise.all([
    googleApiKey
      ? fetchFromGoogleBooks(isbn, googleApiKey, usage).catch(() => unavailable)
      : Promise.resolve<SourceResult>(unavailable),
    fetchFromOpenLibrary(isbn, usage).catch(() => unavailable),
  ]);

  if (google.kind === "found" && openlib.kind === "found") {
    const merged = mergeMetadata(google.meta, openlib.meta);
    // The one field where the merge's Google-wins rule is wrong: Google's cover is a 128px
    // thumbnail and OpenLibrary's is ~330px, and this is the path both were fetched on — so the
    // sharper image is already in hand and the merge was the only thing discarding it.
    return {
      kind: "found",
      meta: {
        ...merged,
        cover_url: pickCoverUrl(google.meta.cover_url, openlib.meta.cover_url),
      },
    };
  }
  if (google.kind === "found") return { kind: "found", meta: google.meta };
  if (openlib.kind === "found") return { kind: "found", meta: openlib.meta };
  if (google.kind === "unavailable" || openlib.kind === "unavailable")
    return unavailable;
  return { kind: "missing" };
}

/**
 * Thrown where a caller must not mistake an outage for an answer. Sibling of `UpstreamSearchError`
 * on the title-search path, and there for the same reason: the routes that only *read* metadata
 * have to say "lookup unavailable" rather than "no such book", because 404 is a claim about the
 * world that a failed request cannot support.
 */
export class UpstreamLookupError extends Error {
  constructor(readonly isbn: string) {
    super(`Metadata lookup unavailable for ISBN ${isbn}`);
    this.name = "UpstreamLookupError";
  }
}

/**
 * A `books` row carrying no identity at all — nothing to render a card from. Deliberately much
 * narrower than `hasMissingMetadata` in `routes/books.ts`, which is true for almost every real
 * book (`physical_dimensions` is rarely populated) and would make this re-fetch on every lookup.
 *
 * Rows like this are created by one path: `POST /api/scans` under `allowEmpty`, when the fetch
 * came back with nothing. Goodreads-import rows are *not* included even when both sources miss —
 * they carry the CSV's title and author — which is what keeps the "misses on every attempt by
 * construction" population out of the retry below, and its quota with it.
 */
function isMetadataEmpty(book: BookRow): boolean {
  return (
    book.title == null && book.author == null && book.cover_url == null
  );
}

/**
 * Fills only the NULL columns of an existing `books` row, never overwriting a value already there
 * (a 0 page count counts as absent — Google returns 0 for "unknown"). Shared by
 * `POST /api/books/refresh` and `resolveEdition`'s repair of a metadata-empty row, so the two
 * cannot disagree about what "fill the gaps" means.
 */
export function fillMetadataStatement(
  db: D1Database,
  bookId: number,
  meta: BookMetadata,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE books SET
         title                  = COALESCE(title, ?),
         author                 = COALESCE(author, ?),
         cover_url              = COALESCE(cover_url, ?),
         language               = COALESCE(language, ?),
         publish_date           = COALESCE(publish_date, ?),
         number_of_pages_median = COALESCE(NULLIF(number_of_pages_median, 0), ?),
         description            = COALESCE(description, ?),
         publisher              = COALESCE(publisher, ?),
         physical_format        = COALESCE(physical_format, ?),
         edition_name           = COALESCE(edition_name, ?),
         physical_dimensions    = COALESCE(physical_dimensions, ?),
         categories             = COALESCE(categories, ?)
       WHERE id = ?`,
    )
    .bind(
      meta.title,
      meta.author,
      meta.cover_url,
      meta.language,
      meta.publish_date,
      meta.number_of_pages_median,
      meta.description,
      meta.publisher,
      meta.physical_format,
      meta.edition_name,
      meta.physical_dimensions,
      meta.categories,
      bookId,
    );
}

// ── Title search ──────────────────────────────────────────────────────────────

export type EditionCandidate = {
  isbn: string;
  title: string | null;
  author: string | null;
  cover_url: string | null;
  publish_date: string | null;
  publisher: string | null;
};

// Escapes LIKE's own wildcards so a title/author containing a literal "%" or "_" (rare, but not
// impossible) is matched as text rather than as a pattern.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, String.raw`\$&`);
}

// Checked before spending Google Books quota — as the catalog grows, a meaningful share of
// title searches turn out to already be sitting in `books` (someone else scanned/imported the
// same title). Deliberately a plain substring match against the raw stored title/author, not
// `normalizeStr`'d: SQLite's LIKE is already case-insensitive for ASCII, and there's no
// normalized column to match against without a schema change. A miss here (e.g. a diacritic
// mismatch) just falls through to Google, same as an empty catalog would.
async function searchLocalBooks(
  db: D1Database,
  title: string,
  author: string | undefined,
  publisher: string | undefined,
  limit = 20,
): Promise<EditionCandidate[]> {
  const conditions = [String.raw`title LIKE ? ESCAPE '\'`];
  const binds: string[] = [`%${escapeLike(title)}%`];
  if (author) {
    conditions.push(String.raw`author LIKE ? ESCAPE '\'`);
    binds.push(`%${escapeLike(author)}%`);
  }
  if (publisher) {
    conditions.push(String.raw`publisher LIKE ? ESCAPE '\'`);
    binds.push(`%${escapeLike(publisher)}%`);
  }

  const { results } = await db
    .prepare(
      `SELECT isbn, title, author, cover_url, publish_date, publisher
       FROM books
       WHERE ${conditions.join(" AND ")}
       ORDER BY fetched_at DESC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<EditionCandidate>();

  return results;
}

export async function searchBooksByTitle(
  title: string,
  author: string | undefined,
  apiKey: string,
  limit = 20,
  publisher?: string,
  usage?: UsageRecorder | null,
): Promise<EditionCandidate[]> {
  let q = `intitle:"${encodeURIComponent(title)}"`;
  if (author) q += `+inauthor:"${encodeURIComponent(author)}"`;
  if (publisher) q += `+inpublisher:"${encodeURIComponent(publisher)}"`;
  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20&key=${apiKey}`;

  // retryTransient: true — Google Books is the only source of title-search candidates; there's
  // no fallback to soften a transient rate-limit or 5xx rejection.
  const { data, status, ok, retryAfterSeconds } = await fetchGoogleBooksJson(
    url,
    { retryTransient: true, operation: "title_search", usage },
  );

  // Fail loudly rather than returning []: a quota/rate-limit rejection is not the same answer as
  // "this title doesn't exist", and callers (and users) need to tell them apart.
  if (!ok) throw new UpstreamSearchError(status, retryAfterSeconds);

  // A genuine zero-result search: Google returns 200 with `totalItems: 0` and no `items` key.
  if (!Array.isArray(data?.items)) return [];

  const seen = new Set<string>();
  const results: EditionCandidate[] = [];

  for (const item of data.items) {
    if (results.length >= limit) break;
    // A single malformed entry (unexpected shape from Google) shouldn't fail the whole search —
    // skip it and keep processing the rest, mirroring the old catch-all's graceful degradation.
    try {
      const info = item.volumeInfo;
      if (!info) continue;

      const identifiers: Array<{ type: string; identifier: string }> =
        info.industryIdentifiers ?? [];
      const isbn13 = identifiers.find((i) => i.type === "ISBN_13")?.identifier;
      const isbn10 = identifiers.find((i) => i.type === "ISBN_10")?.identifier;
      const isbn = isbn13 ?? isbn10;
      if (!isbn || seen.has(isbn)) continue;
      seen.add(isbn);

      results.push({
        isbn,
        title: info.title ?? null,
        author: info.authors?.join(", ") ?? null,
        cover_url: normalizeCoverUrl(info.imageLinks?.thumbnail),
        publish_date: info.publishedDate ?? null,
        publisher: info.publisher ?? null,
      });
    } catch (e) {
      console.error("[searchBooksByTitle] skipping malformed item:", e);
    }
  }

  return results;
}

// Title search results are stable and identical for every user, and the Google Books project has a
// hard daily query quota — so successful searches are cached. 6h.
export const SEARCH_CACHE_TTL_SECONDS = 6 * 60 * 60;

/** A title search's query, as every layer of the chain below keys it. */
export interface TitleQuery {
  title: string;
  author?: string;
  publisher?: string;
}

// Normalized so trivially different spellings share an entry. Deliberately not keyed by user:
// the response depends only on the query.
export function searchCacheKeyString({
  title,
  author,
  publisher,
}: TitleQuery): string {
  const params = new URLSearchParams({ title: normalizeStr(title) });
  if (author) params.set("author", normalizeStr(author));
  if (publisher) params.set("publisher", normalizeStr(publisher));
  return params.toString();
}

/**
 * Title search with the shared caches in front of it: our own catalog first (free of Google quota),
 * then the D1 `search_cache` table (global — a search made from one datacenter is a hit from every
 * other), then Google Books itself, whose answer is written back to `search_cache`.
 *
 * `fromLocalCatalog` marks the one answer a caller must not cache any further: the catalog is the
 * live source, and freezing it would hide the rows that keep being added to it.
 *
 * Throws `UpstreamSearchError` when Google rejects the query — never cached, since a quota/rate-limit
 * rejection says nothing about the query. `GET /api/books/search` wraps this in the Workers edge
 * cache and turns that throw into a 503; the import wizard's auto-ISBN pass calls it directly.
 */
export async function searchTitleCached(
  db: D1Database,
  apiKey: string,
  query: TitleQuery,
  // The cache write is off the critical path: the answer is already in hand, and the caller has a
  // response to return. Both call sites pass `c.executionCtx.waitUntil`.
  waitUntil: (p: Promise<unknown>) => void,
  usage?: UsageRecorder | null,
): Promise<{ results: EditionCandidate[]; fromLocalCatalog: boolean }> {
  const { title, author, publisher } = query;
  // An unindexed `LIKE '%...%'` substring scan of `books` — SQLite can't use an index for a leading
  // wildcard. An empty result (new title, or a miss from not normalizing diacritics) falls through.
  const localResults = await searchLocalBooks(db, title, author, publisher);
  if (localResults.length > 0) {
    return { results: localResults, fromLocalCatalog: true };
  }

  const queryKey = searchCacheKeyString(query);
  const dbCached = await db
    .prepare(
      "SELECT response FROM search_cache WHERE query_key = ? AND expires_at > ?",
    )
    .bind(queryKey, Date.now())
    .first<{ response: string }>();
  if (dbCached) {
    return {
      results: JSON.parse(dbCached.response) as EditionCandidate[],
      fromLocalCatalog: false,
    };
  }

  const results = await searchBooksByTitle(
    title,
    author,
    apiKey,
    20,
    publisher,
    usage,
  );
  // Zero-result searches are cached too: with `searchBooksByTitle` throwing on upstream failure, an
  // empty array is a real answer.
  waitUntil(
    db
      .prepare(
        `INSERT INTO search_cache (query_key, response, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(query_key) DO UPDATE SET response = excluded.response, expires_at = excluded.expires_at`,
      )
      .bind(
        queryKey,
        JSON.stringify(results),
        Date.now() + SEARCH_CACHE_TTL_SECONDS * 1000,
      )
      .run(),
  );
  return { results, fromLocalCatalog: false };
}

// ── Related editions (OpenLibrary works/editions) ────────────────────────────────

// MARC/ISO-639-2(B) → ISO-639-1, for the languages this app is likely to see. OpenLibrary's
// editions.json reports languages in this 3-letter form; falls back to the raw code (still
// usable, just less polished in Intl.DisplayNames) for anything not in this table.
const ISO_639_2_TO_1: Record<string, string> = {
  eng: "en",
  ger: "de",
  deu: "de",
  fre: "fr",
  fra: "fr",
  spa: "es",
  ita: "it",
  por: "pt",
  dut: "nl",
  nld: "nl",
  rus: "ru",
  pol: "pl",
  swe: "sv",
  nor: "no",
  dan: "da",
  fin: "fi",
  gre: "el",
  ell: "el",
  tur: "tr",
  ara: "ar",
  heb: "he",
  jpn: "ja",
  chi: "zh",
  zho: "zh",
  kor: "ko",
  hin: "hi",
  cze: "cs",
  ces: "cs",
  hun: "hu",
  rum: "ro",
  ron: "ro",
  ukr: "uk",
  hrv: "hr",
  srp: "sr",
  slo: "sk",
  slk: "sk",
  slv: "sl",
  bul: "bg",
  lit: "lt",
  lav: "lv",
  est: "et",
  gle: "ga",
  cat: "ca",
  baq: "eu",
  eus: "eu",
  glg: "gl",
  ice: "is",
  isl: "is",
  alb: "sq",
  sqi: "sq",
  mac: "mk",
  mkd: "mk",
  vie: "vi",
  tha: "th",
  ind: "id",
  may: "ms",
  msa: "ms",
};

function mapLanguageCode(olKey: string | undefined): string | null {
  if (!olKey) return null;
  const code = olKey.replace("/languages/", "");
  return ISO_639_2_TO_1[code] ?? code;
}

export type OpenLibraryEdition = {
  isbn: string;
  title: string | null;
  language: string | null;
  cover_url: string | null;
  publish_date: string | null;
  publisher: string | null;
};

// Given an ISBN, resolves its OpenLibrary work and returns every edition OpenLibrary knows for
// that work (other printings, translations) — replaces LibraryThing's thingISBN, which sits
// behind Cloudflare and blocks Workers-origin traffic via Bot Fight Mode (confirmed: the "403"
// was Cloudflare's own challenge page, not an app-level rejection — unfixable from server fetch()).
// Returns null on failure (network/timeout/non-2xx) — distinct from a successful call that found
// no further editions — so the caller doesn't permanently cache a transient error as "none found".
export async function fetchOpenLibraryEditions(
  isbn: string,
  usage?: UsageRecorder | null,
): Promise<OpenLibraryEdition[] | null> {
  try {
    // Only this request is timed here; the editions fetch below is a separate request that
    // carries its own timeout, so it stays outside the callback.
    const lookup = await fetchWithTimeout(
      `https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`,
      usage,
      async (
        res,
      ): Promise<
        { kind: "none" } | { kind: "failed"; status: number } | { kind: "work"; workKey: string }
      > => {
        // 404 = ISBN unknown to OpenLibrary — nothing to expand from, not an error.
        if (res.status === 404) return { kind: "none" };
        if (!res.ok) return { kind: "failed", status: res.status };
        const edition: any = await res.json();
        const workKey: string | undefined = edition.works?.[0]?.key;
        return workKey ? { kind: "work", workKey } : { kind: "none" };
      },
    );
    if (lookup.kind === "none") return [];
    if (lookup.kind === "failed") {
      console.error(
        `[OL editions] HTTP ${lookup.status} resolving isbn ${isbn}`,
      );
      return null;
    }

    return await fetchEditionsForWorkKey(lookup.workKey, usage);
  } catch (e) {
    console.error(`[OL editions] failed for isbn ${isbn}:`, e);
    return null;
  }
}

// Same contract, keyed by an OpenLibrary work id (e.g. "OL2943602W" from Wikidata P648) instead
// of a seed ISBN — works even when none of the owned editions' ISBNs exist in OpenLibrary.
export async function fetchOpenLibraryEditionsByWorkId(
  olWorkId: string,
  usage?: UsageRecorder | null,
): Promise<OpenLibraryEdition[] | null> {
  if (!/^OL\d+W$/.test(olWorkId)) {
    console.warn(`[OL editions] invalid work id: ${olWorkId}`);
    return [];
  }
  try {
    return await fetchEditionsForWorkKey(`/works/${olWorkId}`, usage);
  } catch (e) {
    console.error(`[OL editions] failed for work ${olWorkId}:`, e);
    return null;
  }
}

async function fetchEditionsForWorkKey(
  workKey: string,
  usage?: UsageRecorder | null,
): Promise<OpenLibraryEdition[] | null> {
  // The body is parsed inside the timed scope, so what comes back is the status plus the already
  // -read payload rather than a Response whose stream is no longer guarded.
  let fetched: { status: number; ok: boolean; data: any };
  try {
    fetched = await fetchWithTimeout(
      `https://openlibrary.org${workKey}/editions.json?limit=200`,
      usage,
      async (res) => ({
        status: res.status,
        ok: res.ok,
        data: res.ok ? await res.json() : null,
      }),
    );
  } catch (e) {
    usage?.record("openlibrary", "editions", "error");
    throw e;
  }
  // A 404 means the work has no editions listing, which is an answer rather than a failure —
  // hence classified here instead of by `outcomeForStatus`.
  usage?.record(
    "openlibrary",
    "editions",
    fetched.status === 404 ? "success" : outcomeForStatus(fetched.status),
  );
  if (fetched.status === 404) return [];
  if (!fetched.ok) {
    console.error(
      `[OL editions] HTTP ${fetched.status} fetching ${workKey}/editions.json`,
    );
    return null;
  }
  const data: any = fetched.data;
  const entries: any[] = data.entries ?? [];

  const out: OpenLibraryEdition[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    // normalizeIsbn, not a bare dash-strip: OpenLibrary reports the ISBN-10 check digit in either
    // case, and a lowercase `x` never string-matches the uppercased ISBNs every route boundary
    // produces — so such a candidate could never be recognised as an edition the user already has.
    const raw = (e.isbn_13?.[0] ?? e.isbn_10?.[0]) as string | undefined;
    const entryIsbn = raw ? normalizeIsbn(raw) : undefined;
    if (!entryIsbn || seen.has(entryIsbn)) continue;
    seen.add(entryIsbn);
    out.push({
      isbn: entryIsbn,
      title: e.title ?? null,
      language: mapLanguageCode(e.languages?.[0]?.key),
      // `-L` (~330 px), where this used to hardcode `-M`: the carousel paints these at ~170 CSS
      // px, i.e. 340 device px on a 2x display, so `-M`'s 180 px is already upscaled. Candidates
      // written before this keep `-M` — `saveEditionCandidates` is INSERT OR IGNORE and discovery
      // only runs for a work with no candidates yet — so the grid mixes both sizes until a work is
      // rediscovered. Accepted: it is a thumbnail grid, not the cover the detail view shows.
      // No presence check on `covers[0]`: `-1` is OpenLibrary's deleted-cover sentinel and truthy,
      // so the helper tests the id itself and answers null.
      cover_url: openLibraryCoverUrlById(e.covers?.[0]),
      publish_date: e.publish_date ?? null,
      publisher: e.publishers?.[0] ?? null,
    });
  }
  return out;
}

// Persists discovered candidates (skipping ISBNs already materialized for this work) and marks
// the work as searched. Shared by the user-triggered discover route and enrichment-time discovery.
export async function saveEditionCandidates(
  db: D1Database,
  workId: number,
  related: OpenLibraryEdition[],
): Promise<void> {
  if (related.length) {
    const { results: existingBooks } = await db
      .prepare("SELECT isbn FROM books WHERE work_id = ?")
      .bind(workId)
      .all<{ isbn: string }>();
    // Both forms of every materialized ISBN: an edition stored as ISBN-13 and discovered by
    // OpenLibrary as ISBN-10 is one edition, and storing the counterpart as a "candidate" makes
    // the carousel show it twice.
    const known = new Set(existingBooks.flatMap((b) => isbnForms(b.isbn)));
    const newEditions = related.filter((e) => !known.has(e.isbn));

    if (newEditions.length) {
      await db.batch(
        newEditions.map((e) =>
          db
            .prepare(
              "INSERT OR IGNORE INTO work_edition_isbns (work_id, isbn, title, language, cover_url, publish_date, publisher, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(
              workId,
              e.isbn,
              e.title,
              e.language,
              e.cover_url,
              e.publish_date,
              e.publisher,
              "openlibrary",
            ),
        ),
      );
    }
  }
  await db
    .prepare(
      "UPDATE works SET editions_checked_at = datetime('now') WHERE id = ?",
    )
    .bind(workId)
    .run();
}

// Enrichment-time edition discovery via the Wikidata-linked OL work id. Only runs while the work
// has no candidate editions yet — this deliberately includes works already marked searched whose
// seed-ISBN discovery came up empty (ISBN unknown to OpenLibrary), since the work id is a better key.
export async function discoverEditionsFromOpenLibrary(
  db: D1Database,
  workId: number,
  olWorkId: string,
  usage?: UsageRecorder | null,
): Promise<void> {
  const existing = await db
    .prepare("SELECT 1 FROM work_edition_isbns WHERE work_id = ? LIMIT 1")
    .bind(workId)
    .first();
  if (existing) return;

  const related = await fetchOpenLibraryEditionsByWorkId(olWorkId, usage);
  if (related === null) return; // transient OL failure — leave retryable, don't mark searched
  // An empty result must not stamp `editions_checked_at` either. That stamp is the one-shot gate on
  // the *user-triggered* discover route, whose seed-ISBN path is a different key that may well
  // succeed where the work id found nothing — spending the user's only attempt on this one's miss
  // left "Find other editions" permanently returning an empty list with no way to retry.
  if (!related.length) return;
  await saveEditionCandidates(db, workId, related);
}

// Returns the books row for `isbn` linked to `workId`, fetching and inserting it if missing.
// Sets work_id directly (bypasses linkWork) so cross-language editions of the same work
// (e.g. translations discovered via fetchOpenLibraryEditions) don't mint a competing match-key work.
// `usage` is **required**, like `resolveEdition`'s and `enrichWork`'s — pass `null` only where
// there is deliberately nothing to count (unit tests). It was optional, and the edition-switch
// route duly forgot it, so every Google Books call that materializing a candidate makes went
// unrecorded. That undercount is not just cosmetic: `googleBooksCallsToday` reads the same
// counters to gate the sweeper's daily budget, so it let the cron keep spending against a quota
// user traffic had already eaten into. A compile error is the cheaper guard.
export async function materializeEdition(
  db: D1Database,
  isbn: string,
  workId: number,
  apiKey: string | undefined,
  usage: UsageRecorder | null,
): Promise<BookRow | null> {
  // Matched on both ISBN forms, not the exact string. `resolveEdition` and `POST /api/scans`
  // already dedupe this way; this site didn't, so switching to an ISBN-10 candidate of an edition
  // whose `books` row exists under the ISBN-13 form minted a second row for one physical book —
  // with its own scan, overrides and enrichment.
  const forms = isbnForms(isbn);
  let book = await db
    .prepare(
      `SELECT * FROM books WHERE isbn IN (${forms.map(() => "?").join(", ")})
       ORDER BY (isbn = ?) DESC LIMIT 1`,
    )
    .bind(...forms, isbn)
    .first<BookRow>();
  if (book) {
    if (!book.work_id) {
      await db
        .prepare("UPDATE books SET work_id = ? WHERE id = ?")
        .bind(workId, book.id)
        .run();
      book.work_id = workId;
    }
    return book;
  }

  // Unchanged behaviour: both `missing` and `unavailable` leave no row, so a later run retries.
  const fetched = await fetchBookMetadata(isbn, apiKey, usage);
  if (fetched.kind !== "found") return null;
  const meta = fetched.meta;

  book = await db
    .prepare(
      `INSERT OR IGNORE INTO books
      (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher,
       physical_format, edition_name, physical_dimensions, categories, work_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    )
    .bind(
      isbn,
      meta.title,
      meta.author,
      meta.cover_url,
      meta.language,
      meta.publish_date,
      meta.number_of_pages_median,
      meta.description,
      meta.publisher,
      meta.physical_format,
      meta.edition_name,
      meta.physical_dimensions,
      meta.categories,
      workId,
    )
    .first<BookRow>();

  if (!book)
    book = await db
      .prepare("SELECT * FROM books WHERE isbn = ?")
      .bind(isbn)
      .first<BookRow>();
  return book;
}

export function normalizeStr(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "") // strip combining diacritics
    .replace(/\s+/g, " ")
    .trim();
}

// Identity key for a single author name. Deliberately more aggressive than normalizeStr: it drops
// a trailing parenthetical qualifier, periods, and all whitespace, so "J. R. R. Tolkien",
// "J.R.R. Tolkien" and "J.R.R.Tolkien" collapse to one key. Keys are never displayed —
// authors.name holds the display form — so only cross-source stability matters, not readability.
//
// This only unifies names that differ in *formatting*. Names that differ in *content*
// ("Mary Shelley" vs "Mary Wollstonecraft Shelley", "村上春樹" vs "Haruki Murakami") still produce
// separate keys; those converge later via wikidata_qid in mergeWorks.
//
// Only truncates at '(' when there's name text before it (paren > 0) — a name that's *entirely*
// a parenthetical fragment (a garbage row from the pre-fix splitAuthors, e.g. "(various)") would
// otherwise truncate to "", colliding every such fragment onto one identity. Keeping the parens in
// that case still lets "(various)" and "(anonymous)" key apart.
//
// Kept in exact sync with the SQL in migration 0040, which backfills the stored keys — truncating
// at '(' rather than excising the span is what makes the two agree. A third copy lives in
// scripts/repair-merged-works.mjs (a .mjs can't import this TS), which computes match_keys that
// linkWork must later recompute identically.
export function normalizeAuthorKey(s: string | null | undefined): string {
  const normalized = normalizeStr(s);
  const paren = normalized.indexOf("(");
  return (paren > 0 ? normalized.slice(0, paren) : normalized).replace(
    /[.\s]/g,
    "",
  );
}

// Google Books joins multiple authors with ', '; OpenLibrary stores a single name.
export function splitAuthors(author: string | null): string[] {
  // Parenthetical qualifiers are excised before splitting because they contain commas of their
  // own — "Tolkien, John Ronald Reuel (Mythenforscher, Grossbritannien)" otherwise splits into
  // fragments and lands a literal "Grossbritannien)" row in the authors table. Tracked by paren
  // depth (not a regex) so a nested qualifier — "A (pseudonym of B (1900-1950)) C" — doesn't leave
  // a stray unmatched ")" behind: a regex matching "\(...\)" non-recursively closes on the first
  // ')' it meets, which is the *inner* one, and drops the outer ')' into the output untouched.
  let stripped = "";
  let depth = 0;
  for (const ch of author ?? "") {
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) stripped += ch;
  }
  return stripped
    .replace(/\s+/g, " ")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

// Resolve (or create) the work this edition belongs to, plus its normalized authors.
// Same-language editions sharing title+author collapse to one work synchronously;
// cross-language editions merge later via wikidata_qid (see enrichWork).
/**
 * The identity key two editions must share to count as one work before Wikidata can say so.
 *
 * Title *and* author, because a title on its own is not work identity: German series volumes are
 * frequently catalogued under the series name rather than the volume's — six editions all titled
 * "Star wars - Wächter der Macht", with no author on the row either — and keying on the title alone
 * collapsed six different books into one work, which means one reading status, one rating and one
 * card for all of them. An edition missing either half stands alone (keyed by its own ISBN) until
 * enrichment can identify it by QID and `mergeWorks` groups it deliberately.
 *
 * The `isbn:` fallback keeps the `|<authorKey>` suffix a titleless edition already had, so existing
 * rows keep resolving to the work they are linked to.
 */
export function workMatchKey(
  title: string | null,
  author: string | null,
  isbn: string,
): string {
  const titlePart = normalizeStr(title);
  const authorKey = normalizeAuthorKey(splitAuthors(author)[0] ?? "");
  return `${titlePart && authorKey ? titlePart : `isbn:${isbn}`}|${authorKey}`;
}

export async function linkWork(db: D1Database, book: BookRow): Promise<void> {
  const authors = splitAuthors(book.author);
  const matchKey = workMatchKey(book.title, book.author, book.isbn);

  await db
    .prepare(
      "INSERT OR IGNORE INTO works (match_key, canonical_title, original_language) VALUES (?, ?, ?)",
    )
    .bind(matchKey, book.title, book.language)
    .run();
  const work = await db
    .prepare("SELECT id FROM works WHERE match_key = ?")
    .bind(matchKey)
    .first<{ id: number }>();
  if (!work) return;

  const stmts = [
    db
      .prepare("UPDATE books SET work_id = ? WHERE id = ?")
      .bind(work.id, book.id),
  ];
  for (const name of authors) {
    stmts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO authors (normalized_name, name) VALUES (?, ?)",
        )
        .bind(normalizeAuthorKey(name), name),
    );
  }
  // One batch, not two. The `work_authors` inserts resolve their author ids with a subquery rather
  // than a read-back value, and a D1 batch runs sequentially in one implicit transaction, so they
  // still see the `authors` upserts that precede them. Split across two batches, a failure of the
  // second left the book linked and the work permanently author-less: every caller gates linkWork
  // on `!book.work_id`, so nothing ever re-links it, and AUTHORS_JSON_SUBQUERY returns [] for
  // every scan of that book from then on.
  for (const [idx, name] of authors.entries()) {
    stmts.push(
      db
        .prepare(
          "INSERT OR IGNORE INTO work_authors (work_id, author_id, ordinal) SELECT ?, id, ? FROM authors WHERE normalized_name = ?",
        )
        .bind(work.id, idx, normalizeAuthorKey(name)),
    );
  }
  await db.batch(stmts);
  book.work_id = work.id;
}

// Caller-supplied metadata to seed a placeholder `books` row when Google Books/OpenLibrary both
// miss — e.g. the title/author/publisher a Goodreads CSV row already carries. Only ever used to
// fill an otherwise-entirely-NULL row (see resolveEdition below); never overrides a real fetch.
export type FallbackMetadata = {
  title: string | null;
  author: string | null;
  publisher: string | null;
  publish_date: string | null;
  number_of_pages_median: number | null;
};

export type ResolveEditionOptions = {
  /** Insert a placeholder row instead of returning null when neither source knows the ISBN. */
  allowEmpty?: boolean;
  skipLinkWork?: boolean;
  /** What the caller already knows, to seed that placeholder — see `FallbackMetadata`. */
  fallbackMeta?: FallbackMetadata | null;
  /**
   * Required, not optional: an omitted recorder counts nothing and fails silently, and Google
   * Books calls made here are the daily quota the board exists to watch. Callers with nothing to
   * flush into pass `null` deliberately.
   */
  usage: UsageRecorder | null;
};

/**
 * Second chance for a `books` row that carries no identity at all.
 *
 * Such a row is only ever created by `resolveEdition`'s `allowEmpty` path when the fetch produced
 * nothing — which, before the outcomes were distinguished, included "both sources were
 * unreachable". Because `books` is keyed by ISBN and shared by every user, that blank row was then
 * served to everyone forever without anyone contacting a source again; only a hand-triggered
 * refresh could fix it. Retrying costs a lookup on a row that has nothing to lose, and a genuine
 * miss is bounded by user action (a rescan answers 409 before reaching this).
 *
 * Throws `UpstreamLookupError` when the retry finds the sources down and the caller can't accept a
 * blank row — the same rule the no-row path follows, and for the same reason: answering 200 with
 * the placeholder makes the scanner (which reads `lookup_unavailable` off the 503 alone) say "no
 * match" during an outage.
 *
 * Returns the row to use — the refreshed one on success, the caller's otherwise.
 */
async function repairEmptyBook(
  db: D1Database,
  book: BookRow,
  isbn: string,
  allowEmpty: boolean,
  apiKey: string | undefined,
  usage: UsageRecorder | null,
): Promise<BookRow> {
  const repaired = await fetchBookMetadata(isbn, apiKey, usage);
  if (repaired.kind === "unavailable" && !allowEmpty)
    throw new UpstreamLookupError(isbn);
  if (repaired.kind !== "found") return book;

  await db.batch([
    fillMetadataStatement(db, book.id, repaired.meta),
    // The work this book was linked to at insert time was named from a NULL title, so it carries
    // no `canonical_title` and enrichment retired it as 'no-title' (status `done`, which no
    // sweeper query serves again). Now that there is a title, give it one and make it due —
    // otherwise the card fills in but never gains genres, series or a cover credit. Scoped to
    // works that never had a title, so a real one is never reset.
    db
      .prepare(
        `UPDATE works SET canonical_title = ?, enrichment_status = 'pending', next_retry_at = NULL
               WHERE id = ? AND canonical_title IS NULL`,
      )
      .bind(repaired.meta.title, book.work_id),
  ]);
  return (
    (await db
      .prepare("SELECT * FROM books WHERE id = ?")
      .bind(book.id)
      .first<BookRow>()) ?? book
  );
}

// Returns the books row, creating it (and its work/author links) if missing.
// Centralizes the fetch-metadata → INSERT → re-SELECT flow shared by lookup/guest-lookup/scans.
// The tail is an options object rather than positional flags: callers set one or two of them, and
// padding out `false, false, null` to reach the last was unreadable at every call site.
export async function resolveEdition(
  db: D1Database,
  isbn: string,
  apiKey: string | undefined,
  {
    allowEmpty = false,
    skipLinkWork = false,
    fallbackMeta = null,
    usage,
  }: ResolveEditionOptions,
): Promise<BookRow | null> {
  // Check both ISBN forms — the same edition can already be stored under its ISBN-10 or ISBN-13
  // form depending on which one was scanned/looked-up first. Without this, a lookup under the
  // other form would fall through to fetch+insert and mint a second `books` row for one edition.
  // `ORDER BY (isbn = ?) DESC LIMIT 1` prefers the exact form the caller asked for, as
  // `materializeEdition` does. Where both forms legitimately have a row — an older all-NULL
  // placeholder under one, a populated row under the other — a bare OR + `.first()` returned
  // whichever SQLite yielded first, so a scan could attach to the empty placeholder while the
  // populated row sat unused, and `POST /api/books/refresh` (which selects on the exact ISBN)
  // then repaired a row the card never reads.
  const altIsbn = alternateIsbnForm(isbn);
  let book = await db
    .prepare(
      `SELECT * FROM books WHERE isbn = ? ${altIsbn ? "OR isbn = ?" : ""}
       ORDER BY (isbn = ?) DESC LIMIT 1`,
    )
    .bind(...(altIsbn ? [isbn, altIsbn] : [isbn]), isbn)
    .first<BookRow>();
  if (book) {
    if (isMetadataEmpty(book))
      book = await repairEmptyBook(db, book, isbn, allowEmpty, apiKey, usage);
    if (!book.work_id && !skipLinkWork) await linkWork(db, book);
    return book;
  }

  const fetched = await fetchBookMetadata(isbn, apiKey, usage);
  // An outage must not be recorded as "this ISBN doesn't exist". The read-only callers
  // (`/lookup`, `/guest-lookup`) turn this into a 503 instead of a 404; the `allowEmpty` callers
  // (a draining offline scan, an import row) still get their placeholder, because their guarantee
  // is that the scan always succeeds — and the repair above is what stops that placeholder from
  // being permanent.
  if (fetched.kind === "unavailable" && !allowEmpty)
    throw new UpstreamLookupError(isbn);
  if (fetched.kind !== "found" && !allowEmpty) return null;
  // Neither source had this ISBN — fall back to whatever the caller already knows (e.g. a
  // Goodreads CSV row's title/author) rather than inserting an all-NULL placeholder.
  const meta = fetched.kind === "found" ? fetched.meta : {
    title: fallbackMeta?.title ?? null,
    author: fallbackMeta?.author ?? null,
    cover_url: null,
    language: null,
    publish_date: fallbackMeta?.publish_date ?? null,
    number_of_pages_median: fallbackMeta?.number_of_pages_median ?? null,
    description: null,
    publisher: fallbackMeta?.publisher ?? null,
    physical_format: null,
    edition_name: null,
    physical_dimensions: null,
    categories: null,
  };

  book = await db
    .prepare(
      `INSERT OR IGNORE INTO books
      (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher,
       physical_format, edition_name, physical_dimensions, categories)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`,
    )
    .bind(
      isbn,
      meta.title,
      meta.author,
      meta.cover_url,
      meta.language,
      meta.publish_date,
      meta.number_of_pages_median,
      meta.description,
      meta.publisher,
      meta.physical_format,
      meta.edition_name,
      meta.physical_dimensions,
      meta.categories,
    )
    .first<BookRow>();

  if (!book)
    book = await db
      .prepare("SELECT * FROM books WHERE isbn = ?")
      .bind(isbn)
      .first<BookRow>();
  if (book && !book.work_id && !skipLinkWork) await linkWork(db, book);
  return book;
}
