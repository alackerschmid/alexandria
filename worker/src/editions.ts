import type { BookRow, BookMetadata } from "./types";

async function fetchWithTimeout(
  url: string,
  opts: RequestInit = {},
  timeoutMs = 4000,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchFromGoogleBooks(
  isbn: string,
  apiKey: string,
): Promise<BookMetadata | null> {
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${apiKey}`,
  );
  const data: any = await res.json();
  const info = data.items?.[0]?.volumeInfo;
  if (!info) return null;
  // Google's categories are often BISAC-style ("Fiction / Fantasy / General") — split on the
  // separator and dedupe so they're usable as flat genre tags when Wikidata has no P136 genres.
  const rawCategories: string[] = info.categories ?? [];
  const cleanedCategories = Array.from(
    new Set(
      rawCategories.flatMap((c) =>
        c.split(" / ").map((s) => s.trim()).filter(Boolean),
      ),
    ),
  );
  return {
    title: info.title ?? null,
    author: info.authors?.join(", ") ?? null,
    cover_url:
      info.imageLinks?.thumbnail?.replace("http://", "https://") ?? null,
    language: info.language ?? null,
    publish_date: info.publishedDate ?? null,
    number_of_pages_median: info.pageCount > 0 ? info.pageCount : null,
    description: info.description ?? null,
    publisher: info.publisher ?? null,
    physical_format: null,
    edition_name: null,
    physical_dimensions: null,
    categories: cleanedCategories.length ? JSON.stringify(cleanedCategories) : null,
  };
}

async function fetchFromOpenLibrary(
  isbn: string,
): Promise<BookMetadata | null> {
  const bibkey = `ISBN:${isbn}`;
  const base = `https://openlibrary.org/api/books?bibkeys=${bibkey}&format=json`;

  // Fetch data (existing fields) and details (physical_dimensions, edition_name) in parallel.
  // details fetch is best-effort; failures leave those fields null.
  const [dataJson, detailsJson] = await Promise.all([
    fetchWithTimeout(`${base}&jscmd=data`).then((r) => r.json() as Promise<any>),
    fetchWithTimeout(`${base}&jscmd=details`)
      .then((r) => r.json() as Promise<any>)
      .catch(() => ({})),
  ]);

  const book = dataJson[bibkey];
  if (!book) return null;
  const details: any = detailsJson[bibkey]?.details ?? null;

  const pdRaw = details?.physical_dimensions;
  return {
    title: book.title ?? null,
    author: book.authors?.[0]?.name ?? null,
    cover_url: book.cover?.large ?? book.cover?.medium ?? null,
    language: null,
    publish_date: book.publish_date ?? null,
    number_of_pages_median: book.number_of_pages > 0 ? book.number_of_pages : null,
    description:
      typeof book.description === "string"
        ? book.description
        : (book.description?.value ?? null),
    publisher: book.publishers?.[0]?.name ?? null,
    physical_format: book.physical_format ?? null,
    edition_name: details?.edition_name ?? null,
    physical_dimensions:
      typeof pdRaw === "string" ? pdRaw : (pdRaw?.value ?? null),
    categories: null, // OpenLibrary's API doesn't expose BISAC-style categories
  };
}

// Fill any null field in `primary` from `fallback` (primary's non-null values always win).
function mergeMetadata(
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

// Tries Google Books, then fills gaps from OpenLibrary. Google often omits page counts and never
// returns physical_format/edition_name/physical_dimensions, so we consult OpenLibrary even when
// Google has the book. Returns null if neither source has it.
export async function fetchBookMetadata(
  isbn: string,
  googleApiKey?: string,
): Promise<BookMetadata | null> {
  const [google, openlib] = await Promise.all([
    googleApiKey
      ? fetchFromGoogleBooks(isbn, googleApiKey).catch(() => null)
      : Promise.resolve(null),
    fetchFromOpenLibrary(isbn).catch(() => null),
  ]);

  if (!google) return openlib;
  if (!openlib) return google;
  return mergeMetadata(google, openlib);
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

export async function searchBooksByTitle(
  title: string,
  author: string | undefined,
  apiKey: string,
  limit = 20,
  publisher?: string,
): Promise<EditionCandidate[]> {
  try {
    let q = `intitle:"${encodeURIComponent(title)}"`;
    if (author) q += `+inauthor:"${encodeURIComponent(author)}"`;
    if (publisher) q += `+inpublisher:"${encodeURIComponent(publisher)}"`;
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20&key=${apiKey}`,
    );
    const data: any = await res.json();
    if (!Array.isArray(data.items)) return [];

    const seen = new Set<string>();
    const results: EditionCandidate[] = [];

    for (const item of data.items) {
      if (results.length >= limit) break;
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
        cover_url:
          info.imageLinks?.thumbnail?.replace("http://", "https://") ?? null,
        publish_date: info.publishedDate ?? null,
        publisher: info.publisher ?? null,
      });
    }

    return results;
  } catch {
    return [];
  }
}

// ── Related editions (OpenLibrary works/editions) ────────────────────────────────

// MARC/ISO-639-2(B) → ISO-639-1, for the languages this app is likely to see. OpenLibrary's
// editions.json reports languages in this 3-letter form; falls back to the raw code (still
// usable, just less polished in Intl.DisplayNames) for anything not in this table.
const ISO_639_2_TO_1: Record<string, string> = {
  eng: "en", ger: "de", deu: "de", fre: "fr", fra: "fr", spa: "es", ita: "it",
  por: "pt", dut: "nl", nld: "nl", rus: "ru", pol: "pl", swe: "sv", nor: "no",
  dan: "da", fin: "fi", gre: "el", ell: "el", tur: "tr", ara: "ar", heb: "he",
  jpn: "ja", chi: "zh", zho: "zh", kor: "ko", hin: "hi", cze: "cs", ces: "cs",
  hun: "hu", rum: "ro", ron: "ro", ukr: "uk", hrv: "hr", srp: "sr", slo: "sk",
  slk: "sk", slv: "sl", bul: "bg", lit: "lt", lav: "lv", est: "et", gle: "ga",
  cat: "ca", baq: "eu", eus: "eu", glg: "gl", ice: "is", isl: "is", alb: "sq",
  sqi: "sq", mac: "mk", mkd: "mk", vie: "vi", tha: "th", ind: "id", may: "ms", msa: "ms",
}

function mapLanguageCode(olKey: string | undefined): string | null {
  if (!olKey) return null
  const code = olKey.replace("/languages/", "")
  return ISO_639_2_TO_1[code] ?? code
}

export type OpenLibraryEdition = {
  isbn: string
  title: string | null
  language: string | null
  cover_url: string | null
  publish_date: string | null
  publisher: string | null
}

// Given an ISBN, resolves its OpenLibrary work and returns every edition OpenLibrary knows for
// that work (other printings, translations) — replaces LibraryThing's thingISBN, which sits
// behind Cloudflare and blocks Workers-origin traffic via Bot Fight Mode (confirmed: the "403"
// was Cloudflare's own challenge page, not an app-level rejection — unfixable from server fetch()).
// Returns null on failure (network/timeout/non-2xx) — distinct from a successful call that found
// no further editions — so the caller doesn't permanently cache a transient error as "none found".
export async function fetchOpenLibraryEditions(isbn: string): Promise<OpenLibraryEdition[] | null> {
  try {
    const editionRes = await fetchWithTimeout(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`)
    if (editionRes.status === 404) return [] // ISBN unknown to OpenLibrary — nothing to expand from, not an error
    if (!editionRes.ok) {
      console.error(`[OL editions] HTTP ${editionRes.status} resolving isbn ${isbn}`)
      return null
    }
    const edition: any = await editionRes.json()
    const workKey: string | undefined = edition.works?.[0]?.key
    if (!workKey) return []

    return await fetchEditionsForWorkKey(workKey)
  } catch (e) {
    console.error(`[OL editions] failed for isbn ${isbn}:`, e)
    return null
  }
}

// Same contract, keyed by an OpenLibrary work id (e.g. "OL2943602W" from Wikidata P648) instead
// of a seed ISBN — works even when none of the owned editions' ISBNs exist in OpenLibrary.
export async function fetchOpenLibraryEditionsByWorkId(olWorkId: string): Promise<OpenLibraryEdition[] | null> {
  if (!/^OL\d+W$/.test(olWorkId)) {
    console.warn(`[OL editions] invalid work id: ${olWorkId}`)
    return []
  }
  try {
    return await fetchEditionsForWorkKey(`/works/${olWorkId}`)
  } catch (e) {
    console.error(`[OL editions] failed for work ${olWorkId}:`, e)
    return null
  }
}

async function fetchEditionsForWorkKey(workKey: string): Promise<OpenLibraryEdition[] | null> {
  const editionsRes = await fetchWithTimeout(`https://openlibrary.org${workKey}/editions.json?limit=200`)
  if (editionsRes.status === 404) return []
  if (!editionsRes.ok) {
    console.error(`[OL editions] HTTP ${editionsRes.status} fetching ${workKey}/editions.json`)
    return null
  }
  const data: any = await editionsRes.json()
  const entries: any[] = data.entries ?? []

  const out: OpenLibraryEdition[] = []
  const seen = new Set<string>()
  for (const e of entries) {
    const entryIsbn = ((e.isbn_13?.[0] ?? e.isbn_10?.[0]) as string | undefined)?.replace(/[-\s]/g, "")
    if (!entryIsbn || seen.has(entryIsbn)) continue
    seen.add(entryIsbn)
    out.push({
      isbn: entryIsbn,
      title: e.title ?? null,
      language: mapLanguageCode(e.languages?.[0]?.key),
      cover_url: e.covers?.[0] ? `https://covers.openlibrary.org/b/id/${e.covers[0]}-M.jpg` : null,
      publish_date: e.publish_date ?? null,
      publisher: e.publishers?.[0] ?? null,
    })
  }
  return out
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
      .all<{ isbn: string }>()
    const known = new Set(existingBooks.map((b) => b.isbn))
    const newEditions = related.filter((e) => !known.has(e.isbn))

    if (newEditions.length) {
      await db.batch(newEditions.map((e) =>
        db.prepare(
          "INSERT OR IGNORE INTO work_edition_isbns (work_id, isbn, title, language, cover_url, publish_date, publisher, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(workId, e.isbn, e.title, e.language, e.cover_url, e.publish_date, e.publisher, "openlibrary")))
    }
  }
  await db.prepare("UPDATE works SET editions_checked_at = datetime('now') WHERE id = ?").bind(workId).run()
}

// Enrichment-time edition discovery via the Wikidata-linked OL work id. Only runs while the work
// has no candidate editions yet — this deliberately includes works already marked searched whose
// seed-ISBN discovery came up empty (ISBN unknown to OpenLibrary), since the work id is a better key.
export async function discoverEditionsFromOpenLibrary(
  db: D1Database,
  workId: number,
  olWorkId: string,
): Promise<void> {
  const existing = await db
    .prepare("SELECT 1 FROM work_edition_isbns WHERE work_id = ? LIMIT 1")
    .bind(workId)
    .first()
  if (existing) return

  const related = await fetchOpenLibraryEditionsByWorkId(olWorkId)
  if (related === null) return // transient OL failure — leave retryable, don't mark searched
  await saveEditionCandidates(db, workId, related)
}

// Returns the books row for `isbn` linked to `workId`, fetching and inserting it if missing.
// Sets work_id directly (bypasses linkWork) so cross-language editions of the same work
// (e.g. translations discovered via fetchOpenLibraryEditions) don't mint a competing match-key work.
export async function materializeEdition(
  db: D1Database,
  isbn: string,
  workId: number,
  apiKey?: string,
): Promise<BookRow | null> {
  let book = await db
    .prepare("SELECT * FROM books WHERE isbn = ?")
    .bind(isbn)
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

  const meta = await fetchBookMetadata(isbn, apiKey);
  if (!meta) return null;

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

// Google Books joins multiple authors with ', '; OpenLibrary stores a single name.
export function splitAuthors(author: string | null): string[] {
  return (author ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

// Resolve (or create) the work this edition belongs to, plus its normalized authors.
// Same-language editions sharing title+author collapse to one work synchronously;
// cross-language editions merge later via wikidata_qid (see enrichWork).
export async function linkWork(db: D1Database, book: BookRow): Promise<void> {
  const authors = splitAuthors(book.author);
  const titlePart = normalizeStr(book.title) || `isbn:${book.isbn}`;
  const matchKey = `${titlePart}|${normalizeStr(authors[0])}`;

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
        .bind(normalizeStr(name), name),
    );
  }
  await db.batch(stmts);

  if (authors.length) {
    const links = authors.map((name) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO work_authors (work_id, author_id) SELECT ?, id FROM authors WHERE normalized_name = ?",
        )
        .bind(work.id, normalizeStr(name)),
    );
    await db.batch(links);
  }
  book.work_id = work.id;
}

// Returns the books row, creating it (and its work/author links) if missing.
// Centralizes the fetch-metadata → INSERT → re-SELECT flow shared by lookup/guest-lookup/scans.
// When metadata isn't found: returns null unless allowEmpty (POST /api/scans needs a row to
// exist so an offline-queued scan never fails just because the book couldn't be resolved).
export async function resolveEdition(
  db: D1Database,
  isbn: string,
  apiKey?: string,
  allowEmpty = false,
  skipLinkWork = false,
): Promise<BookRow | null> {
  let book = await db
    .prepare("SELECT * FROM books WHERE isbn = ?")
    .bind(isbn)
    .first<BookRow>();
  if (book) {
    if (!book.work_id && !skipLinkWork) await linkWork(db, book);
    return book;
  }

  const fetched = await fetchBookMetadata(isbn, apiKey);
  if (!fetched && !allowEmpty) return null;
  const meta = fetched ?? {
    title: null,
    author: null,
    cover_url: null,
    language: null,
    publish_date: null,
    number_of_pages_median: null,
    description: null,
    publisher: null,
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
