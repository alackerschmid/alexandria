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
): SeriesSummary {
  const rows: SeriesProgress[] = [];
  for (const series of Object.values(memberships ?? {})) {
    const total = series.entries.length;
    // A series whose membership hasn't resolved to any entries tells us nothing — counting it as
    // 0/0 would make it "complete" and inflate the headline.
    if (total === 0) continue;
    const owned = series.entries.filter((e) => e.owned).length;
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
