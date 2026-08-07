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
  totalPagesRead: number | null;
  medianYear: number | null;
  yearKnownCount: number;
  genreCount: number;
  /** Mean of every rated **work** the user owns, one decimal, on the 0–10 scale. */
  avgRating: number | null;
  ratedCount: number;
  /** Always 11 entries, `rating` 0–10 ascending, zero-count buckets included — so a consumer may
   *  index it directly. Build any fallback with `emptyRatingDistribution()`, never `[]`. */
  ratingDistribution: RatingBucket[];
  translationRatio: {
    pct: number;
    translatedCount: number;
    knownCount: number;
  } | null;
  randomFirstLine: { title: string; firstLine: string } | null;
}
