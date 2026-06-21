import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  CORS_ORIGIN?: string
  GOOGLE_BOOKS_API_KEY: string
}

type Variables = {
  userId: number
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

app.use('/api/*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN ?? '*'
  return cors({
    origin,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Type'],
  })(c, next)
})

// ── Auth ──────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

app.post('/api/auth/register', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ error: 'A valid email address is required' }, 400)
  }
  if (!password || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const db = c.env.DB
  const hash = bcrypt.hashSync(password, 10)

  try {
    await db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .bind(email, hash)
      .run()
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'An account with that email already exists' }, 409)
    }
    return c.json({ error: 'Failed to create account' }, 500)
  }

  const user = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number }>()

  const token = await signToken(user!.id, c.env.JWT_SECRET)
  return c.json({ token, email, firstname: null }, 201)
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const db = c.env.DB
  const user = await db
    .prepare('SELECT id, password_hash, firstname FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number, password_hash: string, firstname: string | null }>()

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const token = await signToken(user.id, c.env.JWT_SECRET)
  return c.json({ token, email, firstname: user.firstname ?? null })
})

async function signToken(userId: number, secret: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret))
}

// ── Auth middleware ─────────────────────────────────────────────────────────

const authMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.split(' ')[1]
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET)
    const { payload } = await jwtVerify(token, secret)
    c.set('userId', payload.userId as number)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

app.patch('/api/auth/me', authMiddleware, async (c) => {
  const { firstname } = await c.req.json()
  const trimmed = typeof firstname === 'string' ? firstname.trim() : ''
  if (!trimmed) return c.json({ error: 'A valid first name is required' }, 400)

  await c.env.DB
    .prepare('UPDATE users SET firstname = ? WHERE id = ?')
    .bind(trimmed, c.get('userId'))
    .run()

  return c.json({ firstname: trimmed })
})

app.use('/api/scans/*', authMiddleware)

// Public guest lookup — no auth. Registered before authMiddleware so it is not gated.
app.get('/api/books/guest-lookup', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const db = c.env.DB
  const cached = await db
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()
  if (cached) return c.json(cached)

  const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!bookData) return c.json({ notFound: true }, 404)

  await db
    .prepare(
      'INSERT OR IGNORE INTO books (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(isbn, bookData.title, bookData.author, bookData.cover_url, bookData.language, bookData.publish_date, bookData.number_of_pages_median, bookData.description, bookData.publisher)
    .run()

  const book = await db
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()

  return c.json(book ?? { notFound: true })
})

// Public sample of random catalogued books — powers the marketing preview. No auth.
app.get('/api/books/sample', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '3'), 12)
  const db = c.env.DB

  const { results } = await db
    .prepare(
      'SELECT title, author, cover_url FROM books WHERE title IS NOT NULL AND cover_url IS NOT NULL ORDER BY RANDOM() LIMIT ?'
    )
    .bind(limit)
    .all<{ title: string, author: string | null, cover_url: string | null }>()

  const total = await db
    .prepare('SELECT COUNT(*) AS n FROM books WHERE title IS NOT NULL')
    .first<{ n: number }>()

  return c.json({ books: results, total: total?.n ?? results.length })
})

app.use('/api/books/*', authMiddleware)
app.use('/api/field-definitions/*', authMiddleware)

// ── Books ─────────────────────────────────────────────────────────────────────

type BookRow = {
  id: number
  isbn: string
  title: string | null
  author: string | null
  cover_url: string | null
  language: string | null
  publish_date: string | null
  number_of_pages_median: number | null
  description: string | null
  publisher: string | null
  fetched_at: string
}

type BookMetadata = {
  title: string | null
  author: string | null
  cover_url: string | null
  language: string | null
  publish_date: string | null
  number_of_pages_median: number | null
  description: string | null
  publisher: string | null
}

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
async function fetchBookMetadata(isbn: string, googleApiKey?: string): Promise<BookMetadata | null> {
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

// Book metadata lookup — checks DB cache first, then Google Books, then OpenLibrary.
app.get('/api/books/lookup', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const db = c.env.DB

  const cached = await db
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()

  if (cached) return c.json(cached)

  const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!bookData) return c.json({ error: 'Book not found' }, 404)

  await db
    .prepare(
      'INSERT OR IGNORE INTO books (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(isbn, bookData.title, bookData.author, bookData.cover_url, bookData.language, bookData.publish_date, bookData.number_of_pages_median, bookData.description, bookData.publisher)
    .run()

  const book = await db
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()

  if (!book) return c.json({ error: 'Book not found' }, 404)
  return c.json(book)
})

