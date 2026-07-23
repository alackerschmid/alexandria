import { describe, it, expect } from "vitest";
import {
  isGoodreadsExport,
  parseGoodreadsRow,
  shelfMappingFor,
  stripTitleAnnotations,
  buildImportPayload,
  DEFAULT_SHELF_MAPPING,
  type ParsedGoodreadsRow,
} from "@/utils/goodreads";

const GOODREADS_HEADERS = [
  "Book Id",
  "Title",
  "Author",
  "Author l-f",
  "Additional Authors",
  "ISBN",
  "ISBN13",
  "My Rating",
  "Average Rating",
  "Publisher",
  "Binding",
  "Number of Pages",
  "Year Published",
  "Original Publication Year",
  "Date Read",
  "Date Added",
  "Bookshelves",
  "Bookshelves with positions",
  "Exclusive Shelf",
  "My Review",
  "Spoiler",
  "Private Notes",
  "Read Count",
  "Owned Copies",
];

describe("isGoodreadsExport", () => {
  it("accepts a real Goodreads header row", () => {
    expect(isGoodreadsExport(GOODREADS_HEADERS)).toBe(true);
  });

  it("accepts extra/reordered columns as long as the required ones are present", () => {
    const shuffled = [...GOODREADS_HEADERS].reverse();
    expect(isGoodreadsExport(shuffled)).toBe(true);
    expect(isGoodreadsExport([...GOODREADS_HEADERS, "Some Extra Column"])).toBe(true);
  });

  it("rejects a header row missing a required column", () => {
    const missingIsbn13 = GOODREADS_HEADERS.filter((h) => h !== "ISBN13");
    expect(isGoodreadsExport(missingIsbn13)).toBe(false);
  });

  it("rejects an unrelated CSV's headers", () => {
    expect(isGoodreadsExport(["Name", "Email", "Date"])).toBe(false);
  });
});

describe("parseGoodreadsRow", () => {
  it("strips the Excel formula wrapper from ISBN/ISBN13 and prefers ISBN13", () => {
    const row = parseGoodreadsRow(
      { ISBN: '="0553293354"', ISBN13: '="9780553293357"' },
      0,
    );
    expect(row.isbn).toBe("9780553293357");
  });

  it("falls back to ISBN10 when ISBN13 is blank", () => {
    const row = parseGoodreadsRow({ ISBN: '="0553293354"', ISBN13: '=""' }, 0);
    expect(row.isbn).toBe("0553293354");
  });

  it("handles a bare (non-Excel-wrapped) ISBN value", () => {
    const row = parseGoodreadsRow({ ISBN: "0553293354", ISBN13: "" }, 0);
    expect(row.isbn).toBe("0553293354");
  });

  it("returns null isbn when both columns are the empty Excel wrapper", () => {
    const row = parseGoodreadsRow({ ISBN: '=""', ISBN13: '=""' }, 0);
    expect(row.isbn).toBeNull();
  });

  it("assigns the given id", () => {
    expect(parseGoodreadsRow({}, 7).id).toBe(7);
  });

  it("converts Goodreads' 1-5 star rating to the app's 0-10 scale", () => {
    expect(parseGoodreadsRow({ "My Rating": "1" }, 0).rating).toBe(2);
    expect(parseGoodreadsRow({ "My Rating": "3" }, 0).rating).toBe(6);
    expect(parseGoodreadsRow({ "My Rating": "5" }, 0).rating).toBe(10);
  });

  it("treats a 0 (or missing) rating as unrated, not zero", () => {
    expect(parseGoodreadsRow({ "My Rating": "0" }, 0).rating).toBeNull();
    expect(parseGoodreadsRow({}, 0).rating).toBeNull();
  });

  it("rewrites Goodreads' slash-separated date to a hyphenated one", () => {
    expect(parseGoodreadsRow({ "Date Added": "2017/06/11" }, 0).createdAt).toBe(
      "2017-06-11",
    );
  });

  it("treats a blank Date Added as no date", () => {
    expect(parseGoodreadsRow({ "Date Added": "" }, 0).createdAt).toBeNull();
  });

  it("parses Owned Copies, treating blank/zero/negative as 0", () => {
    expect(parseGoodreadsRow({ "Owned Copies": "2" }, 0).ownedCopies).toBe(2);
    expect(parseGoodreadsRow({ "Owned Copies": "0" }, 0).ownedCopies).toBe(0);
    expect(parseGoodreadsRow({ "Owned Copies": "" }, 0).ownedCopies).toBe(0);
    expect(parseGoodreadsRow({}, 0).ownedCopies).toBe(0);
  });

  it("splits, trims and dedupes the Bookshelves column", () => {
    const row = parseGoodreadsRow(
      { Bookshelves: "to-read, favorites , to-read,  " },
      0,
    );
    expect(row.shelves).toEqual(["to-read", "favorites"]);
  });

  it("returns an empty shelves array when Bookshelves is blank", () => {
    expect(parseGoodreadsRow({ Bookshelves: "" }, 0).shelves).toEqual([]);
  });

  it("treats a blank/zero Number of Pages as null", () => {
    expect(parseGoodreadsRow({ "Number of Pages": "" }, 0).numberOfPages).toBeNull();
    expect(parseGoodreadsRow({ "Number of Pages": "0" }, 0).numberOfPages).toBeNull();
    expect(parseGoodreadsRow({ "Number of Pages": "412" }, 0).numberOfPages).toBe(412);
  });

  it("collapses a blank Publisher/Year Published to null", () => {
    const row = parseGoodreadsRow({ Publisher: "  ", "Year Published": "" }, 0);
    expect(row.publisher).toBeNull();
    expect(row.publishDate).toBeNull();
  });
});

