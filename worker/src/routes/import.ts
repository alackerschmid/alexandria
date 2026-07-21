import { Hono } from "hono";
import type { Env, BookRow } from "../types";
import { authMiddleware } from "../auth";
import { resolveEdition, linkWork, type FallbackMetadata } from "../editions";
import { rateLimitOrReject } from "../rate-limit";
import { mapWithConcurrency } from "../concurrency";
import {
  validateImportRow,
  validateMatchRow,
  type ImportRowInput,
  type MatchRowInput,
} from "../import-validation";
import {
  getExistingScan,
  isUniqueConstraintError,
  resolveRatingForUpdate,
  type ExistingScan,
} from "../library-query";
import { pickBestMatch, type TitleMatchCandidate } from "../title-match";

const importRoutes = new Hono<Env>();

importRoutes.use("*", authMiddleware);

// Each new ISBN costs 3 external fetches (1 Google Books + 2 OpenLibrary) plus several D1
// statements via resolveEdition. At the cap that's 30 external subrequests — under the Workers
// free-plan limit of 50. (D1 calls bill against a separate 1000/invocation internal budget.)
const MAX_BATCH_SIZE = 10;
// Rows are resolved concurrently: a cached ISBN is a couple of D1 reads, but an uncached one is a
// ~1.1s network round-trip, and serializing those made a 10-row batch take ~11s. The cap keeps the
// burst against OpenLibrary polite — raising it past ~6 buys nothing anyway, since Workers allow
// only 6 simultaneous connections awaiting response headers.
const ROW_CONCURRENCY = 4;
// One increment per request (not per row) — a full library import is a handful of batches,
// this just guards against a runaway client loop.
const IMPORT_RATE_LIMIT = 30;

type ImportOutcome = "imported" | "updated" | "duplicate" | "invalid_isbn" | "failed";

interface ImportedBook {
  isbn: string;
  title: string | null;
  author: string | null;
  cover_url: string | null;
  publisher: string | null;
  language: string | null;
  work_id: number | null;
}

interface ImportRowResult {
  isbn: string;
  outcome: ImportOutcome;
  scan_id?: number;
  // Present only for "imported"/"updated" rows — the resolved edition's details, so the
  // post-import summary can render an editable card without a follow-up per-scan fetch.
  book?: ImportedBook;
  // Present only for "updated" rows — the scan's status/rating/owning_status before this
  // update, so the client can show the real (untouched) owning_status and offer an Undo that
  // restores exactly this.
  previous?: { status: string; rating: number | null; owning_status: string };
}

function bookSummary(book: BookRow): ImportedBook {
  return {
    isbn: book.isbn,
    title: book.title,
    author: book.author,
    cover_url: book.cover_url,
    publisher: book.publisher,
    language: book.language,
    work_id: book.work_id,
  };
}

