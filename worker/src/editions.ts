import type { BookRow, BookMetadata } from './types'

async function fetchFromGoogleBooks(isbn: string, apiKey: string): Promise<BookMetadata | null> {
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${apiKey}`
  )
  const data: any = await res.json()
  const info = data.items?.[0]?.volumeInfo
  if (!info) return null
  return {
    title: info.title ?? null,
    author: info.authors?.join(', ') ?? null,
    cover_url: info.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
    language: info.language ?? null,
    publish_date: info.publishedDate ?? null,
    number_of_pages_median: info.pageCount ?? null,
    description: info.description ?? null,
    publisher: info.publisher ?? null,
    physical_format: null,
    edition_name: null,
    physical_dimensions: null,
  }
}

async function fetchFromOpenLibrary(isbn: string): Promise<BookMetadata | null> {
  const bibkey = `ISBN:${isbn}`
  const base = `https://openlibrary.org/api/books?bibkeys=${bibkey}&format=json`

  // Fetch data (existing fields) and details (physical_dimensions, edition_name) in parallel.
  // details fetch is best-effort; failures leave those fields null.
  const [dataJson, detailsJson] = await Promise.all([
    fetch(`${base}&jscmd=data`).then(r => r.json() as Promise<any>),
    fetch(`${base}&jscmd=details`).then(r => r.json() as Promise<any>).catch(() => ({})),
  ])

  const book = dataJson[bibkey]
  if (!book) return null
  const details: any = detailsJson[bibkey]?.details ?? null

  const pdRaw = details?.physical_dimensions
  return {
    title: book.title ?? null,
    author: book.authors?.[0]?.name ?? null,
    cover_url: book.cover?.large ?? book.cover?.medium ?? null,
    language: null,
    publish_date: book.publish_date ?? null,
    number_of_pages_median: book.number_of_pages ?? null,
    description: typeof book.description === 'string'
      ? book.description
      : book.description?.value ?? null,
    publisher: book.publishers?.[0]?.name ?? null,
    physical_format: book.physical_format ?? null,
    edition_name: details?.edition_name ?? null,
    physical_dimensions: typeof pdRaw === 'string' ? pdRaw : pdRaw?.value ?? null,
  }
}

// Fill any null field in `primary` from `fallback` (primary's non-null values always win).
function mergeMetadata(primary: BookMetadata, fallback: BookMetadata): BookMetadata {
  const out = { ...primary }
  for (const key of Object.keys(out) as (keyof BookMetadata)[]) {
    if (out[key] == null) (out[key] as BookMetadata[typeof key]) = fallback[key]
  }
  return out
}

// Tries Google Books, then fills gaps from OpenLibrary. Google often omits page counts and never
// returns physical_format/edition_name/physical_dimensions, so we consult OpenLibrary even when
// Google has the book. Returns null if neither source has it.
export async function fetchBookMetadata(isbn: string, googleApiKey?: string): Promise<BookMetadata | null> {
  const [google, openlib] = await Promise.all([
    googleApiKey ? fetchFromGoogleBooks(isbn, googleApiKey).catch(() => null) : Promise.resolve(null),
    fetchFromOpenLibrary(isbn).catch(() => null),
  ])

  if (!google) return openlib
  if (!openlib) return google
  return mergeMetadata(google, openlib)
}

// ── Title search ──────────────────────────────────────────────────────────────

export type EditionCandidate = {
  isbn: string
  title: string | null
  author: string | null
  cover_url: string | null
  publish_date: string | null
  publisher: string | null
}

