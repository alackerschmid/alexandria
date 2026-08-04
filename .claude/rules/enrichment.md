---
paths:
  - "worker/src/enrichment.ts"
  - "worker/src/sweeper.ts"
  - "worker/src/editions.ts"
---

# Wikidata enrichment pipeline

Enrichment runs asynchronously via `c.executionCtx.waitUntil(enrichWorkDetached(...))` after
lookups and scans, and in the background via a cron sweeper. It is intentionally skipped for guest
lookups to avoid anonymous SPARQL load.

To add a new enriched field, use the `/add-api-column` skill — the step-by-step procedure lives
there.

## Flow

`enrichWork(db, workId, force, apiKey, source, usage)` (`source` is `scan` | `lookup` | `refresh` |
`sweeper` | `unknown`, recorded in `enrichment_runs` for observability; `usage` is the `api_usage`
recorder and is **required** — pass `null` only when there is deliberately nothing to count).
`enrichWorkDetached` is the wrapper the `waitUntil` call sites use: it owns and flushes its own
recorder, because `usageMiddleware`'s flush has already fired by then. The sweeper calls
`enrichWork` directly, with one recorder for the whole tick →

- If the work **already has a `wikidata_qid`** (a series-member placeholder, or a
  force-refresh): skip the search/merge and go straight to `fetchWorkDetails(workQid)`.
- Otherwise: `fetchBookInfo(title, author)` (SPARQL: title+author search → **verified** work QID +
  primary series — see "Which QID counts as this book's"; a search hit no label confirms is treated
  as not found) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as
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

## Which QID counts as this book's

`fetchBookInfo`'s SPARQL is an **mwapi full-text search ranked by text relevance**, so its top hit
is only a candidate. Accepting it unverified is what merged distinct books onto one work — the
sequel ("The Monster Baru Cormorant" → the Traitor item), the German sequel title ("Der Herr des
Wüstenplaneten" → Dune), the duology item ("Ilium/Olympos"), the novel series ("Star wars - Wächter
der Macht" → *Legacy of the Force*) and a Wikipedia list article ("James Bond 007" → *list of James
Bond films*). Two guards, both needed — neither catches all five:

- **Type**: `FILTER NOT EXISTS` on `P31/P279*` → `Q7725310` (series of creative works) and on
  `P31` → `Q13406463` (Wikimedia list article). The existing `P31/P279* Q47461344` allow-filter
  cannot do this: Wikidata puts book, novel *and* film series **under** written work (verified —
  Q277759, Q1667921 and Q24856 all reach Q47461344), which is why series items passed for so long.

  **The type test is blunt on purpose, and must stay that way.** It over-rejects: a single novel
  Wikidata *additionally* types as a trilogy/dylogy/limited series is thrown out with the series —
  Cryptonomicon and Reamde (literary work + literary trilogy/dylogy), Watchmen (literary work +
  limited series) and Daemon (written work + novel series) all resolved correctly before it shipped
  and were silently unresolvable after. **Do not fix that by weakening the type test.** It cannot be
  done: Daemon's type set is *identical* to that of genuine series (Q1195086 "The Once and Future
  King", Q60969361 "Beartown"). Measured against live Wikidata, "at least one non-series type"
  readmits **1048** series items — Q464928 "Auf der Suche nach der verlorenen Zeit" among them,
  whose German label then verifies at 1.000 against any volume titled with it — and adding a
  direct-membership check for the unambiguous series classes still leaves 115 (Q182099 "Xanth", 46
  volumes). Structural signals don't separate them either: Cryptonomicon has 3 `P527` parts and 3
  items pointing at it with `P179`, the same shape as a real trilogy.

  **The exception lives in the label instead.** When the strict pass finds nothing, `fetchBookInfo`
  runs once more with `{ exactOnly: true }` — type filter dropped, and `pickExactQid` accepts a
  candidate only on **exact** normalized title equality (`exactTitleMatcher` in `title-match.ts`, no
  prefix containment, no bigram tolerance). All four books match their item's label exactly; a volume
  never matches its series, because the ordinal it carries is the difference. This cannot reintroduce
  the merge: two works can only both match one label exactly if their normalized titles are equal,
  and `workMatchKey` (title|author) has already made those one work before enrichment runs. The retry
  deliberately uses the **original** title, never the stripped one — stripping the ordinal is exactly
  what would turn a volume into an exact match for its series. It costs one extra SPARQL call, only
  on the path that was about to return "not found".