async function importRow(
  db: D1Database,
  userId: number,
  apiKey: string,
  input: ImportRowInput,
  update: boolean,
  // Only applied to newly created scans (see below) — an "updated" row's book may already carry
  // tags the user chose deliberately, and the update path otherwise never writes fields the
  // Goodreads row didn't explicitly ask to change.
  shelvesFieldDefId: number | null,
): Promise<ImportRowResult> {
  const validated = validateImportRow(input);
  if (!validated.ok) {
    return { isbn: input.isbn, outcome: "invalid_isbn" };
  }
  const {
    isbn13,
    isbn10,
    status,
    owning_status,
    rating,
    rawRating,
    created_at,
    title,
    author,
    publisher,
    publish_date,
    number_of_pages,
    shelves,
  } = validated.row;

  // Everything below can throw (D1 hiccups, resolveEdition/linkWork failures) — this function
  // runs concurrently with sibling rows via mapWithConcurrency, which lets rejections propagate,
  // so an uncaught throw here would fail the whole batch and misreport already-imported sibling
  // rows as failed. Every exit is a normal ImportRowResult instead.
  try {
    // Dedupe against both ISBN forms — the library may already hold this book under whichever
    // form it was originally scanned/looked up with. A single edition can legitimately have
    // *two* `books` rows (one keyed by each ISBN form, e.g. one from an old scan, one from an
    // earlier import) — check every match for an existing scan, not just whichever row SQLite
    // happens to return first, or a scan sitting on the other row would be missed and duplicated.
    const { results: existingRows } = await db
      .prepare(
        `SELECT * FROM books WHERE isbn = ? ${isbn10 ? "OR isbn = ?" : ""}`,
      )
      .bind(...(isbn10 ? [isbn13, isbn10] : [isbn13]))
      .all<BookRow>();

    let book: BookRow | null;
    if (existingRows.length > 0) {
      // Only one of the candidate book rows (isbn13 form, isbn10 form) can actually carry a
      // scan — the unique constraint is per (user, book), and a user only ever has one of the
      // two rows scanned. Check each until found.
      let matchedScan: ExistingScan | null = null;
      let matchedBook: BookRow | null = null;
      for (const row of existingRows) {
        const scan = await getExistingScan(db, userId, row.id);
        if (scan) {
          matchedScan = scan;
          matchedBook = row;
          break;
        }
      }
      if (matchedScan && matchedBook) {
        if (!update) return { isbn: isbn13, outcome: "duplicate" };

        if (!matchedBook.work_id) await linkWork(db, matchedBook);
        const resolvedRating = resolveRatingForUpdate({
          hasStatus: true,
          effectiveStatus: status,
          hasRating: rawRating != null,
          rating: rawRating,
        });
        const sets = ["status = ?"];
        const binds: (string | number | null)[] = [status];
        if (resolvedRating !== undefined) {
          sets.push("rating = ?");
          binds.push(resolvedRating);
        }
        await db
          .prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`)
          .bind(...binds, matchedScan.id)
          .run();

        return {
          isbn: isbn13,
          outcome: "updated",
          scan_id: matchedScan.id,
          book: bookSummary(matchedBook),
          previous: {
            status: matchedScan.status,
            rating: matchedScan.rating,
            owning_status: matchedScan.owning_status,
          },
        };
      }
      // Neither candidate row has a scan yet — reuse the row already found instead of
      // re-resolving by isbn13 alone: resolveEdition's exact-match lookup would miss a book
      // stored under its isbn10 form and mint a duplicate `books` row for the same edition.
      const existing = existingRows[0];
      if (!existing.work_id) await linkWork(db, existing);
      book = existing;
    } else {
      // Seeds a placeholder row with the CSV's own title/author/publisher/etc. if neither
      // Google Books nor OpenLibrary has this ISBN, instead of inserting an all-NULL book.
      const fallbackMeta: FallbackMetadata = {
        title,
        author,
        publisher,
        publish_date,
        number_of_pages_median: number_of_pages,
      };
      book = await resolveEdition(db, isbn13, apiKey, true, false, fallbackMeta);
    }

    if (!book) {
      console.error("[POST /api/import/goodreads] resolveEdition failed, isbn:", isbn13);
      return { isbn: isbn13, outcome: "failed" };
    }

    const columns = ["user_id", "book_id", "status", "owning_status", "rating"];
    const binds: (string | number | null)[] = [
      userId,
      book.id,
      status,
      owning_status,
      rating,
    ];
    if (created_at) {
      columns.push("created_at");
      binds.push(created_at);
    }

    const result = await db
      .prepare(
        `INSERT INTO scans (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      )
      .bind(...binds)
      .run();

    if (shelvesFieldDefId != null && shelves.length > 0) {
      await db
        .prepare(
          `INSERT INTO book_custom_fields (user_id, book_id, field_def_id, field_value)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, book_id, field_def_id) DO UPDATE SET field_value = excluded.field_value`,
        )
        .bind(userId, book.id, shelvesFieldDefId, JSON.stringify(shelves))
        .run();
    }

    return {
      isbn: isbn13,
      outcome: "imported",
      scan_id: result.meta.last_row_id,
      book: bookSummary(book),
    };
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return { isbn: isbn13, outcome: "duplicate" };
    }
    console.error("[POST /api/import/goodreads] importRow failed, isbn:", isbn13, e);
    return { isbn: isbn13, outcome: "failed" };
  }
}

// No enrichWork/waitUntil here, deliberately — resolveEdition→linkWork leaves new works at
// enrichment_status='pending' and the cron sweeper drains the backlog (7 per 2-min tick). Firing
// one waitUntil per imported row here would spike Wikidata SPARQL traffic across the whole batch
// at once instead of the sweeper's paced trickle.
importRoutes.post("/goodreads", async (c) => {
  const body = await c.req.json<{
    rows?: ImportRowInput[];
    update?: boolean;
    // Request-level, not per-row — the client creates/reuses a single "Shelves" tag field once
    // per import session (see stores/import.ts) rather than per row.
    shelves_field_def_id?: number;
  }>();
  const rows = body.rows;
  const update = body.update === true;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_BATCH_SIZE) {
    return c.json(
      { error: `rows must contain between 1 and ${MAX_BATCH_SIZE} entries` },
      400,
    );
  }
  if (rows.some((r) => typeof r?.isbn !== "string" || !r.isbn)) {
    return c.json({ error: "each row requires an isbn" }, 400);
  }

  const userId = c.get("userId");
  const blocked = await rateLimitOrReject(
    c,
    `import:${userId}`,
    IMPORT_RATE_LIMIT,
    1,
    "Too many import requests — please slow down",
  );
  if (blocked) return blocked;

  const db = c.env.DB;
  const apiKey = c.env.GOOGLE_BOOKS_API_KEY;

  // Verify the field belongs to this user and is actually a tag field before trusting it for
  // every row — a client-supplied id is otherwise an IDOR into another user's field definitions.
  let shelvesFieldDefId: number | null = null;
  if (typeof body.shelves_field_def_id === "number") {
    const owned = await db
      .prepare(
        "SELECT 1 FROM user_field_definitions WHERE id = ? AND user_id = ? AND field_type = 'tag'",
      )
      .bind(body.shelves_field_def_id, userId)
      .first();
    if (owned) shelvesFieldDefId = body.shelves_field_def_id;
  }

  // Concurrent, but order-preserving — the client maps results back onto its rows positionally.
  // Rows sharing a work or author race inside linkWork; every write there is INSERT OR IGNORE and
  // the scan insert is guarded by a UNIQUE constraint (caught as "duplicate"), so the races are benign.
  const results = await mapWithConcurrency(rows, ROW_CONCURRENCY, (row) =>
    importRow(db, userId, apiKey, row, update, shelvesFieldDefId),
  );

  return c.json({ results });
});

