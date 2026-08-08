// Global hourly counters for outbound external-API calls, backing the admin page's usage panel.
// The Google Books project has a hard daily query quota and nothing counted against it before
// this — `enrichment_runs` covers Wikidata outcomes only, and a `search_cache` row proves a search
// happened but says nothing about ISBN lookups, retries or failures.
//
// Deliberately global (no user_id): the quota is a shared resource, and threading a user through
// `editions.ts`/`enrichment.ts` — which are also called from the cron sweeper, where there is no
// user — would buy a dimension nothing asks for yet.

import type { MiddlewareHandler } from "hono";
import type { Env } from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type UsageProvider = "google_books" | "openlibrary" | "wikidata";

/**
 * Every operation label the counters recognise, as a closed union rather than a bare `string`.
 *
 * The `api_usage` primary key is `(hour_start, provider, operation)`, so a mistyped literal does
 * not fail — it silently creates a *new* row nobody reads and drops the increment from the row the
 * board actually charts. Writing `"isbn-lookup"` for `"isbn_lookup"` would compile, run, and split
 * the panel's per-operation totals in two, with no type error, no test failure and no runtime
 * signal. The values are a contract with `worker/migrations/CLAUDE.md`, so they live here and the
 * per-provider subsets below narrow from them.
 */
export type UsageOperation =
  // google_books
  | "isbn_lookup" // also openlibrary — the same logical lookup against either source
  | "title_search"
  // openlibrary
  | "editions"
  // wikidata — `SparqlOperation` in enrichment.ts is exactly these
  | "entity_search"
  | "book_search"
  | "book_hydrate"
  | "labels"
  | "work_details"
  | "series_members"
  | "edition_isbn";

export type UsageOutcome = "success" | "error" | "rate_limited";

/**
 * The ms-epoch UTC hour bucket a timestamp falls in — same construction as `rate_limits`'
 * window_start, and inherently UTC, so no timezone handling is needed on either side.
 */
export function usageHourStart(nowMs: number): number {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
}

/**
 * The ms-epoch UTC day a timestamp falls in — the bucket the Google Books daily quota is measured
 * over. Google actually resets on Pacific time, so this is a deliberate approximation (see
 * `GET /api/admin/usage`); it keeps the arithmetic in the same dialect as `usageHourStart`, and an
 * hour bucket always falls entirely inside one day bucket, so summing hours per day is exact.
 */
export function usageDayStart(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS) * DAY_MS;
}

/**
 * Google Books calls already spent against today's quota. Reads the same hourly counters the admin
 * gauge displays, so an enforcement decision and the board's picture can't disagree.
 *
 * Lags by up to one unit of work: `record()` buffers in memory until `flush()`, so calls made by
 * the caller's own recorder are not visible here yet. That is fine for a budget check — the
 * overshoot is bounded by one sweeper tick's worth of calls.
 */
