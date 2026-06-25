<template>
  <div class="bg-charcoal min-h-screen md:h-screen flex flex-col overflow-hidden" :class="{ 'blur-sm': firstnameDialog }">

    <AppHeader />

    <!-- Top band: greeting + scan CTA -->
    <div class="shrink-0 px-6 md:px-14 pt-5 pb-3 md:py-8">
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 md:gap-16">
        <div>
          <p class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-4">{{ $t('home.welcome') }}</p>
          <h1 class="font-heading font-black text-[2.2rem] md:text-[2.75rem] leading-[1.02] text-text-primary mb-2">{{ greeting }}</h1>
          <p v-if="statsData" class="font-mono text-[10px] md:text-[11px] tracking-[0.05em] text-text-secondary">{{ metaLine }}</p>
        </div>
        <div
          class="flex justify-between items-center px-6 py-3.5 md:py-5 md:w-72 shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
          style="background: rgb(var(--v-theme-primary));"
          @click="$router.push('/scanner')"
        >
          <p class="font-heading font-black text-2xl leading-none" style="color: #111110;">{{ $t('home.scan_cta') }}</p>
          <v-icon icon="mdi-barcode" size="28" style="color: #111110;" />
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- Empty state -->
    <div v-else-if="statsData && statsData.total === 0" class="flex-1 flex flex-col items-center justify-center gap-3 px-6">
      <p class="font-heading font-black text-3xl text-text-primary text-center">{{ $t('home.dashboard_empty_heading') }}</p>
      <p class="text-sm text-text-secondary text-center max-w-xs">{{ $t('home.dashboard_empty_body') }}</p>
    </div>

    <!-- Dashboard -->
    <div v-else-if="statsData" class="flex-1 md:min-h-0 overflow-y-auto px-6 md:px-14 pb-8 flex flex-col gap-5">

      <!-- Stat tiles: 2×2 mobile, 4-col desktop -->
      <div class="grid grid-cols-2 md:grid-cols-4 border-t border-l border-charcoal-border shrink-0">
        <div
          v-for="tile in statTiles"
          :key="tile.key"
          class="border-r border-b border-charcoal-border px-[18px] py-[16px] md:px-[22px] md:py-[18px] flex flex-col"
        >
          <div class="flex items-center gap-2 mb-3">
            <span class="w-[7px] h-[7px] rounded-full shrink-0" :style="{ background: tile.color }"></span>
            <span class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary">{{ tile.label }}</span>
          </div>
          <div class="flex items-baseline gap-2 mb-3">
            <span class="font-heading font-black text-[1.8rem] md:text-[2.4rem] leading-none text-text-primary">{{ tile.value }}</span>
            <span class="font-mono text-[9px] text-text-secondary">{{ tile.pctLabel }}</span>
          </div>
          <div class="h-[3px] bg-charcoal-border relative">
            <div class="absolute left-0 top-0 bottom-0 transition-[width] duration-700" :style="{ width: tile.barWidth, background: tile.color }"></div>
          </div>
        </div>
      </div>

      <!-- Two columns -->
      <div class="flex flex-col md:flex-row gap-5 md:gap-9 flex-1 md:min-h-0">

        <!-- Left: at-a-glance + by-the-numbers -->
        <div class="flex-1 min-w-0 flex flex-col gap-5">

          <!-- Collection at a glance -->
          <div class="bg-charcoal-light border border-charcoal-border px-[22px] py-[18px] md:px-[26px] md:py-[22px] shrink-0">
            <div class="flex justify-between items-baseline mb-4">
              <span class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon">{{ $t('home.glance_title') }}</span>
              <AppSelect v-model="glanceMode" :options="dimensionOptions" :min-width="140" />
            </div>
            <div class="flex h-3 gap-0.5 mb-4">
              <div
                v-for="seg in glanceData"
                :key="seg.label"
                class="transition-[width] duration-500"
                :style="{ width: seg.pctWidth, background: seg.color }"
              ></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-5">
              <div v-for="seg in glanceData" :key="seg.label" class="flex items-center gap-2">
                <span class="w-2 h-2 shrink-0" :style="{ background: seg.color }"></span>
                <span class="flex-1 min-w-0 text-[11px] text-text-primary truncate">{{ seg.label }}</span>
                <span class="font-mono text-[10px] text-text-secondary">{{ seg.pctLabel }}</span>
              </div>
            </div>
          </div>

          <!-- By the numbers -->
          <div class="flex flex-col md:flex-row gap-5 md:gap-0 flex-1 md:min-h-0">
            <div class="md:w-[280px] md:shrink-0 flex flex-col justify-center">
              <p class="font-mono text-[8px] tracking-[0.22em] uppercase text-text-secondary mb-2.5">{{ $t('home.median_year') }}</p>
              <p
                v-if="statsData.medianYear"
                class="font-heading font-black text-[3.5rem] md:text-[82px] leading-[0.85] tracking-[-0.02em] text-text-primary"
              >{{ statsData.medianYear }}</p>
              <p v-else class="font-heading font-black text-[3.5rem] md:text-[82px] leading-none text-text-secondary">—</p>
              <p class="text-[13px] text-text-secondary leading-snug mt-3">{{ $t('home.median_year_desc') }}</p>
            </div>
            <div class="md:flex-1 border-t md:border-t-0 md:border-l border-charcoal-border pt-4 md:pt-0 md:pl-9 flex flex-col justify-center">
              <div
                v-for="item in trioItems"
                :key="item.key"
                class="flex items-baseline justify-between py-[13px] border-b border-charcoal-border"
              >
                <span class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary">{{ item.kicker }}</span>
                <span class="flex items-baseline gap-1.5">
                  <span class="font-heading font-black text-[28px] leading-none text-text-primary">{{ item.value ?? '—' }}</span>
                  <span v-if="item.unit" class="font-heading font-bold text-[14px] text-orange-neon">{{ item.unit }}</span>
                </span>
              </div>
            </div>
          </div>

        </div>

        <!-- Right: top authors -->
        <div class="md:w-[330px] md:shrink-0 border-t md:border-t-0 md:border-l border-charcoal-border pt-5 md:pt-0 md:pl-9 flex flex-col">
          <div class="flex justify-between items-baseline mb-5">
            <span class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon">{{ $t('home.most_represented') }}</span>
            <AppSelect v-model="mostRepMode" :options="dimensionOptions" :min-width="140" />
          </div>
          <div class="flex flex-col gap-4">
            <div
              v-for="(item, i) in mostRepresentedData"
              :key="item.name"
              :class="i >= 4 ? 'hidden md:block' : ''"
            >
              <div class="flex justify-between items-baseline mb-[7px]">
                <span class="font-heading font-bold text-[14px] text-text-primary">{{ item.name }}</span>
                <span class="font-mono text-[11px] text-text-secondary">{{ item.count }}</span>
              </div>
              <div class="h-[3px] bg-charcoal-border relative">
                <div class="absolute left-0 top-0 bottom-0" :style="{ width: item.barWidth, background: item.color }"></div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- First-name onboarding dialog -->
    <v-dialog v-model="firstnameDialog" max-width="420" persistent>
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#f5f2ed'">
        <v-card-text class="px-8 pt-8 pb-8">
          <p class="font-mono text-[10px] tracking-[0.3em] uppercase text-text-secondary mb-3">
            {{ $t('home.firstname_dialog_eyebrow') }}
          </p>
          <h2 class="font-heading font-black text-3xl text-text-primary leading-tight mb-2">
            {{ $t('home.firstname_dialog_heading') }}
          </h2>
          <p class="text-sm text-text-secondary mb-8">
            {{ $t('home.firstname_dialog_body') }}
          </p>
          <div class="border-b border-charcoal-border pb-2 mb-8">
            <label class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1">
              {{ $t('home.firstname_placeholder') }}
            </label>
            <input
              v-model="firstnameInput"
              type="text"
              autocomplete="given-name"
              autofocus
              class="w-full bg-transparent text-text-primary text-base outline-none placeholder:text-charcoal-border"
              :placeholder="$t('home.firstname_placeholder')"
              @keyup.enter="saveFirstname"
            />
          </div>
          <button
            :disabled="!firstnameInput.trim() || savingFirstname"
            class="w-full bg-text-primary text-charcoal py-4 text-xs font-bold tracking-[0.25em] uppercase hover:opacity-80 transition-opacity disabled:opacity-40"
            @click="saveFirstname"
          >
            {{ savingFirstname ? '—' : $t('home.firstname_save') }}
          </button>
        </v-card-text>
      </v-card>
    </v-dialog>

    <AppToast v-model="errorToast" :message="errorMessage" type="error" :timeout="4000" />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useLocaleStore } from '@/stores/locale'
