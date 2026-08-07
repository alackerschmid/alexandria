import { Hono } from "hono";
import type { Env, BookRow } from "../types";
import { authMiddleware } from "../auth";
import { resolveEdition, materializeEdition, linkWork } from "../editions";
import { enrichWorkDetached } from "../enrichment";
import {
  sortClauseFor,
  buildScanSelect,
  fetchCustomFields,
  attachCustomFields,
  VALID_STATUSES,
  VALID_OWNING_STATUSES,
  isValidRating,
  isValidReview,
  normalizeReview,
  REVIEW_MAX_LENGTH,
  findExistingScan,
  isUniqueConstraintError,
  parseIntOr,
  buildScanUpdate,
  upsertWorkRating,
} from "../library-query";
import { rateLimitOrReject } from "../rate-limit";
import { readJsonBody, INVALID_JSON_BODY } from "../json-body";
import { normalizeIsbn, isValidIsbn, isIsbnFormat, alternateIsbnForm } from "../isbn";

const scans = new Hono<Env>();

scans.use("*", authMiddleware);

// Generous enough for a rapid barcode-scanning session (~1 book every 2s); guards against a
// runaway client bug/loop, not deliberate abuse.
const SCAN_RATE_LIMIT = 30;

scans.get("/", async (c) => {
  const userId = c.get("userId");
  const limit = Math.min(
    Math.max(parseIntOr(c.req.query("limit"), 200), 1),
    500,
  );
  const offset = Math.max(parseIntOr(c.req.query("offset"), 0), 0);
  const locale = c.req.query("locale") ?? "en";
  const orderClause = sortClauseFor(c.req.query("sort"));

  const { results } = await c.env.DB.prepare(
    `${buildScanSelect(locale)} WHERE s.user_id = ? ORDER BY ${orderClause} LIMIT ? OFFSET ?`,
  )
    .bind(userId, limit, offset)
    .all<any>();

  const bookIds = results.map((r: any) => r.book_id as number);
  const { defs, valuesByBook } = await fetchCustomFields(
    c.env.DB,
    userId,
    bookIds,
  );

  return c.json(
    results.map((row) => attachCustomFields(row, defs, valuesByBook)),
  );
});

// The scanner's duplicate-detection index: every ISBN the user owns with its reading status,
// unpaginated. Deliberately not `GET /` with a big limit — that row is the full merged JOIN
// (descriptions, JSON tag arrays, per-book custom field values), and the scanner needs *all* of
// it on mount just to build an ISBN→status map, so paging the heavy row put a cost linear in
// library size on the most latency-sensitive page in the app. Two columns per scan stays small
// enough to send in one response at any realistic library size.
// Registered before `/:id` so the literal path wins the match.
scans.get("/isbns", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT b.isbn, s.status FROM scans s JOIN books b ON b.id = s.book_id WHERE s.user_id = ?",
  )
    .bind(userId)
    .all<{ isbn: string; status: string }>();
  return c.json(results);
});

