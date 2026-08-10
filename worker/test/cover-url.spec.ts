import { describe, it, expect } from "vitest";
import {
  isGoogleThumbnail,
  normalizeCoverUrl,
  openLibraryCoverUrlById,
  pickCoverUrl,
} from "../src/cover-url";

const googleThumb = (extra = "") =>
  `https://books.google.com/books/content?id=KrlPEAAAQBAJ&printsec=frontcover&img=1&zoom=1${extra}&source=gbs_api`;

describe("normalizeCoverUrl", () => {
  it("upgrades http to https", () => {
    // Google's imageLinks are http; an https page refuses to load them as mixed content. The
    // insecure URL is the input under test — hence the disable, which is the whole point of it.
    // eslint-disable-next-line unicorn/prefer-https
    const insecure = "http://books.google.com/books/content?id=x";
    expect(normalizeCoverUrl(insecure)).toBe(
      "https://books.google.com/books/content?id=x",
    );
  });

  it("strips edge=curl, Google's fake page-curl overlay", () => {
    expect(normalizeCoverUrl(googleThumb("&edge=curl"))).toBe(googleThumb());
  });

  it("leaves the other query params alone", () => {
    const out = normalizeCoverUrl(googleThumb("&edge=curl")) ?? "";
    expect(out).toContain("printsec=frontcover");
    expect(out).toContain("zoom=1");
    expect(out).toContain("source=gbs_api");
  });

  it("only strips edge on Google URLs", () => {
    // `edge` means nothing to any other host, so removing it there could break the URL.
    const other = "https://example.com/cover.jpg?edge=curl";
    expect(normalizeCoverUrl(other)).toBe(other);
  });

  it("returns null for an absent cover", () => {
    expect(normalizeCoverUrl(null)).toBeNull();
    expect(normalizeCoverUrl(undefined)).toBeNull();
    expect(normalizeCoverUrl("")).toBeNull();
  });

  it("passes an unparseable URL through rather than dropping it", () => {
    // No worse than what we would have stored, and CoverImage falls back when the <img> fails.
    expect(normalizeCoverUrl("not a url")).toBe("not a url");
  });

  it("handles Google's other path shape, `/books?id=`", () => {
    // The older form, usually on a bks<n> host. `pathname` is `/books` with no trailing segment,
    // which a `/books/` test missed — and missing it left `edge=curl` on.
    // eslint-disable-next-line unicorn/prefer-https
    const legacy = "http://bks5.books.google.com/books?id=x&zoom=1&edge=curl";
    expect(normalizeCoverUrl(legacy)).toBe(
      "https://bks5.books.google.com/books?id=x&zoom=1",
    );
  });

  it("drops OpenLibrary's deleted-cover sentinel", () => {
    // Cover id -1 is an edition whose cover was removed; the URL 503s, so storing it buys a failed
    // request where null goes straight to PlaceholderCover.
    expect(
      normalizeCoverUrl("https://covers.openlibrary.org/b/id/-1-L.jpg"),
    ).toBeNull();
    expect(
      normalizeCoverUrl("https://covers.openlibrary.org/b/id/-1-M.jpg"),
    ).toBeNull();
    expect(
      normalizeCoverUrl("https://covers.openlibrary.org/b/id/240727-L.jpg"),
    ).toBe("https://covers.openlibrary.org/b/id/240727-L.jpg");
  });
});

describe("isGoogleThumbnail", () => {
  it("is true for zoom=1, which is all imageLinks ever gives", () => {
    expect(isGoogleThumbnail(googleThumb())).toBe(true);
  });

  it("is true for a Google cover URL with no zoom at all", () => {
    expect(
      isGoogleThumbnail("https://books.google.com/books/content?id=x&img=1"),
    ).toBe(true);
  });

  it("is false once the zoom has been raised", () => {
    // A higher zoom is only ever written by the probe-verified upgrade script — it is a real
    // 575px image, and must not be traded for a smaller OpenLibrary one.
    expect(isGoogleThumbnail(googleThumb().replace("zoom=1", "zoom=3"))).toBe(
      false,
    );
  });

  it("is false for a non-Google URL", () => {
    expect(
      isGoogleThumbnail("https://covers.openlibrary.org/b/id/123-L.jpg"),
    ).toBe(false);
    expect(isGoogleThumbnail("not a url")).toBe(false);
  });

  it("recognises the `/books?id=` path shape too", () => {
    // Otherwise a 128px thumbnail reads as a probe-verified large image and beats OpenLibrary's -L.
    expect(
      isGoogleThumbnail("https://bks5.books.google.com/books?id=x&zoom=1"),
    ).toBe(true);
  });
});

describe("openLibraryCoverUrlById", () => {
  it("defaults to the largest size", () => {
    expect(openLibraryCoverUrlById(240_727)).toBe(
      "https://covers.openlibrary.org/b/id/240727-L.jpg",
    );
  });

  it("takes an explicit size", () => {
    expect(openLibraryCoverUrlById(240_727, "M")).toBe(
      "https://covers.openlibrary.org/b/id/240727-M.jpg",
    );
  });

  it("returns null for the -1 sentinel and for an absent id", () => {
    // `-1` is truthy, so the call site's presence check let it build a URL that 503s.
    expect(openLibraryCoverUrlById(-1)).toBeNull();
    expect(openLibraryCoverUrlById(0)).toBeNull();
    expect(openLibraryCoverUrlById(undefined)).toBeNull();
    expect(openLibraryCoverUrlById(null)).toBeNull();
  });
});

describe("pickCoverUrl", () => {
  const ol = "https://covers.openlibrary.org/b/id/240727-L.jpg";

  it("prefers OpenLibrary over Google's 128px thumbnail", () => {
    expect(pickCoverUrl(googleThumb(), ol)).toBe(ol);
  });

  it("keeps a Google cover that is not a thumbnail", () => {
    const large = googleThumb().replace("zoom=1", "zoom=3");
    expect(pickCoverUrl(large, ol)).toBe(large);
  });

  it("falls back to whichever source has one", () => {
    expect(pickCoverUrl(googleThumb(), null)).toBe(googleThumb());
    expect(pickCoverUrl(null, ol)).toBe(ol);
    expect(pickCoverUrl(null, null)).toBeNull();
  });
});
