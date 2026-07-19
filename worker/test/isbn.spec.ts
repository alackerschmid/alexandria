import { describe, it, expect } from "vitest";
import {
  normalizeIsbn,
  isValidIsbn,
  isbn10To13,
  isbn13To10,
  alternateIsbnForm,
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
