/**
 * Pure view-model builders for the collection statistics surfaces — `/stats` and the home
 * dashboard's teaser. Everything here is Vue-free and unit-tested in `test/stats-view.spec.ts`.
 *
 * `normalizeStats`, `getBreakdown`, `colorRamp` and the percentage helpers used to live inside
 * `home.vue`. Two pages need them now, and a second copy of the version-tolerance layer in
 * particular would drift the moment a field was added to one and not the other.
 */
import type { GroupBy } from "@/types/library";
import {
  emptyRatingDistribution,
  type CollectionStats,
  type DimensionItem,
  type RatingBucket,
} from "@/types/stats";

// ── Formatting ────────────────────────────────────────────────────────────────

/** Counts render as an em dash when absent, never as "0" — an unknown is not a zero. */
export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

/** Whole-number percentage of `total`, guarding the empty-library divide-by-zero. */
export function pctOf(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0;
}

export function pctStr(n: number, total: number): string {
  return `${pctOf(n, total)}%`;
}

/** A bar width as a CSS percentage of the largest value in its own series. */
export function barWidth(count: number, max: number): string {
  return max > 0 ? `${Math.round((count / max) * 100)}%` : "0%";
}

// ── Palette ───────────────────────────────────────────────────────────────────

/**
 * The categorical ramp for breakdown bars. Six stops, ordered most- to least-prominent.
 *
 * Literal hex rather than tokens because these are chart-categorical, not semantic: there is no
 * existing token for "the fourth-largest genre", and the two that do exist
 * (`--color-chart-muted`/`--color-chart-total`) cover only the neutral single-series case. The
 * first stop is the user's accent so the ramp still follows their appearance settings.
 */
export function colorRamp(isDark: boolean): string[] {
  return isDark
    ? [
        "rgb(var(--v-theme-primary))",
        "#b8afa6",
        "#8a8078",
        "#5c544e",
        "#3a3631",
        "#2a2724",
      ]
    : [
        "rgb(var(--v-theme-primary))",
        "#8a7a70",
        "#5c5249",
        "#3d3631",
        "#2a2421",
        "#c9c3bb",
      ];
}

/** Stop `i` of the ramp, saturating at the last one rather than going undefined. */
export function rampColor(ramp: string[], i: number): string {
  return ramp[i] ?? ramp.at(-1)!;
}

// ── Response normalization ────────────────────────────────────────────────────

type Raw = Record<string, any>;

/** Defaults every key of a fixed-shape count block, so a partially-present block can't leave a
 *  sibling `undefined` — which is what breaks a template that reads through it while rendering. */
function counts<K extends string>(
  block: Raw | undefined,
  keys: readonly K[],
): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, block?.[k] ?? 0])) as Record<
    K,
    number
  >;
}

const STATUS_KEYS = ["read", "reading", "unread", "dnf"] as const;
const OWNING_KEYS = [
  "owned",
  "lent_out",
  "unowned",
  "want",
  "unknown",
] as const;
const GAP_KEYS = [
  "noCover",
  "noPageCount",
  "noGenre",
  "noYear",
  "enrichmentPending",
  "readUnrated",
] as const;

/** Lists and scalar counts, defaulted in bulk — the bulk of the payload and the least interesting
 *  part of it, split out so `normalizeStats` stays readable. */
function normalizeDimensions(p: Raw) {
  return {
    genres: p.genres ?? [],
    uncategorizedGenreCount: p.uncategorizedGenreCount ?? 0,
    languages: p.languages ?? [],
    languageCount: p.languageCount ?? 0,
    topAuthors: p.topAuthors ?? [],
    authorCount: p.authorCount ?? 0,
    publishers: p.publishers ?? [],
    forms: p.forms ?? [],
    subjects: p.subjects ?? [],
    countries: p.countries ?? [],
    countryCount: p.countryCount ?? 0,
    decades: p.decades ?? [],
    decadeGenres: p.decadeGenres ?? [],
    topSeries: p.topSeries ?? [],
    customFields: p.customFields ?? [],
    genreCount: p.genreCount ?? 0,
  };
}

function normalizeMeasures(p: Raw) {
  return {
    avgPages: p.avgPages ?? null,
    totalPagesRead: p.totalPagesRead ?? null,
    totalPages: p.totalPages ?? 0,
    pagesKnownCount: p.pagesKnownCount ?? 0,
    pageBuckets: p.pageBuckets ?? [],
    medianYear: p.medianYear ?? null,
    yearKnownCount: p.yearKnownCount ?? 0,
    avgRating: p.avgRating ?? null,
    ratedCount: p.ratedCount ?? 0,
    ratingDistribution: p.ratingDistribution ?? emptyRatingDistribution(),
    translationRatio: p.translationRatio ?? null,
    randomFirstLine: p.randomFirstLine ?? null,
  };
}

