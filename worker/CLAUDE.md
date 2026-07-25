# Worker (`worker/`)

Backend guidance for the Cloudflare Worker. Loaded when working under `worker/`.
For deployment/CI and repo-wide conventions see the root `CLAUDE.md`.

### Worker (`worker/src/`)

Hono on Cloudflare Workers with D1 (SQLite). All routes under `/api/`. `index.ts` is just CORS + route mounting; the routes live in `worker/src/routes/`, one file per resource: `auth.ts` (`/api/auth`), `books.ts` (`/api/books`), `scans.ts` (`/api/scans`), `fields.ts` (`/api/field-definitions`), `catalog.ts` (`/api/works` + `/api/series`), `stats.ts` (`/api/stats`), `import.ts` (`/api/import`).

**Key modules:**

- `editions.ts` — `resolveEdition` (fetch-or-create a `books` row, optionally seeded with caller-supplied `FallbackMetadata` when the ISBN can't be resolved externally), `fetchBookMetadata` (Google Books + OpenLibrary merge), `linkWork` (dedup into `works`/`authors`). The central entry point for all ISBN resolution.
- `library-query.ts` — shared `SCAN_SELECT` (the big JOIN), `OVERRIDE_FIELDS`, `SORT_CLAUSES`, `resolveRatingForUpdate` (the shared status/rating invariant used by both `PATCH /api/scans/:id` and the Goodreads-import update-on-duplicate path). Add new columns here when extending the scan response.
- `title-match.ts` — pure title/author matching for the Goodreads-import no-ISBN path: `titleSimilarity` (Dice-coefficient bigram comparison with a prefix-containment shortcut) + `pickBestMatch` (confident-and-unambiguous match against a candidate list, else no match).
- `enrichment.ts` — Wikidata SPARQL pipeline; exports `CURRENT_ENRICHMENT_SCHEMA_VERSION`.
- `sweeper.ts` — cron handler; imported by `index.ts` as the `scheduled` export.
- `auth.ts` — `authMiddleware` (JWT verify, injects `userId`), `signToken` (HS256, 7-day expiry).
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
- `PATCH /api/books/override` — write per-user field overrides to `book_overrides`; body `{ isbn, changes: { field: value } }`
- `GET /api/scans` — paginated list (`limit`/`offset`/`sort`); returns merged rows with `*_overridden` boolean flags
- `POST /api/scans` — save a scan by ISBN; resolves book metadata automatically
- `PATCH /api/scans/:id` — update status (`unread` | `reading` | `read` | `dnf`), `owning_status`, and/or `rating` (integer 0-10 or `null` to clear). Server-enforced invariants: a rating can only be set while the effective status is `read` (400 otherwise), and moving off `read` without an explicit rating change silently clears any existing rating.
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

- Successful responses (including legitimate zero-result ones) are stored in the Workers edge cache (`caches.default`) for 6h, keyed on the `normalizeStr`'d title+author+publisher and **not** on the user — the answer depends only on the query. Repeated searches then cost no quota.
- Upstream failures are **never cached** and surface as `503 {"error": "search_unavailable"}` (with `Retry-After` when Google supplies one). `searchBooksByTitle` throws `UpstreamSearchError` rather than returning `[]`: a 429/5xx body has no `items` key, which would otherwise be indistinguishable from "this title doesn't exist". Frontends must treat 503 as "search unavailable", not "no matches" (`import.review.search_unavailable`, `scanner.search_error`).
- `fetchGoogleBooksJson(url, { retryOn429 })` retries 5xx up to 4 times with backoff. A 429 is retried **only for title search** (once — enough to rescue a per-minute rate limit, while a daily-quota 429 can only fail). The ISBN metadata path (`fetchFromGoogleBooks`) passes `retryOn429: false` because `fetchBookMetadata` falls back to OpenLibrary; retrying there added ~2.2s to every uncached import row while the quota was exhausted.

**Protected:**

- `GET /api/scans/:id` — single scan row; used to poll `enrichment_status` after a scan
- `PATCH /api/books/custom-fields` — save custom field values; body `{ isbn, values: [{ field_def_id, value }] }` (replaces all values for that book in one batch)
- `GET /api/field-definitions` — list the user's custom field schema
- `POST /api/field-definitions` — create a field; body `{ name, type?, options? }` (`type`: `text` | `integer` | `select` | `tag` | `date`, defaults to `text`; `options` is a `select` field's fixed value set — a string array, sanitized/deduped server-side and ignored by every other type)
- `PATCH /api/field-definitions/:id` — update a field; body `{ name?, type?, required?, options? }`. Every `PATCH /api/books/custom-fields` save re-validates each value against its field's current `field_type`: a `select` value must be one of its current `options` (e.g. catches a value orphaned by a since-renamed/removed option) and an `integer` value must match `^-?\d+$`; either way an invalid value is silently cleared rather than stored
- `DELETE /api/field-definitions/:id` — remove a field and all its stored values
- `GET /api/field-definitions/:id/values` — distinct tag values used across the user's books for that field (powers tag autocomplete)
- `DELETE /api/field-definitions/:id/values?value=` — remove one tag value from every book the user owns (global tag delete)
- `GET /api/works/:workId/editions` — other editions of the same work; `scan_id` is non-null for editions the user owns
- `POST /api/works/:workId/editions/discover` — user-triggered OpenLibrary edition discovery into `work_edition_isbns` (seed-ISBN path, falling back to the stored `openlibrary_work_id`); only runs when `editions_checked_at` is NULL (a failed OpenLibrary call leaves it retryable), then returns the same edition list as GET plus a `discoveryFailed` flag
- `GET /api/series?locale=` — bulk membership: every entry of every series the user owns ≥1 book in, grouped by series id (powers the library's grouped-by-series shelves without a round-trip per series); "owned" requires `owning_status` `owned` or `lent_out` — `want`/`unowned` don't count
- `GET /api/series/:seriesId?locale=` — series name + all member works with ownership status
- `GET /api/stats` — aggregated library statistics (status counts, top authors, genres, languages, page/year stats); response shape defined in `src/types/stats.ts`
- `POST /api/import/goodreads` — batch-import scans from a parsed Goodreads CSV export; body `{ rows: [{ isbn, status?, owning_status?, rating?, created_at?, title?, author?, publisher?, publish_date?, number_of_pages?, owned_copies?, shelves? }], update?: boolean, shelves_field_def_id? }` (1-10 rows); returns `{ results: [{ isbn, outcome: "imported"|"updated"|"duplicate"|"invalid_isbn"|"failed", scan_id?, book?, resolved?, previous? }] }`. `resolved: { status, rating, owning_status }` (on `imported`/`updated`) is the scan state **as actually written** — the client renders the summary card straight from it instead of re-deriving the shelf-mapping/rating/`owned_copies` rules, which had drifted (an `owned_copies>0` create was stored `owned` but shown as its shelf-mapped `want`). Rate-limited to ~600 rows/min per user (`import:<userId>`, same `rate_limits` table, charged via `checkRateLimit`'s `cost` param as `rows.length` rather than 1 per request). `worker/src/import-validation.ts` does checksum validation (stricter than the scan queue's format-only check) and the status/rating/date/metadata normalization; a checksum-invalid ISBN comes back as `invalid_isbn` rather than a 400, so the frontend wizard can route it to a review step instead of failing the whole batch. No `enrichWork`/`waitUntil` call here — new works are left `pending` for the cron sweeper to drain, deliberately avoiding a Wikidata traffic spike across an entire imported library at once.

  `title`/`author`/`publisher`/`publish_date`/`number_of_pages` seed a fallback `books` row (via `resolveEdition`'s `FallbackMetadata`) when neither Google Books nor OpenLibrary has the ISBN, instead of inserting an all-NULL row. `owned_copies > 0` forces `owning_status` to `owned` on a newly created scan, overriding the shelf mapping. `update: true` makes a duplicate-ISBN hit apply the row's `status` (always) and `rating` (only when the row has one) to the *existing* scan via the shared `resolveRatingForUpdate` invariant — `owning_status` is never touched on an update — returning `outcome: "updated"` with `resolved` (post-update state) and `previous: { status, rating, owning_status }` (pre-update state, for Undo) instead of the inert `"duplicate"`. `shelves_field_def_id` (request-level, verified server-side to belong to the caller and be a `tag` field) writes each row's `shelves` into `book_custom_fields` — only for newly created scans, not updates.

  Rows within a batch are resolved **concurrently** (`mapWithConcurrency` in `worker/src/concurrency.ts`, `ROW_CONCURRENCY = 4`, order-preserving). An uncached ISBN costs 3 external fetches (1 Google Books + 2 OpenLibrary, ~1.1s); serializing them made a 10-row batch take ~11s, now ~4.5s. The cap stays well under the free-plan limit of 50 external subrequests per invocation (10 rows × 3 = 30) and keeps the burst against OpenLibrary polite — raising it past ~6 gains nothing, since Workers allow only 6 simultaneous connections awaiting response headers. Concurrent rows can race in `linkWork` when they share a work or author; every write there is `INSERT OR IGNORE` (`works.match_key` and `authors.normalized_name` are UNIQUE) and the `scans` insert is guarded by a UNIQUE constraint caught as `duplicate`, so the races are benign. The client sends batches sequentially with `BATCH_SIZE = 10` (`src/stores/import.ts`) — keep it ≤ `MAX_BATCH_SIZE`.

- `POST /api/import/match` — the title/author matching pass for rows with no usable ISBN (a Goodreads export commonly has these for hand-added books); body `{ rows: [{ title, author?, status?, rating? }], update?: boolean }` (1-50 rows — no external fetches, so a much larger batch than `/goodreads` costs nothing); returns `{ results: [{ outcome: "duplicate"|"updated"|"no_match", scan_id?, book?, resolved?, previous?, confidence? }] }` (`resolved`/`previous` same shape and purpose as `/goodreads`). Shares the `/goodreads` rate-limit bucket (`import:<userId>`) so the two passes of one import session jointly stay under budget. Loads the caller's whole scan list once per request (scan id, book id, effective title/author, work's canonical title) and scores every row against it in-memory via `worker/src/title-match.ts`'s `pickBestMatch` — skipped (every row returns `no_match`) above 20k scans, a bound realistically unreachable for a personal library. A confident match applies the same update rules as `/goodreads`; below the confidence/ambiguity threshold, `no_match` sends the row to manual review instead of guessing.

`GET /api/scans` accepts a `locale` query param (default `en`) for localized series names, and `sort` with values: `date_desc` (default), `date_asc`, `title_asc`, `title_desc`, `author_asc`, `author_desc`, `series_asc`.

Each scan row includes: `enrichment_status` (`pending` | `done` | `failed`), `work_id`, `series_id`, `series_name`, `series_ordinal`, `series_total`, `rating` (integer 0-10 | null), `genres`/`awards`/`nominations`/`narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays, parsed via `parseTagArray` in `library-query.ts` — `[]` when absent, never `null`), `original_pub_date` (4-digit year | null), `main_subject`, `form_of_work`, `language_of_work`, `first_line`, `epigraph`, `subtitle` (strings | null), `physical_format`, `edition_name`, `physical_dimensions` (strings | null, from OpenLibrary only), `reference_page_count` (number | null, page count of the work's Wikidata reference edition — the frontend shows it as "N" with a tooltip when the edition's own page count is unknown), `description` (falls back to another edition's `books.description` sharing the same `work_id` when the scan's own edition and its override both have none — display-only, `books.description` itself is untouched), `custom_field_values` (array of `{ field_def_id, value }`), plus `*_overridden` flags for each overridable field. `author` is never overridable — it's managed through the works/authors model.

### Database schema

Migrations in `worker/migrations/` are authoritative for the schema. `worker/schema.sql` is **not** the initial state — it's a `sqlite3 .dump` snapshot frozen at ~migration 0016 (it already carries later columns like `firstname`, `physical_format`, and the works enrichment fields), so treat it as stale relative to the current migrations.

**Bootstrapping an empty/wiped local D1** (`worker/.wrangler/state/v3/d1`): `wrangler d1 migrations apply --local` alone can't build it from empty — migration `0001` indexes `scans`, but no migration ever CREATEs the base tables (`users`/`books`/`scans`/…); those live only in `schema.sql`. Symptoms of a wiped DB are `500 … no such table: user_field_definitions` on API calls and `migrations apply` failing with `no such table: main.scans`. To rebuild: (1) apply `schema.sql` minus its `CREATE TABLE d1_migrations` line (that table already exists) to create the ~0016 base; (2) `INSERT OR IGNORE INTO d1_migrations (name)` the filenames `0001…0016` so wrangler skips them — 0001–0004 must not re-run, since the snapshot's `scans` already uses `book_id` not the `isbn` those migrations index; (3) run `npx wrangler d1 migrations apply bookscan --local` to apply 0017+ on top; (4) optionally `npm run seed:dev`.

**Core tables:**

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`, `preferences` (TEXT, nullable — a JSON string→string blob of the user's UI preferences; opaque to the server, which only bounds its shape/size in `preferences.ts`. The frontend owns the key set via `src/stores/preferences.ts`)

**`books`** — deduplicated edition metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `physical_format`, `edition_name`, `physical_dimensions` (last three from OpenLibrary only; Google Books returns null), `categories` (JSON array, Google Books BISAC categories — used only as a fallback for `works.genres` when Wikidata has none), `is_featured` (INTEGER 0/1, DEFAULT 0 — manually flipped to hand-pick books for the landing page preview; see `GET /api/books/sample`), `fetched_at`, `work_id` → `works`

**`book_overrides`** — per-user field overrides: `user_id` → `users`, `book_id` → `books`, same nullable fields as `books` (except `author` — not overridable), `updated_at`. Unique on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (`unread` | `reading` | `read` | `dnf`), `owning_status` (`owned` | `unowned` | `want` | `lent_out`), `rating` (integer 0-10, nullable — unrated is the default, no `NOT NULL DEFAULT` unlike the other scan-level fields), `created_at`. Unique on `(user_id, book_id)`.

**FRBR-style works/series model** (added in migrations 0009–0011):

**`works`** — one row per logical work (groups editions): `match_key` (dedup key, `normalizeStr(title)|normalizeAuthorKey(primary-author)`), `wikidata_qid` (set after enrichment), `canonical_title`, `original_language`, `enrichment_status` (`pending` | `done` | `failed` | `exhausted` — the authoritative enrichment state), `next_retry_at` (when a `failed`/`exhausted` work is next due for a sweeper retry; NULL = due immediately; computed at failure time by `scheduleRetry` in `enrichment.ts`), `series_checked_at` (informational: last successful enrichment timestamp), `enrichment_failed_at` (informational: last failure timestamp; dynamic-typed TEXT in a `boolean`-declared column from migration 0010, harmless), `enrichment_failure_reason` (`timeout` | `rate_limited` | `http_5xx` | `network` | `other`, set by `classifyError` in `enrichment.ts`; drives `scheduleRetry`'s per-reason policy), `enrichment_attempts` (failure count; `scheduleRetry` caps retries per reason), `enrichment_schema_version` (INTEGER, DEFAULT 0 — see below), `genres`/`awards`/`nominations` (JSON arrays), `original_pub_date` (year string), `main_subject`, `form_of_work`, `language_of_work`, `language_of_work_code` (ISO 639-1 code via Wikidata P407→P218; stats-only — lets `stats.ts` compare languages by code instead of fragile English-label matching, with the label comparison as a fallback for works the sweeper hasn't backfilled yet), `first_line`, `epigraph`, `subtitle` (strings), `narrative_locations`/`countries_of_origin`/`translator`/`illustrator`/`characters` (JSON arrays), `openlibrary_work_id` (from Wikidata P648, drives edition discovery), `reference_page_count` (page count of the work's Wikidata reference edition P747→P1104; display-only fallback for editions with unknown page count), `editions_checked_at` (non-NULL = OpenLibrary edition discovery already ran)

**`authors`** — `normalized_name` (UNIQUE dedup key, `normalizeAuthorKey`), `name` (display form), `wikidata_qid`

Author identity keys come from `normalizeAuthorKey` (`editions.ts`), which is deliberately more aggressive than `normalizeStr`: it drops a trailing parenthetical qualifier, periods, and all whitespace, so `J. R. R. Tolkien` / `J.R.R. Tolkien` collapse to `jrrtolkien`. It only unifies names differing in _formatting_ — names differing in _content_ (`Mary Shelley` vs `Mary Wollstonecraft Shelley`, `村上春樹` vs `Haruki Murakami`) still key apart and converge later via `wikidata_qid` in `mergeWorks`. **The expression is duplicated in SQL in migration 0040**, which backfilled both columns and merged the rows that collided; keep the two in sync if you change it. Relatedly, `splitAuthors` excises parenthetical spans before splitting on `,` — qualifiers contain their own commas and used to produce fragment author rows.

**`work_authors`** — M:N between `works` and `authors`; `ordinal` (INTEGER) preserves credited author order (legacy rows all tie at 0)

**`series`** — `wikidata_qid` (UNIQUE), `canonical_name` (English/fallback)

**`series_names`** — localized series names: `(series_id, language)` PK

**`work_series`** — `(work_id, series_id)` PK, `ordinal` (REAL, supports decimal interludes like 5.5)

**`work_edition_isbns`** (migrations 0018/0020) — candidate ISBNs discovered for a work, decoupled from full metadata: `(work_id, isbn)` PK, plus lightweight display metadata (`title`, `language`, `cover_url`, `publish_date`, `publisher` — nullable, from a single batched OpenLibrary lookup at discovery time) and `source`. A row means "this ISBN is an edition of this work"; the full `books` row is only materialized when the user switches to that edition.

**`search_cache`** (migration 0038) — D1-backed global cache for `GET /api/books/search`/`guest-search` results: `query_key` (PK, the normalized title+author+publisher key), `response` (raw JSON body), `expires_at` (ms-epoch). Sits behind the per-colo Workers edge cache (`caches.default`) as a deployment-wide L1, so a title search is only repeated once per TTL across every colo, not once per colo. The cron sweeper prunes expired rows.

**Custom fields** (migration 0008):

**`user_field_definitions`** — per-user schema: `user_id`, `field_name`, `field_type` (`text`/`integer`/`select`/`tag`/`date`), `field_options`, `sort_order`, `required` (INTEGER 0/1, migration 0013). Unique on `(user_id, field_name)`.

**`book_custom_fields`** — per-user, per-book values: `user_id`, `book_id`, `field_def_id` → `user_field_definitions`, `field_value`. Unique on `(user_id, book_id, field_def_id)`.

`GET /api/scans` JOINs all tables and uses `COALESCE(book_overrides.field, books.field)` for each overridable field. `POST /api/scans` accepts only `isbn`; metadata and work links are resolved server-side (using `allowEmpty` so offline-queued scans always succeed). `DELETE /api/scans/:id` clears the user's `book_overrides` and `book_custom_fields` for that book, then deletes the scan.

### Wikidata enrichment pipeline

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWork(...))` after lookups and scans, and in the background via a cron sweeper (see below). It is intentionally skipped for guest lookups to avoid anonymous SPARQL load.

**Flow:** `enrichWork(db, workId, force?, apiKey?, source?)` (`source` is `scan` | `lookup` | `refresh` | `sweeper` | `unknown`, recorded in `enrichment_runs` for observability — see below) →

- If the work **already has a `wikidata_qid`** (a series-member placeholder, or a force-refresh): skip the search/merge and go straight to `fetchWorkDetails(workQid)`.
- Otherwise: `fetchBookInfo(title, author)` (SPARQL: title+author search → work QID + primary series) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as placeholder works with `wikidata_qid` + `canonical_title`) → `fetchWorkDetails(workQid)`.

Either path then calls `backfillEdition(db, workId, workQid, apiKey)` — for an identified work with no linked edition it resolves a representative ISBN from Wikidata (`P747` editions → `P212`/`P957`, preferring en/de), fetches metadata via `fetchBookMetadata`, and inserts a `books` row with `work_id` set directly. This gives unowned/placeholder works a cover so the series-completeness view renders them. If Wikidata linked an OpenLibrary work id (`P648`), `discoverEditionsFromOpenLibrary` then pre-populates `work_edition_isbns` from OpenLibrary's `works/{olid}/editions.json` (best-effort; only when the work has no candidate editions yet) — this covers works whose owned ISBN is unknown to OpenLibrary, where the user-triggered seed-ISBN discovery (`POST /api/works/:workId/editions/discover`) finds nothing; that route also falls back to the stored `openlibrary_work_id` when its seed-ISBN path comes up empty. Finally it writes genres/pub date/awards/nominations back to `works`.

**Merge logic:** If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints all `books`, `work_authors`, and `work_series` rows from the duplicate onto the canonical row and deletes the duplicate.

**Enrichment state machine:** `works.enrichment_status` is the authoritative state — `pending` (never enriched, or force-refresh in progress), `done` (enriched; a legitimate "not found on Wikidata" is also `done`, queryable via `wikidata_qid IS NULL`), `failed` (last run threw, retryable), `exhausted` (failed past its reason's attempt cap; still retried once per 2-day long cooldown so nothing is stuck forever). Retry scheduling happens **at failure time, in code**: `enrichWork`'s catch block calls `scheduleRetry(reason, attempts, retryAfter?)` (`enrichment.ts`, unit-tested) which applies the per-reason `RETRY_POLICY` (`rate_limited`: 5 min backoff / cap 5; `timeout`: 60 min / cap 3; `other`: 30 min / cap 2 — usually a bug, not transient; `http_5xx`/`network`: 30 min / cap 5), honors a longer Wikidata `Retry-After` hint, and writes `next_retry_at`. The API surface (`GET /api/scans`) maps `exhausted` → `failed` and only ever exposes `pending | done | failed`. In-flight claims use `enrichment_started_at` (atomic claim in `claimWork`, 5-min stale-claim TTL); `force=true` resets status to `pending` after winning the claim so polls see it. `series_checked_at`/`enrichment_failed_at` are informational timestamps only.

**Cron sweeper** (`worker/src/sweeper.ts`, `scheduled` handler exported from `index.ts`, cron `*/2 * * * *` in `wrangler.toml`): each tick first links up to `LINK_BATCH_SIZE` (5) books with no `work_id`, then enriches a bounded batch of `BATCH_SIZE` (7) from three indexed queries — Q1a: due works that at least one user holds a scan for (`EXISTS (books JOIN scans)`), capped at `BATCH_SIZE - 1` so placeholders still progress; Q1b: `enrichment_status != 'done' AND (next_retry_at IS NULL OR next_retry_at <= now)` (backlog + due retries, pending first), filling the remaining slots and deduped against Q1a; Q2: `enrichment_status = 'done' AND enrichment_schema_version < CURRENT_ENRICHMENT_SCHEMA_VERSION` (already enriched but missing newer Wikidata columns). Q2 is the backfill mechanism: when new columns are added to `works`, bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` (exported from `enrichment.ts`) and all existing enriched works drain through the sweeper automatically; a failed backfill moves the work to `failed`, so it drains through Q1 from then on. Runs sequentially with a short delay to stay polite to Wikidata, then prunes `enrichment_runs` rows older than 30 days. `POST /api/books/refresh` is the manual force-retry path.

**Observability — `enrichment_runs`:** every `enrichWork` call that actually attempts enrichment (not the "already enriched, skip" no-op) writes one row: `work_id`, `started_at`, `duration_ms`, `outcome` (`done` | `not_found` | `failed`), `failure_reason` (set only when `outcome = 'failed'`), `source`. Query it directly for pending/failure-rate/timing stats — there's no dashboard, this is a queryable log table, not a UI feature. Telemetry writes are best-effort (wrapped so a logging failure can't fail the enrichment itself).

**Adding new Wikidata fields:** (1) add `ALTER TABLE works ADD COLUMN` in a new migration, (2) bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` in `enrichment.ts`, (3) add the SPARQL subquery + `WorkDetails` field + `UPDATE works SET` binding, (4) add to `SCAN_SELECT` in `library-query.ts`, (5) JSON-parse in `attachCustomFields` if it's an array.