export async function searchBooksByTitle(
  title: string,
  author: string | undefined,
  apiKey: string,
  limit = 20,
  publisher?: string,
): Promise<EditionCandidate[]> {
  try {
    let q = `intitle:"${encodeURIComponent(title)}"`
    if (author) q += `+inauthor:"${encodeURIComponent(author)}"`
    if (publisher) q += `+inpublisher:"${encodeURIComponent(publisher)}"`
    const res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20&key=${apiKey}`
    )
    const data: any = await res.json()
    if (!Array.isArray(data.items)) return []

    const seen = new Set<string>()
    const results: EditionCandidate[] = []

    for (const item of data.items) {
      if (results.length >= limit) break
      const info = item.volumeInfo
      if (!info) continue

      const identifiers: Array<{ type: string; identifier: string }> = info.industryIdentifiers ?? []
      const isbn13 = identifiers.find(i => i.type === 'ISBN_13')?.identifier
      const isbn10 = identifiers.find(i => i.type === 'ISBN_10')?.identifier
      const isbn = isbn13 ?? isbn10
      if (!isbn || seen.has(isbn)) continue
      seen.add(isbn)

      results.push({
        isbn,
        title: info.title ?? null,
        author: info.authors?.join(', ') ?? null,
        cover_url: info.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
        publish_date: info.publishedDate ?? null,
        publisher: info.publisher ?? null,
      })
    }

    return results
  } catch {
    return []
  }
}

export function normalizeStr(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '') // strip combining diacritics
    .replace(/\s+/g, ' ')
    .trim()
}

// Google Books joins multiple authors with ', '; OpenLibrary stores a single name.
export function splitAuthors(author: string | null): string[] {
  return (author ?? '').split(',').map(a => a.trim()).filter(Boolean)
}

// Resolve (or create) the work this edition belongs to, plus its normalized authors.
// Same-language editions sharing title+author collapse to one work synchronously;
// cross-language editions merge later via wikidata_qid (see enrichWork).
export async function linkWork(db: D1Database, book: BookRow): Promise<void> {
  const authors = splitAuthors(book.author)
  const titlePart = normalizeStr(book.title) || `isbn:${book.isbn}`
  const matchKey = `${titlePart}|${normalizeStr(authors[0])}`

  await db.prepare('INSERT OR IGNORE INTO works (match_key, canonical_title, original_language) VALUES (?, ?, ?)')
    .bind(matchKey, book.title, book.language)
    .run()
  const work = await db.prepare('SELECT id FROM works WHERE match_key = ?').bind(matchKey).first<{ id: number }>()
  if (!work) return

  const stmts = [db.prepare('UPDATE books SET work_id = ? WHERE id = ?').bind(work.id, book.id)]
  for (const name of authors) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO authors (normalized_name, name) VALUES (?, ?)').bind(normalizeStr(name), name))
  }
  await db.batch(stmts)

  if (authors.length) {
    const links = authors.map(name =>
      db.prepare('INSERT OR IGNORE INTO work_authors (work_id, author_id) SELECT ?, id FROM authors WHERE normalized_name = ?')
        .bind(work.id, normalizeStr(name)))
    await db.batch(links)
  }
  book.work_id = work.id
}

// Returns the books row, creating it (and its work/author links) if missing.
// Centralizes the fetch-metadata → INSERT → re-SELECT flow shared by lookup/guest-lookup/scans.
// When metadata isn't found: returns null unless allowEmpty (POST /api/scans needs a row to
// exist so an offline-queued scan never fails just because the book couldn't be resolved).
export async function resolveEdition(db: D1Database, isbn: string, apiKey?: string, allowEmpty = false, skipLinkWork = false): Promise<BookRow | null> {
  let book = await db.prepare('SELECT * FROM books WHERE isbn = ?').bind(isbn).first<BookRow>()
  if (book) {
    if (!book.work_id && !skipLinkWork) await linkWork(db, book)
    return book
  }

  const fetched = await fetchBookMetadata(isbn, apiKey)
  if (!fetched && !allowEmpty) return null
  const meta = fetched ?? {
    title: null, author: null, cover_url: null, language: null,
    publish_date: null, number_of_pages_median: null, description: null, publisher: null,
    physical_format: null, edition_name: null, physical_dimensions: null,
  }

  book = await db.prepare(`INSERT OR IGNORE INTO books
      (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher,
       physical_format, edition_name, physical_dimensions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *`)
    .bind(isbn, meta.title, meta.author, meta.cover_url, meta.language,
          meta.publish_date, meta.number_of_pages_median, meta.description, meta.publisher,
          meta.physical_format, meta.edition_name, meta.physical_dimensions)
    .first<BookRow>()

  if (!book) book = await db.prepare('SELECT * FROM books WHERE isbn = ?').bind(isbn).first<BookRow>()
  if (book && !book.work_id && !skipLinkWork) await linkWork(db, book)
  return book
}
