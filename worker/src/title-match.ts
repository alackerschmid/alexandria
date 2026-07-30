// Pure title/author matching for the Goodreads-import no-ISBN path (routes/import.ts's
// POST /match) — no D1, no network, so it's unit-testable in isolation. Deliberately
// conservative: an auto-applied wrong match silently corrupts a book the user already curated,
// which is worse than one more manual review row, so both functions err toward "no match"
// whenever a candidate is merely plausible rather than confident and unambiguous.
import { normalizeStr, normalizeAuthorKey } from "./editions";

function bigrams(s: string): string[] {
  if (s.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

// A title normalized once and reused across every comparison it takes part in — the `normalizeStr`
// call (NFKD + diacritic-strip) and bigram build are the expensive part, so a candidate's titles
// are prepared once (prepareCandidates) rather than re-derived for each of up to 50 query rows.
interface NormalizedTitle {
  norm: string;
  bigrams: string[];
  counts: Map<string, number>;
}

function normalizeTitle(raw: string | null): NormalizedTitle | null {
  const norm = normalizeStr(raw);
  if (!norm) return null;
  const bg = bigrams(norm);
  const counts = new Map<string, number>();
  for (const g of bg) counts.set(g, (counts.get(g) ?? 0) + 1);
  return { norm, bigrams: bg, counts };
}

/** How much of a title one side is allowed to be missing and still count as containment.
 *
 * `word` — any word boundary: "dune" contains "dune messiah" as much as "dune: book one".
 * Right when the candidates are the user's own scans, where the alternative is failing to
 * recognize a book they demonstrably have.
 * `subtitle` — a punctuation boundary only, so the extra text has to read as a subtitle. Right
 * when the answer is an *ISBN to file the row under*: "Dune" and "Dune Messiah" are two books, and
 * nothing downstream would catch the swap. */
type PrefixRule = "word" | "subtitle";

// One normalized title is a prefix of the other, ending at a boundary — "dune" vs
// "dune: book one", "the hobbit" vs "the hobbit, or there and back again". Deliberately a
// prefix check (not substring anywhere) so e.g. "dune" doesn't match "the dune chronicles".
function isPrefixContainment(
  a: string,
  b: string,
  rule: PrefixRule = "word",
): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter || longer.indexOf(shorter) !== 0) return false;
  const nextChar = longer[shorter.length];
  if (nextChar === undefined) return true;
  return rule === "word"
    ? /[^\p{L}\p{N}]/u.test(nextChar)
    : /[^\p{L}\p{N}\s]/u.test(nextChar);
}

// Sørensen–Dice coefficient over character bigrams of the two prepared titles:
// 2 * |bigrams(a) ∩ bigrams(b)| / (|bigrams(a)| + |bigrams(b)|). Robust to word reordering and
// punctuation differences that plain equality or a Levenshtein distance would penalize more
// harshly. `a.counts` is copied (not mutated) so a prepared title can be scored against many.
function diceScore(
  a: NormalizedTitle | null,
  b: NormalizedTitle | null,
  rule: PrefixRule = "word",
): number {
  if (!a || !b) return 0;
  if (a.norm === b.norm || isPrefixContainment(a.norm, b.norm, rule)) return 1;
  if (a.bigrams.length === 0 || b.bigrams.length === 0) return 0;

  const counts = new Map(a.counts);
  let overlap = 0;
  for (const g of b.bigrams) {
    const remaining = counts.get(g) ?? 0;
    if (remaining > 0) {
      overlap++;
      counts.set(g, remaining - 1);
    }
  }
  return (2 * overlap) / (a.bigrams.length + b.bigrams.length);
}

export function titleSimilarity(a: string, b: string): number {
  return diceScore(normalizeTitle(a), normalizeTitle(b));
}

/**
 * `titleSimilarity` with the left-hand title prepared once — for a caller scoring one title against
 * many strings (enrichment's Wikidata labels, which run into the hundreds per work). The one-shot
 * form re-does the NFKD normalize and bigram build on both sides of every call, which is exactly what
 * `prepareCandidates` exists to avoid on the library path.
 */
export function titleScorer(title: string): (other: string) => number {
  const prepared = normalizeTitle(title);
  return (other) => diceScore(prepared, normalizeTitle(other));
}

