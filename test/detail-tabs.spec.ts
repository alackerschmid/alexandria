import { describe, it, expect } from "vitest";
import {
  buildTabs,
  detailsFieldCount,
  resolveActiveTab,
  workFactCount,
  DEFAULT_TAB,
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
  return { mobile: false, ...extra };
}

const keys = (c: TabContext) => buildTabs(c).map((t) => t.key);

describe("buildTabs", () => {
  it("offers every tab for a book with nothing in it — the row is the same for every book", () => {
    expect(keys(ctx({ mobile: true }))).toEqual([
      "overview",
      "record",
      "details",
      "review",
      "editions",
      "all",
    ]);
  });

  it("drops Record on desktop, where the masthead already holds the same controls", () => {
    expect(keys(ctx({ mobile: false }))).not.toContain("record");
    expect(keys(ctx({ mobile: false }))).toContain("review");
  });

  it("drops Record and Review when readonly — nothing there is the user's to set", () => {
    const readonly = keys(ctx({ readonly: true }));
    expect(readonly).not.toContain("record");
    expect(readonly).not.toContain("review");
  });

  it("offers Editions whatever the edition count, badged only once there is a count", () => {
    const badge = (c: TabContext) =>
      buildTabs(c).find((t) => t.key === "editions")?.badge;
    expect(keys(ctx({ editionCount: 1 }))).toContain("editions");
    expect(badge(ctx({ editionCount: 4 }))).toBe(4);
    expect(badge(ctx())).toBeUndefined();
    expect(badge(ctx({ editionCount: 0 }))).toBeUndefined();
  });

  it("puts All last", () => {
    expect(keys(ctx({ editionCount: 3 })).at(-1)).toBe("all");
  });
});

describe("resolveActiveTab", () => {
  it("defaults to Overview", () => {
    expect(resolveActiveTab(buildTabs(ctx()), null)).toBe("overview");
  });

  it("keeps the current tab when it still exists", () => {
    const tabs = buildTabs(ctx());
    expect(resolveActiveTab(tabs, "details")).toBe("details");
  });

  it("falls back rather than leaving a dead tab selected when the set shrinks", () => {
    // Record was active; the next book is a readonly edition, so that tab is gone.
    const tabs = buildTabs(ctx({ readonly: true }));
    expect(tabs.map((t) => t.key)).not.toContain("record");
    expect(resolveActiveTab(tabs, "record")).toBe("overview");
  });

  it("never returns undefined for an empty set", () => {
    expect(resolveActiveTab([], null)).toBe(DEFAULT_TAB);
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
