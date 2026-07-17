# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet.

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I’m always open to ideas on better ways to do things. Please don’t hesitate to suggest a better way, or one that has long lasting impact over a tactical change. If what we are trying to do is similar to settled science or industry practice, let me know. We don’t have to reinvent the wheel.

6. Keep this file in sync with the code: when adding, renaming, or removing a route, table, store, composable, page, or component, update the corresponding CLAUDE.md inventory in the same change. The behavioral sections age well; the inventories rot silently unless this is enforced.

7. Ignore `to-do.md` at the repo root — it's personal notes, not tasks for you. Don't read, update, or act on it unless explicitly asked.

## Formatting

- Scale response length to task requirements. Be concise but comprehensive.
- No performative tics: no unnecessary validation ("Fair point"), narrating the next move ("Let me name them plainly"), flagging significance ("This is the real issue"), or advertising honesty ("to be honest"). Lead with substance.
- No filler questions. "What's next?", "How can I help?", "What's up?" are social performance, not real questions. Only ask a question when you need the answer to proceed.
- End the response when the substantive answer ends. No trailing asides set apart from the main reply — no "One thing I notice," "One small residual," "Worth flagging," "Also worth knowing," "One note," "One genuinely marginal note," or any closing observation appended after the answer is complete. If a point matters, state it in the body with a clear verdict on whether it's an issue or not. A point held for the end and hedged as "non-blocking" or "marginal" forces the reader to evaluate something the writer already judged unimportant — either give it a real place in the body or cut it.

## Development Setup

**Prerequisites:**

- Node.js 22+ (as per `@tsconfig/node22`)
- npm 10+

**Local development:**

1. `npm install` at root, then `cd worker && npm install` — the worker has its own `package.json`/lockfile and is not covered by the root install
2. Create `worker/.dev.vars` with required secrets:
   ```
   JWT_SECRET=<any-random-string-for-local-dev>
   GOOGLE_BOOKS_API_KEY=<your-google-books-api-key>
   ```
3. Run **both** dev servers simultaneously:
   - `npm run dev` (frontend on `:3000`)
   - `npm run dev:worker` (worker on `:8787`, in separate terminal/tab)

   The frontend proxies `/api/*` to the worker — API calls fail silently if the worker isn’t running.

4. Optional: `cd worker && npm run seed:dev` (worker must already be running) creates/reuses a fixed local test account — `dev@example.com` / `devpassword123` — and seeds it with a handful of scans spanning different statuses/owning-states/ratings, so manual QA doesn't need a throwaway registration each time. Talks to the local worker over HTTP and only ever targets local D1; safe to re-run (skips ISBNs already in the account's library).

## Commands

### Frontend (root)

```bash
npm run dev          # Vite dev server on :3000 (proxies /api → :8787)
npm run build        # Type-check + Vite build → dist/
npm run type-check   # vue-tsc --build --force
npm run lint         # ESLint
npm run lint:fix     # ESLint --fix
```

### Worker (Cloudflare Worker backend)

```bash
npm run dev:worker     # wrangler dev (local worker on :8787)
npm run deploy:worker  # wrangler deploy to production
# Or from worker/ directly:
cd worker && npm run dev
cd worker && npm run deploy
```

### Database migrations

```bash
# Local D1 (during wrangler dev)
cd worker && npx wrangler d1 migrations apply bookscan --local
# Production D1
cd worker && npx wrangler d1 migrations apply bookscan --remote
```

### Verification

```bash
npm run type-check          # Verify TypeScript (required before commit)
npm run lint                # ESLint — the root flat config covers both src/ and worker/src/
npm test                    # Vitest (root) — frontend pure-logic tests (search-parse, shelf-packing, offline-queue)
cd worker && npm test       # Vitest — pure-logic unit tests (isbn, library-query, editions, enrichment, auth, password)
cd worker && npx vitest run test/enrichment.spec.ts   # run a single test file
```

Note: Both the worker (`worker/test/*.spec.ts`) and the frontend (root `test/*.spec.ts`, `vitest run`) have unit tests covering **pure logic only** — no D1/miniflare, no component mounting, so anything requiring a DB or the DOM is untested (deliberate scope decision). Frontend components/pages are verified by type-checking and manual QA (seed via `cd worker && npm run seed:dev`); only Vue-free helpers get unit tests.

## Architecture

Two `wrangler.toml` files — root (`wrangler.toml`) configures Cloudflare Pages and sets `VITE_API_URL` at build time; `worker/wrangler.toml` configures the Worker (D1 binding, cron, observability, `CORS_ORIGIN`).

Two separate deployments, both triggered by pushing to `main`:

