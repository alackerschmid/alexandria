import { describe, it, expect } from "vitest";
import {
  enrichmentLevel,
  failureLevel,
  sweeperLevel,
  worstLevel,
} from "@/utils/admin-signal";

describe("failureLevel", () => {
  it("treats a few failed runs as normal", () => {
    expect(failureLevel(0)).toBe("ok");
    expect(failureLevel(9.9)).toBe("ok");
  });

  it("bands at 10 and 25 percent", () => {
    expect(failureLevel(10)).toBe("warning");
    expect(failureLevel(24.9)).toBe("warning");
    expect(failureLevel(25)).toBe("critical");
    expect(failureLevel(100)).toBe("critical");
  });
});

describe("enrichmentLevel", () => {
  it("stays green while nothing is terminally stuck", () => {
    expect(enrichmentLevel(0)).toBe("ok");
    expect(enrichmentLevel(4.9)).toBe("ok");
  });

  it("bands at 5 and 15 percent", () => {
    expect(enrichmentLevel(5)).toBe("warning");
    expect(enrichmentLevel(14.9)).toBe("warning");
    expect(enrichmentLevel(15)).toBe("critical");
    expect(enrichmentLevel(100)).toBe("critical");
  });
});

describe("sweeperLevel", () => {
  const MIN = 60_000;

  it("stays quiet when there is nothing queued, however old the last run is", () => {
    // An idle instance writes no run rows, so its last run is legitimately ancient.
    expect(sweeperLevel(30 * 24 * 60 * MIN, 0)).toBe("ok");
    expect(sweeperLevel(null, 0)).toBe("ok");
  });

  it("tolerates a backlog that is visibly draining", () => {
    // A bulk import queues hundreds of works; taking hours to drain is normal, not a fault.
    expect(sweeperLevel(1 * MIN, 800)).toBe("ok");
    expect(sweeperLevel(14 * MIN, 800)).toBe("ok");
  });

  it("bands on how long the queue has gone unserved", () => {
    expect(sweeperLevel(15 * MIN, 1)).toBe("warning");
    expect(sweeperLevel(59 * MIN, 1)).toBe("warning");
    expect(sweeperLevel(60 * MIN, 1)).toBe("critical");
  });

  it("warns rather than alarms when there is no run on record at all", () => {
    // Indistinguishable from a brand-new instance whose cron hasn't fired yet.
    expect(sweeperLevel(null, 5)).toBe("warning");
  });
});

describe("worstLevel", () => {
  it("takes the most severe reading", () => {
    expect(worstLevel("ok", "warning")).toBe("warning");
    expect(worstLevel("critical", "ok")).toBe("critical");
    expect(worstLevel("ok", "ok")).toBe("ok");
  });

  it("never lets a missing reading outrank a real one", () => {
    expect(worstLevel("neutral", "ok")).toBe("ok");
    expect(worstLevel("neutral", "neutral")).toBe("neutral");
  });
});
