/** Response shapes for `/api/admin/*` — the admin status board. */

/**
 * One fetched surface: its payload, whether a request is in flight, and the last failure. Every
 * section and dialog on the board is one of these, so `AdminSection` can own the load/fail/retry
 * convention for all of them.
 */
export type Section<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

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
 * One failed `enrichment_runs` row, as `GET /api/admin/runs` returns it — the drill-down behind the
 * vitals panel's failure counts. Every timestamp is ms-epoch, like the rest of `/api/admin/*`.
 */
export type AdminRunRow = {
  id: number;
  workId: number;
  /** `works.canonical_title`, falling back to any edition's title; null if neither exists. */
  workTitle: string | null;
  startedAt: number;
  durationMs: number;
  failureReason: string | null;
  /** Same `RETRY_POLICY` judgement the summary's `failureReasons` carry. */
  transient: boolean;
  source: string;
  /**
   * The work as it stands *now*, not as it was at run time — whether a failure is still being
   * retried is the question a failed run raises. Null when the work row is gone (a merge).
   */
  workStatus: string | null;
  workAttempts: number | null;
  /** When the sweeper will pick the work up again; null = due immediately. */
  workNextRetryAt: number | null;
};

export type AdminRuns = {
  /** The window the list covers — fixed at the summary's 24h, so the two always agree. */
  hours: number;
  /** Matching rows in the window, before the limit — so a truncated list can say so. */
  total: number;
  runs: AdminRunRow[];
};

/**
 * One `works` row, as `GET /api/admin/works` returns it — the drill-down behind the vitals panel's
 * enrichment bar. Every timestamp is ms-epoch, like the rest of `/api/admin/*`.
 */
export type AdminWorkRow = {
  id: number;
  /** `canonical_title`, falling back to any edition's title; null if neither exists. */
  title: string | null;
  /** `works.enrichment_status` — `pending` | `done` | `failed` | `exhausted`. */
  status: string;
  attempts: number;
  /** The last failure's reason; null for a work that has never failed. */
  failureReason: string | null;
  transient: boolean;
  /** Null when Wikidata never matched this work — often the diagnosis by itself. */
  wikidataQid: string | null;
  /** Last failure or last success, whichever is later; null if never attempted. */
  lastAttemptAt: number | null;
  /** When the sweeper picks it up again; null = due immediately (or not scheduled). */
  nextRetryAt: number | null;
};

export type AdminWorks = {
  /** Works matching the status filter, before the limit — so a truncated list can say so. */
  total: number;
  works: AdminWorkRow[];
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
