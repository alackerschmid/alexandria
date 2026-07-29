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
  buildScanUpdate,
  upsertWorkRating,
  type ExistingScan,
} from "../library-query";
import { pickBestMatchPrepared, prepareCandidates } from "../title-match";

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
// Denominated in rows/minute, not requests/minute — charged rows.length per call (see the
// rateLimitOrReject calls below), so a 10-row /goodreads batch and a single review-queue
// resolution both cost what they actually are instead of the same one request. ~600/min covers
// a real Goodreads export (500-3000 books) without a multi-minute stall, while still bounding a
// runaway client loop.
const IMPORT_RATE_LIMIT = 600;

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

interface ScanStateSummary {
  status: string;
  rating: number | null;
  owning_status: string;
}

// An edition of the same work the user already had a scan for. Only ever reported alongside a
// newly created scan — the dedupe below is per ISBN, so a Goodreads row carrying a different
// edition's ISBN than the copy the user scanned is a legitimate second scan, not a duplicate.
interface OtherEditionSummary {
  isbn: string;
  publisher: string | null;
  // Two printings from one publisher are common enough that the publisher alone doesn't identify
  // which copy the user already has — the year is what tells a reissue from the original.
  publish_date: string | null;
  owning_status: string;
}

interface ImportRowResult {
  isbn: string;
  outcome: ImportOutcome;
  scan_id?: number;
  // Present only for "imported"/"updated" rows — the resolved edition's details, so the
  // post-import summary can render an editable card without a follow-up per-scan fetch.
  book?: ImportedBook;
  // Present only for "imported"/"updated" rows — the scan's status/rating/owning_status as
  // actually written server-side (Goodreads import never derives owning_status from the CSV — a
  // create writes "unknown" unless the caller explicitly passed one, e.g. the edition-swap path;
  // an update leaves it alone). The client renders the summary card straight from this instead
  // of re-deriving the status/rating rules, which drifted from the server before.
  resolved?: ScanStateSummary;
  // Present only for "updated" rows — the scan's state before this update, so the client can
  // offer an Undo that restores exactly this.
  previous?: ScanStateSummary;
  // Present only for "imported" rows that added a *second* edition of a work the user already
  // owns — the import wrote owning_status "unknown" on this new scan while another edition sits
  // in the library at its own ownership, and only the server can see that.
  other_edition?: OtherEditionSummary | null;
}

/**
 * Decides whether this import row gets to write the work's rating, and what the row should
 * report either way. Ratings live on `work_ratings` (per user × per work), so within one
 * concurrently-processed batch several rows can target the same work — see `ratedWorkIds`.
 *
 * `value` is what the work's rating actually *is* afterwards, which the client renders straight
 * onto the summary card — so every branch that declines to write has to report `prior`, not the
 * incoming value. It writes nothing when: the book has no work to hang a rating on, the CSV row
 * carries no rating (Goodreads leaves unrated books at 0 — "no opinion", not "clear my rating"),
 * another row in this batch already claimed the work, or `seed` mode found the field already set.
 */
function applyImportRating(
  db: D1Database,
  userId: number,
  workId: number | null,
  incoming: number | null,
  prior: number | null,
  ratedWorkIds: Map<number, number | null>,
  mode: "seed" | "overwrite" = "overwrite",
): { statements: D1PreparedStatement[]; value: number | null } {
  if (workId == null) return { statements: [], value: prior };
  if (ratedWorkIds.has(workId)) {
    return { statements: [], value: ratedWorkIds.get(workId) ?? null };
  }
  // Seed mode's COALESCE would keep the stored value anyway; skipping the write keeps `value`
  // honest instead of reporting a rating that was never applied.
  if (incoming == null || (mode === "seed" && prior != null)) {
    if (prior != null) ratedWorkIds.set(workId, prior);
    return { statements: [], value: prior };
  }
  // Claim and return without awaiting anything, so of two concurrent rows targeting one work
  // exactly one can reach this line — the other finds the claim above and reports its value.
  ratedWorkIds.set(workId, incoming);
  return {
    statements: upsertWorkRating(db, userId, workId, { rating: incoming }, mode),
    value: incoming,
  };
}

