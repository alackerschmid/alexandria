import { defineStore } from "pinia";
import { persistedStr } from "@/stores/preferences";

// Factory for the appearance preset stores (paper, typeface): a single preset key persisted
// through the per-user preferences store and validated against the known preset map on read.
// Each store differs only in its id, preference key, preset map, and default — so they share
// this one body instead of copying it.
export function createPresetStore<K extends string>(
  id: string,
  key: string,
  presets: Record<K, unknown>,
  fallback: K,
) {
  return defineStore(id, () => {
    const preset = persistedStr<K>(
      key,
      fallback,
      (v): v is K => v in presets,
    );

    function set(p: K) {
      preset.value = p;
    }

    return { preset, set };
  });
}
