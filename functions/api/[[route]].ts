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
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

app.get('/api/scans', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM scans WHERE user_id = ? ORDER BY created_at DESC')
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

app.post('/api/scans', async (c) => {
  const { isbn } = await c.req.json()
  const userId = c.get('userId')
  const db = c.env.DB

  let result
  try {
    result = await db
      .prepare('INSERT INTO scans (user_id, isbn) VALUES (?, ?)')
      .bind(userId, isbn)
      .run()
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Already in your list' }, 409)
    }
    return c.json({ error: 'Failed to save scan' }, 500)
  }

  const scanId = result.meta.last_row_id

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const res = await fetch(
          `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
        )
        const data: any = await res.json()
        const book = data[`ISBN:${isbn}`]
        if (book) {
          await db
            .prepare('UPDATE scans SET title = ?, author = ?, cover_url = ? WHERE id = ?')
            .bind(
              book.title ?? null,
              book.authors?.[0]?.name ?? null,
              book.cover?.medium ?? book.cover?.small ?? null,
              scanId,
            )
            .run()
        }
      } catch (e) {
        console.error('OpenLibrary enrichment failed', e)
      }
    })(),
  )

  return c.json({ message: 'Scan saved', isbn }, 201)
})

app.delete('/api/scans/:id', async (c) => {
  const { success } = await c.env.DB
    .prepare('DELETE FROM scans WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('userId'))
    .run()

  return success
    ? c.json({ message: 'Scan deleted' })
    : c.json({ error: 'Failed to delete scan' }, 500)
})

export const onRequest = handle(app)
