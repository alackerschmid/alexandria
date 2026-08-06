import { Hono } from "hono";
import type { Env } from "../types";
import { authMiddleware } from "../auth";
import {
  titleCase,
  parseTagArray,
  parseAuthorsJson,
  AUTHORS_JSON_SUBQUERY,
} from "../library-query";
import { splitAuthors, normalizeStr } from "../editions";

const stats = new Hono<Env>();
stats.use("*", authMiddleware);

// Exported (with the four pure helpers below) for the unit tests: everything in this file that is
// judgement rather than SQL — the year bounds, the `count < 10` decade cutoff, the code-vs-label
// translation fallback — lives in those helpers and is regression-prone.
export type RawRow = {
  status: string;
  author: string | null;
  authors_json: string | null;
  language: string | null;
  pages: number | null;
  publish_date: string | null;
  publisher: string | null;
  original_pub_date: string | null;
  genres: string | null;
  form_of_work: string | null;
  main_subject: string | null;
  countries_of_origin: string | null;
  language_of_work: string | null;
  language_of_work_code: string | null;
};

type SeriesRow = { label: string; count: number };
type CustomFieldRow = {
  field_def_id: number;
  field_name: string;
  field_type: string;
  field_value: string | null;
};
type FirstLineRow = { title: string; first_line: string };
type StatsResponse = {
  total: number;
  byStatus: { read: number; reading: number; unread: number; dnf: number };
  genres: SeriesRow[];
  uncategorizedGenreCount: number;
  languages: { code: string; count: number }[];
  languageCount: number;
  topAuthors: { label: string; count: number }[];
  authorCount: number;
  publishers: { label: string; count: number }[];
  forms: { label: string; count: number }[];
  subjects: { label: string; count: number }[];
  countries: { label: string; count: number }[];
  decades: { label: string; count: number }[];
  decadeGenres: {
    decade: string;
    genre: string;
    count: number;
    total_count: number;
  }[];
  topSeries: SeriesRow[];
  customFields: {
    fieldDefId: number;
    fieldName: string;
    values: { label: string; count: number }[];
  }[];
  avgPages: number | null;
  totalPagesRead: number | null;
  medianYear: number | null;
  yearKnownCount: number;
  genreCount: number;
  translationRatio: {
    pct: number;
    translatedCount: number;
    knownCount: number;
  } | null;
  randomFirstLine: { title: string; firstLine: string } | null;
};

export function extractYear(r: RawRow): number | null {
  if (r.original_pub_date) {
    const n = parseInt(r.original_pub_date, 10);
    if (n >= 100 && n <= 2100) return n;
  }
  if (r.publish_date) {
    const m = r.publish_date.match(/\d{4}/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n >= 100 && n <= 2100) return n;
    }
  }
  return null;
}

function topCounts(
  map: Map<string, number>,
  limit: number,
): { label: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function computeStatusCounts(rows: RawRow[]) {
  const byStatus = { read: 0, reading: 0, unread: 0, dnf: 0 };
  for (const r of rows) {
    switch (r.status) {
      case "read": {
        byStatus.read++;
        break;
      }
      case "reading": {
        byStatus.reading++;
        break;
      }
      case "dnf": {
        byStatus.dnf++;
        break;
      }
      default:
        byStatus.unread++;
    }
  }
  return byStatus;
}

// Top authors — per-individual-author counts, read straight off each row's own
// authors_json (co-authored books increment every author). Books whose work isn't
// linked yet fall back to splitting the raw `author` string, keyed by normalized
// name so a fallback entry merges into a linked one once the book gets re-enriched.
function computeTopAuthors(rows: RawRow[]) {
  const authorLabels = new Map<string, string>();
  const authorCounts = new Map<string, number>();
  for (const r of rows) {
    const linked = parseAuthorsJson(r.authors_json);
    const names = linked.length
      ? linked.map((a) => a.name)
      : splitAuthors(r.author);
    for (const name of names) {
      const norm = normalizeStr(name);
      if (!authorLabels.has(norm)) authorLabels.set(norm, name);
      authorCounts.set(norm, (authorCounts.get(norm) ?? 0) + 1);
    }
  }
  const topAuthors = topCounts(authorCounts, 6).map(({ label, count }) => ({
    label: authorLabels.get(label)!,
    count,
  }));
  return { topAuthors, authorCount: authorCounts.size };
}

function computeLanguages(rows: RawRow[]) {
  const langCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.language)
      langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
  }
  return [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => ({ code, count }));
}

