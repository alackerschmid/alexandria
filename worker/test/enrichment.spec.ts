import { describe, it, expect } from "vitest";
import {
  classifyError,
  scheduleRetry,
  SparqlError,
  RETRY_POLICY,
  LONG_COOLDOWN_MINUTES,
  type FailureReason,
  pickVerifiedQid,
  pickExactQid,
  parseEntitySearchQids,
  rankSurvivors,
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

describe("pickExactQid", () => {
  const labels = (entries: [string, string[]][]) => new Map(entries);

  // The series-typed retry runs with the type guard dropped, so this is the only thing between a
  // series item and a merge. Every case below is a real one from the production library.

  it("accepts the four works Wikidata also types as a series", () => {
    // Single novels carrying a trilogy/dylogy/limited-series/novel-series co-type. Their own label
    // *is* the searched title, which is what makes them safe to accept without the type guard.
    for (const [title, qid] of [
      ["Cryptonomicon", "Q534975"],
      ["Reamde", "Q7301391"],
      ["Watchmen", "Q128444"],
      ["Daemon", "Q5208252"],
    ] as const) {
      expect(pickExactQid(title, [qid], labels([[qid, [title]]]))).toBe(qid);
    }
  });

  it("still matches across languages", () => {
    expect(
      pickExactQid(
        "Unendlicher Spaß",
        ["Q1077445"],
        labels([["Q1077445", ["Infinite Jest", "Unendlicher Spaß"]]]),
      ),
    ).toBe("Q1077445");
  });

  it("rejects a volume against its series item", () => {
    // The whole point. Under titleScorer these score 1.000 by prefix containment, which is how eight
    // Malazan volumes collapsed onto Q458982 in the first place.
    expect(
      pickExactQid(
        "Das Spiel der Götter (12)",
        ["Q458982"],
        labels([["Q458982", ["Malazan Book of the Fallen", "Das Spiel der Götter"]]]),
      ),
    ).toBeNull();
    expect(
      pickExactQid("ILIUM", ["Q692326"], labels([["Q692326", ["Ilium/Olympos"]]])),
    ).toBeNull();
  });

  it("rejects the subtitled edition titleScorer deliberately accepts", () => {
    // The one behavioural difference worth stating: forgiveness is the risk here, not the goal.
    expect(
      pickExactQid(
        "Infinite Jest (30th Anniversary Edition)",
        ["Q1077445"],
        labels([["Q1077445", ["Infinite Jest"]]]),
      ),
    ).toBeNull();
  });

  it("ignores case, diacritics and whitespace, as normalizeStr does", () => {
    expect(
      pickExactQid(
        "  unendlicher  SPASS ",
        ["Q1077445"],
        labels([["Q1077445", ["Unendlicher Spass"]]]),
      ),
    ).toBe("Q1077445");
  });
});

describe("parseEntitySearchQids", () => {
  const hits = (...titles: unknown[]) => ({
    query: { search: titles.map((title) => ({ title })) },
  });

  it("returns the hits' QIDs in the order the search ranked them", () => {
    // Rank order is the contract: `pickVerifiedQid` takes the first candidate that verifies.
    expect(parseEntitySearchQids(hits("Q130283", "Q7941656", "Q320363"))).toEqual(
      ["Q130283", "Q7941656", "Q320363"],
    );
  });

  it("treats an explicitly empty result as a real zero-hit answer", () => {
    expect(parseEntitySearchQids({ query: { search: [] } })).toEqual([]);
  });

  it("drops anything that isn't a bare QID", () => {
    // The pattern is the only guard left on text that reaches a SPARQL VALUES block, so a hit title
    // carrying query syntax must not survive it.
    expect(
      parseEntitySearchQids(
        hits(
          "Q42",
          "Q1 } UNION { ?work wdt:P31 wd:Q5 . VALUES ?x {",
          "Property:P31",
          "Main Page",
          "q42",
          "Q",
          "Q12x",
          42,
          null,
          undefined,
        ),
      ),
    ).toEqual(["Q42"]);
  });

  /**
   * The Action API answers HTTP 200 with an `error` envelope, so `fetchWikidataJson`'s status-based
   * classification cannot see these. Reading them as "no hits" would persist the work as done-with-
   * no-QID and no sweeper query would ever serve it again — the exact permanent-stall this pipeline
   * was rewritten to escape. All four codes below are real, observed against the live API.
   */
  describe("throws rather than reporting zero hits", () => {
    const cases: [string, string, FailureReason][] = [
      ["query-service lag", "maxlag", "rate_limited"],
      ["search load-shedding", "cirrussearch-too-busy-error", "rate_limited"],
      ["wiki in read-only mode", "readonly", "rate_limited"],
      ["a title over 300 chars", "cirrussearch-query-too-long", "other"],
    ];

    for (const [label, code, kind] of cases) {
      it(`${label} → ${kind}`, () => {
        try {
          parseEntitySearchQids({ error: { code, info: "…" } });
          throw new Error("expected a throw");
        } catch (e) {
          expect(e).toBeInstanceOf(SparqlError);
          expect((e as SparqlError).kind).toBe(kind);
        }
      });
    }

    it("an unexpected shape, since only an empty array means no hits", () => {
      for (const json of [{}, { query: {} }, { query: { search: null } }, null]) {
        expect(() => parseEntitySearchQids(json)).toThrow(SparqlError);
      }
    });
  });
});

describe("rankSurvivors", () => {
  it("orders by the search ranking, not by the set it filters against", () => {
    // The eligible set arrives from a SPARQL response, which has no meaningful order; feeding it in
    // reverse must not change the outcome.
    const searchOrder = ["Q1", "Q2", "Q3", "Q4"];
    const eligible = new Set(["Q4", "Q2"]);
    expect(rankSurvivors(searchOrder, eligible, 10)).toEqual(["Q2", "Q4"]);
  });

  it("keeps the best-ranked `max`, not an arbitrary `max`", () => {
    const searchOrder = Array.from({ length: 12 }, (_, i) => `Q${i + 1}`);
    expect(rankSurvivors(searchOrder, new Set(searchOrder), 10)).toEqual(
      searchOrder.slice(0, 10),
    );
  });

  it("drops an eligible QID that was never a search hit", () => {
    // It could only get there through a bug, and it has no rank — so it has no place in a list
    // whose whole meaning is rank order.
    expect(rankSurvivors(["Q1"], new Set(["Q1", "Q999"]), 10)).toEqual(["Q1"]);
  });

  it("returns nothing when no candidate survived", () => {
    expect(rankSurvivors(["Q1", "Q2"], new Set(), 10)).toEqual([]);
  });
});