// ── Title/author matching for rows with no usable ISBN ──────────────────────────────────────
//
// Separate from /goodreads on purpose: these rows cost zero external fetches (no Google
// Books/OpenLibrary call — matching is pure in-memory scoring against the user's own library),
// so they take a larger batch and share nothing else with importRow's per-ISBN resolution flow.

// No external fetches per row, so the batch cap here isn't about subrequest/connection budget —
// just keeping one request's in-memory work (and its D1 round trip for the library index)
// reasonably bounded.
const MAX_MATCH_BATCH_SIZE = 50;
// Above this, loading the full per-user scan index for in-memory scoring stops being cheap
// enough to justify — realistically unreachable for a personal library, but the bound should be
// explicit rather than let an outlier account degrade a request.
const MAX_LIBRARY_INDEX_SIZE = 20_000;

type MatchOutcome = "duplicate" | "updated" | "no_match";

interface MatchRowResult {
  outcome: MatchOutcome;
  scan_id?: number;
  // Present only for "updated" rows.
  book?: ImportedBook;
  previous?: { status: string; rating: number | null; owning_status: string };
  confidence?: number;
}

interface LibraryIndexRow {
  scan_id: number;
  status: string;
  rating: number | null;
  owning_status: string;
  book_id: number;
  work_id: number | null;
  isbn: string;
  title: string | null;
  author: string | null;
  canonical_title: string | null;
  cover_url: string | null;
  publisher: string | null;
  language: string | null;
}

