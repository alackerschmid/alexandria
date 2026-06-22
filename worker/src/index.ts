import { Hono } from 'hono'
import { cors } from 'hono/cors'
import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  CORS_ORIGIN?: string
  GOOGLE_BOOKS_API_KEY: string
}

type Variables = {
  userId: number
}

const app = new Hono<{ Bindings: Bindings, Variables: Variables }>()

app.use('/api/*', async (c, next) => {
  const origin = c.env.CORS_ORIGIN ?? '*'
  return cors({
    origin,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Type'],
  })(c, next)
})

// ── Auth ──────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/

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
  return c.json({ token, email, firstname: null }, 201)
})

app.post('/api/auth/login', async (c) => {
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

async function signToken(userId: number, secret: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret))
}

// ── Auth middleware ─────────────────────────────────────────────────────────

const authMiddleware = async (c: any, next: any) => {
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
  } catch {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}

app.patch('/api/auth/me', authMiddleware, async (c) => {
  const { firstname } = await c.req.json()
  const trimmed = typeof firstname === 'string' ? firstname.trim() : ''
  if (!trimmed) return c.json({ error: 'A valid first name is required' }, 400)

  await c.env.DB
    .prepare('UPDATE users SET firstname = ? WHERE id = ?')
    .bind(trimmed, c.get('userId'))
    .run()

  return c.json({ firstname: trimmed })
})

app.use('/api/scans/*', authMiddleware)

// Public guest lookup — no auth. Registered before authMiddleware so it is not gated.
// Enrichment is intentionally NOT triggered here to avoid anonymous traffic driving Wikidata
// load; the work gets enriched when an authenticated user looks it up or scans it.
app.get('/api/books/guest-lookup', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!book) return c.json({ notFound: true }, 404)
  return c.json(book)
})

// Public sample of random catalogued books — powers the marketing preview. No auth.
app.get('/api/books/sample', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '3'), 12)
  const db = c.env.DB

  const { results } = await db
    .prepare(
      'SELECT title, author, cover_url FROM books WHERE title IS NOT NULL AND cover_url IS NOT NULL ORDER BY RANDOM() LIMIT ?'
    )
    .bind(limit)
    .all<{ title: string, author: string | null, cover_url: string | null }>()

  const total = await db
    .prepare('SELECT COUNT(*) AS n FROM books WHERE title IS NOT NULL')
    .first<{ n: number }>()

  return c.json({ books: results, total: total?.n ?? results.length })
})

app.use('/api/books/*', authMiddleware)
app.use('/api/field-definitions/*', authMiddleware)
app.use('/api/works/*', authMiddleware)
app.use('/api/series/*', authMiddleware)

// ── Books ─────────────────────────────────────────────────────────────────────

type BookRow = {
  id: number
  isbn: string
  title: string | null
  author: string | null
  cover_url: string | null
  language: string | null
  publish_date: string | null
  number_of_pages_median: number | null
  description: string | null
  publisher: string | null
  fetched_at: string
  work_id: number | null
}

type WorkRow = {
  id: number
  match_key: string | null
  wikidata_qid: string | null
  canonical_title: string | null
  original_language: string | null
  series_checked_at: string | null
  enrichment_failed_at: string | null
  genres: string | null
  original_pub_date: string | null
  awards: string | null
  nominations: string | null
}

type BookMetadata = {
  title: string | null
  author: string | null
  cover_url: string | null
  language: string | null
  publish_date: string | null
  number_of_pages_median: number | null
  description: string | null
  publisher: string | null
}

