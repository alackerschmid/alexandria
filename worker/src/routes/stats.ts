import { Hono } from "hono";
import type { Env } from "../types";
import { authMiddleware } from "../auth";
import {
  titleCase,
  parseTagArray,
  parseAuthorsJson,
  AUTHORS_JSON_SUBQUERY,
} from "../library-query";
import { splitAuthors, normalizeStr } from "../editions";

const stats = new Hono<Env>();
stats.use("*", authMiddleware);

// Exported (with the four pure helpers below) for the unit tests: everything in this file that is
// judgement rather than SQL — the year bounds, the `count < 10` decade cutoff, the code-vs-label
// translation fallback — lives in those helpers and is regression-prone.
export type RawRow = {
  status: string;
  owning_status: string;
  // Identity, carried only so the exemplars can name a book and the client can deep-link it.
  // Nothing aggregate reads either one.
  title: string | null;
  isbn: string;
  author: string | null;
  authors_json: string | null;
  language: string | null;
  pages: number | null;
  cover_url: string | null;
  publish_date: string | null;
  publisher: string | null;
  original_pub_date: string | null;
  genres: string | null;
  form_of_work: string | null;
  main_subject: string | null;
  countries_of_origin: string | null;
  language_of_work: string | null;
  language_of_work_code: string | null;
  // Work-level columns. `work_id` is NULL for a book that was never linked — which is itself an
  // enrichment gap, since enrichment hangs off the work. `rating` rides the same LEFT JOIN
  // `buildScanSelect` uses, so it repeats across every owned edition of one work: any aggregate
  // over it has to dedupe by `work_id` first (see `dedupeByWork`).
  work_id: number | null;
  enrichment_status: string | null;
  rating: number | null;
};

type SeriesRow = { label: string; count: number };
type CustomFieldRow = {
  field_def_id: number;
  field_name: string;
  field_type: string;
  field_value: string | null;
};
type SpotlightRow = {
  isbn: string;
  title: string | null;
  first_line: string;
  work_id: number | null;
  author: string | null;
  cover_url: string | null;
  original_pub_date: string | null;
  publish_date: string | null;
  publisher: string | null;
  pages: number | null;
};
export type RatingRow = { rating: number; count: number };

/** One named book, as the home page presents it. Everything but `isbn` can be absent — the row
 *  renders what it has. `year` is already resolved through the shared bounds (`yearFromDates`)
 *  rather than shipped as two raw date columns for the client to re-derive. */
export type ExemplarBook = {
  title: string | null;
  isbn: string;
  workId: number | null;
  author: string | null;
  coverUrl: string | null;
  year: number | null;
  pages: number | null;
  language: string | null;
};

export type Exemplars = {
  oldest: ExemplarBook | null;
  longest: ExemplarBook | null;
  soleLanguage: ExemplarBook | null;
};

/** The spotlight book — a first line plus enough identity to render and link it. */
export type SpotlightBook = {
  isbn: string;
  title: string | null;
  firstLine: string;
  workId: number | null;
  author: string | null;
  coverUrl: string | null;
  year: number | null;
  publisher: string | null;
  pages: number | null;
};

/** How many first-line books the spotlight ships. A pool costs the same one query as a single
 *  row and gives the home page's "show me another" its re-rolls without a refetch — re-rolling
 *  by refetching `/api/stats` would recompute the whole aggregate to change one book. */
export const SPOTLIGHT_POOL_SIZE = 5;
type StatsResponse = {
  total: number;
  byStatus: { read: number; reading: number; unread: number; dnf: number };
  genres: SeriesRow[];
  uncategorizedGenreCount: number;
  languages: { code: string; count: number }[];
  languageCount: number;
  topAuthors: { label: string; count: number }[];
  authorCount: number;
  publishers: { label: string; count: number }[];
  forms: { label: string; count: number }[];
  subjects: { label: string; count: number }[];
  countries: { label: string; count: number }[];
  countryCount: number;
  owningStatus: {
    owned: number;
    lent_out: number;
    unowned: number;
    want: number;
    unknown: number;
  };
  decades: { label: string; count: number }[];
  decadeGenres: {
    decade: string;
    genre: string;
    count: number;
    total_count: number;
  }[];
  topSeries: SeriesRow[];
  customFields: {
    fieldDefId: number;
    fieldName: string;
    values: { label: string; count: number }[];
  }[];
  avgPages: number | null;
  totalPagesRead: number | null;
  totalPages: number;
  pagesKnownCount: number;
  pageBuckets: { label: string; count: number }[];
  medianYear: number | null;
  yearKnownCount: number;
  genreCount: number;
  avgRating: number | null;
  ratedCount: number;
  ratingDistribution: { rating: number; count: number }[];
  genreRatings: {
    best: { label: string; avg: number; count: number } | null;
    worst: { label: string; avg: number; count: number } | null;
  };
  catalogueGaps: {
    noCover: number;
    noPageCount: number;
    noGenre: number;
    noYear: number;
    enrichmentPending: number;
    readUnrated: number;
  };
  translationRatio: {
    pct: number;
    translatedCount: number;
    knownCount: number;
  } | null;
  randomFirstLine: { title: string; firstLine: string } | null;
  /** Up to `SPOTLIGHT_POOL_SIZE` random first-line books. `randomFirstLine` is the first of
   *  these, kept as its own field so an older client still gets the shape it reads. */
  spotlight: SpotlightBook[];
  /** Named books rather than distributions — the home page's half of the split. */
  exemplars: Exemplars;
  /** Scans behind each scope, both always present and independent of the one asked for. The
   *  client needs the other number to offer the switch: an import-only library is 0 owned /
   *  N all, where "nothing to measure" is the wrong thing to say. */
  scopeCounts: { owned: number; all: number };
};

