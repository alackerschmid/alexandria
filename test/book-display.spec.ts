import { describe, it, expect } from "vitest";
import {
  workSiblings,
  pickRepresentativeEdition,
  publishYear,
  bookYear,
  d1TimestampMs,
  formatDateTime,
  formatPublishDate,
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

/**
 * `formatDateTime` renders an *instant* (a scan's acquisition time, a review's written date) in the
 * reader's own zone, so its output legitimately depends on the host timezone — the assertions below
 * pin the parsing, the locale mapping and the field set without pinning a calendar day.
 * `formatPublishDate` is the opposite case and is asserted literally; see its own block.
 */
describe("formatDateTime", () => {
  const enOpts = {
    year: "numeric",
    month: "short",
    day: "numeric",
  } as const;

  it("reads the zone-less D1 timestamp as UTC before formatting", () => {
    expect(formatDateTime("2026-07-28 12:00:00", "en")).toBe(
      new Date(Date.UTC(2026, 6, 28, 12)).toLocaleDateString("en-GB", enOpts),
    );
  });

  it("renders day, month name and year — and no time", () => {
    expect(formatDateTime("2026-07-28 12:00:00", "en")).toMatch(
      /^\d{1,2} \w+ 2026$/,
    );
  });

  it("uses the locale's own format", () => {
    // de-DE puts a period after the day; the mapping from the app's "de" is what this asserts.
    expect(formatDateTime("2026-07-28 12:00:00", "de")).toMatch(
      /^\d{1,2}\. \w+ 2026$/,
    );
  });

  it("falls back to en-GB for an unknown locale", () => {
    const value = "2026-07-28 12:00:00";
    expect(formatDateTime(value, "fr")).toBe(formatDateTime(value, "en"));
  });

  it("returns null rather than a placeholder when there is no timestamp", () => {
    // The callers render nothing at all for null; an "Invalid Date" string would reach the UI.
    expect(formatDateTime(null, "en")).toBeNull();
    expect(formatDateTime(undefined, "en")).toBeNull();
    expect(formatDateTime("", "en")).toBeNull();
    expect(formatDateTime("not a date", "en")).toBeNull();
  });
});

describe("formatPublishDate", () => {
  it("formats a full ISO date with a short month", () => {
    expect(formatPublishDate("1965-08-09", "en")).toBe("9 Aug 1965");
    expect(formatPublishDate("1965-08-09", "de")).toBe("9. Aug. 1965");
  });

  it("formats a year-month as month name plus year, with no invented day", () => {
    expect(formatPublishDate("1965-08", "en")).toBe("August 1965");
    expect(formatPublishDate("1965-08", "de")).toBe("August 1965");
  });

  // Guards the guard. Every assertion below about UTC-pinned formatting is vacuous unless the
  // suite runs *behind* UTC — which is where the bug reproduces and where neither CI (UTC) nor
  // development (CET) sits. vitest.config.ts pins TZ for that reason; this fails if the pin is
  // removed or moved to UTC, rather than letting the block go quietly inert.
  it("runs behind UTC, so these assertions can fail", () => {
    expect(new Date(Date.UTC(2026, 0, 1)).getDate()).not.toBe(1);
  });

  it("keeps the day the string says, in every timezone", () => {
    // Built as UTC midnight and formatted in UTC: rendering in the reader's zone showed this as
    // 8 Aug everywhere west of UTC. The value is a calendar date, not an instant.
    expect(formatPublishDate("1965-08-09", "en")).toContain("9");
    expect(formatPublishDate("2026-01-01", "en")).toBe("1 Jan 2026");
    expect(formatPublishDate("2026-12-31", "en")).toBe("31 Dec 2026");
  });

  it("returns anything else unchanged", () => {
    // A bare year is the common case (Wikidata's original_pub_date), and Google Books also supplies
    // free text — passing it through beats formatting it into something wrong.
    expect(formatPublishDate("1965", "en")).toBe("1965");
    expect(formatPublishDate("January 1, 2004", "en")).toBe("January 1, 2004");
    expect(formatPublishDate("n.d.", "en")).toBe("n.d.");
  });

  it("returns an empty string for absent input", () => {
    expect(formatPublishDate(null, "en")).toBe("");
    expect(formatPublishDate(undefined, "en")).toBe("");
    expect(formatPublishDate("", "en")).toBe("");
  });

  it("falls back to en-GB for an unknown locale", () => {
    expect(formatPublishDate("1965-08-09", "fr")).toBe("9 Aug 1965");
  });

  it("does not reformat a date-shaped string with an out-of-range month", () => {
    // "2026-13-01" matches the full-date regex, so Date.UTC rolls it into the next year. Asserted
    // as the current behaviour, not as a desirable one — the column is upstream-supplied.
    expect(formatPublishDate("2026-13-01", "en")).toBe("1 Jan 2027");
  });
});
