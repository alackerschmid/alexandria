import { describe, it, expect } from "vitest";
import { reviewWordCount } from "@/utils/review";

describe("reviewWordCount", () => {
  it("is zero for no review", () => {
    expect(reviewWordCount(null)).toBe(0);
    expect(reviewWordCount(undefined)).toBe(0);
    expect(reviewWordCount(" ".repeat(3))).toBe(0);
  });

  it("counts plain prose", () => {
    expect(reviewWordCount("Not a book that resolves, and better for it.")).toBe(
      9,
    );
  });

  it("does not count markdown structure as words", () => {
    const review = [
      "## Reading notes",
      "",
      "- the title essay",
      "- the water piece",
      "",
      "> She names the collapse exactly once.",
    ].join("\n");
    // "Reading notes" + "the title essay" + "the water piece" + the six-word quote
    expect(reviewWordCount(review)).toBe(14);
  });

  it("counts a link by its text, not its URL", () => {
    expect(reviewWordCount("See [the Getty essay](https://example.com/a/b)")).toBe(
      4,
    );
  });

  it("ignores fenced and inline code", () => {
    expect(reviewWordCount("Quote:\n```\nlots of code here\n```\ndone")).toBe(2);
    expect(reviewWordCount("the `useEffect` hook")).toBe(2);
  });

  it("does not inflate the count from emphasis markers", () => {
    // "built to be re-read and re-read" — the ** and _ pairs are not words of their own.
    expect(reviewWordCount("built to be **re-read** and _re-read_")).toBe(6);
  });

  it("counts a one-line review, which still gets a metadata line", () => {
    expect(reviewWordCount("Loved it.")).toBe(2);
  });
});
