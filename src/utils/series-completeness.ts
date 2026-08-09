/**
 * Series completeness, derived from the `GET /api/series` membership map.
 *
 * There is no server-side completeness aggregate and there doesn't need to be: that route
 * already returns every entry of every series the user owns at least one book in, each carrying
 * an `owned` flag. `useShelfGroups` computes shelf completeness from exactly the same field, so
 * keeping this on the same input is what stops the stats page and the library shelves
 * disagreeing about whether a series is complete.
 *
 * `owned` reflects the documented ownership gate (`owning_status` in `owned`/`lent_out`) — a
 * `want` entry is a hole in the series, not a book you have.
 */
import type { SeriesMemberships } from "@/composables/useShelfGroups";

/** The shape both callers' entries share — the shelf's `SeriesEntry` and anything else with an
 *  ordinal. Kept structural so this file doesn't have to own the full entry type. */
interface OrdinalEntry {
  ordinal: number | null;
}

/**
 * A "main" entry is a whole-numbered one.
 *
 * `work_series.ordinal` is REAL specifically to carry decimal interludes (5.5), and a novella or
 * companion volume typically arrives from Wikidata with either a decimal ordinal or none at all.
 * So "whole number" is the app's definition of the main sequence, and this is the single place
 * that says so — it used to be written inline in `useShelfGroups`, while the completeness
 * summary counted every entry, which is how the shelves and the stats page came to disagree.
 */
export function isMainSeriesEntry(entry: OrdinalEntry): boolean {
  return entry.ordinal != null && Number.isInteger(entry.ordinal);
}

/**
 * The entries a series' completeness is measured over, honouring the user's
 * "Count novellas & side stories" setting (`libMainOnly`, default main-only).
 *
 * **Falls back to every entry when a series has no whole-numbered ones at all.** Wikidata
 * ordinal coverage is patchy — 23 of 64 Discworld entries carry no ordinal locally, and some
 * series have none whatsoever — and without the fallback such a series measures as 0 of 0.
 * That reads as "complete" in a count and, worse, renders an *empty shelf* in the library,
 * because this same set decides which entries are displayed. Missing metadata should degrade to
 * "we can't tell the side entries apart here", not to "this series has no books".
 *
 * **The threshold is deliberately "none at all", not a coverage ratio.** A series with one
 * whole-numbered entry and three unnumbered ones measures 1 of 1 and reads as complete, which
 * looks like the same bug one entry up — it isn't. A missing ordinal usually *means* novella or
 * companion (see `isMainSeriesEntry`), so that series is most often a volume 1 plus three side
 * stories, and 1 of 1 is the right answer under main-only. Reviewed and kept; don't "fix" it into
 * a `main.length * 2 >= entries.length` floor without data showing the opposite.
 */
export function countableSeriesEntries<T extends OrdinalEntry>(
  entries: T[],
  mainOnly: boolean,
): T[] {
  if (!mainOnly) return entries;
  const main = entries.filter((e) => isMainSeriesEntry(e));
  return main.length > 0 ? main : entries;
}

export interface SeriesSummaryOptions {
  /** The user's `libMainOnly` preference. Pass it through from `useLibraryDefaultsStore` rather
   *  than defaulting per call site, so shelves, home and `/stats` can't disagree. */
  mainOnly: boolean;
}

export interface SeriesProgress {
  seriesId: number;
  name: string | null;
  owned: number;
  total: number;
  missing: number;
  complete: boolean;
  /** Owned share, as a CSS percentage for the progress track. */
  width: string;
}

export interface SeriesSummary {
  /** Series with at least one owned book — the ones the user is actually collecting. */
  tracked: number;
  complete: number;
  /** Volumes missing across every tracked series. */
  missingTotal: number;
  /** Sorted most-complete first, then largest; ties broken on name for a stable order. */
  rows: SeriesProgress[];
}

export function summarizeSeries(
  memberships: SeriesMemberships | null | undefined,
  { mainOnly }: SeriesSummaryOptions,
): SeriesSummary {
  const rows: SeriesProgress[] = [];
  for (const series of Object.values(memberships ?? {})) {
    const counted = countableSeriesEntries(series.entries, mainOnly);
    const total = counted.length;
    // A series whose membership hasn't resolved to any entries tells us nothing — counting it as
    // 0/0 would make it "complete" and inflate the headline.
    if (total === 0) continue;
    const owned = counted.filter((e) => e.owned).length;
    // Owning only side entries is not progress through the main sequence, so under `mainOnly`
    // such a series drops out here rather than showing as 0 of N.
    if (owned === 0) continue;
    rows.push({
      seriesId: series.id,
      name: series.name,
      owned,
      total,
      missing: total - owned,
      complete: owned === total,
      width: `${Math.round((owned / total) * 100)}%`,
    });
  }

  rows.sort(
    (a, b) =>
      b.owned / b.total - a.owned / a.total ||
      b.total - a.total ||
      (a.name ?? "").localeCompare(b.name ?? ""),
  );

  return {
    tracked: rows.length,
    complete: rows.filter((r) => r.complete).length,
    missingTotal: rows.reduce((s, r) => s + r.missing, 0),
    rows,
  };
}
