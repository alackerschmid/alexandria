import { computed, type ComputedRef, type Ref } from "vue";
import { pickRepresentativeEdition } from "@/utils/book-display";
import type { Book } from "@/types/book";

/**
 * Collapses same-work editions in an already search-filtered book list into a single
 * synthetic card per work, so it can drop into the existing display pipeline (sorting,
 * groupBy, pagination) unchanged. Must run downstream of search/filtering — filters like
 * `status:unread` need to match real per-edition fields, not a synthetic representative.
 *
 * Editions with no linked work (`work_id == null`) are never collapsed with each other —
 * each becomes its own singleton bucket, so grouping never blocks on enrichment.
 *
 * `enabled` (default on) gates the whole collapse — when off, every edition passes through
 * as its own card, matching the pre-grouping display.
 */
export function useEditionGrouping(
  books: ComputedRef<Book[]>,
  enabled: Ref<boolean> | boolean = true,
): ComputedRef<Book[]> {
  return computed(() => {
    const isEnabled = typeof enabled === "boolean" ? enabled : enabled.value;
    if (!isEnabled) return books.value;

    const buckets = new Map<string, Book[]>();
    const order: string[] = [];
    for (const book of books.value) {
      const key = book.work_id != null ? `work:${book.work_id}` : `book:${book.id}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = [];
        buckets.set(key, bucket);
        order.push(key);
      }
      bucket.push(book);
    }

    return order.map((key) => {
      const bucket = buckets.get(key)!;
      // Setting editionCount to 1 here (rather than leaving it undefined) lets consumers tell
      // "known single edition" apart from "grouping wasn't run" and skip work accordingly.
      if (bucket.length === 1) return { ...bucket[0], editionCount: 1 };

      const representative = pickRepresentativeEdition(bucket);
      return {
        ...representative,
        title: representative.work_canonical_title ?? representative.title,
        editionCount: bucket.length,
        editions: [representative, ...bucket.filter((b) => b !== representative)],
      };
    });
  });
}
