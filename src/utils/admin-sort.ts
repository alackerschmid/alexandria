/**
 * Sorting for the admin board's tables. Pure, so the comparator — which has to settle how nulls,
 * strings and numbers order against each other — can be unit-tested without mounting a table.
 */

export type SortDirection = "asc" | "desc";

/** What a sortable cell reduces to. `null` is "no value", not "the smallest value". */
export type SortValue = string | number | boolean | null;

function compare(
  a: Exclude<SortValue, null>,
  b: SortValue,
  collator: Intl.Collator,
): number {
  if (typeof a === "string" || typeof b === "string") {
    return collator.compare(String(a), String(b));
  }
  // Booleans coerce the way the column reads: false before true, so "admin" lands on one end.
  return Number(a) - Number(b);
}

/**
 * A copy of `rows` ordered by `value`. Rows whose value is `null` always sort **last**, in either
 * direction: a user who has never scanned has no last-activity date at all, and letting those fill
 * the top half of a descending sort would bury the rows the column was clicked to find.
 *
 * `Array.prototype.sort` is stable, so equal values keep the order the API returned them in.
 */
export function sortRows<T>(
  rows: readonly T[],
  value: (row: T) => SortValue,
  direction: SortDirection,
  locale?: string,
): T[] {
  // numeric: true so "op 2" precedes "op 10"; base sensitivity so case never decides a tie.
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  const sign = direction === "asc" ? 1 : -1;

  return [...rows].sort((rowA, rowB) => {
    const a = value(rowA);
    const b = value(rowB);
    if (a === null || b === null) {
      if (a === b) return 0;
      return a === null ? 1 : -1;
    }
    return sign * compare(a, b, collator);
  });
}
