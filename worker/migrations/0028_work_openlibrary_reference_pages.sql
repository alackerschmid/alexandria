-- OpenLibrary work id from Wikidata (P648, "OL…W") — lets edition discovery work even when the
-- owned edition's ISBN is unknown to OpenLibrary (the seed-ISBN path 404s in that case).
ALTER TABLE works ADD COLUMN openlibrary_work_id TEXT;

-- Page count of the work's Wikidata reference edition (P747 → P1104). Display-only fallback for
-- editions whose own page count is unknown; never mixed into books.number_of_pages_median.
ALTER TABLE works ADD COLUMN reference_page_count INTEGER;
