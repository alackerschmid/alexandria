// Global hourly counters for outbound external-API calls, backing the admin page's usage panel.
// The Google Books project has a hard daily query quota and nothing counted against it before
// this — `enrichment_runs` covers Wikidata outcomes only, and a `search_cache` row proves a search
// happened but says nothing about ISBN lookups, retries or failures.
//
// Deliberately global (no user_id): the quota is a shared resource, and threading a user through
// `editions.ts`/`enrichment.ts` — which are also called from the cron sweeper, where there is no
// user — would buy a dimension nothing asks for yet.

const HOUR_MS = 3_600_000;

export type UsageProvider = "google_books" | "openlibrary" | "wikidata";

export type UsageOutcome = "success" | "error" | "rate_limited";

/**
 * The ms-epoch UTC hour bucket a timestamp falls in — same construction as `rate_limits`'
 * window_start, and inherently UTC, so no timezone handling is needed on either side.
 */
export function usageHourStart(nowMs: number): number {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
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

/**
 * Best-effort increment of one hourly counter. Swallows every failure: a metrics write must never
 * fail — or be able to fail — the operation it measures. `db` is nullable so the fetch helpers can
 * still be called from contexts without a handle (unit tests) and simply record nothing.
 */
export async function recordApiUsage(
  db: D1Database | null | undefined,
  provider: UsageProvider,
  operation: string,
  outcome: UsageOutcome,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO api_usage (hour_start, provider, operation, success, error, rate_limited)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(hour_start, provider, operation) DO UPDATE SET
           success      = success + excluded.success,
           error        = error + excluded.error,
           rate_limited = rate_limited + excluded.rate_limited`,
      )
      .bind(
        usageHourStart(Date.now()),
        provider,
        operation,
        outcome === "success" ? 1 : 0,
        outcome === "error" ? 1 : 0,
        outcome === "rate_limited" ? 1 : 0,
      )
      .run();
  } catch (e) {
    console.error("[usage] failed to record", provider, operation, e);
  }
}
