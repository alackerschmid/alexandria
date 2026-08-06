// One-off repair for works that group editions of *different* books.
//
// Two defects put them there (both fixed in code, but a fix only prevents new ones):
//   1. `linkWork`'s match key was title + first author, and German series volumes are frequently
//      catalogued under the series name — several editions with the same title collapsed into one
//      work. Now guarded for editions with no author (`workMatchKey` in src/editions.ts).
//   2. `fetchBookInfo` accepted the top Wikidata text-search hit unverified, so a sequel, an
//      omnibus/dilogy item or a "novel series" item became the work QID and `mergeWorks` collapsed
//      distinct books onto it. Now verified by label similarity + a series/list type filter.
//
// A merged work means one reading status write, one rating and one summary card for several books.
//
// This script WRITES NOTHING. It prints the plan and emits SQL for review; apply it yourself:
//
//   node scripts/repair-merged-works.mjs                     # plan only
//   node scripts/repair-merged-works.mjs --sql > repair.sql   # emit SQL
//   npx wrangler d1 execute bookscan --remote --file repair.sql
//
// `--work <id>` (repeatable, `--work=<id>` too) narrows both outputs to those entries. Use it for
// anything added after the first application, and only for that.
//
// **Never re-emit an entry that has already been applied.** The SQL is not idempotent, and the
// non-idempotent part is destructive rather than merely repeated:
//
//   - The moved-group pair — `INSERT OR IGNORE INTO works (match_key, …) VALUES (…, 'pending')`
//     then `UPDATE books SET work_id = (SELECT id FROM works WHERE match_key = …)` — is safe only
//     while the work it created still exists. It is created `pending`, so the sweeper enriches it;
//     if it resolves to a QID another row already holds, `mergeWorks` copies its books/ratings/
//     series onto that row and deletes it, **without carrying `match_key` over**. The key is then
//     gone, so a re-run creates a fresh empty `pending` work and repoints those ISBNs off the
//     correctly enriched row onto it, stranding the `work_ratings` row and the series ordinal that
//     mergeWorks moved. Verified against production: of the 2026-07-30 application, the keys for
//     `olympos|dansimmons`, `ilium|dansimmons`, `the monster baru cormorant|sethdickinson` and
//     `der herr des wustenplaneten|frankherbert` no longer exist.
//   - The survivor statements are keyed `WHERE id = <workId>`, so if the sweeper merged that row
//     away they silently match zero rows and the entry half-applies. Work 295 is already gone.
//   - An entry whose `keepQid` is false additionally re-clears enrichment the sweeper has re-run.
//
// The PLAN below is the sign-off surface: each group is one real book, listed by ISBN, derived from
// the production rows as of 2026-07-30 (work 4412 added 2026-08-04). Re-check it before applying if
// the library has moved on — the ISBN→book mapping is only as current as the query it came from.

// Mirrors normalizeStr / normalizeAuthorKey in src/editions.ts — a .mjs can't import the TS, and the
// keys must match what linkWork would compute or the repaired works won't be found again.
const normalizeStr = (s) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeAuthorKey = (s) => {
  // Truncate at the first '(' only when name text precedes it — an entirely-parenthetical name
  // keeps its parens, exactly like the TS original (see its comment on "(various)").
  const normalized = normalizeStr(s);
  const paren = normalized.indexOf("(");
  return (paren > 0 ? normalized.slice(0, paren) : normalized).replace(
    /[.\s]/g,
    "",
  );
};

// workMatchKey keys on the *first* author (`splitAuthors(author)[0]`), so this must too — the PLAN's
// entries are all single names, but a multi-author string here would otherwise produce a key linkWork
// never recomputes, which is exactly the drift this reimplementation risks. Mirrors splitAuthors:
// parenthetical spans excised (by depth), then split on ','.
const firstAuthor = (s) => {
  let stripped = "";
  let depth = 0;
  for (const ch of s ?? "") {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0) stripped += ch;
  }
  return (
    stripped
      .replace(/\s+/g, " ")
      .split(",")
      .map((a) => a.trim())
      .find(Boolean) ?? ""
  );
};

// `title|firstAuthor` when both are known, else the edition stands alone under its own ISBN —
// mirrors workMatchKey in src/editions.ts.
const matchKey = (title, author, isbn) => {
  const t = normalizeStr(title);
  const a = normalizeAuthorKey(firstAuthor(author));
  return `${t && a ? t : `isbn:${isbn}`}|${a}`;
};

