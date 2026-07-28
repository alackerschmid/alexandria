---
name: add-api-column
description: Add a new column to the bookscan API response — routes a Wikidata field, a book metadata field, or a custom field to the right procedure and the files each one touches. Use when extending the scan-row shape returned by GET /api/scans, or when a new field needs to reach the frontend.
---

# Add a new column to the API response

Pick the branch that matches the field, then follow only that branch.

1. **Wikidata field** —
   1. add an `ALTER TABLE works ADD COLUMN` in a new migration in `worker/migrations/`
   2. bump `CURRENT_ENRICHMENT_SCHEMA_VERSION` in `worker/src/enrichment.ts` — this is what
      drains every already-enriched work back through the sweeper to pick the column up
   3. add the SPARQL subquery + the `WorkDetails` field + the `UPDATE works SET` binding, all
      in `enrichment.ts`
   4. add it to `buildScanSelect` in `worker/src/library-query.ts`
   5. JSON-parse it in `attachCustomFields` if it's an array
   6. update the `Book` type in `src/types/book.ts`

   Background on how the sweeper's backfill query picks the work up is in the `enrichment`
   rule, which loads when you open `enrichment.ts`.

2. **New book metadata field** —
   1. add an `ALTER TABLE books ADD COLUMN` migration in `worker/migrations/`
   2. add it to `buildScanSelect` in `worker/src/library-query.ts`
   3. update the `Book` type in `src/types/book.ts`

3. **Custom field** — nothing to do here. The existing `user_field_definitions` +
   `book_custom_fields` schema already covers it: no migration, and no `buildScanSelect` change,
   because custom fields don't go through that query at all. `fetchCustomFields` reads them in a
   separate pass (chunked to stay under D1's parameter cap) and `attachCustomFields` merges them
   onto each row in JS as `custom_field_values`. A new field is created by the user at runtime via
   `POST /api/field-definitions`, not by a code change.

Table-by-table schema reference lives in `worker/migrations/CLAUDE.md`.
