import type { WorkRow, WorkDetails, SeriesHit } from './types'
import { splitAuthors, fetchBookMetadata } from './editions'

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

// A representative ISBN for a work QID (via its editions), preferring en/de editions.
// Many works have no edition/ISBN data in Wikidata — returns null in that case.
async function fetchWorkEditionIsbn(workQid: string): Promise<string | null> {
  if (!/^Q\d+$/.test(workQid)) return null
  const query = `
    SELECT ?isbn ?lang WHERE {
      wd:${workQid} wdt:P747 ?ed.
      { ?ed wdt:P212 ?isbn } UNION { ?ed wdt:P957 ?isbn }
      OPTIONAL { ?ed wdt:P407 ?l. ?l wdt:P218 ?lang }
    } LIMIT 20`.trim()
  const rows = await runSparql(query)
  if (!rows.length) return null
  const clean = (v: string | undefined) => (v ?? '').replace(/[-\s]/g, '')
  // Prefer an English, then German, then any edition.
  const pick = rows.find(r => r.lang?.value === 'en')
    ?? rows.find(r => r.lang?.value === 'de')
    ?? rows[0]
  const isbn = clean(pick.isbn?.value)
  return isbn || null
}

// Gives a placeholder/unowned work a real books row (with cover) so the series view shows it.
// No-op when the work already has a linked edition (a scanned book), to avoid duplicates.
async function backfillEdition(db: D1Database, workId: number, workQid: string, apiKey?: string): Promise<void> {
  const existing = await db.prepare('SELECT 1 FROM books WHERE work_id = ? LIMIT 1').bind(workId).first()
  if (existing) return

  const isbn = await fetchWorkEditionIsbn(workQid)
  if (!isbn) { console.log(`[backfillEdition] no ISBN for ${workQid} (work ${workId})`); return }

  const meta = await fetchBookMetadata(isbn, apiKey)
  if (!meta) { console.log(`[backfillEdition] no metadata for ISBN ${isbn}`); return }

  // Set work_id directly (bypasses linkWork, which would mint a competing match-key work).
  await db.prepare(`INSERT OR IGNORE INTO books
      (isbn, title, author, cover_url, language, publish_date, number_of_pages_median, description, publisher, work_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(isbn, meta.title, meta.author, meta.cover_url, meta.language,
          meta.publish_date, meta.number_of_pages_median, meta.description, meta.publisher, workId)
    .run()
  // If the ISBN row already existed unlinked (e.g. an earlier guest lookup), adopt it.
  await db.prepare('UPDATE books SET work_id = ? WHERE isbn = ? AND work_id IS NULL').bind(workId, isbn).run()
  console.log(`[backfillEdition] linked ISBN ${isbn} to work ${workId}`)
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
// apiKey (Google Books) is only needed when backfilling a cover edition for an unowned work.
export async function enrichWork(db: D1Database, workId: number, force = false, apiKey?: string): Promise<void> {
  let canonicalId = workId
  try {
    console.log(`[enrichWork] start workId=${workId} force=${force}`)
    const w = await db.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first<WorkRow>()
    if (!w) { console.warn(`[enrichWork] work ${workId} not found`); return }
    if (w.series_checked_at && !force) { console.log(`[enrichWork] already enriched (series_checked_at=${w.series_checked_at}), skipping`); return }
    // Clear series_checked_at so the enrichment poll sees 'pending' while we run SPARQL.
    if (force) await db.prepare('UPDATE works SET series_checked_at = NULL WHERE id = ?').bind(workId).run()

    let workQid: string | null = w.wikidata_qid
    let details: WorkDetails | null = null

    if (workQid) {
      // QID-first (placeholder series member, or force-refresh of an already-identified work):
      // we already know the work, so skip the title search, merge, and series repopulation.
      console.log(`[enrichWork] work ${workId} already has QID ${workQid}, fetching details directly`)
      details = await fetchWorkDetails(workQid)
    } else {
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

      if (info?.workQid) {
        workQid = info.workQid
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
    }

    // Give unowned/placeholder works a real edition (cover + ISBN) so the series view renders them.
    if (workQid) await backfillEdition(db, canonicalId, workQid, apiKey)

    const genresJson   = details?.genres.length      ? JSON.stringify(details.genres)      : null
    const awardsJson   = details?.awards.length       ? JSON.stringify(details.awards)      : null
    const nominJson    = details?.nominations.length  ? JSON.stringify(details.nominations) : null
    const pubDate      = details?.originalPubDate ?? null
    console.log(`[enrichWork] writing to works id=${canonicalId}:`, { genresJson, pubDate, awardsJson, nominJson })

    const updateResult = await db.prepare(`
      UPDATE works SET
        series_checked_at    = datetime('now'),
        enrichment_failed_at = NULL,
        enrichment_attempts  = 0,
        genres               = ?,
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
      await db.prepare("UPDATE works SET enrichment_failed_at = datetime('now'), enrichment_attempts = enrichment_attempts + 1 WHERE id = ?").bind(canonicalId).run()
    } catch {}
  }
}
