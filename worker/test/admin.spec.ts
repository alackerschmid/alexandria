import { describe, it, expect } from "vitest";
import { summarizeRuns, type RunRow } from "../src/routes/admin";

const row = (
  outcome: string,
  count: number,
  totalMs: number,
  failureReason: string | null = null,
): RunRow => ({
  outcome,
  failure_reason: failureReason,
  count,
  total_ms: totalMs,
});

describe("summarizeRuns", () => {
  it("returns a complete, zeroed shape for an empty window", () => {
    // An idle instance is the normal case for this board, and the panel reads every field
    // unconditionally — a missing key would render as blank rather than as zero.
    expect(summarizeRuns([], 0)).toEqual({
      total: 0,
      byOutcome: { done: 0, not_found: 0, failed: 0 },
      failureReasons: [],
      avgDurationMs: 0,
      p95DurationMs: 0,
    });
  });

  it("sums counts and durations across groups", () => {
    const summary = summarizeRuns(
      [row("done", 3, 3000), row("not_found", 1, 500)],
      900,
    );
    expect(summary.total).toBe(4);
    expect(summary.byOutcome).toEqual({ done: 3, not_found: 1, failed: 0 });
    expect(summary.avgDurationMs).toBe(875); // 3500 / 4
    expect(summary.p95DurationMs).toBe(900); // passed through, computed in SQL
  });

  it("adds up several groups sharing one outcome", () => {
    // SQL groups by (outcome, failure_reason), so 'failed' arrives split across reasons.
    const summary = summarizeRuns(
      [
        row("failed", 2, 200, "timeout"),
        row("failed", 5, 500, "http_5xx"),
        row("done", 1, 100),
      ],
      100,
    );
    expect(summary.byOutcome.failed).toBe(7);
    expect(summary.total).toBe(8);
  });

  it("counts failure reasons only for failed rows, most frequent first", () => {
    const summary = summarizeRuns(
      [
        row("failed", 1, 100, "timeout"),
        row("failed", 4, 400, "rate_limited"),
        // A non-failed row carrying a reason must not be counted — the column is only meaningful
        // on 'failed', and trusting it elsewhere would inflate the reasons panel.
        row("done", 9, 900, "timeout"),
      ],
      100,
    );
    expect(summary.failureReasons).toEqual([
      { reason: "rate_limited", count: 4, transient: true },
      { reason: "timeout", count: 1, transient: true },
    ]);
  });

  it("labels a reason's transience from RETRY_POLICY, not from a hand-kept list", () => {
    const summary = summarizeRuns(
      [
        row("failed", 1, 10, "network"),
        row("failed", 1, 10, "other"),
        // An outcome written by an older build, whose reason this build no longer knows: treated
        // as a query bug (the reading that gets looked at) rather than as upstream pressure.
        row("failed", 1, 10, "gremlins"),
      ],
      10,
    );
    expect(summary.failureReasons).toEqual(
      expect.arrayContaining([
        { reason: "network", count: 1, transient: true },
        { reason: "other", count: 1, transient: false },
        { reason: "gremlins", count: 1, transient: false },
      ]),
    );
  });

  it("buckets a failed row with no reason under 'other'", () => {
    const summary = summarizeRuns([row("failed", 2, 20, null)], 20);
    expect(summary.failureReasons).toEqual([
      { reason: "other", count: 2, transient: false },
    ]);
  });

  it("ignores an outcome it doesn't know, except in the total", () => {
    // byOutcome is a fixed triple by design (`GET /api/scans` never exposes more), so an
    // unexpected value must not crash or invent a key — it just isn't broken out.
    const summary = summarizeRuns([row("skipped", 3, 300)], 0);
    expect(summary.total).toBe(3);
    expect(summary.byOutcome).toEqual({ done: 0, not_found: 0, failed: 0 });
  });

  it("treats a null total_ms as zero rather than poisoning the average", () => {
    // SUM() over an empty group is NULL in SQLite; `NaN` here would reach the board as a blank.
    const summary = summarizeRuns(
      [{ ...row("done", 2, 0), total_ms: null as unknown as number }],
      0,
    );
    expect(summary.avgDurationMs).toBe(0);
  });

  it("rounds the average to whole milliseconds", () => {
    expect(summarizeRuns([row("done", 3, 1000)], 0).avgDurationMs).toBe(333);
  });
});
