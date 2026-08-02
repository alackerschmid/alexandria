import { describe, it, expect } from "vitest";
import { outcomeForStatus, usageHourStart } from "../src/usage";

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
