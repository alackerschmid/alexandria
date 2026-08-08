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

/**
 * The `books` row for an ISBN, but only when this user actually holds a scan of it — the entry
 * check for the two per-user write routes keyed by ISBN rather than by scan id
 * (`PATCH /api/books/override`, `PATCH /api/books/custom-fields`).
 *
 * It used to be a plain `books` lookup, which let any authenticated user accumulate override and
 * custom-field rows against the whole shared catalogue: nothing bounded the write, and
 * `DELETE /api/scans/:id` only garbage-collects the rows belonging to a book the user scanned. The
 * write also answered `200 {}` — the merged scan row can't exist without a scan — so it read as a
 * save while storing something the user could never see or delete. Requiring the scan bounds the
 * rows to the library they can actually reach.
 */
export function getScannedBookByIsbn(
  db: D1Database,
  userId: number,
  isbn: string,
) {
  return db
    .prepare(
      `SELECT b.id FROM books b
       JOIN scans s ON s.book_id = b.id
       WHERE b.isbn = ? AND s.user_id = ?`,
    )
    .bind(isbn, userId)
    .first<{ id: number }>();
}

// Shared "does this user already own this book" check, used by both the scan-queue and
// Goodreads-import insert paths ahead of their respective duplicate-outcome responses.
export async function findExistingScan(
  db: D1Database,
  userId: number,
  bookId: number,
): Promise<boolean> {
  const dup = await db
    .prepare("SELECT 1 FROM scans WHERE user_id = ? AND book_id = ?")
    .bind(userId, bookId)
    .first();
  return !!dup;
}

export interface ExistingScan {
  id: number;
  status: string;
  rating: number | null;
  review: string | null;
  owning_status: string;
  /** The scan's work, via its book. NULL until the book is linked (see `linkWork`). */
  work_id: number | null;
}

// Like findExistingScan, but returns the scan's id and current status/rating/review/owning_status
// rather than a boolean — used by the Goodreads-import update-on-duplicate path, which needs to
// both capture the pre-update state (for its Undo, and to show the client the scan's real
// owning_status even though the update never touches it) and know which scan row to write to.
// rating/review come from the work, not the scan, so they arrive via the same join the library
// query uses; `work_id` rides along because every rating write needs it.
export async function getExistingScan(
  db: D1Database,
  userId: number,
  bookId: number,
): Promise<ExistingScan | null> {
  return db
    .prepare(
      `SELECT s.id, s.status, s.owning_status, b.work_id, wr.rating, wr.review
         FROM scans s
         JOIN books b ON b.id = s.book_id
    LEFT JOIN work_ratings wr ON wr.work_id = b.work_id AND wr.user_id = s.user_id
        WHERE s.user_id = ? AND s.book_id = ?`,
    )
    .bind(userId, bookId)
    .first<ExistingScan>();
}

// D1 surfaces a UNIQUE constraint violation as a generic Error with this substring in its
// message — there's no typed error class to check against.
export function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("UNIQUE constraint failed");
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
  "edition_name",
] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

// Every clause ends in `s.id` (the scan's unique, monotonic primary key) as a tiebreaker —
// without it, rows sharing the same sort value (e.g. scans saved in the same second) have no
// deterministic order, so sequential paginated requests (see index.vue's fetchBooks) could
// duplicate or drop a row across a page boundary.
export const SORT_CLAUSES: Record<string, string> = {
  date_desc: "s.created_at DESC, s.id DESC",
  date_asc: "s.created_at ASC, s.id ASC",
  // COLLATE binds to the expression and must precede the direction: SQLite's ordering-term is
  // `expr [COLLATE name] [ASC|DESC]`, so `… ASC COLLATE NOCASE` is a parse error, not a quirk.
  title_asc: "COALESCE(b.title, b.isbn) COLLATE NOCASE ASC, s.id ASC",
  title_desc: "COALESCE(b.title, b.isbn) COLLATE NOCASE DESC, s.id ASC",
  author_asc: "COALESCE(b.author, '') COLLATE NOCASE ASC, s.id ASC",
  author_desc: "COALESCE(b.author, '') COLLATE NOCASE DESC, s.id ASC",
  series_asc:
    "series_name IS NULL, series_name COLLATE NOCASE ASC, ws.ordinal ASC, s.id ASC",
  // NULLS LAST in *both* directions, deliberately: an unrated book isn't a bad book, so it
  // belongs at the end of "worst first" just as much as at the end of "best first". SQLite
  // sorts NULL first in ASC, hence the explicit `IS NULL` leading term rather than relying on
  // the default. `wr` is already in buildScanSelect's JOIN.
  rating_desc: "wr.rating IS NULL, wr.rating DESC, s.id DESC",
  rating_asc: "wr.rating IS NULL, wr.rating ASC, s.id ASC",
};