async function fetchFromGoogleBooks(isbn: string, apiKey: string): Promise<BookMetadata | null> {
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${apiKey}`
  )
  const data: any = await res.json()
  const info = data.items?.[0]?.volumeInfo
  if (!info) return null
  return {
    title: info.title ?? null,
    author: info.authors?.join(', ') ?? null,
    cover_url: info.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
    language: info.language ?? null,
    publish_date: info.publishedDate ?? null,
    number_of_pages_median: info.pageCount ?? null,
    description: info.description ?? null,
    publisher: info.publisher ?? null,
  }
}

async function fetchFromOpenLibrary(isbn: string): Promise<BookMetadata | null> {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
  )
  const data: any = await res.json()
  const book = data[`ISBN:${isbn}`]
  if (!book) return null
  return {
    title: book.title ?? null,
    author: book.authors?.[0]?.name ?? null,
    cover_url: book.cover?.large ?? book.cover?.medium ?? null,
    language: null,
    publish_date: book.publish_date ?? null,
    number_of_pages_median: book.number_of_pages ?? null,
    description: typeof book.description === 'string'
      ? book.description
      : book.description?.value ?? null,
    publisher: book.publishers?.[0]?.name ?? null,
  }
}

// Tries Google Books first, then OpenLibrary. Returns null if neither has the book.
async function fetchBookMetadata(isbn: string, googleApiKey?: string): Promise<BookMetadata | null> {
  if (googleApiKey) {
    try {
      const result = await fetchFromGoogleBooks(isbn, googleApiKey)
      if (result) return result
    } catch {}
  }
  try {
    return await fetchFromOpenLibrary(isbn)
  } catch {}
  return null
}

// ── Work / author resolution ────────────────────────────────────────────────

function normalizeStr(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '') // strip combining diacritics
    .replace(/\s+/g, ' ')
    .trim()
}

// Google Books joins multiple authors with ', '; OpenLibrary stores a single name.
function splitAuthors(author: string | null): string[] {
  return (author ?? '').split(',').map(a => a.trim()).filter(Boolean)
}

// Resolve (or create) the work this edition belongs to, plus its normalized authors.
// Same-language editions sharing title+author collapse to one work synchronously;
// cross-language editions merge later via wikidata_qid (see enrichWork).
async function linkWork(db: D1Database, book: BookRow): Promise<void> {
  const authors = splitAuthors(book.author)
  const titlePart = normalizeStr(book.title) || `isbn:${book.isbn}`
  const matchKey = `${titlePart}|${normalizeStr(authors[0])}`

  await db.prepare('INSERT OR IGNORE INTO works (match_key, canonical_title, original_language) VALUES (?, ?, ?)')
    .bind(matchKey, book.title, book.language)
.run()
  const work = await db.prepare('SELECT id FROM works WHERE match_key = ?').bind(matchKey).first<{ id: number }>()
  if (!work) return

  const stmts = [db.prepare('UPDATE books SET work_id = ? WHERE id = ?').bind(work.id, book.id)]
  for (const name of authors) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO authors (normalized_name, name) VALUES (?, ?)').bind(normalizeStr(name), name))
  }
  await db.batch(stmts)

  if (authors.length) {
    const links = authors.map(name =>
      db.prepare('INSERT OR IGNORE INTO work_authors (work_id, author_id) SELECT ?, id FROM authors WHERE normalized_name = ?')
        .bind(work.id, normalizeStr(name)))
    await db.batch(links)
  }
  book.work_id = work.id
}

// Returns the books row, creating it (and its work/author links) if missing.
// Centralizes the fetch-metadata → INSERT → re-SELECT flow shared by lookup/guest-lookup/scans.
// When metadata isn't found: returns null unless allowEmpty (POST /api/scans needs a row to
// exist so an offline-queued scan never fails just because the book couldn't be resolved).
async function resolveEdition(db: D1Database, isbn: string, apiKey?: string, allowEmpty = false): Promise<BookRow | null> {
  let book = await db.prepare('SELECT * FROM books WHERE isbn = ?').bind(isbn).first<BookRow>()
  if (book) {
    if (!book.work_id) await linkWork(db, book)
    return book
  }

  const fetched = await fetchBookMetadata(isbn, apiKey)
  if (!fetched && !allowEmpty) return null
  const meta = fetched ?? {
    title: null, author: null, cover_url: null, language: null,
    publish_date: null, number_of_pages_median: null, description: null, publisher: null,
  }

  await db.prepare(`INSERT OR IGNORE INTO books
      (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(isbn, meta.title, meta.author, meta.cover_url, meta.language,
          meta.publish_date, meta.number_of_pages_median, meta.description, meta.publisher)
.run()

  book = await db.prepare('SELECT * FROM books WHERE isbn = ?').bind(isbn).first<BookRow>()
  if (book && !book.work_id) await linkWork(db, book)
  return book
}

// ── Wikidata enrichment ──────────────────────────────────────────────────────
// Resolves a work to its Wikidata QID + series membership and populates the catalog.
// See wikidata-series-lookup.md. Always best-effort; safe to call from waitUntil.

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql'
const WIKIDATA_UA = 'BookScan/1.0 (https://bookscan.pages.dev; contact@bookscan.pages.dev)'

function escapeSparql(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, String.raw`\"`).replace(/\n/g, '\\n').replace(/\r/g, '\\r')
}

function qidFromUri(uri: string | undefined): string | null {
  return uri ? (uri.split('/').pop() ?? null) : null
}

function parseOrdinal(v: string | undefined): number | null {
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v) : null
}

