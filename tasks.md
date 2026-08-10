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
| D1–D7 | **Done** — see `tasks_completed.md` (`fix/audit-process-hardening`). D1 still needs two Cloudflare-dashboard actions, named there |
| E1, E3, E5, E6, E7 | **Done** — see `tasks_completed.md` (`feat/e-block-polish`) |
| E2, E4 | **Dropped** — removed from the backlog, not built |
| F3 | **Done** — `/stats` shipped on `feat/stats-page`; manual QA pass still owed (see the task) |
| F3b | **Done** — home reworked to match on `feat/home-rework`; manual QA pass still owed (see the task) |
| F (rest) | Open — below |
| G1–G18 | Open — UX QA findings (2026-08-09 Playwright session), below |

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

### F3. Dedicated `/stats` page (M) — **Done** (`feat/stats-page`)

Built from the `Stats v2` / `Stats mobile v2` mockups, which went beyond the original scope; every
block in them was built. Beyond the plan as written:

- **Worker:** one `LEFT JOIN work_ratings` + three columns on the existing main query backed four
  new blocks — `pageBuckets`/`totalPages`, `genreRatings`, `catalogueGaps`, `owningStatus`, plus
  `countryCount`. `topAuthors` raised 6 → 15; `decades` uncapped (a histogram can't take a
  top-N-by-count slice). No migration.
- **Pure helpers:** `src/utils/stats-view.ts` (extracted from `home.vue`, which now shares it) and
  `src/utils/series-completeness.ts`. Series completeness needed no new API — `GET /api/series`
  already carries the `owned` flag `useShelfGroups` uses.
- **`MobileTabBar` had a live bug**, not just a latent one: it sliced two side slots out of a
  filtered list and indexed `[0]`/`[1]`, so a fourth section silently dropped Settings. Now driven
  by an explicit `MOBILE_SLOT_PRIORITY`, with Settings given a second route in via the account menu.
- **`missing:` search key** (`cover|year|genre|pages`) added so the catalogue-gap rows have
  somewhere to link — no other key expresses absence.

**Deliberately not built:** the mockup's All/Read/Unread scope pills (page is unscoped, matching
what the API does).

**Known divergence worth a follow-up:** a gap row's count is gated on
`owning_status IN ('owned','lent_out')` but its library link isn't, so the linked view can list
more books than the count. No single `owning:` value expresses "owned or lent out"; documented in
`CatalogueGaps.vue`.

**Still owed:** a manual QA pass under a non-default paper/typeface preset, and on a real phone
(the layout was checked at 430px in a desktop browser).

### F3b. Home page rework (M) — **Done** (`feat/home-rework`)

`/stats` absorbed eight of home's ~12 blocks, leaving home a smaller, worse copy of it. The two
pages now split by **mode**: `/stats` aggregates and never names a book, home particularises and
shows almost no numbers. Stated as an invariant in `src/CLAUDE.md`.

- **Removed:** both dimension pickers, the five status tiles (Read/Reading/DNF is the reading
  framing being moved away from — the counts survive in the meta line and as `/stats`'s `status`
  breakdown), median year, average length, the trio items, the decade×genre rotator, and the
  `md:h-screen overflow-hidden` shell. Home scrolls now; covers need room.
- **Built:** `src/components/home/{ShelfSpotlight,RecentlyAdded,ShelfGaps,ShelfOddities}.vue`.
- **Worker:** `computeExemplars` + a 5-book `spotlight` pool on the existing queries — two extra
  columns on the main SELECT, no new query, no migration. `randomFirstLine` retained.
- **No `date_read`/`date_started` and no "currently reading" anywhere**, deliberately. "Recently
  added" stays: acquisition is the core collection event, and the Goodreads import backdating
  `created_at` from "Date Added" is arguably correct.