scans.post("/", async (c) => {
  const body = await readJsonBody<{
    isbn: string;
    status?: string;
    owning_status?: string;
    rating?: number | null;
    review?: string | null;
  }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  if (typeof body.isbn !== "string" || !body.isbn)
    return c.json({ error: "ISBN is required" }, 400);
  const isbn = normalizeIsbn(body.isbn);
  // Format-only check (not checksum): a scanner misread that gets one check digit wrong must
  // still queue as a pending scan rather than being hard-rejected — see resolveEdition's allowEmpty.
  if (!isIsbnFormat(isbn)) return c.json({ error: "Invalid ISBN" }, 400);
  const initialStatus = (VALID_STATUSES as readonly string[]).includes(
    body.status ?? "",
  )
    ? body.status
    : "unread";
  const initialOwningStatus = (
    VALID_OWNING_STATUSES as readonly string[]
  ).includes(body.owning_status ?? "")
    ? body.owning_status
    : "owned";
  // Unlike status/owning_status, unrated (null) is a legitimate, common state — no default applied.
  if (body.rating != null && !isValidRating(body.rating)) {
    return c.json({ error: "rating must be an integer 0-10 or null" }, 400);
  }
  const initialRating = body.rating ?? null;
  if (body.review !== undefined && !isValidReview(body.review)) {
    return c.json(
      { error: `review must be a string of at most ${REVIEW_MAX_LENGTH} characters, or null` },
      400,
    );
  }
  const initialReview = normalizeReview(body.review ?? null);

  const userId = c.get("userId");
  const db = c.env.DB;
  const locale = c.req.query("locale") ?? "en";

  // Check for an existing scan of this ISBN before touching external metadata APIs — a
  // duplicate scan is a cheap, common case (e.g. rescanning a shelf) and answering it takes
  // only local D1 reads. Checked under both ISBN forms: the same edition may already be stored
  // under its ISBN-10 or ISBN-13 form.
  const altIsbn = alternateIsbnForm(isbn);
  const { results: existingBooks } = await db
    .prepare(`SELECT id FROM books WHERE isbn = ? ${altIsbn ? "OR isbn = ?" : ""}`)
    .bind(...(altIsbn ? [isbn, altIsbn] : [isbn]))
    .all<{ id: number }>();
  let duplicate = false;
  for (const existingBook of existingBooks) {
    if (await findExistingScan(db, userId, existingBook.id)) {
      duplicate = true;
      break;
    }
  }

  // Charged on the duplicate path too. The check above costs up to three D1 queries, and it
  // used to `return 409` before the limiter was ever consulted — so replaying an owned ISBN
  // was an unmetered way to keep the worker doing database work. A duplicate still reads as a
  // 409 rather than a 429 for as long as the caller is inside the budget, which covers every
  // real rescan (30/min is ~one book every 2s); past it, the limit wins.
  const blocked = await rateLimitOrReject(
    c,
    `scan:${userId}`,
    SCAN_RATE_LIMIT,
    1,
    "Too many scans — please slow down",
  );
  if (blocked) return blocked;
  if (duplicate) return c.json({ error: "Already in your list" }, 409);

  // allowEmpty: a drained offline-queue scan must succeed even if the book can't be resolved.
  const book = await resolveEdition(db, isbn, c.env.GOOGLE_BOOKS_API_KEY, {
    allowEmpty: true,
    usage: c.get("usage"),
  });
  if (!book) {
    console.error("[POST /api/scans] book resolution failed, isbn:", isbn);
    return c.json({ error: "Failed to resolve book entry" }, 500);
  }

  let result;
  try {
    result = await db
      .prepare(
        "INSERT INTO scans (user_id, book_id, status, owning_status) VALUES (?, ?, ?, ?)",
      )
      .bind(userId, book.id, initialStatus, initialOwningStatus)
      .run();
  } catch (e) {
    if (isUniqueConstraintError(e)) {
      return c.json({ error: "Already in your list" }, 409);
    }
    console.error("[POST /api/scans] scan INSERT failed:", e);
    return c.json({ error: "Failed to save scan" }, 500);
  }

  // Seed, never overwrite: the values arriving here are replays from another point in time — the
  // scanner's offline queue draining, or a guest's local scans syncing on register — so they must
  // not stomp a rating the user has since set from another edition of the same work.
  //
  // A rating can never fail the scan itself: `allowEmpty` above exists so a drained offline scan
  // always succeeds, and an unlinked book (no work to hang the rating on) must not undo that.
  if ((initialRating != null || initialReview != null) && book.work_id) {
    await db.batch(
      upsertWorkRating(
        db,
        userId,
        book.work_id,
        { rating: initialRating, review: initialReview },
        "seed",
      ),
    );
  } else if (initialRating != null || initialReview != null) {
    console.error(
      "[POST /api/scans] rating/review dropped, book has no work link, isbn:",
      isbn,
    );
  }

  if (book.work_id)
    c.executionCtx.waitUntil(
      enrichWorkDetached(
        db,
        book.work_id,
        false,
        c.env.GOOGLE_BOOKS_API_KEY,
        "scan",
      ),
    );

  const saved = await db
    .prepare(`${buildScanSelect(locale)} WHERE s.id = ?`)
    .bind(result.meta.last_row_id)
    .first<any>();

  const { defs, valuesByBook } = await fetchCustomFields(
    db,
    userId,
    saved ? [saved.book_id] : [],
  );

  return c.json(
    saved ? attachCustomFields(saved, defs, valuesByBook) : {},
    201,
  );
});