// Returns [] when the query succeeds but has no results.
// Throws on network errors, timeouts, or HTTP errors — callers should let this propagate
// so enrichWork's catch block can set enrichment_failed_at (retryable) rather than
// treating the failure as a permanent "not found" (which would set series_checked_at).
async function runSparql(query: string, timeoutMs = 25_000): Promise<any[]> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
  console.log('[SPARQL] Running query:', query.replace(/\s+/g, ' ').trim().slice(0, 200))
  const once = async () => {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      return await fetch(url, {
        headers: { 'User-Agent': WIKIDATA_UA, Accept: 'application/sparql-results+json' },
        signal: ctrl.signal,
      })
    } finally { clearTimeout(t) }
  }
  let res = await once()
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After')) || 5
    console.warn(`[SPARQL] Rate limited (HTTP 429), retrying after ${retry}s`)
    await new Promise(r => setTimeout(r, Math.min(retry, 10) * 1000))
    res = await once()
  }
  if (!res.ok) throw new Error(`[SPARQL] HTTP ${res.status} ${res.statusText}`)
  const data: any = await res.json()
  const rows: any[] = data?.results?.bindings ?? []
  console.log(`[SPARQL] Got ${rows.length} rows`)
  return rows
}

type SeriesHit = { seriesQid: string; ordinal: number | null; nameEn: string | null; nameDe: string | null }

// Title (+ optional author) → matched work QID and its primary series, if any.
async function fetchBookInfo(title: string, author: string): Promise<{ workQid: string; series: SeriesHit | null } | null> {
  const authorBlock = author
    ? `SERVICE wikibase:mwapi {
         bd:serviceParam wikibase:api "Search"; wikibase:endpoint "www.wikidata.org";
                          mwapi:srsearch "${escapeSparql(author)} haswbstatement:P31=Q5".
         ?author wikibase:apiOutputItem mwapi:title.
       }
       ?work wdt:P50 ?author.`
    : ''
  const query = `
    SELECT ?work ?series ?ordinal ?seriesLabelEn ?seriesLabelDe WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:api "Search"; wikibase:endpoint "www.wikidata.org";
                         mwapi:srsearch "${escapeSparql(title)}".
        ?work wikibase:apiOutputItem mwapi:title.
      }
      ?work wdt:P31/wdt:P279* wd:Q47461344.
      ${authorBlock}
      OPTIONAL {
        ?work p:P179 ?seriesStmt.
        ?seriesStmt ps:P179 ?series.
        OPTIONAL { ?seriesStmt pq:P1545 ?ordinal. }
        OPTIONAL { ?series rdfs:label ?seriesLabelEn. FILTER(LANG(?seriesLabelEn) = "en") }
        OPTIONAL { ?series rdfs:label ?seriesLabelDe. FILTER(LANG(?seriesLabelDe) = "de") }
      }
    } LIMIT 10`.trim()

  console.log('[fetchBookInfo] querying Wikidata for:', { title, author })
  const rows = await runSparql(query)
  if (!rows.length) {
    console.log('[fetchBookInfo] no rows returned')
    return null
  }
  const workQid = qidFromUri(rows[0].work?.value)
  if (!workQid) {
    console.log('[fetchBookInfo] first row has no work URI:', rows[0])
    return null
  }
  console.log('[fetchBookInfo] workQid =', workQid)

  const withSeries = rows.find(r => r.series?.value)
  let series: SeriesHit | null = null
  if (withSeries) {
    const seriesQid = qidFromUri(withSeries.series.value)
    if (seriesQid) {
      series = {
        seriesQid,
        ordinal: parseOrdinal(withSeries.ordinal?.value),
        nameEn: withSeries.seriesLabelEn?.value ?? null,
        nameDe: withSeries.seriesLabelDe?.value ?? null,
      }
      console.log('[fetchBookInfo] series:', series)
    }
  } else {
    console.log('[fetchBookInfo] no series found in results')
  }
  return { workQid, series }
}

type WorkDetails = {
  genres: string[]
  originalPubDate: string | null
  awards: string[]
  nominations: string[]
}