**Known divergence:** the recently-added strip is unscoped — `GET /api/scans` has no `?scope=`,
so it can include `want`/`unknown` books while the rest of the page is scoped. For an
import-only library that is the friendlier miss (the strip still shows books). Same class as the
`CatalogueGaps.vue` one above. Home also makes three requests where it made one; they run in
parallel and `?limit=12` is far lighter than the library's 500-row page.

**Still owed:** the whole manual QA pass — see the checklist the implementing agent reported
(light/dark and a non-default preset, <840px, the no-network "show me another" cycle, every book
link opening the detail on `/library`, an empty and an import-only library).

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

A random unread pick on the home dashboard, optionally re-rollable and biasable by a facet. Most of the machinery now exists: F3b's `spotlight` pool is `ORDER BY RANDOM() LIMIT 5` with client-side re-rolling already built (`ShelfSpotlight.vue`), so this is that query gated on `status = 'unread'` plus a second block — not a new mechanism. Small, fun, on-brand for "statistics you can actually enjoy browsing".

### F9. Serve covers from R2 instead of hot-linking them (M)

- **Today:** every cover is an `<img>` pointing straight at `books.google.com` or `covers.openlibrary.org`, so the *reader's* browser makes that request. Google receives the reader's IP, User-Agent, `Referer: https://bookscan.pages.dev/` and the volume ids — which are the books — as one correlated burst per page load, and because `books.google.com` is a `google.com` subdomain a signed-in reader sends their Google cookies with it. The app already holds the opposite position everywhere else: `utils/markdown.ts` drops images from reviews because "a remote `<img>` in a review would leak the reader's IP the same way a font CDN would", and the fonts are self-hosted for exactly that reason. Covers are the one place the line isn't held, and the highest-volume remote resource on the page. Secondary payoff: hot-link rot is real here — `CoverImage`'s `failed`/`PlaceholderCover` path exists because stored URLs do die — and once the bytes are ours, `cover-url.ts`'s "which size can we actually get" problem is solved once per book instead of on every re-probe.
- **Scope:** a private R2 bucket holding one image per book, filled by the sweeper, served by a public worker route, read by `CoverImage` through one helper. Six pieces:
  1. **Bucket + binding.** `[[r2_buckets]] binding = "COVERS"` / `bucket_name = "bookscan-covers"` in `worker/wrangler.toml`. Local `wrangler dev` writes to local storage automatically — no `preview_bucket_name` needed. Cloudflare-side actions are listed under **Watch out**.
  2. **Schema — `worker/migrations/0045_book_cover_objects.sql`.** One nullable column on `books`, plus the index the sweeper's due-query needs:

     ```sql
     -- The R2 key of this book's stored cover, NULL until the sweeper has fetched it. Deliberately
     -- NOT a replacement for cover_url: that column stays the provenance record (which upstream
     -- image we took, per src/cover-url.ts's measured source ranking) and the fallback for a book
     -- whose object is missing or not yet written. book_overrides.cover_url still wins over both.
     --
     -- Key format `<isbn>/<8 hex of the bytes>.<ext>`. The content hash is load-bearing: the serve
     -- route sends `Cache-Control: immutable`, so a cover we later replace with a better one has to
     -- arrive under a NEW key or every browser keeps the old bytes for a year.
     ALTER TABLE books ADD COLUMN cover_object_key TEXT;

     -- Serves exactly one query — the sweeper's "which books still need localizing" pick. Partial,
     -- because the rows it must find are a shrinking tail that goes empty once the backlog drains,
     -- and a full index over `books` would stay the size of the catalogue forever to answer it.
     CREATE INDEX idx_books_cover_pending
       ON books(id)
       WHERE cover_object_key IS NULL AND cover_url IS NOT NULL;
     ```

     No backfill statement: the column is NULL for every existing row by design, which is exactly the state the sweeper's fill step consumes. Add `cover_object_key` to the `books` line in `worker/migrations/CLAUDE.md`.
  3. **Fill, in the sweeper.** A small per-tick step (start at 3–5 books) over `cover_url IS NOT NULL AND cover_object_key IS NULL`: fetch the URL, `COVERS.put(key, bytes, { httpMetadata: { contentType } })`, write the key. Costs one external subrequest per book, so it must go through `fitsInBudget` alongside enrichment — enrichment is the priority, covers are the filler. R2 calls are *internal* subrequests (separate 1,000/invocation budget), so only the fetch counts against the 50. Guard on size (reject > ~2 MB) and content type (`image/*` only). At 5/tick × 720 ticks/day the existing ~1,250 books drain in well under a day, so **no separate backfill script is needed** — the same code does both.
  4. **Serve.** `GET /api/covers/:isbn/:hash` — **public**, mounted outside `authMiddleware` (an `<img>` cannot send an `Authorization` header, and a cover is not a secret). `Cache-Control: public, max-age=31536000, immutable`, ETag from the R2 object, `If-None-Match` → 304 via `get(key, { onlyIf })`. A miss is a 404, not a redirect to upstream — `CoverImage` already falls back to `PlaceholderCover`, and redirecting would reintroduce the leak this task exists to close. Consider exempting it from `usageMiddleware`: the recorder measures external API quota and a cover hit spends none. Add the route to `worker/CLAUDE.md`.
  5. **Read.** `buildScanSelect` returns `cover_object_key` alongside `cover_url`; `src/utils/cover.ts` gains `coverSrc(book)` — override first (`cover_url_overridden`), then `${VITE_API_URL}/api/covers/${key}`, then the raw `cover_url` — and `CoverImage` is the only caller, which the "wraps every book cover" invariant already guarantees. Extend `types/book.ts`. Note the scanner and import wizard render candidate covers from *search* results, which have no `books` row yet and keep hot-linking; that is acceptable (a handful of images, user-initiated) but say so rather than leaving it looking finished.
  6. **Interim.** Until the bucket is full, add `referrerpolicy="no-referrer"` to the `<img>` in `CoverImage.vue`. One attribute, stops the origin leaking; does nothing about the IP, so it is a stopgap and not the fix.
