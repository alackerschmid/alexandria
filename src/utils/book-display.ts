// Shared book display formatters — keep title/author fallbacks and date parsing in one place.
import { BCP47 } from "@/plugins/i18n";
import type { Book, ReadStatus } from "@/types/book";
import type { SortOption } from "@/types/library";

/** Stable sort by acquisition date: `asc` oldest-first, `desc` newest-first. */
export function sortByCreatedAt(list: Book[], dir: SortOption): Book[] {
  return [...list].sort((a, b) =>
    dir === "asc"
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at),
  );
}

// Edition-collapsing priority rule: read > reading > unread > dnf, most-recent tie-break.
// Distinct from STATUS_ORDER (useBookStatus.ts), which orders the quick-cycle button, not
// which edition "wins" when multiple editions of a work carry different statuses.
const REPRESENTATIVE_STATUS_PRIORITY: Record<ReadStatus, number> = {
  read: 3,
  reading: 2,
  unread: 1,
  dnf: 0,
};

/** Picks the edition whose edition-only fields (cover, publisher, status, ...) represent a
 *  collapsed work-card, via the status-priority rule with most-recently-added as tie-break. */
export function pickRepresentativeEdition(editions: Book[]): Book {
  return editions.reduce((best, cur) => {
    const bestPriority = REPRESENTATIVE_STATUS_PRIORITY[best.status];
    const curPriority = REPRESENTATIVE_STATUS_PRIORITY[cur.status];
    if (curPriority !== bestPriority) return curPriority > bestPriority ? cur : best;
    return cur.created_at > best.created_at ? cur : best;
  });
}

/**
 * Every book in `all` that shares this book's work — the set a per-work value (rating, review)
 * has to be written to at once. `book` is always included, even when it isn't a member of `all`
 * (the detail dialog can hold a copy that a re-filter has since dropped from the list).
 *
 * A book with no work link is its own only sibling: `work_id` is NULL until enrichment links it,
 * and grouping unrelated unlinked books together would be wrong.
 */
export function workSiblings(book: Book, all: Book[] | undefined): Book[] {
  if (!all || book.work_id == null) return [book];
  const siblings = all.filter((b) => b.work_id === book.work_id);
  return siblings.includes(book) ? siblings : [book, ...siblings];
}

/** Title with ISBN fallback when a book has no catalogued title. */
export function displayTitle(book: Pick<Book, "title" | "isbn">): string {
  return book.title || book.isbn;
}

/** Author names, preferring the structured `authors` link over the raw string; empty when neither is known. */
export function authorNames(book: Pick<Book, "author" | "authors">): string[] {
  if (book.authors?.length) return book.authors.map((a) => a.name);
  return book.author ? [book.author] : [];
}

/** Joined author names, preferring the structured `authors` link over the raw string; null when neither is known. */
export function authorDisplayName(
  book: Pick<Book, "author" | "authors">,
): string | null {
  const names = authorNames(book);
  return names.length ? names.join(", ") : null;
}

/** Author with a translated "unknown author" fallback. Pass the i18n `t`. */
export function displayAuthor(
  book: Pick<Book, "author" | "authors">,
  t: (key: string) => string,
): string {
  return authorDisplayName(book) || t("book.unknown_author");
}

/** 4-digit year, preferring the edition's publish date then the work's original date. */
export function bookYear(
  book: Pick<Book, "publish_date" | "original_pub_date">,
): string {
  const d = book.publish_date || book.original_pub_date;
  return d ? String(d).slice(0, 4) : "";
}

/**
 * Locale-aware human date for partial or full ISO date strings.
 * Handles `YYYY-MM-DD` (full date), `YYYY-MM` (month + year), and returns
 * anything else (e.g. a bare year) unchanged.
 */
export function formatPublishDate(
  date: string | null | undefined,
  locale: string,
): string {
  if (!date) return "";
  const loc = BCP47[locale] ?? "en-GB";
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(loc, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    const [y, m] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc, {
      year: "numeric",
      month: "long",
    });
  }
  return date;
}
