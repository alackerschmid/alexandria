import { describe, it, expect } from "vitest";
import {
  normalizeIsbn,
  isValidIsbn,
  isIsbnFormat,
  isbn10To13,
  isbn13To10,
  alternateIsbnForm,
  isbnForms,
} from "../src/isbn";

describe("normalizeIsbn", () => {
  it("strips hyphens and spaces", () => {
    expect(normalizeIsbn("978-0-306-40615-7")).toBe("9780306406157");
    expect(normalizeIsbn("0 8044 2957 x")).toBe("080442957X");
  });

  it("uppercases a trailing X", () => {
    expect(normalizeIsbn("080442957x")).toBe("080442957X");
  });
});

describe("isValidIsbn", () => {
  it("accepts a valid ISBN-10", () => {
    expect(isValidIsbn("0306406152")).toBe(true);
  });

  it("accepts a valid ISBN-10 with an X check digit", () => {
    expect(isValidIsbn("080442957X")).toBe(true);
  });

  it("rejects an ISBN-10 with a bad checksum", () => {
    expect(isValidIsbn("0306406153")).toBe(false);
  });

  it("accepts a valid ISBN-13", () => {
    expect(isValidIsbn("9780306406157")).toBe(true);
  });

  it("rejects an ISBN-13 with a bad checksum", () => {
    expect(isValidIsbn("9780306406158")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isValidIsbn("notanisbn")).toBe(false);
    expect(isValidIsbn("")).toBe(false);
    expect(isValidIsbn("12345")).toBe(false);
  });

  it("validates the normalized (hyphen-stripped) form", () => {
    expect(isValidIsbn(normalizeIsbn("978-0-306-40615-7"))).toBe(true);
    expect(isValidIsbn(normalizeIsbn("0-8044-2957-X"))).toBe(true);
  });
});

describe("isIsbnFormat", () => {
  it("accepts both shapes", () => {
    expect(isIsbnFormat("0306406152")).toBe(true);
    expect(isIsbnFormat("9780306406157")).toBe(true);
  });

  // The whole reason this exists next to isValidIsbn: the scan queue accepts a barcode misread so
  // the offline queue can still take the scan, and resolves (or fails to resolve) metadata later.
  it("accepts a right-shaped ISBN whose checksum is wrong", () => {
    expect(isIsbnFormat("0306406153")).toBe(true);
    expect(isValidIsbn("0306406153")).toBe(false);
    expect(isIsbnFormat("9780306406158")).toBe(true);
    expect(isValidIsbn("9780306406158")).toBe(false);
  });

  it("accepts an X only as the ISBN-10 check digit", () => {
    expect(isIsbnFormat("080442957X")).toBe(true);
    expect(isIsbnFormat("08044X957X")).toBe(false);
    expect(isIsbnFormat("978030640615X")).toBe(false);
  });

  it("rejects any other length", () => {
    expect(isIsbnFormat("")).toBe(false);
    expect(isIsbnFormat("030640615")).toBe(false); // 9
    expect(isIsbnFormat("03064061521")).toBe(false); // 11
    expect(isIsbnFormat("978030640615")).toBe(false); // 12
    expect(isIsbnFormat("97803064061577")).toBe(false); // 14
  });

  it("rejects non-digits and unnormalized input — callers normalize first", () => {
    expect(isIsbnFormat("notanisbn!")).toBe(false);
    expect(isIsbnFormat("978-0-306-40615-7")).toBe(false);
    expect(isIsbnFormat("0 8044 2957 X")).toBe(false);
    // Lowercase too: normalizeIsbn uppercases, and the check is deliberately not case-insensitive.
    expect(isIsbnFormat("080442957x")).toBe(false);
    expect(isIsbnFormat(normalizeIsbn("080442957x"))).toBe(true);
  });

  it("is anchored — an ISBN embedded in a longer string is not a match", () => {
    expect(isIsbnFormat("isbn:9780306406157")).toBe(false);
    expect(isIsbnFormat("9780306406157\n")).toBe(false);
  });
});

describe("isbn10To13", () => {
  it("converts a valid ISBN-10 to its ISBN-13 form", () => {
    expect(isbn10To13("0306406152")).toBe("9780306406157");
  });

  it("converts an ISBN-10 with an X check digit", () => {
    expect(isbn10To13("080442957X")).toBe("9780804429573");
  });

  it("returns null for an invalid ISBN-10", () => {
    expect(isbn10To13("0306406153")).toBeNull();
    expect(isbn10To13("notanisbn")).toBeNull();
  });
});

describe("isbn13To10", () => {
  it("converts a 978-prefixed ISBN-13 back to ISBN-10", () => {
    expect(isbn13To10("9780306406157")).toBe("0306406152");
  });

  it("converts an ISBN-13 back to an ISBN-10 with an X check digit", () => {
    expect(isbn13To10("9780804429573")).toBe("080442957X");
  });

  it("returns null for a 979-prefixed ISBN-13 (no ISBN-10 form)", () => {
    expect(isbn13To10("9791234567896")).toBeNull();
  });

  it("returns null for an invalid ISBN-13", () => {
    expect(isbn13To10("9780306406158")).toBeNull();
    expect(isbn13To10("notanisbn")).toBeNull();
  });

  it("round-trips with isbn10To13", () => {
    const isbn10 = "0306406152";
    const isbn13 = isbn10To13(isbn10);
    expect(isbn13).not.toBeNull();
    expect(isbn13To10(isbn13 as string)).toBe(isbn10);
  });
});

describe("alternateIsbnForm", () => {
  it("converts a valid ISBN-10 to its ISBN-13 form", () => {
    expect(alternateIsbnForm("0306406152")).toBe("9780306406157");
  });

  it("converts a 978-prefixed ISBN-13 to its ISBN-10 form", () => {
    expect(alternateIsbnForm("9780306406157")).toBe("0306406152");
  });

  it("returns null for a 979-prefixed ISBN-13 (no ISBN-10 form)", () => {
    expect(alternateIsbnForm("9791234567896")).toBeNull();
  });

  it("returns null for an invalid ISBN", () => {
    expect(alternateIsbnForm("0306406153")).toBeNull();
    expect(alternateIsbnForm("notanisbn")).toBeNull();
  });
});

describe("isbnForms", () => {
  it("returns both forms of an ISBN-13 with a 10-digit equivalent", () => {
    expect(isbnForms("9780306406157")).toEqual([
      "9780306406157",
      "0306406152",
    ]);
  });

  it("returns both forms of an ISBN-10", () => {
    expect(isbnForms("0306406152")).toEqual(["0306406152", "9780306406157"]);
  });

  it("returns the input alone when there is no alternate form", () => {
    expect(isbnForms("9791234567896")).toEqual(["9791234567896"]);
    expect(isbnForms("notanisbn")).toEqual(["notanisbn"]);
  });

  // The two forms of one edition must compare equal wherever the editions subsystem asks "do we
  // already have this?" — an ISBN-13 `books` row and an ISBN-10 candidate are one physical book.
  it("makes the two forms of one edition mutually discoverable", () => {
    const known = new Set(isbnForms("9780306406157"));
    expect(known.has("0306406152")).toBe(true);
  });
});
