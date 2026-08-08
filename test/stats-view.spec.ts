import { describe, it, expect } from "vitest";
import {
  barWidth,
  buildDecadeHistogram,
  buildLengthSegments,
  buildRatingHistogram,
  colorRamp,
  countOutsideScope,
  dimensionTotal,
  formatCount,
  getBreakdown,
  normalizeStats,
  pctOf,
  rampColor,
} from "@/utils/stats-view";
import { emptyRatingDistribution, type CollectionStats } from "@/types/stats";

/** A fully-defaulted stats object, so each test names only the fields it is about. */
const stats = (overrides: Partial<CollectionStats> = {}): CollectionStats => ({
  ...normalizeStats({}),
  ...overrides,
});

const labels = {
  language: (code: string) => `lang:${code}`,
  status: (key: string) => `status:${key}`,
};

describe("formatCount", () => {
  it("renders an absent count as an em dash, not as zero", () => {
    // An unknown is not a zero — "0 pages read" and "we don't know" are different claims.
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount(0)).toBe("0");
  });
});

describe("pctOf / barWidth", () => {
  it("returns 0 rather than NaN on an empty library", () => {
    expect(pctOf(0, 0)).toBe(0);
    expect(barWidth(0, 0)).toBe("0%");
  });

  it("rounds to whole percentages", () => {
    expect(pctOf(1, 3)).toBe(33);
    expect(barWidth(2, 3)).toBe("67%");
  });
});

describe("rampColor", () => {
  it("saturates at the last stop instead of going undefined", () => {
    const ramp = colorRamp(true);
    expect(rampColor(ramp, 99)).toBe(ramp.at(-1));
  });

  it("leads with the user's accent in both themes", () => {
    expect(colorRamp(true)[0]).toBe("rgb(var(--v-theme-primary))");
    expect(colorRamp(false)[0]).toBe("rgb(var(--v-theme-primary))");
  });
});

describe("normalizeStats", () => {
  it("defaults every field for an empty payload", () => {
    const s = normalizeStats({});
    expect(s.total).toBe(0);
    expect(s.genres).toEqual([]);
    expect(s.avgRating).toBeNull();
    expect(s.catalogueGaps.noCover).toBe(0);
    expect(s.genreRatings).toEqual({ best: null, worst: null });
    expect(s.owningStatus.owned).toBe(0);
    expect(s.scopeCounts).toEqual({ owned: 0, all: 0 });
    // Home reads through `exemplars.oldest.title` while rendering, so a missing block has to
    // arrive as three nulls rather than as `undefined`.
    expect(s.spotlight).toEqual([]);
    expect(s.exemplars).toEqual({
      oldest: null,
      longest: null,
      soleLanguage: null,
    });
  });

  it("falls back to `total` for the scope counts an older worker doesn't send", () => {
    // The page offers "you have N books outside this scope" off the difference between the two.
    // Defaulting them to 0 would make a full library look like it had books to reveal; taking
    // both from `total` says "the scopes are the same size", i.e. offers nothing.
    expect(normalizeStats({ total: 42 }).scopeCounts).toEqual({
      owned: 42,
      all: 42,
    });
  });

  it("passes a real scopeCounts payload through, including a legitimate zero", () => {
    // The payload the whole scope feature exists for: a Goodreads-imported library where every
    // scan is owning_status 'unknown'. `owned: 0` must survive (?? not ||) — collapsing it to
    // `total` would hide the scoped empty state and tell a 120-book library "nothing to
    // measure yet".
    expect(
      normalizeStats({ total: 0, scopeCounts: { owned: 0, all: 120 } })
        .scopeCounts,
    ).toEqual({ owned: 0, all: 120 });
  });

  it("fills a partial scopeCounts per-field from total", () => {
    expect(
      normalizeStats({ total: 42, scopeCounts: { owned: 3 } }).scopeCounts,
    ).toEqual({ owned: 3, all: 42 });
  });

  it("survives null and undefined payloads", () => {
    // An older worker, or a response that failed to parse — neither may blank the page.
    expect(normalizeStats(null).total).toBe(0);
    expect(normalizeStats(undefined).total).toBe(0);
  });

  it("falls back to 11 dense rating buckets, never an empty array", () => {
    // The type promises consumers may index this directly.
    expect(normalizeStats({}).ratingDistribution).toEqual(
      emptyRatingDistribution(),
    );
  });

  it("passes through the fields a current worker sends", () => {
    const s = normalizeStats({
      total: 12,
      byStatus: { read: 5, reading: 1, unread: 6, dnf: 0 },
      catalogueGaps: { noCover: 3 },
      genreRatings: { best: { label: "Poetry", avg: 8.2, count: 7 } },
    });
    expect(s.total).toBe(12);
    expect(s.byStatus.read).toBe(5);
    expect(s.catalogueGaps.noCover).toBe(3);
    // Sibling keys of a partially-present block still default rather than going undefined.
    expect(s.catalogueGaps.readUnrated).toBe(0);
    expect(s.genreRatings.best?.avg).toBe(8.2);
    expect(s.genreRatings.worst).toBeNull();
  });
});

