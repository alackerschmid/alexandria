import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_PAPER,
  PAPER_PRESETS,
  type PaperPreset,
} from "@/utils/appearance";

function stored(): PaperPreset {
  const saved = localStorage.getItem("paper");
  return saved && saved in PAPER_PRESETS ? (saved as PaperPreset) : DEFAULT_PAPER;
}

export const usePaperStore = defineStore("paper", () => {
  const preset = ref<PaperPreset>(stored());

  function set(p: PaperPreset) {
    preset.value = p;
    localStorage.setItem("paper", p);
  }

  return { preset, set };
});
