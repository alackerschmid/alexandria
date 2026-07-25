# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet.

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I’m always open to ideas on better ways to do things. Please don’t hesitate to suggest a better way, or one that has long lasting impact over a tactical change. If what we are trying to do is similar to settled science or industry practice, let me know. We don’t have to reinvent the wheel.

6. Keep these files in sync with the code: when adding, renaming, or removing a route, table, store, composable, page, or component, update the corresponding inventory in the same change — frontend inventories live in `src/CLAUDE.md`, backend routes/schema in `worker/CLAUDE.md`. The behavioral sections age well; the inventories rot silently unless this is enforced.

7. Ignore `to-do.md` at the repo root — it's personal notes, not tasks for you. Don't read, update, or act on it unless explicitly asked.

## Formatting

- Scale response length to task requirements. Be concise but comprehensive.
- No performative tics: no unnecessary validation ("Fair point"), narrating the next move ("Let me name them plainly"), flagging significance ("This is the real issue"), or advertising honesty ("to be honest"). Lead with substance.
- No filler questions. "What's next?", "How can I help?", "What's up?" are social performance, not real questions. Only ask a question when you need the answer to proceed.
- Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested.

## Where things are documented

- `src/CLAUDE.md` — frontend: pages/components/composables/stores/utils inventory, the library display pipeline, styling system (Tailwind + Vuetify + user appearance presets), i18n
- `worker/CLAUDE.md` — backend: API routes, key modules, auth, rate limiting, D1 schema, the Wikidata enrichment pipeline and its state machine
- `/dev-setup` skill — running both dev servers locally, `worker/.dev.vars` secrets, seeding a test account
- `/troubleshooting` skill — API 404s in dev, enrichment stuck on `pending`

## Architecture

Two `wrangler.toml` files — root (`wrangler.toml`) configures Cloudflare Pages and sets `VITE_API_URL` at build time; `worker/wrangler.toml` configures the Worker (D1 binding, cron, observability, `CORS_ORIGIN`).

Two separate deployments, both triggered by pushing to `main`:

- **Frontend**: Cloudflare Pages — static Vite build, deployed automatically on push to `main` via Cloudflare's Git integration
- **Worker**: Cloudflare Worker (`bookscan-worker`) — deployed by the GitHub Actions **Deploy** workflow (`.github/workflows/deploy.yml`) on push to `main`: it runs the shared verify workflow (type-check, lint, worker tests), applies pending D1 migrations, then runs `wrangler deploy`. Requires the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. The former Cloudflare Git integration (Workers Builds) for the worker is disabled. `npm run deploy:worker` (`wrangler deploy`) remains available for manual/out-of-band deploys (it does not apply migrations).

CI: the **CI** workflow (`.github/workflows/ci.yml`) runs the same verify workflow on every push to non-`main` branches.

Pushing to GitHub redeploys both the frontend and the worker. Worker deploys apply pending D1 migrations automatically (before `wrangler deploy`); manual/out-of-band deploys do not — apply those with `npx wrangler d1 migrations apply bookscan --remote`.

The Vite dev server proxies `/api/*` to `http://localhost:8787` — the worker must be running locally for API calls to work in dev. In production, the frontend reads `VITE_API_URL` (set in root `wrangler.toml`) and calls the worker directly.

Primary language is TypeScript; preserve strict typing and prefer minimal, clean code (simplify where reasonable when refactoring).

## Add a new column to the API response

1. If it's a Wikidata field: follow "Adding new Wikidata fields" (5-step process in `worker/CLAUDE.md`'s enrichment section)
2. If it's a new book metadata field: (1) add `ALTER TABLE books ADD COLUMN` migration, (2) add to `SCAN_SELECT` in `library-query.ts`, (3) update the `Book` type in `src/types/book.ts`
3. If it's a custom field: use the existing `user_field_definitions` + `book_custom_fields` schema (already query-merged in `SCAN_SELECT`)

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

Note: Both the worker (`worker/test/*.spec.ts`) and the frontend (root `test/*.spec.ts`, `vitest run`) have unit tests covering **pure logic only** — no D1/miniflare, no component mounting, so anything requiring a DB or the DOM is untested (deliberate scope decision). Frontend components/pages are verified by type-checking and manual QA (seed via `cd worker && npm run seed:dev`); only Vue-free helpers get unit tests.
