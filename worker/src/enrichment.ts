import type { WorkRow, WorkDetails, SeriesHit } from "./types";
import {
  splitAuthors,
  materializeEdition,
  normalizeAuthorKey,
  discoverEditionsFromOpenLibrary,
} from "./editions";
import { exactTitleMatcher, titleScorer } from "./title-match";
import {
  googleBooksCallsToday,
  outcomeForStatus,
  UsageRecorder,
} from "./usage";

// Bump this whenever fetchWorkDetails fetches new columns. The sweeper uses it to re-enrich
// works that were enriched with an older schema and are missing the new fields.
export const CURRENT_ENRICHMENT_SCHEMA_VERSION = 5;

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_UA =
  "BookScan/1.0 (https://bookscan.pages.dev; contact@bookscan.pages.dev)";

export type FailureReason =
  "timeout" | "rate_limited" | "http_5xx" | "network" | "other";

// Which SPARQL query a `runSparql` call is, for the `api_usage` counters. One per query function,
// matching the cost profile the sweeper's BATCH_SIZE comment reasons about.
type SparqlOperation =
  | "book_search"
  | "labels"
  | "work_details"
  | "series_members"
  | "edition_isbn";

// Per-reason retry policy, applied by scheduleRetry at failure time. Typed as
// Record<FailureReason, ...> so adding a new FailureReason value is a compile error here
// until a policy is assigned.
//   - rate_limited: Wikidata is just asking us to slow down — retry soon (5 min), default cap.
//   - timeout: a work that repeatedly times out is unlikely to resolve quickly — wait longer
//     (60 min), tighter cap (3) so we don't keep spending subrequests on a consistently slow query.
//   - other: an unexpected HTTP status from Wikidata itself — usually a query bug, not transient —
//     tight cap (2) so we don't hammer a hopeless case.
//   - network / http_5xx: infrastructure-adjacent, not evidence of a hopeless work — default policy.
export const RETRY_POLICY: Record<
  FailureReason,
  { capAttempts: number; backoffMinutes: number; transient: boolean }
> = {
  rate_limited: { capAttempts: 5, backoffMinutes: 5, transient: true },
  timeout: { capAttempts: 3, backoffMinutes: 60, transient: true },
  other: { capAttempts: 2, backoffMinutes: 30, transient: false },
  http_5xx: { capAttempts: 5, backoffMinutes: 30, transient: true },
  network: { capAttempts: 5, backoffMinutes: 30, transient: true },
};

/**
 * Whether a stored `failure_reason` means upstream pressure rather than a broken query — the same
 * split the caps and backoffs above are reasoned from. Takes a plain string because it reads rows
 * out of `enrichment_runs`, where an older build's reason can survive; anything unrecognised is
 * treated as a query bug, which is the reading that gets looked at rather than waited out.
 */
export const isTransientFailure = (reason: string): boolean =>
  RETRY_POLICY[reason as FailureReason]?.transient ?? false;

// Backstop past the per-reason caps: a work that has exhausted its cap (e.g. a genuinely bad
// title/author match that will never resolve) is marked 'exhausted' rather than dropped —
// it still gets one retry per long cooldown, so nothing is ever stuck forever without an
// automated path back in. Manual POST /api/books/refresh remains the immediate force path.
export const LONG_COOLDOWN_MINUTES = 2 * 24 * 60;

// Decides, at failure time, when a work is next due for a sweeper retry. `attempts` is the
// total failure count *including* the failure being recorded. A Retry-After hint from Wikidata
// overrides the policy backoff when it asks for a longer wait (never a shorter one — the policy
// backoff also spaces out our own load). Pure — unit-tested in test/enrichment.spec.ts.
export function scheduleRetry(
  reason: FailureReason,
  attempts: number,
  retryAfterSeconds?: number,
): { status: "failed" | "exhausted"; nextRetryMinutes: number } {
  const policy = RETRY_POLICY[reason];
  if (attempts >= policy.capAttempts)
    return { status: "exhausted", nextRetryMinutes: LONG_COOLDOWN_MINUTES };
  const hintMinutes = retryAfterSeconds ? Math.ceil(retryAfterSeconds / 60) : 0;
  return {
    status: "failed",
    nextRetryMinutes: Math.max(policy.backoffMinutes, hintMinutes),
  };
}

// Thrown by runSparql with a classified `kind` so enrichWork's catch block can record *why*
// enrichment failed (enrichment_failure_reason) instead of lumping every failure together.
// retryAfterSeconds carries Wikidata's Retry-After hint on a final 429, so scheduleRetry can
// honor the server's own suggested wait. Exported for unit testing classifyError below.
export class SparqlError extends Error {
  kind: FailureReason;
  retryAfterSeconds?: number;
  constructor(
    message: string,
    kind: FailureReason,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "SparqlError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Only a SparqlError (thrown by runSparql) carries a real classification — an unexpected HTTP
// status from Wikidata itself is 'other' territory (usually a query bug). Anything else (a D1
// exception from mergeWorks/upsertSeries/populateSeriesMembers, etc.) is infrastructure-adjacent
// noise, not evidence of a hopeless work, so it gets the lenient default policy ('network') rather
// than 'other's tight 2-attempt cap.
export function classifyError(e: unknown): FailureReason {
  return e instanceof SparqlError ? e.kind : "network";
}

function escapeSparql(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, String.raw`\"`)
    .replace(/\n/g, String.raw`\n`)
    .replace(/\r/g, String.raw`\r`);
}

function qidFromUri(uri: string | undefined): string | null {
  return uri ? (uri.split("/").pop() ?? null) : null;
}

function parseOrdinal(v: string | undefined): number | null {
  return v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null;
}

// Returns [] when the query succeeds but has no results.
// Throws on network errors, timeouts, or HTTP errors — callers should let this propagate
// so enrichWork's catch block can set enrichment_failed_at (retryable) rather than
// treating the failure as a permanent "not found" (which would set series_checked_at).
async function runSparql(
  usage: UsageRecorder | null | undefined,
  operation: SparqlOperation,
  query: string,
  timeoutMs = 25_000,
): Promise<any[]> {
  const url = `${WIKIDATA_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`;
  console.log(
    "[SPARQL] Running query:",
    query.replace(/\s+/g, " ").trim().slice(0, 200),
  );
  const once = async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        headers: {
          "User-Agent": WIKIDATA_UA,
          Accept: "application/sparql-results+json",
        },
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError")
        throw new SparqlError(
          `[SPARQL] timed out after ${timeoutMs}ms`,
          "timeout",
        );
      throw new SparqlError(
        `[SPARQL] network error: ${e?.message ?? e}`,
        "network",
      );
    } finally {
      clearTimeout(t);
    }
  };
  // Counted per attempt, so the 429-then-retry below shows up as a rate_limited *and* whatever
  // the retry produced — two requests really did go to Wikidata, and the 429 is the signal worth
  // keeping. `once` only throws on timeout/network, both plain errors as far as the counter goes.
  const attempt = async () => {
    try {
      const res = await once();
      usage?.record("wikidata", operation, outcomeForStatus(res.status));
      return res;
    } catch (e) {
      usage?.record("wikidata", operation, "error");
      throw e;
    }
  };

  let res = await attempt();
  if (res.status === 429) {
    const retry = Number(res.headers.get("Retry-After")) || 5;
    console.warn(`[SPARQL] Rate limited (HTTP 429), retrying after ${retry}s`);
    await new Promise((r) => setTimeout(r, Math.min(retry, 10) * 1000));
    res = await attempt();
  }
  if (!res.ok) {
    const kind: FailureReason =
      res.status === 429
        ? "rate_limited"
        : res.status >= 500
          ? "http_5xx"
          : "other";
    const retryAfter =
      res.status === 429
        ? Number(res.headers.get("Retry-After")) || undefined
        : undefined;
    throw new SparqlError(
      `[SPARQL] HTTP ${res.status} ${res.statusText}`,
      kind,
      retryAfter,
    );
  }
  const data: any = await res.json();
  const rows: any[] = data?.results?.bindings ?? [];
  console.log(`[SPARQL] Got ${rows.length} rows`);
  return rows;
}

