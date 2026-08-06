import { Hono } from "hono";
import type { Env } from "../types";
import { adminMiddleware, authMiddleware } from "../auth";
import { googleBooksCallsToday, usageDayStart, usageHourStart } from "../usage";
import { isTransientFailure } from "../enrichment";

const admin = new Hono<Env>();
// Both, in this order: adminMiddleware reads the userId authMiddleware sets.
admin.use("*", authMiddleware, adminMiddleware);

const HOUR_MS = 3_600_000;
// Widest window the usage endpoint will serve. 14 days is well inside the sweeper's 90-day
// retention and keeps the row count returned to the page bounded.
const MAX_USAGE_HOURS = 336;
const DEFAULT_USAGE_HOURS = 48;

/**
 * A D1 `datetime('now')` column as ms-epoch. Every timestamp this API returns goes through it, so
 * the board speaks one dialect: `api_usage.hour_start` is already ms-epoch, and shipping the other
 * columns as bare `YYYY-MM-DD HH:MM:SS` would hand the client a string `Date.parse` reads as
 * *local* time — a normalization the caller has to remember, and therefore one it will forget.
 * Second resolution, which is all `datetime('now')` stores and all a relative label needs.
 */
const EPOCH_MS = (column: string) =>
  `CAST(strftime('%s', ${column}) AS INTEGER) * 1000`;

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
 * Headline numbers for the board. Everything here is a COUNT or a small GROUP BY over an indexed
 * column, so the whole endpoint is cheap enough to re-run on every Refresh.
 */
admin.get("/overview", async (c) => {
  const db = c.env.DB;

  // One day of `enrichment_runs` is up to BATCH_SIZE × 30 × 24 ≈ 5k rows whenever the backlog is
  // non-empty — which is exactly the state this page gets opened to look at — so the summary is
  // aggregated in SQL rather than streamed out and reduced in the isolate.
  const RUNS_WINDOW = "created_at >= datetime('now', '-1 day')";

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
 * External-API call counters for the selected window, plus the number that actually matters:
 * how many Google Books calls today's UTC day has spent against the daily quota.
 */
admin.get("/usage", async (c) => {
  const db = c.env.DB;
  const requested = Number(c.req.query("hours"));
  const hours =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), MAX_USAGE_HOURS)
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
