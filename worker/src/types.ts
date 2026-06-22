export type Bindings = {
  DB: D1Database
  JWT_SECRET: string
  CORS_ORIGIN?: string
  GOOGLE_BOOKS_API_KEY: string
}

export type Variables = {
  userId: number
}

export type Env = { Bindings: Bindings; Variables: Variables }

export type BookRow = {
  id: number
  isbn: string
  title: string | null
  author: string | null
  cover_url: string | null
  language: string | null
  publish_date: string | null
  number_of_pages_median: number | null
  description: string | null
  publisher: string | null
  fetched_at: string
  work_id: number | null
}

export type WorkRow = {
  id: number
  match_key: string | null
  wikidata_qid: string | null
  canonical_title: string | null
  original_language: string | null
  series_checked_at: string | null
  enrichment_failed_at: string | null
  genres: string | null
  original_pub_date: string | null
  awards: string | null
  nominations: string | null
}

export type BookMetadata = {
  title: string | null
  author: string | null
  cover_url: string | null
  language: string | null
  publish_date: string | null
  number_of_pages_median: number | null
  description: string | null
  publisher: string | null
}

export type WorkDetails = {
  genres: string[]
  originalPubDate: string | null
  awards: string[]
  nominations: string[]
}

export type SeriesHit = { seriesQid: string; ordinal: number | null; nameEn: string | null; nameDe: string | null }
