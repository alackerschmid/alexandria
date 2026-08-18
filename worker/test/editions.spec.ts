import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchBookMetadata,
  mergeMetadata,
  splitAuthors,
  normalizeStr,
  normalizeAuthorKey,
  workMatchKey,
} from "../src/editions";
import type { BookMetadata } from "../src/types";

const empty: BookMetadata = {
  title: null,
  author: null,
  cover_url: null,
  language: null,
  publish_date: null,
  number_of_pages_median: null,
  description: null,
  publisher: null,
  physical_format: null,
  edition_name: null,
  physical_dimensions: null,
  categories: null,
};

describe("mergeMetadata", () => {
  it("fills null fields on primary from fallback", () => {
    const primary = { ...empty, title: "Dune" };
    const fallback = {
      ...empty,
      title: "Other Title",
      author: "Frank Herbert",
      publisher: "Ace",
    };
    const merged = mergeMetadata(primary, fallback);
    expect(merged.title).toBe("Dune"); // primary wins
    expect(merged.author).toBe("Frank Herbert"); // filled from fallback
    expect(merged.publisher).toBe("Ace");
  });

  it("does not mutate the inputs", () => {
    const primary = { ...empty, title: "Dune" };
    const fallback = { ...empty, author: "Frank Herbert" };
    mergeMetadata(primary, fallback);
    expect(primary.author).toBeNull();
  });

  it("returns primary unchanged when fallback is entirely empty", () => {
    const primary = { ...empty, title: "Dune", author: "Frank Herbert" };
    expect(mergeMetadata(primary, empty)).toEqual(primary);
  });
});

// `pickCoverUrl` is pinned as a pure function in cover-url.spec.ts; these pin that
// `fetchBookMetadata` actually calls it, in the both-sources-answered branch, with the operands
// that way round. Nothing else covers the wiring — reverting the branch to a plain `mergeMetadata`
// (i.e. restoring the 128px bug) left the whole suite green. Only `fetch` is stubbed: this
// function takes no `db`, touches no binding, and `usage: null` counts nothing, which is what the
// worker's "pure logic only" test scope allows for.
describe("fetchBookMetadata cover precedence", () => {
  afterEach(() => vi.unstubAllGlobals());

  const ISBN = "9780061054884";
  const GOOGLE_THUMB =
    // eslint-disable-next-line unicorn/prefer-https
    "http://books.google.com/books/content?id=Krl&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api";
  const GOOGLE_THUMB_STORED =
    "https://books.google.com/books/content?id=Krl&printsec=frontcover&img=1&zoom=1&source=gbs_api";
  const OL_LARGE = "https://covers.openlibrary.org/b/id/240727-L.jpg";

  function stubSources(googleCover: string | null, openLibraryCover: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("googleapis.com"))
          return Response.json({
            items: [
              {
                volumeInfo: {
                  title: "The Dispossessed",
                  authors: ["Ursula K. Le Guin"],
                  pageCount: 387,
                  ...(googleCover && { imageLinks: { thumbnail: googleCover } }),
                },
              },
            ],
          });
        if (url.includes("jscmd=data"))
          return Response.json({
            [`ISBN:${ISBN}`]: {
              title: "The Dispossessed: An Ambiguous Utopia",
              description: "Shevek builds the ansible.",
              cover: { large: openLibraryCover },
            },
          });
        if (url.includes("jscmd=details")) return Response.json({});
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  }

  const found = async () => {
    const out = await fetchBookMetadata(ISBN, "test-key", null);
    if (out.kind !== "found") throw new Error(`expected found, got ${out.kind}`);
    return out.meta;
  };

  it("takes OpenLibrary's -L over Google's 128px thumbnail", async () => {
    stubSources(GOOGLE_THUMB, OL_LARGE);
    const meta = await found();
    expect(meta.cover_url).toBe(OL_LARGE);
    // ...and only the cover: Google still wins the merge on every other field.
    expect(meta.title).toBe("The Dispossessed");
    expect(meta.number_of_pages_median).toBe(387);
  });

  it("keeps a Google cover whose zoom has been raised", async () => {
    const large = GOOGLE_THUMB.replace("zoom=1", "zoom=3");
    stubSources(large, OL_LARGE);
    expect((await found()).cover_url).toBe(
      GOOGLE_THUMB_STORED.replace("zoom=1", "zoom=3"),
    );
  });

  it("keeps Google's cover when OpenLibrary answers with its deleted-cover sentinel", async () => {
    stubSources(GOOGLE_THUMB, "https://covers.openlibrary.org/b/id/-1-L.jpg");
    // The -1 URL 503s, so trading a working 128px image for it would lose the cover outright.
    expect((await found()).cover_url).toBe(GOOGLE_THUMB_STORED);
  });

  it("falls back to OpenLibrary when Google has no cover at all", async () => {
    stubSources(null, OL_LARGE);
    expect((await found()).cover_url).toBe(OL_LARGE);
  });
});

