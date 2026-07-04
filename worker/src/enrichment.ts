import type { WorkRow, WorkDetails, SeriesHit } from './types'
import { splitAuthors, materializeEdition, normalizeStr, discoverEditionsFromOpenLibrary } from './editions'

// Bump this whenever fetchWorkDetails fetches new columns. The sweeper uses it to re-enrich
// works that were enriched with an older schema and are missing the new fields.
export const CURRENT_ENRICHMENT_SCHEMA_VERSION = 4

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql'
const WIKIDATA_UA = 'BookScan/1.0 (https://bookscan.pages.dev; contact@bookscan.pages.dev)'

export type FailureReason = 'timeout' | 'rate_limited' | 'http_5xx' | 'network' | 'other'

// Per-reason sweeper retry policy. Typed as Record<FailureReason, ...> so adding a new
// FailureReason value is a compile error here until a policy is assigned — the sweeper's SQL
// CASE (worker/src/sweeper.ts) is generated from this map, so the two can't drift apart silently.
//   - rate_limited: Wikidata is just asking us to slow down — retry soon (5 min), default cap.
//   - timeout: a work that repeatedly times out is unlikely to resolve quickly — wait longer
//     (60 min), tighter cap (3) so we don't keep spending subrequests on a consistently slow query.
//   - other: an unexpected HTTP status from Wikidata itself — usually a query bug, not transient —
//     tight cap (2) so we don't hammer a hopeless case.
//   - network / http_5xx: infrastructure-adjacent, not evidence of a hopeless work — default policy.
export const RETRY_POLICY: Record<FailureReason, { capAttempts: number; backoffMinutes: number }> = {
  rate_limited: { capAttempts: 5, backoffMinutes: 5 },
  timeout:      { capAttempts: 3, backoffMinutes: 60 },
  other:        { capAttempts: 2, backoffMinutes: 30 },
  http_5xx:     { capAttempts: 5, backoffMinutes: 30 },
  network:      { capAttempts: 5, backoffMinutes: 30 },
}
// Legacy rows enriched before enrichment_failure_reason existed (NULL reason).
export const DEFAULT_RETRY_POLICY = { capAttempts: 5, backoffMinutes: 30 }

// Thrown by runSparql with a classified `kind` so enrichWork's catch block can record *why*
// enrichment failed (enrichment_failure_reason) instead of lumping every failure together.
// Exported for unit testing classifyError below.
export class SparqlError extends Error {
  kind: FailureReason
  constructor(message: string, kind: FailureReason) {
    super(message)
    this.name = 'SparqlError'
    this.kind = kind
  }
}

// Only a SparqlError (thrown by runSparql) carries a real classification — an unexpected HTTP
// status from Wikidata itself is 'other' territory (usually a query bug). Anything else (a D1
// exception from mergeWorks/upsertSeries/populateSeriesMembers, etc.) is infrastructure-adjacent
// noise, not evidence of a hopeless work, so it gets the lenient default policy ('network') rather
// than 'other's tight 2-attempt cap.
export function classifyError(e: unknown): FailureReason {
  return e instanceof SparqlError ? e.kind : 'network'
}

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
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new SparqlError(`[SPARQL] timed out after ${timeoutMs}ms`, 'timeout')
      throw new SparqlError(`[SPARQL] network error: ${e?.message ?? e}`, 'network')
    } finally { clearTimeout(t) }
  }
  let res = await once()
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After')) || 5
    console.warn(`[SPARQL] Rate limited (HTTP 429), retrying after ${retry}s`)
    await new Promise(r => setTimeout(r, Math.min(retry, 10) * 1000))
    res = await once()
  }
  if (!res.ok) {
    const kind: FailureReason = res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'http_5xx' : 'other'
    throw new SparqlError(`[SPARQL] HTTP ${res.status} ${res.statusText}`, kind)
  }
  const data: any = await res.json()
  const rows: any[] = data?.results?.bindings ?? []
  console.log(`[SPARQL] Got ${rows.length} rows`)
  return rows
}

