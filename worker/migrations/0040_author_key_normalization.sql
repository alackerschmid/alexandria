-- Author identity keys (authors.normalized_name and the author half of works.match_key) now drop
-- trailing parenthetical qualifiers, periods, and whitespace, so "J. R. R. Tolkien" and
-- "J.R.R. Tolkien" resolve to one author and one work instead of two. See normalizeAuthorKey in
-- worker/src/editions.ts — the expression below must stay in sync with it.
--
-- Both columns are UNIQUE, so rows that collapse onto the same key have to be merged before the
-- keys are rewritten, or the UPDATE fails on a constraint. Helper tables (not TEMP — D1 may run
-- each statement on a separate connection) hold the computed keys and the chosen survivors.

CREATE TABLE _author_key (id INTEGER PRIMARY KEY, new_key TEXT);
INSERT INTO _author_key (id, new_key)
SELECT id,
       -- instr(...) > 1 (not > 0): a name that's *entirely* a parenthetical fragment (a garbage
       -- row left by the pre-fix splitAuthors, e.g. "(various)") has '(' as its first character.
       -- Truncating there would give every such fragment the same empty key and merge them all
       -- together; keeping the parens instead lets "(various)" and "(anonymous)" key apart.
       replace(replace(
         trim(CASE WHEN instr(normalized_name, '(') > 1
                   THEN substr(normalized_name, 1, instr(normalized_name, '(') - 1)
                   ELSE normalized_name END),
       '.', ''), ' ', '')
FROM authors;

-- Survivor per key: prefer a row that already carries a wikidata_qid (enrichment has identified
-- it, and authors.wikidata_qid is itself UNIQUE), otherwise the lowest id.
CREATE TABLE _author_survivor (new_key TEXT PRIMARY KEY, survivor_id INTEGER, survivor_qid TEXT);
INSERT INTO _author_survivor (new_key, survivor_id, survivor_qid)
SELECT k.new_key,
       (SELECT a.id FROM authors a
          JOIN _author_key k2 ON k2.id = a.id
         WHERE k2.new_key = k.new_key
         ORDER BY (a.wikidata_qid IS NULL), a.id
         LIMIT 1),
       (SELECT a.wikidata_qid FROM authors a
          JOIN _author_key k2 ON k2.id = a.id
         WHERE k2.new_key = k.new_key
         ORDER BY (a.wikidata_qid IS NULL), a.id
         LIMIT 1)
FROM _author_key k
GROUP BY k.new_key;

-- A non-survivor row that already carries its OWN wikidata_qid, distinct from the survivor's, is
-- not a true formatting duplicate — Wikidata resolved the same normalized name to two different
-- people, which this migration isn't in a position to adjudicate. Leave it as a separate row
-- (disambiguated key below) instead of silently merging away its QID link.
CREATE TABLE _author_conflict (id INTEGER PRIMARY KEY);
INSERT INTO _author_conflict (id)
SELECT a.id FROM authors a
  JOIN _author_key k ON k.id = a.id
  JOIN _author_survivor s ON s.new_key = k.new_key
 WHERE a.id != s.survivor_id
   AND a.wikidata_qid IS NOT NULL
   AND a.wikidata_qid != s.survivor_qid;

-- Repoint work_authors off the losing rows. OR IGNORE covers the case where the survivor is
-- already credited on that work: the losing row is left in place and removed by the ON DELETE
-- CASCADE below.
UPDATE OR IGNORE work_authors
   SET author_id = (SELECT s.survivor_id
                      FROM _author_survivor s
                      JOIN _author_key k ON k.new_key = s.new_key
                     WHERE k.id = work_authors.author_id)
 WHERE author_id NOT IN (SELECT survivor_id FROM _author_survivor)
   AND author_id NOT IN (SELECT id FROM _author_conflict);

DELETE FROM authors
 WHERE id NOT IN (SELECT survivor_id FROM _author_survivor)
   AND id NOT IN (SELECT id FROM _author_conflict);

UPDATE authors
   SET normalized_name = (SELECT new_key FROM _author_key WHERE _author_key.id = authors.id)
 WHERE id NOT IN (SELECT id FROM _author_conflict);

-- Conflicting rows keep their own row and QID, but still need a key distinct from the survivor's
-- to satisfy the UNIQUE constraint.
UPDATE authors
   SET normalized_name = (SELECT new_key FROM _author_key WHERE _author_key.id = authors.id) || '#' || authors.id
 WHERE id IN (SELECT id FROM _author_conflict);

-- ── works.match_key ─────────────────────────────────────────────────────────────────────────
-- Only the author half (after the '|') is rewritten; the title half is untouched.

CREATE TABLE _work_key (id INTEGER PRIMARY KEY, new_key TEXT);
INSERT INTO _work_key (id, new_key)
SELECT id,
       -- Same instr(...) > 1 reasoning as the authors half above.
       substr(match_key, 1, instr(match_key, '|'))
       || replace(replace(
            trim(CASE WHEN instr(substr(match_key, instr(match_key, '|') + 1), '(') > 1
                      THEN substr(substr(match_key, instr(match_key, '|') + 1), 1,
                                  instr(substr(match_key, instr(match_key, '|') + 1), '(') - 1)
                      ELSE substr(match_key, instr(match_key, '|') + 1) END),
          '.', ''), ' ', '')