// The work's stored rating for this user, if any. The create path needs it because a rating
// outlives the scan: a book removed from the library and re-added still carries the rating the
// user gave it, and the summary card must show that rather than "unrated".
async function existingWorkRating(
  db: D1Database,
  userId: number,
  workId: number | null,
): Promise<number | null> {
  if (workId == null) return null;
  const row = await db
    .prepare("SELECT rating FROM work_ratings WHERE user_id = ? AND work_id = ?")
    .bind(userId, workId)
    .first<{ rating: number | null }>();
  return row?.rating ?? null;
}

// Another edition of this work already on the user's shelf, if any. `scans` is unique on
// (user_id, book_id), not on the work, so this is a real second copy rather than a duplicate —
// the caller reports it so the summary card can say so instead of quietly adding an "unknown"-
// ownership twin of a book the user already marked owned.
async function findOtherEdition(
  db: D1Database,
  userId: number,
  workId: number | null,
  bookId: number,
): Promise<OtherEditionSummary | null> {
  if (workId == null) return null;
  return await db
    .prepare(
      `SELECT b.isbn, b.publisher, b.publish_date, s.owning_status
         FROM scans s JOIN books b ON b.id = s.book_id
        WHERE s.user_id = ? AND b.work_id = ? AND s.book_id != ?
        LIMIT 1`,
    )
    .bind(userId, workId, bookId)
    .first<OtherEditionSummary>();
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
  // Shared across every row in the batch (mapWithConcurrency runs rows concurrently). Two rows
  // can resolve to the same existing scan — a duplicate CSV entry, or the same book under its
  // isbn10/isbn13 forms — and without this, both would race an independent UPDATE against it and
  // both report "updated" with a `previous` read before either write landed, corrupting Undo.
  // Claiming the scan id here (synchronously, before any await) makes the second row a plain
  // "duplicate" instead, matching how an in-DB duplicate is already handled.
  claimedScanIds: Set<number>,
  // The same race one level up. A rating is keyed by *work*, so two rows resolving to two
  // different editions of one work — distinct scans, so claimedScanIds lets both through —
  // would each read the work's pre-update rating and each write, leaving Undo restoring the
  // wrong value. The first row to claim a work id owns the rating write; later rows report the
  // claimed value instead of their own, hence a Map rather than a Set.
  ratedWorkIds: Map<number, number | null>,
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
        if (claimedScanIds.has(matchedScan.id)) {
          return { isbn: isbn13, outcome: "duplicate" };
        }
        claimedScanIds.add(matchedScan.id);

        if (!matchedBook.work_id) await linkWork(db, matchedBook);
        const { sets, binds } = buildScanUpdate({ status });
        const resolvedRating = applyImportRating(
          db,
          userId,
          matchedBook.work_id,
          rating,
          matchedScan.rating,
          ratedWorkIds,
        );
        await db.batch([
          db
            .prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`)
            .bind(...binds, matchedScan.id),
          ...resolvedRating.statements,
        ]);

        return {
          isbn: isbn13,
          outcome: "updated",
          scan_id: matchedScan.id,
          book: bookSummary(matchedBook),
          resolved: {
            // status is always written; owning_status is never touched on an update; rating is
            // what applyImportRating settled on — this row's value, or the prior one when the
            // CSV row carries none or another row already claimed the work.
            status,
            rating: resolvedRating.value,
            owning_status: matchedScan.owning_status,
          },
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

    // Read *before* the INSERT so this row can't match the scan it's about to create. It can
    // still match a scan *this same import run* created — a sibling row of this batch that
    // inserted first, or any row of an earlier batch — which is a fact about the DB, not about
    // what the user had before importing. The route has no session identity to filter on; the
    // client does, and drops those (`isSessionCreatedEdition` in `stores/import.ts`).
    const otherEdition = await findOtherEdition(db, userId, book.work_id, book.id);

    const columns = ["user_id", "book_id", "status", "owning_status"];
    const binds: (string | number | null)[] = [
      userId,
      book.id,
      status,
      owning_status,
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

    // Seed rather than overwrite: creating a scan must not clobber a rating the user already has
    // on this work — from another edition they own, or from before they removed this very book
    // from their library (work_ratings rows outlive the scan). The read is hoisted out of the
    // call so the claim inside applyImportRating is plainly the first thing that happens after
    // it; a sibling row that lands here meanwhile finds the claim and reports the winner.
    const priorRating = await existingWorkRating(db, userId, book.work_id);
    const createdRating = applyImportRating(
      db,
      userId,
      book.work_id,
      rating,
      priorRating,
      ratedWorkIds,
      "seed",
    );
    if (createdRating.statements.length) await db.batch(createdRating.statements);

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
      // The exact values just written — validateImportRow already resolved owning_status
      // ("unknown" unless the caller explicitly supplied one), so status/owning_status are the
      // same bindings the INSERT used; rating is whatever the work-level seed settled on.
      resolved: { status, rating: createdRating.value, owning_status },
      other_edition: otherEdition,
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
    rows.length,
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
  // the scan insert is guarded by a UNIQUE constraint (caught as "duplicate"), so the races are
  // benign. An update-on-duplicate write has no such guard, so importRow claims the target scan
  // id itself (see claimedScanIds) instead of racing another row's UPDATE against it.
  const claimedScanIds = new Set<number>();
  const ratedWorkIds = new Map<number, number | null>();
  const results = await mapWithConcurrency(rows, ROW_CONCURRENCY, (row) =>
    importRow(
      db,
      userId,
      apiKey,
      row,
      update,
      shelvesFieldDefId,
      claimedScanIds,
      ratedWorkIds,
    ),
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
  // All present only for "updated" rows (see ImportRowResult for the resolved/previous split).
  book?: ImportedBook;
  resolved?: ScanStateSummary;
  previous?: ScanStateSummary;
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
    rows.length,
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
      `SELECT s.id AS scan_id, s.status, wr.rating, s.owning_status,
              b.id AS book_id, b.work_id, b.isbn,
              COALESCE(o.title, b.title) AS title, b.author,
              wk.canonical_title AS canonical_title,
              b.cover_url, b.publisher, b.language
       FROM scans s
       JOIN books b ON b.id = s.book_id
       LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
       LEFT JOIN works wk ON wk.id = b.work_id
       LEFT JOIN work_ratings wr ON wr.work_id = b.work_id AND wr.user_id = s.user_id
       WHERE s.user_id = ?`,
    )
    .bind(userId)
    .all<LibraryIndexRow>();

  const byScanId = new Map(library.map((row) => [row.scan_id, row]));
  // Normalize every candidate's titles/author-key once, up front — the whole row batch is then
  // scored against the same prepared list instead of re-normalizing the library per row.
  const candidates = prepareCandidates(
    library.map((row) => ({
      scanId: row.scan_id,
      bookId: row.book_id,
      title: row.title,
      canonicalTitle: row.canonical_title,
      author: row.author,
    })),
  );

  // Two rows in one batch can resolve to the same library scan (e.g. duplicate hand-added CSV
  // entries). The first claims it and is "updated"; a later row matching an already-claimed scan
  // is reported "duplicate" so the client doesn't render two cards — and two Undos — for one scan.
  const claimedScanIds = new Set<number>();
  // Same claim one level up, keyed by work — see applyImportRating. Two rows can match two
  // different owned editions of one work, which claimedScanIds lets through.
  const ratedWorkIds = new Map<number, number | null>();

  const results: MatchRowResult[] = [];
  for (const row of rows) {
    const validated = validateMatchRow(row);
    if (!validated) {
      results.push({ outcome: "no_match" });
      continue;
    }

    const match = pickBestMatchPrepared(
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

    if (!update || claimedScanIds.has(matched.scan_id)) {
      results.push({ outcome: "duplicate" });
      continue;
    }
    claimedScanIds.add(matched.scan_id);

    const { sets, binds } = buildScanUpdate({ status: validated.status });
    const resolvedRating = applyImportRating(
      db,
      userId,
      matched.work_id,
      validated.rating,
      matched.rating,
      ratedWorkIds,
    );
    await db.batch([
      db
        .prepare(`UPDATE scans SET ${sets.join(", ")} WHERE id = ?`)
        .bind(...binds, matched.scan_id),
      ...resolvedRating.statements,
    ]);

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
      resolved: {
        status: validated.status,
        rating: resolvedRating.value,
        owning_status: matched.owning_status,
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