import AppHeader from '@/components/AppHeader.vue'
import AppSelect from '@/components/AppSelect.vue'
import AppToast from '@/components/AppToast.vue'
import { useApi } from '@/composables/useApi'
import type { CollectionStats } from '@/types/stats'

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()
const { apiFetch } = useApi()

type GlanceMode = 'genre' | 'language' | 'authors' | 'status'

// ── State ─────────────────────────────────────────────────────────────────────

const statsData = ref<CollectionStats | null>(null)
const loading = ref(false)
const errorToast = ref(false)
const errorMessage = ref('')

// ── First-name onboarding ─────────────────────────────────────────────────────

const firstnameDialog = ref(!authStore.firstname)
const firstnameInput = ref('')
const savingFirstname = ref(false)

const saveFirstname = async () => {
  if (!firstnameInput.value.trim() || savingFirstname.value) return
  savingFirstname.value = true
  try {
    const res = await apiFetch('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ firstname: firstnameInput.value.trim() }),
    })
    if (res.ok) {
      authStore.setFirstname(firstnameInput.value.trim())
      firstnameDialog.value = false
    }
  } catch {}
  savingFirstname.value = false
}

// ── Derived ───────────────────────────────────────────────────────────────────

const greeting = computed(() => {
  const hour = new Date().getHours()
  const name = authStore.firstname ?? (() => {
    const raw = (authStore.email ?? '').split('@')[0]
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  })()
  const key = hour < 12 ? 'greeting_morning'
    : hour < 17 ? 'greeting_afternoon'
    : hour < 22 ? 'greeting_evening'
    : 'greeting_night'
  return t(`home.${key}`, { name })
})

