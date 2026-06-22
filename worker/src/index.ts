import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import authRoutes from './routes/auth'
import booksRoutes from './routes/books'
import fieldsRoutes from './routes/fields'
import scansRoutes from './routes/scans'
import { works, series } from './routes/catalog'

const app = new Hono<Env>()

app.use('/api/*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN ?? '*'
  return cors({
    origin,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Type'],
  })(c, next)
})

app.route('/api/auth', authRoutes)
app.route('/api/books', booksRoutes)
app.route('/api/field-definitions', fieldsRoutes)
app.route('/api/scans', scansRoutes)
app.route('/api/works', works)
app.route('/api/series', series)

export default app
