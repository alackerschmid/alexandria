# Tasks

Open backlog derived from a full-codebase audit (2026-08-06, four parallel review agents over worker, frontend, enrichment/schema, and product surface; every claim below was verified by reading the code, confidence noted where it matters). Each task is written to be self-contained: an agent picking one up should be able to start from the task text alone, but should still read the referenced rule files before editing — most of these touch subsystems with documented invariants.

**Finished work lives in `tasks_completed.md`**, with an `Implemented` note per task recording what was actually built and where it deviated from the fix direction proposed here. Move a task there when it lands rather than marking it done in place.

Conventions used below:

- **Where** — files and line numbers as of the audit (branch `fix/wikidata-series-filter`); line numbers drift, the anchors are the symbol names.
- **Read first** — the rule file / doc that governs the area. Non-optional; several fixes are constrained by documented invariants.
- **Done when** — acceptance criteria, including which docs/inventories must be updated per the repo rule (API route changes → `worker/CLAUDE.md`; schema changes → `worker/migrations/CLAUDE.md`).

## Progress

| Batch | State |
| --- | --- |
| A1–A3 | **Done** — see `tasks_completed.md`. `fix/wikidata-series-filter` is unblocked |
| B1–B5 | **Done** — see `tasks_completed.md` (`56444cb`, `fix/audit-high-severity`) |
| C1–C9 | **Done** — see `tasks_completed.md` (`fix/audit-medium-severity`) |
| D, E, F | Open — below |

---

## D. Process, docs, and hardening

### D1. Gate the Pages frontend deploy on the verify workflow

- **Where:** `.github/workflows/deploy.yml` + the Cloudflare Pages Git integration (root `CLAUDE.md` §Architecture).
- **Problem:** Verify failure withholds the worker + migrations, but Pages ships the frontend anyway — new UI against old API. Even on success the two deploys race (frontend typically live minutes before the worker).
- **Fix direction:** deploy Pages from the workflow (`wrangler pages deploy` after the worker step) and disable the Git integration, or use Pages branch-control "skip builds unless checks pass". Consult `cloudflare-docs` MCP before writing config — flags move. Update root `CLAUDE.md` §Architecture to match whichever shape lands.
- **Done when:** a red verify run deploys nothing; ordering is worker-then-frontend (or documented as acceptable).

### D2. Fix `worker/CLAUDE.md` guest-migration claim

- **Where:** `worker/CLAUDE.md` (register/login bullets claim the server "migrates any guest scans to account"). No such code exists — `auth.ts` never touches `scans`; the real mechanism is the client replaying guest scans through `POST /api/scans` in seed mode (comments at `routes/scans.ts` ~154, `library-query.ts` ~384).
- **Fix direction:** correct the two bullets to describe the client-replay mechanism. Doc-only change; the inventory is a contract per repo rules.

### D3. Guard the sweeper's Google Books spend

- **Where:** `worker/src/sweeper.ts` → `backfillEdition`/`materializeEdition` (`worker/src/enrichment.ts` ~699–724); daily counters already exist (`api_usage`, queried in `worker/src/routes/admin.ts` ~180–278).
- **Problem:** The self-amplifying placeholder backlog (each series enrichment inserts ~10 placeholders, each of whose enrichment can spend a Google Books call) can drain the shared daily quota that interactive title search depends on. The admin board observes; nothing enforces.
- **Fix direction:** before `backfillEdition`'s Google half, check the UTC-day Google count against a threshold (constant, e.g. comfortably below the daily quota) and skip with a log line when over. Sweeper-only — never gate interactive paths.
- **Done when:** the guard exists, the threshold is a named constant with the reasoning in a comment, and the skip is visible in logs.

### D4. Record post-merge in-flight outcomes in `enrichment_runs`

