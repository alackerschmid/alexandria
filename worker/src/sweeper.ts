import type { Bindings, BookRow } from "./types";
import { enrichWork, CURRENT_ENRICHMENT_SCHEMA_VERSION } from "./enrichment";
import { linkWork } from "./editions";
import { UsageRecorder } from "./usage";

// How many works to enrich per cron tick. A typical work costs ~3-6 external calls, which keeps a
// batch under the Workers free-plan ceiling of 50 subrequests per invocation (7 x 6 = 42). The tail
// is higher — the paren-stripped title retry, the QID label-verification fallback (only when the
// en/de labels riding the search query don't decide it) and the edition-backfill chain can stack to
// ~11 on one work — so the ceiling is a budget, not a guarantee: a batch of pathological works can
// blow it, failing those fetches for the tick and re-queuing the works through the retry policy.
// Throughput matters after a bulk import (a Goodreads library adds hundreds of pending works at
// once, each showing a "series lookup pending" badge until it drains) — but the per-invocation
// subrequest ceiling caps how far this can go, so the cron interval is the other half of the
// lever: see `crons` in wrangler.toml.
const BATCH_SIZE = 7;
// Books with no work link get their own budget so a large unlinked backlog can't crowd out
// enrichment (and vice versa) — linking is cheap, enrichment is not.
const LINK_BATCH_SIZE = 5;
// Politeness delay between works so we don't burst Wikidata.
const DELAY_MS = 500;
// How long enrichment_runs history is kept before being pruned each tick.
const RUNS_RETENTION_DAYS = 30;
// Grace period after a rate_limits row's own window (window_start + window_ms) has elapsed before
// it's pruned — a row is safe to delete as soon as its window ends (it can never be incremented
// again), this just guards against clock skew. Correct regardless of which caller/window size
// wrote the row, unlike a single fixed retention constant.
const RATE_LIMIT_PRUNE_GRACE_MS = 5 * 60_000;
// How much api_usage history the admin page can look back over. Bounded by construction (one row
// per hour per provider+operation — a few dozen a day at most), so this is generous.
const USAGE_RETENTION_DAYS = 90;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Background sweeper: drains the backlog of un-enriched works — series-member placeholders that
// were never touched, plus works whose enrichment failed (retried with a cap + backoff).
export async function scheduled(
  _event: ScheduledController,
  env: Bindings,
  ctx: ExecutionContext,
): Promise<void> {
  // Prunes run first, ahead of the fallible link/enrichment phases, so a throw down there can't
  // skip all four every tick. Isolated in turn, because ordering them first would otherwise just
  // move the same failure mode: they are pure housekeeping, and none of the work below depends
  // on them, so a failed prune costs only pruning (and self-heals next tick).
  try {
    await prune(env);
  } catch (e) {
    console.error("[sweeper] prune failed:", e);
  }

  // ORDER BY RANDOM() rather than the implicit rowid order: a book that deterministically fails
  // to link is re-served forever (nothing marks it, and linking has no retry state machine by
  // design), so a fixed order lets LINK_BATCH_SIZE poisoned rows occupy every slot of every tick
  // and starve the rest of the backlog. Sampling instead bounds the damage to their share of it.
  // Costs a scan of the unlinked set, which is the transient import backlog rather than `books`.
  const { results: unlinked } = await env.DB.prepare(
    "SELECT * FROM books WHERE work_id IS NULL ORDER BY RANDOM() LIMIT ?",
  )
    .bind(LINK_BATCH_SIZE)
    .all<BookRow>();

  if (unlinked.length) {
    console.log(`[sweeper] linking ${unlinked.length} book(s) with no work`);
    for (const book of unlinked) {
      try {
        await linkWork(env.DB, book);
      } catch (e) {
        // Per-book isolation: without it, one book that throws deterministically takes the whole
        // handler down at the same point every 2 minutes — no linking, no enrichment, ever.
        console.error(`[sweeper] linkWork failed for book ${book.id}:`, e);
      }
    }
  }

  // Two separate queries so each is served by a partial index (a single OR query can fall
  // back to a full table scan). The two predicates are disjoint on enrichment_status
  // ('done' vs. everything else), so the result sets never overlap.

  // Q1a — owned backlog: due works that at least one user actually has a scan for. These are the
  // only works that can be showing a "series lookup pending" badge to somebody, so they go first.
  // This matters because the backlog is self-amplifying: enriching one work with a series inserts
  // its whole roster as placeholder works via populateSeriesMembers (~10 per work, observed), and
  // those placeholders get interleaved ids. Ordering the combined set by id alone lets thousands of
  // placeholders nobody is looking at push a user's own freshly-imported books arbitrarily far back.
  // Written as EXISTS rather than a JOIN deliberately: the JOIN form makes SQLite drive from
  // scans (SCAN s USING COVERING INDEX), i.e. every scan row in the database on every tick. EXISTS
  // leads from idx_works_enrichment_due instead, so the outer scan is bounded by the backlog and
  // each candidate costs two index probes (idx_books_work, idx_scans_book).
  const OWNED_LIMIT = BATCH_SIZE - 1; // leave >=1 slot so placeholders still make progress
  const { results: owned } = await env.DB.prepare(
    `
    SELECT w.id FROM works w
    WHERE w.enrichment_status != 'done'
      AND (w.next_retry_at IS NULL OR w.next_retry_at <= datetime('now'))
      AND EXISTS (
        SELECT 1 FROM books b JOIN scans s ON s.book_id = b.id WHERE b.work_id = w.id
      )
    ORDER BY w.enrichment_status = 'pending' DESC, w.id
    LIMIT ?`,
  )
    .bind(OWNED_LIMIT)
    .all<{ id: number }>();

  // Q1b — general backlog/retry: never-enriched works ('pending', next_retry_at NULL = due
  // immediately) plus failed/exhausted ones whose next_retry_at has arrived. When and how far out
  // next_retry_at is scheduled is decided at failure time by scheduleRetry in enrichment.ts.
  // Uses idx_works_enrichment_due; pending works are served before retries. Overlaps Q1a (it isn't
  // filtered to unowned works — that predicate isn't indexable), so results are deduped below.
  const { results: general } = await env.DB.prepare(
    `
    SELECT id FROM works
    WHERE enrichment_status != 'done'
      AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
    ORDER BY enrichment_status = 'pending' DESC, id
    LIMIT ?`,
  )
    .bind(BATCH_SIZE)
    .all<{ id: number }>();

  const seen = new Set(owned.map((w) => w.id));
  const backlog = [
    ...owned,
    ...general.filter((w) => !seen.has(w.id)),
  ].slice(0, BATCH_SIZE);

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
  // One recorder for the whole tick: a batch of 7 works is ~15-40 external calls but only a
  // handful of distinct (hour, provider, operation) buckets, so it collapses to one small batch
  // write instead of a D1 round-trip in front of every SPARQL response.
  const usage = new UsageRecorder(env.DB);
  try {
    for (const [i, w] of results.entries()) {
      await enrichWork(
        env.DB,
        w.id,
        false,
        env.GOOGLE_BOOKS_API_KEY,
        "sweeper",
        usage,
      );
      if (i < results.length - 1) await sleep(DELAY_MS);
    }
  } finally {
    // finally, not after the loop: enrichWork catches its own errors, but anything that does
    // escape (a D1 hiccup between works) must not also drop every counter recorded this tick —
    // api_usage is what the admin quota gauge measures, and it can't self-heal an undercount.
    ctx.waitUntil(usage.flush());
  }
}

// The four retention DELETEs, in one place so the tick can run them ahead of everything
// fallible. Each is self-healing (rows just wait for the next tick); the caller isolates the
// whole helper, so a failure here costs pruning only.
async function prune(env: Bindings): Promise<void> {
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

  // Same for api_usage — hour_start is the PK's leading column, so this needs no extra index.
  await env.DB.prepare("DELETE FROM api_usage WHERE hour_start < ?")
    .bind(Date.now() - USAGE_RETENTION_DAYS * 86_400_000)
    .run();
}
