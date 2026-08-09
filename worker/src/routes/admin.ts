import { Hono } from "hono";
import type { Env } from "../types";
import { adminMiddleware, authMiddleware } from "../auth";
import { googleBooksCallsToday, usageDayStart, usageHourStart } from "../usage";
import { isTransientFailure } from "../enrichment";
import { parseIntOr } from "../library-query";

const admin = new Hono<Env>();
// Both, in this order: adminMiddleware reads the userId authMiddleware sets.
admin.use("*", authMiddleware, adminMiddleware);

const HOUR_MS = 3_600_000;
// Widest window the usage endpoint will serve. 14 days is well inside the sweeper's 90-day
// retention and keeps the row count returned to the page bounded.
const MAX_USAGE_HOURS = 336;
const DEFAULT_USAGE_HOURS = 48;

/**
 * The one window both run surfaces read — the `/overview` summary and the `/runs` list it drills
 * into. Shared so the list can never disagree with the count that opened it: the board shows
 * "19 failed" and clicking it has to produce those 19 rows, not a differently-windowed 17.
 *
 * Deliberately unqualified so it drops into either query. In the joined one it still resolves to
 * `enrichment_runs.created_at` — `works` has no such column.
 */
const RUNS_WINDOW_HOURS = 24;
const RUNS_WINDOW = `created_at >= datetime('now', '-${RUNS_WINDOW_HOURS} hours')`;

// Most recent rows `/runs` and `/works` will hand back. Both responses also carry the unclamped
// `total`, so a truncated list can say so rather than looking like the whole story.
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

/**
 * A `?limit=` from the board, clamped. Anything unparseable falls back to the default.
 *
 * Exported for the unit tests: it is the only bound on either list route's payload, and `/works`
 * sorts an unindexed column, so a `limit` that escaped the clamp is a real cost. The lower bound
 * matters too — a `LIMIT 0` would render an empty dialog under a non-zero count.
 */
