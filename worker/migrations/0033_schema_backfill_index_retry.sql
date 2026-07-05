-- Q2 (schema backfill) now also retries works whose backfill attempt previously failed, so the
-- old idx_works_schema_backfill (scoped to enrichment_failed_at IS NULL) no longer covers all
-- rows the query can match. Widen it to the query's full base predicate.
DROP INDEX IF EXISTS idx_works_schema_backfill;

CREATE INDEX IF NOT EXISTS idx_works_schema_backfill
  ON works(enrichment_schema_version)
  WHERE series_checked_at IS NOT NULL;
