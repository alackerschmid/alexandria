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

Worker secrets (`wrangler secret put`): `JWT_SECRET`, `GOOGLE_BOOKS_API_KEY`. Local dev uses `worker/.dev.vars`.

### Database schema
Migrations in `worker/migrations/`. Full schema in `worker/schema.sql`.

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`

**`books`** — deduplicated book metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `fetched_at`

**`book_overrides`** — per-user field overrides for book metadata: `id`, `user_id` → `users`, `book_id` → `books`, same nullable fields as `books`, `updated_at`. Unique constraint on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (default `unread`), `created_at`. Unique constraint on `(user_id, book_id)`.

`GET /api/scans` JOINs all four tables: each field in the response is `COALESCE(book_overrides.field, books.field)`, and a `*_overridden` boolean flag is included per field. `POST /api/scans` accepts only `isbn`; book metadata is resolved server-side. `DELETE /api/scans/:id` cascades to delete the user's `book_overrides` row for that book.

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
