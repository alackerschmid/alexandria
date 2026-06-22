import { Hono } from 'hono'
import * as bcrypt from 'bcryptjs'
import type { Env } from '../types'
import { EMAIL_RE, signToken, authMiddleware } from '../auth'

const auth = new Hono<Env>()

auth.post('/register', async (c) => {
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

auth.post('/login', async (c) => {
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

auth.patch('/me', authMiddleware, async (c) => {
  const { firstname } = await c.req.json()
  const trimmed = typeof firstname === 'string' ? firstname.trim() : ''
  if (!trimmed) return c.json({ error: 'A valid first name is required' }, 400)

  await c.env.DB
    .prepare('UPDATE users SET firstname = ? WHERE id = ?')
    .bind(trimmed, c.get('userId'))
    .run()

  return c.json({ firstname: trimmed })
})

export default auth
