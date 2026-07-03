import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../auth'
import { fetchOpenLibraryEditions, fetchOpenLibraryEditionsByWorkId, saveEditionCandidates } from '../editions'

export const works = new Hono<Env>()
export const series = new Hono<Env>()

works.use('*', authMiddleware)
series.use('*', authMiddleware)

type EditionRow = {
  isbn: string
  title: string | null
  language: string | null
  cover_url: string | null
  publish_date: string | null
  publisher: string | null
  scan_id: number | null
  materialized: boolean
}

async function loadEditions(db: D1Database, userId: number, workId: string) {
  const { results: materialized } = await db.prepare(`
    SELECT b.isbn, b.title, b.language, b.cover_url, b.publish_date, b.publisher, s.id AS scan_id
    FROM books b
    LEFT JOIN scans s ON s.book_id = b.id AND s.user_id = ?
    WHERE b.work_id = ?
    ORDER BY b.language`)
    .bind(userId, workId)
    .all<{ isbn: string; title: string | null; language: string | null; cover_url: string | null; publish_date: string | null; publisher: string | null; scan_id: number | null }>()

  const { results: candidates } = await db.prepare(`
    SELECT wei.isbn, wei.title, wei.language, wei.cover_url, wei.publish_date, wei.publisher
    FROM work_edition_isbns wei
    WHERE wei.work_id = ? AND NOT EXISTS (SELECT 1 FROM books b WHERE b.isbn = wei.isbn)
    ORDER BY wei.isbn`)
    .bind(workId)
    .all<{ isbn: string; title: string | null; language: string | null; cover_url: string | null; publish_date: string | null; publisher: string | null }>()

  const editions: EditionRow[] = [
    ...materialized.map(r => ({ ...r, materialized: true })),
    ...candidates.map(r => ({ ...r, scan_id: null, materialized: false })),
  ]

  const work = await db.prepare('SELECT editions_checked_at FROM works WHERE id = ?')
    .bind(workId)
    .first<{ editions_checked_at: string | null }>()

  return { searched: !!work?.editions_checked_at, editions }
}

// Other editions of the same work; scan_id != null marks the ones the user owns.
// materialized:false rows are candidate ISBNs from an OpenLibrary discovery run
// that haven't been fetched into `books` yet (see POST .../editions/discover).
works.get('/:workId/editions', async (c) => {
  const userId = c.get('userId')
  const result = await loadEditions(c.env.DB, userId, c.req.param('workId'))
  return c.json(result)
})

// User-triggered discovery of related editions via OpenLibrary's works/editions.json.
// Idempotent: once works.editions_checked_at is set, subsequent calls are a no-op (returns the
// existing list), so this is never called in a loop and stays polite to OpenLibrary.
works.post('/:workId/editions/discover', async (c) => {
  const userId = c.get('userId')
  const workId = c.req.param('workId')
  const db = c.env.DB

  const work = await db.prepare('SELECT editions_checked_at, openlibrary_work_id FROM works WHERE id = ?')
    .bind(workId)
    .first<{ editions_checked_at: string | null; openlibrary_work_id: string | null }>()
  if (!work) return c.json({ error: 'Work not found' }, 404)

  let discoveryFailed = false

  if (!work.editions_checked_at) {
    const seed = await db.prepare(`
      SELECT b.isbn FROM books b
      LEFT JOIN scans s ON s.book_id = b.id AND s.user_id = ?
      WHERE b.work_id = ?
      ORDER BY s.id IS NULL LIMIT 1`)
      .bind(userId, workId)
      .first<{ isbn: string }>()

    // related is null when the OpenLibrary lookup itself failed (network/timeout/non-2xx) —
    // distinct from a successful call that found zero results. Only a successful call (found
    // something or confirmed nothing) marks the work as searched; a failure leaves it retryable.
    let related = seed ? await fetchOpenLibraryEditions(seed.isbn) : []
    // Seed-ISBN path found nothing (e.g. the owned ISBN is unknown to OpenLibrary) — fall back
    // to the OpenLibrary work id Wikidata linked during enrichment, when available.
    if (related !== null && related.length === 0 && work.openlibrary_work_id) {
      related = await fetchOpenLibraryEditionsByWorkId(work.openlibrary_work_id)
    }

    if (related === null) {
      discoveryFailed = true
    } else {
      await saveEditionCandidates(db, Number(workId), related)
    }
  }

  const result = await loadEditions(db, userId, workId)
  return c.json({ ...result, discoveryFailed })
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
