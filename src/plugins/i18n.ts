import { createI18n } from "vue-i18n";
import en from "../locales/en.json";
import de from "../locales/de.json";

export const BCP47: Record<string, string> = { de: "de-DE", en: "en-GB" };

// The active locale is owned by stores/locale.ts, which syncs it here on boot (and again when
// a login loads that user's stored locale) — this is only the value before that store runs.
export default createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: { en, de },
});
