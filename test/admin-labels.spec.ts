import { describe, it, expect } from "vitest";
import { humanizeToken } from "@/utils/admin-labels";

describe("humanizeToken", () => {
  it("turns a snake/kebab machine string into a display name", () => {
    expect(humanizeToken("google_books")).toBe("Google Books");
    expect(humanizeToken("title_search")).toBe("Title Search");
    expect(humanizeToken("rate-limited")).toBe("Rate Limited");
    expect(humanizeToken("wikidata")).toBe("Wikidata");
  });

  it("leaves nothing blank — this is a fallback for values with no translation", () => {
    expect(humanizeToken("_")).toBe("_");
    expect(humanizeToken("")).toBe("");
  });
});
