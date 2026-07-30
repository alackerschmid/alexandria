import { describe, it, expect } from "vitest";
import { importSortRank, type ImportSortable } from "../src/utils/import-sort";
import type { OwningStatus, ReadStatus } from "../src/types/book";

function card(
  owningStatus: OwningStatus,
  status: ReadStatus,
  rating: number | null = null,
): ImportSortable {
  return { owningStatus, status, rating };
}

/** The order a list of cards ends up in — the sort as the review screen applies it. */
function ranked(cards: ImportSortable[]): ImportSortable[] {
  return [...cards].sort((a, b) => importSortRank(a) - importSortRank(b));
}

describe("importSortRank", () => {
  it("puts an owned, read, 10/10 book first", () => {
    const top = card("owned", "read", 10);
    const others = [
      card("unknown", "unread"),
      card("owned", "read", 8),
      card("owned", "reading", 10),
      card("unowned", "read", 10),
      top,
    ];
    expect(ranked(others)[0]).toBe(top);
  });

  it("orders the owning axis ahead of everything else", () => {
    // The worst reading status and rating on an owned copy still beats the best on an unowned one.
    expect(importSortRank(card("owned", "dnf", null))).toBeLessThan(
      importSortRank(card("unowned", "read", 10)),
    );
  });

  it("uses the library's owning order", () => {
    expect(
      ranked([
        card("unknown", "read"),
        card("lent_out", "read"),
        card("want", "read"),
        card("unowned", "read"),
        card("owned", "read"),
      ]).map((c) => c.owningStatus),
    ).toEqual(["owned", "unowned", "want", "lent_out", "unknown"]);
  });

  it("orders reading status most-progressed first, dnf last", () => {
    expect(
      ranked([
        card("owned", "dnf"),
        card("owned", "unread"),
        card("owned", "read"),
        card("owned", "reading"),
      ]).map((c) => c.status),
    ).toEqual(["read", "reading", "unread", "dnf"]);
  });

  it("orders reading status ahead of rating", () => {
    expect(importSortRank(card("owned", "read", 1))).toBeLessThan(
      importSortRank(card("owned", "reading", 10)),
    );
  });

  it("sorts rating descending", () => {
    expect(
      ranked([
        card("owned", "read", 4),
        card("owned", "read", 10),
        card("owned", "read", 7),
      ]).map((c) => c.rating),
    ).toEqual([10, 7, 4]);
  });

  it("sorts unrated after every rating, 0 included", () => {
    expect(
      ranked([
        card("owned", "read", null),
        card("owned", "read", 1),
        card("owned", "read", 0),
        card("owned", "read", 10),
      ]).map((c) => c.rating),
    ).toEqual([10, 1, null, 0]);
  });

  it("ranks equal cards equally, so a stable sort keeps arrival order", () => {
    expect(importSortRank(card("want", "reading", 6))).toBe(
      importSortRank(card("want", "reading", 6)),
    );
  });

  it("keeps the owning axis dominant even for an unrecognized status", () => {
    // The sentinel slot has to live inside the radix: with a radix of only the listed statuses, an
    // unknown status on an owned card overflowed into the unowned bucket and tied it exactly.
    expect(importSortRank(card("owned", "bogus" as ReadStatus, 10))).toBeLessThan(
      importSortRank(card("unowned", "read", 10)),
    );
  });

  it("ranks an unrecognized status last on its axis rather than first", () => {
    const unknownOwning = card("nonsense" as OwningStatus, "read", 10);
    expect(importSortRank(unknownOwning)).toBeGreaterThan(
      importSortRank(card("unknown", "dnf", null)),
    );
    expect(importSortRank(card("owned", "bogus" as ReadStatus, 10))).toBeGreaterThan(
      importSortRank(card("owned", "dnf", null)),
    );
  });
});
