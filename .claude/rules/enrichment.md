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
- Otherwise: `fetchBookInfo(title, author, searchCache)` (**three requests** — entity search, filter,
  hydrate; see "How `fetchBookInfo` finds candidates" below — → **verified** work QID + primary
  series, per "Which QID counts as this book's"; a search hit no label confirms is treated as not
  found) → `upsertSeries` + `populateSeriesMembers` (fills in all series entries as placeholder works
  with `wikidata_qid` + `canonical_title`) → `fetchWorkDetails(workQid)`.

  `resolveWorkIdentity` makes up to three passes (original title → paren-stripped title →
  `exactOnly`) and threads **one `searchCache`** through all of them, so the author search (identical
  every pass) and the title search (identical in passes 1 and 3) cost one request each rather than
  one per pass.

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

## How `fetchBookInfo` finds candidates — three requests, never one federated query

The title→QID lookup is **an Action API search, then a filter query, then a hydrate query**, and it
must stay that shape:

1. `searchEntityQids` — mwapi `list=search` against `https://www.wikidata.org/w/api.php`, `srlimit`
   `ENTITY_SEARCH_LIMIT` (50). Twice, in parallel: the title, and the author narrowed with
   `haswbstatement:P31=Q5`. Counted as `entity_search`.
2. **filter** (`book_search`) — `VALUES ?work { … }` over those QIDs with the type allow-filter, the
   two `FILTER NOT EXISTS` guards and the author inner join. **No `OPTIONAL`s**, so nothing
   multiplies across 50 candidates. The first `MAX_CANDIDATES` (10) survivors, *in search-rank
   order*, go on.
3. **hydrate** (`book_hydrate`) — labels and the series statement for those ≤10 only.

**This used to be one query with `SERVICE wikibase:mwapi` inside it, and that is what made 28 works
permanently unenrichable.** The federated form streams every hit the search can find into the
surrounding `P31/P279*` walk — hits ranked past 800 were observed for "Macbeth" — and the trailing
`LIMIT 10` only applies once all of it is done. Measured against live Wikidata: Macbeth 37.7–53.4s
(three runs, all successful), Meditations >65s, The Iliad an HTTP 502 — against `runSparql`'s 25s
abort. The queries were never unanswerable; the worker was giving up less than half way through, and
`wikidata_qid IS NULL` on those rows meant "never collected", not "no match".

Two things that look like fixes and are not: `mwapi:srlimit` inside the SERVICE (tried at 20/5/3 —
all still exceeded 65s, so the federation itself is the cost, not the candidate count), and dropping
the `FILTER NOT EXISTS` guards (38.9s, still over budget, and those guards are load-bearing — see
below). Splitting it gives ~4–10s for the same answers, and a title that already worked went
17.0s → 4.3s.

Why the split is also three requests rather than two: hydrating all 50 candidates in one VALUES query
costs 22–23s (Sphere, Siddhartha) because the label and series `OPTIONAL`s multiply; filtering first
and hydrating ten costs ~7s for the same result. Searching only 10 deep instead would be faster still
and **wrong** — the novel *Sphere* and Hesse's *Siddhartha* both sit outside the top ten entity hits
for their own titles, behind the shape, the concept and the place.

Consequences worth keeping in mind:

- **Rank order comes from the search, not from a SPARQL response.** A `VALUES` query returns
  solutions in any order it likes and `pickVerifiedQid` takes the *first* candidate that verifies, so
  the order is carried in the QID array. Reading it back off the response would make the same book
  enrich differently on two runs.
- **No user text reaches a SPARQL query any more** — the searched strings go into an Action API URL
  via `encodeURIComponent`, and the only thing interpolated into a query is a QID already checked
  against `/^Q\d+$/`. `escapeSparql` is gone; don't reintroduce interpolation without it.
- The author join stays an **inner** join on the searched author's items. It is not redundant next to
  the label check: `titleScorer`'s prefix-containment shortcut scores "Meditations" 1.000 against
  *Meditations on First Philosophy*, so the author is the only thing telling Marcus Aurelius from
  Descartes.

## Which QID counts as this book's

The candidate list arrives **ranked by mwapi text relevance**, so its top hit
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
  is only the **fallback**: the **hydrate** request (step 3 above) carries each candidate's en/de
  labels itself (no row multiplication — one label per language), and a top-ranked candidate they
  verify is accepted without the extra round trip, which is one request saved out of the ~6 a
  resolving work now spends — see `BATCH_SIZE`'s recount in `sweeper.ts`. Only a *top-ranked* fast hit
  is decisive — a lower-ranked one still goes through the full fetch, since a higher-ranked candidate
  could verify through another language and rank order must win.

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

