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

---

## Suggested sequencing

1. **A, B, C, D and the whole E block are done** — see `tasks_completed.md`. Manual-QA passes are still owed for B1–B4 and C6/C7 plus the frontend half of C9, and for the E-block's frontend surfaces (including E1's review search); each task names its own. D1 additionally waits on two Cloudflare-dashboard actions, and D7's `initials`/`formatPublishDate` fixes are worth a glance at a placeholder cover and a book's publish date in the browser.
2. **F1** — library export. This is the front of the queue.
3. **The remaining F-items** by appetite. E6 (README) has had one pass, but F1 landing should shrink its "To be implemented" list again. That list's **reading dates + books-read-per-year** entry (the README face of the dropped F2) has been removed, so the roadmap and this backlog agree again.

Notes for implementing agents: branch before multi-commit work; conventional commits; the Stop hook runs type-check/lint/tests for whatever you touch — don't pre-run them; update the two inventory files (`worker/CLAUDE.md`, `worker/migrations/CLAUDE.md`) whenever a route or schema change is part of the task; `to-do.md` at the repo root is the owner's personal notes, not this backlog — leave it alone.
