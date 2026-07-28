# Database schema (`worker/migrations/`)

Table-by-table D1 schema. Loaded when working under `worker/migrations/`.
For routes, key modules and the enrichment pipeline see `worker/CLAUDE.md`.
Rebuilding an empty/wiped local D1 is the `/troubleshooting` skill.

Migrations in `worker/migrations/` are authoritative for the schema. `worker/schema.sql` is **not** the initial state — it's a `sqlite3 .dump` snapshot frozen at ~migration 0016 (it already carries later columns like `firstname`, `physical_format`, and the works enrichment fields), so treat it as stale relative to the current migrations.

**Core tables:**

**`users`** — `id`, `email` (UNIQUE), `password_hash`, `firstname`, `preferences` (TEXT, nullable — a JSON string→string blob of the user's UI preferences; opaque to the server, which only bounds its shape/size in `preferences.ts`. The frontend owns the key set via `src/stores/preferences.ts`)

**`books`** — deduplicated edition metadata keyed by ISBN: `id`, `isbn` (UNIQUE), `title`, `author`, `cover_url`, `language`, `publish_date`, `number_of_pages_median`, `description`, `publisher`, `physical_format`, `edition_name`, `physical_dimensions` (last three from OpenLibrary only; Google Books returns null), `categories` (JSON array, Google Books BISAC categories — used only as a fallback for `works.genres` when Wikidata has none), `is_featured` (INTEGER 0/1, DEFAULT 0 — manually flipped to hand-pick books for the landing page preview; see `GET /api/books/sample`), `fetched_at`, `work_id` → `works`

**`book_overrides`** — per-user field overrides: `user_id` → `users`, `book_id` → `books`, same nullable fields as `books` (except `author` — not overridable), `updated_at`. Unique on `(user_id, book_id)`.

**`scans`** — per-user library entries: `id`, `user_id` → `users`, `book_id` → `books`, `status` (`unread` | `reading` | `read` | `dnf`), `owning_status` (`owned` | `unowned` | `want` | `lent_out` | `unknown` — column is `NOT NULL DEFAULT 'owned'`, right for a scan of a book in your hands; `unknown` is the explicit no-assertion state written by the Goodreads import and is excluded from every `IN ('owned','lent_out')` ownership gate, i.e. series completeness and the ownership stats), `created_at`. Unique on `(user_id, book_id)` — **not on the work**, so a user can legitimately own two editions of the same work. `rating` is a **dead column** as of migration 0042: ratings moved to `work_ratings` and nothing reads or writes it any more. Dropping it is deliberately held back to a follow-up migration (`ALTER TABLE scans DROP COLUMN rating`) — `.github/workflows/deploy.yml` applies migrations *before* `wrangler deploy`, so dropping it in the same release would leave the still-live old worker selecting a column that no longer exists.

**`work_ratings`** (migration 0042) — the user's rating and review of a **work**, not of a copy: `(user_id, work_id)` PK, `rating` (INTEGER 0-10 via CHECK, nullable), `review` (TEXT, nullable — markdown source, stored verbatim and rendered/sanitized client-side), `updated_at`. `works` is global and shared across users, so per-user values can't be columns on it; this is the join table. `buildScanSelect` LEFT JOINs it, which is why every owned edition of a work reports the same rating/review and the collapsed work-card can't disagree with the edition carousel. Rows outlive the scan — deleting a book from the library keeps the rating and review, so re-adding it restores both — and die only with the user, via `ON DELETE CASCADE` on `user_id`. **`work_id` deliberately has no `ON DELETE` clause** (mirroring `books.work_id`): `mergeWorks` ends in `DELETE FROM works`, and a cascade there would silently destroy the losing work's ratings, so instead the FK fails the batch unless `mergeWorks`' repoint stanza runs first. Written only through `upsertWorkRating` (`library-query.ts`), whose `seed` vs `overwrite` modes decide whether a supplied value fills a gap or wins outright.

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
