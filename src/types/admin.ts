/** Response shapes for `/api/admin/*` — the admin status board. */

export type AdminOverview = {
  totalUsers: number;
  newUsers7d: number;
  totalScans: number;
  scans7d: number;
  totalBooks: number;
  totalWorks: number;
  enrichment: {
    pending: number;
    done: number;
    failed: number;
    exhausted: number;
  };
  enrichmentRuns24h: {
    total: number;
    byOutcome: { done: number; not_found: number; failed: number };
    /**
     * `transient: true` means upstream pressure rather than a broken query — the worker's own
     * `RETRY_POLICY` decides which is which, so the board never has to restate that judgement.
     */
    failureReasons: { reason: string; count: number; transient: boolean }[];
    avgDurationMs: number;
    p95DurationMs: number;
  };
  /** Whether the cron is keeping up — see `sweeperLevel` for how the two combine. */
  sweeper: {
    /** Works a tick would pick up right now, by the sweeper's own due predicate. */
    dueCount: number;
    /** ms-epoch of the most recent `enrichment_runs` row; null if there are none. */
    lastRunAt: number | null;
  };
};

/**
 * One hour's call count for one provider. Hours with no calls have no row, and the per-operation
 * and per-outcome splits live in `totals` — the chart stacks by provider only, so the worker folds
 * the raw counter rows before they cross the wire.
 */
export type UsageBucket = {
  /** ms-epoch start of the UTC hour. */
  hourStart: number;
  provider: string;
  calls: number;
};

export type UsageTotal = {
  provider: string;
  operation: string;
  success: number;
  error: number;
  rateLimited: number;
};

export type AdminUsage = {
  hours: number;
  fromHour: number;
  series: UsageBucket[];
  totals: UsageTotal[];
  googleBooksToday: { calls: number; utcDayStart: number };
};

/** Both timestamps are ms-epoch — the admin API never ships a raw D1 datetime string. */
export type AdminUserRow = {
  id: number;
  email: string;
  firstname: string | null;
  createdAt: number;
  isAdmin: boolean;
  scanCount: number;
  lastScanAt: number | null;
};