// Fetches genres, original publication year, awards and nominations for a known Wikidata QID.
// Uses subqueries per property to avoid a cartesian-product explosion when a work has many values.
async function fetchWorkDetails(workQid: string): Promise<WorkDetails> {
  const empty: WorkDetails = { genres: [], originalPubDate: null, awards: [], nominations: [] }
  if (!/^Q\d+$/.test(workQid)) {
    console.warn('[fetchWorkDetails] invalid QID:', workQid)
    return empty
  }
  console.log('[fetchWorkDetails] fetching details for', workQid)
  const query = `
    SELECT ?genres ?originalPubDate ?awards ?nominations WHERE {
      { SELECT (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres) WHERE {
          OPTIONAL { wd:${workQid} wdt:P136 ?genre.
                     ?genre rdfs:label ?genreLabel. FILTER(LANG(?genreLabel) = "en") } } }
      { SELECT (MIN(STR(?pubDate)) AS ?originalPubDate) WHERE {
          OPTIONAL { wd:${workQid} wdt:P577 ?pubDate. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?awardLabel; separator="|") AS ?awards) WHERE {
          OPTIONAL { wd:${workQid} wdt:P166 ?award.
                     ?award rdfs:label ?awardLabel. FILTER(LANG(?awardLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?nominationLabel; separator="|") AS ?nominations) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1411 ?nomination.
                     ?nomination rdfs:label ?nominationLabel. FILTER(LANG(?nominationLabel) = "en") } } }
    }`.trim()
  const rows = await runSparql(query)
  const row = rows[0]
  console.log('[fetchWorkDetails] raw row:', JSON.stringify(row ?? null))
  const splitPipe = (v: string | undefined) => (v ? v.split('|').filter(Boolean) : [])
  const yearFrom = (v: string | undefined) => {
    if (!v) return null
    const m = v.match(/(\d{4})/)
    return m ? m[1] : null
  }
  const result: WorkDetails = {
    genres: splitPipe(row?.genres?.value),
    originalPubDate: yearFrom(row?.originalPubDate?.value),
    awards: splitPipe(row?.awards?.value),
    nominations: splitPipe(row?.nominations?.value),
  }
  console.log('[fetchWorkDetails] parsed:', {
    genres: result.genres,
    originalPubDate: result.originalPubDate,
    awards: result.awards.length,
    nominations: result.nominations.length,
  })
  return result
}

// All member works of a series (for completeness), with ordinals + English titles.
async function fetchSeriesMembers(seriesQid: string): Promise<{ qid: string; ordinal: number | null; title: string | null }[]> {
  const query = `
    SELECT ?work ?ordinal ?label WHERE {
      ?work p:P179 ?st.
      ?st ps:P179 wd:${seriesQid}.
      OPTIONAL { ?st pq:P1545 ?ordinal. }
      OPTIONAL { ?work rdfs:label ?label. FILTER(LANG(?label) = "en") }
    } LIMIT 200`.trim()
  const rows = await runSparql(query)
  const out: { qid: string; ordinal: number | null; title: string | null }[] = []
  for (const r of rows) {
    const qid = qidFromUri(r.work?.value)
    if (qid) out.push({ qid, ordinal: parseOrdinal(r.ordinal?.value), title: r.label?.value ?? null })
  }
  return out
}

// Repoint everything from a match-key work onto the canonical QID work, then drop the dup.
async function mergeWorks(db: D1Database, from: number, into: number): Promise<void> {
  await db.batch([
    db.prepare('UPDATE books SET work_id = ? WHERE work_id = ?').bind(into, from),
    db.prepare('INSERT OR IGNORE INTO work_authors (work_id, author_id) SELECT ?, author_id FROM work_authors WHERE work_id = ?').bind(into, from),
    db.prepare('DELETE FROM work_authors WHERE work_id = ?').bind(from),
    db.prepare('INSERT OR IGNORE INTO work_series (work_id, series_id, ordinal) SELECT ?, series_id, ordinal FROM work_series WHERE work_id = ?').bind(into, from),
    db.prepare('DELETE FROM work_series WHERE work_id = ?').bind(from),
    db.prepare('DELETE FROM works WHERE id = ?').bind(from),
  ])
}

async function upsertSeries(db: D1Database, workId: number, hit: SeriesHit): Promise<number | null> {
  await db.prepare('INSERT OR IGNORE INTO series (wikidata_qid, canonical_name) VALUES (?, ?)')
    .bind(hit.seriesQid, hit.nameEn ?? hit.nameDe ?? null)
.run()
  const series = await db.prepare('SELECT id FROM series WHERE wikidata_qid = ?').bind(hit.seriesQid).first<{ id: number }>()
  if (!series) return null

  const stmts = [
    db.prepare('INSERT OR REPLACE INTO work_series (work_id, series_id, ordinal) VALUES (?, ?, ?)').bind(workId, series.id, hit.ordinal),
  ]
  if (hit.nameEn) stmts.push(db.prepare('INSERT OR REPLACE INTO series_names (series_id, language, name) VALUES (?, ?, ?)').bind(series.id, 'en', hit.nameEn))
  if (hit.nameDe) stmts.push(db.prepare('INSERT OR REPLACE INTO series_names (series_id, language, name) VALUES (?, ?, ?)').bind(series.id, 'de', hit.nameDe))
  await db.batch(stmts)
  return series.id
}

