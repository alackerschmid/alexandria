-- Track enrichment failures so the UI can distinguish "not yet attempted" from "failed".
-- NULL = not yet failed; non-NULL = timestamp of the last failed enrichWork run.
ALTER TABLE works ADD COLUMN enrichment_failed_at boolean;