export const listLimit = (raw: string | undefined): number =>
  Math.min(Math.max(parseIntOr(raw, DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);

/**
 * A stored D1 timestamp as ms-epoch. Every timestamp this API returns goes through it, so the board
 * speaks one dialect: `api_usage.hour_start` is already ms-epoch, and shipping the other columns as
 * bare `YYYY-MM-DD HH:MM:SS` would hand the client a string `Date.parse` reads as *local* time — a
 * normalization the caller has to remember, and therefore one it will forget.
 *
 * Handles both dialects the schema actually holds: `datetime('now')` columns (zone-less UTC, second
 * resolution) and `enrichment_runs.started_at`, which is a JS `toISOString()` string. SQLite parses
 * the `…T…Z` form too, so the conversion is right either way — but note it truncates the ISO string's
 * milliseconds, which is fine for a relative label and would not be for a duration.
 */
const EPOCH_MS = (column: string) =>
  `CAST(strftime('%s', ${column}) AS INTEGER) * 1000`;

/**
 * A work's display title. `canonical_title` is nullable — a work created by the synchronous dedup
 * and never enriched has none — so it falls back to any edition's title (via `idx_books_work`)
 * rather than leaving the row unidentifiable in a list whose whole purpose is naming the works
 * behind a count. Shared by `/runs` and `/works`: two lists must not name the same work differently.
 */
const WORK_TITLE = (titleColumn: string, workIdColumn: string) =>
  `COALESCE(${titleColumn}, (SELECT b.title FROM books b WHERE b.work_id = ${workIdColumn} LIMIT 1))`;

export type RunRow = {
  outcome: string;
  failure_reason: string | null;
  count: number;
  total_ms: number;
};

/**
 * Folds the `(outcome, failure_reason)` groups into the shape the board reads. Split out of the
 * handler because the per-field `??` fallbacks alone push it past the complexity cap.
 *
 * Exported for the unit tests — it is pure, and the fallbacks are the part that would rot silently.
 */
export function summarizeRuns(rows: RunRow[], p95DurationMs: number) {
  let total = 0;
  let totalMs = 0;
  const byOutcome: Record<string, number> = {};
  const failureReasons: Record<string, number> = {};

  for (const r of rows) {
    total += r.count;
    totalMs += r.total_ms ?? 0;
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + r.count;
    if (r.outcome === "failed") {
      const reason = r.failure_reason ?? "other";
      failureReasons[reason] = (failureReasons[reason] ?? 0) + r.count;
    }
  }

  return {
    total,
    byOutcome: {
      done: byOutcome.done ?? 0,
      not_found: byOutcome.not_found ?? 0,
      failed: byOutcome.failed ?? 0,
    },
    // Whether a reason is upstream pressure or a query bug is `RETRY_POLICY`'s judgement, so it
    // ships with the counts rather than being restated by the board against a hand-kept list.
    failureReasons: Object.entries(failureReasons)
      .map(([reason, count]) => ({
        reason,
        count,
        transient: isTransientFailure(reason),
      }))
      .sort((a, b) => b.count - a.count),
    avgDurationMs: total ? Math.round(totalMs / total) : 0,
    p95DurationMs,
  };
}

/**
 * The WHERE for a `/runs` query, from the one optional filter the board sends.
 *
 * The outcome is fixed here rather than taken from the caller: `failed` is the only run count the
 * board makes clickable, and a reason is only meaningful on a failed row anyway.
 *
 * Exported and unit-tested because the `other` rule below is exactly the kind that rots silently:
 * the list is reached by clicking a number, so a filter that disagrees with `summarizeRuns` shows
 * an empty dialog for a chip that says "2".
 */
export function buildRunFilters(reason: string | undefined): {
  where: string;
  binds: string[];
} {
  const clauses = [RUNS_WINDOW, "outcome = 'failed'"];
  const binds: string[] = [];

  if (reason) {
    // `summarizeRuns` buckets a failed row with a NULL reason under 'other', so the chip reading
    // "Other 2" has to match those rows too or it opens onto nothing.
    if (reason === "other") {
      clauses.push("(failure_reason IS NULL OR failure_reason = 'other')");
    } else {
      clauses.push("failure_reason = ?");
      binds.push(reason);
    }
  }

  return { where: clauses.join(" AND "), binds };
}

/**
 * Headline numbers for the board. Everything here is a COUNT or a small GROUP BY over an indexed
 * column, so the whole endpoint is cheap enough to re-run on every Refresh.
 *
 * One day of `enrichment_runs` is up to BATCH_SIZE × 30 × 24 ≈ 5k rows whenever the backlog is
 * non-empty — which is exactly the state this page gets opened to look at — so the summary is
 * aggregated in SQL rather than streamed out and reduced in the isolate.
 */
admin.get("/overview", async (c) => {
  const db = c.env.DB;

  const [counts, enrichment, runs, p95, sweeper] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM users)  AS total_users,
           (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 days')) AS new_users_7d,
           (SELECT COUNT(*) FROM scans)  AS total_scans,
           (SELECT COUNT(*) FROM scans WHERE created_at >= datetime('now', '-7 days')) AS scans_7d,
           (SELECT COUNT(*) FROM books)  AS total_books`,
      )
      .first<{
        total_users: number;
        new_users_7d: number;
        total_scans: number;
        scans_7d: number;
        total_books: number;
      }>(),
    // Also the work total: the groups partition `works` (SQLite gives NULL its own bucket), so
    // counting the table separately would be a second full scan of the fastest-growing one.
    db
      .prepare(
        "SELECT enrichment_status, COUNT(*) AS count FROM works GROUP BY enrichment_status",
      )
      .all<{ enrichment_status: string; count: number }>(),
    // A handful of rows out — one per (outcome, reason) pair. Uses idx_enrichment_runs_created.
    db
      .prepare(
        `SELECT outcome, failure_reason, COUNT(*) AS count, SUM(duration_ms) AS total_ms
         FROM enrichment_runs
         WHERE ${RUNS_WINDOW}
         GROUP BY outcome, failure_reason`,
      )
      .all<RunRow>(),
    // Nearest-rank p95: the value at index ceil(n × 0.95) − 1, done as integer arithmetic
    // because SQLite's ceil() lives in an extension that may not be compiled in.
    db
      .prepare(
        `SELECT duration_ms FROM enrichment_runs
         WHERE ${RUNS_WINDOW}
         ORDER BY duration_ms
         LIMIT 1 OFFSET (
           SELECT MAX((COUNT(*) * 95 + 99) / 100 - 1, 0)
           FROM enrichment_runs WHERE ${RUNS_WINDOW}
         )`,
      )
      .first<{ duration_ms: number }>(),
    // Is the cron actually running? A backlog draining slowly and a dead sweeper look identical
    // from the status counts alone — both just sit at `pending`. These two together separate
    // them: work the sweeper would pick up *right now*, and when it last finished anything.
    // `due_count` repeats the sweeper's own predicate (`idx_works_enrichment_due`), so it counts
    // what a tick would actually see rather than every pending row; `last_run_at` is a MAX over
    // `idx_enrichment_runs_created`. Deliberately not windowed to 24h — a sweeper that died a
    // week ago has to still report the week-old timestamp, not null.
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM works
             WHERE enrichment_status != 'done'
               AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))) AS due_count,
           (SELECT ${EPOCH_MS("MAX(created_at)")} FROM enrichment_runs) AS last_run_at`,
      )
      .first<{ due_count: number; last_run_at: number | null }>(),
  ]);

  const byStatus = Object.fromEntries(
    enrichment.results.map((r) => [r.enrichment_status, r.count]),
  );

  return c.json({
    totalUsers: counts?.total_users ?? 0,
    newUsers7d: counts?.new_users_7d ?? 0,
    totalScans: counts?.total_scans ?? 0,
    scans7d: counts?.scans_7d ?? 0,
    totalBooks: counts?.total_books ?? 0,
    totalWorks: enrichment.results.reduce((sum, r) => sum + r.count, 0),
    enrichment: {
      pending: byStatus.pending ?? 0,
      done: byStatus.done ?? 0,
      failed: byStatus.failed ?? 0,
      exhausted: byStatus.exhausted ?? 0,
    },
    enrichmentRuns24h: summarizeRuns(runs.results, p95?.duration_ms ?? 0),
    sweeper: {
      dueCount: sweeper?.due_count ?? 0,
      lastRunAt: sweeper?.last_run_at ?? null,
    },
  });
});

