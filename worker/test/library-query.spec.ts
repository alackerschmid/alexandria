import { describe, it, expect } from "vitest";
import {
  parseTagArray,
  titleCase,
  parseIntOr,
  parseAuthorsJson,
  buildScanUpdate,
  upsertWorkRating,
  isValidReview,
  normalizeReview,
  REVIEW_MAX_LENGTH,
} from "../src/library-query";

describe("parseTagArray", () => {
  it("returns [] for null", () => {
    expect(parseTagArray(null)).toEqual([]);
  });

  it("returns [] for garbage (non-JSON) input", () => {
    expect(parseTagArray("not json")).toEqual([]);
  });

  it("returns [] for valid JSON that is not an array", () => {
    expect(parseTagArray('{"a":1}')).toEqual([]);
    expect(parseTagArray("42")).toEqual([]);
  });

  it("filters out non-string and empty-string entries from a mixed array", () => {
    expect(parseTagArray('["Fantasy", "", 42, null, "Sci-Fi"]')).toEqual([
      "Fantasy",
      "Sci-Fi",
    ]);
  });

  it("returns a clean string array unchanged", () => {
    expect(parseTagArray('["Fantasy", "Sci-Fi"]')).toEqual([
      "Fantasy",
      "Sci-Fi",
    ]);
  });
});

describe("parseAuthorsJson", () => {
  it("returns [] for null", () => {
    expect(parseAuthorsJson(null)).toEqual([]);
  });

  it("returns [] for the empty-array json_group_array result", () => {
    expect(parseAuthorsJson("[]")).toEqual([]);
  });

  it("parses a json_group_array of json_object rows", () => {
    expect(
      parseAuthorsJson(
        '[{"name":"Frank Herbert","wikidata_qid":"Q184680"},{"name":"Brian Herbert","wikidata_qid":null}]',
      ),
    ).toEqual([
      { name: "Frank Herbert", wikidata_qid: "Q184680" },
      { name: "Brian Herbert", wikidata_qid: null },
    ]);
  });

  it("drops entries with a missing or empty name", () => {
    expect(
      parseAuthorsJson(
        '[{"wikidata_qid":"Q1"},{"name":"","wikidata_qid":null}]',
      ),
    ).toEqual([]);
  });

  it("returns [] for garbage (non-JSON) input", () => {
    expect(parseAuthorsJson("not json")).toEqual([]);
  });

  it("returns [] for valid JSON that is not an array", () => {
    expect(parseAuthorsJson('{"name":"Frank Herbert"}')).toEqual([]);
  });
});

describe("titleCase", () => {
  it("capitalizes the first letter of each word", () => {
    expect(titleCase("science fiction")).toBe("Science Fiction");
  });

  it("is unicode-aware and capitalizes accented/umlaut letters", () => {
    expect(titleCase("österreich")).toBe("Österreich");
    expect(titleCase("über uns")).toBe("Über Uns");
  });

  it("capitalizes after a hyphen", () => {
    expect(titleCase("science-fiction")).toBe("Science-Fiction");
  });
});

describe("isValidReview", () => {
  it("accepts null (an explicit clear)", () => {
    expect(isValidReview(null)).toBe(true);
  });

  it("accepts an ordinary string", () => {
    expect(isValidReview("# Loved it\n\nSee **chapter 4**.")).toBe(true);
  });

  it("accepts a string right at the storage cap", () => {
    expect(isValidReview("x".repeat(REVIEW_MAX_LENGTH))).toBe(true);
  });

  it("rejects a string past the storage cap", () => {
    expect(isValidReview("x".repeat(REVIEW_MAX_LENGTH + 1))).toBe(false);
  });

  it("rejects non-string, non-null values", () => {
    expect(isValidReview(42)).toBe(false);
    expect(isValidReview(undefined)).toBe(false);
    expect(isValidReview({ text: "hi" })).toBe(false);
  });
});

describe("normalizeReview", () => {
  it("collapses a whitespace-only review to null", () => {
    expect(normalizeReview("   \n\t ")).toBeNull();
  });

  it("collapses an empty string to null", () => {
    expect(normalizeReview("")).toBeNull();
  });

  it("passes null through", () => {
    expect(normalizeReview(null)).toBeNull();
  });

  it("trims surrounding whitespace but preserves inner markdown", () => {
    expect(normalizeReview("\n  # Title\n\n- a\n- b\n  ")).toBe(
      "# Title\n\n- a\n- b",
    );
  });
});

