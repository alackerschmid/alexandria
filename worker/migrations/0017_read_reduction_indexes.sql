-- Cut D1 rows-read by replacing full table scans on hot paths with index lookups.

-- Sweeper branch A (never-enriched / retry): matches only the live backlog, 0 rows when idle.
CREATE INDEX IF NOT EXISTS idx_works_unenriched
  ON works(id)
  WHERE series_checked_at IS NULL;

-- Sweeper branch B (schema backfill): range scan on enrichment_schema_version < CURRENT,
-- 0 rows once every enriched work is at the current version.
CREATE INDEX IF NOT EXISTS idx_works_schema_backfill
  ON works(enrichment_schema_version)
  WHERE series_checked_at IS NOT NULL AND enrichment_failed_at IS NULL;

-- Supports the GROUP BY work_id subquery in SCAN_SELECT and the b.work_id joins in catalog routes.
CREATE INDEX IF NOT EXISTS idx_work_series_work
  ON work_series(work_id);