/** The ownership predicates `/api/stats` can be computed over, keyed by the `?scope=` value.
 *
 *  `owned` is the default and what every other ownership gate in the app means (see
 *  `OWNED_OWNING_STATUSES`); `all` drops the gate, which is the only way an import-only library
 *  — every row written at `owning_status = 'unknown'` — measures as anything but empty.
 *  Every query below carries the scans table as `s`, so one clause fits all of them. */
export const SCOPE_CLAUSES: Record<string, string> = {
  owned: "s.owning_status IN ('owned', 'lent_out')",
  all: "1 = 1",
};

/** The only supported way to turn a `?scope=` query param into a predicate. Mirrors
 *  `sortClauseFor`, prototype-safe lookup included: the clause is interpolated into the SQL, so
 *  `?scope=constructor` must not resolve to an inherited function that stringifies into it. */
export function scopeClauseFor(scope: string | undefined): string {
  // hasOwnProperty.call, not Object.hasOwn: the worker's tsconfig lib is es2021.
  return scope && Object.prototype.hasOwnProperty.call(SCOPE_CLAUSES, scope)
    ? SCOPE_CLAUSES[scope]
    : SCOPE_CLAUSES.owned;
}

/** The work's own year where it has one, else a 4-digit year off the edition's publish date,
 *  bounded to 100..2100 — the bound is what stops a Wikidata `"0"` or a mistyped 5-digit year
 *  being reported as the collection's oldest book.
 *
 *  Split out of `extractYear` because the spotlight row is not a `RawRow` and must not grow a
 *  second, subtly different copy of the same rule. */
export function yearFromDates(
  originalPubDate: string | null,
  publishDate: string | null,
): number | null {
  if (originalPubDate) {
    const n = parseInt(originalPubDate, 10);
    if (n >= 100 && n <= 2100) return n;
  }
  if (publishDate) {
    const m = publishDate.match(/\d{4}/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n >= 100 && n <= 2100) return n;
    }
  }
  return null;
}

export function extractYear(r: RawRow): number | null {
  return yearFromDates(r.original_pub_date, r.publish_date);
}

function topCounts(
  map: Map<string, number>,
  limit: number,
): { label: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function computeStatusCounts(rows: RawRow[]) {
  const byStatus = { read: 0, reading: 0, unread: 0, dnf: 0 };
  for (const r of rows) {
    switch (r.status) {
      case "read": {
        byStatus.read++;
        break;
      }
      case "reading": {
        byStatus.reading++;
        break;
      }
      case "dnf": {
        byStatus.dnf++;
        break;
      }
      default:
        byStatus.unread++;
    }
  }
  return byStatus;
}

// Top authors — per-individual-author counts, read straight off each row's own
// authors_json (co-authored books increment every author). Books whose work isn't
// linked yet fall back to splitting the raw `author` string, keyed by normalized
// name so a fallback entry merges into a linked one once the book gets re-enriched.
function computeTopAuthors(rows: RawRow[]) {
  const authorLabels = new Map<string, string>();
  const authorCounts = new Map<string, number>();
  for (const r of rows) {
    const linked = parseAuthorsJson(r.authors_json);
    const names = linked.length
      ? linked.map((a) => a.name)
      : splitAuthors(r.author);
    for (const name of names) {
      const norm = normalizeStr(name);
      if (!authorLabels.has(norm)) authorLabels.set(norm, name);
      authorCounts.set(norm, (authorCounts.get(norm) ?? 0) + 1);
    }
  }
  // 15, matching every other breakdown list — the stats page's collection breakdown expands to
  // the full list it was given, and a 6-entry cap made "author" the one dimension that stopped
  // short of the others for no reason the UI could explain. `authorCount` remains the true
  // distinct total, so a capped list can still say what it's a slice of.
  const topAuthors = topCounts(authorCounts, 15).map(({ label, count }) => ({
    label: authorLabels.get(label)!,
    count,
  }));
  return { topAuthors, authorCount: authorCounts.size };
}

function computeLanguages(rows: RawRow[]) {
  const langCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.language)
      langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }
  return [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));
}

