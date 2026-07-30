# Worker (`worker/`)

Backend guidance for the Cloudflare Worker. Loaded when working under `worker/`.
For the table-by-table D1 schema see `worker/migrations/CLAUDE.md`.
For deployment/CI and repo-wide conventions see the root `CLAUDE.md`.

Two subsystems have their own guidance in `.claude/rules/`, loaded when you open a matching
file: `enrichment` (`enrichment.ts`, `sweeper.ts`, `editions.ts`) and `import-wizard`
(`routes/import.ts`, `import-validation.ts`, `title-match.ts`, `concurrency.ts` — plus the
frontend wizard those routes serve).

### Worker (`worker/src/`)

Hono on Cloudflare Workers with D1 (SQLite). All routes under `/api/`. `index.ts` is just CORS + route mounting; the routes live in `worker/src/routes/`, one file per resource: `auth.ts` (`/api/auth`), `books.ts` (`/api/books`), `scans.ts` (`/api/scans`), `fields.ts` (`/api/field-definitions`), `catalog.ts` (`/api/works` + `/api/series`), `stats.ts` (`/api/stats`), `import.ts` (`/api/import`).

**Key modules:**

- `editions.ts` — `resolveEdition` (fetch-or-create a `books` row, optionally seeded with caller-supplied `FallbackMetadata` when the ISBN can't be resolved externally), `fetchBookMetadata` (Google Books + OpenLibrary merge), `linkWork` (dedup into `works`/`authors`). The central entry point for all ISBN resolution.
- `library-query.ts` — shared `buildScanSelect` (the big JOIN, incl. the `work_ratings` LEFT JOIN), `OVERRIDE_FIELDS`, `SORT_CLAUSES`, `buildScanUpdate` (the shared status/owning SET-clause builder — **can return an empty SET list**, so callers must skip the UPDATE rather than interpolate it blindly), `upsertWorkRating` (the only writer of `work_ratings`; `seed` fills gaps, `overwrite` wins, and a write leaving both fields NULL deletes the row), `isValidRating`/`isValidReview`/`normalizeReview`/`REVIEW_MAX_LENGTH`. Add new columns here when extending the scan response. Unit-tested.
- `title-match.ts` — pure title/author matching for the Goodreads-import no-ISBN path: `titleSimilarity` (Dice-coefficient bigram comparison with a prefix-containment shortcut) + `pickBestMatch` (confident-and-unambiguous match against a candidate list, else no match; ambiguity is judged between *works*, not scans). `titleScorer` (the same scoring with the query title prepared once) is what `enrichment.ts` verifies a Wikidata search hit's labels with. `pickAutoIsbn` picks the ISBN to auto-assign to a row that has none, from title-search results — same thresholds and margin, but the stricter `subtitle` prefix rule (see `PrefixRule`), since there the answer is a new ISBN rather than a scan the user demonstrably has.
- `enrichment.ts` — Wikidata SPARQL pipeline; exports `CURRENT_ENRICHMENT_SCHEMA_VERSION`.
- `sweeper.ts` — cron handler; imported by `index.ts` as the `scheduled` export.
- `auth.ts` — `authMiddleware` (JWT verify, injects `userId`), `signToken` (HS256, 7-day expiry).
- `override-validation.ts` — `validateOverrides`, the per-field rules for `PATCH /api/books/override` (length caps, `http(s)`-only cover URLs, partial-ISO `publish_date`, BCP-47-shaped `language`, integer page count). Returns normalized values plus stable error codes — never prose, so the worker ships no locale strings. Mirrored client-side by `src/utils/book-edit.ts`, which is the round-trip saver, not the enforcement point. Unit-tested.
- `preferences.ts` — `sanitizePreferences`/`parsePreferences` for the opaque per-user preference blob on `users.preferences` (validates a flat string→string map within size bounds; backs `GET`/`PUT /api/auth/preferences`). Unit-tested.
- `isbn.ts` — ISBN normalization/validation (`normalizeIsbn`, `isValidIsbn`).
- `rate-limit.ts` — `checkRateLimit` (fixed-window D1 counter, optional `cost` param to charge more than one unit per call — e.g. a Goodreads-import batch charges its row count) + `rateLimitOrReject` (returns a ready 429 `Response` or null).

**Public routes** (no auth required):

- `POST /api/auth/register` — creates user, returns JWT; migrates any guest scans to account. Also returns `preferences` (always `{}` — the INSERT never sets it), for the same reason login does
- `POST /api/auth/login` — returns JWT; migrates any guest scans to account. Also returns `preferences` (the user's blob, via `parsePreferences`) — it rides the row already read to verify the password, so it costs no extra query and saves the client a `GET /api/auth/preferences` before it can paint the user's look
- `GET /api/books/guest-lookup?isbn=` — metadata lookup for guest mode (same cache-then-fetch as authenticated `/api/books/lookup`, but **skips Wikidata enrichment** to reduce anonymous load)
- `GET /api/books/guest-search?title=` — title search for guest mode (Google Books, no DB writes)

**Protected routes** (require `Authorization: Bearer <jwt>`):

- `PATCH /api/auth/me` — update authenticated user's `firstname`, `email`, and/or password; changing `email` or password requires the current `password` in the body (re-verified server-side) and is rate-limited per user (`me-verify:<userId>`, shared with `DELETE /me`)
- `DELETE /api/auth/me` — **delete the account** and all its data; requires the current `password` in the body (re-verified server-side), returns `204`
- `GET /api/auth/preferences` — the authenticated user's UI preference blob `{ preferences: { [key]: string } }` (empty object when none stored)
- `PUT /api/auth/preferences` — **full replace** (not a merge) of the user's preference blob; body `{ preferences: { [key]: string } }`, validated/bounded by `sanitizePreferences` in `preferences.ts` (flat string→string, key/value/count caps) — an out-of-shape payload is a `400`. Returns `204` (no body — the client has the set already). Backs `src/stores/preferences.ts`; the frontend holds the whole set in memory and sends all of it
- `GET /api/books/lookup?isbn=` — DB cache → Google Books → OpenLibrary fallback; caches result in `books` table
- `GET /api/books/search?title=&author=&publisher=` — candidate editions from Google Books; writes only to the `search_cache` table (see below), never to `books` — a `books` row is only created when the user picks an edition and it flows through lookup/scan
- `POST /api/books/refresh?isbn=` — re-fetches metadata, fills only NULL fields (`COALESCE` updates; a `number_of_pages_median` of 0 is treated as NULL — Google Books returns 0 for unknown page counts, and ingestion in `editions.ts` nulls out non-positive counts)
- `PATCH /api/books/override` — write per-user field overrides to `book_overrides`; body `{ isbn, changes: { field: value } }`. Values are validated by `override-validation.ts`; an out-of-shape one is a `400 { error: "validation_failed", fields: { <field>: <code> } }` where `<code>` is a stable machine string (`too_long`, `invalid_url`, `invalid_date`, `invalid_language`, `invalid_number`, `invalid_type`) the client maps to a message. On success it returns **the merged scan row**, not `{ ok: true }` — the `*_overridden` flags and the value that surfaces under a *cleared* override (the catalogue's, or a sibling edition's description) are only knowable server-side. Because that row is locale-joined like `GET /api/scans`, it takes the same `?locale=` query param (default `en`) — a caller that omits it gets an English `series_name` back
- `GET /api/scans` — paginated list (`limit`/`offset`/`sort`); returns merged rows with `*_overridden` boolean flags
- `POST /api/scans` — save a scan by ISBN; resolves book metadata automatically. Optionally accepts `status`/`owning_status`/`rating`/`review`. Those last two are written to `work_ratings` in **seed** mode — they arrive from another point in time (the scanner's offline queue draining, a guest's local scans syncing on register), so they fill only what's still empty rather than stomping a rating the user has since changed. A rating can never fail the scan: if the book has no work link it is logged and dropped, preserving `allowEmpty`'s guarantee that a queued offline scan always succeeds
- `PATCH /api/scans/:id` — update status (`unread` | `reading` | `read` | `dnf`), `owning_status`, `rating` (integer 0-10 or `null` to clear), and/or `review` (markdown string, or `null`/blank to clear). **`rating`/`review` are not scan columns** — the scan id is only the handle; the route resolves scan → book → work and upserts `work_ratings` (see the table below), so the response also carries `work_id` for the client's fan-out, and — when the write actually touched `work_ratings` — `review_updated_at`, the row's new timestamp, which the client shows as the review's "written" date. A status-only PATCH omits it, having changed nothing there. There is **no status gate on either**: a rating is a judgment about the work, valid at any reading status, and nothing is ever implicitly cleared by a status change. A blank/whitespace-only review normalizes to `NULL` (`normalizeReview`) so "no review" has one representation; length is capped at `REVIEW_MAX_LENGTH` (100k chars) purely so a row can't exceed D1's 2 MB row limit and 500. A rating/review write on a book with no work link calls `linkWork` first and only fails — `409 { code: "work_unresolved" }` — if even that can't produce one (effectively unreachable: `linkWork` falls back to an `isbn:<isbn>` match key). Because a rating-only PATCH touches no scan column, the 404 comes from an explicit lookup rather than from the UPDATE's row count, and `buildScanUpdate` can legitimately return an empty SET list.
- `PATCH /api/scans/:id/edition` — switch the scan to a different edition (ISBN) of the same work; status and custom field values follow the scan, per-user metadata overrides are dropped (they corrected the old edition's metadata)
- `DELETE /api/scans/:id` — remove a scan and its associated `book_overrides`

Worker secrets (`wrangler secret put`): `JWT_SECRET`, `GOOGLE_BOOKS_API_KEY`. Local dev uses `worker/.dev.vars`. `CORS_ORIGIN` is **not** a secret — it's a plain `[vars]` entry in `worker/wrangler.toml` (set to `https://bookscan.pages.dev` in production; the code falls back to `*` when unset).

**Authentication:**

- JWT tokens expire after 7 days (no refresh token mechanism; users re-login after expiry)
- Passwords hashed with Web Crypto PBKDF2 (`worker/src/password.ts`, 100k iterations, self-describing `pbkdf2$<iter>$<salt>$<hash>` format); legacy `bcryptjs` hashes still verify and are re-hashed to PBKDF2 on the next successful login (`bcryptjs` stays a dependency until all users have logged in post-migration)
- Auth header format: `Authorization: Bearer <token>`

**Offline/Queue behavior:**

- `POST /api/scans` accepts `isbn` only and always succeeds, even if metadata fetch fails (`allowEmpty: true`) — unless rate-limited (see below)
- Scans remain `enrichment_status: pending` until background enrichment completes or is triggered manually
- Allows users to queue scans offline; metadata resolves asynchronously in the background

**Rate limiting:** `POST /api/scans` is capped at 30 scans/minute per user (`SCAN_RATE_LIMIT` in `routes/scans.ts`) via `checkRateLimit` (`rate-limit.ts`) — a generic fixed-window D1 counter backed by the `rate_limits` table (`key` TEXT, `window_start` ms-epoch bucket, `window_ms` window length, `count`). `key` is caller-defined (e.g. `scan:<userId>`) so the same table can back other rate-limited routes without a migration. Exceeding the limit returns `429` with a `Retry-After` header; a duplicate-scan request (ISBN already in the user's library) is rejected with `409` before the rate limit is even checked, so retrying/rescanning an owned book doesn't burn quota. The following routes are also rate-limited by caller IP (`CF-Connecting-IP`, keyed `<route>:<ip>`): `POST /api/auth/login` (10/min), `POST /api/auth/register` (5 per 10 min), `GET /api/books/guest-lookup` (20/min), `GET /api/books/guest-search` (15/min). Two more are rate-limited per user: `POST /api/books/refresh` (10/min, keyed `refresh:<userId>`) and `POST /api/works/:workId/editions/discover` (20/min, keyed `discover:<userId>`). No other routes are rate-limited today. The cron sweeper prunes `rate_limits` rows once their own window (`window_start + window_ms`) has elapsed, so retention is correct regardless of window size.

### Additional API routes

**Public:**

- `GET /api/books/sample?limit=` — random sample of hand-picked catalogued books, i.e. `is_featured = 1` (powers the marketing preview, max 12); the flag is set manually (no UI/endpoint — e.g. `wrangler d1 execute`)

**Title search** (`GET /api/books/search`, `GET /api/books/guest-search`) — both go through `handleTitleSearch` in `routes/books.ts`. Google Books is the only candidate source (there's no OpenLibrary fallback for title search), and the project has a hard **daily query quota**, so:

- Everything behind the edge cache — local catalog, then the D1 `search_cache` table, then Google Books — lives in `editions.ts`'s `searchTitleCached`, so `POST /api/import/suggest-isbn` searches through the same caches without going through the route.
- Successful responses (including legitimate zero-result ones) are stored in the Workers edge cache (`caches.default`) for 6h, keyed on the `normalizeStr`'d title+author+publisher and **not** on the user — the answer depends only on the query. Repeated searches then cost no quota. A local-catalog hit is deliberately **not** edge-cached (`source: "local"`), since the catalog is the live source.
- Upstream failures are **never cached** and surface as `503 {"error": "search_unavailable"}` (with `Retry-After` when Google supplies one). `searchBooksByTitle` throws `UpstreamSearchError` rather than returning `[]`: a 429/5xx body has no `items` key, which would otherwise be indistinguishable from "this title doesn't exist". Frontends must treat 503 as "search unavailable", not "no matches" (`import.review.search_unavailable`, `scanner.search_error`).
- `fetchGoogleBooksJson(url, { retryOn429 })` retries 5xx up to 4 times with backoff. A 429 is retried **only for title search** (once — enough to rescue a per-minute rate limit, while a daily-quota 429 can only fail). The ISBN metadata path (`fetchFromGoogleBooks`) passes `retryOn429: false` because `fetchBookMetadata` falls back to OpenLibrary; retrying there added ~2.2s to every uncached import row while the quota was exhausted.

**Protected:**

- `GET /api/scans/:id` — single scan row; used to poll `enrichment_status` after a scan
- `PATCH /api/books/custom-fields` — save custom field values; body `{ isbn, values: [{ field_def_id, value }] }` (replaces all values for that book in one batch). Returns the merged scan row, same as `/override`, and takes the same `?locale=`. `user_field_definitions.required` is **not** enforced here (that would reject every book saved before the flag was set) — the edit mask checks it client-side
- `GET /api/field-definitions` — list the user's custom field schema
- `POST /api/field-definitions` — create a field; body `{ name, type?, options? }` (`type`: `text` | `integer` | `select` | `tag` | `date`, defaults to `text`; `options` is a `select` field's fixed value set — a string array, sanitized/deduped server-side and ignored by every other type)
- `PATCH /api/field-definitions/:id` — update a field; body `{ name?, type?, required?, options? }`. Every `PATCH /api/books/custom-fields` save re-validates each value against its field's current `field_type`: a `select` value must be one of its current `options` (e.g. catches a value orphaned by a since-renamed/removed option) and an `integer` value must match `^-?\d+$`; either way an invalid value is silently cleared rather than stored
- `DELETE /api/field-definitions/:id` — remove a field and all its stored values
- `GET /api/field-definitions/:id/values` — distinct tag values used across the user's books for that field (powers tag autocomplete)
- `DELETE /api/field-definitions/:id/values?value=` — remove one tag value from every book the user owns (global tag delete)
- `GET /api/works/:workId/editions` — other editions of the same work; `scan_id` is non-null for editions the user owns
- `POST /api/works/:workId/editions/discover` — user-triggered OpenLibrary edition discovery into `work_edition_isbns` (seed-ISBN path, falling back to the stored `openlibrary_work_id`); only runs when `editions_checked_at` is NULL (a failed OpenLibrary call leaves it retryable), then returns the same edition list as GET plus a `discoveryFailed` flag
- `GET /api/series?locale=` — bulk membership: every entry of every series the user owns ≥1 book in, grouped by series id (powers the library's grouped-by-series shelves without a round-trip per series); "owned" requires `owning_status` `owned` or `lent_out` — `want`/`unowned`/`unknown` don't count
- `GET /api/series/:seriesId?locale=` — series name + all member works with ownership status
- `GET /api/stats` — aggregated library statistics (status counts, top authors, genres, languages, page/year stats); response shape defined in `src/types/stats.ts`
- `POST /api/import/goodreads` — batch-import scans from a parsed Goodreads CSV export (1-10 rows). Rate-limited to ~600 rows/min per user (`import:<userId>`, charged via `checkRateLimit`'s `cost` param as `rows.length`).
- `POST /api/import/match` — the title/author matching pass for rows with no usable ISBN (1-50 rows; no external fetches). Shares the `/goodreads` rate-limit bucket.
- `POST /api/import/suggest-isbn` — names an ISBN for a row that has none, from a title/author search (1-10 rows, one search each via `searchTitleCached`). Answers only when `pickAutoIsbn` is confident and unambiguous; body `{ rows: [{ title, author? }] }` → `{ results: [{ isbn: string | null, confidence?, unavailable? }] }`, positional. `unavailable: true` marks a row whose *search* failed upstream rather than one that was declined — the client offers those a retry instead of manual resolution. Shares the `/goodreads` rate-limit bucket.

  Request/response shapes, the ownership rule, `update`/Undo semantics and the batch concurrency model are in the `import-wizard` rule, alongside the wizard that drives them.

`GET /api/scans` accepts a `locale` query param (default `en`) for localized series names, and `sort` with values: `date_desc` (default), `date_asc`, `title_asc`, `title_desc`, `author_asc`, `author_desc`, `series_asc`.

Each scan row includes: `rating` (0-10 | null), `review` (markdown string | null) and `review_updated_at` (`work_ratings.updated_at`, i.e. when either of those two was last written — the frontend's review pane presents it as the review's "written" date), all three joined from `work_ratings` and therefore identical across every owned edition of the work, `enrichment_status` (`pending` | `done` | `failed`), `work_id`, `series_id`, `series_name`, `series_ordinal`, `series_total`, `genres`/`awards`/`nominations`/`narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays, parsed via `parseTagArray` in `library-query.ts` — `[]` when absent, never `null`), `original_pub_date` (4-digit year | null), `main_subject`, `form_of_work`, `language_of_work`, `first_line`, `epigraph`, `subtitle` (strings | null), `physical_format`, `edition_name`, `physical_dimensions` (strings | null, from OpenLibrary only), `reference_page_count` (number | null, page count of the work's Wikidata reference edition — the frontend shows it as "N" with a tooltip when the edition's own page count is unknown), `description` (falls back to another edition's `books.description` sharing the same `work_id` when the scan's own edition and its override both have none — display-only, `books.description` itself is untouched), `custom_field_values` (array of `{ field_def_id, value }`), plus `*_overridden` flags for each overridable field. `author` is never overridable — it's managed through the works/authors model.

### Database schema

Table-by-table schema lives in `worker/migrations/CLAUDE.md`, loaded when working under `worker/migrations/`. Migrations there are authoritative; `worker/schema.sql` is a stale ~0016 snapshot, **not** the initial state.

Four schema facts shape route and query code rather than migration code, so they stay here:

- **`scans.rating` is a dead column** as of migration 0042 — the user's rating and review live in `work_ratings`, keyed `(user_id, work_id)` and LEFT JOINed by `buildScanSelect`, so they are identical across every owned edition of a work. Nothing reads or writes `scans.rating`; its `DROP` is deliberately held back to a later release, because `.github/workflows/deploy.yml` applies migrations *before* `wrangler deploy` and the still-live old worker would select a column that no longer exists.
- **`scans` is unique on `(user_id, book_id)`, not on the work** — a user can legitimately own two editions of the same work, so a per-work write has to fan out across siblings (`workSiblings` in `src/utils/book-display.ts`, `upsertWorkRating` in `library-query.ts`) or the collapsed work-card and the edition carousel drift apart.
- **`owning_status = 'unknown'`** is the explicit no-assertion state written by the Goodreads import, and is excluded from every `IN ('owned','lent_out')` ownership gate — series completeness and the ownership stats.
- **`work_ratings.work_id` deliberately has no `ON DELETE` clause** (mirroring `books.work_id`), so `mergeWorks`' repoint stanza must run before its final `DELETE FROM works` — otherwise the FK fails the batch, which is exactly the intended guard against silently destroying the losing work's ratings.

`GET /api/scans` JOINs all tables and uses `COALESCE(book_overrides.field, books.field)` for each overridable field. `POST /api/scans` accepts only `isbn`; metadata and work links are resolved server-side (using `allowEmpty` so offline-queued scans always succeed). `DELETE /api/scans/:id` clears the user's `book_overrides` and `book_custom_fields` for that book, then deletes the scan.

### Wikidata enrichment pipeline

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWork(...))` after lookups and scans, and in the background via a cron sweeper (cron `*/2 * * * *`). It is intentionally skipped for guest lookups to avoid anonymous SPARQL load. `POST /api/books/refresh` is the manual force-retry path.

`works.enrichment_status` is the authoritative state (`pending` | `done` | `failed` | `exhausted`); the API surface maps `exhausted` → `failed` and only ever exposes `pending | done | failed`.

The flow, merge logic, retry policy, sweeper batching and the `enrichment_runs` telemetry table are in the `enrichment` rule, which loads when you open `enrichment.ts`, `sweeper.ts` or `editions.ts`. To add a new enriched field, use the `/add-api-column` skill.
