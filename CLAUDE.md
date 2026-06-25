# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet. 

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I'm always open to ideas on better ways to do things. Please don't hesitate to suggest a better way, or one that has long lasting impact over a tactical change. If what we are trying to do is similar to settled science or industry practice, let me know. We don’t have to reinvent the wheel. 

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

## Architecture

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
  - `guest.ts` — up to 3 scans for unauthenticated users stored in localStorage; `syncToAccount()` migrates them on register/login
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

**Public routes** (no auth required):

- `POST /api/auth/register` — creates user, returns JWT
- `POST /api/auth/login` — returns JWT
- `GET /api/books/guest-lookup?isbn=` — same cache-then-fetch lookup as `/api/books/lookup`, but unauthenticated (for guest mode)

**Protected routes** (require `Authorization: Bearer <jwt>`):

- `PATCH /api/auth/me` — update authenticated user's `firstname`
- `GET /api/books/lookup?isbn=` — DB cache → Google Books → OpenLibrary fallback; caches result in `books` table
- `POST /api/books/refresh?isbn=` — re-fetches metadata, fills only NULL fields (`COALESCE` updates)
- `PATCH /api/books/override` — write per-user field overrides to `book_overrides`; body `{ isbn, changes: { field: value } }`
- `GET /api/scans` — paginated list (`limit`/`offset`/`sort`); returns merged rows with `*_overridden` boolean flags
- `POST /api/scans` — save a scan by ISBN; resolves book metadata automatically
- `PATCH /api/scans/:id` — update status (`unread` | `reading` | `read`)
- `DELETE /api/scans/:id` — remove a scan and its associated `book_overrides`

Worker secrets (`wrangler secret put`): `JWT_SECRET`, `GOOGLE_BOOKS_API_KEY`. Optional: `CORS_ORIGIN` (defaults to `*`). Local dev uses `worker/.dev.vars`.

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

Each scan row includes: `enrichment_status` (`pending` | `done` | `failed`), `work_id`, `series_id`, `series_name`, `series_ordinal`, `series_total`, `genres`/`awards`/`nominations` (JSON arrays | null), `original_pub_date` (4-digit year | null), `main_subject`, `form_of_work`, `language_of_work`, `first_line`, `epigraph` (strings | null), `narrative_locations`/`countries_of_origin` (JSON arrays | null), `physical_format`, `edition_name`, `physical_dimensions` (strings | null, from OpenLibrary only), `custom_field_values` (array of `{ field_def_id, value }`), plus `*_overridden` flags for each overridable field. `author` is never overridable — it's managed through the works/authors model.

### Database schema
Migrations in `worker/migrations/`. The `schema.sql` at root reflects only the initial state — migrations are authoritative.

**Core tables:**

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`

**`books`** — deduplicated edition metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `physical_format`, `edition_name`, `physical_dimensions` (last three from OpenLibrary only; Google Books returns null), `fetched_at`, `work_id` → `works`

**`book_overrides`** — per-user field overrides: `user_id` → `users`, `book_id` → `books`, same nullable fields as `books` (except `author` — not overridable), `updated_at`. Unique on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (`unread` | `reading` | `read`), `created_at`. Unique on `(user_id, book_id)`.

**FRBR-style works/series model** (added in migrations 0009–0011):

**`works`** — one row per logical work (groups editions): `match_key` (normalized `title|primary-author`, dedup key), `wikidata_qid` (set after enrichment), `canonical_title`, `original_language`, `series_checked_at` (NULL = not yet enriched, acts as negative cache), `enrichment_failed_at`, `enrichment_attempts` (failure count, caps cron-sweeper retries), `enrichment_schema_version` (INTEGER, DEFAULT 0 — see below), `genres`/`awards`/`nominations` (JSON arrays), `original_pub_date` (year string), `main_subject`, `form_of_work`, `language_of_work`, `first_line`, `epigraph` (strings), `narrative_locations`/`countries_of_origin` (JSON arrays)

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

**Flow:** `enrichWork(db, workId, force?, apiKey?)` →
- If the work **already has a `wikidata_qid`** (a series-member placeholder, or a force-refresh): skip the search/merge and go straight to `fetchWorkDetails(workQid)`.
- Otherwise: `fetchBookInfo(title, author)` (SPARQL: title+author search → work QID + primary series) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as placeholder works with `wikidata_qid` + `canonical_title`) → `fetchWorkDetails(workQid)`.

Either path then calls `backfillEdition(db, workId, workQid, apiKey)` — for an identified work with no linked edition it resolves a representative ISBN from Wikidata (`P747` editions → `P212`/`P957`, preferring en/de), fetches metadata via `fetchBookMetadata`, and inserts a `books` row with `work_id` set directly. This gives unowned/placeholder works a cover so the series-completeness view renders them. Finally it writes genres/pub date/awards/nominations back to `works`.

**Merge logic:** If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints all `books`, `work_authors`, and `work_series` rows from the duplicate onto the canonical row and deletes the duplicate.

**Negative caching:** `series_checked_at` non-NULL means the work was already enriched (success or "not found"). `enrichment_failed_at` non-NULL means the last SPARQL run threw (network/timeout); `enrichment_attempts` counts failures. `force=true` clears `series_checked_at` to re-run even for already-enriched works.

**Cron sweeper** (`worker/src/sweeper.ts`, `scheduled` handler exported from `index.ts`, cron `*/2 * * * *` in `wrangler.toml`): each tick enriches a bounded batch (5) of works matching either condition — `series_checked_at IS NULL` (never enriched), failed works with backoff (`enrichment_failed_at` older than 30 min, capped at `enrichment_attempts < 5`), or `enrichment_schema_version < CURRENT_ENRICHMENT_SCHEMA_VERSION` (already enriched but missing newer Wikidata columns). The last condition is the backfill mechanism: when new columns are added to `works`, bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` (exported from `enrichment.ts`) and all existing enriched works drain through the sweeper automatically. Runs sequentially with a short delay to stay polite to Wikidata. `POST /api/books/refresh` is the manual force-retry path.

**Adding new Wikidata fields:** (1) add `ALTER TABLE works ADD COLUMN` in a new migration, (2) bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` in `enrichment.ts`, (3) add the SPARQL subquery + `WorkDetails` field + `UPDATE works SET` binding, (4) add to `SCAN_SELECT` in `library-query.ts`, (5) JSON-parse in `attachCustomFields` if it's an array.

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

## Verification
Always run type-checks after code edits and verify they pass before considering a task complete.