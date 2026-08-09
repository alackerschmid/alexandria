import { describe, it, expect } from "vitest";
import {
  countableSeriesEntries,
  isMainSeriesEntry,
  summarizeSeries,
} from "@/utils/series-completeness";
import type { SeriesMemberships } from "@/composables/useShelfGroups";

/** Builds one series' membership from a list of owned flags. */
function series(
  id: number,
  name: string,
  owned: boolean[],
): SeriesMemberships[number] {
  return {
    id,
    name,
    entries: owned.map((o, i) => ({
      work_id: id * 100 + i,
      ordinal: i + 1,
      title: `${name} ${i + 1}`,
      owned: o ? 1 : 0,
      isbn: null,
      cover_url: null,
      scan_id: o ? id * 1000 + i : null,
    })),
  };
}

/** A series whose entries carry explicit ordinals — `null` and decimals are the side entries. */
function withOrdinals(
  id: number,
  name: string,
  entries: { owned: boolean; ordinal: number | null }[],
): SeriesMemberships[number] {
  return {
    id,
    name,
    entries: entries.map((e, i) => ({
      work_id: id * 100 + i,
      ordinal: e.ordinal,
      title: `${name} ${i + 1}`,
      owned: e.owned ? 1 : 0,
      isbn: null,
      cover_url: null,
      scan_id: e.owned ? id * 1000 + i : null,
    })),
  };
}

const map = (...list: SeriesMemberships[number][]): SeriesMemberships =>
  Object.fromEntries(list.map((s) => [s.id, s]));

/** The default the app runs under — `libMainOnly` ships `true`. */
const summarize = (
  memberships: Parameters<typeof summarizeSeries>[0],
  mainOnly = true,
) => summarizeSeries(memberships, { mainOnly });

