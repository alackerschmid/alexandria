import type { BookWithOverrides } from "@/types/book";
import { resolveLanguageName } from "@/utils/language";

/**
 * The per-user metadata overrides the edit mask can write. The client's copy of `OVERRIDE_FIELDS`
 * in `worker/src/library-query.ts` — **keep the two in sync**; the route filters the payload
 * against its own list, so a field added here alone is silently dropped.
 *
 * Order is the mask's field order, so the form and the diff can't disagree about what exists.
 */
export const OVERRIDE_FIELDS = [
  "title",
  "description",
  "publisher",
  "language",
  "publish_date",
  "number_of_pages_median",
  "edition_name",
  "cover_url",
] as const;

export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

/** The draft's per-field text. Every field is a string, `number_of_pages_median` included: an
 *  emptied numeric input yields `""`, so typing it as `number | null` only moved the parse into
 *  the template. `normalizeField` is the one place that parses. */
export type EditForm = Record<OverrideField, string>;

export interface EditDraft {
  values: EditForm;
  /**
   * Fields the user explicitly reset to the catalogue value, as opposed to merely emptied.
   * Both produce the same request (`{field: null}` deletes the override), so this is
   * presentation state: it is what lets the mask say "will be reset to the catalogue value"
   * instead of leaving a blank field that reads like data loss.
   */
  reverted: Set<OverrideField>;
}

export type OverrideChanges = Partial<Record<OverrideField, string | number | null>>;

/** Stable per-field error codes, mirroring `worker/src/override-validation.ts`. The mask maps
 *  them to `detail.edit_err_<code>` — neither side ships prose. */
export type OverrideErrors = Partial<Record<OverrideField, string>>;

/** Which `*_overridden` flag reports each field. `number_of_pages_median` is the odd one — the
 *  API calls its flag `pages_overridden` — and this map is the only place that knows it. */
const OVERRIDE_FLAGS: Record<OverrideField, keyof BookWithOverrides> = {
  title: "title_overridden",
  description: "description_overridden",
  publisher: "publisher_overridden",
  language: "language_overridden",
  publish_date: "publish_date_overridden",
  number_of_pages_median: "pages_overridden",
  edition_name: "edition_name_overridden",
  cover_url: "cover_url_overridden",
};

/** True when the book currently carries a user override for this field. */
export function isOverridden(
  book: BookWithOverrides,
  field: OverrideField,
): boolean {
  return Boolean(book[OVERRIDE_FLAGS[field]]);
}

/** The book's current *merged* value for a field — the override if there is one, else the
 *  catalogue value, since that is all `GET /api/scans` returns (it COALESCEs server-side). */
export function currentValue(
  book: BookWithOverrides,
  field: OverrideField,
): string | number | null {
  return book[field] ?? null;
}

/** Seed a fresh draft from the book's merged values. */
export function draftFromBook(book: BookWithOverrides): EditDraft {
  const values = {} as EditForm;
  for (const field of OVERRIDE_FIELDS) {
    const v = currentValue(book, field);
    values[field] = v === null ? "" : String(v);
  }
  return { values, reverted: new Set() };
}

/**
 * What the mask would send for one field: trimmed, `""` → `null` (the single representation of
 * "no override"), and pages parsed with anything non-positive treated as unset. The one
 * normalization rule, so `dirty` and `save()` can never disagree about whether something changed.
 */
export function normalizeField(
  draft: EditDraft,
  field: OverrideField,
): string | number | null {
  const raw = draft.values[field]?.trim() ?? "";
  if (!raw) return null;
  if (field === "number_of_pages_median") {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return raw;
}

/**
 * Every field whose normalized draft value differs from what the book shows today.
 *
 * Clearing a field that has **no** override is deliberately not a change: it would send
 * `{field: null}`, which writes NULL into `book_overrides` — i.e. no override — and the server
 * would hand back the catalogue value the user just cleared. Treating it as a change would light
 * up Save for an edit that provably cannot take.
 */
export function overrideChanges(
  draft: EditDraft,
  book: BookWithOverrides,
): OverrideChanges {
  const changes: OverrideChanges = {};
  for (const field of OVERRIDE_FIELDS) {
    const next = normalizeField(draft, field);
    if (next === currentValue(book, field)) continue;
    if (next === null && !isOverridden(book, field)) continue;
    changes[field] = next;
  }
  return changes;
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` — the partial-date forms the catalogue uses and
 *  `formatPublishDate` renders. */
export const PUBLISH_DATE_FORM = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

const MAX_LENGTH: Partial<Record<OverrideField, number>> = {
  title: 500,
  publisher: 300,
  edition_name: 120,
  language: 35,
  description: 20_000,
  cover_url: 2048,
};

/**
 * Client-side validation, mirroring `worker/src/override-validation.ts` so the mask can point at
 * the offending field before spending a request. Only *changed* fields are ever passed in, so a
 * free-form catalogue `publish_date` the user never touched can't block an unrelated save.
 *
 * One rule is deliberately stricter here: `language` has to name a real language, not merely look
 * like a tag. "German" is a structurally valid subtag, so only an ICU lookup catches it — which
 * the worker has no business carrying, and which is the same check the field's inline hint makes.
 */
export function validateOverrides(changes: OverrideChanges): OverrideErrors {
  const errors: OverrideErrors = {};
  for (const field of OVERRIDE_FIELDS) {
    const value = changes[field];
    if (value === undefined || value === null) continue;

    if (field === "number_of_pages_median") {
      if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 100_000)
        errors[field] = "invalid_number";
      continue;
    }

    const text = String(value);
    const max = MAX_LENGTH[field];
    if (max !== undefined && text.length > max) {
      errors[field] = "too_long";
      continue;
    }
    if (field === "language" && !resolveLanguageName(text, "en"))
      errors[field] = "invalid_language";
    else if (field === "publish_date" && !PUBLISH_DATE_FORM.test(text))
      errors[field] = "invalid_date";
    else if (field === "cover_url" && !isHttpUrl(text))
      errors[field] = "invalid_url";
  }
  return errors;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