// groups[0] stays on the existing work row; every later group moves to a new one.
// keepQid: the QID is genuinely this book's, so enrichment output survives the split.
// perIsbn: the books are indistinguishable by title (all catalogued under the series name), so each
//          edition gets its own ISBN-keyed work rather than a title-keyed one that would re-collide.
const PLAN = [
  {
    workId: 125,
    author: "George R. R. Martin",
    keepQid: true, // Q1751870 "A Game of Thrones" is correct for the English edition below
    note: "4 German volumes all catalogued as the series name; the English AGoT joined via QID",
    groups: [
      { title: "A Game of Thrones", isbns: ["9780553588484"] },
      { title: "Das Lied von Eis und Feuer", isbns: ["9783442268214"], perIsbn: true },
      { title: "Das Lied von Eis und Feuer", isbns: ["9783442268221"], perIsbn: true },
      { title: "Das Lied von Eis und Feuer", isbns: ["9783442268467"], perIsbn: true },
      { title: "Das Lied von Eis und Feuer", isbns: ["9783442268597"], perIsbn: true },
    ],
  },
  {
    workId: 292,
    author: "Seth Dickinson",
    keepQid: true, // Q21934324 is The Traitor, which stays on the surviving row
    note: "the sequel was merged into book one (label similarity 0.720)",
    groups: [
      { title: "The Traitor Baru Cormorant", isbns: ["9780765380722", "9780765380739"] },
      { title: "The Monster Baru Cormorant", isbns: ["9780765380746", "9781466875135"] },
    ],
  },
  {
    workId: 295,
    author: "Dan Simmons",
    keepQid: false, // Q692326 is the *dilogy* item "Ilium/Olympos" — neither book's work
    note: "Wikidata models the duology as one item; the type filter now rejects it",
    groups: [
      { title: "Ilium", isbns: ["9780380817924", "9783453878983"] },
      { title: "Olympos", isbns: ["9780380817931"] },
    ],
  },
  {
    workId: 803,
    author: "Frank Herbert",
    keepQid: true, // Q190192 is Dune, which stays on the surviving row
    note: "Dune Messiah's German title merged into Dune (0.732 against 'Der Wüstenplanet')",
    groups: [
      { title: "Dune - Der Wüstenplanet.", isbns: ["9783453185678"] },
      { title: "Der Herr des Wüstenplaneten", isbns: ["9783641139582"] },
    ],
  },
  {
    workId: 2673,
    keepQid: false, // Q6517323 "Legacy of the Force" is a novel series
    note: "6 distinct volumes, each merged onto the series item",
    groups: [
      { title: "Star wars - Wächter der Macht", author: "Karen Traviss", isbns: ["9783442265978"], perIsbn: true },
      { title: "Star wars - Wächter der Macht", author: null, isbns: ["9783442265985"], perIsbn: true },
      { title: "Star wars - Wächter der Macht", author: "Aaron Allston", isbns: ["9783442266036"], perIsbn: true },
      { title: "Star wars - Wächter der Macht", author: "Karen Traviss", isbns: ["9783442266074"], perIsbn: true },
      { title: "Star wars - Wächter der Macht", author: "Troy Denning", isbns: ["9783442266241"], perIsbn: true },
      { title: "Star wars - Wächter der Macht", author: null, isbns: ["9783442266661"], perIsbn: true },
    ],
  },
  {
    workId: 2890,
    author: "Ian Fleming",
    keepQid: false, // Q151472 is "list of James Bond films" — a Wikimedia list article
    note: "3 different Fleming novels, all catalogued as 'James Bond 007'",
    groups: [
      { title: "James Bond 007", isbns: ["9783864250705"], perIsbn: true },
      { title: "James Bond 007", isbns: ["9783864250729"], perIsbn: true },
      { title: "James Bond 007", isbns: ["9783864250743"], perIsbn: true },
    ],
  },
  {
    workId: 4412,
    author: "Steven Erikson",
    keepQid: false, // Q458982 "Malazan Book of the Fallen" is a novel series, not any one volume
    note:
      "8 German volumes, each merged onto the series item (2026-07-29, the day before the type " +
      "filter shipped). The 2026-08-02 Goodreads import then read the two scans on this work as " +
      "'already in your library' for five volumes that were never imported at all — books 748-752 " +
      "still have no scan. The survivor keeps the QID-free (12) key it was created under, which is " +
      "also the work the user's rating 8 was written against (2026-07-29 13:05, before the merge), " +
      "so that rating lands on the right book without being moved.",
    groups: [
      { title: "Das Spiel der Götter (12)", isbns: ["9783734160936"] },
      { title: "Das Spiel der Götter (6)", isbns: ["9783442264100"] },
      { title: "Das Spiel der Götter (5)", isbns: ["9783442269914"] },
      { title: "Das Spiel der Götter (4)", isbns: ["9783442269907"] },
      { title: "Das Spiel der Götter (9)", isbns: ["9783734160400"] },
      { title: "Das Spiel der Götter (8)", isbns: ["9783734160394"] },
      { title: "Das Spiel der Götter (10)", isbns: ["9783734160486"] },
      // The one volume catalogued under the bare series name carries no ordinal to key on, so a
      // title key here would collect the next such edition the same way this work collected these.
      { title: "Das Spiel der Götter", isbns: ["9783442269099"], perIsbn: true },
    ],
  },
  {
    workId: 3438,
    keepQid: false, // Q2743959 "The New Jedi Order" is a book series
    note: "4 distinct volumes, each merged onto the series item",
    groups: [
      { title: "Star wars - das Erbe der Jedi-Ritter", author: "Troy Denning", isbns: ["9783442243426"], perIsbn: true },
      { title: "Star wars - das Erbe der Jedi-Ritter", author: "Aaron Allston", isbns: ["9783442243778"], perIsbn: true },
      { title: "Star wars - das Erbe der Jedi-Ritter", author: "Matthew Woodring Stover", isbns: ["9783442244089"], perIsbn: true },
      { title: "Star wars - das Erbe der Jedi-Ritter", author: "Robert A. Salvatore", isbns: ["9783442354146"], perIsbn: true },
    ],
  },
];

