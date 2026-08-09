---
paths:
  - "src/pages/index.vue"
  - "src/pages/series.vue"
  - "src/composables/useLibraryData.ts"
  - "src/composables/useLibrarySearch.ts"
  - "src/composables/useLibraryGrouping.ts"
  - "src/composables/useEditionGrouping.ts"
  - "src/composables/useShelfGroups.ts"
  - "src/composables/useSearchSuggestions.ts"
  - "src/composables/useGroupDimensions.ts"
  - "src/components/Library*.vue"
  - "src/utils/shelf-packing.ts"
  - "src/utils/search-parse.ts"
  - "src/utils/book-display.ts"
  # The series-entry section below is the only description of `countableSeriesEntries`' rules,
  # and it names three consumer surfaces — so the file that implements it and the two new
  # consumers have to load it too, or the drift it documents is exactly what happens next.
  - "src/utils/series-completeness.ts"
  - "src/pages/stats.vue"
  - "src/pages/home.vue"
---

# Library display pipeline

The library page (`index.vue`) runs its book list through a fixed chain of composables. The
order is load-bearing:

```
useLibraryData → useLibrarySearch → useEditionGrouping → useLibraryGrouping → pagination
```

- `useLibraryData.ts` — the page's server data: paginated `GET /api/scans` (with a sequence
  guard against overlapping fetches) + `GET /api/series` membership map, exposing
  `serverBooks`/`seriesMemberships`/`error`
- `useLibrarySearch.ts` — text and filter search (`status:unread` and friends). Most of what it
  matches is per-edition; `review` is the exception — it comes from the `work_ratings` join and
  is identical across every edition of a work, which is why including it in the free-text match
  is safe upstream of collapsing (see below).

  **`missing:` is the absence facet** — `missing:cover|year|genre|pages`, a small closed enum in
  `MISSING_VALUES`. Every other key matches a value a book *has*, which left the `/stats`
  catalogue gaps with nowhere to link: "books with no cover" isn't expressible as
  `cover:something`. Deliberately not a general negation grammar (`-cover:`), which would have
  to answer much harder questions about composing with the free-text half of the query. Its
  autocomplete chips are offered only where the current pool actually contains such a book,
  same present-in-pool rule as the status facets. Membership is a **Set** (`MISSING_SET`), like
  the status facets — a bare `val in MISSING_VALUES` reaches `Object.prototype`, so
  `missing:__proto__` passed the check and then resolved to a non-function, throwing inside
  `baseFiltered` and blanking the page. And `missing:year` asks `workYear`, not `bookYear`: it
  has to agree with `year:`, the decade grouping and the worker's `noYear` tally, or a book with
  a yearless `publish_date` ("n.d.") and a real `original_pub_date` matches "no year" and
  `year:195` at the same time

  **`year:` is a prefix match, not a substring one**, over `workYear(b)` — so `year:1990` is a
  year and `year:199` is the 1990s, which is what the `/stats` decade histogram deep-links to.
  Both halves matter: a substring read also matched `year:200` against a book from 1200, and
  reading `original_pub_date` directly (as this and the `decade` grouping both used to) drops
  every book whose work isn't enriched yet — most of a young library — even though `/stats` has
  already placed it in a decade off the edition's `publish_date`. `workYear` is that fallback,
  and it is the only definition of a book's year the three surfaces are allowed to share
- `useEditionGrouping.ts` — collapses same-work editions into one synthetic card per work.
  **Must run downstream of search**, so filters match real per-edition fields rather than a
  collapsed card's representative values
- `useLibraryGrouping.ts` — group + sort. `useGroupDimensions.ts` supplies the group-by
  dimensions including custom fields
- `useShelfGroups.ts` — turns the grouping output into display-ready shelves (series
  completeness counts, unowned reveal, collapse/"show all" helpers) consumed by the
  packed-row layout

## What counts as a series entry

`countableSeriesEntries` (`src/utils/series-completeness.ts`) is **the only definition of which
entries a series' completeness is measured over**, and it decides both the counts and which
entries a shelf displays. Three surfaces share it — the library shelf's "3 / 7", home's shelf
gaps, and `/stats`' series completeness — and they drifted before it existed: the shelf filtered
to whole-numbered entries inline while `summarizeSeries` counted everything, so Discworld read
"1 / 41" on a shelf and "1 / 64" on the stats page.

- **Main entry = whole-numbered ordinal.** `work_series.ordinal` is REAL precisely to carry
  decimal interludes (5.5), and novellas/companions arrive from Wikidata with a decimal ordinal
  or none at all. `0` is a real ordinal (a prequel), only `null` is unnumbered.
- **It honours `libMainOnly`** (`stores/libraryDefaults`, default main-only) — the setting whose
  own subtitle is "Include non-whole-numbered entries in series counts". Pass the preference in;
  never default it per call site, or the three surfaces disagree again.
- **No whole-numbered entries at all → fall back to every entry.** Wikidata ordinal coverage is
  patchy (23 of 64 Discworld entries have none locally; some series have none whatsoever).
  Without the fallback such a series measures 0 of 0 — which reads as *complete*, and renders an
  **empty shelf**, since this same set drives display. The trigger is "none at all", **not** a
  coverage ratio: one numbered entry beside three unnumbered ones legitimately measures 1 of 1,
  because an unnumbered entry usually *is* a novella. Reviewed and kept as-is.
- **`/series/:id` splits rather than measures, and takes the same fallback.** The detail page
  wants `isMainSeriesEntry` itself, to show "3 of 6 main; 1 of 3 side" — the shelves' aggregate
  decomposed, not a rival count, which is why it doesn't read `libMainOnly`. But its *default*
  list comes from `countableSeriesEntries(entries, true)`, so an all-unnumbered series lands on a
  populated list and a single figure instead of an empty one under "0 of 0 main entries".

## Search bar

`LibrarySearchBar` is the smart-search widget — hero, highlight overlay, autocomplete
dropdown, token pills, ⌘K. It is backed by `useSearchSuggestions.ts`, the autocomplete engine
(prefix chips, facet-value + title matches, highlight segmentation), which reads
`useLibrarySearch`'s outputs.

Other library components: `LibraryCoverCard`, `LibraryRowCard`, `LibraryGhostRow`,
`LibraryGroupHeader` (one shelf-group header — packed `compact` / mobile `full` sizes),
`LibraryGroupTabs`, `LibraryDisplaySettings`.

## Supporting pure helpers

All unit-tested under `test/`:

- `book-display.ts` — `pickRepresentativeEdition` (which edition a collapsed work-card shows)
  and `workSiblings` (the set a per-work write must cover)
- `shelf-packing.ts` — the grouped-shelf bin-packer `packRows` plus shelf/packing types
- `search-parse.ts` — search fragment/highlight parsers

## Per-work writes

Rating and review are stored **per work, not per scan**, so `useScanStatus`'s
`setRating`/`setReview` fan out across every owned edition sharing a `work_id`. Pass
`useScanStatus({ books: () => allBooks.value })` from a page that holds a list, or the
collapsed work-card and the edition carousel drift apart until the next refetch.

The write is optimistic, but it also **reads the PATCH response back**, because two fields are
only knowable server-side: `review_updated_at` (the row's new timestamp, shown as the review's
"written" date — without it the detail keeps displaying the previous date, and a first review
shows none) and the authoritative `work_id`, which the route may have just created via
`linkWork` for a book the client still holds as unlinked. Applying that id is what lets the
*next* write fan out across the full sibling set.
