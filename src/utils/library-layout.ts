// Grid arithmetic for the library's tile and list views. Pure on purpose: the page these
// serve (`pages/index.vue`) can't be unit-tested in this repo's scope, and both of these are
// exactly the kind of off-by-a-row rule that is invisible in a screenshot at one window size.

/**
 * How many columns of `target`-wide cards fit into `contentWidth`, with `gap` between them,
 * clamped to `[min, max]`.
 *
 * Rounds to the *nearest* count rather than flooring, so a width that is a little short of the
 * next column still gets it and the cards come out slightly under target instead of leaving a
 * column's worth of empty track. The resulting card width therefore ranges roughly 0.8×–1.3×
 * `target`.
 *
 * A `contentWidth` of 0 (nothing measured yet) yields `min`; callers that care about the first
 * paint should supply their own fallback rather than rendering a 1-column grid for a frame.
 */
export function fitColumns(
  contentWidth: number,
  target: number,
  gap: number,
  min: number,
  max: number,
): number {
  const n = Math.round((contentWidth + gap) / (target + gap));
  return Math.min(max, Math.max(min, n));
}

/**
 * Rounds a chosen page size to a whole number of rows of `columns`, so a page never ends in a
 * ragged half row.
 *
 * Nearest, not up: the column count is a function of window width, so rounding up turned a
 * 12-per-page choice into 22 books on an 11-column grid — an 83% overshoot of an explicit
 * setting. Nearest keeps the chosen number recognisable in both directions (12 at 11 columns is
 * 11, at 8 columns is 16), and the floor of one full row keeps a page non-empty when the grid
 * has more columns than the user asked for books.
 */
export function fillWholeRows(pageSize: number, columns: number): number {
  return Math.max(columns, Math.round(pageSize / columns) * columns);
}
