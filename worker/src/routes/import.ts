import { Hono, type Context } from "hono";
import type { Env, BookRow } from "../types";
import { authMiddleware } from "../auth";
import {
  resolveEdition,
  linkWork,
  searchTitleCached,
  searchCacheKeyString,
  type FallbackMetadata,
} from "../editions";
import { normalizeIsbn, isValidIsbn } from "../isbn";
import { rateLimitOrReject } from "../rate-limit";
import { readJsonBody, INVALID_JSON_BODY } from "../json-body";
import { mapWithConcurrency } from "../concurrency";
import type { UsageRecorder } from "../usage";
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
  OWNED_OWNING_STATUSES,
  type ExistingScan,
} from "../library-query";
import {
  pickAutoIsbn,
  pickBestMatchPrepared,
  prepareCandidates,
  type IsbnCandidate,
} from "../title-match";

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

// The batch-shape guard all three routes below share. Their caps differ (each has its own budget
// argument) but the contract — a non-empty array within the cap — and the 400 it produces do not.
//
// `Array.isArray` is load-bearing, not defensive: `rows` comes straight off an unvalidated JSON
// body, and a string has a `length` too. `{"rows":"0123456789"}` otherwise passed this check and
// then either threw on `.some` (a 500 instead of a 400) or, on /suggest-isbn, sailed through and
// charged 10 rows against the caller's rate-limit budget for ten junk results.
function batchSizeError(
  c: Context<Env>,
  rows: unknown,
  max: number,
): Response | null {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > max) {
    return c.json({ error: `rows must contain between 1 and ${max} entries` }, 400);
  }
  return null;
}

// All three passes of one import session share a bucket, so they jointly stay under budget — and
// all three charge what they actually are (rows, not requests). Returns a ready 429, or null.
function importRateLimit(c: Context<Env>, rowCount: number): Promise<Response | null> {
  return rateLimitOrReject(
    c,
    `import:${c.get("userId")}`,
    IMPORT_RATE_LIMIT,
    1,
    "Too many import requests — please slow down",
    rowCount,
  );
}

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

// An edition of the same work the user already had a scan for. Only ever reported alongside a newly
// created scan, which now means only when `update` is off: the dedupe is per ISBN, so a Goodreads row
// carrying a different edition's ISBN is not a duplicate, and with updates declined the only thing
// left to do with it is add it as a second scan and say what it landed beside.
interface OtherEditionSummary {
  isbn: string;
  publisher: string | null;
  // Two printings from one publisher are common enough that the publisher alone doesn't identify
  // which copy the user already has — the year is what tells a reissue from the original.
  publish_date: string | null;
  owning_status: string;
}

