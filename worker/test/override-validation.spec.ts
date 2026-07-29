import { describe, it, expect } from "vitest";
import { validateOverrides } from "../src/override-validation";

describe("validateOverrides", () => {
  it("ignores fields that aren't overridable", () => {
    const { values, errors } = validateOverrides({
      author: "Someone",
      isbn: "9780000000001",
      wikidata_qid: "Q1",
    });
    expect(values).toEqual({});
    expect(errors).toEqual({});
  });

  it("normalizes strings and collapses blanks to null", () => {
    const { values, errors } = validateOverrides({
      title: "  Dune  ",
      publisher: " ".repeat(3),
      description: null,
    });
    expect(values).toEqual({ title: "Dune", publisher: null, description: null });
    expect(errors).toEqual({});
  });

  it("distinguishes an absent field from an explicit null", () => {
    expect(validateOverrides({ title: null }).values).toEqual({ title: null });
    expect(validateOverrides({}).values).toEqual({});
  });

  it("accepts a numeric page count and a numeric string", () => {
    expect(validateOverrides({ number_of_pages_median: 412 }).values).toEqual({
      number_of_pages_median: 412,
    });
    expect(validateOverrides({ number_of_pages_median: "412" }).values).toEqual({
      number_of_pages_median: 412,
    });
  });

  it("clears the page count on a blank string, like every other field", () => {
    // The mask sends `null`, but a direct API call sending `""` means the same thing here as it
    // does for `title` — clear the override, not "invalid".
    expect(validateOverrides({ number_of_pages_median: "" }).values).toEqual({
      number_of_pages_median: null,
    });
    expect(validateOverrides({ number_of_pages_median: " ".repeat(3) }).errors).toEqual(
      {},
    );
  });

  it("rejects a page count that isn't a whole number in range", () => {
    expect(validateOverrides({ number_of_pages_median: 0 }).errors).toEqual({
      number_of_pages_median: "invalid_number",
    });
    expect(validateOverrides({ number_of_pages_median: 100_001 }).errors).toEqual({
      number_of_pages_median: "invalid_number",
    });
    expect(validateOverrides({ number_of_pages_median: 1.5 }).errors).toEqual({
      number_of_pages_median: "invalid_type",
    });
    expect(validateOverrides({ number_of_pages_median: "lots" }).errors).toEqual({
      number_of_pages_median: "invalid_type",
    });
    expect(validateOverrides({ number_of_pages_median: 1 }).values).toEqual({
      number_of_pages_median: 1,
    });
    expect(validateOverrides({ number_of_pages_median: 100_000 }).values).toEqual({
      number_of_pages_median: 100_000,
    });
  });

  it("rejects non-scalar values", () => {
    expect(validateOverrides({ title: { a: 1 } }).errors).toEqual({
      title: "invalid_type",
    });
    expect(validateOverrides({ description: ["x"] }).errors).toEqual({
      description: "invalid_type",
    });
  });

  it("holds publish_date to the partial-ISO forms", () => {
    for (const ok of ["2004", "2004-07", "2004-07-15"])
      expect(validateOverrides({ publish_date: ok }).values).toEqual({
        publish_date: ok,
      });
    for (const bad of ["2004-13", "2004-07-32", "July 2004", "04-07-15"])
      expect(validateOverrides({ publish_date: bad }).errors).toEqual({
        publish_date: "invalid_date",
      });
  });

  it("holds language to a BCP-47-shaped tag", () => {
    for (const ok of ["de", "pt-BR", "zh-Hant"])
      expect(validateOverrides({ language: ok }).values).toEqual({ language: ok });
    for (const bad of ["German (Deutsch)", "d", "en_US", "12"])
      expect(validateOverrides({ language: bad }).errors).toEqual({
        language: "invalid_language",
      });
  });

  it("checks the shape of a language tag, not whether it names a real language", () => {
    // "German" is a structurally valid 6-letter subtag. Catching it needs an ICU lookup, which
    // is the frontend's job (`resolveLanguageName` powers the inline hint) — the worker's
    // contract is only that what it stores can't break the display path.
    expect(validateOverrides({ language: "German" }).errors).toEqual({});
  });

  it("rejects a cover URL that isn't http(s)", () => {
    expect(validateOverrides({ cover_url: "javascript:alert(1)" }).errors).toEqual({
      cover_url: "invalid_url",
    });
    expect(validateOverrides({ cover_url: "data:image/png;base64,AA" }).errors).toEqual({
      cover_url: "invalid_url",
    });
    expect(validateOverrides({ cover_url: "example.com/a.jpg" }).errors).toEqual({
      cover_url: "invalid_url",
    });
    expect(validateOverrides({ cover_url: "https://example.com/a.jpg" }).values).toEqual(
      { cover_url: "https://example.com/a.jpg" },
    );
  });

  it("enforces length caps at the boundary", () => {
    expect(validateOverrides({ title: "x".repeat(500) }).errors).toEqual({});
    expect(validateOverrides({ title: "x".repeat(501) }).errors).toEqual({
      title: "too_long",
    });
    expect(validateOverrides({ publisher: "x".repeat(301) }).errors).toEqual({
      publisher: "too_long",
    });
    expect(validateOverrides({ description: "x".repeat(20_001) }).errors).toEqual({
      description: "too_long",
    });
    expect(
      validateOverrides({ cover_url: `https://e.com/${"x".repeat(2100)}` }).errors,
    ).toEqual({ cover_url: "too_long" });
  });

  it("reports every offending field at once, and keeps the valid ones", () => {
    const { values, errors } = validateOverrides({
      title: "Dune",
      language: "en_US",
      publish_date: "yesterday",
    });
    expect(values).toEqual({ title: "Dune" });
    expect(errors).toEqual({
      language: "invalid_language",
      publish_date: "invalid_date",
    });
  });

  it("tolerates a null or undefined body", () => {
    expect(validateOverrides(null)).toEqual({ values: {}, errors: {} });
    expect(validateOverrides(undefined)).toEqual({ values: {}, errors: {} });
  });
});
