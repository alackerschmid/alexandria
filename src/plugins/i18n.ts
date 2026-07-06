import { createI18n } from "vue-i18n";
import en from "../locales/en.json";
import de from "../locales/de.json";

export const BCP47: Record<string, string> = { de: "de-DE", en: "en-GB" };

export default createI18n({
  legacy: false,
  locale: (localStorage.getItem("locale") as "en" | "de") ?? "en",
  fallbackLocale: "en",
  messages: { en, de },
});
