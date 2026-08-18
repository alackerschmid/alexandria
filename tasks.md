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
| F3 | **Done** — see `tasks_completed.md` (`feat/stats-page`); manual QA pass still owed, named there |
| F3b | **Done** — see `tasks_completed.md` (`feat/home-rework`); manual QA pass still owed, named there |
| F9 | **Done** — covers served from R2 on `feat/covers-in-r2`; see `tasks_completed.md` |
| F (rest) | Open — below |
| G1–G15 | **Done** — see `tasks_completed.md` (PRs #67–#70) |
| G16–G18 | Open — the confirm-first findings and the taste call, below |

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

## G. UX QA findings (2026-08-09 Playwright session)

Derived from a 13-pass agent-driven UX test of the running app (dev + a throwaway import account). No data-losing bug was found; these were error-path/display bugs plus friction/polish. IDs in parentheses are the original finding numbers from the session log.

**G1–G15 have shipped** (PRs #67–#70) — see `tasks_completed.md` for what was built and where it deviated. What remains is the tail that a browser session couldn't settle on its own.

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

1. **A, B, C, D, the whole E block, F3/F3b/F9 and G1–G15 are done** — see `tasks_completed.md`. Manual-QA passes are still owed for B1–B4 and C6/C7 plus the frontend half of C9, and for the E-block's frontend surfaces (including E1's review search); each task names its own. D1 additionally waits on two Cloudflare-dashboard actions, and D7's `initials`/`formatPublishDate` fixes are worth a glance at a placeholder cover and a book's publish date in the browser. F3, F3b and F9 each still owe a browser pass, listed with them in `tasks_completed.md`. The G block was verified in a browser as it landed; only G4's bulk-import fallback rests on the code alone, noted there.
2. **F1** — library export. The front of the feature queue.
3. **G16 and G17** whenever someone is at a real browser anyway — both may be automation
   artefacts, and neither should have code written against it until the symptom is reproduced by
   hand. G18 is a taste call to make, not a task to schedule.
4. **The remaining F-items** by appetite. E6 (README) has had one pass, but F1 landing should
   shrink its "To be implemented" list again; that list is down to export, edition management and
   offline, so the roadmap and this backlog agree.
5. **One deferred defect worth a decision**, recorded with G4 in `tasks_completed.md`: `/stats`'
   `CatalogueGaps.vue` deep-links list a superset of what their counts say, because no `owning:`
   value expresses "owned or lent out". Closing it means adding that search facet — a feature, so
   it wants scoping rather than folding into a fix.

Notes for implementing agents: branch before multi-commit work; conventional commits; the Stop hook runs type-check/lint/tests for whatever you touch — don't pre-run them; update the two inventory files (`worker/CLAUDE.md`, `worker/migrations/CLAUDE.md`) whenever a route or schema change is part of the task; `to-do.md` at the repo root is the owner's personal notes, not this backlog — leave it alone.
