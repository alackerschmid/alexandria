import { describe, it, expect } from "vitest";
import {
  computeCatalogueGaps,
  computeDecadeGenres,
  computeExemplars,
  computeGenreRatings,
  computeOwningCounts,
  computePageBuckets,
  computeRatingStats,
  computeTranslationRatio,
  computeYearStats,
  dedupeByWork,
  extractYear,
  scopeClauseFor,
  SCOPE_CLAUSES,
  type RawRow,
} from "../src/routes/stats";

/** A stats row with everything absent, so each test names only the columns it is about. */
function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    status: "read",
    owning_status: "owned",
    title: null,
    isbn: "",
    author: null,
    authors_json: null,
    language: null,
    pages: null,
    cover_url: null,
    publish_date: null,
    publisher: null,
    original_pub_date: null,
    genres: null,
    form_of_work: null,
    main_subject: null,
    countries_of_origin: null,
    language_of_work: null,
    language_of_work_code: null,
    work_id: null,
    enrichment_status: null,
    rating: null,
    ...overrides,
  };
}

/** Shorthand for a rated, genre-tagged work — the shape `computeGenreRatings` cares about. */
function rated(workId: number, rating: number, genres: string[]): RawRow {
  return row({ work_id: workId, rating, genres: JSON.stringify(genres) });
}

describe("extractYear", () => {
  it("prefers the work's original publication year over the edition's", () => {
    // The point of the whole helper: a 2019 reprint of a 1954 novel belongs in the 1950s.
    expect(
      extractYear(row({ original_pub_date: "1954", publish_date: "2019-07-01" })),
    ).toBe(1954);
  });

  it("falls back to the edition's publish date", () => {
    expect(extractYear(row({ publish_date: "2019-07-01" }))).toBe(2019);
  });

  it("finds a 4-digit year anywhere in a free-text publish date", () => {
    expect(extractYear(row({ publish_date: "July 2019" }))).toBe(2019);
    expect(extractYear(row({ publish_date: "1999" }))).toBe(1999);
  });

  it("returns null when neither column has a year", () => {
    expect(extractYear(row())).toBeNull();
    expect(extractYear(row({ publish_date: "undated" }))).toBeNull();
  });

  it("rejects years outside 100–2100 and falls through to the edition", () => {
    // A bad Wikidata date ("0", a bare "20") must not create a "0s" decade bucket.
    expect(extractYear(row({ original_pub_date: "0" }))).toBeNull();
    expect(
      extractYear(row({ original_pub_date: "20", publish_date: "2019" })),
    ).toBe(2019);
    expect(extractYear(row({ original_pub_date: "3000" }))).toBeNull();
  });

  it("accepts the exact bounds", () => {
    expect(extractYear(row({ original_pub_date: "100" }))).toBe(100);
    expect(extractYear(row({ original_pub_date: "2100" }))).toBe(2100);
  });

  it("rejects an out-of-range year found in the publish date too", () => {
    expect(extractYear(row({ publish_date: "9999-01-01" }))).toBeNull();
  });

  it("reads a leading year out of a partial ISO original date", () => {
    // parseInt stops at the first non-digit, which is what makes "1954-01-01" work here.
    expect(extractYear(row({ original_pub_date: "1954-01-01" }))).toBe(1954);
  });
});

describe("scopeClauseFor", () => {
  it("defaults to the owned gate", () => {
    expect(scopeClauseFor(undefined)).toBe(SCOPE_CLAUSES.owned);
    expect(scopeClauseFor("")).toBe(SCOPE_CLAUSES.owned);
    expect(scopeClauseFor("nonsense")).toBe(SCOPE_CLAUSES.owned);
  });

  it("resolves the scopes it knows", () => {
    expect(scopeClauseFor("owned")).toBe(SCOPE_CLAUSES.owned);
    expect(scopeClauseFor("all")).toBe(SCOPE_CLAUSES.all);
  });

  it("does not reach the prototype chain", () => {
    // The clause is interpolated into the SQL, so an inherited property would stringify a
    // function into the query as a 500 — the exact bug `sortClauseFor` was fixed for.
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(scopeClauseFor(key)).toBe(SCOPE_CLAUSES.owned);
    }
  });
});