const metaLine = computed(() => {
  const locale = localeStore.locale === 'de' ? 'de-DE' : 'en-GB'
  const dateStr = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  return t('home.meta', { date: dateStr, count: (statsData.value?.total ?? 0).toLocaleString() })
})

// ── Color helpers ─────────────────────────────────────────────────────────────

const colorRamp = computed<string[]>(() => themeStore.isDark
  ? ['#ff6600', '#b8afa6', '#8a8078', '#5c544e', '#3a3631', '#2a2724']
  : ['#ff6600', '#8a7a70', '#5c5249', '#3d3631', '#2a2421', '#c9c3bb'])

function secondaryBarColor(): string {
  return themeStore.isDark ? '#5c544e' : '#8a7a6f'
}

// ── Most represented (right column) ──────────────────────────────────────────

const mostRepresentedData = computed(() => {
  if (!statsData.value) return []
  const { topAuthors, genres, languages, byStatus, total } = statsData.value
  const ramp = colorRamp.value

  const barWidth = (count: number, max: number) =>
    max > 0 ? Math.round((count / max) * 100) + '%' : '0%'

  if (mostRepMode.value === 'authors') {
    const max = topAuthors[0]?.count ?? 1
    return topAuthors.slice(0, 6).map((a, i) => ({
      name: a.name,
      count: a.count,
      barWidth: barWidth(a.count, max),
      color: i === 0 ? 'rgb(var(--v-theme-primary))' : secondaryBarColor(),
    }))
  }

  if (mostRepMode.value === 'genre') {
    const top = genres.slice(0, 6)
    const max = top[0]?.count ?? 1
    return top.map((g, i) => ({
      name: g.label,
      count: g.count,
      barWidth: barWidth(g.count, max),
      color: ramp[i] ?? ramp[ramp.length - 1],
    }))
  }

  if (mostRepMode.value === 'language') {
    let displayNames: Intl.DisplayNames | null = null
    try { displayNames = new Intl.DisplayNames([localeStore.locale], { type: 'language' }) } catch {}
    const langLabel = (code: string) => { try { return displayNames?.of(code) ?? code } catch { return code } }
    const top = languages.slice(0, 6)
    const max = top[0]?.count ?? 1
    return top.map((l, i) => ({
      name: langLabel(l.code),
      count: l.count,
      barWidth: barWidth(l.count, max),
      color: ramp[i] ?? ramp[ramp.length - 1],
    }))
  }

  // status
  const items = [
    { name: t('book.read'),    count: byStatus.read,    color: 'rgb(var(--v-theme-success))' },
    { name: t('book.unread'),  count: byStatus.unread,  color: 'var(--color-text-secondary)' },
    { name: t('book.reading'), count: byStatus.reading, color: 'rgb(var(--v-theme-primary))' },
  ].filter(s => s.count > 0)
  const max = total > 0 ? total : 1
  return items.map(s => ({ ...s, barWidth: barWidth(s.count, max) }))
})

