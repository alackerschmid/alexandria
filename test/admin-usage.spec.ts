import { describe, it, expect } from "vitest";
import type { UsageBucket } from "@/types/admin";
import {
  GOOGLE_BOOKS_DAILY_QUOTA,
  ageMs,
  barPercent,
  buildHourColumns,
  formatDurationMs,
  peakHour,
  projectEndOfDay,
  providerTotals,
  quotaLevel,
  relativeTime,
} from "@/utils/admin-usage";

const HOUR = 3_600_000;
const H0 = Date.UTC(2026, 7, 2, 10);

const bucket = (
  hourStart: number,
  provider: string,
  operation: string,
  counts: Partial<Pick<UsageBucket, "success" | "error" | "rateLimited">> = {},
): UsageBucket => ({
  hourStart,
  provider,
  operation,
  success: counts.success ?? 0,
  error: counts.error ?? 0,
  rateLimited: counts.rateLimited ?? 0,
});

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
    const columns = buildHourColumns(
      [bucket(H0 + 2 * HOUR, "wikidata", "work_details", { success: 3 })],
      H0,
      4,
    );
    expect(columns).toHaveLength(4);
    expect(columns.map((c) => c.total)).toEqual([0, 0, 3, 0]);
    expect(columns.map((c) => c.hourStart)).toEqual([
      H0,
      H0 + HOUR,
      H0 + 2 * HOUR,
      H0 + 3 * HOUR,
    ]);
  });

  it("sums every outcome into the hour's call count, per provider", () => {
    const columns = buildHourColumns(
      [
        bucket(H0, "google_books", "isbn_lookup", { success: 5, error: 1 }),
        bucket(H0, "google_books", "title_search", { rateLimited: 2 }),
        bucket(H0, "openlibrary", "editions", { success: 4 }),
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
    const columns = buildHourColumns(
      [bucket(H0 - HOUR, "wikidata", "labels", { success: 9 })],
      H0,
      2,
    );
    expect(columns).toHaveLength(2);
    expect(columns.every((c) => c.total === 0)).toBe(true);
  });

  it("still counts an unknown provider in the hour total", () => {
    // The worker writes these counters; a provider added there reaches an older frontend build
    // before it knows the name. Dropping it would understate the hour.
    const columns = buildHourColumns(
      [bucket(H0, "future_source", "lookup", { success: 7 })],
      H0,
      1,
    );
    expect(columns[0].total).toBe(7);
  });
});

describe("providerTotals and peakHour", () => {
  const columns = buildHourColumns(
    [
      bucket(H0, "google_books", "isbn_lookup", { success: 2 }),
      bucket(H0 + HOUR, "google_books", "isbn_lookup", { success: 9 }),
      bucket(H0 + HOUR, "wikidata", "labels", { success: 1 }),
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
    expect(peakHour(columns)?.hourStart).toBe(H0 + HOUR);
    expect(peakHour(columns)?.total).toBe(10);
  });

  it("has no peak when nothing was recorded", () => {
    expect(peakHour(buildHourColumns([], H0, 5))).toBeNull();
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

  it("reads a D1 timestamp as UTC, not local time", () => {
    // "2026-08-02 09:00:00" is three hours before `now`. Parsed as local time it would be off
    // by the host's offset — which is exactly the bug this normalization exists for.
    expect(ageMs("2026-08-02 09:00:00", now)).toBe(3 * HOUR);
  });

  it("formats an age in the largest unit that fits", () => {
    expect(relativeTime("2026-08-02 09:00:00", now, "en-GB")).toBe(
      "3 hours ago",
    );
    expect(relativeTime("2026-07-26 12:00:00", now, "en-GB")).toBe(
      "last week",
    );
  });

  it("returns null for absent or unparseable input", () => {
    expect(relativeTime(null, now, "en-GB")).toBeNull();
    expect(relativeTime("not a date", now, "en-GB")).toBeNull();
    expect(ageMs(null, now)).toBeNull();
  });
});
