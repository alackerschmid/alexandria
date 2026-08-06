# Tasks

Backlog derived from a full-codebase audit (2026-08-06, four parallel review agents over worker, frontend, enrichment/schema, and product surface; every claim below was verified by reading the code, confidence noted where it matters). Each task is written to be self-contained: an agent picking one up should be able to start from the task text alone, but should still read the referenced rule files before editing — most of these touch subsystems with documented invariants.

Conventions used below:

- **Where** — files and line numbers as of the audit (branch `fix/wikidata-series-filter`); line numbers drift, the anchors are the symbol names. Line numbers in tasks already implemented are pre-fix.
- **Read first** — the rule file / doc that governs the area. Non-optional; several fixes are constrained by documented invariants.
- **Done when** — acceptance criteria, including which docs/inventories must be updated per the repo rule (API route changes → `worker/CLAUDE.md`; schema changes → `worker/migrations/CLAUDE.md`).
- **DONE** in a heading means implemented and committed; the task text is kept for review context, with an **Implemented** note recording what was actually built and anything that deviated from the fix direction proposed here.

## Progress

| Batch | State |
| --- | --- |
| A1, A3 | **Done** — commit `e302bc1` on `fix/wikidata-series-filter` |
| A2 | **Done** — file deleted; it was never tracked, so there is no commit (see A2) |
| B1–B5 | **Done** — commit `56444cb` on `fix/audit-high-severity` (branched off `main`) |
| C, D, E, F | Open |