export async function googleBooksCallsToday(
  db: D1Database,
  nowMs: number = Date.now(),
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(success + error + rate_limited), 0) AS calls
       FROM api_usage WHERE provider = 'google_books' AND hour_start >= ?`,
    )
    .bind(usageDayStart(nowMs))
    .first<{ calls: number }>();
  return row?.calls ?? 0;
}

/**
 * Maps an HTTP status to a counter column. A 429 is split out from other failures because it's
 * the one that means "we hit a limit" rather than "the call went wrong"; everything else non-2xx
 * is an error. Callers whose 404 is a legitimate answer rather than a failure (OpenLibrary's
 * "ISBN unknown") classify that case themselves before calling this.
 */
export function outcomeForStatus(status: number): UsageOutcome {
  if (status === 429) return "rate_limited";
  return status >= 200 && status < 300 ? "success" : "error";
}

type Bucket = {
  hourStart: number;
  provider: UsageProvider;
  operation: string;
  success: number;
  error: number;
  rateLimited: number;
};

const UPSERT = `INSERT INTO api_usage (hour_start, provider, operation, success, error, rate_limited)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(hour_start, provider, operation) DO UPDATE SET
     success      = success + excluded.success,
     error        = error + excluded.error,
     rate_limited = rate_limited + excluded.rate_limited`;

/**
 * Buffers counter increments for one unit of work and writes them once at the end.
 *
 * `record` is synchronous on purpose. Writing each increment as it happened put an awaited D1
 * round-trip in front of every outbound call's result: a 10-row Goodreads batch is 30 external
 * fetches, so it paid 30 serialized writes — and with `ROW_CONCURRENCY = 4` several of those
 * contended on the *same* `api_usage` row (same hour, same provider, same operation), which
 * SQLite serializes on top of the round-trip. A batch collapses that to one statement per
 * distinct (hour, provider, operation), off the critical path.
 *
 * The hour bucket is stamped at `record` time, not at flush time, so a unit of work spanning an
 * hour boundary still lands its calls in the hours they actually happened in.
 */
export class UsageRecorder {
  private readonly buckets = new Map<string, Bucket>();
  private fetches = 0;

  /** `db` is nullable so the fetch helpers can run in contexts without a handle (unit tests). */
  constructor(private readonly db: D1Database | null | undefined) {}

  /** External HTTP requests made so far in this invocation — see `countFetch`. */
  get externalCalls(): number {
    return this.fetches;
  }

  /**
   * One outbound HTTP request, counted for the **subrequest budget** rather than for the board.
   *
   * Deliberately separate from `record`, and called from the two fetch helpers themselves
   * (`fetchWithTimeout`, `fetchWikidataJson`) rather than from their callers:
   *
   * - `record` counts *units of work* at the granularity the board reads, which is not 1:1 with
   *   requests — `fetchOpenLibraryBibkey` issues two fetches and records one `isbn_lookup`, and the
   *   work-description fetch records nothing at all. Metering off it would undercount.
   * - Counting inside the helpers means a new call site cannot forget to be counted, which is the
   *   property a budget needs. It also counts unconditionally, including calls whose telemetry the
   *   caller skips.
   *
   * Free-plan Workers allow **50 external subrequests** per invocation (Cloudflare services like D1
   * have their own 1,000, so queries don't compete). `externalCalls` is what `sweeper.ts` meters its
   * batch against; nothing else should read it.
   */
  countFetch(): void {
    this.fetches++;
  }

  record(
    provider: UsageProvider,
    operation: UsageOperation,
    outcome: UsageOutcome,
  ): void {
    if (!this.db) return;
    const hourStart = usageHourStart(Date.now());
    const key = `${hourStart}|${provider}|${operation}`;
    let b = this.buckets.get(key);
    if (!b) {
      b = {
        hourStart,
        provider,
        operation,
        success: 0,
        error: 0,
        rateLimited: 0,
      };
      this.buckets.set(key, b);
    }
    if (outcome === "success") b.success++;
    else if (outcome === "error") b.error++;
    else b.rateLimited++;
  }

  /**
   * Best-effort. Swallows every failure: a metrics write must never fail — or be able to fail —
   * the operation it measures. Safe to call more than once; the buffer is drained first, so a
   * second flush after further recording writes only what's new.
   */
  async flush(): Promise<void> {
    const db = this.db;
    if (!db || this.buckets.size === 0) return;
    const pending = [...this.buckets.values()];
    this.buckets.clear();
    try {
      await db.batch(
        pending.map((b) =>
          db
            .prepare(UPSERT)
            .bind(
              b.hourStart,
              b.provider,
              b.operation,
              b.success,
              b.error,
              b.rateLimited,
            ),
        ),
      );
    } catch (e) {
      console.error("[usage] failed to record", pending.length, "bucket(s)", e);
    }
  }
}

/**
 * Gives every request a recorder on `c.get("usage")` and flushes it after the handler returns,
 * via `waitUntil` so the write never delays the response. Mounted once in `index.ts` rather than
 * per route, so a route that reaches an instrumented fetch helper can't forget the flush.
 *
 * Work that outlives the response — `enrichWork` under `waitUntil`, the cron sweeper — is *not*
 * covered by this: it records after this flush has already run. Those own their own recorder,
 * see `enrichWorkDetached` and `sweeper.ts`.
 */
export const usageMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  const usage = new UsageRecorder(c.env.DB);
  c.set("usage", usage);
  try {
    await next();
  } finally {
    c.executionCtx.waitUntil(usage.flush());
  }
};
