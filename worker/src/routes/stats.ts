import { Hono } from 'hono'
import type { Env } from '../types'
import { authMiddleware } from '../auth'

const stats = new Hono<Env>()
stats.use('*', authMiddleware)

type RawRow = {
  status: string
  author: string | null
  language: string | null
  pages: number | null
  publish_date: string | null
  original_pub_date: string | null
  genres: string | null
}

function extractYear(r: RawRow): number | null {
  if (r.original_pub_date) {
    const n = parseInt(r.original_pub_date, 10)
    if (n >= 100 && n <= 2100) return n
  }
  if (r.publish_date) {
    const m = r.publish_date.match(/\d{4}/)
    if (m) {
      const n = parseInt(m[0], 10)
      if (n >= 100 && n <= 2100) return n
    }
  }
  return null
}

stats.get('/', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare(`
      SELECT s.status                                                        AS status,
             b.author                                                        AS author,
             COALESCE(o.language, b.language)                                AS language,
             COALESCE(o.number_of_pages_median, b.number_of_pages_median)    AS pages,
             COALESCE(o.publish_date, b.publish_date)                        AS publish_date,
             wk.original_pub_date                                            AS original_pub_date,
             wk.genres                                                       AS genres
      FROM scans s
      JOIN books b ON s.book_id = b.id
      LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
      LEFT JOIN works wk ON wk.id = b.work_id
      WHERE s.user_id = ?
    `)
    .bind(userId)
    .all<RawRow>()

  const rows = results

  // Status counts
  const byStatus = { read: 0, reading: 0, unread: 0 }
  for (const r of rows) {
    if (r.status === 'read') byStatus.read++
    else if (r.status === 'reading') byStatus.reading++
    else byStatus.unread++
  }

  // Top authors
  const authorCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.author) authorCounts.set(r.author, (authorCounts.get(r.author) ?? 0) + 1)
  }
  const topAuthors = [...authorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }))

  // Languages
  const langCounts = new Map<string, number>()
  for (const r of rows) {
    if (r.language) langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1)
  }
  const languages = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }))

  // Genres (genres column is a JSON array on works)
  const genreCounts = new Map<string, number>()
  let uncategorizedGenreCount = 0
  for (const r of rows) {
    if (!r.genres) { uncategorizedGenreCount++; continue }
    let parsed: unknown
    try { parsed = JSON.parse(r.genres) } catch { uncategorizedGenreCount++; continue }
    if (!Array.isArray(parsed) || parsed.length === 0) { uncategorizedGenreCount++; continue }
    for (const g of parsed) {
      if (typeof g === 'string') { const t = g.replace(/\b\w/g, c => c.toUpperCase()); genreCounts.set(t, (genreCounts.get(t) ?? 0) + 1) }
    }
  }
  const genres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([label, count]) => ({ label, count }))

  // Average pages
  const pageNums = rows.filter(r => r.pages != null && r.pages > 0).map(r => r.pages as number)
  const avgPages = pageNums.length > 0
    ? Math.round(pageNums.reduce((a, b) => a + b, 0) / pageNums.length)
    : null

  // Publication year stats
  const years = rows.map(extractYear).filter((y): y is number => y !== null).sort((a, b) => a - b)
  const yearKnownCount = years.length
  const medianYear = yearKnownCount > 0 ? years[Math.floor(yearKnownCount / 2)] : null

  let richestCentury: number | null = null
  if (years.length > 0) {
    const centuryCounts = new Map<number, number>()
    for (const y of years) {
      const century = Math.floor(y / 100) + 1
      centuryCounts.set(century, (centuryCounts.get(century) ?? 0) + 1)
    }
    richestCentury = [...centuryCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }

  return c.json({
    total: rows.length,
    byStatus,
    genres,
    uncategorizedGenreCount,
    languages,
    languageCount: languages.length,
    topAuthors,
    avgPages,
    medianYear,
    richestCentury,
    yearKnownCount,
  })
})

export default stats
