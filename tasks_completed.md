# Tasks — completed

The finished half of the audit backlog (see `tasks.md` for what's still open, and for the conventions these entries use). Each task keeps its original text for review context, followed by an **Implemented** note recording what was actually built and anything that deviated from the fix direction originally proposed.

| Batch | State |
| --- | --- |
| A1, A3 | Commit `e302bc1` on `fix/wikidata-series-filter` |
| A2 | File deleted; it was never tracked, so there is no commit (see A2) |
| B1–B5 | Commit `56444cb` on `fix/audit-high-severity` (branched off `main`) |
| C1–C9 | `fix/audit-medium-severity` (branched off `fix/audit-high-severity`) |
| D1–D7 | `fix/audit-process-hardening` (branched off `fix/audit-medium-severity`) |
| E3, E5, E6, E7 | `feat/e-block-polish` (branched off `fix/audit-process-hardening`) |

`fix/audit-high-severity` and `fix/wikidata-series-filter` both touch `sweeper.ts`, in disjoint hunks — they merge cleanly in either order, and neither is blocked.

Manual QA still outstanding: B1–B4 and C6/C7 plus the frontend half of C9 are store/component code, which by project policy carries no unit tests. Each task's "Done when" names the browser pass it still wants.

**D1 needs one action outside the repo before it takes effect**: automatic deployments must be turned off on the Cloudflare Pages project (Workers & Pages → `bookscan` → Settings → Build), and the `CLOUDFLARE_API_TOKEN` secret needs **Pages: Edit**. Until the first, both the workflow and the Git integration deploy the frontend on a push to `main` (redundant, not harmful); until the second, the new step fails the Deploy run after the worker has already shipped.

---

## A. Branch blocker (fixed before merging `fix/wikidata-series-filter`)

### A1. `exactOnly` retry can re-assign series QIDs to bare-titled volumes

- **Where:** `worker/src/enrichment.ts` — the retry at ~942–947, the dropped type filter at ~381 (`exactOnly ? "" : FILTER NOT EXISTS ... SERIES_OF_CREATIVE_WORKS`), `pickExactQid` at ~280–292. Counter-evidence in the branch's own artifacts: `worker/scripts/repair-merged-works.mjs` (the PLAN) and `worker/test/enrichment.spec.ts`.
- **Read first:** `.claude/rules/enrichment.md` (§"Which QID counts as this book's" — the paragraph this task partially invalidates).
- **Problem:** The rule file argues the retry is safe because (a) "a volume never matches its series, because the ordinal it carries is the difference" and (b) `workMatchKey` has already made same-titled works one work. Both defenses fail for volumes catalogued under the **bare series title with no ordinal**, which this production library contains: the repair plan's own groups list work 4412 (`"Das Spiel der Götter"`, keyed `isbn:9783442269099|…`), six "Star wars - Wächter der Macht" editions (authorless, keyed `isbn:<isbn>|`), three "James Bond 007". The branch's test fixture confirms Q458982 — the Malazan *series* item — carries the exact German label "Das Spiel der Götter", and `normalizeStr` makes that an exact match. Sequence: sweeper enriches a repaired isbn-keyed work → strict pass finds nothing (type filter rejects the series; no per-volume item verifies — that's why it merged originally) → stripped pass identical → `exactOnly` retry drops the type filter → series label matches exactly → series QID assigned to the volume → next bare-titled edition resolves to the same QID → `mergeWorks` (destructive, trusts the QID completely) re-collapses the works the repair script just split. Ordinal-carrying titles ("… (12)") are safe because the retry deliberately uses the unstripped title. Confidence: mechanism confirmed; Malazan label equality confirmed by the branch's own fixture; Star Wars/James Bond exposure plausible (depends on live labels/aliases — note `fetchWorkLabels` includes `skos:altLabel`, which widens it).
- **Fix direction (pick one, discuss trade-offs in the PR):**
  1. Skip the `exactOnly` retry entirely for works whose `match_key` starts with `isbn:` — those are exactly the rows that stand alone because local identity was ambiguous, i.e. the population at risk. Cheapest, no extra SPARQL.
  2. Keep the retry but re-check the picked candidate's type set and reject items whose *only* types reach `Q7725310` (series of creative works) — the four known-good cases (Cryptonomicon, Reamde, Watchmen, Daemon) are all co-typed with a non-series work type, a true series item typically isn't. Costs one extra query on an already-rare path; verify the co-typing claim against live Wikidata for the four before relying on it.
- **Also update:** the "This cannot reintroduce the merge" paragraph in `.claude/rules/enrichment.md` — it is wrong as written and the repo's debugging rule says contradicted rule files get corrected, not worked around.
- **Done when:** a unit test encodes the bare-title scenario (a work keyed `isbn:…` whose title exactly equals a series label must NOT get that series QID via the retry), the four known-good singles still resolve, and the rule file reflects the new guard.
- **Implemented** (`e302bc1`): both guards, not one. Fix direction 1 shipped as `isExactRetryEligible(matchKey)` — a new pure, exported predicate in `enrichment.ts`, called at the retry site so an `isbn:`-keyed or key-less work never reaches the retry at all. Fix direction 2 was **rejected**: the file's own measurements against live Wikidata (the comment block above `SERIES_OF_CREATIVE_WORKS`) show type sets cannot separate the co-typed singles from genuine series — Daemon's set is identical to that of real series — so re-checking the picked candidate's types would readmit the population the strict filter exists to reject. In its place, a cheap local signal: a retry hit whose QID already exists in the `series` table (a sibling volume's enrichment upserted it) is rejected as not-found. That covers the residual case guard 1 doesn't — a title|author-keyed volume catalogued under the bare series name — and its known cost is written down (it can reject a legitimate co-typed single whose parts are catalogued separately; nulls beat a series identity). Tests: the bare-title exact match (proving `pickExactQid` alone is insufficient) and three `isExactRetryEligible` cases. The rule file's safety argument was rewritten to match, in both the code comment and `.claude/rules/enrichment.md`.

### A2. Delete or regenerate `worker/repair.sql`

- **Where:** `worker/repair.sql` (full old PLAN output, applied to prod 2026-07-30 per its header).
- **Problem:** It is a checked-in, already-applied, **non-idempotent destructive** script. The branch's own new warning in `repair-merged-works.mjs` documents exactly why re-applying an applied entry is harmful (repoints books off correctly-enriched rows, strands `work_ratings`, half-applies where the sweeper already merged a survivor away — work 295 is already gone). The generator script is the source of truth; the stale SQL sits one `d1 execute --file` away from damage and is findable by someone who never reads the generator's warning.
- **Fix direction:** delete the file (preferred — regenerate on demand), or regenerate it to contain only the unapplied entries (currently `--work 4412`).
- **Done when:** no stale applied SQL is committed; if a file remains, its header states which entries are unapplied and when it was generated.
- **Implemented:** deleted. **Correction to the audit finding:** the file was never tracked by git — no history on any branch, not in the index, not gitignored, just an untracked working-tree artifact from the 2026-07-30 repair run. So "checked-in" in the problem statement above was wrong, and the deletion produced no commit. The hazard was real but local to one machine rather than distributed with the repo, which downgrades this from "blocker" to "housekeeping" in hindsight. Worth knowing for the next generated-SQL run: since the generator writes into `worker/` and nothing ignores `*.sql` there, the artifact is invisible to `git status` reviewers only by luck of nobody staging it — a `worker/*.repair.sql` entry in `.gitignore` would make that deliberate.

### A3. Raise/refresh the enrichment claim TTL; update the sweeper budget comment

- **Where:** `worker/src/enrichment.ts` `CLAIM_TTL_MINUTES` (~860–877, comment says it "must comfortably exceed a worst-case run"); `worker/src/sweeper.ts` ~6–16 (the "7 × 6 = 42" subrequest budget comment).
- **Read first:** `.claude/rules/enrichment.md` (§State machine, §Cron sweeper).
- **Problem (two related, found independently by two reviewers):**
  1. The branch's third search pass (`exactOnly`) pushed the worst-case not-found path to up to 6 SPARQL attempts × 25 s timeout + up to 10 s 429-sleep each ≈ 210 s, before `fetchWorkDetails`/`fetchSeriesMembers`/`fetchWorkEditionIsbn` (~105 s more worst-case) plus Google Books (4 retries with backoff) and OpenLibrary. That exceeds the 5-minute stale-claim TTL, so a slow-Wikidata episode lets the next cron tick steal a live claim and run the same SPARQL concurrently — duplicate external load and racing detail writes, the exact races the claim exists to prevent.
  2. The sweeper's batch-size reasoning predates the third pass: a tick of 7 not-found works (a German-heavy bulk import is exactly this) can spend up to 42 SPARQL calls plus the link batch's ~15 external fetches, past the 50-subrequest free-plan ceiling; excess fetches fail, works land on `failed`, and re-queue to spend the budget again.
- **Fix direction:** raise `CLAIM_TTL_MINUTES` to 10–15 **or** refresh the claim (`enrichment_started_at = now`) between SPARQL phases; recount and update the sweeper budget comment, and consider dropping `BATCH_SIZE` or short-circuiting remaining works in a tick once a subrequest-heavy path has run N times. Migration 0030's comment says "2 minutes" — migrations are immutable, so note the discrepancy in `worker/migrations/CLAUDE.md` instead.
- **Done when:** the TTL provably exceeds the recomputed worst case (show the arithmetic in the comment), the budget comment matches current call counts, and the 0030 drift is noted.
- **Implemented** (`e302bc1`): `CLAIM_TTL_MINUTES` 5 → 15 (the raise, not the mid-run refresh — a refresh means threading the claim through every SPARQL phase for a case a wider TTL covers outright, and the only cost of a wide TTL is how long a crashed run's work stays unclaimable). The recomputed worst case (~380–400 s: three search passes × 2 SPARQL each, then details/series/edition-ISBN, then Google Books and OpenLibrary) is written into the comment so the next person changing the retry chain can see what the number is protecting. Sweeper budget comment updated to ~13 calls on a pathological work and 6 SPARQL on a fully not-found one, and the German-heavy-import trigger named. `BATCH_SIZE` was left at 7 — throughput after a bulk import is the constraint it was tuned for, and the ceiling is documented as a budget rather than a guarantee. Migration 0030's stale "2 minutes" is now recorded on the `works` entry in `worker/migrations/CLAUDE.md`, where the `enrichment_started_at` column was previously undocumented entirely.

---

## B. Bugs — high severity (user-visible)

All five implemented in commit `56444cb` on `fix/audit-high-severity`. Type-check, lint, and both test suites pass; the manual-QA criteria in each "Done when" are the part still outstanding, since none of this code is unit-testable under the project's no-DOM policy.

### B1. `fieldDefs` store leaks across accounts (never reset on logout)

- **Where:** `src/stores/fieldDefs.ts` ~30–42 (`load()` early-returns once `loaded`), ~91–95 (`reset()` — zero call sites); `src/stores/auth.ts` ~70–81 (logout path).
- **Problem:** Log out, log in as another account in the same tab: the new user sees the previous user's custom-field definitions and cached tag values in the edit form, grouping dimensions, and Details pane until a hard reload. Cross-account data exposure on a shared browser; writes can also target field-def ids the new user doesn't own (server 4xxs, broken UI paths).
- **Fix direction:** watch the auth token and reset the store on change — `src/stores/preferences.ts` already implements exactly this pattern; mirror it.
- **Done when:** logging out and in as a different user (seeded via `cd worker && npm run seed:dev`) shows only the new user's fields with no reload. Manual QA — stores aren't unit-tested by policy.
- **Implemented:** a `watch` on `authStore.token` calling the store's existing (previously call-site-less) `reset()`, mirroring the preferences store's watcher. Deliberately not `immediate` — the store is created lazily on first use, so the initial token needs no reset, and firing on creation would clear a `load()` that a page had already kicked off. Still needs the QA pass above.

### B2. Any optimistic write resets library pagination to page 1

- **Where:** `src/pages/index.vue` ~962–964 (page-reset watcher on `filteredBooks`); cause chain through `src/composables/useEditionGrouping.ts` ~42–45 (spreads every book) and `src/utils/book-display.ts` ~33–40 (`pickRepresentativeEdition` reads `status`).
- **Read first:** `.claude/rules/library-pipeline.md`.
- **Problem:** The watcher fires on any new array identity. With `groupEditions` on (default), the computed tracks essentially every property of every book, so cycling a status pill, setting a rating, or an enrichment-poll `refreshed` merge invalidates the chain → user on page 3 is thrown to page 1.
- **Fix direction:** reset the page only when the *inputs* change — watch `parsedSearch`/`groupBy`/`sortDirection`/`perPage` (the filter/group/sort state), not the derived array.
- **Done when:** on a seeded library with 3+ pages, changing a book's status on page 3 leaves the user on page 3; changing the search text still resets to page 1.
- **Implemented:** the watcher now tracks `[search, onlyOwned, groupEditions, sortDirection, groupBy, perPage]` — the raw `search` ref rather than `parsedSearch` as proposed here, since `parsedSearch` is itself a computed over the book list and would have reintroduced the same coupling. `onlyOwned`/`groupEditions` were added because both change the visible set and neither was in the original watcher. Plus a second watcher on `totalPages` that **clamps** `currentPage` when the set shrinks under it (a delete, or a write dropping a book out of the active filter) — without it, dropping the last book on the last page would have stranded the reader on an empty page, which the old blanket reset had incidentally covered.

### B3. Scanner duplicate detection breaks silently past 500 books

- **Where:** `src/pages/scanner.vue` ~1276–1288 (`loadLibraryIsbns` — single `/api/scans?limit=500` fetch, no paging), ~1671 (silent close on `duplicate` result).
- **Problem:** Two stacked failures. (1) Libraries >500 scans: older books aren't in `libraryBooks`, so scanning one shows the normal "match found" sheet instead of the amber in-library summary. (2) The save then 409s, `postScan` returns `duplicate`, and the sheet closes with **no feedback at all** — the user believes the book was added.
- **Fix direction:** page the ISBN load the way `src/composables/useLibraryData.ts` does (it pages to 20k) — or better, add a lightweight `GET /api/scans/isbns` returning just the ISBN list; independently, give the server-detected duplicate path a toast ("already in your library") so the client-side set is a fast path, not the only path. If a route is added, update `worker/CLAUDE.md`.
- **Done when:** with >500 seeded scans, scanning an old book shows the in-library summary; forcing the 409 path (stale client set) produces visible feedback.
- **Implemented:** both halves, and the dedicated `GET /api/scans/isbns` route **was** added after all — the paged-`GET /api/scans` version made scanner startup cost scale with library size on the app's most latency-sensitive page, for a call whose only product is an ISBN→status map. Two columns per scan send unpaginated at any realistic library size. Registered before `/:id` so the literal path wins the route match; documented in `worker/CLAUDE.md`. The duplicate path now toasts `scanner.toast_already_in_library`, a key that already existed in both locales with no call site, so no i18n change was needed.

### B4. Camera can keep running after leaving the scanner

- **Where:** `src/composables/useBarcodeScanner.ts` ~45–85.
- **Problem:** `stop()` only calls `Quagga.stop()` when `started` is true, but `started` is set inside `Quagga.init`'s async callback. Navigate away while init is in flight → the callback later calls `Quagga.start()` on an unmounted page — camera stream and LED stay on until reload. Privacy-relevant.
- **Fix direction:** a `stopRequested` flag set by `stop()`, checked inside the init callback (if set: don't start; release the stream).
- **Done when:** rapidly entering and leaving the scanner page never leaves the camera indicator on (manual QA on a phone; also verify no console error from the orphaned callback).
- **Implemented:** a monotonic token (`initSeq`/`activeInit`) rather than the single `stopRequested` boolean proposed here — a boolean can't tell "the init I am cancelling" from "an init started after the stop", so an enter/leave/enter sequence faster than camera negotiation would have had the second init's callback cancel itself. A superseded callback now releases the stream it acquired (`Quagga.stop()`) instead of starting it, and `start()` early-returns while an init is already in flight so a double-mount can't open two streams. Needs the phone QA above — this is the one fix whose failure mode is invisible on desktop.

### B5. A deterministically failing `linkWork` stalls the whole sweeper

- **Where:** `worker/src/sweeper.ts` ~42–51 (link loop), tick structure ~37–167.
- **Read first:** `.claude/rules/enrichment.md` (§Cron sweeper).
- **Problem:** The link loop runs first in the tick, unguarded, and re-selects the same `LIMIT 5` unlinked books every tick. One book that makes `linkWork` throw deterministically (poisoned data, persistent D1 error) throws out of `scheduled` at the same point every 2 minutes: no linking, **no enrichment at all**, and none of the four prunes run. The admin board shows it only as a stale `lastRunAt`. Works enrichment has a whole retry state machine; linking has none.
- **Fix direction:** try/catch per book in the link loop (log, continue); consider a `link_attempts`-style counter or ordering (`ORDER BY id` + offset rotation) so a poisoned row can't monopolize the batch. Also move prunes ahead of (or make them independent of) the fallible phases, and register the usage `flush()` `waitUntil` before the enrichment loop rather than after so a tick killed mid-loop doesn't drop that tick's counters (`sweeper.ts` ~131–166).
- **Done when:** a unit test (the sweeper's pure parts) or a code path demonstrates one throwing book doesn't prevent the others from linking, and a thrown link error doesn't skip enrichment or prunes.
- **Implemented:** three changes. Per-book try/catch in the link loop (log and continue). The four retention DELETEs extracted into a `prune(env)` helper called **first** in the tick, so nothing fallible sits between the tick starting and the pruning finishing — the audit's "prunes never run again" half of the stall. And the usage `flush()` moved into a `finally` around the enrichment loop rather than being registered before it (`waitUntil` before the loop would flush a recorder still being written to; `finally` keeps the flush on both the normal and the throwing path, which is what the counters actually need). The per-book attempt counter was **not** added: with per-book isolation the loop no longer stalls, so a poisoned row costs one wasted link attempt per tick and nothing else. That becomes worth revisiting only if a row can also make `linkWork` hang rather than throw. No unit test — the sweeper tick is D1-bound end to end, which the project's no-miniflare policy puts out of scope.

---

## C. Bugs — medium severity

All nine implemented on `fix/audit-medium-severity`. Type-check, lint and both suites pass (frontend 214, worker 237). The manual-QA criteria in C6/C7 and the frontend half of C9 are the part still outstanding — none of that code is unit-testable under the project's no-DOM policy.

### C1. `GET /api/scans?sort=<prototype-key>` throws a 500

- **Where:** `worker/src/routes/scans.ts` ~42–43; `worker/src/library-query.ts` ~90 (`SORT_CLAUSES`).
- **Problem:** Plain-object lookup: `?sort=constructor` returns an inherited function (truthy, so the `??` fallback never fires) which gets template-interpolated into `ORDER BY function Object() …` — SQL syntax error, unhandled 500. Not injectable (only fixed prototype members reachable), but a real unhandled-error path any authenticated caller can hit.
- **Fix direction:** `Object.hasOwn(SORT_CLAUSES, sort)` guard, or make `SORT_CLAUSES` a null-prototype object / `Map`.
- **Done when:** `?sort=constructor` and `?sort=garbage` both fall back to `date_desc` (unit-testable — `library-query.ts` is already under test).
- **Implemented:** a new exported `sortClauseFor(sort)` in `library-query.ts` — the guard belongs next to the table rather than at the one call site, since a second caller (E1.2's rating sort, or F1's export route) would otherwise reintroduce the hole. `Object.hasOwn` was **not** used: the worker's tsconfig `lib` is es2021, so it is `Object.prototype.hasOwnProperty.call`. A null-prototype `SORT_CLAUSES` was the other candidate and was rejected — `__proto__: null` in an object literal typed `Record<string, string>` doesn't type-check, and the guard has to live somewhere callers can't skip anyway. Tests cover the two named cases plus `toString`/`valueOf`/`hasOwnProperty`/`__proto__`.

### C2. `PATCH /api/auth/me` commits `firstname` before verifying the password

- **Where:** `worker/src/routes/auth.ts` — unconditional firstname UPDATE ~150–158; rate limit + password re-verification ~183–212.
- **Problem:** A request carrying `{firstname, email, currentPassword}` with a wrong password gets a 401 — but the firstname is already persisted. Server state and the client's view of "that request failed" diverge silently. Same for the 429 path.
- **Fix direction:** validate and verify everything first, write last (batch all writes after the guard block).
- **Done when:** a wrong-password PATCH changes nothing; a correct one changes everything it carried.
- **Implemented:** the handler is now validate-all → guard → write-once. Rather than the proposed `db.batch()` of three UPDATEs, it is **one** UPDATE with a dynamically built SET list: all three fields live on `users`, so a single statement is atomic by construction and needs no batch semantics to reason about. That also closed a second partial-write the audit didn't name — the old sequential writes left the firstname applied when the *email* UPDATE hit its UNIQUE constraint and returned 409. The "no valid fields to update" 400 moved ahead of the guard block, since with writes deferred there is no longer a populated `result` to test at the end.

### C3. `POST /api/books/refresh` can never force enrichment for a book neither source knows

- **Where:** `worker/src/routes/books.ts` ~256–262 (early `404 "Book not found in any source"` before the `enrichWorkDetached(force=true)` at the bottom).
- **Read first:** `.claude/rules/enrichment.md` (refresh is documented as *the* manual force-retry path).
- **Problem:** A book resolved from a Goodreads fallback row (Google and OpenLibrary both miss its ISBN) always has missing metadata, so the fetch always misses and the route 404s — the user's Refresh button can never re-trigger the Wikidata pass, even though the work may be resolvable by title/author.
- **Fix direction:** on metadata miss, fall through to the linkWork/enrichment block and return the existing row (with perhaps a flag noting the metadata refresh itself found nothing) instead of 404ing.
- **Done when:** refresh on such a book returns 200 and schedules enrichment; `worker/CLAUDE.md`'s route description updated if the response shape changes.
- **Implemented:** the miss now only skips the COALESCE UPDATE; the request continues into `linkWork` + `enrichWorkDetached(force=true)` as before. The response carries the suggested flag as **`metadata_refreshed`** (true when nothing was missing *or* the fetch filled something, false when both sources still don't know the ISBN) — `worker/CLAUDE.md`'s route entry now documents it and says the only remaining 404 is "no `books` row for this ISBN". One incidental correctness fix came with it: the re-select after the UPDATE was gated on `hasMissingMetadata(existing)` rather than on the UPDATE having run, so it now keys off whether the write actually happened.

### C4. Editions subsystem ignores ISBN-10/13 alternate forms (duplicate `books` rows)

- **Where:** `worker/src/editions.ts` — `materializeEdition` exact-match SELECT ~745–748, `saveEditionCandidates` known-set ~679–684, OL ISBN normalization ~652–654 (dash-strip but no uppercase); `worker/src/routes/catalog.ts` ~63 (candidate `NOT EXISTS` by exact string).
- **Problem:** `resolveEdition` and `POST /api/scans` dedupe on both forms via `alternateIsbnForm`; the editions subsystem compares exact strings only. A `books` row existing under the ISBN-13 form + an OpenLibrary-discovered ISBN-10 candidate → shown as a second edition, and switching to it mints a duplicate `books` row for the same physical edition. Bonus defect: a lowercase-`x` ISBN-10 candidate can never match the route's uppercased input.
- **Fix direction:** one normalization pass over the subsystem — uppercase OL ISBNs at ingestion, and make the three comparison sites check both forms (reuse `alternateIsbnForm`). Also covers the check-then-insert race in `resolveEdition` (~975–1034) only partially — note that concurrent 10-form/13-form inserts can still both miss; if closing that too, do it via a post-insert dual-form re-check.
- **Done when:** unit tests cover 10↔13 and case normalization at each of the three sites; switching to an alternate-form candidate of an existing edition reuses the existing row.
- **Implemented:** a new `isbnForms(isbn)` in `isbn.ts` — "every form this physical edition can be stored under" — is the shared vocabulary the four sites now use, rather than each calling `alternateIsbnForm` and hand-rolling the pair. OL ingestion runs `normalizeIsbn` (which uppercases) instead of a bare dash-strip; `saveEditionCandidates`' known-set and `materializeEdition`'s SELECT both cover both forms, the latter preferring an exact-string hit when both exist so behaviour is unchanged where no counterpart row is involved. **`catalog.ts` deviates from the fix direction**: its `NOT EXISTS` stayed exact-string and the alternate-form filter is applied in JS over the already-loaded materialized list, because the 10↔13 conversion is a checksum recomputation SQLite can't express. That narrows the filter to *this work's* editions — a `books` row under a different work is still offered as a candidate, as it was before, which is the correct reading of "another edition of this work". The `resolveEdition` insert race was **not** closed (explicitly out of scope per the fix direction) and remains open as a note here. Tests cover `isbnForms` on both directions, the no-alternate cases (979-prefixed, non-ISBN) and the set-membership property the comparison sites rely on; the `isbn.ts` header comment was corrected, since it claimed external-API ISBNs are never normalized.

### C5. Edition switch can 500 on custom-field UNIQUE collision

- **Where:** `worker/src/routes/scans.ts` ~451–463 (the `UPDATE book_custom_fields SET book_id = <target>` in the switch batch); constraint UNIQUE `(user_id, book_id, field_def_id)` from migration 0008. Sibling issue: the `alreadyOwned` INSERT race at ~439–449 also surfaces as 500 rather than 409.
- **Problem:** Reachable because `PATCH /api/books/custom-fields` requires no scan, so a user can hold field values on the target book already; the UPDATE then violates the constraint and the whole batch throws an opaque 500 with the switch rolled back.
- **Fix direction:** delete-then-move (target's existing rows win, or merged per-field — pick and document), and catch `isUniqueConstraintError` on the sibling race → 409. Consider pairing with D6 (require a scan for custom-field writes), which makes this near-unreachable.
- **Done when:** the collision path returns success with a defined merge rule instead of 500.
- **Implemented:** delete-then-move with **the moving scan's values winning** — the opposite of the "target's existing rows win" option offered first, and deliberately so: the target's rows are orphans of a book the user has no scan of, while the scan's values are the ones they have been curating, and "custom field values follow the scan" is already the route's documented behaviour. The DELETE sits inside the same `db.batch`, so the merge is still atomic. The sibling race is caught via `isUniqueConstraintError` around the batch → 409, the same answer the pre-check gives. Both are now written into `worker/CLAUDE.md`'s route entry, since the merge rule is a contract rather than an implementation detail. D6 was not pulled in — it would make this near-unreachable rather than correct, and it is its own task.

### C6. `useFocusTrap` leaks its capture-phase document listener

- **Where:** `src/composables/useFocusTrap.ts` ~47–59 — listener removed only on the `isOpen` false-transition; no `onScopeDispose`.
- **Problem:** Host unmounts while open (scanner's detected-book sheet → "Back to library"; `/import`'s ResolveDrawer): the capture-phase keydown handler stays on `document` forever, swallowing Escape app-wide (`stopPropagation`) and stacking per visit.
- **Fix direction:** `onScopeDispose(() => removeListener())` alongside the existing transition cleanup.
- **Done when:** leave the scanner with the sheet open, then verify Escape still closes dialogs elsewhere (manual QA).
- **Implemented:** exactly the proposed `onScopeDispose`, which also drops the `previouslyFocused` reference — the old code held a detached element for the life of the tab on the same path. It deliberately does **not** restore focus the way the close transition does: on dispose the host is gone and the element that had focus before opening usually went with it. Needs the browser pass above.

### C7. `EditionsDialog.switchTo` omits `?locale=` on a locale-joined PATCH

- **Where:** `src/components/book-detail/EditionsDialog.vue` ~411; server default `en` in `worker/src/routes/scans.ts` ~382/466.
- **Read first:** `.claude/rules/book-detail.md` (documents this exact requirement for the two override PATCHes).
- **Problem:** The reply is a full `buildScanSelect` row spread over the displayed book via `refreshed`; a German-locale user switching editions gets `series_name` (and other locale-joined fields) flipped to English until the next full refetch.
- **Fix direction:** append the current locale exactly as the override PATCH call sites do.
- **Done when:** edition switch under `de` keeps German series names (manual QA with seeded series data).
- **Implemented:** one-line change — the store was already imported for the language filter, so no new wiring. `worker/CLAUDE.md`'s route entry now says the route takes `?locale=` like every other `buildScanSelect`-backed call; it was the only one whose entry didn't. Needs the German-locale QA above.

### C8. `confirmReviewItem` bypasses the absorb guard

- **Where:** `src/stores/import.ts` ~1400–1423 (pushes `buildImportedItem` directly instead of through `pushOrAbsorb`).
- **Read first:** `.claude/rules/import-wizard.md` (the absorb guard's purpose: prevent two cards over one scan fighting via Remove/Undo).
- **Problem:** Resolving a review row to an ISBN whose work an earlier row already updated (with `updateExisting` on, overlapping `sibling_updates`) creates a second card over the same scan — one card can PATCH a scan the other's action deleted, or both restore conflicting state on cancel.
- **Fix direction:** route the review-resolution result through `pushOrAbsorb` like every other pass.
- **Done when:** the described resolution absorbs into the existing card (the import store's pure logic has tests — extend them).
- **Implemented:** routed through `pushOrAbsorb`, and the row it is handed is the *resolved* one (`{ ...item.row, isbn }`, already built for the payload) rather than `item.row` — otherwise an absorbed row logs the review item's original null/invalid ISBN instead of the one it was imported under. **No test was added, and the "Done when" as written isn't reachable:** the guard's pure logic (`cardWriteSet`/`findAbsorbTarget`/`writesToAdopt` in `src/utils/import-cards.ts`) is already covered by `test/import-cards.spec.ts`, and what changed here is which call site reaches it — store wiring, which the no-DOM/no-Pinia-in-tests policy puts out of scope. The behaviour wants the manual pass instead: an export with two rows for one work, `updateExisting` on, one of them resolved through review.

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

**Implemented — all ten.** Per item, where it differed from the sketch above:

1. As proposed.
2. Cleared at the **start** of each fetch rather than on success, so a retry visibly clears the banner while it runs instead of only once it lands.
3. New `detail.refresh_error` in both locales, surfaced as a line beside the Refresh button via a new `refreshError` prop on `DetailsPane` — not a toast: the failure belongs next to the control that caused it, and `DetailsPane` already owns the button's own state.
4. `DUMMY_PASSWORD_HASH` exported from `password.ts` (a well-formed all-zero PBKDF2 hash no password matches) so the format and the constant live together; the iteration count is interpolated from `PBKDF2_ITERATIONS` so it tracks a future raise rather than silently becoming a cheaper branch.
5. New `worker/src/json-body.ts` — `readJsonBody(c)` returning `null` plus a shared `INVALID_JSON_BODY` constant, applied at all 15 body-reading call sites. Returning null rather than throwing an `HTTPException` was deliberate: Hono's error path skips the CORS middleware's post-`next()` header write, so a thrown 400 would reach the browser without CORS headers and read as a network error. It also rejects a **non-object top level** (`"foo"`, `[…]`, `null`) — which is what closes the `register`/`login` array-email hole structurally, with the named `typeof email === "string"` guard added on top. The import routes additionally got `Array.isArray(body.rows)`, since a string `rows` has a `.length` the batch-size guard would have accepted.
6. Both, via a shared `fieldIdParam(c)` helper → 404 for a non-integer id (it can never match a row, and the caller can't distinguish that from an unknown id anyway). `DELETE /:id`, which passed the raw string param, was folded in for consistency. The 200-`null` re-select now 404s.
7. Per-isolate random fallback, behind a new `clientIp(c)` in `rate-limit.ts` so the four call sites can't drift. Documented in `worker/CLAUDE.md`.
8. Sequence token as proposed, plus the failed-load half: a failure now calls `closeDetail()`, stripping `edition=` so the URL stops describing a dialog that isn't there and clicking the entry again is a retry. The page-level `loadError` banner was **not** reused — that replaces the whole series list with an error, which is the wrong scope for one detail row failing.
9. Fixed by exporting `DETAIL_QUERY_PARAMS` from `useDetailRoute.ts` and having `index.vue`'s search watcher carry that set across, rather than swapping one hardcoded name for four — the param list has grown twice already (`scan`, then `view`), and this is the second place it has to be right.
10. As proposed.

---

## D. Process, docs, and hardening

### D1. Gate the Pages frontend deploy on the verify workflow

- **Where:** `.github/workflows/deploy.yml` + the Cloudflare Pages Git integration (root `CLAUDE.md` §Architecture).
- **Problem:** Verify failure withholds the worker + migrations, but Pages ships the frontend anyway — new UI against old API. Even on success the two deploys race (frontend typically live minutes before the worker).
- **Fix direction:** deploy Pages from the workflow (`wrangler pages deploy` after the worker step) and disable the Git integration, or use Pages branch-control "skip builds unless checks pass". Consult `cloudflare-docs` MCP before writing config — flags move. Update root `CLAUDE.md` §Architecture to match whichever shape lands.
- **Done when:** a red verify run deploys nothing; ordering is worker-then-frontend (or documented as acceptable).
- **Implemented:** the workflow-owns-both shape (option 1). The frontend steps are appended to the **existing `deploy` job** rather than added as a second job — same-job sequencing is what guarantees worker-then-frontend without job plumbing, and it means a failed worker deploy stops the frontend from shipping at all. Steps: root `npm ci` → export `VITE_API_URL` → `npm run build-only` → `wrangler pages deploy --branch=main`. Three decisions worth knowing:
  - **`VITE_API_URL` is read out of the root `wrangler.toml`** by a one-line `sed`, not restated in the workflow. Cloudflare's build environment was the only thing injecting `[vars]` into the Vite build; hard-coding the URL in the workflow would have made the same value live in two files, which is exactly the kind of drift the repo's inventory rule exists to prevent. The step fails the deploy if the assignment isn't found, rather than building a frontend with no API base (which silently falls back to a same-origin `/api` that doesn't exist in production). `wrangler.toml` carries a comment saying the shape is load-bearing.
  - **Wrangler is run from `worker/node_modules/.bin`** — it is the worker's devDependency, the frontend has none of its own, and `npx wrangler` unpinned would fetch a fresh copy on every deploy. The command runs with the repo root as cwd so the root `wrangler.toml` (project name `bookscan`, `pages_build_output_dir = "dist"`) is the config wrangler picks up; no `--project-name`/directory flags needed.
  - **`--branch=main` is explicit** because Actions checks out a detached HEAD, so wrangler cannot infer the branch, and only the production branch publishes to `bookscan.pages.dev`.
  - **`build-only`, not `build`** — the latter re-runs the type-check the verify job just did.
  - `setup-node`'s cache now covers both lockfiles.
  - **Not done in the repo, because it can't be:** turning off automatic deployments on the Pages project, and adding **Pages: Edit** to `CLOUDFLARE_API_TOKEN`. Both are dashboard actions; the note at the top of this file records them. Root `CLAUDE.md` §Architecture was rewritten around the new shape, including a line saying what re-enabling Pages auto-deploy would undo.

### D2. Fix `worker/CLAUDE.md` guest-migration claim

- **Where:** `worker/CLAUDE.md` (register/login bullets claim the server "migrates any guest scans to account"). No such code exists — `auth.ts` never touches `scans`; the real mechanism is the client replaying guest scans through `POST /api/scans` in seed mode (comments at `routes/scans.ts` ~154, `library-query.ts` ~384).
- **Fix direction:** correct the two bullets to describe the client-replay mechanism. Doc-only change; the inventory is a contract per repo rules.
- **Implemented:** as proposed, and the claim was re-verified before rewriting (`routes/auth.ts` contains no reference to `scans` at all). The login bullet now names the actual mechanism end to end — `syncToAccount` in `src/stores/guest.ts` replaying each local scan through `POST /api/scans` with the fresh token, oldest first, failed ISBNs kept in `localStorage` and retried by `App.vue`'s watcher on the next authenticated load — and ties it to why that route writes `rating`/`review` in **seed** mode. The register bullet says plainly that nothing is migrated there and points at the login note rather than repeating it. `src/CLAUDE.md`'s own line was left alone: it credits `syncToAccount()`, i.e. the client, which is correct.

### D3. Guard the sweeper's Google Books spend

- **Where:** `worker/src/sweeper.ts` → `backfillEdition`/`materializeEdition` (`worker/src/enrichment.ts` ~699–724); daily counters already exist (`api_usage`, queried in `worker/src/routes/admin.ts` ~180–278).
- **Problem:** The self-amplifying placeholder backlog (each series enrichment inserts ~10 placeholders, each of whose enrichment can spend a Google Books call) can drain the shared daily quota that interactive title search depends on. The admin board observes; nothing enforces.
- **Fix direction:** before `backfillEdition`'s Google half, check the UTC-day Google count against a threshold (constant, e.g. comfortably below the daily quota) and skip with a log line when over. Sweeper-only — never gate interactive paths.
- **Done when:** the guard exists, the threshold is a named constant with the reasoning in a comment, and the skip is visible in logs.
- **Implemented:** in `backfillEdition`, gated on `source === "sweeper"` (`source` is now threaded through `backfillEditionsAndDiscovery`, which needed it and had it available one frame up). `SWEEPER_GOOGLE_BOOKS_BUDGET = 700` sits above the function with the amplification argument and the 1,000/day figure the admin gauge uses.
  - **It drops the Google half rather than skipping the backfill.** `fetchBookMetadata` already treats a missing API key as "OpenLibrary only", so over budget the call passes `undefined` for the key: an unmetered OpenLibrary hit still usually yields a cover, and a total miss inserts no `books` row, which leaves the backfill retryable by any later run. Skipping outright would have marked the work `done` with no edition and no path back short of a schema bump — a permanent missing cover in exchange for a temporary quota problem.
  - **The counter read is shared, not duplicated:** `googleBooksCallsToday(db, nowMs?)` and `usageDayStart(nowMs)` are new exports in `usage.ts` (which owns the `api_usage` writes and the hour bucket), and `GET /api/admin/usage` was switched over to both — its inline `Date.UTC(...)` day boundary and its identical fallback query are gone. The guard and the gauge now cannot disagree about what "today" is.
  - **Known lag, documented at the helper:** `UsageRecorder` buffers until `flush()`, so calls made within the current tick aren't visible to the check. The overshoot is bounded by one tick's worth of calls, which is why a per-tick check is enough and no read-through was added.
  - `.claude/rules/enrichment.md` gained a paragraph under §Cron sweeper, including the instruction not to extend the gate to any path a user is waiting on.

### D4. Record post-merge in-flight outcomes in `enrichment_runs`

- **Where:** `worker/src/enrichment.ts` ~1278 (`if (identity.kind === "in-flight") return;`).
- **Read first:** `.claude/rules/enrichment.md` §Observability (every attempting call writes a row; anything that stops doing so "silently blinds" the board).
- **Problem:** A run that did a full search, verification, and a **destructive merge**, then lost the post-merge re-claim, records nothing. Merges are the most consequential pipeline action and are invisible in telemetry on this path.
- **Fix direction:** write a run row (outcome recording the merge) before the early return. Rare path, low risk.
- **Implemented:** the row is written against the **surviving** work, which required carrying it out of `resolveWorkIdentity`: the `in-flight` variant of `IdentityOutcome` now has a `canonicalId` field, because the row this call started from was deleted by the merge and `enrichment_runs.work_id` has to name a work that still exists.
  - **Outcome is `done`, not a new value.** A fourth outcome (`merged`) would have had to be threaded through `summarizeRuns`, `src/types/admin.ts`, `VitalsPanel`, the signal colours and both locale files — for a rare path, and it would still not have made merges visible *as merges*, since a merge that runs to completion also records plain `done`. Recording what the same merge records when it wins the re-claim keeps the two halves of one behaviour consistent; the comment at the site says so.
  - §Observability in the rule file now names this path explicitly, so the invariant it states is true again rather than aspirational.

### D5. Re-enrich no-title works when they later gain a title

- **Where:** `worker/src/enrichment.ts` ~1273–1277 (no-title path persists `done` at `CURRENT_ENRICHMENT_SCHEMA_VERSION` with nulls).
- **Problem:** If the edition later gains a title (e.g. `/refresh` fills a NULL `books.title`), nothing re-enriches until the next schema bump. Low impact; cheapest fix is to have the metadata-refresh path flip the work back to `pending` when it fills a previously-NULL title.
- **Implemented — no code change; the premise was wrong, and this is the correction.** `POST /api/books/refresh` already force-schedules enrichment (`enrichWorkDetached(..., force = true, ...)`) on **every** call, not only when the metadata fetch changed something — that was a deliberate C-era decision for the Goodreads-import rows neither source knows. `force = true` bypasses the "already `done`, skip" check and resets the work to `pending`, so an edition that gains a title through the only path that can fill one *is* re-enriched immediately. The proposed fix (flip the work to `pending` when the title is filled) would have been strictly weaker than what the code already does.
  - Verified rather than assumed: `books.title` is written in exactly two places — the INSERTs in `resolveEdition`/`materializeEdition`, and the `COALESCE` UPDATE in `/refresh`. `resolveEdition` returns an existing row untouched, so no other request path can fill a NULL title. `linkWork` does assign `book.work_id` in memory (`editions.ts` ~942), so the `if (book.work_id)` guard around the refresh route's enrichment call is not a hole either — that was the one way the gap could still have been real.
  - What landed instead: a comment at the no-title branch recording why it deliberately lands on `done` at the current schema version (a titleless work re-queued forever would occupy batch slots and write a run row every two minutes), that `/refresh` is the recovery path, and that the one case genuinely outside it is a title corrected directly in D1 — which no request observes, and which the enrichment rule happens to recommend for same-title collisions. Closing *that* would need a marker column and a fourth sweeper query, which is not worth it for an operator action.

### D6. Require a scan for override/custom-field writes

- **Where:** `worker/src/routes/books.ts` ~325–421 (`PATCH /api/books/override`, `PATCH /api/books/custom-fields`).
- **Problem:** Not an auth leak (rows are per-user), but any authenticated user can accumulate unbounded rows against the whole shared catalogue; `DELETE /api/scans/:id` only garbage-collects rows for scanned books, and a scanless write succeeds silently with `{}`. Requiring an existing scan (404 otherwise) closes the growth vector and makes C5 near-unreachable.
- **Done when:** scanless writes 404; `worker/CLAUDE.md` route docs updated. Check the frontend never legitimately writes pre-scan (the edit screen shouldn't, but verify the import wizard's paths).
- **Implemented:** `getBookByIsbn` in `library-query.ts` was **replaced** by `getScannedBookByIsbn(db, userId, isbn)` (a `books`⋈`scans` join) rather than adding a second check beside it — those two routes were its only callers, so keeping the unguarded version would have left a shared helper whose whole purpose is to be used the wrong way. Both routes 404 with the existing `{ error: "Book not found" }` body: "the catalogue doesn't have it" and "you don't have it" are deliberately one answer, since a caller with neither can't distinguish them anyway.
  - **Frontend audit, as the task asked:** `BookDetail.vue` is the only caller of either route in the whole of `src/`, and it sends `props.book.isbn` — a book from the library list, i.e. one with a scan. The series page opens the same component with `readonly`, which hides every control that could save. The import wizard writes custom-field values through `POST /api/import/goodreads`'s `shelves_field_def_id`, never through this route. So nothing legitimate wrote pre-scan.
  - **One doc claim went stale and was corrected**, per the repo's rule about contradicted docs: `worker/CLAUDE.md`'s edition-switch entry justified the custom-field merge rule with "`PATCH /api/books/custom-fields` needs no scan, so the user can already hold values on the target book". The clearing step is still needed — rows written before this change still exist, and it is also what keeps the move from violating UNIQUE `(user_id, book_id, field_def_id)` — but the reason is now historical, and the entry says that instead.

### D7. Unit tests for untested pure logic

Per project policy only pure, Vue-free/D1-free logic gets unit tests — all of the below qualify and are currently uncovered:

- `isIsbnFormat` (`worker/src/isbn.ts` ~42) — the one function there with no describe block; guards the scan-queue entry.
- `summarizeRuns` (`worker/src/routes/admin.ts` ~38–73).
- `claimScans`, `pickPrimarySibling`, `applyImportRating` (`worker/src/routes/import.ts` ~168–354) — the pieces the import-wizard concurrency guarantees rest on; need exporting.
- `stats.ts` helpers: `extractYear`, `computeDecadeGenres`, `computeTranslationRatio`, `computeYearStats` (year bounds, `count < 10` cutoff, code-vs-label fallback).
- `src/utils/cover.ts` `tintFor`/`initials` — note `initials` strips all non-ASCII ("Ärger" → "R", non-Latin title → "?"); write the test, then decide whether that behavior is a bug to fix here too.
- `src/utils/book-display.ts` `formatDateTime`/`formatPublishDate` (three-branch date handling, regression-prone).

**Implemented — all six, 108 new assertions across three new spec files and two extended ones.** Three route-module helpers gained an `export` (each with a comment saying it is for the tests), as did `stats.ts`'s `RawRow` type and `admin.ts`'s `RunRow`. New: `worker/test/admin.spec.ts`, `worker/test/import.spec.ts`, `worker/test/stats.spec.ts`; extended: `worker/test/isbn.spec.ts`, `test/book-display.spec.ts`; new frontend: `test/cover.spec.ts`. Importing a route module into a test pulls in Hono and `jose`, which is fine under node — but it is the first time the worker's tests do it.

**Two behaviours the tests turned up were fixed, both in `src/utils/`:**

1. **`initials` mangled every non-ASCII title** — the ASCII whitelist dropped the umlaut and promoted the second letter ("Ärger" → "R"), and emptied a non-Latin title to "?". Now filters on `\p{L}`/`\p{N}` (any script) and indexes by code point rather than UTF-16 unit, so "Ärger" → "Ä", "海辺のカフカ" → "海", and an astral first letter is a whole character instead of half a surrogate pair. ASCII titles are unchanged, punctuation is still stripped ("Don't Panic" → "DP"), and "?" remains the answer when nothing survives.
2. **`formatPublishDate` was a day early west of UTC** — the value is built as UTC midnight but was rendered in the reader's local zone, so `1965-08-09` displayed as 8 Aug for anyone at a negative offset. Both branches now pass `timeZone: "UTC"`. This is also what makes literal assertions possible at all; `formatDateTime` deliberately keeps local-zone rendering (it formats an instant the reader owns, not a calendar date), so its tests pin the UTC *parsing*, the locale mapping and the field set without pinning a calendar day.

Notes on what the tests deliberately encode as current-behaviour-not-endorsement, so a future change is a decision rather than a surprise: `computeYearStats`' median takes the upper of two middles; `computeTranslationRatio` counts a row whose edition language isn't a resolvable code as translated; `formatPublishDate("2026-13-01")` rolls into 2027; `summarizeRuns` drops an unknown outcome from `byOutcome` while still counting it in `total`, and treats an unrecognised failure reason as non-transient (`RETRY_POLICY`'s own reading).

---

## E. Improvements to existing features

E1, E3, E5, E6 and E7 shipped on `feat/e-block-polish` (branched off `fix/audit-process-hardening`). **E2 (admin write actions) and E4 (integer/date custom field stats) were dropped from the backlog rather than built** — they are gone from `tasks.md` and are not recorded here as work.

Manual QA outstanding: these touch frontend surfaces that carry no unit tests by project policy — the library search dropdown (E3), free-text search matching review bodies (E1), the scanner's title search and lookup (E5), the scanner session list and the guest banner (E7), and a screen-reader pass over the rating row (E7).

### E1. Surface ratings: stats, sort, review search

Three small strokes; can be one PR or three.

1. **Rating stats:** `worker/src/routes/stats.ts` (~40–77 response shape) has no `work_ratings` join. Add `avgRating` + a 0–10 distribution to `StatsResponse` (`src/types/stats.ts`), computed in SQL. Feeds F3.
2. **Server rating sort:** add `rating_desc` (and `_asc`) to `SORT_CLAUSES` (`worker/src/library-query.ts` ~90–99 — `work_ratings` is already in the JOIN), plus the option in `LibraryDisplaySettings` and the sort param docs in `worker/CLAUDE.md`. Decide NULL placement (NULLS LAST) deliberately.
3. **Review search:** include `b.review` in the free-text match in `src/composables/useLibrarySearch.ts` ~315–322 — the text is already on every client-side row. Read `.claude/rules/library-pipeline.md` first (the search→collapse→group order is load-bearing).

- **Implemented (1) as its own query rather than a join onto the main stats row.** `GET /api/stats` gained `avgRating`, `ratedCount` and `ratingDistribution`; the SQL is a fifth entry in the existing `Promise.all`, and the arithmetic lives in an exported pure `computeRatingStats` beside the file's other unit-tested helpers. Two decisions worth knowing:
  - **It counts `DISTINCT b.work_id`, not scans.** Every other stat in the file is per-scan, but a rating hangs off the *work* (`work_ratings`, keyed `(user_id, work_id)`), so a user holding two editions of a book they rated 8 would have weighted that 8 twice. This is the one place in `stats.ts` where the unit is the work.
  - **The distribution is dense** — always 11 buckets, `rating` 0–10 ascending, zero counts included — so F3's histogram doesn't have to fill its own gaps. `computeRatingStats` also drops out-of-scale or non-integer ratings defensively; `isValidRating` gates every write, so that is belt-and-braces, not a known bad-data case.
  - **Nothing renders it yet.** `home.vue` is a fixed-height teaser whose layout is tuned to its current tiles, and the rating histogram is explicitly F3's scope; the field is API-only for now, which is what "Feeds F3" asked for. `normalizeStats` defaults the three fields so an older worker can't blank the page.
- **Implemented (2) server-side only — the `LibraryDisplaySettings` half of the task is based on a false premise.** `SORT_CLAUSES` gained `rating_desc`/`rating_asc`, both leading with `wr.rating IS NULL` so **unrated books sort last in both directions** (SQLite defaults NULLs first in ASC, which would open "worst first" with every book the user never rated); `worker/CLAUDE.md`'s sort-param list and a unit test both record that.
  - But `LibraryDisplaySettings` has no sort-by control to add an option to, and **the library page never sends `?sort=` at all**: `useLibraryData` fetches every page at the default `date_desc` and the entire visible ordering is client-side (`groupBy` × `sortDirection`). `rating` is already a group-by dimension there, so the user-facing capability exists by another route. The new clauses are an API-contract addition — real, correct and tested, but not something the app itself exercises today. Worth knowing before someone "wires up the new sort option" and finds nothing to wire it to.
- **Implemented (3) as written.** `b.review` joined the free-text match in `useLibrarySearch`'s `baseFiltered`. It stays part of the free-text match rather than getting its own `review:` key — you search for a phrase you wrote, not for "has a review" — and it costs one extra string compare per book with no round-trip, since `review` already rides the `work_ratings` JOIN on every row. The pipeline order is unaffected: this is still a per-edition field compared before `useEditionGrouping` collapses anything.

### E3. Finish DNF

- `status:dnf` is filterable but never suggested: add it to the facet-suggestion loop in `src/composables/useLibrarySearch.ts` ~348–352 (compare `STATUS_VALUES` — don't hardcode a second list).
- README §Features still says "Unread, Reading, or Read" — update while there. (See also E6.)
- **Implemented:** the hardcoded three-entry array is gone; the loop now iterates `STATUS_ORDER` (the same constant `STATUS_VALUES` is built from) and derives each label from the `book.<status>` locale key, which is what every status picker in the app already does. Two consequences worth knowing:
  - **The suggestion order changed** from read → reading → unread to `STATUS_ORDER`'s unread → reading → read → dnf. The dropdown now matches the pickers rather than contradicting them, but it is a visible change and not purely an addition.
  - **The list stays pool-filtered.** `presentStatuses` is unchanged, so `status:dnf` is only offered to a library that actually contains a DNF book — a user who has never used the status sees exactly what they see today.
  - README's status line was corrected as part of E6's pass rather than separately.

### E5. Route hand-rolled `fetch` through `apiFetch`

- **Where:** `src/stores/fieldDefs.ts` ~34/46/65/108; `src/pages/scanner.vue` ~1428–1434, ~1497–1503.
- **Problem:** violates the documented invariant (src/CLAUDE.md) and loses 401→logout — an expired token on the scanner's title search surfaces as a generic error loop instead of logging out. Note the deliberate exceptions: `guest.ts` `syncToAccount` and `login.vue` are pre-auth/explicit-token and stay raw.
- **Implemented:** all four `fieldDefs` calls converted; the store's `BASE` constant and its `authHeaders()` helper are both gone, and `useApi()` is resolved once at store-setup level beside the existing `useAuthStore()`. The account-switch `revision` guard is untouched and still correct — a 401 now logs out, which trips the token watcher, which calls `reset()`, which bumps `revision`, so an in-flight load still cannot install the previous account's defs.
- **The scanner's two call sites were split rather than converted wholesale**, which is a deviation from the task as written. Each was a three-statement `endpoint`/`headers`/`fetch` dance branching on `isGuest`; each is now a single ternary — `apiFetch` for the authenticated endpoint, a bare `fetch` for the guest one:
  - The guest endpoints (`guest-lookup`, `guest-search`) are public and send **no headers at all**, which keeps them simple cross-origin GETs. `apiFetch` unconditionally sets `Content-Type: application/json`, which would make them preflighted — the worker's CORS middleware sets no `maxAge`, so browsers cache a preflight for only ~5 s and a guest scanning a shelf would pay an extra round trip per book, on the app's most latency-sensitive page. The task named `guest.ts`/`login.vue` as the pre-auth exceptions; these are the same category, and `landing.vue`'s `books/sample` is a fourth.
  - The authenticated halves are the ones that actually had the bug, and they now get 401 → logout.
  - `src/CLAUDE.md`'s `apiFetch` invariant was rewritten to enumerate all the remaining raw `fetch`es and say *why* each stays raw, so the next audit does not re-file this.

### E6. README refresh

The feature list has drifted both directions: it under-sells (no DNF, no ratings/reviews, no owning-status model, no editions carousel, no admin board) and the status list is stale. One pass over `README.md` §Features + §To be implemented, ideally after F1/F2 land so the to-be-implemented list shrinks honestly.

- **Implemented — one pass, taken before F1/F2 rather than after**, since the drift was already user-visible and the "To be implemented" list can be trimmed again when those land (noted in `tasks.md`'s sequencing). **Later correction:** F2 was subsequently dropped from the backlog, and the README entry this pass added for it was removed at the same time — so the item count below is now four, not five.
  - §Features gained six entries — ownership status (all five values named, with the wishlist/lent-out framing), ratings and reviews (half-star 0–10, Markdown, per work rather than per copy), editions, smart search (with `status:dnf` as one of the examples), appearance, and the admin board — and corrected three: reading status now lists DNF, custom fields now list all five types (`text`/`integer`/`date`/`select`/`tag`, not "text, numbers, or dropdowns"), and Goodreads import now mentions ratings. The offline scan queue was folded into the scanning bullet, where a reader looking for it would actually be.
  - §To be implemented now has five items instead of three: export split into CSV **and** JSON, reading dates + books-read-per-year added (F2), the stats item sharpened into "a dedicated statistics page" (F3), edition management kept, and an installable/offline-capable app added (F5) — worded to say plainly that the queue works offline today but only once the page is loaded, so it does not read as a claim that the app is already a PWA.
  - Every claim was checked against code rather than against the previous README: owning values from `src/locales/en.json` `owning.*`, field types from the `POST /api/field-definitions` contract, appearance options from `settings.appearance.*`.

### E7. Minor UX polish (batchable)

- `sessionTime` freeze: `src/pages/scanner.vue` ~1261–1265 renders relative times from non-reactive `Date.now()`; use a ticking ref (30 s interval, cleared on unmount).
- `scanAgain` resets `selectedStatus` to hardcoded `"read"` (~1696) instead of `libraryDefaultsStore.defaultScanStatus`.
- Guest banner hardcodes `{ max: 3 }` (`src/pages/index.vue` ~12) — export `MAX_GUEST_SCANS` from `src/stores/guest.ts`.
- `RatingStars` a11y: `src/components/RatingStars.vue` ~63–74 — half-star buttons announce a bare number; add `role="radiogroup"` + "7 of 10"-style labels.
- Duplicate-scan pre-check runs up to 3 D1 queries before the rate limit (`worker/src/routes/scans.ts` ~107–116, deliberate for 409-before-quota UX): cheap mitigation is charging the limiter when the dup check misses.

**Implemented — all five.**

1. **`sessionTime`** reads a `nowTick` ref refreshed on a 30 s `window.setInterval`, cleared in the existing `onBeforeUnmount`. Known cost, accepted: the tick re-renders the scanner component every 30 s whether or not the session list is on screen. Gating the interval on `sessionBooks.length` was considered and dropped as more moving parts than the render is worth.
2. **`scanAgain`** now uses `libraryDefaultsStore.defaultScanStatus`, matching the three other reset sites in the file (`selectCandidate`, the detection handler, and the offline-queue replay). The hardcoded `"read"` was the only one left.
3. **`MAX_GUEST_SCANS`** is exported from `src/stores/guest.ts` and imported by `index.vue`'s banner. The store already used the constant for `remaining`/`isAtLimit`, so this was purely the banner reading a copy of it.
4. **`RatingStars`** interactive rows are now a `radiogroup` labelled with `detail.rate_book`, each half-star button `role="radio"` with `aria-checked` bound to the current rating and an `aria-label` of `detail.rating_value_aria` ("{n} of 10" / "{n} von 10", new in both locales). Display-only rows are untouched — they render no buttons and are usually nested inside one, so a radiogroup role there would be a lie.
5. **The duplicate-scan pre-check now charges the limiter**, and because this changed a documented invariant it was decided explicitly rather than inferred. The task text ("charging the limiter when the dup check misses") is ambiguous between counting-only and counting-and-rejecting; **counting and rejecting** was chosen, with the owner's agreement. A follow-up commit (`70e1571`) then went further and moved the dup check *below* `rateLimitOrReject` entirely, which is the shipped state: the limiter runs first, and an over-budget caller never reaches the lookup at all. The dup check is still ahead of `resolveEdition`, so no external metadata fetch happens for a duplicate. Inside the budget the answer is unchanged; past it, a duplicate gets the `429`. Rationale: 30/min is ~one book every 2 s, which covers every real rescan, whereas the previous ordering left a path doing up to three D1 queries per request that no limiter ever saw. `worker/CLAUDE.md`'s rate-limiting paragraph was rewritten to describe the new ordering and why the old one changed.