// Genres (JSON array on works)
function computeGenreCounts(rows: RawRow[]) {
  const genreCounts = new Map<string, number>();
  let uncategorizedGenreCount = 0;
  for (const r of rows) {
    if (!r.genres) {
      uncategorizedGenreCount++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.genres);
    } catch {
      uncategorizedGenreCount++;
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      uncategorizedGenreCount++;
      continue;
    }
    for (const g of parsed) {
      if (typeof g === "string") {
        const label = titleCase(g);
        genreCounts.set(label, (genreCounts.get(label) ?? 0) + 1);
      }
    }
  }
  return {
    genres: topCounts(genreCounts, 15),
    genreCount: genreCounts.size,
    uncategorizedGenreCount,
  };
}

function computeStringFieldCounts(
  rows: RawRow[],
  field: "publisher" | "form_of_work" | "main_subject",
) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[field];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return topCounts(counts, 15);
}

// Countries of origin (JSON array)
function computeCountries(rows: RawRow[]) {
  const countryCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.countries_of_origin) continue;
    for (const c of parseTagArray(r.countries_of_origin)) {
      countryCounts.set(c, (countryCounts.get(c) ?? 0) + 1);
    }
  }
  return topCounts(countryCounts, 15);
}

function computePageStats(rows: RawRow[]) {
  const pageNums = rows
    .filter((r) => r.pages != null && r.pages > 0)
    .map((r) => r.pages as number);
  const avgPages =
    pageNums.length > 0
      ? Math.round(pageNums.reduce((a, b) => a + b, 0) / pageNums.length)
      : null;

  const readPageNums = rows
    .filter((r) => r.status === "read" && r.pages != null && r.pages > 0)
    .map((r) => r.pages as number);
  const totalPagesRead =
    readPageNums.length > 0 ? readPageNums.reduce((a, b) => a + b, 0) : null;

  return { avgPages, totalPagesRead };
}

export function computeYearStats(rows: RawRow[]) {
  const years = rows
    .map((r) => extractYear(r))
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);
  const yearKnownCount = years.length;
  const medianYear =
    yearKnownCount > 0 ? years[Math.floor(yearKnownCount / 2)] : null;

  const decadeCounts = new Map<string, number>();
  for (const y of years) {
    const label = `${Math.floor(y / 10) * 10}s`;
    decadeCounts.set(label, (decadeCounts.get(label) ?? 0) + 1);
  }
  const decades = topCounts(decadeCounts, 15);

  return { years, yearKnownCount, medianYear, decades };
}

// Decade × dominant genre
export function computeDecadeGenres(rows: RawRow[]) {
  const decadeGenreCounts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const year = extractYear(r);
    if (year === null || !r.genres) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(r.genres);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const decadeLabel = `${Math.floor(year / 10) * 10}s`;
    let inner = decadeGenreCounts.get(decadeLabel);
    if (!inner) {
      inner = new Map();
      decadeGenreCounts.set(decadeLabel, inner);
    }
    for (const g of parsed) {
      if (typeof g === "string") {
        const label = titleCase(g);
        inner.set(label, (inner.get(label) ?? 0) + 1);
      }
    }
  }
  return [...decadeGenreCounts.entries()]
    .filter(([, genreMap]) => genreMap.size > 0)
    .map(([decade, genreMap]) => {
      const total_count = [...genreMap.values()].reduce(
        (sum, count) => sum + count,
        0,
      );
      const [genre, count] = [...genreMap.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      if (count < 10) return null;
      return { decade, genre, count, total_count };
    })
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, b) => parseInt(a.decade, 10) - parseInt(b.decade, 10));
}

