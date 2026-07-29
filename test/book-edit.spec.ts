import { describe, it, expect } from "vitest";
import {
  draftFromBook,
  isOverridden,
  normalizeField,
  overrideChanges,
  validateOverrides,
  type EditDraft,
} from "@/utils/book-edit";
import type { BookWithOverrides } from "@/types/book";

function book(over: Partial<BookWithOverrides> = {}): BookWithOverrides {
  return {
    id: 1,
    isbn: "9780000000001",
    title: "Dune",
    author: "Frank Herbert",
    cover_url: "https://example.com/dune.jpg",
    status: "read",
    owning_status: "owned",
    rating: null,
    review: null,
    created_at: "2024-01-01T00:00:00Z",
    language: "en",
    publish_date: "1965-08-01",
    number_of_pages_median: 412,
    description: "A desert planet.",
    publisher: "Chilton",
    ...over,
  };
}

function draft(b: BookWithOverrides, edits: Partial<EditDraft["values"]> = {}) {
  const d = draftFromBook(b);
  Object.assign(d.values, edits);
  return d;
}

describe("draftFromBook", () => {
  it("seeds every field as a string, nulls as empty", () => {
    const d = draftFromBook(book({ publisher: null, number_of_pages_median: null }));
    expect(d.values.title).toBe("Dune");
    expect(d.values.number_of_pages_median).toBe("");
    expect(d.values.publisher).toBe("");
    expect(d.reverted.size).toBe(0);
  });

  it("stringifies the numeric page count", () => {
    expect(draftFromBook(book()).values.number_of_pages_median).toBe("412");
  });
});

describe("isOverridden", () => {
  it("reads the flag, including the oddly-named pages one", () => {
    const b = book({ pages_overridden: 1, title_overridden: 0 });
    expect(isOverridden(b, "number_of_pages_median")).toBe(true);
    expect(isOverridden(b, "title")).toBe(false);
    expect(isOverridden(b, "publisher")).toBe(false);
  });
});

describe("normalizeField", () => {
  it("trims and maps empty to null", () => {
    const d = draft(book(), { title: "  Dune  ", publisher: " ".repeat(3) });
    expect(normalizeField(d, "title")).toBe("Dune");
    expect(normalizeField(d, "publisher")).toBeNull();
  });

  it("parses pages and rejects anything non-positive or fractional", () => {
    const b = book();
    expect(normalizeField(draft(b, { number_of_pages_median: "300" }), "number_of_pages_median")).toBe(300);
    expect(normalizeField(draft(b, { number_of_pages_median: "0" }), "number_of_pages_median")).toBeNull();
    expect(normalizeField(draft(b, { number_of_pages_median: "-3" }), "number_of_pages_median")).toBeNull();
    expect(normalizeField(draft(b, { number_of_pages_median: "1.5" }), "number_of_pages_median")).toBeNull();
    expect(normalizeField(draft(b, { number_of_pages_median: "abc" }), "number_of_pages_median")).toBeNull();
    expect(normalizeField(draft(b, { number_of_pages_median: "" }), "number_of_pages_median")).toBeNull();
  });
});

describe("overrideChanges", () => {
  it("is empty for an untouched draft", () => {
    const b = book();
    expect(overrideChanges(draftFromBook(b), b)).toEqual({});
  });

  it("is empty when an edit lands back on the same value", () => {
    const b = book();
    expect(overrideChanges(draft(b, { title: "  Dune " }), b)).toEqual({});
  });

  it("reports only the changed fields", () => {
    const b = book();
    expect(overrideChanges(draft(b, { title: "Dune (1965)", publisher: "Ace" }), b)).toEqual({
      title: "Dune (1965)",
      publisher: "Ace",
    });
  });

  it("clears an overridden field to null", () => {
    const b = book({ title_overridden: 1 });
    expect(overrideChanges(draft(b, { title: "" }), b)).toEqual({ title: null });
  });

  it("ignores clearing a field that has no override — the request could not take", () => {
    const b = book({ title_overridden: 0 });
    expect(overrideChanges(draft(b, { title: "" }), b)).toEqual({});
  });

  it("still clears an override whose value happens to equal the catalogue value", () => {
    // The merged value is non-null, so null is a real change even though nothing visibly moves.
    const b = book({ title: "Dune", title_overridden: 1 });
    expect(overrideChanges(draft(b, { title: "" }), b)).toEqual({ title: null });
  });

  it("treats a page-count edit as a number, not a string", () => {
    const b = book();
    expect(overrideChanges(draft(b, { number_of_pages_median: "500" }), b)).toEqual({
      number_of_pages_median: 500,
    });
  });

  it("does not report a page count that only changed formatting", () => {
    const b = book();
    expect(overrideChanges(draft(b, { number_of_pages_median: " 412 " }), b)).toEqual({});
  });
});