describe("buildScanUpdate", () => {
  it("emits only the columns it was given", () => {
    const { sets, binds } = buildScanUpdate({
      status: "reading",
      owningStatus: "lent_out",
    });
    expect(sets).toEqual(["status = ?", "owning_status = ?"]);
    expect(binds).toEqual(["reading", "lent_out"]);
  });

  it("never emits a rating or review column — those live on work_ratings", () => {
    const { sets } = buildScanUpdate({ status: "dnf" });
    expect(sets).toEqual(["status = ?"]);
  });

  // A rating-only PATCH touches no scan column at all. A caller that interpolates `sets`
  // unconditionally would emit `UPDATE scans SET  WHERE …`, which is a syntax error — so the
  // empty case has to stay visible.
  it("returns empty sets when nothing scan-level is being changed", () => {
    const { sets, binds } = buildScanUpdate({});
    expect(sets).toEqual([]);
    expect(binds).toEqual([]);
  });
});

// Records the SQL/binds handed to D1 instead of executing them — upsertWorkRating only builds
// statements, so its whole contract is observable this way.
function fakeDb() {
  const calls: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const call = { sql, binds: [] as unknown[] };
      calls.push(call);
      return {
        bind: (...binds: unknown[]) => {
          call.binds = binds;
          return call;
        },
      };
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe("upsertWorkRating", () => {
  it("does nothing when neither field is supplied", () => {
    const { db, calls } = fakeDb();
    expect(upsertWorkRating(db, 1, 7, {}, "overwrite")).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("overwrites a supplied field outright", () => {
    const { db, calls } = fakeDb();
    upsertWorkRating(db, 1, 7, { rating: 8 }, "overwrite");
    expect(calls[0].sql).toContain("rating = excluded.rating");
    expect(calls[0].binds).toEqual([1, 7, 8, null]);
  });

  it("only fills a gap in seed mode, so a replayed value can't stomp a newer edit", () => {
    const { db, calls } = fakeDb();
    upsertWorkRating(db, 1, 7, { rating: 8 }, "seed");
    expect(calls[0].sql).toContain(
      "rating = COALESCE(work_ratings.rating, excluded.rating)",
    );
  });

  it("leaves an omitted field at its stored value in either mode", () => {
    for (const mode of ["seed", "overwrite"] as const) {
      const { db, calls } = fakeDb();
      upsertWorkRating(db, 1, 7, { rating: 8 }, mode);
      expect(calls[0].sql).toContain("review = work_ratings.review");
    }
  });

  it("normalizes a blank review to NULL", () => {
    const { db, calls } = fakeDb();
    upsertWorkRating(db, 1, 7, { review: "   \n " }, "overwrite");
    expect(calls[0].binds).toEqual([1, 7, null, null]);
  });

  it("always refreshes updated_at — mergeWorks resolves conflicts by comparing it", () => {
    const { db, calls } = fakeDb();
    upsertWorkRating(db, 1, 7, { rating: 8 }, "overwrite");
    expect(calls[0].sql).toContain("updated_at = CURRENT_TIMESTAMP");
  });

  it("follows every write with a delete so a fully-cleared entry leaves no tombstone", () => {
    const { db, calls } = fakeDb();
    const statements = upsertWorkRating(
      db,
      1,
      7,
      { rating: null, review: null },
      "overwrite",
    );
    expect(statements).toHaveLength(2);
    expect(calls[1].sql).toContain(
      "DELETE FROM work_ratings WHERE user_id = ? AND work_id = ? AND rating IS NULL AND review IS NULL",
    );
    expect(calls[1].binds).toEqual([1, 7]);
  });
});

describe("parseIntOr", () => {
  it("parses a valid integer string", () => {
    expect(parseIntOr("42", 0)).toBe(42);
  });

  it("falls back on undefined", () => {
    expect(parseIntOr(undefined, 7)).toBe(7);
  });

  it("falls back on garbage input", () => {
    expect(parseIntOr("abc", 7)).toBe(7);
  });

  it("parses the leading integer of a partially-numeric string", () => {
    expect(parseIntOr("12abc", 0)).toBe(12);
  });
});
