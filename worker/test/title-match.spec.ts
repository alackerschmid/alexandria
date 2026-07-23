import { describe, it, expect } from "vitest";
import {
  titleSimilarity,
  pickBestMatch,
  type TitleMatchCandidate,
} from "../src/title-match";

describe("titleSimilarity", () => {
  it("returns 1 for identical titles", () => {
    expect(titleSimilarity("Dune", "Dune")).toBe(1);
  });

  it("is case- and diacritic-insensitive (via normalizeStr)", () => {
    expect(titleSimilarity("DUNE", "dune")).toBe(1);
    expect(titleSimilarity("Über uns", "uber uns")).toBe(1);
  });

  it("returns 0 when either title is empty", () => {
    expect(titleSimilarity("", "Dune")).toBe(0);
    expect(titleSimilarity("Dune", "")).toBe(0);
    expect(titleSimilarity("", "")).toBe(0);
  });

  it("scores a prefix-containment pair at a word boundary as 1", () => {
    expect(titleSimilarity("Dune", "Dune: Book One")).toBe(1);
    expect(
      titleSimilarity(
        "The Hobbit",
        "The Hobbit, or There and Back Again",
      ),
    ).toBe(1);
  });

  it("does not treat a mid-string substring as containment", () => {
    // "dune" appears inside "the dune chronicles" but not as a leading prefix — score should
    // fall back to bigram overlap, well short of 1.
    expect(titleSimilarity("Dune", "The Dune Chronicles")).toBeLessThan(1);
  });

  it("scores completely different titles near 0", () => {
    expect(titleSimilarity("Dune", "Pride and Prejudice")).toBeLessThan(0.2);
  });

  it("scores minor punctuation/reordering differences highly but not identically", () => {
    const score = titleSimilarity(
      "Harry Potter and the Sorcerer's Stone",
      "Harry Potter and the Sorcerers Stone",
    );
    expect(score).toBeGreaterThan(0.9);
  });
});

describe("pickBestMatch", () => {
  function candidate(
    overrides: Partial<TitleMatchCandidate>,
  ): TitleMatchCandidate {
    return {
      scanId: 1,
      bookId: 1,
      title: null,
      canonicalTitle: null,
      author: null,
      ...overrides,
    };
  }

  it("returns null when there are no candidates", () => {
    expect(pickBestMatch({ title: "Dune", author: "Frank Herbert" }, [])).toBeNull();
  });

  it("matches an exact title+author pair", () => {
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      [candidate({ scanId: 5, bookId: 5, title: "Dune", author: "Frank Herbert" })],
    );
    expect(result).toEqual({ scanId: 5, bookId: 5, score: 1 });
  });

  it("matches against the candidate's canonical (work) title when the stored title differs", () => {
    const result = pickBestMatch(
      { title: "Le Petit Prince", author: "Antoine de Saint-Exupéry" },
      [
        candidate({
          scanId: 2,
          bookId: 2,
          title: "The Little Prince",
          canonicalTitle: "Le Petit Prince",
          author: "Antoine de Saint-Exupéry",
        }),
      ],
    );
    expect(result?.scanId).toBe(2);
  });

  it("accepts a looser title match when author keys agree", () => {
    // "Messiah of Dune" scores ~0.72 against "Dune Messiah" — well short of the 0.92 title-only
    // bar, but clears the relaxed 0.6 bar that author agreement unlocks.
    const result = pickBestMatch(
      { title: "Dune Messiah", author: "Frank Herbert" },
      [
        candidate({
          scanId: 3,
          bookId: 3,
          title: "Messiah of Dune",
          author: "Frank Herbert",
        }),
      ],
    );
    expect(result?.scanId).toBe(3);
  });

  it("requires a near-exact title when author keys disagree", () => {
    const result = pickBestMatch(
      { title: "Dune Messiah", author: "Someone Else" },
      [
        candidate({
          scanId: 3,
          bookId: 3,
          title: "Messiah of Dune",
          author: "Frank Herbert",
        }),
      ],
    );
    expect(result).toBeNull();
  });

  it("requires a near-exact title when the query has no author at all", () => {
    const result = pickBestMatch(
      { title: "Dune Messiah", author: "" },
      [candidate({ scanId: 3, bookId: 3, title: "Messiah of Dune", author: "Frank Herbert" })],
    );
    expect(result).toBeNull();
  });

  it("returns null when two candidates are too close to call (ambiguous)", () => {
    const result = pickBestMatch(
      { title: "The Ring", author: "Someone" },
      [
        candidate({ scanId: 1, bookId: 1, title: "The Ring", author: "Author A" }),
        candidate({ scanId: 2, bookId: 2, title: "The Ring", author: "Author B" }),
      ],
    );
    expect(result).toBeNull();
  });

  it("picks the clear winner when one candidate is a much better match than the runner-up", () => {
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      [
        candidate({ scanId: 1, bookId: 1, title: "Dune", author: "Frank Herbert" }),
        candidate({ scanId: 2, bookId: 2, title: "Doom", author: "Someone Else" }),
      ],
    );
    expect(result?.scanId).toBe(1);
  });

  it("ignores candidates that never clear their threshold", () => {
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      [candidate({ scanId: 1, bookId: 1, title: "Pride and Prejudice", author: "Jane Austen" })],
    );
    expect(result).toBeNull();
  });
});
