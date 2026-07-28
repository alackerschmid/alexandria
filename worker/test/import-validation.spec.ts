import { describe, it, expect } from "vitest";
import {
  validateImportRow,
  validateMatchRow,
  normalizeCreatedAt,
} from "../src/import-validation";

describe("validateImportRow", () => {
  it("accepts a valid ISBN-13 row and derives the ISBN-10 form", () => {
    const result = validateImportRow({
      isbn: "978-0-306-40615-7",
      status: "read",
      owning_status: "owned",
      rating: 8,
      created_at: "2024-05-01",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.isbn13).toBe("9780306406157");
    expect(result.row.isbn10).toBe("0306406152");
    expect(result.row.status).toBe("read");
    expect(result.row.owning_status).toBe("owned");
    expect(result.row.rating).toBe(8);
    expect(result.row.created_at).toBe("2024-05-01 00:00:00");
  });

  it("accepts a valid ISBN-10 row and derives the ISBN-13 form", () => {
    const result = validateImportRow({ isbn: "0306406152" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.isbn13).toBe("9780306406157");
    expect(result.row.isbn10).toBe("0306406152");
  });

  it("rejects a checksum-invalid ISBN with reason invalid_isbn", () => {
    const result = validateImportRow({ isbn: "0306406153" });
    expect(result).toEqual({ ok: false, reason: "invalid_isbn" });
  });

  it("rejects garbage that isn't ISBN-shaped", () => {
    const result = validateImportRow({ isbn: "not-an-isbn" });
    expect(result).toEqual({ ok: false, reason: "invalid_isbn" });
  });

  it("falls back to unread for a missing or unknown status", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      status: "some-custom-shelf",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.status).toBe("unread");
  });

  it("asserts no ownership when the row doesn't supply one (a shelf says nothing about owning)", () => {
    const result = validateImportRow({ isbn: "9780306406157" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.owning_status).toBe("unknown");
  });

  it("asserts no ownership for an unrecognized owning_status rather than assuming owned", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      owning_status: "bogus",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.owning_status).toBe("unknown");
  });

  it("passes through a valid owning_status when explicitly supplied (edition-swap path)", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      owning_status: "want",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.owning_status).toBe("want");
  });

  it("trims, dedupes and caps the shelves list", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      shelves: [" to-read ", "favorites", "to-read", "", "  "],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.shelves).toEqual(["to-read", "favorites"]);
  });

  it("returns an empty shelves array when the field is missing or not an array", () => {
    const missing = validateImportRow({ isbn: "9780306406157" });
    const wrongType = validateImportRow({
      isbn: "9780306406157",
      shelves: "to-read" as any,
    });
    expect(missing.ok && missing.row.shelves).toEqual([]);
    expect(wrongType.ok && wrongType.row.shelves).toEqual([]);
  });

  it("keeps a valid rating when status is read", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      status: "read",
      rating: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.rating).toBe(6);
  });

  // A rating is stored on the work, not the scan, so the row's shelf no longer gates it —
  // Goodreads either has a score for this book or it doesn't.
  it("keeps the rating when the status is not read", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      status: "to-read" as any,
      rating: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // "to-read" isn't a VALID_STATUSES value, so status still falls back to unread.
    expect(result.row.status).toBe("unread");
    expect(result.row.rating).toBe(8);
  });

  it("drops an out-of-range rating", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      status: "read",
      rating: 11,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.rating).toBeNull();
  });

  it("treats a missing rating as null", () => {
    const result = validateImportRow({ isbn: "9780306406157", status: "read" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.rating).toBeNull();
  });

  it("normalizes title/author/publisher/publish_date/number_of_pages, trimming and capping length", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      title: "  Dune  ",
      author: "  Frank Herbert ",
      publisher: "  Ace Books ",
      publish_date: " 1965 ",
      number_of_pages: 412,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.title).toBe("Dune");
    expect(result.row.author).toBe("Frank Herbert");
    expect(result.row.publisher).toBe("Ace Books");
    expect(result.row.publish_date).toBe("1965");
    expect(result.row.number_of_pages).toBe(412);
  });

  it("collapses blank/whitespace-only metadata fields to null", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      title: ' '.repeat(3),
      author: undefined,
      publisher: "",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.title).toBeNull();
    expect(result.row.author).toBeNull();
    expect(result.row.publisher).toBeNull();
  });

  it("treats a non-positive or non-finite page count as null", () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      const result = validateImportRow({
        isbn: "9780306406157",
        number_of_pages: bad,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok");
      expect(result.row.number_of_pages).toBeNull();
    }
  });
});

describe("normalizeCreatedAt", () => {
  it("accepts a plain YYYY-MM-DD date", () => {
    expect(normalizeCreatedAt("2023-11-02")).toBe("2023-11-02 00:00:00");
  });

  it("returns null for a missing or empty value", () => {
    expect(normalizeCreatedAt(undefined)).toBeNull();
    expect(normalizeCreatedAt(null)).toBeNull();
    expect(normalizeCreatedAt("")).toBeNull();
  });

  it("returns null for a malformed date string", () => {
    expect(normalizeCreatedAt("2023/11/02")).toBeNull();
    expect(normalizeCreatedAt("not-a-date")).toBeNull();
  });

  it("returns null for an invalid calendar date that Date would roll over", () => {
    expect(normalizeCreatedAt("2024-02-30")).toBeNull();
  });

  it("clamps a future date to today", () => {
    const farFuture = "2999-01-01";
    const result = normalizeCreatedAt(farFuture);
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(result).toBe(`${todayIso} 00:00:00`);
  });
});

describe("validateMatchRow", () => {
  it("returns null for a blank or missing title", () => {
    expect(validateMatchRow({ title: "" })).toBeNull();
    expect(validateMatchRow({ title: ' '.repeat(3) })).toBeNull();
  });

  it("trims the title and defaults a missing author to an empty string", () => {
    const result = validateMatchRow({ title: "  Dune  " });
    expect(result).toEqual({
      title: "Dune",
      author: "",
      status: "unread",
      rating: null,
    });
  });

  it("falls back to unread for a missing or unknown status", () => {
    const result = validateMatchRow({ title: "Dune", status: "some-custom-shelf" });
    expect(result?.status).toBe("unread");
  });

  it("keeps the rating regardless of status", () => {
    const result = validateMatchRow({
      title: "Dune",
      status: "to-read" as any,
      rating: 8,
    });
    expect(result?.status).toBe("unread");
    expect(result?.rating).toBe(8);
  });

  it("drops an out-of-range rating", () => {
    const result = validateMatchRow({ title: "Dune", rating: 11 });
    expect(result?.rating).toBeNull();
  });
});