// The only supported way to turn a `?sort=` query param into an ORDER BY clause. The clause is
// interpolated into the SQL, so the lookup must not reach the prototype chain: plain indexing
// resolves `?sort=constructor` to an inherited function, which is truthy (so a `??` fallback never
// fires) and stringifies into the query as a syntax error → unhandled 500.
export function sortClauseFor(sort: string | undefined): string {
  // hasOwnProperty.call, not Object.hasOwn: the worker's tsconfig lib is es2021.
  return sort && Object.prototype.hasOwnProperty.call(SORT_CLAUSES, sort)
    ? SORT_CLAUSES[sort]
    : SORT_CLAUSES.date_desc;
}

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
  SELECT s.id, s.status, s.owning_status, wr.rating, wr.review,
         wr.updated_at                                       AS review_updated_at,
         s.created_at,
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
         COALESCE(o.description, b.description,
           (SELECT b2.description FROM books b2
            WHERE b2.work_id = b.work_id AND b2.id != b.id AND b2.description IS NOT NULL
            ORDER BY b2.id LIMIT 1))                          AS description,
         COALESCE(o.publisher, b.publisher)                  AS publisher,
         b.physical_format                                   AS physical_format,
         COALESCE(o.edition_name, b.edition_name)            AS edition_name,
         b.physical_dimensions                               AS physical_dimensions,
         ws.series_id                                        AS series_id,
         COALESCE(sn.name, sr.canonical_name)                AS series_name,
         ws.ordinal                                          AS series_ordinal,
         (SELECT COUNT(*) FROM work_series x WHERE x.series_id = ws.series_id) AS series_total,
         CASE
           -- No work link and no title: normally resolveEdition links a book synchronously right
           -- after inserting it (even a title-less row still gets a work via linkWork's
           -- isbn:<isbn> fallback key), so this is defensive rather than a steady-state case — it
           -- only catches a linkWork insert-then-select race, or a legacy row from before that
           -- guarantee existed, in the brief window before the sweeper's next unlinked-books pass
           -- reaches it. Reporting 'pending' would look like an active lookup that isn't happening.
           WHEN b.work_id IS NULL AND b.title IS NULL          THEN 'failed'
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
         (o.publisher IS NOT NULL)                           AS publisher_overridden,
         (o.edition_name IS NOT NULL)                        AS edition_name_overridden
  FROM scans s
  JOIN books b ON s.book_id = b.id
  LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
  LEFT JOIN works wk ON wk.id = b.work_id
  -- rating/review are per-user × per-WORK, not per-scan: every owned edition of a work reports
  -- the same values, so the collapsed work-card and the edition carousel can't disagree.
  -- An unlinked book (b.work_id IS NULL) yields NULLs, which is the honest answer.
  LEFT JOIN work_ratings wr ON wr.work_id = b.work_id AND wr.user_id = s.user_id
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