/**
 * The individual failed `enrichment_runs` rows behind one of `/overview`'s failure counts — what
 * the board's "19 failed" is actually made of. Same 24h window as the summary (`RUNS_WINDOW`),
 * optionally narrowed to one `failure_reason`, most recent first.
 *
 * Joined to `works` for the two things a run row alone can't answer: which book it was, and whether
 * the work is still going to be retried. An unknown `reason` isn't rejected — it's bound like any
 * other and simply matches nothing, which is the same answer the caller can act on.
 */
admin.get("/runs", async (c) => {
  const db = c.env.DB;

  const { where, binds } = buildRunFilters(c.req.query("reason") || undefined);
  const limit = listLimit(c.req.query("limit"));

  const [rows, count] = await Promise.all([
    // The title subquery runs per returned row only (≤ MAX_LIST_LIMIT): the ORDER BY is served by
    // `idx_enrichment_runs_created`, so the LIMIT short-circuits before the payload is built.
    db
      .prepare(
        `SELECT r.id, r.work_id, r.failure_reason, r.duration_ms, r.source,
                ${EPOCH_MS("r.started_at")} AS started_at,
                ${WORK_TITLE("w.canonical_title", "r.work_id")} AS work_title,
                w.enrichment_status, w.enrichment_attempts,
                ${EPOCH_MS("w.next_retry_at")} AS next_retry_at
         FROM enrichment_runs r
         LEFT JOIN works w ON w.id = r.work_id
         WHERE ${where}
         -- By finish time, not by the started_at the row ships: created_at is the indexed column and
         -- the one the window filters on, so ordering on it is what lets the LIMIT short-circuit.
         -- The two disagree by a run's duration, so a slow run can sit below a later, shorter one.
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT ?`,
      )
      .bind(...binds, limit)
      .all<{
        id: number;
        work_id: number;
        failure_reason: string | null;
        duration_ms: number;
        source: string;
        started_at: number;
        work_title: string | null;
        enrichment_status: string | null;
        enrichment_attempts: number | null;
        next_retry_at: number | null;
      }>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM enrichment_runs WHERE ${where}`)
      .bind(...binds)
      .first<{ total: number }>(),
  ]);

  return c.json({
    hours: RUNS_WINDOW_HOURS,
    // Unclamped: the list is capped, and the panel's count is what the operator clicked on.
    total: count?.total ?? 0,
    runs: rows.results.map((r) => ({
      id: r.id,
      workId: r.work_id,
      workTitle: r.work_title,
      startedAt: r.started_at,
      durationMs: r.duration_ms,
      failureReason: r.failure_reason,
      // Same judgement as the summary's, from the same policy — the two are read side by side.
      transient: isTransientFailure(r.failure_reason ?? ""),
      source: r.source,
      // The work as it stands *now*, not as it was at run time: whether this failure is still
      // being retried is the question a failed run raises, and only the work row answers it.
      workStatus: r.enrichment_status,
      workAttempts: r.enrichment_attempts,
      workNextRetryAt: r.next_retry_at,
    })),
  });
});

/**
 * The `works` rows behind one segment of `/overview`'s enrichment bar — which books are actually
 * `failed`, `exhausted`, `pending` or `done`, rather than just how many.
 *
 * Ordered newest-attempt-first, then newest work: `enrichment_failed_at` and `series_checked_at`
 * are the informational stamps left by the last failure and the last success (0034), so their
 * COALESCE is "when was this last touched". Never-attempted works have neither and sort last,
 * which is exactly right for the `pending` segment — the backlog's untouched tail is the least
 * interesting part of it.
 *
 * Unindexed sort over `works`, deliberately: a bounded table (one row per logical work) read at
 * most a handful of times per board visit, against an index that would exist only for this.
 */
admin.get("/works", async (c) => {
  const db = c.env.DB;

  // Bound like `/runs`'s outcome: an unknown status matches nothing rather than being rejected.
  const status = c.req.query("status") || undefined;
  const where = status ? "WHERE enrichment_status = ?" : "";
  const binds = status ? [status] : [];
  const limit = listLimit(c.req.query("limit"));

  const LAST_ATTEMPT = EPOCH_MS(
    "COALESCE(enrichment_failed_at, series_checked_at)",
  );
  const ORDER = "last_attempt_at IS NULL, last_attempt_at DESC, id DESC";

  const [rows, count] = await Promise.all([
    // The ordering and the limit are taken in a CTE, and the title fallback resolved over the
    // ≤ MAX_LIST_LIMIT survivors. Unlike `/runs`, that ORDER BY has no index behind it, so SQLite builds each row's
    // payload *before* the sort decides whether to keep it — inline, the `books` lookup would fire
    // once per scanned row rather than once per returned one. The LIMIT inside the CTE is also what
    // stops the optimizer flattening it back into the outer query; the outer ORDER BY restates the
    // order because a scan of a subquery doesn't guarantee it.
    db
      .prepare(
        `WITH picked AS (
           SELECT id, canonical_title, enrichment_status, enrichment_attempts,
                  enrichment_failure_reason, wikidata_qid,
                  ${LAST_ATTEMPT} AS last_attempt_at,
                  ${EPOCH_MS("next_retry_at")} AS next_retry_at
           FROM works
           ${where}
           ORDER BY ${ORDER}
           LIMIT ?
         )
         SELECT id, enrichment_status, enrichment_attempts, enrichment_failure_reason,
                wikidata_qid, last_attempt_at, next_retry_at,
                ${WORK_TITLE("canonical_title", "picked.id")} AS title
         FROM picked
         ORDER BY ${ORDER}`,
      )
      .bind(...binds, limit)
      .all<{
        id: number;
        enrichment_status: string;
        enrichment_attempts: number;
        enrichment_failure_reason: string | null;
        wikidata_qid: string | null;
        title: string | null;
        last_attempt_at: number | null;
        next_retry_at: number | null;
      }>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM works ${where}`)
      .bind(...binds)
      .first<{ total: number }>(),
  ]);

  return c.json({
    total: count?.total ?? 0,
    works: rows.results.map((w) => ({
      id: w.id,
      title: w.title,
      status: w.enrichment_status,
      attempts: w.enrichment_attempts,
      failureReason: w.enrichment_failure_reason,
      // Same judgement the run summary carries, so a reason means one thing across the board.
      transient: isTransientFailure(w.enrichment_failure_reason ?? ""),
      // Null when Wikidata never matched this work — which is itself the diagnosis for a good
      // share of the failures, so it ships rather than being inferred from the reason.
      wikidataQid: w.wikidata_qid,
      lastAttemptAt: w.last_attempt_at,
      nextRetryAt: w.next_retry_at,
    })),
  });
});