- **Where:** `worker/src/enrichment.ts` ~1278 (`if (identity.kind === "in-flight") return;`).
- **Read first:** `.claude/rules/enrichment.md` §Observability (every attempting call writes a row; anything that stops doing so "silently blinds" the board).
- **Problem:** A run that did a full search, verification, and a **destructive merge**, then lost the post-merge re-claim, records nothing. Merges are the most consequential pipeline action and are invisible in telemetry on this path.
- **Fix direction:** write a run row (outcome recording the merge) before the early return. Rare path, low risk.

### D5. Re-enrich no-title works when they later gain a title

- **Where:** `worker/src/enrichment.ts` ~1273–1277 (no-title path persists `done` at `CURRENT_ENRICHMENT_SCHEMA_VERSION` with nulls).
- **Problem:** If the edition later gains a title (e.g. `/refresh` fills a NULL `books.title`), nothing re-enriches until the next schema bump. Low impact; cheapest fix is to have the metadata-refresh path flip the work back to `pending` when it fills a previously-NULL title.

### D6. Require a scan for override/custom-field writes

- **Where:** `worker/src/routes/books.ts` ~325–421 (`PATCH /api/books/override`, `PATCH /api/books/custom-fields`).
- **Problem:** Not an auth leak (rows are per-user), but any authenticated user can accumulate unbounded rows against the whole shared catalogue; `DELETE /api/scans/:id` only garbage-collects rows for scanned books, and a scanless write succeeds silently with `{}`. Requiring an existing scan (404 otherwise) closes the growth vector and makes C5 near-unreachable.
- **Done when:** scanless writes 404; `worker/CLAUDE.md` route docs updated. Check the frontend never legitimately writes pre-scan (the edit screen shouldn't, but verify the import wizard's paths).

### D7. Unit tests for untested pure logic

Per project policy only pure, Vue-free/D1-free logic gets unit tests — all of the below qualify and are currently uncovered:

- `isIsbnFormat` (`worker/src/isbn.ts` ~42) — the one function there with no describe block; guards the scan-queue entry.
- `summarizeRuns` (`worker/src/routes/admin.ts` ~38–73).
- `claimScans`, `pickPrimarySibling`, `applyImportRating` (`worker/src/routes/import.ts` ~168–354) — the pieces the import-wizard concurrency guarantees rest on; need exporting.
- `stats.ts` helpers: `extractYear`, `computeDecadeGenres`, `computeTranslationRatio`, `computeYearStats` (year bounds, `count < 10` cutoff, code-vs-label fallback).
- `src/utils/cover.ts` `tintFor`/`initials` — note `initials` strips all non-ASCII ("Ärger" → "R", non-Latin title → "?"); write the test, then decide whether that behavior is a bug to fix here too.
- `src/utils/book-display.ts` `formatDateTime`/`formatPublishDate` (three-branch date handling, regression-prone).

---

## E. Improvements to existing features

### E1. Surface ratings: stats, sort, review search

Three small strokes; can be one PR or three.

1. **Rating stats:** `worker/src/routes/stats.ts` (~40–77 response shape) has no `work_ratings` join. Add `avgRating` + a 0–10 distribution to `StatsResponse` (`src/types/stats.ts`), computed in SQL. Feeds F3.
2. **Server rating sort:** add `rating_desc` (and `_asc`) to `SORT_CLAUSES` (`worker/src/library-query.ts` ~90–99 — `work_ratings` is already in the JOIN), plus the option in `LibraryDisplaySettings` and the sort param docs in `worker/CLAUDE.md`. Decide NULL placement (NULLS LAST) deliberately.
3. **Review search:** include `b.review` in the free-text match in `src/composables/useLibrarySearch.ts` ~315–322 — the text is already on every client-side row. Read `.claude/rules/library-pipeline.md` first (the search→collapse→group order is load-bearing).

### E2. Admin write actions