describe("validateOverrides", () => {
  it("passes a clean change set", () => {
    expect(
      validateOverrides({
        title: "Dune",
        language: "pt-BR",
        publish_date: "1965",
        number_of_pages_median: 412,
        cover_url: "https://example.com/a.jpg",
      }),
    ).toEqual({});
  });

  it("skips nulls — clearing a field is always valid", () => {
    expect(validateOverrides({ cover_url: null, language: null })).toEqual({});
  });

  it("rejects a language name typed instead of a code", () => {
    // Stricter than the worker's structural check on purpose: "German" is a well-formed subtag,
    // so only an ICU lookup tells it apart from a real one.
    expect(validateOverrides({ language: "German" }).language).toBe("invalid_language");
    expect(validateOverrides({ language: "German (Deutsch)" }).language).toBe("invalid_language");
    expect(validateOverrides({ language: "de" })).toEqual({});
    expect(validateOverrides({ language: "zh-Hant" })).toEqual({});
  });

  it("accepts the three partial date forms and rejects the rest", () => {
    expect(validateOverrides({ publish_date: "2004" })).toEqual({});
    expect(validateOverrides({ publish_date: "2004-07" })).toEqual({});
    expect(validateOverrides({ publish_date: "2004-07-15" })).toEqual({});
    expect(validateOverrides({ publish_date: "2004-13" }).publish_date).toBe("invalid_date");
    expect(validateOverrides({ publish_date: "2004-07-32" }).publish_date).toBe("invalid_date");
    expect(validateOverrides({ publish_date: "July 2004" }).publish_date).toBe("invalid_date");
  });

  it("rejects a cover URL that isn't http(s)", () => {
    expect(validateOverrides({ cover_url: "javascript:alert(1)" }).cover_url).toBe("invalid_url");
    expect(validateOverrides({ cover_url: "example.com/a.jpg" }).cover_url).toBe("invalid_url");
    // eslint-disable-next-line unicorn/prefer-https -- plain http is deliberately accepted
    expect(validateOverrides({ cover_url: "http://example.com/a.jpg" })).toEqual({});
  });

  it("enforces length caps at the boundary", () => {
    expect(validateOverrides({ title: "x".repeat(500) })).toEqual({});
    expect(validateOverrides({ title: "x".repeat(501) }).title).toBe("too_long");
    expect(validateOverrides({ description: "x".repeat(20_001) }).description).toBe("too_long");
    expect(validateOverrides({ publisher: "x".repeat(301) }).publisher).toBe("too_long");
  });

  it("enforces the page-count range", () => {
    expect(validateOverrides({ number_of_pages_median: 1 })).toEqual({});
    expect(validateOverrides({ number_of_pages_median: 100_000 })).toEqual({});
    expect(validateOverrides({ number_of_pages_median: 0 }).number_of_pages_median).toBe("invalid_number");
    expect(validateOverrides({ number_of_pages_median: 100_001 }).number_of_pages_median).toBe("invalid_number");
  });

  it("reports a too-long cover URL as too_long, not invalid_url", () => {
    const long = `https://example.com/${"x".repeat(2100)}`;
    expect(validateOverrides({ cover_url: long }).cover_url).toBe("too_long");
  });
});
