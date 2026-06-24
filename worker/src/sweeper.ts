import type { Bindings, BookRow } from './types'
import { enrichWork } from './enrichment'
import { linkWork } from './editions'

// How many works to enrich per cron tick. Each work costs ~3-6 external calls, so this stays
// comfortably under the Workers free-plan ceiling of 50 subrequests per invocation.
const BATCH_SIZE = 5
// Give up on a work after this many failed enrichment runs.
const MAX_ATTEMPTS = 5
// Politeness delay between works so we don't burst Wikidata.
const DELAY_MS = 500

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Background sweeper: drains the backlog of un-enriched works — series-member placeholders that
// were never touched, plus works whose enrichment failed (retried with a cap + backoff).
export async function scheduled(_event: ScheduledController, env: Bindings, _ctx: ExecutionContext): Promise<void> {
  const { results: unlinked } = await env.DB
    .prepare('SELECT * FROM books WHERE work_id IS NULL LIMIT ?')
    .bind(BATCH_SIZE)
    .all<BookRow>()

  if (unlinked.length) {
    console.log(`[sweeper] linking ${unlinked.length} book(s) with no work`)
    for (const book of unlinked) await linkWork(env.DB, book)
  }

  const { results } = await env.DB.prepare(`
    SELECT id FROM works
    WHERE series_checked_at IS NULL
      AND ( enrichment_failed_at IS NULL
            OR ( enrichment_attempts < ?
                 AND enrichment_failed_at < datetime('now', '-30 minutes') ) )
    ORDER BY enrichment_failed_at IS NOT NULL, id
    LIMIT ?`)
    .bind(MAX_ATTEMPTS, BATCH_SIZE)
    .all<{ id: number }>()

  console.log(`[sweeper] ${results.length} work(s) to enrich`)
  for (const [i, w] of results.entries()) {
    await enrichWork(env.DB, w.id, false, env.GOOGLE_BOOKS_API_KEY)
    if (i < results.length - 1) await sleep(DELAY_MS)
  }
}
