-- Preserves author display order per work (Google Books/OpenLibrary return authors in credited
-- order). Legacy rows (linked before this column existed) all tie at 0 -- no attempt to recover
-- original order via fragile string-splitting; author_id is the tiebreaker until re-linked.
ALTER TABLE work_authors ADD COLUMN ordinal INTEGER;
UPDATE work_authors SET ordinal = 0 WHERE ordinal IS NULL;
CREATE INDEX idx_work_authors_ordinal ON work_authors(work_id, ordinal);