export interface TitleMatchCandidate {
  scanId: number;
  bookId: number;
  /** The work this copy belongs to — two candidates sharing one are the same answer twice, not two
   *  competing answers (see the ambiguity check in pickBestMatchPrepared). NULL for an unlinked scan. */
  workId: number | null;
  title: string | null;
  canonicalTitle: string | null;
  author: string | null;
}

// A candidate with its titles/author-key normalized once, so a whole batch of query rows can be
// scored against it without re-normalizing. Build once per request via prepareCandidates.
export interface PreparedCandidate {
  scanId: number;
  bookId: number;
  workId: number | null;
  authorKey: string;
  title: NormalizedTitle | null;
  canonicalTitle: NormalizedTitle | null;
}

export function prepareCandidates(
  candidates: TitleMatchCandidate[],
): PreparedCandidate[] {
  return candidates.map((c) => ({
    scanId: c.scanId,
    bookId: c.bookId,
    workId: c.workId,
    authorKey: normalizeAuthorKey(c.author),
    title: normalizeTitle(c.title),
    canonicalTitle: normalizeTitle(c.canonicalTitle),
  }));
}

// One candidate with its score, before the ambiguity rules below have had their say.
interface ScoredCandidate {
  scanId: number;
  bookId: number;
  workId: number | null;
  score: number;
}

export interface TitleMatchResult extends ScoredCandidate {
  /** True when this copy won outright — the row identified a specific scan. False when the top score
   *  is a tie among copies of one work: the row identified the *book*, and which copy the caller
   *  should treat as primary is its call (an owned one, by the same rule the ISBN work path uses). */
  identifiedCopy: boolean;
}

// Author keys agreeing (see normalizeAuthorKey) is strong corroborating evidence, so a looser
// title match still counts. Without author agreement — a different author entirely, or one side
// missing — the title alone has to carry the whole match, so it must be near-exact.
const AUTHOR_MATCH_TITLE_THRESHOLD = 0.6;
const TITLE_ONLY_THRESHOLD = 0.92;
// The best candidate must beat the runner-up by at least this much, or the match is ambiguous
// and resolved as "no match" rather than guessed.
const AMBIGUITY_MARGIN = 0.08;

// The bar a candidate's title score has to clear, given whether its author agrees with the query's.
function titleThreshold(queryAuthorKey: string, candidateAuthorKey: string): number {
  const authorMatched =
    queryAuthorKey !== "" && candidateAuthorKey === queryAuthorKey;
  return authorMatched ? AUTHOR_MATCH_TITLE_THRESHOLD : TITLE_ONLY_THRESHOLD;
}

/**
 * The shared decision rule, and the reason both pickers below can claim to apply the same one:
 * the best candidate wins only if it beats the best *genuinely competing* one by `AMBIGUITY_MARGIN`,
 * otherwise the question is unanswerable and the caller must decline rather than guess.
 *
 * What counts as competing differs by caller — copies of one work, editions of one book — so it
 * comes in as `sameAnswer`. `rivals` rides back out because the ranking is worth exactly one sort,
 * and `pickBestMatchPrepared` has a second question to ask of it.
 */
function bestUnambiguous<T extends { score: number }>(
  qualifying: T[],
  sameAnswer: (a: T, b: T) => boolean,
): { best: T; rivals: T[] } | null {
  if (qualifying.length === 0) return null;
  qualifying.sort((a, b) => b.score - a.score);
  const [best, ...rivals] = qualifying;
  const runnerUp = rivals.find((c) => !sameAnswer(c, best));
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) return null;
  return { best, rivals };
}

// Two candidates that are copies of one work are the same answer twice, not a question the matcher
// can't answer — so ambiguity is judged between *works*. An unlinked scan (work_id NULL) is its own
// work and never groups with another, mirroring `workSiblings` on the client: grouping books that
// merely both lack a work link would be wrong.
function sameWork(a: ScoredCandidate, b: ScoredCandidate): boolean {
  return a.workId != null && a.workId === b.workId;
}