- **Label**: `pickVerifiedQid` (pure, unit-tested) takes the first candidate, in rank order, one of
  whose labels **or aliases** clears `QID_TITLE_THRESHOLD` (0.85) against the searched title via
  `titleScorer`. Labels are fetched in **every** language on purpose: the good cross-language
  merge ("Unendlicher Spaß" → Q1077445 *Infinite Jest*) happens through the item's German label, so
  an en/de restriction would reject correct hits in other languages. The threshold sits in a
  measured gap — tightest correct hit 0.909, closest wrong one 0.732. The all-language labels query
  is only the **fallback**: the search query carries each hit's en/de labels itself (no row
  multiplication — one label per language), and a top-ranked candidate they verify is accepted
  without the extra round trip, which keeps the sweeper's subrequest budget where its `BATCH_SIZE`
  comment assumes. Only a *top-ranked* fast hit is decisive — a lower-ranked one still goes through
  the full fetch, since a higher-ranked candidate could verify through another language and rank
  order must win.

Nothing matching is a normal outcome: it stores nulls and lands on `done` with `wikidata_qid IS
NULL`, which is strictly better than a confidently wrong merge. Note that `ILIUM` vs "Ilium/Olympos"
scores **1.000** under `titleScorer` (prefix containment), so the type guard is the only thing
rejecting Q692326 on the strict pass — and `exactTitleMatcher` is the only reason the `exactOnly`
retry can safely drop that guard, since it scores the same pair as no match at all.

## Merge logic

If `fetchBookInfo` returns a QID already assigned to another work row, `mergeWorks` repoints
all `books`, `work_authors`, `work_series`, `work_edition_isbns` and `work_ratings` rows from
the duplicate onto the canonical row and deletes the duplicate.

`mergeWorks` is destructive and trusts the QID completely, so **the verification above is the only
thing standing between a bad search hit and two books permanently sharing one reading status, one
rating and one card.** `worker/scripts/repair-merged-works.mjs` splits works already merged this way
— it writes nothing, emitting reviewable SQL from an explicit per-work plan (the sign-off surface).

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

`GET /api/admin/overview` reads a 24h summary of it (outcome counts, failure reasons, avg + p95
duration) for the `/admin` board's vitals panel — the table's only read surface. Everything else
is a direct query. A busy day writes ~5k rows (`BATCH_SIZE` × 30 × 24), so any new read has to
aggregate in SQL rather than pull the rows out. Telemetry writes are best-effort (wrapped so a
logging failure can't fail the enrichment itself).

`MAX(created_at)` over the whole table is also the board's **liveness signal for the cron**: paired
with a count of currently-due works, it's the only way to tell a stalled sweeper from a draining
backlog, since `works.enrichment_status` reads `pending` in both cases. So a change that stops
writing a run row per processed work — batching them, sampling them, or skipping the `not_found`
case — silently blinds that check as well as the stats.

## Work identity before Wikidata (`editions.ts`)

`workMatchKey` (pure, unit-tested) is the key two editions must share to be one work before a QID
exists: `normalizeStr(title)|normalizeAuthorKey(firstAuthor)`, **but only when both halves are
present**. Title alone is not identity — German series volumes are routinely catalogued under the
series name rather than the volume's, six editions titled "Star wars - Wächter der Macht" with no
author on the row, and a title-only key made them one work. An edition missing either half is keyed
`isbn:<isbn>|<authorKey>` instead, i.e. it stands alone until enrichment can group it deliberately.
That fallback keeps the `|<authorKey>` suffix a titleless edition already had, so rows linked under
the old key still resolve to their work.

This does **not** cover same-titled volumes that do carry an author (three Fleming novels all
catalogued "James Bond 007" still collapse) — nothing local distinguishes those from three editions
of one book. Correcting `books.title` is the only real fix there.

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
