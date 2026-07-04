# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet. 

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I’m always open to ideas on better ways to do things. Please don’t hesitate to suggest a better way, or one that has long lasting impact over a tactical change. If what we are trying to do is similar to settled science or industry practice, let me know. We don’t have to reinvent the wheel. 

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
cd worker && npm test       # Vitest — pure-logic unit tests (isbn, library-query, editions, enrichment, auth)
```

Note: The worker has unit tests (`worker/test/*.spec.ts`, `vitest run`) covering pure logic only — no D1/miniflare, so anything requiring a DB is untested (deliberate scope decision). The frontend has no test suite; type-checking is its primary verification mechanism.

## Architecture

Two `wrangler.toml` files — root (`wrangler.toml`) configures Cloudflare Pages and sets `VITE_API_URL` at build time; `worker/wrangler.toml` configures the Worker (D1 binding, cron, observability, `CORS_ORIGIN`).

Two separate deployments, both triggered by pushing to `main`:

- **Frontend**: Cloudflare Pages — static Vite build, deployed automatically on push to `main`
- **Worker**: Cloudflare Worker (`bookscan-worker`) — deployed automatically on push to `main` via Cloudflare's Git integration (Workers Builds). `npm run deploy:worker` (`wrangler deploy`) remains available for manual/out-of-band deploys.

Pushing to GitHub redeploys both the frontend and the worker. Note: deploys do **not** run D1 migrations — apply those manually with `npx wrangler d1 migrations apply bookscan --remote` (see below).

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
- `src/components/` — `AppHeader`, `AppFooter`, `AppToast`, `BookCard`, `BookDetail`
- `src/stores/` — Pinia stores:
  - `auth.ts` — JWT + email + firstname in localStorage; exports `WELCOME_SEEN_KEY`
  - `guest.ts` — **guest mode:** unauthenticated users can save up to 3 scans to localStorage; on register/login, `syncToAccount()` migrates them to the user's account server-side
  - `theme.ts` (dark/light), `locale.ts` (i18n locale)
- `src/types/stats.ts` — `CollectionStats` interface matching the `GET /api/stats` response shape
- `src/locales/` — `en.json`, `de.json` — all UI strings; add new languages here
- `src/plugins/i18n.ts` — vue-i18n setup (legacy: false, reads locale from localStorage)
- `src/plugins/vuetify.ts` — Vuetify 4 with `editorial` / `editorial-dark` themes
- `src/styles/tailwind.css` — Tailwind v4 config with custom design tokens
- `src/router/index.ts` — Vue Router guards: authenticated users redirect from `/`, `/login` → `/home`; unauthenticated from `/home`, `/series/:id`, `/welcome` → `/`; `/welcome` also redirects to `/home` if `WELCOME_SEEN_KEY` is set

The Vite dev server proxies `/api/*` to `http://localhost:8787` — the worker must be running locally for API calls to work in dev. In production, the frontend reads `VITE_API_URL` (set in root `wrangler.toml`) and calls the worker directly.

### Worker (`worker/src/index.ts`)
Hono on Cloudflare Workers with D1 (SQLite). All routes under `/api/`.

**Key modules:**
- `editions.ts` — `resolveEdition` (fetch-or-create a `books` row), `fetchBookMetadata` (Google Books + OpenLibrary merge), `linkWork` (dedup into `works`/`authors`). The central entry point for all ISBN resolution.
- `library-query.ts` — shared `SCAN_SELECT` (the big JOIN), `OVERRIDE_FIELDS`, `SORT_CLAUSES`. Add new columns here when extending the scan response.
- `enrichment.ts` — Wikidata SPARQL pipeline; exports `CURRENT_ENRICHMENT_SCHEMA_VERSION`.
- `sweeper.ts` — cron handler; imported by `index.ts` as the `scheduled` export.
- `auth.ts` — `authMiddleware` (JWT verify, injects `userId`), `signToken` (HS256, 7-day expiry).

**Public routes** (no auth required):

- `POST /api/auth/register` — creates user, returns JWT; migrates any guest scans to account
- `POST /api/auth/login` — returns JWT; migrates any guest scans to account
- `GET /api/books/guest-lookup?isbn=` — metadata lookup for guest mode (same cache-then-fetch as authenticated `/api/books/lookup`, but **skips Wikidata enrichment** to reduce anonymous load)

**Protected routes** (require `Authorization: Bearer <jwt>`):

- `PATCH /api/auth/me` — update authenticated user's `firstname`
- `GET /api/books/lookup?isbn=` — DB cache → Google Books → OpenLibrary fallback; caches result in `books` table
- `POST /api/books/refresh?isbn=` — re-fetches metadata, fills only NULL fields (`COALESCE` updates; a `number_of_pages_median` of 0 is treated as NULL — Google Books returns 0 for unknown page counts, and ingestion in `editions.ts` nulls out non-positive counts)
- `PATCH /api/books/override` — write per-user field overrides to `book_overrides`; body `{ isbn, changes: { field: value } }`
- `GET /api/scans` — paginated list (`limit`/`offset`/`sort`); returns merged rows with `*_overridden` boolean flags
- `POST /api/scans` — save a scan by ISBN; resolves book metadata automatically
- `PATCH /api/scans/:id` — update status (`unread` | `reading` | `read` | `dnf`)
- `DELETE /api/scans/:id` — remove a scan and its associated `book_overrides`

Worker secrets (`wrangler secret put`): `JWT_SECRET`, `GOOGLE_BOOKS_API_KEY`. Optional: `CORS_ORIGIN` (defaults to `*`). Local dev uses `worker/.dev.vars`.

**Authentication:**
- JWT tokens expire after 7 days (no refresh token mechanism; users re-login after expiry)
- Passwords hashed with `bcryptjs`
- Auth header format: `Authorization: Bearer <token>`

**Offline/Queue behavior:**
- `POST /api/scans` accepts `isbn` only and always succeeds, even if metadata fetch fails (`allowEmpty: true`) — unless rate-limited (see below)
- Scans remain `enrichment_status: pending` until background enrichment completes or is triggered manually
- Allows users to queue scans offline; metadata resolves asynchronously in the background

**Rate limiting:** `POST /api/scans` is capped at 30 scans/minute per user (`SCAN_RATE_LIMIT` in `routes/scans.ts`) via `checkRateLimit` (`rate-limit.ts`) — a generic fixed-window D1 counter backed by the `rate_limits` table (`key` TEXT, `window_start` ms-epoch bucket, `window_ms` window length, `count`). `key` is caller-defined (e.g. `scan:<userId>`) so the same table can back other rate-limited routes without a migration. Exceeding the limit returns `429` with a `Retry-After` header; a duplicate-scan request (ISBN already in the user's library) is rejected with `409` before the rate limit is even checked, so retrying/rescanning an owned book doesn't burn quota. The following routes are also rate-limited by caller IP (`CF-Connecting-IP`, keyed `<route>:<ip>`): `POST /api/auth/login` (10/min), `POST /api/auth/register` (5 per 10 min), `GET /api/books/guest-lookup` (20/min), `GET /api/books/guest-search` (15/min). No other routes are rate-limited today. The cron sweeper prunes `rate_limits` rows once their own window (`window_start + window_ms`) has elapsed, so retention is correct regardless of window size.

### Additional API routes

**Public:**
- `GET /api/books/sample?limit=` — random sample of catalogued books (powers the marketing preview, max 12)

**Protected:**
- `GET /api/scans/:id` — single scan row; used to poll `enrichment_status` after a scan
- `PATCH /api/books/custom-fields` — save custom field values; body `{ isbn, values: [{ field_def_id, value }] }` (replaces all values for that book in one batch)
- `GET /api/field-definitions` — list the user's custom field schema
- `POST /api/field-definitions` — create a field; body `{ name, type }` (`type`: `text` | `integer` | `select`)
- `DELETE /api/field-definitions/:id` — remove a field and all its stored values
- `GET /api/works/:workId/editions` — other editions of the same work; `scan_id` is non-null for editions the user owns
- `GET /api/series/:seriesId?locale=` — series name + all member works with ownership status
- `GET /api/stats` — aggregated library statistics (status counts, top authors, genres, languages, page/year stats); response shape defined in `src/types/stats.ts`

`GET /api/scans` accepts a `locale` query param (default `en`) for localized series names, and `sort` with values: `date_desc` (default), `date_asc`, `title_asc`, `title_desc`, `author_asc`, `author_desc`, `series_asc`.

Each scan row includes: `enrichment_status` (`pending` | `done` | `failed`), `work_id`, `series_id`, `series_name`, `series_ordinal`, `series_total`, `genres`/`awards`/`nominations`/`narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays, parsed via `parseTagArray` in `library-query.ts` — `[]` when absent, never `null`), `original_pub_date` (4-digit year | null), `main_subject`, `form_of_work`, `language_of_work`, `first_line`, `epigraph`, `subtitle` (strings | null), `physical_format`, `edition_name`, `physical_dimensions` (strings | null, from OpenLibrary only), `reference_page_count` (number | null, page count of the work's Wikidata reference edition — the frontend shows it as "≈N" with a tooltip when the edition's own page count is unknown), `custom_field_values` (array of `{ field_def_id, value }`), plus `*_overridden` flags for each overridable field. `author` is never overridable — it's managed through the works/authors model.

### Database schema
Migrations in `worker/migrations/`. The `schema.sql` at root reflects only the initial state — migrations are authoritative.

**Core tables:**

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`

**`books`** — deduplicated edition metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `physical_format`, `edition_name`, `physical_dimensions` (last three from OpenLibrary only; Google Books returns null), `categories` (JSON array, Google Books BISAC categories — used only as a fallback for `works.genres` when Wikidata has none), `fetched_at`, `work_id` → `works`

**`book_overrides`** — per-user field overrides: `user_id` → `users`, `book_id` → `books`, same nullable fields as `books` (except `author` — not overridable), `updated_at`. Unique on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (`unread` | `reading` | `read`), `created_at`. Unique on `(user_id, book_id)`.

**FRBR-style works/series model** (added in migrations 0009–0011):

**`works`** — one row per logical work (groups editions): `match_key` (normalized `title|primary-author`, dedup key), `wikidata_qid` (set after enrichment), `canonical_title`, `original_language`, `series_checked_at` (NULL = not yet enriched, acts as negative cache), `enrichment_failed_at` (TEXT timestamp string despite the column's `boolean` type in migration 0010 — SQLite's dynamic typing makes this harmless), `enrichment_failure_reason` (`timeout` | `rate_limited` | `http_5xx` | `network` | `other`, set by `classifyError` in `enrichment.ts`; drives the sweeper's per-reason retry backoff), `enrichment_attempts` (failure count, caps cron-sweeper retries), `enrichment_schema_version` (INTEGER, DEFAULT 0 — see below), `genres`/`awards`/`nominations` (JSON arrays), `original_pub_date` (year string), `main_subject`, `form_of_work`, `language_of_work`, `language_of_work_code` (ISO 639-1 code via Wikidata P407→P218; stats-only — lets `stats.ts` compare languages by code instead of fragile English-label matching, with the label comparison as a fallback for works the sweeper hasn't backfilled yet), `first_line`, `epigraph`, `subtitle` (strings), `narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays), `openlibrary_work_id` (from Wikidata P648, drives edition discovery), `reference_page_count` (page count of the work's Wikidata reference edition P747→P1104; display-only fallback for editions with unknown page count), `editions_checked_at` (non-NULL = OpenLibrary edition discovery already ran)

**`authors`** — `normalized_name` (UNIQUE dedup key), `name` (display form), `wikidata_qid`

**`work_authors`** — M:N between `works` and `authors`

**`series`** — `wikidata_qid` (UNIQUE), `canonical_name` (English/fallback)

**`series_names`** — localized series names: `(series_id, language)` PK

**`work_series`** — `(work_id, series_id)` PK, `ordinal` (REAL, supports decimal interludes like 5.5)

**Custom fields** (migration 0008):

**`user_field_definitions`** — per-user schema: `user_id`, `field_name`, `field_type` (`text`/`integer`/`select`), `field_options`, `sort_order`. Unique on `(user_id, field_name)`.

**`book_custom_fields`** — per-user, per-book values: `user_id`, `book_id`, `field_def_id` → `user_field_definitions`, `field_value`. Unique on `(user_id, book_id, field_def_id)`.

`GET /api/scans` JOINs all tables and uses `COALESCE(book_overrides.field, books.field)` for each overridable field. `POST /api/scans` accepts only `isbn`; metadata and work links are resolved server-side (using `allowEmpty` so offline-queued scans always succeed). `DELETE /api/scans/:id` clears the user's `book_overrides` and `book_custom_fields` for that book, then deletes the scan.

### Wikidata enrichment pipeline

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWork(...))` after lookups and scans, and in the background via a cron sweeper (see below). It is intentionally skipped for guest lookups to avoid anonymous SPARQL load.

**Flow:** `enrichWork(db, workId, force?, apiKey?, source?)` (`source` is `scan` | `lookup` | `refresh` | `sweeper` | `unknown`, recorded in `enrichment_runs` for observability — see below) →
- If the work **already has a `wikidata_qid`** (a series-member placeholder, or a force-refresh): skip the search/merge and go straight to `fetchWorkDetails(workQid)`.
- Otherwise: `fetchBookInfo(title, author)` (SPARQL: title+author search → work QID + primary series) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as placeholder works with `wikidata_qid` + `canonical_title`) → `fetchWorkDetails(workQid)`.

Either path then calls `backfillEdition(db, workId, workQid, apiKey)` — for an identified work with no linked edition it resolves a representative ISBN from Wikidata (`P747` editions → `P212`/`P957`, preferring en/de), fetches metadata via `fetchBookMetadata`, and inserts a `books` row with `work_id` set directly. This gives unowned/placeholder works a cover so the series-completeness view renders them. If Wikidata linked an OpenLibrary work id (`P648`), `discoverEditionsFromOpenLibrary` then pre-populates `work_edition_isbns` from OpenLibrary's `works/{olid}/editions.json` (best-effort; only when the work has no candidate editions yet) — this covers works whose owned ISBN is unknown to OpenLibrary, where the user-triggered seed-ISBN discovery (`POST /api/works/:workId/editions/discover`) finds nothing; that route also falls back to the stored `openlibrary_work_id` when its seed-ISBN path comes up empty. Finally it writes genres/pub date/awards/nominations back to `works`.

**Merge logic:** If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints all `books`, `work_authors`, and `work_series` rows from the duplicate onto the canonical row and deletes the duplicate.

**Negative caching:** `series_checked_at` non-NULL means the work was already enriched (success or "not found"). `enrichment_failed_at` non-NULL means the last SPARQL run threw (network/timeout); `enrichment_failure_reason` classifies why (`timeout` | `rate_limited` | `http_5xx` | `network` | `other`, via `classifyError`/`SparqlError` in `enrichment.ts`); `enrichment_attempts` counts failures. `force=true` clears `series_checked_at` to re-run even for already-enriched works.

**Cron sweeper** (`worker/src/sweeper.ts`, `scheduled` handler exported from `index.ts`, cron `*/5 * * * *` in `wrangler.toml`): each tick enriches a bounded batch (5) of works matching either condition — `series_checked_at IS NULL` (never enriched), failed works past a **per-reason backoff** (`rate_limited`: 5 min backoff, cap 5 attempts; `timeout`: 60 min backoff, cap 3 attempts; `other`: 30 min backoff, cap 2 attempts — usually a bug, not transient; everything else including legacy NULL-reason rows: 30 min backoff, cap 5 attempts), or `enrichment_schema_version < CURRENT_ENRICHMENT_SCHEMA_VERSION` (already enriched but missing newer Wikidata columns). The last condition is the backfill mechanism: when new columns are added to `works`, bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` (exported from `enrichment.ts`) and all existing enriched works drain through the sweeper automatically. Runs sequentially with a short delay to stay polite to Wikidata, then prunes `enrichment_runs` rows older than 30 days. `POST /api/books/refresh` is the manual force-retry path.

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
2. If it's a new book metadata field: (1) add `ALTER TABLE books ADD COLUMN` migration, (2) add to `SCAN_SELECT` in `library-query.ts`, (3) update frontend `BookDetail` type
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
All user-visible strings must go through `$t()` / `t()`. Add new strings to both `src/locales/en.json` and `src/locales/de.json`. The `useLocaleStore` store handles locale persistence and updates `i18n.global.locale` reactively. `STATUS_CONFIG` objects in `BookCard` and `BookDetail` are `computed` so labels update on locale change.

## Versioning

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat: ...` — new feature → minor version bump
- `fix: ...` — bug fix → patch bump
- `feat!:` / `fix!:` — breaking change → major bump
- `chore:`, `docs:`, `refactor:` — no release

[release-please](.github/workflows/release-please.yml) watches `main` and auto-opens a Release PR that updates `CHANGELOG.md` and `package.json`. Merge that PR when ready to publish a GitHub Release.

## Verification
Always run type-checks after code edits and verify they pass before considering a task complete:
```bash
npm run type-check
cd worker && npm test   # if you touched worker pure-logic functions covered by worker/test/*.spec.ts
```

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
- Verify `wrangler.toml` secrets are set: `npm run deploy:worker` prompts if missing
- Check Cloudflare Workers dashboard for build errors
- Ensure D1 database binding exists in `worker/wrangler.toml`

**D1 migrations not applied:**
- Local: run manually during dev (`npx wrangler d1 migrations apply bookscan --local`)
- Production: **not automatic** — run `npx wrangler d1 migrations apply bookscan --remote` after deploy
- Check migration status: `npx wrangler d1 info bookscan`