- **Frontend**: Cloudflare Pages — static Vite build, deployed automatically on push to `main` via Cloudflare's Git integration
- **Worker**: Cloudflare Worker (`bookscan-worker`) — deployed by the GitHub Actions **Deploy** workflow (`.github/workflows/deploy.yml`) on push to `main`: it runs the shared verify workflow (type-check, lint, worker tests), applies pending D1 migrations, then runs `wrangler deploy`. Requires the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. The former Cloudflare Git integration (Workers Builds) for the worker is disabled. `npm run deploy:worker` (`wrangler deploy`) remains available for manual/out-of-band deploys (it does not apply migrations).

CI: the **CI** workflow (`.github/workflows/ci.yml`) runs the same verify workflow on every push to non-`main` branches.

Pushing to GitHub redeploys both the frontend and the worker. Worker deploys apply pending D1 migrations automatically (before `wrangler deploy`); manual/out-of-band deploys do not — apply those with `npx wrangler d1 migrations apply bookscan --remote` (see below).

### Frontend (`src/`)

Vue 3 + TypeScript + Vite.

- `src/pages/` — route-level components:
  - `landing.vue` — unauthenticated marketing page (`/`)
  - `home.vue` — authenticated dashboard: stats, greeting, recently-added (`/home`)
  - `index.vue` — full paginated library (`/library`)
  - `welcome.vue` — first-run onboarding (`/welcome`); seen-state stored in `localStorage` under `WELCOME_SEEN_KEY`
  - `series.vue` — series completeness view (`/series/:id`)
  - `settings.vue` — custom field management (`/settings`)
  - `login.vue`, `scanner.vue`, `privacy.vue`, `NotFound.vue`
- `src/components/` —
  - App chrome/shared: `AppHeader`, `AppFooter`, `AppToast`, `AppPagination`, `AppSelect`, `AppToggle` (presentational track/knob toggle switch — parent owns the click handler), `MobileTabBar`, `LoadingButton`, `OverrideDot`, `PlaceholderCover`, `ConfirmDialog` (shared destructive-confirm dialog — title/body/danger/loading/confirm-disabled + default slot; used by the library delete + settings account-delete flows), `ScannerPreview` (decorative barcode/scan-line widget used by `landing.vue` and `welcome.vue`; `dark` prop defaults to always-dark, pass `:dark="false"` to follow the app theme)
  - Library page: `LibrarySearchBar` (the smart-search widget — hero, highlight overlay, autocomplete dropdown, token pills, ⌘K; backed by `useSearchSuggestions`), `LibraryCoverCard`, `LibraryRowCard`, `LibraryGhostRow`, `LibraryGroupHeader` (one shelf-group header — packed `compact` / mobile `full` sizes), `LibraryGroupTabs`, `LibraryDisplaySettings`
  - `BookDetail.vue` (card/full mode switch + shared edit/enrichment/edition state) plus its subcomponents in `src/components/book-detail/`: `BookDetailCard` (the compact card-mode view), `AuthorChips`, `BookEditForm`, `CustomFieldsPanel`, `EditionCarousel`, `EditionDetails`, `EditionsDialog`, `EnrichmentBadge`, `RatingDialog`, `TagInput`
  - `src/components/settings/` — settings section building blocks (formerly inline `defineComponent`s): `SettingsSectionHeading`, `SettingsField`, `SettingsDefaultRow`, `SettingsSegControl`
- `src/composables/` — shared logic extracted from pages:
  - `useApi.ts` — **the canonical API client.** `useApi().apiFetch(path, init?, opts?)` prepends `VITE_API_URL`, sets `Content-Type` + `Authorization` from the auth store, and logs the user out on a 401 (opt out with `{ on401: "ignore" }`). All authenticated frontend API calls must go through it — don't hand-roll `fetch`.
  - `useLibraryData.ts` — the library page's server data: paginated `GET /api/scans` (with a sequence guard against overlapping fetches) + `GET /api/series` membership map, exposing `serverBooks`/`seriesMemberships`/`error`
  - `useLibrarySearch.ts` / `useLibraryGrouping.ts` / `useEditionGrouping.ts` — the library display pipeline: text/filter search → collapse same-work editions into one synthetic card per work (must run downstream of search, so filters match real per-edition fields) → group/sort. `useGroupDimensions.ts` supplies the group-by dimensions incl. custom fields.
  - `useSearchSuggestions.ts` — the library search bar's autocomplete engine (prefix chips, facet-value + title matches, highlight segmentation); reads `useLibrarySearch`'s outputs
  - `useShelfGroups.ts` — turns `useLibraryGrouping`'s output into display-ready shelves (series completeness counts, unowned reveal, collapse/"show all" helpers) consumed by the packed-row layout
  - `useEnrichmentPoll.ts` — polls `GET /api/scans/:id` with backoff while enrichment is `pending`
  - `useBookStatus.ts` / `useOwningStatus.ts` / `useRating.ts` / `useScanStatus.ts` — status/owning/rating config + ordering (locale-reactive)
  - `useToast.ts` — per-page toast state (`visible`/`message`/`type` + `showToast`) bound to `AppToast`
  - `useBarcodeScanner.ts` — Quagga2 live-camera lifecycle (init/start/stop + consecutive-read buffer) for the scanner page
  - `useDetailRoute.ts` (detail dialog state in route query params), `useNavLinks.ts`, `useFocusTrap.ts`