// Title (+ optional author) → matched work QID and its primary series, if any.
// Wikidata's own class graph puts book, novel and film series *under* written work (verified:
// Q277759 "book series", Q1667921 "novel series" and Q24856 "film series" all reach Q47461344 through
// P279*), so the P31 allow-filter below cannot tell a series item from a single book. That matters
// because a German edition is often catalogued under its *series* name — six volumes all titled
// "Star wars - Wächter der Macht" — and the series item then outranks every real book in the text
// search, after which mergeWorks collapses six distinct volumes onto one QID.
//
// So the default pass rejects an item if **any** of its P31 types reaches Q7725310. That is
// deliberately blunt, and it over-rejects: a single novel Wikidata *additionally* types as a
// trilogy/dylogy/limited series is thrown out with the series. Four of this library's own works
// failed exactly that way — Cryptonomicon and Reamde (P31 literary work + literary trilogy/dylogy),
// Watchmen (literary work + limited series) and Daemon (written work + novel series).
//
// **Do not try to fix that by weakening the type test.** It cannot be done: Daemon's type set
// (written work + novel series) is *identical* to that of genuine series like Q1195086 "The Once and
// Future King" and Q60969361 "Beartown", and a rule admitting one admits the other. Measured against
// live Wikidata: "at least one non-series type" readmits 1048 series items (Q464928 "Auf der Suche
// nach der verlorenen Zeit" among them, whose German label then verifies at 1.000 against a volume
// titled with it); adding a direct-membership check for the unambiguous series classes still leaves
// 115 (Q182099 "Xanth", 46 volumes). Structural signals don't separate them either — Cryptonomicon
// has 3 P527 parts and 3 items pointing at it with P179, the same shape as a real trilogy.
//
// What *does* separate them is the label, so that is where the exception lives. When the strict pass
// finds nothing, `fetchBookInfo` runs once more with the type filter dropped and accepts a candidate
// only on **exact** normalized title equality (`exactTitleMatcher` — no prefix containment, which is
// the sole mechanism behind every wrong merge here). All four books match their item's label exactly;
// "Das Spiel der Götter (12)" does not match "Das Spiel der Götter", and ILIUM does not match
// "Ilium/Olympos". This cannot reintroduce the merge: two works can only both match one label exactly
// if their normalized titles are equal, and `workMatchKey` (title|author) has already made those a
// single work before enrichment runs. The retry deliberately does **not** use the stripped title —
// stripping the ordinal is precisely what would turn a volume into an exact match for its series.
const SERIES_OF_CREATIVE_WORKS = "Q7725310";
const WIKIMEDIA_LIST_ARTICLE = "Q13406463";

// How close one of an item's labels/aliases must come to the searched title before the QID is
// accepted as this book's. Calibrated against the pairs this library actually produced: the tightest
// *correct* hit is 0.909 (`Jagd auf "Roter Oktober"` vs the label without quotes) and the closest
// *wrong* one is 0.732 ("Der Herr des Wüstenplaneten" — Dune Messiah — against Dune's German label
// "Der Wüstenplanet"), with the sequel case at 0.720 ("The Monster Baru Cormorant" vs "The Traitor
// Baru Cormorant"). 0.85 sits in the middle of that gap.
const QID_TITLE_THRESHOLD = 0.85;

/**
 * The first candidate (they arrive in search-rank order) whose own name plausibly *is* the searched
 * title. The mwapi search ranks by text relevance and will happily return the sequel, the omnibus or
 * the series as its top hit, and accepting that unverified is what merged distinct books onto one
 * work. Pure, so the thresholds above are unit-testable (`test/enrichment.spec.ts`).
 */
export function pickVerifiedQid(
  title: string,
  candidates: readonly string[],
  labels: ReadonlyMap<string, Iterable<string>>,
): string | null {
  const score = titleScorer(title);
  for (const qid of candidates) {
    for (const label of labels.get(qid) ?? []) {
      if (score(label) >= QID_TITLE_THRESHOLD) return qid;
    }
  }
  return null;
}

/**
 * `pickVerifiedQid`'s strict twin, for the series-typed retry described above: same rank-order walk,
 * but a candidate is only this book if one of its names *is* the searched title, exactly. Pure.
 */
export function pickExactQid(
  title: string,
  candidates: readonly string[],
  labels: ReadonlyMap<string, Iterable<string>>,
): string | null {
  const isExact = exactTitleMatcher(title);
  for (const qid of candidates) {
    for (const label of labels.get(qid) ?? []) {
      if (isExact(label)) return qid;
    }
  }
  return null;
}

// A well-covered item carries a label in ~100 languages plus aliases, and most of them are the same
// string (the ~50 Wikipedias that call Q190192 "Dune"), so the query DISTINCTs and the Set dedupes:
// scoring one spelling once instead of fifty times is the difference between a handful of
// titleSimilarity calls per candidate and a thousand.
//
// The bound is **per candidate**. As one shared budget across all ten it was a starvation bug: a
// couple of heavily-labelled items ate the whole response and later candidates arrived with no
// labels at all — and a candidate with no labels can never verify, so `pickVerifiedQid` returned
// null and the work was stored as "not found" with its correct, lower-ranked QID sitting right
// there in the candidate list. Nothing ordered the rows either, so which candidates starved was
// SPARQL's business and the same book could enrich differently on two runs.
//
// 200 is measured, not guessed: the best-covered books run 107 (Dune) to 157 (The Lord of the
// Rings) distinct label+alias strings, and a cap under that would swap the starvation bug for a
// truncation one — LIMIT without ORDER BY would drop an arbitrary slice, possibly the very label
// that verifies. Worst case is 10 × 200 rows on a fallback-only query.
const MAX_LABEL_ROWS_PER_ITEM = 200;

// Labels *and* aliases, in every language: a German edition legitimately resolves to an
// English-titled work through the item's German label ("Unendlicher Spaß" → Q1077445 Infinite Jest),
// so restricting this to en/de would reject correct hits in Hebrew, Japanese and the rest. An extra
// round trip per enrichment, but only the fallback one — the common case is decided by the en/de
// labels the search query itself carries (see fetchBookInfo's fast path).
async function fetchWorkLabels(
  usage: UsageRecorder | null | undefined,
  qids: readonly string[],
): Promise<Map<string, Set<string>>> {
  if (!qids.length) return new Map();
  // One subquery per candidate, because SPARQL has no per-group limit and a subquery's own LIMIT is
  // how you get one. The qids are shape-checked (`/^Q\d+$/`) where the candidate list is built, and
  // that list is capped at 10 by the search query's own LIMIT, so the response stays bounded by
  // 10 × MAX_LABEL_ROWS_PER_ITEM — the same ceiling the single shared budget had, now split fairly.
  const blocks = qids.map(
    (q) => `
      { SELECT DISTINCT ?item ?label WHERE {
          VALUES ?item { wd:${q} }
          { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label }
        } LIMIT ${MAX_LABEL_ROWS_PER_ITEM} }`,
  );
  const rows = await runSparql(
    usage,
    "labels",
    `
    SELECT ?item ?label WHERE {${blocks.join(" UNION")}
    }`.trim(),
  );
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const qid = qidFromUri(r.item?.value);
    const label = r.label?.value;
    if (!qid || !label) continue;
    const existing = out.get(qid);
    if (existing) existing.add(label);
    else out.set(qid, new Set([label]));
  }
  return out;
}

