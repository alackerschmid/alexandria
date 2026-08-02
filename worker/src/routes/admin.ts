import { Hono } from "hono";
import type { Env } from "../types";
import { adminMiddleware, authMiddleware } from "../auth";

const admin = new Hono<Env>();
// Both, in this order: adminMiddleware reads the userId authMiddleware sets.
admin.use("*", authMiddleware, adminMiddleware);

const HOUR_MS = 3_600_000;
// Widest window the usage endpoint will serve. 14 days is well inside the sweeper's 90-day
// retention and keeps the row count returned to the page bounded.
const MAX_USAGE_HOURS = 336;
const DEFAULT_USAGE_HOURS = 48;

/**
 * Headline numbers for the board. Everything here is a COUNT or a small GROUP BY over an indexed
 * column, so the whole endpoint is cheap enough to re-run on every Refresh.
 */
admin.get("/overview", async (c) => {
  const db = c.env.DB;

  const [counts, enrichment, runs] = await Promise.all([
    db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM users)  AS total_users,
           (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 days')) AS new_users_7d,
           (SELECT COUNT(*) FROM scans)  AS total_scans,
           (SELECT COUNT(*) FROM scans WHERE created_at >= datetime('now', '-7 days')) AS scans_7d,
           (SELECT COUNT(*) FROM books)  AS total_books,
           (SELECT COUNT(*) FROM works)  AS total_works`,
      )
      .first<{
        total_users: number;
        new_users_7d: number;
        total_scans: number;
        scans_7d: number;
        total_books: number;
        total_works: number;
      }>(),
    db
      .prepare(
        "SELECT enrichment_status, COUNT(*) AS count FROM works GROUP BY enrichment_status",
      )
      .all<{ enrichment_status: string; count: number }>(),
    // The raw durations rather than an aggregate: a day's worth is a few hundred rows at most,
    // and p95 in JS beats bending SQLite into a percentile. Uses idx_enrichment_runs_created.
    db
      .prepare(
        `SELECT outcome, failure_reason, duration_ms
         FROM enrichment_runs
         WHERE created_at >= datetime('now', '-1 day')`,
      )
      .all<{
        outcome: string;
        failure_reason: string | null;
        duration_ms: number;
      }>(),
  ]);

  const byStatus = Object.fromEntries(
    enrichment.results.map((r) => [r.enrichment_status, r.count]),
  );

  const runRows = runs.results;
  const byOutcome: Record<string, number> = {};
  const failureReasons: Record<string, number> = {};
  for (const r of runRows) {
    byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    if (r.outcome === "failed") {
      const reason = r.failure_reason ?? "other";
      failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    }
  }
  const durations = runRows.map((r) => r.duration_ms).sort((a, b) => a - b);
  const avgDurationMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;
  // Nearest-rank p95: index of the first value at or above the 95th percentile.
  const p95DurationMs = durations.length
    ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)]
    : 0;

  return c.json({
    totalUsers: counts?.total_users ?? 0,
    newUsers7d: counts?.new_users_7d ?? 0,
    totalScans: counts?.total_scans ?? 0,
    scans7d: counts?.scans_7d ?? 0,
    totalBooks: counts?.total_books ?? 0,
    totalWorks: counts?.total_works ?? 0,
    enrichment: {
      pending: byStatus.pending ?? 0,
      done: byStatus.done ?? 0,
      failed: byStatus.failed ?? 0,
      exhausted: byStatus.exhausted ?? 0,
    },
    enrichmentRuns24h: {
      total: runRows.length,
      byOutcome: {
        done: byOutcome.done ?? 0,
        not_found: byOutcome.not_found ?? 0,
        failed: byOutcome.failed ?? 0,
      },
      failureReasons: Object.entries(failureReasons)
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
      avgDurationMs,
      p95DurationMs,
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
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  // Inclusive of the current (partial) hour, so `hours` buckets come back in total.
  const from = currentHour - (hours - 1) * HOUR_MS;

  // Google resets the quota on Pacific time; a UTC day is a close enough proxy for a gauge
  // whose job is "are we about to run out", and it keeps the bucket arithmetic trivial.
  const d = new Date(now);
  const utcDayStart = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
  );

  const [series, totals, googleToday] = await Promise.all([
    db
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
      }>(),
    db
      .prepare(
        `SELECT provider, operation,
                SUM(success) AS success, SUM(error) AS error, SUM(rate_limited) AS rate_limited
         FROM api_usage WHERE hour_start >= ?
         GROUP BY provider, operation
         ORDER BY provider, operation`,
      )
      .bind(from)
      .all<{
        provider: string;
        operation: string;
        success: number;
        error: number;
        rate_limited: number;
      }>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(success + error + rate_limited), 0) AS calls
         FROM api_usage WHERE provider = 'google_books' AND hour_start >= ?`,
      )
      .bind(utcDayStart)
      .first<{ calls: number }>(),
  ]);

  return c.json({
    hours,
    fromHour: from,
    series: series.results.map((r) => ({
      hourStart: r.hour_start,
      provider: r.provider,
      operation: r.operation,
      success: r.success,
      error: r.error,
      rateLimited: r.rate_limited,
    })),
    totals: totals.results.map((r) => ({
      provider: r.provider,
      operation: r.operation,
      success: r.success,
      error: r.error,
      rateLimited: r.rate_limited,
    })),
    googleBooksToday: {
      calls: googleToday?.calls ?? 0,
      utcDayStart,
    },
  });
});

/**
 * Every registered user with their activity. Unpaginated on purpose — this is a single-owner
 * instance whose user base is countable by hand; add paging only if that stops being true.
 */
admin.get("/users", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.firstname, u.created_at, u.is_admin,
            COUNT(s.id) AS scan_count, MAX(s.created_at) AS last_scan_at
     FROM users u LEFT JOIN scans s ON s.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
  ).all<{
    id: number;
    email: string;
    firstname: string | null;
    created_at: string;
    is_admin: number;
    scan_count: number;
    last_scan_at: string | null;
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
