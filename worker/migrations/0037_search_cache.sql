-- D1-backed cache for title search results (see routes/books.ts handleTitleSearch). The Workers
-- edge cache (caches.default) is per-datacenter, so the same search made from two colos is two
-- Google Books calls; this table is global, so a search is only ever repeated once per TTL across
-- the whole deployment, with the edge cache serving as a colo-local L1 in front of it.
-- `query_key` is the same normalized title+author+publisher key already used for the edge cache.
-- `response` is the raw JSON body returned to callers; `expires_at` is ms-epoch so freshness
-- checks and pruning are cheap integer comparisons.
CREATE TABLE search_cache (
  query_key  TEXT PRIMARY KEY,
  response   TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
