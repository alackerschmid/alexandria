-- Supports the sweeper's Q1 retry filter/order (WHERE enrichment_failed_at ... ORDER BY
-- enrichment_failed_at IS NOT NULL, id) within the series_checked_at IS NULL backlog, which
-- idx_works_unenriched alone (indexed on id only) doesn't cover.
CREATE INDEX IF NOT EXISTS idx_works_retry
  ON works(enrichment_failed_at)
  WHERE series_checked_at IS NULL;