// Ratings and reviews are per work, so a merged work has one for several books. The import wrote
// these three on 2026-07-30; which book each was meant for is in the CSV, not in the database, so the
// script leaves them on the surviving row and says so rather than guessing.
const RATINGS_TO_REVIEW = [
  { workId: 125, userId: 2, rating: 8 },
  { workId: 292, userId: 2, rating: 8 },
  { workId: 295, userId: 2, rating: 6 },
];

// Everything fetchWorkDetails writes. Cleared when the QID was wrong: those values describe the
// series or the other book, not this one.
const ENRICHED_COLUMNS = [
  "wikidata_qid", "genres", "awards", "nominations", "original_pub_date",
  "main_subject", "form_of_work", "language_of_work", "language_of_work_code",
  "first_line", "epigraph", "subtitle", "narrative_locations", "countries_of_origin",
  "translator", "illustrator", "characters", "openlibrary_work_id",
  "reference_page_count", "editions_checked_at", "series_checked_at",
  "enrichment_failed_at", "enrichment_failure_reason", "next_retry_at",
];

// `--work 4412 --work 292` → only those entries; no flag → the whole PLAN. An unknown id is an
// error rather than an empty run, which would otherwise read as "nothing to repair".
//
// Both spellings are accepted deliberately. `--work=4412` is the natural form for anyone used to
// `=`-style flags, and matching only `--work` left it parsing as zero ids — i.e. silently emitting
// the *whole* PLAN with exit 0, which is indistinguishable from success in the output and is the
// single worst way this flag could fail. Raw strings are validated rather than `Number()`ed,
// because `Number("")` is 0, not NaN.
function selected() {
  const raw = [];
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--work") {
      raw.push(process.argv[++i]);
    } else if (a.startsWith("--work=")) {
      raw.push(a.slice("--work=".length));
    }
  }
  // Both of these throw rather than exiting: a bad --work must not fall through to the whole PLAN,
  // and a throw is a non-zero exit too — which matters, since the shell line after this one pipes
  // into a file the next command applies to production.
  //
  // A `--work` with nothing usable after it is the mistake this flag exists to prevent.
  if (raw.some((s) => !/^\d+$/.test(s ?? ""))) {
    throw new Error("--work needs a numeric work id");
  }
  const ids = raw.map(Number);
  if (ids.length === 0) return PLAN;
  const unknown = ids.filter((id) => !PLAN.some((w) => w.workId === id));
  if (unknown.length) {
    throw new Error(`no PLAN entry for work ${unknown.join(", ")}`);
  }
  return PLAN.filter((w) => ids.includes(w.workId));
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const groupAuthor = (work, group) =>
  group.author !== undefined ? group.author : work.author;
const groupKey = (work, group) => {
  // perIsbn forces the ISBN-keyed form — the same one matchKey falls back to when the title can't
  // be identity, so it isn't a second key shape.
  return matchKey(
    group.perIsbn ? null : group.title,
    groupAuthor(work, group),
    group.isbns[0],
  );
};

