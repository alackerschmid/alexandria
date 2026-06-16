/// <reference types="@cloudflare/workers-types" />

import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { cors } from 'hono/cors'
import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  CORS_ORIGIN?: string
}

type Variables = {
  userId: number
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

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
    .first<{ id: number; password_hash: string }>()

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

// ── Auth middleware ───────────────────────────────────────────────────────────

app.use('/api/scans/*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET)
    const { payload } = await jwtVerify(authHeader.split(' ')[1], secret)
    c.set('userId', payload.userId as number)
    await next()
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
})

// ── Scans ─────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  date_desc: 'created_at DESC',
  date_asc: 'created_at ASC',
  title_asc: "COALESCE(title, isbn) ASC COLLATE NOCASE",
  title_desc: "COALESCE(title, isbn) DESC COLLATE NOCASE",
  author_asc: "COALESCE(author, '') ASC COLLATE NOCASE",
  author_desc: "COALESCE(author, '') DESC COLLATE NOCASE",
}

const VALID_STATUSES = ['unread', 'reading', 'read'] as const

app.get('/api/scans', async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200'), 500)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const orderClause = SORT_CLAUSES[c.req.query('sort') ?? ''] ?? SORT_CLAUSES.date_desc

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, isbn, title, author, cover_url, status, created_at
       FROM scans WHERE user_id = ?
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?`
    )
    .bind(userId, limit, offset)
    .all()

  return c.json(results)
})

app.post('/api/scans', async (c) => {
  const { isbn, title, author, cover_url } = await c.req.json()
  if (!isbn) return c.json({ error: 'ISBN is required' }, 400)

  const userId = c.get('userId')
  const db = c.env.DB

  let result
  try {
    result = await db
      .prepare(
        'INSERT INTO scans (user_id, isbn, title, author, cover_url) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(userId, isbn, title ?? null, author ?? null, cover_url ?? null)
      .run()
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Already in your list' }, 409)
    }
    return c.json({ error: 'Failed to save scan' }, 500)
  }

  return c.json(
    {
      id: result.meta.last_row_id,
      isbn,
      title: title ?? null,
      author: author ?? null,
      cover_url: cover_url ?? null,
      status: 'unread',
      created_at: new Date().toISOString(),
    },
    201
  )
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

export const onRequest = handle(app)
