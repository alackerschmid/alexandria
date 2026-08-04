/**
 * Pure derivations for the admin status board. Everything the page shows beyond a raw count is
 * computed here so it can be unit-tested without mounting anything.
 */
import type { AdminOverview, UsageBucket, UsageTotal } from "@/types/admin";
import { sweeperLevel } from "@/utils/admin-signal";
import type { SignalLevel } from "@/utils/admin-signal";

const HOUR_MS = 3_600_000;

/** The three providers `api_usage` records, in the order the chart stacks them. */
export const USAGE_PROVIDERS = [
  "google_books",
  "openlibrary",
  "wikidata",
] as const;

export type UsageProvider = (typeof USAGE_PROVIDERS)[number];

/**
 * Windows the chart offers, and the source of the page's default. The worker clamps `hours` to
 * its own maximum; this is the picker, not the enforcement point.
 */
export const USAGE_RANGES = [
  { hours: 24, label: "24h", unit: "hours" },
  { hours: 48, label: "48h", unit: "hours" },
  { hours: 168, label: "7d", unit: "days" },
] as const;

export const DEFAULT_USAGE_HOURS = 48;

/** Which of `admin.range.*` describes a window — the picker's own unit, not a magic threshold. */
export function rangeUnit(hours: number): "hours" | "days" {
  return USAGE_RANGES.find((r) => r.hours === hours)?.unit ?? "hours";
}

/**
 * Google Books' daily query cap. Display-only — nothing enforces it here; it's the number the
 * gauge measures against, and it lives client-side because only the gauge cares.
 */
export const GOOGLE_BOOKS_DAILY_QUOTA = 1000;

/** Fraction of the quota at which the gauge switches from "fine" to "watch this". */
export const QUOTA_WARN_PERCENT = 80;
const QUOTA_CRITICAL_PERCENT = 95;

export function quotaLevel(
  used: number,
  limit = GOOGLE_BOOKS_DAILY_QUOTA,
): Exclude<SignalLevel, "neutral"> {
  const pct = percent(used, limit);
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

/** Every HTTP call a counter row stands for, whatever it resulted in. */
export const totalCalls = (r: UsageTotal): number =>
  r.success + r.error + r.rateLimited;

export type HourColumn = {
  hourStart: number;
  google_books: number;
  openlibrary: number;
  wikidata: number;
  total: number;
};

/**
 * Expands the sparse per-hour/provider rows into one column per hour across the whole window.
 * Hours with no calls get a zeroed column rather than being dropped — a gap in activity is
 * information, and a chart that silently closes it lies about when things happened.
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
    if ((USAGE_PROVIDERS as readonly string[]).includes(row.provider)) {
      col[row.provider as UsageProvider] += row.calls;
    }
    col.total += row.calls;
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

/**
 * The busiest hour in the window, or null when nothing was recorded. `pick` chooses what
 * "busiest" measures — the quota gauge reads one provider, the chart reads the total, and the
 * two must not be confused: an hour dominated by Wikidata says nothing about Google Books.
 */
export function peakHour(
  columns: HourColumn[],
  pick: (c: HourColumn) => number,
): { hourStart: number; value: number } | null {
  let best: { hourStart: number; value: number } | null = null;
  for (const c of columns) {
    const value = pick(c);
    if (value > 0 && (!best || value > best.value)) {
      best = { hourStart: c.hourStart, value };
    }
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

/**
 * The enrichment bar and the percentage above it, from one definition of the total. Measured
 * against the tracked statuses rather than `totalWorks`, so the headline percentage, the segments
 * and the top-strip pip can't disagree about what "done" is a share of. Segments carry the status
 * key only — the colour comes from `statusBg` in `admin-signal.ts`.
 */
export function enrichmentBreakdown(e: AdminOverview["enrichment"]): {
  total: number;
  donePercent: number;
  /** `failed` + `exhausted` — the works that will not enrich without intervention. */
  terminalCount: number;
  terminalPercent: number;
  segments: { key: string; count: number; percent: number }[];
} {
  const total = e.done + e.pending + e.failed + e.exhausted;
  const segments = [
    { key: "done", count: e.done },
    { key: "pending", count: e.pending },
    { key: "failed", count: e.failed },
    { key: "exhausted", count: e.exhausted },
  ];
  const terminalCount = e.failed + e.exhausted;
  return {
    total,
    donePercent: percent(e.done, total),
    terminalCount,
    terminalPercent: percent(terminalCount, total),
    segments: segments.map((s) => ({ ...s, percent: percent(s.count, total) })),
  };
}

/**
 * The sweeper's health, derived once for both the top-strip pip and the vitals panel. The label
 * beside it is locale-dependent and stays in the components; the judgement is here so the two
 * can't disagree about whether the cron is stalled.
 */
export function sweeperStatus(
  s: AdminOverview["sweeper"],
  nowMs: number,
): { dueCount: number; ageMsSinceRun: number | null; level: SignalLevel } {
  const ageMsSinceRun = ageMs(s.lastRunAt, nowMs);
  return {
    dueCount: s.dueCount,
    ageMsSinceRun,
    level: sweeperLevel(ageMsSinceRun, s.dueCount),
  };
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

// Constructing an Intl formatter is the expensive part; the roster builds two per user per
// render, all with identical arguments. One per locale for the lifetime of the page instead.
const RTF_CACHE = new Map<string, Intl.RelativeTimeFormat>();
function relativeFormatter(bcp47: string): Intl.RelativeTimeFormat {
  let fmt = RTF_CACHE.get(bcp47);
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(bcp47, { numeric: "auto" });
    RTF_CACHE.set(bcp47, fmt);
  }
  return fmt;
}

/** Milliseconds since an ms-epoch instant, or null when there isn't one. */
export function ageMs(atMs: number | null, nowMs: number): number | null {
  return atMs === null ? null : nowMs - atMs;
}

/**
 * An ms-epoch instant as localized relative time ("3 hours ago"). Returns null for a null input so
 * the caller can show its own "never" string.
 */
export function relativeTime(
  atMs: number | null,
  nowMs: number,
  bcp47: string,
): string | null {
  const age = ageMs(atMs, nowMs);
  if (age === null) return null;

  const diff = -age;
  const abs = Math.abs(diff);
  const fmt = relativeFormatter(bcp47);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return fmt.format(Math.round(diff / ms), unit);
  }
  return fmt.format(Math.round(diff / 1000), "second");
}