// Scores `query` against every candidate (against both its stored title and its work's canonical
// title, taking the better of the two — covers a scan stored under a translated title) and
// returns the best match, or null if nothing clears its threshold or the two best *works* are too
// close to call.
export function pickBestMatchPrepared(
  query: { title: string; author: string },
  candidates: PreparedCandidate[],
): TitleMatchResult | null {
  const queryAuthorKey = normalizeAuthorKey(query.author);
  const queryTitle = normalizeTitle(query.title);

  const qualifying: ScoredCandidate[] = [];
  for (const c of candidates) {
    // "word": the candidates here are scans the user demonstrably has, so a title that merely
    // contains theirs at a word boundary is still recognizably their book. See PrefixRule.
    const score = Math.max(
      diceScore(queryTitle, c.title, "word"),
      diceScore(queryTitle, c.canonicalTitle, "word"),
    );
    if (score >= titleThreshold(queryAuthorKey, c.authorKey)) {
      qualifying.push({
        scanId: c.scanId,
        bookId: c.bookId,
        workId: c.workId,
        score,
      });
    }
  }

  // The runner-up that has to be beaten is the best-scoring candidate of a *different* work. Two
  // editions of one book score identically here (each is compared against the shared canonical title
  // as well as its own), so treating them as rivals sent every multi-copy row to manual review —
  // exactly the case the ISBN path resolves by work rather than declining to answer.
  const ranked = bestUnambiguous(qualifying, sameWork);
  if (!ranked) return null;
  const { best, rivals } = ranked;
  // Within the winning work, one copy only counts as *identified* if it also beat its siblings by the
  // margin — e.g. a per-user title override, or a German edition matched under its German title.
  const tiedSibling = rivals.some(
    (c) => sameWork(c, best) && best.score - c.score < AMBIGUITY_MARGIN,
  );
  return { ...best, identifiedCopy: !tiedSibling };
}

// Convenience wrapper for one-shot matching (and the tests). A batch caller matching many query
// rows against the same library should call prepareCandidates() once and pickBestMatchPrepared()
// per row instead, so candidate normalization isn't repeated for every row.
export function pickBestMatch(
  query: { title: string; author: string },
  candidates: TitleMatchCandidate[],
): TitleMatchResult | null {
  return pickBestMatchPrepared(query, prepareCandidates(candidates));
}

// ── Auto-assigning an ISBN to a row that has none ─────────────────────────────────────────────

/** One title-search result, as much of it as the pick below judges. */
export interface IsbnCandidate {
  isbn: string;
  title: string | null;
  author: string | null;
}

export interface IsbnPick {
  isbn: string;
  /** The winning candidate's title score — what the wizard shows next to "ISBN auto-assigned". */
  confidence: number;
}

// Two search results are the same book — and so the same answer twice rather than two competing
// ones — when they agree on author and their titles match outright (equal, or one the other's
// subtitled form). A title search legitimately returns a dozen editions of the book it found;
// treating those as rivals would decline every unambiguous query. Under the `subtitle` rule, one
// author's "Dune" and "Dune Messiah" stay two books and rule each other out, which is the point.
function sameBook(
  a: { authorKey: string; title: NormalizedTitle | null },
  b: { authorKey: string; title: NormalizedTitle | null },
): boolean {
  return a.authorKey === b.authorKey && diceScore(a.title, b.title, "subtitle") === 1;
}

/**
 * Picks the ISBN to auto-assign to an import row that carries none, from the candidates a
 * title/author search returned — or null when nothing clears the bar.
 *
 * The decision rule is `pickBestMatchPrepared`'s, shared rather than restated — same thresholds via
 * `titleThreshold`, same margin via `bestUnambiguous` — and for the same reason: a wrong ISBN
 * silently files the row under a different book, which is worse than one more manual review row.
 * Two things differ, both because the candidates are search results rather than scans the user
 * demonstrably has: what counts as one answer twice (see `sameBook`), and the stricter `subtitle`
 * containment rule (see `PrefixRule`).
 */
export function pickAutoIsbn(
  query: { title: string; author: string },
  candidates: IsbnCandidate[],
): IsbnPick | null {
  const queryAuthorKey = normalizeAuthorKey(query.author);
  const queryTitle = normalizeTitle(query.title);

  const qualifying = [];
  for (const c of candidates) {
    const authorKey = normalizeAuthorKey(c.author);
    const title = normalizeTitle(c.title);
    const score = diceScore(queryTitle, title, "subtitle");
    if (score >= titleThreshold(queryAuthorKey, authorKey)) {
      qualifying.push({ isbn: c.isbn, authorKey, title, score });
    }
  }

  const ranked = bestUnambiguous(qualifying, sameBook);
  return ranked ? { isbn: ranked.best.isbn, confidence: ranked.best.score } : null;
}
