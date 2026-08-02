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
    failureReasons: { reason: string; count: number }[];
    avgDurationMs: number;
    p95DurationMs: number;
  };
};

/** One hour's counters for one provider+operation. Hours with no calls have no row. */
export type UsageBucket = {
  /** ms-epoch start of the UTC hour. */
  hourStart: number;
  provider: string;
  operation: string;
  success: number;
  error: number;
  rateLimited: number;
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

export type AdminUserRow = {
  id: number;
  email: string;
  firstname: string | null;
  createdAt: string;
  isAdmin: boolean;
  scanCount: number;
  lastScanAt: string | null;
};
