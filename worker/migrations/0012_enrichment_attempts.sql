-- Counts failed enrichWork runs so the background sweeper can cap retries (backoff).
-- Reset to 0 implicitly on success (the work is then negative-cached via series_checked_at
-- and never re-selected by the sweeper).
ALTER TABLE works ADD COLUMN enrichment_attempts INTEGER NOT NULL DEFAULT 0;