// Single scan — used by BookDetail to poll enrichment_status after a scan.
scans.get("/:id", async (c) => {
  const userId = c.get("userId");
  const locale = c.req.query("locale") ?? "en";
  const scan = await c.env.DB.prepare(
    `${buildScanSelect(locale)} WHERE s.id = ? AND s.user_id = ?`,
  )
    .bind(c.req.param("id"), userId)
    .first<any>();
  if (!scan) return c.json({ error: "Not found" }, 404);
  const { defs, valuesByBook } = await fetchCustomFields(c.env.DB, userId, [
    scan.book_id,
  ]);
  return c.json(attachCustomFields(scan, defs, valuesByBook));
});

interface PatchScanBody {
  status?: string;
  owning_status?: string;
  rating?: number | null;
  review?: string | null;
}

function validatePatchBody(
  body: PatchScanBody,
  hasStatus: boolean,
  hasOwningStatus: boolean,
  hasRating: boolean,
  hasReview: boolean,
): string | null {
  if (!hasStatus && !hasOwningStatus && !hasRating && !hasReview) {
    return "status, owning_status, rating, or review is required";
  }
  if (
    hasStatus &&
    !(VALID_STATUSES as readonly string[]).includes(body.status ?? "")
  ) {
    return "status must be one of: unread, reading, read, dnf";
  }
  if (
    hasOwningStatus &&
    !(VALID_OWNING_STATUSES as readonly string[]).includes(
      body.owning_status ?? "",
    )
  ) {
    return `owning_status must be one of: ${VALID_OWNING_STATUSES.join(", ")}`;
  }
  if (hasRating && body.rating !== null && !isValidRating(body.rating)) {
    return "rating must be an integer 0-10 or null";
  }
  if (hasReview && !isValidReview(body.review)) {
    return `review must be a string of at most ${REVIEW_MAX_LENGTH} characters, or null`;
  }
  return null;
}