// Placeholder works (wikidata_qid set, no edition) so completeness reflects unscanned entries.
// When a real edition is later scanned, enrichWork merges its match-key work into the placeholder.
async function populateSeriesMembers(db: D1Database, seriesId: number, seriesQid: string): Promise<void> {
  const members = await fetchSeriesMembers(seriesQid)
  if (!members.length) return
  await db.batch(members.map(m =>
    db.prepare('INSERT OR IGNORE INTO works (wikidata_qid, canonical_title) VALUES (?, ?)').bind(m.qid, m.title)))
  await db.batch(members.map(m =>
    db.prepare('INSERT OR IGNORE INTO work_series (work_id, series_id, ordinal) SELECT id, ?, ? FROM works WHERE wikidata_qid = ?')
      .bind(seriesId, m.ordinal, m.qid)))
}

// Best-effort enrichment for a work. Negative-cached via works.series_checked_at unless force=true.
async function enrichWork(db: D1Database, workId: number, force = false): Promise<void> {
  let canonicalId = workId
  try {
    console.log(`[enrichWork] start workId=${workId} force=${force}`)
    const w = await db.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first<WorkRow>()
    if (!w) { console.warn(`[enrichWork] work ${workId} not found`); return }
    if (w.series_checked_at && !force) { console.log(`[enrichWork] already enriched (series_checked_at=${w.series_checked_at}), skipping`); return }
    // Clear series_checked_at so the enrichment poll sees 'pending' while we run SPARQL.
    if (force) await db.prepare('UPDATE works SET series_checked_at = NULL WHERE id = ?').bind(workId).run()

    const ed = await db.prepare('SELECT title, author FROM books WHERE work_id = ? AND title IS NOT NULL LIMIT 1')
      .bind(workId)
      .first<{ title: string | null; author: string | null }>()
    const title = ed?.title ?? w.canonical_title
    if (!title) {
      console.warn(`[enrichWork] no title for work ${workId}, marking done`)
      await db.prepare("UPDATE works SET series_checked_at = datetime('now'), enrichment_failed_at = NULL WHERE id = ?").bind(workId).run()
      return
    }
    const author = splitAuthors(ed?.author ?? null)[0] ?? ''
    console.log(`[enrichWork] looking up: title="${title}" author="${author}"`)

    const info = await fetchBookInfo(title, author)
    console.log(`[enrichWork] fetchBookInfo result: workQid=${info?.workQid ?? 'null'} seriesQid=${info?.series?.seriesQid ?? 'null'}`)

    let details: WorkDetails | null = null
    if (info?.workQid) {
      const existing = await db.prepare('SELECT id FROM works WHERE wikidata_qid = ? AND id != ?')
        .bind(info.workQid, workId)
        .first<{ id: number }>()
      if (existing) {
        console.log(`[enrichWork] QID ${info.workQid} already on work ${existing.id}, merging ${workId} → ${existing.id}`)
        await mergeWorks(db, workId, existing.id)
        canonicalId = existing.id
      } else {
        console.log(`[enrichWork] assigning QID ${info.workQid} to work ${workId}`)
        await db.prepare('UPDATE works SET wikidata_qid = ? WHERE id = ?').bind(info.workQid, workId).run()
      }

      if (info.series) {
        console.log(`[enrichWork] upserting series ${info.series.seriesQid} for work ${canonicalId}`)
        const seriesId = await upsertSeries(db, canonicalId, info.series)
        console.log(`[enrichWork] seriesId=${seriesId}`)
        if (seriesId) await populateSeriesMembers(db, seriesId, info.series.seriesQid)
      }
      details = await fetchWorkDetails(info.workQid)
    } else {
      console.log(`[enrichWork] no Wikidata match found, will store nulls`)
    }

    const genresJson   = details?.genres.length      ? JSON.stringify(details.genres)      : null
    const awardsJson   = details?.awards.length       ? JSON.stringify(details.awards)      : null
    const nominJson    = details?.nominations.length  ? JSON.stringify(details.nominations) : null
    const pubDate      = details?.originalPubDate ?? null
    console.log(`[enrichWork] writing to works id=${canonicalId}:`, { genresJson, pubDate, awardsJson, nominJson })

    const updateResult = await db.prepare(`
      UPDATE works SET
        series_checked_at  = datetime('now'),
        enrichment_failed_at = NULL,
        genres             = ?,
        original_pub_date  = ?,
        awards             = ?,
        nominations        = ?
      WHERE id = ?`)
      .bind(genresJson, pubDate, awardsJson, nominJson, canonicalId)
      .run()
    console.log(`[enrichWork] UPDATE result: changes=${updateResult.meta.changes}`)
  } catch (e) {
    console.error('[enrichWork] failed for work', workId, e)
    try {
      await db.prepare("UPDATE works SET enrichment_failed_at = datetime('now') WHERE id = ?").bind(canonicalId).run()
    } catch {}
  }
}

