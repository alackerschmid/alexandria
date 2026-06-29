export interface DimensionItem {
  label: string
  count: number
}

export interface CollectionStats {
  total: number
  byStatus: { read: number; reading: number; unread: number }
  genres: DimensionItem[]
  uncategorizedGenreCount: number
  languages: { code: string; count: number }[]
  languageCount: number
  topAuthors: DimensionItem[]
  publishers: DimensionItem[]
  forms: DimensionItem[]
  subjects: DimensionItem[]
  countries: DimensionItem[]
  decades: DimensionItem[]
  topSeries: DimensionItem[]
  customFields: { fieldDefId: number; fieldName: string; values: DimensionItem[] }[]
  avgPages: number | null
  medianYear: number | null
  richestCentury: number | null
  yearKnownCount: number
}
