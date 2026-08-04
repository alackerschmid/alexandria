import { describe, it, expect } from "vitest";
import type { UsageBucket } from "@/types/admin";
import {
  GOOGLE_BOOKS_DAILY_QUOTA,
  ageMs,
  barPercent,
  buildHourColumns,
  enrichmentBreakdown,
  formatDurationMs,
  peakHour,
  projectEndOfDay,
  providerTotals,
  quotaLevel,
  relativeTime,
  sweeperStatus,
} from "@/utils/admin-usage";

const HOUR = 3_600_000;
const H0 = Date.UTC(2026, 7, 2, 10);

const bucket = (
  hourStart: number,
  provider: string,
  calls: number,
): UsageBucket => ({ hourStart, provider, calls });

describe("quotaLevel", () => {
  it("bands on the share of the cap used", () => {
    expect(quotaLevel(0)).toBe("ok");
    expect(quotaLevel(799)).toBe("ok");
    expect(quotaLevel(800)).toBe("warning");
    expect(quotaLevel(949)).toBe("warning");
    expect(quotaLevel(950)).toBe("critical");
    expect(quotaLevel(GOOGLE_BOOKS_DAILY_QUOTA)).toBe("critical");
  });

  it("doesn't divide by a zero limit", () => {
    expect(quotaLevel(10, 0)).toBe("ok");
  });
});

describe("projectEndOfDay", () => {
  it("withholds a projection until the day has enough elapsed to extrapolate from", () => {
    expect(projectEndOfDay(40, H0 + 10 * 60_000, H0)).toBeNull();
  });

  it("scales the spend so far up to a full day", () => {
    // Six hours in — a quarter of the day — so 100 calls projects to 400.
    expect(projectEndOfDay(100, H0 + 6 * HOUR, H0)).toBe(400);
  });

  it("converges on the actual total as the day closes", () => {
    expect(projectEndOfDay(880, H0 + 24 * HOUR, H0)).toBe(880);
  });
});

describe("buildHourColumns", () => {
  it("keeps a slot for every hour, including ones with no calls", () => {
    const columns = buildHourColumns([bucket(H0 + 2 * HOUR, "wikidata", 3)], H0, 4);
    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.total)).toEqual([0, 0, 3, 0]);
    expect(columns.map((c) => c.hourStart)).toEqual([
      H0,
      H0 + HOUR,
      H0 + 2 * HOUR,
      H0 + 3 * HOUR,
    ]);
  });

  it("stacks the providers of one hour into its total", () => {
    const columns = buildHourColumns(
      [
        bucket(H0, "google_books", 8),
        bucket(H0, "openlibrary", 4),
      ],
      H0,
      1,
    );
    expect(columns[0]).toMatchObject({
      google_books: 8,
      openlibrary: 4,
      wikidata: 0,
      total: 12,
    });
  });

  it("ignores rows outside the window rather than extending the axis", () => {
    const columns = buildHourColumns([bucket(H0 - HOUR, "wikidata", 9)], H0, 2);
    expect(columns).toHaveLength(2);
    expect(columns.every((c) => c.total === 0)).toBe(true);
  });

  it("still counts an unknown provider in the hour total", () => {
    // The worker writes these counters; a provider added there reaches an older frontend build
    // before it knows the name. Dropping it would understate the hour.
    const columns = buildHourColumns([bucket(H0, "future_source", 7)], H0, 1);
    expect(columns[0].total).toBe(7);
  });
});

describe("providerTotals and peakHour", () => {
  const columns = buildHourColumns(
    [
      bucket(H0, "google_books", 2),
      bucket(H0 + HOUR, "google_books", 9),
      bucket(H0 + HOUR, "wikidata", 1),
    ],
    H0,
    3,
  );

  it("totals each provider across the window", () => {
    expect(providerTotals(columns)).toEqual({
      google_books: 11,
      openlibrary: 0,
      wikidata: 1,
    });
  });

  it("finds the busiest hour", () => {
    expect(peakHour(columns, (c) => c.total)).toEqual({
      hourStart: H0 + HOUR,
      value: 10,
    });
  });

  it("measures whatever `pick` names, not always the total", () => {
    // Same hour wins here, but on its Google Books calls (9) rather than its 10 total.
    expect(peakHour(columns, (c) => c.google_books)).toEqual({
      hourStart: H0 + HOUR,
      value: 9,
    });
    expect(peakHour(columns, (c) => c.openlibrary)).toBeNull();
  });

  it("has no peak when nothing was recorded", () => {
    expect(peakHour(buildHourColumns([], H0, 5), (c) => c.total)).toBeNull();
  });
});