**Q2 is also how a flaked best-effort step gets retried.** `backfillEdition` runs its own
`edition_isbn` SPARQL query and so has a real transient failure mode, but it must not fail the
enrichment — a flake there would discard a complete Wikidata read and advance the work toward
`exhausted`. Nor may it simply be swallowed: `persistWorkDetails` would then book the work `done`
at the current schema version, and *neither* Q1 (status != 'done') nor Q2 (schema < current) ever
serves it again, so one WDQS 502 costs a placeholder work its cover edition permanently — with no
manual route back either, since `POST /api/books/refresh` 404s on a work with no `books` row. So
`backfillEditionsAndDiscovery` reports the failure and `persistWorkDetails` writes
`CURRENT_ENRICHMENT_SCHEMA_VERSION - 1`: the run is a success, the attempt counter stays at zero,
and the next tick picks the work up through Q2 to retry the backfill alone. Discovery is not
reported the same way — it is gated on the work having no candidate editions yet, so it retries
on its own.

Runs sequentially with a short delay to stay polite to Wikidata, then prunes `enrichment_runs`
rows older than 30 days. `POST /api/books/refresh` is the manual force-retry path.

**The tick has a fourth phase that is not enrichment: `localizeCovers` (`covers.ts`).** It pulls up
to `COVER_BATCH_SIZE` (5) book covers into R2 so the library stops hot-linking them from Google —
see `worker/CLAUDE.md` for the route that serves them. It runs **last and takes only what
enrichment left** (`SUBREQUEST_BUDGET - usage.externalCalls`), because a pending badge is something
a user is watching and a cover arriving two minutes later is invisible. It needs no `fitsInBudget`
worst case: a cover is exactly one fetch, so the remaining allowance *is* the batch size. It is
isolated in its own `try`, so a bucket or upstream failure costs neither the usage flush nor the
prune — there is nothing to retry either way, since the books simply stay due.

**The tick meters its own subrequests; `BATCH_SIZE` does not bound them.** Free-plan Workers get **50
external subrequests per invocation** (Cloudflare services like D1 have a separate 1,000, so the
tick's queries don't compete). Per-work cost varies ~10x — a work that already has a QID skips the
search entirely at ~1-2 calls, which is the whole schema-backfill population; one needing identity
costs ~6-7; a pathological one ~15 — so a fixed work count is the wrong instrument. `fitsInBudget`
(unit-tested) checks `UsageRecorder.externalCalls` before each work and stops the batch when the next
one's worst case wouldn't fit, leaving the rest due for the next tick.

Two properties that are load-bearing:

- **It stops *before* an overrun, not after.** An overrun throws mid-enrichment and `enrichWork` books
  that as a failure — a healthy work marked `failed` with its attempt count advanced toward
  `exhausted`, for no reason but our arithmetic. A work left unstarted is simply still due.
- **The meter lives in the fetch helpers** (`fetchWithTimeout`, `fetchWikidataJson`), not at their
  call sites, so a new outbound call cannot forget to be counted. It is deliberately *not* the
  `api_usage` counters: those count units of work at the granularity the board reads, which is not
  1:1 with requests (`fetchOpenLibraryBibkey` makes two fetches and records one; the OpenLibrary
  work-description read records nothing), so metering off them would undercount.

**The sweeper has a Google Books budget; interactive paths do not.** `backfillEdition` is the one
place enrichment spends the metered daily quota, and the backlog it serves is self-amplifying, so
past `SWEEPER_GOOGLE_BOOKS_BUDGET` (700 of 1,000/day, checked via `googleBooksCallsToday`) a
`source === "sweeper"` backfill drops the Google half by withholding the API key — OpenLibrary
alone still usually yields a cover, and a total miss leaves no `books` row, so the backfill is
retried by any later run. Never extend this gate to a path a user is waiting on: reserving the
remainder for the scanner's and import wizard's title search is the entire point of it.

## Observability — `enrichment_runs`

Every `enrichWork` call that actually attempts enrichment (not the "already enriched, skip"
no-op) writes one row: `work_id`, `started_at`, `duration_ms`, `outcome`
(`done` | `not_found` | `failed`), `failure_reason` (set only when `outcome = 'failed'`),
`source`. That includes the awkward path where a run merges two works and *then* loses the
post-merge re-claim: it records `done` against the surviving work — same as when it wins the
re-claim — rather than returning silently, because a run that performed a destructive merge is the
last one that should be missing from the history.

Two endpoints read it, both for the `/admin` board: `GET /api/admin/overview` takes a 24h **summary**
(outcome counts, failure reasons, avg + p95 duration) for the vitals panel, and
`GET /api/admin/runs` returns the **individual rows** behind one of those failure counts, for the
drill-down the panel's counts open. Everything else is a direct query.

A busy day writes ~5k rows (`BATCH_SIZE` × 30 × 24), so an **aggregate** read has to aggregate in SQL
rather than pull the rows out — that is what `/overview` does. A row-level read is fine, but it must
be bounded and ordered: `/runs` filters to one outcome inside the 24h window, orders by the indexed
`created_at` and caps at `MAX_LIST_LIMIT`. Both routes share the window constant so the list and the
count that opens it can't be measuring different spans. Telemetry writes are best-effort (wrapped so
a logging failure can't fail the enrichment itself).

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
