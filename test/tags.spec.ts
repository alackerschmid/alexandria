import { describe, it, expect } from "vitest";
import { parseTagList, serializeTagList, stripTagValue } from "@/utils/tags";

describe("parseTagList", () => {
  it("is empty for null, blank or malformed input", () => {
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList("")).toEqual([]);
    expect(parseTagList("not json")).toEqual([]);
    expect(parseTagList('{"a":1}')).toEqual([]);
  });

  it("drops non-string and empty entries", () => {
    expect(parseTagList('["a", 2, "", null, "b"]')).toEqual(["a", "b"]);
  });
});

describe("serializeTagList", () => {
  it("uses null for an empty list, so 'no tags' has one representation", () => {
    expect(serializeTagList([])).toBeNull();
  });

  it("round-trips through parseTagList", () => {
    const tags = ["essays", "reread"];
    expect(parseTagList(serializeTagList(tags))).toEqual(tags);
  });
});

describe("stripTagValue", () => {
  it("removes just the named value", () => {
    expect(stripTagValue('["essays","reread","1979"]', "reread")).toBe(
      '["essays","1979"]',
    );
  });

  it("returns null once the last value goes", () => {
    expect(stripTagValue('["reread"]', "reread")).toBeNull();
  });

  it("leaves a column that never held the value untouched", () => {
    // A global tag delete patches every custom field on the book; the ones that aren't tag
    // columns, or don't carry this tag, have to come back byte-identical.
    expect(stripTagValue('["essays"]', "reread")).toBe('["essays"]');
    expect(stripTagValue("Study, top row", "reread")).toBe("Study, top row");
    expect(stripTagValue(null, "reread")).toBeNull();
  });
});