scans.patch("/:id", async (c) => {
  const body = await readJsonBody<PatchScanBody>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  const hasStatus = "status" in body;
  const hasOwningStatus = "owning_status" in body;
  const hasRating = "rating" in body;
  const hasReview = "review" in body;

  const validationError = validatePatchBody(
    body,
    hasStatus,
    hasOwningStatus,
    hasRating,
    hasReview,
  );
  if (validationError) return c.json({ error: validationError }, 400);

  const userId = c.get("userId");
  const db = c.env.DB;
  const scanId = c.req.param("id");

  // One lookup does three jobs: the 404 check (the scan UPDATE can no longer supply it — a
  // rating-only PATCH touches no scan column at all), the book row `linkWork` needs, and the
  // work id every rating write is keyed on. Selects `b.*` alone, never `s.id` alongside it:
  // both columns are named `id`, and `linkWork` writes `UPDATE books SET work_id = ? WHERE
  // id = ?` — if the duplicate ever resolved to the scan's id it would stamp the work onto an
  // unrelated book. The scan's own id is already in hand as `scanId`.
  const book = await db
    .prepare(
      `SELECT b.* FROM scans s JOIN books b ON b.id = s.book_id
        WHERE s.id = ? AND s.user_id = ?`,
    )
    .bind(scanId, userId)
    .first<BookRow>();
  if (!book) return c.json({ error: "Book not found" }, 404);

  const writesRating = hasRating || hasReview;
  let workId = book.work_id;
  if (writesRating && !workId) {
    // Effectively always succeeds — linkWork falls back to an `isbn:<isbn>` match key even for a
    // title-less book — and it writes work_id back onto the row in place.
    await linkWork(db, book);
    workId = book.work_id;
    if (!workId) {
      return c.json(
        { error: "This book isn't linked to a work yet", code: "work_unresolved" },
        409,
      );
    }
  }

  const { sets, binds } = buildScanUpdate({
    status: hasStatus ? body.status! : undefined,
    owningStatus: hasOwningStatus ? body.owning_status! : undefined,
  });

  const resolvedReview = hasReview ? normalizeReview(body.review ?? null) : undefined;

  // One batch so a status+rating PATCH can't half-apply across the two tables.
  const statements = [
    ...(sets.length
      ? [
          db
            .prepare(
              `UPDATE scans SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
            )
            .bind(...binds, scanId, userId),
        ]
      : []),
    ...(writesRating
      ? upsertWorkRating(
          db,
          userId,
          workId!,
          {
            ...(hasRating ? { rating: body.rating ?? null } : {}),
            ...(hasReview ? { review: resolvedReview } : {}),
          },
          "overwrite",
        )
      : []),
  ];
  if (statements.length) await db.batch(statements);

  // `updated_at` is set by the upsert to CURRENT_TIMESTAMP, and the detail view shows it as the
  // review's "written" date — so read back the value that was actually stored rather than letting
  // the client guess or keep displaying the previous one. Only for writes that touched the row:
  // a status-only PATCH leaves the rating untouched and has nothing to report.
  const reviewUpdatedAt = writesRating
    ? ((
        await db
          .prepare(
            "SELECT updated_at FROM work_ratings WHERE user_id = ? AND work_id = ?",
          )
          .bind(userId, workId!)
          .first<{ updated_at: string }>()
      )?.updated_at ?? null)
    : undefined;

  return c.json({
    id: Number(scanId),
    // The client fans a rating/review change out across every owned edition of this work, so it
    // needs the work id from the server rather than trusting its own possibly-stale copy.
    work_id: book.work_id,
    ...(hasStatus ? { status: body.status } : {}),
    ...(hasOwningStatus ? { owning_status: body.owning_status } : {}),
    ...(hasRating ? { rating: body.rating ?? null } : {}),
    ...(hasReview ? { review: resolvedReview ?? null } : {}),
    ...(writesRating ? { review_updated_at: reviewUpdatedAt } : {}),
  });
});

// Switch a scan to a different edition (ISBN) of the same work. Reading status and custom
// field values follow the scan to the new edition; per-user metadata overrides are dropped
// (they corrected the old edition's metadata and don't necessarily apply to the new one).
scans.patch("/:id/edition", async (c) => {
  const userId = c.get("userId");
  const scanId = c.req.param("id");
  const db = c.env.DB;
  const locale = c.req.query("locale") ?? "en";
  const body = await readJsonBody<{ isbn: string }>(c);
  if (!body) return c.json(INVALID_JSON_BODY, 400);
  if (typeof body.isbn !== "string" || !body.isbn)
    return c.json({ error: "ISBN is required" }, 400);
  const isbn = normalizeIsbn(body.isbn);
  if (!isValidIsbn(isbn)) return c.json({ error: "Invalid ISBN" }, 400);

  const scan = await db
    .prepare("SELECT book_id FROM scans WHERE id = ? AND user_id = ?")
    .bind(scanId, userId)
    .first<{ book_id: number }>();
  if (!scan) return c.json({ error: "Book not found" }, 404);

  const currentBook = await db
    .prepare("SELECT work_id, isbn FROM books WHERE id = ?")
    .bind(scan.book_id)
    .first<{ work_id: number | null; isbn: string }>();
  if (!currentBook?.work_id)
    return c.json({ error: "This book has no known editions" }, 400);
  const workId = currentBook.work_id;

  // The scan's current row, returned untouched. Used both for the trivial "same ISBN" case and
  // for a request that only *resolves* to the current book (see the self-switch guard below) —
  // in each the correct answer is the state the caller already has, with nothing written.
  const respondUnchanged = async () => {
    const unchanged = await db
      .prepare(`${buildScanSelect(locale)} WHERE s.id = ?`)
      .bind(scanId)
      .first<any>();
    const { defs, valuesByBook } = await fetchCustomFields(
      db,
      userId,
      unchanged ? [unchanged.book_id] : [],
    );
    return c.json(
      unchanged ? attachCustomFields(unchanged, defs, valuesByBook) : {},
    );
  };

  if (isbn === currentBook.isbn) return respondUnchanged();

  // Validate the target ISBN actually belongs to this work (either already materialized,
  // or a candidate discovered via OpenLibrary) — prevents repointing to an arbitrary book.
  const isKnownEdition = await db
    .prepare(
      `
    SELECT 1 FROM books WHERE isbn = ? AND work_id = ?
    UNION SELECT 1 FROM work_edition_isbns WHERE isbn = ? AND work_id = ?`,
    )
    .bind(isbn, workId, isbn, workId)
    .first();
  if (!isKnownEdition)
    return c.json({ error: "ISBN is not a known edition of this book" }, 400);

  const targetBook = await materializeEdition(
    db,
    isbn,
    workId,
    c.env.GOOGLE_BOOKS_API_KEY,
  );
  if (!targetBook)
    return c.json({ error: "Failed to resolve target edition" }, 500);

  // Self-switch guard. The `isbn === currentBook.isbn` short-circuit above compares exact strings,
  // but `materializeEdition` matches on both ISBN forms — so a request naming the 10/13 counterpart
  // of the scan's *current* ISBN (a legacy `work_edition_isbns` candidate written before the
  // dedupe was form-aware) resolves right back to the book the scan is already on. Without this,
  // the batch below deletes that book's custom-field values and its overrides and the following
  // UPDATE moves nothing back — silent data loss, answered 200. `alreadyOwned` can't catch it: it
  // deliberately excludes this scan.
  if (targetBook.id === scan.book_id) return respondUnchanged();

  // The target must belong to *this* work. `materializeEdition` takes `workId` only to link a row
  // that has none — a row with a non-null but different `work_id` is returned as-is, and matching
  // on both ISBN forms made that reachable from the editions carousel (a candidate of this work
  // whose counterpart form is materialized under a duplicate/translated work). Repointing there
  // would move the scan out of its work, and since rating and review are keyed per work, the
  // user's rating would silently stop showing with no error.
  if (targetBook.work_id !== workId)
    return c.json({ error: "ISBN is not a known edition of this book" }, 400);

  const alreadyOwned = await db
    .prepare(
      "SELECT id FROM scans WHERE user_id = ? AND book_id = ? AND id != ?",
    )
    .bind(userId, targetBook.id, scanId)
    .first();
  if (alreadyOwned)
    return c.json(
      { error: "You already have this edition in your library" },
      409,
    );

  try {
    await db.batch([
      db
        .prepare("UPDATE scans SET book_id = ? WHERE id = ? AND user_id = ?")
        .bind(targetBook.id, scanId, userId),
      // Clear the target's own custom-field rows before moving the scan's across.
      // `PATCH /api/books/custom-fields` needs no scan, so the user can already hold values on
      // the target book; without this the move violates UNIQUE (user_id, book_id, field_def_id)
      // and the whole batch throws an opaque 500 with the switch rolled back. Merge rule: the
      // values follow the scan and win, matching the documented "custom field values follow the
      // scan" behaviour — the target's rows are orphans of a book the user has no scan of.
      db
        .prepare(
          "DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?",
        )
        .bind(userId, targetBook.id),
      db
        .prepare(
          "UPDATE book_custom_fields SET book_id = ? WHERE user_id = ? AND book_id = ?",
        )
        .bind(targetBook.id, userId, scan.book_id),
      db
        .prepare("DELETE FROM book_overrides WHERE user_id = ? AND book_id = ?")
        .bind(userId, scan.book_id),
    ]);
  } catch (e) {
    // The alreadyOwned SELECT above is check-then-act: a concurrent scan of the target edition
    // lands between it and this UPDATE and trips UNIQUE (user_id, book_id). Same answer as the
    // check itself gives, rather than a 500.
    if (isUniqueConstraintError(e))
      return c.json(
        { error: "You already have this edition in your library" },
        409,
      );
    throw e;
  }

  const updated = await db
    .prepare(`${buildScanSelect(locale)} WHERE s.id = ?`)
    .bind(scanId)
    .first<any>();
  const { defs, valuesByBook } = await fetchCustomFields(
    db,
    userId,
    updated ? [updated.book_id] : [],
  );
  return c.json(updated ? attachCustomFields(updated, defs, valuesByBook) : {});
});

scans.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const scanId = c.req.param("id");

  const scan = await c.env.DB.prepare(
    "SELECT book_id FROM scans WHERE id = ? AND user_id = ?",
  )
    .bind(scanId, userId)
    .first<{ book_id: number }>();

  if (!scan) return c.json({ error: "Book not found" }, 404);

  // work_ratings is deliberately NOT cleaned up here: the user's rating and review of a work
  // outlive their copy of it, so removing a book and re-adding it later restores both. The row
  // dies with the user, via work_ratings' ON DELETE CASCADE on user_id.
  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM book_overrides WHERE user_id = ? AND book_id = ?",
    ).bind(userId, scan.book_id),
    c.env.DB.prepare(
      "DELETE FROM book_custom_fields WHERE user_id = ? AND book_id = ?",
    ).bind(userId, scan.book_id),
    c.env.DB.prepare("DELETE FROM scans WHERE id = ? AND user_id = ?").bind(
      scanId,
      userId,
    ),
  ]);

  return c.json({ message: "Scan deleted" });
});

export default scans;
