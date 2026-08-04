import { describe, it, expect } from "vitest";
import { UsageRecorder, outcomeForStatus, usageHourStart } from "../src/usage";

const HOUR = 3_600_000;

describe("usageHourStart", () => {
  it("floors to the containing hour", () => {
    // 2026-08-02T13:37:21.500Z
    const t = Date.UTC(2026, 7, 2, 13, 37, 21, 500);
    expect(usageHourStart(t)).toBe(Date.UTC(2026, 7, 2, 13, 0, 0, 0));
  });

  it("is idempotent on an exact hour boundary", () => {
    const boundary = Date.UTC(2026, 7, 2, 13);
    expect(usageHourStart(boundary)).toBe(boundary);
  });

  it("puts the last millisecond of an hour in that hour, not the next", () => {
    const boundary = Date.UTC(2026, 7, 2, 13);
    expect(usageHourStart(boundary - 1)).toBe(boundary - HOUR);
    expect(usageHourStart(boundary + HOUR - 1)).toBe(boundary);
  });

  it("buckets in UTC regardless of the host timezone", () => {
    // Every bucket is a whole number of hours from the epoch — true only in UTC, which is what
    // makes the counters comparable between the worker and the browser reading them.
    const t = Date.UTC(2026, 7, 2, 13, 37);
    expect(usageHourStart(t) % HOUR).toBe(0);
  });
});

describe("outcomeForStatus", () => {
  it("counts 2xx as success", () => {
    expect(outcomeForStatus(200)).toBe("success");
    expect(outcomeForStatus(204)).toBe("success");
  });

  it("splits 429 out from other failures", () => {
    expect(outcomeForStatus(429)).toBe("rate_limited");
  });

  it("counts every other status as an error", () => {
    expect(outcomeForStatus(404)).toBe("error");
    expect(outcomeForStatus(403)).toBe("error");
    expect(outcomeForStatus(500)).toBe("error");
    expect(outcomeForStatus(503)).toBe("error");
    // 0 is the "never got a response" case fetch failures leave behind.
    expect(outcomeForStatus(0)).toBe("error");
  });
});

/**
 * A stand-in for D1: records the statements each `batch()` was handed. Enough to assert what the
 * recorder collapses to, without a real database — the UPSERT itself is exercised in production
 * and by the admin endpoint's own reads.
 */
function fakeDb() {
  const batches: unknown[][][] = [];
  let fail = false;
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({ sql, args }),
    }),
    batch: async (stmts: { sql: string; args: unknown[] }[]) => {
      if (fail) throw new Error("D1 unavailable");
      batches.push(stmts.map((s) => s.args));
    },
  };
  return {
    db: db as unknown as D1Database,
    batches,
    breakIt: () => {
      fail = true;
    },
  };
}

describe("UsageRecorder", () => {
  it("collapses repeated calls into one row per provider+operation", async () => {
    const { db, batches } = fakeDb();
    const usage = new UsageRecorder(db);
    for (let i = 0; i < 10; i++)
      usage.record("google_books", "isbn_lookup", "success");
    usage.record("google_books", "isbn_lookup", "error");
    usage.record("google_books", "title_search", "rate_limited");
    usage.record("openlibrary", "isbn_lookup", "success");

    await usage.flush();

    expect(batches).toHaveLength(1);
    // Thirteen calls, three distinct counters — the whole point of buffering.
    expect(batches[0]).toHaveLength(3);
    const hour = usageHourStart(Date.now());
    expect(batches[0]).toContainEqual([
      hour,
      "google_books",
      "isbn_lookup",
      10,
      1,
      0,
    ]);
    expect(batches[0]).toContainEqual([
      hour,
      "google_books",
      "title_search",
      0,
      0,
      1,
    ]);
    expect(batches[0]).toContainEqual([
      hour,
      "openlibrary",
      "isbn_lookup",
      1,
      0,
      0,
    ]);
  });

  it("writes nothing when nothing was recorded", async () => {
    const { db, batches } = fakeDb();
    await new UsageRecorder(db).flush();
    expect(batches).toHaveLength(0);
  });

  it("drains the buffer, so a second flush doesn't double-count", async () => {
    const { db, batches } = fakeDb();
    const usage = new UsageRecorder(db);
    usage.record("wikidata", "labels", "success");
    await usage.flush();
    await usage.flush();
    expect(batches).toHaveLength(1);

    usage.record("wikidata", "labels", "error");
    await usage.flush();
    expect(batches).toHaveLength(2);
    expect(batches[1][0]).toEqual([
      usageHourStart(Date.now()),
      "wikidata",
      "labels",
      0,
      1,
      0,
    ]);
  });

  it("swallows a write failure — telemetry must never fail its caller", async () => {
    const { db, breakIt } = fakeDb();
    breakIt();
    const usage = new UsageRecorder(db);
    usage.record("wikidata", "book_search", "error");
    await expect(usage.flush()).resolves.toBeUndefined();
  });

  it("records nothing without a database handle", async () => {
    const usage = new UsageRecorder(null);
    usage.record("google_books", "isbn_lookup", "success");
    await expect(usage.flush()).resolves.toBeUndefined();
  });
});
