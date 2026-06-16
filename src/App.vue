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

const vuetifyTheme = useTheme()
const themeStore = useThemeStore()

watch(
  () => themeStore.isDark,
  (dark) => {
    vuetifyTheme.global.name.value = dark ? 'editorial-dark' : 'editorial'
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  },
  { immediate: true },
)
</script>
