# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

Two separate deployments:

- **Frontend**: Cloudflare Pages — static Vite build, deployed automatically on push to `main`
- **Worker**: Cloudflare Worker (`bookscan-worker`) — deployed manually via `wrangler deploy`

Pushing to GitHub only redeploys the frontend. The worker must be manually deployed after any changes to `worker/`.

### Frontend (`src/`)
Vue 3 + TypeScript + Vite.

- `src/pages/` — route-level components:
  - `landing.vue` — unauthenticated marketing page (`/`)
  - `home.vue` — authenticated dashboard: stats, greeting, recently-added (`/home`)
  - `index.vue` — full paginated library (`/library`)
  - `login.vue`, `scanner.vue`, `privacy.vue`, `NotFound.vue`
- `src/components/` — `AppHeader`, `AppFooter`, `AppToast`, `BookCard`, `BookDetail`
- `src/stores/` — Pinia stores:
  - `auth.ts` — JWT + email + firstname in localStorage
  - `guest.ts` — up to 3 scans for unauthenticated users stored in localStorage; `syncToAccount()` migrates them on register/login
  - `theme.ts` (dark/light), `locale.ts` (i18n locale)
- `src/locales/` — `en.json`, `de.json` — all UI strings; add new languages here
- `src/plugins/i18n.ts` — vue-i18n setup (legacy: false, reads locale from localStorage)
- `src/plugins/vuetify.ts` — Vuetify 4 with `editorial` / `editorial-dark` themes
- `src/styles/tailwind.css` — Tailwind v4 config with custom design tokens
- `src/router/index.ts` — Vue Router; authenticated users are redirected from `/` and `/login` → `/home`; unauthenticated users are redirected from `/home` → `/`

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

`GET /api/scans` accepts a `locale` query param (default `en`) for localized series names, and `sort` with values: `date_desc` (default), `date_asc`, `title_asc`, `title_desc`, `author_asc`, `author_desc`, `series_asc`.

Each scan row includes: `enrichment_status` (`pending` | `done` | `failed`), `work_id`, `series_id`, `series_name`, `series_ordinal`, `series_total`, `genres` (JSON array | null), `original_pub_date` (4-digit year | null), `awards` (JSON array | null), `nominations` (JSON array | null), `custom_field_values` (array of `{ field_def_id, value }`), plus the existing `*_overridden` flags. `author` is never overridable — it's managed through the works/authors model.

### Database schema
Migrations in `worker/migrations/`. The `schema.sql` at root reflects only the initial state — migrations are authoritative.

**Core tables:**

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`

**`books`** — deduplicated edition metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `fetched_at`, `work_id` → `works`

**`book_overrides`** — per-user field overrides: `user_id` → `users`, `book_id` → `books`, same nullable fields as `books` (except `author` — not overridable), `updated_at`. Unique on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (`unread` | `reading` | `read`), `created_at`. Unique on `(user_id, book_id)`.

**FRBR-style works/series model** (added in migrations 0009–0011):

**`works`** — one row per logical work (groups editions): `match_key` (normalized `title|primary-author`, dedup key), `wikidata_qid` (set after enrichment), `canonical_title`, `original_language`, `series_checked_at` (NULL = not yet enriched, acts as negative cache), `enrichment_failed_at`, `genres` (JSON), `original_pub_date` (year string), `awards` (JSON), `nominations` (JSON)

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

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWork(...))` after lookups and scans. It is intentionally skipped for guest lookups to avoid anonymous SPARQL load.

**Flow:** `enrichWork(db, workId)` → `fetchBookInfo(title, author)` (SPARQL: title+author search → work QID + primary series) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as placeholder works with `wikidata_qid`) → `fetchWorkDetails(workQid)` (genres, original pub date, awards, nominations) → writes back to `works`.

**Merge logic:** If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints all `books`, `work_authors`, and `work_series` rows from the duplicate onto the canonical row and deletes the duplicate.

**Negative caching:** `series_checked_at` non-NULL means the work was already enriched (success or "not found"). `enrichment_failed_at` non-NULL means the last SPARQL run threw (network/timeout); these can be retried via `POST /api/books/refresh`. `force=true` clears `series_checked_at` to re-run even for already-enriched works.

There is no cron sweeper — the only retry path is the user manually triggering `POST /api/books/refresh`.

### Styling system

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
