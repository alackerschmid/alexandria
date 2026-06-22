-- Wikidata-sourced work-level metadata from the second enrichment pass.
-- genres / awards / nominations stored as JSON arrays (TEXT); original_pub_date is a 4-digit year string.
ALTER TABLE works ADD COLUMN genres TEXT;
ALTER TABLE works ADD COLUMN original_pub_date TEXT;
ALTER TABLE works ADD COLUMN awards TEXT;
ALTER TABLE works ADD COLUMN nominations TEXT;
