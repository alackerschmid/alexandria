// Shared query infrastructure for scans and books routes.
import type { AuthorRef } from "./types";

// Guards against garbage query params (NaN, negative offsets) reaching a D1 bind and 500ing.
export function parseIntOr(
  value: string | undefined,
  fallback: number,
): number {
  const n = parseInt(value ?? "", 10);
  return Number.isNaN(n) ? fallback : n;
}

export function getBookByIsbn(db: D1Database, isbn: string) {
  return db
    .prepare("SELECT id FROM books WHERE isbn = ?")
    .bind(isbn)
    .first<{ id: number }>();
}

// author is intentionally excluded — authors are managed via the works/authors model, not per-user overrides.
export const OVERRIDE_FIELDS = [
  "title",
  "cover_url",
  "language",
  "publish_date",
  "number_of_pages_median",
  "description",
  "publisher",
] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

// Every clause ends in `s.id` (the scan's unique, monotonic primary key) as a tiebreaker —
// without it, rows sharing the same sort value (e.g. scans saved in the same second) have no
// deterministic order, so sequential paginated requests (see index.vue's fetchBooks) could
// duplicate or drop a row across a page boundary.
export const SORT_CLAUSES: Record<string, string> = {
  date_desc: "s.created_at DESC, s.id DESC",
  date_asc: "s.created_at ASC, s.id ASC",
  title_asc: "COALESCE(b.title, b.isbn) ASC COLLATE NOCASE, s.id ASC",
  title_desc: "COALESCE(b.title, b.isbn) DESC COLLATE NOCASE, s.id ASC",
  author_asc: "COALESCE(b.author, '') ASC COLLATE NOCASE, s.id ASC",
  author_desc: "COALESCE(b.author, '') DESC COLLATE NOCASE, s.id ASC",
  series_asc:
    "series_name IS NULL, series_name ASC COLLATE NOCASE, ws.ordinal ASC, s.id ASC",
};

// book_id is included here solely for custom-field merging in JS; it is stripped before the response.
// `ws` is the work's primary (lowest-ordinal) series row, picked per book via a correlated
// rowid lookup. This keys the work_series read off b.work_id (using idx_work_series_work) so we
// only touch the handful of rows for books in this result set, instead of GROUP BY-scanning the
// whole table. A work in multiple series still yields one row (list view shows the primary series).
export const AUTHORS_JSON_SUBQUERY = `
         (SELECT json_group_array(json_object('name', a.name, 'wikidata_qid', a.wikidata_qid))
          FROM work_authors wa JOIN authors a ON a.id = wa.author_id
          WHERE wa.work_id = b.work_id
          ORDER BY wa.ordinal, wa.author_id)`;

export function buildScanSelect(locale: string): string {
  const safeLocale = /^[a-z]{2,3}$/.test(locale) ? locale : "en";
  return `
  SELECT s.id, s.status, s.owning_status, s.rating, s.created_at,
         b.id   AS book_id,
         b.isbn,
         b.work_id                                           AS work_id,
         wk.canonical_title                                  AS work_canonical_title,
         COALESCE(o.title, b.title)                          AS title,
         b.author                                            AS author,
         ${AUTHORS_JSON_SUBQUERY}                            AS authors_json,
         COALESCE(o.cover_url, b.cover_url)                  AS cover_url,
         COALESCE(o.language, b.language)                    AS language,
         COALESCE(o.publish_date, b.publish_date)            AS publish_date,
         COALESCE(o.number_of_pages_median, b.number_of_pages_median) AS number_of_pages_median,
         COALESCE(o.description, b.description)              AS description,
         COALESCE(o.publisher, b.publisher)                  AS publisher,
         b.physical_format                                   AS physical_format,
         b.edition_name                                      AS edition_name,
         b.physical_dimensions                               AS physical_dimensions,
         ws.series_id                                        AS series_id,
         COALESCE(sn.name, sr.canonical_name)                AS series_name,
         ws.ordinal                                          AS series_ordinal,
         (SELECT COUNT(*) FROM work_series x WHERE x.series_id = ws.series_id) AS series_total,
         CASE
           WHEN b.work_id IS NULL                              THEN 'pending'
           WHEN wk.enrichment_status IN ('failed','exhausted') THEN 'failed'
           WHEN wk.enrichment_status = 'done'                  THEN 'done'
           ELSE                                                     'pending'
         END                                                 AS enrichment_status,
         wk.genres                                          AS genres,
         wk.original_pub_date                              AS original_pub_date,
         wk.awards                                         AS awards,
         wk.nominations                                    AS nominations,
         wk.main_subject                                   AS main_subject,
         wk.form_of_work                                   AS form_of_work,
         wk.language_of_work                               AS language_of_work,
         wk.first_line                                     AS first_line,
         wk.epigraph                                       AS epigraph,
         wk.narrative_locations                            AS narrative_locations,
         wk.countries_of_origin                            AS countries_of_origin,
         wk.subtitle                                       AS subtitle,
         wk.translator                                     AS translator,
         wk.illustrator                                    AS illustrator,
         wk.characters                                     AS characters,
         wk.reference_page_count                           AS reference_page_count,
         (o.title IS NOT NULL)                               AS title_overridden,
         (o.cover_url IS NOT NULL)                           AS cover_url_overridden,
         (o.language IS NOT NULL)                            AS language_overridden,
         (o.publish_date IS NOT NULL)                        AS publish_date_overridden,
         (o.number_of_pages_median IS NOT NULL)              AS pages_overridden,
         (o.description IS NOT NULL)                         AS description_overridden,
         (o.publisher IS NOT NULL)                           AS publisher_overridden
  FROM scans s
  JOIN books b ON s.book_id = b.id
  LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
  LEFT JOIN works wk ON wk.id = b.work_id
  LEFT JOIN work_series ws ON ws.rowid = (
    SELECT w2.rowid FROM work_series w2
    WHERE w2.work_id = b.work_id
    ORDER BY w2.ordinal IS NULL, w2.ordinal, w2.series_id
    LIMIT 1
  )
  LEFT JOIN series sr ON sr.id = ws.series_id
  LEFT JOIN series_names sn ON sn.series_id = sr.id AND sn.language = '${safeLocale}'`;
}