/**
 * Defaults every field of a `/api/stats` payload.
 *
 * This is the version-tolerance layer: the frontend and worker types are hand-mirrored with no
 * runtime schema validation, so a page talking to an older worker would otherwise read
 * `undefined` mid-render and paint blank. Add a field to `CollectionStats` and it must get a
 * default here too.
 *
 * `ratingDistribution` falls back to `emptyRatingDistribution()`, never `[]` — the type promises
 * 11 dense buckets that consumers may index directly.
 */
export function normalizeStats(payload: unknown): CollectionStats {
  const p = (payload ?? {}) as Raw;
  return {
    total: p.total ?? 0,
    // An older worker ships no scope counts at all; falling back to the scope-agnostic `total`
    // keeps the empty state from claiming books exist outside the current scope when it can't know.
    scopeCounts: {
      owned: p.scopeCounts?.owned ?? p.total ?? 0,
      all: p.scopeCounts?.all ?? p.total ?? 0,
    },
    byStatus: counts(p.byStatus, STATUS_KEYS),
    owningStatus: counts(p.owningStatus, OWNING_KEYS),
    catalogueGaps: counts(p.catalogueGaps, GAP_KEYS),
    genreRatings: {
      best: p.genreRatings?.best ?? null,
      worst: p.genreRatings?.worst ?? null,
    },
    spotlight: p.spotlight ?? [],
    exemplars: {
      oldest: p.exemplars?.oldest ?? null,
      longest: p.exemplars?.longest ?? null,
      soleLanguage: p.exemplars?.soleLanguage ?? null,
    },
    ...normalizeDimensions(p),
    ...normalizeMeasures(p),
  };
}

/**
 * Books the *other* scope holds that the current one doesn't — what a scoped empty state
 * offers to reveal ("You've catalogued N books, but none are marked as owned"). Only ever
 * non-zero under `owned`, since `all` is a superset; the `Math.max` clamp keeps a
 * degenerate payload from putting a negative count into that sentence. Shared by `/stats`
 * and home, which carry the same two-branch empty state.
 */
export function countOutsideScope(stats: CollectionStats | null): number {
  const c = stats?.scopeCounts;
  return c ? Math.max(0, c.all - c.owned) : 0;
}

// ── Dimension breakdown ───────────────────────────────────────────────────────

/** Localized labels a breakdown needs but the payload only carries as codes/keys. */
export interface BreakdownLabels {
  /** Language code → display name, from `languageDisplayFormatter`. */
  language: (code: string) => string;
  /** Reading- and owning-status keys → their translated labels. */
  status: (key: string) => string;
}

/**
 * The `{ label, count }` series behind one group-by dimension.
 *
 * `status`, `owning` and `rating` are derived here rather than shipped as lists, because the
 * payload holds them in fixed-shape blocks. They used to fall through to `[]`, which on the home
 * teaser was invisible but on a page built around the dimension picker meant dead options.
 */
export function getBreakdown(
  mode: GroupBy,
  stats: CollectionStats,
  labels: BreakdownLabels,
): DimensionItem[] {
  switch (mode) {
    case "genre":
      return stats.genres;
    case "language":
      return stats.languages.map((l) => ({
        label: labels.language(l.code),
        count: l.count,
      }));
    case "author":
      return stats.topAuthors;
    case "series":
      return stats.topSeries;
    case "publisher":
      return stats.publishers;
    case "form":
      return stats.forms;
    case "country":
      return stats.countries;
    case "decade":
      return stats.decades;
    case "subject":
      return stats.subjects;
    case "status":
      return (["read", "reading", "unread", "dnf"] as const)
        .map((k) => ({ label: labels.status(k), count: stats.byStatus[k] }))
        .filter((s) => s.count > 0);
    case "owning":
      return (["owned", "lent_out", "unowned", "want", "unknown"] as const)
        .map((k) => ({ label: labels.status(k), count: stats.owningStatus[k] }))
        .filter((s) => s.count > 0);
    case "rating":
      // Descending, so the picker's strongest bar is the highest rating rather than the lowest.
      return stats.ratingDistribution
        .filter((b) => b.count > 0)
        .map((b) => ({ label: String(b.rating), count: b.count }))
        .reverse();
    case "none":
      return [];
    default: {
      const m = (mode as string).match(/^cf:(\d+)$/);
      if (m)
        return (
          stats.customFields.find((cf) => cf.fieldDefId === Number(m[1]))
            ?.values ?? []
        );
      return [];
    }
  }
}

