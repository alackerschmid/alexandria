import { describe, it, expect, vi, afterEach } from "vitest";
import {
  coverBudget,
  COVER_BATCH_SIZE,
  fitsInBudget,
  SUBREQUEST_BUDGET,
  WORST_CASE_PER_WORK,
} from "../src/sweeper";
import { UsageRecorder } from "../src/usage";

/** A recorder that has already spent `n` external calls this invocation. */
const spent = (n: number) => {
  const usage = new UsageRecorder(null);
  for (let i = 0; i < n; i++) usage.countFetch();
  return usage;
};

/**
 * The tick's subrequest meter. Pure enough to test with a real `UsageRecorder` and no D1 handle:
 * `countFetch` deliberately doesn't touch the database, because a budget must be counted even where
 * telemetry isn't being written.
 */
describe("fitsInBudget", () => {
  afterEach(() => vi.restoreAllMocks());

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

/**
 * The covers phase's claim on the same 50. It runs last and takes what enrichment left, so unlike
 * `fitsInBudget` it needs no worst-case reservation — a cover is one fetch as `countFetch` sees it.
 * What it does need is the redirect discount, which is the whole reason this is a function.
 */
describe("coverBudget", () => {
  it("gives the full batch on an idle tick", () => {
    expect(coverBudget(spent(0))).toBe(COVER_BATCH_SIZE);
  });

  it("leaves the platform cushion intact when enrichment ran long", () => {
    // The regression this pins: spending the remaining allowance outright made this phase consume
    // the entire 5-request cushion SUBREQUEST_BUDGET keeps below the platform's 50 — the cushion
    // that exists precisely because redirects are invisible to the meter, and cover hosts redirect.
    const usage = spent(SUBREQUEST_BUDGET - 5);
    expect(coverBudget(usage)).toBe(2);
    expect(usage.externalCalls + coverBudget(usage) * 2).toBeLessThanOrEqual(50);
  });

  it("never exceeds the platform limit, at any point enrichment could stop", () => {
    for (let alreadySpent = 0; alreadySpent <= SUBREQUEST_BUDGET; alreadySpent++) {
      const budget = coverBudget(spent(alreadySpent));
      // Two hops per cover is the worst case the discount is sized for.
      expect(alreadySpent + Math.max(budget, 0) * 2).toBeLessThanOrEqual(50);
    }
  });

  it("returns zero or less once there is no room, rather than a negative LIMIT", () => {
    // `localizeCovers` early-returns on `limit <= 0`. Without that guard a negative value reaches
    // `LIMIT ?`, where SQLite reads -1 as *no* limit and the phase would fetch the whole backlog.
    expect(coverBudget(spent(SUBREQUEST_BUDGET))).toBe(0);
    expect(coverBudget(spent(SUBREQUEST_BUDGET + 10))).toBeLessThanOrEqual(0);
  });
});
