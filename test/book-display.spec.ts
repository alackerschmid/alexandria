import { describe, it, expect } from "vitest";
import {
  workSiblings,
  pickRepresentativeEdition,
  publishYear,
  bookYear,
  d1TimestampMs,
} from "@/utils/book-display";
import type { Book, ReadStatus } from "@/types/book";

function book(
  id: number,
  workId: number | null,
  extra: Partial<Book> = {},
): Book {
  return {
    id,
    isbn: `978000000000${id}`,
    title: `Book ${id}`,
    author: "A",
    cover_url: null,
    status: "unread" as ReadStatus,
    owning_status: "owned",
    rating: null,
    review: null,
    created_at: "2024-01-01T00:00:00Z",
    work_id: workId,
    ...extra,
  };
}

describe("workSiblings", () => {
  it("returns every book sharing the work — the set a per-work write must cover", () => {
    const a = book(1, 10);
    const b = book(2, 10);
    const other = book(3, 11);
    expect(workSiblings(a, [a, b, other])).toEqual([a, b]);
  });

  it("returns the book alone when no list is supplied", () => {
    const a = book(1, 10);
    expect(workSiblings(a, undefined)).toEqual([a]);
  });

  // work_id is NULL until enrichment links the book; unlinked books are not siblings of each
  // other just because they're both unlinked.
  it("never groups unlinked books together", () => {
    const a = book(1, null);
    const b = book(2, null);
    expect(workSiblings(a, [a, b])).toEqual([a]);
  });

  it("includes a book that isn't in the list — the detail dialog can hold a dropped copy", () => {
    const detached = book(1, 10);
    const inList = book(2, 10);
    expect(workSiblings(detached, [inList])).toEqual([detached, inList]);
  });

  it("does not duplicate the book when it is in the list", () => {
    const a = book(1, 10);
    expect(workSiblings(a, [a])).toEqual([a]);
  });
});

describe("pickRepresentativeEdition", () => {
  it("prefers the furthest-along status: read > reading > unread > dnf", () => {
    const dnf = book(1, 10, { status: "dnf" });
    const read = book(2, 10, { status: "read" });
    const reading = book(3, 10, { status: "reading" });
    expect(pickRepresentativeEdition([dnf, read, reading])).toBe(read);
  });

  it("breaks a status tie with the most recently added edition", () => {
    const older = book(1, 10, { status: "read", created_at: "2024-01-01" });
    const newer = book(2, 10, { status: "read", created_at: "2025-06-01" });
    expect(pickRepresentativeEdition([older, newer])).toBe(newer);
  });

  // Documents the deliberate divergence in migration 0042's backfill, which restricts its
  // candidates to *rated* scans: this function has no rating term, so on its own it can pick an
  // unrated edition over a rated one — which as a backfill rule would discard a real rating.
  it("has no rating term — an unrated edition can win over a rated one", () => {
    const rated = book(1, 10, { status: "read", rating: 9, created_at: "2024-01-01" });
    const unrated = book(2, 10, { status: "read", created_at: "2025-06-01" });
    expect(pickRepresentativeEdition([rated, unrated])).toBe(unrated);
  });
});

describe("publishYear", () => {
  it.each([
    ["2004", "2004"],
    ["2004-01", "2004"],
    ["2004-01-15", "2004"],
    // `publish_date` is not guaranteed ISO — OpenLibrary passes through free-form edition
    // records, and a leading 4-character slice turned this one into "Janu" on the card.
    ["January 1, 2004", "2004"],
    ["1 Jan 2004", "2004"],
    ["c. 1979", "1979"],
  ])("reads the year out of %s", (input, expected) => {
    expect(publishYear(input)).toBe(expected);
  });

  it.each([null, undefined, "", "n.d.", "12345"])(
    "is empty when there is no 4-digit year (%s)",
    (input) => {
      expect(publishYear(input)).toBe("");
    },
  );

  it("prefers the edition's own date over the work's original one", () => {
    const b = book(1, 10, {
      publish_date: "January 1, 2004",
      original_pub_date: "1936",
    });
    expect(bookYear(b)).toBe("2004");
    expect(bookYear({ ...b, publish_date: null })).toBe("1936");
  });
});

describe("d1TimestampMs", () => {
  it("reads a zone-less D1 timestamp as UTC, not local time", () => {
    // `datetime('now')` writes `YYYY-MM-DD HH:MM:SS` with no marker; `Date.parse` would take it
    // as local, putting `created_at` hours out and, near midnight, on the wrong day.
    expect(d1TimestampMs("2026-08-02 09:00:00")).toBe(Date.UTC(2026, 7, 2, 9));
  });

  it("leaves an already-explicit ISO instant alone", () => {
    expect(d1TimestampMs("2026-08-02T09:00:00Z")).toBe(Date.UTC(2026, 7, 2, 9));
  });

  it("returns null for absent or unparseable input", () => {
    expect(d1TimestampMs(null)).toBeNull();
    expect(d1TimestampMs(undefined)).toBeNull();
    expect(d1TimestampMs("")).toBeNull();
    expect(d1TimestampMs("not a date")).toBeNull();
  });
});