async function fetchBookInfo(
  usage: UsageRecorder | null | undefined,
  title: string,
  author: string,
  // The series-typed retry: drop the type filter, and demand an exact title match instead. Never
  // call this with a stripped title — see the comment above SERIES_OF_CREATIVE_WORKS.
  { exactOnly = false }: { exactOnly?: boolean } = {},
): Promise<{
  workQid: string;
  authorQid: string | null;
  series: SeriesHit | null;
} | null> {
  const authorBlock = author
    ? `SERVICE wikibase:mwapi {
         bd:serviceParam wikibase:api "Search"; wikibase:endpoint "www.wikidata.org";
                          mwapi:srsearch "${escapeSparql(author)} haswbstatement:P31=Q5".
         ?author wikibase:apiOutputItem mwapi:title.
       }
       ?work wdt:P50 ?author.`
    : "";
  const query = `
    SELECT ?work ?titleRank ?author ?series ?ordinal ?seriesLabelEn ?seriesLabelDe ?workLabelEn ?workLabelDe WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:api "Search"; wikibase:endpoint "www.wikidata.org";
                         mwapi:srsearch "${escapeSparql(title)}".
        ?work wikibase:apiOutputItem mwapi:title.
        ?titleRank wikibase:apiOrdinal true.
      }
      ?work wdt:P31/wdt:P279* wd:Q47461344.
      ${exactOnly ? "" : `FILTER NOT EXISTS { ?work wdt:P31/wdt:P279* wd:${SERIES_OF_CREATIVE_WORKS} }`}
      FILTER NOT EXISTS { ?work wdt:P31 wd:${WIKIMEDIA_LIST_ARTICLE} }
      ${authorBlock}
      OPTIONAL { ?work rdfs:label ?workLabelEn. FILTER(LANG(?workLabelEn) = "en") }
      OPTIONAL { ?work rdfs:label ?workLabelDe. FILTER(LANG(?workLabelDe) = "de") }
      OPTIONAL {
        ?work p:P179 ?seriesStmt.
        ?seriesStmt ps:P179 ?series.
        OPTIONAL { ?seriesStmt pq:P1545 ?ordinal. }
        OPTIONAL { ?series rdfs:label ?seriesLabelEn. FILTER(LANG(?seriesLabelEn) = "en") }
        OPTIONAL { ?series rdfs:label ?seriesLabelDe. FILTER(LANG(?seriesLabelDe) = "de") }
      }
    } ORDER BY ASC(?titleRank) LIMIT 10`.trim();

  console.log("[fetchBookInfo] querying Wikidata for:", { title, author });
  const rows = await runSparql(usage, "book_search", query);
  if (!rows.length) {
    console.log("[fetchBookInfo] no rows returned");
    return null;
  }
  // Rows grouped by hit, a Map so the keys stay in search-rank order — the top one is only a
  // *candidate* until one of its own labels says it is this book (see pickVerifiedQid). Grouping once
  // rather than re-deriving the qid per read is also what scopes the author and series rows below to
  // the chosen work structurally, instead of by repeating the predicate.
  const byQid = new Map<string, any[]>();
  for (const r of rows) {
    const qid = qidFromUri(r.work?.value);
    // Shape-checked because these are interpolated into the labels query below.
    if (!qid || !/^Q\d+$/.test(qid)) continue;
    const existing = byQid.get(qid);
    if (existing) existing.push(r);
    else byQid.set(qid, [r]);
  }
  const candidates = [...byQid.keys()];
  if (!candidates.length) {
    console.log("[fetchBookInfo] no rows carried a usable work URI:", rows[0]);
    return null;
  }
  // Fast path: the en/de labels already ride the search query (one per language per work, so no row
  // multiplication — the same shape as the series labels). Only a *top-ranked* fast hit is decisive,
  // though: a lower-ranked one (or none) leaves open that a higher-ranked candidate would verify
  // through an alias or another language, and rank order must win — so everything else falls back to
  // the all-language round trip. Most books verify through their en or de label, which is what keeps
  // the second SPARQL call off the sweeper's subrequest budget in the common case.
  const fastLabels = new Map(
    candidates.map((qid): [string, string[]] => {
      const r = byQid.get(qid)![0];
      return [
        qid,
        [r.workLabelEn?.value, r.workLabelDe?.value].filter(
          (l): l is string => !!l,
        ),
      ];
    }),
  );
  const pick = exactOnly ? pickExactQid : pickVerifiedQid;
  const workQid =
    pick(title, candidates, fastLabels) === candidates[0]
      ? candidates[0]
      : pick(title, candidates, await fetchWorkLabels(usage, candidates));
  if (!workQid) {
    console.log(
      `[fetchBookInfo] no candidate's own name matches "${title}"${exactOnly ? " exactly" : ""} — treating as not found rather than trusting the search rank. Candidates: ${candidates.join(", ")}`,
    );
    return null;
  }
  console.log("[fetchBookInfo] workQid =", workQid);
  // The rows of the *verified* work, which need not be the top-ranked one. Scoping the series read to
  // them is what stops a series match on some other candidate row (a same-titled but unrelated work)
  // from being attached to this workQid.
  const chosenRows = byQid.get(workQid)!;
  const authorQid = qidFromUri(chosenRows[0].author?.value);

  const withSeries = chosenRows.find((r) => r.series?.value);
  let series: SeriesHit | null = null;
  if (withSeries) {
    const seriesQid = qidFromUri(withSeries.series.value);
    if (seriesQid) {
      series = {
        seriesQid,
        ordinal: parseOrdinal(withSeries.ordinal?.value),
        nameEn: withSeries.seriesLabelEn?.value ?? null,
        nameDe: withSeries.seriesLabelDe?.value ?? null,
      };
      console.log("[fetchBookInfo] series:", series);
    }
  } else {
    console.log("[fetchBookInfo] no series found in results");
  }
  return { workQid, authorQid, series };
}

