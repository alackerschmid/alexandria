import { computed, type Ref } from "vue";
import { authorDisplayName } from "@/utils/book-display";
import { countableSeriesEntries } from "@/utils/series-completeness";
import type { BookGroup } from "@/composables/useLibraryGrouping";
import type { ParsedSearch } from "@/composables/useLibrarySearch";
import type { ShelfEntry, ShelfGroup } from "@/utils/shelf-packing";
import type { Book } from "@/types/book";

// Full series membership (incl. unowned entries) as returned by GET /api/series,
// used for completeness counts and the unowned-reveal on grouped-by-series shelves.
export type SeriesEntry = {
  work_id: number;
  ordinal: number | null;
  title: string | null;
  owned: number;
  isbn: string | null;
  cover_url: string | null;
  scan_id: number | null;
};
export type SeriesMemberships = Record<
  number,
  { id: number; name: string | null; entries: SeriesEntry[] }
>;

/**
 * Turns the raw grouping output (`allGroups`) into display-ready shelves: series
 * groups get completeness counts and unowned reveal from the full membership
 * fetch, other groups get a plain count. Also owns the collapse/"show all"
 * visibility helpers the page template and the packed-row layout consume.
 */
export function useShelfGroups(options: {
  allGroups: Ref<BookGroup[]>;
  /** Unfiltered edition-grouped books, keyed to resolve one representative per work. */
  groupedAllBooks: Ref<Book[]>;
  seriesMemberships: Ref<SeriesMemberships>;
  parsedSearch: Ref<ParsedSearch>;
  search: Ref<string>;
  // Writable-computed display settings and plain computeds alike satisfy Ref<T>.
  mainOnly: Ref<boolean>;
  showUnowned: Ref<boolean>;
  onlyOwned: Ref<boolean>;
  shelfRowSize: Ref<number>;
  expanded: Ref<Record<string, boolean>>;
  currentPage: Ref<number>;
  pageSize: Ref<number>;
}) {
  const {
    allGroups,
    groupedAllBooks,
    seriesMemberships,
    parsedSearch,
    search,
    mainOnly,
    showUnowned,
    onlyOwned,
    shelfRowSize,
    expanded,
    currentPage,
    pageSize,
  } = options;

  // Keyed by work_id so a work with multiple owned scans resolves to one representative
  // (via useEditionGrouping's priority rule) — deliberately built from the unfiltered
  // allBooks, since series-shelf entries below aren't meant to react to the active search.
  const booksByWorkId = computed(() => {
    const m = new Map<number, Book>();
    for (const b of groupedAllBooks.value)
      if (b.work_id != null) m.set(b.work_id, b);
    return m;
  });

  const bookToEntry = (b: Book): ShelfEntry => ({
    key: `b${b.id}`,
    title: b.title || b.isbn,
    cover_url: b.cover_url ?? null,
    ordinal: b.series_ordinal ?? null,
    owned: true,
    status: b.status,
    owningStatus: b.owning_status,
    author: authorDisplayName(b),
    book: b,
    seriesId: b.series_id ?? null,
    editionCount: b.editionCount,
  });

  const shelfGroups = computed<ShelfGroup[]>(() =>
    allGroups.value.map((g): ShelfGroup => {
      // Series group with full membership → counts + completeness + unowned reveal.
      if (g.seriesId != null && seriesMemberships.value[g.seriesId]) {
        const members = seriesMemberships.value[g.seriesId].entries;
        // `countableSeriesEntries` owns the main-sequence rule and the no-ordinals fallback, and
        // is shared with `summarizeSeries` — home's shelf gaps and the stats page's series
        // completeness are the same claim as this shelf's "3 / 7" and must not drift from it.
        const pool = countableSeriesEntries(members, mainOnly.value);
        // Completeness reflects actual possession (worker-computed `owned`, which now
        // requires owning_status 'owned'/'lent_out') and is intentionally independent of the
        // "Owned books only" / `owning:` display filters below — narrowing visible tiles
        // shouldn't change the underlying completeness fact, any more than a text search does.
        const denom = pool.length;
        const numer = pool.filter((e) => e.owned).length;
        const complete = denom > 0 && numer === denom;
        const visible = showUnowned.value ? pool : pool.filter((e) => e.owned);
        // "Owned books only" and the `owning:` search token both filter by owning_status —
        // a display filter, distinct from the FRBR ownership (`e.owned`) that drives
        // showUnowned/completeness above, so it's applied after entries are built.
        const owningFilter = parsedSearch.value.owning;
        const entries: ShelfEntry[] = visible
          .map((e) => {
            const book = booksByWorkId.value.get(e.work_id);
            return {
              key: `m${e.work_id}`,
              title: e.title,
              cover_url: book?.cover_url ?? e.cover_url ?? null,
              ordinal: e.ordinal,
              owned: !!e.owned,
              status: book?.status,
              owningStatus: book?.owning_status,
              author: book ? authorDisplayName(book) : null,
              book,
              seriesId: g.seriesId,
              editionCount: book?.editionCount,
            };
          })
          .filter((entry) => {
            if (
              onlyOwned.value &&
              entry.book &&
              entry.book.owning_status !== "owned"
            )
              return false;
            if (owningFilter && entry.book?.owning_status !== owningFilter)
              return false;
            return true;
          });
        return {
          key: g.key,
          label: g.label,
          seriesId: g.seriesId,
          complete,
          countLabel: `${numer} / ${denom}`,
          entries,
        };
      }
      // Series fallback (membership not loaded yet) — owned-only against series_total.
      if (g.seriesId != null) {
        const total = g.seriesTotal ?? g.books.length;
        const complete = total > 0 && g.books.length === total;
        return {
          key: g.key,
          label: g.label,
          seriesId: g.seriesId,
          complete,
          countLabel: `${g.books.length} / ${total}`,
          entries: g.books.map((b) => bookToEntry(b)),
        };
      }
      // Non-series groups (author/genre/standalone/…): plain count.
      return {
        key: g.key,
        label: g.label,
        seriesId: g.seriesId ?? null,
        complete: false,
        countLabel: String(g.books.length),
        entries: g.books.map((b) => bookToEntry(b)),
      };
    }),
  );

  const pagedGroups = computed<ShelfGroup[]>(() => {
    const start = (currentPage.value - 1) * pageSize.value;
    return shelfGroups.value.slice(start, start + pageSize.value);
  });

  // Collapsed shelves show one row; expanded show everything.
  // While a search is active, always show all matches — no collapsing.
  const hasActiveSearch = computed(() => search.value.trim().length > 0);
  const shelfVisible = (g: ShelfGroup): ShelfEntry[] =>
    hasActiveSearch.value || expanded.value[g.key]
      ? g.entries
      : g.entries.slice(0, shelfRowSize.value);
  const shelfTotal = (g: ShelfGroup): number => g.entries.length;
  const shelfHasMore = (g: ShelfGroup): boolean =>
    !hasActiveSearch.value && shelfTotal(g) > shelfRowSize.value;

  // Desktop packed rendering only: when collapsed, show one fewer raw entry than the row
  // threshold whenever a trailing "show all" tile will also be shown, so cards+tile
  // together total exactly one row's width in the common case. This is a best-effort fit,
  // not a hard guarantee: `expandEntry` (tile shelf only) can inject extra edition-card
  // slots for an already-visible entry *after* this cap is applied, growing the row beyond
  // this count — `packRows`'s unconditional flush at the end of a `hasMore` group is what
  // actually prevents the tile from bleeding into the next group's row in that case (see
  // its comment). Mobile's classic layout doesn't need any of this: its "show all" control
  // lives in the header line, not the card grid.
  // `hasMore` is passed in (rather than recomputed here) so packRows — which already needs
  // it to decide whether to append the trailing tile — computes it exactly once per group.
  const packedShelfVisible = (g: ShelfGroup, hasMore: boolean): ShelfEntry[] => {
    if (hasActiveSearch.value || expanded.value[g.key]) return g.entries;
    const rowSize = shelfRowSize.value;
    const cap = hasMore ? rowSize - 1 : rowSize;
    return g.entries.slice(0, cap);
  };

  return {
    bookToEntry,
    shelfGroups,
    pagedGroups,
    hasActiveSearch,
    shelfVisible,
    shelfTotal,
    shelfHasMore,
    packedShelfVisible,
  };
}