// Trims, drops empties, and dedupes a list of strings. Shared by any code cleaning a user- or
// upstream-supplied string array before storing it (custom field options, Google Books BISAC
// categories, etc.) — factor callers' own splitting/pre-processing out before calling this.
export function dedupeTrimmed(items: string[]): string[] {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

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

// "unknown" is the deliberate no-assertion state: nothing is claimed about whether the user owns
// the copy. It's what a Goodreads import writes (a shelf says nothing about ownership) and it is
// excluded from every "owned" gate — series completeness (routes/catalog.ts) keys on
// `IN ('owned', 'lent_out')` unconditionally, and `/api/stats` does too unless the caller asks
// for `?scope=all`, which exists precisely because an import-only library is entirely "unknown"
// and would otherwise measure as empty (see SCOPE_CLAUSES in routes/stats.ts).
export const VALID_OWNING_STATUSES = [
  "owned",
  "unowned",
  "want",
  "lent_out",
  "unknown",
] as const;

/** The "owned" gate as a value, for the checks that run in JS rather than in SQL. */
export const OWNED_OWNING_STATUSES: readonly string[] = ["owned", "lent_out"];

export function isValidRating(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 10;
}

// There is deliberately no user-facing length limit on a review — this cap exists purely so a
// single scan row can't be pushed past what D1 will physically store (2 MB per row), which would
// surface as an opaque 500 instead of a validation error. 100k characters is ~50 printed pages.
export const REVIEW_MAX_LENGTH = 100_000;

export function isValidReview(v: unknown): v is string | null {
  return v === null || (typeof v === "string" && v.length <= REVIEW_MAX_LENGTH);
}

// Collapses a blank review to NULL so "no review" has exactly one representation in the column
// (the frontend sends "" when the user clears the textarea, not null).
export function normalizeReview(v: string | null): string | null {
  return v == null ? null : v.trim() || null;
}

// Builds the SET clause + bind values for a scan status/owning UPDATE, so every write path —
// PATCH /api/scans/:id and both Goodreads-import update paths — emits the same SQL. A column is
// included only when its value is provided. Callers append their own WHERE binds after `binds`.
//
// rating/review are NOT here: they live on `work_ratings`, keyed by work rather than by scan, and
// are written through `upsertWorkRating`. That means **`sets` can legitimately come back empty**
// (a rating-only PATCH touches no scan column) — a caller that interpolates it unconditionally
// emits `UPDATE scans SET  WHERE …`, which is a syntax error. Skip the UPDATE when it's empty.
export function buildScanUpdate(args: {
  status?: string;
  owningStatus?: string;
}): {
  sets: string[];
  binds: (string | number | null)[];
} {
  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (args.status !== undefined) {
    sets.push("status = ?");
    binds.push(args.status);
  }
  if (args.owningStatus !== undefined) {
    sets.push("owning_status = ?");
    binds.push(args.owningStatus);
  }
  return { sets, binds };
}

export interface WorkRatingInput {
  /** Omit to leave the column alone; `null` clears it. */
  rating?: number | null;
  /** Omit to leave the column alone; `null` or blank clears it. */
  review?: string | null;
}

/**
 * Statements that write a user's rating/review for a work, for `db.batch`.
 *
 * `mode` decides what happens when a row already exists:
 * - `"overwrite"` — an ordinary user edit. The supplied fields win.
 * - `"seed"` — a value replayed from elsewhere in time (the scanner's offline queue draining, a
 *   guest scan syncing on register, a Goodreads row creating a scan). It fills only what is still
 *   empty, so a queue that drains hours later can't stomp a rating the user has since changed.
 *
 * `updated_at` is set explicitly on every write: the column DEFAULT only fires on INSERT, and
 * mergeWorks resolves genuine conflicts by comparing it.
 *
 * A write that leaves both columns NULL deletes the row rather than keeping a tombstone.
 */
export function upsertWorkRating(
  db: D1Database,
  userId: number,
  workId: number,
  input: WorkRatingInput,
  mode: "seed" | "overwrite",
): D1PreparedStatement[] {
  const hasRating = input.rating !== undefined;
  const hasReview = input.review !== undefined;
  if (!hasRating && !hasReview) return [];

  const rating = hasRating ? (input.rating ?? null) : null;
  const review = hasReview ? normalizeReview(input.review ?? null) : null;

  // An omitted field must not overwrite a stored one, so it falls back to the existing value in
  // both modes; a supplied field wins outright in "overwrite" and only fills a gap in "seed".
  // Kept as bare value expressions (not `col = …`) so `updated_at` can compare the same
  // expression against the stored value — see below.
  const valueExpr = (col: string, supplied: boolean) => {
    if (!supplied) return `work_ratings.${col}`;
    return mode === "seed"
      ? `COALESCE(work_ratings.${col}, excluded.${col})`
      : `excluded.${col}`;
  };
  const ratingExpr = valueExpr("rating", hasRating);
  const reviewExpr = valueExpr("review", hasReview);

  return [
    db
      .prepare(
        // `updated_at` moves only when a column's value actually changes. It used to be stamped
        // unconditionally, which in "seed" mode is precisely the case that changes nothing — seed's
        // whole contract is that it leaves a populated row alone. A guest scan syncing months later
        // therefore re-dated a January review as written in August (the client presents this column
        // as the review's written date), and handed the untouched side an artificially fresh
        // timestamp that would win a genuine conflict in mergeWorks' field-by-field merge.
        // SQLite evaluates every SET expression against the pre-update row, and `IS NOT` is
        // NULL-safe, so comparing the assignment expressions is exact.
        `INSERT INTO work_ratings (user_id, work_id, rating, review)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, work_id) DO UPDATE SET
           rating = ${ratingExpr},
           review = ${reviewExpr},
           updated_at = CASE
             WHEN ${ratingExpr} IS NOT work_ratings.rating
               OR ${reviewExpr} IS NOT work_ratings.review
             THEN CURRENT_TIMESTAMP
             ELSE work_ratings.updated_at
           END`,
      )
      .bind(userId, workId, rating, review),
    db
      .prepare(
        "DELETE FROM work_ratings WHERE user_id = ? AND work_id = ? AND rating IS NULL AND review IS NULL",
      )
      .bind(userId, workId),
  ];
}
