// The matched table's column geometry, shared by the header strip (import.vue) and each
// MatchedRow so the two can't drift apart.
//
// The dense row only fits from `lg` (1145px) up — below that the fixed columns leave the title
// too little room, so the grid collapses to two columns and every cell stacks with its own
// label. The header strip is hidden there.
// Deliberately omits the `display` utility — the row applies `grid`, the header `hidden lg:grid`.
// Baking `grid` in here would override the header's `hidden` and leak it onto stacked layouts.
export const MATCHED_GRID =
  "grid-cols-[40px_1fr] lg:grid-cols-[40px_1fr_180px_150px_124px_116px_28px] items-center gap-x-4 gap-y-3";

export const MATCHED_ROW_PADDING = "px-6 md:px-8";