describe("countOutsideScope", () => {
  it("is the all-minus-owned difference the scoped empty state renders", () => {
    expect(
      countOutsideScope(stats({ scopeCounts: { owned: 0, all: 120 } })),
    ).toBe(120);
  });

  it("is 0 while stats are still loading (null)", () => {
    expect(countOutsideScope(null)).toBe(0);
  });

  it("clamps a degenerate payload to 0 rather than going negative", () => {
    // "You've catalogued -2 books" must be unrepresentable whatever the worker sends.
    expect(
      countOutsideScope(stats({ scopeCounts: { owned: 5, all: 3 } })),
    ).toBe(0);
  });
});

describe("getBreakdown", () => {
  it("maps language codes through the supplied formatter", () => {
    const s = stats({ languages: [{ code: "de", count: 4 }] });
    expect(getBreakdown("language", s, labels)).toEqual([
      { label: "lang:de", count: 4 },
    ]);
  });

  it("derives the status dimension and drops empty buckets", () => {
    const s = stats({ byStatus: { read: 3, reading: 0, unread: 2, dnf: 0 } });
    expect(getBreakdown("status", s, labels)).toEqual([
      { label: "status:read", count: 3 },
      { label: "status:unread", count: 2 },
    ]);
  });

  it("derives the owning dimension", () => {
    // This and `rating` used to fall through to [] — invisible on the home teaser, but two dead
    // options on a page whose whole point is the dimension picker.
    const s = stats({
      owningStatus: { owned: 9, lent_out: 2, unowned: 0, want: 0, unknown: 0 },
    });
    expect(getBreakdown("owning", s, labels)).toEqual([
      { label: "status:owned", count: 9 },
      { label: "status:lent_out", count: 2 },
    ]);
  });

  it("derives the rating dimension highest-first", () => {
    const dist = emptyRatingDistribution().map((b) => ({
      ...b,
      count: b.rating === 8 ? 5 : b.rating === 4 ? 2 : 0,
    }));
    const s = stats({ ratingDistribution: dist });
    expect(getBreakdown("rating", s, labels)).toEqual([
      { label: "8", count: 5 },
      { label: "4", count: 2 },
    ]);
  });

  it("resolves a custom field by id and returns [] for an unknown one", () => {
    const s = stats({
      customFields: [
        { fieldDefId: 7, fieldName: "Shelf", values: [{ label: "Study", count: 3 }] },
      ],
    });
    expect(getBreakdown("cf:7", s, labels)).toEqual([
      { label: "Study", count: 3 },
    ]);
    expect(getBreakdown("cf:99", s, labels)).toEqual([]);
  });

  it("returns [] for the none dimension", () => {
    expect(getBreakdown("none", stats(), labels)).toEqual([]);
  });
});

describe("dimensionTotal", () => {
  it("reports the true distinct total where the payload carries one", () => {
    const s = stats({ genreCount: 214, authorCount: 88 });
    expect(dimensionTotal("genre", s)).toBe(214);
    expect(dimensionTotal("author", s)).toBe(88);
  });

  it("returns null where the total is not knowable", () => {
    // A caption must be able to say "15 shown" rather than invent a total.
    expect(dimensionTotal("publisher", stats())).toBeNull();
    expect(dimensionTotal("cf:3", stats())).toBeNull();
  });
});

describe("buildDecadeHistogram", () => {
  it("orders chronologically rather than by count", () => {
    const bars = buildDecadeHistogram([
      { label: "2010s", count: 30 },
      { label: "1990s", count: 5 },
      { label: "2000s", count: 12 },
    ]);
    expect(bars.map((b) => b.label)).toEqual(["1990s", "2000s", "2010s"]);
  });

  it("zero-fills a decade the user owns nothing from", () => {
    // A missing bucket would read as data ("nothing from the 1980s" vs. a gap in the axis).
    const bars = buildDecadeHistogram([
      { label: "1970s", count: 4 },
      { label: "2000s", count: 9 },
    ]);
    expect(bars.map((b) => [b.label, b.count])).toEqual([
      ["1970s", 4],
      ["1980s", 0],
      ["1990s", 0],
      ["2000s", 9],
    ]);
  });

  it("rolls everything below the floor into one leading bucket", () => {
    const bars = buildDecadeHistogram([
      { label: "1820s", count: 3 },
      { label: "1900s", count: 6 },
      { label: "1960s", count: 10 },
    ]);
    expect(bars[0]).toMatchObject({ label: "<1960", count: 9, rollup: true });
    expect(bars).toHaveLength(2);
  });

  it("honours a custom floor", () => {
    const bars = buildDecadeHistogram(
      [
        { label: "1960s", count: 2 },
        { label: "2000s", count: 5 },
      ],
      { floor: 2000 },
    );
    expect(bars.map((b) => b.label)).toEqual(["<2000", "2000s"]);
  });

  it("marks the tallest bar as the peak", () => {
    const bars = buildDecadeHistogram([
      { label: "1990s", count: 5 },
      { label: "2000s", count: 20 },
    ]);
    expect(bars.find((b) => b.peak)?.label).toBe("2000s");
    expect(bars.find((b) => b.peak)?.height).toBe("100%");
  });

  it("returns nothing for an empty list", () => {
    expect(buildDecadeHistogram([])).toEqual([]);
  });

  it("ignores an unparseable decade label", () => {
    expect(buildDecadeHistogram([{ label: "unknown", count: 4 }])).toEqual([]);
  });

  it("emits only the rollup when every decade is below the floor", () => {
    const bars = buildDecadeHistogram([{ label: "1900s", count: 7 }]);
    expect(bars).toEqual([
      { label: "<1960", count: 7, rollup: true, height: "100%", peak: true },
    ]);
  });
});

