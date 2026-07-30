import { describe, it, expect } from "vitest";
import {
  classifyError,
  scheduleRetry,
  SparqlError,
  RETRY_POLICY,
  LONG_COOLDOWN_MINUTES,
  type FailureReason,
  pickVerifiedQid,
} from "../src/enrichment";

describe("classifyError", () => {
  it("extracts the kind from a SparqlError", () => {
    expect(classifyError(new SparqlError("timed out", "timeout"))).toBe(
      "timeout",
    );
    expect(classifyError(new SparqlError("rate limited", "rate_limited"))).toBe(
      "rate_limited",
    );
    expect(classifyError(new SparqlError("server error", "http_5xx"))).toBe(
      "http_5xx",
    );
    expect(classifyError(new SparqlError("bad request", "other"))).toBe(
      "other",
    );
  });

  it("classifies any non-SparqlError as network (infrastructure-adjacent, not a hopeless work)", () => {
    expect(classifyError(new Error("some D1 exception"))).toBe("network");
    expect(classifyError("a plain string")).toBe("network");
    expect(classifyError(null)).toBe("network");
  });
});

describe("scheduleRetry", () => {
  it("schedules each reason at its policy backoff while under the cap", () => {
    for (const reason of Object.keys(RETRY_POLICY) as FailureReason[]) {
      expect(scheduleRetry(reason, 1)).toEqual({
        status: "failed",
        nextRetryMinutes: RETRY_POLICY[reason].backoffMinutes,
      });
    }
  });

  it("marks the work exhausted with the long cooldown once the cap is reached", () => {
    const { capAttempts } = RETRY_POLICY.timeout;
    expect(scheduleRetry("timeout", capAttempts)).toEqual({
      status: "exhausted",
      nextRetryMinutes: LONG_COOLDOWN_MINUTES,
    });
  });

  it("keeps an exhausted work exhausted when it fails again past the cap", () => {
    const { capAttempts } = RETRY_POLICY.other;
    expect(scheduleRetry("other", capAttempts + 3)).toEqual({
      status: "exhausted",
      nextRetryMinutes: LONG_COOLDOWN_MINUTES,
    });
  });

  it("honors a Retry-After hint longer than the policy backoff", () => {
    const hintSeconds = (RETRY_POLICY.rate_limited.backoffMinutes + 10) * 60;
    expect(scheduleRetry("rate_limited", 1, hintSeconds).nextRetryMinutes).toBe(
      RETRY_POLICY.rate_limited.backoffMinutes + 10,
    );
  });

  it("ignores a Retry-After hint shorter than the policy backoff", () => {
    expect(scheduleRetry("rate_limited", 1, 30).nextRetryMinutes).toBe(
      RETRY_POLICY.rate_limited.backoffMinutes,
    );
  });
});

describe("pickVerifiedQid", () => {
  const labels = (entries: [string, string[]][]) => new Map(entries);

  it("accepts a hit whose label is the searched title", () => {
    expect(
      pickVerifiedQid("Infinite Jest", ["Q1077445"], labels([["Q1077445", ["Infinite Jest"]]])),
    ).toBe("Q1077445");
  });

  it("accepts a translated edition via the item's label in another language", () => {
    // The whole reason labels are fetched in every language: this is the *good* merge, the one that
    // pairs the German edition with the English work.
    expect(
      pickVerifiedQid(
        "Unendlicher Spaß",
        ["Q1077445"],
        labels([["Q1077445", ["Infinite Jest", "Unendlicher Spaß"]]]),
      ),
    ).toBe("Q1077445");
  });

  it("accepts a subtitled edition of the same work", () => {
    expect(
      pickVerifiedQid(
        "Infinite Jest (30th Anniversary Edition)",
        ["Q1077445"],
        labels([["Q1077445", ["Infinite Jest"]]]),
      ),
    ).toBe("Q1077445");
  });

  it("rejects the sequel the text search ranked first", () => {
    // "The Monster Baru Cormorant" scored 0.720 against "The Traitor Baru Cormorant" and was merged
    // into it, so the two books shared one status write and one rating.
    expect(
      pickVerifiedQid(
        "The Monster Baru Cormorant",
        ["Q21934324"],
        labels([["Q21934324", ["The Traitor Baru Cormorant"]]]),
      ),
    ).toBeNull();
  });

  it("rejects a same-series book with a similar German title", () => {
    // Dune Messiah's German title against Dune's German label: 0.732.
    expect(
      pickVerifiedQid(
        "Der Herr des Wüstenplaneten",
        ["Q190192"],
        labels([["Q190192", ["Dune", "Der Wüstenplanet"]]]),
      ),
    ).toBeNull();
  });

  it("falls through to a lower-ranked candidate that does match", () => {
    expect(
      pickVerifiedQid(
        "Olympos",
        ["Q692326", "Q1348195"],
        labels([
          ["Q692326", ["Ilium/Olympos"]],
          ["Q1348195", ["Olympos"]],
        ]),
      ),
    ).toBe("Q1348195");
  });

  it("returns null when a candidate has no labels at all", () => {
    expect(pickVerifiedQid("Dune", ["Q190192"], labels([]))).toBeNull();
  });
});
