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

// Bulk membership: every entry of every series the user owns ≥1 book in.
// Powers the library's grouped-by-series shelves (unowned reveal, main/side counts,
// completeness) without a round-trip per series. Same row shape as /:seriesId.
series.get('/', async (c) => {
  const userId = c.get('userId')
  const locale = c.req.query('locale') ?? 'en'

  const { results: rows } = await c.env.DB.prepare(`
    WITH user_series AS (
      SELECT DISTINCT ws.series_id
      FROM scans sc
      JOIN books b ON b.id = sc.book_id
      JOIN work_series ws ON ws.work_id = b.work_id
      WHERE sc.user_id = ?
    )
    SELECT ws.series_id AS series_id,
           COALESCE(sn.name, s.canonical_name) AS series_name,
           w.id AS work_id, ws.ordinal, w.canonical_title AS title,
           MAX(sc.id IS NOT NULL) AS owned,
           COALESCE(MAX(CASE WHEN sc.id IS NOT NULL THEN b.isbn END), MAX(b.isbn)) AS isbn,
           COALESCE(MAX(CASE WHEN sc.id IS NOT NULL THEN b.cover_url END), MAX(b.cover_url)) AS cover_url,
           MAX(sc.id) AS scan_id
    FROM work_series ws
    JOIN works w ON w.id = ws.work_id
    JOIN series s ON s.id = ws.series_id
    LEFT JOIN series_names sn ON sn.series_id = s.id AND sn.language = ?
    LEFT JOIN books b ON b.work_id = w.id
    LEFT JOIN scans sc ON sc.book_id = b.id AND sc.user_id = ?
    WHERE ws.series_id IN (SELECT series_id FROM user_series)
    GROUP BY ws.series_id, w.id
    ORDER BY ws.series_id, ws.ordinal IS NULL, ws.ordinal, w.canonical_title`)
    .bind(userId, locale, userId)
    .all<{
      series_id: number; series_name: string | null; work_id: number; ordinal: number | null
      title: string | null; owned: number; isbn: string | null; cover_url: string | null; scan_id: number | null
    }>()

  const byId: Record<number, { id: number; name: string | null; entries: unknown[] }> = {}
  for (const r of rows) {
    const { series_id, series_name, ...entry } = r
    if (!byId[series_id]) byId[series_id] = { id: series_id, name: series_name, entries: [] }
    byId[series_id].entries.push(entry)
  }
  return c.json(byId)
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

  const { results: entries } = await c.env.DB.prepare(`
    SELECT w.id AS work_id, ws.ordinal, w.canonical_title AS title,
           MAX(sc.id IS NOT NULL) AS owned,
           COALESCE(MAX(CASE WHEN sc.id IS NOT NULL THEN b.isbn END), MAX(b.isbn)) AS isbn,
           COALESCE(MAX(CASE WHEN sc.id IS NOT NULL THEN b.cover_url END), MAX(b.cover_url)) AS cover_url,
           MAX(sc.id) AS scan_id
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