/**
 * External-API call counters for the selected window, plus the number that actually matters:
 * how many Google Books calls today's UTC day has spent against the daily quota.
 */
admin.get("/usage", async (c) => {
  const db = c.env.DB;
  const requested = Number(c.req.query("hours"));
  // Clamped at both ends, like `listLimit`. The lower bound is not cosmetic: `requested > 0`
  // admitted any fraction below 1, which `Math.trunc` then turned into 0, and `from` became
  // `usageHourStart(now) + HOUR_MS` — an hour into the future, matching no rows. The chart and the
  // per-provider totals came back empty while the quota gauge (its own query) showed real numbers,
  // which reads as "no external calls at all" rather than as a bad parameter.
  const hours =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_USAGE_HOURS)
      : DEFAULT_USAGE_HOURS;

  const now = Date.now();
  // The same bucket boundaries the counters are written on — `usage.ts` owns both, so reading them
  // back cannot drift from writing them, and the sweeper's spend guard measures the same day this
  // gauge does. Google resets the quota on Pacific time; a UTC day is a close enough proxy for a
  // gauge whose job is "are we about to run out", and it keeps the bucket arithmetic trivial.
  const from = usageHourStart(now) - (hours - 1) * HOUR_MS;
  const utcDayStart = usageDayStart(now);

  // One scan of the window answers all three questions. A `GROUP BY provider, operation` over the
  // same predicate would read the identical rows a second time, and today's Google calls are a
  // sub-range of the window whenever it reaches back past UTC midnight — which every range the
  // board offers does. Only a sub-day window needs the extra query.
  const { results } = await db
    .prepare(
      `SELECT hour_start, provider, operation, success, error, rate_limited
       FROM api_usage WHERE hour_start >= ? ORDER BY hour_start`,
    )
    .bind(from)
    .all<{
      hour_start: number;
      provider: string;
      operation: string;
      success: number;
      error: number;
      rate_limited: number;
    }>();

  // One pass answers all three. `series` is folded to (hour, provider) rather than shipped raw:
  // the chart stacks by provider only, so the operation and outcome splits would be up to 3× the
  // rows for a dimension the only consumer discards — `totals` is where those splits are read.
  const byEndpoint = new Map<
    string,
    {
      provider: string;
      operation: string;
      success: number;
      error: number;
      rateLimited: number;
    }
  >();
  const byHour = new Map<
    string,
    { hourStart: number; provider: string; calls: number }
  >();
  let googleToday = 0;
  for (const r of results) {
    const calls = r.success + r.error + r.rate_limited;

    const endpointKey = `${r.provider} ${r.operation}`;
    const endpoint = byEndpoint.get(endpointKey) ?? {
      provider: r.provider,
      operation: r.operation,
      success: 0,
      error: 0,
      rateLimited: 0,
    };
    endpoint.success += r.success;
    endpoint.error += r.error;
    endpoint.rateLimited += r.rate_limited;
    byEndpoint.set(endpointKey, endpoint);

    const hourKey = `${r.hour_start} ${r.provider}`;
    const hour = byHour.get(hourKey) ?? {
      hourStart: r.hour_start,
      provider: r.provider,
      calls: 0,
    };
    hour.calls += calls;
    byHour.set(hourKey, hour);

    if (r.provider === "google_books" && r.hour_start >= utcDayStart) {
      googleToday += calls;
    }
  }

  if (from > utcDayStart) {
    googleToday = await googleBooksCallsToday(db, now);
  }

  return c.json({
    hours,
    fromHour: from,
    series: [...byHour.values()],
    totals: [...byEndpoint.values()].sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        a.operation.localeCompare(b.operation),
    ),
    googleBooksToday: { calls: googleToday, utcDayStart },
  });
});

/**
 * Every registered user with their activity. Unpaginated on purpose — this is a single-owner
 * instance whose user base is countable by hand; add paging only if that stops being true.
 */
admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.firstname, u.is_admin,
            ${EPOCH_MS("u.created_at")} AS created_at,
            COUNT(s.id) AS scan_count,
            ${EPOCH_MS("MAX(s.created_at)")} AS last_scan_at
     FROM users u LEFT JOIN scans s ON s.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  ).all<{
    id: number;
    email: string;
    firstname: string | null;
    created_at: number;
    is_admin: number;
    scan_count: number;
    last_scan_at: number | null;
  }>();

  return c.json({
    users: results.map((u) => ({
      id: u.id,
      email: u.email,
      firstname: u.firstname,
      createdAt: u.created_at,
      isAdmin: u.is_admin === 1,
      scanCount: u.scan_count,
      lastScanAt: u.last_scan_at,
    })),
  });
});

export default admin;
