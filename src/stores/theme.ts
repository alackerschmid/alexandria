import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'auto'

const mq = typeof window !== 'undefined'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(
    (localStorage.getItem('themeMode') as ThemeMode)
    || (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'),
  )
  const systemDark = ref(mq?.matches ?? false)

  if (mq) {
    mq.addEventListener('change', (e) => { systemDark.value = e.matches })
  }

  const isDark = computed(() => {
    if (mode.value === 'auto') return systemDark.value
    return mode.value === 'dark'
  })

  function setMode(m: ThemeMode) {
    mode.value = m
    localStorage.setItem('themeMode', m)
    localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
  }

  function toggle() {
    setMode(isDark.value ? 'light' : 'dark')
  }

  return { mode, isDark, setMode, toggle }
})
