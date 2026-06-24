import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../auth'
import { resolveEdition } from '../editions'
import { enrichWork } from '../enrichment'
import { SORT_CLAUSES, SCAN_SELECT, fetchCustomFields, attachCustomFields, VALID_STATUSES } from '../library-query'

const scans = new Hono<Env>()

scans.use('*', authMiddleware)

scans.get('/', async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '200'), 500)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const locale = c.req.query('locale') ?? 'en'
  const orderClause = SORT_CLAUSES[c.req.query('sort') ?? ''] ?? SORT_CLAUSES.date_desc

  const { results } = await c.env.DB
    .prepare(`${SCAN_SELECT} WHERE s.user_id = ? ORDER BY ${orderClause} LIMIT ? OFFSET ?`)
    .bind(locale, userId, limit, offset)
    .all<any>()

  const bookIds = results.map((r: any) => r.book_id as number)
  const { defs, valuesByBook } = await fetchCustomFields(c.env.DB, userId, bookIds)

  return c.json(results.map(row => attachCustomFields(row, defs, valuesByBook)))
})

scans.post('/', async (c) => {
  const { isbn, status } = await c.req.json<{ isbn: string; status?: string }>()
  if (!isbn) return c.json({ error: 'ISBN is required' }, 400)
  const VALID_STATUSES = ['unread', 'reading', 'read']
  const initialStatus = VALID_STATUSES.includes(status ?? '') ? status : 'unread'

  const userId = c.get('userId')
  const db = c.env.DB
  const locale = c.req.query('locale') ?? 'en'

  // allowEmpty: a drained offline-queue scan must succeed even if the book can't be resolved.
  const book = await resolveEdition(db, isbn, c.env.GOOGLE_BOOKS_API_KEY, true)
  if (!book) {
    console.error('[POST /api/scans] book resolution failed, isbn:', isbn)
    return c.json({ error: 'Failed to resolve book entry' }, 500)
  }

  let result
  try {
    result = await db
      .prepare('INSERT INTO scans (user_id, book_id, status) VALUES (?, ?, ?)')
      .bind(userId, book.id, initialStatus)
      .run()
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Already in your list' }, 409)
    }
    console.error('[POST /api/scans] scan INSERT failed:', e)
    return c.json({ error: 'Failed to save scan' }, 500)
  }

  if (book.work_id) c.executionCtx.waitUntil(enrichWork(db, book.work_id, false, c.env.GOOGLE_BOOKS_API_KEY))

  const saved = await db
    .prepare(`${SCAN_SELECT} WHERE s.id = ?`)
    .bind(locale, result.meta.last_row_id)
    .first<any>()

  const { defs, valuesByBook } = await fetchCustomFields(db, userId, saved ? [saved.book_id] : [])

  return c.json(saved ? attachCustomFields(saved, defs, valuesByBook) : {}, 201)
})

// Single scan — used by BookDetail to poll enrichment_status after a scan.
scans.get('/:id', async (c) => {
  const userId = c.get('userId')
  const locale = c.req.query('locale') ?? 'en'
  const scan = await c.env.DB
    .prepare(`${SCAN_SELECT} WHERE s.id = ? AND s.user_id = ?`)
    .bind(locale, c.req.param('id'), userId)
    .first<any>()
  if (!scan) return c.json({ error: 'Not found' }, 404)
  const { defs, valuesByBook } = await fetchCustomFields(c.env.DB, userId, [scan.book_id])
  return c.json(attachCustomFields(scan, defs, valuesByBook))
})

scans.patch('/:id', async (c) => {
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

scans.delete('/:id', async (c) => {
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

export default scans
