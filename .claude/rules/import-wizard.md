---
paths:
  - "src/components/import/**"
  - "src/pages/import.vue"
  - "src/stores/import.ts"
  - "src/utils/goodreads.ts"
  - "worker/src/routes/import.ts"
  - "worker/src/import-validation.ts"
  - "worker/src/title-match.ts"
  - "worker/src/concurrency.ts"
---

# Goodreads import

Both halves of one feature: the wizard in `src/` and the two batch routes in `worker/`.

## Frontend

`import.vue`'s state comes entirely from `src/stores/import.ts` — the page and
`ImportProgressChip.vue` are both thin views over it.

`stores/import.ts` is a **deliberate exception to the cross-page-only store rule**: it holds
the entire import session (parsed rows, mapping, review queue, matched items) so the send
loop keeps running when the user navigates away from `/import`. It persists to `localStorage`
after every batch/edit (stripped of re-fetchable candidate-search state) and rehydrates on
boot into a "paused" state if a run was interrupted mid-batch — resuming re-derives the
unsent rows from what's already been resolved rather than tracking a batch cursor.

Pieces in `src/components/import/`:

- `ImportHeaderBar` — review-screen file name/counts + cancel/finalize
- `MatchedRow` — one editable card in the Matched tab: cover, edition picker, status/owning
  `CyclePill`s, rating, remove/undo
- `AttentionRow` — one review-queue row
- `ResolveDrawer` — manual title/ISBN search side panel for a review-queue row.
  `useFocusTrap`'d, always-mounted with a nullable `item` prop so its focus-trap state
  survives across opens instead of leaking a listener per open/close cycle
- `ShelfMappingPanel` — the per-shelf reading-status `AppSegmented` control, behind the
  confirm step's "Adjust shelf mapping" disclosure. Goodreads import never maps
  `owning_status`, only `status`; imported scans land on `owning_status` `unknown` and the
  user sets ownership per book afterwards
- `ImportProgressChip` — global fixed-position indicator hosted in `App.vue`, hidden on
  `/import` itself; shows running/paused/complete state and routes to `/import` on click
- `matched-grid.ts` — shared grid-column geometry for the Matched table's header + rows

`src/utils/goodreads.ts` does the CSV row parsing, shelf mapping and import-payload building.
Unit-tested (`test/goodreads.spec.ts`).

## `POST /api/import/goodreads`

Batch-import scans from a parsed Goodreads CSV export; body
`{ rows: [{ isbn, status?, owning_status?, rating?, created_at?, title?, author?, publisher?, publish_date?, number_of_pages?, shelves? }], update?: boolean, shelves_field_def_id? }`
(1-10 rows); returns
`{ results: [{ isbn, outcome: "imported"|"updated"|"duplicate"|"invalid_isbn"|"failed", scan_id?, book?, resolved?, previous? }] }`.

`resolved: { status, rating, owning_status }` (on `imported`/`updated`) is the scan state **as
actually written** — the client renders the summary card straight from it instead of
re-deriving the shelf-mapping/rating rules, which had drifted from the server before.

**Goodreads import never sets `owning_status` from the CSV — only reading `status`.** A shelf
says nothing about whether the user owns the copy, so a plain CSV-import row is written as
`owning_status = 'unknown'` (the no-assertion state) rather than inheriting the `scans` table
default `owned` — a 400-book `to-read` shelf must not land as 400 owned books.
`import-validation.ts` resolves that default (`IMPORT_DEFAULT_OWNING_STATUS`) and the route
binds the column unconditionally, so `resolved.owning_status` is the value actually written
and not a re-derivation of the schema default. A row's `owning_status` is only honored when
the caller explicitly supplies a valid one; the one caller that does is the edition-swap path
in `stores/import.ts` (`changeImportedEdition`), which re-creates a scan under a different
ISBN and passes the item's current `owning_status` through so the swap doesn't reset it.