FROM works
WHERE match_key IS NOT NULL AND instr(match_key, '|') > 0;

-- Survivor per key: prefer the row that already has a wikidata_qid so enrichment state and series
-- links are preserved, otherwise the lowest id. Mirrors mergeWorks in worker/src/enrichment.ts.
CREATE TABLE _work_survivor (new_key TEXT PRIMARY KEY, survivor_id INTEGER, survivor_qid TEXT);
INSERT INTO _work_survivor (new_key, survivor_id, survivor_qid)
SELECT k.new_key,
       (SELECT w.id FROM works w
          JOIN _work_key k2 ON k2.id = w.id
         WHERE k2.new_key = k.new_key
         ORDER BY (w.wikidata_qid IS NULL), w.id
         LIMIT 1),
       (SELECT w.wikidata_qid FROM works w
          JOIN _work_key k2 ON k2.id = w.id
         WHERE k2.new_key = k.new_key
         ORDER BY (w.wikidata_qid IS NULL), w.id
         LIMIT 1)
FROM _work_key k
GROUP BY k.new_key;

-- Same reasoning as _author_conflict: a non-survivor work that already carries its own distinct
-- wikidata_qid isn't a real duplicate of the survivor. Leave it separate.
CREATE TABLE _work_conflict (id INTEGER PRIMARY KEY);
INSERT INTO _work_conflict (id)
SELECT w.id FROM works w
  JOIN _work_key k ON k.id = w.id
  JOIN _work_survivor s ON s.new_key = k.new_key
 WHERE w.id != s.survivor_id
   AND w.wikidata_qid IS NOT NULL
   AND w.wikidata_qid != s.survivor_qid;

-- books.work_id is REFERENCES works(id) with no ON DELETE clause, so books must be repointed
-- before the losing works are deleted or the DELETE fails the foreign key check.
UPDATE books
   SET work_id = (SELECT s.survivor_id
                    FROM _work_survivor s
                    JOIN _work_key k ON k.new_key = s.new_key
                   WHERE k.id = books.work_id)
 WHERE work_id IN (SELECT id FROM _work_key)
   AND work_id NOT IN (SELECT survivor_id FROM _work_survivor)
   AND work_id NOT IN (SELECT id FROM _work_conflict);

UPDATE OR IGNORE work_authors
   SET work_id = (SELECT s.survivor_id
                    FROM _work_survivor s
                    JOIN _work_key k ON k.new_key = s.new_key
                   WHERE k.id = work_authors.work_id)
 WHERE work_id IN (SELECT id FROM _work_key)
   AND work_id NOT IN (SELECT survivor_id FROM _work_survivor)
   AND work_id NOT IN (SELECT id FROM _work_conflict);

UPDATE OR IGNORE work_series
   SET work_id = (SELECT s.survivor_id
                    FROM _work_survivor s
                    JOIN _work_key k ON k.new_key = s.new_key
                   WHERE k.id = work_series.work_id)
 WHERE work_id IN (SELECT id FROM _work_key)
   AND work_id NOT IN (SELECT survivor_id FROM _work_survivor)
   AND work_id NOT IN (SELECT id FROM _work_conflict);

-- work_edition_isbns is FK'd ON DELETE CASCADE (migration 0018): without repointing it here, any
-- discovered candidate ISBNs recorded for a losing work would be silently dropped by the DELETE
-- below instead of merged onto the survivor.
UPDATE OR IGNORE work_edition_isbns
   SET work_id = (SELECT s.survivor_id
                    FROM _work_survivor s
                    JOIN _work_key k ON k.new_key = s.new_key
                   WHERE k.id = work_edition_isbns.work_id)
 WHERE work_id IN (SELECT id FROM _work_key)
   AND work_id NOT IN (SELECT survivor_id FROM _work_survivor)
   AND work_id NOT IN (SELECT id FROM _work_conflict);

DELETE FROM works
 WHERE id IN (SELECT id FROM _work_key)
   AND id NOT IN (SELECT survivor_id FROM _work_survivor)
   AND id NOT IN (SELECT id FROM _work_conflict);

UPDATE works
   SET match_key = (SELECT new_key FROM _work_key WHERE _work_key.id = works.id)
 WHERE id IN (SELECT id FROM _work_key)
   AND id NOT IN (SELECT id FROM _work_conflict);

-- Conflicting works keep their own row and QID, but still need a key distinct from the survivor's.
UPDATE works
   SET match_key = (SELECT new_key FROM _work_key WHERE _work_key.id = works.id) || '#' || works.id
 WHERE id IN (SELECT id FROM _work_key)
   AND id IN (SELECT id FROM _work_conflict);

DROP TABLE _author_key;
DROP TABLE _author_survivor;
DROP TABLE _author_conflict;
DROP TABLE _work_key;
DROP TABLE _work_survivor;
DROP TABLE _work_conflict;
