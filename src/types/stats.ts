export interface CollectionStats {
  total: number
  byStatus: { read: number; reading: number; unread: number }
  genres: { label: string; count: number }[]
  uncategorizedGenreCount: number
  languages: { code: string; count: number }[]
  languageCount: number
  topAuthors: { name: string; count: number }[]
  avgPages: number | null
  medianYear: number | null
  richestCentury: number | null
  yearKnownCount: number
}