// Genres (JSON array on works)
function computeGenreCounts(rows: RawRow[]) {
  const genreCounts = new Map<string, number>();
  let uncategorizedGenreCount = 0;
  for (const r of rows) {
    if (!r.genres) {
      uncategorizedGenreCount++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.genres);
    } catch {
      uncategorizedGenreCount++;
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      uncategorizedGenreCount++;
      continue;
    }
    for (const g of parsed) {
      if (typeof g === "string") {
        const label = titleCase(g);
        genreCounts.set(label, (genreCounts.get(label) ?? 0) + 1);
      }
    }
  }
  return {
    genres: topCounts(genreCounts, 15),
    genreCount: genreCounts.size,
    uncategorizedGenreCount,
  };
}

function computeStringFieldCounts(
  rows: RawRow[],
  field: "publisher" | "form_of_work" | "main_subject",
) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[field];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return topCounts(counts, 15);
}

// Countries of origin (JSON array)
function computeCountries(rows: RawRow[]) {
  const countryCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.countries_of_origin) continue;
    for (const c of parseTagArray(r.countries_of_origin)) {
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
  }
  // The count is the *distinct* total, not the list length — the list is capped at 15 and the
  // stats page's "N more" row is the difference between the two.
  return {
    countries: topCounts(countryCounts, 15),
    countryCount: countryCounts.size,
  };
}

// ── Exemplars ─────────────────────────────────────────────────────────────────

function toExemplar(r: RawRow): ExemplarBook {
  return {
    title: r.title,
    isbn: r.isbn,
    workId: r.work_id,
    author: r.author,
    coverUrl: r.cover_url,
    year: extractYear(r),
    pages: r.pages,
    language: r.language,
  };
}

/** Ties break on `isbn`, so the block names the same book on every request rather than whichever
 *  row D1 happened to return first — the same trap `computeGenreRatings` documents. */
function firstByIsbn(a: RawRow, b: RawRow): RawRow {
  return a.isbn.localeCompare(b.isbn) <= 0 ? a : b;
}

/** The row with the extreme value of `valueOf`, rows without one skipped. */
function pickExtreme(
  rows: RawRow[],
  valueOf: (r: RawRow) => number | null,
  better: (candidate: number, best: number) => boolean,
): RawRow | null {
  let best: RawRow | null = null;
  let bestValue = 0;
  for (const r of rows) {
    const v = valueOf(r);
    if (v === null) continue;
    if (best === null || better(v, bestValue)) {
      best = r;
      bestValue = v;
    } else if (v === bestValue) {
      best = firstByIsbn(best, r);
    }
  }
  return best;
}

/**
 * The three named books the home page shows instead of a distribution.
 *
 * One pass over the rows the route already holds — no extra query. Every one of them is null for
 * a library that can't answer it (no years known, no page counts, one language), and the block
 * hides the rows it gets nothing for.
 *
 * `soleLanguage` is the only book in its language, which is null for a monolingual library — the
 * common case. It also stays null for a **one-book** library, where the claim is trivially true
 * of the only book there is and the row would just repeat `oldest`.
 */
export function computeExemplars(rows: RawRow[]): Exemplars {
  const oldest = pickExtreme(rows, extractYear, (v, best) => v < best);
  const longest = pickExtreme(
    rows,
    (r) => (r.pages != null && r.pages > 0 ? r.pages : null),
    (v, best) => v > best,
  );

  const byLanguage = new Map<string, RawRow[]>();
  for (const r of rows) {
    if (!r.language) continue;
    const list = byLanguage.get(r.language);
    if (list) list.push(r);
    else byLanguage.set(r.language, [r]);
  }
  let sole: RawRow | null = null;
  if (rows.length > 1) {
    for (const list of byLanguage.values()) {
      if (list.length !== 1) continue;
      sole = sole === null ? list[0] : firstByIsbn(sole, list[0]);
    }
  }

  return {
    oldest: oldest && toExemplar(oldest),
    longest: longest && toExemplar(longest),
    soleLanguage: sole && toExemplar(sole),
  };
}

/** One row per work, for aggregates over a work-level value (`rating`).
 *
 *  `scans` is unique on `(user_id, book_id)`, not on the work, so a user who owns two editions
 *  of one book contributes two rows carrying the *same* `work_ratings` row through the LEFT
 *  JOIN. Averaging over the raw rows would weight that one rating twice — the trap the ratings
 *  query already sidesteps with `COUNT(DISTINCT b.work_id)`. Rows with no `work_id` can't
 *  carry a rating at all, so they're dropped rather than each counted as their own work. */
