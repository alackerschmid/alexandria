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
npm run dev:worker   # wrangler dev (local worker on :8787)
npm run deploy:worker  # wrangler deploy to production
# Or from worker/ directly:
cd worker && npm run dev
cd worker && npm run deploy
```

### Database migrations
```bash
# Local D1 (during wrangler dev)
cd worker && wrangler d1 migrations apply bookscan --local
# Production D1
cd worker && wrangler d1 migrations apply bookscan --remote
```

## Architecture

Two separate deployments:
- **Frontend**: Cloudflare Pages (static Vite build, deployed via Git push to main)
- **Worker**: Cloudflare Worker (`bookscan-worker`), deployed separately via `wrangler deploy`

These are independent — pushing to GitHub only redeploys the frontend. The worker must be manually deployed with `wrangler deploy` after any changes to `worker/`.

### Frontend (`src/`)
Vue 3 + TypeScript + Vite. Key structure:
- `src/pages/` — route-level components (index, login, scanner, privacy, NotFound)
- `src/components/` — AppHeader, AppFooter, AppToast, BookCard
- `src/stores/` — Pinia stores: `auth.ts` (JWT token + email in localStorage), `app.ts`, `theme.ts`
- `src/router/index.ts` — Vue Router with `requiresAuth` meta guard; redirects to `/login` if unauthenticated
- `src/plugins/vuetify.ts` — Vuetify 4 with custom `editorial` / `editorial-dark` themes
- `src/styles/tailwind.css` — Tailwind v4 config with custom design tokens

The Vite dev server proxies `GET/POST/etc /api/*` to `http://localhost:8787`, so the worker must be running locally for API calls to work in dev. In production the frontend reads `VITE_API_URL` (set in root `wrangler.toml` `[vars]`) and calls the worker directly.

### Worker (`worker/src/index.ts`)
Hono framework on Cloudflare Workers with D1 (SQLite). All routes under `/api/`.

**Auth routes** (no auth required):
- `POST /api/auth/register` — creates user, returns JWT
- `POST /api/auth/login` — returns JWT

**Protected routes** (require `Authorization: Bearer <jwt>`):
- `GET /api/books/lookup?isbn=...` — proxies Google Books API using `GOOGLE_BOOKS_API_KEY` secret
- `GET /api/scans` — paginated list with `limit`/`offset`/`sort` params
- `POST /api/scans` — save a scanned book
- `PATCH /api/scans/:id` — update status (`unread` | `reading` | `read`)
- `DELETE /api/scans/:id` — remove a scan

Worker secrets (`wrangler secret put`): `JWT_SECRET`, `GOOGLE_BOOKS_API_KEY`. Local dev uses `worker/.dev.vars`.

### Styling system
Two systems coexist — use Tailwind for layout/spacing, Vuetify components for interactive UI elements.

**Tailwind tokens** (defined in `src/styles/tailwind.css`, theme-aware via CSS variables):
- Colors: `bg-charcoal`, `bg-charcoal-light`, `border-charcoal-border`, `text-orange-neon`, `text-text-primary`, `text-text-secondary`
- Semantic Vuetify colors also aliased: `bg-primary`, `bg-success`, `bg-error`, etc.
- Fonts: `font-heading` (Playfair Display), `font-body` (Roboto), `font-mono` (Roboto Mono)

**Breakpoints** (same values in both Tailwind and Vuetify):
- `sm` 600px / `md` 840px / `lg` 1145px / `xl` 1545px
- `md` is the mobile/desktop threshold (`useDisplay().mdAndUp` for behavioral branches, `md:` prefix for layout-only)

**Vuetify theme colors** (for `:color` props and semantic use):
- `editorial` (light): success `#276749`, warning `#d97706`, error `#c0392b`
- `editorial-dark` (dark): success `#4caf80`, warning `#e8a838`, error `#e05252`

### Database schema
Two tables in D1: `users` (id, email, password_hash) and `scans` (id, user_id, isbn, title, author, cover_url, status, created_at, language, publish_date, number_of_pages_median). Unique constraint on `(user_id, isbn)`. Migrations in `worker/migrations/`.
