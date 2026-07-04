-- Marks an in-flight enrichWork() run so concurrent invocations (cron sweeper + a manual
-- refresh/lookup racing it) don't duplicate the same SPARQL work. Cleared on completion;
-- a stale claim (crashed run) expires after 2 minutes so a work can't get stuck forever.
ALTER TABLE works ADD COLUMN enrichment_started_at TEXT;