- **Where:** `worker/src/routes/admin.ts` (currently GET-only), `src/pages/admin.vue` + `src/components/admin/`.
- **Scope:**
  1. **Requeue enrichment:** `POST /api/admin/enrichment/requeue` — set `exhausted`/`failed` works to `pending`, `next_retry_at = NULL`; the 2-minute sweeper does the rest. The board already displays exactly the counts this targets. Body should scope: `{ statuses: ["exhausted"] }` or a work-id list.
  2. **Featured toggle:** a books search + star toggle on the admin page writing `books.is_featured` — replaces the documented `wrangler d1 execute` ritual (`worker/CLAUDE.md` "no UI/endpoint"). `PATCH /api/admin/books/:id/featured` or similar.
  3. **Deliberately out of scope:** `is_admin` promotion from the UI — keeping that manual is a safety property, not an omission.
- **Done when:** both actions exist behind `adminMiddleware`, `worker/CLAUDE.md` route inventory updated, and the "set by hand" notes in both CLAUDE.md files corrected.

### E3. Finish DNF

- `status:dnf` is filterable but never suggested: add it to the facet-suggestion loop in `src/composables/useLibrarySearch.ts` ~348–352 (compare `STATUS_VALUES` — don't hardcode a second list).
- README §Features still says "Unread, Reading, or Read" — update while there. (See also E6.)

### E4. Make integer/date custom fields pay rent

- **Where:** `worker/src/routes/stats.ts` ~452 (`ufd.field_type NOT IN ('date','integer')`), `src/composables/useLibrarySearch.ts` ~447 (facet suggestions skip them).
- **Scope:** a separate `customNumericFields` stats block — sum/avg/min/max for integers, year-bucketed counts for dates — rendered on the stats surface (pairs naturally with F3). Values are stored as strings; validate/cast in SQL defensively (`CAST` + `GLOB` guard) since historical rows may predate the current validation.

### E5. Route hand-rolled `fetch` through `apiFetch`

- **Where:** `src/stores/fieldDefs.ts` ~34/46/65/108; `src/pages/scanner.vue` ~1428–1434, ~1497–1503.
- **Problem:** violates the documented invariant (src/CLAUDE.md) and loses 401→logout — an expired token on the scanner's title search surfaces as a generic error loop instead of logging out. Note the deliberate exceptions: `guest.ts` `syncToAccount` and `login.vue` are pre-auth/explicit-token and stay raw.

### E6. README refresh

The feature list has drifted both directions: it under-sells (no DNF, no ratings/reviews, no owning-status model, no editions carousel, no admin board) and the status list is stale. One pass over `README.md` §Features + §To be implemented, ideally after F1/F2 land so the to-be-implemented list shrinks honestly.

### E7. Minor UX polish (batchable)

- `sessionTime` freeze: `src/pages/scanner.vue` ~1261–1265 renders relative times from non-reactive `Date.now()`; use a ticking ref (30 s interval, cleared on unmount).
- `scanAgain` resets `selectedStatus` to hardcoded `"read"` (~1696) instead of `libraryDefaultsStore.defaultScanStatus`.
- Guest banner hardcodes `{ max: 3 }` (`src/pages/index.vue` ~12) — export `MAX_GUEST_SCANS` from `src/stores/guest.ts`.
- `RatingStars` a11y: `src/components/RatingStars.vue` ~63–74 — half-star buttons announce a bare number; add `role="radiogroup"` + "7 of 10"-style labels.
- Duplicate-scan pre-check runs up to 3 D1 queries before the rate limit (`worker/src/routes/scans.ts` ~107–116, deliberate for 409-before-quota UX): cheap mitigation is charging the limiter when the dup check misses.

---

## F. New features

### F1. Library export (S/M) — highest priority feature

- **Today:** the Settings "Export data" button is a permanently-disabled decoy (`src/pages/settings.vue` ~504–542, `@click.prevent` + `settings.export.coming_soon` tooltip; strings `src/locales/en.json` ~421–427). No export route exists.
- **Scope:** `GET /api/export?format=csv|json`, authed.
  - **CSV:** Goodreads-column-compatible — exactly the header set `src/utils/goodreads.ts` ~3–12 validates (`Title, Author, ISBN13, My Rating, Exclusive Shelf, Date Added, Bookshelves, …`), so export⇄import round-trips. Map rating 0–10 → 1–5 (inverse of `goodreads.ts` ~73), status → shelf (inverse of `DEFAULT_SHELF_MAPPING` ~101), tag-type custom field → `Bookshelves`.
  - **JSON:** the merged rows verbatim plus custom fields — lossless backup.
  - `buildScanSelect` (`worker/src/library-query.ts`) already produces the full merged row; page the query like `useLibraryData` (500/page) and stream the response (D1 result-size limits — check current limits via `cloudflare-docs` MCP before implementing).
  - **Frontend:** replace the decoy's `@click.prevent` with a blob download; both locales.
- **Done when:** a library exports to CSV, that CSV re-imports through the existing wizard cleanly, JSON contains every field including overrides/ratings/reviews/custom fields, and `worker/CLAUDE.md` lists the route. No migration needed.

### F2. Reading dates + books-read-per-year (M)

- **Today:** Goodreads `Date Read` is parsed nowhere (`src/utils/goodreads.ts` ~75 reads only `Date Added`; the fixture header in `test/goodreads.spec.ts` ~27 shows the column exists) and **is silently lost on import** — no column stores it (`scans` has only `created_at`; `work_ratings` only `updated_at`). This blocks the single most-wanted tracker stat.
- **Scope:**
  1. Migration: `scans.finished_at` (nullable; optionally `started_at`). Per-scan matches how status already lives per copy. Update `worker/migrations/CLAUDE.md`.
  2. `PATCH /api/scans/:id` accepts it; server auto-sets to today when status flips to `read` and the field is empty (never overwrite a set value). Client edit control in `src/components/book-detail/RecordPane.vue` (owns status controls). Read `.claude/rules/book-detail.md` first.
  3. Goodreads import parses `Date Read` → `finished_at` (touch `parseGoodreadsRow`, `ImportPayloadRow`, `worker/src/import-validation.ts` (reuse the future-clamp pattern from `normalizeCreatedAt`), and the INSERT binding in `routes/import.ts`). Read `.claude/rules/import-wizard.md` first.
  4. `stats.ts`: `readByYear: { year, count }[]`.
- **Note:** ship before encouraging any re-import — every import until then keeps destroying this history.
- **Done when:** import of a CSV with `Date Read` populates `finished_at`, marking a book read stamps it, the stat appears in `StatsResponse`, and both CLAUDE.md inventories are updated.

### F3. Dedicated `/stats` page (M)

- **Today:** `home.vue` is a fixed-height teaser; `worker/src/routes/stats.ts` already computes ~10 breakdown dimensions (publishers, forms, subjects, countries, decades, decade×genre) the dashboard shows 5–6 of.
- **Scope:** a `/stats` route reusing `getBreakdown`/`useGroupDimensions`; full-length bars, decade histogram, pages histogram, rating distribution (E1.1), reading timeline (F2). Mostly frontend; put any new computation helpers in `src/utils/` as pure functions so they're unit-testable (policy). Nav entry in header + mobile tab bar; both locales.

### F4. "Want this" from the series page + wishlist view (S/M)

- **Today:** `owning_status = 'want'` is fully modeled and filterable (`owning:want`), but the only way in is scanning a book you hold and flipping the pill. The natural feeder — the series page's Missing volumes — opens the detail read-only with all controls hidden (`src/pages/series.vue` ~325–339 sets `detailReadonly = true`; `BookDetail.vue` gates on `!readonly`).
- **Scope:** an "Add to wanted" action on the read-only detail opened from a missing series entry — server needs nothing new (`POST /api/scans` already accepts `{ isbn, owning_status: "want", status: "unread" }`). Plus a wishlist presentation: cheapest is a saved `owning:want` filter chip; nicer is a shelf-group tab (`useShelfGroups` already handles unowned-reveal display). Read `.claude/rules/book-detail.md` (readonly semantics) and `.claude/rules/library-pipeline.md` first.
- **Watch out:** `want` must stay excluded from ownership stats and series completeness (documented gate: `IN ('owned','lent_out')`).

### F5. PWA service worker (S)

- **Today:** a real offline scan queue exists (`src/pages/scanner.vue` ~1147–1621, `src/utils/offline-queue.ts`; `POST /api/scans` designed around it) and manifest icons ship (`public/icons/web-app-manifest-*`), but there is no service worker at all — the queue only helps if the page was already loaded when signal dropped.
- **Scope:** `vite-plugin-pwa`, cache-first app shell, network-first (or network-only) for `/api/*`. No worker/API changes. Test the update flow (stale-shell traps are the classic failure) and verify the scanner page works from cache offline.

### F6. Edition management, in slices (README item)

Existing base: `EditionsPane`/`EditionsDialog`, `useWorkEditions`, `work_edition_isbns` discovery, edition switch. Smallest first:

1. **"Add as second copy" (S):** a button in the editions carousel calling `POST /api/scans` with that edition's ISBN — the schema (unique per `(user_id, book_id)`) and all sibling handling (`workSiblings`, rating fan-out) already support it; it is purely a missing button.
2. **Cover adoption (S):** pick another edition's cover as your override — `PATCH /api/books/override` `cover_url` already validates http(s) URLs.
3. **Manual work merge/split (L, own project):** expose `mergeWorks` behind a user-facing "these are the same book" flow. Today a wrong `match_key` grouping is user-unfixable (no route exposes merge; `author` is deliberately non-overridable). Destructive-adjacent — needs its own design pass (undo story, confirmation, admin-only vs user-facing). Do not start this slice without discussing scope.

### F7. Password reset, admin-issued (S)

- **Today:** no reset path of any kind in `worker/src/routes/auth.ts`; a forgotten password means manual D1 surgery.
- **Scope:** admin generates a one-time short-lived reset token from the `/admin` user roster (`src/components/admin/UserRoster.vue` lists everyone), hands the link over out-of-band; public `POST /api/auth/reset` consumes it (token hashed at rest, single-use, ~1 h expiry, rate-limited by IP). Avoids the email-deliverability story entirely; upgradeable to self-service later without redoing the token model. Needs a small table or a column — update `worker/migrations/CLAUDE.md`.

### F8. "What should I read next?" spotlight (S)

A random unread pick on the home dashboard, optionally re-rollable and biasable by a facet. Precedent: `randomFirstLine` in `stats.ts` (`ORDER BY RANDOM() LIMIT 1`). Small, fun, on-brand for "statistics you can actually enjoy browsing".

---

## Suggested sequencing

1. **A, B and C are done** — see `tasks_completed.md`. Manual-QA passes are still owed for B1–B4 and C6/C7 plus the frontend half of C9; each task names its own.
2. **F1 + F2** — export and reading dates; F2 is time-sensitive (every Goodreads import until then loses history). This is the front of the queue.
3. **D-block** alongside whatever touches the same area. Two of them got cheaper as a side effect of the C-block: D6 (require a scan for override/custom-field writes) now sits next to the merge rule C5 wrote into the edition-switch batch, and D2's doc correction is one file away from the route entries C3/C5/C7 already rewrote. E5's `fieldDefs` half is likewise one file from B1's watcher.
4. **E-block and remaining F-items** by appetite.

Notes for implementing agents: branch before multi-commit work; conventional commits; the Stop hook runs type-check/lint/tests for whatever you touch — don't pre-run them; update the two inventory files (`worker/CLAUDE.md`, `worker/migrations/CLAUDE.md`) whenever a route or schema change is part of the task; `to-do.md` at the repo root is the owner's personal notes, not this backlog — leave it alone.