export function dedupeByWork(rows: RawRow[]): RawRow[] {
  const seen = new Set<number>();
  const out: RawRow[] = [];
  for (const r of rows) {
    if (r.work_id == null || seen.has(r.work_id)) continue;
    seen.add(r.work_id);
    out.push(r);
  }
  return out;
}

/** The page-length bands, as `[label, exclusive upper bound]`. The last band is open-ended. */
export const PAGE_BUCKETS: readonly (readonly [string, number])[] = [
  ["<200", 200],
  ["200-350", 350],
  ["350-500", 500],
  ["500-750", 750],
  ["750+", Infinity],
];

// The length histogram, over every owned book with a known page count. `totalPages` spans the
// whole collection — distinct from `totalPagesRead`, which is the read-only sum and stays as is.
export function computePageBuckets(rows: RawRow[]) {
  const counts = PAGE_BUCKETS.map(([label]) => ({ label, count: 0 }));
  let totalPages = 0;
  let knownCount = 0;
  for (const r of rows) {
    const p = r.pages;
    if (p == null || p <= 0) continue;
    knownCount++;
    totalPages += p;
    const i = PAGE_BUCKETS.findIndex(([, max]) => p < max);
    counts[i === -1 ? counts.length - 1 : i].count++;
  }
  return { pageBuckets: counts, totalPages, pagesKnownCount: knownCount };
}

/** A genre needs this many rated works before it can be called best- or worst-rated. Mirrors the
 *  `count < 10` floor in `computeDecadeGenres`: without it a single 10/10 book wins outright. */
export const GENRE_RATING_MIN_SAMPLE = 5;

// Best- and worst-rated genre. Deduped by work first (see `dedupeByWork`), and a book counts
// toward every genre it carries — the same many-to-one shape `computeGenreCounts` uses.
export function computeGenreRatings(rows: RawRow[]) {
  const sums = new Map<string, { sum: number; count: number }>();
  for (const r of dedupeByWork(rows)) {
    if (r.rating == null || !r.genres) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.genres);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    for (const g of parsed) {
      if (typeof g !== "string") continue;
      const label = titleCase(g);
      const entry = sums.get(label) ?? { sum: 0, count: 0 };
      entry.sum += r.rating;
      entry.count++;
      sums.set(label, entry);
    }
  }
  const ranked = [...sums.entries()]
    .filter(([, v]) => v.count >= GENRE_RATING_MIN_SAMPLE)
    .map(([label, v]) => ({
      label,
      avg: Math.round((v.sum / v.count) * 10) / 10,
      count: v.count,
    }))
    // Ties break on the label so the answer is stable across requests rather than
    // depending on Map insertion order, i.e. on the order D1 happened to return rows in.
    .sort((a, b) => b.avg - a.avg || a.label.localeCompare(b.label));
  if (ranked.length === 0) return { best: null, worst: null };
  const best = ranked[0];
  // Index arithmetic rather than `.at(-1)`: the worker's TS lib target predates
  // Array.prototype.at, and bumping it for one call site is not this change's business.
  // eslint-disable-next-line unicorn/prefer-at
  const worst = ranked[ranked.length - 1];
  // One qualifying genre is its own best and worst, which reads as a bug in the UI.
  return ranked.length === 1 ? { best, worst: null } : { best, worst };
}

// The catalogue-gap counts, each of which the frontend turns into a library deep-link.
// `noGenre` and `noYear` are passed in rather than recomputed — they're already produced by
// `computeGenreCounts` and `computeYearStats`, and two counts of the same thing would drift.
export function computeCatalogueGaps(
  rows: RawRow[],
  known: { noGenre: number; yearKnownCount: number },
) {
  let noCover = 0;
  let noPageCount = 0;
  let enrichmentPending = 0;
  let readUnrated = 0;
  for (const r of rows) {
    if (!r.cover_url) noCover++;
    if (r.pages == null || r.pages <= 0) noPageCount++;
    // A book with no work link has never been enriched and never will be until one exists, so
    // it belongs in this count as much as a work still sitting on `pending` does.
    if (r.work_id == null || r.enrichment_status === "pending") enrichmentPending++;
    if (r.status === "read" && r.rating == null) readUnrated++;
  }
  return {
    noCover,
    noPageCount,
    noGenre: known.noGenre,
    noYear: rows.length - known.yearKnownCount,
    enrichmentPending,
    readUnrated,
  };
}

