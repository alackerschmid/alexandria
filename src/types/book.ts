export type ReadStatus = "unread" | "reading" | "read" | "dnf";
export type OwningStatus = "owned" | "unowned" | "want" | "lent_out";

export interface AuthorRef {
  name: string;
  wikidata_qid: string | null;
}

export interface Book {
  id: number;
  isbn: string;
  title: string | null;
  author: string | null;
  authors?: AuthorRef[];
  cover_url: string | null;
  status: ReadStatus;
  owning_status: OwningStatus;
  rating: number | null;
  created_at: string;
  language?: string | null;
  publish_date?: string | null;
  number_of_pages_median?: number | null;
  reference_page_count?: number | null;
  description?: string | null;
  publisher?: string | null;
  work_id?: number | null;
  work_canonical_title?: string | null;
  /** Client-only: set by useEditionGrouping to this work's owned-edition count (1 if only one).
   *  Undefined when grouping hasn't run over this book at all. */
  editionCount?: number;
  /** Client-only: the full set of owned editions this card represents, representative first. */
  editions?: Book[];
  series_id?: number | null;
  series_name?: string | null;
  series_ordinal?: number | null;
  series_total?: number | null;
  enrichment_status?: "pending" | "done" | "failed";
  genres?: string[];
  original_pub_date?: string | null;
  awards?: string[];
  nominations?: string[];
  main_subject?: string | null;
  form_of_work?: string | null;
  language_of_work?: string | null;
  first_line?: string | null;
  epigraph?: string | null;
  narrative_locations?: string[];
  countries_of_origin?: string[];
  subtitle?: string | null;
  translator?: string[];
  illustrator?: string[];
  characters?: string[];
  physical_format?: string | null;
  edition_name?: string | null;
  physical_dimensions?: string | null;
  custom_field_values?: Array<{
    field_def_id: number;
    value: string | null;
  }> | null;
}
