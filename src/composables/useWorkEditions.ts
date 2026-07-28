import { ref, watch } from "vue";
import { useApi } from "@/composables/useApi";
import type { WorkEdition } from "@/types/book";

export interface WorkEditionsOptions {
  /** The work whose editions to load; null/undefined while the book has no work link yet. */
  workId: () => number | null | undefined;
  /** Only fetch once the caller actually needs the list. */
  enabled: () => boolean;
  /**
   * The owned-edition count when the caller already knows it — `useEditionGrouping` sets this to 1
   * for a single-edition work. A work with one edition can offer nothing to browse, so knowing that
   * up front skips the request entirely, which is the common case.
   */
  knownCount?: () => number | undefined;
}

/**
 * The other editions of a work, loaded once per work for the detail view.
 *
 * It lives in the shell rather than in the Editions pane because the tab row needs the *count*
 * before the pane is ever rendered (a single-edition work gets no Editions tab).
 *
 * The list is cached per work and deliberately **not** cleared when `enabled` goes false: collapsing
 * back to card mode and re-expanding is a round trip the user makes constantly, and dropping the
 * list would refetch each time — and, while that request was in flight, make the Editions tab
 * vanish and take the user's tab selection with it.
 *
 * A response superseded by a newer work while in flight is discarded, so switching quickly between
 * two books can't leave one showing the other's editions.
 */
export function useWorkEditions(options: WorkEditionsOptions) {
  const { apiFetch } = useApi();
  const editions = ref<WorkEdition[]>([]);
  /** The work `editions` currently holds, so a re-enable doesn't refetch what's already loaded. */
  const loadedWorkId = ref<number | null>(null);

  async function load() {
    const id = options.workId();
    if (id == null || !options.enabled()) return;
    if (loadedWorkId.value === id) return;

    if ((options.knownCount?.() ?? 0) === 1) {
      editions.value = [];
      loadedWorkId.value = id;
      return;
    }

    try {
      const res = await apiFetch(`/api/works/${id}/editions`);
      if (id !== options.workId()) return;
      if (!res.ok) return;
      const data = (await res.json()) as { editions: WorkEdition[] };
      if (id !== options.workId()) return;
      editions.value = data.editions;
      loadedWorkId.value = id;
    } catch {
      // Leave whatever was loaded; the Editions tab simply doesn't appear.
    }
  }

  // Drop the cache only when the *work* changes — never on enable/disable.
  watch(options.workId, (id) => {
    if (id !== loadedWorkId.value) {
      editions.value = [];
      loadedWorkId.value = null;
    }
    load();
  });
  watch(options.enabled, load, { immediate: true });

  return { editions };
}