- `src/utils/` — pure helpers: `book-display.ts`, `cover.ts`, `custom-fields.ts`, `language.ts`, `tags.ts`, `search-parse.ts` (search fragment/highlight parsers), `shelf-packing.ts` (grouped-shelf bin-packer `packRows` + shelf/packing types), `offline-queue.ts` (scanner offline-scan localStorage queue). The last three are unit-tested (`test/*.spec.ts`).
- `src/stores/` — Pinia stores:
  - `auth.ts` — JWT + email + firstname in localStorage; exports `WELCOME_SEEN_KEY`
  - `guest.ts` — **guest mode:** unauthenticated users can save up to 3 scans to localStorage; on register/login, `syncToAccount()` migrates them to the user's account server-side
  - `fieldDefs.ts` — the user's custom field definitions + lazily-loaded distinct tag values for autocomplete
  - `libraryDefaults.ts` — user display preferences in localStorage (default view/list vs tile, scan status, page size, etc.)
  - `theme.ts` (dark/light), `accent.ts` (accent color, default `#ff6600`), `locale.ts` (i18n locale)
- `src/types/` — `book.ts` (`Book`, `ReadStatus`, `OwningStatus` — the scan-row shape; extend it when adding API response columns), `library.ts` (`GroupBy`, `SortOption`), `stats.ts` (`CollectionStats`, matching the `GET /api/stats` response shape)
- `src/locales/` — `en.json`, `de.json` — all UI strings; add new languages here
- `src/plugins/i18n.ts` — vue-i18n setup (legacy: false, reads locale from localStorage)
- `src/plugins/vuetify.ts` — Vuetify 4 with `editorial` / `editorial-dark` themes
- `src/styles/tailwind.css` — Tailwind v4 config with custom design tokens
- `src/router/index.ts` — Vue Router guards: authenticated users redirect from `/`, `/login` → `/home`; unauthenticated from `/home`, `/series/:id`, `/welcome` → `/`; `/welcome` also redirects to `/home` if `WELCOME_SEEN_KEY` is set

The Vite dev server proxies `/api/*` to `http://localhost:8787` — the worker must be running locally for API calls to work in dev. In production, the frontend reads `VITE_API_URL` (set in root `wrangler.toml`) and calls the worker directly.

**Frontend data flow:** pages fetch via `useApi().apiFetch` and hold their own page-level state; Pinia stores hold only cross-page state (auth/guest session, field definitions, display preferences, theme/accent/locale). The library page (`index.vue`) runs its book list through the composable pipeline: `useLibrarySearch` (filters like `status:unread` against real per-edition fields) → `useEditionGrouping` (collapses same-work editions into one card) → `useLibraryGrouping` (group + sort) → pagination. After a scan, `useEnrichmentPoll` polls the scan row until `enrichment_status` resolves.

### Worker (`worker/src/`)

Hono on Cloudflare Workers with D1 (SQLite). All routes under `/api/`. `index.ts` is just CORS + route mounting; the routes live in `worker/src/routes/`, one file per resource: `auth.ts` (`/api/auth`), `books.ts` (`/api/books`), `scans.ts` (`/api/scans`), `fields.ts` (`/api/field-definitions`), `catalog.ts` (`/api/works` + `/api/series`), `stats.ts` (`/api/stats`).

**Key modules:**

- `editions.ts` — `resolveEdition` (fetch-or-create a `books` row), `fetchBookMetadata` (Google Books + OpenLibrary merge), `linkWork` (dedup into `works`/`authors`). The central entry point for all ISBN resolution.
- `library-query.ts` — shared `SCAN_SELECT` (the big JOIN), `OVERRIDE_FIELDS`, `SORT_CLAUSES`. Add new columns here when extending the scan response.
- `enrichment.ts` — Wikidata SPARQL pipeline; exports `CURRENT_ENRICHMENT_SCHEMA_VERSION`.
- `sweeper.ts` — cron handler; imported by `index.ts` as the `scheduled` export.
- `auth.ts` — `authMiddleware` (JWT verify, injects `userId`), `signToken` (HS256, 7-day expiry).
- `isbn.ts` — ISBN normalization/validation (`normalizeIsbn`, `isValidIsbn`).
- `rate-limit.ts` — `checkRateLimit` (fixed-window D1 counter) + `rateLimitOrReject` (returns a ready 429 `Response` or null).

