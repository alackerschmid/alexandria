export interface DimensionItem {
  label: string
  count: number
}

export interface CollectionStats {
  total: number
  byStatus: { read: number; reading: number; unread: number; dnf: number }
  genres: DimensionItem[]
  uncategorizedGenreCount: number
  languages: { code: string; count: number }[]
  languageCount: number
  topAuthors: DimensionItem[]
  authorCount: number
  publishers: DimensionItem[]
  forms: DimensionItem[]
  subjects: DimensionItem[]
  countries: DimensionItem[]
  decades: DimensionItem[]
  topSeries: DimensionItem[]
  customFields: { fieldDefId: number; fieldName: string; values: DimensionItem[] }[]
  avgPages: number | null
  totalPagesRead: number | null
  medianYear: number | null
  yearKnownCount: number
  genreCount: number
}
