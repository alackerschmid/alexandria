import { describe, it, expect } from "vitest";
import {
  applyImportRating,
  claimScans,
  pickPrimarySibling,
} from "../src/routes/import";

/**
 * The pieces the import wizard's per-batch concurrency guarantees rest on. All three are pure —
 * `applyImportRating` only *builds* statements — so the fake below needs nothing but `prepare`.
 */
function fakeDb() {
  return {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
  } as unknown as D1Database;
}

describe("claimScans", () => {
  it("claims every id and reports success when none are taken", () => {
    const claimed = new Set<number>();
    expect(claimScans(claimed, [1, 2, 3])).toBe(true);
    expect([...claimed]).toEqual([1, 2, 3]);
  });

  it("declines when any id is already claimed", () => {
    const claimed = new Set([7]);
    expect(claimScans(claimed, [5, 7])).toBe(false);
  });

  // The contract that matters: a losing row reports `duplicate` and writes nothing, so it must not
  // have taken half its ids on the way out — the next row targeting id 5 has to be able to claim it.
  it("is all-or-nothing: a declined claim adds nothing", () => {
    const claimed = new Set([7]);
    claimScans(claimed, [5, 7]);
    expect(claimed.has(5)).toBe(false);
    expect(claimScans(claimed, [5])).toBe(true);
  });

  it("declines a second identical claim — two rows resolving to one scan", () => {
    const claimed = new Set<number>();
    expect(claimScans(claimed, [42])).toBe(true);
    expect(claimScans(claimed, [42])).toBe(false);
  });

  it("succeeds vacuously on an empty id list", () => {
    const claimed = new Set([1]);
    expect(claimScans(claimed, [])).toBe(true);
    expect([...claimed]).toEqual([1]);
  });

  it("tolerates a repeated id within one claim", () => {
    // A row can name the same scan twice (one book under both ISBN forms); that is one claim, not
    // a self-collision.
    const claimed = new Set<number>();
    expect(claimScans(claimed, [3, 3])).toBe(true);
    expect([...claimed]).toEqual([3]);
  });
});

describe("pickPrimarySibling", () => {
  const sib = (id: number, owning_status: string) => ({ id, owning_status });

  it("prefers an owned copy over an earlier unowned one", () => {
    const siblings = [sib(1, "unknown"), sib(2, "owned")];
    expect(pickPrimarySibling(siblings).id).toBe(2);
  });

  it("counts lent_out as owned", () => {
    // OWNED_OWNING_STATUSES — the same gate series completeness and the ownership stats use.
    expect(pickPrimarySibling([sib(1, "want"), sib(2, "lent_out")]).id).toBe(2);
  });

  it("takes the first owned copy when several qualify — callers order by created_at", () => {
    expect(
      pickPrimarySibling([sib(1, "unknown"), sib(2, "owned"), sib(3, "lent_out")])
        .id,
    ).toBe(2);
  });

  it("falls back to the oldest when nothing is owned", () => {
    expect(pickPrimarySibling([sib(1, "unknown"), sib(2, "want")]).id).toBe(1);
  });

  it("does not treat 'unowned' or 'unknown' as ownership", () => {
    expect(pickPrimarySibling([sib(1, "unowned"), sib(2, "unknown")]).id).toBe(1);
  });
});

describe("applyImportRating", () => {
  const db = fakeDb();

  it("writes the incoming rating and claims the work", () => {
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, 10, 8, null, rated);
    expect(result.value).toBe(8);
    expect(result.statements).toHaveLength(2); // upsert + the empty-row DELETE
    expect(rated.get(10)).toBe(8);
  });

  it("writes nothing for a book with no work link, reporting the prior value", () => {
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, null, 8, 5, rated);
    expect(result).toEqual({ statements: [], value: 5 });
    expect(rated.size).toBe(0);
  });

  it("leaves the stored rating alone when the CSV row carries none", () => {
    // Goodreads leaves unrated books at 0, which the validation maps to null — "no opinion",
    // not "clear my rating".
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, 10, null, 6, rated);
    expect(result).toEqual({ statements: [], value: 6 });
    // Still claimed, so a second row for the same work reports 6 rather than writing its own.
    expect(rated.get(10)).toBe(6);
  });

  it("reports null — not a rating — when neither side has one", () => {
    const rated = new Map<number, number | null>();
    expect(applyImportRating(db, 1, 10, null, null, rated).value).toBeNull();
    // Nothing worth claiming: no value to report to a later row either.
    expect(rated.has(10)).toBe(false);
  });

  it("lets only the first of two rows targeting one work write", () => {
    // Two editions of one work in the same batch are distinct scans, so `claimedScanIds` lets both
    // through — this is the claim that stops them both writing the single shared rating.
    const rated = new Map<number, number | null>();
    const first = applyImportRating(db, 1, 10, 9, null, rated);
    const second = applyImportRating(db, 1, 10, 3, null, rated);
    expect(first.statements).toHaveLength(2);
    expect(second.statements).toEqual([]);
    // The loser reports the winner's value, so both cards show the rating the work actually has.
    expect(second.value).toBe(9);
  });

  it("reports the claimed value even when the winner declined to write", () => {
    const rated = new Map<number, number | null>();
    applyImportRating(db, 1, 10, null, 7, rated); // claims 7 without writing
    const second = applyImportRating(db, 1, 10, 2, 7, rated);
    expect(second).toEqual({ statements: [], value: 7 });
  });

  it("seed mode declines when the work is already rated", () => {
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, 10, 9, 4, rated, "seed");
    // COALESCE would have kept 4 anyway; skipping the write keeps `value` honest.
    expect(result).toEqual({ statements: [], value: 4 });
    expect(rated.get(10)).toBe(4);
  });

  it("seed mode writes when there is no stored rating", () => {
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, 10, 9, null, rated, "seed");
    expect(result.value).toBe(9);
    expect(result.statements).toHaveLength(2);
  });

  it("overwrite mode replaces a stored rating", () => {
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, 10, 9, 4, rated, "overwrite");
    expect(result.value).toBe(9);
    expect(result.statements).toHaveLength(2);
  });

  it("keeps a claim per work rather than per row", () => {
    const rated = new Map<number, number | null>();
    applyImportRating(db, 1, 10, 9, null, rated);
    const other = applyImportRating(db, 1, 11, 5, null, rated);
    expect(other.statements).toHaveLength(2);
    expect(other.value).toBe(5);
  });

  it("treats a rating of 0 as a value, not as absent", () => {
    // 0 reaches here only from an explicit `{ rating: 0 }`; the Goodreads 0 is normalized to null
    // upstream. `== null` rather than a falsy check is what keeps this from silently skipping.
    const rated = new Map<number, number | null>();
    const result = applyImportRating(db, 1, 10, 0, 7, rated);
    expect(result.value).toBe(0);
    expect(result.statements).toHaveLength(2);
  });
});