export async function fetchCustomFields(
  db: D1Database,
  userId: number,
  bookIds: number[],
) {
  if (!bookIds.length)
    return {
      defs: [],
      valuesByBook: new Map<number, Map<number, string | null>>(),
    };

  const { results: defs } = await db
    .prepare(
      "SELECT id, field_name AS name, field_type AS type FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order",
    )
    .bind(userId)
    .all<{ id: number; name: string; type: string }>();

  const valuesByBook = new Map<number, Map<number, string | null>>();

  // Batch in chunks of 50 to stay under 100 parameters (1 userId + 50 bookIds = 51)
  const chunkSize = 50;
  for (let i = 0; i < bookIds.length; i += chunkSize) {
    const chunk = bookIds.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const { results: rawValues } = await db
      .prepare(
        `SELECT book_id, field_def_id, field_value FROM book_custom_fields WHERE user_id = ? AND book_id IN (${placeholders})`,
      )
      .bind(userId, ...chunk)
      .all<{
        book_id: number;
        field_def_id: number;
        field_value: string | null;
      }>();

    for (const v of rawValues) {
      if (!valuesByBook.has(v.book_id)) valuesByBook.set(v.book_id, new Map());
      valuesByBook.get(v.book_id)!.set(v.field_def_id, v.field_value);
    }
  }

  return { defs, valuesByBook };
}

export const titleCase = (s: string) =>
  s.replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());

export function parseTagArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((v): v is string => typeof v === "string" && v !== "")
      : [];
  } catch {
    return [];
  }
}

// authors_json is a json_group_array(json_object(...)) from buildScanSelect's correlated
// subquery; [] (unlinked work, or work_id NULL) is the common case until enrichment links authors.
export function parseAuthorsJson(raw: string | null): AuthorRef[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (v): v is AuthorRef =>
        v &&
        typeof v === "object" &&
        typeof v.name === "string" &&
        v.name !== "",
    );
  } catch {
    return [];
  }
}

export function attachCustomFields(
  row: any,
  defs: { id: number; name: string; type: string }[],
  valuesByBook: Map<number, Map<number, string | null>>,
) {
  const { book_id, authors_json, ...rest } = row;
  const bookVals = valuesByBook.get(book_id);
  return {
    ...rest,
    authors: parseAuthorsJson(authors_json),
    genres: parseTagArray(rest.genres).map((g) => titleCase(g)),
    awards: parseTagArray(rest.awards),
    nominations: parseTagArray(rest.nominations),
    narrative_locations: parseTagArray(rest.narrative_locations),
    countries_of_origin: parseTagArray(rest.countries_of_origin),
    translator: parseTagArray(rest.translator),
    illustrator: parseTagArray(rest.illustrator),
    characters: parseTagArray(rest.characters),
    custom_field_values: defs.map((d) => ({
      field_def_id: d.id,
      value: bookVals?.get(d.id) ?? null,
    })),
  };
}

export const VALID_STATUSES = ["unread", "reading", "read", "dnf"] as const;

export const VALID_OWNING_STATUSES = [
  "owned",
  "unowned",
  "want",
  "lent_out",
] as const;

export function isValidRating(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10;
}
