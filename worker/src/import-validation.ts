// Pure validation/normalization for Goodreads CSV import rows — kept separate from the route
// so it's unit-testable without spinning up a D1/Hono context.
import { normalizeIsbn, isValidIsbn, isbn10To13, isbn13To10 } from "./isbn";
import { VALID_STATUSES, VALID_OWNING_STATUSES, isValidRating } from "./library-query";

export interface ImportRowInput {
  isbn: string;
  status?: string;
  owning_status?: string;
  rating?: number | null;
  created_at?: string | null;
}

export interface ValidatedImportRow {
  isbn13: string;
  isbn10: string | null;
  status: string;
  owning_status: string;
  rating: number | null;
  created_at: string | null;
}

export type ValidationResult =
  | { ok: true; row: ValidatedImportRow }
  | { ok: false; reason: "invalid_isbn" };

// Canonicalizes to the 13-form (used for storage/resolveEdition) while keeping the 10-form
// around too, since the library may have stored a book under either form depending on how it
// was originally scanned or looked up — the import route dedupes against both.
function normalizeAndValidateIsbn(
  raw: string,
): { isbn13: string; isbn10: string | null } | null {
  const normalized = normalizeIsbn(raw);
  if (!isValidIsbn(normalized)) return null;
  if (normalized.length === 13) {
    return { isbn13: normalized, isbn10: isbn13To10(normalized) };
  }
  const isbn13 = isbn10To13(normalized);
  return isbn13 ? { isbn13, isbn10: normalized } : null;
}

// Rejects anything that isn't a plain YYYY-MM-DD, round-trips it through Date to guard against
// silently rolling over an invalid calendar date (e.g. "2024-02-30" -> March 1st), and clamps
// future dates to today. Formatted as "YYYY-MM-DD 00:00:00" to match SQLite's CURRENT_TIMESTAMP
// text format so lexicographic date_desc sorting stays correct against server-timestamped scans.
export function normalizeCreatedAt(
  raw: string | null | undefined,
): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsedMs = Date.parse(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsedMs)) return null;
  const iso = new Date(parsedMs).toISOString().slice(0, 10);
  if (iso !== raw) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const dateOnly = [iso, todayIso].sort()[0];
  return `${dateOnly} 00:00:00`;
}

export function validateImportRow(input: ImportRowInput): ValidationResult {
  const isbns = normalizeAndValidateIsbn(input.isbn);
  if (!isbns) return { ok: false, reason: "invalid_isbn" };

  const status = (VALID_STATUSES as readonly string[]).includes(
    input.status ?? "",
  )
    ? (input.status as string)
    : "unread";
  const owning_status = (VALID_OWNING_STATUSES as readonly string[]).includes(
    input.owning_status ?? "",
  )
    ? (input.owning_status as string)
    : "owned";
  // Rating only persists on a "read" scan, mirroring the invariant enforced in routes/scans.ts —
  // a rated to-read/currently-reading row imports fine but silently drops the rating.
  const rating =
    status === "read" && isValidRating(input.rating ?? null)
      ? (input.rating as number)
      : null;

  return {
    ok: true,
    row: {
      isbn13: isbns.isbn13,
      isbn10: isbns.isbn10,
      status,
      owning_status,
      rating,
      created_at: normalizeCreatedAt(input.created_at),
    },
  };
}
