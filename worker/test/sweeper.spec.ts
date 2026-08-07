import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fitsInBudget,
  SUBREQUEST_BUDGET,
  WORST_CASE_PER_WORK,
} from "../src/sweeper";
import { UsageRecorder } from "../src/usage";

/**
 * The tick's subrequest meter. Pure enough to test with a real `UsageRecorder` and no D1 handle:
 * `countFetch` deliberately doesn't touch the database, because a budget must be counted even where
 * telemetry isn't being written.
 */
describe("fitsInBudget", () => {
  afterEach(() => vi.restoreAllMocks());

  /** A recorder that has already spent `n` external calls this invocation. */
  const spent = (n: number) => {
    const usage = new UsageRecorder(null);
    for (let i = 0; i < n; i++) usage.countFetch();
    return usage;
  };

  it("counts every fetch, with or without a database handle", () => {
    // The no-db case is the one that matters: `record` early-returns without a handle, so a meter
    // built on it would read zero here and admit an unbounded batch.
    expect(spent(3).externalCalls).toBe(3);
  });

  it("always starts the first work, even with the budget already blown", () => {
    // Nothing has been spent when index 0 runs in a real tick; this pins the invariant anyway,
    // because refusing every work would stall the queue permanently rather than slow it down.
    expect(fitsInBudget(spent(SUBREQUEST_BUDGET * 2), 0)).toBe(true);
  });

  it("admits a work while the worst case still fits", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const room = SUBREQUEST_BUDGET - WORST_CASE_PER_WORK;
    expect(fitsInBudget(spent(room), 1)).toBe(true); // exactly at the boundary
    expect(fitsInBudget(spent(room - 1), 1)).toBe(true);
    expect(fitsInBudget(spent(room + 1), 1)).toBe(false);
  });

  it("stays under the platform limit even if the next work is the worst case", () => {
    // The point of reserving the worst case rather than the average: whatever the check admits, the
    // work that follows it cannot cross 50.
    const room = SUBREQUEST_BUDGET - WORST_CASE_PER_WORK;
    expect(room + WORST_CASE_PER_WORK).toBeLessThanOrEqual(50);
  });

  it("lets a run of cheap works through where a fixed batch size could not", () => {
    // Seven backfill works (already have a QID, ~2 calls each) all fit — that population is exactly
    // what a lowered BATCH_SIZE would have throttled for no reason.
    const usage = new UsageRecorder(null);
    let admitted = 0;
    for (let i = 0; i < 7; i++) {
      if (!fitsInBudget(usage, i)) break;
      admitted++;
      usage.countFetch();
      usage.countFetch();
    }
    expect(admitted).toBe(7);
  });

  it("stops a run of expensive works before the limit", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Identity-resolving works at the worst case: the meter should cut the batch short rather than
    // let the tick overrun and mark healthy works failed.
    const usage = new UsageRecorder(null);
    let admitted = 0;
    for (let i = 0; i < 7; i++) {
      if (!fitsInBudget(usage, i)) break;
      admitted++;
      for (let c = 0; c < WORST_CASE_PER_WORK; c++) usage.countFetch();
    }
    expect(admitted).toBeGreaterThanOrEqual(2);
    expect(admitted).toBeLessThan(7);
    expect(usage.externalCalls).toBeLessThanOrEqual(50);
  });
});
