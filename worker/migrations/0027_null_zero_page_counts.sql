-- Google Books returns pageCount 0 when the page count is unknown; these were stored
-- as literal 0 instead of NULL, blocking COALESCE-based refresh fills and skewing stats.
UPDATE books SET number_of_pages_median = NULL WHERE number_of_pages_median = 0;
