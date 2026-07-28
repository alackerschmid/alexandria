-- Per-user rating + review move off `scans` (per-user × per-EDITION) onto a per-user × per-WORK
-- join table. `works` is a global shared table (one row per logical work across all users), so
-- per-user data can't be columns on it — hence a join table.
--
-- Storing a rating per edition made "my rating of this book" ambiguous: a user can own two
-- editions of one work (scans is UNIQUE on (user_id, book_id), not on the work), and the
-- collapsed work-card (useEditionGrouping) showed whichever one won pickRepresentativeEdition's
-- status-priority race while the other stayed invisible until the edition carousel was opened.
--
-- NO ON DELETE CASCADE on work_id, deliberately — mirroring books.work_id. mergeWorks()
-- (worker/src/enrichment.ts) ends in `DELETE FROM works WHERE id = <from>`; a cascade there would
-- silently destroy the losing work's ratings. Without one, D1's immediate FK enforcement fails
-- that DELETE and rolls back the whole batch unless work_ratings is repointed first — a loud
-- tripwire instead of silent data loss. Keep that repoint ahead of the DELETE in mergeWorks.
--
-- Rows are per user and outlive the scan: deleting a book from your library keeps your rating and
-- review, so re-adding it restores them. They die only with the user, via the CASCADE below.
CREATE TABLE work_ratings (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  work_id    INTEGER NOT NULL REFERENCES works(id),
  rating     INTEGER CHECK (rating IS NULL OR (rating BETWEEN 0 AND 10)),
  review     TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, work_id)
);

-- (user_id, work_id) lookups ride the PK's implicit index — that's what buildScanSelect's LEFT
-- JOIN keys on. This one serves the work-only scans: the backfill below, and mergeWorks'
-- repoint/DELETE pair, which filter on work_id alone.
CREATE INDEX idx_work_ratings_work ON work_ratings(work_id);

-- ── Backfill ────────────────────────────────────────────────────────────────────────────────
-- One row per (user, work) with at least one rated scan. Where a user owns several rated editions
-- of one work, the winner follows pickRepresentativeEdition's status priority
-- (read > reading > unread > dnf), tie-broken by most recently added — so the surviving value is
-- the one the collapsed work-card was already most likely to be showing.
--
-- Deliberate divergence from pickRepresentativeEdition (src/utils/book-display.ts): candidates
-- are restricted to RATED scans. That function has no rating term and can pick an unrated edition
-- over a rated one; honouring that here would delete a rating the user actually entered once
-- scans.rating is dropped. So a collapsed card may GAIN a rating it wasn't showing — preferred
-- over losing one.
--
-- `review` is NOT backfilled: there has never been a review column on `scans` in production, so
-- there is nothing to move. It starts NULL for everyone.
--
-- Ratings on scans whose book has no work link (books.work_id IS NULL — guest lookups create
-- these; the cron sweeper links 5 per 2-min tick) are skipped: there is no work to hang them on.
INSERT INTO work_ratings (user_id, work_id, rating)
SELECT s.user_id, b.work_id, s.rating
  FROM scans s
  JOIN books b ON b.id = s.book_id
 WHERE s.rating IS NOT NULL
   AND b.work_id IS NOT NULL
   AND s.id = (
     SELECT s2.id
       FROM scans s2
       JOIN books b2 ON b2.id = s2.book_id
      WHERE s2.user_id = s.user_id
        AND b2.work_id = b.work_id
        AND s2.rating IS NOT NULL
      ORDER BY CASE s2.status
                 WHEN 'read'    THEN 3
                 WHEN 'reading' THEN 2
                 WHEN 'unread'  THEN 1
                 ELSE 0                    -- 'dnf', and anything unexpected
               END DESC,
               s2.created_at DESC,
               s2.id DESC
      LIMIT 1
   );