// Owning-status counts, so the breakdown picker's `owning` dimension has data behind it.
// Which keys can be non-zero follows the request's `?scope=`: under `owned` only `owned` and
// `lent_out` survive the gate, under `all` every one of them can. The shape stays total either
// way so the client never has to guess at a missing key. Deliberately computed from the scoped
// rows rather than from the ungated `scopeCounts` query, so this breakdown adds up to the same
// `total` every other breakdown on the page does.
export function computeOwningCounts(rows: RawRow[]) {
  const counts = { owned: 0, lent_out: 0, unowned: 0, want: 0, unknown: 0 };
  for (const r of rows) {
    if (r.owning_status in counts) counts[r.owning_status as keyof typeof counts]++;
    else counts.unknown++;
  }
  return counts;
}

function computePageStats(rows: RawRow[]) {
  const pageNums = rows
    .filter((r) => r.pages != null && r.pages > 0)
    .map((r) => r.pages as number);
  const avgPages =
    pageNums.length > 0
      ? Math.round(pageNums.reduce((a, b) => a + b, 0) / pageNums.length)
      : null;

  const readPageNums = rows
    .filter((r) => r.status === "read" && r.pages != null && r.pages > 0)
    .map((r) => r.pages as number);
  const totalPagesRead =
    readPageNums.length > 0 ? readPageNums.reduce((a, b) => a + b, 0) : null;

  return { avgPages, totalPagesRead };
}

export function computeYearStats(rows: RawRow[]) {
  const years = rows
    .map((r) => extractYear(r))
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);
  const yearKnownCount = years.length;
  const medianYear =
    yearKnownCount > 0 ? years[Math.floor(yearKnownCount / 2)] : null;

  const decadeCounts = new Map<string, number>();
  for (const y of years) {
    const label = `${Math.floor(y / 10) * 10}s`;
    decadeCounts.set(label, (decadeCounts.get(label) ?? 0) + 1);
  }
  // Uncapped, unlike every other breakdown: the stats page draws these as a chronological
  // histogram, and a top-15-by-count slice silently drops whichever decades are sparse — which
  // in a histogram reads as "you own nothing from the 1970s" rather than as a truncation.
  // `extractYear` bounds years to 100..2100, so the set can't exceed ~200 entries.
  const decades = topCounts(decadeCounts, decadeCounts.size);

  return { years, yearKnownCount, medianYear, decades };
}

// Decade × dominant genre
export function computeDecadeGenres(rows: RawRow[]) {
  const decadeGenreCounts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const year = extractYear(r);
    if (year === null || !r.genres) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.genres);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const decadeLabel = `${Math.floor(year / 10) * 10}s`;
    let inner = decadeGenreCounts.get(decadeLabel);
    if (!inner) {
      inner = new Map();
      decadeGenreCounts.set(decadeLabel, inner);
    }
    for (const g of parsed) {
      if (typeof g === "string") {
        const label = titleCase(g);
        inner.set(label, (inner.get(label) ?? 0) + 1);
      }
    }
  }
  return [...decadeGenreCounts.entries()]
    .filter(([, genreMap]) => genreMap.size > 0)
    .map(([decade, genreMap]) => {
      const total_count = [...genreMap.values()].reduce(
        (sum, count) => sum + count,
        0,
      );
      const [genre, count] = [...genreMap.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (count < 10) return null;
      return { decade, genre, count, total_count };
    })
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, b) => parseInt(a.decade, 10) - parseInt(b.decade, 10));
}

/** The rating scale, as the number of buckets the distribution always reports (0–10 inclusive). */
export const RATING_SCALE_MAX = 10;

/** The all-zero distribution. The dense shape is a contract (see `computeRatingStats`), so every
 *  fallback has to produce 11 buckets rather than an empty array a consumer can't index. */
export const emptyRatingDistribution = () =>
  Array.from({ length: RATING_SCALE_MAX + 1 }, (_, rating) => ({
    rating,
    count: 0,
  }));

// Ratings are per **work**, so the SQL counts distinct works rather than scans — owning two
// editions of a book you rated 8 must not weight that 8 twice. The distribution is dense: every
// value 0..10 is present, zero-count included, so a histogram doesn't have to fill its own gaps.
export function computeRatingStats(ratingRows: RatingRow[]) {
  const counts = new Map<number, number>();
  for (const r of ratingRows) {
    if (!Number.isInteger(r.rating) || r.rating < 0 || r.rating > RATING_SCALE_MAX)
      continue;
    counts.set(r.rating, (counts.get(r.rating) ?? 0) + r.count);
  }
  const ratingDistribution = emptyRatingDistribution().map((d) => ({
    ...d,
    count: counts.get(d.rating) ?? 0,
  }));
  const ratedCount = ratingDistribution.reduce((sum, d) => sum + d.count, 0);
  const weighted = ratingDistribution.reduce(
    (sum, d) => sum + d.rating * d.count,
    0,
  );
  const avgRating =
    ratedCount > 0 ? Math.round((weighted / ratedCount) * 10) / 10 : null;
  return { avgRating, ratedCount, ratingDistribution };
}

