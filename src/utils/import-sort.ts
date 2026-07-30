import { OWNING_ORDER } from "@/composables/useOwningStatus";
import { STATUS_PROGRESS_ORDER } from "@/utils/book-display";
import type { OwningStatus, ReadStatus } from "@/types/book";

/**
 * The display order of the review screen's Matched cards: owning status, then reading status, then
 * rating descending — so an owned, read, 10/10 book sits at the top and an unowned, unread, unrated
 * one at the bottom.
 *
 * Expressed as a single sortable number per card rather than a comparator, because the rank is
 * captured **once**, when the card is created (`sortRank` on `ImportedItem`). The cards are editable
 * in place, and a live comparator would make a card jump out from under the click that changed its
 * status or rating.
 *
 * Pure and unit-tested (`test/import-sort.spec.ts`).
 */

// Each axis gets its listed values plus one trailing slot for an unrecognized value (an older
// persisted session, say), which indexOrLast sends last on its axis rather than first — the slot has
// to be inside the radix, or a sentinel on one axis overflows into the next bucket of the axis above.
const STATUS_SLOTS = STATUS_PROGRESS_ORDER.length + 1;
/** 1-10 descending, plus one trailing slot shared by 0 and null (both "no opinion"). */
const RATING_SLOTS = 11;

/** Just enough of a card to rank it. */
export interface ImportSortable {
  status: ReadStatus;
  owningStatus: OwningStatus;
  rating: number | null;
}

/**
 * A card's rank — lower sorts first. Ties keep arrival order, since `Array.prototype.sort` is stable.
 *
 * The owning axis reuses `OWNING_ORDER` (the library sort's and search facets' order) and the reading
 * axis `STATUS_PROGRESS_ORDER` (the edition-collapsing rule's) — deliberately not `STATUS_ORDER`,
 * which is the pickers' order, and not its reverse either.
 */
export function importSortRank(item: ImportSortable): number {
  const owningIdx = indexOrLast(OWNING_ORDER, item.owningStatus);
  const statusIdx = indexOrLast(STATUS_PROGRESS_ORDER, item.status);
  // 0 and null both mean "no opinion" here (Goodreads leaves unrated books at 0), so both land in
  // the trailing slot rather than sorting as the worst possible rating.
  const ratingIdx = item.rating ? 10 - item.rating : RATING_SLOTS - 1;
  return (owningIdx * STATUS_SLOTS + statusIdx) * RATING_SLOTS + ratingIdx;
}

function indexOrLast<T>(order: readonly T[], value: T): number {
  const idx = order.indexOf(value);
  return idx === -1 ? order.length : idx;
}
