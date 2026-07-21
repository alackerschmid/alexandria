import type { Book, OwningStatus, ReadStatus } from "@/types/book";

// Shared shelf data shapes (produced by useShelfGroups, consumed by the library
// page template and by packRows below). Kept here — free of Vue/i18n imports — so
// the bin-packer stays unit-testable in a plain node environment
// (test/shelf-packing.spec.ts).

export interface ShelfEntry {
  key: string;
  title: string | null;
  cover_url: string | null;
  ordinal: number | null;
  owned: boolean;
  status?: ReadStatus;
  owningStatus?: OwningStatus;
  author?: string | null;
  book?: Book;
  seriesId?: number | null;
  editionCount?: number;
}

export interface ShelfGroup {
  key: string;
  label: string;
  seriesId?: number | null;
  complete: boolean;
  countLabel: string;
  entries: ShelfEntry[];
}

export interface GroupCaption {
  text: string;
  seriesId: number | null;
  complete: boolean;
  countLabel: string;
}

export type PackedSlot =
  | { type: "entry"; key: string; entry: ShelfEntry }
  | {
      type: "more";
      key: string;
      groupKey: string;
      expanded: boolean;
      count: number;
    };

export interface RowSegment {
  key: string;
  span: number;
  groupLabel: GroupCaption | null;
  slots: PackedSlot[];
}

export interface PackedRow {
  key: string;
  segments: RowSegment[];
}

/**
 * Bin-packs grouped shelves into shared physical rows (desktop packed layout):
 * a short group's cards share a grid row with the next group's cards instead of
 * leaving the rest of that row empty. Each row is split into column-spanning
 * "segments" (one per group represented in it); a segment carries the header
 * treatment sized to the columns it occupies, shown once on the group's first row.
 *
 * A group with more entries than are visible gets a trailing "show all / collapse"
 * tile appended, and `packRows` always ends such a group on its own row so that
 * tile (and any overflow cards) can never bleed into the next group's row.
 *
 * Pure over its inputs — the reactive plumbing (which groups, current row size,
 * expansion state) is injected by the caller:
 *  - `entriesFor(g, hasMore)` — the visible entries for a group, already trimmed
 *  - `hasMoreFor(g)`          — whether the group shows a trailing "more" tile
 *  - `isExpandedFor(g)`       — whether the group is currently expanded
 */
export function packRows(
  cols: number,
  groups: ShelfGroup[],
  entriesFor: (g: ShelfGroup, hasMore: boolean) => ShelfEntry[],
  hasMoreFor: (g: ShelfGroup) => boolean,
  isExpandedFor: (g: ShelfGroup) => boolean,
): PackedRow[] {
  const rows: PackedRow[] = [];
  let curRow: RowSegment[] = [];
  let curCol = 0;
  let rowIndex = 0;

  function flushRow() {
    if (curRow.length) rows.push({ key: `row-${rowIndex++}`, segments: curRow });
    curRow = [];
    curCol = 0;
  }

  for (const g of groups) {
    const hasMore = hasMoreFor(g);
    const slots: PackedSlot[] = entriesFor(g, hasMore).map((entry) => ({
      type: "entry",
      key: entry.key,
      entry,
    }));
    if (hasMore) {
      slots.push({
        type: "more",
        key: `more-${g.key}`,
        groupKey: g.key,
        expanded: isExpandedFor(g),
        count: g.entries.length,
      });
      // The trailing tile starts a fresh row when the current one is partially
      // filled, so the group's cards+tile stay together.
      if (curCol > 0) flushRow();
    }

    let prevStartCol: number | null = null;
    let i = 0;
    while (i < slots.length) {
      const take = Math.min(cols - curCol, slots.length - i);
      const chunk = slots.slice(i, i + take);
      // Header shown on the group's first row, and repeated whenever a continuation
      // lands in a different starting column than its previous chunk — i.e. it no
      // longer sits directly beneath the header (or the last repeat), which would
      // otherwise read as an unlabeled gap. A chunk that continues at the same
      // column as the previous one (the common case: the group fills whole rows by
      // itself) stays a bare continuation — repeating there would just be clutter.
      const showHeader = curCol !== prevStartCol;
      curRow.push({
        key: `${g.key}-${i}`,
        span: take,
        groupLabel: showHeader
          ? {
              text: g.label,
              seriesId: g.seriesId ?? null,
              complete: g.complete,
              countLabel: g.countLabel,
            }
          : null,
        slots: chunk,
      });
      prevStartCol = curCol;
      curCol += take;
      i += take;
      if (curCol >= cols) flushRow();
    }
    // A `hasMore` group always ends its own row — this is what actually guarantees
    // the "more" tile (and any overflow cards) can never bleed into the next group.
    if (hasMore) flushRow();
  }
  flushRow();
  return rows;
}