// Fetches work-level metadata for a known Wikidata QID.
// Uses one subquery per property to avoid cartesian-product explosion when a work has many values.
async function fetchWorkDetails(
  usage: UsageRecorder | null | undefined,
  workQid: string,
): Promise<WorkDetails> {
  const empty: WorkDetails = {
    title: null,
    genres: [],
    originalPubDate: null,
    awards: [],
    nominations: [],
    mainSubject: null,
    formOfWork: null,
    languageOfWork: null,
    languageOfWorkCode: null,
    firstLine: null,
    epigraph: null,
    narrativeLocations: [],
    countriesOfOrigin: [],
    subtitle: null,
    translator: [],
    illustrator: [],
    characters: [],
    openlibraryWorkId: null,
    referencePageCount: null,
  };
  if (!/^Q\d+$/.test(workQid)) {
    console.warn("[fetchWorkDetails] invalid QID:", workQid);
    return empty;
  }
  console.log("[fetchWorkDetails] fetching details for", workQid);
  const query = `
    SELECT ?titleEn ?titleDe ?genres ?originalPubDate ?awards ?nominations
           ?mainSubject ?formOfWork ?languageOfWork ?languageOfWorkCode ?firstLine ?epigraph
           ?narrativeLocations ?countriesOfOrigin
           ?subtitle ?translators ?illustrators ?characters
           ?olWorkId ?refPageCount WHERE {
      { SELECT (SAMPLE(?tEn) AS ?titleEn) (SAMPLE(?tDe) AS ?titleDe) WHERE {
          OPTIONAL { wd:${workQid} rdfs:label ?tEn. FILTER(LANG(?tEn) = "en") }
          OPTIONAL { wd:${workQid} rdfs:label ?tDe. FILTER(LANG(?tDe) = "de") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres) WHERE {
          OPTIONAL { wd:${workQid} wdt:P136 ?genre.
                     ?genre rdfs:label ?genreLabel. FILTER(LANG(?genreLabel) = "en") } } }
      { SELECT (MIN(STR(?pubDate)) AS ?originalPubDate) WHERE {
          OPTIONAL { wd:${workQid} wdt:P577 ?pubDate. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?awardLabel; separator="|") AS ?awards) WHERE {
          OPTIONAL { wd:${workQid} wdt:P166 ?award.
                     ?award rdfs:label ?awardLabel. FILTER(LANG(?awardLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?nominLabel; separator="|") AS ?nominations) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1411 ?nomin.
                     ?nomin rdfs:label ?nominLabel. FILTER(LANG(?nominLabel) = "en") } } }
      { SELECT (SAMPLE(?subjLabel) AS ?mainSubject) WHERE {
          OPTIONAL { wd:${workQid} wdt:P921 ?subj.
                     ?subj rdfs:label ?subjLabel. FILTER(LANG(?subjLabel) = "en") } } }
      { SELECT (SAMPLE(?formLabel) AS ?formOfWork) WHERE {
          OPTIONAL { wd:${workQid} wdt:P7937 ?form.
                     ?form rdfs:label ?formLabel. FILTER(LANG(?formLabel) = "en") } } }
      { SELECT (SAMPLE(?langLabel) AS ?languageOfWork) WHERE {
          OPTIONAL { wd:${workQid} wdt:P407 ?lang.
                     ?lang rdfs:label ?langLabel. FILTER(LANG(?langLabel) = "en") } } }
      { SELECT (SAMPLE(?langCode) AS ?languageOfWorkCode) WHERE {
          OPTIONAL { wd:${workQid} wdt:P407 ?lang2. ?lang2 wdt:P218 ?langCode. } } }
      { SELECT (SAMPLE(STR(?fl)) AS ?firstLine) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1922 ?fl. } } }
      { SELECT (SAMPLE(STR(?ep)) AS ?epigraph) WHERE {
          OPTIONAL { wd:${workQid} wdt:P7150 ?ep. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?narLocLabel; separator="|") AS ?narrativeLocations) WHERE {
          OPTIONAL { wd:${workQid} wdt:P840 ?narLoc.
                     ?narLoc rdfs:label ?narLocLabel. FILTER(LANG(?narLocLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countriesOfOrigin) WHERE {
          OPTIONAL { wd:${workQid} wdt:P495 ?country.
                     ?country rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = "en") } } }
      { SELECT (SAMPLE(STR(?st)) AS ?subtitle) WHERE {
          OPTIONAL { wd:${workQid} wdt:P1680 ?st. } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?translatorLabel; separator="|") AS ?translators) WHERE {
          OPTIONAL { wd:${workQid} wdt:P655 ?translator.
                     ?translator rdfs:label ?translatorLabel. FILTER(LANG(?translatorLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?illustratorLabel; separator="|") AS ?illustrators) WHERE {
          OPTIONAL { wd:${workQid} wdt:P110 ?illustrator.
                     ?illustrator rdfs:label ?illustratorLabel. FILTER(LANG(?illustratorLabel) = "en") } } }
      { SELECT (GROUP_CONCAT(DISTINCT ?characterLabel; separator="|") AS ?characters) WHERE {
          OPTIONAL { wd:${workQid} wdt:P674 ?character.
                     ?character rdfs:label ?characterLabel. FILTER(LANG(?characterLabel) = "en") } } }
      { SELECT (SAMPLE(?olid) AS ?olWorkId) WHERE {
          OPTIONAL { wd:${workQid} wdt:P648 ?olid. FILTER(STRENDS(?olid, "W")) } } }
      { SELECT (SAMPLE(?pageCount) AS ?refPageCount) WHERE {
          OPTIONAL { wd:${workQid} wdt:P747 ?refEd. ?refEd wdt:P1104 ?pageCount. } } }
    }`.trim();
  const rows = await runSparql(usage, "work_details", query);
  const row = rows[0];
  console.log("[fetchWorkDetails] raw row:", JSON.stringify(row ?? null));
  const result = parseWorkDetailsRow(row);
  console.log("[fetchWorkDetails] parsed:", {
    title: result.title,
    genres: result.genres,
    originalPubDate: result.originalPubDate,
    awards: result.awards.length,
    nominations: result.nominations.length,
    mainSubject: result.mainSubject,
    formOfWork: result.formOfWork,
    narrativeLocations: result.narrativeLocations.length,
    countriesOfOrigin: result.countriesOfOrigin.length,
    subtitle: result.subtitle,
    translator: result.translator.length,
    illustrator: result.illustrator.length,
    characters: result.characters.length,
    openlibraryWorkId: result.openlibraryWorkId,
    referencePageCount: result.referencePageCount,
  });
  return result;
}

function splitPipe(v: string | undefined): string[] {
  return v ? v.split("|").filter(Boolean) : [];
}

function strOrNull(v: string | undefined): string | null {
  return v || null;
}

function positiveIntOrNull(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function yearFrom(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/(\d{4})/);
  return m ? m[1] : null;
}

function parseWorkDetailsListFields(row: any) {
  return {
    genres: splitPipe(row?.genres?.value),
    awards: splitPipe(row?.awards?.value),
    nominations: splitPipe(row?.nominations?.value),
    narrativeLocations: splitPipe(row?.narrativeLocations?.value),
    countriesOfOrigin: splitPipe(row?.countriesOfOrigin?.value),
    translator: splitPipe(row?.translators?.value),
    illustrator: splitPipe(row?.illustrators?.value),
    characters: splitPipe(row?.characters?.value),
  };
}

function parseWorkDetailsScalarFields(row: any) {
  return {
    title: strOrNull(row?.titleEn?.value) ?? strOrNull(row?.titleDe?.value),
    originalPubDate: yearFrom(row?.originalPubDate?.value),
    mainSubject: strOrNull(row?.mainSubject?.value),
    formOfWork: strOrNull(row?.formOfWork?.value),
    languageOfWork: strOrNull(row?.languageOfWork?.value),
    languageOfWorkCode: strOrNull(row?.languageOfWorkCode?.value),
    firstLine: strOrNull(row?.firstLine?.value),
    epigraph: strOrNull(row?.epigraph?.value),
    subtitle: strOrNull(row?.subtitle?.value),
    openlibraryWorkId: strOrNull(row?.olWorkId?.value),
    referencePageCount: positiveIntOrNull(row?.refPageCount?.value),
  };
}

function parseWorkDetailsRow(row: any): WorkDetails {
  return {
    ...parseWorkDetailsListFields(row),
    ...parseWorkDetailsScalarFields(row),
  };
}

