-- The sweeper's owned-first query walks works -> books (idx_books_work) -> scans to find the
-- works a user can actually see a "series lookup pending" badge for. The existing
-- idx_scans_user_book is (user_id, book_id), so a lookup keyed on book_id alone can't use it and
-- falls back to a full scan of scans on every candidate work.
CREATE INDEX IF NOT EXISTS idx_scans_book ON scans(book_id);