**Public routes** (no auth required):

- `POST /api/auth/register` — creates user, returns JWT; migrates any guest scans to account
- `POST /api/auth/login` — returns JWT; migrates any guest scans to account
- `GET /api/books/guest-lookup?isbn=` — metadata lookup for guest mode (same cache-then-fetch as authenticated `/api/books/lookup`, but **skips Wikidata enrichment** to reduce anonymous load)
- `GET /api/books/guest-search?title=` — title search for guest mode (Google Books, no DB writes)

**Protected routes** (require `Authorization: Bearer <jwt>`):

- `PATCH /api/auth/me` — update authenticated user's `firstname`
- `DELETE /api/auth/me` — **delete the account** and all its data; requires the current `password` in the body (re-verified server-side), returns `204`
- `GET /api/books/lookup?isbn=` — DB cache → Google Books → OpenLibrary fallback; caches result in `books` table
- `GET /api/books/search?title=&author=&publisher=` — candidate editions from Google Books; no DB writes (a `books` row is only created when the user picks an edition and it flows through lookup/scan)
- `POST /api/books/refresh?isbn=` — re-fetches metadata, fills only NULL fields (`COALESCE` updates; a `number_of_pages_median` of 0 is treated as NULL — Google Books returns 0 for unknown page counts, and ingestion in `editions.ts` nulls out non-positive counts)
- `PATCH /api/books/override` — write per-user field overrides to `book_overrides`; body `{ isbn, changes: { field: value } }`
- `GET /api/scans` — paginated list (`limit`/`offset`/`sort`); returns merged rows with `*_overridden` boolean flags
- `POST /api/scans` — save a scan by ISBN; resolves book metadata automatically
- `PATCH /api/scans/:id` — update status (`unread` | `reading` | `read` | `dnf`), `owning_status`, and/or `rating` (integer 0-10 or `null` to clear). Server-enforced invariants: a rating can only be set while the effective status is `read` (400 otherwise), and moving off `read` without an explicit rating change silently clears any existing rating.
- `PATCH /api/scans/:id/edition` — switch the scan to a different edition (ISBN) of the same work; status and custom field values follow the scan, per-user metadata overrides are dropped (they corrected the old edition's metadata)
- `DELETE /api/scans/:id` — remove a scan and its associated `book_overrides`

Worker secrets (`wrangler secret put`): `JWT_SECRET`, `GOOGLE_BOOKS_API_KEY`. Local dev uses `worker/.dev.vars`. `CORS_ORIGIN` is **not** a secret — it's a plain `[vars]` entry in `worker/wrangler.toml` (set to `https://bookscan.pages.dev` in production; the code falls back to `*` when unset).

**Authentication:**

- JWT tokens expire after 7 days (no refresh token mechanism; users re-login after expiry)
- Passwords hashed with Web Crypto PBKDF2 (`worker/src/password.ts`, 100k iterations, self-describing `pbkdf2$<iter>$<salt>$<hash>` format); legacy `bcryptjs` hashes still verify and are re-hashed to PBKDF2 on the next successful login (`bcryptjs` stays a dependency until all users have logged in post-migration)
- Auth header format: `Authorization: Bearer <token>`

**Offline/Queue behavior:**

- `POST /api/scans` accepts `isbn` only and always succeeds, even if metadata fetch fails (`allowEmpty: true`) — unless rate-limited (see below)
- Scans remain `enrichment_status: pending` until background enrichment completes or is triggered manually
- Allows users to queue scans offline; metadata resolves asynchronously in the background

**Rate limiting:** `POST /api/scans` is capped at 30 scans/minute per user (`SCAN_RATE_LIMIT` in `routes/scans.ts`) via `checkRateLimit` (`rate-limit.ts`) — a generic fixed-window D1 counter backed by the `rate_limits` table (`key` TEXT, `window_start` ms-epoch bucket, `window_ms` window length, `count`). `key` is caller-defined (e.g. `scan:<userId>`) so the same table can back other rate-limited routes without a migration. Exceeding the limit returns `429` with a `Retry-After` header; a duplicate-scan request (ISBN already in the user's library) is rejected with `409` before the rate limit is even checked, so retrying/rescanning an owned book doesn't burn quota. The following routes are also rate-limited by caller IP (`CF-Connecting-IP`, keyed `<route>:<ip>`): `POST /api/auth/login` (10/min), `POST /api/auth/register` (5 per 10 min), `GET /api/books/guest-lookup` (20/min), `GET /api/books/guest-search` (15/min). Two more are rate-limited per user: `POST /api/books/refresh` (10/min, keyed `refresh:<userId>`) and `POST /api/works/:workId/editions/discover` (20/min, keyed `discover:<userId>`). No other routes are rate-limited today. The cron sweeper prunes `rate_limits` rows once their own window (`window_start + window_ms`) has elapsed, so retention is correct regardless of window size.

### Additional API routes

**Public:**

- `GET /api/books/sample?limit=` — random sample of catalogued books (powers the marketing preview, max 12)

**Protected:**

- `GET /api/scans/:id` — single scan row; used to poll `enrichment_status` after a scan
- `PATCH /api/books/custom-fields` — save custom field values; body `{ isbn, values: [{ field_def_id, value }] }` (replaces all values for that book in one batch)
- `GET /api/field-definitions` — list the user's custom field schema
- `POST /api/field-definitions` — create a field; body `{ name, type? }` (`type`: `text` | `integer` | `select`, defaults to `text`)
- `PATCH /api/field-definitions/:id` — update a field; body `{ name?, type?, required? }`
- `DELETE /api/field-definitions/:id` — remove a field and all its stored values
- `GET /api/field-definitions/:id/values` — distinct tag values used across the user's books for that field (powers tag autocomplete)
- `DELETE /api/field-definitions/:id/values?value=` — remove one tag value from every book the user owns (global tag delete)
- `GET /api/works/:workId/editions` — other editions of the same work; `scan_id` is non-null for editions the user owns
- `POST /api/works/:workId/editions/discover` — user-triggered OpenLibrary edition discovery into `work_edition_isbns` (seed-ISBN path, falling back to the stored `openlibrary_work_id`); only runs when `editions_checked_at` is NULL (a failed OpenLibrary call leaves it retryable), then returns the same edition list as GET plus a `discoveryFailed` flag
- `GET /api/series?locale=` — bulk membership: every entry of every series the user owns ≥1 book in, grouped by series id (powers the library's grouped-by-series shelves without a round-trip per series); "owned" requires `owning_status` `owned` or `lent_out` — `want`/`unowned` don't count
- `GET /api/series/:seriesId?locale=` — series name + all member works with ownership status
- `GET /api/stats` — aggregated library statistics (status counts, top authors, genres, languages, page/year stats); response shape defined in `src/types/stats.ts`

`GET /api/scans` accepts a `locale` query param (default `en`) for localized series names, and `sort` with values: `date_desc` (default), `date_asc`, `title_asc`, `title_desc`, `author_asc`, `author_desc`, `series_asc`.

Each scan row includes: `enrichment_status` (`pending` | `done` | `failed`), `work_id`, `series_id`, `series_name`, `series_ordinal`, `series_total`, `rating` (integer 0-10 | null), `genres`/`awards`/`nominations`/`narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays, parsed via `parseTagArray` in `library-query.ts` — `[]` when absent, never `null`), `original_pub_date` (4-digit year | null), `main_subject`, `form_of_work`, `language_of_work`, `first_line`, `epigraph`, `subtitle` (strings | null), `physical_format`, `edition_name`, `physical_dimensions` (strings | null, from OpenLibrary only), `reference_page_count` (number | null, page count of the work's Wikidata reference edition — the frontend shows it as "≈N" with a tooltip when the edition's own page count is unknown), `custom_field_values` (array of `{ field_def_id, value }`), plus `*_overridden` flags for each overridable field. `author` is never overridable — it's managed through the works/authors model.

### Database schema

Migrations in `worker/migrations/`. The `schema.sql` at root reflects only the initial state — migrations are authoritative.

**Core tables:**

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`

**`books`** — deduplicated edition metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `physical_format`, `edition_name`, `physical_dimensions` (last three from OpenLibrary only; Google Books returns null), `categories` (JSON array, Google Books BISAC categories — used only as a fallback for `works.genres` when Wikidata has none), `fetched_at`, `work_id` → `works`

**`book_overrides`** — per-user field overrides: `user_id` → `users`, `book_id` → `books`, same nullable fields as `books` (except `author` — not overridable), `updated_at`. Unique on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (`unread` | `reading` | `read` | `dnf`), `owning_status` (`owned` | `unowned` | `want` | `lent_out`), `rating` (integer 0-10, nullable — unrated is the default, no `NOT NULL DEFAULT` unlike the other scan-level fields), `created_at`. Unique on `(user_id, book_id)`.

**FRBR-style works/series model** (added in migrations 0009–0011):

**`works`** — one row per logical work (groups editions): `match_key` (normalized `title|primary-author`, dedup key), `wikidata_qid` (set after enrichment), `canonical_title`, `original_language`, `enrichment_status` (`pending` | `done` | `failed` | `exhausted` — the authoritative enrichment state), `next_retry_at` (when a `failed`/`exhausted` work is next due for a sweeper retry; NULL = due immediately; computed at failure time by `scheduleRetry` in `enrichment.ts`), `series_checked_at` (informational: last successful enrichment timestamp), `enrichment_failed_at` (informational: last failure timestamp; dynamic-typed TEXT in a `boolean`-declared column from migration 0010, harmless), `enrichment_failure_reason` (`timeout` | `rate_limited` | `http_5xx` | `network` | `other`, set by `classifyError` in `enrichment.ts`; drives `scheduleRetry`'s per-reason policy), `enrichment_attempts` (failure count; `scheduleRetry` caps retries per reason), `enrichment_schema_version` (INTEGER, DEFAULT 0 — see below), `genres`/`awards`/`nominations` (JSON arrays), `original_pub_date` (year string), `main_subject`, `form_of_work`, `language_of_work`, `language_of_work_code` (ISO 639-1 code via Wikidata P407→P218; stats-only — lets `stats.ts` compare languages by code instead of fragile English-label matching, with the label comparison as a fallback for works the sweeper hasn't backfilled yet), `first_line`, `epigraph`, `subtitle` (strings), `narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays), `openlibrary_work_id` (from Wikidata P648, drives edition discovery), `reference_page_count` (page count of the work's Wikidata reference edition P747→P1104; display-only fallback for editions with unknown page count), `editions_checked_at` (non-NULL = OpenLibrary edition discovery already ran)

**`authors`** — `normalized_name` (UNIQUE dedup key), `name` (display form), `wikidata_qid`

**`work_authors`** — M:N between `works` and `authors`; `ordinal` (INTEGER) preserves credited author order (legacy rows all tie at 0)

**`series`** — `wikidata_qid` (UNIQUE), `canonical_name` (English/fallback)

**`series_names`** — localized series names: `(series_id, language)` PK

**`work_series`** — `(work_id, series_id)` PK, `ordinal` (REAL, supports decimal interludes like 5.5)

**`work_edition_isbns`** (migrations 0018/0020) — candidate ISBNs discovered for a work, decoupled from full metadata: `(work_id, isbn)` PK, plus lightweight display metadata (`title`, `language`, `cover_url`, `publish_date`, `publisher` — nullable, from a single batched OpenLibrary lookup at discovery time) and `source`. A row means "this ISBN is an edition of this work"; the full `books` row is only materialized when the user switches to that edition.

**Custom fields** (migration 0008):

**`user_field_definitions`** — per-user schema: `user_id`, `field_name`, `field_type` (`text`/`integer`/`select`), `field_options`, `sort_order`, `required` (INTEGER 0/1, migration 0013). Unique on `(user_id, field_name)`.

**`book_custom_fields`** — per-user, per-book values: `user_id`, `book_id`, `field_def_id` → `user_field_definitions`, `field_value`. Unique on `(user_id, book_id, field_def_id)`.

`GET /api/scans` JOINs all tables and uses `COALESCE(book_overrides.field, books.field)` for each overridable field. `POST /api/scans` accepts only `isbn`; metadata and work links are resolved server-side (using `allowEmpty` so offline-queued scans always succeed). `DELETE /api/scans/:id` clears the user's `book_overrides` and `book_custom_fields` for that book, then deletes the scan.

### Wikidata enrichment pipeline

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWork(...))` after lookups and scans, and in the background via a cron sweeper (see below). It is intentionally skipped for guest lookups to avoid anonymous SPARQL load.

**Flow:** `enrichWork(db, workId, force?, apiKey?, source?)` (`source` is `scan` | `lookup` | `refresh` | `sweeper` | `unknown`, recorded in `enrichment_runs` for observability — see below) →

- If the work **already has a `wikidata_qid`** (a series-member placeholder, or a force-refresh): skip the search/merge and go straight to `fetchWorkDetails(workQid)`.
- Otherwise: `fetchBookInfo(title, author)` (SPARQL: title+author search → work QID + primary series) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as placeholder works with `wikidata_qid` + `canonical_title`) → `fetchWorkDetails(workQid)`.

Either path then calls `backfillEdition(db, workId, workQid, apiKey)` — for an identified work with no linked edition it resolves a representative ISBN from Wikidata (`P747` editions → `P212`/`P957`, preferring en/de), fetches metadata via `fetchBookMetadata`, and inserts a `books` row with `work_id` set directly. This gives unowned/placeholder works a cover so the series-completeness view renders them. If Wikidata linked an OpenLibrary work id (`P648`), `discoverEditionsFromOpenLibrary` then pre-populates `work_edition_isbns` from OpenLibrary's `works/{olid}/editions.json` (best-effort; only when the work has no candidate editions yet) — this covers works whose owned ISBN is unknown to OpenLibrary, where the user-triggered seed-ISBN discovery (`POST /api/works/:workId/editions/discover`) finds nothing; that route also falls back to the stored `openlibrary_work_id` when its seed-ISBN path comes up empty. Finally it writes genres/pub date/awards/nominations back to `works`.

**Merge logic:** If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints all `books`, `work_authors`, and `work_series` rows from the duplicate onto the canonical row and deletes the duplicate.

**Enrichment state machine:** `works.enrichment_status` is the authoritative state — `pending` (never enriched, or force-refresh in progress), `done` (enriched; a legitimate "not found on Wikidata" is also `done`, queryable via `wikidata_qid IS NULL`), `failed` (last run threw, retryable), `exhausted` (failed past its reason's attempt cap; still retried once per 2-day long cooldown so nothing is stuck forever). Retry scheduling happens **at failure time, in code**: `enrichWork`'s catch block calls `scheduleRetry(reason, attempts, retryAfter?)` (`enrichment.ts`, unit-tested) which applies the per-reason `RETRY_POLICY` (`rate_limited`: 5 min backoff / cap 5; `timeout`: 60 min / cap 3; `other`: 30 min / cap 2 — usually a bug, not transient; `http_5xx`/`network`: 30 min / cap 5), honors a longer Wikidata `Retry-After` hint, and writes `next_retry_at`. The API surface (`GET /api/scans`) maps `exhausted` → `failed` and only ever exposes `pending | done | failed`. In-flight claims use `enrichment_started_at` (atomic claim in `claimWork`, 5-min stale-claim TTL); `force=true` resets status to `pending` after winning the claim so polls see it. `series_checked_at`/`enrichment_failed_at` are informational timestamps only.

**Cron sweeper** (`worker/src/sweeper.ts`, `scheduled` handler exported from `index.ts`, cron `*/5 * * * *` in `wrangler.toml`): each tick enriches a bounded batch (5) from two indexed queries — Q1: `enrichment_status != 'done' AND (next_retry_at IS NULL OR next_retry_at <= now)` (backlog + due retries, pending first), Q2: `enrichment_status = 'done' AND enrichment_schema_version < CURRENT_ENRICHMENT_SCHEMA_VERSION` (already enriched but missing newer Wikidata columns). Q2 is the backfill mechanism: when new columns are added to `works`, bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` (exported from `enrichment.ts`) and all existing enriched works drain through the sweeper automatically; a failed backfill moves the work to `failed`, so it drains through Q1 from then on. Runs sequentially with a short delay to stay polite to Wikidata, then prunes `enrichment_runs` rows older than 30 days. `POST /api/books/refresh` is the manual force-retry path.

**Observability — `enrichment_runs`:** every `enrichWork` call that actually attempts enrichment (not the "already enriched, skip" no-op) writes one row: `work_id`, `started_at`, `duration_ms`, `outcome` (`done` | `not_found` | `failed`), `failure_reason` (set only when `outcome = 'failed'`), `source`. Query it directly for pending/failure-rate/timing stats — there's no dashboard, this is a queryable log table, not a UI feature. Telemetry writes are best-effort (wrapped so a logging failure can't fail the enrichment itself).

**Adding new Wikidata fields:** (1) add `ALTER TABLE works ADD COLUMN` in a new migration, (2) bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` in `enrichment.ts`, (3) add the SPARQL subquery + `WorkDetails` field + `UPDATE works SET` binding, (4) add to `SCAN_SELECT` in `library-query.ts`, (5) JSON-parse in `attachCustomFields` if it's an array.

## Common Development Flows

**User scans a book:**

1. Frontend calls `POST /api/scans` with ISBN
2. Worker calls `resolveEdition()` → `fetchBookMetadata()` (Google Books → OpenLibrary fallback) → inserts/updates `books` row
3. Worker calls `enrichWork()` asynchronously (does not block response)
4. Frontend receives scan row with `enrichment_status: pending`
5. Cron sweeper (`*/5 * * * *`) or manual `POST /api/books/refresh` triggers enrichment pipeline
6. Wikidata data populates `works` table; series members become placeholder works with covers

**User overrides a book field (e.g., title):**

1. Frontend calls `PATCH /api/books/override` with `{ isbn, changes: { title: "..." } }`
2. Worker upserts `book_overrides` row
3. Subsequent `GET /api/scans` uses `COALESCE(book_overrides.field, books.field)` to merge overrides

**Add a new column to the API response:**

1. If it's a Wikidata field: follow "Adding new Wikidata fields" (5-step process in enrichment section)
2. If it's a new book metadata field: (1) add `ALTER TABLE books ADD COLUMN` migration, (2) add to `SCAN_SELECT` in `library-query.ts`, (3) update the `Book` type in `src/types/book.ts`
3. If it's a custom field: use the existing `user_field_definitions` + `book_custom_fields` schema (already query-merged in `SCAN_SELECT`)

### Styling system

Primary language is TypeScript; preserve strict typing and prefer minimal, clean code (simplify where reasonable when refactoring).

Tailwind for layout/spacing, Vuetify components for interactive elements. Do not mix — use Tailwind classes on plain HTML, Vuetify props on `<v-*>` components.

**Tailwind tokens** (defined in `src/styles/tailwind.css`, theme-aware via CSS variables):

- Colors: `bg-charcoal`, `bg-charcoal-light`, `border-charcoal-border`, `text-orange-neon`, `text-text-primary`, `text-text-secondary`
- Fonts: `font-heading` (Playfair Display), `font-body` (Roboto), `font-mono` (Roboto Mono)
- Semantic Vuetify colors aliased: `bg-primary`, `bg-success`, `bg-error`, etc.

**Breakpoints** (identical in Tailwind and Vuetify): `sm` 600px / `md` 840px / `lg` 1145px / `xl` 1545px — `md` is the mobile/desktop threshold.

**Vuetify theme colors** (use via `:color` prop):

- `editorial` (light): `primary` #ff6600, `success` #276749, `warning` #d97706, `error` #c0392b
- `editorial-dark` (dark): `primary` #ff6600, `success` #4caf80, `warning` #e8a838, `error` #e05252

### i18n

All user-visible strings must go through `$t()` / `t()`. Add new strings to both `src/locales/en.json` and `src/locales/de.json`. The `useLocaleStore` store handles locale persistence and updates `i18n.global.locale` reactively. Status/owning/rating label config lives in `computed`s (`STATUS_CONFIG` in `BookDetail`, `useBookStatus`/`useOwningStatus` composables) so labels update on locale change — follow that pattern for any new locale-dependent config object.

## Versioning

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` — new feature → minor version bump
- `fix: ...` — bug fix → patch bump
- `feat!:` / `fix!:` — breaking change → major bump
- `chore:`, `docs:`, `refactor:` — no release

[release-please](.github/workflows/release-please.yml) watches `main` and auto-opens a Release PR that updates `CHANGELOG.md` and `package.json`. Merge that PR when ready to publish a GitHub Release.

## Verification

Always run type-checks and lint after code edits and verify they pass before considering a task complete:

```bash
npm run type-check
npm run lint
npm test                # if you touched frontend pure-logic helpers covered by root test/*.spec.ts
cd worker && npm test   # if you touched worker pure-logic functions covered by worker/test/*.spec.ts
```

This applies to code review as well: a `/code-review` pass (and any fixes applied from one) isn't done until these commands have actually been run and shown to pass — don't stop at static-analysis findings.

## Troubleshooting

**API calls fail or return 404 in dev:**

- Ensure both dev servers are running: `npm run dev` (frontend) + `npm run dev:worker` (worker) in separate terminals
- Check that worker is on `:8787` and frontend is proxying `/api/*` to it (see vite.config.ts)

**Enrichment stuck on `pending` status:**

- Cron sweeper runs every 5 minutes (check `wrangler.toml` for `*/5 * * * *`)
- Check wrangler dev logs for SPARQL errors or timeouts
- Manual retry: `POST /api/books/refresh?isbn=<isbn>`

**Type-check fails after pulling changes:**

- Run with `--force`: `npm run type-check -- --force`
- Clear build cache: `rm -rf dist/ && npm run type-check`

**Guest scans not migrating on login:**

- Check `localStorage` for `guest_scans` key in browser DevTools
- Ensure `guest.ts` `syncToAccount()` is called after successful login/register
- Check server logs for migration errors

**Worker not deploying:**

- Check the GitHub Actions **Deploy** workflow run for the failing step (verify, migrations, or `wrangler deploy`)
- Ensure the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets are set
- Ensure D1 database binding exists in `worker/wrangler.toml`
- For manual deploys: `npm run deploy:worker` prompts if wrangler secrets are missing

**D1 migrations not applied:**

- Local: run manually during dev (`npx wrangler d1 migrations apply bookscan --local`)
- Production: applied automatically by the Deploy workflow before `wrangler deploy`; after a **manual** deploy, run `npx wrangler d1 migrations apply bookscan --remote` yourself
- Check migration status: `npx wrangler d1 info bookscan`
