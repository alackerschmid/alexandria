import { computed, ref } from "vue";
import { useAdminFormat } from "@/composables/useAdminFormat";
import { sortRows } from "@/utils/admin-sort";
import type { SortDirection, SortValue } from "@/utils/admin-sort";

export type SortColumn<T> = {
  /** The cell value this column orders by — the *displayed* one, where they differ. */
  value: (row: T) => SortValue;
  /** Counts and dates read "biggest first", so their first click sorts descending. */
  descFirst?: boolean;
};

/**
 * Click-to-sort state for a board table, shared by the roster and the endpoint table so the two
 * can't disagree about what a second click does.
 *
 * Starts unsorted — `sorted` is the API's own order until a header is clicked, since both
 * endpoints already return a deliberate one (newest user first, busiest endpoint first).
 */
export function useTableSort<T>(
  rows: () => readonly T[],
  columns: Record<string, SortColumn<T>>,
) {
  const { tag } = useAdminFormat();

  const sortKey = ref<string | null>(null);
  const sortDirection = ref<SortDirection>("asc");

  function toggle(key: string): void {
    const column = columns[key];
    if (!column) return;
    if (sortKey.value === key) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = key;
    sortDirection.value = column.descFirst ? "desc" : "asc";
  }

  const sorted = computed<readonly T[]>(() => {
    const key = sortKey.value;
    const column = key ? columns[key] : undefined;
    if (!column) return rows();
    return sortRows(rows(), column.value, sortDirection.value, tag.value);
  });

  return { sortKey, sortDirection, toggle, sorted };
}
