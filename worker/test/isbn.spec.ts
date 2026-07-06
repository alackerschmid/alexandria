import { describe, it, expect } from "vitest";
import { normalizeIsbn, isValidIsbn } from "../src/isbn";

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
