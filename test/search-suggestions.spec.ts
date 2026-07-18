import { describe, it, expect } from "vitest";
import {
  parseSearchFragment,
  parseSearchSegments,
} from "@/utils/search-parse";

// Mirrors the runtime set: BUILTIN_KEYS plus any custom-field slugs. The parsers
// only care about membership, so a representative subset suffices here.
const KNOWN = new Set([
  "status",
  "owning",
  "author",
  "genre",
  "series",
  "publisher",
  "language",
  "year",
]);

describe("parseSearchFragment", () => {
  it("returns the whole string when there is no committed token", () => {
    expect(parseSearchFragment("hitch", KNOWN)).toBe("hitch");
    expect(parseSearchFragment("the lord of", KNOWN)).toBe("the lord of");
  });

  it("returns the trailing fragment after a committed key:value token", () => {
    expect(parseSearchFragment("author:tolkien hob", KNOWN)).toBe("hob");
    expect(parseSearchFragment("status:read gen", KNOWN)).toBe("gen");
  });

  it("treats a quoted value as one committed token and skips past it", () => {
    expect(parseSearchFragment('author:"le guin" wiz', KNOWN)).toBe("wiz");
  });

  it("keeps a multi-word trailing fragment intact", () => {
    // Everything after the last committed token is the fragment — it may hold spaces.
    expect(parseSearchFragment("genre:fantasy lord of", KNOWN)).toBe("lord of");
  });

  it("does not treat an in-progress bare key as committed", () => {
    // `author:` has no value yet, so the fragment is the whole in-progress token.
    expect(parseSearchFragment("author:", KNOWN)).toBe("author:");
  });

  it("ignores an unknown key as a committed token", () => {
    expect(parseSearchFragment("bogus:x abc", KNOWN)).toBe("bogus:x abc");
  });

  it("returns empty when the query ends exactly on a committed token", () => {
    expect(parseSearchFragment("author:tolkien", KNOWN)).toBe("");
    expect(parseSearchFragment("author:tolkien ", KNOWN)).toBe("");
  });
});

describe("parseSearchSegments", () => {
  it("returns nothing for an empty string", () => {
    expect(parseSearchSegments("", KNOWN)).toEqual([]);
  });

  it("marks a key: prefix as a key role and the value as plain", () => {
    expect(parseSearchSegments("author:tolkien", KNOWN)).toEqual([
      { text: "author:", role: "key" },
      { text: "tolkien", role: "plain" },
    ]);
  });

  it("keeps free text plain", () => {
    expect(parseSearchSegments("hobbit", KNOWN)).toEqual([
      { text: "hobbit", role: "plain" },
    ]);
  });

  it("handles a mix of plain text and a structured token", () => {
    expect(parseSearchSegments("epic status:read", KNOWN)).toEqual([
      { text: "epic ", role: "plain" },
      { text: "status:", role: "key" },
      { text: "read", role: "plain" },
    ]);
  });

  it("captures a quoted value as a single plain segment", () => {
    expect(parseSearchSegments('author:"le guin"', KNOWN)).toEqual([
      { text: "author:", role: "key" },
      { text: '"le guin"', role: "plain" },
    ]);
  });
});
