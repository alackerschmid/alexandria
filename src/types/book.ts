export type ReadStatus = 'unread' | 'reading' | 'read' | 'dnf'

export interface Book {
  id: number
  isbn: string
  title: string | null
  author: string | null
  cover_url: string | null
  status: ReadStatus
  created_at: string
  language?: string | null
  publish_date?: string | null
  number_of_pages_median?: number | null
  description?: string | null
  publisher?: string | null
  work_id?: number | null
  series_id?: number | null
  series_name?: string | null
  series_ordinal?: number | null
  series_total?: number | null
  enrichment_status?: 'pending' | 'done' | 'failed'
  genres?: string[] | null
  original_pub_date?: string | null
  awards?: string[] | null
  nominations?: string[] | null
  main_subject?: string | null
  form_of_work?: string | null
  language_of_work?: string | null
  first_line?: string | null
  epigraph?: string | null
  narrative_locations?: string[] | null
  countries_of_origin?: string[] | null
  physical_format?: string | null
  edition_name?: string | null
  physical_dimensions?: string | null
  custom_field_values?: Array<{ field_def_id: number; value: string | null }> | null
}
