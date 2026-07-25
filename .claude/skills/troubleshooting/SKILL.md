---
name: troubleshooting
description: Diagnose bookscan-specific dev failures — API 404s in dev, and Wikidata enrichment stuck on "pending" (sweeper throughput, why wrangler dev never fires cron, the self-amplifying backlog). Use when something works in production but not locally, or when enrichment appears stalled.
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
