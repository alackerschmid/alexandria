import { ref, watch } from "vue";
import { useApi } from "@/composables/useApi";
import type { WorkEdition } from "@/types/book";

/**
 * The other editions of a work, loaded once per work for the detail view.
 *
 * It lives in the shell rather than in the Editions pane because the tab row needs the *count*
 * before the pane is ever rendered — a work with a single edition gets no Editions tab at all.
 *
 * The response is discarded when a newer load for a different work superseded it while in flight,
 * so switching quickly between two books can't leave one showing the other's editions.
 */
export function useWorkEditions(
  workId: () => number | null | undefined,
  enabled: () => boolean,
) {
  const { apiFetch } = useApi();
  const editions = ref<WorkEdition[]>([]);
  const loading = ref(false);

  async function load() {
    const id = workId();
    if (id == null || !enabled()) {
      editions.value = [];
      return;
    }
    loading.value = true;
    try {
      const res = await apiFetch(`/api/works/${id}/editions`);
      if (id !== workId()) return;
      if (!res.ok) {
        editions.value = [];
        return;
      }
      const data = (await res.json()) as { editions: WorkEdition[] };
      if (id !== workId()) return;
      editions.value = data.editions;
    } catch {
      editions.value = [];
    } finally {
      if (id === workId()) loading.value = false;
    }
  }

  watch([workId, enabled], load, { immediate: true });

  return { editions, loading, reload: load };
}