// Translation ratio: edition language (ISO code) vs work's original language. Prefers a direct
// ISO-code comparison (language_of_work_code, backfilled by the schema-version sweeper); falls
// back to the older English-label comparison for rows the sweeper hasn't reached yet.
export function computeTranslationRatio(rows: RawRow[]) {
  const langNamer = new Intl.DisplayNames(["en"], { type: "language" });
  let translatedCount = 0;
  let translationKnownCount = 0;
  for (const r of rows) {
    if (!r.language || !r.language_of_work) continue;
    translationKnownCount++;
    if (r.language_of_work_code) {
      if (r.language.toLowerCase() !== r.language_of_work_code.toLowerCase())
        translatedCount++;
      continue;
    }
    let editionLangName: string;
    try {
      editionLangName = langNamer.of(r.language) ?? r.language;
    } catch {
      editionLangName = r.language;
    }
    if (editionLangName.toLowerCase() !== r.language_of_work.toLowerCase())
      translatedCount++;
  }
  return translationKnownCount > 0
    ? {
        pct: Math.round((translatedCount / translationKnownCount) * 100),
        translatedCount,
        knownCount: translationKnownCount,
      }
    : null;
}

// Custom fields — group by field def, count values
function computeCustomFields(customFieldRows: CustomFieldRow[]) {
  const cfMap = new Map<
    number,
    { fieldName: string; fieldType: string; valueCounts: Map<string, number> }
  >();
  for (const row of customFieldRows) {
    if (row.field_value == null) continue;
    if (!cfMap.has(row.field_def_id)) {
      cfMap.set(row.field_def_id, {
        fieldName: row.field_name,
        fieldType: row.field_type,
        valueCounts: new Map(),
      });
    }
    const entry = cfMap.get(row.field_def_id)!;
    const vals =
      row.field_type === "tag"
        ? parseTagArray(row.field_value)
        : [row.field_value];
    for (const v of vals) {
      entry.valueCounts.set(v, (entry.valueCounts.get(v) ?? 0) + 1);
    }
  }
  return [...cfMap.entries()].map(
    ([fieldDefId, { fieldName, valueCounts }]) => ({
      fieldDefId,
      fieldName,
      values: topCounts(valueCounts, 15),
    }),
  );
}

function buildStatsResponse(input: StatsResponse): StatsResponse {
  return {
    total: input.total,
    byStatus: input.byStatus,
    genres: input.genres ?? [],
    uncategorizedGenreCount: input.uncategorizedGenreCount ?? 0,
    languages: input.languages ?? [],
    languageCount: input.languageCount ?? 0,
    topAuthors: input.topAuthors ?? [],
    authorCount: input.authorCount ?? 0,
    publishers: input.publishers ?? [],
    forms: input.forms ?? [],
    subjects: input.subjects ?? [],
    countries: input.countries ?? [],
    decades: input.decades ?? [],
    decadeGenres: input.decadeGenres ?? [],
    topSeries: input.topSeries ?? [],
    customFields: input.customFields ?? [],
    avgPages: input.avgPages ?? null,
    totalPagesRead: input.totalPagesRead ?? null,
    medianYear: input.medianYear ?? null,
    yearKnownCount: input.yearKnownCount ?? 0,
    genreCount: input.genreCount ?? 0,
    translationRatio: input.translationRatio ?? null,
    randomFirstLine: input.randomFirstLine ?? null,
  };
}

