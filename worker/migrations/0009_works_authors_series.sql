-- FRBR-style model: works group editions (books), series group works.
-- match_key = normalized "title|author" for synchronous same-language dedup;
-- wikidata_qid enables cross-language merge during async enrichment.
CREATE TABLE works (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key         TEXT UNIQUE,                 -- normalized title|primary-author
  wikidata_qid      TEXT UNIQUE,                 -- nullable until enriched
  canonical_title   TEXT,
  original_language TEXT,
  series_checked_at TEXT                         -- negative cache; NULL = not yet enriched
);

-- Editions (books) point at a work (nullable until resolved).
ALTER TABLE books ADD COLUMN work_id INTEGER REFERENCES works(id);
CREATE INDEX idx_books_work ON books(work_id);

-- Author is no longer user-overridable: drop the column from per-user overrides.
ALTER TABLE book_overrides DROP COLUMN author;

-- Normalized authors (analytics foundation; display still reads books.author).
CREATE TABLE authors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_name TEXT UNIQUE,                   -- dedup key (lowercased/trimmed)
  name            TEXT,                          -- display form
  wikidata_qid    TEXT UNIQUE
);

CREATE TABLE work_authors (
  work_id   INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, author_id)
);

CREATE TABLE series (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  wikidata_qid   TEXT UNIQUE,
  canonical_name TEXT                            -- English/fallback display name
);

CREATE TABLE series_names (
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  language  TEXT NOT NULL,
  name      TEXT NOT NULL,
  PRIMARY KEY (series_id, language)
);

CREATE TABLE work_series (
  work_id   INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  ordinal   REAL,                                -- decimal supports 5.5 interludes
  PRIMARY KEY (work_id, series_id)
);
CREATE INDEX idx_work_series_series ON work_series(series_id);
