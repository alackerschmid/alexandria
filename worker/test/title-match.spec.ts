import { describe, it, expect } from "vitest";
import {
  titleSimilarity,
  titleScorer,
  pickBestMatch,
  pickAutoIsbn,
  type TitleMatchCandidate,
  type IsbnCandidate,
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

  it("titleScorer agrees with the one-shot form", () => {
    const score = titleScorer("Dune");
    for (const other of ["Dune", "Dune: Book One", "The Dune Chronicles", "", "Pride and Prejudice"]) {
      expect(score(other)).toBe(titleSimilarity("Dune", other));
    }
  });
});

describe("pickBestMatch", () => {
  function candidate(
    overrides: Partial<TitleMatchCandidate>,
  ): TitleMatchCandidate {
    return {
      scanId: 1,
      bookId: 1,
      workId: null,
      title: null,
      canonicalTitle: null,
      author: null,
      ...overrides,
    };
  }

  /** Two copies of one work, as the library index would hand them over — same workId, and both
   *  therefore scoring against the same canonical title. */
  function copies(
    workId: number,
    ...overrides: Partial<TitleMatchCandidate>[]
  ): TitleMatchCandidate[] {
    return overrides.map((o) => candidate({ workId, ...o }));
  }

  it("returns null when there are no candidates", () => {
    expect(pickBestMatch({ title: "Dune", author: "Frank Herbert" }, [])).toBeNull();
  });

  it("matches an exact title+author pair", () => {
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      [candidate({ scanId: 5, bookId: 5, title: "Dune", author: "Frank Herbert" })],
    );
    expect(result).toEqual({
      scanId: 5,
      bookId: 5,
      workId: null,
      score: 1,
      identifiedCopy: true,
    });
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

  it("matches a work the user has two copies of, rather than calling it ambiguous", () => {
    // The no-ISBN counterpart of the ISBN work path: the row names a book, and a book the user owns
    // twice is still one book. Both copies tie (each scores against the shared canonical title), and
    // treating that tie as unanswerable sent every multi-copy row to manual review.
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      copies(
        9,
        { scanId: 1, bookId: 1, title: "Dune", author: "Frank Herbert" },
        { scanId: 2, bookId: 2, title: "Dune", author: "Frank Herbert" },
      ),
    );
    expect(result?.workId).toBe(9);
    // Neither copy outscored the other, so the caller — not the matcher — picks which one the card
    // points at.
    expect(result?.identifiedCopy).toBe(false);
  });

  it("still identifies the copy that outscores its own siblings", () => {
    const result = pickBestMatch(
      { title: "Der Wüstenplanet", author: "Frank Herbert" },
      copies(
        9,
        {
          scanId: 1,
          bookId: 1,
          title: "Dune",
          canonicalTitle: "Dune",
          author: "Frank Herbert",
        },
        {
          scanId: 2,
          bookId: 2,
          title: "Der Wüstenplanet",
          canonicalTitle: "Dune",
          author: "Frank Herbert",
        },
      ),
    );
    expect(result?.scanId).toBe(2);
    expect(result?.identifiedCopy).toBe(true);
  });

  it("is still ambiguous when the tied candidates are different works", () => {
    const result = pickBestMatch(
      { title: "The Ring", author: "Someone" },
      [
        candidate({ scanId: 1, bookId: 1, workId: 1, title: "The Ring", author: "Someone" }),
        candidate({ scanId: 2, bookId: 2, workId: 2, title: "The Ring", author: "Someone" }),
      ],
    );
    expect(result).toBeNull();
  });

  it("does not group two unlinked scans as one work", () => {
    // work_id NULL is "not linked yet", not "the same work as every other unlinked book" — same rule
    // as workSiblings on the client.
    const result = pickBestMatch(
      { title: "The Ring", author: "Someone" },
      [
        candidate({ scanId: 1, bookId: 1, title: "The Ring", author: "Someone" }),
        candidate({ scanId: 2, bookId: 2, title: "The Ring", author: "Someone" }),
      ],
    );
    expect(result).toBeNull();
  });

  it("ignores a same-work copy when ranking against a rival work", () => {
    // The runner-up that has to be beaten is the best *other* work, so a third copy of the winner
    // doesn't change the verdict either way.
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      [
        ...copies(
          9,
          { scanId: 1, bookId: 1, title: "Dune", author: "Frank Herbert" },
          { scanId: 2, bookId: 2, title: "Dune", author: "Frank Herbert" },
        ),
        candidate({ scanId: 3, bookId: 3, workId: 4, title: "Dune", author: "Frank Herbert" }),
      ],
    );
    expect(result).toBeNull();
  });

  it("ignores candidates that never clear their threshold", () => {
    const result = pickBestMatch(
      { title: "Dune", author: "Frank Herbert" },
      [candidate({ scanId: 1, bookId: 1, title: "Pride and Prejudice", author: "Jane Austen" })],
    );
    expect(result).toBeNull();
  });
});

