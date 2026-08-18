import { ref } from "vue";
import { useI18n } from "vue-i18n";
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
  const { t } = useI18n();

  const serverBooks = ref<Book[]>([]);
  const seriesMemberships = ref<SeriesMemberships>({});
  const error = ref("");
  // Whether a fetch has ever come back with rows. The library page needs the distinction to tell
  // "you own nothing yet" from "we never got an answer" — without it, an unreachable worker paints
  // the first-scan empty state over a full shelf, which reads as data loss.
  const hasLoaded = ref(false);
  let fetchSeq = 0;

  async function fetchBooks(onLoaded?: () => void) {
    const seq = ++fetchSeq;
    // Cleared per attempt, not only set on failure: `error` backs a banner on the library page
    // that had no other way to go away, so one transient failure left it on screen for the rest
    // of the session even after a successful refetch.
    error.value = "";
    try {
      const collected: Book[] = [];
      let offset = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await apiFetch(
          `/api/scans?limit=${PAGE_SIZE}&offset=${offset}&locale=${localeStore.locale}`,
        );
        // Status first, body second. A worker that is down answers with an empty body, and parsing
        // that threw a DOMException whose text ("Failed to execute 'json' on 'Response'…") went
        // straight into the banner. Only a JSON error object is worth quoting; anything else gets
        // the translated message.
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (seq !== fetchSeq) return;
          error.value = body?.error || t("library.error_load");
          return;
        }
        const data = await res.json();
        if (seq !== fetchSeq) return;
        collected.push(...data);
        if (data.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      serverBooks.value = collected;
      hasLoaded.value = true;
      onLoaded?.();
    } catch {
      if (seq !== fetchSeq) return;
      // Everything reaching here is a transport failure — `fetch` rejecting (no network, no
      // worker, CORS) or a 200 that isn't JSON. Their native messages are browser-authored,
      // untranslated and meaningless to a reader, so none of them is shown.
      error.value = t("library.error_load");
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

  return {
    serverBooks,
    seriesMemberships,
    error,
    hasLoaded,
    fetchBooks,
    fetchMemberships,
  };
}