Rate-limited to ~600 rows/min per user (`import:<userId>`, same `rate_limits` table, charged
via `checkRateLimit`'s `cost` param as `rows.length` rather than 1 per request).

`worker/src/import-validation.ts` does checksum validation (stricter than the scan queue's
format-only check) and the status/rating/date/metadata normalization; a checksum-invalid ISBN
comes back as `invalid_isbn` rather than a 400, so the frontend wizard can route it to a
review step instead of failing the whole batch.

No `enrichWork`/`waitUntil` call here — new works are left `pending` for the cron sweeper to
drain, deliberately avoiding a Wikidata traffic spike across an entire imported library at
once.

`title`/`author`/`publisher`/`publish_date`/`number_of_pages` seed a fallback `books` row (via
`resolveEdition`'s `FallbackMetadata`) when neither Google Books nor OpenLibrary has the ISBN,
instead of inserting an all-NULL row.

`update: true` makes a duplicate-ISBN hit apply the row's `status` (always) and `rating` (only
when the row has one — Goodreads leaves unrated books at 0, which means "no opinion", not
"clear my rating") to the *existing* scan, the rating going to `work_ratings` in `overwrite`
mode — `owning_status` is never touched on an update — returning `outcome: "updated"` with
`resolved` (post-update state) and `previous: { status, rating, owning_status }` (pre-update
state, for Undo) instead of the inert `"duplicate"`.

`shelves_field_def_id` (request-level, verified server-side to belong to the caller and be a
`tag` field) writes each row's `shelves` into `book_custom_fields` — only for newly created
scans, not updates.

### Concurrency

Rows within a batch are resolved **concurrently** (`mapWithConcurrency` in
`worker/src/concurrency.ts`, `ROW_CONCURRENCY = 4`, order-preserving). An uncached ISBN costs
3 external fetches (1 Google Books + 2 OpenLibrary, ~1.1s); serializing them made a 10-row
batch take ~11s, now ~4.5s. The cap stays well under the free-plan limit of 50 external
subrequests per invocation (10 rows × 3 = 30) and keeps the burst against OpenLibrary polite —
raising it past ~6 gains nothing, since Workers allow only 6 simultaneous connections awaiting
response headers.

Concurrent rows can race in `linkWork` when they share a work or author; every write there is
`INSERT OR IGNORE` (`works.match_key` and `authors.normalized_name` are UNIQUE) and the `scans`
insert is guarded by a UNIQUE constraint caught as `duplicate`, so the races are benign.

Two writes that are **not** benign get explicit request-scoped claims: `claimedScanIds` (two
rows resolving to the same scan) and `ratedWorkIds` (two rows resolving to two different
editions of the *same work* — distinct scans, so the first claim lets both through, but they'd
each write the one shared rating and leave Undo restoring the wrong value). Both are claimed
synchronously before any `await`; a losing row reports the winner's value rather than its own.

The client sends batches sequentially with `BATCH_SIZE = 10` (`src/stores/import.ts`) — keep
it ≤ `MAX_BATCH_SIZE`.

## `POST /api/import/match`

The title/author matching pass for rows with no usable ISBN (a Goodreads export commonly has
these for hand-added books); body `{ rows: [{ title, author?, status?, rating? }], update?: boolean }`
(1-50 rows — no external fetches, so a much larger batch than `/goodreads` costs nothing);
returns `{ results: [{ outcome: "duplicate"|"updated"|"no_match", scan_id?, book?, resolved?, previous?, confidence? }] }`
(`resolved`/`previous` same shape and purpose as `/goodreads`).

Shares the `/goodreads` rate-limit bucket (`import:<userId>`) so the two passes of one import
session jointly stay under budget.

Loads the caller's whole scan list once per request (scan id, book id, effective title/author,
work's canonical title) and scores every row against it in-memory via
`worker/src/title-match.ts`'s `pickBestMatch` — skipped (every row returns `no_match`) above
20k scans, a bound realistically unreachable for a personal library. A confident match applies
the same update rules as `/goodreads`; below the confidence/ambiguity threshold, `no_match`
sends the row to manual review instead of guessing.

`title-match.ts` is pure: `titleSimilarity` (Dice-coefficient bigram comparison with a
prefix-containment shortcut) + `pickBestMatch` (confident-and-unambiguous match against a
candidate list, else no match). Unit-tested.