describe("pickAutoIsbn", () => {
  const cand = (
    isbn: string,
    title: string | null,
    author: string | null,
  ): IsbnCandidate => ({ isbn, title, author });

  it("picks the confident match when the author agrees", () => {
    const pick = pickAutoIsbn({ title: "Dune", author: "Frank Herbert" }, [
      cand("9780441013593", "Dune", "Frank Herbert"),
    ]);
    expect(pick?.isbn).toBe("9780441013593");
    expect(pick?.confidence).toBe(1);
  });

  it("treats further editions of the same book as the same answer, not a rival", () => {
    // What a title search actually returns: a dozen editions of the book it found.
    const pick = pickAutoIsbn({ title: "Dune", author: "Frank Herbert" }, [
      cand("9780441013593", "Dune", "Frank Herbert"),
      cand("9780450011849", "Dune", "Frank Herbert"),
      cand("9780593099322", "Dune: Book One", "Frank Herbert"),
    ]);
    expect(pick?.isbn).toBe("9780441013593");
  });

  it("does not let a sequel pass as its own predecessor", () => {
    // The `word` prefix rule pickBestMatch uses scores "Dune" against "Dune Messiah" as 1; here the
    // answer is an ISBN to file the row under, so the two have to stay apart.
    expect(
      pickAutoIsbn({ title: "Dune", author: "Frank Herbert" }, [
        cand("9780593098233", "Dune Messiah", "Frank Herbert"),
      ]),
    ).toBeNull();
    // ...and when both are in the results, the right one wins outright rather than tying.
    const pick = pickAutoIsbn({ title: "Dune", author: "Frank Herbert" }, [
      cand("9780593098233", "Dune Messiah", "Frank Herbert"),
      cand("9780441013593", "Dune", "Frank Herbert"),
    ]);
    expect(pick?.isbn).toBe("9780441013593");
  });

  it("declines when two different books are too close to call", () => {
    const pick = pickAutoIsbn({ title: "The Trial", author: "" }, [
      cand("9780805209990", "The Trial", "Franz Kafka"),
      cand("9781234567897", "The Trial", "D. H. Lawrence"),
    ]);
    expect(pick).toBeNull();
  });

  it("requires a near-exact title when no author corroborates it", () => {
    // 'Dune Messiah' against 'Dune' clears neither bar without an author agreeing.
    expect(
      pickAutoIsbn({ title: "Dune", author: "Someone Else" }, [
        cand("9780593098233", "Dune Messiah", "Frank Herbert"),
      ]),
    ).toBeNull();
    expect(
      pickAutoIsbn({ title: "Dune Messiah", author: "Frank Herbert" }, [
        cand("9780593098233", "Dune Messiah", "Frank Herbert"),
      ])?.isbn,
    ).toBe("9780593098233");
  });

  it("tolerates an author written the other way round", () => {
    // Goodreads exports "Tolkien, J.R.R."; normalizeAuthorKey does not reorder, so this one rides
    // on the title bar alone — near-exact, and it is.
    const pick = pickAutoIsbn(
      { title: "The Hobbit", author: "Tolkien, J.R.R." },
      [cand("9780547928227", "The Hobbit, or There and Back Again", "J.R.R. Tolkien")],
    );
    expect(pick?.isbn).toBe("9780547928227");
  });

  it("returns null for an empty candidate list and for untitled candidates", () => {
    expect(pickAutoIsbn({ title: "Dune", author: "Frank Herbert" }, [])).toBeNull();
    expect(
      pickAutoIsbn({ title: "Dune", author: "Frank Herbert" }, [
        cand("9780441013593", null, "Frank Herbert"),
      ]),
    ).toBeNull();
  });
});
