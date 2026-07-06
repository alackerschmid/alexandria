import { describe, it, expect } from "vitest";
import {
  parseTagArray,
  titleCase,
  parseIntOr,
  parseAuthorsJson,
} from "../src/library-query";

describe("parseTagArray", () => {
  it("returns [] for null", () => {
    expect(parseTagArray(null)).toEqual([]);
  });

  it("returns [] for garbage (non-JSON) input", () => {
    expect(parseTagArray("not json")).toEqual([]);
  });

  it("returns [] for valid JSON that is not an array", () => {
    expect(parseTagArray('{"a":1}')).toEqual([]);
    expect(parseTagArray("42")).toEqual([]);
  });

  it("filters out non-string and empty-string entries from a mixed array", () => {
    expect(parseTagArray('["Fantasy", "", 42, null, "Sci-Fi"]')).toEqual([
      "Fantasy",
      "Sci-Fi",
    ]);
  });

  it("returns a clean string array unchanged", () => {
    expect(parseTagArray('["Fantasy", "Sci-Fi"]')).toEqual([
      "Fantasy",
      "Sci-Fi",
    ]);
  });
});

describe("parseAuthorsJson", () => {
  it("returns [] for null", () => {
    expect(parseAuthorsJson(null)).toEqual([]);
  });

  it("returns [] for the empty-array json_group_array result", () => {
    expect(parseAuthorsJson("[]")).toEqual([]);
  });

  it("parses a json_group_array of json_object rows", () => {
    expect(
      parseAuthorsJson(
        '[{"name":"Frank Herbert","wikidata_qid":"Q184680"},{"name":"Brian Herbert","wikidata_qid":null}]',
      ),
    ).toEqual([
      { name: "Frank Herbert", wikidata_qid: "Q184680" },
      { name: "Brian Herbert", wikidata_qid: null },
    ]);
  });

  it("drops entries with a missing or empty name", () => {
    expect(
      parseAuthorsJson(
        '[{"wikidata_qid":"Q1"},{"name":"","wikidata_qid":null}]',
      ),
    ).toEqual([]);
  });

  it("returns [] for garbage (non-JSON) input", () => {
    expect(parseAuthorsJson("not json")).toEqual([]);
  });

  it("returns [] for valid JSON that is not an array", () => {
    expect(parseAuthorsJson('{"name":"Frank Herbert"}')).toEqual([]);
  });
});

describe("titleCase", () => {
  it("capitalizes the first letter of each word", () => {
    expect(titleCase("science fiction")).toBe("Science Fiction");
  });

  it("is unicode-aware and capitalizes accented/umlaut letters", () => {
    expect(titleCase("österreich")).toBe("Österreich");
    expect(titleCase("über uns")).toBe("Über Uns");
  });

  it("capitalizes after a hyphen", () => {
    expect(titleCase("science-fiction")).toBe("Science-Fiction");
  });
});

describe("parseIntOr", () => {
  it("parses a valid integer string", () => {
    expect(parseIntOr("42", 0)).toBe(42);
  });

  it("falls back on undefined", () => {
    expect(parseIntOr(undefined, 7)).toBe(7);
  });

  it("falls back on garbage input", () => {
    expect(parseIntOr("abc", 7)).toBe(7);
  });

  it("parses the leading integer of a partially-numeric string", () => {
    expect(parseIntOr("12abc", 0)).toBe(12);
  });
});
