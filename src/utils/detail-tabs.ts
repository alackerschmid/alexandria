import type { Book } from "@/types/book";

// Which panes the book detail offers, derived from what the book actually has.
//
// The rule (and the reason this is a pure module rather than a tangle of `v-if`s): **a pane that
// would be empty is not a tab.** A book with no description and no first line has no Overview tab
// at all and opens on Details, instead of presenting a tab that leads to a hole. `review` is the
// deliberate exception — it is always offered when the user owns the book, because an unwritten
// review is the state they are most meant to act on; it carries a dot instead of disappearing.
//
// `all` is last and is the default: it stacks every other pane in one scroll, so the tabs read as
// a filter rather than a wall.

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
  dot?: boolean;
}

/** True when the Overview pane would render something. */
export function hasOverview(book: Book): boolean {
  return !!(
    book.description ||
    book.first_line ||
    book.epigraph ||
    book.genres?.length
  );
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

export interface TabContext {
  book: Book;
  /** `series.vue` renders editions the user doesn't own — nothing there is theirs to set. */
  readonly?: boolean;
  /** Custom field definitions the user has created; 0 means the Record pane has nothing to show
   *  beyond the controls, which on desktop already live in the masthead. Guest mode passes 0 —
   *  guests have no custom fields — which is the whole of guest's effect on the tab set. */
  customFieldCount: number;
  /** Owned + discoverable editions of this work, once known. */
  editionCount?: number;
  /** True below the `md` breakpoint, where the masthead's control cluster doesn't fit and the
   *  Record pane is the only place status/owning/rating can be set. */
  mobile: boolean;
}

export function buildTabs(ctx: TabContext): TabDescriptor[] {
  const tabs: TabDescriptor[] = [];

  if (hasOverview(ctx.book)) tabs.push({ key: "overview" });

  // On mobile Record always earns its place — it holds the only copy of the controls. On desktop
  // those are in the masthead, so it is worth a tab only when there are custom fields in it.
  if (!ctx.readonly && (ctx.mobile || ctx.customFieldCount > 0)) {
    tabs.push({ key: "record" });
  }

  tabs.push({ key: "details" });

  if (!ctx.readonly) {
    tabs.push({ key: "review", dot: !ctx.book.review });
  }

  if (ctx.book.work_id != null && (ctx.editionCount ?? 0) > 1) {
    tabs.push({ key: "editions", badge: ctx.editionCount });
  }

  // "All" only means something when there is more than one pane to stack.
  if (tabs.length > 1) tabs.push({ key: "all" });

  return tabs;
}

/** The tab to show, given the available set and whatever was previously active. Defaults to `all`
 *  (or the single remaining pane), and falls back rather than leaving a dead tab selected when the
 *  set shrinks — e.g. switching to a book with no description while Overview was active. */
export function resolveActiveTab(
  tabs: TabDescriptor[],
  current: TabKey | null,
): TabKey {
  if (current && tabs.some((t) => t.key === current)) return current;
  const last = tabs.at(-1);
  return last?.key ?? "details";
}
