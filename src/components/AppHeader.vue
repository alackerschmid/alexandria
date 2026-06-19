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
        <v-btn
          variant="text"
          color="primary"
          size="small"
          class="text-[10px] tracking-widest font-mono"
          @click="localeStore.toggle()"
        >
          {{ localeStore.locale === 'en' ? 'DE' : 'EN' }}
        </v-btn>
        <v-btn
          :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          variant="text"
          color="primary"
          size="small"
          @click="themeStore.toggle()"
        />
        <v-menu location="bottom end" :offset="8">
          <template #activator="{ props: menuProps }">
            <button
              v-bind="menuProps"
              class="ml-1 w-8 h-8 rounded-full border border-charcoal-border bg-charcoal-light flex items-center justify-center font-mono text-[11px] text-text-primary hover:opacity-70 transition-opacity"
            >
              {{ userInitial }}
            </button>
          </template>
          <v-list
            density="compact"
            rounded="0"
            :bg-color="themeStore.isDark ? '#1c1b19' : '#f5f2ed'"
            min-width="160"
          >
            <v-list-item
              prepend-icon="mdi-logout"
              class="text-[11px] tracking-widest uppercase"
              @click="authStore.logout()"
            >
              {{ $t('home.sign_out') }}
            </v-list-item>
          </v-list>
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
