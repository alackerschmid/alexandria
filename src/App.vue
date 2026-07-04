<template>
  <v-app>
    <v-main class="bg-charcoal">
      <div class="max-w-[1440px] mx-auto">
        <router-view />
      </div>
    </v-main>
    <MobileTabBar v-if="route.meta.mobileNav" />
  </v-app>
</template>

<script lang="ts" setup>
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTheme } from 'vuetify'
import { useThemeStore } from '@/stores/theme'
import { useAccentStore } from '@/stores/accent'
import { useAuthStore } from '@/stores/auth'
import { useGuestStore } from '@/stores/guest'
import MobileTabBar from '@/components/MobileTabBar.vue'

const route = useRoute()
const vuetifyTheme = useTheme()
const themeStore = useThemeStore()
const accentStore = useAccentStore()
const authStore = useAuthStore()
const guestStore = useGuestStore()

// Centralized retry for guest scans that failed to migrate on a previous login (network
// blip, etc.) — syncToAccount keeps failed ISBNs in localStorage for exactly this. Runs
// whenever the app is (or becomes) authenticated with leftover guest scans, so a stuck scan
// recovers on the next authenticated page load instead of requiring a logout/login cycle.
watch(
  () => authStore.isAuthenticated,
  (authenticated) => {
    if (authenticated && authStore.token && guestStore.scans.length > 0) {
      guestStore.syncToAccount(authStore.token)
    }
  },
  { immediate: true },
)

watch(
  () => themeStore.isDark,
  (dark) => {
    vuetifyTheme.global.name.value = dark ? 'editorial-dark' : 'editorial'
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  },
  { immediate: true },
)

watch(
  () => accentStore.color,
  (c) => {
    vuetifyTheme.themes.value['editorial'].colors.primary = c
    vuetifyTheme.themes.value['editorial-dark'].colors.primary = c
    document.documentElement.style.setProperty('--color-orange-neon', c)
  },
  { immediate: true },
)
</script>
