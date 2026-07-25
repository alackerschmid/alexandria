import { defineStore } from "pinia";
import { persistedStr } from "@/stores/preferences";

export const DEFAULT_ACCENT = "#ff6600";

const isHexColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

export const useAccentStore = defineStore("accent", () => {
  // Validated like every other preference: the value is written straight into
  // `--color-orange-neon` and Vuetify's `primary`, and the server stores the blob opaquely.
  const color = persistedStr("accent", DEFAULT_ACCENT, (v): v is string =>
    isHexColor(v),
  );

  function set(c: string) {
    color.value = c;
  }

  return { color, set };
});