// Title (+ optional author) → matched work QID and its primary series, if any.
async function fetchBookInfo(title: string, author: string): Promise<{ workQid: string; authorQid: string | null; series: SeriesHit | null } | null> {
  const authorBlock = author
    ? `SERVICE wikibase:mwapi {
         bd:serviceParam wikibase:api "Search"; wikibase:endpoint "www.wikidata.org";
                          mwapi:srsearch "${escapeSparql(author)} haswbstatement:P31=Q5".
         ?author wikibase:apiOutputItem mwapi:title.
       }
       ?work wdt:P50 ?author.`
    : ''
  const query = `
    SELECT ?work ?author ?series ?ordinal ?seriesLabelEn ?seriesLabelDe WHERE {
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
  const authorQid = qidFromUri(rows[0].author?.value)

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
  return { workQid, authorQid, series }
}

// Fetches work-level metadata for a known Wikidata QID.
// Uses one subquery per property to avoid cartesian-product explosion when a work has many values.
async function fetchWorkDetails(workQid: string): Promise<WorkDetails> {
  const empty: WorkDetails = {
    genres: [], originalPubDate: null, awards: [], nominations: [],
    mainSubject: null, formOfWork: null, languageOfWork: null, languageOfWorkCode: null,
    firstLine: null, epigraph: null, narrativeLocations: [], countriesOfOrigin: [],
    subtitle: null, translator: [], illustrator: [], characters: [],
    openlibraryWorkId: null, referencePageCount: null,
  }
  if (!/^Q\d+$/.test(workQid)) {
    console.warn('[fetchWorkDetails] invalid QID:', workQid)
    return empty
  }
  console.log('[fetchWorkDetails] fetching details for', workQid)
  const query = `
    SELECT ?genres ?originalPubDate ?awards ?nominations
           ?mainSubject ?formOfWork ?languageOfWork ?languageOfWorkCode ?firstLine ?epigraph
           ?narrativeLocations ?countriesOfOrigin
           ?subtitle ?translators ?illustrators ?characters
           ?olWorkId ?refPageCount WHERE {
      { SELECT (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres) WHERE {
          OPTIONAL { wd:${workQid} wdt:P136 ?genre.
                     ?genre rdfs:label ?genreLabel. FILTER(LANG(?genreLabel) = "en") } } }
      { SELECT (MIN(STR(?pubDate)) AS ?originalPubDate) WHERE {
          OPTIONAL { wd:${workQid} wdt:P577 ?pubDate. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?awardLabel; separator="|") AS ?awards) WHERE {
          OPTIONAL { wd:${workQid} wdt:P166 ?award.
                     ?award rdfs:label ?awardLabel. FILTER(LANG(?awardLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?nominLabel; separator="|") AS ?nominations) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1411 ?nomin.
                     ?nomin rdfs:label ?nominLabel. FILTER(LANG(?nominLabel) = "en") } } }
      { SELECT (SAMPLE(?subjLabel) AS ?mainSubject) WHERE {
          OPTIONAL { wd:${workQid} wdt:P921 ?subj.
                     ?subj rdfs:label ?subjLabel. FILTER(LANG(?subjLabel) = "en") } } }
      { SELECT (SAMPLE(?formLabel) AS ?formOfWork) WHERE {
          OPTIONAL { wd:${workQid} wdt:P7937 ?form.
                     ?form rdfs:label ?formLabel. FILTER(LANG(?formLabel) = "en") } } }
      { SELECT (SAMPLE(?langLabel) AS ?languageOfWork) WHERE {
          OPTIONAL { wd:${workQid} wdt:P407 ?lang.
                     ?lang rdfs:label ?langLabel. FILTER(LANG(?langLabel) = "en") } } }
      { SELECT (SAMPLE(?langCode) AS ?languageOfWorkCode) WHERE {
          OPTIONAL { wd:${workQid} wdt:P407 ?lang2. ?lang2 wdt:P218 ?langCode. } } }
      { SELECT (SAMPLE(STR(?fl)) AS ?firstLine) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1922 ?fl. } } }
      { SELECT (SAMPLE(STR(?ep)) AS ?epigraph) WHERE {
          OPTIONAL { wd:${workQid} wdt:P7150 ?ep. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?narLocLabel; separator="|") AS ?narrativeLocations) WHERE {
          OPTIONAL { wd:${workQid} wdt:P840 ?narLoc.
                     ?narLoc rdfs:label ?narLocLabel. FILTER(LANG(?narLocLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countriesOfOrigin) WHERE {
          OPTIONAL { wd:${workQid} wdt:P495 ?country.
                     ?country rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "en") } } }
      { SELECT (SAMPLE(STR(?st)) AS ?subtitle) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1680 ?st. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?translatorLabel; separator="|") AS ?translators) WHERE {
          OPTIONAL { wd:${workQid} wdt:P655 ?translator.
                     ?translator rdfs:label ?translatorLabel. FILTER(LANG(?translatorLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?illustratorLabel; separator="|") AS ?illustrators) WHERE {
          OPTIONAL { wd:${workQid} wdt:P110 ?illustrator.
                     ?illustrator rdfs:label ?illustratorLabel. FILTER(LANG(?illustratorLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?characterLabel; separator="|") AS ?characters) WHERE {
          OPTIONAL { wd:${workQid} wdt:P674 ?character.
                     ?character rdfs:label ?characterLabel. FILTER(LANG(?characterLabel) = "en") } } }
      { SELECT (SAMPLE(?olid) AS ?olWorkId) WHERE {
          OPTIONAL { wd:${workQid} wdt:P648 ?olid. FILTER(STRENDS(?olid, "W")) } } }
      { SELECT (SAMPLE(?pageCount) AS ?refPageCount) WHERE {
          OPTIONAL { wd:${workQid} wdt:P747 ?refEd. ?refEd wdt:P1104 ?pageCount. } } }
    }`.trim()
  const rows = await runSparql(query)
  const row = rows[0]
  console.log('[fetchWorkDetails] raw row:', JSON.stringify(row ?? null))
  const splitPipe = (v: string | undefined) => (v ? v.split('|').filter(Boolean) : [])
  const strOrNull = (v: string | undefined) => v || null
  const positiveIntOrNull = (v: string | undefined) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null
  }
  const yearFrom = (v: string | undefined) => {
    if (!v) return null
    const m = v.match(/(\d{4})/)
    return m ? m[1] : null
  }
  const result: WorkDetails = {
    genres:            splitPipe(row?.genres?.value),
    originalPubDate:   yearFrom(row?.originalPubDate?.value),
    awards:            splitPipe(row?.awards?.value),
    nominations:       splitPipe(row?.nominations?.value),
    mainSubject:       strOrNull(row?.mainSubject?.value),
    formOfWork:        strOrNull(row?.formOfWork?.value),
    languageOfWork:    strOrNull(row?.languageOfWork?.value),
    languageOfWorkCode: strOrNull(row?.languageOfWorkCode?.value),
    firstLine:         strOrNull(row?.firstLine?.value),
    epigraph:          strOrNull(row?.epigraph?.value),
    narrativeLocations: splitPipe(row?.narrativeLocations?.value),
    countriesOfOrigin:  splitPipe(row?.countriesOfOrigin?.value),
    subtitle:           strOrNull(row?.subtitle?.value),
    translator:         splitPipe(row?.translators?.value),
    illustrator:        splitPipe(row?.illustrators?.value),
    characters:         splitPipe(row?.characters?.value),
    openlibraryWorkId:  strOrNull(row?.olWorkId?.value),
    referencePageCount: positiveIntOrNull(row?.refPageCount?.value),
  }
  console.log('[fetchWorkDetails] parsed:', {
    genres: result.genres, originalPubDate: result.originalPubDate,
    awards: result.awards.length, nominations: result.nominations.length,
    mainSubject: result.mainSubject, formOfWork: result.formOfWork,
    narrativeLocations: result.narrativeLocations.length, countriesOfOrigin: result.countriesOfOrigin.length,
    subtitle: result.subtitle, translator: result.translator.length,
    illustrator: result.illustrator.length, characters: result.characters.length,
    openlibraryWorkId: result.openlibraryWorkId, referencePageCount: result.referencePageCount,
  })
  return result
}

// All member works of a series (for completeness), with ordinals + English titles.
async function fetchSeriesMembers(seriesQid: string): Promise<{ qid: string; ordinal: number | null; title: string | null }[]> {
  if (!/^Q\d+$/.test(seriesQid)) { console.warn('[fetchSeriesMembers] invalid QID:', seriesQid); return [] }
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

  const book = await materializeEdition(db, isbn, workId, apiKey)
  if (!book) { console.log(`[backfillEdition] no metadata for ISBN ${isbn}`); return }
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

export type EnrichmentSource = 'scan' | 'lookup' | 'refresh' | 'sweeper' | 'unknown'

// Best-effort telemetry write for observability (pending count, failure breakdown, timing) —
// never lets a logging failure affect the enrichment result itself.
async function recordRun(
  db: D1Database,
  workId: number,
  startedAt: number,
  outcome: 'done' | 'not_found' | 'failed',
  failureReason: FailureReason | null,
  source: EnrichmentSource,
): Promise<void> {
  try {
    await db.prepare(
      'INSERT INTO enrichment_runs (work_id, started_at, duration_ms, outcome, failure_reason, source) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(workId, new Date(startedAt).toISOString(), Date.now() - startedAt, outcome, failureReason, source).run()
  } catch (e) {
    console.error('[enrichWork] failed to write enrichment_runs row', e)
  }
}

// Best-effort enrichment for a work. Negative-cached via works.series_checked_at unless force=true.
// apiKey (Google Books) is only needed when backfilling a cover edition for an unowned work.
export async function enrichWork(db: D1Database, workId: number, force = false, apiKey?: string, source: EnrichmentSource = 'unknown'): Promise<void> {
  let canonicalId = workId
  let merged = false
  const startedAt = Date.now()
  try {
    console.log(`[enrichWork] start workId=${workId} force=${force}`)
    const w = await db.prepare('SELECT * FROM works WHERE id = ?').bind(workId).first<WorkRow>()
    if (!w) { console.warn(`[enrichWork] work ${workId} not found`); return }
    // Re-enrich already-checked works when they're behind the current schema version (the sweeper's
    // backfill path passes force=false), so new Wikidata columns get populated without a force-refresh.
    const schemaStale = (w.enrichment_schema_version ?? 0) < CURRENT_ENRICHMENT_SCHEMA_VERSION
    if (w.series_checked_at && !force && !schemaStale) { console.log(`[enrichWork] already enriched (series_checked_at=${w.series_checked_at}), skipping`); return }

    // Claim the work atomically so a concurrent invocation (cron sweeper vs. a manual
    // refresh/lookup) can't run the same SPARQL work twice. A stale claim (a run that crashed
    // without clearing it) expires after 2 minutes. force=true still respects an in-flight run.
    const claim = await db.prepare(
      "UPDATE works SET enrichment_started_at = datetime('now') WHERE id = ? AND (enrichment_started_at IS NULL OR enrichment_started_at < datetime('now', '-2 minutes'))",
    ).bind(workId).run()
    if (claim.meta.changes === 0) {
      console.log(`[enrichWork] work ${workId} already has an enrichment in flight, skipping`)
      return
    }

    // Clear series_checked_at so the enrichment poll sees 'pending' while we run SPARQL. Done
    // only now, after winning the claim — clearing it before the claim risked leaving the work
    // stuck looking 'pending' forever if this call then lost the claim and the in-flight run it
    // deferred to later failed (which doesn't restore series_checked_at).
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
        await db.prepare("UPDATE works SET series_checked_at = datetime('now'), enrichment_failed_at = NULL, enrichment_failure_reason = NULL, enrichment_started_at = NULL WHERE id = ?").bind(workId).run()
        await recordRun(db, workId, startedAt, 'not_found', null, source)
        return
      }
      const author = splitAuthors(ed?.author ?? null)[0] ?? ''
      console.log(`[enrichWork] looking up: title="${title}" author="${author}"`)

      let info = await fetchBookInfo(title, author)
      if (!info) {
        const strippedTitle = title.replace(/\s*[([{].*?[)\]}]/g, '').trim()
        if (strippedTitle && strippedTitle !== title) {
          console.log(`[enrichWork] no results for "${title}", retrying with stripped title "${strippedTitle}"`)
          info = await fetchBookInfo(strippedTitle, author)
        }
      }
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
          merged = true
          // The claim above was taken on workId, which mergeWorks just deleted. Re-claim the
          // canonical row so a second concurrent enrichWork that resolves to the same existing
          // work can't race this one on the series/detail writes below.
          const canonicalClaim = await db.prepare(
            "UPDATE works SET enrichment_started_at = datetime('now') WHERE id = ? AND (enrichment_started_at IS NULL OR enrichment_started_at < datetime('now', '-2 minutes'))",
          ).bind(canonicalId).run()
          if (canonicalClaim.meta.changes === 0) {
            console.log(`[enrichWork] canonical work ${canonicalId} already has an enrichment in flight, skipping after merge`)
            return
          }
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

        // Best-effort: link the searched author's own QID for future dedup. Isolated in its own
        // try/catch so a failure here (e.g. two normalized names colliding on the UNIQUE index)
        // can't turn an otherwise-successful work enrichment into a failed one.
        if (info.authorQid && author) {
          try {
            const authorResult = await db.prepare(
              'UPDATE authors SET wikidata_qid = ? WHERE normalized_name = ? AND wikidata_qid IS NULL'
            ).bind(info.authorQid, normalizeStr(author)).run()
            console.log(`[enrichWork] author QID ${info.authorQid} write: changes=${authorResult.meta.changes}`)
          } catch (e) {
            console.error('[enrichWork] failed to write author QID', info.authorQid, e)
          }
        }

        details = await fetchWorkDetails(info.workQid)
      } else {
        console.log(`[enrichWork] no Wikidata match found, will store nulls`)
      }
    }

    // Give unowned/placeholder works a real edition (cover + ISBN) so the series view renders them.
    if (workQid) await backfillEdition(db, canonicalId, workQid, apiKey)

    // Pre-discover related editions via the Wikidata-linked OpenLibrary work id (P648) — covers
    // works whose owned ISBN is unknown to OpenLibrary (the seed-ISBN discover path finds nothing).
    // Best-effort: a failure here must not turn a successful enrichment into a failed one.
    if (details?.openlibraryWorkId) {
      try {
        await discoverEditionsFromOpenLibrary(db, canonicalId, details.openlibraryWorkId)
      } catch (e) {
        console.error('[enrichWork] edition discovery failed for work', canonicalId, e)
      }
    }

    const arrToJson = (a: string[] | undefined) => a?.length ? JSON.stringify(a) : null
    let genresJson      = arrToJson(details?.genres)
    if (!genresJson && !force) {
      // Wikidata had no genres for this work — fall back to Google Books' BISAC categories,
      // captured on any linked edition. Wikidata stays authoritative; this only fills a gap.
      // Skipped on force=true so a manual refresh can still clear a stale genre value —
      // that's the whole point of force overwriting unconditionally (see coalesce() below).
      const fallback = await db.prepare(
        'SELECT categories FROM books WHERE work_id = ? AND categories IS NOT NULL LIMIT 1'
      ).bind(canonicalId).first<{ categories: string }>()
      if (fallback?.categories) genresJson = fallback.categories
    }
    const awardsJson    = arrToJson(details?.awards)
    const nominJson     = arrToJson(details?.nominations)
    const narLocsJson   = arrToJson(details?.narrativeLocations)
    const countriesJson = arrToJson(details?.countriesOfOrigin)
    const translatorJson  = arrToJson(details?.translator)
    const illustratorJson = arrToJson(details?.illustrator)
    const charactersJson  = arrToJson(details?.characters)
    const pubDate        = details?.originalPubDate ?? null
    console.log(`[enrichWork] writing to works id=${canonicalId}:`, { genresJson, pubDate, awardsJson, nominJson })

    // force=true (manual refresh): overwrite unconditionally so stale values can be cleared.
    // force=false (sweeper backfill): COALESCE preserves existing values when Wikidata returns null.
    const coalesce = (col: string) => force ? '?' : `COALESCE(?, ${col})`
    const updateResult = await db.prepare(`
      UPDATE works SET
        series_checked_at         = datetime('now'),
        enrichment_failed_at      = NULL,
        enrichment_failure_reason = NULL,
        enrichment_attempts       = 0,
        enrichment_started_at     = NULL,
        enrichment_schema_version = ${CURRENT_ENRICHMENT_SCHEMA_VERSION},
        genres                    = ${coalesce('genres')},
        original_pub_date         = ${coalesce('original_pub_date')},
        awards                    = ${coalesce('awards')},
        nominations               = ${coalesce('nominations')},
        main_subject              = ${coalesce('main_subject')},
        form_of_work              = ${coalesce('form_of_work')},
        language_of_work          = ${coalesce('language_of_work')},
        language_of_work_code     = ${coalesce('language_of_work_code')},
        first_line                = ${coalesce('first_line')},
        epigraph                  = ${coalesce('epigraph')},
        narrative_locations       = ${coalesce('narrative_locations')},
        countries_of_origin       = ${coalesce('countries_of_origin')},
        subtitle                  = ${coalesce('subtitle')},
        translator                = ${coalesce('translator')},
        illustrator               = ${coalesce('illustrator')},
        characters                = ${coalesce('characters')},
        openlibrary_work_id       = ${coalesce('openlibrary_work_id')},
        reference_page_count      = ${coalesce('reference_page_count')}
      WHERE id = ?`)
      .bind(genresJson, pubDate, awardsJson, nominJson,
            details?.mainSubject ?? null, details?.formOfWork ?? null,
            details?.languageOfWork ?? null, details?.languageOfWorkCode ?? null, details?.firstLine ?? null,
            details?.epigraph ?? null, narLocsJson, countriesJson,
            details?.subtitle ?? null, translatorJson, illustratorJson, charactersJson,
            details?.openlibraryWorkId ?? null, details?.referencePageCount ?? null,
            canonicalId)
      .run()
    console.log(`[enrichWork] UPDATE result: changes=${updateResult.meta.changes}`)
    await recordRun(db, canonicalId, startedAt, workQid ? 'done' : 'not_found', null, source)
  } catch (e) {
    console.error('[enrichWork] failed for work', workId, e)
    const failTarget = merged ? canonicalId : workId
    const reason = classifyError(e)
    try {
      await db.prepare(
        "UPDATE works SET enrichment_failed_at = datetime('now'), enrichment_attempts = enrichment_attempts + 1, enrichment_failure_reason = ?, enrichment_started_at = NULL WHERE id = ?",
      ).bind(reason, failTarget).run()
    } catch {}
    await recordRun(db, failTarget, startedAt, 'failed', reason, source)
  }
}