// ── Stat tiles ────────────────────────────────────────────────────────────────

const statTiles = computed(() => {
  if (!statsData.value) return []
  const { total, byStatus } = statsData.value
  const pctOf = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0
  const totalColor = themeStore.isDark ? '#c9c1b8' : '#8a7a6f'
  return [
    {
      key: 'total',
      label: t('home.stat_total'),
      value: total.toLocaleString(),
      pctLabel: '100%',
      barWidth: '100%',
      color: totalColor,
    },
    {
      key: 'read',
      label: t('home.stat_read'),
      value: byStatus.read.toLocaleString(),
      pctLabel: pctOf(byStatus.read) + '%',
      barWidth: Math.max(pctOf(byStatus.read), byStatus.read > 0 ? 4 : 0) + '%',
      color: 'rgb(var(--v-theme-success))',
    },
    {
      key: 'unread',
      label: t('home.stat_unread'),
      value: byStatus.unread.toLocaleString(),
      pctLabel: pctOf(byStatus.unread) + '%',
      barWidth: pctOf(byStatus.unread) + '%',
      color: 'var(--color-text-secondary)',
    },
    {
      key: 'reading',
      label: t('home.stat_reading'),
      value: byStatus.reading.toLocaleString(),
      pctLabel: pctOf(byStatus.reading) + '%',
      barWidth: Math.max(pctOf(byStatus.reading), byStatus.reading > 0 ? 4 : 0) + '%',
      color: 'rgb(var(--v-theme-primary))',
    },
  ]
})

// ── At a glance ───────────────────────────────────────────────────────────────

const glanceMode = ref<GlanceMode>('genre')
const mostRepMode = ref<GlanceMode>('authors')

const dimensionOptions = computed(() => [
  { value: 'genre',    label: t('home.dim_genre') },
  { value: 'language', label: t('home.dim_language') },
  { value: 'authors',  label: t('home.dim_authors') },
  { value: 'status',   label: t('home.dim_status') },
])