// Book metadata lookup — checks DB cache first, then Google Books, then OpenLibrary.
app.get('/api/books/lookup', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const book = await resolveEdition(c.env.DB, isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!book) return c.json({ error: 'Book not found' }, 404)
  if (book.work_id) c.executionCtx.waitUntil(enrichWork(c.env.DB, book.work_id))
  return c.json(book)
})

// Refresh book metadata — tries Google Books then OpenLibrary, fills NULL fields only.
app.post('/api/books/refresh', async (c) => {
  const isbn = c.req.query('isbn')
  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const bookData = await fetchBookMetadata(isbn, c.env.GOOGLE_BOOKS_API_KEY)
  if (!bookData) return c.json({ error: 'Book not found in any source' }, 404)

  await c.env.DB
    .prepare(`
      UPDATE books SET
        title = COALESCE(title, ?),
        author = COALESCE(author, ?),
        cover_url = COALESCE(cover_url, ?),
        language = COALESCE(language, ?),
        publish_date = COALESCE(publish_date, ?),
        number_of_pages_median = COALESCE(number_of_pages_median, ?),
        description = COALESCE(description, ?),
        publisher = COALESCE(publisher, ?)
      WHERE isbn = ?
    `)
    .bind(
      bookData.title, bookData.author, bookData.cover_url, bookData.language,
      bookData.publish_date, bookData.number_of_pages_median,
      bookData.description, bookData.publisher,
      isbn
    )
    .run()

  const book = await c.env.DB
    .prepare('SELECT * FROM books WHERE isbn = ?')
    .bind(isbn)
    .first<BookRow>()

  if (!book) return c.json({ error: 'Book not found' }, 404)
  if (!book.work_id) await linkWork(c.env.DB, book)
  // Manual refresh doubles as the enrichment retry path (no cron sweeper): force a re-check.
  if (book.work_id) c.executionCtx.waitUntil(enrichWork(c.env.DB, book.work_id, true))
  return c.json(book)
})

// ── Book overrides ────────────────────────────────────────────────────────────

function getBookByIsbn(db: D1Database, isbn: string) {
  return db.prepare('SELECT id FROM books WHERE isbn = ?').bind(isbn).first<{ id: number }>()
}

// author is intentionally excluded — authors are managed via the works/authors model, not per-user overrides.
const OVERRIDE_FIELDS = ['title', 'cover_url', 'language', 'publish_date', 'number_of_pages_median', 'description', 'publisher'] as const
type OverrideField = typeof OVERRIDE_FIELDS[number]

app.patch('/api/books/override', async (c) => {
  const userId = c.get('userId')
  const { isbn, changes } = await c.req.json<{ isbn: string; changes: Partial<Record<OverrideField, string | number | null>> }>()

  if (!isbn) return c.json({ error: 'ISBN required' }, 400)

  const validFields = Object.keys(changes ?? {}).filter(f => (OVERRIDE_FIELDS as readonly string[]).includes(f)) as OverrideField[]
  if (!validFields.length) return c.json({ ok: true })

  const book = await getBookByIsbn(c.env.DB, isbn)
  if (!book) return c.json({ error: 'Book not found' }, 404)

  const values = validFields.map(f => changes[f] ?? null)
  const cols = validFields.join(', ')
  const placeholders = validFields.map(() => '?').join(', ')
  const setClauses = validFields.map(f => `${f} = excluded.${f}`).join(', ')

  await c.env.DB
    .prepare(`
      INSERT INTO book_overrides (user_id, book_id, ${cols})
      VALUES (?, ?, ${placeholders})
      ON CONFLICT(user_id, book_id) DO UPDATE SET
        ${setClauses},
        updated_at = datetime('now')
    `)
    .bind(userId, book.id, ...values)
    .run()

  return c.json({ ok: true })
})

app.patch('/api/books/custom-fields', async (c) => {
  const userId = c.get('userId')
  const body = await c.req.json<{ isbn: string; values: Array<{ field_def_id: number; value: string }> }>()
  if (!body.isbn) return c.json({ error: 'ISBN required' }, 400)

  const [book, { results: ownedDefs }] = await Promise.all([
    getBookByIsbn(c.env.DB, body.isbn),
    c.env.DB.prepare('SELECT id FROM user_field_definitions WHERE user_id = ?').bind(userId).all<{ id: number }>(),
  ])
  if (!book) return c.json({ error: 'Book not found' }, 404)

  const validIds = new Set(ownedDefs.map(d => d.id))
  const values = (body.values ?? []).filter(v => validIds.has(v.field_def_id))

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?').bind(userId, book.id),
    ...values.map(v =>
      c.env.DB.prepare('INSERT INTO book_custom_fields (user_id, book_id, field_def_id, field_value) VALUES (?, ?, ?, ?)')
        .bind(userId, book.id, v.field_def_id, (v.value ?? '').trim() || null)
    ),
  ])

  return c.json({ ok: true })
})

