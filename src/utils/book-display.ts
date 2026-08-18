// Shared book display formatters — keep title/author fallbacks and date parsing in one place.
import { BCP47 } from "@/plugins/i18n";
import type { Book, ReadStatus, WorkEdition } from "@/types/book";
import type { SortOption } from "@/types/library";

/** Stable sort by acquisition date: `asc` oldest-first, `desc` newest-first. */
export function sortByCreatedAt(list: Book[], dir: SortOption): Book[] {
  return [...list].sort((a, b) =>
    dir === "asc"
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at),
  );
}

/** Reading status by progress, most-progressed first — `dnf` last as the abandoned end of the axis.
 *  Distinct from STATUS_ORDER (useBookStatus.ts), which orders the quick-cycle button. Shared by the
 *  edition-collapsing rule below and the import review sort (import-sort.ts), so the two can't drift. */
export const STATUS_PROGRESS_ORDER: readonly ReadStatus[] = [
  "read",
  "reading",
  "unread",
  "dnf",
];

// Edition-collapsing priority rule: which edition "wins" when multiple editions of a work carry
// different statuses — STATUS_PROGRESS_ORDER as a higher-is-better score, most-recent tie-break.
const REPRESENTATIVE_STATUS_PRIORITY = Object.fromEntries(
  STATUS_PROGRESS_ORDER.map((s, i) => [s, STATUS_PROGRESS_ORDER.length - 1 - i]),
) as Record<ReadStatus, number>;

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

/**
 * Tile border for one edition of a work, shared by the Editions pane and the editions dialog.
 * They sit one click apart showing the same covers, so any divergence in how "the edition you're
 * looking at" versus "another copy you own" is marked is immediately visible to the user.
 */
export function editionBorderClass(
  edition: Pick<WorkEdition, "isbn" | "scan_id">,
  activeIsbn: string,
): string {
  if (edition.isbn === activeIsbn) return "border-2 border-orange-neon";
  if (edition.scan_id) return "border border-orange-neon/50";
  return "border border-charcoal-border";
}

/**
 * The 4-digit year in a publish date, wherever it sits in the string, or "" when there isn't one.
 *
 * `publish_date` is **not** guaranteed ISO: OpenLibrary hands back whatever the edition record
 * carries, so alongside `2004` and `2004-01` there are strings like `January 1, 2004`. Slicing
 * the first four characters off that yields "Janu", which is what used to reach the card.
 */
const YEAR_RE = /\b\d{4}\b/;

export function publishYear(date: string | null | undefined): string {
  return YEAR_RE.exec(date ?? "")?.[0] ?? "";
}

/** Publication year of an edition, or "" when unknown. */
export function editionYear(edition: Pick<WorkEdition, "publish_date">): string {
  return publishYear(edition.publish_date);
}

/** 4-digit year, preferring the edition's publish date then the work's original date. */
export function bookYear(
  book: Pick<Book, "publish_date" | "original_pub_date">,
): string {
  return publishYear(book.publish_date || book.original_pub_date);
}

/**
 * 4-digit year of the **work** — when it was written — preferring the original publication date
 * and falling back to the edition's. The opposite precedence to `bookYear`, deliberately: that
 * one answers "which printing is this", this one answers "when is this book from", so a 2019
 * reprint of a 1954 novel is a 1954 book here and a 2019 edition there.
 *
 * The client-side mirror of the worker's `extractYear` (`routes/stats.ts`), which is what the
 * `/stats` decade histogram buckets by — so anything claiming to filter or group by the same
 * decades has to come through here, or it silently drops every book placed by the fallback.
 * `original_pub_date` comes from Wikidata enrichment and is null for most of an unenriched
 * library, which is exactly when the two answers diverge most.
 *
 * The mirror leans on a writer contract: `yearFrom` (`worker/src/enrichment.ts`) is the sole
 * writer of `works.original_pub_date` and emits exactly four digits or NULL — which is why the
 * `||` fallback here (falsy-only) matches `extractYear`'s parse-failure fallback in practice,
 * and why zero-padded early years ("0500") resolve identically on both sides. One latent
 * difference remains, on the `publish_date` half: `YEAR_RE` is word-boundary anchored while
 * `extractYear`'s regex is not, so a MARC-style date like "c1990" would be bucketed by the
 * histogram but dropped here. OpenLibrary's `publish_date` passes through unnormalised
 * (`editions.ts`), so nothing rules such values out — none exist in the catalogue today
 * (verified across all distinct values), so this is recorded rather than defended against.
 */
export function workYear(
  book: Pick<Book, "publish_date" | "original_pub_date">,
): string {
  return publishYear(book.original_pub_date || book.publish_date);
}

/**
 * The `year:` search token's predicate: a **prefix** match on the work year, so `year:1954` is
 * a year and `year:195` is the 1950s — which is what the `/stats` decade histogram deep-links
 * to. Deliberately not a substring match: that also matched `year:200` against a book from
 * 1200. Lives here rather than in `useLibrarySearch` so the semantics are pinned by unit test.
 */
export function matchesYearPrefix(
  book: Pick<Book, "publish_date" | "original_pub_date">,
  prefix: string,
): boolean {
  return workYear(book).startsWith(prefix);
}

/**
 * A D1 `datetime('now')` timestamp as ms-epoch, or null when it's absent/unparseable.
 *
 * D1 stores these as `YYYY-MM-DD HH:MM:SS` in UTC with **no zone marker**, which `Date.parse`
 * reads as *local* time — so west of UTC every such timestamp lands hours early, and near
 * midnight on the wrong calendar day. Anything reading one of these columns has to come through
 * here; `/api/admin/*` sidesteps it entirely by returning ms-epoch.
 */
export function d1TimestampMs(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const then = Date.parse(iso);
  return Number.isNaN(then) ? null : then;
}

/**
 * Locale-aware "28 Jul 2026" for a full timestamp — the format the detail view uses for both the
 * acquisition date and the review's written date. Shared so the `?? "en-GB"` fallback, the field
 * set and the UTC normalization stay one decision rather than being re-typed per call site.
 */
export function formatDateTime(
  value: string | null | undefined,
  locale: string,
): string | null {
  const ms = d1TimestampMs(value);
  if (ms === null) return null;
  const loc = BCP47[locale] ?? "en-GB";
  return new Date(ms).toLocaleDateString(loc, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Locale-aware human date for partial or full ISO date strings.
 * Handles `YYYY-MM-DD` (full date), `YYYY-MM` (month + year), and returns
 * anything else (e.g. a bare year) unchanged.
 *
 * Formatted in **UTC**, unlike `formatDateTime` above. A publish date is a calendar date rather
 * than an instant: the value is built as UTC midnight, so rendering it in the reader's zone showed
 * "1965-08-09" as 8 Aug to everyone west of UTC — a day earlier than the string says, for no
 * reason a reader could act on.
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
      timeZone: "UTC",
    });
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    const [y, m] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc, {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    });
  }
  return date;
}

/**
 * Turns literal `<br>` tags into real newlines.
 *
 * Wikidata literals are plain strings, but editors transcribing verse reach for `<br>` to keep the
 * lines apart, so the tag arrives as text and renders as text. Epigraphs are where this shows,
 * being the one field that is usually a poem. Only the break is translated: the result stays a
 * string bound with `{{ }}` and displayed with `white-space: pre-line`, so no third-party metadata
 * is ever interpreted as markup. Reviews, which are user-authored and genuinely rich, keep going
 * through renderMarkdown/DOMPurify instead (utils/markdown.ts) — that path is not for this.
 */
export function unescapeLineBreaks(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "\n");
}
