/**
 * Pure derivations for the admin status board. Everything the page shows beyond a raw count is
 * computed here so it can be unit-tested without mounting anything.
 */
import type { UsageBucket } from "@/types/admin";

const HOUR_MS = 3_600_000;

/** The three providers `api_usage` records, in the order the chart stacks them. */
export const USAGE_PROVIDERS = [
  "google_books",
  "openlibrary",
  "wikidata",
] as const;

export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

/**
 * Google Books' daily query cap. Display-only — nothing enforces it here; it's the number the
 * gauge measures against, and it lives client-side because only the gauge cares.
 */
export const GOOGLE_BOOKS_DAILY_QUOTA = 1000;

/** Fraction of the quota at which the gauge switches from "fine" to "watch this". */
export const QUOTA_WARN_PERCENT = 80;
const QUOTA_CRITICAL_PERCENT = 95;

export type QuotaLevel = "ok" | "warning" | "critical";

export function quotaLevel(
  used: number,
  limit = GOOGLE_BOOKS_DAILY_QUOTA,
): QuotaLevel {
  const pct = limit > 0 ? (used / limit) * 100 : 0;
  if (pct >= QUOTA_CRITICAL_PERCENT) return "critical";
  if (pct >= QUOTA_WARN_PERCENT) return "warning";
  return "ok";
}

/**
 * Where the day lands if the rest of it looks like the part already elapsed. Deliberately naive —
 * usage is bursty and this is a hint, not a forecast. Returns null before enough of the day has
 * passed for the extrapolation to mean anything (the first few minutes would project wildly).
 */
export function projectEndOfDay(
  used: number,
  nowMs: number,
  utcDayStartMs: number,
): number | null {
  const elapsed = nowMs - utcDayStartMs;
  if (elapsed < 30 * 60_000) return null;
  const fractionElapsed = elapsed / 86_400_000;
  return Math.round(used / fractionElapsed);
}

export type HourColumn = {
  hourStart: number;
  google_books: number;
  openlibrary: number;
  wikidata: number;
  total: number;
};

/**
 * Expands the sparse per-provider/operation rows into one column per hour across the whole
 * window. Hours with no calls get a zeroed column rather than being dropped — a gap in activity
 * is information, and a chart that silently closes it lies about when things happened.
 */
export function buildHourColumns(
  series: UsageBucket[],
  fromHour: number,
  hours: number,
): HourColumn[] {
  const columns = new Map<number, HourColumn>();
  for (let i = 0; i < hours; i++) {
    const hourStart = fromHour + i * HOUR_MS;
    columns.set(hourStart, {
      hourStart,
      google_books: 0,
      openlibrary: 0,
      wikidata: 0,
      total: 0,
    });
  }

  for (const row of series) {
    const col = columns.get(row.hourStart);
    // A row outside the requested window (clock skew, a stale response) is ignored rather than
    // appended — the columns define the axis.
    if (!col) continue;
    const calls = row.success + row.error + row.rateLimited;
    if ((USAGE_PROVIDERS as readonly string[]).includes(row.provider)) {
      col[row.provider as UsageProvider] += calls;
    }
    col.total += calls;
  }

  return [...columns.values()].sort((a, b) => a.hourStart - b.hourStart);
}

/** Per-provider call totals across the window, for the chart legend. */
export function providerTotals(
  columns: HourColumn[],
): Record<UsageProvider, number> {
  const out = { google_books: 0, openlibrary: 0, wikidata: 0 };
  for (const c of columns) {
    for (const p of USAGE_PROVIDERS) out[p] += c[p];
  }
  return out;
}

/** The busiest hour in the window, or null when nothing was recorded. */
export function peakHour(columns: HourColumn[]): HourColumn | null {
  let best: HourColumn | null = null;
  for (const c of columns) {
    if (c.total > 0 && (!best || c.total > best.total)) best = c;
  }
  return best;
}

/**
 * Bar height as a percentage of the tallest column. Non-zero values get a floor so a single call
 * still paints something visible instead of a sub-pixel sliver.
 */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, (value / max) * 100);
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Milliseconds as a compact duration: "840 ms", "1.9 s". */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400_000],
  ["month", 30 * 86_400_000],
  ["week", 7 * 86_400_000],
  ["day", 86_400_000],
  ["hour", HOUR_MS],
  ["minute", 60_000],
];

/**
 * A SQLite `datetime('now')` timestamp as localized relative time ("3 hours ago"). Returns null
 * for a null/unparseable input so the caller can show its own "never" string.
 *
 * D1 stores those timestamps as `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker, which
 * `Date.parse` reads as *local* time — hence the explicit normalization before parsing.
 */
export function relativeTime(
  timestamp: string | null,
  nowMs: number,
  bcp47: string,
): string | null {
  if (!timestamp) return null;
  const iso = timestamp.includes("T")
    ? timestamp
    : `${timestamp.replace(" ", "T")}Z`;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;

  const diff = then - nowMs;
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat(bcp47, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return fmt.format(Math.round(diff / 1000), "second");
}

/** Milliseconds since a timestamp, or null when it's absent/unparseable. */
export function ageMs(timestamp: string | null, nowMs: number): number | null {
  if (!timestamp) return null;
  const iso = timestamp.includes("T")
    ? timestamp
    : `${timestamp.replace(" ", "T")}Z`;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? null : nowMs - then;
}
