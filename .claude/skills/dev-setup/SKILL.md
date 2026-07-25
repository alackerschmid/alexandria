---
name: dev-setup
description: Set up and run bookscan locally — both dev servers (frontend :3000 + worker :8787), required worker/.dev.vars secrets, and seeding a local test account for manual QA. Use when starting local development, when API calls fail in dev, or when you need seeded data.
---

# Local development setup

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
