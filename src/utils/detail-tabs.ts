import type { Book } from "@/types/book";

// Which panes the book detail offers.
//
// The rule: **the tab row is the same for every book.** Overview, Details, Review, Editions and
// All are always present, whether or not the book has anything to put in them — a pane that has
// nothing says so (an empty Overview reads "no description available") rather than vanishing, so
// the row doesn't reshuffle as the user moves between books.
//
// The two conditions left are neither of them about emptiness:
//   - `readonly` — `series.vue` shows editions the user doesn't own, and Record/Review there
//     would offer controls that write to a scan that doesn't exist.
//   - `mobile` — Record is *only* a tab below `md`. On desktop the masthead already holds the
//     same four controls, and the pane would be a second copy of them on the same screen.
//
// `all` is last — it stacks every other pane in one scroll, so the tabs read as a filter rather
// than a wall — but **`DEFAULT_TAB` (`overview`) is what the view opens on**: what the book *is*
// comes before a dump of everything known about it.

export type TabKey =
  | "overview"
  | "record"
  | "details"
  | "review"
  | "editions"
  | "all";

export interface TabDescriptor {
  key: TabKey;
  badge?: number;
}

/** True when the Details pane's "The work" ledger would render something. `This edition` always
 *  has at least the ISBN, so Details itself is never empty — this only drives the row count. */
export function workFactCount(book: Book): number {
  return [
    book.original_pub_date,
    book.form_of_work,
    book.language_of_work,
    book.main_subject,
    book.countries_of_origin?.length,
    book.narrative_locations?.length,
    (book.awards?.length ?? 0) + (book.nominations?.length ?? 0) || null,
  ].filter(Boolean).length;
}

/** Rows the Details pane shows in total, for the All view's section summary. */
export function detailsFieldCount(book: Book): number {
  const edition = [
    book.publisher,
    book.language,
    book.publish_date,
    book.number_of_pages_median || book.reference_page_count,
    book.isbn,
    book.edition_name,
    book.physical_dimensions,
  ].filter(Boolean).length;
  return edition + workFactCount(book);
}

/** The tab a book opens on. Exported because `BookDetail` needs the same value to seed and reset
 *  `activeTab` — `resolveActiveTab` only ever *replaces* a tab that has ceased to exist, so it
 *  never moves a freshly-opened book onto the default by itself. One literal, two call sites. */
export const DEFAULT_TAB: TabKey = "overview";

export interface TabContext {
  /** `series.vue` renders editions the user doesn't own — nothing there is theirs to set. */
  readonly?: boolean;
  /** Owned + discoverable editions of this work, once known. Drives the badge only. */
  editionCount?: number;
  /** True below the `md` breakpoint, where the masthead's control cluster doesn't fit and the
   *  Record pane is the only place status/owning/rating can be set. */
  mobile: boolean;
}

export function buildTabs(ctx: TabContext): TabDescriptor[] {
  const own = !ctx.readonly;
  const tabs: (TabDescriptor | null)[] = [
    { key: "overview" },
    own && ctx.mobile ? { key: "record" } : null,
    { key: "details" },
    own ? { key: "review" } : null,
    // The badge is the only thing the count still drives — an unknown or empty count (the lookup
    // hasn't returned, or the work has one edition) shows the tab without one.
    { key: "editions", badge: ctx.editionCount || undefined },
    { key: "all" },
  ];
  return tabs.filter((tab) => tab !== null);
}

/** The tab to show, given the available set and whatever was previously active. Falls back to the
 *  default rather than leaving a dead tab selected when the set shrinks — e.g. Record was active
 *  and the next book is a readonly edition. */
export function resolveActiveTab(
  tabs: TabDescriptor[],
  current: TabKey | null,
): TabKey {
  if (current && tabs.some((t) => t.key === current)) return current;
  return DEFAULT_TAB;
}
