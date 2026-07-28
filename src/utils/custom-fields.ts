import type { Book, CustomFieldValue } from "@/types/book";
import type { FieldDef } from "@/stores/fieldDefs";
import { parseTagList } from "@/utils/tags";

/** A book's stored value for a custom field definition, or null when unset. */
export function bookCustomValue(book: Book, defId: number): string | null {
  return (
    book.custom_field_values?.find((v) => v.field_def_id === defId)?.value ??
    null
  );
}

/** The editor model for one field: a string for text/integer/select/date, a string[] for tag. */
export type CustomFieldModel = Record<number, string | string[]>;

/** Seed the editor model for a book from its saved values, one entry per current definition. */
export function customFieldModel(
  book: Book,
  defs: FieldDef[],
): CustomFieldModel {
  const model: CustomFieldModel = {};
  for (const def of defs) {
    const raw = bookCustomValue(book, def.id);
    model[def.id] = def.type === "tag" ? parseTagList(raw) : (raw ?? "");
  }
  return model;
}

/** Serialize the editor model into the `PATCH /api/books/custom-fields` value list — tag arrays
 *  become JSON, everything empty becomes "" (the endpoint replaces all values at once, so every
 *  definition has to be represented, including the cleared ones). */
export function customFieldsPayload(
  model: CustomFieldModel,
  defs: FieldDef[],
): Array<{ field_def_id: number; value: string }> {
  return defs.map((def) => {
    const v = model[def.id];
    let value = "";
    if (def.type === "tag") {
      const arr = (Array.isArray(v) ? v : [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      value = arr.length ? JSON.stringify(arr) : "";
    } else if (typeof v === "string") {
      value = v;
    }
    return { field_def_id: def.id, value };
  });
}

/** The same payload in the shape `Book.custom_field_values` uses (empty string → null), for the
 *  optimistic `refreshed` patch that follows a successful save. */
export function customFieldValues(
  model: CustomFieldModel,
  defs: FieldDef[],
): CustomFieldValue[] {
  return customFieldsPayload(model, defs).map((v) => ({
    field_def_id: v.field_def_id,
    value: v.value || null,
  }));
}

/** True when the editor model differs from what the book already has saved — lets the edit form
 *  skip the custom-fields PATCH entirely when only metadata changed. */
export function customFieldsChanged(
  model: CustomFieldModel,
  defs: FieldDef[],
  book: Book,
): boolean {
  const saved = customFieldsPayload(customFieldModel(book, defs), defs);
  const next = customFieldsPayload(model, defs);
  return next.some((v, i) => v.value !== saved[i]?.value);
}
