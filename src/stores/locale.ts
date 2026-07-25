import { defineStore } from "pinia";
import { watch } from "vue";
import i18n from "@/plugins/i18n";
import { persistedStr } from "@/stores/preferences";

type Locale = "en" | "de";

const isValid = (l: string): l is Locale => l === "en" || l === "de";

export const useLocaleStore = defineStore("locale", () => {
  const locale = persistedStr<Locale>("locale", "en", isValid);

  // Keep vue-i18n in sync with the active preference — including when it changes underneath us
  // because a user logged in and their stored locale loaded from the server.
  watch(
    locale,
    (l) => {
      i18n.global.locale.value = l;
    },
    { immediate: true },
  );

  function set(l: Locale) {
    locale.value = l;
  }

  function toggle() {
    set(locale.value === "en" ? "de" : "en");
  }

  return { locale, toggle, set };
});
