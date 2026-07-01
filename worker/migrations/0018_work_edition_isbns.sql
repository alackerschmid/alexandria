-- Candidate ISBNs discovered for a work (e.g. via LibraryThing thingISBN), decoupled
-- from full metadata. A row here means "this ISBN is an edition of this work". title/
-- language/cover_url are lightweight display metadata from a single batched OpenLibrary
-- lookup at discovery time (nullable — some ISBNs have no OpenLibrary record). The full
-- `books` row is only materialized on demand when the user switches to this edition.
CREATE TABLE work_edition_isbns (
  work_id    INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  isbn       TEXT NOT NULL,
  title      TEXT,
  language   TEXT,
  cover_url  TEXT,
  source     TEXT NOT NULL DEFAULT 'librarything',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (work_id, isbn)
);

-- Negative cache: non-NULL means thingISBN was already queried for this work; skip re-fetch.
ALTER TABLE works ADD COLUMN librarything_checked_at TEXT;
