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
import MobileTabBar from '@/components/MobileTabBar.vue'

const route = useRoute()
const vuetifyTheme = useTheme()
const themeStore = useThemeStore()
const accentStore = useAccentStore()

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
