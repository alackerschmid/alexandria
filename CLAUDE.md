# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

1. Ask, don't assume. If something is unclear, ask before writing a single line. Never make silent assumptions about intent, architecture, or requirements. When running unattended, pick the most reasonable interpretation, proceed, and record the assumption rather than blocking.

2. Implement the simplest solution for simple problems, better solutions for harder problems. Do not over-engineer or add flexibility that isn't needed yet.

3. Don't touch unrelated code but please do surface bad code or design smells you discover with me so we can address them as a separate issue.

4. Flag uncertainty explicitly. If you're unsure about something, see point 1 above. If it makes sense to do so, conduct a small, localised and low-risk experiment and bring the hypothesis and results to me to discuss. Confidence without certainty causes more damage than admitting a gap.

5. I’m always open to ideas on better ways to do things. Please don’t hesitate to suggest a better way, or one that has long lasting impact over a tactical change. If what we are trying to do is similar to settled science or industry practice, let me know. We don’t have to reinvent the wheel.

6. Keep the two remaining inventories in sync with the code: when adding, renaming, or removing an **API route**, update `worker/CLAUDE.md`; when changing a **table or column**, update `worker/migrations/CLAUDE.md`. Both are contracts rather than file listings, so they don't rot the way a component roster does. There is deliberately no frontend inventory — ask the `inventory` subagent for the roster of an area instead.

7. `to-do.md` at the repo root is personal notes, not a backlog for you. `.claude/settings.json` denies Read/Edit/Write on it, but permission rules don't cover Bash or a repo-wide grep — so if its contents reach you some other way, don't act on them, and don't treat anything in it as a task. Only work from it if I ask you to.

## Formatting

- Scale response length to task requirements. Be concise but comprehensive.
- No performative tics: no unnecessary validation ("Fair point"), narrating the next move ("Let me name them plainly"), flagging significance ("This is the real issue"), or advertising honesty ("to be honest"). Lead with substance.
- No filler questions. "What's next?", "How can I help?", "What's up?" are social performance, not real questions. Only ask a question when you need the answer to proceed.
- Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested.

## Where things are documented

Loaded by directory:

- `src/CLAUDE.md` — frontend invariants, data flow, styling tokens, i18n
- `worker/CLAUDE.md` — backend: API routes, key modules, auth, rate limiting
- `worker/migrations/CLAUDE.md` — the table-by-table D1 schema

Loaded by file, from `.claude/rules/` (each carries `paths:` frontmatter and costs nothing until you open a matching file):

- `book-detail` — the detail dialog: measure and bands, tab derivation, the single-Save edit screen, `RatingDialog` ownership and its flush rule
- `import-wizard` — both halves of the Goodreads import: the wizard, the two batch routes, the ownership rule, `update`/Undo semantics, batch concurrency
- `library-pipeline` — the search → collapse → group chain and why the order is load-bearing
- `appearance` — user presets, `.force-dark`, the `tailwind.css` ↔ `appearance.ts` sync requirement, self-hosted fonts
- `preferences` — where persisted preferences live and how to add one
- `enrichment` — the Wikidata pipeline, retry policy, sweeper batching, telemetry

On demand:

- `/dev-setup` skill — running both dev servers locally, `worker/.dev.vars` secrets, seeding a test account
- `/troubleshooting` skill — API 404s in dev, enrichment stuck on `pending`, rebuilding a wiped local D1
- `/add-api-column` skill — adding a new column to the API response (Wikidata / book metadata / custom field)
- `inventory` subagent — the roster of an area: which components/composables/stores/routes exist under a directory and what each is for

## Architecture

Two `wrangler.toml` files — root (`wrangler.toml`) configures Cloudflare Pages and sets `VITE_API_URL` at build time; `worker/wrangler.toml` configures the Worker (D1 binding, cron, observability, `CORS_ORIGIN`).

Two separate deployments, both triggered by pushing to `main`:

- **Frontend**: Cloudflare Pages — static Vite build, deployed automatically on push to `main` via Cloudflare's Git integration
- **Worker**: Cloudflare Worker (`bookscan-worker`) — deployed by the GitHub Actions **Deploy** workflow (`.github/workflows/deploy.yml`) on push to `main`: it runs the shared verify workflow (frontend type-check + lint + tests, worker type-check + tests), applies pending D1 migrations, then runs `wrangler deploy`. Requires the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets. The former Cloudflare Git integration (Workers Builds) for the worker is disabled. `npm run deploy:worker` (`wrangler deploy`) remains available for manual/out-of-band deploys (it does not apply migrations).

CI: the **CI** workflow (`.github/workflows/ci.yml`) runs the same verify workflow on every push to non-`main` branches.