describe("buildRatingHistogram", () => {
  const dist = (counts: Record<number, number>) =>
    emptyRatingDistribution().map((b) => ({
      ...b,
      count: counts[b.rating] ?? 0,
    }));

  it("emits ten rows, 10 down to 1", () => {
    const h = buildRatingHistogram(dist({}));
    expect(h.rows).toHaveLength(10);
    expect(h.rows[0].rating).toBe(10);
    expect(h.rows[9].rating).toBe(1);
  });

  it("reports rating 0 separately rather than dropping it", () => {
    // 0 is a real rating on this scale, but it has no star row of its own.
    const h = buildRatingHistogram(dist({ 0: 4, 8: 6 }));
    expect(h.zeroCount).toBe(4);
    expect(h.rows.some((r) => r.rating === 0)).toBe(false);
    expect(h.ratedCount).toBe(10);
  });

  it("scales widths against the biggest row, not the total", () => {
    // Otherwise a flat distribution renders as ten stubs.
    const h = buildRatingHistogram(dist({ 8: 10, 6: 5 }));
    expect(h.rows.find((r) => r.rating === 8)?.width).toBe("100%");
    expect(h.rows.find((r) => r.rating === 6)?.width).toBe("50%");
  });

  it("takes percentages against the rated count", () => {
    const h = buildRatingHistogram(dist({ 10: 1, 5: 3 }));
    expect(h.rows.find((r) => r.rating === 10)?.pct).toBe(25);
  });

  it("survives an all-zero distribution", () => {
    const h = buildRatingHistogram(emptyRatingDistribution());
    expect(h.ratedCount).toBe(0);
    expect(h.rows.every((r) => r.width === "0%" && r.pct === 0)).toBe(true);
  });
});

describe("buildLengthSegments", () => {
  const ramp = colorRamp(true);

  it("keeps zero-count bands rather than dropping them from the legend", () => {
    const segs = buildLengthSegments(
      [
        { label: "<200", count: 2 },
        { label: "200-350", count: 0 },
        { label: "350-500", count: 2 },
      ],
      ramp,
    );
    expect(segs).toHaveLength(3);
    expect(segs[1]).toMatchObject({ key: "200-350", count: 0, width: "0%" });
  });

  it("gives the accent to the biggest band, not to the first one", () => {
    // By position the accent would land on "<200" whatever its size, which says nothing.
    const segs = buildLengthSegments(
      [
        { label: "<200", count: 1 },
        { label: "200-350", count: 14 },
        { label: "350-500", count: 4 },
      ],
      ramp,
    );
    expect(segs[1].color).toBe(ramp[0]);
    expect(segs[2].color).toBe(ramp[1]);
    expect(segs[0].color).toBe(ramp[2]);
  });

  it("keeps band order for ties so colours don't swap between renders", () => {
    const segs = buildLengthSegments(
      [
        { label: "<200", count: 3 },
        { label: "200-350", count: 3 },
      ],
      ramp,
    );
    expect(segs[0].color).toBe(ramp[0]);
    expect(segs[1].color).toBe(ramp[1]);
  });

  it("returns segments in band order regardless of colour rank", () => {
    const segs = buildLengthSegments(
      [
        { label: "<200", count: 1 },
        { label: "200-350", count: 9 },
      ],
      ramp,
    );
    expect(segs.map((s) => s.key)).toEqual(["<200", "200-350"]);
  });

  it("takes percentages against the banded total", () => {
    const segs = buildLengthSegments(
      [
        { label: "<200", count: 1 },
        { label: "200-350", count: 3 },
      ],
      ramp,
    );
    expect(segs[0].pct).toBe(25);
    expect(segs[1].pct).toBe(75);
  });

  it("uses unrounded widths so the stack fills exactly", () => {
    // Rounding each slice leaves a visible gap or overflow at the end of the bar.
    const segs = buildLengthSegments(
      [
        { label: "a", count: 1 },
        { label: "b", count: 1 },
        { label: "c", count: 1 },
      ],
      ramp,
    );
    const sum = segs.reduce((s, x) => s + parseFloat(x.width), 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it("survives an empty collection", () => {
    const segs = buildLengthSegments(
      [{ label: "<200", count: 0 }],
      ramp,
    );
    expect(segs[0].width).toBe("0%");
    expect(segs[0].pct).toBe(0);
  });
});
