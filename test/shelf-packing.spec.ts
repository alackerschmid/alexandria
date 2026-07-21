import { describe, it, expect } from "vitest";
import {
  packRows,
  type ShelfGroup,
  type ShelfEntry,
  type PackedSlot,
} from "@/utils/shelf-packing";

function makeGroup(key: string, n: number): ShelfGroup {
  const entries: ShelfEntry[] = Array.from({ length: n }, (_, i) => ({
    key: `${key}-${i}`,
    title: `${key} ${i}`,
    cover_url: null,
    ordinal: null,
    owned: true,
  }));
  return { key, label: key, complete: false, countLabel: String(n), entries };
}

const allEntries = (g: ShelfGroup) => g.entries;
const noneExpanded = () => false;

// Sum of segment spans on a row must never exceed the column count.
function assertRowsFit(rows: ReturnType<typeof packRows>, cols: number) {
  for (const row of rows) {
    const sum = row.segments.reduce((acc, s) => acc + s.span, 0);
    expect(sum).toBeLessThanOrEqual(cols);
  }
}

describe("packRows", () => {
  it("packs two short groups into one shared row", () => {
    const rows = packRows(
      4,
      [makeGroup("A", 2), makeGroup("B", 2)],
      allEntries,
      () => false,
      noneExpanded,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].segments).toHaveLength(2);
    expect(rows[0].segments[0].span).toBe(2);
    expect(rows[0].segments[1].span).toBe(2);
    // Each segment is the group's first row → both carry a header.
    expect(rows[0].segments[0].groupLabel?.text).toBe("A");
    expect(rows[0].segments[1].groupLabel?.text).toBe("B");
    assertRowsFit(rows, 4);
  });

  it("shows a group's header only on its first row", () => {
    const rows = packRows(4, [makeGroup("A", 6)], allEntries, () => false, noneExpanded);
    expect(rows).toHaveLength(2);
    expect(rows[0].segments[0].groupLabel).not.toBeNull();
    expect(rows[0].segments[0].groupLabel?.text).toBe("A");
    // Continuation row carries no header.
    expect(rows[1].segments[0].groupLabel).toBeNull();
    assertRowsFit(rows, 4);
  });

  it("appends a 'more' tile for a hasMore group and reports the full total", () => {
    // hasMore trims the visible cards to cols-1 (=3); the group actually has 6 entries.
    const entriesFor = (g: ShelfGroup, hasMore: boolean) =>
      hasMore ? g.entries.slice(0, 3) : g.entries;
    const rows = packRows(
      4,
      [makeGroup("A", 6)],
      entriesFor,
      () => true,
      noneExpanded,
    );
    expect(rows).toHaveLength(1);
    const slots = rows[0].segments[0].slots;
    expect(slots).toHaveLength(4);
    const more = slots[3] as Extract<PackedSlot, { type: "more" }>;
    expect(more.type).toBe("more");
    expect(more.count).toBe(6); // full total, not the trimmed 3
    expect(more.expanded).toBe(false);
    assertRowsFit(rows, 4);
  });

  it("reflects expansion state in the 'more' tile", () => {
    const entriesFor = (g: ShelfGroup, hasMore: boolean) =>
      hasMore ? g.entries.slice(0, 3) : g.entries;
    const rows = packRows(4, [makeGroup("A", 6)], entriesFor, () => true, () => true);
    const more = rows[0].segments[0].slots.at(-1) as Extract<
      PackedSlot,
      { type: "more" }
    >;
    expect(more.expanded).toBe(true);
  });

  it("keeps a hasMore group on its own row so its tile never bleeds into the next group", () => {
    // A is hasMore and its visible entries overflow one row (edition-expansion case):
    // 5 shown cards + 1 more tile = 6 slots over 4 cols → 2 rows, then flush.
    const entriesFor = (g: ShelfGroup) =>
      g.key === "A" ? g.entries.slice(0, 5) : g.entries;
    const hasMoreFor = (g: ShelfGroup) => g.key === "A";
    const rows = packRows(
      4,
      [makeGroup("A", 9), makeGroup("B", 2)],
      entriesFor,
      hasMoreFor,
      noneExpanded,
    );
    // A spans two rows; B must start a fresh row of its own.
    const bRow = rows.find((r) => r.segments.some((s) => s.groupLabel?.text === "B"));
    expect(bRow).toBeDefined();
    // B's row contains only B — no A slots leaked in.
    const keysOnBRow = bRow!.segments.flatMap((s) => s.slots.map((sl) => sl.key));
    expect(keysOnBRow.every((k) => k.startsWith("B") || k.startsWith("more-B"))).toBe(true);
    assertRowsFit(rows, 4);
  });

  it("starts a hasMore group on a fresh row when the current row is partially filled", () => {
    // A (2 entries, no more) leaves the first row half-full; B is hasMore and must
    // not share that row — it starts fresh so its cards+tile stay together.
    const entriesFor = (g: ShelfGroup, hasMore: boolean) =>
      hasMore ? g.entries.slice(0, 3) : g.entries;
    const hasMoreFor = (g: ShelfGroup) => g.key === "B";
    const rows = packRows(
      4,
      [makeGroup("A", 2), makeGroup("B", 6)],
      entriesFor,
      hasMoreFor,
      noneExpanded,
    );
    const aRow = rows.find((r) => r.segments.some((s) => s.groupLabel?.text === "A"))!;
    const aKeys = aRow.segments.flatMap((s) => s.slots.map((sl) => sl.key));
    expect(aKeys.some((k) => k.startsWith("B"))).toBe(false);
    assertRowsFit(rows, 4);
  });

  it("repeats a group's header when its continuation lands in a different column", () => {
    // Rincewind (2) shares row 1 with Dark Tower (2 of 4) at cols 2-3; Dark Tower's
    // remaining 2 entries continue on row 2 at cols 0-1 — a different column than
    // where its header was, so the header must repeat instead of leaving a gap.
    const rows = packRows(
      4,
      [makeGroup("Rincewind", 2), makeGroup("DarkTower", 4)],
      allEntries,
      () => false,
      noneExpanded,
    );
    expect(rows).toHaveLength(2);
    const row1DarkTower = rows[0].segments.find((s) => s.groupLabel?.text === "DarkTower");
    expect(row1DarkTower?.groupLabel).not.toBeNull();
    const row2DarkTower = rows[1].segments.find((s) =>
      s.slots.some((sl) => sl.key.startsWith("DarkTower")),
    );
    expect(row2DarkTower?.groupLabel?.text).toBe("DarkTower");
    assertRowsFit(rows, 4);
  });

  it("returns no rows for an empty group list", () => {
    expect(packRows(4, [], allEntries, () => false, noneExpanded)).toEqual([]);
  });
});