describe("splitAuthors", () => {
  it("splits a comma-joined author string", () => {
    expect(splitAuthors("Jane Doe, John Smith")).toEqual([
      "Jane Doe",
      "John Smith",
    ]);
  });

  it("trims whitespace around each name", () => {
    expect(splitAuthors("Jane Doe ,  John Smith")).toEqual([
      "Jane Doe",
      "John Smith",
    ]);
  });

  it("returns [] for null", () => {
    expect(splitAuthors(null)).toEqual([]);
  });

  it("drops empty segments", () => {
    expect(splitAuthors("Jane Doe,,")).toEqual(["Jane Doe"]);
  });

  it("returns a single-element array for one author", () => {
    expect(splitAuthors("Frank Herbert")).toEqual(["Frank Herbert"]);
  });

  it("does not split on commas inside a parenthetical qualifier", () => {
    // Observed in the wild via OpenLibrary; previously produced a literal "Grossbritannien)"
    // author row and truncated the real name to "John Ronald Reuel Tolkien (Mythenforscher".
    expect(
      splitAuthors("John Ronald Reuel Tolkien (Mythenforscher, Grossbritannien)"),
    ).toEqual(["John Ronald Reuel Tolkien"]);
  });

  it("keeps authors credited after a parenthetical", () => {
    expect(splitAuthors("Jane Doe (editor), John Smith")).toEqual([
      "Jane Doe",
      "John Smith",
    ]);
  });

  it("handles an unclosed parenthetical", () => {
    expect(splitAuthors("Jane Doe (editor")).toEqual(["Jane Doe"]);
  });

  it("does not leave a stray ')' behind for a nested parenthetical", () => {
    expect(splitAuthors("A (pseudonym of B (1900-1950)) C")).toEqual(["A C"]);
  });

  it("strips two separate (non-nested) parentheticals on the same name", () => {
    expect(splitAuthors("Jane Doe (b. 1980) (editor)")).toEqual(["Jane Doe"]);
  });
});

describe("normalizeAuthorKey", () => {
  it("collapses initial spacing and punctuation to one key", () => {
    const expected = "jrrtolkien";
    expect(normalizeAuthorKey("J.R.R. Tolkien")).toBe(expected);
    expect(normalizeAuthorKey("J. R. R. Tolkien")).toBe(expected);
    expect(normalizeAuthorKey("j.r.r.tolkien")).toBe(expected);
  });

  it("drops a trailing parenthetical qualifier", () => {
    expect(normalizeAuthorKey("John Ronald Reuel Tolkien (Mythenforscher")).toBe(
      normalizeAuthorKey("John Ronald Reuel Tolkien"),
    );
  });

  it("still strips diacritics", () => {
    expect(normalizeAuthorKey("Émile Zola")).toBe("emilezola");
  });

  it("keeps names that differ in content apart", () => {
    // These converge via wikidata_qid in mergeWorks, not via the key.
    expect(normalizeAuthorKey("Mary Shelley")).not.toBe(
      normalizeAuthorKey("Mary Wollstonecraft Shelley"),
    );
  });

  it('returns "" for null/undefined', () => {
    expect(normalizeAuthorKey(null)).toBe("");
    expect(normalizeAuthorKey(undefined)).toBe("");
  });

  it("keeps distinct all-parenthetical garbage fragments apart instead of colliding on \"\"", () => {
    // A leftover fragment row from the pre-fix splitAuthors bug, e.g. a comma-separated segment
    // that was nothing but a qualifier ("Tolkien, (translator), Smith"). Truncating at '(' when
    // it's the very first character would collapse every such fragment onto the empty key.
    const various = normalizeAuthorKey("(various)");
    const anonymous = normalizeAuthorKey("(anonymous)");
    expect(various).not.toBe("");
    expect(anonymous).not.toBe("");
    expect(various).not.toBe(anonymous);
  });
});

describe("normalizeStr", () => {
  it("lowercases input", () => {
    expect(normalizeStr("Frank Herbert")).toBe("frank herbert");
  });

  it("strips combining diacritics", () => {
    expect(normalizeStr("J.R.R. Tolkien")).toBe("j.r.r. tolkien");
    expect(normalizeStr("Émile Zola")).toBe("emile zola");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeStr("Frank   Herbert")).toBe("frank herbert");
  });

  it('returns "" for null/undefined', () => {
    expect(normalizeStr(null)).toBe("");
    expect(normalizeStr(undefined)).toBe("");
  });
});

describe("workMatchKey", () => {
  it("keys on normalized title and first-author identity", () => {
    expect(workMatchKey("Dune", "Frank Herbert", "9780441013593")).toBe(
      "dune|frankherbert",
    );
    expect(workMatchKey("  DUNE  ", "Frank  Herbert", "9780441013593")).toBe(
      "dune|frankherbert",
    );
  });

  it("groups two editions of one book under one key", () => {
    expect(workMatchKey("The Sun Also Rises", "Ernest Hemingway", "1")).toBe(
      workMatchKey("The sun also rises", "Ernest Hemingway", "2"),
    );
  });

  it("does NOT group same-titled editions that carry no author", () => {
    // Six German Star Wars volumes were all catalogued as "Star wars - Wächter der Macht" with an
    // empty author, and a title-only key made them one work — one status, one rating, six books.
    const a = workMatchKey("Star wars - Wächter der Macht", null, "9783453874008");
    const b = workMatchKey("Star wars - Wächter der Macht", "", "9783453522343");
    expect(a).not.toBe(b);
    expect(a).toBe("isbn:9783453874008|");
  });

  it("keeps the existing key shape for a titleless edition", () => {
    // Unchanged from before the author guard, so books already linked under this key still resolve.
    expect(workMatchKey(null, "Frank Herbert", "9780441013593")).toBe(
      "isbn:9780441013593|frankherbert",
    );
  });

  it("gives an edition with neither title nor author its own key", () => {
    expect(workMatchKey(null, null, "9780441013593")).toBe(
      "isbn:9780441013593|",
    );
  });
});
