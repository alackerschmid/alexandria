import { describe, it, expect } from "vitest";
import { initials, tintFor } from "@/utils/cover";

describe("tintFor", () => {
  it("is stable for the same title", () => {
    // The placeholder cover is re-rendered on every list render and on every page of pagination;
    // a tint that moved would make the same book look like a different one.
    expect(tintFor("The Road")).toBe(tintFor("The Road"));
  });

  it("always returns one of the palette's hex values", () => {
    const titles = [
      "",
      "A",
      "The Road",
      "Ärger mit dem Nachbarn",
      "海辺のカフカ",
      "x".repeat(500),
    ];
    for (const t of titles) expect(tintFor(t)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("distinguishes titles that differ only in case or spacing", () => {
    // Deliberately not normalized — two distinct titles should be allowed to look distinct.
    expect(tintFor("the road")).not.toBe(tintFor("The Road"));
    expect(tintFor("TheRoad")).not.toBe(tintFor("The Road"));
  });

  it("spreads a realistic set of titles across more than one tint", () => {
    const tints = new Set(
      ["Dune", "Ilium", "Neuromancer", "Hyperion", "Solaris", "Blindness"].map(
        (t) => tintFor(t),
      ),
    );
    expect(tints.size).toBeGreaterThan(1);
  });

  it("never goes out of bounds on a title whose hash is large", () => {
    // hash() is forced unsigned with >>> 0, so the modulo can't come back negative and index
    // past the array into undefined.
    expect(tintFor("\u{10FFFF}".repeat(40))).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("initials", () => {
  it("takes the first letter of the first two words", () => {
    expect(initials("The Road")).toBe("TR");
    expect(initials("Infinite Jest")).toBe("IJ");
  });

  it("ignores everything after the second word", () => {
    expect(initials("A Brief History of Time")).toBe("AB");
  });

  it("returns a single letter for a one-word title", () => {
    expect(initials("Dune")).toBe("D");
  });

  it("uppercases", () => {
    expect(initials("the road")).toBe("TR");
  });

  it("drops punctuation without letting it split a word", () => {
    expect(initials("Don't Panic")).toBe("DP");
    expect(initials("Anti-Oedipus")).toBe("A");
    expect(initials("(Nachtzug) nach Lissabon")).toBe("NN");
  });

  it("collapses extra whitespace rather than emitting an empty initial", () => {
    expect(initials("  The   Road ")).toBe("TR");
  });

  it("keeps digits", () => {
    expect(initials("1984")).toBe("1");
    expect(initials("2001 A Space Odyssey")).toBe("2A");
  });

  it("keeps the real first letter of a non-ASCII title", () => {
    // The ASCII-only filter this replaced answered "R" here — the umlaut was dropped and the
    // second letter promoted, which is wrong for a large share of this library.
    expect(initials("Ärger mit dem Nachbarn")).toBe("ÄM");
    expect(initials("Über allen Gipfeln")).toBe("ÜA");
    expect(initials("Élégance du hérisson")).toBe("ÉD");
  });

  it("handles a non-Latin title instead of giving up on it", () => {
    expect(initials("海辺のカフカ")).toBe("海");
    expect(initials("Война и мир")).toBe("ВИ");
  });

  it("falls back to ? when nothing survives the filter", () => {
    expect(initials("")).toBe("?");
    expect(initials("!!!")).toBe("?");
    expect(initials(" ".repeat(3))).toBe("?");
  });

  it("returns a whole code point, not half a surrogate pair", () => {
    // "𝐁ook" — a title starting with an astral letter. Indexing by UTF-16 unit would return a lone
    // high surrogate, which renders as a replacement glyph.
    expect([...initials("\u{1D401}ook")]).toHaveLength(1);
  });
});
