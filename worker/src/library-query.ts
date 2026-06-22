// Shared query infrastructure for scans and books routes.

export function getBookByIsbn(db: D1Database, isbn: string) {
  return db.prepare('SELECT id FROM books WHERE isbn = ?').bind(isbn).first<{ id: number }>()
}

// author is intentionally excluded — authors are managed via the works/authors model, not per-user overrides.
export const OVERRIDE_FIELDS = ['title', 'cover_url', 'language', 'publish_date', 'number_of_pages_median', 'description', 'publisher'] as const
export type OverrideField = typeof OVERRIDE_FIELDS[number]

export const SORT_CLAUSES: Record<string, string> = {
  date_desc: 's.created_at DESC',
  date_asc: 's.created_at ASC',
  title_asc: 'COALESCE(b.title, b.isbn) ASC COLLATE NOCASE',
  title_desc: 'COALESCE(b.title, b.isbn) DESC COLLATE NOCASE',
  author_asc: "COALESCE(b.author, '') ASC COLLATE NOCASE",
  author_desc: "COALESCE(b.author, '') DESC COLLATE NOCASE",
  series_asc: 'series_name IS NULL, series_name ASC COLLATE NOCASE, ws.ordinal ASC',
}

// book_id is included here solely for custom-field merging in JS; it is stripped before the response.
// The single `?` placeholder (series_names.language) must be bound FIRST, before any WHERE params.
// `ws` collapses a work's series to its lowest-ordinal one via SQLite's min()/bare-column rule,
// so a work in multiple series never multiplies scan rows (list view shows the primary series).
export const SCAN_SELECT = `
  SELECT s.id, s.status, s.created_at,
         b.id   AS book_id,
         b.isbn,
         b.work_id                                           AS work_id,
         COALESCE(o.title, b.title)                          AS title,
         b.author                                            AS author,
         COALESCE(o.cover_url, b.cover_url)                  AS cover_url,
         COALESCE(o.language, b.language)                    AS language,
         COALESCE(o.publish_date, b.publish_date)            AS publish_date,
         COALESCE(o.number_of_pages_median, b.number_of_pages_median) AS number_of_pages_median,
         COALESCE(o.description, b.description)              AS description,
         COALESCE(o.publisher, b.publisher)                  AS publisher,
         ws.series_id                                        AS series_id,
         COALESCE(sn.name, sr.canonical_name)                AS series_name,
         ws.ordinal                                          AS series_ordinal,
         (SELECT COUNT(*) FROM work_series x WHERE x.series_id = ws.series_id) AS series_total,
         CASE
           WHEN b.work_id IS NULL                         THEN 'pending'
           WHEN wk.enrichment_failed_at IS NOT NULL       THEN 'failed'
           WHEN wk.series_checked_at IS NOT NULL          THEN 'done'
           ELSE                                                'pending'
         END                                                 AS enrichment_status,
         wk.genres                                          AS genres,
         wk.original_pub_date                              AS original_pub_date,
         wk.awards                                         AS awards,
         wk.nominations                                    AS nominations,
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
  LEFT JOIN (
    SELECT work_id, series_id, MIN(ordinal) AS ordinal
    FROM work_series GROUP BY work_id
  ) ws ON ws.work_id = b.work_id
  LEFT JOIN series sr ON sr.id = ws.series_id
  LEFT JOIN series_names sn ON sn.series_id = sr.id AND sn.language = ?`

export async function fetchCustomFields(db: D1Database, userId: number, bookIds: number[]) {
  if (!bookIds.length) return { defs: [], valuesByBook: new Map<number, Map<number, string | null>>() }
  const placeholders = bookIds.map(() => '?').join(',')
  const [{ results: defs }, { results: rawValues }] = await Promise.all([
    db.prepare('SELECT id, field_name AS name, field_type AS type FROM user_field_definitions WHERE user_id = ? ORDER BY sort_order')
      .bind(userId)
      .all<{ id: number; name: string; type: string }>(),
    db.prepare(`SELECT book_id, field_def_id, field_value FROM book_custom_fields WHERE user_id = ? AND book_id IN (${placeholders})`)
      .bind(userId, ...bookIds)
      .all<{ book_id: number; field_def_id: number; field_value: string | null }>(),
  ])
  const valuesByBook = new Map<number, Map<number, string | null>>()
  for (const v of rawValues) {
    if (!valuesByBook.has(v.book_id)) valuesByBook.set(v.book_id, new Map())
    valuesByBook.get(v.book_id)!.set(v.field_def_id, v.field_value)
  }
  return { defs, valuesByBook }
}

export function attachCustomFields(
  row: any,
  defs: { id: number; name: string; type: string }[],
  valuesByBook: Map<number, Map<number, string | null>>,
) {
  const { book_id, ...rest } = row
  const bookVals = valuesByBook.get(book_id)
  return {
    ...rest,
    genres:      rest.genres      ? JSON.parse(rest.genres)      : null,
    awards:      rest.awards      ? JSON.parse(rest.awards)      : null,
    nominations: rest.nominations ? JSON.parse(rest.nominations) : null,
    custom_field_values: defs.map(d => ({ field_def_id: d.id, value: bookVals?.get(d.id) ?? null })),
  }
}

export const VALID_STATUSES = ['unread', 'reading', 'read'] as const
