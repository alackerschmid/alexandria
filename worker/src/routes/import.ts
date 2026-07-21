import { Hono } from "hono";
import type { Env, BookRow } from "../types";
import { authMiddleware } from "../auth";
import { resolveEdition, linkWork, type FallbackMetadata } from "../editions";
import { rateLimitOrReject } from "../rate-limit";
import { mapWithConcurrency } from "../concurrency";
import { validateImportRow, type ImportRowInput } from "../import-validation";
import {
  getExistingScan,
  isUniqueConstraintError,
  resolveRatingForUpdate,
} from "../library-query";

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
  // Present only for "updated" rows — the scan's status/rating before this update, so the
  // client can offer an Undo that restores exactly this.
  previous?: { status: string; rating: number | null };
}

function bookSummary(book: BookRow): ImportedBook {
  return {
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
      let matchedScan: { id: number; status: string; rating: number | null } | null = null;
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
          previous: { status: matchedScan.status, rating: matchedScan.rating },
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
  const body = await c.req.json<{ rows?: ImportRowInput[]; update?: boolean }>();
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
  // Concurrent, but order-preserving — the client maps results back onto its rows positionally.
  // Rows sharing a work or author race inside linkWork; every write there is INSERT OR IGNORE and
  // the scan insert is guarded by a UNIQUE constraint (caught as "duplicate"), so the races are benign.
  const results = await mapWithConcurrency(rows, ROW_CONCURRENCY, (row) =>
    importRow(db, userId, apiKey, row, update),
  );

  return c.json({ results });
});

export default importRoutes;
