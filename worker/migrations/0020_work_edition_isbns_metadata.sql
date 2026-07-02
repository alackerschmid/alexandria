-- Lightweight publisher/publish_date for unmaterialized edition candidates, sourced from
-- the same batched OpenLibrary editions.json lookup that already fills title/language/cover_url.
ALTER TABLE work_edition_isbns ADD COLUMN publish_date TEXT;
ALTER TABLE work_edition_isbns ADD COLUMN publisher TEXT;