// All member works of a series (for completeness), with ordinals + English titles.
async function fetchSeriesMembers(
  usage: UsageRecorder | null | undefined,
  seriesQid: string,
): Promise<{ qid: string; ordinal: number | null; title: string | null }[]> {
  if (!/^Q\d+$/.test(seriesQid)) {
    console.warn("[fetchSeriesMembers] invalid QID:", seriesQid);
    return [];
  }
  const query = `
    SELECT ?work ?ordinal ?label WHERE {
      ?work p:P179 ?st.
      ?st ps:P179 wd:${seriesQid}.
      OPTIONAL { ?st pq:P1545 ?ordinal. }
      OPTIONAL { ?work rdfs:label ?label. FILTER(LANG(?label) = "en") }
    } LIMIT 200`.trim();
  const rows = await runSparql(usage, "series_members", query);
  const out: { qid: string; ordinal: number | null; title: string | null }[] =
    [];
  for (const r of rows) {
    const qid = qidFromUri(r.work?.value);
    if (qid)
      out.push({
        qid,
        ordinal: parseOrdinal(r.ordinal?.value),
        title: r.label?.value ?? null,
      });
  }
  return out;
}

// A representative ISBN for a work QID (via its editions), preferring en/de editions.
// Many works have no edition/ISBN data in Wikidata — returns null in that case.
async function fetchWorkEditionIsbn(
  usage: UsageRecorder | null | undefined,
  workQid: string,
): Promise<string | null> {
  if (!/^Q\d+$/.test(workQid)) return null;
  const query = `
    SELECT ?isbn ?lang WHERE {
      wd:${workQid} wdt:P747 ?ed.
      { ?ed wdt:P212 ?isbn } UNION { ?ed wdt:P957 ?isbn }
      OPTIONAL { ?ed wdt:P407 ?l. ?l wdt:P218 ?lang }
    } LIMIT 20`.trim();
  const rows = await runSparql(usage, "edition_isbn", query);
  if (!rows.length) return null;
  const clean = (v: string | undefined) => (v ?? "").replace(/[-\s]/g, "");
  // Prefer an English, then German, then any edition.
  const pick =
    rows.find((r) => r.lang?.value === "en") ??
    rows.find((r) => r.lang?.value === "de") ??
    rows[0];
  const isbn = clean(pick.isbn?.value);
  return isbn || null;
}

// The share of the Google Books daily quota the cron sweeper may spend. The placeholder backlog is
// self-amplifying — enriching one work with a series inserts its whole roster as placeholder works
// (~10 observed), and each of those can spend a Google Books call here to give itself a cover — so
// one bulk import can drain a quota that interactive title search (the scanner, the import wizard)
// depends on and that nothing refills until the day rolls over. 700 of the project's 1,000/day
// (`GOOGLE_BOOKS_DAILY_QUOTA`, the number the admin gauge displays) leaves ~300 for the paths
// somebody is actually waiting on. Only the sweeper is ever gated; interactive requests spend
// freely, which is the point of reserving anything.
const SWEEPER_GOOGLE_BOOKS_BUDGET = 700;

// Gives a placeholder/unowned work a real books row (with cover) so the series view shows it.
// No-op when the work already has a linked edition (a scanned book), to avoid duplicates.
async function backfillEdition(
  db: D1Database,
  workId: number,
  workQid: string,
  source: EnrichmentSource,
  apiKey?: string,
  usage?: UsageRecorder | null,
): Promise<void> {
  const existing = await db
    .prepare("SELECT 1 FROM books WHERE work_id = ? LIMIT 1")
    .bind(workId)
    .first();
  if (existing) return;

  const isbn = await fetchWorkEditionIsbn(usage, workQid);
  if (!isbn) {
    console.log(`[backfillEdition] no ISBN for ${workQid} (work ${workId})`);
    return;
  }

  // Over budget, the Google half is dropped by withholding the key: `fetchBookMetadata` then
  // resolves from OpenLibrary alone, which is unmetered and often enough for a cover. Only if
  // OpenLibrary doesn't know the ISBN either does the work stay edition-less — and since that
  // leaves no `books` row, a later run (schema backfill, force refresh) retries the whole thing.
  let effectiveKey = apiKey;
  if (apiKey && source === "sweeper") {
    const spent = await googleBooksCallsToday(db);
    if (spent >= SWEEPER_GOOGLE_BOOKS_BUDGET) {
      console.log(
        `[backfillEdition] over sweeper Google Books budget (${spent}/${SWEEPER_GOOGLE_BOOKS_BUDGET} today), OpenLibrary only for ISBN ${isbn} (work ${workId})`,
      );
      effectiveKey = undefined;
    }
  }

  const book = await materializeEdition(db, isbn, workId, effectiveKey, usage);
  if (!book) {
    console.log(`[backfillEdition] no metadata for ISBN ${isbn}`);
    return;
  }
  console.log(`[backfillEdition] linked ISBN ${isbn} to work ${workId}`);
}

// Repoint everything from a match-key work onto the canonical QID work, then drop the dup.
async function mergeWorks(
  db: D1Database,
  from: number,
  into: number,
): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE books SET work_id = ? WHERE work_id = ?")
      .bind(into, from),
    db
      .prepare(
        "INSERT OR IGNORE INTO work_authors (work_id, author_id, ordinal) SELECT ?, author_id, ordinal FROM work_authors WHERE work_id = ?",
      )
      .bind(into, from),
    db.prepare("DELETE FROM work_authors WHERE work_id = ?").bind(from),
    db
      .prepare(
        "INSERT OR IGNORE INTO work_series (work_id, series_id, ordinal) SELECT ?, series_id, ordinal FROM work_series WHERE work_id = ?",
      )
      .bind(into, from),
    db.prepare("DELETE FROM work_series WHERE work_id = ?").bind(from),
    db
      .prepare(
        "INSERT OR IGNORE INTO work_edition_isbns (work_id, isbn, title, language, cover_url, publish_date, publisher, source) SELECT ?, isbn, title, language, cover_url, publish_date, publisher, source FROM work_edition_isbns WHERE work_id = ?",
      )
      .bind(into, from),
    db.prepare("DELETE FROM work_edition_isbns WHERE work_id = ?").bind(from),
    // work_ratings holds user data, so unlike the tables above a collision here is lossy rather
    // than redundant — the user may have rated the English edition's work and reviewed the
    // German one's before enrichment discovered they're the same book. Merge field by field:
    // a field the survivor lacks is taken from the loser either way, and a genuine conflict
    // (both non-NULL) goes to whichever row was written more recently.
    //
    // The SELECT must keep its trailing WHERE — without it SQLite can't tell ON CONFLICT from a
    // join and the statement is a parse error. MAX(a, b) here is the two-argument scalar form;
    // CURRENT_TIMESTAMP text ("YYYY-MM-DD HH:MM:SS", UTC) compares correctly lexicographically.
    db
      .prepare(
        `INSERT INTO work_ratings (user_id, work_id, rating, review, updated_at)
         SELECT user_id, ?, rating, review, updated_at FROM work_ratings WHERE work_id = ?
         ON CONFLICT(user_id, work_id) DO UPDATE SET
           rating = CASE WHEN excluded.updated_at > work_ratings.updated_at
                         THEN COALESCE(excluded.rating, work_ratings.rating)
                         ELSE COALESCE(work_ratings.rating, excluded.rating) END,
           review = CASE WHEN excluded.updated_at > work_ratings.updated_at
                         THEN COALESCE(excluded.review, work_ratings.review)
                         ELSE COALESCE(work_ratings.review, excluded.review) END,
           updated_at = MAX(work_ratings.updated_at, excluded.updated_at)`,
      )
      .bind(into, from),
    db.prepare("DELETE FROM work_ratings WHERE work_id = ?").bind(from),
    // Must come last. work_ratings.work_id is REFERENCES works(id) with NO ON DELETE clause,
    // deliberately: a cascade would let this DELETE silently destroy the losing work's ratings.
    // Instead D1's FK enforcement fails the whole batch if the repoint above is ever removed or
    // reordered after it — a loud tripwire rather than silent data loss.
    db.prepare("DELETE FROM works WHERE id = ?").bind(from),
  ]);
}

