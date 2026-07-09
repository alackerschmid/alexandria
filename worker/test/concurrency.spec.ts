import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../src/concurrency";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order even when later items settle first", async () => {
    const out = await mapWithConcurrency([30, 20, 10, 0], 4, async (ms, i) => {
      await tick(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }), 4, async () => {
      peak = Math.max(peak, ++inFlight);
      await tick(1);
      inFlight--;
    });
    expect(peak).toBe(4);
  });

  it("actually overlaps work rather than serializing it", async () => {
    const started = Date.now();
    await mapWithConcurrency(Array.from({ length: 8 }), 4, () => tick(20));
    // 8 items / 4 workers = 2 sequential waves of 20ms; serial would be ~160ms.
    expect(Date.now() - started).toBeLessThan(120);
  });

  it("handles an empty list, and a limit above the item count", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n * 2)).toEqual([
      2, 4,
    ]);
  });

  it("visits every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      await tick(1);
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("propagates a rejection from fn", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