Pushing to GitHub redeploys both the frontend and the worker. Worker deploys apply pending D1 migrations automatically (before `wrangler deploy`); manual/out-of-band deploys do not — apply those with `npx wrangler d1 migrations apply bookscan --remote`.

The Vite dev server proxies `/api/*` to `http://localhost:8787` — the worker must be running locally for API calls to work in dev. In production, the frontend reads `VITE_API_URL` (set in root `wrangler.toml`) and calls the worker directly.

Primary language is TypeScript; preserve strict typing and prefer minimal, clean code (simplify where reasonable when refactoring).

## Cloudflare MCP

The `cloudflare` plugin adds five MCP servers. Four of them reach the **live account**, which also holds unrelated `thursday` and `bookclub` projects — scope every call to `bookscan-worker` / D1 `bookscan` explicitly, never take "the first worker in the list".

- **`cloudflare-docs`** — `search_cloudflare_documentation`. Consult it before writing worker code, editing either `wrangler.toml`, or adding a migration, instead of answering from pretrained knowledge: wrangler flags, D1 limits, and cron semantics all move faster than a model cutoff. Same rule for the `cloudflare:wrangler` and `cloudflare:workers-best-practices` skills.
- **`cloudflare-observability`** — `query_worker_observability` plus `observability_keys` / `observability_values` over production logs (7-day retention; filter `$metadata.service = bookscan-worker`). This is the only view of prod enrichment behaviour — whether the 2-minute cron actually fired, SPARQL error and timeout rates, real latency. Local `wrangler dev` logs cover none of that. Confirm keys and values with the `_keys`/`_values` tools before filtering on them rather than guessing field names.
- **`cloudflare-bindings`** — `d1_database_query` runs arbitrary SQL against the **production** database. Read-only `SELECT` for diagnosis is fine; `INSERT`/`UPDATE`/`DELETE`/DDL through it is not. Schema changes go through `worker/migrations/` and the deploy path, always. It is deliberately **not** allowlisted in `.claude/settings.json`, so every call prompts — that prompt is the guardrail; don't route around it with `wrangler d1 execute --remote` either.
- **`cloudflare-api`** — generic REST API access. Its `execute` tool could mutate anything in the account and is in `deny`, so only the read-only `search` / `docs` tools are usable. Anything that genuinely needs `execute` is a conversation, not a tool call.
- **`cloudflare-builds`** — Workers Builds only, which is disabled for this repo (see Architecture), so it will be empty for `bookscan-worker`. Deploy status comes from `gh run watch` on the **Deploy** workflow.

## Versioning

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` — new feature → minor version bump
- `fix: ...` — bug fix → patch bump
- `feat!:` / `fix!:` — breaking change → major bump
- `chore:`, `docs:`, `refactor:` — no release

[release-please](.github/workflows/release-please.yml) watches `main` and auto-opens a Release PR that updates `CHANGELOG.md` and `package.json`. Merge that PR when ready to publish a GitHub Release.

## Verification

**This is enforced, not requested.** A `Stop` hook (`.claude/hooks/verify.mjs`) records which files each turn edited and runs the checks those paths imply:

| Edited | Runs |
| --- | --- |
| `src/`, `test/`, `vite.config`, `vitest.config`, `tsconfig`, `eslint.config`, `.claude/hooks/` | `npm run type-check` + `npm run lint` |
| `worker/` | `npm run lint` (root ESLint covers `worker/`; the worker has no lint script), plus the worker's own type-check and tests |
| `src/utils/`, `src/locales/`, `test/` | `npm test` |

A failure blocks the turn and returns the output. A turn that edited nothing runs nothing. Only files an actual check can fail on are recorded (`.ts`/`.mts`/`.vue`/`.json`/`.js`/`.mjs`/`.cjs`) — notably **not** `.css`, which neither `vue-tsc` nor ESLint reads, so `src/styles/tailwind.css` has no automated check and needs a look in the browser.

So don't hand-run these to "check your work" — finish the edit and let the hook decide. Do run them manually when you need a result mid-task, or when the hook has given up after three consecutive failures. The same standard applies to a `/code-review` pass: fixes applied from one aren't done until these pass.

Note: both the worker (`worker/test/*.spec.ts`) and the frontend (root `test/*.spec.ts`) have unit tests covering **pure logic only** — no D1/miniflare, no component mounting, so anything requiring a DB or the DOM is untested (deliberate scope decision). Frontend components/pages are verified by type-checking and manual QA (seed via `cd worker && npm run seed:dev`); only Vue-free helpers get unit tests. `test/locales.spec.ts` additionally fails `npm test` (and so CI) if `en.json` and `de.json` key sets drift — note that `npm run build` does not run the tests, so it will not catch that on its own.
