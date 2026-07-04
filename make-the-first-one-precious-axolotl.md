# Plan: Use the `authors` table for display, grouping, search, and stats

## Context

The app has a FRBR-style schema where `works`/`authors`/`work_authors` were introduced (migration 0009) explicitly as an "analytics foundation" for author identity (dedup via `normalized_name`, future linking via `wikidata_qid`). In practice, nothing ever switched over: every author-facing surface in the app (list display, sort, book detail, click-to-filter, grouping, search, and stats' "top authors") still reads the raw `books.author` string — a comma-joined value straight from Google Books/OpenLibrary. As a result:

- Co-authored books are treated as one opaque bucket keyed on the full joined string (e.g. "Jane Doe, John Smith") in grouping, search-facets, and stats — they never surface under either author individually.
- Name variants ("J.R.R. Tolkien" vs "J. R. R. Tolkien") are never consolidated.
- The `authors.wikidata_qid` data that enrichment already collects is captured but never surfaced anywhere.

This change makes the `authors`/`work_authors` tables the source of truth for author identity everywhere the app currently treats `books.author` as an opaque string, while keeping the raw string as a fallback for books whose work hasn't been linked yet (e.g. pending enrichment).

**Confirmed decisions:**
- Legacy `work_authors` rows (pre-ordinal) get backfilled to `ordinal = 0` — no attempt to recover exact original order via fragile SQL string-splitting. Acceptable minor/cosmetic regression for pre-existing multi-author entries until re-linked.
- `BookDetail.vue` renders each co-author as its own clickable chip (filtering by that individual name), consistent with how genres/awards already render.
- Stats "top authors"/"author count" switch to per-individual-author counting (a co-authored book increments both authors' counts) — a deliberate behavior change from today's per-string bucket.
- `book.author` (raw string) is kept as a permanent fallback field, not removed — used only when a work has no linked `authors` rows yet.

## Implementation Steps

### 1. Migration — `worker/migrations/0029_work_authors_ordinal.sql`
- `ALTER TABLE work_authors ADD COLUMN ordinal INTEGER;`
- Backfill: `UPDATE work_authors SET ordinal = 0 WHERE ordinal IS NULL;` (all legacy rows tie at 0; `author_id` order is the tiebreaker for display until a work is re-linked).
- `CREATE INDEX idx_work_authors_ordinal ON work_authors(work_id, ordinal);`
- Before finalizing the query in step 3, verify D1 supports `json_group_array`/`json_object` via `wrangler d1 execute --local` — fall back to a JS-side aggregation in `library-query.ts` if not supported.

### 2. `worker/src/editions.ts` — populate ordinal in `linkWork()`
- Change `authors.map((name) => ...)` to `authors.map((name, idx) => ...)` in the `work_authors` insert loop (~line 444-452).
- Insert as `INSERT OR IGNORE INTO work_authors (work_id, author_id, ordinal) SELECT ?, id, ? FROM authors WHERE normalized_name = ?`, binding `(workId, idx, normalizeStr(name))`.
- Keep `INSERT OR IGNORE` (not `ON CONFLICT DO UPDATE`) — first-linked edition's author order wins and re-scans/re-runs can't corrupt an existing ordinal. Consistent with how `works.match_key` already behaves as first-write-wins.

### 3. `worker/src/library-query.ts` — structured `authors` field
- Add a correlated scalar subquery to `buildScanSelect()` (no JOIN fan-out, preserves 1-row-per-scan):
  ```sql
  (SELECT json_group_array(json_object('name', a.name, 'wikidata_qid', a.wikidata_qid))
   FROM work_authors wa JOIN authors a ON a.id = wa.author_id
   WHERE wa.work_id = b.work_id
   ORDER BY wa.ordinal, wa.author_id)                  AS authors_json
  ```
- Keep `b.author AS author` unchanged as the raw fallback.
- Add a `parseAuthorsJson()` helper next to `parseTagArray`, applied wherever `attachCustomFields`/response-shaping already parses `genres`/`awards`, producing `authors: {name, wikidata_qid}[]` (empty array when unlinked).
- Leave `SORT_CLAUSES.author_asc/desc` on `COALESCE(b.author, '')` — raw string is still a reasonable proxy for primary-author sort; not worth the divergence risk of switching to the structured field.

### 4. `worker/src/routes/stats.ts` — per-individual-author counts
- Add `b.work_id` to the base stats query's SELECT (needed to detect unlinked books).
- Add a second parallel query (alongside the existing `Promise.all`) joining `work_authors`/`authors`, grouped by `a.id`, for linked books' author counts.
- For books with `work_id IS NULL` or no `work_authors` rows, fall back to splitting `r.author` via `splitAuthors`/`normalizeStr` (exported from `editions.ts`) and merge into the same count map, keyed by normalized name — prefer the linked `authors.name` as the canonical display label when both sources hit the same normalized name.
- `authorCount` = distinct count from the merged map (or a dedicated `COUNT(DISTINCT a.id)` query for the linked portion, merged with unlinked distinct names).
- All other shared aggregates (byStatus, languages, genres, publishers, decades) are unaffected — this is an additive query, not a modification of the existing shared `rows` result set.

### 5. Types
- `worker/src/types.ts`: add `AuthorRef = { name: string; wikidata_qid: string | null }`.
- `src/types/book.ts`: add `authors?: AuthorRef[]` to `Book`, keep existing `author: string | null` untouched.
- `src/types/stats.ts`: no shape change (`topAuthors`/`authorCount` semantics change but types are unchanged).

### 6. Frontend
- `src/utils/book-display.ts` — `displayAuthor()`: prefer `book.authors.map(a => a.name).join(', ')` when non-empty, else fall back to `book.author`. This is the single choke point for any caller that doesn't need per-author interactivity (e.g. `BookEditForm.vue`).
- `src/components/BookDetail.vue` (and `src/components/book-detail/EditionDetails.vue`, which also renders author with `filterBy`): render each `book.authors` entry as its own clickable chip filtering by that individual name (matching the existing genre/award chip pattern); fall back to a single non-split chip from `book.author` when `authors` is empty.
- `src/components/LibraryCoverCard.vue`: keep its `author: string | null` prop as a plain display string — have the parent grid/list view compute it via `displayAuthor()` rather than threading structured data into this presentational component. Locate and update the parent call site(s).
- `src/composables/useLibraryGrouping.ts` — `'author'` case: `values: b => b.authors?.length ? b.authors.map(a => a.name) : (b.author ? [b.author] : [])`. Verify `groupByValues` handles a book appearing in multiple groups without double-counting any "total books" figure elsewhere (check `home.vue`/library page for such a total).
- `src/composables/useLibrarySearch.ts`: update the `author:` structured token match, free-text substring match, and facet-suggestion loop to check `b.authors` (one facet per individual author) with fallback to `b.author`, mirroring the existing per-genre facet loop in the same function.
- No changes needed in `useGroupDimensions.ts` / `libraryDefaults.ts` (dimension registration only, no data logic).

### 7. i18n
No new keys expected — author joining/fallback reuses the existing `book.unknown_author` string and plain `, ` separators.

## Verification

1. `npm run type-check` (root + worker) — must pass after type additions.
2. `wrangler d1 migrations apply --local` against a dev DB with existing multi-author `work_authors` rows — confirm the ordinal backfill runs cleanly and `json_group_array`/`json_object` work under D1's SQLite build.
3. Scan a single-author book — confirm unchanged display.
4. Scan a known multi-author book — confirm: detail view shows per-author chips in original order; grouping by author places the book under both authors; searching `author:<second author name>` (not just the first) finds it via structured match; facet suggestions list both authors separately.
5. Check `home.vue` stats — confirm the multi-author test book increments both authors' individual counts and `authorCount` grows by the right number of previously-unseen authors.
6. Re-scan an already-linked ISBN — confirm `work_authors.ordinal` is unchanged (verifies `INSERT OR IGNORE` doesn't corrupt on re-runs).
7. Test a book with `work_id IS NULL` (unlinked/pending enrichment) — confirm display/search/grouping/stats still work via the raw `author` fallback without errors.

## Critical files
- `worker/migrations/0029_work_authors_ordinal.sql` (new)
- `worker/src/editions.ts`
- `worker/src/library-query.ts`
- `worker/src/routes/stats.ts`
- `worker/src/types.ts`
- `src/types/book.ts`
- `src/utils/book-display.ts`
- `src/components/BookDetail.vue`, `src/components/book-detail/EditionDetails.vue`
- `src/components/LibraryCoverCard.vue`
- `src/composables/useLibraryGrouping.ts`, `src/composables/useLibrarySearch.ts`
