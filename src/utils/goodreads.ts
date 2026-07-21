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
  title: string;
  author: string;
  isbn: string | null;
  rating: number | null;
  createdAt: string | null;
  shelf: string;
  publisher: string | null;
  publishDate: string | null;
  numberOfPages: number | null;
}

// Goodreads leaves the cell blank rather than "0" for an unset page count.
function parsePageCount(raw: string | undefined): number | null {
  const n = Number((raw ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseGoodreadsRow(
  raw: Record<string, string>,
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
    title: raw["Title"] ?? "",
    author: raw["Author"] ?? "",
    isbn: isbn13 || isbn10 || null,
    rating,
    createdAt: dateAdded ? dateAdded.replace(/\//g, "-") : null,
    shelf: (raw["Exclusive Shelf"] ?? "").trim(),
    publisher: publisher || null,
    publishDate: yearPublished || null,
    numberOfPages: parsePageCount(raw["Number of Pages"]),
  };
}

export interface ShelfMapping {
  status: ReadStatus;
  owning_status: OwningStatus;
}

export const DEFAULT_SHELF_MAPPING: Record<string, ShelfMapping> = {
  read: { status: "read", owning_status: "owned" },
  "to-read": { status: "unread", owning_status: "want" },
  "currently-reading": { status: "reading", owning_status: "owned" },
  "did-not-finish": { status: "dnf", owning_status: "owned" },
};

const UNKNOWN_SHELF_MAPPING: ShelfMapping = {
  status: "unread",
  owning_status: "owned",
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
  owning_status: OwningStatus;
  rating: number | null;
  created_at: string | null;
  title: string | null;
  author: string | null;
  publisher: string | null;
  publish_date: string | null;
  number_of_pages: number | null;
}

// row.isbn must be non-null — callers route no-ISBN rows to the review queue instead.
export function buildImportPayload(
  row: ParsedGoodreadsRow & { isbn: string },
  mapping: Record<string, ShelfMapping>,
): ImportPayloadRow {
  const { status, owning_status } = shelfMappingFor(row.shelf, mapping);
  const title = stripTitleAnnotations(row.title).trim();
  return {
    isbn: row.isbn,
    status,
    owning_status,
    rating: row.rating,
    created_at: row.createdAt,
    title: title || null,
    author: row.author.trim() || null,
    publisher: row.publisher,
    publish_date: row.publishDate,
    number_of_pages: row.numberOfPages,
  };
}