/**
 * How many distinct values a dimension actually has, which is usually more than the payload
 * ships: every breakdown list is capped at 15 server-side. Returns `null` when the true total
 * isn't knowable, so a caption can say "15 shown" instead of claiming a total it invented.
 */
export function dimensionTotal(
  mode: GroupBy,
  stats: CollectionStats,
): number | null {
  switch (mode) {
    case "genre":
      return stats.genreCount;
    case "author":
      return stats.authorCount;
    case "language":
      return stats.languageCount;
    case "country":
      return stats.countryCount;
    default:
      return null;
  }
}

// ── Breakdown rows ────────────────────────────────────────────────────────────

/** Values a search token has to be quoted for, because the tokenizer splits on whitespace. */
export function quoteToken(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** A breakdown item, plus the optional token override a language row needs. */
export interface BreakdownInput {
  label: string;
  count: number;
  /** What the deep-link token carries when it isn't the label — languages link by ISO code. */
  tokenValue?: string;
}

export interface BreakdownRow {
  label: string;
  count: number;
  /** Share of the whole collection, not of the dimension. */
  pct: number;
  width: string;
  color: string;
  /** `genre:"Science fiction"`, or null where the dimension has no library facet. */
  token: string | null;
}

export interface BreakdownRowOptions {
  ramp: string[];
  /** Collection size, for the "% of the shelf" tail. */
  total: number;
  /** The library search key this dimension deep-links through. Absent = no equivalent facet. */
  searchKey?: string | null;
  /** Rows to keep. The scale and the ramp are computed over the *full* list first, so collapsing
   *  never changes a bar's width or its colour. */
  limit?: number;
}

/**
 * The bars behind one breakdown dimension.
 *
 * Two things this owes the caller, both of which were wrong while it lived inside `stats.vue` and
 * so could not be tested:
 *
 * - **The scale is the largest row, not the first one.** `getBreakdown` emits `status`, `owning`
 *   and `rating` in fixed key order rather than by count, so `items[0]` is not the maximum for
 *   three of the fourteen dimensions — and a library with more `unknown` than `owned` rows (every
 *   Goodreads import) produced widths in the thousands of percent.
 * - **Colour is assigned by rank, not by position** — the same rule `buildLengthSegments` follows,
 *   so the accent marks the modal value rather than whichever row happens to be listed first.
 */
export function buildBreakdownRows(
  items: readonly BreakdownInput[],
  { ramp, total, searchKey = null, limit }: BreakdownRowOptions,
): BreakdownRow[] {
  const max = items.reduce((m, it) => Math.max(m, it.count), 0);
  const rank = new Map(
    items
      // Ties keep list order, so two equal rows don't swap colours between renders.
      .map((it, i) => ({ it, i }))
      .sort((x, y) => y.it.count - x.it.count || x.i - y.i)
      .map(({ i }, position) => [i, position]),
  );
  return items.slice(0, limit ?? items.length).map((it, i) => ({
    label: it.label,
    count: it.count,
    pct: pctOf(it.count, total),
    width: barWidth(it.count, max),
    color: rampColor(ramp, rank.get(i)!),
    token: searchKey ? `${searchKey}:${quoteToken(it.tokenValue ?? it.label)}` : null,
  }));
}

// ── Decade histogram ──────────────────────────────────────────────────────────

export interface DecadeBar {
  /** `"1990s"`, or `"<1960"` for the rolled-up early bucket. */
  label: string;
  count: number;
  /** Bar height as a CSS percentage of the tallest bar. */
  height: string;
  /** True for the tallest bar — the one the chart highlights. */
  peak: boolean;
  /** True for the rolled-up bucket, which the client labels differently. */
  rollup: boolean;
}

export interface DecadeHistogramOptions {
  /** Decades before this year collapse into one leading bucket. */
  floor?: number;
}

/**
 * Turns `decades` into a contiguous chronological histogram.
 *
 * Three things the raw list can't do: it arrives ordered by count, it has no entry at all for a
 * decade the user owns nothing from (a gap that reads as data rather than as absence), and its
 * long tail of one-book 1800s decades squashes everything modern. So: sort ascending, roll
 * everything below `floor` into one bucket, and zero-fill the decades in between.
 */
export function buildDecadeHistogram(
  decades: DimensionItem[],
  { floor = 1960 }: DecadeHistogramOptions = {},
): DecadeBar[] {
  const byYear = new Map<number, number>();
  let rollupCount = 0;
  for (const d of decades) {
    const year = parseInt(d.label, 10);
    if (!Number.isFinite(year)) continue;
    if (year < floor) rollupCount += d.count;
    else byYear.set(year, (byYear.get(year) ?? 0) + d.count);
  }

  const bars: { label: string; count: number; rollup: boolean }[] = [];
  if (rollupCount > 0) bars.push({ label: `<${floor}`, count: rollupCount, rollup: true });

  const years = [...byYear.keys()].sort((a, b) => a - b);
  if (years.length > 0) {
    // Zero-fill between the first and last decade that actually has books, so the axis is
    // continuous without inventing empty decades past either end.
    for (let y = years[0]; y <= years.at(-1)!; y += 10) {
      bars.push({ label: `${y}s`, count: byYear.get(y) ?? 0, rollup: false });
    }
  }

  const max = bars.reduce((m, b) => Math.max(m, b.count), 0);
  return bars.map((b) => ({
    ...b,
    height: barWidth(b.count, max),
    peak: max > 0 && b.count === max,
  }));
}

// ── Rating histogram ──────────────────────────────────────────────────────────

export interface RatingRow {
  /** 1–10, the stored scale. `ratingStars` renders it as five half-fillable stars. */
  rating: number;
  count: number;
  /** Share of *rated* works, not of the collection. */
  pct: number;
  width: string;
}

export interface RatingHistogram {
  /** Ratings 10 down to 1 — highest first, matching how the mockup reads top-to-bottom. */
  rows: RatingRow[];
  /** Works rated exactly 0. A real rating on this scale, but it has no star row of its own, so
   *  it is reported alongside the block rather than silently dropped. */
  zeroCount: number;
  ratedCount: number;
}

export function buildRatingHistogram(
  distribution: RatingBucket[],
): RatingHistogram {
  const counts = new Map(distribution.map((b) => [b.rating, b.count]));
  const zeroCount = counts.get(0) ?? 0;
  const ratedCount = distribution.reduce((s, b) => s + b.count, 0);
  // Widths are relative to the biggest single row, not to `ratedCount`: a flat distribution
  // would otherwise render as ten stubs.
  let max = 0;
  for (let r = 1; r <= 10; r++) max = Math.max(max, counts.get(r) ?? 0);

  const rows: RatingRow[] = [];
  for (let r = 10; r >= 1; r--) {
    const count = counts.get(r) ?? 0;
    rows.push({
      rating: r,
      count,
      pct: pctOf(count, ratedCount),
      width: barWidth(count, max),
    });
  }
  return { rows, zeroCount, ratedCount };
}

// ── Length distribution ───────────────────────────────────────────────────────

export interface LengthSegment {
  /** The server's stable band id (`"<200"`, `"200-350"`, …), for the client to translate. */
  key: string;
  count: number;
  /** Share of books with a known page count. */
  pct: number;
  /** Width of this band's slice of the stacked bar. */
  width: string;
  color: string;
}

/**
 * The stacked length bar plus its legend, in band order.
 *
 * Zero-count bands are kept: the legend is a fixed five-band scale, and dropping one would
 * renumber the rest.
 *
 * Colour is assigned by **rank**, not by band order — the biggest band takes the accent and the
 * rest step down from it. Colouring by position would put the accent on whichever band happens
 * to be first (`<200`), which says nothing; by rank it marks the modal length, the same thing
 * the decade histogram's highlighted bar and `buildBreakdownRows`' accent bar mean.
 */
export function buildLengthSegments(
  buckets: DimensionItem[],
  ramp: string[],
): LengthSegment[] {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const rank = new Map(
    [...buckets]
      // Ties keep band order, so two equal bands don't swap colours between renders.
      .map((b, i) => ({ b, i }))
      .sort((x, y) => y.b.count - x.b.count || x.i - y.i)
      .map(({ i }, position) => [i, position]),
  );
  return buckets.map((b, i) => ({
    key: b.label,
    count: b.count,
    pct: pctOf(b.count, total),
    width: total > 0 ? `${(b.count / total) * 100}%` : "0%",
    color: rampColor(ramp, rank.get(i)!),
  }));
}
