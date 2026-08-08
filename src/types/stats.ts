export interface DimensionItem {
  label: string;
  count: number;
}

export interface RatingBucket {
  rating: number;
  count: number;
}

/**
 * The all-zero rating distribution — the client-side mirror of the worker's
 * `emptyRatingDistribution`. `ratingDistribution` promises 11 dense buckets so a histogram never
 * has to fill its own gaps, which means a fallback for a payload that lacks the field (an older
 * worker) has to be the dense zeros, not `[]`: the type says consumers may index it.
 */
export const emptyRatingDistribution = (): RatingBucket[] =>
  Array.from({ length: 11 }, (_, rating) => ({ rating, count: 0 }));

export interface GenreRating {
  label: string;
  /** Mean rating for the genre, 0–10, one decimal. */
  avg: number;
  /** Rated **works** behind that mean, deduped — not owned copies. */
  count: number;
}

/**
 * Books missing a given piece of data. Each one is a library deep-link on the stats page, so the
 * keys line up with `useLibrarySearch`'s `missing:` values (`cover`, `pages`, `genre`, `year`);
 * the last two have no filter because neither is a property of the book the user can search for.
 */
export interface CatalogueGaps {
  noCover: number;
  noPageCount: number;
  noGenre: number;
  noYear: number;
  enrichmentPending: number;
  readUnrated: number;
}

export interface CollectionStats {
  total: number;
  byStatus: { read: number; reading: number; unread: number; dnf: number };
  genres: DimensionItem[];
  uncategorizedGenreCount: number;
  languages: { code: string; count: number }[];
  languageCount: number;
  topAuthors: DimensionItem[];
  authorCount: number;
  publishers: DimensionItem[];
  forms: DimensionItem[];
  subjects: DimensionItem[];
  countries: DimensionItem[];
  /** Distinct countries, not `countries.length` — that list is capped at 15 server-side, and the
   *  stats page's "N more" row is the difference between the two. Same relationship as
   *  `authorCount`/`topAuthors` and `genreCount`/`genres`. */
  countryCount: number;
  owningStatus: {
    owned: number;
    lent_out: number;
    unowned: number;
    want: number;
    unknown: number;
  };
  /** Uncapped and unordered by count — the stats page sorts these chronologically and rolls the
   *  early ones up, which a top-N-by-count slice would have made impossible. */
  decades: DimensionItem[];
  decadeGenres: {
    decade: string;
    genre: string;
    count: number;
    total_count: number;
  }[];
  topSeries: DimensionItem[];
  customFields: {
    fieldDefId: number;
    fieldName: string;
    values: DimensionItem[];
  }[];
  avgPages: number | null;
  /** Pages of **read** books only. `totalPages` is the whole collection — they are different
   *  numbers and the labels have to keep saying which is which. */
  totalPagesRead: number | null;
  totalPages: number;
  pagesKnownCount: number;
  /** The five length bands, ascending, always present. Labels are stable ids (`"<200"`,
   *  `"200-350"`, …) that the client maps to translated strings — never display them raw. */
  pageBuckets: DimensionItem[];
  medianYear: number | null;
  yearKnownCount: number;
  genreCount: number;
  /** Mean of every rated **work** the user owns, one decimal, on the 0–10 scale. */
  avgRating: number | null;
  ratedCount: number;
  /** Always 11 entries, `rating` 0–10 ascending, zero-count buckets included — so a consumer may
   *  index it directly. Build any fallback with `emptyRatingDistribution()`, never `[]`. */
  ratingDistribution: RatingBucket[];
  /** Best- and worst-rated genre, each null until a genre clears the server's sample floor.
   *  `worst` is also null when only one genre qualifies — one genre being both would read as a
   *  bug. Averages are on the 0–10 scale, one decimal. */
  genreRatings: {
    best: GenreRating | null;
    worst: GenreRating | null;
  };
  catalogueGaps: CatalogueGaps;
  translationRatio: {
    pct: number;
    translatedCount: number;
    knownCount: number;
  } | null;
  randomFirstLine: { title: string; firstLine: string } | null;
}
