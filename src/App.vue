<template>
  <v-app>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
import { watch } from 'vue'
import { useTheme } from 'vuetify'
import { useThemeStore } from '@/stores/theme'
import { useAccentStore } from '@/stores/accent'

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
