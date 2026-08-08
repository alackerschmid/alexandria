import { describe, it, expect } from "vitest";
import { summarizeSeries } from "@/utils/series-completeness";
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

const map = (...list: SeriesMemberships[number][]): SeriesMemberships =>
  Object.fromEntries(list.map((s) => [s.id, s]));

describe("summarizeSeries", () => {
  it("counts owned against total membership", () => {
    const summary = summarizeSeries(
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
    const summary = summarizeSeries(
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
    const summary = summarizeSeries(
      map(series(1, "Owned", [true]), series(2, "Ghost", [false, false])),
    );
    expect(summary.tracked).toBe(1);
    expect(summary.rows.map((r) => r.name)).toEqual(["Owned"]);
  });

  it("skips a series with no entries rather than calling it complete", () => {
    // 0/0 is arithmetically complete and would inflate the headline "N of M complete".
    const summary = summarizeSeries(map(series(1, "Empty", [])));
    expect(summary.tracked).toBe(0);
    expect(summary.complete).toBe(0);
  });

  it("sorts most-complete first, then by size", () => {
    const summary = summarizeSeries(
      map(
        series(1, "Half", [true, false]),
        series(2, "Done", [true, true, true]),
        series(3, "Quarter", [true, false, false, false]),
      ),
    );
    expect(summary.rows.map((r) => r.name)).toEqual(["Done", "Half", "Quarter"]);
  });

  it("breaks ties on name so the order is stable across loads", () => {
    const summary = summarizeSeries(
      map(series(1, "Zulu", [true, false]), series(2, "Alpha", [true, false])),
    );
    expect(summary.rows.map((r) => r.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("returns the empty summary for missing memberships", () => {
    for (const input of [null, undefined, {}]) {
      expect(summarizeSeries(input)).toEqual({
        tracked: 0,
        complete: 0,
        missingTotal: 0,
        rows: [],
      });
    }
  });

  it("tolerates an unnamed series", () => {
    const unnamed = { ...series(1, "x", [true, false]), name: null };
    const summary = summarizeSeries(map(unnamed));
    expect(summary.rows[0].name).toBeNull();
    expect(summary.tracked).toBe(1);
  });
});