// Translation ratio: edition language (ISO code) vs work's original language. Prefers a direct
// ISO-code comparison (language_of_work_code, backfilled by the schema-version sweeper); falls
// back to the older English-label comparison for rows the sweeper hasn't reached yet.
export function computeTranslationRatio(rows: RawRow[]) {
  const langNamer = new Intl.DisplayNames(["en"], { type: "language" });
  let translatedCount = 0;
  let translationKnownCount = 0;
  for (const r of rows) {
    if (!r.language || !r.language_of_work) continue;
    translationKnownCount++;
    if (r.language_of_work_code) {
      if (r.language.toLowerCase() !== r.language_of_work_code.toLowerCase())
        translatedCount++;
      continue;
    }
    let editionLangName: string;
    try {
      editionLangName = langNamer.of(r.language) ?? r.language;
    } catch {
      editionLangName = r.language;
    }
    if (editionLangName.toLowerCase() !== r.language_of_work.toLowerCase())
      translatedCount++;
  }
  return translationKnownCount > 0
    ? {
        pct: Math.round((translatedCount / translationKnownCount) * 100),
        translatedCount,
        knownCount: translationKnownCount,
      }
    : null;
}

// Custom fields — group by field def, count values
function computeCustomFields(customFieldRows: CustomFieldRow[]) {
  const cfMap = new Map<
    number,
    { fieldName: string; fieldType: string; valueCounts: Map<string, number> }
  >();
  for (const row of customFieldRows) {
    if (row.field_value == null) continue;
    if (!cfMap.has(row.field_def_id)) {
      cfMap.set(row.field_def_id, {
        fieldName: row.field_name,
        fieldType: row.field_type,
        valueCounts: new Map(),
      });
    }
    const entry = cfMap.get(row.field_def_id)!;
    const vals =
      row.field_type === "tag"
        ? parseTagArray(row.field_value)
        : [row.field_value];
    for (const v of vals) {
      entry.valueCounts.set(v, (entry.valueCounts.get(v) ?? 0) + 1);
    }
  }
  return [...cfMap.entries()].map(
    ([fieldDefId, { fieldName, valueCounts }]) => ({
      fieldDefId,
      fieldName,
      values: topCounts(valueCounts, 15),
    }),
  );
}

// Split three ways purely to keep each function under the complexity ceiling — one `??` per
// field adds up. The grouping deliberately mirrors `normalizeStats`/`normalizeDimensions`/
// `normalizeMeasures` in `src/utils/stats-view.ts`, the hand-written client-side mirror of this
// same shape, so a field lands in the matching half on both sides.

/** The list and count fields — the bulk of the payload and the least interesting part of it. */
function buildDimensions(input: StatsResponse) {
  return {
    genres: input.genres ?? [],
    uncategorizedGenreCount: input.uncategorizedGenreCount ?? 0,
    languages: input.languages ?? [],
    languageCount: input.languageCount ?? 0,
    topAuthors: input.topAuthors ?? [],
    authorCount: input.authorCount ?? 0,
    publishers: input.publishers ?? [],
    forms: input.forms ?? [],
    subjects: input.subjects ?? [],
    countries: input.countries ?? [],
    countryCount: input.countryCount ?? 0,
    decades: input.decades ?? [],
    decadeGenres: input.decadeGenres ?? [],
    topSeries: input.topSeries ?? [],
    customFields: input.customFields ?? [],
    genreCount: input.genreCount ?? 0,
  };
}

/** The scalar measures. `ratingDistribution` falls back to the dense zeros, never `[]` — the
 *  shape is a contract consumers may index directly (see `computeRatingStats`). */
function buildMeasures(input: StatsResponse) {
  return {
    avgPages: input.avgPages ?? null,
    totalPagesRead: input.totalPagesRead ?? null,
    totalPages: input.totalPages ?? 0,
    pagesKnownCount: input.pagesKnownCount ?? 0,
    pageBuckets: input.pageBuckets ?? [],
    medianYear: input.medianYear ?? null,
    yearKnownCount: input.yearKnownCount ?? 0,
    avgRating: input.avgRating ?? null,
    ratedCount: input.ratedCount ?? 0,
    ratingDistribution: input.ratingDistribution ?? emptyRatingDistribution(),
    translationRatio: input.translationRatio ?? null,
    randomFirstLine: input.randomFirstLine ?? null,
  };
}

