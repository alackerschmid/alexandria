import { Hono } from "hono";
import type { Env } from "../types";
import { authMiddleware } from "../auth";
import { resolveEdition, materializeEdition } from "../editions";
import { enrichWork } from "../enrichment";
import {
  SORT_CLAUSES,
  buildScanSelect,
  fetchCustomFields,
  attachCustomFields,
  VALID_STATUSES,
  VALID_OWNING_STATUSES,
  isValidRating,
  getBookByIsbn,
  parseIntOr,
} from "../library-query";
import { rateLimitOrReject } from "../rate-limit";
import { normalizeIsbn, isValidIsbn, isIsbnFormat } from "../isbn";

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
  const orderClause =
    SORT_CLAUSES[c.req.query("sort") ?? ""] ?? SORT_CLAUSES.date_desc;

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

scans.post("/", async (c) => {
  const body = await c.req.json<{
    isbn: string;
    status?: string;
    owning_status?: string;
    rating?: number | null;
  }>();
  if (!body.isbn) return c.json({ error: "ISBN is required" }, 400);
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
  // Rating only makes sense for a book marked "read" — silently drop it otherwise, mirroring
  // the silent status/owning_status fallback above rather than hard-rejecting the whole scan.
  const initialRating = initialStatus === "read" ? (body.rating ?? null) : null;

  const userId = c.get("userId");
  const db = c.env.DB;
  const locale = c.req.query("locale") ?? "en";

  // Check for an existing scan of this ISBN before consuming rate-limit quota or touching
  // external metadata APIs — a duplicate scan is a cheap, common case (e.g. rescanning a shelf)
  // and shouldn't cost the user part of their scan-rate budget.
  const existingBook = await getBookByIsbn(db, isbn);
  if (existingBook) {
    const dup = await db
      .prepare("SELECT 1 FROM scans WHERE user_id = ? AND book_id = ?")
      .bind(userId, existingBook.id)
      .first();
    if (dup) return c.json({ error: "Already in your list" }, 409);
  }

  const blocked = await rateLimitOrReject(
    c,
    `scan:${userId}`,
    SCAN_RATE_LIMIT,
    1,
    "Too many scans — please slow down",
  );
  if (blocked) return blocked;

  // allowEmpty: a drained offline-queue scan must succeed even if the book can't be resolved.
  const book = await resolveEdition(db, isbn, c.env.GOOGLE_BOOKS_API_KEY, true);
  if (!book) {
    console.error("[POST /api/scans] book resolution failed, isbn:", isbn);
    return c.json({ error: "Failed to resolve book entry" }, 500);
  }

  let result;
  try {
    result = await db
      .prepare(
        "INSERT INTO scans (user_id, book_id, status, owning_status, rating) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(userId, book.id, initialStatus, initialOwningStatus, initialRating)
      .run();
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint failed")) {
      return c.json({ error: "Already in your list" }, 409);
    }
    console.error("[POST /api/scans] scan INSERT failed:", e);
    return c.json({ error: "Failed to save scan" }, 500);
  }

  if (book.work_id)
    c.executionCtx.waitUntil(
      enrichWork(db, book.work_id, false, c.env.GOOGLE_BOOKS_API_KEY, "scan"),
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

scans.patch("/:id", async (c) => {
  const rawBody = await c.req.json();
  if (typeof rawBody !== "object" || rawBody === null) {
    return c.json({ error: "status or owning_status is required" }, 400);
  }
  const body = rawBody as {
    status?: string;
    owning_status?: string;
    rating?: number | null;
  };
  const hasStatus = "status" in body;
  const hasOwningStatus = "owning_status" in body;
  const hasRating = "rating" in body;

  if (!hasStatus && !hasOwningStatus && !hasRating) {
    return c.json(
      { error: "status, owning_status, or rating is required" },
      400,
    );
  }
  if (
    hasStatus &&
    !(VALID_STATUSES as readonly string[]).includes(body.status ?? "")
  ) {
    return c.json(
      { error: "status must be one of: unread, reading, read, dnf" },
      400,
    );
  }
  if (
    hasOwningStatus &&
    !(VALID_OWNING_STATUSES as readonly string[]).includes(
      body.owning_status ?? "",
    )
  ) {
    return c.json(
      {
        error: "owning_status must be one of: owned, unowned, want, lent_out",
      },
      400,
    );
  }
  if (hasRating && body.rating !== null && !isValidRating(body.rating)) {
    return c.json({ error: "rating must be an integer 0-10 or null" }, 400);
  }

  const userId = c.get("userId");
  const scanId = c.req.param("id");

  // Rating only makes sense for a book marked "read" — enforce that invariant here so it
  // holds regardless of caller (frontend gates the rating UI on status==='read', but a
  // direct API call must not be able to leave a rating on a non-read scan).
  if (hasRating && body.rating != null) {
    const effectiveStatus = hasStatus
      ? body.status
      : (
          await c.env.DB.prepare(
            "SELECT status FROM scans WHERE id = ? AND user_id = ?",
          )
            .bind(scanId, userId)
            .first<{ status: string }>()
        )?.status;
    if (effectiveStatus !== "read") {
      return c.json(
        { error: "rating can only be set on a book marked as read" },
        400,
      );
    }
  }

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];
  if (hasStatus) {
    sets.push("status = ?");
    binds.push(body.status!);
  }
  if (hasOwningStatus) {
    sets.push("owning_status = ?");
    binds.push(body.owning_status!);
  }
  const clearsRatingOnStatusChange = !hasRating && hasStatus && body.status !== "read";
  if (hasRating) {
    sets.push("rating = ?");
    binds.push(body.rating ?? null);
  } else if (clearsRatingOnStatusChange) {
    // Moving off "read" without an explicit rating change clears any existing rating —
    // otherwise a book no longer marked read could still surface under "group by rating".
    sets.push("rating = ?");
    binds.push(null);
  }

  const result = await c.env.DB.prepare(
    `UPDATE scans SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  )
    .bind(...binds, scanId, userId)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: "Book not found" }, 404);
  }

  return c.json({
    id: Number(scanId),
    ...(hasStatus ? { status: body.status } : {}),
    ...(hasOwningStatus ? { owning_status: body.owning_status } : {}),
    ...(hasRating || clearsRatingOnStatusChange ? { rating: body.rating ?? null } : {}),
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
  const body = await c.req.json<{ isbn: string }>();
  if (!body.isbn) return c.json({ error: "ISBN is required" }, 400);
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

  if (isbn === currentBook.isbn) {
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
  }

  // Validate the target ISBN actually belongs to this work (either already materialized,
  // or a candidate discovered via LibraryThing) — prevents repointing to an arbitrary book.
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

  await db.batch([
    db
      .prepare("UPDATE scans SET book_id = ? WHERE id = ? AND user_id = ?")
      .bind(targetBook.id, scanId, userId),
    db
      .prepare(
        "UPDATE book_custom_fields SET book_id = ? WHERE user_id = ? AND book_id = ?",
      )
      .bind(targetBook.id, userId, scan.book_id),
    db
      .prepare("DELETE FROM book_overrides WHERE user_id = ? AND book_id = ?")
      .bind(userId, scan.book_id),
  ]);

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
