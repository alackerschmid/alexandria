export type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ORIGIN?: string;
  GOOGLE_BOOKS_API_KEY: string;
};

export type Variables = {
  userId: number;
};

export type Env = { Bindings: Bindings; Variables: Variables };

export type BookRow = {
  id: number;
  isbn: string;
  title: string | null;
  author: string | null;
  cover_url: string | null;
  language: string | null;
  publish_date: string | null;
  number_of_pages_median: number | null;
  description: string | null;
  publisher: string | null;
  physical_format: string | null;
  edition_name: string | null;
  physical_dimensions: string | null;
  categories: string | null;
  fetched_at: string;
  work_id: number | null;
};

export type WorkRow = {
  id: number;
  match_key: string | null;
  wikidata_qid: string | null;
  canonical_title: string | null;
  original_language: string | null;
  enrichment_status: "pending" | "done" | "failed" | "exhausted";
  next_retry_at: string | null;
  series_checked_at: string | null;
  enrichment_failed_at: string | null;
  enrichment_failure_reason: string | null;
  enrichment_attempts: number;
  enrichment_schema_version: number;
  genres: string | null;
  original_pub_date: string | null;
  awards: string | null;
  nominations: string | null;
  main_subject: string | null;
  form_of_work: string | null;
  language_of_work: string | null;
  language_of_work_code: string | null;
  first_line: string | null;
  epigraph: string | null;
  narrative_locations: string | null;
  countries_of_origin: string | null;
  subtitle: string | null;
  translator: string | null;
  illustrator: string | null;
  characters: string | null;
  openlibrary_work_id: string | null;
  reference_page_count: number | null;
};

export type BookMetadata = {
  title: string | null;
  author: string | null;
  cover_url: string | null;
  language: string | null;
  publish_date: string | null;
  number_of_pages_median: number | null;
  description: string | null;
  publisher: string | null;
  physical_format: string | null;
  edition_name: string | null;
  physical_dimensions: string | null;
  categories: string | null;
};

export type WorkDetails = {
  genres: string[];
  originalPubDate: string | null;
  awards: string[];
  nominations: string[];
  mainSubject: string | null;
  formOfWork: string | null;
  languageOfWork: string | null;
  languageOfWorkCode: string | null;
  firstLine: string | null;
  epigraph: string | null;
  narrativeLocations: string[];
  countriesOfOrigin: string[];
  subtitle: string | null;
  translator: string[];
  illustrator: string[];
  characters: string[];
  openlibraryWorkId: string | null;
  referencePageCount: number | null;
};

export type SeriesHit = {
  seriesQid: string;
  ordinal: number | null;
  nameEn: string | null;
  nameDe: string | null;
};

export type AuthorRef = { name: string; wikidata_qid: string | null };