describe("computeYearStats", () => {
  it("returns the empty shape when no row has a year", () => {
    expect(computeYearStats([row(), row({ publish_date: "n/a" })])).toEqual({
      years: [],
      yearKnownCount: 0,
      medianYear: null,
      decades: [],
    });
  });

  it("sorts the years and counts only the known ones", () => {
    const stats = computeYearStats([
      row({ original_pub_date: "1999" }),
      row(),
      row({ original_pub_date: "1954" }),
    ]);
    expect(stats.years).toEqual([1954, 1999]);
    expect(stats.yearKnownCount).toBe(2);
  });

  it("takes the upper of two middles for an even count", () => {
    // Math.floor(n / 2) on a sorted list — documented here so a later "fix" to a true mean is a
    // deliberate change rather than an accident.
    const stats = computeYearStats([
      row({ original_pub_date: "1900" }),
      row({ original_pub_date: "2000" }),
    ]);
    expect(stats.medianYear).toBe(2000);
  });

  it("takes the middle element for an odd count", () => {
    const stats = computeYearStats([
      row({ original_pub_date: "2000" }),
      row({ original_pub_date: "1900" }),
      row({ original_pub_date: "1950" }),
    ]);
    expect(stats.medianYear).toBe(1950);
  });

  it("labels decades by their first year and orders them by count", () => {
    const stats = computeYearStats([
      row({ original_pub_date: "1955" }),
      row({ original_pub_date: "1951" }),
      row({ original_pub_date: "1999" }),
    ]);
    expect(stats.decades).toEqual([
      { label: "1950s", count: 2 },
      { label: "1990s", count: 1 },
    ]);
  });

  it("puts a year on a decade boundary in the decade it starts", () => {
    expect(computeYearStats([row({ original_pub_date: "1960" })]).decades).toEqual(
      [{ label: "1960s", count: 1 }],
    );
  });

  it("does not cap the decade list", () => {
    // Deliberately uncapped, unlike every other breakdown: the stats page draws these as a
    // chronological histogram, where a top-15-by-count slice would drop the sparse decades and
    // read as "you own nothing from the 1970s" rather than as a truncation. `extractYear`
    // bounds years to 100..2100, so the set is inherently small.
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ original_pub_date: String(1800 + i * 10) }),
    );
    expect(computeYearStats(rows).decades).toHaveLength(20);
  });
});