async function upsertSeries(
  db: D1Database,
  workId: number,
  hit: SeriesHit,
): Promise<number | null> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO series (wikidata_qid, canonical_name) VALUES (?, ?)",
    )
    .bind(hit.seriesQid, hit.nameEn ?? hit.nameDe ?? null)
    .run();
  const series = await db
    .prepare("SELECT id FROM series WHERE wikidata_qid = ?")
    .bind(hit.seriesQid)
    .first<{ id: number }>();
  if (!series) return null;

  const stmts = [
    db
      .prepare(
        "INSERT OR REPLACE INTO work_series (work_id, series_id, ordinal) VALUES (?, ?, ?)",
      )
      .bind(workId, series.id, hit.ordinal),
  ];
  if (hit.nameEn)
    stmts.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO series_names (series_id, language, name) VALUES (?, ?, ?)",
        )
        .bind(series.id, "en", hit.nameEn),
    );
  if (hit.nameDe)
    stmts.push(
      db
        .prepare(
          "INSERT OR REPLACE INTO series_names (series_id, language, name) VALUES (?, ?, ?)",
        )
        .bind(series.id, "de", hit.nameDe),
    );
  await db.batch(stmts);
  return series.id;
}

// Placeholder works (wikidata_qid set, no edition) so completeness reflects unscanned entries.
// When a real edition is later scanned, enrichWork merges its match-key work into the placeholder.
async function populateSeriesMembers(
  db: D1Database,
  seriesId: number,
  seriesQid: string,
  usage?: UsageRecorder | null,
): Promise<void> {
  const members = await fetchSeriesMembers(usage, seriesQid);
  if (!members.length) return;
  await db.batch(
    members.map((m) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO works (wikidata_qid, canonical_title) VALUES (?, ?)",
        )
        .bind(m.qid, m.title),
    ),
  );
  await db.batch(
    members.map((m) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO work_series (work_id, series_id, ordinal) SELECT id, ?, ? FROM works WHERE wikidata_qid = ?",
        )
        .bind(seriesId, m.ordinal, m.qid),
    ),
  );
}

// A stale claim (a run that crashed without clearing it) expires after this long. Must
// comfortably exceed a worst-case enrichWork run — several SPARQL calls at 25s timeout each,
// plus 429 retry sleeps and Google Books/OpenLibrary calls — or a live run's claim can be
// stolen mid-flight. 5 minutes spans several sweeper ticks (cron runs every 2 minutes).
const CLAIM_TTL_MINUTES = 5;

// Atomically claims a work for enrichment so a concurrent invocation (cron sweeper vs. a manual
// refresh/lookup) can't run the same SPARQL work twice. Returns false if another run currently
// holds the claim.
async function claimWork(db: D1Database, workId: number): Promise<boolean> {
  const claim = await db
    .prepare(
      `UPDATE works SET enrichment_started_at = datetime('now') WHERE id = ? AND (enrichment_started_at IS NULL OR enrichment_started_at < datetime('now', '-${CLAIM_TTL_MINUTES} minutes'))`,
    )
    .bind(workId)
    .run();
  return claim.meta.changes > 0;
}

type IdentityOutcome =
  | { kind: "no-title" }
  // `canonicalId` is the surviving work of the merge this run performed before losing the
  // re-claim — the row the telemetry has to be written against, since the row this call started
  // from no longer exists.
  | { kind: "in-flight"; canonicalId: number }
  | {
      kind: "resolved";
      workQid: string | null;
      canonicalId: number;
      merged: boolean;
      details: WorkDetails | null;
    };

// Resolves the Wikidata QID and work-level details for a work: either fetches details directly
// for a work that already has a QID (placeholder series member, or a force-refresh), or searches
// Wikidata by title/author, dedup-merges onto an existing work if the QID is already claimed
// elsewhere, and populates series membership. Returns 'no-title' when the work has no title to
// search with, and 'in-flight' when a post-merge re-claim loses to a concurrent run.
async function resolveWorkIdentity(
  db: D1Database,
  workId: number,
  w: WorkRow,
  usage?: UsageRecorder | null,
): Promise<IdentityOutcome> {
  if (w.wikidata_qid) {
    console.log(
      `[enrichWork] work ${workId} already has QID ${w.wikidata_qid}, fetching details directly`,
    );
    const details = await fetchWorkDetails(usage, w.wikidata_qid);
    return {
      kind: "resolved",
      workQid: w.wikidata_qid,
      canonicalId: workId,
      merged: false,
      details,
    };
  }

  const ed = await db
    .prepare(
      "SELECT title, author FROM books WHERE work_id = ? AND title IS NOT NULL LIMIT 1",
    )
    .bind(workId)
    .first<{ title: string | null; author: string | null }>();
  const title = ed?.title ?? w.canonical_title;
  if (!title) {
    console.warn(`[enrichWork] no title for work ${workId}, marking done`);
    return { kind: "no-title" };
  }
  const author = splitAuthors(ed?.author ?? null)[0] ?? "";
  console.log(`[enrichWork] looking up: title="${title}" author="${author}"`);

  let info = await fetchBookInfo(usage, title, author);
  if (!info) {
    const strippedTitle = title.replace(/\s*[([{].*?[)\]}]/g, "").trim();
    if (strippedTitle && strippedTitle !== title) {
      console.log(
        `[enrichWork] no results for "${title}", retrying with stripped title "${strippedTitle}"`,
      );
      info = await fetchBookInfo(usage, strippedTitle, author);
    }
  }
  // Last resort: the item may be a single work Wikidata also types as a series (Cryptonomicon,
  // Reamde, Watchmen, Daemon), which the type filter cannot tell from a real series. Retry without
  // it, accepting only an exact title match — on the *original* title, never the stripped one.
  if (!info) {
    console.log(
      `[enrichWork] no results for "${title}", retrying series-typed items with an exact title match`,
    );
    info = await fetchBookInfo(usage, title, author, { exactOnly: true });
  }
  console.log(
    `[enrichWork] fetchBookInfo result: workQid=${info?.workQid ?? "null"} seriesQid=${info?.series?.seriesQid ?? "null"}`,
  );

  if (!info?.workQid) {
    console.log(`[enrichWork] no Wikidata match found, will store nulls`);
    return {
      kind: "resolved",
      workQid: null,
      canonicalId: workId,
      merged: false,
      details: null,
    };
  }

  let canonicalId = workId;
  let merged = false;
  const existing = await db
    .prepare("SELECT id FROM works WHERE wikidata_qid = ? AND id != ?")
    .bind(info.workQid, workId)
    .first<{ id: number }>();
  if (existing) {
    console.log(
      `[enrichWork] QID ${info.workQid} already on work ${existing.id}, merging ${workId} → ${existing.id}`,
    );
    await mergeWorks(db, workId, existing.id);
    canonicalId = existing.id;
    merged = true;
    // The claim taken earlier was on workId, which mergeWorks just deleted. Re-claim the
    // canonical row so a second concurrent enrichWork that resolves to the same existing
    // work can't race this one on the series/detail writes below.
    if (!(await claimWork(db, canonicalId))) {
      console.log(
        `[enrichWork] canonical work ${canonicalId} already has an enrichment in flight, skipping after merge`,
      );
      return { kind: "in-flight", canonicalId };
    }
  } else {
    console.log(`[enrichWork] assigning QID ${info.workQid} to work ${workId}`);
    await db
      .prepare("UPDATE works SET wikidata_qid = ? WHERE id = ?")
      .bind(info.workQid, workId)
      .run();
  }

  if (info.series) {
    console.log(
      `[enrichWork] upserting series ${info.series.seriesQid} for work ${canonicalId}`,
    );
    const seriesId = await upsertSeries(db, canonicalId, info.series);
    console.log(`[enrichWork] seriesId=${seriesId}`);
    if (seriesId)
      await populateSeriesMembers(db, seriesId, info.series.seriesQid, usage);
  }

  // Best-effort: link the searched author's own QID for future dedup, in parallel with the
  // work-details SPARQL fetch below (independent writes, so no need to serialize). Isolated in
  // its own try/catch so a failure here (e.g. two normalized names colliding on the UNIQUE index)
  // can't turn an otherwise-successful work enrichment into a failed one.
  const authorQidUpdate =
    info.authorQid && author
      ? db
          .prepare(
            "UPDATE authors SET wikidata_qid = ? WHERE normalized_name = ? AND wikidata_qid IS NULL",
          )
          .bind(info.authorQid, normalizeAuthorKey(author))
          .run()
          .then((authorResult) =>
            console.log(
              `[enrichWork] author QID ${info.authorQid} write: changes=${authorResult.meta.changes}`,
            ),
          )
          .catch((e) =>
            console.error(
              "[enrichWork] failed to write author QID",
              info.authorQid,
              e,
            ),
          )
      : Promise.resolve();

  const [details] = await Promise.all([
    fetchWorkDetails(usage, info.workQid),
    authorQidUpdate,
  ]);
  return {
    kind: "resolved",
    workQid: info.workQid,
    canonicalId,
    merged,
    details,
  };
}