describe("barPercent", () => {
  it("gives a visible floor to any non-zero value", () => {
    expect(barPercent(1, 1000)).toBe(2);
  });

  it("leaves zero at zero, so an empty hour stays empty", () => {
    expect(barPercent(0, 1000)).toBe(0);
  });

  it("is a plain proportion above the floor", () => {
    expect(barPercent(50, 100)).toBe(50);
  });
});

describe("formatDurationMs", () => {
  it("uses milliseconds below a second and seconds above", () => {
    expect(formatDurationMs(840)).toBe("840 ms");
    expect(formatDurationMs(1900)).toBe("1.9 s");
    expect(formatDurationMs(4430)).toBe("4.4 s");
  });
});

describe("relativeTime / ageMs", () => {
  const now = Date.UTC(2026, 7, 2, 12);

  it("formats an age in the largest unit that fits", () => {
    expect(relativeTime(now - 3 * HOUR, now, "en-GB")).toBe("3 hours ago");
    expect(relativeTime(now - 7 * 24 * HOUR, now, "en-GB")).toBe("last week");
  });

  it("returns null when there is no instant to measure from", () => {
    expect(relativeTime(null, now, "en-GB")).toBeNull();
    expect(ageMs(null, now)).toBeNull();
  });
});

describe("enrichmentBreakdown", () => {
  it("measures every share against the tracked statuses, not totalWorks", () => {
    const b = enrichmentBreakdown({
      done: 60,
      pending: 30,
      failed: 6,
      exhausted: 4,
    });
    expect(b.total).toBe(100);
    expect(b.donePercent).toBe(60);
    // The two that don't drain with time, which is what the pip's colour bands on.
    expect(b.terminalCount).toBe(10);
    expect(b.terminalPercent).toBe(10);
    expect(b.segments.map((s) => s.key)).toEqual([
      "done",
      "pending",
      "failed",
      "exhausted",
    ]);
    expect(b.segments.reduce((sum, s) => sum + s.percent, 0)).toBeCloseTo(100);
  });

  it("separates a big backlog from a real problem", () => {
    // Right after a bulk import: barely any progress, but nothing is actually wrong.
    const draining = enrichmentBreakdown({
      done: 20,
      pending: 80,
      failed: 0,
      exhausted: 0,
    });
    expect(draining.donePercent).toBe(20);
    expect(draining.terminalPercent).toBe(0);

    // Nearly finished, but a fifth of the library will never enrich on its own.
    const stuck = enrichmentBreakdown({
      done: 78,
      pending: 2,
      failed: 5,
      exhausted: 15,
    });
    expect(stuck.donePercent).toBe(78);
    expect(stuck.terminalPercent).toBe(20);
  });

  it("reports zeroes rather than dividing by zero on an empty instance", () => {
    const b = enrichmentBreakdown({
      done: 0,
      pending: 0,
      failed: 0,
      exhausted: 0,
    });
    expect(b.total).toBe(0);
    expect(b.donePercent).toBe(0);
    expect(b.terminalPercent).toBe(0);
    expect(b.segments.every((s) => s.percent === 0)).toBe(true);
  });
});

describe("sweeperStatus", () => {
  const now = Date.UTC(2026, 7, 2, 12);

  it("separates a stalled cron from a draining backlog", () => {
    // Both have work queued and neither has finished recently in status terms — only the run
    // timestamp tells them apart, which is the whole reason the endpoint returns it.
    const draining = sweeperStatus(
      { dueCount: 812, lastRunAt: now - 60_000 },
      now,
    );
    expect(draining.level).toBe("ok");
    expect(draining.ageMsSinceRun).toBe(60_000);

    const stalled = sweeperStatus(
      { dueCount: 812, lastRunAt: now - 3 * HOUR },
      now,
    );
    expect(stalled.level).toBe("critical");
    expect(stalled.ageMsSinceRun).toBe(3 * HOUR);
  });

  it("says nothing is wrong when the queue is empty", () => {
    expect(
      sweeperStatus({ dueCount: 0, lastRunAt: now - 60 * 24 * HOUR }, now)
        .level,
    ).toBe("ok");
  });

  it("handles an instance with no runs on record", () => {
    const s = sweeperStatus({ dueCount: 3, lastRunAt: null }, now);
    expect(s.ageMsSinceRun).toBeNull();
    expect(s.level).toBe("warning");
  });
});