`fix/audit-high-severity` and `fix/wikidata-series-filter` both touch `sweeper.ts`, in disjoint hunks — they merge cleanly in either order, and neither is blocked. B1–B4 are store/component code, which by project policy carries no unit tests, so they still want a browser pass (see each task's "Done when").

---

## A. Branch blocker (fix before merging `fix/wikidata-series-filter`)

### A1. `exactOnly` retry can re-assign series QIDs to bare-titled volumes — DONE

- **Where:** `worker/src/enrichment.ts` — the retry at ~942–947, the dropped type filter at ~381 (`exactOnly ? "" : FILTER NOT EXISTS ... SERIES_OF_CREATIVE_WORKS`), `pickExactQid` at ~280–292. Counter-evidence in the branch's own artifacts: `worker/scripts/repair-merged-works.mjs` (the PLAN) and `worker/test/enrichment.spec.ts`.
- **Read first:** `.claude/rules/enrichment.md` (§"Which QID counts as this book's" — the paragraph this task partially invalidates).
- **Problem:** The rule file argues the retry is safe because (a) "a volume never matches its series, because the ordinal it carries is the difference" and (b) `workMatchKey` has already made same-titled works one work. Both defenses fail for volumes catalogued under the **bare series title with no ordinal**, which this production library contains: the repair plan's own groups list work 4412 (`"Das Spiel der Götter"`, keyed `isbn:9783442269099|…`), six "Star wars - Wächter der Macht" editions (authorless, keyed `isbn:<isbn>|`), three "James Bond 007". The branch's test fixture confirms Q458982 — the Malazan *series* item — carries the exact German label "Das Spiel der Götter", and `normalizeStr` makes that an exact match. Sequence: sweeper enriches a repaired isbn-keyed work → strict pass finds nothing (type filter rejects the series; no per-volume item verifies — that's why it merged originally) → stripped pass identical → `exactOnly` retry drops the type filter → series label matches exactly → series QID assigned to the volume → next bare-titled edition resolves to the same QID → `mergeWorks` (destructive, trusts the QID completely) re-collapses the works the repair script just split. Ordinal-carrying titles ("… (12)") are safe because the retry deliberately uses the unstripped title. Confidence: mechanism confirmed; Malazan label equality confirmed by the branch's own fixture; Star Wars/James Bond exposure plausible (depends on live labels/aliases — note `fetchWorkLabels` includes `skos:altLabel`, which widens it).
- **Fix direction (pick one, discuss trade-offs in the PR):**
  1. Skip the `exactOnly` retry entirely for works whose `match_key` starts with `isbn:` — those are exactly the rows that stand alone because local identity was ambiguous, i.e. the population at risk. Cheapest, no extra SPARQL.
  2. Keep the retry but re-check the picked candidate's type set and reject items whose *only* types reach `Q7725310` (series of creative works) — the four known-good cases (Cryptonomicon, Reamde, Watchmen, Daemon) are all co-typed with a non-series work type, a true series item typically isn't. Costs one extra query on an already-rare path; verify the co-typing claim against live Wikidata for the four before relying on it.
- **Also update:** the "This cannot reintroduce the merge" paragraph in `.claude/rules/enrichment.md` — it is wrong as written and the repo's debugging rule says contradicted rule files get corrected, not worked around.
- **Done when:** a unit test encodes the bare-title scenario (a work keyed `isbn:…` whose title exactly equals a series label must NOT get that series QID via the retry), the four known-good singles still resolve, and the rule file reflects the new guard.
- **Implemented** (`e302bc1`): both guards, not one. Fix direction 1 shipped as `isExactRetryEligible(matchKey)` — a new pure, exported predicate in `enrichment.ts`, called at the retry site so an `isbn:`-keyed or key-less work never reaches the retry at all. Fix direction 2 was **rejected**: the file's own measurements against live Wikidata (the comment block above `SERIES_OF_CREATIVE_WORKS`) show type sets cannot separate the co-typed singles from genuine series — Daemon's set is identical to that of real series — so re-checking the picked candidate's types would readmit the population the strict filter exists to reject. In its place, a cheap local signal: a retry hit whose QID already exists in the `series` table (a sibling volume's enrichment upserted it) is rejected as not-found. That covers the residual case guard 1 doesn't — a title|author-keyed volume catalogued under the bare series name — and its known cost is written down (it can reject a legitimate co-typed single whose parts are catalogued separately; nulls beat a series identity). Tests: the bare-title exact match (proving `pickExactQid` alone is insufficient) and three `isExactRetryEligible` cases. The rule file's safety argument was rewritten to match, in both the code comment and `.claude/rules/enrichment.md`.

### A2. Delete or regenerate `worker/repair.sql` — DONE

- **Where:** `worker/repair.sql` (full old PLAN output, applied to prod 2026-07-30 per its header).
- **Problem:** It is a checked-in, already-applied, **non-idempotent destructive** script. The branch's own new warning in `repair-merged-works.mjs` documents exactly why re-applying an applied entry is harmful (repoints books off correctly-enriched rows, strands `work_ratings`, half-applies where the sweeper already merged a survivor away — work 295 is already gone). The generator script is the source of truth; the stale SQL sits one `d1 execute --file` away from damage and is findable by someone who never reads the generator's warning.
- **Fix direction:** delete the file (preferred — regenerate on demand), or regenerate it to contain only the unapplied entries (currently `--work 4412`).
- **Done when:** no stale applied SQL is committed; if a file remains, its header states which entries are unapplied and when it was generated.
- **Implemented:** deleted. **Correction to the audit finding:** the file was never tracked by git — no history on any branch, not in the index, not gitignored, just an untracked working-tree artifact from the 2026-07-30 repair run. So "checked-in" in the problem statement above was wrong, and the deletion produced no commit. The hazard was real but local to one machine rather than distributed with the repo, which downgrades this from "blocker" to "housekeeping" in hindsight. Worth knowing for the next generated-SQL run: since the generator writes into `worker/` and nothing ignores `*.sql` there, the artifact is invisible to `git status` reviewers only by luck of nobody staging it — a `worker/*.repair.sql` entry in `.gitignore` would make that deliberate.

### A3. Raise/refresh the enrichment claim TTL; update the sweeper budget comment — DONE

- **Where:** `worker/src/enrichment.ts` `CLAIM_TTL_MINUTES` (~860–877, comment says it "must comfortably exceed a worst-case run"); `worker/src/sweeper.ts` ~6–16 (the "7 × 6 = 42" subrequest budget comment).
- **Read first:** `.claude/rules/enrichment.md` (§State machine, §Cron sweeper).
- **Problem (two related, found independently by two reviewers):**
  1. The branch's third search pass (`exactOnly`) pushed the worst-case not-found path to up to 6 SPARQL attempts × 25 s timeout + up to 10 s 429-sleep each ≈ 210 s, before `fetchWorkDetails`/`fetchSeriesMembers`/`fetchWorkEditionIsbn` (~105 s more worst-case) plus Google Books (4 retries with backoff) and OpenLibrary. That exceeds the 5-minute stale-claim TTL, so a slow-Wikidata episode lets the next cron tick steal a live claim and run the same SPARQL concurrently — duplicate external load and racing detail writes, the exact races the claim exists to prevent.
  2. The sweeper's batch-size reasoning predates the third pass: a tick of 7 not-found works (a German-heavy bulk import is exactly this) can spend up to 42 SPARQL calls plus the link batch's ~15 external fetches, past the 50-subrequest free-plan ceiling; excess fetches fail, works land on `failed`, and re-queue to spend the budget again.
- **Fix direction:** raise `CLAIM_TTL_MINUTES` to 10–15 **or** refresh the claim (`enrichment_started_at = now`) between SPARQL phases; recount and update the sweeper budget comment, and consider dropping `BATCH_SIZE` or short-circuiting remaining works in a tick once a subrequest-heavy path has run N times. Migration 0030's comment says "2 minutes" — migrations are immutable, so note the discrepancy in `worker/migrations/CLAUDE.md` instead.
- **Done when:** the TTL provably exceeds the recomputed worst case (show the arithmetic in the comment), the budget comment matches current call counts, and the 0030 drift is noted.
- **Implemented** (`e302bc1`): `CLAIM_TTL_MINUTES` 5 → 15 (the raise, not the mid-run refresh — a refresh means threading the claim through every SPARQL phase for a case a wider TTL covers outright, and the only cost of a wide TTL is how long a crashed run's work stays unclaimable). The recomputed worst case (~380–400 s: three search passes × 2 SPARQL each, then details/series/edition-ISBN, then Google Books and OpenLibrary) is written into the comment so the next person changing the retry chain can see what the number is protecting. Sweeper budget comment updated to ~13 calls on a pathological work and 6 SPARQL on a fully not-found one, and the German-heavy-import trigger named. `BATCH_SIZE` was left at 7 — throughput after a bulk import is the constraint it was tuned for, and the ceiling is documented as a budget rather than a guarantee. Migration 0030's stale "2 minutes" is now recorded on the `works` entry in `worker/migrations/CLAUDE.md`, where the `enrichment_started_at` column was previously undocumented entirely.

---

## B. Bugs — high severity (user-visible today)

All five implemented in commit `56444cb` on `fix/audit-high-severity`. Type-check, lint, and both test suites pass (frontend 214, worker 225); the manual-QA criteria in each "Done when" are the part still outstanding, since none of this code is unit-testable under the project's no-DOM policy.

### B1. `fieldDefs` store leaks across accounts (never reset on logout) — DONE

- **Where:** `src/stores/fieldDefs.ts` ~30–42 (`load()` early-returns once `loaded`), ~91–95 (`reset()` — zero call sites); `src/stores/auth.ts` ~70–81 (logout path).
- **Problem:** Log out, log in as another account in the same tab: the new user sees the previous user's custom-field definitions and cached tag values in the edit form, grouping dimensions, and Details pane until a hard reload. Cross-account data exposure on a shared browser; writes can also target field-def ids the new user doesn't own (server 4xxs, broken UI paths).
- **Fix direction:** watch the auth token and reset the store on change — `src/stores/preferences.ts` already implements exactly this pattern; mirror it.
- **Done when:** logging out and in as a different user (seeded via `cd worker && npm run seed:dev`) shows only the new user's fields with no reload. Manual QA — stores aren't unit-tested by policy.
- **Implemented:** a `watch` on `authStore.token` calling the store's existing (previously call-site-less) `reset()`, mirroring the preferences store's watcher. Deliberately not `immediate` — the store is created lazily on first use, so the initial token needs no reset, and firing on creation would clear a `load()` that a page had already kicked off. Still needs the QA pass above.

### B2. Any optimistic write resets library pagination to page 1 — DONE

- **Where:** `src/pages/index.vue` ~962–964 (page-reset watcher on `filteredBooks`); cause chain through `src/composables/useEditionGrouping.ts` ~42–45 (spreads every book) and `src/utils/book-display.ts` ~33–40 (`pickRepresentativeEdition` reads `status`).
- **Read first:** `.claude/rules/library-pipeline.md`.
- **Problem:** The watcher fires on any new array identity. With `groupEditions` on (default), the computed tracks essentially every property of every book, so cycling a status pill, setting a rating, or an enrichment-poll `refreshed` merge invalidates the chain → user on page 3 is thrown to page 1.
- **Fix direction:** reset the page only when the *inputs* change — watch `parsedSearch`/`groupBy`/`sortDirection`/`perPage` (the filter/group/sort state), not the derived array.
- **Done when:** on a seeded library with 3+ pages, changing a book's status on page 3 leaves the user on page 3; changing the search text still resets to page 1.
- **Implemented:** the watcher now tracks `[search, onlyOwned, groupEditions, sortDirection, groupBy, perPage]` — the raw `search` ref rather than `parsedSearch` as proposed here, since `parsedSearch` is itself a computed over the book list and would have reintroduced the same coupling. `onlyOwned`/`groupEditions` were added because both change the visible set and neither was in the original watcher. Plus a second watcher on `totalPages` that **clamps** `currentPage` when the set shrinks under it (a delete, or a write dropping a book out of the active filter) — without it, dropping the last book on the last page would have stranded the reader on an empty page, which the old blanket reset had incidentally covered.

### B3. Scanner duplicate detection breaks silently past 500 books — DONE

- **Where:** `src/pages/scanner.vue` ~1276–1288 (`loadLibraryIsbns` — single `/api/scans?limit=500` fetch, no paging), ~1671 (silent close on `duplicate` result).
- **Problem:** Two stacked failures. (1) Libraries >500 scans: older books aren't in `libraryBooks`, so scanning one shows the normal "match found" sheet instead of the amber in-library summary. (2) The save then 409s, `postScan` returns `duplicate`, and the sheet closes with **no feedback at all** — the user believes the book was added.
- **Fix direction:** page the ISBN load the way `src/composables/useLibraryData.ts` does (it pages to 20k) — or better, add a lightweight `GET /api/scans/isbns` returning just the ISBN list; independently, give the server-detected duplicate path a toast ("already in your library") so the client-side set is a fast path, not the only path. If a route is added, update `worker/CLAUDE.md`.
- **Done when:** with >500 seeded scans, scanning an old book shows the in-library summary; forcing the 409 path (stale client set) produces visible feedback.
- **Implemented:** both halves. `loadLibraryIsbns` now pages at 500/request with the same 40-page runaway guard `useLibraryData` uses. The dedicated `GET /api/scans/isbns` route was **not** added — it would be a new API surface (and a `worker/CLAUDE.md` entry) to save bandwidth on a once-per-mount call, worth revisiting only if the payload becomes a problem on mobile. The duplicate path now toasts `scanner.toast_already_in_library`, a key that already existed in both locales with no call site, so no i18n change was needed.

### B4. Camera can keep running after leaving the scanner — DONE

- **Where:** `src/composables/useBarcodeScanner.ts` ~45–85.
- **Problem:** `stop()` only calls `Quagga.stop()` when `started` is true, but `started` is set inside `Quagga.init`'s async callback. Navigate away while init is in flight → the callback later calls `Quagga.start()` on an unmounted page — camera stream and LED stay on until reload. Privacy-relevant.
- **Fix direction:** a `stopRequested` flag set by `stop()`, checked inside the init callback (if set: don't start; release the stream).
- **Done when:** rapidly entering and leaving the scanner page never leaves the camera indicator on (manual QA on a phone; also verify no console error from the orphaned callback).
- **Implemented:** a monotonic token (`initSeq`/`activeInit`) rather than the single `stopRequested` boolean proposed here — a boolean can't tell "the init I am cancelling" from "an init started after the stop", so an enter/leave/enter sequence faster than camera negotiation would have had the second init's callback cancel itself. A superseded callback now releases the stream it acquired (`Quagga.stop()`) instead of starting it, and `start()` early-returns while an init is already in flight so a double-mount can't open two streams. Needs the phone QA above — this is the one fix whose failure mode is invisible on desktop.

### B5. A deterministically failing `linkWork` stalls the whole sweeper — DONE

- **Where:** `worker/src/sweeper.ts` ~42–51 (link loop), tick structure ~37–167.
- **Read first:** `.claude/rules/enrichment.md` (§Cron sweeper).
- **Problem:** The link loop runs first in the tick, unguarded, and re-selects the same `LIMIT 5` unlinked books every tick. One book that makes `linkWork` throw deterministically (poisoned data, persistent D1 error) throws out of `scheduled` at the same point every 2 minutes: no linking, **no enrichment at all**, and none of the four prunes run. The admin board shows it only as a stale `lastRunAt`. Works enrichment has a whole retry state machine; linking has none.
- **Fix direction:** try/catch per book in the link loop (log, continue); consider a `link_attempts`-style counter or ordering (`ORDER BY id` + offset rotation) so a poisoned row can't monopolize the batch. Also move prunes ahead of (or make them independent of) the fallible phases, and register the usage `flush()` `waitUntil` before the enrichment loop rather than after so a tick killed mid-loop doesn't drop that tick's counters (`sweeper.ts` ~131–166).
- **Done when:** a unit test (the sweeper's pure parts) or a code path demonstrates one throwing book doesn't prevent the others from linking, and a thrown link error doesn't skip enrichment or prunes.
- **Implemented:** three changes. Per-book try/catch in the link loop (log and continue). The four retention DELETEs extracted into a `prune(env)` helper called **first** in the tick, so nothing fallible sits between the tick starting and the pruning finishing — the audit's "prunes never run again" half of the stall. And the usage `flush()` moved into a `finally` around the enrichment loop rather than being registered before it (`waitUntil` before the loop would flush a recorder still being written to; `finally` keeps the flush on both the normal and the throwing path, which is what the counters actually need). The per-book attempt counter was **not** added: with per-book isolation the loop no longer stalls, so a poisoned row costs one wasted link attempt per tick and nothing else. That becomes worth revisiting only if a row can also make `linkWork` hang rather than throw. No unit test — the sweeper tick is D1-bound end to end, which the project's no-miniflare policy puts out of scope.

---

## C. Bugs — medium severity

### C1. `GET /api/scans?sort=<prototype-key>` throws a 500

- **Where:** `worker/src/routes/scans.ts` ~42–43; `worker/src/library-query.ts` ~90 (`SORT_CLAUSES`).
- **Problem:** Plain-object lookup: `?sort=constructor` returns an inherited function (truthy, so the `??` fallback never fires) which gets template-interpolated into `ORDER BY function Object() …` — SQL syntax error, unhandled 500. Not injectable (only fixed prototype members reachable), but a real unhandled-error path any authenticated caller can hit.
- **Fix direction:** `Object.hasOwn(SORT_CLAUSES, sort)` guard, or make `SORT_CLAUSES` a null-prototype object / `Map`.
- **Done when:** `?sort=constructor` and `?sort=garbage` both fall back to `date_desc` (unit-testable — `library-query.ts` is already under test).

### C2. `PATCH /api/auth/me` commits `firstname` before verifying the password

- **Where:** `worker/src/routes/auth.ts` — unconditional firstname UPDATE ~150–158; rate limit + password re-verification ~183–212.
- **Problem:** A request carrying `{firstname, email, currentPassword}` with a wrong password gets a 401 — but the firstname is already persisted. Server state and the client's view of "that request failed" diverge silently. Same for the 429 path.
- **Fix direction:** validate and verify everything first, write last (batch all writes after the guard block).
- **Done when:** a wrong-password PATCH changes nothing; a correct one changes everything it carried.

### C3. `POST /api/books/refresh` can never force enrichment for a book neither source knows

- **Where:** `worker/src/routes/books.ts` ~256–262 (early `404 "Book not found in any source"` before the `enrichWorkDetached(force=true)` at the bottom).
- **Read first:** `.claude/rules/enrichment.md` (refresh is documented as *the* manual force-retry path).
- **Problem:** A book resolved from a Goodreads fallback row (Google and OpenLibrary both miss its ISBN) always has missing metadata, so the fetch always misses and the route 404s — the user's Refresh button can never re-trigger the Wikidata pass, even though the work may be resolvable by title/author.
- **Fix direction:** on metadata miss, fall through to the linkWork/enrichment block and return the existing row (with perhaps a flag noting the metadata refresh itself found nothing) instead of 404ing.
- **Done when:** refresh on such a book returns 200 and schedules enrichment; `worker/CLAUDE.md`'s route description updated if the response shape changes.

### C4. Editions subsystem ignores ISBN-10/13 alternate forms (duplicate `books` rows)

- **Where:** `worker/src/editions.ts` — `materializeEdition` exact-match SELECT ~745–748, `saveEditionCandidates` known-set ~679–684, OL ISBN normalization ~652–654 (dash-strip but no uppercase); `worker/src/routes/catalog.ts` ~63 (candidate `NOT EXISTS` by exact string).
- **Problem:** `resolveEdition` and `POST /api/scans` dedupe on both forms via `alternateIsbnForm`; the editions subsystem compares exact strings only. A `books` row existing under the ISBN-13 form + an OpenLibrary-discovered ISBN-10 candidate → shown as a second edition, and switching to it mints a duplicate `books` row for the same physical edition. Bonus defect: a lowercase-`x` ISBN-10 candidate can never match the route's uppercased input.
- **Fix direction:** one normalization pass over the subsystem — uppercase OL ISBNs at ingestion, and make the three comparison sites check both forms (reuse `alternateIsbnForm`). Also covers the check-then-insert race in `resolveEdition` (~975–1034) only partially — note that concurrent 10-form/13-form inserts can still both miss; if closing that too, do it via a post-insert dual-form re-check.
- **Done when:** unit tests cover 10↔13 and case normalization at each of the three sites; switching to an alternate-form candidate of an existing edition reuses the existing row.

### C5. Edition switch can 500 on custom-field UNIQUE collision

- **Where:** `worker/src/routes/scans.ts` ~451–463 (the `UPDATE book_custom_fields SET book_id = <target>` in the switch batch); constraint UNIQUE `(user_id, book_id, field_def_id)` from migration 0008. Sibling issue: the `alreadyOwned` INSERT race at ~439–449 also surfaces as 500 rather than 409.
- **Problem:** Reachable because `PATCH /api/books/custom-fields` requires no scan, so a user can hold field values on the target book already; the UPDATE then violates the constraint and the whole batch throws an opaque 500 with the switch rolled back.
- **Fix direction:** delete-then-move (target's existing rows win, or merged per-field — pick and document), and catch `isUniqueConstraintError` on the sibling race → 409. Consider pairing with D6 (require a scan for custom-field writes), which makes this near-unreachable.
- **Done when:** the collision path returns success with a defined merge rule instead of 500.

### C6. `useFocusTrap` leaks its capture-phase document listener

- **Where:** `src/composables/useFocusTrap.ts` ~47–59 — listener removed only on the `isOpen` false-transition; no `onScopeDispose`.
- **Problem:** Host unmounts while open (scanner's detected-book sheet → "Back to library"; `/import`'s ResolveDrawer): the capture-phase keydown handler stays on `document` forever, swallowing Escape app-wide (`stopPropagation`) and stacking per visit.
- **Fix direction:** `onScopeDispose(() => removeListener())` alongside the existing transition cleanup.
- **Done when:** leave the scanner with the sheet open, then verify Escape still closes dialogs elsewhere (manual QA).

### C7. `EditionsDialog.switchTo` omits `?locale=` on a locale-joined PATCH

- **Where:** `src/components/book-detail/EditionsDialog.vue` ~411; server default `en` in `worker/src/routes/scans.ts` ~382/466.
- **Read first:** `.claude/rules/book-detail.md` (documents this exact requirement for the two override PATCHes).
- **Problem:** The reply is a full `buildScanSelect` row spread over the displayed book via `refreshed`; a German-locale user switching editions gets `series_name` (and other locale-joined fields) flipped to English until the next full refetch.
- **Fix direction:** append the current locale exactly as the override PATCH call sites do.
- **Done when:** edition switch under `de` keeps German series names (manual QA with seeded series data).

### C8. `confirmReviewItem` bypasses the absorb guard

- **Where:** `src/stores/import.ts` ~1400–1423 (pushes `buildImportedItem` directly instead of through `pushOrAbsorb`).
- **Read first:** `.claude/rules/import-wizard.md` (the absorb guard's purpose: prevent two cards over one scan fighting via Remove/Undo).
- **Problem:** Resolving a review row to an ISBN whose work an earlier row already updated (with `updateExisting` on, overlapping `sibling_updates`) creates a second card over the same scan — one card can PATCH a scan the other's action deleted, or both restore conflicting state on cancel.
- **Fix direction:** route the review-resolution result through `pushOrAbsorb` like every other pass.
- **Done when:** the described resolution absorbs into the existing card (the import store's pure logic has tests — extend them).

### C9. Smaller confirmed defects (batchable)

Each is one small, isolated fix; a single PR can take the lot.

1. **`setStatus` rollback lacks the supersede guard** its siblings have — `src/composables/useScanStatus.ts` ~39–42 vs ~70–75/117–121; restore `prev` only `if (book.status === next)`.
2. **Library fetch error is sticky** — `src/composables/useLibraryData.ts` ~24/45–48; clear `error` at the start of each fetch or on success (banner at `src/pages/index.vue` ~287–296 otherwise renders forever).
3. **`BookDetail.refresh()` fails silently** — `src/components/BookDetail.vue` ~881–894; `throw` inside try/finally with no catch → unhandled rejection, no user feedback on the "only user-facing retry" for failed enrichment. Add a catch → toast/error state.
4. **Login timing oracle** — `worker/src/routes/auth.ts` ~105; `!user || !(await verifyPassword(...))` short-circuits, so unknown emails answer ~100k PBKDF2 iterations faster. Verify against a dummy hash when the user is missing. Low severity here (registration's 409 already leaks existence) but cheap.
5. **Malformed JSON bodies 500** across most routes — `await c.req.json()` unguarded; add a shared `safeJson` helper → 400. Also `register` accepts a JSON array for email (coerces through `EMAIL_RE.test`, fails at D1 bind → 500): add `typeof email === "string"` (login has the same hole).
6. **`fields.ts` handler nits** — `worker/src/routes/fields.ts`: ~187 returns 200 `null` when the re-select finds nothing (should 404); `Number(c.req.param("id"))` on non-numeric ids yields NaN → D1 bind error → 500 where 400/404 is right (~135, ~237, ~256).
7. **Rate-limit keys degrade to one shared bucket** without `CF-Connecting-IP` — `auth.ts` ~11/70, `books.ts` ~99/124 (`?? "unknown"`). Only bites off-Cloudflare (local dev); fine to fix with a per-instance random fallback or accept + comment.
8. **`series.vue` detail loads lack a supersede guard** — `src/pages/series.vue` ~346–372; rapid edition switches can let an older response clobber `detailBook`. Copy the sequence-token pattern from `useWorkEditions`. Also: a failed load leaves `edition=` in the URL with no dialog and no error.
9. **Dead `book` query param** — `src/pages/index.vue` ~1156–1163 preserves `query.book`, which nothing writes; the live detail params are `work`/`edition`/`scan`/`view` (`useDetailRoute.ts`). Fix the param list so a search change while a detail is open doesn't silently close it.
10. **Settings field-type labels don't react to locale switch** — `src/pages/settings.vue` ~974–983; `TYPE_LABELS` is a setup-time const with `t()`. Make it a `computed` like `NAV_SECTIONS` above it (the documented pattern).

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

1. ~~**A1–A3**~~ — all done. A1/A3 in `e302bc1`; A2 was a file deletion with nothing to commit. **`fix/wikidata-series-filter` is unblocked.**
2. ~~**B1–B5**~~ — done (`56444cb`), pending the manual-QA passes noted per task. Merge order against the A-branch doesn't matter.
3. **F1 + F2** — export and reading dates; F2 is time-sensitive (every Goodreads import until then loses history). This is now the front of the queue.
4. **C-block** in opportunistic batches (C9 is one PR); **D-block** alongside whatever touches the same area. Two C-items got cheaper as a side effect of the B-block: C9.2 (sticky library error) is adjacent to the pagination watchers now touched in `index.vue`, and E5's `fieldDefs` half is one file away from B1's watcher.
5. **E-block and remaining F-items** by appetite.

Notes for implementing agents: branch before multi-commit work; conventional commits; the Stop hook runs type-check/lint/tests for whatever you touch — don't pre-run them; update the two inventory files (`worker/CLAUDE.md`, `worker/migrations/CLAUDE.md`) whenever a route or schema change is part of the task; `to-do.md` at the repo root is the owner's personal notes, not this backlog — leave it alone.
