import { describe, it, expect } from "vitest";
import { COVER_UNAVAILABLE, coverKeyFor, isCoverKey } from "../src/covers";

const HASH = "a1b2c3d4";

describe("isCoverKey", () => {
  it("accepts the key shape the store writes", () => {
    expect(isCoverKey(`9780593081518/${HASH}.jpg`)).toBe(true);
    expect(isCoverKey(`9780593081518/${HASH}.png`)).toBe(true);
    expect(isCoverKey(`0553813145/${HASH}.webp`)).toBe(true);
  });

  it("rejects the unavailable sentinel", () => {
    // It is a marker, not a key. The serve route must 404 it rather than look it up, and the
    // client must never be handed it — buildScanSelect suppresses it for the same reason.
    expect(isCoverKey(COVER_UNAVAILABLE)).toBe(false);
  });

  it("rejects anything that could reach outside the covers namespace", () => {
    // The serve route rebuilds the key from caller-controlled path params, so this check is the
    // boundary: a `.` or an extra `/` in the first segment must not survive it.
    expect(isCoverKey(`../secrets/${HASH}.jpg`)).toBe(false);
    expect(isCoverKey(`a/b/${HASH}.jpg`)).toBe(false);
    expect(isCoverKey(`9780593081518/../${HASH}.jpg`)).toBe(false);
    expect(isCoverKey("9780593081518/..%2fx.jpg")).toBe(false);
  });

  it("rejects a malformed hash or an extension we do not serve", () => {
    expect(isCoverKey("9780593081518/xyz.jpg")).toBe(false);
    expect(isCoverKey(`9780593081518/${HASH}.svg`)).toBe(false);
    expect(isCoverKey(`9780593081518/${HASH}`)).toBe(false);
    expect(isCoverKey(null)).toBe(false);
    expect(isCoverKey(undefined)).toBe(false);
  });
});

describe("coverKeyFor", () => {
  it("builds a key per content type", () => {
    expect(coverKeyFor("9780593081518", "image/jpeg", HASH)).toBe(
      `9780593081518/${HASH}.jpg`,
    );
    expect(coverKeyFor("9780593081518", "image/webp", HASH)).toBe(
      `9780593081518/${HASH}.webp`,
    );
  });

  it("ignores charset and whitespace on the content type", () => {
    expect(coverKeyFor("9780593081518", "image/jpeg; charset=binary", HASH)).toBe(
      `9780593081518/${HASH}.jpg`,
    );
  });

  it("returns null for a body we will not store", () => {
    // A 200 carrying an HTML error page or an SVG: the request succeeded, so retrying changes
    // nothing — the caller writes the permanent sentinel rather than trying again every tick.
    expect(coverKeyFor("9780593081518", "text/html", HASH)).toBeNull();
    expect(coverKeyFor("9780593081518", "image/svg+xml", HASH)).toBeNull();
    expect(coverKeyFor("9780593081518", null, HASH)).toBeNull();
  });

  it("keys a dashed or legacy ISBN rather than declaring the book coverless", () => {
    // The key's first segment is a charset rule, not an ISBN shape check: rejecting here writes
    // the permanent sentinel, which would decide such a book has no cover when it does.
    expect(coverKeyFor("978-0-593-08151-8", "image/jpeg", HASH)).toBe(
      `978-0-593-08151-8/${HASH}.jpg`,
    );
  });

  it("returns null rather than a key that could escape the namespace", () => {
    expect(coverKeyFor("../evil", "image/jpeg", HASH)).toBeNull();
    expect(coverKeyFor("a/b", "image/jpeg", HASH)).toBeNull();
  });
});
