import { describe, it, expect } from "vitest";
import { fitColumns, fillWholeRows } from "@/utils/library-layout";

// The two gaps the library actually renders with (gap-4 / gap-3.5) and the widest content box
// the shell allows (max-w-[1440px] minus the page's px-10) — so these read as the real cases
// rather than arbitrary numbers.
const TILE_GAP = 16;
const LIST_GAP = 14;
const WIDEST = 1360;

describe("fitColumns", () => {
  it("fits the list grid to 4 columns at the widest content box", () => {
    expect(fitColumns(WIDEST, 330, LIST_GAP, 2, 5)).toBe(4);
  });

  it("fits the tile grid by cover size at the widest content box", () => {
    expect(fitColumns(WIDEST, 110, TILE_GAP, 4, 14)).toBe(11);
    expect(fitColumns(WIDEST, 150, TILE_GAP, 4, 14)).toBe(8);
    expect(fitColumns(WIDEST, 200, TILE_GAP, 4, 14)).toBe(6);
  });

  it("rounds to the nearest column rather than flooring", () => {
    // The midpoint sits at 1190px (3.5 columns) and rounds up, so 1189 is the last width
    // that still renders 3 cards ~387px wide rather than 4 at ~287.
    expect(fitColumns(1150, 330, LIST_GAP, 2, 5)).toBe(3);
    expect(fitColumns(1189, 330, LIST_GAP, 2, 5)).toBe(3);
    expect(fitColumns(1190, 330, LIST_GAP, 2, 5)).toBe(4);
  });

  it("clamps at both ends", () => {
    expect(fitColumns(4000, 150, TILE_GAP, 4, 14)).toBe(14);
    expect(fitColumns(300, 330, LIST_GAP, 2, 5)).toBe(2);
  });

  it("yields the minimum when nothing has been measured yet", () => {
    expect(fitColumns(0, 150, TILE_GAP, 4, 14)).toBe(4);
  });
});

describe("fillWholeRows", () => {
  it("leaves a size that already fills whole rows alone", () => {
    expect(fillWholeRows(24, 8)).toBe(24);
    expect(fillWholeRows(12, 4)).toBe(12);
  });

  it("rounds to the nearest whole row, not up", () => {
    // The regression this exists for: ceil() turned 12-per-page into 22 books on the
    // 11-column (small-cover, 1920px) grid.
    expect(fillWholeRows(12, 11)).toBe(11);
    expect(fillWholeRows(12, 5)).toBe(10);
    expect(fillWholeRows(96, 7)).toBe(98);
  });

  it("never drops below one full row", () => {
    expect(fillWholeRows(12, 14)).toBe(14);
    expect(fillWholeRows(1, 8)).toBe(8);
  });
});
