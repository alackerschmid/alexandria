import type { Bindings, BookRow } from "./types";
import { enrichWork, CURRENT_ENRICHMENT_SCHEMA_VERSION } from "./enrichment";
import { linkWork } from "./editions";

// How many works to enrich per cron tick. Each work costs ~3-6 external calls, so this stays
// comfortably under the Workers free-plan ceiling of 50 subrequests per invocation.
const BATCH_SIZE = 5;
// Politeness delay between works so we don't burst Wikidata.
const DELAY_MS = 500;
// How long enrichment_runs history is kept before being pruned each tick.
const RUNS_RETENTION_DAYS = 30;
// Grace period after a rate_limits row's own window (window_start + window_ms) has elapsed before
// it's pruned — a row is safe to delete as soon as its window ends (it can never be incremented
// again), this just guards against clock skew. Correct regardless of which caller/window size
// wrote the row, unlike a single fixed retention constant.
const RATE_LIMIT_PRUNE_GRACE_MS = 5 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Background sweeper: drains the backlog of un-enriched works — series-member placeholders that
// were never touched, plus works whose enrichment failed (retried with a cap + backoff).
export async function scheduled(
  _event: ScheduledController,
  env: Bindings,
  _ctx: ExecutionContext,
): Promise<void> {
  const { results: unlinked } = await env.DB.prepare(
    "SELECT * FROM books WHERE work_id IS NULL LIMIT ?",
  )
    .bind(BATCH_SIZE)
    .all<BookRow>();

  if (unlinked.length) {
    console.log(`[sweeper] linking ${unlinked.length} book(s) with no work`);
    for (const book of unlinked) await linkWork(env.DB, book);
  }

  // Two separate queries so each is served by a partial index (a single OR query can fall
  // back to a full table scan). The two predicates are disjoint on enrichment_status
  // ('done' vs. everything else), so the result sets never overlap.

  // Q1 — backlog/retry: never-enriched works ('pending', next_retry_at NULL = due immediately)
  // plus failed/exhausted ones whose next_retry_at has arrived. When and how far out
  // next_retry_at is scheduled is decided at failure time by scheduleRetry in enrichment.ts.
  // Uses idx_works_enrichment_due; pending works are served before retries.
  const { results: backlog } = await env.DB.prepare(
    `
    SELECT id FROM works
    WHERE enrichment_status != 'done'
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
    ORDER BY enrichment_status = 'pending' DESC, id
    LIMIT ?`,
  )
    .bind(BATCH_SIZE)
    .all<{ id: number }>();

  // Q2 — schema backfill: already-enriched works missing newer Wikidata columns. A backfill
  // attempt that fails moves the work to 'failed', so it drains through Q1 from then on.
  // Uses idx_works_schema_backfill.
  const remaining = Math.max(0, BATCH_SIZE - backlog.length);
  const backfill =
    remaining > 0
      ? (
          await env.DB.prepare(
            `
        SELECT id FROM works
        WHERE enrichment_status = 'done'
          AND enrichment_schema_version < ?
        ORDER BY enrichment_schema_version, id
        LIMIT ?`,
          )
            .bind(CURRENT_ENRICHMENT_SCHEMA_VERSION, remaining)
            .all<{ id: number }>()
        ).results
      : [];

  const results = [...backlog, ...backfill];

  console.log(`[sweeper] ${results.length} work(s) to enrich`);
  for (const [i, w] of results.entries()) {
    await enrichWork(env.DB, w.id, false, env.GOOGLE_BOOKS_API_KEY, "sweeper");
    if (i < results.length - 1) await sleep(DELAY_MS);
  }

  // Keep enrichment_runs from growing unbounded — cheap given idx_enrichment_runs_created.
  await env.DB.prepare(
    `DELETE FROM enrichment_runs WHERE created_at < datetime('now', '-${RUNS_RETENTION_DAYS} days')`,
  ).run();

  // Keep rate_limits from growing unbounded. Table stays small (one row per active user per
  // window), so a plain scan on this rarely-hit DELETE is fine — no dedicated index.
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE window_start + window_ms < ?",
  )
    .bind(Date.now() - RATE_LIMIT_PRUNE_GRACE_MS)
    .run();

  // Keep search_cache from growing unbounded — expired entries are dead weight (a stale row is
  // never served, `handleTitleSearch` filters on expires_at > now), just wasted storage.
  await env.DB.prepare("DELETE FROM search_cache WHERE expires_at < ?")
    .bind(Date.now())
    .run();
}
