-- One row per enrichWork invocation (outside of already-enriched/skip no-ops) — gives a queryable
-- history of enrichment timing and failure reasons, since the pipeline was previously observable
-- only via console logs.
CREATE TABLE enrichment_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id        INTEGER NOT NULL,
  started_at     TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  outcome        TEXT NOT NULL, -- 'done' | 'not_found' | 'failed'
  failure_reason TEXT,          -- set only when outcome = 'failed'
  source         TEXT NOT NULL, -- 'scan' | 'lookup' | 'refresh' | 'sweeper' | 'unknown'
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_enrichment_runs_work ON enrichment_runs(work_id);
CREATE INDEX idx_enrichment_runs_created ON enrichment_runs(created_at);