// ── Field definitions ──────────────────────────────────────────────────────────

app.get('/api/field-definitions', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB
    .prepare('SELECT id, field_name AS name, field_type AS type, field_options AS options, sort_order FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
    .bind(userId)
    .all()
  return c.json(results)
})

app.post('/api/field-definitions', async (c) => {
  const userId = c.get('userId')
  const { name, type = 'text' } = await c.req.json<{ name: string; type?: string }>()
  if (!name?.trim()) return c.json({ error: 'Name required' }, 400)
  const VALID_TYPES = ['text', 'integer', 'select']
  if (!VALID_TYPES.includes(type)) return c.json({ error: 'Invalid type' }, 400)

  const maxOrder = await c.env.DB
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM user_field_definitions WHERE user_id = ?')
    .bind(userId)
    .first<{ max_order: number }>()

  try {
    const result = await c.env.DB
      .prepare('INSERT INTO user_field_definitions (user_id, field_name, field_type, sort_order) VALUES (?, ?, ?, ?)')
      .bind(userId, name.trim(), type, (maxOrder?.max_order ?? -1) + 1)
      .run()
    return c.json({ id: result.meta.last_row_id, name: name.trim(), type, sort_order: (maxOrder?.max_order ?? -1) + 1 }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) return c.json({ error: 'A field with that name already exists' }, 409)
    return c.json({ error: 'Failed to create field' }, 500)
  }
})

