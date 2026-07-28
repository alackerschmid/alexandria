import { describe, it, expect } from "vitest";
import {
  buildTabs,
  detailsFieldCount,
  hasOverview,
  resolveActiveTab,
  workFactCount,
  type TabContext,
} from "@/utils/detail-tabs";
import type { Book } from "@/types/book";

function book(extra: Partial<Book> = {}): Book {
  return {
    id: 1,
    isbn: "9780000000001",
    title: "The White Album",
    author: "Joan Didion",
    cover_url: null,
    status: "read",
    owning_status: "owned",
    rating: null,
    review: null,
    created_at: "2024-01-01T00:00:00Z",
    work_id: 7,
    ...extra,
  };
}

function ctx(extra: Partial<TabContext> = {}): TabContext {
  return {
    book: book(),
    customFieldCount: 0,
    mobile: false,
    ...extra,
  };
}

const keys = (c: TabContext) => buildTabs(c).map((t) => t.key);

describe("hasOverview", () => {
  it("is false when the book has no prose and no genres", () => {
    expect(hasOverview(book())).toBe(false);
  });

  it.each([
    ["description", { description: "A collection of essays." }],
    ["first_line", { first_line: "We tell ourselves stories in order to live." }],
    ["epigraph", { epigraph: "..." }],
    ["genres", { genres: ["Essay"] }],
  ])("is true from %s alone", (_label, extra) => {
    expect(hasOverview(book(extra))).toBe(true);
  });

  it("ignores an empty genre array", () => {
    expect(hasOverview(book({ genres: [] }))).toBe(false);
  });
});

describe("buildTabs", () => {
  it("drops Overview entirely when there is nothing to show, so the page opens on Details", () => {
    expect(keys(ctx())).not.toContain("overview");
    expect(resolveActiveTab(buildTabs(ctx()), null)).toBe("all");
  });

  it("always offers Review for an owned book, dotted until one is written", () => {
    const unwritten = buildTabs(ctx()).find((t) => t.key === "review");
    expect(unwritten?.dot).toBe(true);
    const written = buildTabs(ctx({ book: book({ review: "Good." }) })).find(
      (t) => t.key === "review",
    );
    expect(written?.dot).toBe(false);
  });

  it("drops Record and Review when readonly — nothing there is the user's to set", () => {
    const readonly = keys(ctx({ readonly: true, mobile: true }));
    expect(readonly).not.toContain("record");
    expect(readonly).not.toContain("review");
  });

  it("offers Record on mobile even with no custom fields, since it holds the only controls", () => {
    expect(keys(ctx({ mobile: true }))).toContain("record");
  });

  it("offers Record on desktop only once there are custom fields to show there", () => {
    expect(keys(ctx({ mobile: false }))).not.toContain("record");
    expect(keys(ctx({ mobile: false, customFieldCount: 2 }))).toContain(
      "record",
    );
  });

  it("offers Editions only for a work with more than one known edition", () => {
    expect(keys(ctx({ editionCount: 1 }))).not.toContain("editions");
    expect(keys(ctx({ editionCount: 4 }))).toContain("editions");
    expect(
      keys(ctx({ book: book({ work_id: null }), editionCount: 4 })),
    ).not.toContain("editions");
  });

  it("carries the edition count as the tab badge", () => {
    const tab = buildTabs(ctx({ editionCount: 4 })).find(
      (t) => t.key === "editions",
    );
    expect(tab?.badge).toBe(4);
  });

  it("puts All last", () => {
    expect(keys(ctx({ mobile: true, editionCount: 3 })).at(-1)).toBe("all");
  });

  it("omits All when only one pane survives — there is nothing to stack", () => {
    expect(keys(ctx({ readonly: true }))).toEqual(["details"]);
  });
});

describe("resolveActiveTab", () => {
  it("defaults to All", () => {
    expect(resolveActiveTab(buildTabs(ctx({ mobile: true })), null)).toBe("all");
  });

  it("keeps the current tab when it still exists", () => {
    const tabs = buildTabs(ctx({ mobile: true }));
    expect(resolveActiveTab(tabs, "details")).toBe("details");
  });

  it("falls back rather than leaving a dead tab selected when the set shrinks", () => {
    // Overview was active; the next book has no description, so that tab is gone.
    const tabs = buildTabs(ctx({ mobile: true }));
    expect(tabs.map((t) => t.key)).not.toContain("overview");
    expect(resolveActiveTab(tabs, "overview")).toBe("all");
  });

  it("never returns undefined for an empty set", () => {
    expect(resolveActiveTab([], null)).toBe("details");
  });
});

describe("field counts", () => {
  it("counts only the work facts that are present", () => {
    expect(workFactCount(book())).toBe(0);
    expect(
      workFactCount(
        book({
          original_pub_date: "1979",
          form_of_work: "Essay collection",
          countries_of_origin: [],
          awards: ["A"],
          nominations: ["B", "C"],
        }),
      ),
    ).toBe(3); // date + form + recognition; the empty country array doesn't count
  });

  it("always counts the ISBN, so Details is never an empty pane", () => {
    expect(detailsFieldCount(book())).toBe(1);
  });

  it("treats a reference page count as standing in for a missing page count", () => {
    expect(detailsFieldCount(book({ reference_page_count: 189 }))).toBe(2);
    expect(
      detailsFieldCount(
        book({ number_of_pages_median: 189, reference_page_count: 200 }),
      ),
    ).toBe(2);
  });
});
