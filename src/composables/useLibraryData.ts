import { ref } from "vue";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";
import type { SeriesMemberships } from "@/composables/useShelfGroups";
import type { Book } from "@/types/book";

const PAGE_SIZE = 500;
// Hard ceiling so a pagination/sort-stability bug (pages that never shrink below PAGE_SIZE)
// can't spin the loop forever — 40 pages is 20,000 books, far beyond any real library.
const MAX_PAGES = 40;

/**
 * Owns the library page's server data: the full paginated scan list and the
 * per-series membership map. `fetchBooks` guards against overlapping fetches
 * (locale switches, remounts) with a sequence counter so a slow earlier response
 * can't clobber a newer one.
 */
export function useLibraryData() {
  const { apiFetch } = useApi();
  const localeStore = useLocaleStore();

  const serverBooks = ref<Book[]>([]);
  const seriesMemberships = ref<SeriesMemberships>({});
  const error = ref("");
  let fetchSeq = 0;

  async function fetchBooks(onLoaded?: () => void) {
    const seq = ++fetchSeq;
    try {
      const collected: Book[] = [];
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await apiFetch(
          `/api/scans?limit=${PAGE_SIZE}&offset=${offset}&locale=${localeStore.locale}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch books");
        if (seq !== fetchSeq) return;
        collected.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      serverBooks.value = collected;
      onLoaded?.();
    } catch (err: any) {
      if (seq !== fetchSeq) return;
      error.value = err.message;
    }
  }

  // Full series membership (incl. unowned entries) for the grouped-by-series shelves.
  // Failure here is non-fatal: shelves fall back to owned-only counts.
  async function fetchMemberships() {
    try {
      const res = await apiFetch(`/api/series?locale=${localeStore.locale}`);
      if (!res.ok) return;
      seriesMemberships.value = await res.json();
    } catch {
      /* non-fatal */
    }
  }

  return { serverBooks, seriesMemberships, error, fetchBooks, fetchMemberships };
}
