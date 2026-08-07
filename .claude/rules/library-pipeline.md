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
  is safe upstream of collapsing (see below)
- `useEditionGrouping.ts` — collapses same-work editions into one synthetic card per work.
  **Must run downstream of search**, so filters match real per-edition fields rather than a
  collapsed card's representative values
- `useLibraryGrouping.ts` — group + sort. `useGroupDimensions.ts` supplies the group-by
  dimensions including custom fields
- `useShelfGroups.ts` — turns the grouping output into display-ready shelves (series
  completeness counts, unowned reveal, collapse/"show all" helpers) consumed by the
  packed-row layout

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
