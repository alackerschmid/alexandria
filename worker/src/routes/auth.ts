import { Hono } from 'hono'
import type { Env } from '../types'
import { EMAIL_RE, signToken, authMiddleware } from '../auth'
import { hashPassword, verifyPassword, needsRehash } from '../password'
import { rateLimitOrReject } from '../rate-limit'

const auth = new Hono<Env>()

auth.post('/register', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const blocked = await rateLimitOrReject(c, `register:${ip}`, 5, 10, 'Too many registration attempts — please slow down')
  if (blocked) return blocked

  const body = await c.req.json()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : body.email
  const { password } = body

  if (!email || !EMAIL_RE.test(email)) {
    return c.json({ error: 'A valid email address is required' }, 400)
  }
  // typeof guard: a non-string JSON value (e.g. a number) has no usable .length
  // and would otherwise be silently coerced by hashPassword's TextEncoder.
  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400)
  }

  const db = c.env.DB
  const hash = await hashPassword(password)

  let userId: number
  try {
    const result = await db
      .prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .bind(email, hash)
      .run()
    userId = result.meta.last_row_id
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'An account with that email already exists' }, 409)
    }
    return c.json({ error: 'Failed to create account' }, 500)
  }

  const token = await signToken(userId, c.env.JWT_SECRET)
  return c.json({ token, email, firstname: null }, 201)
})

auth.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown'
  const blocked = await rateLimitOrReject(c, `login:${ip}`, 10, 1, 'Too many login attempts — please slow down')
  if (blocked) return blocked

  const body = await c.req.json()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : body.email
  const { password } = body

  if (!email || typeof password !== 'string' || !password) {
    return c.json({ error: 'Email and password are required' }, 400)
  }

  const db = c.env.DB
  const user = await db
    .prepare('SELECT id, password_hash, firstname FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number, password_hash: string, firstname: string | null }>()

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  // Lazy migration to the current hash scheme now that the plaintext is in hand.
  // Best-effort and off the critical path: a failed rehash must not fail a
  // verified login (the next login simply retries it).
  if (needsRehash(user.password_hash)) {
    c.executionCtx.waitUntil(
      hashPassword(password)
        .then(hash => db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
          .bind(hash, user.id)
          .run())
        .catch(e => console.error('password rehash failed', e)),
    )
  }

  const token = await signToken(user.id, c.env.JWT_SECRET)
  return c.json({ token, email, firstname: user.firstname ?? null })
})

auth.patch('/me', authMiddleware, async (c) => {
  const body = await c.req.json<{
    firstname?: string
    email?: string
    currentPassword?: string
    newPassword?: string
  }>()
  const db = c.env.DB
  const userId = c.get('userId')
  const result: Record<string, unknown> = {}

  if (typeof body.firstname === 'string') {
    const trimmed = body.firstname.trim()
    if (!trimmed) return c.json({ error: 'A valid first name is required' }, 400)
    await db.prepare('UPDATE users SET firstname = ? WHERE id = ?').bind(trimmed, userId).run()
    result.firstname = trimmed
  }

  if (typeof body.email === 'string') {
    const newEmail = body.email.trim().toLowerCase()
    if (!EMAIL_RE.test(newEmail)) return c.json({ error: 'A valid email address is required' }, 400)
    try {
      await db.prepare('UPDATE users SET email = ? WHERE id = ?').bind(newEmail, userId).run()
      result.email = newEmail
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint failed')) {
        return c.json({ error: 'That email address is already in use' }, 409)
      }
      return c.json({ error: 'Failed to update email' }, 500)
    }
  }

  if (typeof body.currentPassword === 'string' && typeof body.newPassword === 'string') {
    if (body.newPassword.length < 8) {
      return c.json({ error: 'New password must be at least 8 characters' }, 400)
    }
    const user = await db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(userId)
      .first<{ password_hash: string }>()
    if (!user || !(await verifyPassword(body.currentPassword, user.password_hash))) {
      return c.json({ error: 'Current password is incorrect' }, 401)
    }
    const newHash = await hashPassword(body.newPassword)
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run()
    result.passwordChanged = true
  }

  if (Object.keys(result).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  return c.json(result)
})

auth.delete('/me', authMiddleware, async (c) => {
  const { password } = await c.req.json<{ password?: string }>()
  if (typeof password !== 'string' || !password) {
    return c.json({ error: 'Password is required to delete your account' }, 400)
  }

  const db = c.env.DB
  const userId = c.get('userId')
  const user = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string }>()

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Incorrect password' }, 401)
  }

  await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
  return new Response(null, { status: 204 })
})

export default auth
