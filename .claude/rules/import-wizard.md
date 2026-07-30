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
  `CyclePill`s, rating, remove/undo. On an updated (preexisting) row the status pill shows the
  value the import just wrote and a "was X" caption names the one it replaced, read from
  `previous`; ownership needs no such caption, since the import never changes it. A
  `matchedViaWork` row additionally says the export named a different edition than the copy shown
  — with the count when several copies were written; the "was X" caption still names only the
  primary's prior status, a simplification, since `siblingUpdates` carries each one for Undo
- `AttentionRow` — one review-queue row
- `ResolveDrawer` — manual title/ISBN search side panel for a review-queue row.
  `useFocusTrap`'d, always-mounted with a nullable `item` prop so its focus-trap state
  survives across opens instead of leaking a listener per open/close cycle
- `ShelfMappingPanel` — the per-shelf reading-status `AppSegmented` control, behind the
  confirm step's "Adjust shelf mapping" disclosure. Goodreads import never maps
  `owning_status`, only `status`; imported scans land on `owning_status` `unknown` and the
  user sets ownership per book afterwards
- `ImportProgressChip` — global fixed-position indicator hosted in `App.vue`, hidden on
  `/import` itself; shows running/paused/complete state and routes to `/import` on click.
  On desktop `AppHeader` additionally shows an **Import** nav entry while `store.sessionActive`
  (sending, paused, or awaiting review — not the upload/confirm steps), with the same
  running/paused/complete dot. It is written into `AppHeader` directly rather than added to
  `useNavLinks`, because `MobileTabBar` slices its two side slots out of that list and a fifth
  entry would silently push one off the bar; mobile keeps the chip as its only indicator. Both
  indicators are additionally gated on `authStore.isAuthenticated`: the session lives in
  `localStorage` and rehydrates on boot, so it outlives a logout, and an ungated one would both
  link somewhere the `requiresAuth` guard bounces and tell the next person on that browser that
  an import was in progress
- `matched-grid.ts` — shared grid-column geometry for the Matched table's header + rows

