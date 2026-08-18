<template>
  <v-app>
    <v-main class="bg-charcoal">
      <div class="max-w-[1440px] mx-auto">
        <router-view />
      </div>
    </v-main>
    <MobileTabBar v-if="route.meta.mobileNav" />
    <ImportProgressChip v-if="authStore.isAuthenticated" />
  </v-app>
</template>

<script lang="ts" setup>
import { watch } from "vue";
import { useRoute } from "vue-router";
import { useTheme } from "vuetify";
import { useThemeStore } from "@/stores/theme";
import { useAccentStore } from "@/stores/accent";
import { usePaperStore } from "@/stores/paper";
import { useTypefaceStore } from "@/stores/typeface";
import { useLocaleStore } from "@/stores/locale";
import { useAuthStore } from "@/stores/auth";
import { useGuestStore } from "@/stores/guest";
import { useImportStore } from "@/stores/import";
import { PAPER_PRESETS, TYPEFACE_PRESETS } from "@/utils/appearance";
import MobileTabBar from "@/components/MobileTabBar.vue";
import ImportProgressChip from "@/components/import/ImportProgressChip.vue";

const route = useRoute();
const vuetifyTheme = useTheme();
const themeStore = useThemeStore();
const accentStore = useAccentStore();
const paperStore = usePaperStore();
const typefaceStore = useTypefaceStore();
// Instantiated here, before any child renders, so its watcher pushes the stored locale into
// vue-i18n up front rather than whenever the first locale-aware component happens to mount.
useLocaleStore();
const authStore = useAuthStore();
const guestStore = useGuestStore();

// Centralized retry for guest scans that failed to migrate on a previous login (network
// blip, etc.) — syncToAccount keeps failed ISBNs in localStorage for exactly this. Runs
// whenever the app is (or becomes) authenticated with leftover guest scans, so a stuck scan
// recovers on the next authenticated page load instead of requiring a logout/login cycle.
watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (authenticated && authStore.token && guestStore.scans.length > 0) {
      guestStore.syncToAccount(authStore.token);
    }
  },
  { immediate: true },
);

// An import session lives in localStorage and so outlives the account that started it: the next
// person to log in on this browser inherited the finished-import chip, and clicking it landed
// them on someone else's review screen. Cleared on the transition to logged-out — deliberately
// not `immediate`, or a reload during a legitimate session would discard a resumable import
// before the auth store has restored its token.
watch(
  () => authStore.isAuthenticated,
  (authenticated, wasAuthenticated) => {
    if (wasAuthenticated && !authenticated) useImportStore().reset();
  },
);

watch(
  () => themeStore.isDark,
  (dark) => {
    vuetifyTheme.change(dark ? "editorial-dark" : "editorial");
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  },
  { immediate: true },
);

watch(
  () => accentStore.color,
  (c) => {
    vuetifyTheme.themes.value["editorial"].colors.primary = c;
    vuetifyTheme.themes.value["editorial-dark"].colors.primary = c;
    document.documentElement.style.setProperty("--color-orange-neon", c);
  },
  { immediate: true },
);

// Paper depends on the active mode as well as the preset: each preset carries a
// light and a dark half, and only the active half is applied. Writing the vars
// inline on <html> outranks both the @theme defaults and the [data-theme="dark"]
// block in tailwind.css, so this wins regardless of which one would apply.
watch(
  [() => paperStore.preset, () => themeStore.isDark],
  ([preset, dark]) => {
    const definition = PAPER_PRESETS[preset];
    const mode = definition[dark ? "dark" : "light"];
    for (const [name, value] of Object.entries(mode.vars))
      document.documentElement.style.setProperty(`--color-${name}`, value);
    // The preset's dark half published under a second namespace, always — `.force-dark`
    // (tailwind.css) remaps the tokens from these, so an always-dark subtree still honors the
    // user's paper preset instead of falling back to the baseline dark palette.
    for (const [name, value] of Object.entries(definition.dark.vars))
      document.documentElement.style.setProperty(`--dark-color-${name}`, value);
    const theme =
      vuetifyTheme.themes.value[dark ? "editorial-dark" : "editorial"];
    Object.assign(theme.colors, mode.vuetify);
  },
  { immediate: true },
);

watch(
  () => typefaceStore.preset,
  (p) => {
    const { heading, body, mono } = TYPEFACE_PRESETS[p];
    document.documentElement.style.setProperty("--font-heading", heading);
    document.documentElement.style.setProperty("--font-body", body);
    document.documentElement.style.setProperty("--font-mono", mono);
  },
  { immediate: true },
);
</script>
