import { describe, it, expect } from "vitest";
import { sanitizePreferences, parsePreferences } from "../src/preferences";

describe("sanitizePreferences", () => {
  it("accepts a flat string map", () => {
    expect(sanitizePreferences({ accent: "#3366ff", themeMode: "dark" })).toEqual({
      accent: "#3366ff",
      themeMode: "dark",
    });
  });

  it("accepts an empty object", () => {
    expect(sanitizePreferences({})).toEqual({});
  });

  it("rejects non-objects", () => {
    expect(sanitizePreferences(null)).toBeNull();
    expect(sanitizePreferences("dark")).toBeNull();
    expect(sanitizePreferences(42)).toBeNull();
    expect(sanitizePreferences([["accent", "#fff"]])).toBeNull();
  });

  it("rejects non-string values", () => {
    expect(sanitizePreferences({ defaultPageSize: 24 })).toBeNull();
    expect(sanitizePreferences({ libMainOnly: true })).toBeNull();
    expect(sanitizePreferences({ nested: { a: "b" } })).toBeNull();
  });

  it("rejects an empty key", () => {
    expect(sanitizePreferences({ "": "x" })).toBeNull();
  });

  it("rejects values and keys past their length cap", () => {
    expect(sanitizePreferences({ accent: "x".repeat(257) })).toBeNull();
    expect(sanitizePreferences({ ["k".repeat(65)]: "x" })).toBeNull();
  });

  it("rejects more keys than the cap", () => {
    const many = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`k${i}`, "v"]),
    );
    expect(sanitizePreferences(many)).toBeNull();
  });
});

describe("parsePreferences", () => {
  it("parses a stored blob", () => {
    expect(parsePreferences('{"paper":"cool"}')).toEqual({ paper: "cool" });
  });

  it("degrades to empty for missing, malformed, or out-of-bounds blobs", () => {
    expect(parsePreferences(null)).toEqual({});
    expect(parsePreferences("")).toEqual({});
    expect(parsePreferences("{not json")).toEqual({});
    expect(parsePreferences('["a"]')).toEqual({});
    expect(parsePreferences('{"defaultPageSize":24}')).toEqual({});
  });
});