The Matched tab is ordered **owning status, then reading status, then rating descending** — owned /
read / 10-of-10 first — via `src/utils/import-sort.ts` (`importSortRank`, unit-tested). Owning reuses
`OWNING_ORDER` (the library sort's own order); reading status gets its own `read → reading → unread →
dnf`, since `STATUS_ORDER` is the pickers' order and neither it nor its reverse is what's wanted here.
A rating of 0 or `null` both sort last. The rank is **captured once**, at card creation, into
`ImportedItem.sortRank` — not persisted, but re-derived from current state on every rehydrate: the
cards are editable in place, so a live comparator would make one jump out from under the click that
changed its status or rating, but a reload has no click in flight and re-ranking there is the order a
fresh render should have. `import.vue` sorts a copy for rendering — the store's array stays in arrival
order, which `absorbIntoExistingCard`, `indexOf`/`splice` removal and `resolvedRowIds` all read.

`src/utils/goodreads.ts` does the CSV row parsing, shelf mapping and import-payload building.
Unit-tested (`test/goodreads.spec.ts`).

## `POST /api/import/goodreads`

Batch-import scans from a parsed Goodreads CSV export; body
`{ rows: [{ isbn, status?, owning_status?, rating?, created_at?, title?, author?, publisher?, publish_date?, number_of_pages?, shelves? }], update?: boolean, shelves_field_def_id? }`
(1-10 rows); returns
`{ results: [{ isbn, outcome: "imported"|"updated"|"duplicate"|"invalid_isbn"|"failed", scan_id?, book?, resolved?, previous?, other_edition?, matched_via_work?, sibling_updates? }] }`.

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

`findWorkSiblingScans` reads **every other edition of the work the user already has a scan for**,
oldest first (`LIMIT 20`, a sanity bound on the status fan-out below), with each sibling's scan
id, status, `owning_status`, the work's `rating` (joined, so the update path needs no second read)
and the `books` columns `bookSummary` copies. Dedupe is per ISBN (both forms) and `scans` is unique
on `(user_id, book_id)` rather than on the work, so those siblings are real second copies rather
than duplicates — which is why a Goodreads row naming one of their sibling ISBNs is still about a
book the user has already logged. It runs **before** the INSERT so a row can't match the scan it is
about to create. It drives two things:

`other_edition: { isbn, publisher, publish_date, owning_status }` (on `imported` only, so only
when nothing was updated — i.e. `update` off) names the copy the new scan landed beside, chosen
`owned`/`lent_out`-first: the new scan sits at `owning_status = 'unknown'` next to a book the user
may have marked `owned`, and only the server can see that. The sibling it finds can be one **this
same import run** created — a row of the concurrent batch that inserted first, or of an earlier
batch — which is a fact about the DB rather than about what the user had before importing, and the
route has no session identity to filter on, so the client drops those: `isSessionCreatedEdition`
in `stores/import.ts` (the normalized ISBNs of the session's own non-preexisting items, so it
holds regardless of the order rows resolve in) suppresses the note. `MatchedRow` renders the
surviving ones as a warning-coloured note; the edition-swap path in `changeImportedEdition`
deliberately **discards** the field, because there the sibling it finds is the item's own prior
scan, which that path then deletes.

`matched_via_work: true` + `sibling_updates: [{ scan_id, previous_status }]` (on `updated` only)
mark the **work-level update** path — see below.

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

`update: true` also fires on a **work-level** match, not just an exact-ISBN one: a Goodreads ISBN is
whichever edition was popular there, not a claim about which copy the user holds, so a row whose
*work* is already in the library updates that copy instead of adding an `owning_status = 'unknown'`
twin beside it. Same rules as the ISBN path (status always, rating only when the row has one, in
`overwrite` mode; `owning_status` untouched) — enforced by construction rather than by hand, since
**all three update paths go through `applyImportUpdate`**: the ISBN-duplicate branch, this one, and
`/match`'s title hit. It takes the scans to write with `scans[0]` as the primary by contract, writes
one `UPDATE … WHERE id IN (…)` plus the rating statements in a single `db.batch`, and assembles the
whole `"updated"` core (`scan_id`/`book`/`resolved`/`previous`, plus `sibling_updates` when it was
given more than one scan). `claimScans` is the matching all-or-nothing claim helper. Three specifics:

- **Status goes to every copy of the work, on all three paths.** Reading status is per scan —
  `useScanStatus` deliberately never fans it out, since progress belongs to a copy — but a work the
  user has twice is still one book they read, and a CSV row is a statement about the book. Matching by
  exact ISBN rather than by work doesn't change that, so the ISBN path fans out too (one extra
  `findWorkSiblingScans` read on a duplicate row); otherwise the same export would update one copy for
  a row naming a copy's own ISBN and every copy for a row naming a third edition. Each sibling's own
  prior value rides back in `sibling_updates` (the rating needs no equivalent, being one per-work
  value), and the client restores each on Undo/cancel via `restorePreImport` → `patchScanStatuses`.
- **The primary is the scan the row identified** — the ISBN's own scan, or the title match's. Only the
  work path has no identified scan, and there it is an `owned`/`lent_out` copy first, else the oldest
  (`pickPrimarySibling`, keyed on `OWNED_OWNING_STATUSES`). The summary card is an editor for that one
  scan; on the work path its `book` is therefore the edition **in the library**, not the one the CSV
  named — that one has no scan. `MatchedRow` says so via `updated_other_edition`, appends
  `also_copies` whenever more than one copy was written, and `setImportedStatus` fans a later tweak
  across `siblingUpdates` too, or the import would write every copy and the next click on the same
  card write one.
- **All-or-nothing claims.** Two rows of one batch that are two editions of the same work would
  otherwise both write these statuses, each having read a `previous` from before the other's write. A
  row finding *any* of its scans claimed returns the plain `"duplicate"`.

The ISBN-duplicate branch returns first, so an exact ISBN match always wins over a work match. With
`update` **off** nothing is written to existing scans at all — that row falls through to the INSERT
and the `other_edition` note, which is the point of the toggle. `changeImportedEdition` sends
`update: false` and so never takes this path.

Two rows of one export that are two *different* editions of one book write overlapping sets of copies
— the client's pre-send dedupe only catches identical ISBNs, and `claimedScanIds` is per request while
batches are separate requests — so the second row would open a card over a scan the first already
owns. Two cards over one scan fight: one PATCHes a scan the other's Remove deleted, or the two restore
it to different values on cancel. `absorbIntoExistingCard` in `stores/import.ts` folds the later row
into the existing card and logs it `in_file`. Three details matter:

- It compares **whole write sets** (`cardWriteSet` × `scansWritten`), not primary against primary. The
  two rows can reach one work from different directions — an ISBN row and a work-matched row, or two
  work-matched rows whose primary differs — so the scan they share is often one card's *sibling*.
- It **adopts** the copies the card doesn't track yet, rather than dropping the incoming
  `sibling_updates`. Dropping them left a pre-existing scan on an imported status with no card
  pointing at it, so neither Undo nor cancel could restore it.
- A scan the card already knows **keeps its existing entry** — recorded first, so it holds the true
  pre-import status, whereas the later row's `previous` for it is only what the earlier row wrote.

It runs only for `"updated"` outcomes: a freshly inserted scan's id cannot collide with a card that
already exists, and skipping the scan keeps a large import off an O(n²) walk of `importedItems`.

The work lookup necessarily runs *after* `resolveEdition`, since `linkWork` is what populates
`book.work_id` — so a work-level update still pays the ~3 external fetches for an edition it then
never scans, leaving a scan-less `books` row behind (harmless; `books` is a shared catalogue).
Probing `works.match_key` from the CSV's own title/author first would skip that, but the
normalization would have to match `linkWork` exactly and Goodreads titles carry series annotations
— a false positive there updates the wrong book.

`shelves_field_def_id` (request-level, verified server-side to belong to the caller and be a
`tag` field) writes each row's `shelves` into `book_custom_fields` — only for newly created
scans, not updates (a work-level update included: the copy in the library may already carry tags
the user chose).

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
returns `{ results: [{ outcome: "duplicate"|"updated"|"no_match", scan_id?, book?, resolved?, previous?, sibling_updates?, confidence? }] }`
(`resolved`/`previous`/`sibling_updates` same shape and purpose as `/goodreads`).

Shares the `/goodreads` rate-limit bucket (`import:<userId>`) so the two passes of one import
session jointly stay under budget.

Loads the caller's whole scan list once per request (scan id, book id, effective title/author,
work's canonical title) and scores every row against it in-memory via
`worker/src/title-match.ts`'s `pickBestMatch` — skipped (every row returns `no_match`) above
20k scans, a bound realistically unreachable for a personal library. A confident match applies
the same update rules as `/goodreads` — literally, via `applyImportUpdate` — including the status
fan-out across every copy of the matched work, which costs no query here since the whole library is
already in memory. Below the confidence/ambiguity threshold, `no_match` sends the row to manual
review instead of guessing.

**The ambiguity guard is judged between works, not between scans.** Two same-titled editions of one
work score identically (each candidate is compared against its own title *and* the shared work
canonical title), so scan-level ambiguity sent every multi-copy row to manual review — the exact case
the ISBN path answers by updating the work. So `pickBestMatchPrepared` takes each candidate's `workId`
and picks the runner-up to beat from a *different* work; a tie among copies of one work is one answer
twice, not an unanswerable question. An unlinked scan (`work_id` NULL) is its own work and never
groups with another, mirroring `workSiblings` on the client. Genuinely different works with the same
title still come back `null` and still go to review.

Which copy the card then points at is the caller's call, via `identifiedCopy` on the result: true when
one copy beat its own siblings by the margin (a per-user title override, or a German edition matched
under its German title), and the row therefore identified a scan. On a tie the route picks with
`pickPrimarySibling` — owned/lent_out first, else the oldest — the same rule and the same reasoning as
the ISBN work path, which is why the `/match` library-index query orders by `created_at, id` and why
that helper is generic over the row shape. The status write covers every copy either way.

`title-match.ts` is pure: `titleSimilarity` (Dice-coefficient bigram comparison with a
prefix-containment shortcut) + `pickBestMatch` (confident-and-unambiguous match against a
candidate list, else no match). Unit-tested.
