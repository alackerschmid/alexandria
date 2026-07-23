// Pure validation/normalization for Goodreads CSV import rows — kept separate from the route
// so it's unit-testable without spinning up a D1/Hono context.
import { normalizeIsbn, isValidIsbn, isbn10To13, isbn13To10 } from "./isbn";
import {
  VALID_STATUSES,
  VALID_OWNING_STATUSES,
  isValidRating,
  dedupeTrimmed,
  resolveRatingForUpdate,
} from "./library-query";

export interface ImportRowInput {
  isbn: string;
  status?: string;
  owning_status?: string;
  rating?: number | null;
  created_at?: string | null;
  // Present when the CSV already carries this data — used to seed a placeholder `books` row if
  // Google Books/OpenLibrary both miss on the ISBN (see resolveEdition's fallbackMeta).
  title?: string | null;
  author?: string | null;
  publisher?: string | null;
  publish_date?: string | null;
  number_of_pages?: number | null;
  // Goodreads' own copy count — when > 0 it overrides the shelf-mapped owning_status (a stronger
  // ownership signal than which shelf a book happens to sit on).
  owned_copies?: number;
  // The Goodreads "Bookshelves" column — only ever written to book_custom_fields when the caller
  // opts in and supplies a target field id (see routes/import.ts).
  shelves?: string[];
}

export interface ValidatedImportRow {
  isbn13: string;
  isbn10: string | null;
  status: string;
  owning_status: string;
  // Gated on status === "read", for the create-new-scan path (mirrors the PATCH /api/scans/:id
  // invariant: a rating only persists on a "read" scan).
  rating: number | null;
  // The same rating, ungated by status — Goodreads either has a rating for this book or it
  // doesn't, independent of which shelf the row is on. Used by the update-on-duplicate path
  // (routes/import.ts) via resolveRatingForUpdate, which applies the status gate itself against
  // the *existing* scan's status rather than this row's.
  rawRating: number | null;
  created_at: string | null;
  title: string | null;
  author: string | null;
  publisher: string | null;
  publish_date: string | null;
  number_of_pages: number | null;
  shelves: string[];
}

const MAX_TEXT_FIELD_LENGTH = 500;

// Trims and caps length; empty/whitespace-only collapses to null. Used for the free-text CSV
// fields that seed a fallback `books` row — never trust their length or contents otherwise.
function normalizeText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_TEXT_FIELD_LENGTH);
  return trimmed || null;
}

// Mirrors editions.ts's own page-count handling (`> 0 ? n : null` for both Google Books and
// OpenLibrary responses) so a Goodreads-supplied count is treated identically to a fetched one.
function normalizePageCount(raw: number | null | undefined): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? Math.trunc(raw)
    : null;
}

const MAX_SHELVES = 50;
const MAX_SHELF_LENGTH = 100;

// Defense in depth — the client already trims/dedupes (src/utils/goodreads.ts's parseShelves),
// but this is a stored custom-field value, so it gets the same treatment as any other
// user-controllable text reaching the DB.
function normalizeShelves(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim().slice(0, MAX_SHELF_LENGTH));
  return dedupeTrimmed(cleaned).slice(0, MAX_SHELVES);
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
  const mappedOwningStatus = (
    VALID_OWNING_STATUSES as readonly string[]
  ).includes(input.owning_status ?? "")
    ? (input.owning_status as string)
    : "owned";
  // A positive copy count is a stronger, more direct ownership signal than the shelf a book
  // happens to sit on (e.g. a book on "to-read" that Goodreads says you own 1 copy of) — only
  // ever pushes toward "owned", never away from an explicit shelf-mapped status.
  const owning_status =
    typeof input.owned_copies === "number" && input.owned_copies > 0
      ? "owned"
      : mappedOwningStatus;
  const rawRating = isValidRating(input.rating ?? null)
    ? (input.rating as number)
    : null;
  // Rating only persists on a "read" scan — delegate to the shared invariant rather than
  // re-deriving it, so this create path and the update paths stay in lock-step. `?? null` fills
  // the "no rating to write" case (undefined) since a create always inserts a concrete value.
  const rating =
    resolveRatingForUpdate({
      hasStatus: true,
      effectiveStatus: status,
      hasRating: rawRating != null,
      rating: rawRating,
    }) ?? null;

  return {
    ok: true,
    row: {
      isbn13: isbns.isbn13,
      isbn10: isbns.isbn10,
      status,
      owning_status,
      rating,
      rawRating,
      created_at: normalizeCreatedAt(input.created_at),
      title: normalizeText(input.title),
      author: normalizeText(input.author),
      publisher: normalizeText(input.publisher),
      publish_date: normalizeText(input.publish_date),
      number_of_pages: normalizePageCount(input.number_of_pages),
      shelves: normalizeShelves(input.shelves),
    },
  };
}

export interface MatchRowInput {
  title: string;
  author?: string;
  status?: string;
  rating?: number | null;
}

export interface ValidatedMatchRow {
  title: string;
  author: string;
  status: string;
  // Ungated by status — see rawRating above. The /match route never creates a scan (only
  // updates or reports no_match), so there's no status-gated `rating` counterpart to compute.
  rawRating: number | null;
}

// Unlike validateImportRow, there's no ISBN and thus no hard failure mode beyond a blank title —
// a title-less row has nothing to search against, so the caller treats null as "no_match".
export function validateMatchRow(input: MatchRowInput): ValidatedMatchRow | null {
  const title = normalizeText(input.title);
  if (!title) return null;

  const status = (VALID_STATUSES as readonly string[]).includes(
    input.status ?? "",
  )
    ? (input.status as string)
    : "unread";
  const rawRating = isValidRating(input.rating ?? null)
    ? (input.rating as number)
    : null;

  return {
    title,
    author: normalizeText(input.author) ?? "",
    status,
    rawRating,
  };
}
