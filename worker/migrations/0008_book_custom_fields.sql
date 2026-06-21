-- Field definitions: the user's custom field schema (one row per field they've defined)
CREATE TABLE user_field_definitions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_name   TEXT NOT NULL,
  field_type   TEXT NOT NULL DEFAULT 'text',
  field_options TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, field_name)
);

CREATE INDEX idx_user_field_defs_user ON user_field_definitions(user_id);

-- Field values: per-book values, keyed to a definition
CREATE TABLE book_custom_fields (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  field_def_id INTEGER NOT NULL REFERENCES user_field_definitions(id) ON DELETE CASCADE,
  field_value  TEXT,
  UNIQUE(user_id, book_id, field_def_id)
);

CREATE INDEX idx_book_custom_fields_user_book ON book_custom_fields(user_id, book_id);
