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

// One normalized title is a prefix of the other, ending at a word boundary — "dune" vs
// "dune: book one", "the hobbit" vs "the hobbit, or there and back again". Deliberately a
// prefix check (not substring anywhere) so e.g. "dune" doesn't match "the dune chronicles".
function isPrefixContainment(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!shorter || longer.indexOf(shorter) !== 0) return false;
  const nextChar = longer[shorter.length];
  return nextChar === undefined || /[^\p{L}\p{N}]/u.test(nextChar);
}

// Sørensen–Dice coefficient over character bigrams of the normalized titles:
// 2 * |bigrams(a) ∩ bigrams(b)| / (|bigrams(a)| + |bigrams(b)|). Robust to word reordering and
// punctuation differences that plain equality or a Levenshtein distance would penalize more
// harshly, while staying cheap enough to run against an entire library's worth of candidates.
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  if (!na || !nb) return 0;
  if (na === nb || isPrefixContainment(na, nb)) return 1;

  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.length === 0 || bb.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of bb) {
    const remaining = counts.get(g) ?? 0;
    if (remaining > 0) {
      overlap++;
      counts.set(g, remaining - 1);
    }
  }
  return (2 * overlap) / (ba.length + bb.length);
}

export interface TitleMatchCandidate {
  scanId: number;
  bookId: number;
  title: string | null;
  canonicalTitle: string | null;
  author: string | null;
}

export interface TitleMatchResult {
  scanId: number;
  bookId: number;
  score: number;
}

// Author keys agreeing (see normalizeAuthorKey) is strong corroborating evidence, so a looser
// title match still counts. Without author agreement — a different author entirely, or one side
// missing — the title alone has to carry the whole match, so it must be near-exact.
const AUTHOR_MATCH_TITLE_THRESHOLD = 0.6;
const TITLE_ONLY_THRESHOLD = 0.92;
// The best candidate must beat the runner-up by at least this much, or the match is ambiguous
// and resolved as "no match" rather than guessed.
const AMBIGUITY_MARGIN = 0.08;

// Scores `query` against every candidate (against both its stored title and its work's canonical
// title, taking the better of the two — covers a scan stored under a translated title) and
// returns the best match, or null if nothing clears its threshold or the top two are too close
// to call.
export function pickBestMatch(
  query: { title: string; author: string },
  candidates: TitleMatchCandidate[],
): TitleMatchResult | null {
  const queryAuthorKey = normalizeAuthorKey(query.author);

  const qualifying: TitleMatchResult[] = [];
  for (const c of candidates) {
    const authorMatched =
      queryAuthorKey !== "" && normalizeAuthorKey(c.author) === queryAuthorKey;
    const score = Math.max(
      titleSimilarity(query.title, c.title ?? ""),
      titleSimilarity(query.title, c.canonicalTitle ?? ""),
    );
    const threshold = authorMatched
      ? AUTHOR_MATCH_TITLE_THRESHOLD
      : TITLE_ONLY_THRESHOLD;
    if (score >= threshold) {
      qualifying.push({ scanId: c.scanId, bookId: c.bookId, score });
    }
  }

  if (qualifying.length === 0) return null;
  qualifying.sort((a, b) => b.score - a.score);
  const [best, runnerUp] = qualifying;
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) return null;
  return best;
}
