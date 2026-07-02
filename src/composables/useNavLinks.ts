import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

export interface NavLink {
  name: string
  to: string
  label: string
  icon: string
  activeIcon: string
}

// Single source of truth for the app's primary destinations, shared by the
// desktop header nav (shows all of them) and the mobile bottom tab bar
// (shows the scan action plus whichever 2 of these aren't the current section).
export function useNavLinks() {
  const { t } = useI18n()

  const navLinks = computed<NavLink[]>(() => [
    { name: 'dashboard', to: '/home', label: t('home.nav_home'), icon: 'mdi-home-outline', activeIcon: 'mdi-home' },
    { name: 'library', to: '/library', label: t('home.nav_library'), icon: 'mdi-bookshelf', activeIcon: 'mdi-bookshelf' },
    { name: 'scanner', to: '/scanner', label: t('home.nav_scan'), icon: 'mdi-barcode', activeIcon: 'mdi-barcode' },
    { name: 'settings', to: '/settings', label: t('settings.nav_label'), icon: 'mdi-cog-outline', activeIcon: 'mdi-cog' },
  ])

  return { navLinks }
}
