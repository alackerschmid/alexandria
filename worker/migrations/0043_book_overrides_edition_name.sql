-- Per-user override for the edition name ("50th Anniversary Edition", "Book Club Edition").
-- OpenLibrary populates it rarely, and it is one of the few edition facts the owner of the copy
-- knows better than the catalogue does.
ALTER TABLE book_overrides ADD COLUMN edition_name TEXT;