// Refresh book metadata — tries Google Books then OpenLibrary, fills NULL fields only.
app.post('/api/books/refresh', async (c) => {
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
        publisher = COALESCE(publisher, ?)
      WHERE isbn = ?
    `)
    .bind(
      bookData.title, bookData.author, bookData.cover_url, bookData.language,
      bookData.publish_date, bookData.number_of_pages_median,
      bookData.description, bookData.publisher,
      isbn
    )
    .run()

  const book = await c.env.DB
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()

  if (!book) return c.json({ error: 'Book not found' }, 404)
  return c.json(book)
})

// ── Book overrides ────────────────────────────────────────────────────────────

function getBookByIsbn(db: D1Database, isbn: string) {
  return db.prepare('SELECT id FROM books WHERE isbn = ?').bind(isbn).first<{ id: number }>()
}

const OVERRIDE_FIELDS = ['title', 'author', 'cover_url', 'language', 'publish_date', 'number_of_pages_median', 'description', 'publisher'] as const
type OverrideField = typeof OVERRIDE_FIELDS[number]

app.patch('/api/books/override', async (c) => {
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

app.patch('/api/books/custom-fields', async (c) => {
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

// ── Field definitions ──────────────────────────────────────────────────────────

app.get('/api/field-definitions', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare('SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
    .bind(userId)
    .all()
  return c.json(results)
})

app.post('/api/field-definitions', async (c) => {
  const userId = c.get('userId')
  const { name, type = 'text' } = await c.req.json<{ name: string; type?: string }>()
  if (!name?.trim()) return c.json({ error: 'Name required' }, 400)
  const VALID_TYPES = ['text', 'integer', 'select']
  if (!VALID_TYPES.includes(type)) return c.json({ error: 'Invalid type' }, 400)

  const maxOrder = await c.env.DB
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM user_field_definitions WHERE user_id = ?')
    .bind(userId)
    .first<{ max_order: number }>()

  try {
    const result = await c.env.DB
      .prepare('INSERT INTO user_field_definitions (user_id, field_name, field_type, sort_order) VALUES (?, ?, ?, ?)')
      .bind(userId, name.trim(), type, (maxOrder?.max_order ?? -1) + 1)
      .run()
    return c.json({ id: result.meta.last_row_id, name: name.trim(), type, sort_order: (maxOrder?.max_order ?? -1) + 1 }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'A field with that name already exists' }, 409)
    return c.json({ error: 'Failed to create field' }, 500)
  }
})

app.delete('/api/field-definitions/:id', async (c) => {
  const userId = c.get('userId')
  const result = await c.env.DB
    .prepare('DELETE FROM user_field_definitions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

// ── Scans ─────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  date_desc: 's.created_at DESC',
  date_asc: 's.created_at ASC',
  title_asc: 'COALESCE(b.title, b.isbn) ASC COLLATE NOCASE',
  title_desc: 'COALESCE(b.title, b.isbn) DESC COLLATE NOCASE',
  author_asc: "COALESCE(b.author, '') ASC COLLATE NOCASE",
  author_desc: "COALESCE(b.author, '') DESC COLLATE NOCASE",
}

// book_id is included here solely for custom-field merging in JS; it is stripped before the response.
const SCAN_SELECT = `
  SELECT s.id, s.status, s.created_at,
         b.id   AS book_id,
         b.isbn,
         COALESCE(o.title, b.title)                          AS title,
         COALESCE(o.author, b.author)                        AS author,
         COALESCE(o.cover_url, b.cover_url)                  AS cover_url,
         COALESCE(o.language, b.language)                    AS language,
         COALESCE(o.publish_date, b.publish_date)            AS publish_date,
         COALESCE(o.number_of_pages_median, b.number_of_pages_median) AS number_of_pages_median,
         COALESCE(o.description, b.description)              AS description,
         COALESCE(o.publisher, b.publisher)                  AS publisher,
         (o.title IS NOT NULL)                               AS title_overridden,
         (o.author IS NOT NULL)                              AS author_overridden,
         (o.cover_url IS NOT NULL)                           AS cover_url_overridden,
         (o.language IS NOT NULL)                            AS language_overridden,
         (o.publish_date IS NOT NULL)                        AS publish_date_overridden,
         (o.number_of_pages_median IS NOT NULL)              AS pages_overridden,
         (o.description IS NOT NULL)                         AS description_overridden,
         (o.publisher IS NOT NULL)                           AS publisher_overridden
  FROM scans s
  JOIN books b ON s.book_id = b.id
  LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id`

async function fetchCustomFields(db: D1Database, userId: number, bookIds: number[]) {
  if (!bookIds.length) return { defs: [], valuesByBook: new Map<number, Map<number, string | null>>() }
  const placeholders = bookIds.map(() => '?').join(',')
  const [{ results: defs }, { results: rawValues }] = await Promise.all([
    db.prepare('SELECT id, field_name AS name, field_type AS type FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
      .bind(userId).all<{ id: number; name: string; type: string }>(),
    db.prepare(`SELECT book_id, field_def_id, field_value FROM book_custom_fields WHERE user_id = ? AND book_id IN (${placeholders})`)
      .bind(userId, ...bookIds).all<{ book_id: number; field_def_id: number; field_value: string | null }>(),
  ])
  const valuesByBook = new Map<number, Map<number, string | null>>()
  for (const v of rawValues) {
    if (!valuesByBook.has(v.book_id)) valuesByBook.set(v.book_id, new Map())
    valuesByBook.get(v.book_id)!.set(v.field_def_id, v.field_value)
  }
  return { defs, valuesByBook }
}

function attachCustomFields(
  row: any,
  defs: { id: number; name: string; type: string }[],
  valuesByBook: Map<number, Map<number, string | null>>,
) {
  const { book_id, ...rest } = row
  const bookVals = valuesByBook.get(book_id)
  return {
    ...rest,
    custom_field_values: defs.map(d => ({ field_def_id: d.id, value: bookVals?.get(d.id) ?? null })),
  }
}

const VALID_STATUSES = ['unread', 'reading', 'read'] as const

app.get('/api/scans', async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200'), 500)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const orderClause = SORT_CLAUSES[c.req.query('sort') ?? ''] ?? SORT_CLAUSES.date_desc

  const { results } = await c.env.DB
    .prepare(`${SCAN_SELECT} WHERE s.user_id = ? ORDER BY ${orderClause} LIMIT ? OFFSET ?`)
    .bind(userId, limit, offset)
    .all<any>()

  const bookIds = results.map((r: any) => r.book_id as number)
  const { defs, valuesByBook } = await fetchCustomFields(c.env.DB, userId, bookIds)

  return c.json(results.map(row => attachCustomFields(row, defs, valuesByBook)))
})

app.post('/api/scans', async (c) => {
  const { isbn } = await c.req.json()
  if (!isbn) return c.json({ error: 'ISBN is required' }, 400)

  const userId = c.get('userId')
  const db = c.env.DB

  // Ensure book exists in the books table (may have been cached by /api/books/lookup already).
  let book = await db
    .prepare('SELECT id FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<{ id: number }>()

  if (!book) {
    // Book wasn't looked up beforehand (e.g. drained from offline queue) — fetch and cache now.
    // fetchBookMetadata never throws (catches internally), so ?? handles the null/undefined case.
    const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY) ?? {
      title: null, author: null, cover_url: null, language: null,
      publish_date: null, number_of_pages_median: null, description: null, publisher: null,
    }
    try {
      await db
        .prepare('INSERT OR IGNORE INTO books (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(isbn, bookData.title, bookData.author, bookData.cover_url, bookData.language, bookData.publish_date, bookData.number_of_pages_median, bookData.description, bookData.publisher)
        .run()
    } catch (e) {
      console.error('[POST /api/scans] book resolution failed:', e)
      return c.json({ error: 'Failed to resolve book entry' }, 500)
    }
    book = await db.prepare('SELECT id FROM books WHERE isbn = ?').bind(isbn).first<{ id: number }>()
  }

  if (!book) {
    console.error('[POST /api/scans] book still null after insert, isbn:', isbn)
    return c.json({ error: 'Failed to resolve book entry' }, 500)
  }

  let result
  try {
    result = await db
      .prepare('INSERT INTO scans (user_id, book_id) VALUES (?, ?)')
      .bind(userId, book.id)
      .run()
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Already in your list' }, 409)
    }
    console.error('[POST /api/scans] scan INSERT failed:', e)
    return c.json({ error: 'Failed to save scan' }, 500)
  }

  const saved = await db
    .prepare(`${SCAN_SELECT} WHERE s.id = ?`)
    .bind(result.meta.last_row_id)
    .first<any>()

  const { defs, valuesByBook } = await fetchCustomFields(db, userId, saved ? [saved.book_id] : [])

  return c.json(saved ? attachCustomFields(saved, defs, valuesByBook) : {}, 201)
})

app.patch('/api/scans/:id', async (c) => {
  const { status } = await c.req.json()
  if (!VALID_STATUSES.includes(status)) {
    return c.json({ error: 'status must be one of: unread, reading, read' }, 400)
  }

  const result = await c.env.DB
    .prepare('UPDATE scans SET status = ? WHERE id = ? AND user_id = ?')
    .bind(status, c.req.param('id'), c.get('userId'))
    .run()

  if (!result.meta.changes) {
    return c.json({ error: 'Book not found' }, 404)
  }

  return c.json({ id: Number(c.req.param('id')), status })
})

app.delete('/api/scans/:id', async (c) => {
  const userId = c.get('userId')
  const scanId = c.req.param('id')

  const scan = await c.env.DB
    .prepare('SELECT book_id FROM scans WHERE id = ? AND user_id = ?')
    .bind(scanId, userId)
    .first<{ book_id: number }>()

  if (!scan) return c.json({ error: 'Book not found' }, 404)

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM book_overrides WHERE user_id = ? AND book_id = ?').bind(userId, scan.book_id),
    c.env.DB.prepare('DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?').bind(userId, scan.book_id),
    c.env.DB.prepare('DELETE FROM scans WHERE id = ? AND user_id = ?').bind(scanId, userId),
  ])

  return c.json({ message: 'Scan deleted' })
})

export default app
