import { Hono } from 'hono'
import type { Env, BookRow } from '../types'
import { authMiddleware } from '../auth'
import { resolveEdition, fetchBookMetadata, linkWork, searchBooksByTitle } from '../editions'
import { enrichWork } from '../enrichment'
import { getBookByIsbn, OVERRIDE_FIELDS, type OverrideField } from '../library-query'

const books = new Hono<Env>()

// ── Public routes (no auth) ───────────────────────────────────────────────────

// Public guest lookup — no auth. Enrichment is intentionally NOT triggered here to avoid
// anonymous traffic driving Wikidata load; the work gets enriched when an authenticated
// user looks it up or scans it.
books.get('/guest-lookup', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY, false, true)
  if (!book) return c.json({ notFound: true }, 404)
  return c.json(book)
})

// Public guest title search — no auth. Mirrors /search for unauthenticated users.
books.get('/guest-search', async (c) => {
  const title = c.req.query('title')?.trim()
  const author = c.req.query('author')?.trim() || undefined
  if (!title) return c.json({ error: 'Title required' }, 400)
  return c.json(await searchBooksByTitle(title, author, c.env.GOOGLE_BOOKS_API_KEY))
})

// Public sample of random catalogued books — powers the marketing preview. No auth.
// Cached in the Workers edge cache (keyed by limit) so anonymous/bot traffic doesn't
// re-run the ORDER BY RANDOM() full scan on every hit. A 10-min-stale random sample is
// fine for a marketing preview.
books.get('/sample', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '3'), 12)
  const db = c.env.DB

  const cache = caches.default
  const cacheKey = new Request(`https://bookscan-cache/sample?limit=${limit}`)
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const { results } = await db
    .prepare(
      'SELECT title, author, cover_url FROM books WHERE title IS NOT NULL AND cover_url IS NOT NULL ORDER BY RANDOM() LIMIT ?'
    )
    .bind(limit)
    .all<{ title: string, author: string | null, cover_url: string | null }>()

  const total = await db
    .prepare('SELECT COUNT(*) AS n FROM books WHERE title IS NOT NULL')
    .first<{ n: number }>()

  const res = c.json({ books: results, total: total?.n ?? results.length })
  res.headers.set('Cache-Control', 'public, max-age=600')
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()))
  return res
})

// ── Protected routes ──────────────────────────────────────────────────────────

books.use('*', authMiddleware)

// Title search — returns candidate editions from Google Books. No DB writes; the
// books row is created only when the user selects an edition and it flows through lookup/scan.
books.get('/search', async (c) => {
  const title = c.req.query('title')?.trim()
  const author = c.req.query('author')?.trim() || undefined
  if (!title) return c.json({ error: 'Title required' }, 400)
  return c.json(await searchBooksByTitle(title, author, c.env.GOOGLE_BOOKS_API_KEY))
})

// Book metadata lookup — checks DB cache first, then Google Books, then OpenLibrary.
books.get('/lookup', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!book) return c.json({ error: 'Book not found' }, 404)
  if (book.work_id) c.executionCtx.waitUntil(enrichWork(c.env.DB, book.work_id, false, c.env.GOOGLE_BOOKS_API_KEY))
  return c.json(book)
})

// Refresh book metadata — tries Google Books then OpenLibrary, fills NULL fields only.
books.post('/refresh', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!bookData) return c.json({ error: 'Book not found in any source' }, 404)

  await c.env.DB
    .prepare(`
      UPDATE books SET
        title = COALESCE(title, ?),
        author = COALESCE(author, ?),
        cover_url = COALESCE(cover_url, ?),
        language = COALESCE(language, ?),
        publish_date = COALESCE(publish_date, ?),
        number_of_pages_median = COALESCE(number_of_pages_median, ?),
        description = COALESCE(description, ?),
        publisher = COALESCE(publisher, ?),
        physical_format = COALESCE(physical_format, ?),
        edition_name = COALESCE(edition_name, ?),
        physical_dimensions = COALESCE(physical_dimensions, ?)
      WHERE isbn = ?
    `)
    .bind(
      bookData.title, bookData.author, bookData.cover_url, bookData.language,
      bookData.publish_date, bookData.number_of_pages_median,
      bookData.description, bookData.publisher,
      bookData.physical_format, bookData.edition_name, bookData.physical_dimensions,
      isbn
    )
    .run()

  const book = await c.env.DB
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()

  if (!book) return c.json({ error: 'Book not found' }, 404)
  if (!book.work_id) await linkWork(c.env.DB, book)
  // force=true clears series_checked_at so enrichment re-runs even if already done.
  // Unlike the cron sweeper (which only picks up series_checked_at IS NULL), this forces any work.
  if (book.work_id) c.executionCtx.waitUntil(enrichWork(c.env.DB, book.work_id, true, c.env.GOOGLE_BOOKS_API_KEY))
  return c.json(book)
})

books.patch('/override', async (c) => {
  const userId = c.get('userId')
  const { isbn, changes } = await c.req.json<{ isbn: string; changes: Partial<Record<OverrideField, string | number | null>> }>()

  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const validFields = Object.keys(changes ?? {}).filter(f => (OVERRIDE_FIELDS as readonly string[]).includes(f)) as OverrideField[]
  if (!validFields.length) return c.json({ ok: true })

  const book = await getBookByIsbn(c.env.DB, isbn)
  if (!book) return c.json({ error: 'Book not found' }, 404)

  const values = validFields.map(f => changes[f] ?? null)
  const cols = validFields.join(', ')
  const placeholders = validFields.map(() => '?').join(', ')
  const setClauses = validFields.map(f => `${f} = excluded.${f}`).join(', ')

  await c.env.DB
    .prepare(`
      INSERT INTO book_overrides (user_id, book_id, ${cols})
      VALUES (?, ?, ${placeholders})
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        ${setClauses},
        updated_at = datetime('now')
    `)
    .bind(userId, book.id, ...values)
    .run()

  return c.json({ ok: true })
})

books.patch('/custom-fields', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ isbn: string; values: Array<{ field_def_id: number; value: string }> }>()
  if (!body.isbn) return c.json({ error: 'ISBN required' }, 400)

  const [book, { results: ownedDefs }] = await Promise.all([
    getBookByIsbn(c.env.DB, body.isbn),
    c.env.DB.prepare('SELECT id FROM user_field_definitions WHERE user_id = ?').bind(userId).all<{ id: number }>(),
  ])
  if (!book) return c.json({ error: 'Book not found' }, 404)

  const validIds = new Set(ownedDefs.map(d => d.id))
  const values = (body.values ?? []).filter(v => validIds.has(v.field_def_id))

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?').bind(userId, book.id),
    ...values.map(v =>
      c.env.DB.prepare('INSERT INTO book_custom_fields (user_id, book_id, field_def_id, field_value) VALUES (?, ?, ?, ?)')
        .bind(userId, book.id, v.field_def_id, (v.value ?? '').trim() || null)
    ),
  ])

  return c.json({ ok: true })
})

export default books