const glanceData = computed(() => {
  if (!statsData.value) return []
  const { total, genres, languages, byStatus, topAuthors } = statsData.value
  const ramp = colorRamp.value
  const pctOf = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0
  const pctStr = (n: number) => pctOf(n) + '%'

  if (glanceMode.value === 'authors') {
    const top = topAuthors.slice(0, 5)
    const topTotal = top.reduce((s, a) => s + a.count, 0)
    const otherCount = total - topTotal
    const segs = top.map((a, i) => ({ label: a.name, color: ramp[i], pctWidth: pctStr(a.count), pctLabel: pctStr(a.count) }))
    if (otherCount > 0) segs.push({ label: t('home.glance_other'), color: ramp[5] ?? ramp[4], pctWidth: pctStr(otherCount), pctLabel: pctStr(otherCount) })
    return segs
  }

  if (glanceMode.value === 'genre') {
    const top = genres.slice(0, 5)
    const topTotal = top.reduce((s, g) => s + g.count, 0)
    const otherCount = total - topTotal
    const segs = top.map((g, i) => ({ label: g.label, color: ramp[i], pctWidth: pctStr(g.count), pctLabel: pctStr(g.count) }))
    if (otherCount > 0) segs.push({ label: t('home.glance_other'), color: ramp[5] ?? ramp[4], pctWidth: pctStr(otherCount), pctLabel: pctStr(otherCount) })
    return segs
  }

  if (glanceMode.value === 'language') {
    let displayNames: Intl.DisplayNames | null = null
    try { displayNames = new Intl.DisplayNames([localeStore.locale], { type: 'language' }) } catch {}
    const langLabel = (code: string) => {
      try { return displayNames?.of(code) ?? code } catch { return code }
    }
    const top = languages.slice(0, 5)
    const topTotal = top.reduce((s, l) => s + l.count, 0)
    const otherCount = total - topTotal
    const segs = top.map((l, i) => ({ label: langLabel(l.code), color: ramp[i], pctWidth: pctStr(l.count), pctLabel: pctStr(l.count) }))
    if (otherCount > 0) segs.push({ label: t('home.glance_other'), color: ramp[5] ?? ramp[4], pctWidth: pctStr(otherCount), pctLabel: pctStr(otherCount) })
    return segs
  }

  // status
  return [
    { label: t('book.read'),    color: 'rgb(var(--v-theme-success))', pctWidth: pctStr(byStatus.read),    pctLabel: pctStr(byStatus.read) },
    { label: t('book.unread'),  color: 'var(--color-text-secondary)', pctWidth: pctStr(byStatus.unread),  pctLabel: pctStr(byStatus.unread) },
    { label: t('book.reading'), color: 'rgb(var(--v-theme-primary))', pctWidth: pctStr(byStatus.reading), pctLabel: pctStr(byStatus.reading) },
  ].filter(s => s.pctWidth !== '0%')
})

// ── By the numbers ────────────────────────────────────────────────────────────

function ordinalCentury(n: number): string {
  if (localeStore.locale === 'de') return n + '.'
  const v = n % 100
  const suffix = (v >= 11 && v <= 13) ? 'th' : (['th', 'st', 'nd', 'rd'][v % 10] ?? 'th')
  return n + suffix
}

const trioItems = computed(() => {
  if (!statsData.value) return []
  const { avgPages, richestCentury, languageCount } = statsData.value
  return [
    { key: 'pages', kicker: t('home.avg_length'),      value: avgPages ?? null,                           unit: t('home.unit_pp') },
    { key: 'era',   kicker: t('home.richest_era'),      value: richestCentury ? ordinalCentury(richestCentury) : null, unit: t('home.unit_century') },
    { key: 'langs', kicker: t('home.languages_label'),  value: languageCount > 0 ? languageCount : null,  unit: '' },
  ]
})

// ── Data fetching ─────────────────────────────────────────────────────────────

const fetchStats = async () => {
  try {
    const res = await apiFetch('/api/stats')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch stats')
    statsData.value = data
  } catch (err: any) {
    errorMessage.value = err.message
    errorToast.value = true
  }
}

onMounted(async () => {
  loading.value = true
  await fetchStats()
  loading.value = false
})
</script>
