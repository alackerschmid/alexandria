-- Normalise book metadata into its own table so the same ISBN is only looked up once.

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
);

-- Migrate existing book data out of scans (deduplicated by isbn).
INSERT OR IGNORE INTO books (isbn, title, author, cover_url, language, publish_date, number_of_pages_median)
SELECT DISTINCT isbn, title, author, cover_url, language, publish_date, number_of_pages_median
FROM scans;

-- Recreate scans referencing books instead of carrying denormalised book columns.
CREATE TABLE scans_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  book_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id)
);

INSERT INTO scans_new (id, user_id, book_id, status, created_at)
SELECT s.id, s.user_id, b.id, s.status, s.created_at
FROM scans s
JOIN books b ON b.isbn = s.isbn;

DROP TABLE scans;
ALTER TABLE scans_new RENAME TO scans;

CREATE INDEX idx_scans_user_id ON scans(user_id);
CREATE UNIQUE INDEX idx_scans_user_book ON scans(user_id, book_id);
