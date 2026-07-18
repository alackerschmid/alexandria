import { describe, it, expect } from "vitest";
import {
  validateImportRow,
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

  it("falls back to unread/owned for a missing or unknown status/owning_status", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      status: "some-custom-shelf",
      owning_status: "bogus",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.row.status).toBe("unread");
    expect(result.row.owning_status).toBe("owned");
  });

  it("drops the rating when status is not read", () => {
    const result = validateImportRow({
      isbn: "9780306406157",
      status: "to-read" as any,
      rating: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    // "to-read" isn't a valid VALID_STATUSES value so it falls back to unread — either way
    // it is not "read", so rating must be dropped.
    expect(result.row.status).toBe("unread");
    expect(result.row.rating).toBeNull();
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

  it("drops an out-of-range rating even when status is read", () => {
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
