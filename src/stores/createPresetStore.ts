import { defineStore } from "pinia";
import { ref } from "vue";

// Factory for the appearance preset stores (paper, typeface): a single preset key persisted to
// localStorage and validated against the known preset map on load. Each store differs only in its
// id, storage key, preset map, and default — so they share this one body instead of copying it.
export function createPresetStore<K extends string>(
  id: string,
  key: string,
  presets: Record<K, unknown>,
  fallback: K,
) {
  return defineStore(id, () => {
    const saved = localStorage.getItem(key);
    const preset = ref<K>(saved && saved in presets ? (saved as K) : fallback);

    function set(p: K) {
      preset.value = p;
      localStorage.setItem(key, p);
    }

    return { preset, set };
  });
}
