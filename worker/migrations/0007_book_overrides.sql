CREATE TABLE book_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT,
  author TEXT,
  cover_url TEXT,
  language TEXT,
  publish_date TEXT,
  number_of_pages_median INTEGER,
  description TEXT,
  publisher TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, book_id)
);
