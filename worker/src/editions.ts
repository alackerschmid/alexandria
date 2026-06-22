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
  }
}

async function fetchFromOpenLibrary(isbn: string): Promise<BookMetadata | null> {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  )
  const data: any = await res.json()
  const book = data[`ISBN:${isbn}`]
  if (!book) return null
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
  }
}

// Tries Google Books first, then OpenLibrary. Returns null if neither has the book.
export async function fetchBookMetadata(isbn: string, googleApiKey?: string): Promise<BookMetadata | null> {
  if (googleApiKey) {
    try {
      const result = await fetchFromGoogleBooks(isbn, googleApiKey)
      if (result) return result
    } catch {}
  }
  try {
    return await fetchFromOpenLibrary(isbn)
  } catch {}
  return null
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
export async function resolveEdition(db: D1Database, isbn: string, apiKey?: string, allowEmpty = false): Promise<BookRow | null> {
  let book = await db.prepare('SELECT * FROM books WHERE isbn = ?').bind(isbn).first<BookRow>()
  if (book) {
    if (!book.work_id) await linkWork(db, book)
    return book
  }

  const fetched = await fetchBookMetadata(isbn, apiKey)
  if (!fetched && !allowEmpty) return null
  const meta = fetched ?? {
    title: null, author: null, cover_url: null, language: null,
    publish_date: null, number_of_pages_median: null, description: null, publisher: null,
  }

  await db.prepare(`INSERT OR IGNORE INTO books
      (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(isbn, meta.title, meta.author, meta.cover_url, meta.language,
          meta.publish_date, meta.number_of_pages_median, meta.description, meta.publisher)
    .run()

  book = await db.prepare('SELECT * FROM books WHERE isbn = ?').bind(isbn).first<BookRow>()
  if (book && !book.work_id) await linkWork(db, book)
  return book
}
