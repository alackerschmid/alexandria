<template>
  <header class="shrink-0 flex justify-between items-center px-6 md:px-14 py-4 md:py-5.5 border-b border-charcoal-border">
    <router-link
      to="/home"
      class="text-orange-neon font-mono text-[9px] md:text-[10px] font-bold tracking-[0.28em] md:tracking-[0.35em] uppercase leading-snug max-w-40 md:max-w-none"
    >
      {{ $t('app_name') }}
    </router-link>
    <div class="flex items-center gap-5 md:gap-8">
      <nav class="hidden md:flex items-center gap-8">
        <router-link
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          class="text-[11px] tracking-[0.18em] uppercase transition-colors"
          :class="
            route.name === link.name
              ? 'text-text-primary border-b border-text-primary pb-px pointer-events-none'
              : 'text-text-secondary hover:text-text-primary'
          "
        >
          {{ link.label }}
        </router-link>
      </nav>
      <div class="flex items-center gap-1">
        <v-menu location="bottom end" :offset="8">
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="w-8 h-8 rounded-full border border-charcoal-border bg-charcoal-light flex items-center justify-center font-mono text-[11px] text-text-primary hover:opacity-70 transition-opacity"
            >
              {{ userInitial }}
            </button>
          </template>
          <div
            class="py-1 border border-charcoal-border"
            :style="{ background: themeStore.isDark ? '#1c1b19' : '#f5f2ed', minWidth: '180px' }"
          >
            <button
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
              @click="themeStore.toggle()"
            >
              <v-icon :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'" size="14" class="text-text-secondary shrink-0" />
              <span class="text-[11px] tracking-widest uppercase text-text-primary">{{ themeStore.isDark ? $t('home.theme_light') : $t('home.theme_dark') }}</span>
            </button>
            <button
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
              @click="localeStore.toggle()"
            >
              <v-icon icon="mdi-translate" size="14" class="text-text-secondary shrink-0" />
              <span class="text-[11px] tracking-widest uppercase text-text-primary">{{ localeStore.locale === 'en' ? 'Deutsch' : 'English' }}</span>
            </button>
            <div class="border-t border-charcoal-border my-1" />
            <button
              class="w-full flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
              @click="authStore.logout()"
            >
              <v-icon icon="mdi-logout" size="14" class="text-text-secondary shrink-0" />
              <span class="text-[11px] tracking-widest uppercase text-text-primary">{{ $t('home.sign_out') }}</span>
            </button>
          </div>
        </v-menu>
      </div>
    </div>
  </header>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useLocaleStore } from '@/stores/locale'

const { t } = useI18n()
const route = useRoute()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()

const userInitial = computed(() => (authStore.email ?? '').charAt(0).toUpperCase())

const navLinks = computed(() => [
  { name: 'dashboard', to: '/home', label: t('home.nav_home') },
  { name: 'library',   to: '/library', label: t('home.nav_library') },
  { name: 'scanner',   to: '/scanner', label: t('home.nav_scan') },
])
</script>
