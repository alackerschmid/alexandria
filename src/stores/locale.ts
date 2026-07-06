import { defineStore } from "pinia";
import { ref } from "vue";
import i18n from "@/plugins/i18n";

type Locale = "en" | "de";

export const useLocaleStore = defineStore("locale", () => {
  const locale = ref<Locale>(i18n.global.locale.value as Locale);

  function set(l: Locale) {
    locale.value = l;
    i18n.global.locale.value = l;
    localStorage.setItem("locale", l);
  }

  function toggle() {
    set(locale.value === "en" ? "de" : "en");
  }

  return { locale, toggle, set };
});
