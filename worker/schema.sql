PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, firstname TEXT);
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  isbn TEXT UNIQUE NOT NULL,
  title TEXT,
  author TEXT,
  cover_url TEXT,
  language TEXT,
  publish_date TEXT,
  number_of_pages_median INTEGER,
  fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
, description TEXT, publisher TEXT, work_id INTEGER REFERENCES works(id), physical_format TEXT, edition_name TEXT, physical_dimensions TEXT);
CREATE TABLE IF NOT EXISTS "scans" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
CREATE TABLE book_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT,
  cover_url TEXT,
  language TEXT,
  publish_date TEXT,
  number_of_pages_median INTEGER,
  description TEXT,
  publisher TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, book_id)
);
CREATE TABLE user_field_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_name   TEXT NOT NULL,
  field_type   TEXT NOT NULL DEFAULT 'text',
  field_options TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0, required INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, field_name)
);
CREATE TABLE book_custom_fields (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  field_def_id INTEGER NOT NULL REFERENCES user_field_definitions(id) ON DELETE CASCADE,
  field_value  TEXT,
  UNIQUE(user_id, book_id, field_def_id)
);
CREATE TABLE works (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key         TEXT UNIQUE,                 
  wikidata_qid      TEXT UNIQUE,                 
  canonical_title   TEXT,
  original_language TEXT,
  series_checked_at TEXT                         
, enrichment_failed_at boolean, genres TEXT, original_pub_date TEXT, awards TEXT, nominations TEXT, enrichment_attempts INTEGER NOT NULL DEFAULT 0, main_subject TEXT, form_of_work TEXT, language_of_work TEXT, first_line TEXT, epigraph TEXT, narrative_locations TEXT, countries_of_origin TEXT, enrichment_schema_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE authors (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_name TEXT UNIQUE,                   
  name            TEXT,                          
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
  canonical_name TEXT                            
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
  ordinal   REAL,                                
  PRIMARY KEY (work_id, series_id)
);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_scans_user_id ON scans(user_id);
CREATE UNIQUE INDEX idx_scans_user_book ON scans(user_id, book_id);
CREATE INDEX idx_user_field_defs_user ON user_field_definitions(user_id);
CREATE INDEX idx_book_custom_fields_user_book ON book_custom_fields(user_id, book_id);
CREATE INDEX idx_books_work ON books(work_id);
CREATE INDEX idx_work_series_series ON work_series(series_id);
