import { describe, it, expect } from "vitest";
import {
  COVER_UNAVAILABLE,
  classifyCoverStatus,
  coverHash,
  coverKeyFor,
  isCoverKey,
  isStorableCover,
} from "../src/covers";

const HASH = "a1b2c3d4";
const bytes = (...values: number[]): ArrayBuffer =>
  Uint8Array.from(values).buffer as ArrayBuffer;

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

  it("does not read an extension off Object.prototype", () => {
    // `EXTENSIONS` is an object literal, so `constructor` and `__proto__` are reachable through a
    // bare index and answer truthy non-strings — which would then be interpolated into a key.
    expect(coverKeyFor("9780593081518", "constructor", HASH)).toBeNull();
    expect(coverKeyFor("9780593081518", "__proto__", HASH)).toBeNull();
  });

  it("treats the media type case-insensitively, as HTTP does", () => {
    expect(coverKeyFor("9780593081518", "IMAGE/JPEG", HASH)).toBe(
      `9780593081518/${HASH}.jpg`,
    );
  });
});

describe("coverHash", () => {
  it("produces a hash the key regex accepts, for real bytes", async () => {
    // The coupling this pins: `coverHash` returns 8 lowercase hex chars only because HASH_LENGTH
    // is halved for the byte slice and toString(16) is lowercase, while COVER_KEY demands
    // `[\da-f]{8}`. Change either and every real fetch fails its own key check — storeCover then
    // writes the permanent '-' for every book in the catalogue, bucket empty, suite still green.
    // The other specs here use a hand-written literal, which cannot catch that.
    const hash = await coverHash(bytes(1, 2, 3, 4));
    expect(hash).toMatch(/^[\da-f]{8}$/);
    expect(isCoverKey(coverKeyFor("9780593081518", "image/jpeg", hash))).toBe(
      true,
    );
  });

  it("is stable for the same bytes and differs for different ones", async () => {
    // Stability is what lets `immutable` be safe; difference is what makes a replaced cover arrive
    // under a new key — i.e. a new URL — instead of being masked by a year-long cache entry.
    expect(await coverHash(bytes(1, 2, 3))).toBe(await coverHash(bytes(1, 2, 3)));
    expect(await coverHash(bytes(1, 2, 3))).not.toBe(await coverHash(bytes(4)));
  });
});

describe("classifyCoverStatus", () => {
  it("calls 404/410 permanent — the source saying the image is gone", () => {
    expect(classifyCoverStatus(404)).toBe("unavailable");
    expect(classifyCoverStatus(410)).toBe("unavailable");
  });

  it("calls every other failure transient, so the book stays due", () => {
    // Collapsing these onto `unavailable` marks every book that hit one upstream blip as coverless
    // forever, and nothing in the codebase ever retries a row once '-' is written.
    expect(classifyCoverStatus(500)).toBe("retry");
    expect(classifyCoverStatus(503)).toBe("retry");
    expect(classifyCoverStatus(429)).toBe("retry");
    expect(classifyCoverStatus(403)).toBe("retry");
  });

  it("reads the body only on a 2xx", () => {
    expect(classifyCoverStatus(200)).toBe("read");
    expect(classifyCoverStatus(204)).toBe("read");
    // A redirect reaching here would already have been followed by fetch; treat it as unresolved
    // rather than as an image.
    expect(classifyCoverStatus(302)).toBe("retry");
  });
});

describe("isStorableCover", () => {
  it("accepts the four types we serve", () => {
    expect(isStorableCover("image/jpeg", 1024)).toBe(true);
    expect(isStorableCover("image/png", 1024)).toBe(true);
    expect(isStorableCover("image/gif", 1024)).toBe(true);
    expect(isStorableCover("image/webp", 1024)).toBe(true);
  });

  it("rejects a 200 that isn't an image we store", () => {
    // An HTML error page or an SVG: the request succeeded, so retrying changes nothing and the
    // caller writes the permanent sentinel.
    expect(isStorableCover("text/html", 1024)).toBe(false);
    expect(isStorableCover("image/svg+xml", 1024)).toBe(false);
    expect(isStorableCover(null, 1024)).toBe(false);
  });

  it("rejects an empty or oversized body", () => {
    expect(isStorableCover("image/jpeg", 0)).toBe(false);
    expect(isStorableCover("image/jpeg", 2 * 1024 * 1024 + 1)).toBe(false);
    expect(isStorableCover("image/jpeg", 2 * 1024 * 1024)).toBe(true);
  });

  it("ignores charset on the content type", () => {
    expect(isStorableCover("image/jpeg; charset=binary", 1024)).toBe(true);
  });
});
