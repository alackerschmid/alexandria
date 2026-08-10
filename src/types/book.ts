export type ReadStatus = "unread" | "reading" | "read" | "dnf";
// "unknown" is the no-assertion state (nothing claimed about ownership) — what a Goodreads
// import writes, since a shelf says nothing about whether the user owns the copy. It is not
// "owned" anywhere it matters: series completeness and the ownership stats both count only
// `owned`/`lent_out`.
export type OwningStatus =
  | "owned"
  | "unowned"
  | "want"
  | "lent_out"
  | "unknown";

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
  /** R2 key of the cover stored on our own origin, when there is one. Prefer it over `cover_url`
   *  via `coverSrc` — reading `cover_url` directly asks Google for the image from the reader's
   *  browser, which is what serving them ourselves exists to stop. Absent on a response from a
   *  worker older than migration 0045, and deliberately absent when the user has overridden the
   *  cover (the server suppresses it, so the override cannot be shadowed). */
  cover_object_key?: string | null;
  status: ReadStatus;
  owning_status: OwningStatus;
  /** 0-10, or null when unrated. Stored per user × per **work** (`work_ratings`), not per scan:
   *  every owned edition of the same work reports the same value, and it is independent of the
   *  reading status — nothing clears it implicitly. */
  rating: number | null;
  /** Free-text markdown review / notes. Same per-work scope and status-independence as
   *  `rating`; notes on an unread or abandoned book are legitimate. Required, not optional —
   *  it rides the same `work_ratings` LEFT JOIN as `rating` and is always present on an API
   *  row, so making it optional would only push a `?? null` onto every reader. */
  review: string | null;
  /** When the `work_ratings` row was last written (rating *or* review). Same per-work scope as
   *  the two fields above, so it dates whichever was touched last — the review pane presents it
   *  as the review's "written" date, which is what it is in practice for a book with a review. */
  review_updated_at?: string | null;
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
  custom_field_values?: CustomFieldValue[] | null;
}

export interface CustomFieldValue {
  field_def_id: number;
  value: string | null;
}

/** One row of `GET /api/works/:workId/editions` — another edition of the same work. `scan_id` is
 *  non-null for the editions the user owns; `materialized` marks the ones that already have a full
 *  `books` row rather than only a discovered ISBN. */
export interface WorkEdition {
  isbn: string;
  title: string | null;
  language: string | null;
  cover_url: string | null;
  publish_date: string | null;
  publisher: string | null;
  scan_id: number | null;
  materialized: boolean;
}

/** A `Book` as the detail view sees it: the same row plus the per-field "this was manually
 *  overridden" flags `GET /api/scans` reports (0/1 integers, not booleans — D1 has no boolean).
 *  Lives here rather than in `BookDetail.vue` because the panes, the edit form and `series.vue`
 *  all need it, and importing a type from a component is a cycle waiting to happen. */
export interface BookWithOverrides extends Book {
  title_overridden?: number;
  cover_url_overridden?: number;
  language_overridden?: number;
  publish_date_overridden?: number;
  pages_overridden?: number;
  description_overridden?: number;
  publisher_overridden?: number;
  edition_name_overridden?: number;
}
