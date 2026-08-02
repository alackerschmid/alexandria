-- Admin flag. Set manually for the owner's account (no UI/endpoint):
--   wrangler d1 execute bookscan --remote --command "UPDATE users SET is_admin = 1 WHERE email = '...'"
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

-- Global hourly counters for outbound external-API calls (written by src/usage.ts). One row per
-- UTC hour per provider+operation, incremented via UPSERT, best-effort. No user_id dimension by
-- design: the Google Books daily quota is a global resource. Pruned by the cron sweeper after
-- USAGE_RETENTION_DAYS. No extra index — the PK's leftmost column serves both the range reads
-- and the prune.
CREATE TABLE api_usage (
  hour_start   INTEGER NOT NULL, -- ms-epoch UTC hour bucket: floor(now / 3600000) * 3600000
  provider     TEXT NOT NULL,    -- 'google_books' | 'openlibrary' | 'wikidata'
  operation    TEXT NOT NULL,    -- provider-specific, see usage.ts
  success      INTEGER NOT NULL DEFAULT 0,
  error        INTEGER NOT NULL DEFAULT 0, -- non-429 failure: http error, timeout, network
  rate_limited INTEGER NOT NULL DEFAULT 0, -- HTTP 429
  PRIMARY KEY (hour_start, provider, operation)
);
