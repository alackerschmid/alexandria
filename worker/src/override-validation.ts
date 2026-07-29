import { OVERRIDE_FIELDS, type OverrideField } from "./library-query";

/**
 * Validation for `PATCH /api/books/override`.
 *
 * The route used to bind whatever it was handed straight into the upsert, so a direct API call
 * could store a `javascript:` cover URL, a megabyte of description or a page count of `"lots"`.
 * The frontend mirrors these rules in `src/utils/book-edit.ts` so it can point at the offending
 * field before spending a request — but the frontend is not the enforcement point.
 *
 * Errors are stable machine codes, never prose: the client maps them to `detail.edit_err_<code>`,
 * so the worker ships no locale strings.
 */
export interface OverrideValidation {
  /** Normalized values for the recognised fields — trimmed, `""` collapsed to `null`. */
  values: Partial<Record<OverrideField, string | number | null>>;
  errors: Partial<Record<OverrideField, string>>;
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Overrides are held to the partial-ISO forms the frontend
 *  renders; free-form catalogue dates live on `books`, not here, and are unaffected. */
const PUBLISH_DATE_FORM =
  /^\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;
const LANGUAGE_TAG = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/i;

const MAX_LENGTH: Partial<Record<OverrideField, number>> = {
  title: 500,
  publisher: 300,
  edition_name: 120,
  language: 35,
  // Far past anything anyone types; the point is to keep a runaway client from filling a D1 row.
  description: 20_000,
  cover_url: 2048,
};

const MAX_PAGES = 100_000;

export function validateOverrides(changes: unknown): OverrideValidation {
  const values: OverrideValidation["values"] = {};
  const errors: OverrideValidation["errors"] = {};
  const input = (changes ?? {}) as Record<string, unknown>;

  for (const field of OVERRIDE_FIELDS) {
    if (!(field in input)) continue;
    const raw = input[field];

    // `null` is how the mask clears an override; it is always valid.
    if (raw === null || raw === undefined) {
      values[field] = null;
      continue;
    }

    if (field === "number_of_pages_median") {
      // A blank string clears the override, exactly as it does for every field below. The mask
      // normalizes it to `null` before it ever gets here, but a direct API call is entitled to
      // the same meaning rather than an `invalid_type` for the one numeric field.
      if (typeof raw === "string" && raw.trim() === "") {
        values[field] = null;
        continue;
      }
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isInteger(n)) {
        errors[field] = "invalid_type";
      } else if (n < 1 || n > MAX_PAGES) {
        errors[field] = "invalid_number";
      } else {
        values[field] = n;
      }
      continue;
    }

    if (typeof raw !== "string" && typeof raw !== "number") {
      errors[field] = "invalid_type";
      continue;
    }

    const text = String(raw).trim();
    if (!text) {
      values[field] = null;
      continue;
    }

    const max = MAX_LENGTH[field];
    if (max !== undefined && text.length > max) {
      errors[field] = "too_long";
      continue;
    }
    if (field === "language" && !LANGUAGE_TAG.test(text)) {
      errors[field] = "invalid_language";
      continue;
    }
    if (field === "publish_date" && !PUBLISH_DATE_FORM.test(text)) {
      errors[field] = "invalid_date";
      continue;
    }
    if (field === "cover_url" && !isHttpUrl(text)) {
      errors[field] = "invalid_url";
      continue;
    }
    values[field] = text;
  }

  return { values, errors };
}

function isHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}
