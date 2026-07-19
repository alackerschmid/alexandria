import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_TYPEFACE,
  TYPEFACE_PRESETS,
  type TypefacePreset,
} from "@/utils/appearance";

function stored(): TypefacePreset {
  const saved = localStorage.getItem("typeface");
  return saved && saved in TYPEFACE_PRESETS
    ? (saved as TypefacePreset)
    : DEFAULT_TYPEFACE;
}

export const useTypefaceStore = defineStore("typeface", () => {
  const preset = ref<TypefacePreset>(stored());

  function set(p: TypefacePreset) {
    preset.value = p;
    localStorage.setItem("typeface", p);
  }

  return { preset, set };
});
