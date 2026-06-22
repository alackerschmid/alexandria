import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../auth'

export const works = new Hono<Env>()
export const series = new Hono<Env>()

works.use('*', authMiddleware)
series.use('*', authMiddleware)

// Other editions of the same work; scan_id != null marks the ones the user owns.
works.get('/:workId/editions', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB.prepare(`
    SELECT b.isbn, b.title, b.language, b.cover_url, s.id AS scan_id
    FROM books b
    LEFT JOIN scans s ON s.book_id = b.id AND s.user_id = ?
    WHERE b.work_id = ?
    ORDER BY b.language`)
    .bind(userId, c.req.param('workId'))
    .all()
  return c.json(results)
})

// Series completeness: localized name + every entry (incl. ones the user hasn't scanned).
series.get('/:seriesId', async (c) => {
  const userId = c.get('userId')
  const seriesId = c.req.param('seriesId')
  const locale = c.req.query('locale') ?? 'en'

  const s = await c.env.DB.prepare(`
    SELECT s.id, COALESCE(sn.name, s.canonical_name) AS name
    FROM series s
    LEFT JOIN series_names sn ON sn.series_id = s.id AND sn.language = ?
    WHERE s.id = ?`)
    .bind(locale, seriesId)
    .first<{ id: number; name: string | null }>()
  if (!s) return c.json({ error: 'Series not found' }, 404)

  // One row per work: MAX(owned) picks an owned edition's isbn/cover when the user has one
  // (SQLite bare-column-with-aggregate rule).
  const { results: entries } = await c.env.DB.prepare(`
    SELECT w.id AS work_id, ws.ordinal, w.canonical_title AS title,
           MAX(sc.id IS NOT NULL) AS owned,
           b.isbn, b.cover_url, sc.id AS scan_id
    FROM work_series ws
    JOIN works w ON w.id = ws.work_id
    LEFT JOIN books b ON b.work_id = w.id
    LEFT JOIN scans sc ON sc.book_id = b.id AND sc.user_id = ?
    WHERE ws.series_id = ?
    GROUP BY w.id
    ORDER BY ws.ordinal IS NULL, ws.ordinal, w.canonical_title`)
    .bind(userId, seriesId)
    .all()

  return c.json({ id: s.id, name: s.name, entries })
})
