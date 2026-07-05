import type { Bindings, BookRow } from './types'
import { enrichWork, CURRENT_ENRICHMENT_SCHEMA_VERSION, RETRY_POLICY, DEFAULT_RETRY_POLICY, type FailureReason } from './enrichment'
import { linkWork } from './editions'

// How many works to enrich per cron tick. Each work costs ~3-6 external calls, so this stays
// comfortably under the Workers free-plan ceiling of 50 subrequests per invocation.
const BATCH_SIZE = 5
// Politeness delay between works so we don't burst Wikidata.
const DELAY_MS = 500
// How long enrichment_runs history is kept before being pruned each tick.
const RUNS_RETENTION_DAYS = 30
// Grace period after a rate_limits row's own window (window_start + window_ms) has elapsed before
// it's pruned — a row is safe to delete as soon as its window ends (it can never be incremented
// again), this just guards against clock skew. Correct regardless of which caller/window size
// wrote the row, unlike a single fixed retention constant.
const RATE_LIMIT_PRUNE_GRACE_MS = 5 * 60_000
// Backstop above the per-reason RETRY_POLICY caps: a work that has exhausted its cap (e.g. a
// genuinely bad title/author match that will never resolve) would otherwise be excluded from
// both sweeper queries forever, with no automated path back in. Once a failure is this old, retry
// once more regardless of attempts/cap — worst case it fails again and waits another cooldown.
const LONG_COOLDOWN_MINUTES = 2 * 24 * 60

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Generated from enrichment.ts's RETRY_POLICY (typed as Record<FailureReason, ...>, so a new
// FailureReason value forces a policy to be assigned there) rather than hardcoded here — keeps
// this SQL from silently drifting out of sync with the type it switches on.
const attemptsCaseSql = (Object.entries(RETRY_POLICY) as [FailureReason, typeof RETRY_POLICY[FailureReason]][])
  .map(([reason, p]) => `WHEN '${reason}' THEN ${p.capAttempts}`)
  .join(' ')
const backoffCaseSql = (Object.entries(RETRY_POLICY) as [FailureReason, typeof RETRY_POLICY[FailureReason]][])
  .map(([reason, p]) => `WHEN '${reason}' THEN ${p.backoffMinutes}`)
  .join(' ')

// Shared retry gate for both sweeper queries: never failed, or failed but past its reason's
// backoff/cap, or failed so long ago that it gets one more try regardless of cap. Without the
// last clause, a work that failed enough times to hit its cap (or, for Q2, failed even once
// before the fix that added this fragment there) would never appear in either query again.
const retryableSql = `
  ( enrichment_failed_at IS NULL
    OR ( enrichment_attempts < CASE enrichment_failure_reason ${attemptsCaseSql} ELSE ${DEFAULT_RETRY_POLICY.capAttempts} END
         AND enrichment_failed_at < datetime('now', '-' || CASE enrichment_failure_reason ${backoffCaseSql} ELSE ${DEFAULT_RETRY_POLICY.backoffMinutes} END || ' minutes') )
    OR enrichment_failed_at < datetime('now', '-${LONG_COOLDOWN_MINUTES} minutes') )
`

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

  // Two separate queries so each is served by a partial index (a single OR query can fall
  // back to a full table scan). The two predicates are disjoint on series_checked_at
  // (NULL vs NOT NULL), so the result sets never overlap.

  // Q1 — backlog/retry: never-enriched works plus failed ones past their backoff window.
  // Uses idx_works_unenriched (WHERE series_checked_at IS NULL) and idx_works_retry.
  // Retry policy varies by enrichment_failure_reason (set by enrichWork's classifyError) — see
  // RETRY_POLICY in enrichment.ts for the per-reason cap/backoff and rationale. NULL (legacy rows
  // enriched before this column existed) falls through to DEFAULT_RETRY_POLICY.
  const { results: backlog } = await env.DB.prepare(`
    SELECT id FROM works
    WHERE series_checked_at IS NULL
      AND ${retryableSql}
    ORDER BY enrichment_failed_at IS NOT NULL, id
    LIMIT ?`)
    .bind(BATCH_SIZE)
    .all<{ id: number }>()

  // Q2 — schema backfill: already-enriched works missing newer Wikidata columns, including ones
  // where the backfill attempt itself previously failed (retried under the same policy as Q1).
  // Uses idx_works_schema_backfill.
  const remaining = Math.max(0, BATCH_SIZE - backlog.length)
  const backfill = remaining > 0
    ? (await env.DB.prepare(`
        SELECT id FROM works
        WHERE series_checked_at IS NOT NULL
          AND enrichment_schema_version < ?
          AND ${retryableSql}
        ORDER BY enrichment_schema_version, id
        LIMIT ?`)
        .bind(CURRENT_ENRICHMENT_SCHEMA_VERSION, remaining)
        .all<{ id: number }>()).results
    : []

  const results = [...backlog, ...backfill]

  console.log(`[sweeper] ${results.length} work(s) to enrich`)
  for (const [i, w] of results.entries()) {
    await enrichWork(env.DB, w.id, false, env.GOOGLE_BOOKS_API_KEY, 'sweeper')
    if (i < results.length - 1) await sleep(DELAY_MS)
  }

  // Keep enrichment_runs from growing unbounded — cheap given idx_enrichment_runs_created.
  await env.DB.prepare(`DELETE FROM enrichment_runs WHERE created_at < datetime('now', '-${RUNS_RETENTION_DAYS} days')`).run()

  // Keep rate_limits from growing unbounded. Table stays small (one row per active user per
  // window), so a plain scan on this rarely-hit DELETE is fine — no dedicated index.
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start + window_ms < ?').bind(Date.now() - RATE_LIMIT_PRUNE_GRACE_MS).run()
}
