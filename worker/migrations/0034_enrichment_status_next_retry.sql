-- Replace the implicit enrichment state machine (derived from series_checked_at /
-- enrichment_failed_at at read time) with an explicit status column, and move retry
-- scheduling from sweeper-side SQL to a next_retry_at computed in code at failure time.
-- series_checked_at and enrichment_failed_at remain as informational timestamps only.
ALTER TABLE works ADD COLUMN enrichment_status TEXT NOT NULL DEFAULT 'pending';
-- When a 'failed'/'exhausted' work is next due for a sweeper retry. NULL = due immediately.
ALTER TABLE works ADD COLUMN next_retry_at TEXT;

-- Backfill from the old implicit state.
UPDATE works SET enrichment_status = CASE
  WHEN enrichment_failed_at IS NOT NULL THEN 'failed'
  WHEN series_checked_at    IS NOT NULL THEN 'done'
  ELSE 'pending' END;
-- next_retry_at stays NULL for backfilled failed rows = due on the next tick. Rows that had
-- exhausted their retry cap will re-fail once and be reclassified 'exhausted' by the new
-- write-time scheduling (self-healing; no need to replicate per-reason cap CASEs here).

DROP INDEX IF EXISTS idx_works_unenriched;       -- from 0017, keyed on series_checked_at
DROP INDEX IF EXISTS idx_works_retry;            -- from 0023, keyed on enrichment_failed_at
DROP INDEX IF EXISTS idx_works_schema_backfill;  -- from 0033, keyed on series_checked_at

-- Sweeper Q1 (backlog + due retries): everything not done, filtered by due time.
CREATE INDEX IF NOT EXISTS idx_works_enrichment_due
  ON works(next_retry_at)
  WHERE enrichment_status != 'done';

-- Sweeper Q2 (schema backfill): range scan on enrichment_schema_version over done works.
CREATE INDEX IF NOT EXISTS idx_works_schema_backfill
  ON works(enrichment_schema_version)
  WHERE enrichment_status = 'done';