// One scan the user already has on another edition of the work being imported, with everything
// the update path needs: the scan to write, its pre-update state for Undo, and its edition's
// details so the summary card can name the copy in the library rather than the CSV's edition.
interface WorkSiblingScan extends ImportedBook, UpdatableScan {
  /** Only for the `other_edition` note — the year is what tells a reissue from the original. */
  publish_date: string | null;
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
  // Present only for "updated" rows matched by *work* rather than by ISBN: the CSV carried a
  // different edition's ISBN than the copy in the library, and the copy is what got updated. An
  // explicit flag rather than something the client infers from `isbn` vs `book.isbn`, which would
  // be wrong for a book stored under the other ISBN form.
  matched_via_work?: true;
  // Present only alongside `matched_via_work` — the *other* sibling scans whose status this row
  // also wrote, each with its own pre-update value. Undo has to restore all of them, not just
  // `scan_id`; the rating needs no equivalent, being one per-work value.
  sibling_updates?: { scan_id: number; previous_status: string }[];
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
 *
 * Exported for the unit tests: the claim bookkeeping is what the batch's per-work guarantee rests
 * on, and it is pure apart from the statements it hands back unexecuted.
 */
export function applyImportRating(
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

// The scan fields every update-in-place path needs: the row to write, its pre-update state for
// Undo, and the ownership to report back untouched. `ExistingScan` (the ISBN-duplicate path) and
// `WorkSiblingScan` (the work path) satisfy it as-is; the match route's library index row names the
// same column `scan_id`, so its call site adapts it.
interface UpdatableScan {
  id: number;
  status: string;
  rating: number | null;
  owning_status: string;
}

// The common core of an "updated" result. Each caller adds its own envelope: /goodreads the row's
// `isbn` (plus `matched_via_work` on the work path), /match the match `confidence`.
type ImportUpdateResult = { outcome: "updated" } &
  Required<Pick<ImportRowResult, "scan_id" | "book" | "resolved" | "previous">> &
  Pick<ImportRowResult, "sibling_updates">;

// All-or-nothing claim of the scans a row is about to write, synchronously before any await. Two
// rows of one batch can resolve to the same scan — a duplicate CSV entry, one book under both ISBN
// forms, or two editions of one work — and without this both would write, each having read a
// `previous` from before the other's write, leaving Undo restoring the wrong value. The row that
// loses the claim reports `duplicate` instead.
//
// Exported for the unit tests — all-or-nothing is the whole contract, and a partial claim would be
// invisible until two rows of one export happened to overlap.
export function claimScans(claimedScanIds: Set<number>, ids: number[]): boolean {
  if (ids.some((id) => claimedScanIds.has(id))) return false;
  for (const id of ids) claimedScanIds.add(id);
  return true;
}

// The write every update-in-place row performs and the result it reports, shared by all three paths
// that have one (ISBN duplicate, work-level match, title match) so they cannot drift: the row's
// `status` onto every scan given, its `rating` onto the work they share, `owning_status` untouched.
//
// `scans[0]` is the primary by contract — the scan the client's card edits, and the one `resolved`
// and `previous` describe. Anything after it is another copy of the same work, reported in
// `sibling_updates` with its own prior status so Undo can restore each one individually.
async function applyImportUpdate(
  db: D1Database,
  userId: number,
  scans: UpdatableScan[],
  book: ImportedBook,
  status: string,
  rating: number | null,
  ratedWorkIds: Map<number, number | null>,
): Promise<ImportUpdateResult> {
  const [primary, ...others] = scans;
  // `status` is required here and `validateImportRow`/`validateMatchRow` always resolve one, so this
  // SET list is never empty — unlike PATCH /api/scans/:id, which passes both fields optionally and
  // has to skip the UPDATE when neither is present.
  const { sets, binds } = buildScanUpdate({ status });
  const resolvedRating = applyImportRating(
    db,
    userId,
    book.work_id,
    rating,
    primary.rating,
    ratedWorkIds,
  );
  await db.batch([
    // One statement for the whole set — every scan takes the same SET clause.
    db
      .prepare(
        `UPDATE scans SET ${sets.join(", ")} WHERE id IN (${scans.map(() => "?").join(", ")})`,
      )
      .bind(...binds, ...scans.map((s) => s.id)),
    ...resolvedRating.statements,
  ]);

  return {
    outcome: "updated",
    scan_id: primary.id,
    book,
    resolved: {
      // status is always written; owning_status is never touched on an update; rating is what
      // applyImportRating settled on — this row's value, or the prior one when the CSV row carries
      // none or another row already claimed the work.
      status,
      rating: resolvedRating.value,
      owning_status: primary.owning_status,
    },
    previous: {
      status: primary.status,
      rating: primary.rating,
      owning_status: primary.owning_status,
    },
    ...(others.length > 0
      ? {
          sibling_updates: others.map((s) => ({
            scan_id: s.id,
            previous_status: s.status,
          })),
        }
      : {}),
  };
}

// Every *other* edition of this work the user already has a scan for, oldest first. `scans` is
// unique on (user_id, book_id) rather than on the work, so these are real second copies rather
// than duplicates — which is exactly why a Goodreads row naming one of their sibling ISBNs is
// still about a book the user has already logged.
//
// `rating` rides along from the work_ratings join: it is keyed per (user, work), so every sibling
// reports the same value and the update path gets its `prior` without a second query. The `books`
// columns are the ones `bookSummary` copies, so a sibling can stand in for the resolved edition
// on the summary card.
//
// The LIMIT is a sanity bound on the status fan-out below, not a real constraint — nobody logs
// twenty editions of one work.
async function findWorkSiblingScans(
  db: D1Database,
  userId: number,
  workId: number | null,
  bookId: number,
): Promise<WorkSiblingScan[]> {
  if (workId == null) return [];
  const { results } = await db
    .prepare(
      `SELECT s.id, s.status, s.owning_status, wr.rating,
              b.isbn, b.title, b.author, b.cover_url, b.publisher, b.publish_date,
              b.language, b.work_id
         FROM scans s
         JOIN books b ON b.id = s.book_id
    LEFT JOIN work_ratings wr ON wr.work_id = b.work_id AND wr.user_id = s.user_id
        WHERE s.user_id = ? AND b.work_id = ? AND s.book_id != ?
        ORDER BY s.created_at, s.id
        LIMIT 20`,
    )
    .bind(userId, workId, bookId)
    .all<WorkSiblingScan>();
  return results;
}

// Which sibling the summary card points at: the copy the user actually has, else the oldest (both
// callers' queries order by created_at). Only the card's identity hangs on this — the status write
// covers every sibling regardless. Generic over the row shape, so /match's library-index row can use
// it as well as the work path's sibling row. Exported for the unit tests.
export function pickPrimarySibling<T extends { owning_status: string }>(
  siblings: T[],
): T {
  return (
    siblings.find((s) => OWNED_OWNING_STATUSES.includes(s.owning_status)) ??
    siblings[0]
  );
}

// Widened from BookRow to exactly the fields it copies, so a work-sibling row — which selects the
// same `books` columns — can go through it as well as a freshly resolved edition.
function bookSummary(book: ImportedBook): ImportedBook {
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
  usage: UsageRecorder,
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

        if (!matchedBook.work_id) {
          await linkWork(db, matchedBook);
          // Re-read the work's rating: `getExistingScan` joined it through `books.work_id`, which
          // was still NULL at that point, so it reported null for a work that may well already
          // carry a rating — ratings outlive scans, so a book re-added after being deleted still
          // has one. Left stale, an incoming CSV rating overwrote the real stored value and
          // `previous.rating` reported null, so Undo destroyed it rather than restoring it.
          matchedScan.rating = await existingWorkRating(
            db,
            userId,
            matchedBook.work_id,
          );
        }
        // The row named this edition, so it stays the primary — but a reading status is a statement
        // about the book, so every other copy of the work takes it too, exactly as on the work-match
        // path below. Without this the same export would update one copy for a row naming the exact
        // ISBN of a copy, and every copy for a row naming some third edition.
        const scans = [
          matchedScan,
          ...(await findWorkSiblingScans(
            db,
            userId,
            matchedBook.work_id,
            matchedBook.id,
          )),
        ];
        if (!claimScans(claimedScanIds, scans.map((s) => s.id))) {
          return { isbn: isbn13, outcome: "duplicate" };
        }
        return {
          isbn: isbn13,
          ...(await applyImportUpdate(
            db,
            userId,
            scans,
            bookSummary(matchedBook),
            status,
            rating,
            ratedWorkIds,
          )),
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
      book = await resolveEdition(db, isbn13, apiKey, {
        allowEmpty: true,
        fallbackMeta,
        usage,
      });
    }

    if (!book) {
      console.error("[POST /api/import/goodreads] resolveEdition failed, isbn:", isbn13);
      return { isbn: isbn13, outcome: "failed" };
    }

    // Read *before* the INSERT so this row can't match the scan it's about to create. It can
    // still match a scan *this same import run* created — a sibling row of this batch that
    // inserted first, or any row of an earlier batch — which is a fact about the DB, not about
    // what the user had before importing. That matters for the note below (the client filters
    // those out via `isSessionCreatedEdition`); for the update path it doesn't, since updating a
    // scan an earlier row just created is the same thing the user wants either way.
    const siblings = await findWorkSiblingScans(db, userId, book.work_id, book.id);

    // A Goodreads ISBN is whichever edition was popular there, not a claim about which copy the
    // user holds — so with `update` on, a row whose *work* is already in the library updates that
    // copy instead of adding an "unknown"-ownership twin beside it. With `update` off nothing is
    // written to the existing scans at all; that row falls through to the INSERT and the
    // `other_edition` note below, which is the whole point of the toggle.
    if (update && siblings.length > 0) {
      if (!claimScans(claimedScanIds, siblings.map((s) => s.id))) {
        return { isbn: isbn13, outcome: "duplicate" };
      }
      // Reading status is per scan — the app deliberately never fans it out, since ownership and
      // progress belong to a copy. But a work the user has twice is still one book they read, and
      // the CSV row is a statement about the book, so the shelf's status goes to every copy.
      // `book` is the edition in the library, not the one the CSV named — that one has no scan, and
      // the card is an editor for a scan.
      const primary = pickPrimarySibling(siblings);
      return {
        isbn: isbn13,
        matched_via_work: true,
        ...(await applyImportUpdate(
          db,
          userId,
          [primary, ...siblings.filter((s) => s !== primary)],
          bookSummary(primary),
          status,
          rating,
          ratedWorkIds,
        )),
      };
    }

    // Only reachable when nothing was updated above: a second scan is going in at
    // owning_status "unknown" beside a copy the user may well have marked owned, and only the
    // server can see that. Name the owned copy where there is one — that's the one to reconcile
    // against.
    const noted = siblings.length > 0 ? pickPrimarySibling(siblings) : null;
    const otherEdition: OtherEditionSummary | null = noted && {
      isbn: noted.isbn,
      publisher: noted.publisher,
      publish_date: noted.publish_date,
      owning_status: noted.owning_status,
    };

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
    // The sibling query's work_ratings join already carries this when there was a sibling to join
    // through; only a work with no other scan needs the dedicated read (a rating outlives the scan,
    // so "no scan" does not mean "no rating").
    const priorRating = siblings.length
      ? siblings[0].rating
      : await existingWorkRating(db, userId, book.work_id);
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
  const body = await readJsonBody<{
    rows?: ImportRowInput[];
    update?: boolean;
    // Request-level, not per-row — the client creates/reuses a single "Shelves" tag field once
    // per import session (see stores/import.ts) rather than per row.
    shelves_field_def_id?: number;
  }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  // Defaulted rather than checked for undefined: an absent `rows` is an empty batch, which the
  // size guard already rejects — and defaulting keeps `rows` an array for the checks below.
  // A `rows` that isn't an array is the same non-batch. `batchSizeError` leads with its own
  // `Array.isArray` check, so this changes no response; it is here to keep the local type honest
  // (`.some` below is only reachable on an array because that guard already returned).
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const update = body.update === true;
  const tooMany = batchSizeError(c, rows, MAX_BATCH_SIZE);
  if (tooMany) return tooMany;
  if (rows.some((r) => typeof r?.isbn !== "string" || !r.isbn)) {
    return c.json({ error: "each row requires an isbn" }, 400);
  }

  const userId = c.get("userId");
  // After the shape checks, so a malformed batch 400s without burning the user's row budget.
  const blocked = await importRateLimit(c, rows.length);
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
      c.get("usage"),
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
  // All present only for "updated" rows (see ImportRowResult for the resolved/previous split, and
  // for what sibling_updates carries).
  book?: ImportedBook;
  resolved?: ScanStateSummary;
  previous?: ScanStateSummary;
  sibling_updates?: { scan_id: number; previous_status: string }[];
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
  const body = await readJsonBody<{
    rows?: MatchRowInput[];
    update?: boolean;
  }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const update = body.update === true;
  const tooMany = batchSizeError(c, rows, MAX_MATCH_BATCH_SIZE);
  if (tooMany) return tooMany;
  if (rows.some((r) => typeof r?.title !== "string" || !r.title)) {
    return c.json({ error: "each row requires a title" }, 400);
  }

  const userId = c.get("userId");
  const blocked = await importRateLimit(c, rows.length);
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
       WHERE s.user_id = ?
       ORDER BY s.created_at, s.id`,
    )
    .bind(userId)
    .all<LibraryIndexRow>();

  const byScanId = new Map(library.map((row) => [row.scan_id, row]));
  // The copies of each work, grouped once rather than re-scanned per matched row: at the 20k-scan
  // ceiling a filter inside the loop is 50 walks of the whole library to find the one or two rows
  // that share a work. Insertion order follows the query's `ORDER BY created_at, id`, which is what
  // makes pickPrimarySibling's "else the oldest" fallback mean anything.
  const byWorkId = new Map<number, LibraryIndexRow[]>();
  for (const row of library) {
    if (row.work_id == null) continue;
    const existing = byWorkId.get(row.work_id);
    if (existing) existing.push(row);
    else byWorkId.set(row.work_id, [row]);
  }
  // Normalize every candidate's titles/author-key once, up front — the whole row batch is then
  // scored against the same prepared list instead of re-normalizing the library per row. `workId`
  // rides along so two copies of one book don't read as two rival answers (see pickBestMatchPrepared).
  const candidates = prepareCandidates(
    library.map((row) => ({
      scanId: row.scan_id,
      bookId: row.book_id,
      workId: row.work_id,
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
    // Per-row isolation, as `/goodreads`'s `importRow` has. This loop awaits `applyImportUpdate`,
    // and therefore a real `db.batch`; without a catch, a throw on row k propagated out of the
    // handler as a 500 and discarded the whole `results` array — including rows 0..k-1 whose scan
    // statuses and work_ratings had already been written. The client then marked every row of the
    // batch `no_match`, leaving those committed writes with no card pointing at them, so neither
    // Undo nor cancel could restore them. Reporting `no_match` for the failed row keeps the
    // response positional and lets the rows that did write report their scan_id and previous.
    try {
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

      // Every copy of the matched work, primary first. Same rule as the /goodreads work path — one
      // book the user has twice still takes one reading status — and free here: the whole library is
      // already in memory, so the siblings cost no query. A work-less scan is its own only copy;
      // grouping unlinked books together would be wrong (see `workSiblings` on the client).
      const copies =
        matched.work_id == null ? [matched] : byWorkId.get(matched.work_id)!;
      // The row named a title, not an edition, so it only identifies a *copy* when one outscored its
      // siblings. On a tie the card points at an owned copy, else the oldest — the same choice the
      // ISBN work path makes for the same reason: the card is an editor for one scan, and the copy
      // on the user's shelf is the one they mean. The status write covers all of them either way.
      const primary = match.identifiedCopy
        ? matched
        : pickPrimarySibling(copies);
      const scans: UpdatableScan[] = [
        primary,
        ...copies.filter((r) => r !== primary),
      ].map((r) => ({ ...r, id: r.scan_id }));

      if (
        !update ||
        !claimScans(
          claimedScanIds,
          scans.map((s) => s.id),
        )
      ) {
        results.push({ outcome: "duplicate" });
        continue;
      }

      results.push({
        ...(await applyImportUpdate(
          db,
          userId,
          scans,
          bookSummary(primary),
          validated.status,
          validated.rating,
          ratedWorkIds,
        )),
        confidence: match.score,
      });
    } catch (e) {
      console.error("[POST /api/import/match] row failed:", e);
      results.push({ outcome: "no_match" });
    }
  }

  return c.json({ results });
});

// ── Auto-assigning an ISBN to a row that has none ────────────────────────────────────────────
//
// The third and last pass over a row with no usable ISBN: /match has already ruled out the user's
// own library, so this one asks the catalogue/Google Books what edition the title/author names and
// hands back an ISBN the client can send through /goodreads like any other row. The user picks
// nothing — but `pickAutoIsbn` only answers when the answer is confident and unambiguous, so a row
// this pass declines still goes to manual review rather than being guessed at.

// One Google Books search per row at most (the catalogue, `search_cache` and the per-request memo
// below absorb the repeats). Nominally 10 external subrequests, but `searchBooksByTitle` retries a
// 5xx up to 4 times, so a bad Google episode makes the true worst case 40 of the free plan's 50 —
// which is the real reason this cap isn't higher.
const MAX_SUGGEST_BATCH_SIZE = 10;

interface SuggestRowInput {
  title?: unknown;
  author?: unknown;
}

interface SuggestRowResult {
  isbn: string | null;
  /** Title-match score of the winning candidate; absent when nothing was picked. */
  confidence?: number;
  /** Set when the search never ran to an answer (Google quota/5xx). The row is *unanswered*, not
   *  declined — nothing about it was judged — so the client can offer a retry instead of sending
   *  the user off to resolve by hand what a second attempt would resolve by itself. */
  unavailable?: true;
}

importRoutes.post("/suggest-isbn", async (c) => {
  const body = await readJsonBody<{ rows?: SuggestRowInput[] }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const tooMany = batchSizeError(c, rows, MAX_SUGGEST_BATCH_SIZE);
  if (tooMany) return tooMany;

  const blocked = await importRateLimit(c, rows.length);
  if (blocked) return blocked;

  const db = c.env.DB;
  const apiKey = c.env.GOOGLE_BOOKS_API_KEY;

  // Rows run concurrently and the `search_cache` write only lands in waitUntil, so two rows naming
  // the same book — routine in a hand-added Goodreads shelf — would each spend a Google query on
  // the identical search. Sharing the in-flight promise costs one Map and saves the scarce thing.
  const searches = new Map<string, Promise<IsbnCandidate[]>>();
  function searchOnce(title: string): Promise<IsbnCandidate[]> {
    // Searched by title alone, with the author only used to *score* the results: Google's
    // `inauthor:` is an exact-ish filter, and a Goodreads author string ("Tolkien, J.R.R.",
    // "Terry Pratchett, Neil Gaiman") often fails it outright, which would return nothing to judge
    // rather than something to reject.
    const query = { title };
    const key = searchCacheKeyString(query);
    let search = searches.get(key);
    if (!search) {
      search = searchTitleCached(
        db,
        apiKey,
        query,
        (p) => c.executionCtx.waitUntil(p),
        c.get("usage"),
      ).then(({ results }) =>
        // Google occasionally reports an identifier that isn't a valid ISBN; /goodreads would reject
        // it as `invalid_isbn` and the row would land in review anyway, one round-trip later.
        results
          .map((cand) => ({ ...cand, isbn: normalizeIsbn(cand.isbn) }))
          .filter((cand) => isValidIsbn(cand.isbn)),
      );
      searches.set(key, search);
    }
    return search;
  }

  const results = await mapWithConcurrency<SuggestRowInput, SuggestRowResult>(
    rows,
    ROW_CONCURRENCY,
    async (row) => {
      const title = typeof row?.title === "string" ? row.title.trim() : "";
      const author = typeof row?.author === "string" ? row.author.trim() : "";
      // Nothing to search on. The client filters these out already; this is the backstop that keeps
      // the response positional with the request either way.
      if (!title) return { isbn: null };

      let candidates: IsbnCandidate[];
      try {
        candidates = await searchOnce(title);
      } catch (e) {
        // A quota/rate-limit rejection (UpstreamSearchError) is not an answer about this row — but
        // it isn't worth failing the batch over either. It is reported apart from a considered
        // "no" so the row can be retried rather than hand-resolved, and logged because nothing
        // else records it: `search_cache` stores only successes, which left a Google outage
        // mid-import indistinguishable from a library of genuinely unidentifiable titles.
        console.error("[POST /api/import/suggest-isbn] search failed, title:", title, e);
        return { isbn: null, unavailable: true };
      }

      const pick = pickAutoIsbn({ title, author }, candidates);
      return pick ? { isbn: pick.isbn, confidence: pick.confidence } : { isbn: null };
    },
  );

  return c.json({ results });
});

export default importRoutes;