describe("summarizeSeries", () => {
  it("counts owned against total membership", () => {
    const summary = summarize(
      map(series(1, "Earthsea", [true, true, false, false])),
    );
    expect(summary.rows[0]).toMatchObject({
      seriesId: 1,
      name: "Earthsea",
      owned: 2,
      total: 4,
      missing: 2,
      complete: false,
      width: "50%",
    });
  });

  it("marks a series complete only when every entry is owned", () => {
    const summary = summarize(
      map(
        series(1, "Complete", [true, true]),
        series(2, "Partial", [true, false]),
      ),
    );
    expect(summary.tracked).toBe(2);
    expect(summary.complete).toBe(1);
    expect(summary.missingTotal).toBe(1);
  });

  it("skips a series the user owns nothing from", () => {
    // GET /api/series only returns series with >=1 owned book, but the unowned-reveal means a
    // membership can legitimately be all-unowned after a book is deleted mid-session.
    const summary = summarize(
      map(series(1, "Owned", [true]), series(2, "Ghost", [false, false])),
    );
    expect(summary.tracked).toBe(1);
    expect(summary.rows.map((r) => r.name)).toEqual(["Owned"]);
  });

  it("skips a series with no entries rather than calling it complete", () => {
    // 0/0 is arithmetically complete and would inflate the headline "N of M complete".
    const summary = summarize(map(series(1, "Empty", [])));
    expect(summary.tracked).toBe(0);
    expect(summary.complete).toBe(0);
  });

  it("sorts most-complete first, then by size", () => {
    const summary = summarize(
      map(
        series(1, "Half", [true, false]),
        series(2, "Done", [true, true, true]),
        series(3, "Quarter", [true, false, false, false]),
      ),
    );
    expect(summary.rows.map((r) => r.name)).toEqual(["Done", "Half", "Quarter"]);
  });

  it("breaks ties on name so the order is stable across loads", () => {
    const summary = summarize(
      map(series(1, "Zulu", [true, false]), series(2, "Alpha", [true, false])),
    );
    expect(summary.rows.map((r) => r.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("returns the empty summary for missing memberships", () => {
    for (const input of [null, undefined, {}]) {
      expect(summarize(input)).toEqual({
        tracked: 0,
        complete: 0,
        missingTotal: 0,
        rows: [],
      });
    }
  });

  it("tolerates an unnamed series", () => {
    const unnamed = { ...series(1, "x", [true, false]), name: null };
    const summary = summarize(map(unnamed));
    expect(summary.rows[0].name).toBeNull();
    expect(summary.tracked).toBe(1);
  });
});

describe("isMainSeriesEntry", () => {
  it("accepts whole-numbered entries only", () => {
    expect(isMainSeriesEntry({ ordinal: 1 })).toBe(true);
    expect(isMainSeriesEntry({ ordinal: 41 })).toBe(true);
    // `work_series.ordinal` is REAL specifically to carry decimal interludes, which is how a
    // novella arrives; and a companion volume usually arrives with no ordinal at all.
    expect(isMainSeriesEntry({ ordinal: 5.5 })).toBe(false);
    expect(isMainSeriesEntry({ ordinal: null })).toBe(false);
  });

  it("treats 0 as a real ordinal", () => {
    // A prequel numbered 0 is part of the main sequence; only null means "unnumbered".
    expect(isMainSeriesEntry({ ordinal: 0 })).toBe(true);
  });
});

describe("countableSeriesEntries", () => {
  const entries = [
    { ordinal: 1 },
    { ordinal: 1.5 },
    { ordinal: 2 },
    { ordinal: null },
  ];

  it("keeps only whole-numbered entries under mainOnly", () => {
    expect(countableSeriesEntries(entries, true)).toEqual([
      { ordinal: 1 },
      { ordinal: 2 },
    ]);
  });

  it("keeps everything when the user counts side stories", () => {
    expect(countableSeriesEntries(entries, false)).toEqual(entries);
  });

  it("falls back to every entry when a series has no whole-numbered ones", () => {
    // Wikidata ordinal coverage is patchy — locally 23 of 64 Discworld entries have none, and
    // some series have none at all. Without this the series measures 0 of 0, which reads as
    // complete AND renders an empty shelf, since this same set decides what is displayed.
    const unnumbered = [{ ordinal: null }, { ordinal: null }];
    expect(countableSeriesEntries(unnumbered, true)).toEqual(unnumbered);
  });

  it("returns an empty list for an empty series either way", () => {
    expect(countableSeriesEntries([], true)).toEqual([]);
    expect(countableSeriesEntries([], false)).toEqual([]);
  });
});

describe("summarizeSeries — side entries", () => {
  // Discworld as the local database actually holds it, in miniature: whole-numbered novels
  // plus unnumbered companions. Counting the companions is the bug this covers.
  const discworld = withOrdinals(1, "Discworld", [
    { owned: true, ordinal: 1 },
    { owned: false, ordinal: 2 },
    { owned: false, ordinal: 3 },
    { owned: false, ordinal: null },
    { owned: false, ordinal: null },
    { owned: false, ordinal: 4.5 },
  ]);

  it("excludes side entries from the missing count by default", () => {
    const row = summarize(map(discworld)).rows[0];
    expect(row.total).toBe(3);
    expect(row.missing).toBe(2);
  });

  it("includes them when the user opts in", () => {
    const row = summarize(map(discworld), false).rows[0];
    expect(row.total).toBe(6);
    expect(row.missing).toBe(5);
  });

  it("can complete a series you own every numbered volume of", () => {
    // Owning 1-3 but none of the companions is a finished series under the default setting,
    // and an unfinished one if you opted into counting side stories.
    const s = withOrdinals(2, "Trilogy", [
      { owned: true, ordinal: 1 },
      { owned: true, ordinal: 2 },
      { owned: true, ordinal: 3 },
      { owned: false, ordinal: null },
    ]);
    expect(summarize(map(s)).rows[0].complete).toBe(true);
    expect(summarize(map(s), false).rows[0].complete).toBe(false);
  });

  it("keeps a series whose entries are all unnumbered", () => {
    // The fallback: 1 owned of 1, not 0 of 0 — and not dropped from the list entirely.
    const s = withOrdinals(3, "Unnumbered", [
      { owned: true, ordinal: null },
      { owned: false, ordinal: null },
    ]);
    const row = summarize(map(s)).rows[0];
    expect(row).toMatchObject({ owned: 1, total: 2, missing: 1 });
  });

  it("drops a series you own only side entries of", () => {
    // Owning a companion volume is not progress through the main sequence, so under the
    // default setting there is nothing to report — and 0 of N would be a misleading row.
    const s = withOrdinals(4, "Side only", [
      { owned: false, ordinal: 1 },
      { owned: false, ordinal: 2 },
      { owned: true, ordinal: null },
    ]);
    expect(summarize(map(s)).tracked).toBe(0);
    expect(summarize(map(s), false).tracked).toBe(1);
  });

  it("counts the headline totals over main entries only", () => {
    const summary = summarize(map(discworld));
    expect(summary.tracked).toBe(1);
    expect(summary.missingTotal).toBe(2);
  });
});