app.delete('/api/field-definitions/:id', async (c) => {
  const userId = c.get('userId')
  const result = await c.env.DB
    .prepare('DELETE FROM user_field_definitions WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), userId)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

// ── Scans ─────────────────────────────────────────────────────────────────────

const SORT_CLAUSES: Record<string, string> = {
  date_desc: 's.created_at DESC',
  date_asc: 's.created_at ASC',
  title_asc: 'COALESCE(b.title, b.isbn) ASC COLLATE NOCASE',
  title_desc: 'COALESCE(b.title, b.isbn) DESC COLLATE NOCASE',
  author_asc: "COALESCE(b.author, '') ASC COLLATE NOCASE",
  author_desc: "COALESCE(b.author, '') DESC COLLATE NOCASE",
  series_asc: 'series_name IS NULL, series_name ASC COLLATE NOCASE, ws.ordinal ASC',
}

// book_id is included here solely for custom-field merging in JS; it is stripped before the response.
// The single `?` placeholder (series_names.language) must be bound FIRST, before any WHERE params.
// `ws` collapses a work's series to its lowest-ordinal one via SQLite's min()/bare-column rule,
// so a work in multiple series never multiplies scan rows (list view shows the primary series).
const SCAN_SELECT = `
  SELECT s.id, s.status, s.created_at,
         b.id   AS book_id,
         b.isbn,
         b.work_id                                           AS work_id,
         COALESCE(o.title, b.title)                          AS title,
         b.author                                            AS author,
         COALESCE(o.cover_url, b.cover_url)                  AS cover_url,
         COALESCE(o.language, b.language)                    AS language,
         COALESCE(o.publish_date, b.publish_date)            AS publish_date,
         COALESCE(o.number_of_pages_median, b.number_of_pages_median) AS number_of_pages_median,
         COALESCE(o.description, b.description)              AS description,
         COALESCE(o.publisher, b.publisher)                  AS publisher,
         ws.series_id                                        AS series_id,
         COALESCE(sn.name, sr.canonical_name)                AS series_name,
         ws.ordinal                                          AS series_ordinal,
         (SELECT COUNT(*) FROM work_series x WHERE x.series_id = ws.series_id) AS series_total,
         CASE
           WHEN b.work_id IS NULL                         THEN 'pending'
           WHEN wk.enrichment_failed_at IS NOT NULL       THEN 'failed'
           WHEN wk.series_checked_at IS NOT NULL          THEN 'done'
           ELSE                                                'pending'
         END                                                 AS enrichment_status,
         wk.genres                                          AS genres,
         wk.original_pub_date                              AS original_pub_date,
         wk.awards                                         AS awards,
         wk.nominations                                    AS nominations,
         (o.title IS NOT NULL)                               AS title_overridden,
         (o.cover_url IS NOT NULL)                           AS cover_url_overridden,
         (o.language IS NOT NULL)                            AS language_overridden,
         (o.publish_date IS NOT NULL)                        AS publish_date_overridden,
         (o.number_of_pages_median IS NOT NULL)              AS pages_overridden,
         (o.description IS NOT NULL)                         AS description_overridden,
         (o.publisher IS NOT NULL)                           AS publisher_overridden
  FROM scans s
  JOIN books b ON s.book_id = b.id
  LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
  LEFT JOIN works wk ON wk.id = b.work_id
  LEFT JOIN (
    SELECT work_id, series_id, MIN(ordinal) AS ordinal
    FROM work_series GROUP BY work_id
  ) ws ON ws.work_id = b.work_id
  LEFT JOIN series sr ON sr.id = ws.series_id
  LEFT JOIN series_names sn ON sn.series_id = sr.id AND sn.language = ?`

async function fetchCustomFields(db: D1Database, userId: number, bookIds: number[]) {
  if (!bookIds.length) return { defs: [], valuesByBook: new Map<number, Map<number, string | null>>() }
  const placeholders = bookIds.map(() => '?').join(',')
  const [{ results: defs }, { results: rawValues }] = await Promise.all([
    db.prepare('SELECT id, field_name AS name, field_type AS type FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
      .bind(userId)
.all<{ id: number; name: string; type: string }>(),
    db.prepare(`SELECT book_id, field_def_id, field_value FROM book_custom_fields WHERE user_id = ? AND book_id IN (${placeholders})`)
      .bind(userId, ...bookIds)
.all<{ book_id: number; field_def_id: number; field_value: string | null }>(),
  ])
  const valuesByBook = new Map<number, Map<number, string | null>>()
  for (const v of rawValues) {
    if (!valuesByBook.has(v.book_id)) valuesByBook.set(v.book_id, new Map())
    valuesByBook.get(v.book_id)!.set(v.field_def_id, v.field_value)
  }
  return { defs, valuesByBook }
}

function attachCustomFields(
  row: any,
  defs: { id: number; name: string; type: string }[],
  valuesByBook: Map<number, Map<number, string | null>>,
) {
  const { book_id, ...rest } = row
  const bookVals = valuesByBook.get(book_id)
  return {
    ...rest,
    genres:      rest.genres      ? JSON.parse(rest.genres)      : null,
    awards:      rest.awards      ? JSON.parse(rest.awards)      : null,
    nominations: rest.nominations ? JSON.parse(rest.nominations) : null,
    custom_field_values: defs.map(d => ({ field_def_id: d.id, value: bookVals?.get(d.id) ?? null })),
  }
}

const VALID_STATUSES = ['unread', 'reading', 'read'] as const

app.get('/api/scans', async (c) => {
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

app.post('/api/scans', async (c) => {
  const { isbn } = await c.req.json()
  if (!isbn) return c.json({ error: 'ISBN is required' }, 400)

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
      .prepare('INSERT INTO scans (user_id, book_id) VALUES (?, ?)')
      .bind(userId, book.id)
      .run()
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint failed')) {
      return c.json({ error: 'Already in your list' }, 409)
    }
    console.error('[POST /api/scans] scan INSERT failed:', e)
    return c.json({ error: 'Failed to save scan' }, 500)
  }

  if (book.work_id) c.executionCtx.waitUntil(enrichWork(db, book.work_id))

  const saved = await db
    .prepare(`${SCAN_SELECT} WHERE s.id = ?`)
    .bind(locale, result.meta.last_row_id)
    .first<any>()

  const { defs, valuesByBook } = await fetchCustomFields(db, userId, saved ? [saved.book_id] : [])

  return c.json(saved ? attachCustomFields(saved, defs, valuesByBook) : {}, 201)
})

// Single scan — used by BookDetail to poll enrichment_status after a scan.
app.get('/api/scans/:id', async (c) => {
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

app.patch('/api/scans/:id', async (c) => {
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

app.delete('/api/scans/:id', async (c) => {
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

// ── Works & series ──────────────────────────────────────────────────────────

// Other editions of the same work; scan_id != null marks the ones the user owns.
app.get('/api/works/:workId/editions', async (c) => {
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
app.get('/api/series/:seriesId', async (c) => {
  const userId = c.get('userId')
  const seriesId = c.req.param('seriesId')
  const locale = c.req.query('locale') ?? 'en'

  const series = await c.env.DB.prepare(`
    SELECT s.id, COALESCE(sn.name, s.canonical_name) AS name
    FROM series s
    LEFT JOIN series_names sn ON sn.series_id = s.id AND sn.language = ?
    WHERE s.id = ?`)
    .bind(locale, seriesId)
    .first<{ id: number; name: string | null }>()
  if (!series) return c.json({ error: 'Series not found' }, 404)

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

  return c.json({ id: series.id, name: series.name, entries })
})

export default app
