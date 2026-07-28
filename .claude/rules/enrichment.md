---
paths:
  - "worker/src/enrichment.ts"
  - "worker/src/sweeper.ts"
  - "worker/src/editions.ts"
---

# Wikidata enrichment pipeline

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWork(...))` after lookups
and scans, and in the background via a cron sweeper. It is intentionally skipped for guest
lookups to avoid anonymous SPARQL load.

To add a new enriched field, use the `/add-api-column` skill — the step-by-step procedure lives
there.

## Flow

`enrichWork(db, workId, force?, apiKey?, source?)` (`source` is `scan` | `lookup` | `refresh` |
`sweeper` | `unknown`, recorded in `enrichment_runs` for observability) →

- If the work **already has a `wikidata_qid`** (a series-member placeholder, or a
  force-refresh): skip the search/merge and go straight to `fetchWorkDetails(workQid)`.
- Otherwise: `fetchBookInfo(title, author)` (SPARQL: title+author search → work QID + primary
  series) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as
  placeholder works with `wikidata_qid` + `canonical_title`) → `fetchWorkDetails(workQid)`.

Either path then calls `backfillEdition(db, workId, workQid, apiKey)` — for an identified work
with no linked edition it resolves a representative ISBN from Wikidata (`P747` editions →
`P212`/`P957`, preferring en/de), fetches metadata via `fetchBookMetadata`, and inserts a
`books` row with `work_id` set directly. This gives unowned/placeholder works a cover so the
series-completeness view renders them.

If Wikidata linked an OpenLibrary work id (`P648`), `discoverEditionsFromOpenLibrary` then
pre-populates `work_edition_isbns` from OpenLibrary's `works/{olid}/editions.json`
(best-effort; only when the work has no candidate editions yet) — this covers works whose
owned ISBN is unknown to OpenLibrary, where the user-triggered seed-ISBN discovery
(`POST /api/works/:workId/editions/discover`) finds nothing; that route also falls back to the
stored `openlibrary_work_id` when its seed-ISBN path comes up empty.

Finally it writes genres/pub date/awards/nominations back to `works`.

## Merge logic

If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints
all `books`, `work_authors`, `work_series`, `work_edition_isbns` and `work_ratings` rows from
the duplicate onto the canonical row and deletes the duplicate.

`work_ratings` is the only one where a collision is *lossy* rather than redundant (the user may
have rated the English edition's work and reviewed the German one's before enrichment
discovered they're the same book), so it merges field by field: a field the survivor lacks is
taken from the loser, and a genuine both-non-NULL conflict goes to the more recent
`updated_at`.

**The repoint must stay ahead of the final `DELETE FROM works`** — that ordering is what
`work_ratings.work_id`'s missing `ON DELETE` clause enforces.

## State machine

`works.enrichment_status` is the authoritative state:

- `pending` — never enriched, or force-refresh in progress
- `done` — enriched. A legitimate "not found on Wikidata" is also `done`, queryable via
  `wikidata_qid IS NULL`
- `failed` — last run threw, retryable
- `exhausted` — failed past its reason's attempt cap; still retried once per 2-day long
  cooldown so nothing is stuck forever

Retry scheduling happens **at failure time, in code**: `enrichWork`'s catch block calls
`scheduleRetry(reason, attempts, retryAfter?)` (unit-tested) which applies the per-reason
`RETRY_POLICY` (`rate_limited`: 5 min backoff / cap 5; `timeout`: 60 min / cap 3; `other`:
30 min / cap 2 — usually a bug, not transient; `http_5xx`/`network`: 30 min / cap 5), honors a
longer Wikidata `Retry-After` hint, and writes `next_retry_at`.

The API surface (`GET /api/scans`) maps `exhausted` → `failed` and only ever exposes
`pending | done | failed`.

In-flight claims use `enrichment_started_at` (atomic claim in `claimWork`, 5-min stale-claim
TTL); `force=true` resets status to `pending` after winning the claim so polls see it.
`series_checked_at`/`enrichment_failed_at` are informational timestamps only.

## Cron sweeper

`worker/src/sweeper.ts`, `scheduled` handler exported from `index.ts`, cron `*/2 * * * *` in
`wrangler.toml`. Each tick first links up to `LINK_BATCH_SIZE` (5) books with no `work_id`,
then enriches a bounded batch of `BATCH_SIZE` (7) from three indexed queries:

- **Q1a** — due works that at least one user holds a scan for (`EXISTS (books JOIN scans)`),
  capped at `BATCH_SIZE - 1` so placeholders still progress
- **Q1b** — `enrichment_status != 'done' AND (next_retry_at IS NULL OR next_retry_at <= now)`
  (backlog + due retries, pending first), filling the remaining slots and deduped against Q1a
- **Q2** — `enrichment_status = 'done' AND enrichment_schema_version < CURRENT_ENRICHMENT_SCHEMA_VERSION`
  (already enriched but missing newer Wikidata columns)

Q2 is the backfill mechanism: when new columns are added to `works`, bump
`CURRENT_ENRICHMENT_SCHEMA_VERSION` (exported from `enrichment.ts`) and all existing enriched
works drain through the sweeper automatically; a failed backfill moves the work to `failed`, so
it drains through Q1 from then on.

Runs sequentially with a short delay to stay polite to Wikidata, then prunes `enrichment_runs`
rows older than 30 days. `POST /api/books/refresh` is the manual force-retry path.

## Observability — `enrichment_runs`

Every `enrichWork` call that actually attempts enrichment (not the "already enriched, skip"
no-op) writes one row: `work_id`, `started_at`, `duration_ms`, `outcome`
(`done` | `not_found` | `failed`), `failure_reason` (set only when `outcome = 'failed'`),
`source`.

Query it directly for pending/failure-rate/timing stats — there's no dashboard, this is a
queryable log table, not a UI feature. Telemetry writes are best-effort (wrapped so a logging
failure can't fail the enrichment itself).

## Author identity (`editions.ts`)

Author identity keys come from `normalizeAuthorKey`, which is deliberately more aggressive than
`normalizeStr`: it drops a trailing parenthetical qualifier, periods, and all whitespace, so
`J. R. R. Tolkien` / `J.R.R. Tolkien` collapse to `jrrtolkien`. It only unifies names differing
in _formatting_ — names differing in _content_ (`Mary Shelley` vs `Mary Wollstonecraft
Shelley`, `村上春樹` vs `Haruki Murakami`) still key apart and converge later via
`wikidata_qid` in `mergeWorks`.

**The expression is duplicated in SQL in migration 0040**, which backfilled both columns and
merged the rows that collided; keep the two in sync if you change it.

Relatedly, `splitAuthors` excises parenthetical spans before splitting on `,` — qualifiers
contain their own commas and used to produce fragment author rows.
