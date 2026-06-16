import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
}

type Variables = {
  userId: number
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

app.use('/api/*', cors())

app.post('/api/auth/register', async (c) => {
  const { email, password } = await c.req.json()
  const db = c.env.DB
  
  const hash = bcrypt.hashSync(password, 10)
  try {
    const { success } = await db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .bind(email, hash)
      .run()

    if (success) {
      return c.json({ message: 'User created successfully' }, 201)
    }
    return c.json({ error: 'Failed to create user' }, 500)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Email already exists' }, 409)
    }
    return c.json({ error: e.message }, 500)
  }
})

app.post('/api/auth/login', async (c) => {
  const { email, password } = await c.req.json()
  const db = c.env.DB
  
  const user = await db.prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number, password_hash: string }>()
    
  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  
  const valid = bcrypt.compareSync(password, user.password_hash)
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }
  
  const secret = new TextEncoder().encode(c.env.JWT_SECRET)
  const token = await new SignJWT({ userId: user.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
    
  return c.json({ token, email })
})

// Auth middleware
app.use('/api/scans/*', async (c, next) => {
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
    return c.json({ error: 'Invalid token' }, 401)
  }
})

app.get('/api/scans', async (c) => {
  const userId = c.get('userId')
  const db = c.env.DB
  
  const { results } = await db.prepare('SELECT * FROM scans WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all()
    
  return c.json(results)
})

app.post('/api/scans', async (c) => {
  const userId = c.get('userId')
  const { isbn } = await c.req.json()
  const db = c.env.DB

  // Fetch metadata from OpenLibrary
  let title = 'Unknown Title'
  let author = 'Unknown Author'
  let cover_url = ''

  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`)
    const data: any = await res.json()
    const book = data[`ISBN:${isbn}`]
    if (book) {
      title = book.title || title
      if (book.authors && book.authors.length > 0) {
        author = book.authors[0].name
      }
      if (book.cover) {
        cover_url = book.cover.medium || book.cover.small || book.cover.large || ''
      }
    }
  } catch (e) {
    console.error('Failed to fetch from OpenLibrary', e)
  }
  
  const { success } = await db.prepare(
    'INSERT INTO scans (user_id, isbn, title, author, cover_url) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(userId, isbn, title, author, cover_url)
    .run()
    
  if (success) {
    return c.json({ message: 'Scan saved', isbn, title, author, cover_url }, 201)
  }
  return c.json({ error: 'Failed to save scan' }, 500)
})

app.delete('/api/scans/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const db = c.env.DB
  
  const { success } = await db.prepare('DELETE FROM scans WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .run()
    
  if (success) {
    return c.json({ message: 'Scan deleted' })
  }
  return c.json({ error: 'Failed to delete scan' }, 500)
})

export default app
