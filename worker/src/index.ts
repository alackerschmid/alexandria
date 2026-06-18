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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  return c.json({ token, email }, 201)
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()

  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const db = c.env.DB
  const user = await db
    .prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number, password_hash: string }>()

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  const token = await signToken(user.id, c.env.JWT_SECRET)
  return c.json({ token, email })
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
  } catch (e) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

app.use('/api/scans/*', authMiddleware)
app.use('/api/books/*', authMiddleware)

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

// ── Scans ─────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  date_desc: 's.created_at DESC',
  date_asc: 's.created_at ASC',
  title_asc: 'COALESCE(b.title, b.isbn) ASC COLLATE NOCASE',
  title_desc: 'COALESCE(b.title, b.isbn) DESC COLLATE NOCASE',
  author_asc: "COALESCE(b.author, '') ASC COLLATE NOCASE",
  author_desc: "COALESCE(b.author, '') DESC COLLATE NOCASE",
}

const SCAN_SELECT = `
  SELECT s.id, s.status, s.created_at,
         b.isbn, b.title, b.author, b.cover_url, b.language, b.publish_date, b.number_of_pages_median,
         b.description, b.publisher
  FROM scans s
  JOIN books b ON s.book_id = b.id`

const VALID_STATUSES = ['unread', 'reading', 'read'] as const

app.get('/api/scans', async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200'), 500)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const orderClause = SORT_CLAUSES[c.req.query('sort') ?? ''] ?? SORT_CLAUSES.date_desc

  const { results } = await c.env.DB
    .prepare(`${SCAN_SELECT} WHERE s.user_id = ? ORDER BY ${orderClause} LIMIT ? OFFSET ?`)
    .bind(userId, limit, offset)
    .all()

  return c.json(results)
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
    const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY) ?? {
      title: null, author: null, cover_url: null, language: null,
      publish_date: null, number_of_pages_median: null, description: null, publisher: null,
    }
    await db
      .prepare('INSERT OR IGNORE INTO books (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(isbn, bookData.title, bookData.author, bookData.cover_url, bookData.language, bookData.publish_date, bookData.number_of_pages_median, bookData.description, bookData.publisher)
      .run()
    book = await db.prepare('SELECT id FROM books WHERE isbn = ?').bind(isbn).first<{ id: number }>()
  }

  if (!book) return c.json({ error: 'Failed to resolve book entry' }, 500)

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
    return c.json({ error: 'Failed to save scan' }, 500)
  }

  const saved = await db
    .prepare(`${SCAN_SELECT} WHERE s.id = ?`)
    .bind(result.meta.last_row_id)
    .first()

  return c.json(saved, 201)
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
  const result = await c.env.DB
    .prepare('DELETE FROM scans WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()

  if (!result.meta.changes) {
    return c.json({ error: 'Book not found' }, 404)
  }

  return c.json({ message: 'Scan deleted' })
})

export default app
