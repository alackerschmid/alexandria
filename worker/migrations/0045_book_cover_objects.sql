-- Covers move into R2, so the reader's browser stops fetching them from Google and OpenLibrary.
--
-- Every cover today is an <img> pointing straight at books.google.com or covers.openlibrary.org,
-- which means the *reader* makes that request: their IP, their User-Agent, the referring origin and
-- the volume ids — which are the books — go to Google as one correlated burst per page load, with
-- their Google cookies attached, since books.google.com is a google.com subdomain. The app already
-- takes the opposite position everywhere else (utils/markdown.ts drops images from reviews for this
-- exact reason; the fonts are self-hosted for it too). This column is what lets a cover be served
-- from our own origin instead.
--
-- The R2 key of this book's stored cover, NULL until the sweeper has fetched it. Deliberately NOT a
-- replacement for cover_url: that column stays the provenance record (which upstream image we took,
-- per the measured source ranking in src/cover-url.ts) and the fallback for a book whose object is
-- missing or not written yet. book_overrides.cover_url still wins over both — buildScanSelect
-- suppresses the key when an override exists, so the override cannot be shadowed by a stored object
-- of the cover it was set to replace.
--
-- Key format `<isbn>/<8 hex of the bytes>.<ext>`. The content hash is load-bearing: the serve route
-- sends `Cache-Control: immutable`, so a cover we later replace with a better one has to arrive
-- under a NEW key or every browser that has seen the old bytes keeps them for a year.
--
-- One value is not a key: '-' is the sentinel for "asked, and there is permanently nothing there"
-- (a 404 upstream, or a 200 that wasn't an image). Without it a dead cover URL is re-fetched every
-- two minutes forever, spending a subrequest per tick that enrichment needs. It is deliberately not
-- a second column: nothing else needs to distinguish the states, and `isCoverKey` in src/covers.ts
-- already rejects anything that isn't shaped like a key, so the sentinel falls back to cover_url on
-- the read path for free. A transient failure (5xx, timeout) writes nothing and is simply retried.
ALTER TABLE books ADD COLUMN cover_object_key TEXT;

-- Serves exactly one query — the sweeper's "which books still need localizing" pick. Partial,
-- because the rows it has to find are a shrinking tail that goes empty once the backlog drains,
-- and a full index over `books` would stay the size of the catalogue forever to answer it.
CREATE INDEX idx_books_cover_pending
  ON books(id)
  WHERE cover_object_key IS NULL AND cover_url IS NOT NULL;

-- No backfill statement: NULL on every existing row *is* the starting state the sweeper's fill step
-- consumes, so the ~1,100 books that already have a cover URL drain through it on their own.
