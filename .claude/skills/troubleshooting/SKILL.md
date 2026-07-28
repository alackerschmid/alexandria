---
name: troubleshooting
description: Diagnose bookscan-specific dev failures — API 404s in dev, Wikidata enrichment stuck on "pending" (sweeper throughput, why wrangler dev never fires cron, the self-amplifying backlog), and rebuilding an empty or wiped local D1 database ("no such table" errors from API calls or from `migrations apply`). Use when something works in production but not locally, when enrichment appears stalled, or when the local DB is missing tables.
---

# Troubleshooting

**API calls fail or return 404 in dev:**

- Ensure both dev servers are running: `npm run dev` (frontend) + `npm run dev:worker` (worker) in separate terminals
- Check that worker is on `:8787` and frontend is proxying `/api/*` to it (see vite.config.ts)

**Enrichment stuck on `pending` status:**

- Cron sweeper runs every 2 minutes (check `wrangler.toml` for `*/2 * * * *`). **`wrangler dev` does not fire cron triggers automatically** — in local dev, nothing ever drains the backlog unless you hit `curl "http://localhost:8787/__scheduled"`. A large local backlog (e.g. after a Goodreads import) is expected, not a bug.
- Throughput is `BATCH_SIZE` × tick rate (7 per 2 min ≈ 210/hr). A bulk import creates hundreds of pending works at once, so books can legitimately sit queued for a while; the detail view's badge switches from "series lookup pending" to "series lookup queued" once its poll gives up.
- The backlog is **self-amplifying**: enriching one work that belongs to a series inserts that series' whole roster as placeholder works via `populateSeriesMembers` (~10 per work, measured). Placeholder ids interleave with owned ones, which is why Q1a prioritizes works a user actually holds a scan for — without it, placeholders nobody is looking at push freshly-imported books arbitrarily far back.
- Check wrangler dev logs for SPARQL errors or timeouts
- Manual retry: `POST /api/books/refresh?isbn=<isbn>`

**Empty or wiped local D1** (`worker/.wrangler/state/v3/d1`):

`wrangler d1 migrations apply --local` alone can't build it from empty. Migration `0001` indexes `scans` before anything creates it, and while `0004_books_table.sql` does `CREATE TABLE books` and rebuilds `scans` via a `scans_new` swap, it copies from an existing `scans` — so it can't bootstrap either. Nothing creates `users` at all. The base schema lives only in `schema.sql`. Symptoms of a wiped DB are `500 … no such table: user_field_definitions` on API calls and `migrations apply` failing with `no such table: main.scans`. To rebuild:

1. Apply `schema.sql` minus its `CREATE TABLE d1_migrations` line (that table already exists) to create the ~0016 base.
2. `INSERT OR IGNORE INTO d1_migrations (name)` the filenames `0001…0016` so wrangler skips them — 0001–0004 must not re-run, since the snapshot's `scans` already uses `book_id` not the `isbn` those migrations index.
3. Run `npx wrangler d1 migrations apply bookscan --local` to apply 0017+ on top.
4. Optionally `npm run seed:dev`.
