import { describe, it, expect } from "vitest";
import {
  computeDecadeGenres,
  computeRatingStats,
  computeTranslationRatio,
  computeYearStats,
  extractYear,
  type RawRow,
} from "../src/routes/stats";

/** A stats row with everything absent, so each test names only the columns it is about. */
function row(overrides: Partial<RawRow> = {}): RawRow {
  return {
    status: "read",
    author: null,
    authors_json: null,
    language: null,
    pages: null,
    publish_date: null,
    publisher: null,
    original_pub_date: null,
    genres: null,
    form_of_work: null,
    main_subject: null,
    countries_of_origin: null,
    language_of_work: null,
    language_of_work_code: null,
    ...overrides,
  };
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

  it("caps the decade list at 15 entries", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      row({ original_pub_date: String(1800 + i * 10) }),
    );
    expect(computeYearStats(rows).decades).toHaveLength(15);
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