// Gives an identified work a cover edition (if unowned) and pre-discovers related OpenLibrary
// editions via the Wikidata-linked work id. Independent operations on different tables, run
// concurrently. Both best-effort: a discovery failure must not turn a successful enrichment
// into a failed one (backfillEdition has no failure mode of its own).
async function backfillEditionsAndDiscovery(
  db: D1Database,
  canonicalId: number,
  workQid: string | null,
  details: WorkDetails | null,
  source: EnrichmentSource,
  apiKey?: string,
  usage?: UsageRecorder | null,
): Promise<void> {
  const backfill = workQid
    ? backfillEdition(db, canonicalId, workQid, source, apiKey, usage)
    : Promise.resolve();
  const discovery = details?.openlibraryWorkId
    ? discoverEditionsFromOpenLibrary(
        db,
        canonicalId,
        details.openlibraryWorkId,
        usage,
      ).catch((e) => {
        console.error(
          "[enrichWork] edition discovery failed for work",
          canonicalId,
          e,
        );
      })
    : Promise.resolve();
  await Promise.all([backfill, discovery]);
}

// Writes fetched Wikidata details back to `works`. force=true (manual refresh) overwrites
// unconditionally so stale values can be cleared; force=false (sweeper backfill) COALESCEs to
// preserve existing values when Wikidata returns null. When Wikidata has no genres and this
// isn't a force refresh, falls back to Google Books' BISAC categories from a linked edition.
async function persistWorkDetails(
  db: D1Database,
  canonicalId: number,
  details: WorkDetails | null,
  force: boolean,
): Promise<void> {
  const arrToJson = (a: string[] | undefined) =>
    a?.length ? JSON.stringify(a) : null;
  const nullish = <T>(v: T | null | undefined): T | null => v ?? null;
  let genresJson = arrToJson(details?.genres);
  if (!genresJson && !force) {
    const fallback = await db
      .prepare(
        "SELECT categories FROM books WHERE work_id = ? AND categories IS NOT NULL LIMIT 1",
      )
      .bind(canonicalId)
      .first<{ categories: string }>();
    if (fallback?.categories) genresJson = fallback.categories;
  }
  const awardsJson = arrToJson(details?.awards);
  const nominJson = arrToJson(details?.nominations);
  const narLocsJson = arrToJson(details?.narrativeLocations);
  const countriesJson = arrToJson(details?.countriesOfOrigin);
  const translatorJson = arrToJson(details?.translator);
  const illustratorJson = arrToJson(details?.illustrator);
  const charactersJson = arrToJson(details?.characters);
  const pubDate = nullish(details?.originalPubDate);
  console.log(`[enrichWork] writing to works id=${canonicalId}:`, {
    genresJson,
    pubDate,
    awardsJson,
    nominJson,
  });

  const coalesce = (col: string) => (force ? "?" : `COALESCE(?, ${col})`);
  const updateResult = await db
    .prepare(
      `
    UPDATE works SET
      enrichment_status         = 'done',
      next_retry_at             = NULL,
      series_checked_at         = datetime('now'),
      enrichment_failed_at      = NULL,
      enrichment_failure_reason = NULL,
      enrichment_attempts       = 0,
      enrichment_started_at     = NULL,
      enrichment_schema_version = ${CURRENT_ENRICHMENT_SCHEMA_VERSION},
      canonical_title           = ${coalesce("canonical_title")},
      genres                    = ${coalesce("genres")},
      original_pub_date         = ${coalesce("original_pub_date")},
      awards                    = ${coalesce("awards")},
      nominations               = ${coalesce("nominations")},
      main_subject              = ${coalesce("main_subject")},
      form_of_work              = ${coalesce("form_of_work")},
      language_of_work          = ${coalesce("language_of_work")},
      language_of_work_code     = ${coalesce("language_of_work_code")},
      first_line                = ${coalesce("first_line")},
      epigraph                  = ${coalesce("epigraph")},
      narrative_locations       = ${coalesce("narrative_locations")},
      countries_of_origin       = ${coalesce("countries_of_origin")},
      subtitle                  = ${coalesce("subtitle")},
      translator                = ${coalesce("translator")},
      illustrator               = ${coalesce("illustrator")},
      characters                = ${coalesce("characters")},
      openlibrary_work_id       = ${coalesce("openlibrary_work_id")},
      reference_page_count      = ${coalesce("reference_page_count")}
    WHERE id = ?`,
    )
    .bind(
      nullish(details?.title),
      genresJson,
      pubDate,
      awardsJson,
      nominJson,
      nullish(details?.mainSubject),
      nullish(details?.formOfWork),
      nullish(details?.languageOfWork),
      nullish(details?.languageOfWorkCode),
      nullish(details?.firstLine),
      nullish(details?.epigraph),
      narLocsJson,
      countriesJson,
      nullish(details?.subtitle),
      translatorJson,
      illustratorJson,
      charactersJson,
      nullish(details?.openlibraryWorkId),
      nullish(details?.referencePageCount),
      canonicalId,
    )
    .run();
  console.log(
    `[enrichWork] UPDATE result: changes=${updateResult.meta.changes}`,
  );
}