function plan() {
  const works = selected();
  const lines = [];
  let newWorks = 0;
  for (const work of works) {
    lines.push(
      `\nwork ${work.workId} — ${work.note}`,
      `  QID: ${work.keepQid ? "kept (correct for the surviving book)" : "CLEARED + requeued for enrichment"}`,
    );
    work.groups.forEach((group, i) => {
      const role = i === 0 ? "stays on work " + work.workId : "NEW work";
      if (i > 0) newWorks++;
      lines.push(
        `  ${role.padEnd(18)} ${JSON.stringify(group.title)} [${group.isbns.join(", ")}]`,
        `  ${"".padEnd(18)} match_key ${q(groupKey(work, group))}${group.perIsbn ? "  (per-ISBN: title alone would re-collide)" : ""}`,
      );
    });
  }
  const editions = works.reduce(
    (n, w) => n + w.groups.reduce((m, g) => m + g.isbns.length, 0),
    0,
  );
  lines.push(
    `\n${works.length} works split, ${newWorks} new works created, ${editions} editions repointed.`,
    "\nRatings left on the surviving row (the import wrote them; the intended book is in the CSV):",
  );
  for (const r of RATINGS_TO_REVIEW) {
    const work = works.find((w) => w.workId === r.workId);
    if (!work) continue;
    lines.push(
      `  work ${r.workId}: rating ${r.rating} (user ${r.userId}) stays with ${JSON.stringify(work.groups[0].title)}`,
    );
  }
  lines.push(
    "\nWorks whose QID is cleared lose their Wikidata metadata until the sweeper re-runs. For the",
    "series-titled volumes it will now correctly find nothing — the catalogue title is the series",
    "name, so there is no book to match. Correcting books.title is the follow-up that fixes those.",
  );
  return lines.join("\n");
}

function sql() {
  const works = selected();
  const out = [
    "-- Generated by scripts/repair-merged-works.mjs — review before applying.",
    "-- Splits works that group editions of different books. See the script header.",
  ];
  for (const work of works) {
    const [survivor, ...moved] = work.groups;
    out.push(`\n-- ─── work ${work.workId}: ${work.note} ───`);

    // The survivor is re-keyed first: it may currently hold the very key a new work needs (work 292
    // was created by the sequel), and match_key is UNIQUE.
    const survivorKey = groupKey(work, survivor);
    out.push(
      `UPDATE works SET match_key = ${q(survivorKey)}, canonical_title = ${q(survivor.title)} WHERE id = ${work.workId};`,
    );
    if (!work.keepQid) {
      out.push(
        `UPDATE works SET ${ENRICHED_COLUMNS.map((c) => `${c} = NULL`).join(", ")}, enrichment_status = 'pending', enrichment_attempts = 0, enrichment_schema_version = 0 WHERE id = ${work.workId};`,
        // Series membership and discovered editions came from the wrong item too.
        `DELETE FROM work_series WHERE work_id = ${work.workId};`,
        `DELETE FROM work_edition_isbns WHERE work_id = ${work.workId};`,
        // Authors of the volumes being split off must not stay credited on the survivor.
        `DELETE FROM work_authors WHERE work_id = ${work.workId};`,
      );
      const survivorAuthor = normalizeAuthorKey(groupAuthor(work, survivor));
      if (survivorAuthor) {
        out.push(
          `INSERT OR IGNORE INTO work_authors (work_id, author_id, ordinal) SELECT ${work.workId}, id, 0 FROM authors WHERE normalized_name = ${q(survivorAuthor)};`,
        );
      }
    }

    for (const group of moved) {
      const key = groupKey(work, group);
      const author = normalizeAuthorKey(groupAuthor(work, group));
      out.push(
        `INSERT OR IGNORE INTO works (match_key, canonical_title, enrichment_status) VALUES (${q(key)}, ${q(group.title)}, 'pending');`,
        `UPDATE books SET work_id = (SELECT id FROM works WHERE match_key = ${q(key)}) WHERE isbn IN (${group.isbns.map((i) => q(i)).join(", ")});`,
      );
      if (author) {
        out.push(
          `INSERT OR IGNORE INTO work_authors (work_id, author_id, ordinal) SELECT (SELECT id FROM works WHERE match_key = ${q(key)}), id, 0 FROM authors WHERE normalized_name = ${q(author)};`,
        );
      }
    }
  }

  out.push("\n-- Ratings stay on the surviving row. If one was meant for a book that moved, move it by hand:");
  for (const r of RATINGS_TO_REVIEW) {
    const work = works.find((w) => w.workId === r.workId);
    if (!work) continue;
    for (const group of work.groups.slice(1)) {
      out.push(
        `--   UPDATE work_ratings SET work_id = (SELECT id FROM works WHERE match_key = ${q(groupKey(work, group))}) WHERE work_id = ${r.workId} AND user_id = ${r.userId};  -- → ${group.title} [${group.isbns[0]}]`,
      );
    }
  }

  const allIsbns = works.flatMap((w) => w.groups.flatMap((g) => g.isbns))
    .map((i) => q(i))
    .join(", ");
  out.push(
    "\n-- Verify: every work below should now hold editions of exactly one book.",
    `SELECT b.work_id, w.match_key, w.wikidata_qid, b.isbn, b.title FROM books b JOIN works w ON w.id = b.work_id WHERE b.isbn IN (${allIsbns}) ORDER BY b.work_id, b.isbn;`,
  );
  return out.join("\n");
}

console.log(process.argv.includes("--sql") ? sql() : plan());