importRoutes.post("/match", async (c) => {
  const body = await c.req.json<{ rows?: MatchRowInput[]; update?: boolean }>();
  const rows = body.rows;
  const update = body.update === true;
  if (
    !Array.isArray(rows) ||
    rows.length === 0 ||
    rows.length > MAX_MATCH_BATCH_SIZE
  ) {
    return c.json(
      { error: `rows must contain between 1 and ${MAX_MATCH_BATCH_SIZE} entries` },
      400,
    );
  }
  if (rows.some((r) => typeof r?.title !== "string" || !r.title)) {
    return c.json({ error: "each row requires a title" }, 400);
  }

  const userId = c.get("userId");
  // Shares the import route's bucket — the two passes of one import session must jointly stay
  // under the same per-minute budget, not each get their own.
  const blocked = await rateLimitOrReject(
    c,
    `import:${userId}`,
    IMPORT_RATE_LIMIT,
    1,
    "Too many import requests — please slow down",
  );
  if (blocked) return blocked;

  const db = c.env.DB;

  const countRow = await db
    .prepare("SELECT COUNT(*) AS count FROM scans WHERE user_id = ?")
    .bind(userId)
    .first<{ count: number }>();
  if ((countRow?.count ?? 0) > MAX_LIBRARY_INDEX_SIZE) {
    return c.json({
      results: rows.map((): MatchRowResult => ({ outcome: "no_match" })),
    });
  }

  const { results: library } = await db
    .prepare(
      `SELECT s.id AS scan_id, s.status, s.rating, s.owning_status,
              b.id AS book_id, b.work_id, b.isbn,
              COALESCE(o.title, b.title) AS title, b.author,
              wk.canonical_title AS canonical_title,
              b.cover_url, b.publisher, b.language
       FROM scans s
       JOIN books b ON b.id = s.book_id
       LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
       LEFT JOIN works wk ON wk.id = b.work_id
       WHERE s.user_id = ?`,
    )
    .bind(userId)
    .all<LibraryIndexRow>();

  const byScanId = new Map(library.map((row) => [row.scan_id, row]));
  const candidates: TitleMatchCandidate[] = library.map((row) => ({
    scanId: row.scan_id,
    bookId: row.book_id,
    title: row.title,
    canonicalTitle: row.canonical_title,
    author: row.author,
  }));

  const results: MatchRowResult[] = [];
  for (const row of rows) {
    const validated = validateMatchRow(row);
    if (!validated) {
      results.push({ outcome: "no_match" });
      continue;
    }

    const match = pickBestMatch(
      { title: validated.title, author: validated.author },
      candidates,
    );
    if (!match) {
      results.push({ outcome: "no_match" });
      continue;
    }

    const matched = byScanId.get(match.scanId);
    if (!matched) {
      results.push({ outcome: "no_match" });
      continue;
    }

    if (!update) {
      results.push({ outcome: "duplicate" });
      continue;
    }

    const resolvedRating = resolveRatingForUpdate({
      hasStatus: true,
      effectiveStatus: validated.status,
      hasRating: validated.rawRating != null,
      rating: validated.rawRating,
    });
    const sets = ["status = ?"];
    const binds: (string | number | null)[] = [validated.status];
    if (resolvedRating !== undefined) {
      sets.push("rating = ?");
      binds.push(resolvedRating);
    }
    await db
      .prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...binds, matched.scan_id)
      .run();

    results.push({
      outcome: "updated",
      scan_id: matched.scan_id,
      book: {
        isbn: matched.isbn,
        title: matched.title,
        author: matched.author,
        cover_url: matched.cover_url,
        publisher: matched.publisher,
        language: matched.language,
        work_id: matched.work_id,
      },
      previous: {
        status: matched.status,
        rating: matched.rating,
        owning_status: matched.owning_status,
      },
      confidence: match.score,
    });
  }

  return c.json({ results });
});

export default importRoutes;