describe("shelfMappingFor", () => {
  it("returns the default mapping for a known exclusive shelf", () => {
    expect(shelfMappingFor("read")).toEqual(DEFAULT_SHELF_MAPPING.read);
    expect(shelfMappingFor("to-read")).toEqual(DEFAULT_SHELF_MAPPING["to-read"]);
  });

  it("falls back to unread/owned for an unrecognized shelf", () => {
    expect(shelfMappingFor("my-custom-shelf")).toEqual({
      status: "unread",
      owning_status: "owned",
    });
  });

  it("uses a caller-supplied mapping instead of the default when given one", () => {
    const custom = { "to-read": { status: "reading" as const, owning_status: "want" as const } };
    expect(shelfMappingFor("to-read", custom)).toEqual(custom["to-read"]);
    // A shelf missing from the custom mapping still falls back to unread/owned, not the default
    // mapping's entry for that shelf.
    expect(shelfMappingFor("read", custom)).toEqual({
      status: "unread",
      owning_status: "owned",
    });
  });
});

describe("stripTitleAnnotations", () => {
  it("strips a single trailing parenthetical", () => {
    expect(stripTitleAnnotations("Dune (Dune Chronicles, #1)")).toBe("Dune");
  });

  it("strips repeated/nested trailing parentheticals", () => {
    expect(
      stripTitleAnnotations("Night Watch (Discworld, #29; City Watch, #6)"),
    ).toBe("Night Watch");
  });

  it("preserves parentheses that aren't at the end of the title", () => {
    expect(stripTitleAnnotations("The (Not So) Great Escape")).toBe(
      "The (Not So) Great Escape",
    );
  });

  it("falls back to the raw (trimmed) title when it's entirely parenthetical", () => {
    expect(stripTitleAnnotations("(Untitled)")).toBe("(Untitled)");
  });

  it("trims surrounding whitespace even with nothing to strip", () => {
    expect(stripTitleAnnotations("  Dune  ")).toBe("Dune");
  });
});

describe("buildImportPayload", () => {
  function row(overrides: Partial<ParsedGoodreadsRow> = {}): ParsedGoodreadsRow & { isbn: string } {
    return {
      id: 0,
      title: "Dune (Dune Chronicles, #1)",
      author: "Frank Herbert",
      isbn: "9780441013593",
      rating: 8,
      createdAt: "2024-01-01 00:00:00",
      shelf: "read",
      publisher: "Ace Books",
      publishDate: "1965",
      numberOfPages: 412,
      ownedCopies: 1,
      shelves: ["sci-fi", "favorites"],
      ...overrides,
    };
  }

  it("strips title annotations for the payload title but keeps the raw author", () => {
    const payload = buildImportPayload(row(), DEFAULT_SHELF_MAPPING);
    expect(payload.title).toBe("Dune");
    expect(payload.author).toBe("Frank Herbert");
  });

  it("maps the shelf to status/owning_status via the given mapping", () => {
    const payload = buildImportPayload(row({ shelf: "to-read" }), DEFAULT_SHELF_MAPPING);
    expect(payload.status).toBe("unread");
    expect(payload.owning_status).toBe("want");
  });

  it("carries through rating, dates and the new metadata/ownership fields", () => {
    const payload = buildImportPayload(row(), DEFAULT_SHELF_MAPPING);
    expect(payload.isbn).toBe("9780441013593");
    expect(payload.rating).toBe(8);
    expect(payload.created_at).toBe("2024-01-01 00:00:00");
    expect(payload.publisher).toBe("Ace Books");
    expect(payload.publish_date).toBe("1965");
    expect(payload.number_of_pages).toBe(412);
    expect(payload.owned_copies).toBe(1);
    expect(payload.shelves).toEqual(["sci-fi", "favorites"]);
  });

  it("collapses a title that strips down to nothing to null", () => {
    const payload = buildImportPayload(row({ title: ' '.repeat(3) }), DEFAULT_SHELF_MAPPING);
    expect(payload.title).toBeNull();
  });

  it("collapses a blank author to null", () => {
    const payload = buildImportPayload(row({ author: ' '.repeat(3) }), DEFAULT_SHELF_MAPPING);
    expect(payload.author).toBeNull();
  });
});
