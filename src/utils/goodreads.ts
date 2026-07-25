import type { ReadStatus, OwningStatus } from "@/types/book";

const REQUIRED_HEADERS = [
  "Book Id",
  "Title",
  "Author",
  "ISBN",
  "ISBN13",
  "My Rating",
  "Date Added",
  "Exclusive Shelf",
];

export function isGoodreadsExport(headers: string[]): boolean {
  return REQUIRED_HEADERS.every((h) => headers.includes(h));
}

// Goodreads wraps ISBN-shaped columns in an Excel formula (="055215430X") so Excel doesn't
// mangle the leading zero / treat it as a number — strip that wrapper to get the raw value.
function stripExcelWrapper(raw: string): string {
  const match = raw.match(/^="?(.*?)"?$/);
  return (match ? match[1] : raw).trim();
}

export interface ParsedGoodreadsRow {
  /** Stable identity within this parse — the row's index in the source file. Lets the import
   *  session track exactly which rows are already resolved (imported/logged/queued) so a
   *  resumed run doesn't re-send or double-count them. Not Goodreads' own "Book Id" column,
   *  which callers shouldn't need to think about. */
  id: number;
  title: string;
  author: string;
  isbn: string | null;
  rating: number | null;
  createdAt: string | null;
  shelf: string;
  publisher: string | null;
  publishDate: string | null;
  numberOfPages: number | null;
  /** The non-exclusive "Bookshelves" column, trimmed and deduped (includes the exclusive shelf
   *  too, since Goodreads lists it there as well). Only used when importing shelves as tags. */
  shelves: string[];
}

// Goodreads leaves the cell blank rather than "0" for an unset page count.
function parsePageCount(raw: string | undefined): number | null {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseShelves(raw: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function parseGoodreadsRow(
  raw: Record<string, string>,
  id: number,
): ParsedGoodreadsRow {
  const isbn13 = stripExcelWrapper(raw["ISBN13"] ?? "");
  const isbn10 = stripExcelWrapper(raw["ISBN"] ?? "");

  const goodreadsRating = Number(raw["My Rating"] ?? "0");
  // Goodreads 1-5 stars -> app's 0-10 scale (x2); 0 means unrated in Goodreads.
  const rating = goodreadsRating > 0 ? goodreadsRating * 2 : null;

  const dateAdded = (raw["Date Added"] ?? "").trim();
  const publisher = (raw["Publisher"] ?? "").trim();
  const yearPublished = (raw["Year Published"] ?? "").trim();

  return {
    id,
    title: raw["Title"] ?? "",
    author: raw["Author"] ?? "",
    isbn: isbn13 || isbn10 || null,
    rating,
    createdAt: dateAdded ? dateAdded.replace(/\//g, "-") : null,
    shelf: (raw["Exclusive Shelf"] ?? "").trim(),
    publisher: publisher || null,
    publishDate: yearPublished || null,
    numberOfPages: parsePageCount(raw["Number of Pages"]),
    shelves: parseShelves(raw["Bookshelves"]),
  };
}

export interface ShelfMapping {
  status: ReadStatus;
}

// Goodreads import only ever maps reading status — a shelf says nothing about whether the user
// owns the copy, so imported scans are left at owning_status "unknown" server-side and the user
// sets ownership per book afterwards (see buildImportPayload below).
export const DEFAULT_SHELF_MAPPING: Record<string, ShelfMapping> = {
  read: { status: "read" },
  "to-read": { status: "unread" },
  "currently-reading": { status: "reading" },
  "did-not-finish": { status: "dnf" },
};

const UNKNOWN_SHELF_MAPPING: ShelfMapping = {
  status: "unread",
};

export function shelfMappingFor(
  shelf: string,
  mapping: Record<string, ShelfMapping> = DEFAULT_SHELF_MAPPING,
): ShelfMapping {
  return mapping[shelf] ?? UNKNOWN_SHELF_MAPPING;
}

// Goodreads titles often carry trailing series/collection annotations in parentheses, e.g.
// "Night Watch (Discworld, #29; City Watch, #6)" — Google Books' intitle: match is closer to
// strict-token than fuzzy, so these tokens are more likely to eliminate the right result than
// help disambiguate it. Used for the review-queue search query only; display keeps the raw title.
export function stripTitleAnnotations(title: string): string {
  let stripped = title.trim();
  let prev: string;
  do {
    prev = stripped;
    stripped = stripped.replace(/\s*\([^()]*\)\s*$/, "").trim();
  } while (stripped !== prev && stripped.length > 0);
  return stripped || title.trim();
}

export interface ImportPayloadRow {
  isbn: string;
  status: ReadStatus;
  // Never set by buildImportPayload below (Goodreads import only ever maps reading status, so a
  // CSV row asserts nothing about ownership and the server stores "unknown") — optional so the
  // edition-swap path (stores/import.ts's changeImportedEdition) can pass the item's current
  // owning_status through explicitly, preserving it across the swap.
  owning_status?: OwningStatus;
  rating: number | null;
  created_at: string | null;
  title: string | null;
  author: string | null;
  publisher: string | null;
  publish_date: string | null;
  number_of_pages: number | null;
  shelves: string[];
}

// row.isbn must be non-null — callers route no-ISBN rows to the review queue instead.
export function buildImportPayload(
  row: ParsedGoodreadsRow & { isbn: string },
  mapping: Record<string, ShelfMapping>,
): ImportPayloadRow {
  const { status } = shelfMappingFor(row.shelf, mapping);
  const title = stripTitleAnnotations(row.title).trim();
  return {
    isbn: row.isbn,
    status,
    rating: row.rating,
    created_at: row.createdAt,
    title: title || null,
    author: row.author.trim() || null,
    publisher: row.publisher,
    publish_date: row.publishDate,
    number_of_pages: row.numberOfPages,
    shelves: row.shelves,
  };
}