- **Read first:** `worker/CLAUDE.md` (route conventions, `usageMiddleware` ownership), `.claude/rules/enrichment.md` (the sweeper's subrequest budget and why `fitsInBudget` stops *before* an overrun), `src/CLAUDE.md` (`CoverImage` invariant, override semantics), `worker/src/cover-url.ts` (which source wins and why, measured).
- **Done when:** a cold library load makes zero requests to `books.google.com` / `covers.openlibrary.org` for books with a `cover_object_key`; a second load serves them from the browser cache with no worker request at all; a cover override still wins; a missing object degrades to `PlaceholderCover`; `worker/CLAUDE.md` and `worker/migrations/CLAUDE.md` updated.
- **Watch out:**
  - **Deploy order is on your side here.** `.github/workflows/deploy.yml` applies migrations *before* `wrangler deploy`, so an added column exists before any worker selects it — the safe direction. (The reverse is the trap `scans.rating`'s deferred `DROP` documents.) Nothing special to do; just don't reorder the workflow.
  - **Cost model.** A Worker route is invoked on *every* request to it, and cache hits count as requests — the Free plan's 100k/day is the ceiling. `immutable` browser caching means only cold loads pay, so a single-owner instance is nowhere near it, but do not assume edge caching makes cover requests free. R2 itself is not the constraint: ~1,250 covers at ~100 KB is ~125 MB against a 10 GB free tier, and reads are Class B (10M/month free).
  - **Cloudflare dashboard actions** (all before the first deploy): create the bucket (**R2 → Create bucket**, name `bookscan-covers`, Standard class, location hint EU) — enabling R2 on the account may ask for a payment method even though this stays inside the free tier; **leave the Public Development URL (`r2.dev`) disabled** — it is rate-limited, uncacheable and would re-expose the bucket the worker is meant to gate; and add **Workers R2 Storage: Edit** to the `CLOUDFLARE_API_TOKEN` repo secret, the same way **Pages: Edit** had to be added.
  - **Later upgrade, not now:** an R2 *custom domain* serves objects straight from cache with no Worker invocation at all, which removes the 100k/day exposure entirely — but it needs a real domain as a zone in the same account, and this instance runs on `bookscan.pages.dev`. If a domain ever appears, it changes only what `coverSrc` prefixes; nothing else in this task.

---

## G. UX QA findings (2026-08-09 Playwright session)

Derived from a 13-pass agent-driven UX test of the running app (dev + a throwaway import account). No data-losing bug was found; these are error-path/display bugs plus friction/polish. IDs in parentheses are the original finding numbers from the session log. Ordered by severity: broken → friction → polish → confirm-first.

### Broken (display/content)

### G1. Worker-down library shows a raw exception + the "scan your first book" empty-state (F15)

- **Today:** with the worker unreachable, `/library` renders the raw JS error `Failed to execute 'json' on 'Response': Unexpected end of JSON input` in the error banner AND the new-user empty-state ("0 titles", "Nothing here yet." / "Scan your first book →") over a library that actually has books — reads as data loss. Reproduced live by killing the worker.
- **Where:** `src/composables/useLibraryData.ts` ~40–41 calls `await res.json()` **before** `if (!res.ok)`, so a non-JSON error body throws the DOMException whose text becomes `error.value`; `src/pages/index.vue` can't distinguish "fetch failed" (`serverBooks` stays `[]`) from "genuinely empty", so it paints the first-scan empty-state on a network failure.
- **Fix:** check `res.ok` before parsing and map a non-JSON body to an i18n message (not the DOMException); gate the empty-state on `!error && hasLoadedOnce` and show a distinct error/retry panel otherwise.
- **Done when:** a worker-down `/library` shows a friendly "couldn't reach the server — retry" and never the empty "scan your first book" CTA over a populated library; recovery on reload still works (already does); both locales.

### G2. Epigraph renders literal `<br>` tags instead of line breaks (F17)

- **Today:** a book's detail Overview → EPIGRAPH shows raw `<br>` text (e.g. Frankenstein: "…from my clay`<br>`To mould me Man…"). The field isn't going through the sanitized markdown path the review uses.
- **Where:** `src/components/book-detail/OverviewPane.vue` epigraph block. **Read first:** `src/CLAUDE.md` (the `MarkdownText` / `utils/markdown.ts` DOMPurify allowlist is the only sanctioned HTML render).
- **Fix:** render the epigraph through the sanitized markdown path (turns `<br>` into a break) or normalise `<br>`→`\n` before display. Do not hand-roll `v-html`.
- **Done when:** the epigraph shows line breaks, no raw tags, and no unsanitized HTML is introduced.

### Friction

### G3. Manual entry of an already-owned ISBN is a silent no-op (F10)

- **Today:** on `/scanner` (manual mode), submitting an ISBN already in the library correctly short-circuits (no lookup/POST) but shows **no feedback** — no "already in library" sheet, no toast; the field just clears. The user can't tell "already owned" from "lookup failed".
- **Where:** `src/pages/scanner.vue` — `submitManualIsbn` (~1418) routes through `onBarcodeDetected`, whose camera-only guard `if (sessionScanned.has(isbn)) return;` (~1580) swallows the repeat; any duplicate is added to `sessionScanned` the first time it's shown (~1613). The title-search path already inlines detection to dodge this exact guard (see the comment ~1479–1481).
- **Fix:** make `submitManualIsbn` bypass the `sessionScanned` short-circuit — inline detection like `selectCandidate`, or pass `{ manual: true }` to skip the guard — so manual entry always produces the sheet, including the amber duplicate sheet the component already supports via `detectedBook.duplicate`.
- **Done when:** typing an owned ISBN and submitting shows the "in library" sheet every time, not a silent field-clear.

### G4. Home mixes a scope-filtered count with unscoped book sections (F14)

- **Today:** under the default **Owned** scope, `/home` hero reads "N books" (scoped) while Recently-added / Gaps / Oddities draw from the **full** library — e.g. "3 books" over ~17 covers on a mostly-import library. Self-contradictory. **Read first:** `src/CLAUDE.md` (the `/stats` aggregates / home particularises invariant and the persisted `useStatsDefaultsStore().scope`).
- **Fix (product decision — discuss before building):** either scope Recently-added/Oddities/Gaps to match the hero (keep a blank-home guard that falls back to all-scope + surfaces the "switch scope on /stats" hint), or stop the hero claiming a total the sections then contradict. Note this is the same class as the documented `CatalogueGaps.vue` / recently-added-unscoped divergences (see F3/F3b above) — resolve together.
- **Done when:** the home hero count and the book sections tell one consistent story under both scopes.

### G5. A work's other owned editions are hard to find (F6)

- **Today:** a work owned in 2 editions (e.g. Pride & Prejudice, scan_id 44 + 72 from `/api/works/44/editions`) shows a "2 editions owned" badge, but opening it lands on one edition and the Editions tab marks only "Your copy" for the current one; the second owned edition is only findable via "Show all N editions" → EditionsDialog among N rows.
- **Where:** `src/components/book-detail/EditionsPane.vue` / `EditionsDialog.vue` curated-list selection. **Read first:** `.claude/rules/book-detail.md`.
- **Fix:** pin **every** owned edition (`scan_id != null`) to the top of the curated Editions list with the "In your library" marker, not just the opened one; optionally show the owned-count on the Editions tab label.
- **Done when:** all owned editions of a work are visible without opening "Show all".

### G6. Autocomplete lists duplicate suggestions for multi-edition works (F4)

- **Today:** typing "dune" shows "Dune — Title" twice (2 owned editions; suggestions aren't deduped by title/work).
- **Where:** `src/composables/useSearchSuggestions.ts`. **Read first:** `.claude/rules/library-pipeline.md`.
- **Fix / Done when:** dedupe title suggestions by work/title so each appears once.

### G7. Library header "N titles" ignores the active filter (F5)

- **Today:** the `/library` header count is a static total; with a search active — even at zero results ("No books match this filter.") — it still reads "37 titles".
- **Where:** `src/pages/index.vue` header count.
- **Fix / Done when:** the count tracks the filtered (collapsed) result, or is relabeled so it doesn't read as a live total.

### G8. Home "Gaps on your shelves" surfaces an "Untitled series — N missing" placeholder (F2)

- **Today:** a series with no display name (enrichment placeholder) shows on the dashboard as "Untitled series" with a missing count → `/series/2`; reads as data corruption.
- **Where:** home gaps block; series naming (`series_names`). **Read first:** `.claude/rules/library-pipeline.md` + `.claude/rules/enrichment`.
- **Fix / Done when:** unnamed/placeholder series are hidden from the home gaps block (or given a real name upstream) so no "Untitled series" appears.

### G9. Library bootstrap data fetched twice on load (F7 — efficiency)

- **Today:** loading `/library` fires the four bootstrap calls (`/api/auth/preferences`, `/api/scans?limit=500`, `/api/series`, `/api/field-definitions`) **twice** — likely a mount fetch plus a reactive re-fetch once preferences/locale settle.
- **Where:** `src/composables/useLibraryData.ts` / the page's watch wiring.
- **Fix / Done when:** the bootstrap set fires once per load (guard/debounce the locale/prefs-driven re-fetch).

### Polish / a11y / copy

### G10. Landing icon-only hero CTA has no accessible name (F1)

- **Where:** `src/pages/landing.vue` — the hero button before "Catalogue your library". **Fix / Done when:** add an `aria-label`; screen readers announce it.

### G11. Rating button keeps `aria-label="Rate this book"` even when rated (F9)

- **Where:** `src/components/book-detail/RecordControls.vue` masthead rating button — renders a star glyph with no text/title. **Fix / Done when:** the label reflects state (e.g. "Rated 7 of 10 — edit") so a screen reader hears the value.

### G12. Library header "37 titles" vs pagination "of 35" (F3)

- **Today:** 37 = scan/edition count, 35 = collapsed work-cards (P&P and Dune each have 2 owned editions). Two totals for "my books" on one screen. **Where:** `src/pages/index.vue` header vs pagination; `useEditionGrouping`. **Fix / Done when:** the header "titles" count matches the collapsed count the list shows (relates to G7).

### G13. Scanner instruction reads "Enter V2 ISBN" (F11)

- **Where:** `src/pages/scanner.vue` / `scanner.*` locale string (en + de). **Fix / Done when:** reads "Enter an ISBN" / "ISBN-13"; both locales.

### G14. Import counters say "1 books" (F13)

- **Where:** `src/pages/import.vue` / `src/components/import/*` shelf-count label. **Fix / Done when:** pluralization is correct ("1 book"); both locales.

### G15. "Import complete" chip never auto-dismisses and leaks across logout/account (F16)

- **Today:** the success chip stays pinned across navigations, a worker restart, a logout, and re-login as a different account — the completion state lives unscoped in the localStorage import store; only a manual × clears it.
- **Where:** `ImportProgressChip` / `src/stores/import.ts` completion state. **Read first:** `.claude/rules/import-wizard.md`.
- **Fix / Done when:** the success chip times out on its own and clears on logout; it never shows for a user who didn't run the import.

### Confirm first (need a human at a real browser before fixing)

### G16. Browser Back on a dirty edit may show the native prompt vs the in-app confirm (F8)

- **Observed:** `page.goBack()` on a dirty edit fired a native `beforeunload` dialog, not the in-app "Discard changes?" that Esc/Cancel raise — very likely a Playwright `goBack()` artifact (a real SPA popstate wouldn't unload). **Confirm:** press the real back button on a dirty edit; if it shows the native prompt, unify it with the in-app confirm (Esc-vs-Back inconsistency). **Read first:** `.claude/rules/book-detail.md`.

### G17. Scanner session list looked fragile under automation (F12)

- **Observed:** during rapid automation the "Added this session" counter jumped 1 → 0 and `/api/scans/isbns` refetched repeatedly, suggesting a mid-session remount. Probably scripted-navigation noise. **Confirm:** save a book, do a second manual lookup, verify the session list survives; only then investigate a remount.

### G18. Taste calls (J1, J2) — no code change unless you agree

- **J1:** the mobile camera-denied screen is a large black void with a small "Enter ISBN manually" link + a toast (functional and recoverable, but could read as broken). `src/pages/scanner.vue` camera-fail state.
- **J2:** `/welcome` onboarding copy is placeholder-flavored ("This could be an impressive tagline.", "badge of shame") and greets "your shelf is empty" even right after a guest-sync added books. `src/pages/welcome.vue`. Decide whether that's the intended voice.

---

## Suggested sequencing

1. **A, B, C, D and the whole E block are done** — see `tasks_completed.md`. Manual-QA passes are still owed for B1–B4 and C6/C7 plus the frontend half of C9, and for the E-block's frontend surfaces (including E1's review search); each task names its own. D1 additionally waits on two Cloudflare-dashboard actions, and D7's `initials`/`formatPublishDate` fixes are worth a glance at a placeholder cover and a book's publish date in the browser.
2. **F1** — library export. This is the front of the queue.
3. **The remaining F-items** by appetite. E6 (README) has had one pass, but F1 landing should shrink its "To be implemented" list again. That list's **reading dates + books-read-per-year** entry (the README face of the dropped F2) has been removed, so the roadmap and this backlog agree again.

Notes for implementing agents: branch before multi-commit work; conventional commits; the Stop hook runs type-check/lint/tests for whatever you touch — don't pre-run them; update the two inventory files (`worker/CLAUDE.md`, `worker/migrations/CLAUDE.md`) whenever a route or schema change is part of the task; `to-do.md` at the repo root is the owner's personal notes, not this backlog — leave it alone.
