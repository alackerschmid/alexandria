import { describe, it, expect } from "vitest";
import {
  bookCustomValue,
  customFieldModel,
  customFieldValues,
  customFieldsChanged,
  customFieldsPayload,
} from "@/utils/custom-fields";
import type { Book } from "@/types/book";
import type { FieldDef } from "@/stores/fieldDefs";

const defs: FieldDef[] = [
  { id: 1, name: "Shelf", type: "text" },
  { id: 2, name: "Copies", type: "integer" },
  { id: 3, name: "Tags", type: "tag" },
];

function book(values: Book["custom_field_values"] = []): Book {
  return {
    id: 1,
    isbn: "9780000000001",
    title: "T",
    author: "A",
    cover_url: null,
    status: "read",
    owning_status: "owned",
    rating: null,
    review: null,
    created_at: "2024-01-01T00:00:00Z",
    custom_field_values: values,
  };
}

describe("customFieldModel", () => {
  it("seeds one entry per definition, tags parsed into an array", () => {
    const model = customFieldModel(
      book([
        { field_def_id: 1, value: "Living room" },
        { field_def_id: 3, value: '["essays","reread"]' },
      ]),
      defs,
    );
    expect(model).toEqual({
      1: "Living room",
      2: "",
      3: ["essays", "reread"],
    });
  });

  it("gives an unset field an empty value rather than omitting it", () => {
    expect(customFieldModel(book(), defs)).toEqual({ 1: "", 2: "", 3: [] });
  });
});

describe("customFieldsPayload", () => {
  it("represents every definition, including the cleared ones", () => {
    // The endpoint replaces all values at once, so a field left out would be silently dropped.
    expect(customFieldsPayload({ 1: "Shelf A" }, defs)).toEqual([
      { field_def_id: 1, value: "Shelf A" },
      { field_def_id: 2, value: "" },
      { field_def_id: 3, value: "" },
    ]);
  });

  it("serializes tags as JSON and drops blanks", () => {
    const payload = customFieldsPayload({ 3: ["a", " ", "b"] }, defs);
    expect(payload[2].value).toBe('["a","b"]');
  });

  it("sends an empty tag list as the empty string, not []", () => {
    expect(customFieldsPayload({ 3: [] }, defs)[2].value).toBe("");
  });
});

describe("customFieldValues", () => {
  it("maps an empty value back to null, matching the Book shape", () => {
    expect(customFieldValues({ 1: "x" }, defs)).toEqual([
      { field_def_id: 1, value: "x" },
      { field_def_id: 2, value: null },
      { field_def_id: 3, value: null },
    ]);
  });
});

describe("customFieldsChanged", () => {
  const saved = book([
    { field_def_id: 1, value: "Living room" },
    { field_def_id: 3, value: '["essays"]' },
  ]);

  it("is false when the draft matches what is stored", () => {
    expect(
      customFieldsChanged(customFieldModel(saved, defs), defs, saved),
    ).toBe(false);
  });

  it("detects an edited value", () => {
    const model = { ...customFieldModel(saved, defs), 1: "Study" };
    expect(customFieldsChanged(model, defs, saved)).toBe(true);
  });

  it("detects a cleared value", () => {
    const model = { ...customFieldModel(saved, defs), 1: "" };
    expect(customFieldsChanged(model, defs, saved)).toBe(true);
  });

  it("detects an added tag", () => {
    const model = { ...customFieldModel(saved, defs), 3: ["essays", "reread"] };
    expect(customFieldsChanged(model, defs, saved)).toBe(true);
  });
});

describe("bookCustomValue", () => {
  it("returns null for a field the book has no value for", () => {
    expect(bookCustomValue(book(), 1)).toBeNull();
  });
});
