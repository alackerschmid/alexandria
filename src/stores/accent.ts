import { defineStore } from "pinia";
import { ref } from "vue";

export const DEFAULT_ACCENT = "#ff6600";

export const useAccentStore = defineStore("accent", () => {
  const color = ref(localStorage.getItem("accent") || DEFAULT_ACCENT);

  function set(c: string) {
    color.value = c;
    localStorage.setItem("accent", c);
  }

  return { color, set };
});
