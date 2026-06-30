import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ReadStatus } from '@/types/book'

// Single source of truth for how a reading status is presented across the app.
// Different call sites need different colour representations:
//  - Tailwind classes (`textClass`/`dotClass`/`activeClass`) for HTML in the cards & detail view
//  - fixed hex (`color`/`tint`) for inline styles in the scanner session preview
//  - theme-adaptive CSS vars (`themeColor`) for the cover dot & the home charts (light/dark aware)

export const STATUS_ORDER: ReadStatus[] = ['unread', 'reading', 'read']

export const NEXT_STATUS: Record<ReadStatus, ReadStatus> = {
  unread: 'reading',
  reading: 'read',
  read: 'unread',
}

export interface StatusMeta {
  /** Tailwind text + hover classes for the status label button */
  textClass: string
  /** Tailwind background class for the status dot */
  dotClass: string
  /** Tailwind text class for the active option in a status picker */
  activeClass: string
  /** mdi icon name */
  icon: string
  /** Solid colour (hex) for inline styles — scanner session preview */
  color: string
  /** Translucent tint background (rgba) for inline styles — scanner session preview */
  tint: string
  /** Theme-adaptive CSS colour (light/dark aware) — cover dot & home charts */
  themeColor: string
}

export const STATUS_META: Record<ReadStatus, StatusMeta> = {
  unread: {
    textClass: 'text-text-secondary/50 hover:text-text-secondary',
    dotClass: 'bg-text-secondary/40',
    activeClass: 'text-text-secondary',
    icon: 'mdi-circle-outline',
    color: '#8a8078',
    tint: 'rgba(138,128,120,0.12)',
    themeColor: 'var(--color-text-secondary)',
  },
  reading: {
    textClass: 'text-orange-neon',
    dotClass: 'bg-orange-neon',
    activeClass: 'text-orange-neon',
    icon: 'mdi-book-open-outline',
    color: '#ff6600',
    tint: 'rgba(255,102,0,0.10)',
    themeColor: 'rgb(var(--v-theme-primary))',
  },
  read: {
    textClass: 'text-[#22c55e]',
    dotClass: 'bg-[#22c55e]',
    activeClass: 'text-[#22c55e]',
    icon: 'mdi-check-circle-outline',
    color: '#22c55e',
    tint: 'rgba(34,197,94,0.10)',
    themeColor: 'rgb(var(--v-theme-success))',
  },
}

export type StatusConfig = StatusMeta & { label: string }

/** Reactive status presentation with translated labels. */
export function useBookStatus() {
  const { t } = useI18n()

  const statusConfig = computed<Record<ReadStatus, StatusConfig>>(() => ({
    unread: { ...STATUS_META.unread, label: t('book.unread') },
    reading: { ...STATUS_META.reading, label: t('book.reading') },
    read: { ...STATUS_META.read, label: t('book.read') },
  }))

  const statusLabels = computed<Record<ReadStatus, string>>(() => ({
    unread: t('book.unread'),
    reading: t('book.reading'),
    read: t('book.read'),
  }))

  const statusOptions = computed(() =>
    STATUS_ORDER.map(status => ({
      status,
      label: t(`book.${status}`),
      dotClass: STATUS_META[status].dotClass,
      activeClass: STATUS_META[status].activeClass,
    })),
  )

  return { statusConfig, statusLabels, statusOptions }
}
