import { describe, it, expect } from "vitest";
import {
  cardWriteSet,
  findAbsorbTarget,
  writesToAdopt,
  type CardWrites,
  type ScanWrite,
} from "../src/utils/import-cards";

function card(scanId: number, siblings: [number, ScanWrite["previousStatus"]][] = []): CardWrites {
  return {
    scanId,
    siblingUpdates: siblings.map(([id, previousStatus]) => ({ scanId: id, previousStatus })),
  };
}

function write(scanId: number, previousStatus: ScanWrite["previousStatus"]): ScanWrite {
  return { scanId, previousStatus };
}

describe("cardWriteSet", () => {
  it("is the primary alone when the work has one copy", () => {
    expect(cardWriteSet(card(7))).toEqual([7]);
  });

  it("includes every copy the import wrote alongside the primary", () => {
    expect(cardWriteSet(card(7, [[8, "unread"], [9, "read"]]))).toEqual([7, 8, 9]);
  });
});

describe("findAbsorbTarget", () => {
  it("finds nothing when no scan is shared", () => {
    expect(findAbsorbTarget([card(1), card(2, [[3, "read"]])], [write(4, "unread")])).toBeUndefined();
  });

  it("matches primary against primary", () => {
    const target = card(1);
    expect(findAbsorbTarget([target, card(2)], [write(1, "read")])).toBe(target);
  });

  // The case the primary-only check missed: an exact-ISBN row can land on a scan that an earlier
  // work-matched row only recorded as a sibling.
  it("matches a row's primary against an existing card's sibling", () => {
    const target = card(1, [[5, "unread"]]);
    expect(findAbsorbTarget([card(9), target], [write(5, "reading")])).toBe(target);
  });

  it("matches a row's sibling against an existing card's primary", () => {
    const target = card(5);
    expect(findAbsorbTarget([target], [write(1, "read"), write(5, "reading")])).toBe(target);
  });

  it("matches on a shared sibling when neither primary overlaps", () => {
    const target = card(1, [[5, "unread"]]);
    expect(findAbsorbTarget([target], [write(2, "read"), write(5, "reading")])).toBe(target);
  });

  it("returns the first overlapping card, so one scan never ends up on two", () => {
    const first = card(1, [[5, "unread"]]);
    expect(findAbsorbTarget([first, card(5)], [write(5, "read")])).toBe(first);
  });
});

describe("writesToAdopt", () => {
  it("adopts a copy the card doesn't track yet", () => {
    expect(writesToAdopt(card(1), [write(1, "read"), write(2, "unread")])).toEqual([
      { scanId: 2, previousStatus: "unread" },
    ]);
  });

  it("never re-adopts the card's own primary", () => {
    expect(writesToAdopt(card(1), [write(1, "read")])).toEqual([]);
  });

  // The earlier entry holds the true pre-import status; a later row's "previous" for the same scan is
  // only what the earlier row already wrote to it.
  it("keeps the existing entry for a scan the card already knows", () => {
    expect(writesToAdopt(card(1, [[2, "unread"]]), [write(2, "reading")])).toEqual([]);
  });

  it("adopts only the unknown ones out of a mixed set", () => {
    const result = writesToAdopt(card(1, [[2, "unread"]]), [
      write(1, "reading"),
      write(2, "reading"),
      write(3, "read"),
      write(4, "dnf"),
    ]);
    expect(result).toEqual([
      { scanId: 3, previousStatus: "read" },
      { scanId: 4, previousStatus: "dnf" },
    ]);
  });

  it("de-duplicates within one row's writes", () => {
    expect(writesToAdopt(card(1), [write(2, "unread"), write(2, "read")])).toEqual([
      { scanId: 2, previousStatus: "unread" },
    ]);
  });
});