stats.get("/", async (c) => {
  const userId = c.get("userId");
  const locale = (c.req.query("locale") ?? "en").slice(0, 5);

  const [{ results }, seriesResult, customFieldResult, firstLineResult] =
    await Promise.all([
      c.env.DB.prepare(
        `
      SELECT s.status                                                        AS status,
             b.author                                                        AS author,
             ${AUTHORS_JSON_SUBQUERY}                                       AS authors_json,
             COALESCE(o.language, b.language)                               AS language,
             COALESCE(o.number_of_pages_median, b.number_of_pages_median)   AS pages,
             COALESCE(o.publish_date, b.publish_date)                       AS publish_date,
             COALESCE(o.publisher, b.publisher)                             AS publisher,
             wk.original_pub_date                                           AS original_pub_date,
             wk.genres                                                      AS genres,
             wk.form_of_work                                                AS form_of_work,
             wk.main_subject                                                AS main_subject,
             wk.countries_of_origin                                         AS countries_of_origin,
             wk.language_of_work                                            AS language_of_work,
             wk.language_of_work_code                                       AS language_of_work_code
      FROM scans s
      JOIN books b ON s.book_id = b.id
      LEFT JOIN book_overrides o ON o.book_id = b.id AND o.user_id = s.user_id
      LEFT JOIN works wk ON wk.id = b.work_id
      WHERE s.user_id = ? AND s.owning_status IN ('owned', 'lent_out')
    `,
      )
        .bind(userId)
        .all<RawRow>(),

      c.env.DB.prepare(
        `
      SELECT COALESCE(sn.name, ser.canonical_name) AS label, COUNT(*) AS count
      FROM scans s
      JOIN books b ON s.book_id = b.id
      JOIN works wk ON wk.id = b.work_id
      JOIN work_series ws ON ws.work_id = wk.id
      JOIN series ser ON ser.id = ws.series_id
      LEFT JOIN series_names sn ON sn.series_id = ser.id AND sn.language = ?
      WHERE s.user_id = ? AND s.owning_status IN ('owned', 'lent_out')
      GROUP BY ser.id
      ORDER BY count DESC
      LIMIT 15
    `,
      )
        .bind(locale, userId)
        .all<SeriesRow>(),

      c.env.DB.prepare(
        `
      SELECT ufd.id AS field_def_id, ufd.field_name, ufd.field_type, bcf.field_value
      FROM book_custom_fields bcf
      JOIN user_field_definitions ufd ON ufd.id = bcf.field_def_id
      JOIN scans s ON s.book_id = bcf.book_id AND s.user_id = bcf.user_id
      WHERE bcf.user_id = ?
      AND ufd.field_type NOT IN ('date', 'integer')
      AND s.owning_status IN ('owned', 'lent_out')
    `,
      )
        .bind(userId)
        .all<CustomFieldRow>(),

      c.env.DB.prepare(
        `
      SELECT b.title AS title, wk.first_line AS first_line
      FROM scans s
      JOIN books b ON s.book_id = b.id
      JOIN works wk ON wk.id = b.work_id
      WHERE s.user_id = ? AND s.owning_status IN ('owned', 'lent_out')
        AND wk.first_line IS NOT NULL AND wk.first_line != ''
      ORDER BY RANDOM()
      LIMIT 1
    `,
      )
        .bind(userId)
        .all<FirstLineRow>(),
    ]);

  const rows = results;

  const byStatus = computeStatusCounts(rows);
  const { topAuthors, authorCount } = computeTopAuthors(rows);
  const languages = computeLanguages(rows);
  const { genres, genreCount, uncategorizedGenreCount } =
    computeGenreCounts(rows);
  const publishers = computeStringFieldCounts(rows, "publisher");
  const forms = computeStringFieldCounts(rows, "form_of_work");
  const subjects = computeStringFieldCounts(rows, "main_subject");
  const countries = computeCountries(rows);
  const { avgPages, totalPagesRead } = computePageStats(rows);
  const { yearKnownCount, medianYear, decades } = computeYearStats(rows);
  const decadeGenres = computeDecadeGenres(rows);
  const translationRatio = computeTranslationRatio(rows);

  // Random first line (for the home page spotlight)
  const firstLineRow = firstLineResult.results[0];
  const randomFirstLine = firstLineRow
    ? { title: firstLineRow.title, firstLine: firstLineRow.first_line }
    : null;

  // Series
  const topSeries = seriesResult.results.map((r) => ({
    label: r.label,
    count: r.count,
  }));

  const customFields = computeCustomFields(customFieldResult.results);

  return c.json(
    buildStatsResponse({
      total: rows.length,
      byStatus,
      genres,
      uncategorizedGenreCount,
      languages,
      languageCount: languages.length,
      topAuthors,
      authorCount,
      publishers,
      forms,
      subjects,
      countries,
      decades,
      decadeGenres,
      topSeries,
      customFields,
      avgPages,
      totalPagesRead,
      medianYear,
      yearKnownCount,
      genreCount,
      translationRatio,
      randomFirstLine,
    }),
  );
});

export default stats;