describe("computeDecadeGenres", () => {
  const genreRows = (year: string, genre: string, count: number) =>
    Array.from({ length: count }, () =>
      row({ original_pub_date: year, genres: JSON.stringify([genre]) }),
    );

  it("drops a decade whose dominant genre is under 10 books", () => {
    // The cutoff is the whole point: one sci-fi novel does not make a decade's character.
    expect(computeDecadeGenres(genreRows("1955", "science fiction", 9))).toEqual(
      [],
    );
  });

  it("reports a decade once its dominant genre reaches 10", () => {
    expect(computeDecadeGenres(genreRows("1955", "science fiction", 10))).toEqual(
      [
        {
          decade: "1950s",
          genre: "Science Fiction",
          count: 10,
          total_count: 10,
        },
      ],
    );
  });

  it("counts every genre toward total_count but reports only the dominant one", () => {
    const rows = [
      ...genreRows("1955", "science fiction", 10),
      ...genreRows("1957", "poetry", 3),
    ];
    const [entry] = computeDecadeGenres(rows);
    expect(entry.genre).toBe("Science Fiction");
    expect(entry.count).toBe(10);
    expect(entry.total_count).toBe(13);
  });

  it("counts every genre on a multi-genre row", () => {
    const rows = Array.from({ length: 10 }, () =>
      row({
        original_pub_date: "1955",
        genres: JSON.stringify(["science fiction", "satire"]),
      }),
    );
    const [entry] = computeDecadeGenres(rows);
    expect(entry.total_count).toBe(20);
    expect(entry.count).toBe(10);
  });

  it("sorts decades chronologically, not by count", () => {
    const rows = [
      ...genreRows("1995", "fantasy", 10),
      ...genreRows("1955", "science fiction", 12),
    ];
    expect(computeDecadeGenres(rows).map((d) => d.decade)).toEqual([
      "1950s",
      "1990s",
    ]);
  });

  it("skips rows with no year and rows with no genres", () => {
    const rows = [
      ...genreRows("1955", "science fiction", 10),
      row({ genres: JSON.stringify(["horror"]) }), // no year
      row({ original_pub_date: "1955" }), // no genres
    ];
    expect(computeDecadeGenres(rows)).toHaveLength(1);
  });

  it("survives a malformed genres column", () => {
    // `works.genres` is written by the enrichment pipeline, so a bad row is a bug elsewhere — but
    // one row must not 500 the whole stats endpoint.
    const rows = [
      ...genreRows("1955", "science fiction", 10),
      row({ original_pub_date: "1965", genres: "not json" }),
      row({ original_pub_date: "1975", genres: JSON.stringify("fantasy") }),
      row({ original_pub_date: "1985", genres: JSON.stringify([42, null]) }),
    ];
    expect(computeDecadeGenres(rows)).toEqual([
      {
        decade: "1950s",
        genre: "Science Fiction",
        count: 10,
        total_count: 10,
      },
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(computeDecadeGenres([])).toEqual([]);
  });
});

describe("computeTranslationRatio", () => {
  it("returns null when no row can be judged", () => {
    // Distinct from 0%: "we can't tell" must not render as "nothing translated".
    expect(computeTranslationRatio([row()])).toBeNull();
    expect(computeTranslationRatio([row({ language: "en" })])).toBeNull();
    expect(
      computeTranslationRatio([row({ language_of_work: "German" })]),
    ).toBeNull();
  });

  it("compares ISO codes when the work has one", () => {
    const ratio = computeTranslationRatio([
      // English edition of a German work — a translation.
      row({
        language: "en",
        language_of_work: "German",
        language_of_work_code: "de",
      }),
      // German edition of the same — the original.
      row({
        language: "de",
        language_of_work: "German",
        language_of_work_code: "de",
      }),
    ]);
    expect(ratio).toEqual({ pct: 50, translatedCount: 1, knownCount: 2 });
  });

  it("ignores case on both sides of the code comparison", () => {
    const ratio = computeTranslationRatio([
      row({
        language: "DE",
        language_of_work: "German",
        language_of_work_code: "de",
      }),
    ]);
    expect(ratio).toEqual({ pct: 0, translatedCount: 0, knownCount: 1 });
  });

  it("falls back to the English label for rows the sweeper hasn't backfilled", () => {
    const ratio = computeTranslationRatio([
      // No language_of_work_code: "en" resolves to "English", which matches the label.
      row({ language: "en", language_of_work: "English" }),
      row({ language: "en", language_of_work: "German" }),
    ]);
    expect(ratio).toEqual({ pct: 50, translatedCount: 1, knownCount: 2 });
  });

  it("counts a row whose edition language isn't a resolvable code as translated", () => {
    // Intl either throws or echoes the input; either way it can't match a real language label, so
    // the row lands on "translated" rather than being dropped. Documented, not endorsed.
    const ratio = computeTranslationRatio([
      row({ language: "zzz", language_of_work: "English" }),
    ]);
    expect(ratio).toEqual({ pct: 100, translatedCount: 1, knownCount: 1 });
  });

  it("rounds the percentage", () => {
    const rows = [
      row({ language: "en", language_of_work: "German", language_of_work_code: "de" }),
      row({ language: "de", language_of_work: "German", language_of_work_code: "de" }),
      row({ language: "de", language_of_work: "German", language_of_work_code: "de" }),
    ];
    expect(computeTranslationRatio(rows)?.pct).toBe(33);
  });

  it("returns null for no rows at all", () => {
    expect(computeTranslationRatio([])).toBeNull();
  });
});

describe("computeRatingStats", () => {
  it("reports a dense 0-10 distribution with zero-count buckets", () => {
    const { ratingDistribution } = computeRatingStats([{ rating: 7, count: 2 }]);
    expect(ratingDistribution).toHaveLength(11);
    expect(ratingDistribution.map((d) => d.rating)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(ratingDistribution[7]).toEqual({ rating: 7, count: 2 });
    expect(ratingDistribution[0]).toEqual({ rating: 0, count: 0 });
  });

  it("weights the average by each bucket's count", () => {
    const { avgRating, ratedCount } = computeRatingStats([
      { rating: 10, count: 3 },
      { rating: 6, count: 1 },
    ]);
    expect(ratedCount).toBe(4);
    expect(avgRating).toBe(9);
  });

  it("rounds the average to one decimal", () => {
    expect(
      computeRatingStats([
        { rating: 8, count: 1 },
        { rating: 7, count: 2 },
      ]).avgRating,
    ).toBe(7.3);
  });

  // 0 is a real rating, not "unrated" — the SQL filters NULLs out, so every row that arrives here
  // counts, and a library of nothing but 0s must average 0 rather than null.
  it("treats a rating of 0 as rated", () => {
    expect(computeRatingStats([{ rating: 0, count: 2 }])).toMatchObject({
      avgRating: 0,
      ratedCount: 2,
    });
  });

  it("returns a null average and an empty-but-dense distribution for no ratings", () => {
    const stats = computeRatingStats([]);
    expect(stats.avgRating).toBeNull();
    expect(stats.ratedCount).toBe(0);
    // toHaveLength first: `.every()` alone is vacuously true on `[]`, so it would pass for an
    // early return that skipped the dense shape — which is exactly the case this test names.
    expect(stats.ratingDistribution).toHaveLength(11);
    expect(stats.ratingDistribution.every((d) => d.count === 0)).toBe(true);
  });

  it("drops out-of-scale and non-integer ratings rather than skewing the average", () => {
    const stats = computeRatingStats([
      { rating: 11, count: 5 },
      { rating: -1, count: 5 },
      { rating: 4.5, count: 5 },
      { rating: 4, count: 1 },
    ]);
    expect(stats.ratedCount).toBe(1);
    expect(stats.avgRating).toBe(4);
  });
});

describe("dedupeByWork", () => {
  it("keeps one row per work", () => {
    // Two owned editions of the same work carry the same work_ratings row through the LEFT
    // JOIN. This is the primitive that stops that rating being counted twice.
    const rows = [
      row({ work_id: 1, rating: 8 }),
      row({ work_id: 1, rating: 8 }),
      row({ work_id: 2, rating: 4 }),
    ];
    expect(dedupeByWork(rows).map((r) => r.work_id)).toEqual([1, 2]);
  });

  it("drops rows with no work link rather than treating each as its own work", () => {
    expect(dedupeByWork([row(), row(), row({ work_id: 3 })])).toHaveLength(1);
  });
});

describe("computePageBuckets", () => {
  it("bands each known page count and sums the whole collection", () => {
    const result = computePageBuckets([
      row({ pages: 120 }),
      row({ pages: 300 }),
      row({ pages: 420 }),
      row({ pages: 600 }),
      row({ pages: 900 }),
    ]);
    expect(result.pageBuckets).toEqual([
      { label: "<200", count: 1 },
      { label: "200-350", count: 1 },
      { label: "350-500", count: 1 },
      { label: "500-750", count: 1 },
      { label: "750+", count: 1 },
    ]);
    expect(result.totalPages).toBe(2340);
    expect(result.pagesKnownCount).toBe(5);
  });

  it("puts a boundary value in the band above it", () => {
    // The bands are half-open: 200 is the first page of "200-350", not the last of "<200".
    const result = computePageBuckets([row({ pages: 200 }), row({ pages: 350 })]);
    expect(result.pageBuckets[0].count).toBe(0);
    expect(result.pageBuckets[1].count).toBe(1);
    expect(result.pageBuckets[2].count).toBe(1);
  });

  it("ignores unknown and non-positive page counts", () => {
    // Google Books returns 0 for unknown; ingestion nulls it, but not every legacy row was.
    const result = computePageBuckets([row(), row({ pages: 0 }), row({ pages: -3 })]);
    expect(result.totalPages).toBe(0);
    expect(result.pagesKnownCount).toBe(0);
    expect(result.pageBuckets.every((b) => b.count === 0)).toBe(true);
  });
});

describe("computeGenreRatings", () => {
  const five = (workBase: number, rating: number, genre: string) =>
    Array.from({ length: 5 }, (_, i) => rated(workBase + i, rating, [genre]));

  it("ranks genres that clear the sample floor", () => {
    const result = computeGenreRatings([
      ...five(100, 9, "philosophy"),
      ...five(200, 3, "thriller"),
    ]);
    expect(result.best).toEqual({ label: "Philosophy", avg: 9, count: 5 });
    expect(result.worst).toEqual({ label: "Thriller", avg: 3, count: 5 });
  });

  it("ignores genres below the sample floor", () => {
    // A lone 10/10 must not outrank a genre with a real track record.
    const result = computeGenreRatings([
      ...five(100, 7, "history"),
      rated(300, 10, ["poetry"]),
    ]);
    expect(result.best?.label).toBe("History");
    expect(result.worst).toBeNull();
  });

  it("does not double-weight a rating the user owns two editions of", () => {
    // Both rows are work 1: one 10 alongside five 5s must average 5.8, not 6.7.
    const result = computeGenreRatings([
      rated(1, 10, ["essays"]),
      rated(1, 10, ["essays"]),
      ...five(10, 5, "essays"),
    ]);
    expect(result.best).toEqual({ label: "Essays", avg: 5.8, count: 6 });
  });

  it("counts a book toward every genre it carries", () => {
    const result = computeGenreRatings(
      Array.from({ length: 5 }, (_, i) => rated(i, 8, ["sci-fi", "fantasy"])),
    );
    expect(result.best?.count).toBe(5);
    expect(result.worst?.count).toBe(5);
  });

  it("reports no worst when only one genre qualifies", () => {
    const result = computeGenreRatings(five(100, 6, "drama"));
    expect(result.best?.label).toBe("Drama");
    expect(result.worst).toBeNull();
  });

  it("returns the empty shape when nothing qualifies", () => {
    expect(computeGenreRatings([row(), rated(1, 5, ["poetry"])])).toEqual({
      best: null,
      worst: null,
    });
  });

  it("skips unrated works and unparseable genre JSON", () => {
    const result = computeGenreRatings([
      ...five(100, 6, "history"),
      row({ work_id: 900, rating: 10, genres: "{not json" }),
      row({ work_id: 901, genres: JSON.stringify(["history"]) }),
    ]);
    expect(result.best).toEqual({ label: "History", avg: 6, count: 5 });
  });
});

describe("computeCatalogueGaps", () => {
  it("counts each gap independently", () => {
    const rows = [
      row({ cover_url: "https://x/1.jpg", pages: 300, work_id: 1, enrichment_status: "done" }),
      row({ cover_url: null, pages: 300, work_id: 2, enrichment_status: "done" }),
      row({ cover_url: "https://x/3.jpg", pages: null, work_id: 3, enrichment_status: "pending" }),
    ];
    const gaps = computeCatalogueGaps(rows, { noGenre: 7, yearKnownCount: 2 });
    expect(gaps.noCover).toBe(1);
    expect(gaps.noPageCount).toBe(1);
    expect(gaps.enrichmentPending).toBe(1);
    expect(gaps.noGenre).toBe(7);
    expect(gaps.noYear).toBe(1);
  });

  it("treats a book with no work link as an enrichment gap", () => {
    // Enrichment hangs off the work, so an unlinked book is not merely 'not done' — it has no
    // route to being enriched at all until a work exists.
    const gaps = computeCatalogueGaps([row({ work_id: null })], {
      noGenre: 0,
      yearKnownCount: 0,
    });
    expect(gaps.enrichmentPending).toBe(1);
  });

  it("counts read-but-unrated only for read books", () => {
    const gaps = computeCatalogueGaps(
      [
        row({ status: "read", work_id: 1, rating: null }),
        row({ status: "read", work_id: 2, rating: 8 }),
        row({ status: "unread", work_id: 3, rating: null }),
      ],
      { noGenre: 0, yearKnownCount: 3 },
    );
    expect(gaps.readUnrated).toBe(1);
  });

  it("treats a zero page count as missing", () => {
    const gaps = computeCatalogueGaps([row({ pages: 0 })], {
      noGenre: 0,
      yearKnownCount: 1,
    });
    expect(gaps.noPageCount).toBe(1);
  });
});

describe("computeOwningCounts", () => {
  it("counts the ownership states the query admits", () => {
    const counts = computeOwningCounts([
      row({ owning_status: "owned" }),
      row({ owning_status: "owned" }),
      row({ owning_status: "lent_out" }),
    ]);
    expect(counts).toEqual({
      owned: 2,
      lent_out: 1,
      unowned: 0,
      want: 0,
      unknown: 0,
    });
  });

  it("files an unrecognized value under unknown rather than dropping it", () => {
    // The shape is total so the client never has to guess at a missing key, and a count that
    // silently vanished would make the breakdown disagree with `total`.
    const counts = computeOwningCounts([row({ owning_status: "borrowed" })]);
    expect(counts.unknown).toBe(1);
  });
});

describe("computeExemplars", () => {
  it("dates the oldest book by the work's year, not the reprint's", () => {
    // The `extractYear` contract, applied where it matters most: a 2019 reprint of Frankenstein
    // is the oldest book on the shelf, and saying "your oldest book is from 2019" would be the
    // whole block reading as wrong.
    const { oldest } = computeExemplars([
      row({
        isbn: "1",
        title: "Frankenstein",
        original_pub_date: "1818",
        publish_date: "2019-07-01",
      }),
      row({ isbn: "2", title: "Dune", original_pub_date: "1965" }),
    ]);
    expect(oldest?.title).toBe("Frankenstein");
    expect(oldest?.year).toBe(1818);
  });

  it("ignores a year outside the bounds rather than crowning it oldest", () => {
    const { oldest } = computeExemplars([
      row({ isbn: "1", title: "Bad data", original_pub_date: "0" }),
      row({ isbn: "2", title: "Dune", original_pub_date: "1965" }),
    ]);
    expect(oldest?.title).toBe("Dune");
  });

  it("breaks an oldest tie on isbn so the block doesn't reshuffle between requests", () => {
    const both = [
      row({ isbn: "9780002", title: "Second", original_pub_date: "1818" }),
      row({ isbn: "9780001", title: "First", original_pub_date: "1818" }),
    ];
    expect(computeExemplars(both).oldest?.title).toBe("First");
    // Same rows, opposite order in from D1 — same answer out.
    expect(computeExemplars([...both].reverse()).oldest?.title).toBe("First");
  });

  it("picks the longest book by page count, ties broken on isbn", () => {
    const { longest } = computeExemplars([
      row({ isbn: "9780003", title: "Short", pages: 120 }),
      row({ isbn: "9780002", title: "Long B", pages: 1216 }),
      row({ isbn: "9780001", title: "Long A", pages: 1216 }),
    ]);
    expect(longest?.title).toBe("Long A");
    expect(longest?.pages).toBe(1216);
  });

  it("names the only book in its language", () => {
    const { soleLanguage } = computeExemplars([
      row({ isbn: "1", title: "A", language: "en" }),
      row({ isbn: "2", title: "B", language: "en" }),
      row({ isbn: "3", title: "L'Étranger", language: "fr" }),
    ]);
    expect(soleLanguage?.title).toBe("L'Étranger");
    expect(soleLanguage?.language).toBe("fr");
  });

  it("leaves soleLanguage null when no language has exactly one book", () => {
    // The monolingual library — the common case, and the reason the row hides rather than
    // announcing "your only book in English" about a shelf that is entirely English.
    const { soleLanguage } = computeExemplars([
      row({ isbn: "1", language: "en" }),
      row({ isbn: "2", language: "en" }),
      row({ isbn: "3", language: "de" }),
      row({ isbn: "4", language: "de" }),
    ]);
    expect(soleLanguage).toBeNull();
  });

  it("leaves soleLanguage null for a one-book library", () => {
    // Trivially true of the only book there is, and it would just repeat the `oldest` row.
    const { soleLanguage } = computeExemplars([
      row({ isbn: "1", title: "A", language: "en", original_pub_date: "1990" }),
    ]);
    expect(soleLanguage).toBeNull();
  });

  it("returns every exemplar null for an empty library", () => {
    expect(computeExemplars([])).toEqual({
      oldest: null,
      longest: null,
      soleLanguage: null,
    });
  });

  it("returns null for an exemplar nothing can answer", () => {
    // Books with no year and no page count: the block still renders whatever it can fill.
    const exemplars = computeExemplars([
      row({ isbn: "1", language: "en" }),
      row({ isbn: "2", language: "fr" }),
    ]);
    expect(exemplars.oldest).toBeNull();
    expect(exemplars.longest).toBeNull();
    expect(exemplars.soleLanguage).not.toBeNull();
  });

  it("ignores a zero page count rather than calling it the longest book", () => {
    const { longest } = computeExemplars([
      row({ isbn: "1", pages: 0 }),
      row({ isbn: "2", pages: 0 }),
    ]);
    expect(longest).toBeNull();
  });
});