function buildStatsResponse(input: StatsResponse): StatsResponse {
  return {
    total: input.total,
    byStatus: input.byStatus,
    owningStatus: input.owningStatus ?? {
      owned: 0,
      lent_out: 0,
      unowned: 0,
      want: 0,
      unknown: 0,
    },
    genreRatings: input.genreRatings ?? { best: null, worst: null },
    catalogueGaps: input.catalogueGaps ?? {
      noCover: 0,
      noPageCount: 0,
      noGenre: 0,
      noYear: 0,
      enrichmentPending: 0,
      readUnrated: 0,
    },
    scopeCounts: input.scopeCounts ?? { owned: 0, all: 0 },
    spotlight: input.spotlight ?? [],
    exemplars: input.exemplars ?? {
      oldest: null,
      longest: null,
      soleLanguage: null,
    },
    ...buildDimensions(input),
    ...buildMeasures(input),
  };
}

stats.get("/", async (c) => {
  const userId = c.get("userId");
  const locale = (c.req.query("locale") ?? "en").slice(0, 5);
  const scopeClause = scopeClauseFor(c.req.query("scope"));

  const [
    { results },
    seriesResult,
    customFieldResult,
    firstLineResult,
    ratingResult,
    scopeCountRow,
  ] = await Promise.all([
      c.env.DB.prepare(
        `
      SELECT s.status                                                        AS status,
             s.owning_status                                                 AS owning_status,
             b.title                                                         AS title,
             b.isbn                                                          AS isbn,
             b.author                                                        AS author,
             ${AUTHORS_JSON_SUBQUERY}                                       AS authors_json,
             COALESCE(o.language, b.language)                               AS language,
             COALESCE(o.number_of_pages_median, b.number_of_pages_median)   AS pages,
             COALESCE(o.cover_url, b.cover_url)                             AS cover_url,
             COALESCE(o.publish_date, b.publish_date)                       AS publish_date,
             COALESCE(o.publisher, b.publisher)                             AS publisher,
             b.work_id                                                       AS work_id,
             wk.enrichment_status                                            AS enrichment_status,
             wr.rating                                                       AS rating,
             wk.original_pub_date                                           AS original_pub_date,
             wk.genres                                                      AS genres,
             wk.form_of_work                                                AS form_of_work,
             wk.main_subject                                                AS main_subject,
             wk.countries_of_origin                                         AS countries_of_origin,
             wk.language_of_work                                            AS language_of_work,
             wk.language_of_work_code                                       AS language_of_work_code
      FROM scans s
      JOIN books b ON s.book_id = b.id
      LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
      LEFT JOIN works wk ON wk.id = b.work_id
      LEFT JOIN work_ratings wr ON wr.work_id = b.work_id AND wr.user_id = s.user_id
      WHERE s.user_id = ? AND ${scopeClause}
    `,
      )
        .bind(userId)
        .all<RawRow>(),

      c.env.DB.prepare(
        `
      SELECT COALESCE(sn.name, ser.canonical_name) AS label, COUNT(*) AS count
      FROM scans s
      JOIN books b ON s.book_id = b.id
      JOIN works wk ON wk.id = b.work_id
      JOIN work_series ws ON ws.work_id = wk.id
      JOIN series ser ON ser.id = ws.series_id
      LEFT JOIN series_names sn ON sn.series_id = ser.id AND sn.language = ?
      WHERE s.user_id = ? AND ${scopeClause}
      GROUP BY ser.id
      ORDER BY count DESC
      LIMIT 15
    `,
      )
        .bind(locale, userId)
        .all<SeriesRow>(),

      c.env.DB.prepare(
        `
      SELECT ufd.id AS field_def_id, ufd.field_name, ufd.field_type, bcf.field_value
      FROM book_custom_fields bcf
      JOIN user_field_definitions ufd ON ufd.id = bcf.field_def_id
      JOIN scans s ON s.book_id = bcf.book_id AND s.user_id = bcf.user_id
      WHERE bcf.user_id = ?
      AND ufd.field_type NOT IN ('date', 'integer')
      AND ${scopeClause}
    `,
      )
        .bind(userId)
        .all<CustomFieldRow>(),

      // A pool rather than one row (see `SPOTLIGHT_POOL_SIZE`): same query cost, and the home
      // page can re-roll client-side instead of refetching the whole aggregate.
      c.env.DB.prepare(
        `
      SELECT b.isbn                                                          AS isbn,
             b.title                                                          AS title,
             b.work_id                                                        AS work_id,
             b.author                                                         AS author,
             wk.first_line                                                    AS first_line,
             wk.original_pub_date                                             AS original_pub_date,
             COALESCE(o.cover_url, b.cover_url)                               AS cover_url,
             COALESCE(o.publish_date, b.publish_date)                         AS publish_date,
             COALESCE(o.publisher, b.publisher)                               AS publisher,
             COALESCE(o.number_of_pages_median, b.number_of_pages_median)     AS pages
      FROM scans s
      JOIN books b ON s.book_id = b.id
      JOIN works wk ON wk.id = b.work_id
      LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
      WHERE s.user_id = ? AND ${scopeClause}
        AND wk.first_line IS NOT NULL AND wk.first_line != ''
      ORDER BY RANDOM()
      LIMIT ${SPOTLIGHT_POOL_SIZE}
    `,
      )
        .bind(userId)
        .all<SpotlightRow>(),

      // COUNT(DISTINCT b.work_id), not COUNT(*): the rating hangs off the work, so a user who
      // owns two editions of one book would otherwise contribute that rating twice.
      c.env.DB.prepare(
        `
      SELECT wr.rating AS rating, COUNT(DISTINCT b.work_id) AS count
      FROM scans s
      JOIN books b ON s.book_id = b.id
      JOIN work_ratings wr ON wr.work_id = b.work_id AND wr.user_id = s.user_id
      WHERE s.user_id = ? AND ${scopeClause}
        AND wr.rating IS NOT NULL
      GROUP BY wr.rating
    `,
      )
        .bind(userId)
        .all<RatingRow>(),

      // Deliberately ungated and separate from the main query rather than derived from it: the
      // whole point is to report the size of the scope the caller *didn't* ask for. One indexed
      // aggregate over `scans` is cheaper than widening the main row read to every scan.
      c.env.DB.prepare(
        `
      SELECT COUNT(*) AS all_count,
             SUM(CASE WHEN s.owning_status IN ('owned', 'lent_out') THEN 1 ELSE 0 END) AS owned_count
      FROM scans s
      WHERE s.user_id = ?
    `,
      )
        .bind(userId)
        .first<{ all_count: number; owned_count: number | null }>(),
    ]);

  const rows = results;

  const byStatus = computeStatusCounts(rows);
  const { topAuthors, authorCount } = computeTopAuthors(rows);
  const languages = computeLanguages(rows);
  const { genres, genreCount, uncategorizedGenreCount } =
    computeGenreCounts(rows);
  const publishers = computeStringFieldCounts(rows, "publisher");
  const forms = computeStringFieldCounts(rows, "form_of_work");
  const subjects = computeStringFieldCounts(rows, "main_subject");
  const { countries, countryCount } = computeCountries(rows);
  const owningStatus = computeOwningCounts(rows);
  const { avgPages, totalPagesRead } = computePageStats(rows);
  const { pageBuckets, totalPages, pagesKnownCount } = computePageBuckets(rows);
  const { yearKnownCount, medianYear, decades } = computeYearStats(rows);
  const decadeGenres = computeDecadeGenres(rows);
  const translationRatio = computeTranslationRatio(rows);
  const genreRatings = computeGenreRatings(rows);
  const catalogueGaps = computeCatalogueGaps(rows, {
    noGenre: uncategorizedGenreCount,
    yearKnownCount,
  });
  const { avgRating, ratedCount, ratingDistribution } = computeRatingStats(
    ratingResult.results,
  );

  // The home page's spotlight pool. `randomFirstLine` is the first entry, kept as its own field
  // so a client that only knows the old shape still gets exactly what it used to.
  const spotlight: SpotlightBook[] = firstLineResult.results.map((r) => ({
    isbn: r.isbn,
    title: r.title,
    firstLine: r.first_line,
    workId: r.work_id,
    author: r.author,
    coverUrl: r.cover_url,
    year: yearFromDates(r.original_pub_date, r.publish_date),
    publisher: r.publisher,
    pages: r.pages,
  }));
  const randomFirstLine = spotlight[0]
    ? { title: spotlight[0].title ?? "", firstLine: spotlight[0].firstLine }
    : null;

  const exemplars = computeExemplars(rows);

  // Series
  const topSeries = seriesResult.results.map((r) => ({
    label: r.label,
    count: r.count,
  }));

  const customFields = computeCustomFields(customFieldResult.results);

  // SUM over no rows is NULL, and `first()` is nullable in the types — an account with no scans
  // at all has to read as 0/0 rather than as NaN in the client's empty-state sentence.
  const scopeCounts = {
    owned: scopeCountRow?.owned_count ?? 0,
    all: scopeCountRow?.all_count ?? 0,
  };

  return c.json(
    buildStatsResponse({
      total: rows.length,
      byStatus,
      genres,
      uncategorizedGenreCount,
      languages,
      languageCount: languages.length,
      topAuthors,
      authorCount,
      publishers,
      forms,
      subjects,
      countries,
      countryCount,
      owningStatus,
      decades,
      decadeGenres,
      topSeries,
      customFields,
      avgPages,
      totalPagesRead,
      totalPages,
      pagesKnownCount,
      pageBuckets,
      medianYear,
      yearKnownCount,
      genreCount,
      avgRating,
      ratedCount,
      ratingDistribution,
      genreRatings,
      catalogueGaps,
      translationRatio,
      randomFirstLine,
      spotlight,
      exemplars,
      scopeCounts,
    }),
  );
});

export default stats;
