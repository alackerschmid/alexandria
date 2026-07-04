-- ISO 639-1 code (via Wikidata P407 -> P218) for the work's original language, alongside the
-- existing English-label language_of_work. Lets stats.ts compare ISO codes directly instead of
-- fragile English-name matching ("Mandarin Chinese" != "Chinese"). Stats-only; not in SCAN_SELECT.
ALTER TABLE works ADD COLUMN language_of_work_code TEXT;