export type EnrichmentSource =
  "scan" | "lookup" | "refresh" | "sweeper" | "unknown";

// Best-effort telemetry write for observability (pending count, failure breakdown, timing) —
// never lets a logging failure affect the enrichment result itself.
async function recordRun(
  db: D1Database,
  workId: number,
  startedAt: number,
  outcome: "done" | "not_found" | "failed",
  failureReason: FailureReason | null,
  source: EnrichmentSource,
): Promise<void> {
  try {
    await db
      .prepare(
        "INSERT INTO enrichment_runs (work_id, started_at, duration_ms, outcome, failure_reason, source) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(
        workId,
        new Date(startedAt).toISOString(),
        Date.now() - startedAt,
        outcome,
        failureReason,
        source,
      )
      .run();
  } catch (e) {
    console.error("[enrichWork] failed to write enrichment_runs row", e);
  }
}

// Best-effort enrichment for a work. Negative-cached via works.series_checked_at unless force=true.
// apiKey (Google Books) is only needed when backfilling a cover edition for an unowned work.
// Every argument is explicit: `enrichWorkDetached` below is the convenience wrapper that carries
// the defaults, and it and the sweeper are the only two callers.
export async function enrichWork(
  db: D1Database,
  workId: number,
  force: boolean,
  apiKey: string | undefined,
  source: EnrichmentSource,
  /**
   * Required, not optional: an omitted recorder counts nothing and fails silently, and the whole
   * point of the counters is that they can't quietly under-report. Callers with nothing to flush
   * into (unit tests) pass `null` deliberately.
   */
  usage: UsageRecorder | null,
): Promise<void> {
  let canonicalId = workId;
  let merged = false;
  const startedAt = Date.now();
  try {
    console.log(`[enrichWork] start workId=${workId} force=${force}`);
    const w = await db
      .prepare("SELECT * FROM works WHERE id = ?")
      .bind(workId)
      .first<WorkRow>();
    if (!w) {
      console.warn(`[enrichWork] work ${workId} not found`);
      return;
    }
    // Re-enrich already-done works when they're behind the current schema version (the sweeper's
    // backfill path passes force=false), so new Wikidata columns get populated without a force-refresh.
    const schemaStale =
      (w.enrichment_schema_version ?? 0) < CURRENT_ENRICHMENT_SCHEMA_VERSION;
    if (w.enrichment_status === "done" && !force && !schemaStale) {
      console.log(
        `[enrichWork] already enriched (${w.series_checked_at}), skipping`,
      );
      return;
    }

    // Claim the work atomically so a concurrent invocation (cron sweeper vs. a manual
    // refresh/lookup) can't run the same SPARQL work twice. force=true still respects an
    // in-flight run.
    if (!(await claimWork(db, workId))) {
      console.log(
        `[enrichWork] work ${workId} already has an enrichment in flight, skipping`,
      );
      return;
    }

    // Reset to 'pending' so the enrichment poll sees it while we run SPARQL. Done only now,
    // after winning the claim — resetting before the claim risked leaving the work stuck
    // looking 'pending' forever if this call then lost the claim and the in-flight run it
    // deferred to later failed (which doesn't restore the status to 'done').
    // next_retry_at is cleared too: a force refresh is an explicit "try again now", and leaving a
    // previous failure's schedule in place would hide the work from the sweeper's due-time filter
    // for up to LONG_COOLDOWN_MINUTES (2 days) if this run also fails.
    if (force)
      await db
        .prepare(
          "UPDATE works SET enrichment_status = 'pending', next_retry_at = NULL WHERE id = ?",
        )
        .bind(workId)
        .run();

    const identity = await resolveWorkIdentity(db, workId, w, usage);
    if (identity.kind === "no-title") {
      // Lands on `done` at the current schema version, so neither sweeper query serves this work
      // again — deliberate: nothing about it will have changed on the next tick, and a titleless
      // work re-queued forever would occupy batch slots and write a run row every two minutes.
      // The recovery path is `POST /api/books/refresh`, which fills a NULL `books.title` and
      // force-schedules enrichment *unconditionally* (not only when the metadata fetch changed
      // something) — so an edition that later gains a title does get re-enriched, without anything
      // extra here. The one case still outside that: a title corrected directly in D1, which no
      // request observes.
      await persistWorkDetails(db, workId, null, force);
      await recordRun(db, workId, startedAt, "not_found", null, source);
      return;
    }
    if (identity.kind === "in-flight") {
      // This call searched, verified and then *merged two works* before losing the re-claim — the
      // most consequential thing the pipeline does. Returning silently left the one path where
      // that happens with no row at all, which blinds the duration/outcome stats and, worse, the
      // board's cron-liveness signal (`MAX(enrichment_runs.created_at)`). Recorded as `done`
      // against the surviving work, which is exactly what the same merge records when it *wins*
      // the re-claim; the detail writes it skipped belong to the run that holds the claim now.
      await recordRun(
        db,
        identity.canonicalId,
        startedAt,
        "done",
        null,
        source,
      );
      return;
    }

    const { workQid, details } = identity;
    canonicalId = identity.canonicalId;
    merged = identity.merged;

    await backfillEditionsAndDiscovery(
      db,
      canonicalId,
      workQid,
      details,
      source,
      apiKey,
      usage,
    );
    await persistWorkDetails(db, canonicalId, details, force);
    await recordRun(
      db,
      canonicalId,
      startedAt,
      workQid ? "done" : "not_found",
      null,
      source,
    );
  } catch (e) {
    console.error("[enrichWork] failed for work", workId, e);
    const failTarget = merged ? canonicalId : workId;
    const reason = classifyError(e);
    try {
      // Re-read attempts from the fail target: after a merge it's the canonical row, whose
      // count differs from the row loaded at the top. The claim rules out concurrent increments.
      const row = await db
        .prepare("SELECT enrichment_attempts FROM works WHERE id = ?")
        .bind(failTarget)
        .first<{ enrichment_attempts: number }>();
      const attempts = (row?.enrichment_attempts ?? 0) + 1;
      const retryAfter =
        e instanceof SparqlError ? e.retryAfterSeconds : undefined;
      const { status, nextRetryMinutes } = scheduleRetry(
        reason,
        attempts,
        retryAfter,
      );
      await db
        .prepare(
          `UPDATE works SET
           enrichment_status         = ?,
           next_retry_at             = datetime('now', '+${nextRetryMinutes} minutes'),
           enrichment_failed_at      = datetime('now'),
           enrichment_attempts       = ?,
           enrichment_failure_reason = ?,
           enrichment_started_at     = NULL
         WHERE id = ?`,
        )
        .bind(status, attempts, reason, failTarget)
        .run();
    } catch {}
    await recordRun(db, failTarget, startedAt, "failed", reason, source);
  }
}

/**
 * `enrichWork` as a detached background task — the `waitUntil(enrichWork(...))` shape used after
 * a lookup or a scan. It runs *after* the response, so `usageMiddleware`'s flush has already
 * fired by the time its SPARQL calls happen; it therefore owns its own recorder and flushes it
 * itself. The sweeper doesn't use this: it enriches a whole batch and flushes once for all of it.
 */
export async function enrichWorkDetached(
  db: D1Database,
  workId: number,
  force = false,
  apiKey?: string,
  source: EnrichmentSource = "unknown",
): Promise<void> {
  const usage = new UsageRecorder(db);
  try {
    await enrichWork(db, workId, force, apiKey, source, usage);
  } finally {
    await usage.flush();
  }
}
