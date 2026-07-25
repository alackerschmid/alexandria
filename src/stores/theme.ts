import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { persistedStr } from "@/stores/preferences";

export type ThemeMode = "light" | "dark" | "auto";

// Device-global, not per-user: index.html and plugins/vuetify.ts read it before Vue boots, so
// the first paint isn't the wrong theme. This store owns it.
export const THEME_HINT_KEY = "theme";

const mq =
  typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function isValidMode(m: string): m is ThemeMode {
  return (["light", "dark", "auto"] as string[]).includes(m);
}

export const useThemeStore = defineStore("theme", () => {
  const systemDark = ref(mq?.matches ?? false);

  if (mq) {
    mq.addEventListener("change", (e) => {
      systemDark.value = e.matches;
    });
  }

  const mode = persistedStr<ThemeMode>("themeMode", "light", isValidMode);

  const isDark = computed(() => {
    if (mode.value === "auto") return systemDark.value;
    return mode.value === "dark";
  });

  // Track whatever is currently shown, not just explicit picks: logging out reverts to the
  // default light theme, and the next reload shouldn't flash the previous user's dark.
  watch(
    isDark,
    (dark) => {
      localStorage.setItem(THEME_HINT_KEY, dark ? "dark" : "light");
    },
    { immediate: true },
  );

  function setMode(m: ThemeMode) {
    mode.value = m;
  }

  function toggle() {
    setMode(isDark.value ? "light" : "dark");
  }

  return { mode, isDark, setMode, toggle };
});
