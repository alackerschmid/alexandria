import type { Bindings, BookRow } from "./types";
import { enrichWork, CURRENT_ENRICHMENT_SCHEMA_VERSION } from "./enrichment";
import { linkWork } from "./editions";
import { UsageRecorder } from "./usage";

// The most works a tick will *consider*. It is no longer what keeps the tick inside the subrequest
// limit — `fitsInBudget` does that, by metering the calls actually spent (see SUBREQUEST_BUDGET) —
// so this is now purely a throughput knob, and raising it costs nothing but wall-clock time when the
// works turn out to be cheap.
//
// Cheap and expensive works differ by ~10x, which is why a fixed count was the wrong instrument: a
// work that already has a QID skips the search entirely (~1-2 calls, and the whole schema-backfill
// population is this kind), while one that needs identity costs ~6-7 and a pathological one ~15.
// Seven expensive works would exceed the free plan's 50; seven cheap ones use a fifth of it.
//
// Throughput matters after a bulk import (a Goodreads library adds hundreds of pending works at
// once, each showing a "series lookup pending" badge until it drains). The cron interval is the
// other half of that lever: see `crons` in wrangler.toml.
const BATCH_SIZE = 7;
// Books with no work link get their own budget so a large unlinked backlog can't crowd out
// enrichment (and vice versa) — linking is cheap, enrichment is not.
const LINK_BATCH_SIZE = 5;

/**
 * The tick's external-subrequest allowance, and the cost it assumes the next work might have.
 *
 * **Free-plan Workers get 50 external subrequests per invocation.** Cloudflare services (D1) have a
 * separate 1,000, so the tick's queries don't compete — this budget is only about calls to Wikidata,
 * Google Books and OpenLibrary, which is exactly what `UsageRecorder.countFetch` counts.
 *
 * `WORST_CASE_PER_WORK` is deliberately the *worst* case, not the typical one, because the check runs
 * before a work starts and cannot know which kind it got. A work that already has a QID costs ~1-2
 * (`resolveWorkIdentity` returns early and never searches); one that needs identity costs ~6-7, and
 * one that finds nothing until the third pass, then backfills an edition, reaches ~15. Reserving 15
 * means a tick admits ~3 works in the worst case and all 7 whenever the early ones were cheap — the
 * meter adapts, which a fixed BATCH_SIZE could not.
 *
 * `SUBREQUEST_BUDGET` keeps 5 in hand below the platform's 50: the count is exact for calls made
 * through the two fetch helpers, and nothing else in the tick makes an external request today, but a
 * redirect chain counts twice against the platform limit and is invisible from here.
 */
export const SUBREQUEST_BUDGET = 45;
export const WORST_CASE_PER_WORK = 15;

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

/**
 * Whether the next work can be started without risking the invocation's subrequest limit. The first
 * work always runs: refusing to start any work at all would stall the queue permanently, and one
 * work can only exceed the platform limit if `WORST_CASE_PER_WORK` is wrong by 3x.
 */
export function fitsInBudget(usage: UsageRecorder, index: number): boolean {
  if (index === 0) return true;
  const spent = usage.externalCalls;
  if (spent + WORST_CASE_PER_WORK <= SUBREQUEST_BUDGET) return true;
  console.log(
    `[sweeper] stopping after ${index} work(s): ${spent} external calls spent, ` +
    `${SUBREQUEST_BUDGET - spent} left and a work can need ${WORST_CASE_PER_WORK}. ` +
    `The rest stay due for the next tick.`,
  );
  return false;
}

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
      // Stop before a work that can't fit rather than after one that didn't: an overrun throws
      // mid-enrichment, and `enrichWork` books that as a *failure* — a healthy work marked `failed`,
      // its attempt count advanced toward `exhausted`, for no reason but our own arithmetic. A work
      // left unstarted is simply still due, and the next tick (two minutes) takes it.
      if (!fitsInBudget(usage, i)) break;
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
